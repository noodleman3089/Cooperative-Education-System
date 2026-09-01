import { Request, Response } from 'express';
import { CoopCalendarModel, CoopCalendarEventRow } from '../models/coopCalendar';
import { CoopSemesterModel } from '../models/semester';
import {
  COOP_ACTIVITIES,
  CalendarStatus,
  activityLabel,
  calendarStatus,
  isCoopActivityKey,
} from '../utils/coopCalendar';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ActivitySlot {
  activity_key: string;
  label: string;
  event_id: number | null;
  start_date: string | null;
  end_date: string | null;
  late_end_date: string | null;
  note: string | null;
  status: CalendarStatus;
}

interface CustomSlot {
  event_id: number;
  title: string;
  start_date: string;
  end_date: string;
  late_end_date: string | null;
  note: string | null;
  status: CalendarStatus;
}

interface ValidatedPayload {
  title: string | null;
  start_date: string;
  end_date: string;
  late_end_date: string | null;
  note: string | null;
}

/**
 * ตรวจ payload ที่ create และ update ใช้ร่วมกัน
 * คืนข้อความไทยเมื่อไม่ผ่าน — ผู้เรียกเอาไปตอบ 400
 */
function validatePayload(
  body: Record<string, unknown>,
  activityKey: string | null
): { error: string } | { value: ValidatedPayload } {
  const start = typeof body.start_date === 'string' ? body.start_date.trim() : '';
  const end = typeof body.end_date === 'string' ? body.end_date.trim() : '';

  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    return { error: 'กรุณาระบุวันเริ่มและวันสิ้นสุดในรูปแบบ ปี-เดือน-วัน ให้ครบทั้งสองช่อง' };
  }

  // ด่านปี พ.ศ./ค.ศ. (BUG-01): ฐานเก็บ ค.ศ. แต่ฟอร์มหลายที่ในระบบใช้ พ.ศ.
  // ถ้าปล่อยให้ 2569 ลงฐานได้ ช่วงเวลานั้นจะไม่มีวันเปิดและไม่มีใครรู้ว่าทำไม
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  if (startYear < 2000 || startYear > 2200 || endYear < 2000 || endYear > 2200) {
    return {
      error: 'กรุณาระบุปีเป็น ค.ศ. (เช่น 2026) ระบบจะแปลงเป็น พ.ศ. ให้เองตอนแสดงผล',
    };
  }

  // เทียบสตริงล้วน — รูปแบบ YYYY-MM-DD เรียงตามลำดับเวลาอยู่แล้ว
  if (end < start) {
    return { error: 'วันสิ้นสุดต้องไม่มาก่อนวันเริ่ม' };
  }

  // วันผ่อนผัน: ไม่กรอก = ไม่เปิดผ่อนผันสำหรับกิจกรรมนี้ ไม่ใช่ผ่อนผันไม่จำกัด
  const rawLate = typeof body.late_end_date === 'string' ? body.late_end_date.trim() : '';
  let lateEnd: string | null = null;
  if (rawLate) {
    if (!ISO_DATE.test(rawLate)) {
      return { error: 'กรุณาระบุวันสุดท้ายที่ผ่อนผันในรูปแบบ ปี-เดือน-วัน' };
    }
    const lateYear = Number(rawLate.slice(0, 4));
    if (lateYear < 2000 || lateYear > 2200) {
      return {
        error: 'กรุณาระบุปีของวันผ่อนผันเป็น ค.ศ. (เช่น 2026) ระบบจะแปลงเป็น พ.ศ. ให้เองตอนแสดงผล',
      };
    }
    if (rawLate < end) {
      return { error: 'วันสุดท้ายที่ผ่อนผันต้องไม่มาก่อนวันสิ้นสุดปกติ' };
    }
    lateEnd = rawLate;
  }

  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
  if (!activityKey && !rawTitle) {
    return { error: 'กรุณาระบุชื่อกำหนดการสำหรับรายการที่เพิ่มเอง' };
  }

  const rawNote = typeof body.note === 'string' ? body.note.trim() : '';

  return {
    value: {
      // กิจกรรมตายตัวใช้ชื่อจาก constant เสมอ — ทิ้ง title ที่ client ส่งมา
      // ไม่งั้นจะมีชื่อสองชุดแล้ววันหนึ่งไม่ตรงกัน
      title: activityKey ? null : rawTitle,
      start_date: start,
      end_date: end,
      late_end_date: lateEnd,
      note: rawNote || null,
    },
  };
}

