import { Request, Response } from 'express';
import { query } from '../config/database';
import { resolveMajorScope, sendAccessError } from '../utils/access';
import { sendUnexpectedError } from '../utils/httpError';

export class CoopProgressController {
  /**
   * Fetch coop progress dashboard list for personnel (Advisor, Dept Head, Staff)
   * Route: GET /api/coop-progress/dashboard
   */
  static async getDashboardProgress(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const userId = req.user.userId;
      const { roles } = req.user;

      const isAdvisor = roles.includes('advisor');
      const isDeptHead = roles.includes('dept_head');
      const isStaff = roles.includes('staff');

      if (!isAdvisor && !isDeptHead && !isStaff) {
        res.status(403).json({ message: 'Forbidden. You do not have access to the dashboard.' });
        return;
      }

      // An advisor is scoped by their own assignment list below, so their major
      // is never needed — and demanding a personnel profile from them here would
      // lock out an advisor who is correctly scoped already.
      const advisorOnly = isAdvisor && !isStaff && !isDeptHead;

      // SEC-06: fails closed. This used to be `if (personnelRow) { take major }`
      // followed by `else if (userMajorId)` below, so a department head with no
      // personnel row fell past both branches and the query ran with **no filter
      // at all** — every student in the university, with their placement,
      // accommodation, report and score data.
      // `resolveMajorScope` also returns null for staff, which is the intended
      // institution-wide scope for the co-op office; the old code accidentally
      // pinned staff to whichever major their own profile happened to carry.
      const scopedMajorId = advisorOnly ? null : (await resolveMajorScope(userId, roles)).majorId;

      // Build Query
      let queryStr = `
        SELECT 
          s.student_id,
          s.student_code,
          s.first_name,
          s.last_name,
          m.major_name_th,
          m.major_code,
          s.advisor_id,
          p_adv.first_name as advisor_fname,
          p_adv.last_name as advisor_lname,
          -- Intent details
          inf.status as intent_status,
          c.name_th as company_name,
          -- Accommodations
          acc.student_id as acc_student_id,
          -- Work plans count
          (SELECT COUNT(*) FROM weekly_work_plans wwp WHERE wwp.student_id = s.student_id) as work_plans_count,
          -- Outline (สหกิจ 11)
          rep_out.status as outline_status,
          -- Supervision logs
          (SELECT COUNT(*) 
           FROM supervision_appointments sa 
           JOIN supervision_logs sl ON sa.appointment_id = sl.appointment_id 
           WHERE sa.student_id = s.student_id AND sl.status = 'submitted') as supervision_logs_count,
          -- Final Report
          rep_fin.status as final_report_status,
          rep_fin.file_path as final_report_path,
          rep_fin.report_id as final_report_id,
          -- Mentor Evaluation
          eval_men.total_score as mentor_score,
          -- Advisor Evaluation
          eval_adv.total_score as advisor_score,
          -- Notifications Cooldown
          notif.last_notified_at
        FROM students s
        JOIN master_major m ON s.major_id = m.major_id
        LEFT JOIN personnel p_adv ON s.advisor_id = p_adv.personnel_id
        LEFT JOIN intent_forms inf ON s.student_id = inf.student_id AND inf.status = 'accepted'
        LEFT JOIN companies c ON inf.company_id = c.company_id
        LEFT JOIN accommodations acc ON s.student_id = acc.student_id
        LEFT JOIN report_outlines rep_out ON s.student_id = rep_out.student_id
        LEFT JOIN final_reports rep_fin ON s.student_id = rep_fin.student_id AND rep_fin.version = (
            SELECT COALESCE(MAX(version), 1) FROM final_reports WHERE student_id = s.student_id
        )
        LEFT JOIN final_evaluations eval_men ON s.student_id = eval_men.student_id AND eval_men.evaluator_role = 'mentor'
        LEFT JOIN final_evaluations eval_adv ON s.student_id = eval_adv.student_id AND eval_adv.evaluator_role = 'advisor'
        LEFT JOIN mentor_notifications notif ON s.student_id = notif.student_id
        WHERE 1=1
      `;

      const queryParams: unknown[] = [];

      // An advisor sees the students assigned to them; a department head sees
      // their own major; staff see the whole institution.
      if (advisorOnly) {
        queryParams.push(userId);
        queryStr += ` AND s.advisor_id = $${queryParams.length}`;
      } else if (scopedMajorId !== null) {
        queryParams.push(scopedMajorId);
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      }

      queryStr += ` ORDER BY s.student_code ASC`;

      const dbRes = await query(queryStr, queryParams);

      // Process Progress Calculations on the backend
      const studentsProgress = dbRes.rows.map((row: any) => {
        let progress = 0;
        const details = {
          intentApproved: false,
          accommodationSubmitted: false,
          outlineApproved: false,
          supervisionCompleted: false,
          finalReportSubmitted: false,
          mentorEvaluated: false,
          advisorEvaluated: false
        };

        // 1. Intent Approved (20%)
        if (row.intent_status === 'accepted') {
          progress += 20;
          details.intentApproved = true;
        }

        // 2. Accommodation & Work Plan (20%)
        if (row.acc_student_id && row.work_plans_count > 0) {
          progress += 20;
          details.accommodationSubmitted = true;
        }

        // 3. Report Outline Approved (20%)
        if (row.outline_status === 'approved') {
          progress += 20;
          details.outlineApproved = true;
        }

        // 4. Supervision Submitted (10%)
        if (parseInt(row.supervision_logs_count, 10) > 0) {
          progress += 10;
          details.supervisionCompleted = true;
        }

        // 5. Final Report Submitted (10%)
        if (row.final_report_status) {
          progress += 10;
          details.finalReportSubmitted = true;
        }

        // 6. Mentor Evaluation (10%)
        if (row.mentor_score !== null && row.mentor_score !== undefined) {
          progress += 10;
          details.mentorEvaluated = true;
        }

        // 7. Advisor Evaluation (10%)
        if (row.advisor_score !== null && row.advisor_score !== undefined) {
          progress += 10;
          details.advisorEvaluated = true;
        }

        return {
          studentId: row.student_id,
          studentCode: row.student_code,
          studentName: `${row.first_name} ${row.last_name}`,
          majorName: row.major_name_th,
          majorCode: row.major_code,
          advisorName: row.advisor_fname ? `${row.advisor_fname} ${row.advisor_lname}` : 'ไม่ได้ระบุ',
          companyName: row.company_name || 'ไม่ได้ระบุ',
          progressPercent: progress,
          progressDetails: details,
          finalReportStatus: row.final_report_status || 'not_submitted',
          finalReportPath: row.final_report_path || null,
          finalReportId: row.final_report_id || null,
          mentorScore: row.mentor_score !== null ? parseFloat(row.mentor_score) : null,
          advisorScore: row.advisor_score !== null ? parseFloat(row.advisor_score) : null,
          totalScore: (row.mentor_score !== null ? parseFloat(row.mentor_score) : 0) + (row.advisor_score !== null ? parseFloat(row.advisor_score) : 0),
          lastNotifiedAt: row.last_notified_at || null
        };
      });

      res.status(200).json({
        success: true,
        data: studentsProgress
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Dashboard Progress Error', 'An internal server error occurred.');
    }
  }
}
