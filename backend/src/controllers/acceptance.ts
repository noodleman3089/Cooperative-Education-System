import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { IntentFormModel } from '../models/intent';
import { CompanyAcceptPayload, StudentAcceptPayload } from '../types';
import { notifyStudentStatusChange, sendMentorLoginLinkEmail } from '../utils/email';
import { issueMentorLoginLink, revokeMentorLoginLink, MENTOR_LINK_TTL_SYSTEM_MS } from '../utils/mentorLoginLink';
import pool from '../config/database';
import { AuditAction, writeAudit } from '../utils/audit';
import { getErrorMessage } from '../utils/httpError';
import { validateAcceptanceInput } from '../utils/acceptanceInput';
import { updateCompanyFields } from './form07';

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
    // multer เขียนไฟล์ลงดิสก์ไปแล้วก่อนถึงตรงนี้ — ล้มตรงไหนหลังจากนี้ต้องลบทิ้ง ไม่งั้นค้างเป็นไฟล์กำพร้า
    // (แบบเดียวกับ discardFile ของทางลิงก์ใน publicAcceptance.ts) · สำเร็จแล้วไฟล์เป็นของใบ ห้ามลบ
    const file = req.file;
    const discardFile = () => {
      if (file) {
        fs.promises.unlink(file.path).catch((e) => console.error('[Acceptance] cannot remove rejected upload:', e));
      }
    };
    try {
      if (!req.user) {
        discardFile();
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const intentId = parseInt(req.params.intent_id, 10);
      if (isNaN(intentId)) {
        discardFile();
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const body = req.body as StudentAcceptPayload;
      const { name, email, phone, position, department, start_date } = body;

      // ด่านตรวจร่วมกับทางลิงก์ของบริษัท (utils/acceptanceInput.ts) — ห้ามคัดลอกไปตรวจซ้ำที่นี่
      // ไฟล์ · ช่องพี่เลี้ยง · วันเริ่มงาน · หนังสือถูกลงนามแล้ว (409) · ผู้ลงนามบนแบบตอบรับ
      const input = await validateAcceptanceInput(intentId, {
        hasFile: !!req.file,
        mentor: { name, email, phone },
        start_date,
        signer: req.body as Record<string, unknown>,
      });
      if (!input.ok) {
        discardFile();
        res.status(input.status).json({ message: input.message });
        return;
      }
      const { submittedLate, signer } = input;

      const studentUserId = req.user.userId;
      // validateAcceptanceInput ปฏิเสธไปแล้วถ้าไม่มีไฟล์ — ตรงนี้ req.file มีแน่
      const evidencePath = `acceptance_evidence/${req.file!.filename}`;

      const updatedIntent = await IntentFormModel.acceptByStudentWithTransaction(
        intentId,
        studentUserId,
        { name, email, phone, position, department },
        start_date,
        evidencePath,
        submittedLate,
        signer
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
      discardFile();
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

      const { action } = req.body; // action: 'accepted' or 'rejected'
      if (!action || !['accepted', 'rejected'].includes(action)) {
        res.status(400).json({ message: 'Required field: action must be either "accepted" or "rejected".' });
        return;
      }
      // ตีกลับต้องมีเหตุผล — เดิมบังคับแค่บนหน้าจอ ส่งตรงมาที่ API ว่างๆ ก็ผ่าน
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (action === 'rejected' && !reason) {
        res.status(400).json({ message: 'กรุณาระบุเหตุผลที่ตีกลับ เพื่อให้นักศึกษาแก้ไขได้ถูกจุด' });
        return;
      }

      await client.query('BEGIN');

      // 1. Fetch and lock intent form
      const intentRes = await client.query(
        `SELECT i.form_id, i.student_id, i.company_id, i.mentor_id, i.status, i.company_form07_pending,
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

        // บริษัทตอบผ่านลิงก์: ข้อมูลบริษัทส่วน สหกิจ 07 ถูกพักไว้ที่ใบ (D5) — เขียนลง companies ตรงนี้
        // ในทรานแซกชันเดียวกับการกดรับ แล้วล้างที่พัก · rollback ที่ไหนก็ไม่มีทะเบียนบริษัทถูกแตะครึ่งเดียว
        // ⛔ ห้ามเขียนตอนบริษัทกดส่ง — ลิงก์ไปถึงอีเมลที่นักศึกษาพิมพ์ ใครถือลิงก์ก็แก้ทะเบียนบริษัทได้
        if (intent.company_form07_pending) {
          await updateCompanyFields(client, intent.company_id, intent.company_form07_pending);
          await client.query(`UPDATE intent_forms SET company_form07_pending = NULL WHERE form_id = $1`, [intentId]);
        }

        // 3. Activate mentor account if it's currently inactive
        let mentorMail: { email: string; url: string; expiresAt: Date; tokenId: number } | null = null;
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
              // No password is ever set (SEC-15): the mentor enters through a
              // one-time emailed login link. The token row is written on the
              // same client, so a rollback discards it too; the email itself
              // is sent only after COMMIT.
              await client.query(
                `UPDATE users SET password_hash = NULL, is_active = TRUE WHERE user_id = $1`,
                [intent.mentor_id]
              );

              const issued = await issueMentorLoginLink(
                { userId: intent.mentor_id, ttlMs: MENTOR_LINK_TTL_SYSTEM_MS, skipCooldown: true },
                client
              );
              // SEC-03 above already guarantees eligibility — null/cooldown here is a bug, roll back
              if (!issued || 'cooledDown' in issued) {
                throw new Error('ออกลิงก์เข้าสู่ระบบให้พี่เลี้ยงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
              }
              mentorMail = {
                email: mentorUser.email,
                url: issued.url,
                expiresAt: issued.expiresAt,
                tokenId: issued.tokenId,
              };
              console.log(`Activated mentor account ${mentorUser.email} and issued a login link.`);
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

        // ส่งเมลหลัง COMMIT เท่านั้น — ลิงก์ในเมลต้องมีแถวอยู่จริงในฐานตอนพี่เลี้ยงกด
        if (mentorMail) {
          const sent = await sendMentorLoginLinkEmail(mentorMail.email, mentorMail.url, {
            expiresAt: mentorMail.expiresAt,
            kind: 'welcome',
          });
          if (!sent) {
            // ลิงก์ที่ไม่เคยถึงมือพี่เลี้ยงต้องไม่ค้างในฐาน · บอกตามจริง ไม่กลืน
            await revokeMentorLoginLink(mentorMail.tokenId);
            res.status(200).json({
              success: true,
              mentor_email_sent: false,
              message: 'อนุมัติเอกสารตอบรับและเปิดใช้งานบัญชีพี่เลี้ยงเรียบร้อยแล้ว แต่ส่งอีเมลลิงก์เข้าสู่ระบบถึงพี่เลี้ยงไม่สำเร็จ พี่เลี้ยงขอลิงก์เองได้ที่หน้า /login/mentor',
            });
            return;
          }
        }

        res.status(200).json({
          success: true,
          ...(mentorMail ? { mentor_email_sent: true } : {}),
          message: 'อนุมัติเอกสารตอบรับและเปิดใช้งานบัญชีพี่เลี้ยงเรียบร้อยแล้ว',
        });
      } else {
        // Action is 'rejected' — ตีกลับ "แบบตอบรับ" ไม่ใช่ปฏิเสธที่ฝึก
        // ใบกลับไปรอแบบตอบรับ (ขั้นก่อนอัปโหลด) ไฟล์เดิมถูกล้าง นักศึกษาส่งใหม่ในใบเดิมได้
        // แบบเดียวกับตีกลับแบบคำร้อง (เอกสารหมายเลข 1)
        // ⛔ เดิมปิดใบเป็น 'rejected' และคืนโควตา — นักศึกษาส่งใหม่ไม่ได้ทั้งที่อีเมลบอกให้อัปโหลดใหม่
        //    ถ้าบริษัทไม่รับจริง นักศึกษากด "สัมภาษณ์ไม่ผ่าน" เอง (ทางนั้นปิดใบและคืนโควตาให้)
        // เหตุผลเก็บบนแถวเพราะคนที่ต้องอ่านคือนักศึกษา และ audit_log ไม่มี read API (SEC-07)
        const previous = await client.query(
          `SELECT acceptance_evidence_path FROM intent_forms WHERE form_id = $1`,
          [intentId]
        );
        const previousPath: string | null = previous.rows[0]?.acceptance_evidence_path ?? null;

        // company_mail_count = 0: ตีกลับแล้วนักศึกษาต้องส่งลิงก์ให้บริษัทใหม่ได้ครบ 3 ครั้งอีกรอบ (SEC-13 ด่าน 5)
        // ไม่งั้นใบที่ถูกตีกลับหลายรอบโดนโควตาเดิมกิน (429 ทั้งที่ไม่ได้ทำผิด) · รีเซ็ตตรงนี้ปลอดภัย
        // เพราะการตีกลับมีคนกดทุกครั้ง นักศึกษาใช้เป็นช่องส่งเมลซ้ำไม่ได้
        await client.query(
          `UPDATE intent_forms
              SET status = 'approved_by_dept_head', reject_reason = $2,
                  acceptance_evidence_path = NULL, acceptance_signer_name = NULL,
                  acceptance_signer_position = NULL, acceptance_signed_date = NULL,
                  acceptance_source = NULL, company_form07_pending = NULL,
                  company_mail_count = 0
            WHERE form_id = $1`,
          [intentId, reason]
        );

        await writeAudit({
          action: AuditAction.ACCEPTANCE_OFFICER_DECISION,
          entityType: 'intent_form',
          entityId: intentId,
          subjectId: intent.student_id,
          detail: { decision: 'rejected', reason },
        }, req, client);

        await client.query('COMMIT');

        if (previousPath) {
          fs.promises.unlink(path.join(process.cwd(), 'uploads', previousPath)).catch(() => undefined);
        }

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