/** ประกอบผลลัพธ์ที่ทุก role ใช้ร่วมกัน — รูปเดียว ไม่แยกร่างตาม role */
function buildCalendar(rows: CoopCalendarEventRow[], today: string) {
  const byKey = new Map<string, CoopCalendarEventRow>();
  const custom: CustomSlot[] = [];

  for (const row of rows) {
    if (row.activity_key) {
      byKey.set(row.activity_key, row);
    } else {
      custom.push({
        event_id: row.event_id,
        title: row.title ?? '',
        start_date: row.start_date,
        end_date: row.end_date,
        late_end_date: row.late_end_date,
        note: row.note,
        status: calendarStatus(today, row.start_date, row.end_date, row.late_end_date),
      });
    }
  }

  // คืนครบทุกกิจกรรมเสมอ รวมอันที่ยังไม่ได้ตั้ง เพราะแถบเตือนของเจ้าหน้าที่
  // นับจาก status === 'not_configured' — ไม่ต้องมีฟิลด์ warnings แยก
  const activities: ActivitySlot[] = COOP_ACTIVITIES.map(({ key, label }) => {
    const row = byKey.get(key);
    return {
      activity_key: key,
      label,
      event_id: row?.event_id ?? null,
      start_date: row?.start_date ?? null,
      end_date: row?.end_date ?? null,
      late_end_date: row?.late_end_date ?? null,
      note: row?.note ?? null,
      status: calendarStatus(
        today,
        row?.start_date ?? null,
        row?.end_date ?? null,
        row?.late_end_date ?? null
      ),
    };
  });

  return { activities, custom_events: custom };
}

export class CoopCalendarController {
  /**
   * ปฏิทินของภาคการศึกษาหนึ่ง
   * Route: GET /api/calendar?semester_id=
   * Access: ผู้ใช้ที่ล็อกอินทุก role (นักศึกษาต้องอ่านได้ ไม่งั้นแบนเนอร์ว่างเปล่า)
   */
  static async getCalendar(req: Request, res: Response): Promise<void> {
    try {
      const raw = req.query.semester_id;
      const semesterId = typeof raw === 'string' && raw ? parseInt(raw, 10) : undefined;
      if (semesterId !== undefined && isNaN(semesterId)) {
        res.status(400).json({ message: 'รหัสภาคการศึกษาไม่ถูกต้อง' });
        return;
      }

      const semester = await CoopCalendarModel.resolveSemester(semesterId);
      const today = await CoopCalendarModel.today();

      if (!semester) {
        // ไม่มีภาคการศึกษา = ยังไม่มีกฎ ไม่ใช่ข้อผิดพลาด — ตอบ 200 พร้อมของว่าง
        // ให้หน้าจออธิบายเอง (แบนเนอร์นักศึกษาจะเงียบ ส่วนเจ้าหน้าที่เห็นคำอธิบาย)
        res.status(200).json({ semester: null, today, activities: [], custom_events: [] });
        return;
      }

      const rows = await CoopCalendarModel.listBySemester(semester.semester_id);
      res.status(200).json({ semester, today, ...buildCalendar(rows, today) });
    } catch (err) {
      sendUnexpectedError(
        res,
        err,
        'getCalendar error',
        'เกิดข้อผิดพลาดขณะดึงข้อมูลปฏิทินสหกิจศึกษา'
      );
    }
  }

