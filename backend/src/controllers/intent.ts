import { Request, Response } from 'express';
import { IntentFormModel, COMPANY_VISIBLE_STATUSES } from '../models/intent';
import { StudentModel } from '../models/student';
import { PersonnelModel } from '../models/personnel';
import { query } from '../config/database';
import { notifyStudentStatusChange } from '../utils/email';
import { assertCanAccessStudent, resolveMajorScope, sendAccessError } from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';
import { getErrorMessage } from '../utils/httpError';
import { sendUnexpectedError } from '../utils/httpError';

export class IntentFormController {
  /**
   * Submit cooperative education intent form.
   * Route: POST /api/intents
   * Access: student
   */
  static async submitIntent(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = req.user.userId;
      const body = req.body;
      const { is_self_found, semester_id } = body;

      if (semester_id === undefined) {
        res.status(400).json({ message: 'Required field: semester_id.' });
        return;
      }
      const parsedSemesterId = parseInt(semester_id as any, 10);
      if (isNaN(parsedSemesterId)) {
        res.status(400).json({ message: 'semester_id must be a valid integer.' });
        return;
      }

      let intentForm;

      if (is_self_found === true) {
        const {
          company_name_th,
          company_name_en,
          company_address,
          company_province,
          company_district,
          company_postal_code,
          company_phone,
          contact_person,
          contact_position,
          contact_email
        } = body;

        if (!company_name_th || !company_address || !company_province || !company_district || !company_postal_code || !company_phone) {
          res.status(400).json({ message: 'กรุณากรอกข้อมูลสถานที่ฝึกงานที่จำเป็นให้ครบถ้วน' });
          return;
        }

        intentForm = await IntentFormModel.createSelfFoundWithTransaction(studentId, parsedSemesterId, {
          name_th: company_name_th,
          name_en: company_name_en,
          address: company_address,
          province: company_province,
          district: company_district,
          postal_code: company_postal_code,
          phone: company_phone,
          contact_person,
          contact_position,
          email: contact_email
        });
      } else {
        const { company_id, job_id } = body;
        if (company_id === undefined) {
          res.status(400).json({ message: 'Required fields: company_id.' });
          return;
        }

        const parsedCompanyId = parseInt(company_id as any, 10);
        const parsedJobId = job_id !== undefined && job_id !== null ? parseInt(job_id as any, 10) : null;

        if (isNaN(parsedCompanyId)) {
          res.status(400).json({ message: 'company_id must be a valid integer.' });
          return;
        }

        if (parsedJobId !== null && isNaN(parsedJobId)) {
          res.status(400).json({ message: 'job_id must be a valid integer or null.' });
          return;
        }

        // Call database transaction method
        intentForm = await IntentFormModel.createWithTransaction({
          student_id: studentId,
          company_id: parsedCompanyId,
          semester_id: parsedSemesterId,
          job_id: parsedJobId,
        });
      }

      res.status(201).json({
        message: 'Cooperative education intent submitted successfully.',
        intentForm,
      });
    } catch (error) {
      console.error('Submit Intent Error:', error);
      
      // Return business logic validation error as 400 Bad Request
      res.status(400).json({
        message: getErrorMessage(error, 'An error occurred while submitting your cooperative education intent.'),
      });
    }
  }

  /**
   * Update student intent form status (Approve or Reject).
   * Route: PATCH /api/intents/:id/status
   * Access: advisor
   */
  static async updateIntentStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const { status, reason } = req.body;
      if (!status || !['approved_by_advisor', 'rejected'].includes(status)) {
        res.status(400).json({ message: 'Required field: status must be either "approved_by_advisor" or "rejected".' });
        return;
      }

      // Fetch intent form
      const intentForm = await IntentFormModel.findById(formId);
      if (!intentForm) {
        res.status(404).json({ message: 'Intent form not found.' });
        return;
      }

      // Check current status
      if (intentForm.status !== 'pending_advisor') {
        res.status(400).json({
          message: `Cannot update intent status. Form must be in 'pending_advisor' status. Current status: '${intentForm.status}'.`,
        });
        return;
      }

      // Verify advisor major matches student major (MED-01)
      const advisorId = req.user.userId;
      const advisorProfile = await PersonnelModel.findByPersonnelId(advisorId);
      const studentProfile = await StudentModel.findByStudentId(intentForm.student_id);

      if (!advisorProfile) {
        res.status(403).json({ message: 'Personnel profile not found for advisor.' });
        return;
      }

      if (!studentProfile) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }

      if (advisorProfile.major_id !== studentProfile.major_id) {
        res.status(403).json({ message: 'Forbidden. You cannot update intent forms for students outside your major.' });
        return;
      }

      if (status === 'approved_by_advisor') {
        const updated = await IntentFormModel.updateStatus(formId, 'approved_by_advisor');
        if (!updated) {
          res.status(400).json({ message: 'Failed to approve intent form.' });
          return;
        }

        writeAudit({
          action: AuditAction.INTENT_APPROVED_ADVISOR,
          entityType: 'intent_form',
          entityId: formId,
          subjectId: intentForm.student_id,
        }, req).catch(() => undefined);

        // Send email notification to student
        notifyStudentStatusChange(formId, 'approved_by_advisor').catch(console.error);

        res.status(200).json({
          message: "Intent form approved successfully. Status changed to 'approved_by_advisor'.",
          form_id: formId,
        });
      } else {
        // Status is 'rejected'
        console.log(`Intent form ${formId} rejected by advisor ${advisorId}. Reason: ${reason || 'N/A'}`);
        await IntentFormModel.rejectByAdvisorWithTransaction(formId, advisorId);

        writeAudit({
          action: AuditAction.INTENT_REJECTED_ADVISOR,
          entityType: 'intent_form',
          entityId: formId,
          subjectId: intentForm.student_id,
          detail: { reason: reason || null },
        }, req).catch(() => undefined);

        // Send email notification to student
        notifyStudentStatusChange(formId, 'rejected', reason).catch(console.error);

        res.status(200).json({
          message: "Intent form rejected successfully. Status changed to 'rejected'.",
          form_id: formId,
        });
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'Update Intent Status Error', 'An internal server error occurred while updating intent status.');
    }
  }

  /**
   * Upload parental consent for intent form.
   * Route: PUT /api/intents/:id/parental-consent
   * Access: student
   */
  static async uploadParentalConsent(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ message: 'Required file upload: consent.' });
        return;
      }

      // Fetch intent form
      const intentForm = await IntentFormModel.findById(formId);
      if (!intentForm) {
        res.status(404).json({ message: 'Intent form not found.' });
        return;
      }

      // Check ownership
      if (intentForm.student_id !== req.user.userId) {
        res.status(403).json({ message: 'Unauthorized. You can only upload consent for your own intent form.' });
        return;
      }

      const consentPath = `parental_consents/${req.file.filename}`;

      const updated = await IntentFormModel.updateParentalConsent(formId, consentPath);
      if (!updated) {
        res.status(400).json({ message: 'Failed to update parental consent path.' });
        return;
      }

      res.status(200).json({
        message: 'Parental consent uploaded successfully.',
        form_id: formId,
        parental_consent_path: consentPath,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Upload Parental Consent Error', 'An internal server error occurred while uploading parental consent.');
    }
  }

  /**
   * Get intents submitted by the current student.
   * Route: GET /api/intents/me
   * Access: student
   */
  static async getStudentIntents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }
      const studentId = req.user.userId;
      const result = await query(
        `SELECT i.form_id, i.student_id, i.company_id, c.name_th as company_name_th, c.name_en as company_name_en,
                i.semester_id, i.job_id, j.title as job_title, i.status, i.mentor_id, i.start_date, i.parental_consent_path, i.acceptance_evidence_path
         FROM intent_forms i
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN job_posts j ON i.job_id = j.job_id
         WHERE i.student_id = $1
         ORDER BY i.form_id DESC`,
        [studentId]
      );
      res.status(200).json(result.rows);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Student Intents Error', 'An internal server error occurred while retrieving your intents.');
    }
  }

  /**
   * Get list of intents with filtering.
   * Route: GET /api/intents
   * Access: advisor, dept_head, staff, dean, company
   */
  static async getIntents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { roles, userId } = req.user;
      const { status, major_id } = req.query;
      let { company_id } = req.query;

      // Restrict query for company role
      const isCompany = roles.includes('company');
      if (isCompany) {
        const companyQuery = await query('SELECT company_id FROM companies WHERE created_by = $1 LIMIT 1', [userId]);
        if ((companyQuery.rowCount ?? 0) === 0) {
          res.status(200).json([]);
          return;
        }
        company_id = companyQuery.rows[0].company_id.toString();
      }

      const isStaffOrDeanOrCompany = roles.some((r: string) => ['staff', 'dean', 'company'].includes(r));
      let userMajorId: number | null = null;

      if (!isStaffOrDeanOrCompany) {
        // SEC-06: fails closed — an advisor/dept_head without a personnel profile
        // used to fall through with no filter and see every student's PII.
        userMajorId = (await resolveMajorScope(userId, roles)).majorId;
      }

      let queryStr = `
        SELECT i.form_id, i.student_id, s.student_code, s.major_id, m.major_name_th,
               s.cumulative_gpa,
               i.company_id, c.name_th as company_name_th, i.semester_id, i.job_id, j.title as job_title, i.status,
               s.resume_file, i.parental_consent_path, i.acceptance_evidence_path,
               s.first_name, s.last_name, s.nickname, s.phone as student_phone, s.alt_email, s.year_level, s.current_address,
               s.parent_name, s.parent_phone, c.phone as company_phone, c.contact_person as company_contact_person,
               i.start_date, i.reject_reason
        FROM intent_forms i
        JOIN students s ON i.student_id = s.student_id
        JOIN master_major m ON s.major_id = m.major_id
        JOIN companies c ON i.company_id = c.company_id
        LEFT JOIN job_posts j ON i.job_id = j.job_id
        WHERE 1=1
      `;
      const queryParams: any[] = [];

      if (status) {
        queryParams.push(status);
        queryStr += ` AND i.status = $${queryParams.length}`;
      }

      if (userMajorId !== null) {
        queryParams.push(userMajorId);
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      } else if (major_id) {
        queryParams.push(parseInt(major_id as string, 10));
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      }

      if (company_id) {
        queryParams.push(parseInt(company_id as string, 10));
        queryStr += ` AND i.company_id = $${queryParams.length}`;
      }

      // SEC-10: a company must not see a placement the faculty has not sent it.
      // On paper nothing reaches the company until the department head has
      // selected the students and สหกิจ 04 goes out; the screen now starts at the
      // same point instead of listing applications from the moment they are filed.
      if (isCompany) {
        queryParams.push(COMPANY_VISIBLE_STATUSES);
        queryStr += ` AND i.status = ANY($${queryParams.length}::text[])`;
      }

      queryStr += ` ORDER BY i.form_id DESC`;

      const result = await query(queryStr, queryParams);

      // SEC-10: one query serves five roles, so the columns it selects are the
      // union of what all five need — and an advisor needs the student's home
      // address and parent contacts. A company does not: its paper equivalent,
      // สหกิจ 04, carries only the name, student code, major and job title, and
      // everything personal reaches the company through the student's own
      // สหกิจ 03 — the resume file they chose to attach, still linked below.
      // The rest of each row is dropped here rather than by narrowing the query,
      // because the other four roles genuinely use all of it.
      if (isCompany) {
        const visible = result.rows.map((row) => ({
          form_id: row.form_id,
          student_code: row.student_code,
          first_name: row.first_name,
          last_name: row.last_name,
          major_name_th: row.major_name_th,
          job_title: row.job_title,
          status: row.status,
          resume_file: row.resume_file,
          reject_reason: row.reject_reason,
        }));
        res.status(200).json(visible);
        return;
      }

      res.status(200).json(result.rows);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Intents Error', 'An internal server error occurred while retrieving intents.');
    }
  }

  /**
   * Get detailed view of an intent form.
   * Route: GET /api/intents/:id
   * Access: student owner, advisor, dept_head, staff, dean, company
   */
  static async getIntentDetail(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const result = await query(
        `SELECT i.form_id, i.status, i.start_date, i.parental_consent_path, i.acceptance_evidence_path,
                s.student_id, s.student_code, s.cumulative_gpa, s.resume_file, s.is_eligible, s.is_orientation_passed,
                m_maj.major_name_th, m_maj.major_code, f.faculty_name_th,
                u_std.email as student_email,
                c.company_id, c.name_th as company_name_th, c.name_en as company_name_en, c.address as company_address,
                c.province as company_province, c.district as company_district, c.postal_code as company_postal_code,
                c.phone as company_phone, c.contact_person as company_contact_person, c.contact_position as company_contact_position,
                c.email as company_email,
                i.job_id, j.title as job_title, j.description as job_description,
                i.mentor_id, men.name as mentor_name, u_men.email as mentor_email, men.phone as mentor_phone,
                men.position as mentor_position, men.department as mentor_department
         FROM intent_forms i
         JOIN students s ON i.student_id = s.student_id
         JOIN users u_std ON s.student_id = u_std.user_id
         JOIN master_major m_maj ON s.major_id = m_maj.major_id
         JOIN master_faculty f ON m_maj.faculty_id = f.faculty_id
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN job_posts j ON i.job_id = j.job_id
         LEFT JOIN mentors men ON i.mentor_id = men.mentor_id
         LEFT JOIN users u_men ON i.mentor_id = u_men.user_id
         WHERE i.form_id = $1`,
        [formId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Intent form not found.' });
        return;
      }

      const row = result.rows[0];

      // RBAC validation
      const { roles, userId } = req.user;
      
      let isAuthorized = false;

      if (roles.some(r => ['staff', 'dean', 'advisor', 'dept_head'].includes(r))) {
        // SEC-06: personnel could previously open any intent detail regardless of
        // major, even though the list endpoint scoped them. Apply the same scope.
        await assertCanAccessStudent(userId, roles, row.student_id);
        isAuthorized = true;
      } else if (roles.includes('student') && row.student_id === userId) {
        isAuthorized = true;
      } else if (roles.includes('company')) {
        const companyQuery = await query('SELECT company_id FROM companies WHERE created_by = $1 LIMIT 1', [userId]);
        if ((companyQuery.rowCount ?? 0) > 0 && companyQuery.rows[0].company_id === row.company_id) {
          isAuthorized = true;
        }
      }

      if (!isAuthorized) {
        res.status(403).json({ message: 'Forbidden. You do not have access to view this intent form.' });
        return;
      }

      res.status(200).json(row);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Intent Detail Error', 'An internal server error occurred while retrieving intent details.');
    }
  }


  /**
   * Update student intent form status by Dept Head (Approve or Reject).
   * Route: PATCH /api/intents/:id/dept-head-status
   * Access: dept_head
   */
  static async updateIntentStatusByDeptHead(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const { status, reason } = req.body;
      if (!status || !['approved_by_dept_head', 'rejected_by_dept_head'].includes(status)) {
        res.status(400).json({ message: 'Required field: status must be either "approved_by_dept_head" or "rejected_by_dept_head".' });
        return;
      }

      const deptHeadId = req.user.userId;

      if (status === 'approved_by_dept_head') {
        await IntentFormModel.approveByDeptHead(formId, deptHeadId);

        writeAudit({
          action: AuditAction.INTENT_APPROVED_DEPT_HEAD,
          entityType: 'intent_form',
          entityId: formId,
        }, req).catch(() => undefined);

        // Send email notification to student
        notifyStudentStatusChange(formId, 'approved_by_dept_head').catch(console.error);

        res.status(200).json({
          message: "Intent form approved by department head. Status changed to 'approved_by_dept_head'.",
          form_id: formId,
        });
      } else {
        // Status is 'rejected_by_dept_head'
        console.log(`Intent form ${formId} rejected by dept_head ${deptHeadId}. Reason: ${reason || 'N/A'}`);
        await IntentFormModel.rejectByDeptHeadWithTransaction(formId, deptHeadId);

        writeAudit({
          action: AuditAction.INTENT_REJECTED_DEPT_HEAD,
          entityType: 'intent_form',
          entityId: formId,
          detail: { reason: reason || null },
        }, req).catch(() => undefined);

        // Send email notification to student
        notifyStudentStatusChange(formId, 'rejected_by_dept_head', reason).catch(console.error);

        res.status(200).json({
          message: "Intent form rejected by department head. Status changed to 'rejected_by_dept_head'.",
          form_id: formId,
        });
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'Update Intent Status By Dept Head Error', 'An internal server error occurred while updating intent status.');
    }
  }

  /**
   * Get pipeline summary counts for all statuses.
   * Route: GET /api/intents/pipeline-summary
   */
  static async getPipelineSummary(_req: Request, res: Response): Promise<void> {
    try {
      const summaryResult = await query(`
        SELECT status, COUNT(*)::int as count
        FROM intent_forms
        GROUP BY status
      `);

      const counts: Record<string, number> = {
        pending_advisor: 0,
        approved_by_advisor: 0,
        approved_by_dept_head: 0,
        accepted: 0,
        pending_officer_approval: 0,
        rejected_by_advisor: 0,
        rejected_by_dept_head: 0,
        company_rejected: 0,
        dispatch_eligible: 0
      };

      summaryResult.rows.forEach((row: { status: string; count: number }) => {
        if (counts.hasOwnProperty(row.status)) {
          counts[row.status] = Number(row.count);
        }
      });

      // Count dispatch eligible (status = 'accepted' AND no dispatch_letter doc)
      const dispatchEligibleResult = await query(`
        SELECT COUNT(*)::int as count
        FROM intent_forms i
        LEFT JOIN official_documents d ON d.student_id = i.student_id AND d.type = 'dispatch_letter'
        WHERE i.status = 'accepted' AND d.doc_id IS NULL
      `);
      counts.dispatch_eligible = Number(dispatchEligibleResult.rows[0]?.count || 0);

      res.status(200).json(counts);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Pipeline Summary Error', 'An error occurred while fetching pipeline summary.');
    }
  }

}

