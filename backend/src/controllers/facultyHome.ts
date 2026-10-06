import { Request, Response } from 'express';
import { query } from '../config/database';
import { CoopCalendarModel } from '../models/coopCalendar';
import { resolveMajorScope, sendAccessError } from '../utils/access';
import { sendUnexpectedError } from '../utils/httpError';

/**
 * หน้าแรกของอาจารย์ที่ปรึกษา/นิเทศ และหัวหน้าสาขาวิชา (spec-F ข้อ 3 · spec-G ข้อ 3)
 *
 * เส้นเดียวต่อบทบาท ด้วยเหตุผลเดียวกับหน้าแรกเจ้าหน้าที่ (SB8): ทุกตัวนับต้องมาจาก
 * "วันนี้" ก้อนเดียวกัน และ **นิยามของแต่ละกองอยู่ที่นี่ที่เดียว** — หน้าจอห้ามนับเอง
 * จากรายการ ไม่งั้นตัวเลขบนหน้าแรกกับบนหน้าจอของกองนั้นจะเพี้ยนคนละทาง
 *
 * ⛔ ขอบเขตผูกกับ **บทบาทของเส้นนี้** ไม่ใช่ทุกบทบาทที่บัญชีถือ — บัญชีที่เป็นทั้ง
 *    อาจารย์และเจ้าหน้าที่ต้องได้หน้าแรกของอาจารย์ที่ถูกกรองตามสาขา ไม่ใช่ทั้งคณะ
 *    (resolveMajorScope คืน null ให้ staff/dean) จึงส่งบทบาทเดียวเข้าไปเสมอ
 */

/** แถวย่อใต้กอง — ความหมายของ `detail`/`since` ขึ้นกับกอง (spec-F ข้อ 15.2) */
interface TileItem {
  ref_id: number | null;
  student_id: number;
  student_code: string;
  full_name: string;
  company_name_th: string | null;
  detail: string | null;
  since: string | null;
  days: number | null;
  visit_number?: number;
}

interface Tile {
  count: number;
  note: string | null;
  items: TileItem[];
}

const ITEMS_PER_TILE = 5;

function tile(rows: TileItem[], emptyNote: string): Tile {
  return {
    count: rows.length,
    note: rows.length === 0 ? emptyNote : null,
    items: rows.slice(0, ITEMS_PER_TILE).map((r) => ({
      ...r,
      days: r.days === null || r.days === undefined ? null : Number(r.days),
    })),
  };
}

