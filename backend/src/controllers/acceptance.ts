import { Request, Response } from 'express';
import { IntentFormModel } from '../models/intent';
import { CompanyAcceptPayload, StudentAcceptPayload } from '../types';
import { notifyStudentStatusChange, sendMentorInviteEmail } from '../utils/email';
import { createInviteLink } from '../utils/invite';
import pool, { query } from '../config/database';
import { AuditAction, writeAudit } from '../utils/audit';
import { getErrorMessage } from '../utils/httpError';

export class AcceptanceController {
  /**
   * Update company acceptance status (accept or reject).
   * Route: PATCH /api/acceptances/company/:intent_id/status
   * Access: company
   */
  static async updateCompanyAcceptanceStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const intentId = parseInt(req.params.intent_id, 10);
      if (isNaN(intentId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const { status } = req.body;
      if (!status || !['accepted', 'rejected'].includes(status)) {
        res.status(400).json({ message: 'Required field: status must be either "accepted" or "rejected".' });
        return;
      }

      const companyUserId = req.user.userId;

      if (status === 'accepted') {
        const body = req.body as CompanyAcceptPayload;
        const { name, email, phone, position, department, start_date } = body;

        // Validate required fields
        if (!name || !email || !phone || !start_date) {
          res.status(400).json({ message: 'Required fields: name, email, phone, start_date.' });
          return;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          res.status(400).json({ message: 'Invalid email address format.' });
          return;
        }

        // Date validation
        if (isNaN(Date.parse(start_date))) {
          res.status(400).json({ message: 'Invalid start_date format.' });
          return;
        }

        const updatedIntent = await IntentFormModel.acceptByCompanyWithTransaction(
          intentId,
          companyUserId,
          { name, email, phone, position, department },
          start_date
        );

        // Notify student via email
        notifyStudentStatusChange(intentId, 'accepted').catch(console.error);

        res.status(200).json({
          message: 'Student application accepted and mentor onboarding completed successfully.',
          intentForm: updatedIntent,
        });
      } else {
        // Status is 'rejected'
        // A reason is mandatory, as it already is for the advisor and the
        // department head. A student who is turned down has to re-apply
        // somewhere else, and cannot do that well without knowing what went
        // wrong.
        const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
        if (!reason) {
          res.status(400).json({ message: 'กรุณาระบุเหตุผลที่ไม่รับนักศึกษาเข้าปฏิบัติงาน' });
          return;
        }

        const success = await IntentFormModel.rejectByCompany(intentId, companyUserId, reason);
        if (!success) {
          res.status(400).json({ message: 'Failed to reject intent form.' });
          return;
        }

        // Notify student via email
        notifyStudentStatusChange(intentId, 'company_rejected', reason).catch(console.error);

        res.status(200).json({
          message: 'Student application rejected by company. Student is unlocked to apply again.',
          intent_id: intentId,
        });
      }
    } catch (error) {
      console.error('Update Company Acceptance Status Error:', error);
      res.status(400).json({
        message: getErrorMessage(error, 'An error occurred while updating the application status.'),
      });
    }
  }

  /**
   * Student uploads manual acceptance proof and onboard the mentor.
   * Route: POST /api/acceptances/student/:intent_id/upload-proof
   * Access: student
   */
  static async acceptByStudent(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const intentId = parseInt(req.params.intent_id, 10);
      if (isNaN(intentId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ message: 'Required file upload: evidence.' });
        return;
      }

      const body = req.body as StudentAcceptPayload;
      const { name, email, phone, position, department, start_date } = body;

