import { Request, Response } from 'express';
import { CoopCalendarModel, CoopCalendarEventRow } from '../models/coopCalendar';
import { CoopSemesterModel } from '../models/semester';
import {
  COOP_ACTIVITIES,
  CalendarDateKind,
  CalendarStatus,
  CoopActivity,
  activityByKey,
  activityLabel,
  calendarStatus,
  isCalendarDateKind,
  isCoopActivityKey,
} from '../utils/coopCalendar';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ActivitySlot {
  activity_key: string;
  label: string;
  date_kind: CalendarDateKind;
  /** true = นอกช่วงแล้วเซิร์ฟเวอร์ปฏิเสธจริง · false = หมุดบอกเวลาเฉยๆ */
  locks: boolean;
  /** true = เจ้าหน้าที่กรอกเองไม่ได้ ช่วงมาจากกิจกรรมอื่น */
  derived: boolean;
  /** true = หน้าจอเจ้าหน้าที่ควรมีช่อง "ผ่อนผันถึง" ให้กรอก */
  allow_late: boolean;
  paper_row: string | null;
  hint: string | null;
  event_id: number | null;
  start_date: string | null;
  end_date: string | null;
  late_end_date: string | null;
  detail_text: string | null;
  note: string | null;
  status: CalendarStatus;
}

interface CustomSlot {
  event_id: number;
  title: string;
  date_kind: CalendarDateKind;
  start_date: string | null;
  end_date: string | null;
  late_end_date: string | null;
  detail_text: string | null;
  sort_order: number;
  note: string | null;
  status: CalendarStatus;
}

interface ValidatedPayload {
  title: string | null;
  date_kind: CalendarDateKind;
  start_date: string | null;
  end_date: string | null;
  late_end_date: string | null;
  detail_text: string | null;
  sort_order: number;
  note: string | null;
}

/** อ่านค่าสตริงที่ตัดช่องว่างแล้ว · คืน null เมื่อไม่ได้ส่งมาหรือส่งมาว่าง */
function readText(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

/**
 * ด่านปี พ.ศ./ค.ศ. (BUG-01): ฐานเก็บ ค.ศ. แต่ฟอร์มหลายที่ในระบบใช้ พ.ศ.
 * ถ้าปล่อยให้ 2569 ลงฐานได้ ช่วงเวลานั้นจะไม่มีวันเปิดและไม่มีใครรู้ว่าทำไม
 */
function badDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return true;
  const year = Number(iso.slice(0, 4));
  return year < 2000 || year > 2200;
}

const KIND_LABEL: Record<CalendarDateKind, string> = {
  range: 'ช่วงวันที่',
  deadline: 'ภายในวันที่',
  single: 'วันเดียว',
  relative: 'ข้อความอ้างอิงเหตุการณ์อื่น',
  external: 'ข้อความอ้างอิงปฏิทินอื่น',
};

/**
 * ตรวจ payload ที่ create และ update ใช้ร่วมกัน
 * คืนข้อความไทยเมื่อไม่ผ่าน — ผู้เรียกเอาไปตอบ 400
 *
 * **ชนิดวันของกิจกรรมตายตัวมาจาก `COOP_ACTIVITIES` ไม่ใช่จาก client** — มันคือ
 * สิ่งที่พิมพ์อยู่บนกระดาษ ไม่ใช่ตัวเลือกของคนกรอก · ส่วนรายการอิสระที่เจ้าหน้าที่
 * พิมพ์เองเลือกชนิดได้ เพราะกระดาษมีทั้งแบบมีวันและแบบเป็นข้อความล้วน
 *
 * ช่องที่ใช้ต่างกันตามชนิด — คนละความหมายจึงคนละช่อง ไม่ยัดลงช่องเดียว:
 *   range    `start_date` + `end_date`
 *   deadline `end_date` อย่างเดียว  ("ภายในวันที่ …" ไม่มีวันเริ่ม)
 *   single   `start_date` อย่างเดียว (ระบบสำเนาลง `end_date` ให้เอง)
 *   relative / external  `detail_text` อย่างเดียว ไม่มีวันเลย
 */
