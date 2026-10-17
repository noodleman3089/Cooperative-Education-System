import { Request, Response } from 'express';
import { CoopSpecialRoundModel, SpecialRoundInput, SpecialRoundRow } from '../models/coopSpecialRound';
import { CoopSemesterModel } from '../models/semester';
import { CoopCalendarModel } from '../models/coopCalendar';
import { StudentMemoModel } from '../models/studentMemo';
import { ROUND_MEMO_TYPES } from '../config/memoTypes';
import { isCoopActivityKey, isRoundableActivity, activityLabel } from '../utils/coopCalendar';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STUDENTS = 500;

function readText(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/** ปี พ.ศ./ค.ศ. — กติกาเดียวกับ `controllers/coopCalendar.ts` (ฐานเก็บ ค.ศ.) */
function badDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return true;
  const year = Number(iso.slice(0, 4));
  return year < 2000 || year > 2200;
}

/** ตรวจ payload ที่ create กับ update ใช้ร่วมกัน · คืนข้อความไทยเมื่อไม่ผ่าน (ผู้เรียกตอบ 400) */
async function validateInput(
  body: Record<string, unknown>
): Promise<{ error: string } | { value: SpecialRoundInput }> {
  const title = readText(body.title);
  if (!title) return { error: 'กรุณาระบุชื่อรอบพิเศษ' };
  if (title.length > 255) return { error: 'ชื่อรอบพิเศษยาวเกินไป (ไม่เกิน 255 ตัวอักษร)' };

  const start = readText(body.start_date);
  const end = readText(body.end_date);
  if (!start || !end || badDate(start) || badDate(end)) {
    return {
      error: 'กรุณาระบุวันเริ่มและวันสิ้นสุดของรอบให้ครบทั้งสองช่อง เป็นปี ค.ศ. (เช่น 2026-10-20)',
    };
  }
  // เทียบสตริงล้วน — YYYY-MM-DD เรียงตามเวลาอยู่แล้ว (ห้าม new Date())
  if (end < start) return { error: 'วันสิ้นสุดของรอบต้องไม่มาก่อนวันเริ่ม' };

  const keys = Array.isArray(body.activity_keys) ? [...new Set(body.activity_keys as unknown[])] : [];
  if (keys.length === 0) return { error: 'กรุณาเลือกกิจกรรมที่เปิดให้ส่งในรอบนี้อย่างน้อย 1 รายการ' };
  for (const key of keys) {
    if (typeof key !== 'string' || !isCoopActivityKey(key)) {
      return { error: 'ไม่รู้จักกิจกรรมที่เลือก' };
    }
    if (!isRoundableActivity(key)) {
      return {
        error: `"${activityLabel(key)}" เปิดรอบพิเศษไม่ได้ — กิจกรรมนี้ไม่ได้ล็อกการทำรายการ หรือช่วงถูกคำนวณจากกิจกรรมอื่น`,
      };
    }
  }

  const rawIds = Array.isArray(body.student_ids) ? (body.student_ids as unknown[]) : [];
  const ids = [...new Set(rawIds.map((v) => Number(v)))];
  if (ids.length === 0) return { error: 'กรุณาเลือกนักศึกษาที่ใช้รอบนี้อย่างน้อย 1 คน' };
  if (ids.length > MAX_STUDENTS) return { error: `เลือกนักศึกษาได้ไม่เกิน ${MAX_STUDENTS} คนต่อรอบ` };
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return { error: 'รายชื่อนักศึกษาไม่ถูกต้อง' };
  if ((await CoopSpecialRoundModel.countExistingStudents(ids)) !== ids.length) {
    return { error: 'พบนักศึกษาที่ไม่มีอยู่ในระบบในรายชื่อที่เลือก' };
  }

  return {
    value: {
      title,
      start_date: start,
      end_date: end,
      note: readText(body.note),
      activity_keys: keys as string[],
      student_ids: ids,
    },
  };
}

function auditDetail(round: SpecialRoundRow, studentCount: number) {
  return {
    semester_id: round.semester_id,
    title: round.title,
    start_date: round.start_date,
    end_date: round.end_date,
    activity_keys: round.activity_keys,
    // ไม่ใส่ชื่อ/รหัสนักศึกษาลง audit — จำนวนพอสำหรับถามว่า "ใครเปิดรอบให้กี่คน"
    student_count: studentCount,
  };
}

export class CoopSpecialRoundController {
  /**
   * ค้นนักศึกษาให้เจ้าหน้าที่เลือกใส่รอบ
   * Route: GET /api/calendar/special-rounds/students?q=
   * Access: staff
   */
  static async searchStudents(req: Request, res: Response): Promise<void> {
    try {
      const term = readText(req.query.q);
      if (!term || term.length < 2) {
        res.status(200).json([]);
        return;
      }
      res.status(200).json(await CoopSpecialRoundModel.searchStudents(term));
    } catch (err) {
      sendUnexpectedError(res, err, 'searchSpecialRoundStudents error', 'เกิดข้อผิดพลาดขณะค้นหานักศึกษา');
    }
  }

