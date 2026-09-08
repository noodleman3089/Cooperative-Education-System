import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { BATCH_CERTIFIABLE_KINDS, MentorQueueModel } from '../models/mentorQueue';
import { writeAudit } from '../utils/audit';
import { getErrorMessage, sendUnexpectedError } from '../utils/httpError';

/** กันไม่ให้ยิงมาเป็นพัน ๆ ใบในคำขอเดียว — หน้าจอเลือกได้ทีละไม่กี่ใบอยู่แล้ว */
const MAX_BATCH_ITEMS = 20;

export class MentorController {
  /**
   * งานที่รอพี่เลี้ยงคนนี้ + การ์ดนักศึกษาที่ดูแล
   * Route: GET /api/mentor/pending
   * Access: mentor
   *
   * ⛔ นี่คือ "ช่องทางแจ้งเตือน" ทั้งหมดของฝ่ายพี่เลี้ยง — **ไม่มีตาราง notification
   *    และไม่มีกระดิ่งบนแถบบน** งานค้างอ่านจากสถานะจริงของเอกสาร ส่วนอีเมลใช้ตัวเดิม
   *    ที่มี `mentor_notifications` คุมจังหวะไม่ให้ยิงซ้ำภายใน 24 ชม.
   */
  static async getPending(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }
      const mentorId = req.user.userId;

      const [items, students] = await Promise.all([
        MentorQueueModel.pendingItems(mentorId),
        MentorQueueModel.myStudents(mentorId),
      ]);

