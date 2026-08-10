import { Request, Response } from 'express';
import { query } from '../config/database';
import { assertCanReviewStudentWork, sendAccessError } from '../utils/access';

export class WeeklyLogController {
  /**
   * Student submits weekly log
   * Route: POST /api/weekly-logs
   * Access: student
   */
  static async submitLog(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = req.user.userId;
      const { week_number, achievements, problems } = req.body;

      if (week_number === undefined || !achievements) {
        res.status(400).json({ message: 'Missing required fields: week_number, achievements.' });
        return;
      }

      const weekNum = parseInt(week_number, 10);
      if (isNaN(weekNum) || weekNum < 1 || weekNum > 16) {
        res.status(400).json({ message: 'Week number must be between 1 and 16.' });
        return;
      }

      // Check if student has an active intent
      const intentRes = await query(
        `SELECT company_id FROM intent_forms WHERE student_id = $1 AND status = 'accepted'`,
        [studentId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'No accepted cooperative education intent found.' });
        return;
      }

      // Upsert weekly log
      const existingRes = await query(
        `SELECT weekly_log_id FROM weekly_logs WHERE student_id = $1 AND week_number = $2`,
        [studentId, weekNum]
      );

      let logId;
      if ((existingRes.rowCount ?? 0) > 0) {
        logId = existingRes.rows[0].weekly_log_id;
        await query(
          `UPDATE weekly_logs SET achievements = $1, problems = $2, submitted_at = CURRENT_TIMESTAMP WHERE weekly_log_id = $3`,
          [achievements, problems || null, logId]
        );
      } else {
        const insertRes = await query(
          `INSERT INTO weekly_logs (student_id, week_number, achievements, problems) VALUES ($1, $2, $3, $4) RETURNING weekly_log_id`,
          [studentId, weekNum, achievements, problems || null]
        );
        logId = insertRes.rows[0].weekly_log_id;
      }

      res.status(201).json({
        success: true,
        message: 'Weekly log submitted successfully.',
        data: { weekly_log_id: logId }
      });
    } catch (error: any) {
      console.error('Submit Weekly Log Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
    }
  }

  /**
   * Fetch logs for Mentor/Advisor/Student
   * Route: GET /api/weekly-logs/student/:id
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

      // Access control
      if (roles.includes('student') && userId !== targetStudentId) {
        res.status(403).json({ message: 'Forbidden. You can only view your own logs.' });
        return;
      }

      if (roles.includes('mentor')) {
        // Mentor can only see logs of their students
        const intentRes = await query(
          `SELECT form_id FROM intent_forms WHERE student_id = $1 AND mentor_id = $2 AND status = 'accepted'`,
          [targetStudentId, userId]
        );
        if ((intentRes.rowCount ?? 0) === 0) {
          res.status(403).json({ message: 'Forbidden. This student is not assigned to you.' });
          return;
        }
      }

      // SEC-06: the advisor/dept_head branch used to be deliberately skipped, which
      // let any advisor read every student's daily diary entries. Scope it the same
      // way every other student-work endpoint is scoped.
      if (roles.some((r) => ['advisor', 'dept_head', 'staff', 'dean'].includes(r))) {
        await assertCanReviewStudentWork(userId, roles, targetStudentId);
      }

      const logsRes = await query(
        `SELECT weekly_log_id, week_number, achievements, problems, submitted_at 
         FROM weekly_logs 
         WHERE student_id = $1 
         ORDER BY week_number ASC`,
        [targetStudentId]
      );

      res.status(200).json({
        success: true,
        data: logsRes.rows
      });
    } catch (error: any) {
      if (sendAccessError(res, error)) return;
      console.error('Get Weekly Logs Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
    }
  }
}
