import { Request, Response } from 'express';
import { query } from '../config/database';
import { sendSupervisionAppointmentEmail } from '../utils/email';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { sendUnexpectedError } from '../utils/httpError';
import { assertAssignedDuty, sendAccessError } from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';
import { issueMentorLoginLink, MENTOR_LINK_TTL_SYSTEM_MS } from '../utils/mentorLoginLink';
import { buildTravelRequestPdf, TRAVEL_REQUEST_MAX_ROWS } from '../utils/travelRequestPdf';

/** คู่มือกำหนดนิเทศสหกิจ 2 ครั้ง · ไม่มีสถานะยกเลิกนัด จึงไม่มีนัดที่ 3 */
const MAX_VISITS = 2;
/** นัดครั้งถัดไปร่างได้เมื่อครั้งก่อนตกลงกันแล้วเท่านั้น */
const CONFIRMED_APPOINTMENT_STATUSES = ['accepted', 'offline_agreed'];

// No fallback secret: a guessable default would let anyone forge the mentor
// response tokens minted below (and every other JWT in the system).
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not configured.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET as string;

/**
 * Verify a mentor's emailed response token against the appointment it claims.
 * Returns null when it checks out, or the {status, message} to answer with.
 *
 * Written once because two endpoints now take this token: the one that reads
 * the appointment out and the one that records the answer.
 */
function verifyResponseToken(token: unknown, appointmentId: number): { status: number; message: string } | null {
  if (!token || typeof token !== 'string') {
    return { status: 400, message: 'Missing token.' };
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    if (decoded.appointment_id !== appointmentId || decoded.role !== 'mentor_response') {
      return { status: 403, message: 'Invalid token.' };
    }
  } catch {
    return { status: 403, message: 'Token expired or invalid.' };
  }
  return null;
}

/** Today in the server's local timezone as YYYY-MM-DD, for comparing date-only input. */
function todayIsoDate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * YYYY-MM-DD ที่เป็นวันจริงในปฏิทิน — ตรวจเป็นสตริง ไม่ผ่าน `new Date()` (parse แล้ววันเพี้ยนได้หนึ่งวัน)
 * เดิมค่าเพี้ยนหลุดไปถึง Postgres แล้วกลายเป็น 500
 */