      // Validate required fields
      if (!name || !email || !phone || !start_date) {
        res.status(400).json({ message: 'Required fields: name, email, phone, start_date.' });
        return;
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ message: 'Invalid email address format.' });
        return;
      }

      // Date validation
      if (isNaN(Date.parse(start_date))) {
        res.status(400).json({ message: 'Invalid start_date format.' });
        return;
      }

      const studentUserId = req.user.userId;
      const evidencePath = `acceptance_evidence/${req.file.filename}`;

      // แบบตอบรับ (เอกสารหมายเลข 2) ตอบ **หนังสือขอความอนุเคราะห์** ที่คณบดีลงนาม
      // ยังไม่ลงนาม = ยังไม่มีอะไรให้บริษัทตอบ · `acceptance_due_date` ถูกปั๊มตอนลงนาม
      // จึงใช้เป็นด่านลำดับได้ในตัว ไม่ต้อง join หา official_documents ซ้ำ
      const gate = await query(
        `SELECT i.acceptance_due_date::text AS due,
                (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text AS today,
                (SELECT d.dean_signature_date::date::text
                   FROM official_documents d
                  WHERE d.student_id = i.student_id AND d.company_id = i.company_id
                    AND d.type = 'cover_letter' AND d.status = 'signed'
                  ORDER BY d.doc_id DESC LIMIT 1) AS letter_signed_on
           FROM intent_forms i WHERE i.form_id = $1`,
        [intentId]
      );
      if ((gate.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบใบแจ้งความจำนงที่ต้องการ' });
        return;
      }
      const { due, today, letter_signed_on } = gate.rows[0] as {
        due: string | null;
        today: string;
        letter_signed_on: string | null;
      };
      if (!due) {
        res.status(409).json({
          message:
            'ยังส่งแบบตอบรับไม่ได้ เพราะคณบดียังไม่ได้ลงนามหนังสือขอความอนุเคราะห์ — สถานประกอบการต้องได้รับหนังสือฉบับนั้นก่อนจึงจะตอบรับได้',
        });
        return;
      }

      // เลยกำหนดแล้ว **ยังรับ** แต่ติดธง — เจ้าหน้าที่ยืนยันเองว่าผ่อนผันเวลาได้
      // เพราะบางบริษัทเซ็นช้า · เทียบสตริง YYYY-MM-DD ล้วน ห้าม new Date()
      const submittedLate = today > due;

      // ผู้ลงนามบนแบบตอบรับ — ถูกพิมพ์ลงหนังสือส่งตัว จึงบังคับ · นักศึกษาถือกระดาษอยู่แล้วเลยกรอกเอง
      // (เจ้าของตัดสิน 2026-09-21: เดิมเจ้าหน้าที่คีย์จากกระดาษตอนตรวจ = ภาระซ้ำ)
      const raw = req.body as Record<string, unknown>;
      const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const signerName = text(raw.signer_name);
      const signerPosition = text(raw.signer_position);
      const signedDate = text(raw.signed_date);
      if (!signerName || !signerPosition || !signedDate) {
        res.status(400).json({
          message: 'กรุณากรอกชื่อ ตำแหน่ง และวันที่ของผู้ลงนาม ตามที่ปรากฏบนแบบตอบรับของสถานประกอบการ',
        });
        return;
      }
      // เทียบสตริง YYYY-MM-DD ล้วน — ห้าม new Date() (เลื่อนวันตาม timezone)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(signedDate)) {
        res.status(400).json({ message: 'รูปแบบวันที่บนแบบตอบรับไม่ถูกต้อง' });
        return;
      }
      if (signedDate > today) {
        res.status(400).json({ message: 'วันที่บนแบบตอบรับเป็นวันในอนาคต กรุณาตรวจสอบกับกระดาษอีกครั้ง' });
        return;
      }
      if (letter_signed_on && signedDate < letter_signed_on) {
        res.status(400).json({
          message: `วันที่บนแบบตอบรับ (${signedDate}) มาก่อนวันที่คณบดีลงนามหนังสือขอความอนุเคราะห์ (${letter_signed_on}) ซึ่งเป็นไปไม่ได้ เพราะสถานประกอบการตอบรับหลังได้รับหนังสือฉบับนั้น`,
        });
        return;
      }


      const updatedIntent = await IntentFormModel.acceptByStudentWithTransaction(
        intentId,
        studentUserId,
        { name, email, phone, position, department },
        start_date,
        evidencePath,
        submittedLate,
        { name: signerName, position: signerPosition, signedDate }
      );

      // Send email notification to student: waiting for officer review
      notifyStudentStatusChange(intentId, 'pending_officer_approval').catch(console.error);

      res.status(200).json({
        message: submittedLate
          ? 'อัปโหลดแบบตอบรับเรียบร้อยแล้ว รอเจ้าหน้าที่ตรวจสอบ — ระบบบันทึกว่าส่งกลับหลังพ้นกำหนด ๑๕ วันทำการ หากเจ้าหน้าที่ขอคำชี้แจง ให้ยื่นบันทึกข้อความจากเมนู "บันทึกข้อความถึงคณบดี"'
          : 'อัปโหลดแบบตอบรับเรียบร้อยแล้ว รอเจ้าหน้าที่ตรวจสอบเอกสาร',
        intentForm: updatedIntent,
      });
    } catch (error) {
      console.error('Student Accept Error:', error);
      res.status(400).json({
        message: getErrorMessage(error, 'An error occurred while submitting student acceptance.'),
      });
    }
  }

  /**
   * Student reports they failed the interview.
   * Route: POST /api/acceptances/student/:intent_id/fail
   * Access: student
   */
  static async failByStudent(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const intentId = parseInt(req.params.intent_id, 10);
      if (isNaN(intentId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const studentUserId = req.user.userId;

      const success = await IntentFormModel.failByStudent(intentId, studentUserId);

      if (!success) {
        res.status(400).json({ message: 'Failed to report failure.' });
        return;
      }

      // Send email notification to student
      notifyStudentStatusChange(intentId, 'rejected').catch(console.error);

      res.status(200).json({
        message: 'Student application reported as failed. Student is unlocked to apply again.',
        intent_id: intentId,
      });
    } catch (error) {
      console.error('Student Fail Error:', error);
      res.status(400).json({
        message: getErrorMessage(error, 'An error occurred while reporting application failure.'),
      });
    }
  }

  /**
   * Staff/Dept Head approves or rejects the manual paper acceptance uploaded by the student.
   * Route: PUT /api/acceptances/:intent_id/officer-approve
   * Access: staff, dept_head
   */
  static async approveByOfficer(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const intentId = parseInt(req.params.intent_id, 10);
      if (isNaN(intentId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const { action, reason } = req.body; // action: 'accepted' or 'rejected'
      if (!action || !['accepted', 'rejected'].includes(action)) {
        res.status(400).json({ message: 'Required field: action must be either "accepted" or "rejected".' });
        return;
      }

      await client.query('BEGIN');

      // 1. Fetch and lock intent form
      const intentRes = await client.query(
        `SELECT i.form_id, i.student_id, i.mentor_id, i.status,
                (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text AS today,
                (SELECT d.dean_signature_date::date::text
                   FROM official_documents d
                  WHERE d.student_id = i.student_id AND d.company_id = i.company_id
                    AND d.type = 'cover_letter' AND d.status = 'signed'
                  ORDER BY d.doc_id DESC LIMIT 1) AS letter_signed_on
           FROM intent_forms i WHERE i.form_id = $1 FOR UPDATE`,
        [intentId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        throw new Error('Intent form not found.');
      }

      const intent = intentRes.rows[0];

      if (intent.status !== 'pending_officer_approval') {
        throw new Error(`Intent form must be in 'pending_officer_approval' status. Current: '${intent.status}'.`);
      }

      if (action === 'accepted') {
        // ผู้ลงนามบนแบบตอบรับ นักศึกษากรอกตอนอัปโหลดแล้ว (ตรวจวันที่ไว้ตรงนั้น) — เจ้าหน้าที่แค่ดูเทียบกับกระดาษ
        // ⛔ ไม่รับชื่อ/ตำแหน่ง/วันที่จากเจ้าหน้าที่แล้ว (เจ้าของตัดสิน 2026-09-21) · ส่งมาก็เมิน
        const signerRes = await client.query(
          `SELECT acceptance_signer_name, acceptance_signed_date::text AS acceptance_signed_date
             FROM intent_forms WHERE form_id = $1`,
          [intentId]
        );
        const signerName = signerRes.rows[0]?.acceptance_signer_name ?? null;
        const signedDate = signerRes.rows[0]?.acceptance_signed_date ?? null;

        // 2. Update intent status to accepted
        await client.query(`UPDATE intent_forms SET status = 'accepted' WHERE form_id = $1`, [intentId]);

        // 3. Activate mentor account if it's currently inactive
        if (intent.mentor_id) {
          // Lock the row first — PostgreSQL rejects FOR UPDATE alongside GROUP BY,
          // so the role aggregation is a separate read.
          const mentorUserRes = await client.query(
            `SELECT user_id, email, is_active,
                    EXISTS (SELECT 1 FROM mentors m WHERE m.mentor_id = users.user_id) AS has_mentor_profile
             FROM users WHERE user_id = $1 FOR UPDATE`,
            [intent.mentor_id]
          );

          if ((mentorUserRes.rowCount ?? 0) > 0) {
            const mentorUser = mentorUserRes.rows[0];
            const rolesRes = await client.query(
              'SELECT role_name FROM user_roles WHERE user_id = $1',
              [intent.mentor_id]
            );
            const mentorRoles: string[] = rolesRes.rows.map((row: { role_name: string }) => row.role_name);

            // SEC-03: this branch resets a password and re-activates an account.
            // Restrict it to accounts that exist purely to be a mentor, so
            // approving a placement can never overwrite the credentials of a staff
            // member, advisor or student whose address was supplied as the mentor
            // email. An account qualifies when it has a mentor profile and carries
            // no role other than 'mentor'.
            const hasForeignRole = mentorRoles.some((r) => r !== 'mentor');
            if (hasForeignRole || !mentorUser.has_mentor_profile) {
              throw new Error(
                'บัญชีพี่เลี้ยงที่ผูกกับใบตอบรับนี้ไม่ใช่บัญชีพี่เลี้ยงโดยเฉพาะ ไม่สามารถออกรหัสผ่านใหม่ให้อัตโนมัติได้ กรุณาตรวจสอบข้อมูลพี่เลี้ยง'
              );
            }

            // Heal records created before the mentor role was consistently written.
            if (!mentorRoles.includes('mentor')) {
              await client.query(
                `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'mentor') ON CONFLICT DO NOTHING`,
                [intent.mentor_id]
              );
            }

            if (!mentorUser.is_active) {
              // Activate with no password: the mentor chooses their own through
              // the invitation link, so none is ever mailed. The token is
              // written on the same client, so a rollback discards it too.
              await client.query(
                `UPDATE users SET password_hash = NULL, is_active = TRUE WHERE user_id = $1`,
                [intent.mentor_id]
              );

              const inviteLink = await createInviteLink(intent.mentor_id, client);
              await sendMentorInviteEmail(mentorUser.email, inviteLink);
              console.log(`Activated mentor account ${mentorUser.email} and sent an invitation.`);
            }
          }
        }

        await writeAudit({
          action: AuditAction.ACCEPTANCE_OFFICER_DECISION,
          entityType: 'intent_form',
          entityId: intentId,
          subjectId: intent.student_id,
          detail: {
            decision: 'accepted',
            mentor_id: intent.mentor_id,
            acceptance_signer_name: signerName,
            acceptance_signed_date: signedDate,
          },
        }, req, client);

        await client.query('COMMIT');

        // Notify student of approval
        notifyStudentStatusChange(intentId, 'accepted').catch(console.error);

        res.status(200).json({ success: true, message: 'อนุมัติเอกสารตอบรับและเปิดใช้งานบัญชีพี่เลี้ยงเรียบร้อยแล้ว' });
      } else {
        // Action is 'rejected'
        // 2. Update intent status to rejected (unlocking student)
        await client.query(
          `UPDATE intent_forms SET status = 'rejected' WHERE form_id = $1`,
          [intentId]
        );

        // 3. Decrement job quota applied count if applicable
        const jobRes = await client.query(
          `SELECT job_id FROM intent_forms WHERE form_id = $1`,
          [intentId]
        );
        if ((jobRes.rowCount ?? 0) > 0 && jobRes.rows[0].job_id !== null) {
          const jobId = jobRes.rows[0].job_id;
          const jpRes = await client.query(
            `SELECT quota, applied_count, status FROM job_posts WHERE job_id = $1 FOR UPDATE`,
            [jobId]
          );
          if ((jpRes.rowCount ?? 0) > 0) {
            const jp = jpRes.rows[0];
            const newAppliedCount = Math.max(0, jp.applied_count - 1);
            // Only reopen when the post is genuinely under quota again — the old
            // unconditional reopen resurrected posts the company had closed itself.
            const newStatus =
              jp.status === 'closed' && newAppliedCount < jp.quota ? 'published' : jp.status;
            await client.query(
              `UPDATE job_posts SET applied_count = $1, status = $2 WHERE job_id = $3`,
              [newAppliedCount, newStatus, jobId]
            );
          }
        }

        await writeAudit({
          action: AuditAction.ACCEPTANCE_OFFICER_DECISION,
          entityType: 'intent_form',
          entityId: intentId,
          subjectId: intent.student_id,
          detail: { decision: 'rejected', reason: reason ?? null },
        }, req, client);

        await client.query('COMMIT');

        // Notify student of rejection
        notifyStudentStatusChange(intentId, 'evidence_rejected', reason).catch(console.error);

        res.status(200).json({ success: true, message: 'ปฏิเสธหลักฐานการตอบรับเรียบร้อยแล้ว' });
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Approve By Officer Error:', error);
      res.status(400).json({ message: getErrorMessage(error, 'An error occurred during approval.') });
    } finally {
      client.release();
    }
  }
}
