import { Request, Response } from 'express';
import { ApplicationModel } from '../models/application';
import { StudentModel } from '../models/student';
import { PersonnelModel } from '../models/personnel';

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
      const { semester_id, expected_region, special_skills } = req.body;

      if (!semester_id) {
        res.status(400).json({ message: 'Required field: semester_id.' });
        return;
      }

      const parsedSemesterId = parseInt(semester_id as any, 10);
      if (isNaN(parsedSemesterId)) {
        res.status(400).json({ message: 'semester_id must be a valid integer.' });
        return;
      }

      const application = await ApplicationModel.submit(
        studentId,
        parsedSemesterId,
        expected_region || null,
        special_skills || null
      );

      res.status(201).json({
        success: true,
        message: 'Application submitted successfully.',
        data: application,
      });
    } catch (error: any) {
      console.error('Submit Application Error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'An error occurred while submitting your application.',
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
    } catch (error: any) {
      console.error('Get My Applications Error:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
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

      const isStaffOrDean = roles.some((r: string) => ['staff', 'dean'].includes(r));
      let majorId: number | null = null;

      // If advisor or dept_head, restrict to their major
      if (!isStaffOrDean && roles.some((r: string) => ['advisor', 'dept_head'].includes(r))) {
        const personnelProfile = await PersonnelModel.findByPersonnelId(userId);
        if (personnelProfile) {
          majorId = personnelProfile.major_id;
        } else {
          res.status(403).json({ message: 'Personnel profile not found.' });
          return;
        }
      }

      if (majorId === null) {
        // Fallback for staff/dean if they want to filter by major (optional query param)
        if (req.query.major_id) {
          majorId = parseInt(req.query.major_id as string, 10);
        }
      }

      if (majorId === null) {
        // If still null, return empty or implement a global fetch method.
        // For System 1, it's safer to require major_id context.
        res.status(400).json({ message: 'major_id is required to fetch applications.' });
        return;
      }

      const applications = await ApplicationModel.getByMajor(majorId, status as string);

      res.status(200).json({
        success: true,
        data: applications,
      });
    } catch (error: any) {
      console.error('Get Applications Error:', error);
      res.status(500).json({
        success: false,
        message: 'An internal server error occurred.',
      });
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

      // IDOR Major Guard
      const app = await ApplicationModel.findById(applicationId);
      if (!app) {
        res.status(404).json({ message: 'Application not found.' });
        return;
      }

      const studentProfile = await StudentModel.findByStudentId(app.student_id);
      const advisorProfile = await PersonnelModel.findByPersonnelId(advisorId);

      if (!studentProfile || !advisorProfile || studentProfile.major_id !== advisorProfile.major_id) {
        res.status(403).json({ message: 'Forbidden. Major ID mismatch.' });
        return;
      }

      const success = await ApplicationModel.evaluateByAdvisor(applicationId, advisorId, {
        academic_evaluation,
        academic_remark,
        behavior_evaluation,
        behavior_remark,
        maturity_evaluation,
        maturity_remark
      });

      if (!success) {
        res.status(400).json({ message: 'Failed to evaluate. Ensure application is in pending_advisor status.' });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Evaluation saved successfully.',
      });
    } catch (error: any) {
      console.error('Evaluate By Advisor Error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'An internal server error occurred.',
      });
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

      // IDOR Major Guard
      const app = await ApplicationModel.findById(applicationId);
      if (!app) {
        res.status(404).json({ message: 'Application not found.' });
        return;
      }

      const studentProfile = await StudentModel.findByStudentId(app.student_id);
      const deptHeadProfile = await PersonnelModel.findByPersonnelId(deptHeadId);

      if (!studentProfile || !deptHeadProfile || studentProfile.major_id !== deptHeadProfile.major_id) {
        res.status(403).json({ message: 'Forbidden. Major ID mismatch.' });
        return;
      }

      await ApplicationModel.approveByDeptHeadWithTransaction(applicationId, deptHeadId, conclusion, remark);

      res.status(200).json({
        success: true,
        message: `Application ${conclusion} successfully.`,
      });
    } catch (error: any) {
      console.error('Approve By Dept Head Error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'An error occurred while approving the application.',
      });
    }
  }
}
