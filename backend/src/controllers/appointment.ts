import { Request, Response } from 'express';
import { query } from '../config/database';
import { sendSupervisionAppointmentEmail } from '../utils/email';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { sendUnexpectedError } from '../utils/httpError';

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
      
      let queryStr = `
        SELECT a.*, s.first_name, s.last_name, s.student_code, c.name_th as company_name 
        FROM supervision_appointments a
        JOIN students s ON a.student_id = s.student_id
        JOIN companies c ON a.company_id = c.company_id
        WHERE 1=1
      `;
      const params: unknown[] = [];
      
      if (roles.includes('advisor')) {
        params.push(userId);
        queryStr += ` AND a.advisor_id = $1`;
      } else if (roles.includes('staff')) {
        // Staff sees all drafts, or all appointments
        queryStr += ` AND a.status = 'draft'`; // Usually staff audits drafts
      }
      
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
        res.status(400).json({ message: 'Missing required fields.' });
        return;
      }

      // Check if student has an active intent
      const intentRes = await query(
        `SELECT company_id FROM intent_forms WHERE student_id = $1 AND status = 'accepted'`,
        [student_id]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'Student does not have an accepted intent form.' });
        return;
      }

      const companyId = intentRes.rows[0].company_id;

      const insertRes = await query(
        `INSERT INTO supervision_appointments 
         (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, tour_requested, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft') RETURNING appointment_id`,
        [advisorId, student_id, companyId, appointment_date, student_time, mentor_time, tour_requested || false]
      );

      res.status(201).json({
        success: true,
        message: 'Draft appointment created.',
        data: { appointment_id: insertRes.rows[0].appointment_id }
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Create Draft Appointment Error', 'An internal server error occurred.');
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

      if (app.status !== 'draft') {
        res.status(400).json({ message: 'Only draft appointments can be sent.' });
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
        tokenLink
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

      if (action === 'accept') {
        await query(
          `UPDATE supervision_appointments SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE appointment_id = $1`,
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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(new_date))) {
          res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง' });
          return;
        }
        if (String(new_date) < todayIsoDate()) {
          res.status(400).json({ message: 'ไม่สามารถเสนอวันนัดหมายที่เป็นวันย้อนหลังได้' });
          return;
        }
        await query(
          `UPDATE supervision_appointments 
           SET status = 'rescheduled', proposed_reschedule_date = $2, proposed_mentor_time = $3, updated_at = CURRENT_TIMESTAMP 
           WHERE appointment_id = $1`,
          [appointmentId, new_date, new_time]
        );
      } else {
        res.status(400).json({ message: 'Invalid action.' });
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

      // Optional: Check if advisor owns the appointment
      const advisorId = req.user.userId;

      await query(
        `UPDATE supervision_appointments SET status = 'offline_agreed', updated_at = CURRENT_TIMESTAMP WHERE appointment_id = $1 AND advisor_id = $2`,
        [appointmentId, advisorId]
      );

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

      const advisorId = req.user.userId;

      const appRes = await query(
        `SELECT status, proposed_reschedule_date, proposed_mentor_time FROM supervision_appointments WHERE appointment_id = $1 AND advisor_id = $2`,
        [appointmentId, advisorId]
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
}

