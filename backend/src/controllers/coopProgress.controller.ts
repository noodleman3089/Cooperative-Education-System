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
          -- สหกิจ 07 หน้า 3 — พี่เลี้ยงลงนามรับรองแล้ว (กระดาษส่งคืนงานสหกิจ = คนที่ดูหน้านี้)
          -- เดิมนับ weekly_work_plans ซึ่งไม่ใช่ใบนี้ · สูตรเดียวกับ work_plan_certified หน้าแรกนักศึกษา
          EXISTS (SELECT 1 FROM work_plan_approvals wpa
                   WHERE wpa.student_id = s.student_id AND wpa.approver_role = 'mentor'
                     AND wpa.status = 'approved') as work_plan_certified,
          -- Outline (สหกิจ 11)
          rep_out.status as outline_status,
          -- Supervision logs
          (SELECT COUNT(*) 
           FROM supervision_appointments sa 
           JOIN supervision_logs sl ON sa.appointment_id = sl.appointment_id 
           WHERE sa.student_id = s.student_id AND sl.status = 'submitted') as supervision_logs_count,
          -- สหกิจ 13 — แบบฟอร์มจริงของการนิเทศ (เดิมไม่ถูกนับเลย)
          (SELECT COUNT(*) FROM supervision_records sr WHERE sr.student_id = s.student_id) as supervision_records_count,
          -- สหกิจ 14 — แบบแจ้งยืนยันการส่งรายงาน (นักศึกษายื่น · อาจารย์ที่ปรึกษาลงนาม)
          rc.confirmation_id, rc.status as confirmation_status, rc.requested_at as confirmation_requested_at,
          rc.certified_at as confirmation_certified_at,
          -- Final Report
          rep_fin.status as final_report_status,
          rep_fin.file_path as final_report_path,
          rep_fin.report_id as final_report_id,
          -- แบบประเมินของพี่เลี้ยงสองใบ — ทั้งคู่เป็นของพี่เลี้ยง ไม่ใช่ของอาจารย์
          -- สหกิจ 15 เต็ม 100 ใช้ตัดเกรด · สหกิจ 16 เต็ม 70 เป็นเรตติ้งรายงาน ไม่รวมเกรด
          eval_15.total_score as sahatkit15_score,
          eval_16.total_score as sahatkit16_score,
          -- Notifications Cooldown
          notif.last_notified_at
        FROM students s
        JOIN master_major m ON s.major_id = m.major_id
        LEFT JOIN personnel p_adv ON s.advisor_id = p_adv.personnel_id
        LEFT JOIN intent_forms inf ON s.student_id = inf.student_id AND inf.status = 'accepted'
        LEFT JOIN companies c ON inf.company_id = c.company_id
        LEFT JOIN accommodations acc ON s.student_id = acc.student_id
        LEFT JOIN report_outlines rep_out ON s.student_id = rep_out.student_id
        -- ⛔ กรอง reviewer_kind='advisor' ทั้งสองชั้น — ร่างที่ส่งพี่เลี้ยงนับเลขฉบับแยกกัน
        --    ถ้าไม่กรอง ฉบับที่ 1 ของร่างกับของเล่มจริงชนกัน = แถวซ้ำ หรือได้ report_id ของร่าง
        --    ซึ่งหน้าตรวจรับเล่มส่งต่อไปที่ PATCH /final-reports/:id/status
        LEFT JOIN final_reports rep_fin ON s.student_id = rep_fin.student_id
             AND rep_fin.reviewer_kind = 'advisor'
             AND rep_fin.version = (
               SELECT COALESCE(MAX(version), 1) FROM final_reports
                WHERE student_id = s.student_id AND reviewer_kind = 'advisor'
             )
        LEFT JOIN report_confirmations rc ON s.student_id = rc.student_id
        LEFT JOIN final_evaluations eval_15 ON s.student_id = eval_15.student_id
             AND eval_15.evaluator_role = 'mentor' AND eval_15.form_code = 'sahatkit_15'
        LEFT JOIN final_evaluations eval_16 ON s.student_id = eval_16.student_id
             AND eval_16.evaluator_role = 'mentor' AND eval_16.form_code = 'sahatkit_16'
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
      const studentsProgress = dbRes.rows.map((row) => {
        let progress = 0;
        const details = {
          intentApproved: false,
          accommodationSubmitted: false,
          workPlanCertified: false,
          outlineApproved: false,
          supervisionCompleted: false,
          finalReportSubmitted: false,
          evaluation15Submitted: false,
          evaluation16Submitted: false
        };

        // 1. Intent Approved (20%)
        if (row.intent_status === 'accepted') {
          progress += 20;
          details.intentApproved = true;
        }

        // 2. สหกิจ 06 ที่พัก (10%) + สหกิจ 07 แผนงานที่พี่เลี้ยงรับรองแล้ว (10%)
        if (row.acc_student_id) {
          progress += 10;
          details.accommodationSubmitted = true;
        }
        if (row.work_plan_certified) {
          progress += 10;
          details.workPlanCertified = true;
        }

        // 3. Report Outline Approved (20%)
        if (row.outline_status === 'approved') {
          progress += 20;
          details.outlineApproved = true;
        }

        // 4. Supervision Submitted (10%)
        // บันทึกย่อหลังนิเทศ หรือแบบบันทึก สหกิจ 13 อย่างใดอย่างหนึ่ง = ไปนิเทศแล้ว
        if (parseInt(row.supervision_logs_count, 10) > 0 || parseInt(row.supervision_records_count, 10) > 0) {
          progress += 10;
          details.supervisionCompleted = true;
        }

        // 5. Final Report Submitted (10%)
        if (row.final_report_status) {
          progress += 10;
          details.finalReportSubmitted = true;
        }

        // 6. สหกิจ 15 — แบบประเมินผลนักศึกษา (10%)
        // 7. สหกิจ 16 — แบบประเมินรายงาน (10%)
        // ทั้งสองใบเป็นภาระของพี่เลี้ยงคนเดียวกันและจำเป็นทั้งคู่ — ท้ายฟอร์มเขียนเองว่า
        // "หากนักศึกษาไม่ได้รับแบบประเมินดังกล่าว จะไม่ผ่านการประเมินผล" การแยก 10+10
        // จึงบอกได้ว่าค้างใบไหน ต่างจากการยุบเป็น 20 ก้อนเดียวที่บอกไม่ได้
        if (row.sahatkit15_score !== null && row.sahatkit15_score !== undefined) {
          progress += 10;
          details.evaluation15Submitted = true;
        }

        if (row.sahatkit16_score !== null && row.sahatkit16_score !== undefined) {
          progress += 10;
          details.evaluation16Submitted = true;
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
          // ไม่มี totalScore อีกแล้ว — สองใบคนละมาตร (100 กับ 70) และเจ้าของเคาะว่า
          // เกรดมาจาก สหกิจ 15 อย่างเดียว การบวกกันจะสร้างตัวเลขที่ไม่มีความหมาย
          sahatkit15Score: row.sahatkit15_score !== null ? parseFloat(row.sahatkit15_score) : null,
          sahatkit16Score: row.sahatkit16_score !== null ? parseFloat(row.sahatkit16_score) : null,
          lastNotifiedAt: row.last_notified_at || null,
          supervisionRecordCount: parseInt(row.supervision_records_count, 10),
          reportConfirmation: row.confirmation_id
            ? {
                confirmationId: row.confirmation_id,
                status: row.confirmation_status,
                requestedAt: row.confirmation_requested_at,
                certifiedAt: row.confirmation_certified_at,
              }
            : null
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
