import { Request, Response } from 'express';
import { query } from '../config/database';
import { CoopCalendarModel } from '../models/coopCalendar';
import { sendUnexpectedError } from '../utils/httpError';
import { semesterLabel } from '../utils/semesterLabel';

/**
 * แดชบอร์ด "นักศึกษาตอนนี้" ของเจ้าหน้าที่ — นักศึกษาแต่ละคนอยู่ขั้นไหน · ใครต้องขยับ · ค้างนานแค่ไหน
 *
 * Route: GET /api/staff/pipeline?semester_id=&major_id=
 * Access: staff (ทั้งคณะ) — ด่านอยู่ที่ `routes/staff.ts`
 *
 * ⛔ **ขั้นของนักศึกษาตัดสินที่นี่ที่เดียว** (`deriveStage`) ห้ามให้หน้าจอเดาเอง — ใช้ข้อมูลเดียวกับที่เซิร์ฟเวอร์ใช้
 *    ตัดสินในที่อื่น (สถานะใบ · หนังสือที่คณบดีลงนาม · ส่งเมลหาบริษัท · `mentor_id` · หนังสือส่งตัว · ที่พัก)
 * ⛔ **ตัวหาร = รุ่นของภาคเรียน** (`semester_cohort`) ∪ คนที่มีใบคำร้องในภาคนั้น — ไม่ใช่ทุกคนใน `students`
 *    (ตารางนั้นสะสมข้ามปี) · รุ่นว่าง = บอกตรง ๆ ให้ไปนำเข้ารายชื่อ ไม่แต่งตัวเลข
 * ⛔ **อายุที่ค้าง** มีเฉพาะขั้นที่ระบบเก็บเวลาไว้จริง · ขั้นที่ไม่มีเวลา = `null` ("ไม่ทราบ") ห้ามเดา
 *    · เวลาเข้าขั้นมาจาก `intent_stage_events` (migration 049 · เขียนที่จุดเปลี่ยนสถานะ) · ใบเก่าที่เกิดก่อนมีตารางนี้
 *      ขาดบางขั้น → "ไม่ทราบ" · "ระหว่างฝึก/หลังฝึก" นับจากวันเริ่ม/วันสิ้นสุดการปฏิบัติงานของใบ
 *    · "รอเจ้าหน้าที่รับคำร้อง" ถ้าไม่มีเวลาอัปโหลดกระดาษ (ใบเก่า) ถอยไปนับจากวันที่สร้างใบ
 * ⛔ ไม่เปิดเลขบัตร/เกรด/ข้อมูล SEC-12 — มีแค่ชื่อ รหัส สาขา บริษัท ขั้น อายุ
 */

export type StageKey =
  | 'not_registered'
  | 'no_intent'
  | 'await_upload'
  | 'await_officer_request'
  | 'await_dean'
  | 'await_send'
  | 'await_company'
  | 'await_mentor'
  | 'await_officer_accept'
  | 'accepted_prep'
  | 'on_placement'
  | 'post_placement'
  | 'done'
  | 'exit';

/** ใครต้องเป็นคนขยับ — `clear` = ไม่มีใครต้องทำอะไรตอนนี้ */
export type Holder = 'student' | 'staff' | 'company' | 'dean' | 'clear';

/**
 * ลำดับ = ลำดับที่แสดงบนจอ · `label` เป็นถ้อยคำที่หน้าจอใช้ตรง ๆ (ที่เดียว)
 * `short` = ชื่อย่อสำหรับแถบท่อ 14 ช่องท้ายหน้าแรกเจ้าหน้าที่ (ช่องแคบ ใส่ชื่อเต็มไม่พอ) — คนอ่านคือเจ้าหน้าที่ จึงเขียนว่า "รอคุณ…"
 */