      res.status(200).json({ items, students });
    } catch (error) {
      sendUnexpectedError(res, error, 'Mentor pending queue error', 'ไม่สามารถโหลดรายการที่รอรับรองได้');
    }
  }

  /**
   * รับรองบันทึกหลายใบพร้อมกัน
   * Route: PATCH /api/mentor/certify-batch
   * Access: mentor
   *
   * ⛔ รับเฉพาะบันทึกการปฏิบัติงาน (สหกิจ 08/09/10) — แผนปฏิบัติงาน โครงร่างรายงาน
   *    และร่างรายงานต้องอ่านก่อนถึงจะเซ็นได้ จึงมีปุ่มของตัวเองในหน้าจอของมันเอง
   * ⛔ ทั้งชุดอยู่ในทรานแซกชันเดียว — เจอใบที่ไม่ใช่ของนักศึกษาที่ตัวเองดูแลเมื่อไหร่
   *    ล้มทั้งชุด ไม่ใช่ข้ามใบนั้นเงียบ ๆ
   */
  static async certifyBatch(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const raw = Array.isArray(req.body?.items) ? req.body.items : null;
      if (!raw || raw.length === 0) {
        res.status(400).json({ message: 'กรุณาเลือกบันทึกที่ต้องการรับรองอย่างน้อยหนึ่งรายการ' });
        return;
      }
      if (raw.length > MAX_BATCH_ITEMS) {
        res.status(400).json({ message: `รับรองได้ครั้งละไม่เกิน ${MAX_BATCH_ITEMS} รายการ` });
        return;
      }

      const items: { kind: string; id: number }[] = [];
      for (const entry of raw) {
        const kind = String(entry?.kind ?? '');
        const id = Number(entry?.id);
        if (!BATCH_CERTIFIABLE_KINDS.includes(kind as never) || !Number.isInteger(id)) {
          res.status(400).json({
            message: 'รับรองรวดเดียวได้เฉพาะบันทึกการปฏิบัติงาน (รายวัน รายสัปดาห์ รายเดือน) เท่านั้น',
          });
          return;
        }
        items.push({ kind, id });
      }

      await client.query('BEGIN');
      const certified = await MentorQueueModel.certifyBatch(client, req.user.userId, items);
      await client.query('COMMIT');

      writeAudit(
        {
          action: 'work_log.mentor_certified_batch',
          entityType: 'work_log',
          detail: { count: certified, items },
        },
        req
      ).catch(() => undefined);

      // ⛔ นับตามจำนวน "รายการที่ผู้ใช้เลือก" ไม่ใช่จำนวนแถวที่ถูกอัปเดต — บันทึกรายวัน
      //    หนึ่งรายการในคิวคือทั้งสัปดาห์ (5 แถว) ถ้ารายงานเป็นจำนวนแถว ผู้ใช้ที่เลือก
      //    4 รายการจะเห็นข้อความว่า "รับรองแล้ว 8 รายการ" แล้วสงสัยว่าไปโดนของใครเข้า
      res.status(200).json({
        certified: items.length,
        certified_rows: certified,
        message: `รับรองบันทึกเรียบร้อยแล้ว ${items.length} รายการ`,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message = getErrorMessage(error, '');
      if (message.includes('ไม่ใช่ของนักศึกษาที่ท่านดูแล')) {
        res.status(403).json({ message });
        return;
      }
      if (message.includes('รับรองรวดเดียวได้เฉพาะ')) {
        res.status(400).json({ message });
        return;
      }
      sendUnexpectedError(res, error, 'Mentor certify batch error', 'ไม่สามารถรับรองบันทึกได้');
    } finally {
      client.release();
    }
  }

  /**
   * เปิด/ปิดการบันทึกรายวัน (สหกิจ 08) ของการไปฝึกครั้งนี้
   * Route: PATCH /api/intents/:id/daily-log-required
   * Access: mentor เท่านั้น
   *
   * ⛔ **นักศึกษาปิดเองไม่ได้** — มันคือการยกเลิกภาระงานของตัวเอง
   * ⛔ เปิดกลางเทอมมีผล **ตั้งแต่สัปดาห์ปัจจุบันเป็นต้นไป ห้ามย้อนหลัง**
   *    (บังคับที่ฝั่งการนับความครบ ไม่ใช่ที่นี่ — ที่นี่แค่เก็บวันที่สลับค่าไว้ใน audit_log
   *    ให้ตอบได้ว่าเริ่มบังคับเมื่อไหร่)
   * ⛔ ปิดทีหลังแล้ว **บันทึกที่เคยกรอกไว้ไม่ถูกลบ** — ไม่มี DELETE ในเส้นนี้โดยตั้งใจ
   */
  static async setDailyLogRequired(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (!Number.isInteger(formId)) {
        res.status(400).json({ message: 'รหัสคำร้องไม่ถูกต้อง' });
        return;
      }
      if (typeof req.body?.value !== 'boolean') {
        res.status(400).json({ message: 'ค่าที่ส่งมาต้องเป็น true หรือ false' });
        return;
      }
      const value: boolean = req.body.value;

      // ⛔ fail closed — ต้องเป็นคำร้องที่ผูกกับพี่เลี้ยงคนนี้และตอบรับแล้วเท่านั้น
      const updated = await query(
        `UPDATE intent_forms SET daily_log_required = $3
          WHERE form_id = $1 AND mentor_id = $2 AND status = 'accepted'
          RETURNING student_id, daily_log_required`,
        [formId, req.user.userId, value]
      );
      if ((updated.rowCount ?? 0) === 0) {
        res.status(403).json({ message: 'นักศึกษาคนนี้ไม่ได้อยู่ในการดูแลของท่าน' });
        return;
      }

      writeAudit(
        {
          action: 'intent.daily_log_required',
          entityType: 'intent_form',
          entityId: formId,
          subjectId: updated.rows[0].student_id,
          detail: { value },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        daily_log_required: value,
        message: value
          ? 'เปิดให้นักศึกษาบันทึกรายวันแล้ว มีผลตั้งแต่สัปดาห์ปัจจุบันเป็นต้นไป'
          : 'ปิดการบันทึกรายวันแล้ว บันทึกที่เคยกรอกไว้ยังอยู่ครบ',
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Set daily log required error', 'ไม่สามารถเปลี่ยนการตั้งค่าบันทึกรายวันได้');
    }
  }
}
