import { Request, Response } from 'express';
import { query } from '../config/database';
import { CoopCalendarModel } from '../models/coopCalendar';
import { CoopSemesterModel } from '../models/semester';
import {
  CalendarStatus,
  COOP_ACTIVITIES,
  CoopActivityKey,
  calendarStatus,
} from '../utils/coopCalendar';
import { sendUnexpectedError } from '../utils/httpError';

/**
 * หน้าแรกของเจ้าหน้าที่งานสหกิจศึกษา — “คิวงานวันนี้” (spec-E ข้อ 4 · SB8)
 *
 * เส้นเดียวที่หน้าแรกเรียก · รวมฤดูกาล ตัวนับ 5 กอง แถบเวลา และคำเตือนปฏิทิน
 * ไว้ในคำขอเดียว เพราะทั้งหมดนี้ต้องมาจาก **“วันนี้” ก้อนเดียวกัน** — ถ้าแยกเป็น
 * หลายคำขอ แต่ละอันจะอ่านนาฬิกาคนละครั้งและตอบคนละวันได้ในช่วงเที่ยงคืน
 *
 * ⛔ **ฤดูกาลตัดสินที่นี่ที่เดียว ห้ามให้หน้าจอตัดสินเอง** — ตรรกะที่อยู่สองที่
 *    จะเพี้ยนคนละทางแน่นอน และหน้าจอไม่มีทางรู้ “วันนี้” ของฐานข้อมูล
 *
 * ⛔ **ตัวเลขทุกตัวต้องมาจากข้อมูลจริง** ไม่มีค่าสำรองสวย ๆ · สิ่งที่คำนวณไม่ได้
 *    (เช่นอายุคิวของแถวที่ไม่มี `created_at`) ต้องออกไปเป็น `null` แล้วให้หน้าจอ
 *    เขียนว่า “ไม่ทราบ” ห้ามเดาแล้วนับเป็นเลยกำหนด
 */
