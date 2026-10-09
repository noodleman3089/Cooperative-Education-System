import { Request, Response } from 'express';
import { query } from '../config/database';
import { assertCanReviewStudentWork, assertMentorOwnsStudent, sendAccessError } from '../utils/access';
import { sendUnexpectedError } from '../utils/httpError';
import { AuditAction, writeAudit } from '../utils/audit';

const PERSONNEL_REVIEW_ROLES = ['advisor', 'dept_head', 'staff', 'dean'];

export class ReportOutlineController {
  /**
   * Upload a report outline (Co-op 11)
   * Route: POST /api/outlines
   * Access: student
   */
  static async uploadOutline(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const { report_title, outline_text } = req.body;
      const filePath = req.file ? `report_outlines/${req.file.filename}` : (req.body.file_path || null);

      if (!report_title || !report_title.trim()) {
        res.status(400).json({ message: 'กรุณาระบุหัวข้อรายงาน' });
        return;
      }

      const studentId = req.user.userId;
      
      // Get the student's current active company_id from intent_forms
      const intentRes = await query(
        `SELECT company_id FROM intent_forms WHERE student_id = $1 AND status = 'accepted'`,
        [studentId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'No accepted cooperative education intent found.' });
        return;
      }

      const companyId = intentRes.rows[0].company_id;

      // Check if an outline already exists for this student
      const existingRes = await query(
        `SELECT outline_id, status FROM report_outlines WHERE student_id = $1`,
        [studentId]
      );

      let outlineId;

      if ((existingRes.rowCount ?? 0) > 0) {
        // ⛔ พี่เลี้ยงเห็นชอบแล้ว (ถึงมืออาจารย์ / อนุมัติแล้ว) = ส่งทับไม่ได้ จนกว่าจะถูกตีกลับ
        //    เดิมส่งได้ทุกสถานะ แล้วดันใบที่อาจารย์อนุมัติแล้วกลับไปรอพี่เลี้ยง = ล้างการอนุมัติเงียบ ๆ (พบ 2026-09-22)
        if (['pending_advisor', 'approved'].includes(existingRes.rows[0].status)) {
          res.status(409).json({
            message:
              'โครงร่างนี้พี่เลี้ยงเห็นชอบแล้ว ส่งฉบับใหม่ทับไม่ได้ จนกว่าอาจารย์นิเทศจะส่งกลับให้แก้ไข',
          });
          return;
        }
        outlineId = existingRes.rows[0].outline_id;
        // Update status back to pending_mentor
        await query(
          `UPDATE report_outlines SET status = 'pending_mentor', updated_at = CURRENT_TIMESTAMP WHERE outline_id = $1`,
          [outlineId]
        );
      } else {
        const insertRes = await query(
          `INSERT INTO report_outlines (student_id, company_id, status) VALUES ($1, $2, 'pending_mentor') RETURNING outline_id`,
          [studentId, companyId]
        );
        outlineId = insertRes.rows[0].outline_id;
      }

      // Add a new version
      await query(
        `INSERT INTO report_outline_versions (outline_id, file_path, report_title, outline_text, status)
         VALUES ($1, $2, $3, $4, 'submitted')`,
        [outlineId, filePath, report_title.trim(), outline_text || null]
      );

      res.status(201).json({
        success: true,
        message: 'Report outline submitted successfully.',
        data: { outline_id: outlineId, file_path: filePath, report_title: report_title.trim() }
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Upload Outline Error', 'An internal server error occurred.');
    }
  }

  /**
   * Update report outline status (Approve or Reject)
   * Route: PUT /api/outlines/:id/status
   * Access: mentor, advisor
   */
  static async updateStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const outlineId = parseInt(req.params.id, 10);
      if (isNaN(outlineId)) {
        res.status(400).json({ message: 'Invalid outline ID format.' });
        return;
      }

      const { status, comment } = req.body;
      if (!status || !['pending_advisor', 'approved', 'rejected'].includes(status)) {
        res.status(400).json({ message: 'Invalid status.' });
        return;
      }

      const userId = req.user.userId;
      const { roles } = req.user;
      
