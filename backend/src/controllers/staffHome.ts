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
import { semesterLabel } from '../utils/semesterLabel';
import { REQUEST_OVERDUE_DAYS, requestQueuedAtSql } from '../utils/stageEvents';

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

      const [tiles, windows, missingCoverLetters] = await Promise.all([
        loadTiles(today),
        loadCalendarWindows(semester?.semester_id ?? null, today),
        loadMissingCoverLetters(),
      ]);

      /**
       * ⛔ ลำดับนี้คือข้อ 4.2 ของสเปกเป๊ะ ๆ — **หยุดที่เงื่อนไขแรกที่เป็นจริง**
       *    “ของที่เลยกำหนด” มาก่อนทุกอย่างโดยตั้งใจ: งานตามปฏิทินมาทุกภาคเรียน
       *    แต่ของที่เลยกำหนดแล้วไม่มีใครมาเตือนอีก
       */
      const overdueTotal = tiles.request.overdue + tiles.acceptance.overdue;
      const extra = await loadSeasonExtras(today, semester?.semester_id ?? null);
      const otherSemesters = await loadOtherSemesters(today, semester?.semester_id ?? null);

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
              label: semesterLabel(semester.semester, semester.academic_year),
              is_active: semester.is_active,
            }
          : null,
        season,
        // ภาคอื่นที่ยังมีเรื่องค้าง (เฟส 1 R1-3) — การ์ดฤดูกาลผูกกับภาคที่เปิดอยู่ภาคเดียว จึงต้องมีแถวนี้แยก
        // ไม่งั้นนักศึกษาภาคเก่าที่ยังฝึก/รอประเมินหายจากหน้าแรกพอเปิดภาคใหม่ (F7)
        other_semesters: otherSemesters,
        season_detail: seasonDetail(season, today, tiles, windows, extra),
        // ใบที่รับแล้วแต่ไม่มีหนังสือเข้าคิวคณบดี — ไม่มีใครเห็นถ้าไม่ขึ้นที่นี่ (แถวแดงบนสุดของหน้าแรก)
        missing_cover_letters: missingCoverLetters,
        tiles,
        // "งานที่รอคุณ N เรื่อง" บนหัวหน้าแรก — เฉพาะ 4 กองที่เป็นงานของเจ้าหน้าที่ (ไม่รวมของที่ค้างที่คณบดี)
        work_total:
          tiles.request.count + tiles.acceptance.count + tiles.dispatch.count + tiles.appointment.count,
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
  /** รอนานสุดกี่วัน (คำร้อง · แบบตอบรับ) — null = ไม่มีของในกอง หรือไม่ทราบอายุ ห้ามให้หน้าจอนับเอง */
  oldest_days: number | null;
  /** วันที่ใกล้สุดของกอง (วันเริ่มงานของใบที่รอหนังสือส่งตัว · วันนัดของร่างนัดนิเทศ) */
  next_date: string | null;
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

interface OtherSemester {
  semester_id: number;
  label: string;
  closed: boolean;
  open_forms: number;
  on_placement: number;
  evaluations_missing: number;
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
       -- 1. คำร้องรอออกเลขหนังสือ · เลยกำหนด = รอเจ้าหน้าที่เกิน 7 วัน
       --    นับจาก **วันที่อัปโหลดกระดาษล่าสุด** ไม่ใช่วันที่กดยื่น — นักศึกษาเดินเรื่องกระดาษอยู่หลายวัน
       --    ก่อนอัปโหลด ช่วงนั้นไม่ใช่งานค้างของเจ้าหน้าที่ (ที่มาเดียวกับ GET /intents และ staffPipeline)
       --    ⛔ ไม่มีทั้งเหตุการณ์อัปโหลดและ created_at (แถวก่อน migration 030) = ไม่ทราบอายุ
       --       ต้อง **ไม่นับ** เป็นเลยกำหนด ไม่ใช่เดาว่าเก่า (NULL > 7 ไม่เป็นจริง)
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_request')                      AS request_count,
       (SELECT COUNT(*)::int FROM intent_forms i
         WHERE i.status = 'pending_officer_request'
           AND ($1::date - (${requestQueuedAtSql('i')} AT TIME ZONE 'Asia/Bangkok')::date)
               > ${REQUEST_OVERDUE_DAYS})                               AS request_overdue,
       (SELECT MAX($1::date - (${requestQueuedAtSql('i')} AT TIME ZONE 'Asia/Bangkok')::date)::int
          FROM intent_forms i
         WHERE i.status = 'pending_officer_request')                    AS request_oldest_days,
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_request' AND submitted_late)   AS request_late,