  /**
   * บันทึกข้อความที่คณบดีอนุมัติแล้ว (ออกก่อนกำหนด · ส่งเอกสารล่าช้า) ให้เจ้าหน้าที่เลือกนำเข้ารอบพิเศษ
   * Route: GET /api/calendar/special-rounds/memos?semester_id=
   * Access: staff
   *
   * ⛔ ไม่เปิดรอบเอง — คำตัดสินของคณบดีคือการอนุญาต ส่วนวัน/กิจกรรมของรอบเจ้าหน้าที่เป็นคนกำหนด
   */
  static async listApprovedMemos(req: Request, res: Response): Promise<void> {
    try {
      const raw = req.query.semester_id;
      const semesterId = typeof raw === 'string' && raw ? parseInt(raw, 10) : undefined;
      if (semesterId !== undefined && isNaN(semesterId)) {
        res.status(400).json({ message: 'รหัสภาคการศึกษาไม่ถูกต้อง' });
        return;
      }
      const semester = await CoopCalendarModel.resolveSemester(semesterId);
      if (!semester) {
        res.status(200).json([]);
        return;
      }
      const memos = await StudentMemoModel.listApprovedForRounds(semester.semester_id, [
        ...ROUND_MEMO_TYPES,
      ]);
      res.status(200).json(
        memos.map((m) => ({
          memo_id: m.memo_id,
          memo_type: m.memo_type,
          student_id: m.student_id,
          student_code: m.student_code,
          first_name: m.first_name,
          last_name: m.last_name,
          major_name_th: m.major_name_th,
          decided_at: m.decided_at,
        }))
      );
    } catch (err) {
      sendUnexpectedError(res, err, 'listApprovedMemos error', 'เกิดข้อผิดพลาดขณะดึงบันทึกข้อความที่อนุมัติ');
    }
  }

  /**
   * Route: POST /api/calendar/special-rounds
   * Access: staff
   */
  static async create(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const body = req.body as Record<string, unknown>;
      const semesterId = Number(body.semester_id);
      if (!Number.isInteger(semesterId) || semesterId <= 0) {
        res.status(400).json({ message: 'กรุณาเลือกภาคการศึกษา' });
        return;
      }
      if (!(await CoopSemesterModel.findById(semesterId))) {
        res.status(404).json({ message: 'ไม่พบภาคการศึกษาที่เลือก' });
        return;
      }

      const checked = await validateInput(body);
      if ('error' in checked) {
        res.status(400).json({ message: checked.error });
        return;
      }

      const roundId = await CoopSpecialRoundModel.save(null, semesterId, checked.value, req.user.userId);
      const round = await CoopSpecialRoundModel.findById(roundId);

      if (round) {
        await writeAudit(
          {
            action: AuditAction.SPECIAL_ROUND_CREATED,
            entityType: 'coop_special_round',
            entityId: roundId,
            detail: auditDetail(round, checked.value.student_ids.length),
          },
          req
        );
      }

      res.status(201).json({ message: 'เปิดรอบพิเศษเรียบร้อยแล้ว', round });
    } catch (err) {
      sendUnexpectedError(res, err, 'createSpecialRound error', 'เกิดข้อผิดพลาดขณะเปิดรอบพิเศษ');
    }
  }

  /**
   * Route: PUT /api/calendar/special-rounds/:id
   * Access: staff · ภาคย้ายไม่ได้ · ส่งรายชื่อ/กิจกรรมมาใหม่ทั้งชุด (แทนที่ของเดิม)
   */
  static async update(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const roundId = parseInt(req.params.id, 10);
      if (isNaN(roundId)) {
        res.status(400).json({ message: 'รหัสรอบพิเศษไม่ถูกต้อง' });
        return;
      }
      const existing = await CoopSpecialRoundModel.findById(roundId);
      if (!existing) {
        res.status(404).json({ message: 'ไม่พบรอบพิเศษที่ต้องการแก้ไข' });
        return;
      }

      const checked = await validateInput(req.body as Record<string, unknown>);
      if ('error' in checked) {
        res.status(400).json({ message: checked.error });
        return;
      }

      await CoopSpecialRoundModel.save(roundId, existing.semester_id, checked.value, req.user.userId);
      const round = await CoopSpecialRoundModel.findById(roundId);

      if (round) {
        await writeAudit(
          {
            action: AuditAction.SPECIAL_ROUND_UPDATED,
            entityType: 'coop_special_round',
            entityId: roundId,
            detail: {
              ...auditDetail(round, checked.value.student_ids.length),
              previous: {
                title: existing.title,
                start_date: existing.start_date,
                end_date: existing.end_date,
                activity_keys: existing.activity_keys,
              },
            },
          },
          req
        );
      }

      res.status(200).json({ message: 'แก้ไขรอบพิเศษเรียบร้อยแล้ว', round });
    } catch (err) {
      sendUnexpectedError(res, err, 'updateSpecialRound error', 'เกิดข้อผิดพลาดขณะแก้ไขรอบพิเศษ');
    }
  }

  /**
   * Route: DELETE /api/calendar/special-rounds/:id
   * Access: staff
   */
  static async remove(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const roundId = parseInt(req.params.id, 10);
      if (isNaN(roundId)) {
        res.status(400).json({ message: 'รหัสรอบพิเศษไม่ถูกต้อง' });
        return;
      }
      const existing = await CoopSpecialRoundModel.findById(roundId);
      if (!existing) {
        res.status(404).json({ message: 'ไม่พบรอบพิเศษที่ต้องการลบ' });
        return;
      }
      const studentCount = (await CoopSpecialRoundModel.listStudents(roundId)).length;
      await CoopSpecialRoundModel.delete(roundId);

      await writeAudit(
        {
          action: AuditAction.SPECIAL_ROUND_DELETED,
          entityType: 'coop_special_round',
          entityId: roundId,
          detail: auditDetail(existing, studentCount),
        },
        req
      );

      res.status(200).json({ message: 'ลบรอบพิเศษเรียบร้อยแล้ว' });
    } catch (err) {
      sendUnexpectedError(res, err, 'deleteSpecialRound error', 'เกิดข้อผิดพลาดขณะลบรอบพิเศษ');
    }
  }
}
