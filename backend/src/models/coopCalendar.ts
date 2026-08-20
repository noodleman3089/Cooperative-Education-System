import { query } from '../config/database';
import { CoopSemester } from '../types';

/**
 * "วันนี้" ตามเวลาไทย คิดที่ฐานข้อมูลเสมอ
 *
 * ห้ามใช้ CURRENT_DATE เฉยๆ — ถ้า Postgres ตั้ง TZ เป็น UTC (ค่าเริ่มต้นของ
 * หลาย container) ช่วง 00:00-07:00 ตามเวลาไทยระบบจะคิดว่ายังเป็น "เมื่อวาน"
 * ทำให้ช่วงที่ปิดไปแล้วยังเปิดอยู่อีก 7 ชั่วโมง
 */
const TODAY_SQL = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`;

export interface CoopCalendarEventRow {
  event_id: number;
  semester_id: number;
  activity_key: string | null;
  title: string | null;
  /** `pg` ถูกตั้งให้คืน DATE (OID 1082) เป็นสตริง YYYY-MM-DD ดิบ ไม่ใช่ Date */
  start_date: string;
  end_date: string;
  note: string | null;
}

export interface CalendarWindowLookup {
  today: string;
  start_date: string | null;
  end_date: string | null;
}

export class CoopCalendarModel {
  /** วันนี้ตามเวลาไทย — ใช้ตอนที่ยังไม่มี query อื่นที่ดึงมาให้แล้ว */
  static async today(): Promise<string> {
    const res = await query(`SELECT ${TODAY_SQL} AS today`);
    return res.rows[0].today as string;
  }

  /**
   * ช่วงเวลาของกิจกรรมหนึ่ง ในภาคการศึกษาที่เปิดใช้งานอยู่ พร้อมวันนี้ในคำขอเดียว
   *
   * คืน null เมื่อไม่มีภาคการศึกษาที่ active เลย — ผู้เรียกต้องตีความว่า
   * "ยังไม่มีกฎ" (fail-open) ไม่ใช่ "ปฏิเสธ"
   *
   * `LIMIT 1` ไม่มี `ORDER BY` โดยตั้งใจให้เหมือน CoopSemesterModel.findActiveSemester()
   * เป๊ะ — schema ไม่มีอะไรห้ามให้มีภาค active สองแถว ถ้าเกิดขึ้นจริงทั้งระบบ
   * ต้องหยิบแถวเดียวกัน ผิดพร้อมกันดีกว่าแบนเนอร์อ่านภาคหนึ่งแต่ตัวล็อกอ่านอีกภาค
   */
  static async findActiveWindow(activityKey: string): Promise<CalendarWindowLookup | null> {
    const res = await query(
      `SELECT e.start_date, e.end_date, ${TODAY_SQL} AS today
         FROM coop_semesters s
         LEFT JOIN coop_calendar_events e
           ON e.semester_id = s.semester_id AND e.activity_key = $1
        WHERE s.is_active = TRUE
        LIMIT 1`,
      [activityKey]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CalendarWindowLookup;
  }

  /** ภาคการศึกษาที่จะใช้เป็นบริบทของหน้าปฏิทิน */
  static async resolveSemester(semesterId?: number): Promise<CoopSemester | null> {
    const res = semesterId
      ? await query(
          `SELECT semester_id, academic_year, semester, is_active
             FROM coop_semesters WHERE semester_id = $1`,
          [semesterId]
        )
      : await query(
          `SELECT semester_id, academic_year, semester, is_active
             FROM coop_semesters WHERE is_active = TRUE LIMIT 1`
        );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopSemester;
  }

  static async listBySemester(semesterId: number): Promise<CoopCalendarEventRow[]> {
    const res = await query(
      `SELECT event_id, semester_id, activity_key, title, start_date, end_date, note
         FROM coop_calendar_events
        WHERE semester_id = $1
        ORDER BY start_date, event_id`,
      [semesterId]
    );
    return res.rows as CoopCalendarEventRow[];
  }

  static async findById(eventId: number): Promise<CoopCalendarEventRow | null> {
    const res = await query(
      `SELECT event_id, semester_id, activity_key, title, start_date, end_date, note
         FROM coop_calendar_events WHERE event_id = $1`,
      [eventId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopCalendarEventRow;
  }

  static async create(data: {
    semester_id: number;
    activity_key: string | null;
    title: string | null;
    start_date: string;
    end_date: string;
    note: string | null;
    created_by: number;
  }): Promise<CoopCalendarEventRow> {
    const res = await query(
      `INSERT INTO coop_calendar_events
         (semester_id, activity_key, title, start_date, end_date, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING event_id, semester_id, activity_key, title, start_date, end_date, note`,
      [
        data.semester_id,
        data.activity_key,
        data.title,
        data.start_date,
        data.end_date,
        data.note,
        data.created_by,
      ]
    );
    return res.rows[0] as CoopCalendarEventRow;
  }

  /** แก้ได้เฉพาะวัน ชื่อ และหมายเหตุ — `semester_id`/`activity_key` ย้ายไม่ได้ */
  static async update(
    eventId: number,
    data: { title: string | null; start_date: string; end_date: string; note: string | null }
  ): Promise<CoopCalendarEventRow | null> {
    const res = await query(
      `UPDATE coop_calendar_events
          SET title = $2, start_date = $3, end_date = $4, note = $5
        WHERE event_id = $1
       RETURNING event_id, semester_id, activity_key, title, start_date, end_date, note`,
      [eventId, data.title, data.start_date, data.end_date, data.note]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopCalendarEventRow;
  }

  static async delete(eventId: number): Promise<boolean> {
    const res = await query(`DELETE FROM coop_calendar_events WHERE event_id = $1`, [eventId]);
    return (res.rowCount ?? 0) > 0;
  }
}