function validatePayload(
  body: Record<string, unknown>,
  activity: CoopActivity | null,
  sortOrder: number
): { error: string } | { value: ValidatedPayload } {
  const kind: CalendarDateKind | null = activity
    ? activity.dateKind
    : isCalendarDateKind(body.date_kind)
      ? body.date_kind
      : null;
  if (!kind) {
    return { error: 'กรุณาเลือกชนิดของกำหนดการ (ช่วงวันที่ · ภายในวันที่ · วันเดียว · ข้อความ)' };
  }

  const rawStart = readText(body.start_date);
  const rawEnd = readText(body.end_date);
  const rawDetail = readText(body.detail_text);

  let start: string | null = null;
  let end: string | null = null;
  let detail: string | null = null;

  if (kind === 'range') {
    if (!rawStart || !rawEnd || badDate(rawStart) || badDate(rawEnd)) {
      return {
        error:
          'กรุณาระบุวันเริ่มและวันสิ้นสุดให้ครบทั้งสองช่อง เป็นปี ค.ศ. (เช่น 2026-06-08) ระบบจะแปลงเป็น พ.ศ. ให้เองตอนแสดงผล',
      };
    }
    // เทียบสตริงล้วน — รูปแบบ YYYY-MM-DD เรียงตามลำดับเวลาอยู่แล้ว
    if (rawEnd < rawStart) return { error: 'วันสิ้นสุดต้องไม่มาก่อนวันเริ่ม' };
    start = rawStart;
    end = rawEnd;
  } else if (kind === 'deadline') {
    if (!rawEnd || badDate(rawEnd)) {
      return {
        error:
          'กำหนดการแบบ "ภายในวันที่" ให้ระบุเฉพาะวันสุดท้าย เป็นปี ค.ศ. (เช่น 2026-06-05) — ระบบเปิดให้ทำรายการตั้งแต่ต้นจนถึงวันนั้น',
      };
    }
    if (rawStart) {
      return {
        error:
          'กำหนดการแบบ "ภายในวันที่" ไม่มีวันเริ่ม — กรอกวันเริ่มด้วยจะกลายเป็นเปิดวันเดียว ซึ่งตรงข้ามกับที่ปฏิทินเขียนไว้',
      };
    }
    end = rawEnd;
  } else if (kind === 'single') {
    if (!rawStart || badDate(rawStart)) {
      return { error: 'กรุณาระบุวันที่ เป็นปี ค.ศ. (เช่น 2026-07-06)' };
    }
    // สำเนาลง end_date ให้เอง ผู้เรียกอื่นๆ จะได้ถามว่า "จบวันไหน" ได้เหมือนกันหมด
    start = rawStart;
    end = rawStart;
  } else {
    // relative | external — ไม่มีวันจริง มีแต่ข้อความที่ลอกมาจากกระดาษ
    if (!rawDetail) {
      return {
        error: `กำหนดการแบบ "${KIND_LABEL[kind]}" ไม่มีวันที่ กรุณาพิมพ์ข้อความตามที่ปฏิทินเขียนไว้ เช่น "ภายใน 3 วันทำการหลังส่งเอกสาร"`,
      };
    }
    if (rawStart || rawEnd) {
      return { error: `กำหนดการแบบ "${KIND_LABEL[kind]}" กรอกวันที่ไม่ได้ — ใช้ช่องข้อความแทน` };
    }
    detail = rawDetail;
  }

  // วันผ่อนผัน: ไม่กรอก = ไม่เปิดผ่อนผันสำหรับกิจกรรมนี้ ไม่ใช่ผ่อนผันไม่จำกัด
  const rawLate = readText(body.late_end_date);
  let lateEnd: string | null = null;
  if (rawLate) {
    if (!end) {
      return {
        error: `กำหนดการแบบ "${KIND_LABEL[kind]}" ไม่มีวันปิด จึงตั้งวันผ่อนผันไม่ได้`,
      };
    }
    if (badDate(rawLate)) {
      return {
        error: 'กรุณาระบุวันสุดท้ายที่ผ่อนผันเป็นปี ค.ศ. ในรูปแบบ ปี-เดือน-วัน',
      };
    }
    if (rawLate < end) {
      return { error: 'วันสุดท้ายที่ผ่อนผันต้องไม่มาก่อนวันสิ้นสุดปกติ' };
    }
    lateEnd = rawLate;
  }

  const rawTitle = readText(body.title);
  if (!activity && !rawTitle) {
    return { error: 'กรุณาระบุชื่อกำหนดการสำหรับรายการที่เพิ่มเอง' };
  }

  return {
    value: {
      // กิจกรรมตายตัวใช้ชื่อจาก constant เสมอ — ทิ้ง title ที่ client ส่งมา
      // ไม่งั้นจะมีชื่อสองชุดแล้ววันหนึ่งไม่ตรงกัน
      title: activity ? null : rawTitle,
      date_kind: kind,
      start_date: start,
      end_date: end,
      late_end_date: lateEnd,
      detail_text: detail,
      sort_order: sortOrder,
      note: readText(body.note),
    },
  };
}

