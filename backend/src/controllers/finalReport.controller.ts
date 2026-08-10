import { Request, Response } from 'express';
import { query } from '../config/database';
import { sendFinalReportNotificationEmail } from '../utils/email';
import { assertCanReviewStudentWork, sendAccessError } from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';

export class FinalReportController {
  /**
   * Submit Final Report PDF (Student only)
   * Route: POST /api/final-reports
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

      // 1. Check if Report Outline (สหกิจ 11) is Approved
      const outlineRes = await query(
        `SELECT status FROM report_outlines WHERE student_id = $1 AND status = 'approved'`,
        [studentId]
      );

      if ((outlineRes.rowCount ?? 0) === 0) {
        res.status(400).json({
          message: 'โครงร่างรายงาน (สหกิจ 11) ต้องได้รับการอนุมัติจากอาจารย์ที่ปรึกษาก่อน จึงจะสามารถอัปโหลดเล่มรายงานสมบูรณ์ได้'
        });
        return;
      }

      const filePath = `final_reports/${req.file.filename}`;

      // 2. Get next version number
      const verRes = await query(
        `SELECT COALESCE(MAX(version), 0) as max_ver FROM final_reports WHERE student_id = $1`,
        [studentId]
      );
      const nextVer = verRes.rows[0].max_ver + 1;

      // 3. Save report details
      await query(
        `INSERT INTO final_reports (student_id, file_path, status, version) VALUES ($1, $2, 'submitted', $3)`,
        [studentId, filePath, nextVer]
      );

      // 4. Trigger Auto-email to Mentor (Checks cooldown)
      await FinalReportController.sendMentorNotificationHelper(studentId);

      res.status(201).json({
        success: true,
        message: 'อัปโหลดเล่มรายงานฉบับสมบูรณ์สำเร็จแล้ว ระบบได้ส่งการแจ้งเตือนไปยังพี่เลี้ยงเรียบร้อย',
        data: { file_path: filePath, version: nextVer }
      });
    } catch (error: any) {
      console.error('Submit Final Report Error:', error);
      res.status(500).json({ message: error.message || 'An internal server error occurred.' });
    }
  }

  /**
   * Get student's own report history
   * Route: GET /api/final-reports/my-report
   */
  static async getMyReport(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = req.user.userId;

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
    } catch (error: any) {
      console.error('Get My Report Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
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
    } catch (error: any) {
      if (sendAccessError(res, error)) return;
      console.error('Get Student Reports Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
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

      const reviewerId = req.user.userId;

      // SEC-06: this endpoint had no ownership check whatsoever — any advisor
      // could approve or reject any student's final report by guessing an id.
      const ownerRes = await query('SELECT student_id FROM final_reports WHERE report_id = $1', [reportId]);
      if ((ownerRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบเล่มรายงานที่ระบุ' });
        return;
      }
      await assertCanReviewStudentWork(reviewerId, req.user.roles, ownerRes.rows[0].student_id);

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
    } catch (error: any) {
      if (sendAccessError(res, error)) return;
      console.error('Review Report Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
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

      const sent = await FinalReportController.sendMentorNotificationHelper(studentId);

      if (sent) {
        res.status(200).json({
          success: true,
          message: 'ส่งอีเมลแจ้งเตือนพนักงานที่ปรึกษา (พี่เลี้ยง) สำเร็จแล้ว'
        });
      } else {
        res.status(429).json({
          message: 'ไม่สามารถส่งอีเมลแจ้งเตือนได้เนื่องจากยังอยู่ในช่วงเวลา Cooldown (ส่งได้วันละ 1 ครั้ง)'
        });
      }
    } catch (error: any) {
      if (sendAccessError(res, error)) return;
      console.error('Notify Mentor Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
    }
  }

  /**
   * Helper function for sending mentor notification email with rate limiting
   */
  private static async sendMentorNotificationHelper(studentId: number): Promise<boolean> {
    // 1. Fetch mentor credentials and student name
    const infoRes = await query(
      `SELECT m.name as mentor_name, u_men.email as mentor_email, s.first_name || ' ' || s.last_name as student_name, s.student_code
       FROM intent_forms i
       JOIN mentors m ON i.mentor_id = m.mentor_id
       JOIN users u_men ON i.mentor_id = u_men.user_id
       JOIN students s ON i.student_id = s.student_id
       WHERE i.student_id = $1 AND i.status = 'accepted'`,
      [studentId]
    );

    if ((infoRes.rowCount ?? 0) === 0) {
      console.warn(`[FinalReport] No active accepted mentor found for student ID: ${studentId}`);
      return false;
    }

    const { mentor_name, mentor_email, student_name, student_code } = infoRes.rows[0];

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
        return false;
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
    await sendFinalReportNotificationEmail(mentor_email, mentor_name, student_name, student_code);
    return true;
  }
}
