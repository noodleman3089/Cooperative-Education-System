import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';
import { drawReportConfirmationPdf, fetchReportConfirmationData } from '../utils/reportConfirmationPdf';

export class ReportConfirmationController {
  /**
   * Student requests confirmation from Advisor (Step 3)
   * Route: POST /api/report-confirmations
   * Access: student
   */
  static async requestConfirmation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = req.user.userId;

      // Verify that student has an approved final report from advisor
      const reportRes = await query(
        `SELECT report_id FROM final_reports
         WHERE student_id = $1 AND reviewer_kind = 'advisor' AND status = 'approved'
         ORDER BY version DESC LIMIT 1`,
        [studentId]
      );

      if ((reportRes.rowCount ?? 0) === 0) {
        res.status(400).json({
          message: 'รายงานฉบับสมบูรณ์ต้องได้รับการอนุมัติจากอาจารย์ที่ปรึกษาก่อน จึงจะสามารถขอใบยืนยันการส่งรายงาน (สหกิจ 14) ได้'
        });
        return;
      }

      const reportId = reportRes.rows[0].report_id;

      const confirmRes = await query(
        `INSERT INTO report_confirmations (student_id, report_id, status, requested_at)
         VALUES ($1, $2, 'pending', NOW())
         ON CONFLICT (student_id) DO UPDATE SET
           report_id = EXCLUDED.report_id,
           requested_at = NOW(),
           status = 'pending',
           certified_by = NULL,
           certified_at = NULL
         RETURNING confirmation_id`,
        [studentId, reportId]
      );

      const confirmationId = confirmRes.rows[0].confirmation_id;

      writeAudit({
        action: AuditAction.DOCUMENT_SIGNED,
        entityType: 'report_confirmation',
        entityId: confirmationId,
        subjectId: studentId,
        detail: { report_id: reportId, status: 'pending' },
      }, req).catch(() => undefined);

      res.status(201).json({
        success: true,
        message: 'ยื่นคำขอให้อาจารย์ที่ปรึกษารับรองการส่งรายงาน (สหกิจ 14) เรียบร้อยแล้ว',
        data: { confirmation_id: confirmationId, status: 'pending' }
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Request Report Confirmation Error', 'An internal server error occurred.');
    }
  }

  /**
   * Get student's own confirmation status
   * Route: GET /api/report-confirmations/me
   * Access: student
   */
  static async getMyConfirmation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = req.user.userId;

      const resDb = await query(
        `SELECT rc.confirmation_id, rc.report_id, rc.status, rc.requested_at, rc.certified_at,
                p.first_name as certified_by_first_name, p.last_name as certified_by_last_name
         FROM report_confirmations rc
         LEFT JOIN personnel p ON rc.certified_by = p.personnel_id
         WHERE rc.student_id = $1
         LIMIT 1`,
        [studentId]
      );

      res.status(200).json({
        success: true,
        data: resDb.rows[0] || null
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Confirmation Error', 'An internal server error occurred.');
    }
  }

  /**
   * Advisor certifies report confirmation (สหกิจ 14)
   * Route: PATCH /api/report-confirmations/:id/certify
   * Access: advisor only
   */
  static async certifyConfirmation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const confirmationId = parseInt(req.params.id, 10);
      if (isNaN(confirmationId)) {
        res.status(400).json({ message: 'Invalid confirmation ID.' });
        return;
      }

      const advisorId = req.user.userId;

      // Verify confirmation exists and student belongs to advisor
      const checkRes = await query(
        `SELECT rc.student_id, rc.status, s.advisor_id
         FROM report_confirmations rc
         JOIN students s ON rc.student_id = s.student_id
         WHERE rc.confirmation_id = $1`,
        [confirmationId]
      );

      if ((checkRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบใบยืนยันการส่งรายงานที่ระบุ' });
        return;
      }

      const { student_id, advisor_id } = checkRes.rows[0];

      if (advisor_id !== advisorId) {
        res.status(403).json({ message: 'Forbidden. คุณไม่ใช่อาจารย์ที่ปรึกษาของนักศึกษาคนนี้' });
        return;
      }

      await query(
        `UPDATE report_confirmations
         SET status = 'certified', certified_by = $1, certified_at = NOW()
         WHERE confirmation_id = $2`,
        [advisorId, confirmationId]
      );

      writeAudit({
        action: AuditAction.DOCUMENT_SIGNED,
        entityType: 'report_confirmation',
        entityId: confirmationId,
        subjectId: student_id,
        detail: { status: 'certified', certified_by: advisorId },
      }, req).catch(() => undefined);

      res.status(200).json({
        success: true,
        message: 'ลงนามรับรองใบแจ้งยืนยันการส่งรายงาน (สหกิจ 14) เรียบร้อยแล้ว'
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Certify Confirmation Error', 'An internal server error occurred.');
    }
  }

  /**
   * Student prints own confirmation PDF (สหกิจ 14)
   * Route: GET /api/report-confirmations/print
   * Access: student
   */
  static async printConfirmation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = req.user.userId;
      const data = await fetchReportConfirmationData(studentId);

      if (!data) {
        res.status(404).json({ message: 'ไม่พบข้อมูลสำหรับจัดพิมพ์ใบแจ้งยืนยันการส่งรายงาน' });
        return;
      }

      const pdfBytes = await drawReportConfirmationPdf(data);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="sahatkit-14-confirmation.pdf"');
      res.send(Buffer.from(pdfBytes));
    } catch (error) {
      sendUnexpectedError(res, error, 'Print Confirmation Error', 'An internal server error occurred.');
    }
  }
}
