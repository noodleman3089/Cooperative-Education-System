import { Request, Response } from 'express';
import { query } from '../config/database';
import { PersonnelModel } from '../models/personnel';
import { resolveMajorScope, sendAccessError } from '../utils/access';
import { sendUnexpectedError } from '../utils/httpError';

export class PersonnelController {
  /**
   * Get list of personnel with filtering.
   * Route: GET /api/personnel
   * Access: staff, dept_head
   */
  static async getPersonnel(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { role, major_id } = req.query;

      const { roles, userId } = req.user;

      // SEC-06: fails closed. This used to be the forbidden shape —
      // `if (personnelRow) { applyFilter }` — so a department head whose
      // personnel row was missing got no filter at all and saw every member of
      // staff in the university instead of their own department.
      const userMajorId = (await resolveMajorScope(userId, roles)).majorId;

      // first_name/last_name are selected because the screens that consume this
      // list are choosing a person — the department head assigns an advisor to a
      // student — and without them the only label available was the email
      // address, so the UI read "advisor1@test.com" where a name belongs.
      let queryStr = `
        SELECT p.personnel_id, p.major_id, m.major_name_th, p.e_signature_file, p.status,
               p.first_name, p.last_name,
               u.email,
               COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') as roles
        FROM personnel p
        JOIN users u ON p.personnel_id = u.user_id
        JOIN user_roles r ON u.user_id = r.user_id
        JOIN master_major m ON p.major_id = m.major_id
        WHERE 1=1
      `;
      const queryParams: unknown[] = [];

      if (userMajorId !== null) {
        queryParams.push(userMajorId);
        queryStr += ` AND p.major_id = $${queryParams.length}`;
      } else if (major_id) {
        queryParams.push(parseInt(major_id as string, 10));
        queryStr += ` AND p.major_id = $${queryParams.length}`;
      }

      queryStr += ` GROUP BY p.personnel_id, p.first_name, p.last_name, m.major_name_th, u.email`;

      const result = await query(queryStr, queryParams);
      let rows = result.rows;

      // If filtering by role, filter based on roles JSON array
      if (role) {
        rows = rows.filter((p: any) => {
          const rolesList = typeof p.roles === 'string' ? JSON.parse(p.roles) : p.roles;
          return rolesList.includes(role);
        });
      }

      res.status(200).json(rows);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Personnel List Error', 'An internal server error occurred while retrieving personnel.');
    }
  }

  /**
   * Approve/reject personnel registration status.
   * Route: PUT /api/personnel/:id/approve
   * Access: staff
   */
  static async approvePersonnel(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const personnelId = parseInt(req.params.id, 10);
      if (isNaN(personnelId)) {
        res.status(400).json({ message: 'Invalid personnel ID format.' });
        return;
      }

      const { status } = req.body;
      if (!status || !['approved', 'rejected', 'pending_approval'].includes(status)) {
        res.status(400).json({ message: "Invalid status. Must be 'approved', 'rejected', or 'pending_approval'." });
        return;
      }

      const updated = await PersonnelModel.updateStatus(personnelId, status as any);
      if (!updated) {
        res.status(404).json({ message: 'Personnel profile not found.' });
        return;
      }

      res.status(200).json({
        message: `Personnel registration status updated to '${status}' successfully.`,
        personnel_id: personnelId
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Approve Personnel Error', 'An internal server error occurred while updating personnel status.');
    }
  }

  /**
   * Get list of students assigned to the logged-in supervisor/advisor
   * Route: GET /api/personnel/supervised-students
   * Access: advisor
   */
  static async getSupervisedStudents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const personnelId = req.user.userId;

      // Query students where this personnel is either advisor or supervisor
      const queryStr = `
        SELECT 
          s.student_id, s.student_code, s.first_name, s.last_name, s.phone,
          s.advisor_id, s.supervisor_id,
          c.name_th as company_name, c.address as company_address, c.province as company_province, c.district as company_district, c.google_place_id,
          m.name as mentor_name, m.phone as mentor_phone,
          a.address as accommodation_address, a.phone as accommodation_phone, a.emergency_contact, a.emergency_phone,
          COALESCE(
            (SELECT json_agg(json_build_object(
              'plan_id', w.plan_id,
              'week_number', w.week_number,
              'start_date', w.start_date,
              'end_date', w.end_date,
              'tasks', w.tasks,
              'status', w.status
            ) ORDER BY w.week_number ASC)
            FROM weekly_work_plans w WHERE w.student_id = s.student_id), '[]'
          ) as weekly_plans
        FROM students s
        JOIN intent_forms i ON s.student_id = i.student_id AND i.status NOT IN ('rejected', 'company_rejected', 'rejected_by_dept_head')
        JOIN companies c ON i.company_id = c.company_id
        LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
        LEFT JOIN accommodations a ON s.student_id = a.student_id
        WHERE s.supervisor_id = $1 OR s.advisor_id = $1
      `;
      
      const result = await query(queryStr, [personnelId]);
      res.status(200).json(result.rows);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Supervised Students Error', 'An internal server error occurred while retrieving supervised students.');
    }
  }
}
