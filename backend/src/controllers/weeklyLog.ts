import { Request, Response } from 'express';
import { query } from '../config/database';
import { assertCanReviewStudentWork, sendAccessError } from '../utils/access';
import { sendUnexpectedError } from '../utils/httpError';
import { writeAudit } from '../utils/audit';

export class WeeklyLogController {
  /**
   * Student submits or saves draft for weekly log (สหกิจ 09)
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
      const {
        week_number,
        assigned_work,
        methods,
        tools_used,
        achievements,
        problems,
        status = 'draft',
        start_date,
        end_date,
        summary,
      } = req.body;

      if (week_number === undefined) {
        res.status(400).json({ message: 'Missing required field: week_number.' });
        return;
      }

      const weekNum = parseInt(week_number, 10);
      if (isNaN(weekNum) || weekNum < 1) {
        res.status(400).json({ message: 'Week number must be at least 1.' });
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
          if (!assigned_work || !methods || !tools_used || !achievements) {
            res.status(400).json({
              message: 'กรุณากรอกข้อมูลให้ครบทั้ง 4 หัวข้อหลัก (งานที่ได้รับมอบหมาย, วิธีการ, เครื่องมือ, ผลการปฏิบัติงาน)',
            });
            return;
          }
        }
      }

      // หน้าจอนักศึกษาไม่ได้ส่งช่วงวันที่มา — ถ้าเก็บ NULL พี่เลี้ยงจะเห็น "ช่วง – – –" บนใบที่ต้องรับรอง
      // คิดจากวันเริ่มปฏิบัติงานใน SQL ล้วน (ไม่ผ่าน Date ของ Node กันวันเลื่อน) · จันทร์–ศุกร์ = +4
      // ตรงกับป้ายสัปดาห์ที่นักศึกษาเห็นใน WeeklyLog.tsx
      const weekStartSql = `(SELECT start_date + ($2::int - 1) * 7 FROM intent_forms WHERE form_id = $1)`;
      const weekDates = await query(
        `SELECT ${weekStartSql} AS week_start, ${weekStartSql} + 4 AS week_end`,
        [intent.form_id, weekNum]
      );
      const weekStart = start_date || weekDates.rows[0].week_start || null;
      const weekEnd = end_date || weekDates.rows[0].week_end || null;

      // Check existing weekly log
      const existingRes = await query(
        `SELECT weekly_log_id, mentor_certified_at, mentor_certified_by
         FROM weekly_logs
         WHERE student_id = $1 AND week_number = $2`,
        [studentId, weekNum]
      );

      let logId: number;

      if ((existingRes.rowCount ?? 0) > 0) {
        const existing = existingRes.rows[0];
        logId = existing.weekly_log_id;

        const wasCertified = existing.mentor_certified_at !== null;

        await query(
          `UPDATE weekly_logs
           SET assigned_work = $1,
               methods = $2,
               tools_used = $3,
               achievements = $4,
               problems = $5,
               status = $6,
               start_date = $7,
               end_date = $8,
               external_file_path = $9,
               summary = $10,
               mentor_certified_by = NULL,
               mentor_certified_at = NULL,
               returned_comment = CASE WHEN $6::varchar = 'submitted' THEN NULL ELSE returned_comment END,
               submitted_at = CASE WHEN $6::varchar = 'submitted' THEN CURRENT_TIMESTAMP ELSE submitted_at END,
               updated_at = CURRENT_TIMESTAMP
           WHERE weekly_log_id = $11`,
          [
            assigned_work || null,
            methods || null,
            tools_used || null,
            achievements || null,
            problems || null,
            status,
            weekStart,
            weekEnd,
            filePath,
            summary || null,
            logId,
          ]
        );

        if (wasCertified) {
          await writeAudit(
            {
              action: 'work_log.mentor_certification_cleared',
              entityType: 'weekly_logs',
              entityId: logId,
              subjectId: studentId,
              detail: { week_number: weekNum, reason: 'Student updated certified weekly log' },
            },
            req
          );
        }
      } else {
        const insertRes = await query(
          `INSERT INTO weekly_logs (
             student_id, week_number, assigned_work, methods, tools_used,
             achievements, problems, status, start_date, end_date,
             external_file_path, summary, submitted_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $8::varchar = 'submitted' THEN CURRENT_TIMESTAMP ELSE NULL END
           ) RETURNING weekly_log_id`,
          [
            studentId,
            weekNum,
            assigned_work || null,
            methods || null,
            tools_used || null,
            achievements || null,
            problems || null,
            status,
            weekStart,
            weekEnd,
            filePath,
            summary || null,
          ]
        );
        logId = insertRes.rows[0].weekly_log_id;
      }

      res.status(201).json({
        success: true,
        message: status === 'submitted' ? 'ส่งบันทึกการปฏิบัติงานรายสัปดาห์เรียบร้อยแล้ว' : 'บันทึกร่างเรียบร้อยแล้ว',
        data: { weekly_log_id: logId, external_file_path: filePath },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Submit Weekly Log Error', 'An internal server error occurred.');
    }
  }

  /**
   * Student gets all own weekly logs + intent metadata + current DB date
   * Route: GET /api/weekly-logs/me
   * Access: student
   */
  static async getMyLogs(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = req.user.userId;

      // Intent & company & mentor info
      const intentRes = await query(
        `SELECT i.form_id, i.start_date, i.end_date, i.uses_company_log_form,
                c.company_id, c.name_th as company_name_th,
                m.mentor_id, m.name as mentor_name
         FROM intent_forms i
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
         WHERE i.student_id = $1 AND i.status = 'accepted'
         ORDER BY i.form_id DESC LIMIT 1`,
        [studentId]
      );

      const todayRes = await query(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date as today`);
      const today = todayRes.rows[0]?.today;

      const logsRes = await query(
        `SELECT w.weekly_log_id, w.student_id, w.week_number, w.assigned_work, w.methods,
                w.tools_used, w.achievements, w.problems, w.status, w.start_date, w.end_date,
                w.external_file_path, w.summary, w.mentor_certified_by, w.mentor_certified_at,
                w.returned_comment, w.submitted_at, w.created_at, w.updated_at,
                m.name as mentor_certified_name
         FROM weekly_logs w
         LEFT JOIN mentors m ON w.mentor_certified_by = m.mentor_id
         WHERE w.student_id = $1
         ORDER BY w.week_number ASC`,
        [studentId]
      );

      res.status(200).json({
        success: true,
        data: {
          intent: intentRes.rows[0] || null,
          today,
          logs: logsRes.rows,
        },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get My Weekly Logs Error', 'An internal server error occurred.');
    }
  }

  /**
   * Mentor certifies a weekly log
   * Route: PATCH /api/weekly-logs/:id/certify
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

      // Verify mentor is assigned to this student's active intent
      const checkRes = await query(
        `SELECT w.weekly_log_id, w.student_id, w.week_number
         FROM weekly_logs w
         JOIN intent_forms i ON w.student_id = i.student_id
         WHERE w.weekly_log_id = $1 AND i.mentor_id = $2 AND i.status = 'accepted'`,
        [logId, mentorUserId]
      );

      if ((checkRes.rowCount ?? 0) === 0) {
        res.status(403).json({ message: 'Forbidden. You are not assigned as mentor for this student.' });
        return;
      }

      const log = checkRes.rows[0];

      const updated = await query(
        `UPDATE weekly_logs
         SET mentor_certified_by = $1,
             mentor_certified_at = CURRENT_TIMESTAMP,
             returned_comment = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE weekly_log_id = $2 AND status = 'submitted'
         RETURNING weekly_log_id`,
        [mentorUserId, logId]
      );

      // เดิมไม่ดูสถานะ — ยิง API ตรงแล้วรับรอง/ส่งกลับใบร่างได้ (รายวันตรวจอยู่แล้ว)
      // ใบที่รับรองแล้วสถานะยังเป็น submitted จึงยังส่งกลับได้ — ทางแก้เดียวเมื่อพี่เลี้ยงกดรับรองผิด
      if ((updated.rowCount ?? 0) === 0) {
        res.status(409).json({ message: 'บันทึกนี้ยังไม่ได้ส่ง หรือถูกส่งกลับให้แก้ไขแล้ว' });
        return;
      }

      await writeAudit(
        {
          action: 'work_log.certified',
          entityType: 'weekly_logs',
          entityId: logId,
          subjectId: log.student_id,
          detail: { week_number: log.week_number },
        },
        req
      );

      res.status(200).json({
        success: true,
        message: 'รับรองบันทึกการปฏิบัติงานเรียบร้อยแล้ว',
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Certify Weekly Log Error', 'An internal server error occurred.');
    }
  }

  /**
   * Mentor returns a weekly log for revision
   * Route: PATCH /api/weekly-logs/:id/return
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
        `SELECT w.weekly_log_id, w.student_id, w.week_number
         FROM weekly_logs w
         JOIN intent_forms i ON w.student_id = i.student_id
         WHERE w.weekly_log_id = $1 AND i.mentor_id = $2 AND i.status = 'accepted'`,
        [logId, mentorUserId]
      );

      if ((checkRes.rowCount ?? 0) === 0) {
        res.status(403).json({ message: 'Forbidden. You are not assigned as mentor for this student.' });
        return;
      }

      const log = checkRes.rows[0];

      const updated = await query(
        `UPDATE weekly_logs
         SET status = 'returned',
             returned_comment = $1,
             mentor_certified_by = NULL,
             mentor_certified_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE weekly_log_id = $2 AND status = 'submitted'
         RETURNING weekly_log_id`,
        [returned_comment.trim(), logId]
      );

      // เดิมไม่ดูสถานะ — ยิง API ตรงแล้วรับรอง/ส่งกลับใบร่างได้ (รายวันตรวจอยู่แล้ว)
      // ใบที่รับรองแล้วสถานะยังเป็น submitted จึงยังส่งกลับได้ — ทางแก้เดียวเมื่อพี่เลี้ยงกดรับรองผิด
      if ((updated.rowCount ?? 0) === 0) {
        res.status(409).json({ message: 'บันทึกนี้ยังไม่ได้ส่ง หรือถูกส่งกลับให้แก้ไขแล้ว' });
        return;
      }

      await writeAudit(
        {
          action: 'work_log.returned',
          entityType: 'weekly_logs',
          entityId: logId,
          subjectId: log.student_id,
          detail: { week_number: log.week_number, comment: returned_comment.trim() },
        },
        req
      );

      res.status(200).json({
        success: true,
        message: 'ส่งกลับบันทึกการปฏิบัติงานให้นักศึกษาแก้ไขเรียบร้อยแล้ว',
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Return Weekly Log Error', 'An internal server error occurred.');
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
        `SELECT w.weekly_log_id, w.student_id, w.week_number, w.assigned_work, w.methods,
                w.tools_used, w.achievements, w.problems, w.status, w.start_date, w.end_date,
                w.external_file_path, w.summary, w.mentor_certified_by, w.mentor_certified_at,
                w.returned_comment, w.submitted_at, w.created_at, w.updated_at,
                m.name as mentor_certified_name
         FROM weekly_logs w
         LEFT JOIN mentors m ON w.mentor_certified_by = m.mentor_id
         WHERE w.student_id = $1 
         ORDER BY w.week_number ASC`,
        [targetStudentId]
      );

      res.status(200).json({
        success: true,
        data: logsRes.rows,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Weekly Logs Error', 'An internal server error occurred.');
    }
  }
}
