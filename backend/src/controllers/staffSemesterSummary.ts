import { Request, Response } from 'express';
import { query } from '../config/database';
import { CoopCalendarModel } from '../models/coopCalendar';
import { sendUnexpectedError } from '../utils/httpError';
import { semesterLabel } from '../utils/semesterLabel';

/**
 * สรุปภาคเรียน — ตัวเลขของภาคที่เลือก เทียบกับภาคก่อนหน้า + เวลาที่ใช้ในแต่ละขั้น (เฟส 2 R2-2)
 *
 * Route: GET /api/staff/semester-summary?semester_id=
 * Access: staff
 *
 * ⛔ **คำนวณสดจากข้อมูลจริงทุกครั้ง** ไม่มีภาพนิ่ง (R2-3 ยังไม่ทำ) — ภาคเก่าไม่ถูกลบ/ไม่ถูกย้าย จึงอ่านย้อนหลังได้เสมอ
 * ⛔ "ผลประเมินครบ" = มีครบทั้งสองใบ (สหกิจ 15 + 16) **ไม่ใช่ "ผ่าน"** — ระบบไม่รู้ว่าใครผ่าน อาจารย์เป็นผู้ตัดเกรด
 * ⛔ เวลาในแต่ละขั้นมาจาก intent_stage_events เท่านั้น · ใบที่ไม่มีเวลาของสองปลายทางไม่ถูกนับ (บอกจำนวน n) — ห้ามเดา
 * ⛔ ไม่มีเกรด/เลขบัตร/ข้อมูล SEC-12 — มีแต่จำนวนนับ
 */

const TERMINAL = `'rejected', 'company_rejected', 'superseded'`;

/** ช่วงเวลาระหว่างสองเหตุการณ์ (ดูชื่อขั้นที่ utils/stageEvents.ts) · เรียงตามเส้นทางจริงของใบ */
const DURATIONS: { key: string; label: string; from: string; to: string }[] = [
  { key: 'upload', label: 'ยื่นคำร้อง → อัปโหลดกระดาษที่ลงนาม', from: 'form_created', to: 'request_uploaded' },
  { key: 'officer', label: 'อัปโหลดกระดาษ → เจ้าหน้าที่รับคำร้อง', from: 'request_uploaded', to: 'officer_approved' },
  { key: 'dean', label: 'เจ้าหน้าที่รับคำร้อง → คณบดีลงนาม', from: 'officer_approved', to: 'dean_signed' },
  { key: 'send', label: 'คณบดีลงนาม → นักศึกษาส่งหนังสือให้บริษัท', from: 'dean_signed', to: 'mail_sent' },
  { key: 'company', label: 'ส่งหนังสือ → ได้แบบตอบรับ', from: 'mail_sent', to: 'acceptance_submitted' },
  { key: 'confirm', label: 'ได้แบบตอบรับ → เจ้าหน้าที่ยืนยัน', from: 'acceptance_submitted', to: 'accepted' },
  { key: 'total', label: 'ยื่นคำร้อง → ได้ที่ฝึก (ทั้งเส้นทาง)', from: 'form_created', to: 'accepted' },
];

interface Counts {
  cohort_total: number;
  submitted: number;
  placed: number;
  exited: number;
  in_flight: number;
  late_forms: number;
  evaluations_complete: number;
  reports_approved: number;
}