export class StaffHomeController {
  /**
   * Route: GET /api/staff/home
   * Access: staff
   */
  static async getHome(_req: Request, res: Response): Promise<void> {
    try {
      const today = await CoopCalendarModel.today();
      const semester = await CoopSemesterModel.findActiveSemester();

      const [tiles, windows] = await Promise.all([
        loadTiles(today),
        loadCalendarWindows(semester?.semester_id ?? null, today),
      ]);

      /**
       * ⛔ ลำดับนี้คือข้อ 4.2 ของสเปกเป๊ะ ๆ — **หยุดที่เงื่อนไขแรกที่เป็นจริง**
       *    “ของที่เลยกำหนด” มาก่อนทุกอย่างโดยตั้งใจ: งานตามปฏิทินมาทุกภาคเรียน
       *    แต่ของที่เลยกำหนดแล้วไม่มีใครมาเตือนอีก
       */
      const overdueTotal = tiles.request.overdue + tiles.acceptance.overdue;
      const extra = await loadSeasonExtras(today, semester?.semester_id ?? null);

      let season: Season;
      if (!semester) {
        // ไม่มีภาคเรียนที่เปิดใช้งาน = ไม่มีปฏิทินให้อ้างเลย → ว่าง + แถบเตือน (ข้อ 4.2)
        season = 'idle';
      } else if (overdueTotal > 0) {
        season = 'overdue';
      } else if (isOpen(windows.intent_submission.state)) {
        season = 'request';
      } else if (isOpen(windows.acceptance_form.state)) {
        season = 'acceptance';
      } else if (
        windows.coop_period.start !== null &&
        windows.coop_period.end !== null &&
        today >= windows.coop_period.start &&
        today <= windows.coop_period.end
      ) {
        season = 'supervision';
      } else if (
        windows.coop_period.end !== null &&
        today > windows.coop_period.end &&
        extra.evaluationsMissing > 0
      ) {
        season = 'evaluation';
      } else {
        season = 'idle';
      }

      res.status(200).json({
        today,
        semester: semester
          ? {
              semester_id: semester.semester_id,
              /**
               * `academic_year` ในฐานเก็บปนกันทั้ง ค.ศ. และ พ.ศ. (seed เป็น 2026)
               * แปะลงป้ายดิบ ๆ จะได้ “ภาคเรียนที่ 1/2026” นั่งอยู่ข้าง “วันนี้ 12 ก.ย. 2569”
               * บนหน้าจอเดียวกัน — กติกา `> 2500` นี้เป็นอันเดียวกับที่หน้าจออื่นใช้อยู่แล้ว
               */
              label: `ภาคเรียนที่ ${semester.semester}/${
                semester.academic_year > 2500 ? semester.academic_year : semester.academic_year + 543
              }`,
              is_active: semester.is_active,
            }
          : null,
        season,
        season_detail: seasonDetail(season, today, tiles, windows, extra),
        tiles,
        timeline: [
          timelineEntry('intent_submission', 'รับคำร้อง & ออกหนังสือ', windows.intent_submission),
          timelineEntry('acceptance_form', 'รับแบบตอบรับ', windows.acceptance_form),
          {
            key: 'coop_start',
            label: 'ระหว่างปฏิบัติงาน & นิเทศ',
            state: windows.coop_period.state,
            start: windows.coop_period.start,
            end: windows.coop_period.end,
            late_end: null,
          },
          timelineEntry('final_report', 'ประเมินและปิดภาค', windows.final_report),
        ],
        calendar_warnings: semester
          ? windows.warnings
          : [
              {
                activity_key: null,
                label:
                  'ยังไม่ได้เปิดภาคเรียน — ไปตั้งที่ปฏิทินสหกิจศึกษา (ตอนนี้ระบบยังไม่ล็อกใครในขั้นไหนเลย)',
              },
            ],
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Staff home error', 'ไม่สามารถโหลดหน้าแรกของเจ้าหน้าที่ได้');
    }
  }
}

/* ── ชนิดข้อมูลของไฟล์นี้ ──────────────────────────────────────────── */

type Season =
  | 'overdue'
  | 'request'
  | 'acceptance'
  | 'supervision'
  | 'evaluation'
  | 'idle';

interface Tile {
  count: number;
  overdue: number;
  note: string | null;
}

interface Tiles {
  request: Tile;
  acceptance: Tile;
  dispatch: Tile;
  appointment: Tile;
  dean: Tile;
}

interface Window {
  state: CalendarStatus;
  start: string | null;
  end: string | null;
  late_end: string | null;
}

interface Windows {
  intent_submission: Window;
  acceptance_form: Window;
  final_report: Window;
  /** ช่วงปฏิบัติงาน = `coop_start` → `coop_end` (ทั้งคู่เป็นชนิด single) */
  coop_period: Window;
  warnings: { activity_key: string | null; label: string }[];
}

interface SeasonExtras {
  /** คำร้องในคิวที่ถูกปั๊มว่ายื่นช่วงผ่อนผัน */
  lateRequests: number;
  /** นักศึกษาที่ออกฝึกแล้วในภาคนี้ */
  studentsOnPlacement: number;
  /** ในจำนวนนั้น ยังมีแบบประเมินไม่ครบทั้งสองใบกี่คน */
  evaluationsMissing: number;
}

const isOpen = (s: CalendarStatus): boolean => s === 'open' || s === 'late';

/* ── ตัวนับ 5 กอง ──────────────────────────────────────────────────
 *
 * ⛔ **ไม่กรองด้วยภาคเรียนโดยตั้งใจ** — คำร้องที่ค้างมาจากภาคที่แล้วก็ยังเป็นงานที่
 *    ต้องมีคนทำ การซ่อนมันเพราะ "คนละภาค" คือการทำให้งานหายไปจากสายตาถาวร
 *    (ตัวที่ผูกกับภาคเรียนคือ "ฤดูกาล" ไม่ใช่ "กองงาน")
 */
async function loadTiles(today: string): Promise<Tiles> {
  const res = await query(
    `SELECT
       -- 1. คำร้องรอออกเลขหนังสือ · เลยกำหนด = ค้างเกิน 7 วัน
       --    ⛔ created_at เป็น NULL ได้ (แถวก่อน migration 030) = ไม่ทราบอายุ
       --       ต้อง **ไม่นับ** เป็นเลยกำหนด ไม่ใช่เดาว่าเก่า
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_request')                      AS request_count,
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_request'
           AND created_at IS NOT NULL
           AND created_at < ($1::date - 7))                             AS request_overdue,
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_request' AND submitted_late)   AS request_late,

       -- 2. แบบตอบรับรอตรวจ · เลยกำหนด = เลย acceptance_due_date (๑๕ วันทำการ)
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_approval')                     AS acceptance_count,
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_approval'
           AND acceptance_due_date IS NOT NULL
           AND acceptance_due_date < $1::date)                          AS acceptance_overdue,

       -- 3. หนังสือส่งตัวรอออกเลข · เลยกำหนด = นักศึกษาถึงวันเริ่มงานแล้วแต่ยังไม่มีหนังสือ
       --    (ไม่มีเส้นตายของตัวเองบนปฏิทิน — วันเริ่มงานคือเส้นตายจริงของใบนี้)
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'accepted' AND dispatch_document_no IS NULL)     AS dispatch_count,
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'accepted' AND dispatch_document_no IS NULL
           AND start_date IS NOT NULL AND start_date <= $1::date)        AS dispatch_overdue,

       -- 5. ร่างนัดหมายนิเทศรอส่ง · เลยกำหนด = วันนัดผ่านไปแล้วแต่ยังไม่ได้ส่งออก
       (SELECT COUNT(*)::int FROM supervision_appointments
         WHERE status = 'draft')                                        AS appointment_count,
       (SELECT COUNT(*)::int FROM supervision_appointments
         WHERE status = 'draft'
           AND appointment_date IS NOT NULL
           AND appointment_date < $1::date)                             AS appointment_overdue,

       -- 6. ค้างที่คณบดี — อ่านอย่างเดียว ไม่ใช่งานของเจ้าหน้าที่ จึงไม่มี "เลยกำหนด"
       (SELECT COUNT(*)::int FROM official_documents
         WHERE status = 'pending_sign')                                 AS dean_count,
       (SELECT MIN(created_at)::date FROM official_documents
         WHERE status = 'pending_sign')                                 AS dean_oldest`,
    [today]
  );
  const r = res.rows[0];

  const deanDays =
    r.dean_oldest === null || r.dean_oldest === undefined
      ? null
      : daysBetween(String(r.dean_oldest), today);

  return {
    request: {
      count: r.request_count,
      overdue: r.request_overdue,
      note: r.request_late > 0 ? `${r.request_late} ใบยื่นช่วงผ่อนผัน` : null,
    },
    acceptance: { count: r.acceptance_count, overdue: r.acceptance_overdue, note: null },
    dispatch: {
      count: r.dispatch_count,
      overdue: r.dispatch_overdue,
      note:
        r.dispatch_overdue > 0
          ? `${r.dispatch_overdue} คนถึงวันเริ่มงานแล้วแต่ยังไม่ได้รับหนังสือส่งตัว`
          : null,
    },
    appointment: { count: r.appointment_count, overdue: r.appointment_overdue, note: null },
    dean: {
      count: r.dean_count,
      overdue: 0,
      // ⛔ ไม่มี created_at (แถวก่อน migration 030) = บอกตรง ๆ ว่าไม่ทราบ
      //    ห้ามเขียน "ค้างมา 0 วัน" ซึ่งอ่านว่าเพิ่งเข้าคิววันนี้
      note:
        r.dean_count === 0
          ? null
          : deanDays === null
            ? 'ไม่ทราบว่าค้างมานานเท่าไร (ใบเก่าที่ไม่มีวันที่ออก)'
            : `ค้างมา ${deanDays} วัน`,
    },
  };
}

/* ── ช่วงเวลาจากปฏิทิน ─────────────────────────────────────────────── */

async function loadCalendarWindows(
  semesterId: number | null,
  today: string
): Promise<Windows> {
  const empty: Window = { state: 'not_configured', start: null, end: null, late_end: null };
  if (semesterId === null) {
    return {
      intent_submission: empty,
      acceptance_form: empty,
      final_report: empty,
      coop_period: empty,
      warnings: [],
    };
  }

  const events = await CoopCalendarModel.listBySemester(semesterId);
  const byKey = new Map(events.filter((e) => e.activity_key).map((e) => [e.activity_key!, e]));

  const read = (key: CoopActivityKey): Window => {
    const row = byKey.get(key);
    return {
      state: calendarStatus(
        today,
        row?.start_date ?? null,
        row?.end_date ?? null,
        row?.late_end_date ?? null
      ),
      start: row?.start_date ?? null,
      end: row?.end_date ?? null,
      late_end: row?.late_end_date ?? null,
    };
  };

  // ช่วงปฏิบัติงานประกอบจากหมุดสองอัน ทั้งคู่เป็นชนิด single (start = end)
  const startPin = byKey.get('coop_start');
  const endPin = byKey.get('coop_end');
  const periodStart = startPin?.start_date ?? startPin?.end_date ?? null;
  const periodEnd = endPin?.end_date ?? endPin?.start_date ?? null;

  /**
   * ⛔ แถบเตือน fail-open — ด่านปฏิทินปล่อยผ่านเมื่อไม่มีวันปิด **โดยตั้งใจ**
   *    (ตรงข้ามกับ SEC-06 ซึ่งเป็นเรื่องสิทธิ์และต้อง fail closed)
   *    แต่ fail-open ต้องไม่เงียบ — หน้าจอเจ้าหน้าที่คือที่เดียวที่บอกได้ว่า
   *    ตอนนี้ขั้นไหน "ยังไม่ล็อกใครเลย" · ⛔ ข้อความห้ามเขียนว่าผิดพลาดหรือระบบไม่พร้อม
   */
  const warnings = COOP_ACTIVITIES.filter((a) => a.locks && !a.derivedFrom)
    .filter((a) => !byKey.get(a.key)?.end_date)
    .map((a) => ({ activity_key: a.key as string | null, label: a.label }));

  return {
    intent_submission: read('intent_submission'),
    acceptance_form: read('acceptance_form'),
    final_report: read('final_report'),
    coop_period: {
      state: calendarStatus(today, periodStart, periodEnd, null),
      start: periodStart,
      end: periodEnd,
      late_end: null,
    },
    warnings,
  };
}

/* ── ตัวเลขที่การ์ดใบใหญ่ใช้ ────────────────────────────────────────── */

async function loadSeasonExtras(
  today: string,
  semesterId: number | null
): Promise<SeasonExtras> {
  const res = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_request' AND submitted_late) AS late_requests,
       -- "ออกฝึกแล้ว" = ใบที่ตอบรับแล้วและถึงวันเริ่มงานแล้ว ในภาคที่เปิดอยู่
       (SELECT COUNT(*)::int FROM intent_forms i
         WHERE i.status = 'accepted' AND i.semester_id = $2::int
           AND i.start_date IS NOT NULL AND i.start_date <= $1::date) AS students_on_placement,
       -- ⛔ "ยังไม่ครบ" = ยังไม่มีครบ **ทั้งสองใบ** (สหกิจ 15 ตัดเกรด + สหกิจ 16 ประเมินรายงาน)
       --    ห้ามอ่านว่า "ยังไม่ผ่าน" — ระบบไม่รู้ว่าใครผ่าน อาจารย์เป็นผู้ตัดเกรด
       (SELECT COUNT(*)::int FROM intent_forms i
         WHERE i.status = 'accepted' AND i.semester_id = $2::int
           AND i.start_date IS NOT NULL AND i.start_date <= $1::date
           AND (SELECT COUNT(DISTINCT e.form_code) FROM final_evaluations e
                 WHERE e.student_id = i.student_id) < 2) AS evaluations_missing`,
    [today, semesterId]
  );
  const r = res.rows[0];
  return {
    lateRequests: r.late_requests,
    studentsOnPlacement: r.students_on_placement,
    evaluationsMissing: r.evaluations_missing,
  };
}

/**
 * ตัวเลขบนการ์ดใบใหญ่ — ความหมายของแต่ละช่องเปลี่ยนตามฤดูกาล
 * (ยึดตามการ์ดทั้ง 6 ใบใน `.design/staff/StaffHomeSeasons.dc.html`)
 */
function seasonDetail(
  season: Season,
  today: string,
  tiles: Tiles,
  windows: Windows,
  extra: SeasonExtras
): { headline_count: number; deadline: string | null; days_left: number | null; secondary_count: number } {
  const pack = (
    headline: number,
    deadline: string | null,
    secondary: number
  ): { headline_count: number; deadline: string | null; days_left: number | null; secondary_count: number } => ({
    headline_count: headline,
    deadline,
    // ⛔ นับให้เสร็จฝั่งเซิร์ฟเวอร์ หน้าจอห้ามเทียบวันเอง (นาฬิกาเบราว์เซอร์เชื่อไม่ได้)
    days_left: deadline === null ? null : daysBetween(today, deadline),
    secondary_count: secondary,
  });

  switch (season) {
    case 'overdue':
      return pack(
        tiles.request.overdue + tiles.acceptance.overdue,
        null,
        0
      );
    case 'request':
      return pack(
        tiles.request.count,
        windows.intent_submission.state === 'late'
          ? windows.intent_submission.late_end
          : windows.intent_submission.end,
        extra.lateRequests
      );
    case 'acceptance':
      return pack(
        tiles.acceptance.count,
        windows.acceptance_form.state === 'late'
          ? windows.acceptance_form.late_end
          : windows.acceptance_form.end,
        tiles.dispatch.count
      );
    case 'supervision':
      return pack(tiles.appointment.count, windows.coop_period.end, extra.studentsOnPlacement);
    case 'evaluation':
      return pack(extra.evaluationsMissing, windows.final_report.end, extra.studentsOnPlacement);
    default:
      return pack(0, null, 0);
  }
}

function timelineEntry(key: CoopActivityKey, label: string, w: Window) {
  return { key, label, state: w.state, start: w.start, end: w.end, late_end: w.late_end };
}

/**
 * จำนวนวันระหว่างสองวัน (`to - from`) — รับเฉพาะ `YYYY-MM-DD`
 *
 * ⛔ ใช้ `Date.UTC` ไม่ใช่ `new Date(string)` — ตัวหลังตีความตามโซนของเครื่อง
 *    แล้วเลื่อนไปหนึ่งวัน (บทเรียนเดิม: `2020-01-01` ถูกเก็บเป็น `2019-12-31`)
 *    ตรงนี้เป็นการ **ลบวันสองวันที่มาจาก Postgres ทั้งคู่** ไม่ใช่การอ่านนาฬิกา Node
 */
function daysBetween(from: string, to: string): number {
  const toUtc = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}
