import { Request, Response } from 'express';
import { query } from '../config/database';
import { assertCanReviewStudentWork, sendAccessError } from '../utils/access';
import { sendUnexpectedError } from '../utils/httpError';
import { writeAudit } from '../utils/audit';

export class MonthlyLogController {
  /**
   * Student submits or saves draft for monthly log (สหกิจ 10)
   * Route: POST /api/monthly-logs
   * Access: student
   */
  static async submitLog(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = req.user.userId;
      const {
        year,
        month,
        work_summary,
        effectiveness,
        status = 'draft',
        start_date,
        end_date,
        summary,
      } = req.body;

      if (year === undefined || month === undefined) {
        res.status(400).json({ message: 'Missing required fields: year, month.' });
        return;
      }

      const parsedYear = parseInt(year, 10);
      const parsedMonth = parseInt(month, 10);

      if (isNaN(parsedYear) || isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
        res.status(400).json({ message: 'Invalid year or month.' });
        return;
      }

      // Check if student has an active intent
      const intentRes = await query(
        `SELECT form_id, company_id, mentor_id, start_date, end_date, uses_company_log_form
         FROM intent_forms
         WHERE student_id = $1 AND status = 'accepted'
         ORDER BY form_id DESC LIMIT 1`,
        [studentId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'No accepted cooperative education intent found.' });
        return;
      }

      const intent = intentRes.rows[0];
      const filePath = req.file ? `work_logs/${req.file.filename}` : (req.body.external_file_path || null);

      if (status === 'submitted') {
        if (intent.uses_company_log_form) {
          if (!filePath) {
            res.status(400).json({ message: 'กรุณาแนบไฟล์บันทึกการทำงานของสถานประกอบการ' });
            return;
          }
          if (!summary || !summary.trim()) {
            res.status(400).json({ message: 'กรุณากรอกสรุปสั้นๆ 1–2 บรรทัดเมื่อแนบไฟล์' });
            return;
          }
        } else {
          if (!work_summary || !effectiveness) {
            res.status(400).json({
              message: 'กรุณากรอกข้อมูลให้ครบทั้ง 2 หัวข้อหลัก (สรุปผลการปฏิบัติงาน, ประสิทธิภาพและประสิทธิผลของงาน)',
            });
            return;
          }
        }
      }

      // Check existing monthly log
      const existingRes = await query(
        `SELECT monthly_log_id, mentor_certified_at, mentor_certified_by
         FROM monthly_logs
         WHERE student_id = $1 AND year = $2 AND month = $3`,
        [studentId, parsedYear, parsedMonth]
      );

      let logId: number;

      if ((existingRes.rowCount ?? 0) > 0) {
        const existing = existingRes.rows[0];
        logId = existing.monthly_log_id;

        const wasCertified = existing.mentor_certified_at !== null;

        await query(
          `UPDATE monthly_logs
           SET work_summary = $1,
               effectiveness = $2,
               status = $3,
               start_date = $4,
               end_date = $5,
               external_file_path = $6,
               summary = $7,
               mentor_certified_by = NULL,
               mentor_certified_at = NULL,
               returned_comment = CASE WHEN $3::varchar = 'submitted' THEN NULL ELSE returned_comment END,
               submitted_at = CASE WHEN $3::varchar = 'submitted' THEN CURRENT_TIMESTAMP ELSE submitted_at END,
               updated_at = CURRENT_TIMESTAMP
           WHERE monthly_log_id = $8`,
          [
            work_summary || null,
            effectiveness || null,
            status,
            start_date || null,
            end_date || null,
            filePath,
            summary || null,
            logId,
          ]
        );

        if (wasCertified) {
          await writeAudit(
            {
              action: 'work_log.mentor_certification_cleared',
              entityType: 'monthly_logs',
              entityId: logId,
              subjectId: studentId,
              detail: { year: parsedYear, month: parsedMonth, reason: 'Student updated certified monthly log' },
            },
            req
          );
        }
      } else {
        const insertRes = await query(
          `INSERT INTO monthly_logs (
             student_id, year, month, work_summary, effectiveness,
             status, start_date, end_date, external_file_path, summary, submitted_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             CASE WHEN $6::varchar = 'submitted' THEN CURRENT_TIMESTAMP ELSE NULL END
           ) RETURNING monthly_log_id`,
          [
            studentId,
            parsedYear,
            parsedMonth,
            work_summary || null,
            effectiveness || null,
            status,
            start_date || null,
            end_date || null,
            filePath,
            summary || null,
          ]
        );
        logId = insertRes.rows[0].monthly_log_id;
      }

      res.status(201).json({
        success: true,
        message: status === 'submitted' ? 'ส่งบันทึกการปฏิบัติงานประจำเดือนเรียบร้อยแล้ว' : 'บันทึกร่างเรียบร้อยแล้ว',
        data: { monthly_log_id: logId, external_file_path: filePath },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Submit Monthly Log Error', 'An internal server error occurred.');
    }
  }

