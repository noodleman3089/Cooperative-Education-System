import pool, { query } from '../config/database';

export interface CoopApplication {
  application_id: number;
  student_id: number;
  semester_id: number;
  expected_region: string;
  special_skills: string;
  status: string;
  academic_evaluation?: string;
  academic_remark?: string;
  behavior_evaluation?: string;
  behavior_remark?: string;
  maturity_evaluation?: string;
  maturity_remark?: string;
  advisor_id?: number;
  advisor_evaluated_at?: Date;
  overall_conclusion?: string;
  conclusion_remark?: string;
  dept_head_id?: number;
  dept_head_approved_at?: Date;
  created_at: Date;
}

export class ApplicationModel {
  /**
   * Submit a new application (Student)
   */
  static async submit(
    studentId: number,
    semesterId: number,
    expectedRegion: string | null,
    specialSkills: string | null
  ): Promise<CoopApplication> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check if student already applied this semester
      const duplicateCheck = await client.query(
        `SELECT 1 FROM coop_applications WHERE student_id = $1 AND semester_id = $2`,
        [studentId, semesterId]
      );
      if ((duplicateCheck.rowCount ?? 0) > 0) {
        throw new Error('You have already submitted an application for this semester.');
      }

      const insertRes = await client.query(
        `INSERT INTO coop_applications (student_id, semester_id, expected_region, special_skills, status)
         VALUES ($1, $2, $3, $4, 'pending_advisor')
         RETURNING *`,
        [studentId, semesterId, expectedRegion, specialSkills]
      );
      
      await client.query('COMMIT');
      return insertRes.rows[0] as CoopApplication;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Find application by ID with lock
   */
  static async findById(applicationId: number): Promise<CoopApplication | null> {
    const res = await query(
      `SELECT * FROM coop_applications WHERE application_id = $1`,
      [applicationId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopApplication;
  }

  /**
   * Get all applications for a specific major
   */
  static async getByMajor(majorId: number, status?: string): Promise<any[]> {
    let queryStr = `
      SELECT a.*, s.student_code, s.first_name, s.last_name, s.cumulative_gpa
      FROM coop_applications a
      JOIN students s ON a.student_id = s.student_id
      WHERE s.major_id = $1
    `;
    const params: any[] = [majorId];
    
    if (status) {
      params.push(status);
      queryStr += ` AND a.status = $2`;
    }
    
    queryStr += ` ORDER BY a.created_at DESC`;
    
    const res = await query(queryStr, params);
    return res.rows;
  }

  /**
   * Get applications for a specific student
   */
  static async getByStudent(studentId: number): Promise<any[]> {
    const res = await query(
      `SELECT a.*, sem.semester, sem.academic_year 
       FROM coop_applications a
       JOIN coop_semesters sem ON a.semester_id = sem.semester_id
       WHERE a.student_id = $1
       ORDER BY a.created_at DESC`,
      [studentId]
    );
    return res.rows;
  }

  /**
   * Step 1: Advisor evaluates the application
   */
  static async evaluateByAdvisor(
    applicationId: number,
    advisorId: number,
    evaluations: {
      academic_evaluation: string;
      academic_remark?: string;
      behavior_evaluation: string;
      behavior_remark?: string;
      maturity_evaluation: string;
      maturity_remark?: string;
    }
  ): Promise<boolean> {
    const res = await query(
      `UPDATE coop_applications 
       SET status = 'pending_dept_head',
           academic_evaluation = $1, academic_remark = $2,
           behavior_evaluation = $3, behavior_remark = $4,
           maturity_evaluation = $5, maturity_remark = $6,
           advisor_id = $7, advisor_evaluated_at = NOW()
       WHERE application_id = $8 AND status = 'pending_advisor'`,
      [
        evaluations.academic_evaluation, evaluations.academic_remark || null,
        evaluations.behavior_evaluation, evaluations.behavior_remark || null,
        evaluations.maturity_evaluation, evaluations.maturity_remark || null,
        advisorId, applicationId
      ]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Step 2: Dept Head approves and updates student eligibility transactionally
   */
  static async approveByDeptHeadWithTransaction(
    applicationId: number,
    deptHeadId: number,
    conclusion: string, // 'approved', 'waitlisted', 'other'
    remark?: string
  ): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock the application
      const appRes = await client.query(
        `SELECT student_id, status FROM coop_applications WHERE application_id = $1 FOR UPDATE`,
        [applicationId]
      );

      if ((appRes.rowCount ?? 0) === 0) {
        throw new Error('Application not found.');
      }

      const app = appRes.rows[0];
      if (app.status !== 'pending_dept_head') {
        throw new Error(`Cannot approve application in '${app.status}' status.`);
      }

      // 2. Update the application status
      await client.query(
        `UPDATE coop_applications 
         SET status = $1, overall_conclusion = $2, conclusion_remark = $3,
             dept_head_id = $4, dept_head_approved_at = NOW()
         WHERE application_id = $5`,
        [conclusion, conclusion, remark || null, deptHeadId, applicationId]
      );

      // 3. If approved, update student eligibility (Logic Lens constraint)
      if (conclusion === 'approved') {
        await client.query(
          `UPDATE students SET is_eligible = TRUE WHERE student_id = $1`,
          [app.student_id]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