const COUNTS_SQL = `
  WITH members AS (
    SELECT student_code FROM semester_cohort WHERE semester_id = $1
    UNION
    SELECT s.student_code FROM intent_forms i JOIN students s ON s.student_id = i.student_id WHERE i.semester_id = $1
  )
  SELECT
    (SELECT COUNT(*)::int FROM members) AS cohort_total,
    (SELECT COUNT(DISTINCT student_id)::int FROM intent_forms WHERE semester_id = $1) AS submitted,
    (SELECT COUNT(DISTINCT student_id)::int FROM intent_forms WHERE semester_id = $1 AND status = 'accepted') AS placed,
    (SELECT COUNT(*)::int FROM intent_forms WHERE semester_id = $1 AND status IN (${TERMINAL})) AS exited,
    (SELECT COUNT(*)::int FROM intent_forms WHERE semester_id = $1 AND status NOT IN (${TERMINAL}, 'accepted')) AS in_flight,
    (SELECT COUNT(*)::int FROM intent_forms WHERE semester_id = $1 AND submitted_late) AS late_forms,
    (SELECT COUNT(*)::int FROM intent_forms i
      WHERE i.semester_id = $1 AND i.status = 'accepted'
        AND (SELECT COUNT(DISTINCT e.form_code) FROM final_evaluations e
              WHERE e.student_id = i.student_id AND e.evaluator_role = 'mentor') >= 2) AS evaluations_complete,
    (SELECT COUNT(*)::int FROM intent_forms i
      WHERE i.semester_id = $1 AND i.status = 'accepted'
        AND EXISTS (SELECT 1 FROM final_reports r
                     WHERE r.student_id = i.student_id AND r.reviewer_kind = 'advisor' AND r.status = 'approved')) AS reports_approved`;

const DURATION_SQL = `
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (x.tb - x.ta)) / 86400.0) AS median_days,
         COUNT(*)::int AS n
    FROM (
      SELECT e.form_id,
             MIN(e.entered_at) FILTER (WHERE e.stage = $2) AS ta,
             MIN(e.entered_at) FILTER (WHERE e.stage = $3) AS tb
        FROM intent_stage_events e
        JOIN intent_forms f ON f.form_id = e.form_id
       WHERE f.semester_id = $1
       GROUP BY e.form_id
    ) x
   WHERE x.ta IS NOT NULL AND x.tb IS NOT NULL AND x.tb >= x.ta`;

async function loadCounts(semesterId: number): Promise<Counts> {
  return (await query(COUNTS_SQL, [semesterId])).rows[0] as Counts;
}

