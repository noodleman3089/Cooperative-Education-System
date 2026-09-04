import { query } from '../config/database';
import { CoopSemester } from '../types';
import { CalendarDateKind, DERIVED_WINDOWS } from '../utils/coopCalendar';

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
  date_kind: CalendarDateKind;
  /**
   * `pg` ถูกตั้งให้คืน DATE (OID 1082) เป็นสตริง YYYY-MM-DD ดิบ ไม่ใช่ Date
   * · null ได้ตั้งแต่ 2026-09-04 — deadline ไม่มีวันเริ่ม · relative/external ไม่มีวันเลย
   */
  start_date: string | null;
  end_date: string | null;
  /** วันสุดท้ายที่ยังรับแบบส่งช้า · null = ไม่เปิดผ่อนผัน */
  late_end_date: string | null;
  /** ข้อความแทนวันที่ สำหรับชนิด relative/external */
  detail_text: string | null;
  sort_order: number;
  note: string | null;
}

/** คอลัมน์ที่ทุก query ในไฟล์นี้คืน — เขียนที่เดียวกันลืมไม่ตรงกัน */
const EVENT_COLUMNS = `event_id, semester_id, activity_key, title, date_kind,
         start_date, end_date, late_end_date, detail_text, sort_order, note`;

export interface CalendarWindowLookup {
  today: string;
  start_date: string | null;
  end_date: string | null;
  late_end_date: string | null;
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
    const derived = DERIVED_WINDOWS[activityKey as keyof typeof DERIVED_WINDOWS];
    if (derived) return this.findDerivedWindow(derived.start, derived.end);

    const res = await query(
      `SELECT e.start_date, e.end_date, e.late_end_date, ${TODAY_SQL} AS today
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

  /**
   * ช่วงที่ประกอบจากกิจกรรมสองอัน — วันเริ่มจากอันหนึ่ง วันปิดจากอีกอัน
   *
   * ใช้กับ `weekly_log` ซึ่งไม่มีแถวของตัวเองบนปฏิทินคณะ เพราะมันคือช่วงระหว่าง
   * "วันเริ่มปฏิบัติงาน" ถึง "วันสิ้นสุดการปฏิบัติงาน" พอดี
   *
   * ⛔ **วันผ่อนผันต้องมาจากฝั่งวันปิดเท่านั้น** — ผ่อนผันคือการยืดวันปิดออกไป
   *   การไปหยิบของฝั่งวันเริ่มมาจะได้ตัวเลขที่ไม่มีความหมายอะไรเลย
   * ตั้งไม่ครบทั้งสองอัน → คืน null ในช่องที่ขาด → `calendarStatus` ตอบ
   * `not_configured` → fail-open ตามเดิม (ตรงกับ middlewares/calendarGate.ts)
   */
  private static async findDerivedWindow(
    startKey: string,
    endKey: string
  ): Promise<CalendarWindowLookup | null> {
    const res = await query(
      `SELECT
         (SELECT a.start_date FROM coop_calendar_events a
           WHERE a.semester_id = s.semester_id AND a.activity_key = $1) AS start_date,
         (SELECT b.end_date FROM coop_calendar_events b
           WHERE b.semester_id = s.semester_id AND b.activity_key = $2) AS end_date,
         (SELECT b.late_end_date FROM coop_calendar_events b
           WHERE b.semester_id = s.semester_id AND b.activity_key = $2) AS late_end_date,
         ${TODAY_SQL} AS today
         FROM coop_semesters s
        WHERE s.is_active = TRUE
        LIMIT 1`,
      [startKey, endKey]
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
      // เรียงตามลำดับบนกระดาษ ไม่ใช่ตามวัน — เกินครึ่งของแถวบนปฏิทินจริงไม่มีวันเลย
      `SELECT ${EVENT_COLUMNS}
         FROM coop_calendar_events
        WHERE semester_id = $1
        ORDER BY sort_order, start_date NULLS LAST, event_id`,
      [semesterId]
    );
    return res.rows as CoopCalendarEventRow[];
  }

  static async findById(eventId: number): Promise<CoopCalendarEventRow | null> {
    const res = await query(
      `SELECT ${EVENT_COLUMNS} FROM coop_calendar_events WHERE event_id = $1`,
      [eventId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopCalendarEventRow;
  }

  static async create(data: {
    semester_id: number;
    activity_key: string | null;
    title: string | null;
    date_kind: CalendarDateKind;
    start_date: string | null;
    end_date: string | null;
    late_end_date: string | null;
    detail_text: string | null;
    sort_order: number;
    note: string | null;
    created_by: number;
  }): Promise<CoopCalendarEventRow> {
    const res = await query(
      `INSERT INTO coop_calendar_events
         (semester_id, activity_key, title, date_kind, start_date, end_date,
          late_end_date, detail_text, sort_order, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${EVENT_COLUMNS}`,
      [
        data.semester_id,
        data.activity_key,
        data.title,
        data.date_kind,
        data.start_date,
        data.end_date,
        data.late_end_date,
        data.detail_text,
        data.sort_order,
        data.note,
        data.created_by,
      ]
    );
    return res.rows[0] as CoopCalendarEventRow;
  }

  /** แก้ได้เฉพาะวัน ชื่อ และหมายเหตุ — `semester_id`/`activity_key` ย้ายไม่ได้ */
  static async update(
    eventId: number,
    data: {
      title: string | null;
      date_kind: CalendarDateKind;
      start_date: string | null;
      end_date: string | null;
      late_end_date: string | null;
      detail_text: string | null;
      sort_order: number;
      note: string | null;
    }
  ): Promise<CoopCalendarEventRow | null> {
    const res = await query(
      `UPDATE coop_calendar_events
          SET title = $2, date_kind = $3, start_date = $4, end_date = $5,
              late_end_date = $6, detail_text = $7, sort_order = $8, note = $9
        WHERE event_id = $1
       RETURNING ${EVENT_COLUMNS}`,
      [
        eventId,
        data.title,
        data.date_kind,
        data.start_date,
        data.end_date,
        data.late_end_date,
        data.detail_text,
        data.sort_order,
        data.note,
      ]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopCalendarEventRow;
  }

  static async delete(eventId: number): Promise<boolean> {
    const res = await query(`DELETE FROM coop_calendar_events WHERE event_id = $1`, [eventId]);
    return (res.rowCount ?? 0) > 0;
  }
}