       -- 2. แบบตอบรับรอตรวจ · เลยกำหนด = เลย acceptance_due_date (๑๕ วันทำการ)
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_approval')                     AS acceptance_count,
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'pending_officer_approval'
           AND acceptance_due_date IS NOT NULL
           AND acceptance_due_date < $1::date)                          AS acceptance_overdue,
       -- รอเจ้าหน้าที่ตรวจนานสุดกี่วัน = นับจากได้แบบตอบรับครั้งล่าสุดของใบ · ไม่มีเหตุการณ์ (ใบเก่า) = ไม่ทราบ
       (SELECT MAX($1::date - ((SELECT MAX(e.entered_at) FROM intent_stage_events e
                                 WHERE e.form_id = i.form_id AND e.stage = 'acceptance_submitted')
                               AT TIME ZONE 'Asia/Bangkok')::date)::int
          FROM intent_forms i
         WHERE i.status = 'pending_officer_approval')                   AS acceptance_oldest_days,

       -- 3. หนังสือส่งตัวรอออกเลข · เลยกำหนด = นักศึกษาถึงวันเริ่มงานแล้วแต่ยังไม่มีหนังสือ
       --    (ไม่มีเส้นตายของตัวเองบนปฏิทิน — วันเริ่มงานคือเส้นตายจริงของใบนี้)
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'accepted' AND dispatch_document_no IS NULL)     AS dispatch_count,
       (SELECT COUNT(*)::int FROM intent_forms
         WHERE status = 'accepted' AND dispatch_document_no IS NULL
           AND start_date IS NOT NULL AND start_date <= $1::date)        AS dispatch_overdue,
       (SELECT MIN(start_date)::text FROM intent_forms
         WHERE status = 'accepted' AND dispatch_document_no IS NULL)     AS dispatch_next_start,

       -- 5. ร่างนัดหมายนิเทศรอส่ง · เลยกำหนด = วันนัดผ่านไปแล้วแต่ยังไม่ได้ส่งออก
       (SELECT COUNT(*)::int FROM supervision_appointments
         WHERE status = 'draft')                                        AS appointment_count,
       (SELECT COUNT(*)::int FROM supervision_appointments
         WHERE status = 'draft'
           AND appointment_date IS NOT NULL
           AND appointment_date < $1::date)                             AS appointment_overdue,
       (SELECT MIN(appointment_date)::text FROM supervision_appointments
         WHERE status = 'draft')                                        AS appointment_next_date,

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
      oldest_days: r.request_oldest_days ?? null,
      next_date: null,
    },
    acceptance: {
      count: r.acceptance_count,
      overdue: r.acceptance_overdue,
      note: null,
      oldest_days: r.acceptance_oldest_days ?? null,
      next_date: null,
    },
    dispatch: {
      count: r.dispatch_count,
      overdue: r.dispatch_overdue,
      note:
        r.dispatch_overdue > 0
          ? `${r.dispatch_overdue} คนถึงวันเริ่มงานแล้วแต่ยังไม่ได้รับหนังสือส่งตัว`
          : null,
      oldest_days: null,
      next_date: r.dispatch_next_start ?? null,
    },
    appointment: {
      count: r.appointment_count,
      overdue: r.appointment_overdue,
      note: null,
      oldest_days: null,
      next_date: r.appointment_next_date ?? null,
    },
    dean: {
      count: r.dean_count,
      overdue: 0,
      oldest_days: deanDays,
      next_date: null,
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

/**
 * คำร้องที่เจ้าหน้าที่รับแล้ว (เลขออกแล้ว บริษัทรับรองแล้ว) แต่ **ไม่มีหนังสือขอความอนุเคราะห์** จับคู่อยู่
 * — เกิดเมื่อการวาด/บันทึกหนังสือล้มหลังรับคำร้อง (ฟอนต์หาย · เขียนดิสก์ไม่ได้ · ข้อมูลหนังสือไม่ครบ)
 * ใบแบบนี้ไม่อยู่ในคิวไหนเลย: ไม่ใช่คิวเจ้าหน้าที่แล้ว และคณบดีก็ไม่มีอะไรให้ลงนาม
 *
 * ⛔ เงื่อนไขจับคู่เดียวกับ LATERAL ทั้งระบบ และเดียวกับที่ `issueCoverLetter` ใช้กันออกซ้ำ
 */
async function loadMissingCoverLetters(): Promise<
  { form_id: number; student_code: string; student_name: string | null; company_name: string; document_no: string | null }[]
> {
  const res = await query(
    `SELECT i.form_id, s.student_code,
            NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), '') AS student_name,
            c.name_th AS company_name, i.officer_document_no AS document_no
       FROM intent_forms i
       JOIN students s ON s.student_id = i.student_id
       JOIN companies c ON c.company_id = i.company_id
      WHERE i.status = 'approved_by_dept_head'
        AND NOT EXISTS (
          SELECT 1 FROM official_documents d
           WHERE d.student_id = i.student_id AND d.company_id = i.company_id
             AND d.type = 'cover_letter'
             AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
        )
      ORDER BY i.form_id`
  );
  return res.rows;
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

/**
 * ภาคที่ไม่ได้เปิดอยู่แต่ยังมีเรื่องค้าง — ใบที่ยังรอผล · นักศึกษาที่กำลังฝึก · ผลประเมินยังไม่ครบ
 *
 * ⛔ ภาคที่ไม่มีอะไรค้างไม่ต้องขึ้น (ไม่แต่งแถวว่าง) · ภาคที่ปิดแล้วแต่ยังมีของค้างต้องขึ้น — ปิดภาคไม่ใช่การเคลียร์ของ
 * ⛔ "ผลประเมินยังไม่ครบ" = ยังไม่มีครบทั้งสองใบ (สหกิจ 15 + 16) ห้ามอ่านว่า "ยังไม่ผ่าน" — เหมือนที่การ์ดฤดูกาลใช้
 */
async function loadOtherSemesters(today: string, activeId: number | null): Promise<OtherSemester[]> {
  const res = await query(
    `SELECT s.semester_id, s.academic_year, s.semester, s.closed_at,
            COUNT(*) FILTER (WHERE i.status NOT IN ('rejected', 'company_rejected', 'superseded', 'accepted'))::int AS open_forms,
            COUNT(*) FILTER (WHERE i.status = 'accepted' AND i.start_date IS NOT NULL AND i.start_date <= $1::date
                               AND (i.end_date IS NULL OR i.end_date >= $1::date))::int AS on_placement,
            COUNT(*) FILTER (WHERE i.status = 'accepted' AND i.start_date IS NOT NULL AND i.start_date <= $1::date
                               AND (SELECT COUNT(DISTINCT e.form_code) FROM final_evaluations e
                                     WHERE e.student_id = i.student_id) < 2)::int AS evaluations_missing
       FROM coop_semesters s
       JOIN intent_forms i ON i.semester_id = s.semester_id
      WHERE s.semester_id IS DISTINCT FROM $2::int
      GROUP BY s.semester_id
     HAVING COUNT(*) FILTER (WHERE i.status NOT IN ('rejected', 'company_rejected', 'superseded', 'accepted')) > 0
         OR COUNT(*) FILTER (WHERE i.status = 'accepted' AND i.start_date IS NOT NULL AND i.start_date <= $1::date
                               AND (i.end_date IS NULL OR i.end_date >= $1::date)) > 0
         OR COUNT(*) FILTER (WHERE i.status = 'accepted' AND i.start_date IS NOT NULL AND i.start_date <= $1::date
                               AND (SELECT COUNT(DISTINCT e.form_code) FROM final_evaluations e
                                     WHERE e.student_id = i.student_id) < 2) > 0
      ORDER BY s.academic_year DESC, s.semester DESC`,
    [today, activeId]
  );
  return (res.rows as (Omit<OtherSemester, 'label' | 'closed'> & { academic_year: number; semester: string; closed_at: string | null })[]).map((r) => ({
    semester_id: r.semester_id,
    label: semesterLabel(r.semester, r.academic_year),
    closed: r.closed_at !== null,
    open_forms: r.open_forms,
    on_placement: r.on_placement,
    evaluations_missing: r.evaluations_missing,
  }));
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
