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
}