function isIsoDate(value: unknown): value is string {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

export class AppointmentController {
  /**
   * Get appointments
   * Route: GET /api/appointments
   * Access: advisor, staff
   */
  static async getAppointments(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const { roles, userId } = req.user;
      
      // visit_number = ครั้งที่นิเทศบนกระดาษ (สหกิจ 12 · บันทึก สหกิจ 13 · ใบขออนุมัติเดินทาง)
      // ⛔ นับจากนัดทั้งหมดของนักศึกษาคนนั้น ก่อนกรองตามผู้เรียก — ถ้าอาจารย์คนละคน
      //    ร่างครั้งที่ 1 กับ 2 การนับหลังกรองจะให้ทั้งคู่เป็น "ครั้งที่ 1"
      let queryStr = `
        SELECT a.*, s.first_name, s.last_name, s.student_code, c.name_th as company_name,
               v.visit_number,
               NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '') AS advisor_name,
               m.mentor_email
        FROM supervision_appointments a
        JOIN (
          SELECT appointment_id,
                 ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at, appointment_id)::int AS visit_number
            FROM supervision_appointments
        ) v ON v.appointment_id = a.appointment_id
        JOIN students s ON a.student_id = s.student_id
        JOIN companies c ON a.company_id = c.company_id
        LEFT JOIN personnel p ON p.personnel_id = a.advisor_id
        -- ปลายทางอีเมลตัวเดียวกับที่ auditSend ส่งจริง (พี่เลี้ยงบนใบที่ตอบรับแล้ว)
        -- ⛔ หน้าจอเจ้าหน้าที่ใช้ค่านี้ตัดสินว่า "ส่งได้/ส่งไม่ได้" — เดิมไม่ได้ส่งมา
        --    ทุกแถวเลยขึ้นว่าไม่มีอีเมลและกดส่งไม่ได้เลย
        LEFT JOIN LATERAL (
          SELECT u.email AS mentor_email
            FROM intent_forms i
            JOIN users u ON u.user_id = i.mentor_id
           WHERE i.student_id = a.student_id AND i.company_id = a.company_id AND i.status = 'accepted'
           ORDER BY i.form_id DESC
           LIMIT 1
        ) m ON TRUE
        WHERE 1=1
      `;
      const params: unknown[] = [];
      
      if (roles.includes('advisor')) {
        params.push(userId);
        queryStr += ` AND a.advisor_id = $1`;
      }
      // เจ้าหน้าที่เห็นทุกสถานะ — หน้าจอมีกอง "ส่งแล้ว / ขอเลื่อน / ยืนยันแล้ว" และปุ่มรับวันใหม่
      // (เดิมกรองเหลือแค่ร่าง กองอื่นจึงเป็นศูนย์ตลอด)
      
      queryStr += ' ORDER BY a.appointment_date ASC, a.created_at DESC';
      
      const result = await query(queryStr, params);
      res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Appointments Error', 'Server error');
    }
  }

  /**
   * Advisor creates draft appointment
   * Route: POST /api/appointments/draft
   * Access: advisor
   */
  static async createDraft(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const advisorId = req.user.userId;
      const { student_id, appointment_date, student_time, mentor_time, tour_requested } = req.body;

      if (!student_id || !appointment_date || !student_time || !mentor_time) {
        res.status(400).json({ message: 'กรุณาระบุวันที่ เวลาพบนักศึกษา และเวลาพบพี่เลี้ยงให้ครบ' });
        return;
      }
      const studentId = parseInt(String(student_id), 10);
      if (!Number.isInteger(studentId)) {
        res.status(400).json({ message: 'รหัสนักศึกษาไม่ถูกต้อง' });
        return;
      }
      if (!isIsoDate(appointment_date)) {
        res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง' });
        return;
      }

      // SEC-06: เดิมไม่ตรวจเลย — อาจารย์คนไหนก็ร่างนัดให้นักศึกษาคนไหนก็ได้ที่มีที่ฝึกแล้ว
      // และร่างนั้นกลายเป็นอีเมลถึงพี่เลี้ยงของบริษัทนั้นเมื่อเจ้าหน้าที่กดส่ง
      // SB-F9: สหกิจ 12 เป็นงานของอาจารย์นิเทศ — ที่ปรึกษาที่ไม่ได้นิเทศร่างไม่ได้ (จะแย่งเพดาน 2 ครั้ง)
      await assertAssignedDuty(advisorId, req.user.roles, studentId, 'supervisor');

      // Check if student has an active intent
      const intentRes = await query(
        `SELECT company_id FROM intent_forms WHERE student_id = $1 AND status = 'accepted'`,
        [studentId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'นักศึกษาคนนี้ยังไม่ได้รับการตอบรับจากสถานประกอบการ จึงยังนัดนิเทศไม่ได้' });
        return;
      }

      const existing = await query(
        `SELECT status FROM supervision_appointments WHERE student_id = $1 ORDER BY created_at, appointment_id`,
        [studentId]
      );
      if ((existing.rowCount ?? 0) >= MAX_VISITS) {
        res.status(409).json({ message: `นัดนิเทศของนักศึกษาคนนี้ครบ ${MAX_VISITS} ครั้งแล้ว` });
        return;
      }
      if (existing.rows.some((r) => !CONFIRMED_APPOINTMENT_STATUSES.includes(r.status))) {
        res.status(409).json({
          message: 'นัดนิเทศครั้งก่อนยังไม่ได้รับการยืนยัน — รอพี่เลี้ยงตอบหรือบันทึกว่าตกลงนอกระบบก่อน',
        });
        return;
      }

      const companyId = intentRes.rows[0].company_id;

      const insertRes = await query(
        `INSERT INTO supervision_appointments 
         (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, tour_requested, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft') RETURNING appointment_id`,
        [advisorId, studentId, companyId, appointment_date, student_time, mentor_time, tour_requested || false]
      );
      const appointmentId = insertRes.rows[0].appointment_id;

      writeAudit({
        action: AuditAction.APPOINTMENT_DRAFT_CREATED,
        entityType: 'supervision_appointment',
        entityId: appointmentId,
        subjectId: studentId,
        detail: { visit_number: (existing.rowCount ?? 0) + 1, appointment_date },
      }, req).catch(() => undefined);

      res.status(201).json({
        success: true,
        message: 'บันทึกร่างนัดนิเทศแล้ว รอเจ้าหน้าที่ตรวจและส่งถึงสถานประกอบการ',
        data: { appointment_id: appointmentId, visit_number: (existing.rowCount ?? 0) + 1 }
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Create Draft Appointment Error', 'An internal server error occurred.');
    }
  }

  /**
   * อาจารย์นิเทศแก้นัดที่ตัวเองร่าง — แก้ได้ทุกสถานะ แก้แล้วนัดกลับเป็นร่างเสมอ
   * Route: PUT /api/appointments/:id
   * Access: advisor (เจ้าของนัด)
   *
   * นัดที่ส่งถึงพี่เลี้ยงแล้วกลับเป็นร่าง = เจ้าหน้าที่ต้องตรวจและส่งใหม่ พี่เลี้ยงต้องตอบอีกครั้ง
   * (ลิงก์เดิมตอบไม่ได้ระหว่างเป็นร่าง — ดู `respond`)
   */
  static async updateAppointment(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const appointmentId = parseInt(req.params.id, 10);
      if (isNaN(appointmentId)) {
        res.status(400).json({ message: 'Invalid appointment ID.' });
        return;
      }

      const { appointment_date, student_time, mentor_time, tour_requested } = req.body;
      if (!appointment_date || !student_time || !mentor_time) {
        res.status(400).json({ message: 'กรุณาระบุวันที่ เวลาพบนักศึกษา และเวลาพบพี่เลี้ยงให้ครบ' });
        return;
      }
      if (!isIsoDate(appointment_date)) {
        res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง' });
        return;
      }

      // คำสั่งเดียว: ล็อกแถวเดิม อ่านสถานะ/วันเดิม แล้วเขียนค่าใหม่ — ไม่มีช่องให้คำตอบของพี่เลี้ยงแทรกกลาง
      const result = await query(
        `UPDATE supervision_appointments a
            SET appointment_date = $2, student_time = $3, mentor_time = $4, tour_requested = $5,
                status = 'draft', proposed_reschedule_date = NULL, proposed_mentor_time = NULL,
                updated_at = CURRENT_TIMESTAMP
           FROM (SELECT appointment_id, status, appointment_date::text AS appointment_date
                   FROM supervision_appointments
                  WHERE appointment_id = $1 AND advisor_id = $6
                    FOR UPDATE) old
          WHERE a.appointment_id = old.appointment_id
          RETURNING a.student_id, old.status AS previous_status, old.appointment_date AS previous_date`,
        [appointmentId, appointment_date, student_time, mentor_time, tour_requested || false, req.user.userId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบนัดหมายที่แก้ไขได้ (ไม่ใช่นัดของท่าน)' });
        return;
      }

      const previous = result.rows[0];
      const wasSent = previous.previous_status !== 'draft';

      writeAudit({
        action: AuditAction.APPOINTMENT_UPDATED,
        entityType: 'supervision_appointment',
        entityId: appointmentId,
        subjectId: previous.student_id,
        detail: {
          previous_status: previous.previous_status,
          previous_date: previous.previous_date,
          appointment_date,
        },
      }, req).catch(() => undefined);

      res.status(200).json({
        success: true,
        message: wasSent
          ? 'บันทึกการแก้ไขแล้ว นัดกลับเป็นร่าง รอเจ้าหน้าที่ตรวจและส่งถึงสถานประกอบการอีกครั้ง'
          : 'บันทึกการแก้ไขร่างนัดนิเทศแล้ว',
        data: { status: 'draft', was_sent: wasSent },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Update Appointment Error', 'An internal server error occurred.');
    }
  }

  /**
   * อาจารย์นิเทศลบร่างนัดที่ตัวเองร่าง
   * Route: DELETE /api/appointments/:id
   * Access: advisor (เจ้าของนัด)
   *
   * ลบได้เมื่อครบสามข้อ: ยังเป็นร่าง · เป็นนัดล่าสุดของนักศึกษา (เลขครั้งที่คิดจาก ROW_NUMBER —
   * ลบครั้งที่ 1 แล้วครั้งที่ 2 จะกลายเป็นครั้งที่ 1) · ไม่มีบันทึกย่อของนัดนั้น (FK เป็น ON DELETE CASCADE)
   */
  static async deleteDraft(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const appointmentId = parseInt(req.params.id, 10);
      if (isNaN(appointmentId)) {
        res.status(400).json({ message: 'Invalid appointment ID.' });
        return;
      }

      const found = await query(
        `SELECT a.student_id, a.status, a.appointment_date::text AS appointment_date,
                EXISTS (SELECT 1 FROM supervision_appointments n
                         WHERE n.student_id = a.student_id
                           AND (n.created_at, n.appointment_id) > (a.created_at, a.appointment_id)) AS has_later,
                EXISTS (SELECT 1 FROM supervision_logs l WHERE l.appointment_id = a.appointment_id) AS has_log
           FROM supervision_appointments a
          WHERE a.appointment_id = $1 AND a.advisor_id = $2`,
        [appointmentId, req.user.userId]
      );
      if ((found.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบนัดหมายที่ลบได้ (ไม่ใช่นัดของท่าน)' });
        return;
      }

      const appointment = found.rows[0];
      const blocked =
        appointment.status !== 'draft'
          ? 'ลบได้เฉพาะนัดที่ยังเป็นร่าง — นัดที่ส่งถึงพี่เลี้ยงแล้วให้ใช้ "แก้ไขนัด" แทน'
          : appointment.has_later
            ? 'ลบไม่ได้ เพราะนักศึกษาคนนี้มีนัดนิเทศครั้งถัดไปอยู่แล้ว — ใช้ "แก้ไขนัด" แทน'
            : appointment.has_log
              ? 'ลบไม่ได้ เพราะมีบันทึกการนิเทศของนัดนี้แล้ว'
              : null;
      if (blocked) {
        res.status(409).json({ message: blocked });
        return;
      }

      // เงื่อนไขซ้ำใน DELETE: เจ้าหน้าที่กดส่ง หรือมีบันทึกเกิดขึ้น ระหว่างสองคำสั่งนี้ ต้องไม่ถูกลบ
      const deleted = await query(
        `DELETE FROM supervision_appointments a
          WHERE a.appointment_id = $1 AND a.advisor_id = $2 AND a.status = 'draft'
            AND NOT EXISTS (SELECT 1 FROM supervision_logs l WHERE l.appointment_id = a.appointment_id)
          RETURNING a.appointment_id`,
        [appointmentId, req.user.userId]
      );
      if ((deleted.rowCount ?? 0) === 0) {
        res.status(409).json({ message: 'นัดนี้เพิ่งถูกเปลี่ยนสถานะ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' });
        return;
      }

      writeAudit({
        action: AuditAction.APPOINTMENT_DRAFT_DELETED,
        entityType: 'supervision_appointment',
        entityId: appointmentId,
        subjectId: appointment.student_id,
        detail: { appointment_date: appointment.appointment_date },
      }, req).catch(() => undefined);

      res.status(200).json({ success: true, message: 'ลบร่างนัดนิเทศแล้ว' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Delete Draft Appointment Error', 'An internal server error occurred.');
    }
  }

  /**
   * Staff clicks send email
   * Route: PUT /api/appointments/:id/audit-send
   * Access: staff
   */
  static async auditSend(req: Request, res: Response): Promise<void> {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      if (isNaN(appointmentId)) {
        res.status(400).json({ message: 'Invalid appointment ID.' });
        return;
      }

      // Fetch appointment and related info
      const appRes = await query(
        `SELECT a.*, s.first_name as student_fname, s.last_name as student_lname, c.name_th as company_name, i.mentor_id
         FROM supervision_appointments a
         JOIN students s ON a.student_id = s.student_id
         JOIN companies c ON a.company_id = c.company_id
         LEFT JOIN intent_forms i ON s.student_id = i.student_id AND i.status = 'accepted'
         WHERE a.appointment_id = $1`,
        [appointmentId]
      );

      if ((appRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Appointment not found.' });
        return;
      }

      const app = appRes.rows[0];

      // ส่งซ้ำได้ขณะยังรอบริษัทตอบ (ปุ่ม "ส่งซ้ำ" — พี่เลี้ยงหาอีเมลไม่เจอ) · ตอบแล้วส่งซ้ำไม่ได้
      if (app.status !== 'draft' && app.status !== 'pending_company') {
        res.status(400).json({ message: 'ส่งได้เฉพาะนัดที่ยังเป็นร่าง หรือยังรอสถานประกอบการตอบ' });
        return;
      }

      if (!app.mentor_id) {
        res.status(400).json({ message: 'No mentor assigned for this student.' });
        return;
      }

      const mentorRes = await query(`SELECT email FROM users WHERE user_id = $1`, [app.mentor_id]);
      if ((mentorRes.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'Mentor email not found.' });
        return;
      }

      const mentorEmail = mentorRes.rows[0].email;

      // Generate a simple token (valid for 14 days)
      const token = jwt.sign({ appointment_id: appointmentId, role: 'mentor_response' }, JWT_SECRET, { expiresIn: '14d' });
      // In a real app, FRONTEND_URL is loaded from env, let's assume standard Vite local port or a config
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const tokenLink = `${frontendUrl}/appointment-response?token=${token}`;

      // ปุ่มเข้าสู่ระบบใช้ครั้งเดียวในอีเมลเดียวกัน — ไม่ได้ลิงก์ (ไม่ใช่พี่เลี้ยงล้วน/ติด cooldown) ก็ส่งแค่ปุ่มตอบรับเดิม
      const loginLink = await issueMentorLoginLink({
        userId: app.mentor_id,
        target: '/dashboard',
        ttlMs: MENTOR_LINK_TTL_SYSTEM_MS,
        skipCooldown: true,
      });

      await sendSupervisionAppointmentEmail(
        mentorEmail,
        {
          studentName: `${app.student_fname} ${app.student_lname}`,
          companyName: app.company_name,
          appointmentDate: new Date(app.appointment_date).toLocaleDateString('th-TH'),
          studentTime: app.student_time,
          mentorTime: app.mentor_time,
          tourRequested: app.tour_requested
        },
        tokenLink,
        loginLink && 'url' in loginLink ? loginLink.url : undefined
      );

      // Update status
      await query(
        `UPDATE supervision_appointments SET status = 'pending_company', updated_at = CURRENT_TIMESTAMP WHERE appointment_id = $1`,
        [appointmentId]
      );

      res.status(200).json({ success: true, message: 'Email sent and status updated.' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Audit Send Appointment Error', 'An internal server error occurred.');
    }
  }

  /**
   * Read out the appointment a mentor was emailed about.
   * Route: POST /api/appointments/:id/respond-info
   * Access: public (with valid token)
   *
   * The response page used to ask "confirm or reschedule?" without saying which
   * student, which date or which time — everything the mentor needs in order to
   * answer was in the email and nowhere on the page they were sent to.
   *
   * POST rather than GET so the link token stays in the request body: a token in
   * a query string lands in access logs and Referer headers, which is the very
   * thing SEC-08 removed from the session cookie.
   */
  static async respondInfo(req: Request, res: Response): Promise<void> {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      if (isNaN(appointmentId)) {
        res.status(400).json({ message: 'Invalid appointment ID.' });
        return;
      }

      const tokenError = verifyResponseToken(req.body?.token, appointmentId);
      if (tokenError) {
        res.status(tokenError.status).json({ message: tokenError.message });
        return;
      }

      const result = await query(
        `SELECT a.appointment_id, a.appointment_date, a.student_time, a.mentor_time,
                a.tour_requested, a.status,
                a.proposed_reschedule_date, a.proposed_mentor_time,
                s.first_name AS student_first_name, s.last_name AS student_last_name,
                s.student_code,
                c.name_th AS company_name,
                p.first_name AS advisor_first_name, p.last_name AS advisor_last_name
         FROM supervision_appointments a
         JOIN students s ON a.student_id = s.student_id
         JOIN companies c ON a.company_id = c.company_id
         LEFT JOIN personnel p ON a.advisor_id = p.personnel_id
         WHERE a.appointment_id = $1`,
        [appointmentId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Appointment not found.' });
        return;
      }

      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
      sendUnexpectedError(res, error, 'Appointment Respond Info Error', 'An internal server error occurred.');
    }
  }

  /**
   * Mentor responds to email
   * Route: PUT /api/appointments/:id/respond
   * Access: public (with valid token)
   */
  static async respond(req: Request, res: Response): Promise<void> {
    try {
      const appointmentId = parseInt(req.params.id, 10);
      const { token, action, new_date, new_time } = req.body; // action: 'accept', 'reschedule'

      const tokenError = verifyResponseToken(token, appointmentId);
      if (tokenError) {
        res.status(tokenError.status).json({ message: tokenError.message });
        return;
      }

      // ลิงก์อายุ 14 วันและใช้ซ้ำได้ — เดิมไม่ดูสถานะ นัดที่ยืนยันแล้วถูกพลิกเป็น "ขอเลื่อน" ด้วยลิงก์เดิมได้
      // ยืนยันได้จากรอตอบ · ขอเลื่อนได้จากรอตอบและขอเลื่อนค้างอยู่ (เปลี่ยนวันที่เสนอ) · นอกนั้น 409
      let updated;
      if (action === 'accept') {
        updated = await query(
          `UPDATE supervision_appointments SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
            WHERE appointment_id = $1 AND status = 'pending_company'
            RETURNING appointment_id`,
          [appointmentId]
        );
      } else if (action === 'reschedule') {
        if (!new_date || !new_time) {
          res.status(400).json({ message: 'New date and time are required for rescheduling.' });
          return;
        }
        // Nothing stopped a mentor proposing a visit in the past: 1 Jan 2020
        // was accepted, stored, and mailed to the advisor as a real proposal.
        // Compared as YYYY-MM-DD strings so the check cannot drift by a day the
        // way parsing a date-only value into a Date does.
        if (!isIsoDate(new_date)) {
          res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง' });
          return;
        }
        if (new_date < todayIsoDate()) {
          res.status(400).json({ message: 'ไม่สามารถเสนอวันนัดหมายที่เป็นวันย้อนหลังได้' });
          return;
        }
        updated = await query(
          `UPDATE supervision_appointments
           SET status = 'rescheduled', proposed_reschedule_date = $2, proposed_mentor_time = $3, updated_at = CURRENT_TIMESTAMP
           WHERE appointment_id = $1 AND status IN ('pending_company', 'rescheduled')
           RETURNING appointment_id`,
          [appointmentId, new_date, new_time]
        );
      } else {
        res.status(400).json({ message: 'Invalid action.' });
        return;
      }

      if ((updated.rowCount ?? 0) === 0) {
        res.status(409).json({
          code: 'not_awaiting_response',
          message: 'นัดหมายนี้ไม่ได้อยู่ระหว่างรอคำตอบแล้ว หากต้องการเปลี่ยนแปลงกรุณาติดต่ออาจารย์นิเทศ',
        });
        return;
      }

      res.status(200).json({ success: true, message: 'Response recorded successfully.' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Respond Appointment Error', 'An internal server error occurred.');
    }
  }

  /**
   * Advisor bypass (offline agreed)
   * Route: PUT /api/appointments/:id/bypass
   * Access: advisor
   */
  static async bypass(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const appointmentId = parseInt(req.params.id, 10);
      if (isNaN(appointmentId)) {
        res.status(400).json({ message: 'Invalid appointment ID.' });
        return;
      }

      // อาจารย์บันทึกได้เฉพาะนัดของตัวเอง · เจ้าหน้าที่บันทึกได้ทุกนัด (ปุ่ม "บันทึกว่านัดทางโทรศัพท์แล้ว"
      // สำหรับบริษัทที่ไม่มีอีเมล — เดิม route เปิดให้อาจารย์อย่างเดียว ปุ่มนั้นจึงได้ 403 ทุกครั้ง)
      const isStaff = req.user.roles.includes('staff');
      const result = await query(
        `UPDATE supervision_appointments SET status = 'offline_agreed', updated_at = CURRENT_TIMESTAMP
          WHERE appointment_id = $1 AND ($2::boolean OR advisor_id = $3)
            AND status IN ('draft', 'pending_company', 'rescheduled')
          RETURNING appointment_id`,
        [appointmentId, isStaff, req.user.userId]
      );

      // เดิมตอบ 200 แม้ไม่มีแถวไหนถูกแก้ (นัดของคนอื่น / ตกลงไปแล้ว) — ผู้ใช้เห็นว่าสำเร็จทั้งที่ไม่มีอะไรเกิดขึ้น
      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบนัดหมายที่บันทึกได้ (ไม่ใช่นัดของท่าน หรือตกลงกันไปแล้ว)' });
        return;
      }

      res.status(200).json({ success: true, message: 'Appointment marked as offline agreed.' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Bypass Appointment Error', 'An internal server error occurred.');
    }
  }

  /**
   * Advisor accepts reschedule
   * Route: PUT /api/appointments/:id/accept-reschedule
   * Access: advisor
   */
  static async acceptReschedule(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const appointmentId = parseInt(req.params.id, 10);
      if (isNaN(appointmentId)) {
        res.status(400).json({ message: 'Invalid appointment ID.' });
        return;
      }

      // เจ้าหน้าที่รับวันใหม่แทนได้ (ปุ่ม "รับวันใหม่" บนหน้านัดหมายของเจ้าหน้าที่)
      const isStaff = req.user.roles.includes('staff');
      const appRes = await query(
        `SELECT status, proposed_reschedule_date, proposed_mentor_time FROM supervision_appointments
          WHERE appointment_id = $1 AND ($2::boolean OR advisor_id = $3)`,
        [appointmentId, isStaff, req.user.userId]
      );

      if ((appRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Appointment not found or unauthorized.' });
        return;
      }

      const app = appRes.rows[0];
      if (app.status !== 'rescheduled') {
        res.status(400).json({ message: 'Appointment is not in rescheduled status.' });
        return;
      }

      await query(
        `UPDATE supervision_appointments 
         SET status = 'accepted', 
             appointment_date = $2, 
             mentor_time = $3, 
             student_time = $3, 
             proposed_reschedule_date = NULL, 
             proposed_mentor_time = NULL, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE appointment_id = $1`,
        [appointmentId, app.proposed_reschedule_date, app.proposed_mentor_time]
      );

      res.status(200).json({ success: true, message: 'Reschedule accepted successfully.' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Accept Reschedule Error', 'An internal server error occurred.');
    }
  }

  /**
   * พิมพ์บันทึกข้อความขออนุมัติเดินทางไปราชการ (คู่มือหน้า 33–34 · 50) — ปุ่มพิมพ์สำรอง
   * Route: GET /api/appointments/travel-request/print?visit=1&ids=12,15
   * Access: advisor · เฉพาะนัดที่ตัวเองร่าง และตกลงกันแล้ว
   *
   * ⛔ วาดสดทุกครั้ง ไม่เก็บไฟล์ ไม่สร้างสถานะ — การอนุมัติจริงอยู่ที่ E-document
   */
  static async printTravelRequest(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const visit = Number(req.query.visit);
      if (visit !== 1 && visit !== 2) {
        res.status(400).json({ message: 'กรุณาระบุการนิเทศครั้งที่ 1 หรือ 2' });
        return;
      }
      const ids = String(req.query.ids ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s));
      if (ids.length === 0 || ids.some((n) => !Number.isInteger(n) || n <= 0) || new Set(ids).size !== ids.length) {
        res.status(400).json({ message: 'กรุณาเลือกนัดนิเทศอย่างน้อยหนึ่งรายการ' });
        return;
      }
      if (ids.length > TRAVEL_REQUEST_MAX_ROWS) {
        res.status(400).json({ message: `บันทึกหนึ่งฉบับใส่ได้ไม่เกิน ${TRAVEL_REQUEST_MAX_ROWS} คน — แบ่งเป็นหลายฉบับ` });
        return;
      }

      const rows = await query(
        `WITH v AS (
           SELECT appointment_id,
                  ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at, appointment_id)::int AS visit_number
             FROM supervision_appointments
         )
         SELECT a.appointment_id, a.advisor_id, a.status, a.appointment_date::text AS appointment_date, v.visit_number,
                s.first_name, s.last_name, c.name_th AS company_name_th
           FROM supervision_appointments a
           JOIN v ON v.appointment_id = a.appointment_id
           JOIN students s ON s.student_id = a.student_id
           JOIN companies c ON c.company_id = a.company_id
          WHERE a.appointment_id = ANY($1::int[])
          ORDER BY a.appointment_date, s.student_code`,
        [ids]
      );
      if ((rows.rowCount ?? 0) !== ids.length) {
        res.status(404).json({ message: 'ไม่พบนัดนิเทศบางรายการที่เลือก' });
        return;
      }
      const me = req.user.userId;
      if (rows.rows.some((r) => r.advisor_id !== me)) {
        res.status(403).json({ message: 'เลือกได้เฉพาะนัดนิเทศที่ท่านเป็นผู้ร่างเท่านั้น' });
        return;
      }
      const notReady = rows.rows.filter(
        (r) => !CONFIRMED_APPOINTMENT_STATUSES.includes(r.status) || r.visit_number !== visit
      );
      if (notReady.length > 0) {
        res.status(400).json({
          message:
            `นัดของ ${notReady.map((r) => [r.first_name, r.last_name].filter(Boolean).join(' ')).join(' · ')} ` +
            `ยังไม่ได้ยืนยัน หรือไม่ใช่การนิเทศครั้งที่ ${visit}`,
        });
        return;
      }

      const advisor = await query(
        `SELECT p.first_name, p.last_name, m.major_name_th, f.faculty_name_th
           FROM personnel p
           JOIN master_major m ON m.major_id = p.major_id
           JOIN master_faculty f ON f.faculty_id = m.faculty_id
          WHERE p.personnel_id = $1`,
        [me]
      );
      if ((advisor.rowCount ?? 0) === 0) {
        res.status(403).json({ message: 'ไม่พบข้อมูลบุคลากรของท่าน กรุณาติดต่อเจ้าหน้าที่เพื่อตั้งค่าโปรไฟล์' });
        return;
      }
      const a = advisor.rows[0];

      const pdf = await buildTravelRequestPdf({
        visit_number: visit as 1 | 2,
        advisor_first_name: a.first_name,
        advisor_last_name: a.last_name,
        major_name_th: a.major_name_th,
        faculty_name_th: a.faculty_name_th,
        rows: rows.rows,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="travel-request-visit-${visit}.pdf"`);
      res.status(200).send(pdf);
    } catch (error) {
      sendUnexpectedError(res, error, 'Travel request PDF error', 'เกิดข้อผิดพลาดขณะสร้างบันทึกข้อความขออนุมัติเดินทาง');
    }
  }
}

