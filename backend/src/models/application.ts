import pool, { query } from '../config/database';

export interface CoopApplication {
  application_id: number;
  student_id: number;
  semester_id: number;
  expected_region: string;
  special_skills: string;
  /** เกรดที่นักศึกษาแจ้งเองในใบสมัคร ยังไม่ใช่เกรดทางการจนกว่าหัวหน้าสาขาจะอนุมัติ */
  claimed_gpa: string | number | null;
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
    specialSkills: string | null,
    claimedGpa: number
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
        throw new Error('คุณยื่นใบสมัครของภาคการศึกษานี้ไปแล้ว');
      }

      const insertRes = await client.query(
        `INSERT INTO coop_applications (student_id, semester_id, expected_region, special_skills, claimed_gpa, status)
         VALUES ($1, $2, $3, $4, $5, 'pending_advisor')
         RETURNING *`,
        [studentId, semesterId, expectedRegion, specialSkills, claimedGpa]
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
   * List applications for reviewers.
   *
   * SEC-06: `majorId === null` means the caller is staff or a dean — a scope the
   * *caller* proved through resolveMajorScope, never a filter that quietly went
   * missing. Advisors and department heads always arrive here with a major.
   */
  static async list(majorId: number | null, status?: string): Promise<any[]> {
    let queryStr = `
      SELECT a.*, s.student_code, s.first_name, s.last_name, s.cumulative_gpa,
             sem.semester, sem.academic_year
      FROM coop_applications a
      JOIN students s ON a.student_id = s.student_id
      JOIN coop_semesters sem ON a.semester_id = sem.semester_id
    `;
    const params: any[] = [];
    const conditions: string[] = [];

    if (majorId !== null) {
      params.push(majorId);
      conditions.push(`s.major_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`a.status = $${params.length}`);
    }

    if (conditions.length > 0) {
      queryStr += ` WHERE ${conditions.join(' AND ')}`;
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
  ): Promise<{ studentId: number; gpaApplied: number | null }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock the application
      const appRes = await client.query(
        `SELECT student_id, status, claimed_gpa FROM coop_applications WHERE application_id = $1 FOR UPDATE`,
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

      // 3. การอนุมัติของหัวหน้าสาขาคือ *ทางเดียว* ที่ students.is_eligible ถูกตั้งเป็น TRUE
      //    การนำเข้า CSV เขียนได้แค่ eligible_students_list เท่านั้น จึงไม่มีสองแหล่ง
      //    ที่เขียนทับกันเงียบๆ อีก · เกรดที่นักศึกษาแจ้งจะกลายเป็นเกรดทางการตรงนี้
      //    เพราะตรงนี้คือจุดที่มีมนุษย์รับผิดชอบและถูกบันทึกลง audit_log
      let gpaApplied: number | null = null;
      if (conclusion === 'approved') {
        gpaApplied = app.claimed_gpa !== null ? Number(app.claimed_gpa) : null;
        await client.query(
          `UPDATE students
           SET is_eligible = TRUE,
               cumulative_gpa = COALESCE($2, cumulative_gpa)
           WHERE student_id = $1`,
          [app.student_id, gpaApplied]
        );
      }

      await client.query('COMMIT');
      return { studentId: app.student_id as number, gpaApplied };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