/**
 * ลำดับการแสดงผล — กิจกรรมตายตัวใช้ลำดับใน `COOP_ACTIVITIES` (ซึ่งเรียงตามกระดาษ)
 * ส่วนรายการอิสระที่เจ้าหน้าที่เพิ่มเองรับจาก client ได้ แต่ถูกดันไปอยู่หลังสุด
 * เสมอเมื่อไม่ได้ระบุ เพราะของที่คณะพิมพ์ไว้ควรมาก่อนของที่พิมพ์แทรกทีหลัง
 */
const CUSTOM_ROW_BASE_ORDER = 1000;

function resolveSortOrder(body: Record<string, unknown>, activity: CoopActivity | null): number {
  if (activity) return COOP_ACTIVITIES.findIndex((a) => a.key === activity.key);
  const raw = Number(body.sort_order);
  return Number.isInteger(raw) && raw >= 0 && raw <= 9999 ? raw : CUSTOM_ROW_BASE_ORDER;
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
        date_kind: row.date_kind,
        start_date: row.start_date,
        end_date: row.end_date,
        late_end_date: row.late_end_date,
        detail_text: row.detail_text,
        sort_order: row.sort_order,
        note: row.note,
        status: calendarStatus(today, row.start_date, row.end_date, row.late_end_date),
      });
    }
  }

  // คืนครบทุกกิจกรรมเสมอ รวมอันที่ยังไม่ได้ตั้ง เพราะแถบเตือนของเจ้าหน้าที่
  // นับจาก status === 'not_configured' — ไม่ต้องมีฟิลด์ warnings แยก
  const activities: ActivitySlot[] = COOP_ACTIVITIES.map((activity) => {
    const row = byKey.get(activity.key);

    // กิจกรรมที่คำนวณเอง (weekly_log) ไม่มีแถวของตัวเองในฐาน — ประกอบช่วงจาก
    // สองกิจกรรมที่มันอ้างอิง กติกาเดียวกับ CoopCalendarModel.findDerivedWindow
    // เพื่อให้ "สิ่งที่หน้าจอบอก" กับ "สิ่งที่ตัวล็อกทำ" ตอบตรงกันเสมอ
    const source = activity.derivedFrom;
    const start = source
      ? (byKey.get(source.start)?.start_date ?? null)
      : (row?.start_date ?? null);
    const endRow = source ? byKey.get(source.end) : row;
    const end = endRow?.end_date ?? null;
    const lateEnd = endRow?.late_end_date ?? null;

    return {
      activity_key: activity.key,
      label: activity.label,
      date_kind: activity.dateKind,
      locks: activity.locks,
      derived: !!source,
      allow_late: activity.allowLate,
      paper_row: activity.paperRow,
      hint: activity.hint,
      event_id: row?.event_id ?? null,
      start_date: start,
      end_date: end,
      late_end_date: lateEnd,
      detail_text: row?.detail_text ?? null,
      note: row?.note ?? null,
      status: calendarStatus(today, start, end, lateEnd),
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
      let activity: CoopActivity | null = null;
      if (rawKey !== null && rawKey !== undefined && rawKey !== '') {
        if (!isCoopActivityKey(rawKey)) {
          res.status(400).json({ message: 'ไม่รู้จักกิจกรรมที่เลือก' });
          return;
        }
        activityKey = rawKey;
        activity = activityByKey(rawKey);
      }

      // กิจกรรมที่คำนวณเองต้องไม่มีแถวในฐาน — ถ้ามี จะเกิดวันสองชุดที่วันหนึ่งไม่ตรงกัน
      if (activity?.derivedFrom) {
        res.status(400).json({
          message: `"${activity.label}" คำนวณจากวันเริ่มและวันสิ้นสุดการปฏิบัติงานอยู่แล้ว จึงตั้งช่วงแยกไม่ได้`,
        });
        return;
      }

      const checked = validatePayload(body, activity, resolveSortOrder(body, activity));
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

      const body = req.body as Record<string, unknown>;
      const activity = existing.activity_key ? activityByKey(existing.activity_key) : null;
      const checked = validatePayload(body, activity, resolveSortOrder(body, activity));
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
