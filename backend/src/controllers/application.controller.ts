import { Request, Response } from 'express';
import { ApplicationModel } from '../models/application';
import { assertCanAccessStudent, resolveMajorScope, sendAccessError } from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';
import { getErrorMessage, sendUnexpectedError } from '../utils/httpError';

export class ApplicationController {
  /**
   * @route POST /api/applications
   * @desc Submit a new Co-op 01 application (Student)
   * @access Student
   */
  static async submitApplication(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.user.roles.includes('student')) {
        res.status(403).json({ message: 'Forbidden. Only students can submit applications.' });
        return;
      }

      const studentId = req.user.userId;
      const { semester_id, expected_region, special_skills, claimed_gpa } = req.body;

      if (!semester_id) {
        res.status(400).json({ message: 'กรุณาระบุภาคการศึกษาที่ต้องการสมัคร' });
        return;
      }

      const parsedSemesterId = parseInt(String(semester_id), 10);
      if (isNaN(parsedSemesterId)) {
        res.status(400).json({ message: 'semester_id must be a valid integer.' });
        return;
      }

      // เกรดเป็นค่าที่นักศึกษาแจ้งเอง จึงบังคับให้กรอกและอยู่ในช่วงที่เป็นไปได้
      // ตัวเลขนี้ยังไม่แตะ students.cumulative_gpa จนกว่าหัวหน้าสาขาจะอนุมัติ (SEC-05)
      const parsedGpa = parseFloat(String(claimed_gpa));
      if (claimed_gpa === undefined || claimed_gpa === null || claimed_gpa === '' || isNaN(parsedGpa)) {
        res.status(400).json({ message: 'กรุณากรอกเกรดเฉลี่ยสะสมตามที่ปรากฏในใบแสดงผลการเรียน' });
        return;
      }
      if (parsedGpa < 0 || parsedGpa > 4) {
        res.status(400).json({ message: 'เกรดเฉลี่ยสะสมต้องอยู่ระหว่าง 0.00 ถึง 4.00' });
        return;
      }

      const application = await ApplicationModel.submit(
        studentId,
        parsedSemesterId,
        expected_region || null,
        special_skills || null,
        parsedGpa
      );