export const STAGES: { key: StageKey; label: string; short: string }[] = [
  { key: 'not_registered', label: 'ยังไม่เข้าระบบ (ยังไม่ตั้งโปรไฟล์)', short: 'ยังไม่เข้าระบบ' },
  { key: 'no_intent', label: 'ยังไม่ยื่นคำร้อง', short: 'ยังไม่ยื่น' },
  { key: 'await_upload', label: 'ยื่นแล้ว รออัปโหลดกระดาษที่ลงนาม', short: 'รออัปโหลดกระดาษ' },
  { key: 'await_officer_request', label: 'รอเจ้าหน้าที่รับคำร้อง', short: 'รอคุณรับคำร้อง' },
  { key: 'await_dean', label: 'รอคณบดีลงนามหนังสือ', short: 'รอคณบดี' },
  { key: 'await_send', label: 'รอนักศึกษาส่งหนังสือให้บริษัท', short: 'รอส่งหนังสือ' },
  { key: 'await_company', label: 'รอบริษัทตอบรับ', short: 'รอบริษัทตอบ' },
  { key: 'await_mentor', label: 'รอนักศึกษาระบุพี่เลี้ยง', short: 'รอระบุพี่เลี้ยง' },
  { key: 'await_officer_accept', label: 'รอเจ้าหน้าที่ยืนยันแบบตอบรับ', short: 'รอคุณยืนยันตอบรับ' },
  { key: 'accepted_prep', label: 'ตอบรับแล้ว · เตรียมเอกสารก่อนฝึก', short: 'เตรียมเอกสาร' },
  { key: 'on_placement', label: 'ระหว่างปฏิบัติงานและนิเทศ', short: 'ระหว่างฝึก' },
  { key: 'post_placement', label: 'หลังฝึก · ส่งรายงาน / ประเมิน', short: 'หลังฝึก' },
  { key: 'done', label: 'ครบ · รายงานอนุมัติและประเมินส่งครบ', short: 'ครบ' },
  { key: 'exit', label: 'ออกจากท่อ · ต้องหาที่ฝึกใหม่', short: 'ต้องหาที่ใหม่' },
];

interface Row {
  student_code: string;
  student_id: number | null;
  first_name: string | null;
  last_name: string | null;
  major_id: number | null;
  major_name_th: string | null;
  advisor_id: number | null;
  supervisor_id: number | null;
  form_id: number | null;
  status: string | null;
  company_name: string | null;
  mentor_id: number | null;
  reject_reason: string | null;
  dispatch_document_no: string | null;
  start_date: string | null;
  end_date: string | null;
  company_mail_sent_at: string | null;
  cover_status: string | null;
  has_accommodation: boolean;
  final_report_approved: boolean;
  mentor_evaluations: number;
  mentor_logged_in: boolean;
  age_created: number | null;
  age_doc: number | null;
  age_signed: number | null;
  age_mail: number | null;
  age_upload: number | null;
  age_request: number | null;
  age_submitted: number | null;
  age_mentor: number | null;
  age_accepted: number | null;
  age_start: number | null;
  age_end: number | null;
}

interface Derived {
  stage: StageKey;
  holder: Holder;
  age: number | null;
}

/**
 * ขั้น · คนถือเรื่อง · อายุที่ค้าง ของนักศึกษาหนึ่งคน
 * `today` เป็นสตริง `YYYY-MM-DD` ที่มาจาก Postgres (เทียบเป็นสตริงล้วน ห้าม new Date())
 */
export function deriveStage(r: Row, today: string): Derived {
  if (r.student_id === null) return { stage: 'not_registered', holder: 'student', age: null };
  if (r.form_id === null) return { stage: 'no_intent', holder: 'student', age: null };

  switch (r.status) {
    case 'rejected':
    case 'company_rejected':
      return { stage: 'exit', holder: 'student', age: null };
    case 'pending_advisor':
      return { stage: 'await_upload', holder: 'student', age: r.age_upload ?? r.age_created };
    case 'pending_officer_request':
      return { stage: 'await_officer_request', holder: 'staff', age: r.age_request ?? r.age_created };
    case 'approved_by_dept_head':
      if (r.cover_status !== 'signed') return { stage: 'await_dean', holder: 'dean', age: r.age_doc };
      // ส่งเมลแล้วแต่เจ้าหน้าที่ตีกลับแบบตอบรับ (`reject_reason`) = นักศึกษาต้องส่งลิงก์ใหม่
      if (r.company_mail_sent_at === null || r.reject_reason) {
        return { stage: 'await_send', holder: 'student', age: r.age_signed };
      }
      return { stage: 'await_company', holder: 'company', age: r.age_mail };
    case 'pending_officer_approval':
      // บริษัทตอบทางลิงก์ไม่ได้ระบุพี่เลี้ยง — นักศึกษาต้องระบุก่อนเจ้าหน้าที่กดรับได้
      // รอเจ้าหน้าที่ = นับจากเหตุการณ์ล่าสุดของสองอย่าง (ได้แบบตอบรับ · นักศึกษาระบุพี่เลี้ยง) = อายุที่น้อยกว่า
      return r.mentor_id === null
        ? { stage: 'await_mentor', holder: 'student', age: r.age_submitted }
        : { stage: 'await_officer_accept', holder: 'staff', age: minKnown(r.age_submitted, r.age_mentor) };
    case 'accepted': {
      const finished = r.final_report_approved && r.mentor_evaluations >= 2;
      if (finished) return { stage: 'done', holder: 'clear', age: null };
      if (r.end_date !== null && r.end_date < today) {
        // หลังฝึก: ยังขาดผลประเมินพี่เลี้ยง = บริษัท/พี่เลี้ยงถือ · ไม่งั้นรอเล่มรายงาน = นักศึกษา
        return { stage: 'post_placement', holder: r.mentor_evaluations < 2 ? 'company' : 'student', age: r.age_end };
      }
      if (r.start_date !== null && r.start_date <= today) {
        return { stage: 'on_placement', holder: 'clear', age: r.age_start };
      }
      if (r.dispatch_document_no === null) return { stage: 'accepted_prep', holder: 'staff', age: r.age_accepted };
      if (!r.has_accommodation) return { stage: 'accepted_prep', holder: 'student', age: r.age_accepted };
      return { stage: 'accepted_prep', holder: 'clear', age: r.age_accepted };
    }
    default:
      // สถานะที่ไม่รู้จัก = ไม่แต่งเรื่อง · นับเป็นขั้นแรกที่ยังไม่ยื่นไม่ได้ จึงถือว่าอยู่กับเจ้าหน้าที่ให้ตรวจ
      return { stage: 'await_officer_request', holder: 'staff', age: null };
  }
}

