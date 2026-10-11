import { query } from '../config/database';
import { CoopSemester } from '../types';

/** ใบที่จบเส้นทางแล้ว — ตรงกับตัวกันใบซ้ำใน models/intent.ts */
const TERMINAL_INTENT_STATUSES = `('rejected', 'company_rejected', 'superseded')`;

export class CoopSemesterModel {
  /**
   * Get the current active cooperative education semester.
   * มีได้ภาคเดียว — partial unique `uq_coop_semesters_one_active` (migration 047)
   */
  static async findActiveSemester(): Promise<CoopSemester | null> {
    const res = await query(
      `SELECT semester_id, academic_year, semester, is_active 
       FROM coop_semesters 
       WHERE is_active = TRUE 
       LIMIT 1`
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopSemester;
  }

  /**
   * Find a cooperative semester by ID.
   */
  static async findById(semesterId: number): Promise<CoopSemester | null> {
    const res = await query(
      `SELECT semester_id, academic_year, semester, is_active 
       FROM coop_semesters 
       WHERE semester_id = $1`,
      [semesterId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopSemester;
  }

  /**
   * ภาคของใบที่นักศึกษายังเดินอยู่ (ใบล่าสุดที่ไม่ถูกปฏิเสธ/ยกเลิก)
   * null = ไม่มีใบที่เดินอยู่ → ผู้เรียกใช้ภาคที่ active แทน
   *
   * ด่านปฏิทินและผลประเมินของนักศึกษาต้องอ่านภาคนี้ ไม่ใช่ภาค active — ไม่งั้นพอเปิดภาคใหม่
   * ใบของภาคเก่าที่ยังฝึกอยู่จะถูกล็อกด้วยหน้าต่างของภาคใหม่
   */
  static async findStudentSemesterId(studentId: number): Promise<number | null> {
    const res = await query(
      `SELECT semester_id FROM intent_forms
        WHERE student_id = $1 AND status NOT IN ${TERMINAL_INTENT_STATUSES}
        ORDER BY form_id DESC LIMIT 1`,
      [studentId]
    );
    return (res.rowCount ?? 0) > 0 ? (res.rows[0].semester_id as number) : null;
  }

  /** ภาคของใบหนึ่ง — เฉพาะใบของนักศึกษาคนนั้น (ใบของคนอื่น = null ไม่บอกว่ามีอยู่) */
  static async findIntentSemesterId(formId: number, studentId: number): Promise<number | null> {
    const res = await query(
      `SELECT semester_id FROM intent_forms WHERE form_id = $1 AND student_id = $2`,
      [formId, studentId]
    );
    return (res.rowCount ?? 0) > 0 ? (res.rows[0].semester_id as number) : null;
  }

  /**
   * นักศึกษาที่เจ้าหน้าที่ปิดใบที่ฝึก (ถูกส่งตัวกลับ / เปลี่ยนที่ฝึก) = มีใบ `superseded` ในภาคนั้น
   * → ผ่านด่านปฏิทินของการหาที่ใหม่ได้แม้พ้นช่วง (`middlewares/calendarGate.ts` เป็นคนใช้)
   *
   * ⛔ นิยามเดียวของสิทธิ์นี้ ห้ามเขียนเงื่อนไขซ้ำที่อื่น · `superseded` ตั้งได้ทางเดียวคือเจ้าหน้าที่ปิดใบ
   *    (`IntentFormModel.closeAcceptedByOfficer`) และยกเลิกการปิดแล้วใบกลับเป็น `accepted` สิทธิ์จึงหายเอง
   * `semesterId` ว่าง = ภาคที่ active (กติกาเดียวกับ `CoopCalendarModel.findWindow`)
   */
  static async hasReplacementPass(studentId: number, semesterId: number | null): Promise<boolean> {
    const res = await query(
      `SELECT 1 FROM intent_forms i
         JOIN coop_semesters s ON s.semester_id = i.semester_id
        WHERE i.student_id = $1 AND i.status = 'superseded'
          AND CASE WHEN $2::int IS NULL THEN s.is_active ELSE s.semester_id = $2 END
        LIMIT 1`,
      [studentId, semesterId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
