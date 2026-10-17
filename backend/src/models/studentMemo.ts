import { query } from '../config/database';
import type { MemoDetails } from '../config/memoTypes';

/**
 * บันทึกข้อความของนักศึกษา — คำร้องกรณียกเว้นที่เสนอถึงคณบดี
 *
 * เก็บสิ่งที่นักศึกษาเขียน + **คำตัดสินของคณบดี** (`status` · migration 058 · เจ้าของสั่ง 2026-10-18
 * กลับคำตัดสิน 2026-08-27 ที่เคยให้ไม่มีสถานะ) — คณบดีกดอนุมัติ/ไม่อนุมัติในระบบ แล้วเจ้าหน้าที่นำบันทึกที่
 * อนุมัติ (หัวข้อ early_departure · late_submission) ไปเปิดรอบพิเศษให้นักศึกษา
 *
 * ลายเซ็นบนกระดาษยังเป็นหลักฐานทางการ · คำตัดสินในระบบคือสิ่งที่ปลดล็อกรอบพิเศษ
 * ⛔ ตัดสินแล้วแก้ไม่ได้ (`decide` ยอมเฉพาะแถวที่ยัง pending) · สถานะมีสามค่าที่ฐานบังคับ ไม่ใช่ชื่อที่ตั้งเอง
 */

export type MemoDecisionStatus = 'pending' | 'approved' | 'rejected';

export interface StudentMemoRow {
  memo_id: number;
  student_id: number;
  semester_id: number;
  memo_type: string;
  intent_form_id: number | null;
  reason: string;
  created_at: string;
  status: MemoDecisionStatus;
  decided_at: string | null;
  decision_note: string | null;
  /** รายละเอียดเฉพาะหัวข้อ (migration 059) — ดู `parseMemoDetails` */
  details: MemoDetails;
}

/** แถวพร้อมข้อมูลที่ต้องพิมพ์ลงกระดาษ — รวมมาในคำสั่งเดียวเพื่อไม่ต้องยิงซ้ำ */
export interface StudentMemoWithContext extends StudentMemoRow {
  /** ใบความจำนงที่บันทึกอ้างถึง — ให้คณบดีเห็นว่านักศึกษาอยู่ที่ไหน สถานะอะไร (null ถ้าไม่ได้อ้างใบ) */
  intent_company_name_th: string | null;
  intent_status: string | null;
  student_code: string | null;
  first_name: string | null;
  last_name: string | null;
  student_phone: string | null;
  major_name_th: string | null;
  faculty_name_th: string | null;
  academic_year: number | null;
  semester: string | null;
}

const SELECT_WITH_CONTEXT = `
  SELECT m.memo_id, m.student_id, m.semester_id, m.memo_type, m.intent_form_id,
         m.reason, m.created_at, m.status, m.decided_at, m.decision_note, m.details,
         s.student_code, s.first_name, s.last_name, s.phone AS student_phone,
         maj.major_name_th, f.faculty_name_th,
         sem.academic_year, sem.semester,
         i.status AS intent_status, c.name_th AS intent_company_name_th
    FROM student_memos m
    JOIN students s ON m.student_id = s.student_id
    LEFT JOIN intent_forms i ON m.intent_form_id = i.form_id
    LEFT JOIN companies c ON i.company_id = c.company_id
    JOIN master_major maj ON s.major_id = maj.major_id
    JOIN master_faculty f ON maj.faculty_id = f.faculty_id
    JOIN coop_semesters sem ON m.semester_id = sem.semester_id
`;

export class StudentMemoModel {
  static async create(data: {
    student_id: number;
    semester_id: number;
    memo_type: string;
    intent_form_id: number | null;
    reason: string;
    details: MemoDetails;
  }): Promise<StudentMemoRow> {
    const res = await query(
      `INSERT INTO student_memos (student_id, semester_id, memo_type, intent_form_id, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING memo_id, student_id, semester_id, memo_type, intent_form_id, reason, created_at,
                 status, decided_at, decision_note, details`,
      [data.student_id, data.semester_id, data.memo_type, data.intent_form_id, data.reason, JSON.stringify(data.details)]
    );
    return res.rows[0] as StudentMemoRow;
  }

  /**
   * คณบดีตัดสินบันทึกหนึ่งใบ — ได้เฉพาะแถวที่ยัง pending (ครั้งเดียว · แก้ไม่ได้)
   * คืน null เมื่อไม่มีแถว/ตัดสินไปแล้ว — ผู้เรียกแยกสองกรณีด้วย `findById`
   */
  static async decide(
    memoId: number,
    deanId: number,
    status: 'approved' | 'rejected',
    note: string | null
  ): Promise<boolean> {
    const res = await query(
      `UPDATE student_memos
          SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4
        WHERE memo_id = $1 AND status = 'pending'`,
      [memoId, status, deanId, note]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * บันทึกที่คณบดีอนุมัติแล้ว ของหัวข้อที่เปิดรอบพิเศษได้ — ให้เจ้าหน้าที่เลือกนำเข้า (การ์ดรอบพิเศษ)
   * เรียงใหม่สุดก่อน · ไม่ตัดตามสาขา เพราะผู้เรียกคือเจ้าหน้าที่คณะ (route จำกัด staff)
   */
  static async listApprovedForRounds(
    semesterId: number,
    memoTypes: string[]
  ): Promise<StudentMemoWithContext[]> {
    const res = await query(
      `${SELECT_WITH_CONTEXT}
        WHERE m.semester_id = $1 AND m.status = 'approved' AND m.memo_type = ANY($2::varchar[])
        ORDER BY m.memo_id DESC`,
      [semesterId, memoTypes]
    );
    return res.rows as StudentMemoWithContext[];
  }

  static async findById(memoId: number): Promise<StudentMemoWithContext | null> {
    const res = await query(`${SELECT_WITH_CONTEXT} WHERE m.memo_id = $1`, [memoId]);
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as StudentMemoWithContext;
  }

  static async listByStudent(studentId: number): Promise<StudentMemoWithContext[]> {
    const res = await query(
      `${SELECT_WITH_CONTEXT} WHERE m.student_id = $1 ORDER BY m.memo_id DESC`,
      [studentId]
    );
    return res.rows as StudentMemoWithContext[];
  }

  /**
   * รายการสำหรับบุคลากร · `majorId` มาจาก `resolveMajorScope` ซึ่ง fail closed (SEC-06)
   * ผู้เรียกที่ไม่มีขอบเขตต้องถูกปฏิเสธก่อนถึงตรงนี้ ไม่ใช่ส่ง null มาแล้วได้ทุกสาขา
   */
  static async listForPersonnel(majorId: number | null): Promise<StudentMemoWithContext[]> {
    if (majorId === null) {
      return (await query(`${SELECT_WITH_CONTEXT} ORDER BY m.memo_id DESC`))
        .rows as StudentMemoWithContext[];
    }
    const res = await query(
      `${SELECT_WITH_CONTEXT} WHERE s.major_id = $1 ORDER BY m.memo_id DESC`,
      [majorId]
    );
    return res.rows as StudentMemoWithContext[];
  }
}