/** อายุที่น้อยกว่าของสองค่าที่รู้ · ไม่รู้สักค่า = null (ห้ามเดา) */
const minKnown = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.min(a, b);

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const ROW_SQL = `
  WITH members AS (
    SELECT student_code FROM semester_cohort WHERE semester_id = $1
    UNION
    SELECT s.student_code FROM intent_forms i JOIN students s ON s.student_id = i.student_id WHERE i.semester_id = $1
  )
  SELECT m.student_code,
         s.student_id, s.first_name, s.last_name, s.major_id, mj.major_name_th,
         s.advisor_id, s.supervisor_id,
         i.form_id, i.status, i.mentor_id, i.reject_reason, i.dispatch_document_no,
         i.start_date::text AS start_date, i.end_date::text AS end_date,
         i.company_mail_sent_at, c.name_th AS company_name,
         doc.status AS cover_status,
         (acc.student_id IS NOT NULL) AS has_accommodation,
         COALESCE(fr.ok, FALSE) AS final_report_approved,
         COALESCE(ev.n, 0)::int AS mentor_evaluations,
         COALESCE(ml.ok, FALSE) AS mentor_logged_in,
         -- อายุเป็นวันปฏิทินเวลาไทย · NULL = ระบบไม่เก็บเวลาของขั้นนั้น (ห้ามเดา)
         ($2::date - (i.created_at AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_created,
         ($2::date - (doc.created_at AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_doc,
         ($2::date - doc.dean_signature_date::date)::int AS age_signed,
         ($2::date - (i.company_mail_sent_at AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_mail,
         -- เวลาเข้าขั้นจาก intent_stage_events (migration 049) · ไม่มีแถว = NULL = ไม่ทราบ
         ($2::date - (se.t_upload AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_upload,
         ($2::date - (se.t_request AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_request,
         ($2::date - (se.t_submitted AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_submitted,
         ($2::date - (se.t_mentor AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_mentor,
         ($2::date - (se.t_accepted AT TIME ZONE 'Asia/Bangkok')::date)::int AS age_accepted,
         ($2::date - i.start_date)::int AS age_start,
         ($2::date - i.end_date)::int AS age_end
    FROM members m
    LEFT JOIN students s ON s.student_code = m.student_code
    LEFT JOIN master_major mj ON mj.major_id = s.major_id
    LEFT JOIN LATERAL (
      SELECT x.form_id, x.status, x.company_id, x.mentor_id, x.reject_reason, x.dispatch_document_no,
             x.start_date, x.end_date, x.company_mail_sent_at, x.created_at, x.officer_document_no
        FROM intent_forms x
       WHERE x.student_id = s.student_id AND x.semester_id = $1
       -- ใบที่ยังเดินอยู่มาก่อนใบที่ถูกปิด · ถ้ามีแต่ใบที่ปิด = ใช้ใบล่าสุด (ขั้น "ออกจากท่อ")
       ORDER BY (x.status IN ('rejected', 'company_rejected', 'superseded')) ASC, x.form_id DESC
       LIMIT 1
    ) i ON TRUE
    LEFT JOIN companies c ON c.company_id = i.company_id
    -- LATERAL เดียวกับที่ SEC-13/14 ใช้ (เทียบเลขที่หนังสือกับ officer_document_no) — ห้ามอ่านจากที่อื่น
    LEFT JOIN LATERAL (
      SELECT d.status, d.created_at, d.dean_signature_date
        FROM official_documents d
       WHERE d.student_id = s.student_id AND d.company_id = i.company_id
         AND d.type = 'cover_letter'
         AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
       ORDER BY d.doc_id DESC
       LIMIT 1
    ) doc ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        MAX(e.entered_at) FILTER (WHERE e.stage IN ('form_created', 'request_returned')) AS t_upload,
        MAX(e.entered_at) FILTER (WHERE e.stage = 'request_uploaded') AS t_request,
        MAX(e.entered_at) FILTER (WHERE e.stage = 'acceptance_submitted') AS t_submitted,
        MAX(e.entered_at) FILTER (WHERE e.stage = 'mentor_set') AS t_mentor,
        MAX(e.entered_at) FILTER (WHERE e.stage = 'accepted') AS t_accepted
        FROM intent_stage_events e WHERE e.form_id = i.form_id
    ) se ON TRUE
    LEFT JOIN accommodations acc ON acc.student_id = s.student_id
    LEFT JOIN LATERAL (
      SELECT TRUE AS ok FROM final_reports f
       WHERE f.student_id = s.student_id AND f.reviewer_kind = 'advisor' AND f.status = 'approved' LIMIT 1
    ) fr ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT e.form_code) AS n FROM final_evaluations e
       WHERE e.student_id = s.student_id AND e.evaluator_role = 'mentor'
    ) ev ON TRUE
    LEFT JOIN LATERAL (
      SELECT TRUE AS ok FROM mentor_login_tokens t
       WHERE t.user_id = i.mentor_id AND t.used_at IS NOT NULL LIMIT 1
    ) ml ON TRUE
   WHERE ($3::int IS NULL OR s.major_id = $3)
`;

