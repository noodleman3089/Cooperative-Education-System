import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';

/**
 * รายชื่อรุ่นต่อภาคเรียน (`semester_cohort`) — เฟส 1 R1-2 ของ `design_semester_lifecycle.md`
 *
 * Route: /api/semesters/:id/cohort · เจ้าหน้าที่เท่านั้น (ด่านอยู่ที่ routes/semester.ts)
 *
 * ⛔ รายชื่อนี้ **ไม่ใช่การตัดสินสิทธิ์** (SEC-02) — แค่ตัวหารของแดชบอร์ดว่าภาคนี้คาดหวังใคร · ไม่อยู่ในรายชื่อก็ยื่นคำร้องได้
 * ⛔ ถอดได้เฉพาะคนที่ **ยังไม่มีใบคำร้องในภาคนั้น** — คนที่มีใบถูกนับด้วยใบอยู่แล้ว ถอดแล้วก็ไม่หาย แต่ทำให้เจ้าหน้าที่เข้าใจผิดว่าถอดได้
 * ⛔ ยกยอดต้องเป็น **การกดของเจ้าหน้าที่** ไม่ยกเงียบ ๆ (ข้อ 7.2 ของแผน) และไม่ย้าย/ไม่แตะใบของภาคเดิม
 */

const TERMINAL = `'rejected', 'company_rejected', 'superseded'`;

function readId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const semesterExists = async (id: number): Promise<boolean> =>
  ((await query('SELECT 1 FROM coop_semesters WHERE semester_id = $1', [id])).rowCount ?? 0) > 0;

/**
 * ผู้สมัครยกยอดจากภาค `$1` เข้าภาค `$2`
 *   = รุ่นของภาค `$1` ∪ คนที่มีใบในภาค `$1`
 *   − คนที่ยังมีใบเดินอยู่หรือตอบรับแล้วในภาค `$1` (ยังอยู่ในมือของภาคเดิม)
 *   − คนที่ตอบรับที่ฝึกแล้วในภาคใดก็ตาม
 *   − คนที่อยู่ในรุ่นของภาค `$2` แล้ว
 */
const CARRY_OVER_CANDIDATES = `
  WITH cand AS (
    SELECT student_code FROM semester_cohort WHERE semester_id = $1
    UNION
    SELECT s.student_code FROM intent_forms i JOIN students s ON s.student_id = i.student_id WHERE i.semester_id = $1
  ), busy AS (
    SELECT s.student_code FROM intent_forms i JOIN students s ON s.student_id = i.student_id
     WHERE (i.semester_id = $1 AND i.status NOT IN (${TERMINAL})) OR i.status = 'accepted'
  )
  SELECT c.student_code FROM cand c
   WHERE c.student_code NOT IN (SELECT student_code FROM busy)
     AND c.student_code NOT IN (SELECT student_code FROM semester_cohort WHERE semester_id = $2)`;

