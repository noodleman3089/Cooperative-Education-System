import { Request, Response } from 'express';
import { query } from '../config/database';
import { assertCanReviewStudentWork, sendAccessError } from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';

/** Rubric bounds — total_score is NUMERIC(5,2) so the sum must stay under 1000. */
const MAX_ITEM_SCORE = 100;
const MAX_RUBRIC_ITEMS = 50;

/**
 * Keys inside `scoresDetail` that are free text rather than rubric scores.
 * The evaluation forms submit the reviewer's written comment alongside the
 * numeric items, so it is stored in the same JSONB blob but never summed.
 */
const NON_SCORE_KEYS = ['comments', 'comment', 'remark', 'note'];

export class FinalEvaluationController {
  /**
   * Submit or update raw score evaluation (Mentor or Advisor only)
   * Route: POST /api/final-evaluations
   */
  static async submitEvaluation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const { studentId, scoresDetail } = req.body;
      const targetStudentId = parseInt(studentId, 10);

      if (isNaN(targetStudentId) || !scoresDetail || typeof scoresDetail !== 'object') {
        res.status(400).json({ message: 'ข้อมูลประเมินไม่ถูกต้อง' });
        return;
      }

      const evaluatorId = req.user.userId;
      const { roles } = req.user;

      const isMentor = roles.includes('mentor');
      const isAdvisor = roles.includes('advisor');

      if (!isMentor && !isAdvisor) {
        res.status(403).json({ message: 'คุณไม่มีสิทธิ์ในการส่งประเมินผล' });
        return;
      }

      // 1. Verify access authorization & determine role
      let evaluatorRole: 'mentor' | 'advisor';

      if (isMentor) {
        // Must be the assigned mentor in intent_forms with accepted status
        const mentorCheck = await query(
          `SELECT mentor_id FROM intent_forms WHERE student_id = $1 AND mentor_id = $2 AND status = 'accepted'`,
          [targetStudentId, evaluatorId]
        );
        if ((mentorCheck.rowCount ?? 0) === 0) {
          res.status(403).json({ message: 'คุณไม่ได้รับมอบหมายให้เป็นพี่เลี้ยงสำหรับนักศึกษาคนนี้' });
          return;
        }
        evaluatorRole = 'mentor';
      } else {
        // Must be the assigned advisor in students table
        const advisorCheck = await query(
          `SELECT advisor_id FROM students WHERE student_id = $1 AND advisor_id = $2`,
          [targetStudentId, evaluatorId]
        );
        if ((advisorCheck.rowCount ?? 0) === 0) {
          res.status(403).json({ message: 'คุณไม่ใช่คู่ที่ปรึกษาสหกิจสำหรับนักศึกษาคนนี้' });
          return;
        }
        evaluatorRole = 'advisor';
      }

      // 2. Calculate Total Score from scoresDetail.
      //    `scoresDetail` carries both rubric scores and free-text metadata
      //    (see NON_SCORE_KEYS). Every scoring entry must be a real number inside
      //    the rubric range — the previous version summed whatever was sent, so an
      //    evaluator could post an arbitrary total or poison the record with NaN.
      const entries = Object.entries(scoresDetail);
      const scoreEntries = entries.filter(([key]) => !NON_SCORE_KEYS.includes(key));

      if (scoreEntries.length === 0 || scoreEntries.length > MAX_RUBRIC_ITEMS) {
        res.status(400).json({
          message: `จำนวนหัวข้อประเมินต้องอยู่ระหว่าง 1 ถึง ${MAX_RUBRIC_ITEMS} หัวข้อ`,
        });
        return;
      }

      for (const key of NON_SCORE_KEYS) {
        const val = (scoresDetail as Record<string, unknown>)[key];
        if (val !== undefined && val !== null && typeof val !== 'string') {
          res.status(400).json({ message: `ฟิลด์ '${key}' ต้องเป็นข้อความ` });
          return;
        }
      }

