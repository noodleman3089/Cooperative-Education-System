import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { assertCanReviewStudentWork, assertMentorOwnsStudent, sendAccessError } from '../utils/access';
import { writeAudit } from '../utils/audit';
import { getErrorMessage, sendUnexpectedError } from '../utils/httpError';

/**
 * แบบรายงานการปฏิบัติงานประจำวัน (สหกิจ 08)
 *
 * ⛔ **ส่งและรับรองเป็นชุดทั้งสัปดาห์ ไม่ใช่ทีละวัน** — ถ้ารับรองรายวัน พี่เลี้ยงต้องกด
 *    ~90 ครั้งต่อนักศึกษาหนึ่งคน ซึ่งจะไม่มีใครทำ แล้วสถานะ "รับรองแล้ว" จะกลายเป็น
 *    ป้ายที่ไม่มีความหมาย
 *
 * ⛔ **คู่มือไม่ได้บังคับให้ทุกคนทำ** — เปิดใช้เมื่อพี่เลี้ยงกดสวิตช์
 *    `intent_forms.daily_log_required` เท่านั้น · ปิดอยู่แล้วนักศึกษายิงเข้ามา = 403
 *    (หน้าจอยังต้องแสดงแท็บไว้พร้อมบอกว่าใครเป็นคนเปิด ⛔ ห้ามซ่อนเงียบ ๆ)
 */
