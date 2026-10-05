import { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import pool, { query } from '../config/database';
import { CoopSemesterModel } from '../models/semester';
import { AuditAction, writeAudit } from '../utils/audit';
import { COOP_ACTIVITIES } from '../utils/coopCalendar';
import { sendUnexpectedError } from '../utils/httpError';
import { semesterLabel } from '../utils/semesterLabel';

const ALLOWED_SEMESTERS = ['1', '2', '3'];

/** ใบที่จบเส้นทางแล้ว — ชุดเดียวกับ models/semester.ts และตัวกันใบซ้ำใน models/intent.ts */
const TERMINAL = `'rejected', 'company_rejected', 'superseded'`;

/**
 * ตัวเลขต่อภาคที่หน้า "ภาคเรียน" ใช้แสดงในกล่องยืนยันเปิด/ปิดภาค
 *
 * ⛔ ทุกตัวเป็น **คำเตือนให้เจ้าหน้าที่เห็น ไม่ใช่ตัวขวาง** (หลักการวงจรภาค) — ปิดภาคแล้วใบที่ค้างอยู่ตามเดิม
 *    ไม่เปลี่ยนสถานะ ไม่ย้ายภาค · "ยังไม่ครบ" ไม่ได้แปลว่า "ยังไม่ผ่าน" (อาจารย์เป็นผู้ตัดเกรด)
 */
const STATS_SQL = `
  SELECT s.semester_id, s.academic_year, s.semester, s.is_active, s.closed_at,
    (SELECT COUNT(*)::int FROM intent_forms i
      WHERE i.semester_id = s.semester_id AND i.status NOT IN (${TERMINAL}, 'accepted')) AS open_forms,
    (SELECT COUNT(*)::int FROM intent_forms i
      WHERE i.semester_id = s.semester_id AND i.status = 'accepted') AS accepted_forms,
    (SELECT COUNT(*)::int FROM intent_forms i
      WHERE i.semester_id = s.semester_id AND i.status = 'accepted'
        AND (SELECT COUNT(DISTINCT e.form_code) FROM final_evaluations e
              WHERE e.student_id = i.student_id) < 2) AS evaluations_missing,
    (SELECT COUNT(*)::int FROM intent_forms i
      WHERE i.semester_id = s.semester_id AND i.status = 'accepted'
        AND NOT EXISTS (SELECT 1 FROM final_reports r
                         WHERE r.student_id = i.student_id AND r.status = 'approved')) AS reports_pending,
    (SELECT COUNT(*)::int FROM semester_cohort c WHERE c.semester_id = s.semester_id) AS cohort_total
  FROM coop_semesters s`;

interface StatsRow {
  semester_id: number;
  academic_year: number;
  semester: string;
  is_active: boolean;
  closed_at: string | null;
  open_forms: number;
  accepted_forms: number;
  evaluations_missing: number;
  reports_pending: number;
  cohort_total: number;
}

/** กิจกรรมที่ล็อกจริงและเจ้าหน้าที่ต้องกรอกเอง ที่ภาคนี้ยังไม่มีวันปิด — เป็นคำเตือน (ปฏิทิน fail-open) */
async function calendarUnsetByKey(): Promise<Map<number, string[]>> {
  const set = await query(
    `SELECT semester_id, activity_key FROM coop_calendar_events
      WHERE activity_key IS NOT NULL AND end_date IS NOT NULL`
  );
  const configured = new Map<number, Set<string>>();
  for (const r of set.rows as { semester_id: number; activity_key: string }[]) {
    if (!configured.has(r.semester_id)) configured.set(r.semester_id, new Set());
    configured.get(r.semester_id)!.add(r.activity_key);
  }
  const locking = COOP_ACTIVITIES.filter((a) => a.locks && !a.derivedFrom);
  const out = new Map<number, string[]>();
  const all = await query(`SELECT semester_id FROM coop_semesters`);
  for (const r of all.rows as { semester_id: number }[]) {
    const have = configured.get(r.semester_id);
    out.set(
      r.semester_id,
      locking.filter((a) => !have?.has(a.key)).map((a) => a.label)
    );
  }
  return out;
}

function present(row: StatsRow, calendarUnset: string[]) {
  return {
    semester_id: row.semester_id,
    academic_year: row.academic_year,
    semester: row.semester,
    label: semesterLabel(row.semester, row.academic_year),
    is_active: row.is_active,
    closed_at: row.closed_at,
    open_forms: row.open_forms,
    accepted_forms: row.accepted_forms,
    evaluations_missing: row.evaluations_missing,
    reports_pending: row.reports_pending,
    cohort_total: row.cohort_total,
    calendar_unset: calendarUnset,
  };
}

async function loadStats(client: PoolClient | null, semesterId: number): Promise<StatsRow | null> {
  const sql = `${STATS_SQL} WHERE s.semester_id = $1`;
  const res = client ? await client.query(sql, [semesterId]) : await query(sql, [semesterId]);
  return (res.rows[0] as StatsRow | undefined) ?? null;
}

/** รหัสภาคจาก URL — ไม่ใช่จำนวนเต็มบวก = null */
function readId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const isUniqueViolation = (e: unknown) => (e as { code?: string } | undefined)?.code === '23505';

export class CoopSemesterController {
  /**
   * Get the current active cooperative education semester.
   * Route: GET /api/semesters/active
   * Access: Public (or Token authenticated)
   */
  static async getActiveSemester(_req: Request, res: Response): Promise<void> {
    try {
      const activeSemester = await CoopSemesterModel.findActiveSemester();
      if (!activeSemester) {
        res.status(404).json({ message: 'No active cooperative semester found.' });
        return;
      }
      res.status(200).json(activeSemester);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Active Semester Error', 'An internal server error occurred while retrieving active semester.');
    }
  }

  /**
   * Route: GET /api/semesters
   * Access: staff — รายการภาคทั้งหมดพร้อมตัวเลขสำหรับกล่องยืนยันเปิด/ปิดภาค
   */
  static async list(_req: Request, res: Response): Promise<void> {
    try {
      const rows = (await query(`${STATS_SQL} ORDER BY s.academic_year DESC, s.semester DESC`))
        .rows as StatsRow[];
      const unset = await calendarUnsetByKey();
      res.status(200).json({ semesters: rows.map((r) => present(r, unset.get(r.semester_id) ?? [])) });
    } catch (error) {
      sendUnexpectedError(res, error, 'List Semesters Error', 'เกิดข้อผิดพลาดขณะดึงรายการภาคเรียน');
    }
  }

  /**
   * Route: POST /api/semesters
   * Access: staff — สร้างภาค (ยังไม่เปิดใช้งาน) · ปีเป็น พ.ศ.
   *
   * `copy_from` คัดลอกปฏิทินจากภาคก่อน · **วันที่เว้นว่างเป็นค่าเริ่มต้น** เพราะปฏิทินคณะเปลี่ยนทุกปี
   * (กิจกรรมชนิดมีวันจะคัดลอกได้ก็ต่อเมื่อ `shift_year` — ฐานบังคับว่าชนิดช่วง/วันเดียว/ภายในวันที่ต้องมีวัน
   * การเว้นว่างจึงหมายถึง "ไม่คัดลอกแถวนั้น" ซึ่งปฏิทินอ่านเป็น "ยังไม่ตั้ง" = fail-open ตามเดิม)
   * แถวที่เป็นข้อความล้วน (ไม่มีวัน) คัดลอกให้เสมอ
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const year = Number(body.academic_year);
      const term = typeof body.semester === 'string' ? body.semester : String(body.semester ?? '');
      if (!Number.isInteger(year) || year < 2500 || year > 2700) {
        res.status(400).json({ message: 'ปีการศึกษาต้องเป็น พ.ศ. (เช่น 2570)' });
        return;
      }
      if (!ALLOWED_SEMESTERS.includes(term)) {
        res.status(400).json({ message: 'เลือกภาคเรียนเป็น 1 · 2 · ฤดูร้อน (3)' });
        return;
      }
      const copyFrom = body.copy_from === undefined || body.copy_from === null || body.copy_from === ''
        ? null
        : Number(body.copy_from);
      if (copyFrom !== null && (!Number.isInteger(copyFrom) || copyFrom <= 0)) {
        res.status(400).json({ message: 'ภาคที่จะคัดลอกปฏิทินไม่ถูกต้อง' });
        return;
      }
      const shiftYear = body.shift_year === true;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (copyFrom !== null) {
          const src = await client.query(`SELECT 1 FROM coop_semesters WHERE semester_id = $1`, [copyFrom]);
          if ((src.rowCount ?? 0) === 0) {
            await client.query('ROLLBACK');
            res.status(404).json({ message: 'ไม่พบภาคที่จะคัดลอกปฏิทิน' });
            return;
          }
        }
        const dup = await client.query(
          `SELECT 1 FROM coop_semesters WHERE academic_year = $1 AND semester = $2`,
          [year, term]
        );
        if ((dup.rowCount ?? 0) > 0) {
          await client.query('ROLLBACK');
          res.status(409).json({ message: `มี${semesterLabel(term, year)}อยู่แล้ว` });
          return;
        }

        const created = await client.query(
          `INSERT INTO coop_semesters (academic_year, semester, is_active)
           VALUES ($1, $2, FALSE) RETURNING semester_id`,
          [year, term]
        );
        const semesterId = created.rows[0].semester_id as number;

        let copied = 0;
        if (copyFrom !== null) {
          const ins = await client.query(
            `INSERT INTO coop_calendar_events
               (semester_id, activity_key, title, date_kind, start_date, end_date,
                late_end_date, detail_text, sort_order, note, created_by)
             SELECT $1, activity_key, title, date_kind,
                    start_date + CASE WHEN $3 THEN INTERVAL '1 year' ELSE INTERVAL '0' END,
                    end_date + CASE WHEN $3 THEN INTERVAL '1 year' ELSE INTERVAL '0' END,
                    late_end_date + CASE WHEN $3 THEN INTERVAL '1 year' ELSE INTERVAL '0' END,
                    detail_text, sort_order, note, $4
               FROM coop_calendar_events
              WHERE semester_id = $2
                AND ($3 OR date_kind IN ('relative', 'external'))`,
            [semesterId, copyFrom, shiftYear, req.user?.userId ?? null]
          );
          copied = ins.rowCount ?? 0;
        }

        await writeAudit(
          {
            action: AuditAction.SEMESTER_CREATED,
            entityType: 'coop_semesters',
            entityId: semesterId,
            detail: { academic_year: year, semester: term, copy_from: copyFrom, shift_year: shiftYear, copied_events: copied },
          },
          req,
          client
        );
        await client.query('COMMIT');

        const stats = await loadStats(null, semesterId);
        res.status(201).json({ semester: stats ? present(stats, []) : null, copied_events: copied });
      } catch (error) {
        await client.query('ROLLBACK');
        if (isUniqueViolation(error)) {
          res.status(409).json({ message: `มี${semesterLabel(term, year)}อยู่แล้ว` });
          return;
        }
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'Create Semester Error', 'เกิดข้อผิดพลาดขณะสร้างภาคเรียน');
    }
  }

  /**
   * Route: POST /api/semesters/:id/activate
   * Access: staff — เปิดภาคนี้ (ภาคที่เปิดอยู่เดิมหยุดรับ) ในทรานแซกชันเดียว
   *
   * ภาคเดิมแค่ `is_active = FALSE` — ใบที่ค้างอยู่ตามเดิม ไม่เปลี่ยนสถานะ ไม่ย้ายภาค
   * เปิดภาคที่เคยปิดไปแล้ว = ล้าง `closed_at` (เจ้าหน้าที่กดปิดผิด แก้ได้โดยไม่ต้องเขียน SQL)
   */
  static async activate(req: Request, res: Response): Promise<void> {
    try {
      const semesterId = readId(req.params.id);
      if (semesterId === null) {
        res.status(400).json({ message: 'รหัสภาคเรียนไม่ถูกต้อง' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const target = await client.query(
          `SELECT semester_id, is_active FROM coop_semesters WHERE semester_id = $1 FOR UPDATE`,
          [semesterId]
        );
        if ((target.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          res.status(404).json({ message: 'ไม่พบภาคเรียนที่ระบุ' });
          return;
        }
        if (target.rows[0].is_active) {
          await client.query('ROLLBACK');
          res.status(409).json({ message: 'ภาคเรียนนี้เปิดใช้งานอยู่แล้ว' });
          return;
        }

        // ลำดับสำคัญ: ปิดตัวเดิมก่อนเปิดตัวใหม่ ไม่งั้นชน partial unique ของฐาน
        const prev = await client.query(
          `UPDATE coop_semesters SET is_active = FALSE WHERE is_active RETURNING semester_id`
        );
        const previousId = (prev.rows[0]?.semester_id as number | undefined) ?? null;
        const previous = previousId ? await loadStats(client, previousId) : null;

        await client.query(
          `UPDATE coop_semesters SET is_active = TRUE, closed_at = NULL WHERE semester_id = $1`,
          [semesterId]
        );
        await writeAudit(
          {
            action: AuditAction.SEMESTER_ACTIVATED,
            entityType: 'coop_semesters',
            entityId: semesterId,
            detail: { previous_semester_id: previousId, open_forms_in_previous: previous?.open_forms ?? 0 },
          },
          req,
          client
        );
        await client.query('COMMIT');
        res.status(200).json({ message: 'เปิดภาคเรียนแล้ว', semester_id: semesterId });
      } catch (error) {
        await client.query('ROLLBACK');
        if (isUniqueViolation(error)) {
          res.status(409).json({ message: 'มีการเปลี่ยนภาคเรียนพร้อมกัน กรุณารีเฟรชแล้วลองใหม่' });
          return;
        }
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'Activate Semester Error', 'เกิดข้อผิดพลาดขณะเปิดภาคเรียน');
    }
  }

  /**
   * Route: POST /api/semesters/:id/close
   * Access: staff — ปิดภาค: ตั้ง `closed_at` และหยุดรับ (ถ้าเป็นภาคที่เปิดอยู่)
   *
   * ⛔ ไม่แตะใบ ไม่ย้ายภาค ไม่เปลี่ยนสถานะอัตโนมัติ — ใบที่ค้างอยู่ตามเดิมและยังขึ้นในคิวเจ้าหน้าที่
   *    การปิดภาคที่เปิดอยู่ทำให้ไม่มีภาค active จนกว่าจะเปิดภาคใหม่ (ด่านปฏิทินปล่อยผ่านตามหลัก fail-open)
   */
  static async close(req: Request, res: Response): Promise<void> {
    try {
      const semesterId = readId(req.params.id);
      if (semesterId === null) {
        res.status(400).json({ message: 'รหัสภาคเรียนไม่ถูกต้อง' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const target = await client.query(
          `SELECT closed_at FROM coop_semesters WHERE semester_id = $1 FOR UPDATE`,
          [semesterId]
        );
        if ((target.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          res.status(404).json({ message: 'ไม่พบภาคเรียนที่ระบุ' });
          return;
        }
        if (target.rows[0].closed_at) {
          await client.query('ROLLBACK');
          res.status(409).json({ message: 'ภาคเรียนนี้ปิดไปแล้ว' });
          return;
        }

        const before = await loadStats(client, semesterId);
        await client.query(
          `UPDATE coop_semesters SET is_active = FALSE, closed_at = NOW() WHERE semester_id = $1`,
          [semesterId]
        );
        await writeAudit(
          {
            action: AuditAction.SEMESTER_CLOSED,
            entityType: 'coop_semesters',
            entityId: semesterId,
            detail: {
              was_active: before?.is_active ?? false,
              open_forms: before?.open_forms ?? 0,
              evaluations_missing: before?.evaluations_missing ?? 0,
              reports_pending: before?.reports_pending ?? 0,
            },
          },
          req,
          client
        );
        await client.query('COMMIT');
        res.status(200).json({ message: 'ปิดภาคเรียนแล้ว', semester_id: semesterId });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'Close Semester Error', 'เกิดข้อผิดพลาดขณะปิดภาคเรียน');
    }
  }
}
