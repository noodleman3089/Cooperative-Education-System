import { Request, Response } from 'express';
import { query } from '../config/database';
import { sendFinalReportNotificationEmail } from '../utils/email';
import { assertAssignedDuty, assertCanReviewStudentWork, sendAccessError } from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';
import { issueMentorLoginLink, MENTOR_LINK_TTL_SYSTEM_MS } from '../utils/mentorLoginLink';

export class FinalReportController {
  /**
   * Submit Final Report PDF (Student only)
   * Route: POST /api/final-reports
   * Supports: reviewer_kind = 'mentor' (Step 1 draft) or 'advisor' (Step 2 final)
   */
  static async submitReport(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ message: 'Required file upload: report.' });
        return;
      }

      const studentId = req.user.userId;
      const reviewerKind = req.body.reviewer_kind === 'mentor' ? 'mentor' : 'advisor';

      // 1. Check if Report Outline (สหกิจ 11) is Approved (required for advisor submission)
      if (reviewerKind === 'advisor') {
        const outlineRes = await query(
          `SELECT status FROM report_outlines WHERE student_id = $1 AND status = 'approved'`,
          [studentId]
        );

        if ((outlineRes.rowCount ?? 0) === 0) {
          res.status(400).json({
            message: 'โครงร่างรายงาน (สหกิจ 11) ต้องได้รับการอนุมัติจากอาจารย์นิเทศก่อน จึงจะสามารถอัปโหลดเล่มรายงานสมบูรณ์ได้'
          });
          return;
        }
      }

      const filePath = `final_reports/${req.file.filename}`;

      // 2. Get next version number per (student_id, reviewer_kind)
      const verRes = await query(
        `SELECT COALESCE(MAX(version), 0) as max_ver FROM final_reports WHERE student_id = $1 AND reviewer_kind = $2`,
        [studentId, reviewerKind]
      );
      const nextVer = Number(verRes.rows[0].max_ver) + 1;

      // 3. Save report details
      await query(
        `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
         VALUES ($1, $2, 'submitted', $3, $4)`,
        [studentId, filePath, nextVer, reviewerKind]
      );

      // 4. Trigger Auto-email to Mentor (Checks cooldown) if draft or advisor report
      await FinalReportController.sendMentorNotificationHelper(studentId);

      res.status(201).json({
        success: true,
        message: reviewerKind === 'mentor'
          ? 'อัปโหลดร่างรายงานให้พี่เลี้ยงตรวจสำเร็จแล้ว'
          : 'อัปโหลดเล่มรายงานฉบับสมบูรณ์สำเร็จแล้ว ระบบได้ส่งการแจ้งเตือนไปยังพี่เลี้ยงเรียบร้อย',
        data: { file_path: filePath, version: nextVer, reviewer_kind: reviewerKind }
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Submit Final Report Error', 'An internal server error occurred.');
    }
  }

  /**
   * Get student's own report history (both mentor drafts and advisor reports + intent metadata)
   * Route: GET /api/final-reports/my-report
   */
  static async getMyReport(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = req.user.userId;

      // Intent & dates
      const intentRes = await query(
        `SELECT i.start_date, i.end_date, c.name_th as company_name, m.name as mentor_name
         FROM intent_forms i
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
         WHERE i.student_id = $1 AND i.status = 'accepted'
         ORDER BY i.form_id DESC LIMIT 1`,
        [studentId]
      );
      const intent = intentRes.rows[0] || null;

      // Report outline status
      const outlineRes = await query(
        `SELECT status FROM report_outlines WHERE student_id = $1 AND status = 'approved' LIMIT 1`,
        [studentId]
      );
      const outlineApproved = (outlineRes.rowCount ?? 0) > 0;

      // Final reports list
      const reportRes = await query(
        `SELECT r.report_id, r.file_path, r.status, r.rejection_comment, r.version,
                r.reviewer_kind, r.reviewer_comment, r.submitted_at, r.reviewed_at,
                u.email as reviewer_email,
                p.first_name as advisor_first_name, p.last_name as advisor_last_name,
                m.name as mentor_reviewer_name
         FROM final_reports r
         LEFT JOIN users u ON r.reviewed_by = u.user_id
         LEFT JOIN personnel p ON r.reviewed_by = p.personnel_id
         LEFT JOIN mentors m ON r.reviewed_by = m.mentor_id
         WHERE r.student_id = $1
         ORDER BY r.version DESC`,
        [studentId]
      );

      // Report confirmation (สหกิจ 14)
      const confirmRes = await query(
        `SELECT rc.confirmation_id, rc.report_id, rc.status, rc.requested_at, rc.certified_at,
                p.first_name as certified_by_first_name, p.last_name as certified_by_last_name
         FROM report_confirmations rc
         LEFT JOIN personnel p ON rc.certified_by = p.personnel_id
         WHERE rc.student_id = $1
         LIMIT 1`,
        [studentId]
      );
      const confirmation = confirmRes.rows[0] || null;

      // Deadline mentor draft: intent.end_date - 14 days
      let deadlineMentorDraft: string | null = null;
      if (intent?.end_date) {
        const d = new Date(intent.end_date);
        d.setDate(d.getDate() - 14);
        deadlineMentorDraft = d.toISOString().split('T')[0];
      }

      res.status(200).json({
        success: true,
        data: {
          intent,
          outline_approved: outlineApproved,
          deadline_mentor_draft: deadlineMentorDraft,
          mentor_drafts: reportRes.rows.filter((r: { reviewer_kind: string }) => r.reviewer_kind === 'mentor'),
          advisor_reports: reportRes.rows.filter((r: { reviewer_kind: string }) => r.reviewer_kind === 'advisor'),
          confirmation,
        }
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get My Report Error', 'An internal server error occurred.');
    }
  }

  /**
   * ร่างรายงานที่นักศึกษาของพี่เลี้ยงคนนี้ส่งมาให้ตรวจ (ขั้นที่ 1 ก่อน สหกิจ 16)
   * Route: GET /api/final-reports/mentor
   * Access: mentor
   *
   * ⛔ คืนเฉพาะ `reviewer_kind = 'mentor'` — **เล่มที่ส่งอาจารย์พี่เลี้ยงไม่เห็น**
   *    สองอย่างนี้เดินคนละสาย และคนละคนเป็นผู้อนุมัติ
   * ⛔ fail closed: กรองด้วย `intent_forms.mentor_id` ที่สถานะ accepted เสมอ (SEC-06)
   *
   * หัวข้อรายงานมาจากโครงร่าง (สหกิจ 11) เวอร์ชันที่อนุมัติแล้ว — พี่เลี้ยงต้องรู้ว่า
   * กำลังอ่านร่างของหัวข้อไหน โดยไม่ต้องเปิดไฟล์ก่อน
   */
  static async getMentorDrafts(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const result = await query(
        `SELECT r.report_id, r.student_id, r.version, r.file_path, r.status,
                r.reviewer_comment, r.submitted_at, r.reviewed_at,
                s.student_code,
                btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) AS full_name,
                (i.end_date - 14) AS draft_due_date,
                ((i.end_date - 14) < (NOW() AT TIME ZONE 'Asia/Bangkok')::date) AS is_overdue,
                (SELECT v.report_title
                   FROM report_outlines o
                   JOIN report_outline_versions v ON v.outline_id = o.outline_id
                  WHERE o.student_id = s.student_id AND v.status IN ('approved', 'approved_without_mentor')
                  ORDER BY v.version_id DESC LIMIT 1) AS report_title
           FROM final_reports r
           JOIN intent_forms i ON i.student_id = r.student_id
           JOIN students s ON s.student_id = r.student_id
          WHERE r.reviewer_kind = 'mentor'
            AND i.mentor_id = $1 AND i.status = 'accepted'
          ORDER BY s.student_code, r.version DESC`,
        [req.user.userId]
      );

      res.status(200).json(
        result.rows.map((r) => ({
          ...r,
          draft_due_date: r.draft_due_date
            ? new Date(r.draft_due_date).toISOString().slice(0, 10)
            : null,
        }))
      );
    } catch (error) {
      sendUnexpectedError(res, error, 'Get mentor drafts error', 'ไม่สามารถโหลดร่างรายงานได้');
    }
  }

  /**
   * Mentor reviews draft report (Step 1)
   * Route: PATCH /api/final-reports/:id/mentor-review
   * Access: mentor
   */
  static async mentorReview(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const reportId = parseInt(req.params.id, 10);
      const { status, comment } = req.body;

      if (isNaN(reportId) || !status || !['approved', 'rejected'].includes(status)) {
        res.status(400).json({ message: 'Invalid request data. Status must be approved or rejected.' });
        return;
      }

      const mentorId = req.user.userId;

      // Verify report exists and reviewer_kind is mentor
      const reportRes = await query(
        `SELECT r.student_id, r.reviewer_kind
         FROM final_reports r
         WHERE r.report_id = $1`,
        [reportId]
      );
      if ((reportRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบร่างรายงานที่ระบุ' });
        return;
      }
      const { student_id, reviewer_kind } = reportRes.rows[0];
      if (reviewer_kind !== 'mentor') {
        res.status(400).json({ message: 'รายงานนี้ไม่ใช่ร่างที่ส่งให้พี่เลี้ยงตรวจ' });
        return;
      }

      // Check mentor assignment via intent_forms
      const mentorCheck = await query(
        `SELECT 1 FROM intent_forms WHERE student_id = $1 AND mentor_id = $2 AND status = 'accepted' LIMIT 1`,
        [student_id, mentorId]
      );
      if ((mentorCheck.rowCount ?? 0) === 0) {
        res.status(403).json({ message: 'Forbidden. นักศึกษาคนนี้ไม่ได้อยู่ในการดูแลของคุณ' });
        return;
      }

      await query(
        `UPDATE final_reports
         SET status = $1, reviewer_comment = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
         WHERE report_id = $4`,
        [status, comment || null, mentorId, reportId]
      );

      writeAudit({
        action: AuditAction.FINAL_REPORT_REVIEWED,
        entityType: 'final_report_draft',
        entityId: reportId,
        subjectId: student_id,
        detail: { status, reviewer_comment: comment ?? null },
      }, req).catch(() => undefined);

      res.status(200).json({
        success: true,
        message: `บันทึกผลการตรวจร่างรายงานเป็น ${status === 'approved' ? 'เห็นชอบ' : 'ส่งกลับให้แก้ไข'} เรียบร้อยแล้ว`
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Mentor Review Error', 'An internal server error occurred.');
    }
  }

  /**
   * Get report history of a specific student (For Advisor/Staff)
   * Route: GET /api/final-reports/student/:studentId
   */
  static async getStudentReports(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.studentId, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID.' });
        return;
      }

      await assertCanReviewStudentWork(req.user.userId, req.user.roles, studentId);

      const reportRes = await query(
        `SELECT r.report_id, r.file_path, r.status, r.rejection_comment, r.version, r.submitted_at, r.reviewed_at, u.email as reviewer_email
         FROM final_reports r
         LEFT JOIN users u ON r.reviewed_by = u.user_id
         WHERE r.student_id = $1
         ORDER BY r.version DESC`,
         [studentId]
      );

      res.status(200).json({
        success: true,
        data: reportRes.rows
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Student Reports Error', 'An internal server error occurred.');
    }
  }

  /**
   * Advisor approves or rejects a final report
   * Route: PATCH /api/final-reports/:id/status
   */
  static async reviewReport(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const reportId = parseInt(req.params.id, 10);
      const { status, comment } = req.body;

      if (isNaN(reportId) || !status || !['approved', 'rejected'].includes(status)) {
        res.status(400).json({ message: 'Invalid request data.' });
        return;
      }

      // เหตุผลการส่งกลับถูกเก็บบนแถวให้นักศึกษาอ่าน — ส่งกลับโดยไม่บอกว่าแก้อะไรคือทางตัน
      if (status === 'rejected' && !(typeof comment === 'string' && comment.trim())) {
        res.status(400).json({ message: 'กรุณาระบุข้อเสนอแนะว่าต้องแก้ไขอะไร ก่อนส่งเล่มรายงานกลับ' });
        return;
      }

      const reviewerId = req.user.userId;

      // SEC-06: this endpoint had no ownership check whatsoever — any advisor
      // could approve or reject any student's final report by guessing an id.
      const ownerRes = await query(
        'SELECT student_id, status, reviewer_kind FROM final_reports WHERE report_id = $1',
        [reportId]
      );
      if ((ownerRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบเล่มรายงานที่ระบุ' });
        return;
      }
      // SB-F9: ตรวจรับเล่มเป็นงานของอาจารย์ที่ปรึกษา (คู่กับ สหกิจ 14) ไม่ใช่อาจารย์นิเทศ
      await assertAssignedDuty(reviewerId, req.user.roles, ownerRes.rows[0].student_id, 'advisor');

      // allow-list (แนวเดียวกับ SEC-04): ตรวจรับได้เฉพาะเล่มฉบับสมบูรณ์ที่ส่งมารอตรวจ
      // · แถว reviewer_kind='mentor' คือร่างที่ส่งพี่เลี้ยง ไม่ใช่ของอาจารย์
      // · เล่มที่ตรวจไปแล้วห้ามกดทับ — สหกิจ 14 อ้างแถวที่ approved อยู่
      const { status: currentStatus, reviewer_kind: reviewerKind } = ownerRes.rows[0];
      if (reviewerKind !== 'advisor') {
        res.status(409).json({ message: 'แถวนี้เป็นร่างที่ส่งให้พนักงานที่ปรึกษาตรวจ ไม่ใช่เล่มฉบับสมบูรณ์' });
        return;
      }
      if (currentStatus !== 'submitted') {
        res.status(409).json({
          message: `เล่มรายงานฉบับนี้ตรวจไปแล้ว (สถานะปัจจุบัน: ${currentStatus === 'approved' ? 'ตรวจรับแล้ว' : 'ส่งกลับแก้ไข'})`,
        });
        return;
      }

      // Update report status
      await query(
        `UPDATE final_reports
         SET status = $1, rejection_comment = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
         WHERE report_id = $4`,
        [status, status === 'rejected' ? comment : null, reviewerId, reportId]
      );

      writeAudit({
        action: AuditAction.FINAL_REPORT_REVIEWED,
        entityType: 'final_report',
        entityId: reportId,
        subjectId: ownerRes.rows[0].student_id,
        detail: { status, comment: status === 'rejected' ? comment ?? null : null },
      }, req).catch(() => undefined);

      res.status(200).json({
        success: true,
        message: `บันทึกผลการตรวจสอบเป็น ${status === 'approved' ? 'อนุมัติ' : 'ตีกลับแก้ไข'} เรียบร้อยแล้ว`
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Review Report Error', 'An internal server error occurred.');
    }
  }

  /**
   * Manual email trigger to notify mentor (Advisor/Staff only)
   * Route: POST /api/final-reports/notify-mentor/:studentId
   */
  static async notifyMentor(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.studentId, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID.' });
        return;
      }

      await assertCanReviewStudentWork(req.user.userId, req.user.roles, studentId);

      const sent = await FinalReportController.sendMentorNotificationHelper(studentId, req.user.userId);

      if (sent === 'sent') {
        res.status(200).json({
          success: true,
          message: 'ส่งอีเมลแจ้งเตือนพนักงานที่ปรึกษา (พี่เลี้ยง) สำเร็จแล้ว'
        });
      } else if (sent === 'no_mentor') {
        res.status(409).json({
          code: 'mentor_not_ready',
          message: 'ยังแจ้งเตือนไม่ได้ เพราะนักศึกษายังไม่ได้ระบุพี่เลี้ยง หรือพี่เลี้ยงยังรออาจารย์นิเทศยืนยัน'
        });
      } else {
        res.status(429).json({
          message: 'ไม่สามารถส่งอีเมลแจ้งเตือนได้เนื่องจากยังอยู่ในช่วงเวลา Cooldown (ส่งได้วันละ 1 ครั้ง)'
        });
      }
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Notify Mentor Error', 'An internal server error occurred.');
    }
  }

  /**
   * Helper function for sending mentor notification email with rate limiting
   *
   * ⛔ ส่งถึงพี่เลี้ยงที่อาจารย์นิเทศยืนยันแล้วเท่านั้น (`is_active`) — ทางนี้นักศึกษากระตุ้นได้เองตอนอัปโหลดเล่ม
   *    อีเมลของพี่เลี้ยงที่ยังไม่ยืนยันคือที่อยู่ที่นักศึกษาพิมพ์ ระบบต้องไม่ส่งอะไรไป (SEC-03 · แนวเดียวกับ SEC-13)
   */
  private static async sendMentorNotificationHelper(
    studentId: number,
    sentBy: number | null = null
  ): Promise<'sent' | 'cooldown' | 'no_mentor'> {
    // 1. Fetch mentor credentials and student name
    const infoRes = await query(
      `SELECT i.mentor_id, m.name as mentor_name, u_men.email as mentor_email, s.first_name || ' ' || s.last_name as student_name, s.student_code
       FROM intent_forms i
       JOIN mentors m ON i.mentor_id = m.mentor_id
       JOIN users u_men ON i.mentor_id = u_men.user_id
       JOIN students s ON i.student_id = s.student_id
       WHERE i.student_id = $1 AND i.status = 'accepted' AND u_men.is_active = TRUE`,
      [studentId]
    );

    if ((infoRes.rowCount ?? 0) === 0) {
      console.warn(`[FinalReport] No confirmed mentor on an accepted placement for student ID: ${studentId}`);
      return 'no_mentor';
    }

    const { mentor_id, mentor_name, mentor_email, student_name, student_code } = infoRes.rows[0];

    // 2. Check Cooldown (24 hours)
    const notifyRes = await query(
      `SELECT last_notified_at FROM mentor_notifications WHERE student_id = $1`,
      [studentId]
    );

    if ((notifyRes.rowCount ?? 0) > 0) {
      const lastNotified = new Date(notifyRes.rows[0].last_notified_at).getTime();
      const now = Date.now();
      const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours cooldown

      if (now - lastNotified < cooldownMs) {
        console.log(`[FinalReport] Notification skipped. Still in cooldown for student ID ${studentId}.`);
        return 'cooldown';
      }

      // Update notification record
      await query(
        `UPDATE mentor_notifications 
         SET last_notified_at = CURRENT_TIMESTAMP, notification_count = notification_count + 1 
         WHERE student_id = $1`,
        [studentId]
      );
    } else {
      // Insert new notification record
      await query(
        `INSERT INTO mentor_notifications (student_id, last_notified_at, notification_count) 
         VALUES ($1, CURRENT_TIMESTAMP, 1)`,
        [studentId]
      );
    }

    // 3. Send the Email
    // ลิงก์เข้าสู่ระบบใช้ครั้งเดียวพาไปหน้าประเมินเลย — ไม่ได้ลิงก์ก็ส่งแค่ที่ชี้ไปหน้าขอลิงก์เอง
    const loginLink = await issueMentorLoginLink({
      userId: mentor_id,
      target: '/dashboard?menu=final_evaluation',
      ttlMs: MENTOR_LINK_TTL_SYSTEM_MS,
      skipCooldown: true,
    });
    await sendFinalReportNotificationEmail(
      mentor_email,
      mentor_name,
      student_name,
      student_code,
      loginLink && 'url' in loginLink ? loginLink.url : undefined
    );

    // นับเป็นการเตือนพี่เลี้ยงหนึ่งครั้ง (หน้า คณะตามพี่เลี้ยง · การ์ดนักศึกษา) — เขียนไม่ได้ก็ไม่ทำให้คำขอล้ม
    // เพราะเมลออกไปแล้วและ cooldown ของ mentor_notifications บันทึกไปแล้ว
    try {
      await query(
        `INSERT INTO mentor_reminders (mentor_id, student_id, kind, sent_by)
         VALUES ($1, $2, 'final_report', $3)`,
        [mentor_id, studentId, sentBy]
      );
    } catch (error) {
      console.error('[FinalReport] Failed to record mentor reminder', error);
    }
    return 'sent';
  }
}