      res.status(201).json({
        success: true,
        message: 'Application submitted successfully.',
        data: application,
      });
    } catch (error) {
      console.error('Submit Application Error:', error);
      res.status(400).json({
        success: false,
        message: getErrorMessage(error, 'An error occurred while submitting your application.'),
      });
    }
  }

  /**
   * @route GET /api/applications/me
   * @desc Get applications for the logged-in student
   * @access Student
   */
  static async getMyApplications(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.user.roles.includes('student')) {
        res.status(403).json({ message: 'Forbidden. Only students can access this route.' });
        return;
      }

      const studentId = req.user.userId;
      const applications = await ApplicationModel.getByStudent(studentId);

      res.status(200).json({
        success: true,
        data: applications,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get My Applications Error', 'An internal server error occurred.');
    }
  }

  /**
   * @route GET /api/applications
   * @desc Get applications (Filtered by major for Advisors/Dept Heads)
   * @access Advisor, Dept Head, Dean, Staff
   */
  static async getApplications(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { roles, userId } = req.user;
      const { status } = req.query;

      // SEC-06: อาจารย์/หัวหน้าสาขาที่ไม่มีโปรไฟล์บุคลากรจะถูกปฏิเสธ ไม่ใช่เห็นทั้งมหาวิทยาลัย
      const scope = await resolveMajorScope(userId, roles);

      // เจ้าหน้าที่และคณบดีเห็นทั้งคณะ และเลือกกรองเฉพาะสาขาได้ผ่าน query param
      let majorId = scope.majorId;
      if (!scope.isScoped && req.query.major_id) {
        const requestedMajor = parseInt(req.query.major_id as string, 10);
        if (!isNaN(requestedMajor)) majorId = requestedMajor;
      }

      const applications = await ApplicationModel.list(majorId, status as string);

      res.status(200).json({
        success: true,
        data: applications,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Applications Error', 'An internal server error occurred.');
    }
  }

  /**
   * @route PUT /api/applications/:id/evaluate
   * @desc Evaluate an application (Step 1 - Advisor)
   * @access Advisor
   */
  static async evaluateByAdvisor(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.user.roles.includes('advisor')) {
        res.status(403).json({ message: 'Forbidden. Only advisors can evaluate applications.' });
        return;
      }

      const applicationId = parseInt(req.params.id, 10);
      if (isNaN(applicationId)) {
        res.status(400).json({ message: 'Invalid application ID.' });
        return;
      }

      const advisorId = req.user.userId;
      const {
        academic_evaluation, academic_remark,
        behavior_evaluation, behavior_remark,
        maturity_evaluation, maturity_remark
      } = req.body;

      // Validation
      if (!academic_evaluation || !behavior_evaluation || !maturity_evaluation) {
        res.status(400).json({ message: 'All 3 evaluation aspects are required.' });
        return;
      }
      
      const validOptions = ['appropriate', 'inappropriate'];
      if (!validOptions.includes(academic_evaluation) ||
          !validOptions.includes(behavior_evaluation) ||
          !validOptions.includes(maturity_evaluation)) {
        res.status(400).json({ message: 'Evaluation values must be appropriate or inappropriate.' });
        return;
      }

      // การประเมินว่า "ไม่เหมาะสม" ต้องมีเหตุผลเสมอ เพราะปลายทางคือนักศึกษาที่ต้องรู้ว่าติดตรงไหน
      const missingRemark = [
        { value: academic_evaluation, remark: academic_remark, label: 'ด้านวิชาการ' },
        { value: behavior_evaluation, remark: behavior_remark, label: 'ด้านความประพฤติ' },
        { value: maturity_evaluation, remark: maturity_remark, label: 'ด้านวุฒิภาวะ' },
      ].find((aspect) => aspect.value === 'inappropriate' && !String(aspect.remark || '').trim());

      if (missingRemark) {
        res.status(400).json({
          message: `กรุณาระบุเหตุผลของการประเมิน "ไม่เหมาะสม" ใน${missingRemark.label}`,
        });
        return;
      }

      const app = await ApplicationModel.findById(applicationId);
      if (!app) {
        res.status(404).json({ message: 'Application not found.' });
        return;
      }

      // SEC-06: อาจารย์ประเมินได้เฉพาะนักศึกษาในสาขาตัวเอง (Phase 1 ยังไม่มีการจับคู่ที่ปรึกษา)
      await assertCanAccessStudent(advisorId, req.user.roles, app.student_id);

      const success = await ApplicationModel.evaluateByAdvisor(applicationId, advisorId, {
        academic_evaluation,
        academic_remark,
        behavior_evaluation,
        behavior_remark,
        maturity_evaluation,
        maturity_remark
      });

      if (!success) {
        res.status(400).json({ message: 'ใบสมัครนี้ถูกพิจารณาไปแล้ว หรือไม่ได้อยู่ในขั้นรออาจารย์ที่ปรึกษา' });
        return;
      }

      void writeAudit(
        {
          action: AuditAction.APPLICATION_EVALUATED,
          entityType: 'coop_application',
          entityId: applicationId,
          subjectId: app.student_id,
          detail: { academic_evaluation, behavior_evaluation, maturity_evaluation },
        },
        req
      );

      res.status(200).json({
        success: true,
        message: 'บันทึกผลการประเมินเรียบร้อยแล้ว',
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Evaluate By Advisor Error', 'An internal server error occurred.');
    }
  }

  /**
   * @route PUT /api/applications/:id/approve
   * @desc Approve an application (Step 2 - Dept Head)
   * @access Dept Head
   */
  static async approveByDeptHead(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.user.roles.includes('dept_head')) {
        res.status(403).json({ message: 'Forbidden. Only department heads can approve applications.' });
        return;
      }

      const applicationId = parseInt(req.params.id, 10);
      if (isNaN(applicationId)) {
        res.status(400).json({ message: 'Invalid application ID.' });
        return;
      }

      const deptHeadId = req.user.userId;
      const { conclusion, remark } = req.body; // 'approved', 'waitlisted', 'other'

      if (!conclusion || !['approved', 'waitlisted', 'other'].includes(conclusion)) {
        res.status(400).json({ message: 'Invalid conclusion value.' });
        return;
      }

      // ผลที่ไม่ใช่ "อนุมัติ" ต้องมีเหตุผล — นักศึกษาต้องรู้ว่าทำไมยังไปต่อไม่ได้
      if (conclusion !== 'approved' && !String(remark || '').trim()) {
        res.status(400).json({ message: 'กรุณาระบุเหตุผลของผลการพิจารณา' });
        return;
      }

      const app = await ApplicationModel.findById(applicationId);
      if (!app) {
        res.status(404).json({ message: 'Application not found.' });
        return;
      }

      // SEC-06: หัวหน้าสาขาอนุมัติได้เฉพาะนักศึกษาในสาขาตัวเอง
      await assertCanAccessStudent(deptHeadId, req.user.roles, app.student_id);

      const result = await ApplicationModel.approveByDeptHeadWithTransaction(
        applicationId,
        deptHeadId,
        conclusion,
        remark
      );

      // SEC-07: การอนุมัติตรงนี้ให้สิทธิ์สหกิจและเขียนเกรดทางการ — ต้องมีร่องรอยว่าใครทำ
      void writeAudit(
        {
          action: AuditAction.APPLICATION_DECIDED,
          entityType: 'coop_application',
          entityId: applicationId,
          subjectId: result.studentId,
          detail: {
            conclusion,
            remark: remark || null,
            is_eligible_set: conclusion === 'approved',
            cumulative_gpa_applied: result.gpaApplied,
          },
        },
        req
      );

      res.status(200).json({
        success: true,
        message:
          conclusion === 'approved'
            ? 'อนุมัติใบสมัครเรียบร้อยแล้ว นักศึกษาได้รับสิทธิ์เข้าร่วมสหกิจศึกษา'
            : 'บันทึกผลการพิจารณาเรียบร้อยแล้ว',
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      console.error('Approve By Dept Head Error:', error);
      res.status(400).json({
        success: false,
        message: getErrorMessage(error, 'An error occurred while approving the application.'),
      });
    }
  }
}