async function loadDurations(semesterId: number): Promise<{ median_days: number | null; n: number }[]> {
  const out: { median_days: number | null; n: number }[] = [];
  for (const d of DURATIONS) {
    const row = (await query(DURATION_SQL, [semesterId, d.from, d.to])).rows[0] as { median_days: string | null; n: number };
    // เก็บทศนิยม 1 ตำแหน่ง — ขั้นที่ใช้ไม่ถึงวันยังต้องเห็นเป็น 0.3 ไม่ใช่ 0
    out.push({ median_days: row.median_days === null ? null : Math.round(Number(row.median_days) * 10) / 10, n: row.n });
  }
  return out;
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

export class StaffSemesterSummaryController {
  static async getSummary(req: Request, res: Response): Promise<void> {
    try {
      const rawSemester = typeof req.query.semester_id === 'string' && req.query.semester_id ? Number(req.query.semester_id) : null;
      if (rawSemester !== null && !Number.isInteger(rawSemester)) {
        res.status(400).json({ message: 'รูปแบบภาคเรียนไม่ถูกต้อง' });
        return;
      }

      const today = await CoopCalendarModel.today();
      const semesters = (
        await query(
          `SELECT semester_id, academic_year, semester, is_active, closed_at FROM coop_semesters
            ORDER BY academic_year DESC, semester DESC`
        )
      ).rows as { semester_id: number; academic_year: number; semester: string; is_active: boolean; closed_at: string | null }[];

      const list = semesters.map((s) => ({
        semester_id: s.semester_id,
        label: semesterLabel(s.semester, s.academic_year),
        is_active: s.is_active,
        closed: s.closed_at !== null,
      }));

      // ไม่ระบุภาค = ภาคที่เปิดอยู่ (ไม่มี = ภาคล่าสุด) · ระบุภาคที่ไม่มี = 404
      const index =
        rawSemester !== null
          ? semesters.findIndex((s) => s.semester_id === rawSemester)
          : Math.max(0, semesters.findIndex((s) => s.is_active));
      if (rawSemester !== null && index < 0) {
        res.status(404).json({ message: 'ไม่พบภาคเรียนที่ระบุ' });
        return;
      }
      if (semesters.length === 0) {
        res.status(200).json({ today, semester: null, previous: null, semesters: list, metrics: [], durations: [] });
        return;
      }

      const current = semesters[index];
      // ภาคก่อนหน้า = ภาคถัดไปในลำดับใหม่→เก่า (ปี พ.ศ. แล้วภาค) · ภาคแรกสุด = ไม่มีให้เทียบ
      const prev = semesters[index + 1] ?? null;

      const [now, before] = await Promise.all([
        loadCounts(current.semester_id),
        prev ? loadCounts(prev.semester_id) : Promise.resolve(null),
      ]);
      const [durNow, durBefore] = await Promise.all([
        loadDurations(current.semester_id),
        prev ? loadDurations(prev.semester_id) : Promise.resolve(null),
      ]);

      const metric = (
        key: string,
        label: string,
        hint: string | null,
        unit: string,
        cur: number | null,
        old: number | null | undefined
      ) => ({ key, label, hint, unit, current: cur, previous: old === undefined ? null : old });

      const metrics = [
        metric('cohort_total', 'นักศึกษาในรุ่น', 'รายชื่อรุ่น รวมคนที่มีใบคำร้องในภาคนั้น', 'คน', now.cohort_total, before?.cohort_total),
        metric('submitted', 'ยื่นคำร้องแล้ว', 'นับเป็นรายคน', 'คน', now.submitted, before?.submitted),
        metric('placed', 'ได้ที่ฝึกแล้ว (ตอบรับ)', 'นับเป็นรายคน', 'คน', now.placed, before?.placed),
        metric('placement_rate', 'สัดส่วนที่ได้ที่ฝึก', 'ได้ที่ฝึก ÷ นักศึกษาในรุ่น', '%', pct(now.placed, now.cohort_total), before ? pct(before.placed, before.cohort_total) : null),
        metric('exited', 'ออกจากท่อ (บริษัทไม่รับ / ยกเลิก)', 'นับเป็นใบคำร้อง', 'ใบ', now.exited, before?.exited),
        metric('in_flight', 'ใบที่ยังรอผล', 'ยังไม่ตอบรับและยังไม่ถูกปฏิเสธ', 'ใบ', now.in_flight, before?.in_flight),
        metric('late_forms', 'ใบที่ยื่นช่วงผ่อนผัน', 'ปั๊มตอนยื่น ไม่คำนวณย้อนหลัง', 'ใบ', now.late_forms, before?.late_forms),
        metric('evaluations_complete', 'ผลประเมินพี่เลี้ยงครบ 2 ใบ', 'ครบ ไม่ใช่ "ผ่าน" — อาจารย์เป็นผู้ตัดเกรด', 'คน', now.evaluations_complete, before?.evaluations_complete),
        metric('reports_approved', 'เล่มรายงานอนุมัติแล้ว', 'อาจารย์ที่ปรึกษาอนุมัติ', 'คน', now.reports_approved, before?.reports_approved),
      ];

      const durations = DURATIONS.map((d, i) => ({
        key: d.key,
        label: d.label,
        current_median_days: durNow[i].median_days,
        current_n: durNow[i].n,
        previous_median_days: durBefore ? durBefore[i].median_days : null,
        previous_n: durBefore ? durBefore[i].n : 0,
      }));

      res.status(200).json({
        today,
        semester: { semester_id: current.semester_id, label: semesterLabel(current.semester, current.academic_year), is_active: current.is_active, closed: current.closed_at !== null },
        previous: prev ? { semester_id: prev.semester_id, label: semesterLabel(prev.semester, prev.academic_year) } : null,
        semesters: list,
        metrics,
        durations,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Staff semester summary error', 'ไม่สามารถโหลดสรุปภาคเรียนได้');
    }
  }
}
