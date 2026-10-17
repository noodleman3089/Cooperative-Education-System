import pool, { query } from '../config/database';

/** "วันนี้" ตามเวลาไทยที่ฐานข้อมูล — กติกาเดียวกับ `models/coopCalendar.ts` */
const TODAY_SQL = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`;

export interface SpecialRoundRow {
  round_id: number;
  semester_id: number;
  title: string;
  /** `pg` คืน DATE เป็นสตริง YYYY-MM-DD ดิบ */
  start_date: string;
  end_date: string;
  note: string | null;
  activity_keys: string[];
}

export interface SpecialRoundStudent {
  student_id: number;
  student_code: string;
  first_name: string;
  last_name: string;
}

export interface SpecialRoundInput {
  title: string;
  start_date: string;
  end_date: string;
  note: string | null;
  activity_keys: string[];
  student_ids: number[];
}

const ROUND_SELECT = `
  SELECT r.round_id, r.semester_id, r.title, r.start_date, r.end_date, r.note,
         COALESCE((SELECT array_agg(a.activity_key ORDER BY a.activity_key)
                     FROM coop_special_round_activities a WHERE a.round_id = r.round_id),
                  ARRAY[]::varchar[]) AS activity_keys
    FROM coop_special_rounds r`;

export class CoopSpecialRoundModel {
  /**
   * นักศึกษาคนนี้ใช้รอบพิเศษของกิจกรรมนี้ได้ ณ วันนี้หรือไม่ — **นิยามเดียวของสิทธิ์นี้**
   * (ด่านปฏิทิน · งานปิดใบอัตโนมัติ · ด่านลิงก์บริษัทอ่านจากที่นี่ที่เดียว)
   *
   * `semesterId` ว่าง = ภาค active (กติกาเดียวกับ `CoopCalendarModel.findWindow`)
   * ⛔ ไม่ใช่ fail-open — ค้นพัง = โยน error ให้ผู้เรียกตอบ 500 · ไม่เคยตีความว่า "มีสิทธิ์"
   */
  static async isOpenForStudent(
    activityKey: string,
    semesterId: number | null,
    studentId: number
  ): Promise<boolean> {
    const res = await query(
      `SELECT 1
         FROM coop_special_rounds r
         JOIN coop_semesters s ON s.semester_id = r.semester_id
         JOIN coop_special_round_activities a ON a.round_id = r.round_id AND a.activity_key = $1
         JOIN coop_special_round_students st ON st.round_id = r.round_id AND st.student_id = $3
        WHERE CASE WHEN $2::int IS NULL THEN s.is_active ELSE s.semester_id = $2 END
          AND ${TODAY_SQL} BETWEEN r.start_date AND r.end_date
        LIMIT 1`,
      [activityKey, semesterId, studentId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** รอบทั้งหมดของภาค (มุมมองเจ้าหน้าที่) */
  static async listBySemester(semesterId: number): Promise<SpecialRoundRow[]> {
    const res = await query(`${ROUND_SELECT} WHERE r.semester_id = $1 ORDER BY r.start_date, r.round_id`, [
      semesterId,
    ]);
    return res.rows as SpecialRoundRow[];
  }

  /** เฉพาะรอบที่นักศึกษาคนนี้อยู่ในรายชื่อ (มุมมองนักศึกษา — ไม่คืนรายชื่อคนอื่น) */
  static async listForStudent(semesterId: number, studentId: number): Promise<SpecialRoundRow[]> {
    const res = await query(
      `${ROUND_SELECT}
        WHERE r.semester_id = $1
          AND EXISTS (SELECT 1 FROM coop_special_round_students st
                       WHERE st.round_id = r.round_id AND st.student_id = $2)
        ORDER BY r.start_date, r.round_id`,
      [semesterId, studentId]
    );
    return res.rows as SpecialRoundRow[];
  }

  static async findById(roundId: number): Promise<SpecialRoundRow | null> {
    const res = await query(`${ROUND_SELECT} WHERE r.round_id = $1`, [roundId]);
    return (res.rowCount ?? 0) > 0 ? (res.rows[0] as SpecialRoundRow) : null;
  }

  /** รายชื่อนักศึกษาของรอบหนึ่ง — มุมมองเจ้าหน้าที่เท่านั้น */
  static async listStudents(roundId: number): Promise<SpecialRoundStudent[]> {
    const res = await query(
      `SELECT s.student_id, s.student_code, s.first_name, s.last_name
         FROM coop_special_round_students st
         JOIN students s ON s.student_id = st.student_id
        WHERE st.round_id = $1
        ORDER BY s.student_code`,
      [roundId]
    );
    return res.rows as SpecialRoundStudent[];
  }

  /** นักศึกษาที่มีอยู่จริงในจำนวนที่ส่งมา — ผู้เรียกเทียบจำนวนเพื่อจับรหัสที่ไม่มี */
  static async countExistingStudents(studentIds: number[]): Promise<number> {
    const res = await query(`SELECT COUNT(*)::int AS n FROM students WHERE student_id = ANY($1::int[])`, [
      studentIds,
    ]);
    return res.rows[0].n as number;
  }

  /** ค้นนักศึกษาให้เจ้าหน้าที่เลือกใส่รอบ — รหัสหรือชื่อ · จำกัด 20 แถว · ไม่คืนข้อมูลอื่นนอกจากตัวระบุ */
  static async searchStudents(term: string): Promise<SpecialRoundStudent[]> {
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const res = await query(
      `SELECT student_id, student_code, first_name, last_name
         FROM students
        WHERE student_code ILIKE $1
           OR (first_name || ' ' || last_name) ILIKE $1
        ORDER BY student_code
        LIMIT 20`,
      [like]
    );
    return res.rows as SpecialRoundStudent[];
  }

  /** สร้าง/แก้ทั้งรอบ + กิจกรรม + รายชื่อใน transaction เดียว — ไม่ให้ค้างครึ่งรอบ */
  static async save(
    roundId: number | null,
    semesterId: number,
    input: SpecialRoundInput,
    createdBy: number
  ): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let id = roundId;
      if (id === null) {
        const ins = await client.query(
          `INSERT INTO coop_special_rounds (semester_id, title, start_date, end_date, note, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING round_id`,
          [semesterId, input.title, input.start_date, input.end_date, input.note, createdBy]
        );
        id = ins.rows[0].round_id as number;
      } else {
        await client.query(
          `UPDATE coop_special_rounds SET title = $2, start_date = $3, end_date = $4, note = $5
            WHERE round_id = $1`,
          [id, input.title, input.start_date, input.end_date, input.note]
        );
        await client.query(`DELETE FROM coop_special_round_activities WHERE round_id = $1`, [id]);
        await client.query(`DELETE FROM coop_special_round_students WHERE round_id = $1`, [id]);
      }
      await client.query(
        `INSERT INTO coop_special_round_activities (round_id, activity_key)
         SELECT $1::int, UNNEST($2::varchar[])`,
        [id, input.activity_keys]
      );
      await client.query(
        `INSERT INTO coop_special_round_students (round_id, student_id)
         SELECT $1::int, UNNEST($2::int[])`,
        [id, input.student_ids]
      );
      await client.query('COMMIT');
      return id;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async delete(roundId: number): Promise<boolean> {
    const res = await query(`DELETE FROM coop_special_rounds WHERE round_id = $1`, [roundId]);
    return (res.rowCount ?? 0) > 0;
  }
}