export class SemesterCohortController {
  /** GET /api/semesters/:id/cohort */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const semesterId = readId(req.params.id);
      if (semesterId === null) {
        res.status(400).json({ message: 'รหัสภาคเรียนไม่ถูกต้อง' });
        return;
      }
      if (!(await semesterExists(semesterId))) {
        res.status(404).json({ message: 'ไม่พบภาคเรียนที่ระบุ' });
        return;
      }
      const rows = (
        await query(
          `SELECT c.student_code, c.source, c.added_at, s.first_name, s.last_name, mj.major_name_th,
                  EXISTS (SELECT 1 FROM intent_forms i JOIN students st ON st.student_id = i.student_id
                           WHERE i.semester_id = c.semester_id AND st.student_code = c.student_code) AS has_form
             FROM semester_cohort c
             LEFT JOIN students s ON s.student_code = c.student_code
             LEFT JOIN master_major mj ON mj.major_id = s.major_id
            WHERE c.semester_id = $1
            ORDER BY c.student_code`,
          [semesterId]
        )
      ).rows;
      res.status(200).json({ members: rows });
    } catch (error) {
      sendUnexpectedError(res, error, 'List Cohort Error', 'เกิดข้อผิดพลาดขณะดึงรายชื่อรุ่น');
    }
  }

  /** DELETE /api/semesters/:id/cohort/:code — ถอดคนที่ใส่ผิด (เฉพาะคนที่ยังไม่มีใบในภาคนั้น) */
  static async remove(req: Request, res: Response): Promise<void> {
    try {
      const semesterId = readId(req.params.id);
      const code = typeof req.params.code === 'string' ? req.params.code.trim() : '';
      if (semesterId === null || !code) {
        res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });
        return;
      }
      const hasForm = await query(
        `SELECT 1 FROM intent_forms i JOIN students s ON s.student_id = i.student_id
          WHERE i.semester_id = $1 AND s.student_code = $2 LIMIT 1`,
        [semesterId, code]
      );
      if ((hasForm.rowCount ?? 0) > 0) {
        res.status(409).json({ message: 'ถอดไม่ได้ — นักศึกษาคนนี้มีใบคำร้องในภาคนี้แล้ว (ระบบนับจากใบคำร้องอยู่แล้ว)' });
        return;
      }
      const removed = await query(
        `DELETE FROM semester_cohort WHERE semester_id = $1 AND student_code = $2`,
        [semesterId, code]
      );
      if ((removed.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบนักศึกษาคนนี้ในรายชื่อรุ่นของภาคนี้' });
        return;
      }
      await writeAudit(
        {
          action: AuditAction.SEMESTER_COHORT_REMOVED,
          entityType: 'coop_semesters',
          entityId: semesterId,
          detail: { student_code: code },
        },
        req
      );
      res.status(200).json({ message: 'ถอดออกจากรายชื่อรุ่นแล้ว' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Remove Cohort Member Error', 'เกิดข้อผิดพลาดขณะถอดรายชื่อ');
    }
  }

  /** GET /api/semesters/:id/cohort/carry-over?from=<id> — นับคนที่จะถูกยกยอด (ยังไม่ทำอะไร) */
  static async previewCarryOver(req: Request, res: Response): Promise<void> {
    try {
      const ids = await SemesterCohortController.readPair(req, res);
      if (!ids) return;
      const found = await query(CARRY_OVER_CANDIDATES, [ids.from, ids.to]);
      res.status(200).json({ candidates: found.rowCount ?? 0 });
    } catch (error) {
      sendUnexpectedError(res, error, 'Preview Carry Over Error', 'เกิดข้อผิดพลาดขณะนับรายชื่อที่จะยกยอด');
    }
  }

  /** POST /api/semesters/:id/cohort/carry-over { from_semester_id } */
  static async carryOver(req: Request, res: Response): Promise<void> {
    try {
      const ids = await SemesterCohortController.readPair(req, res);
      if (!ids) return;
      const added = await query(
        `INSERT INTO semester_cohort (semester_id, student_code, source)
         SELECT $2, student_code, 'carry_over' FROM (${CARRY_OVER_CANDIDATES}) picked
         ON CONFLICT DO NOTHING`,
        [ids.from, ids.to]
      );
      const count = added.rowCount ?? 0;
      await writeAudit(
        {
          action: AuditAction.SEMESTER_COHORT_CARRIED_OVER,
          entityType: 'coop_semesters',
          entityId: ids.to,
          detail: { from_semester_id: ids.from, added: count },
        },
        req
      );
      res.status(200).json({ added: count });
    } catch (error) {
      sendUnexpectedError(res, error, 'Carry Over Error', 'เกิดข้อผิดพลาดขณะยกยอดรายชื่อ');
    }
  }

  /** อ่านภาคปลายทาง (`:id`) กับภาคต้นทาง (`from` / `from_semester_id`) — ตอบ 4xx เองแล้วคืน null เมื่อไม่ผ่าน */
  private static async readPair(req: Request, res: Response): Promise<{ from: number; to: number } | null> {
    const to = readId(req.params.id);
    const from = readId(req.query.from ?? (req.body as Record<string, unknown> | undefined)?.from_semester_id);
    if (to === null || from === null) {
      res.status(400).json({ message: 'กรุณาเลือกภาคต้นทางที่จะยกยอด' });
      return null;
    }
    if (to === from) {
      res.status(400).json({ message: 'ภาคต้นทางต้องเป็นคนละภาคกับภาคนี้' });
      return null;
    }
    if (!(await semesterExists(to)) || !(await semesterExists(from))) {
      res.status(404).json({ message: 'ไม่พบภาคเรียนที่ระบุ' });
      return null;
    }
    return { from, to };
  }
}