  /**
   * Route: POST /api/calendar
   * Access: staff
   */
  static async createEvent(req: Request, res: Response): Promise<void> {
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

      const rawKey = body.activity_key;
      let activityKey: string | null = null;
      if (rawKey !== null && rawKey !== undefined && rawKey !== '') {
        if (!isCoopActivityKey(rawKey)) {
          res.status(400).json({ message: 'ไม่รู้จักกิจกรรมที่เลือก' });
          return;
        }
        activityKey = rawKey;
      }

      const checked = validatePayload(body, activityKey);
      if ('error' in checked) {
        res.status(400).json({ message: checked.error });
        return;
      }

      let created: CoopCalendarEventRow;
      try {
        created = await CoopCalendarModel.create({
          semester_id: semesterId,
          activity_key: activityKey,
          ...checked.value,
          created_by: req.user.userId,
        });
      } catch (err) {
        // 23505 = unique_violation จาก idx_coop_calendar_activity_once
        // ดักด้วยรหัสไม่ใช่ข้อความ เพราะข้อความของ Postgres เปลี่ยนตามเวอร์ชัน
        if ((err as { code?: string }).code === '23505') {
          res.status(409).json({
            message:
              'ภาคการศึกษานี้ตั้งช่วงของกิจกรรมนี้ไว้แล้ว หากต้องการเปลี่ยนวันให้แก้ที่รายการเดิม',
          });
          return;
        }
        throw err;
      }

      await writeAudit(
        {
          action: AuditAction.CALENDAR_EVENT_CREATED,
          entityType: 'coop_calendar_event',
          entityId: created.event_id,
          detail: {
            semester_id: created.semester_id,
            activity_key: created.activity_key,
            title: created.title ?? activityLabel(created.activity_key ?? ''),
            start_date: created.start_date,
            end_date: created.end_date,
            late_end_date: created.late_end_date,
          },
        },
        req
      );

      res.status(201).json({ message: 'บันทึกกำหนดการเรียบร้อยแล้ว', event: created });
    } catch (err) {
      sendUnexpectedError(res, err, 'createCalendarEvent error', 'เกิดข้อผิดพลาดขณะบันทึกกำหนดการ');
    }
  }

  /**
   * Route: PUT /api/calendar/:id
   * Access: staff
   */
  static async updateEvent(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) {
        res.status(400).json({ message: 'รหัสกำหนดการไม่ถูกต้อง' });
        return;
      }

      const existing = await CoopCalendarModel.findById(eventId);
      if (!existing) {
        res.status(404).json({ message: 'ไม่พบกำหนดการที่ต้องการแก้ไข' });
        return;
      }

      const checked = validatePayload(req.body as Record<string, unknown>, existing.activity_key);
      if ('error' in checked) {
        res.status(400).json({ message: checked.error });
        return;
      }

      const updated = await CoopCalendarModel.update(eventId, checked.value);
      if (!updated) {
        res.status(404).json({ message: 'ไม่พบกำหนดการที่ต้องการแก้ไข' });
        return;
      }

      await writeAudit(
        {
          action: AuditAction.CALENDAR_EVENT_UPDATED,
          entityType: 'coop_calendar_event',
          entityId: updated.event_id,
          detail: {
            semester_id: updated.semester_id,
            activity_key: updated.activity_key,
            title: updated.title ?? activityLabel(updated.activity_key ?? ''),
            start_date: updated.start_date,
            end_date: updated.end_date,
            late_end_date: updated.late_end_date,
            previous: {
              start_date: existing.start_date,
              end_date: existing.end_date,
              late_end_date: existing.late_end_date,
            },
          },
        },
        req
      );

      res.status(200).json({ message: 'แก้ไขกำหนดการเรียบร้อยแล้ว', event: updated });
    } catch (err) {
      sendUnexpectedError(res, err, 'updateCalendarEvent error', 'เกิดข้อผิดพลาดขณะแก้ไขกำหนดการ');
    }
  }

  /**
   * Route: DELETE /api/calendar/:id
   * Access: staff
   */
  static async deleteEvent(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const eventId = parseInt(req.params.id, 10);
      if (isNaN(eventId)) {
        res.status(400).json({ message: 'รหัสกำหนดการไม่ถูกต้อง' });
        return;
      }

      const existing = await CoopCalendarModel.findById(eventId);
      if (!existing) {
        res.status(404).json({ message: 'ไม่พบกำหนดการที่ต้องการลบ' });
        return;
      }

      await CoopCalendarModel.delete(eventId);

      await writeAudit(
        {
          action: AuditAction.CALENDAR_EVENT_DELETED,
          entityType: 'coop_calendar_event',
          entityId: eventId,
          detail: {
            semester_id: existing.semester_id,
            activity_key: existing.activity_key,
            title: existing.title ?? activityLabel(existing.activity_key ?? ''),
            start_date: existing.start_date,
            end_date: existing.end_date,
            late_end_date: existing.late_end_date,
          },
        },
        req
      );

      res.status(200).json({ message: 'ลบกำหนดการเรียบร้อยแล้ว' });
    } catch (err) {
      sendUnexpectedError(res, err, 'deleteCalendarEvent error', 'เกิดข้อผิดพลาดขณะลบกำหนดการ');
    }
  }
}
