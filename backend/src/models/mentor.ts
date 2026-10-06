import { query } from '../config/database';
import { Mentor } from '../types';

export class MentorModel {
  /**
   * Find a mentor by mentor_id.
   */
  static async findById(mentorId: number): Promise<Mentor | null> {
    const res = await query(
      `SELECT mentor_id, company_id, name, position, department, phone 
       FROM mentors 
       WHERE mentor_id = $1`,
      [mentorId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Mentor;
  }

  /**
   * The mentor's own profile, as their profile screen needs it: the row they
   * may edit, plus the company and login email they may only read.
   *
   * A mentor has no row in `personnel`, which is why sending them to the
   * personnel profile screen produced a permanent red banner — and offered them
   * a university major to pick and a document-approval signature to set.
   */
  static async findProfileById(mentorId: number): Promise<{
    mentor_id: number;
    company_id: number;
    name: string;
    position: string | null;
    department: string | null;
    phone: string;
    company_name_th: string;
    email: string;
  } | null> {
    const res = await query(
      `SELECT m.mentor_id, m.company_id, m.name, m.position, m.department, m.phone,
              c.name_th AS company_name_th,
              u.email
       FROM mentors m
       JOIN companies c ON m.company_id = c.company_id
       JOIN users u ON m.mentor_id = u.user_id
       WHERE m.mentor_id = $1`,
      [mentorId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0];
  }

  /**
   * Update the four fields a mentor owns. `company_id` is deliberately absent:
   * which company a mentor belongs to is set when the placement is accepted and
   * is not the mentor's to change (SEC-05 applies the same rule to students).
   */
  static async updateProfile(
    mentorId: number,
    data: { name: string; position: string | null; department: string | null; phone: string }
  ): Promise<Mentor | null> {
    const res = await query(
      `UPDATE mentors
       SET name = $2, position = $3, department = $4, phone = $5
       WHERE mentor_id = $1
       RETURNING mentor_id, company_id, name, position, department, phone`,
      [mentorId, data.name, data.position, data.department, data.phone]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Mentor;
  }

  /**
   * Find user and mentor profile details by email.
   * Useful to check if a user exists in the system and if they have a mentor profile.
   */
  static async findByEmail(email: string): Promise<{ user_id: number; email: string; roles: string[]; mentor?: Mentor } | null> {
    const cleanEmail = email.trim().toLowerCase();
    const res = await query(
      `SELECT u.user_id, u.email,
              COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') as roles,
              m.company_id, m.name, m.position, m.department, m.phone
       FROM users u
       LEFT JOIN user_roles r ON u.user_id = r.user_id
       LEFT JOIN mentors m ON u.user_id = m.mentor_id
       WHERE u.email = $1
       GROUP BY u.user_id, m.mentor_id`,
      [cleanEmail]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    
    const row = res.rows[0];
    const roles: string[] = typeof row.roles === 'string' ? JSON.parse(row.roles) : row.roles;
    
    let mentor: Mentor | undefined;
    if (row.company_id !== null && row.company_id !== undefined) {
      mentor = {
        mentor_id: row.user_id,
        company_id: row.company_id,
        name: row.name,
        position: row.position,
        department: row.department,
        phone: row.phone,
      };
    }

    return {
      user_id: row.user_id,
      email: row.email,
      roles,
      mentor,
    };
  }
}