/** ชื่อเต็มของนักศึกษา — ไม่มีชื่อให้ตกไปที่รหัส ไม่ใช่ข้อความแต่งขึ้น */
const FULL_NAME = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), ''), s.student_code)`;

export class FacultyHomeController {
  /**
   * Route: GET /api/faculty/home/advisor?view=advisor|supervisor
   * Access: advisor
   *
   * `view` เลือกฝ่าย (SB-F8 · `utils/facultyViews.ts`) — ฝ่ายที่ปรึกษาได้กองของสหกิจ 11 · เล่ม · สหกิจ 14
   * ฝ่ายนิเทศได้กองของสหกิจ 12 · 13 · นักศึกษาที่ยังไม่มีนัด · ⛔ ไม่ส่งปนกัน อาจารย์นิเทศอย่างเดียว
   * ต้องไม่เห็นกองของที่ปรึกษาที่ว่างตลอด
   */
  static async getAdvisorHome(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const view = req.query.view;
      if (view !== 'advisor' && view !== 'supervisor') {
        res.status(400).json({ message: 'ต้องระบุ view เป็น advisor หรือ supervisor' });
        return;
      }
      const me = req.user.userId;
      // SEC-06: ไม่มีโปรไฟล์บุคลากร = 403 ไม่ใช่หน้าแรกที่ไม่ถูกกรอง
      const { majorId } = await resolveMajorScope(me, ['advisor']);
      const today = await CoopCalendarModel.today();

      if (view === 'advisor') {
        const [outline, report, confirmation, paper] = await Promise.all([
          FacultyHomeController.outlineRows(me, today),
          FacultyHomeController.reportRows(me, today),
          FacultyHomeController.confirmationRows(me, today),
          // เอกสารหมายเลข 1 ในสาขาที่ยังรอลงนามบนกระดาษ — แถบข้อมูล ไม่ใช่กองงาน (SEC-04)
          query(
            `SELECT COUNT(*)::int AS n
               FROM intent_forms i JOIN students s ON s.student_id = i.student_id
              WHERE i.status = 'pending_advisor' AND s.major_id = $1`,
            [majorId]
          ),
        ]);
        res.status(200).json({
          today,
          view,
          tiles: {
            outline: tile(outline.rows, 'ไม่มีโครงร่างที่รอคุณเห็นชอบ'),
            report: tile(report.rows, 'ยังไม่มีเล่มที่ส่งเข้ามารอตรวจรับ'),
            confirmation: tile(confirmation.rows, 'ยังไม่มีนักศึกษายื่นขอ'),
          },
          paper_pending_major: paper.rows[0].n,
        });
        return;
      }

      const [reschedule, unrecorded, noAppointment] = await Promise.all([
        FacultyHomeController.rescheduleRows(me, today),
        FacultyHomeController.unrecordedRows(me, today),
        FacultyHomeController.noAppointmentRows(me),
      ]);
      res.status(200).json({
        today,
        view,
        tiles: {
          reschedule: tile(reschedule.rows, 'ไม่มีนัดที่พี่เลี้ยงขอเลื่อน'),
          unrecorded_visit: tile(unrecorded.rows, 'ไม่มีการนิเทศที่ค้างบันทึก'),
          no_appointment: tile(noAppointment.rows, 'นักศึกษาที่คุณนิเทศและได้ที่ฝึกแล้วมีนัดนิเทศทุกคน'),
        },
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Advisor home error', 'เกิดข้อผิดพลาดขณะโหลดหน้าแรกของอาจารย์');
    }
  }

  // สหกิจ 11 — ใบที่พี่เลี้ยงเห็นชอบแล้วและรออาจารย์ที่ปรึกษา (updateStatus ตรวจ advisor_id)
  private static outlineRows(me: number, today: string) {
    return query(
          `SELECT ro.outline_id AS ref_id, s.student_id, s.student_code, ${FULL_NAME} AS full_name,
                  c.name_th AS company_name_th, v.report_title AS detail,
                  (ro.updated_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date::text AS since,
                  ($2::date - (ro.updated_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date) AS days
             FROM report_outlines ro
             JOIN students s ON s.student_id = ro.student_id
             JOIN companies c ON c.company_id = ro.company_id
             LEFT JOIN LATERAL (
               SELECT report_title FROM report_outline_versions
                WHERE outline_id = ro.outline_id ORDER BY submitted_at DESC LIMIT 1
             ) v ON TRUE
            WHERE ro.status = 'pending_advisor' AND s.advisor_id = $1
            ORDER BY ro.updated_at ASC`,
          [me, today]
        );
  }

  // สหกิจ 12 — พี่เลี้ยงขอเลื่อน รออาจารย์ผู้ร่างนัดตอบ · detail = วันที่พี่เลี้ยงเสนอ
  //   ผู้ร่างนัดคืออาจารย์นิเทศ (SB-F9) และเส้นตอบรับตรวจ `a.advisor_id` = ผู้ร่าง จึงกรองด้วยคอลัมน์เดียวกัน
  private static rescheduleRows(me: number, today: string) {
    return query(
          `WITH v AS (
             SELECT appointment_id,
                    ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at, appointment_id)::int AS visit_number
               FROM supervision_appointments
           )
           SELECT a.appointment_id AS ref_id, s.student_id, s.student_code, ${FULL_NAME} AS full_name,
                  c.name_th AS company_name_th, a.proposed_reschedule_date::text AS detail,
                  (a.updated_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date::text AS since,
                  ($2::date - (a.updated_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date) AS days,
                  v.visit_number
             FROM supervision_appointments a
             JOIN v ON v.appointment_id = a.appointment_id
             JOIN students s ON s.student_id = a.student_id
             JOIN companies c ON c.company_id = a.company_id
            WHERE a.status = 'rescheduled' AND a.advisor_id = $1
            ORDER BY a.updated_at ASC`,
          [me, today]
        );
  }

  // สหกิจ 13 — นัดของฉันที่ตกลงแล้ว วันนัดผ่านไปแล้ว แต่ยังไม่มีแบบบันทึกของครั้งนั้น
  private static unrecordedRows(me: number, today: string) {
    return query(
          `WITH v AS (
             SELECT a.*,
                    ROW_NUMBER() OVER (PARTITION BY a.student_id ORDER BY a.created_at, a.appointment_id)::int AS visit_number
               FROM supervision_appointments a
           )
           SELECT v.appointment_id AS ref_id, s.student_id, s.student_code, ${FULL_NAME} AS full_name,
                  c.name_th AS company_name_th, NULL::text AS detail,
                  v.appointment_date::text AS since, ($2::date - v.appointment_date) AS days,
                  v.visit_number
             FROM v
             JOIN students s ON s.student_id = v.student_id
             JOIN companies c ON c.company_id = v.company_id
            WHERE v.advisor_id = $1
              AND v.status IN ('accepted', 'offline_agreed')
              AND v.appointment_date <= $2::date
              AND NOT EXISTS (
                SELECT 1 FROM supervision_records r
                 WHERE r.student_id = v.student_id AND r.visit_number = v.visit_number
              )
            ORDER BY v.appointment_date ASC`,
          [me, today]
        );
  }

  // เล่มฉบับสมบูรณ์ฉบับล่าสุดที่ส่งมารอตรวจรับ (ตรงกับ allow-list ของ reviewReport)
  private static reportRows(me: number, today: string) {
    return query(
          `SELECT fr.report_id AS ref_id, s.student_id, s.student_code, ${FULL_NAME} AS full_name,
                  c.name_th AS company_name_th, ('ฉบับที่ ' || fr.version) AS detail,
                  (fr.submitted_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date::text AS since,
                  ($2::date - (fr.submitted_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date) AS days
             FROM (
               SELECT DISTINCT ON (student_id) *
                 FROM final_reports
                WHERE reviewer_kind = 'advisor'
                ORDER BY student_id, version DESC
             ) fr
             JOIN students s ON s.student_id = fr.student_id
             LEFT JOIN intent_forms i ON i.student_id = s.student_id AND i.status = 'accepted'
             LEFT JOIN companies c ON c.company_id = i.company_id
            WHERE fr.status = 'submitted' AND s.advisor_id = $1
            ORDER BY fr.submitted_at ASC`,
          [me, today]
        );
  }

  // สหกิจ 14 — นักศึกษายื่นขอแล้ว รออาจารย์ที่ปรึกษาลงนาม
  private static confirmationRows(me: number, today: string) {
    return query(
          `SELECT rc.confirmation_id AS ref_id, s.student_id, s.student_code, ${FULL_NAME} AS full_name,
                  c.name_th AS company_name_th, NULL::text AS detail,
                  (rc.requested_at AT TIME ZONE 'Asia/Bangkok')::date::text AS since,
                  ($2::date - (rc.requested_at AT TIME ZONE 'Asia/Bangkok')::date) AS days
             FROM report_confirmations rc
             JOIN students s ON s.student_id = rc.student_id
             LEFT JOIN intent_forms i ON i.student_id = s.student_id AND i.status = 'accepted'
             LEFT JOIN companies c ON c.company_id = i.company_id
            WHERE rc.status = 'pending' AND s.advisor_id = $1
            ORDER BY rc.requested_at ASC`,
          [me, today]
        );
  }

  // ข้อมูลประกอบ: นักศึกษาที่ฉันนิเทศ ได้ที่ฝึกแล้วแต่ยังไม่มีนัดนิเทศเลยสักครั้ง
  private static noAppointmentRows(me: number) {
    return query(
          `SELECT DISTINCT ON (s.student_id)
                  NULL::int AS ref_id, s.student_id, s.student_code, ${FULL_NAME} AS full_name,
                  c.name_th AS company_name_th, NULL::text AS detail, NULL::text AS since, NULL::int AS days
             FROM students s
             JOIN intent_forms i ON i.student_id = s.student_id AND i.status = 'accepted'
             JOIN companies c ON c.company_id = i.company_id
            WHERE s.supervisor_id = $1
              AND NOT EXISTS (SELECT 1 FROM supervision_appointments a WHERE a.student_id = s.student_id)
            ORDER BY s.student_id, i.form_id DESC`,
          [me]
        );
  }

  /**
   * Route: GET /api/faculty/home/dept-head
   * Access: dept_head
   */
  static async getDeptHeadHome(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const { majorId } = await resolveMajorScope(req.user.userId, ['dept_head']);
      const today = await CoopCalendarModel.today();

      const [major, unassigned, pipeline, evaluation] = await Promise.all([
        query(
          `SELECT m.major_id, m.major_name_th,
                  (SELECT COUNT(*)::int FROM students WHERE major_id = m.major_id) AS students_total
             FROM master_major m WHERE m.major_id = $1`,
          [majorId]
        ),
        query(
          `SELECT s.student_id, s.student_code, ${FULL_NAME} AS full_name,
                  (s.advisor_id IS NULL) AS no_advisor, (s.supervisor_id IS NULL) AS no_supervisor
             FROM students s
            WHERE s.major_id = $1 AND (s.advisor_id IS NULL OR s.supervisor_id IS NULL)
            ORDER BY s.student_code`,
          [majorId]
        ),
        // ใบที่ยังมีชีวิตล่าสุดของแต่ละคน · นิยามกองตรงกับ spec-G ข้อ 5 (หน้า approval ใช้ชุดเดียวกัน)
        query(
          `WITH live AS (
             SELECT DISTINCT ON (i.student_id) i.status, doc.status AS cover_status
               FROM intent_forms i
               JOIN students s ON s.student_id = i.student_id
               LEFT JOIN LATERAL (
                 SELECT d.status FROM official_documents d
                  WHERE d.student_id = i.student_id AND d.company_id = i.company_id
                    AND d.type = 'cover_letter'
                    AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
                  ORDER BY d.doc_id DESC LIMIT 1
               ) doc ON TRUE
              WHERE s.major_id = $1 AND i.status NOT IN ('rejected', 'company_rejected', 'superseded')
              ORDER BY i.student_id, i.form_id DESC
           )
           SELECT COUNT(*)::int AS live_total,
                  COUNT(*) FILTER (WHERE status = 'pending_advisor')::int AS paper,
                  COUNT(*) FILTER (WHERE status IN ('pending_officer_request', 'pending_officer_approval'))::int AS staff,
                  COUNT(*) FILTER (WHERE status = 'approved_by_dept_head' AND cover_status IS DISTINCT FROM 'signed')::int AS dean,
                  COUNT(*) FILTER (WHERE status = 'approved_by_dept_head' AND cover_status = 'signed')::int AS company,
                  COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted
             FROM live`,
          [majorId]
        ),
        query(
          `WITH placed AS (
             SELECT DISTINCT s.student_id
               FROM students s JOIN intent_forms i ON i.student_id = s.student_id AND i.status = 'accepted'
              WHERE s.major_id = $1
           ), forms AS (
             SELECT p.student_id,
                    EXISTS (SELECT 1 FROM final_evaluations e WHERE e.student_id = p.student_id
                             AND e.evaluator_role = 'mentor' AND e.form_code = 'sahatkit_15') AS has15,
                    EXISTS (SELECT 1 FROM final_evaluations e WHERE e.student_id = p.student_id
                             AND e.evaluator_role = 'mentor' AND e.form_code = 'sahatkit_16') AS has16
               FROM placed p
           )
           SELECT COUNT(*)::int AS placed,
                  COUNT(*) FILTER (WHERE NOT has15)::int AS missing_15,
                  COUNT(*) FILTER (WHERE NOT has16)::int AS missing_16,
                  COUNT(*) FILTER (WHERE has15 AND has16)::int AS both_done
             FROM forms`,
          [majorId]
        ),
      ]);

      const m = major.rows[0];
      const p = pipeline.rows[0];
      const u = unassigned.rows;

      res.status(200).json({
        today,
        major: m ? { major_id: m.major_id, major_name_th: m.major_name_th } : null,
        students_total: m ? m.students_total : 0,
        unassigned: {
          students_affected: u.length,
          missing_advisor: u.filter((r) => r.no_advisor).length,
          missing_supervisor: u.filter((r) => r.no_supervisor).length,
          items: u.slice(0, ITEMS_PER_TILE).map((r) => ({
            student_id: r.student_id,
            student_code: r.student_code,
            full_name: r.full_name,
            missing: [...(r.no_advisor ? ['advisor'] : []), ...(r.no_supervisor ? ['supervisor'] : [])],
          })),
        },
        pipeline: {
          not_submitted: Math.max(0, (m ? m.students_total : 0) - p.live_total),
          paper: p.paper,
          staff: p.staff,
          dean: p.dean,
          company: p.company,
          accepted: p.accepted,
        },
        evaluation: evaluation.rows[0],
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Dept head home error', 'เกิดข้อผิดพลาดขณะโหลดหน้าแรกของหัวหน้าสาขาวิชา');
    }
  }
}