      // ⛔ บทบาท `company` ถูกลบออกจากระบบแล้ว (บริษัทไม่มีบัญชี) — มีแค่พี่เลี้ยงกับอาจารย์
      const isMentor = roles.includes('mentor');
      const isAdvisor = roles.includes('advisor');
      // ใบที่อนุมัติแล้วถูกส่งกลับ — มีด่านเพิ่มและลง audit แยกจากการตีกลับปกติ
      let reopening = false;

      if (!isMentor && !isAdvisor) {
        res.status(403).json({ message: 'Forbidden. Only mentor or advisor can update status.' });
        return;
      }

      // Fetch outline to verify relationships & current status
      const outlineRes = await query(
        `SELECT student_id, company_id, status AS current_status FROM report_outlines WHERE outline_id = $1`,
        [outlineId]
      );
      if ((outlineRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Report outline not found.' });
        return;
      }
      // company_id ไม่ถูกใช้แล้ว — ด่านสิทธิ์ของพี่เลี้ยงผูกที่ระดับนักศึกษาแทนที่จะเทียบบริษัท
      const { student_id, current_status } = outlineRes.rows[0];

      // Relationship & State Machine Verification
      if (status === 'pending_advisor') {
        if (current_status !== 'pending_mentor') {
          res.status(400).json({ message: 'Cannot review for advisor approval unless current status is pending_mentor.' });
          return;
        }
        // Must be the assigned company mentor
        if (!isMentor) {
          res.status(403).json({ message: 'Forbidden. Only mentors can review outlines at this stage.' });
          return;
        }
        /**
         * ⛔ ต้องเป็นพี่เลี้ยง **ของนักศึกษาคนนี้** ไม่ใช่แค่พี่เลี้ยงที่บริษัทเดียวกัน
         *
         * ของเดิมเทียบแค่ `company_id` ตรงกัน แปลว่าพี่เลี้ยงคนอื่นในบริษัทเดียวกัน
         * ที่ไม่เคยดูแลนักศึกษาคนนี้ ก็เห็นชอบหัวข้อรายงานของเขาได้ · SEC-06 บอกว่า
         * พี่เลี้ยงเห็นเฉพาะนักศึกษาที่ผูกกับตัวเอง จึงต้องผูกที่ระดับนักศึกษา
         * และของเดิมยังตกไปอ่าน `companies.created_by` ให้บัญชีบริษัทผ่านด่านนี้ด้วย
         * ซึ่งเป็นทางที่ข้อ 14.1 สั่งปิด
         */
        await assertMentorOwnsStudent(userId, student_id);
      } else if (status === 'approved') {
        if (current_status !== 'pending_advisor') {
          res.status(400).json({ message: 'Cannot approve outline unless current status is pending_advisor (after mentor review).' });
          return;
        }
        // สหกิจ 11 เป็นงานของอาจารย์นิเทศ (`supervisor_id`) ตามคู่มือคณะ — เดิมผูกกับอาจารย์ที่ปรึกษา (เจ้าของตัดสิน 2026-10-09)
        // route ยังเปิดให้ role `advisor` เพราะอาจารย์นิเทศถือ role นั้น · ชื่อสถานะ `pending_advisor` คงเดิม
        if (!isAdvisor) {
          res.status(403).json({ message: 'Forbidden. Only advisors can approve outlines.' });
          return;
        }
        const studentCheck = await query('SELECT supervisor_id FROM students WHERE student_id = $1', [student_id]);
        if ((studentCheck.rowCount ?? 0) === 0 || studentCheck.rows[0].supervisor_id !== userId) {
          res.status(403).json({ message: 'งานนี้เป็นของอาจารย์นิเทศของนักศึกษาคนนี้เท่านั้น' });
          return;
        }
      } else if (status === 'rejected') {
        /**
         * ⛔ ตีกลับได้เฉพาะใบที่ยังอยู่ในมือคนที่กด — allow-list เดียวกับสายอนุมัติ
         *
         * ของเดิมสายนี้ไม่ตรวจ `current_status` เลย แปลว่า:
         *   · อาจารย์ตีกลับใบที่ **เห็นชอบไปแล้ว** ได้ (นักศึกษาเริ่มเขียนเล่มไปแล้ว ใบย้อนกลับเงียบ ๆ)
         *   · อาจารย์ตีกลับใบที่ยัง `pending_mentor` ได้ = ข้ามขั้นพี่เลี้ยง (สหกิจ 11 ต้องผ่าน 2 คนตามลำดับ)
         *
         * 2026-10-09: อาจารย์นิเทศส่งใบที่อนุมัติแล้วกลับได้ (ทางแก้เมื่ออนุมัติผิด) — เฉพาะตอนนักศึกษา
         * ยังไม่ส่งเล่มสมบูรณ์ และต้องมีเหตุผล · ส่งกลับแล้วนักศึกษาส่งฉบับใหม่ ซึ่งต้องผ่านพี่เลี้ยงอีกรอบ
         */
        const allowedFrom = isAdvisor && (current_status === 'pending_advisor' || current_status === 'approved')
          ? 'advisor'
          : isMentor && current_status === 'pending_mentor'
            ? 'mentor'
            : null;
        if (!allowedFrom) {
          res.status(400).json({
            message:
              current_status === 'approved'
                ? 'โครงร่างนี้อนุมัติแล้ว ส่งกลับได้เฉพาะอาจารย์นิเทศของนักศึกษา'
                : `ตีกลับโครงร่างในสถานะ ${current_status} ไม่ได้`,
          });
          return;
        }

        // Can be either, check whichever role is making the request
        let allowed = false;
        if (isAdvisor) {
          const studentCheck = await query('SELECT supervisor_id FROM students WHERE student_id = $1', [student_id]);
          if ((studentCheck.rowCount ?? 0) > 0 && studentCheck.rows[0].supervisor_id === userId) {
            allowed = true;
          }
        }
        if (!allowed && isMentor) {
          // ⛔ เหตุผลเดียวกับสาย pending_advisor ด้านบน — การตีกลับก็เป็นการเขียนสถานะ
          //    ลงโครงร่างของคนอื่นได้เท่ากัน จึงต้องเป็นพี่เลี้ยงของนักศึกษาคนนั้นจริง
          try {
            await assertMentorOwnsStudent(userId, student_id);
            allowed = true;
          } catch {
            allowed = false;
          }
        }
        if (!allowed) {
          res.status(403).json({ message: 'Forbidden. You are not authorized to reject this report outline.' });
          return;
        }

        // ตีกลับต้องบอกเหตุผล — นักศึกษาต้องรู้ว่าแก้อะไร · เดิมบังคับแค่บนหน้าจอ
        // ยิง API ตรงแล้ว rejection_comment เป็น NULL ได้ · ตรวจหลังด่านสิทธิ์
        // เพื่อให้คนไม่มีสิทธิ์ได้ 403 เหมือนเดิม ไม่ใช่ 400
        if (typeof comment !== 'string' || !comment.trim()) {
          res.status(400).json({ message: 'กรุณาระบุข้อเสนอแนะในการส่งกลับแก้ไขโครงร่างรายงาน' });
          return;
        }

        if (current_status === 'approved') {
          // เล่มสมบูรณ์ส่งเข้ามาแล้ว = เล่มถูกเขียนตามโครงร่างนี้ไปแล้ว ถอนการอนุมัติไม่ได้
          const reportRes = await query(
            `SELECT 1 FROM final_reports WHERE student_id = $1 AND reviewer_kind = 'advisor' LIMIT 1`,
            [student_id]
          );
          if ((reportRes.rowCount ?? 0) > 0) {
            res.status(409).json({
              code: 'final_report_submitted',
              message: 'นักศึกษาส่งเล่มรายงานฉบับสมบูรณ์แล้ว จึงส่งโครงร่างกลับไม่ได้',
            });
            return;
          }
          reopening = true;
        }
      }

      // State Machine Enforcement
      if (isMentor && !isAdvisor) {
        if (status !== 'pending_advisor' && status !== 'rejected') {
          res.status(403).json({ message: 'Forbidden. Mentor can only set status to pending_advisor or rejected.' });
          return;
        }
      }

      if (isAdvisor) {
        if (status !== 'approved' && status !== 'rejected') {
          res.status(403).json({ message: 'Forbidden. Advisor can only set status to approved or rejected.' });
          return;
        }
      }

      // เงื่อนไขสถานะเดิมอยู่ใน UPDATE — สองคนกดพร้อมกัน คนที่สองต้องไม่เขียนทับผลของคนแรก
      const updated = await query(
        `UPDATE report_outlines SET status = $1, updated_at = CURRENT_TIMESTAMP
          WHERE outline_id = $2 AND status = $3
          RETURNING outline_id`,
        [status, outlineId, current_status]
      );
      if ((updated.rowCount ?? 0) === 0) {
        res.status(409).json({ message: 'สถานะของโครงร่างนี้เพิ่งเปลี่ยน กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง' });
        return;
      }

      const versionRes = await query(
        `SELECT version_id FROM report_outline_versions WHERE outline_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
        [outlineId]
      );

      if ((versionRes.rowCount ?? 0) > 0) {
        const versionId = versionRes.rows[0].version_id;
        const versionStatus = status === 'rejected' ? 'rejected' : 'approved';
        await query(
          `UPDATE report_outline_versions SET status = $1, rejection_comment = $2, reviewed_by = $3 WHERE version_id = $4`,
          [versionStatus, comment || null, userId, versionId]
        );
      }

      if (reopening) {
        writeAudit({
          action: AuditAction.OUTLINE_REOPENED,
          entityType: 'report_outline',
          entityId: outlineId,
          subjectId: student_id,
          detail: { reason: String(comment).trim() },
        }, req).catch(() => undefined);
      }

      res.status(200).json({
        success: true,
        message: 'Status updated successfully.',
      });
    } catch (error) {
      // ด่านสิทธิ์โยน AccessDeniedError ซึ่งเป็น 403 ของผู้เรียก ไม่ใช่ระบบพัง
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Update Outline Status Error', 'An internal server error occurred.');
    }
  }

  /**
   * Get versions of a report outline for a student
   * Route: GET /api/outlines/student/:id
   * Access: student, mentor, advisor
   */
  static async getVersions(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID.' });
        return;
      }

      // SEC-06: this endpoint performed no authorization at all, so any student
      // could read another student's outline history and stored file paths.
      const { roles, userId } = req.user;
      if (roles.includes('student') && !roles.some((r) => PERSONNEL_REVIEW_ROLES.includes(r))) {
        if (userId !== studentId) {
          res.status(403).json({ message: 'Forbidden. You can only view your own report outline.' });
          return;
        }
      } else if (roles.includes('mentor')) {
        const mentorCheck = await query(
          `SELECT 1 FROM intent_forms WHERE student_id = $1 AND mentor_id = $2 AND status = 'accepted' LIMIT 1`,
          [studentId, userId]
        );
        if ((mentorCheck.rowCount ?? 0) === 0) {
          res.status(403).json({ message: 'Forbidden. This student is not assigned to you.' });
          return;
        }
      } else {
        await assertCanReviewStudentWork(userId, roles, studentId);
      }

      const metaRes = await query(
        `SELECT i.start_date, i.end_date,
                m.name as mentor_name,
                -- ผู้พิจารณาโครงร่างคืออาจารย์นิเทศ (supervisor_id) — ชื่อคีย์ advisor_* คงไว้เพราะหน้าจอใช้อยู่
                p.first_name as advisor_first_name, p.last_name as advisor_last_name
         FROM students s
         LEFT JOIN personnel p ON s.supervisor_id = p.personnel_id
         LEFT JOIN intent_forms i ON s.student_id = i.student_id AND i.status = 'accepted'
         LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
         WHERE s.student_id = $1
         ORDER BY i.form_id DESC LIMIT 1`,
        [studentId]
      );
      const studentMeta = metaRes.rows[0] || null;

      const outlineRes = await query(
        `SELECT outline_id, status, created_at, updated_at FROM report_outlines WHERE student_id = $1`,
        [studentId]
      );

      if ((outlineRes.rowCount ?? 0) === 0) {
        res.status(200).json({
          success: true,
          data: {
            outline_id: null,
            status: 'draft',
            meta: studentMeta,
            versions: [],
          },
        });
        return;
      }

      const outline = outlineRes.rows[0];

      const versionsRes = await query(
        `SELECT v.version_id, v.file_path, v.report_title, v.outline_text, v.submitted_at,
                v.rejection_comment, v.status, u.email as reviewer_email,
                p.first_name as reviewer_first_name, p.last_name as reviewer_last_name,
                m.name as reviewer_mentor_name
         FROM report_outline_versions v
         LEFT JOIN users u ON v.reviewed_by = u.user_id
         LEFT JOIN personnel p ON v.reviewed_by = p.personnel_id
         LEFT JOIN mentors m ON v.reviewed_by = m.mentor_id
         WHERE v.outline_id = $1
         ORDER BY v.submitted_at DESC`,
        [outline.outline_id]
      );

      res.status(200).json({
        success: true,
        data: {
          ...outline,
          meta: studentMeta,
          versions: versionsRes.rows,
        },
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Versions Error', 'An internal server error occurred.');
    }
  }

  /**
   * Get report outlines for mentor's company
   * Route: GET /api/outlines/company
   * Access: mentor
   */
  static async getCompanyOutlines(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const userId = req.user.userId;
      let companyId: number | null = null;

      const mentorRes = await query('SELECT company_id FROM mentors WHERE mentor_id = $1', [userId]);
      if ((mentorRes.rowCount ?? 0) > 0) {
        companyId = mentorRes.rows[0].company_id;
      }

      if (!companyId) {
        res.status(200).json({ success: true, data: [] });
        return;
      }

      const result = await query(
        `SELECT 
          ro.outline_id,
          ro.student_id,
          ro.status,
          ro.created_at,
          ro.updated_at,
          s.student_code,
          s.first_name,
          s.last_name,
          m.major_name_th,
          v.file_path as latest_file_path,
          v.submitted_at as latest_submitted_at,
          v.rejection_comment as latest_rejection_comment
        FROM report_outlines ro
        JOIN students s ON ro.student_id = s.student_id
        JOIN master_major m ON s.major_id = m.major_id
        LEFT JOIN LATERAL (
          SELECT file_path, submitted_at, rejection_comment
          FROM report_outline_versions
          WHERE outline_id = ro.outline_id
          ORDER BY submitted_at DESC
          LIMIT 1
        ) v ON true
        WHERE ro.company_id = $1
        ORDER BY ro.updated_at DESC`,
        [companyId]
      );

      res.status(200).json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Company Outlines Error', 'An internal server error occurred.');
    }
  }

  /**
   * โครงร่างของนักศึกษาที่ผู้เรียกเป็นอาจารย์นิเทศ (สหกิจ 11 เป็นงานของอาจารย์นิเทศ — ชื่อ route คงเดิม)
   * Route: GET /api/outlines/advisor
   * Access: advisor
   */
  static async getAdvisorOutlines(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const userId = req.user.userId;

      const result = await query(
        `SELECT 
          ro.outline_id,
          ro.student_id,
          ro.status,
          ro.created_at,
          ro.updated_at,
          s.student_code,
          s.first_name,
          s.last_name,
          m.major_name_th,
          c.name_th as company_name_th,
          v.file_path as latest_file_path,
          v.submitted_at as latest_submitted_at,
          v.rejection_comment as latest_rejection_comment,
          v.report_title as latest_report_title,
          (SELECT COUNT(*)::int FROM report_outline_versions WHERE outline_id = ro.outline_id) as version_count,
          ro.updated_at::timestamptz as waiting_since,
          -- "รอคุณมากี่วัน" — นับเฉพาะใบที่อยู่ในมืออาจารย์ · updated_at ขยับตอนพี่เลี้ยงเห็นชอบ
          -- ⛔ updated_at เป็น TIMESTAMP ไม่มีโซน (ค่าเวลาตามโซนของ session ที่เขียน) —
          --    แปลงเป็น timestamptz ด้วยโซนเดียวกันก่อน แล้วค่อยตัดวันตามเวลาไทย
          CASE WHEN ro.status = 'pending_advisor'
               THEN ((NOW() AT TIME ZONE 'Asia/Bangkok')::date - (ro.updated_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date)
               ELSE NULL END as days_waiting
        FROM report_outlines ro
        JOIN students s ON ro.student_id = s.student_id
        JOIN master_major m ON s.major_id = m.major_id
        JOIN companies c ON ro.company_id = c.company_id
        LEFT JOIN LATERAL (
          SELECT file_path, submitted_at, rejection_comment, report_title
          FROM report_outline_versions
          WHERE outline_id = ro.outline_id
          ORDER BY submitted_at DESC
          LIMIT 1
        ) v ON true
        WHERE s.supervisor_id = $1
        ORDER BY ro.updated_at DESC`,
        [userId]
      );

      res.status(200).json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Advisor Outlines Error', 'An internal server error occurred.');
    }
  }
}