export class DailyLogController {
  /**
   * Route: GET /api/daily-logs/me
   * Access: student
   */
  static async getMyLogs(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = req.user.userId;
      const intent = await fetchIntent(studentId);
      res.status(200).json({
        intent,
        weeks: intent ? await fetchWeeks(studentId) : [],
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get my daily logs error', 'ไม่สามารถโหลดบันทึกรายวันได้');
    }
  }

  /**
   * บันทึกทั้งสัปดาห์ในครั้งเดียว
   * Route: POST /api/daily-logs
   * Access: student
   *
   * body: `{ week_number, status: 'draft'|'submitted', days: [{ log_date, work_detail, remark }] }`
   */
  static async submitWeek(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = req.user.userId;

      const weekNumber = parseInt(String(req.body?.week_number), 10);
      if (!Number.isInteger(weekNumber) || weekNumber < 1) {
        res.status(400).json({ message: 'กรุณาระบุสัปดาห์ที่ต้องการบันทึก' });
        return;
      }
      const status = req.body?.status === 'submitted' ? 'submitted' : 'draft';
      const days = Array.isArray(req.body?.days) ? req.body.days : [];

      const intent = await fetchIntent(studentId);
      if (!intent) {
        res.status(400).json({ message: 'ยังไม่มีคำร้องที่ได้รับการตอบรับ จึงยังบันทึกการปฏิบัติงานไม่ได้' });
        return;
      }
      // ⛔ สวิตช์ของพี่เลี้ยง — ปิดอยู่ต้อง 403 ไม่ใช่รับไว้เงียบ ๆ
      if (!intent.daily_log_required) {
        res.status(403).json({
          message: 'พนักงานที่ปรึกษายังไม่ได้เปิดให้บันทึกรายวันสำหรับการปฏิบัติงานครั้งนี้',
        });
        return;
      }

      const range = weekRange(intent.start_date, weekNumber);
      if (!range) {
        res.status(400).json({ message: 'ยังไม่ทราบวันเริ่มปฏิบัติงาน จึงคำนวณสัปดาห์ไม่ได้' });
        return;
      }

      const rows: { logDate: string; detail: string | null; remark: string | null }[] = [];
      for (const raw of days) {
        const logDate = String((raw as { log_date?: unknown }).log_date ?? '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) continue;
        // ⛔ วันที่ต้องอยู่ในสัปดาห์ที่อ้างจริง ไม่งั้นบันทึกจะไปโผล่ผิดสัปดาห์
        //    แล้วการรับรองทั้งสัปดาห์จะกวาดของสัปดาห์อื่นติดไปด้วย
        if (logDate < range.start || logDate > range.end) {
          res.status(400).json({
            message: `วันที่ ${logDate} ไม่ได้อยู่ในสัปดาห์ที่ ${weekNumber} (${range.start} ถึง ${range.end})`,
          });
          return;
        }
        rows.push({
          logDate,
          detail: emptyToNull((raw as { work_detail?: unknown }).work_detail),
          remark: emptyToNull((raw as { remark?: unknown }).remark),
        });
      }

      if (status === 'submitted' && rows.every((r) => !r.detail)) {
        res.status(400).json({ message: 'กรุณากรอกบันทึกอย่างน้อยหนึ่งวันก่อนส่งให้พนักงานที่ปรึกษารับรอง' });
        return;
      }

      await client.query('BEGIN');

      // แก้บันทึกที่รับรองไปแล้ว = ล้างการรับรองทิ้ง แล้วกลับไปรอรับรองใหม่
      // ⛔ ห้ามปล่อยให้แก้โดยที่สถานะรับรองยังค้าง เท่ากับพี่เลี้ยงรับรองข้อความที่ไม่เคยเห็น
      // ⛔ และห้ามล็อกไม่ให้แก้ — พี่เลี้ยงเผลอกดเร็วไปแล้วนักศึกษาแก้ไม่ได้เลยคือทางตัน
      const wasCertified = await client.query(
        `SELECT 1 FROM daily_logs
          WHERE student_id = $1 AND week_number = $2 AND mentor_certified_at IS NOT NULL LIMIT 1`,
        [studentId, weekNumber]
      );

      for (const row of rows) {
        await client.query(
          `INSERT INTO daily_logs (student_id, week_number, log_date, work_detail, remark, status, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6::varchar,
                   CASE WHEN $6::varchar = 'submitted' THEN NOW() ELSE NULL END)
           ON CONFLICT (student_id, log_date) DO UPDATE SET
             week_number = EXCLUDED.week_number,
             work_detail = EXCLUDED.work_detail,
             remark = EXCLUDED.remark,
             status = EXCLUDED.status,
             submitted_at = EXCLUDED.submitted_at,
             returned_comment = NULL,
             mentor_certified_by = NULL,
             mentor_certified_at = NULL,
             updated_at = NOW()`,
          [studentId, weekNumber, row.logDate, row.detail, row.remark, status]
        );
      }

      /**
       * ⛔ ล้างการรับรองของ **ทั้งสัปดาห์** ไม่ใช่เฉพาะวันที่เพิ่งแก้
       *
       * พี่เลี้ยงรับรอง "สัปดาห์" เป็นหน่วยเดียว การแก้วันพุธวันเดียวแล้วปล่อยให้อีก
       * สี่วันยังมีตรารับรองค้างอยู่ แปลว่าลายเซ็นบนสัปดาห์นั้นครอบข้อความที่เขาไม่เคยเห็น
       * (เจอตอนทดสอบ: แก้วันเดียวแล้วหน้าจอยังขึ้นว่ารับรองแล้วทั้งสัปดาห์)
       */
      if ((wasCertified.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE daily_logs
              SET mentor_certified_by = NULL, mentor_certified_at = NULL, updated_at = NOW()
            WHERE student_id = $1 AND week_number = $2`,
          [studentId, weekNumber]
        );
      }

      await client.query('COMMIT');

      if ((wasCertified.rowCount ?? 0) > 0) {
        writeAudit(
          {
            action: 'work_log.mentor_certification_cleared',
            entityType: 'daily_log',
            subjectId: studentId,
            detail: { week_number: weekNumber, reason: 'Student updated certified daily logs' },
          },
          req
        ).catch(() => undefined);
      }

      res.status(200).json({
        message: status === 'submitted'
          ? `ส่งบันทึกรายวันสัปดาห์ที่ ${weekNumber} ให้พนักงานที่ปรึกษารับรองแล้ว`
          : `บันทึกร่างของสัปดาห์ที่ ${weekNumber} เรียบร้อยแล้ว`,
        week_number: weekNumber,
        saved: rows.length,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      sendUnexpectedError(res, error, 'Submit daily logs error', 'ไม่สามารถบันทึกรายวันได้');
    } finally {
      client.release();
    }
  }

  /**
   * Route: GET /api/daily-logs/student/:id
   * Access: student (ของตัวเอง) · mentor (ของนักศึกษาตัวเอง) · advisor/dept_head
   */
  static async getStudentLogs(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = parseInt(req.params.id, 10);
      if (!Number.isInteger(studentId)) {
        res.status(400).json({ message: 'รหัสนักศึกษาไม่ถูกต้อง' });
        return;
      }
      await assertMayRead(req, studentId);

      res.status(200).json({
        intent: await fetchIntent(studentId),
        weeks: await fetchWeeks(studentId),
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      if (getErrorMessage(error, '') === 'FORBIDDEN') {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }
      sendUnexpectedError(res, error, 'Get student daily logs error', 'ไม่สามารถโหลดบันทึกรายวันได้');
    }
  }

  /**
   * รับรองบันทึกรายวัน **ทั้งสัปดาห์**
   * Route: PATCH /api/daily-logs/week/:weekNumber/certify?student=<id>
   * Access: mentor
   */
  static async certifyWeek(req: Request, res: Response): Promise<void> {
    await decideWeek(req, res, 'certify');
  }

  /**
   * ส่งกลับให้แก้ทั้งสัปดาห์ — **บังคับเหตุผล**
   * Route: PATCH /api/daily-logs/week/:weekNumber/return?student=<id>
   */
  static async returnWeek(req: Request, res: Response): Promise<void> {
    await decideWeek(req, res, 'return');
  }
}

/* ── ตัวช่วย ──────────────────────────────────────────────────────── */

async function decideWeek(req: Request, res: Response, action: 'certify' | 'return'): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized.' });
      return;
    }
    const weekNumber = parseInt(req.params.weekNumber, 10);
    const studentId = parseInt(String(req.query.student ?? ''), 10);
    if (!Number.isInteger(weekNumber) || !Number.isInteger(studentId)) {
      res.status(400).json({ message: 'ระบุนักศึกษาและสัปดาห์ที่ต้องการไม่ถูกต้อง' });
      return;
    }

    await assertMentorOwnsStudent(req.user.userId, studentId);

    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (action === 'return' && !comment) {
      res.status(400).json({ message: 'กรุณาระบุเหตุผลที่ส่งกลับให้นักศึกษาแก้ไข' });
      return;
    }

    const updated = action === 'certify'
      ? await query(
          `UPDATE daily_logs
              SET mentor_certified_by = $3, mentor_certified_at = NOW(), returned_comment = NULL, updated_at = NOW()
            WHERE student_id = $1 AND week_number = $2 AND status = 'submitted'
            RETURNING daily_log_id`,
          [studentId, weekNumber, req.user.userId]
        )
      : await query(
          `UPDATE daily_logs
              SET status = 'returned', returned_comment = $3,
                  mentor_certified_by = NULL, mentor_certified_at = NULL, updated_at = NOW()
            WHERE student_id = $1 AND week_number = $2 AND status = 'submitted'
            RETURNING daily_log_id`,
          [studentId, weekNumber, comment]
        );

    if ((updated.rowCount ?? 0) === 0) {
      res.status(404).json({ message: 'ไม่พบบันทึกรายวันที่รอดำเนินการในสัปดาห์นี้' });
      return;
    }

    writeAudit(
      {
        action: action === 'certify' ? 'work_log.mentor_certified' : 'work_log.mentor_returned',
        entityType: 'daily_log',
        subjectId: studentId,
        detail: { week_number: weekNumber, days: updated.rowCount, comment: comment || undefined },
      },
      req
    ).catch(() => undefined);

    res.status(200).json({
      message: action === 'certify'
        ? `รับรองบันทึกรายวันสัปดาห์ที่ ${weekNumber} เรียบร้อยแล้ว (${updated.rowCount} วัน)`
        : `ส่งบันทึกรายวันสัปดาห์ที่ ${weekNumber} กลับให้นักศึกษาแก้ไขแล้ว`,
      days: updated.rowCount,
    });
  } catch (error) {
    if (sendAccessError(res, error)) return;
    sendUnexpectedError(res, error, 'Decide daily log week error', 'ไม่สามารถดำเนินการกับบันทึกรายวันได้');
  }
}

/** ⛔ fail closed — ไม่เข้าเงื่อนไขไหนเลยคือปฏิเสธ ไม่ใช่ปล่อยผ่าน */
async function assertMayRead(req: Request, studentId: number): Promise<void> {
  const { roles, userId } = req.user!;
  if (userId === studentId) return;
  if (roles.includes('mentor')) {
    await assertMentorOwnsStudent(userId, studentId);
    return;
  }
  if (roles.includes('advisor') || roles.includes('dept_head') || roles.includes('staff')) {
    await assertCanReviewStudentWork(userId, roles, studentId);
    return;
  }
  throw new Error('FORBIDDEN');
}

async function fetchIntent(studentId: number) {
  const res = await query(
    `SELECT form_id, start_date, end_date, daily_log_required, mentor_id,
            (SELECT name FROM mentors WHERE mentor_id = i.mentor_id) AS mentor_name
       FROM intent_forms i
      WHERE student_id = $1 AND status = 'accepted'
      ORDER BY form_id DESC LIMIT 1`,
    [studentId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    ...row,
    start_date: row.start_date ? new Date(row.start_date).toISOString().slice(0, 10) : null,
    end_date: row.end_date ? new Date(row.end_date).toISOString().slice(0, 10) : null,
  };
}

/** บันทึกทั้งหมดจัดกลุ่มเป็นสัปดาห์ — หน้าจอทั้งสองฝั่งอ่านรูปนี้เหมือนกัน */
async function fetchWeeks(studentId: number) {
  const res = await query(
    `SELECT week_number, daily_log_id, log_date, work_detail, remark, status,
            returned_comment, mentor_certified_at,
            (SELECT name FROM mentors WHERE mentor_id = d.mentor_certified_by) AS certified_by_name
       FROM daily_logs d
      WHERE student_id = $1
      ORDER BY week_number, log_date`,
    [studentId]
  );

  /**
   * สรุปสถานะระดับสัปดาห์จาก **ทุกวันในสัปดาห์** ไม่ใช่จากวันแรก
   *
   * ⛔ ห้ามหยิบค่าของแถวแรกมาเป็นสถานะของทั้งสัปดาห์ — ถ้านักศึกษาแก้วันเดียว
   *    สัปดาห์นั้นจะยังขึ้นว่า "รับรองแล้ว" ทั้งที่มีวันที่พี่เลี้ยงไม่เคยเห็น
   *    (บั๊กที่เจอตอนทดสอบรอบแรก)
   */
  const weeks = new Map<number, { week_number: number; days: unknown[]; rows: Record<string, unknown>[] }>();
  for (const row of res.rows) {
    if (!weeks.has(row.week_number)) {
      weeks.set(row.week_number, { week_number: row.week_number, days: [], rows: [] });
    }
    const week = weeks.get(row.week_number)!;
    week.rows.push(row);
    week.days.push({
      daily_log_id: row.daily_log_id,
      log_date: new Date(row.log_date).toISOString().slice(0, 10),
      work_detail: row.work_detail,
      remark: row.remark,
    });
  }

  return Array.from(weeks.values()).map((week) => {
    const rows = week.rows;
    const returned = rows.find((r) => r.status === 'returned');
    const allCertified = rows.every((r) => r.mentor_certified_at !== null);
    const allSubmitted = rows.every((r) => r.status === 'submitted');
    return {
      week_number: week.week_number,
      status: returned ? 'returned' : allSubmitted ? 'submitted' : 'draft',
      returned_comment: (returned?.returned_comment as string | null) ?? null,
      // รับรองแล้วก็ต่อเมื่อ **ครบทุกวัน** — ค่าที่แสดงคือวันที่รับรองล่าสุด
      mentor_certified_at: allCertified
        ? rows.map((r) => r.mentor_certified_at as string).sort().at(-1) ?? null
        : null,
      certified_by_name: allCertified ? (rows[0].certified_by_name as string | null) : null,
      days: week.days,
    };
  });
}

/**
 * ช่วงวันของสัปดาห์ที่ n — สัปดาห์แรกเริ่มที่ **วันเริ่มปฏิบัติงาน** ไม่ใช่วันจันทร์
 * (ตรงกับที่ฝั่งบันทึกรายสัปดาห์ใช้ และตรงกับที่คนนับกันจริง)
 */
function weekRange(startDate: string | null, weekNumber: number): { start: string; end: string } | null {
  if (!startDate) return null;
  const base = new Date(`${startDate}T00:00:00Z`);
  const start = new Date(base.getTime() + (weekNumber - 1) * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function emptyToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