      let calculatedTotal = 0;
      for (const [key, val] of scoreEntries) {
        const scoreVal = typeof val === 'number' ? val : parseFloat(String(val));
        if (!Number.isFinite(scoreVal) || scoreVal < 0 || scoreVal > MAX_ITEM_SCORE) {
          res.status(400).json({
            message: `คะแนนหัวข้อ '${key}' ต้องเป็นตัวเลขระหว่าง 0 ถึง ${MAX_ITEM_SCORE}`,
          });
          return;
        }
        calculatedTotal += scoreVal;
      }

      // 3. Upsert score record into final_evaluations
      await query(
        `INSERT INTO final_evaluations (student_id, evaluator_role, scores_detail, total_score) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (student_id, evaluator_role) 
         DO UPDATE SET scores_detail = EXCLUDED.scores_detail, total_score = EXCLUDED.total_score, submitted_at = CURRENT_TIMESTAMP`,
        [targetStudentId, evaluatorRole, JSON.stringify(scoresDetail), calculatedTotal]
      );

      writeAudit({
        action: AuditAction.EVALUATION_SUBMITTED,
        entityType: 'final_evaluation',
        entityId: `${targetStudentId}:${evaluatorRole}`,
        subjectId: targetStudentId,
        detail: { evaluator_role: evaluatorRole, total_score: calculatedTotal },
      }, req).catch(() => undefined);

      res.status(200).json({
        success: true,
        message: 'บันทึกคะแนนดิบและส่งผลการประเมินสำเร็จ',
        data: { total_score: calculatedTotal }
      });
    } catch (error: any) {
      console.error('Submit Evaluation Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
    }
  }

  /**
   * Fetch evaluation score card of a student (Advisor / Dept Head / Staff)
   * Route: GET /api/final-evaluations/student/:studentId
   */
  static async getStudentEvaluation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const targetStudentId = parseInt(req.params.studentId, 10);
      if (isNaN(targetStudentId)) {
        res.status(400).json({ message: 'Invalid student ID.' });
        return;
      }

      const { roles, userId } = req.user;
      const isAuthorized = roles.includes('advisor') || roles.includes('dept_head') || roles.includes('staff');
      if (!isAuthorized) {
        res.status(403).json({ message: 'คุณไม่มีสิทธิ์เข้าถึงผลประเมินของนักศึกษา' });
        return;
      }

      // SEC-06: sealed evaluation scores are only visible to the people
      // responsible for this student, not to every advisor in the university.
      await assertCanReviewStudentWork(userId, roles, targetStudentId);

      // Fetch all evaluations for this student
      const evalRes = await query(
        `SELECT evaluator_role, scores_detail, total_score, submitted_at 
         FROM final_evaluations 
         WHERE student_id = $1`,
        [targetStudentId]
      );

      res.status(200).json({
        success: true,
        data: evalRes.rows
      });
    } catch (error: any) {
      if (sendAccessError(res, error)) return;
      console.error('Get Student Evaluation Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
    }
  }

  /**
   * Fetch active students assigned to this mentor
   * Route: GET /api/final-evaluations/my-students
   * Access: Mentor only
   */
  static async getMyStudents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const mentorId = req.user.userId;
      const { roles } = req.user;

      if (!roles.includes('mentor')) {
        res.status(403).json({ message: 'Forbidden. Only mentors can access this list.' });
        return;
      }

      const studentsRes = await query(
        `SELECT 
          s.student_id,
          s.student_code,
          s.first_name,
          s.last_name,
          m.major_name_th,
          c.name_th as company_name,
          eval.total_score as mentor_score,
          fr.status as final_report_status,
          fr.file_path as final_report_path
         FROM intent_forms i
         JOIN students s ON i.student_id = s.student_id
         JOIN master_major m ON s.major_id = m.major_id
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN final_reports fr ON s.student_id = fr.student_id AND fr.version = (
             SELECT COALESCE(MAX(version), 1) FROM final_reports WHERE student_id = s.student_id
         )
         LEFT JOIN final_evaluations eval ON s.student_id = eval.student_id AND eval.evaluator_role = 'mentor'
         WHERE i.mentor_id = $1 AND i.status = 'accepted'`,
        [mentorId]
      );

      res.status(200).json({
        success: true,
        data: studentsRes.rows
      });
    } catch (error: any) {
      console.error('Get Mentor Students Error:', error);
      res.status(500).json({ message: 'An internal server error occurred.' });
    }
  }
}