export class StaffPipelineController {
  static async getPipeline(req: Request, res: Response): Promise<void> {
    try {
      const rawSemester = typeof req.query.semester_id === 'string' && req.query.semester_id ? Number(req.query.semester_id) : null;
      const rawMajor = typeof req.query.major_id === 'string' && req.query.major_id ? Number(req.query.major_id) : null;
      if ((rawSemester !== null && !Number.isInteger(rawSemester)) || (rawMajor !== null && !Number.isInteger(rawMajor))) {
        res.status(400).json({ message: 'รูปแบบภาคเรียนหรือสาขาไม่ถูกต้อง' });
        return;
      }

      const today = await CoopCalendarModel.today();
      const semesters = (
        await query(
          `SELECT semester_id, academic_year, semester, is_active FROM coop_semesters
            ORDER BY academic_year DESC, semester DESC`
        )
      ).rows as { semester_id: number; academic_year: number; semester: string; is_active: boolean }[];

      // ไม่ระบุภาค = ภาคที่เปิดใช้งานอยู่ (ไม่มี = ภาคล่าสุด) · ระบุภาคที่ไม่มี = 404
      const semester =
        rawSemester !== null
          ? semesters.find((s) => s.semester_id === rawSemester)
          : (semesters.find((s) => s.is_active) ?? semesters[0]);
      if (rawSemester !== null && !semester) {
        res.status(404).json({ message: 'ไม่พบภาคเรียนที่ระบุ' });
        return;
      }

      const majors = (
        await query(`SELECT major_id, major_name_th FROM master_major ORDER BY major_name_th`)
      ).rows as { major_id: number; major_name_th: string }[];

      const semesterPayload = semester
        ? {
            semester_id: semester.semester_id,
            label: semesterLabel(semester.semester, semester.academic_year),
            is_active: semester.is_active,
          }
        : null;
      const semesterList = semesters.map((s) => ({
        semester_id: s.semester_id,
        label: semesterLabel(s.semester, s.academic_year),
        is_active: s.is_active,
      }));

      const base = { today, semester: semesterPayload, semesters: semesterList, majors };

      if (!semester) {
        res.status(200).json({ ...base, cohort_total: 0, stages: [], holders: [], kpis: null, gaps: [], longest: [], unknown_age: 0 });
        return;
      }

      const rows = (await query(ROW_SQL, [semester.semester_id, today, rawMajor])).rows as Row[];
      const derived = rows.map((r) => ({ r, d: deriveStage(r, today) }));

      const stages = STAGES.map(({ key, label, short }) => {
        const members = derived.filter((x) => x.d.stage === key);
        const ages = members.map((x) => x.d.age).filter((a): a is number => a !== null && a >= 0);
        // ใครต้องขยับในขั้นนี้ — ขั้นเดียวอาจมีหลายคนถือ (เช่น ตอบรับแล้ว: ของเจ้าหน้าที่ + ของนักศึกษา)
        const byHolder: Record<Holder, number> = { student: 0, staff: 0, company: 0, dean: 0, clear: 0 };
        for (const x of members) byHolder[x.d.holder] += 1;
        return {
          key,
          label,
          short,
          count: members.length,
          holders: byHolder,
          // มัธยฐานของคนที่ "รู้อายุ" เท่านั้น · ไม่มีใครรู้ = null (หน้าจอเขียน "ไม่ทราบ")
          median_age_days: median(ages),
          known_age: ages.length,
        };
      });

      const holders = (['student', 'staff', 'company', 'dean', 'clear'] as Holder[]).map((h) => ({
        holder: h,
        count: derived.filter((x) => x.d.holder === h && x.d.stage !== 'done').length,
      }));

      const placed = derived.filter((x) => x.r.status === 'accepted').length;
      const kpis = {
        total: derived.length,
        placed,
        awaiting_company: derived.filter((x) => x.d.stage === 'await_company').length,
        awaiting_company_overdue: derived.filter((x) => x.d.stage === 'await_company' && (x.d.age ?? 0) >= 10).length,
        exited: derived.filter((x) => x.d.stage === 'exit').length,
        no_intent: derived.filter((x) => x.d.stage === 'no_intent' || x.d.stage === 'not_registered').length,
      };

      const acceptedRows = derived.filter((x) => x.r.status === 'accepted');
      const gaps = [
        { key: 'no_accommodation', label: 'ตอบรับแล้วแต่ยังไม่แจ้งที่พัก (สหกิจ 06)', count: acceptedRows.filter((x) => !x.r.has_accommodation).length },
        { key: 'no_dispatch', label: 'ตอบรับแล้วแต่ยังไม่ได้ออกหนังสือส่งตัว', count: acceptedRows.filter((x) => x.r.dispatch_document_no === null).length },
        { key: 'no_faculty', label: 'ตอบรับแล้วแต่ไม่มีอาจารย์ที่ปรึกษาหรืออาจารย์นิเทศ', count: acceptedRows.filter((x) => x.r.advisor_id === null || x.r.supervisor_id === null).length },
        { key: 'mentor_never_logged_in', label: 'พี่เลี้ยงยังไม่เคยเข้าระบบด้วยลิงก์', count: acceptedRows.filter((x) => x.r.mentor_id !== null && !x.r.mentor_logged_in).length },
      ];

      // ค้างนานที่สุด — เฉพาะที่รู้อายุ และยังมีคนต้องขยับ (clear/ออกจากท่อไม่ต้องตาม)
      const ranked = derived
        .filter((x) => x.d.age !== null && x.d.holder !== 'clear' && x.d.stage !== 'exit')
        .sort((a, b) => (b.d.age ?? 0) - (a.d.age ?? 0));
      const stageLabel = new Map(STAGES.map((s) => [s.key, s.label]));
      const longest = ranked.slice(0, 15).map(({ r, d }) => ({
        form_id: r.form_id,
        student_code: r.student_code,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
        major_name_th: r.major_name_th,
        company_name: r.company_name,
        stage: d.stage,
        stage_label: stageLabel.get(d.stage) ?? d.stage,
        holder: d.holder,
        age_days: d.age,
      }));
      // คนที่ยังมีเรื่องค้างแต่ระบบไม่รู้อายุ — บอกจำนวน ไม่ซ่อน
      const unknownAge = derived.filter(
        (x) => x.d.age === null && x.d.holder !== 'clear' && x.d.stage !== 'exit' && x.d.stage !== 'not_registered' && x.d.stage !== 'no_intent'
      ).length;

      res.status(200).json({ ...base, cohort_total: derived.length, stages, holders, kpis, gaps, longest, unknown_age: unknownAge });
    } catch (error) {
      sendUnexpectedError(res, error, 'Staff pipeline error', 'ไม่สามารถโหลดแดชบอร์ดนักศึกษาตอนนี้ได้');
    }
  }
}