  /**
   * Student gets own monthly logs
   * Route: GET /api/monthly-logs/me
   * Access: student
   */
  static async getMyLogs(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = req.user.userId;

      const logsRes = await query(
        `SELECT m.monthly_log_id, m.student_id, m.year, m.month, m.work_summary,
                m.effectiveness, m.status, m.start_date, m.end_date,
                m.external_file_path, m.summary, m.mentor_certified_by, m.mentor_certified_at,
                m.returned_comment, m.submitted_at, m.created_at, m.updated_at,
                men.name as mentor_certified_name
         FROM monthly_logs m
         LEFT JOIN mentors men ON m.mentor_certified_by = men.mentor_id
         WHERE m.student_id = $1
         ORDER BY m.year ASC, m.month ASC`,
        [studentId]
      );

      res.status(200).json({
        success: true,
        data: logsRes.rows,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get My Monthly Logs Error', 'An internal server error occurred.');
    }
  }

  /**
   * Mentor certifies a monthly log
   * Route: PATCH /api/monthly-logs/:id/certify
   * Access: mentor
   */
  static async certifyLog(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const logId = parseInt(req.params.id, 10);
      if (isNaN(logId)) {
        res.status(400).json({ message: 'Invalid log ID.' });
        return;
      }

      const mentorUserId = req.user.userId;

      const checkRes = await query(
        `SELECT m.monthly_log_id, m.student_id, m.year, m.month
         FROM monthly_logs m
         JOIN intent_forms i ON m.student_id = i.student_id
         WHERE m.monthly_log_id = $1 AND i.mentor_id = $2 AND i.status = 'accepted'`,
        [logId, mentorUserId]
      );

      if ((checkRes.rowCount ?? 0) === 0) {
        res.status(403).json({ message: 'Forbidden. You are not assigned as mentor for this student.' });
        return;
      }

      const log = checkRes.rows[0];

      await query(
        `UPDATE monthly_logs
         SET mentor_certified_by = $1,
             mentor_certified_at = CURRENT_TIMESTAMP,
             returned_comment = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE monthly_log_id = $2`,
        [mentorUserId, logId]
      );

      await writeAudit(
        {
          action: 'work_log.certified',
          entityType: 'monthly_logs',
          entityId: logId,
          subjectId: log.student_id,
          detail: { year: log.year, month: log.month },
        },
        req
      );

      res.status(200).json({
        success: true,
        message: 'รับรองบันทึกการปฏิบัติงานประจำเดือนเรียบร้อยแล้ว',
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Certify Monthly Log Error', 'An internal server error occurred.');
    }
  }

  /**
   * Mentor returns a monthly log for revision
   * Route: PATCH /api/monthly-logs/:id/return
   * Access: mentor
   */
  static async returnLog(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const logId = parseInt(req.params.id, 10);
      if (isNaN(logId)) {
        res.status(400).json({ message: 'Invalid log ID.' });
        return;
      }

      const { returned_comment } = req.body;
      if (!returned_comment || !returned_comment.trim()) {
        res.status(400).json({ message: 'กรุณาระบุเหตุผลหรือข้อเสนอแนะในการส่งกลับ' });
        return;
      }

      const mentorUserId = req.user.userId;

      const checkRes = await query(
        `SELECT m.monthly_log_id, m.student_id, m.year, m.month
         FROM monthly_logs m
         JOIN intent_forms i ON m.student_id = i.student_id
         WHERE m.monthly_log_id = $1 AND i.mentor_id = $2 AND i.status = 'accepted'`,
        [logId, mentorUserId]
      );

      if ((checkRes.rowCount ?? 0) === 0) {
        res.status(403).json({ message: 'Forbidden. You are not assigned as mentor for this student.' });
        return;
      }

      const log = checkRes.rows[0];

      await query(
        `UPDATE monthly_logs
         SET status = 'returned',
             returned_comment = $1,
             mentor_certified_by = NULL,
             mentor_certified_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE monthly_log_id = $2`,
        [returned_comment.trim(), logId]
      );

      await writeAudit(
        {
          action: 'work_log.returned',
          entityType: 'monthly_logs',
          entityId: logId,
          subjectId: log.student_id,
          detail: { year: log.year, month: log.month, comment: returned_comment.trim() },
        },
        req
      );

      res.status(200).json({
        success: true,
        message: 'ส่งกลับบันทึกการปฏิบัติงานให้นักศึกษาแก้ไขเรียบร้อยแล้ว',
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Return Monthly Log Error', 'An internal server error occurred.');
    }
  }

  /**
   * Fetch logs for Mentor/Advisor/Student
   * Route: GET /api/monthly-logs/student/:id
   * Access: student, mentor, advisor, dept_head
   */
  static async getStudentLogs(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const targetStudentId = parseInt(req.params.id, 10);
      if (isNaN(targetStudentId)) {
        res.status(400).json({ message: 'Invalid student ID.' });
        return;
      }

      const { roles, userId } = req.user;

      if (roles.includes('student') && userId !== targetStudentId) {
        res.status(403).json({ message: 'Forbidden. You can only view your own logs.' });
        return;
      }

      if (roles.includes('mentor')) {
        const intentRes = await query(
          `SELECT form_id FROM intent_forms i
           WHERE i.student_id = $1 AND i.mentor_id = $2 AND i.status = 'accepted'`,
          [targetStudentId, userId]
        );
        if ((intentRes.rowCount ?? 0) === 0) {
          res.status(403).json({ message: 'Forbidden. This student is not assigned to you.' });
          return;
        }
      }

      if (roles.some((r) => ['advisor', 'dept_head', 'staff', 'dean'].includes(r))) {
        await assertCanReviewStudentWork(userId, roles, targetStudentId);
      }

      const logsRes = await query(
        `SELECT m.monthly_log_id, m.student_id, m.year, m.month, m.work_summary,
                m.effectiveness, m.status, m.start_date, m.end_date,
                m.external_file_path, m.summary, m.mentor_certified_by, m.mentor_certified_at,
                m.returned_comment, m.submitted_at, m.created_at, m.updated_at,
                men.name as mentor_certified_name
         FROM monthly_logs m
         LEFT JOIN mentors men ON m.mentor_certified_by = men.mentor_id
         WHERE m.student_id = $1 
         ORDER BY m.year ASC, m.month ASC`,
        [targetStudentId]
      );

      res.status(200).json({
        success: true,
        data: logsRes.rows,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Monthly Logs Error', 'An internal server error occurred.');
    }
  }
}
