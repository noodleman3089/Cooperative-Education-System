import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { IntentConflictError, IntentFormModel } from '../models/intent';
import { notifyStudentStatusChange } from '../utils/email';
import pool from '../config/database';
import { AuditAction, writeAudit } from '../utils/audit';
import { getErrorMessage } from '../utils/httpError';
import { validateAcceptanceInput } from '../utils/acceptanceInput';
import { recordStageEvent } from '../utils/stageEvents';

export class AcceptanceController {
  /**
   * Student uploads manual acceptance proof.
   * Route: POST /api/acceptances/student/:intent_id/upload-proof
   * Access: student
   * ⛔ ไม่รับข้อมูลพี่เลี้ยง — ช่องพี่เลี้ยงที่ส่งมาถูกเมิน (แบบเดียวกับทางลิงก์ของบริษัท)
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

      // ด่านตรวจร่วมกับทางลิงก์ของบริษัท (utils/acceptanceInput.ts) — ห้ามคัดลอกไปตรวจซ้ำที่นี่
      // ไฟล์ · หนังสือถูกลงนามแล้ว (409) · ผู้ลงนามบนแบบตอบรับ · ⛔ ไม่อ่านวันเริ่มงานจากผู้เรียก (มาจากปฏิทินสหกิจ)
      const input = await validateAcceptanceInput(intentId, {
        hasFile: !!req.file,
        signer: (req.body ?? {}) as Record<string, unknown>,
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
   * นักศึกษาระบุพี่เลี้ยงหลังเริ่มฝึก — ระบุซ้ำได้จนกว่าอาจารย์นิเทศจะยืนยันพี่เลี้ยง (ยืนยันแล้ว = 409)
   * Route: POST /api/intents/:id/mentor
   * Access: student เจ้าของใบ · เฉพาะใบ `accepted` ที่ถึงวันเริ่มฝึกแล้ว (ตรวจในโมเดล · ยังไม่ถึง = 409 `internship_not_started`)
   * ⛔ ไม่เปิดบัญชี ไม่ส่งอีเมล — บัญชีพี่เลี้ยงเปิดตอนอาจารย์นิเทศของนักศึกษายืนยันเท่านั้น
   *    (`POST /api/mentor-followup/:mentorId/confirm` · SEC-03 · SEC-15)
   */
  static async setMentor(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }
      const intentId = parseInt(req.params.id, 10);
      if (isNaN(intentId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const mentor = {
        name: text(body.name),
        email: text(body.email),
        phone: text(body.phone),
        position: text(body.position),
        department: text(body.department),
      };
      if (!mentor.name || !mentor.email || !mentor.phone) {
        res.status(400).json({ message: 'กรุณากรอกชื่อ อีเมล และเบอร์โทรของพนักงานที่ปรึกษา (พี่เลี้ยง)' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mentor.email)) {
        res.status(400).json({ message: 'รูปแบบอีเมลของพนักงานที่ปรึกษาไม่ถูกต้อง' });
        return;
      }
      if (
        mentor.name.length > 255 || mentor.position.length > 255 || mentor.department.length > 255 ||
        mentor.email.length > 254 || mentor.phone.length > 50
      ) {
        res.status(400).json({ message: 'ข้อมูลพนักงานที่ปรึกษายาวเกินกำหนด' });
        return;
      }

      await IntentFormModel.setMentorWithTransaction(intentId, req.user.userId, mentor);

      await writeAudit(
        {
          action: AuditAction.INTENT_MENTOR_SET,
          entityType: 'intent_form',
          entityId: intentId,
          subjectId: req.user.userId,
        },
        req
      );

      res.status(200).json({ message: 'บันทึกข้อมูลพี่เลี้ยงเรียบร้อยแล้ว รออาจารย์นิเทศยืนยันก่อนระบบส่งลิงก์เข้าใช้งานให้พี่เลี้ยง' });
    } catch (error) {
      if (error instanceof IntentConflictError) {
        // `extra` ของ internship_not_started = { opens_on } — หน้าจอใช้บอกวันที่เปิดให้ระบุ
        res.status(409).json({ message: error.message, code: error.code, ...error.extra });
        return;
      }
      // ข้อความจากโมเดลเป็นภาษาไทยและอธิบายสาเหตุอยู่แล้ว (SEC-03 · สถานะไม่ถูก · ไม่ใช่ของตัวเอง)
      res.status(400).json({ message: getErrorMessage(error, 'บันทึกข้อมูลพี่เลี้ยงไม่สำเร็จ') });
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
      notifyStudentStatusChange(intentId, 'student_reported_fail').catch(console.error);

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
        `SELECT i.form_id, i.student_id, i.company_id, i.status,
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
        // ⛔ การกดรับไม่เกี่ยวกับพี่เลี้ยงแล้ว — ไม่ต้องมีพี่เลี้ยง ไม่เปิดบัญชี ไม่ส่งลิงก์
        //    คณะรู้ตัวพี่เลี้ยงหลังนักศึกษาเริ่มฝึก: นักศึกษาระบุบนใบ `accepted` แล้วอาจารย์นิเทศยืนยันที่
        //    `POST /api/mentor-followup/:mentorId/confirm` (ด่าน SEC-03/15 ย้ายไปอยู่ที่นั่นทั้งก้อน)

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
        await recordStageEvent(client, intentId, 'accepted');

        await writeAudit({
          action: AuditAction.ACCEPTANCE_OFFICER_DECISION,
          entityType: 'intent_form',
          entityId: intentId,
          subjectId: intent.student_id,
          detail: {
            decision: 'accepted',
            acceptance_signer_name: signerName,
            acceptance_signed_date: signedDate,
          },
        }, req, client);

        await client.query('COMMIT');

        // Notify student of approval
        notifyStudentStatusChange(intentId, 'accepted').catch(console.error);

        res.status(200).json({ success: true, message: 'อนุมัติเอกสารตอบรับเรียบร้อยแล้ว' });
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
                  acceptance_source = NULL, acceptance_form_fill = NULL,
                  company_mail_count = 0
            WHERE form_id = $1`,
          [intentId, reason]
        );
        await recordStageEvent(client, intentId, 'acceptance_returned');

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
