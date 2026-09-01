import { query } from '../config/database';

/**
 * บันทึกข้อความของนักศึกษา — คำร้องกรณียกเว้นที่เสนอถึงคณบดี
 *
 * ตารางนี้เก็บ **สิ่งที่นักศึกษาเขียน** อย่างเดียว ไม่มีสถานะอนุมัติ เพราะการอนุมัติ
 * เกิดบนกระดาษและใน e-Document ของมหาวิทยาลัยซึ่งอยู่นอกระบบนี้ (เจ้าของเลือก
 * ทางเลือก ก. เมื่อ 2026-08-27: ระบบพิมพ์ให้ คนเดินเอกสารเอง)
 *
 * ⛔ **อย่าเติมคอลัมน์สถานะแบบเดา** — ถ้าวันหนึ่งได้สิทธิ์เชื่อม e-Document ค่อยออกแบบ
 * ตามสถานะจริงของระบบนั้น ดีกว่าตั้งชื่อสถานะขึ้นเองแล้วต้องย้ายทีหลัง
 */

export interface StudentMemoRow {
  memo_id: number;
  student_id: number;
  semester_id: number;
  memo_type: string;
  intent_form_id: number | null;
  reason: string;
  created_at: string;
}

/** แถวพร้อมข้อมูลที่ต้องพิมพ์ลงกระดาษ — รวมมาในคำสั่งเดียวเพื่อไม่ต้องยิงซ้ำ */
export interface StudentMemoWithContext extends StudentMemoRow {
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
         m.reason, m.created_at,
         s.student_code, s.first_name, s.last_name, s.phone AS student_phone,
         maj.major_name_th, f.faculty_name_th,
         sem.academic_year, sem.semester
    FROM student_memos m
    JOIN students s ON m.student_id = s.student_id
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
  }): Promise<StudentMemoRow> {
    const res = await query(
      `INSERT INTO student_memos (student_id, semester_id, memo_type, intent_form_id, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING memo_id, student_id, semester_id, memo_type, intent_form_id, reason, created_at`,
      [data.student_id, data.semester_id, data.memo_type, data.intent_form_id, data.reason]
    );
    return res.rows[0] as StudentMemoRow;
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
