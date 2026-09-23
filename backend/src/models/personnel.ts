import { query } from '../config/database';
import { Personnel } from '../types';

export class PersonnelModel {
  static async findByPersonnelId(personnelId: number): Promise<Personnel | null> {
    // email / major / faculty names are for the profile screen, which shows them
    // read-only — the major decides whose students this person can see.
    const res = await query(
      `SELECT p.personnel_id, p.major_id, p.e_signature_file, p.status, p.first_name, p.last_name, p.birth_date,
              u.email, m.major_name_th, f.faculty_name_th
       FROM personnel p
       JOIN users u ON u.user_id = p.personnel_id
       LEFT JOIN master_major m ON m.major_id = p.major_id
       LEFT JOIN master_faculty f ON f.faculty_id = m.faculty_id
       WHERE p.personnel_id = $1`,
      [personnelId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Personnel;
  }

  static async createPersonnel(
    personnelId: number,
    majorId: number,
    eSignatureFile: string | null = null,
    firstName: string | null = null,
    lastName: string | null = null,
    birthDate: string | Date | null = null
  ): Promise<Personnel> {
    // Standard personnel accounts default to 'pending_approval' status upon profile registration.
    const res = await query(
      `INSERT INTO personnel (personnel_id, major_id, e_signature_file, status, first_name, last_name, birth_date) 
       VALUES ($1, $2, $3, 'pending_approval', $4, $5, $6) 
       RETURNING personnel_id, major_id, e_signature_file, status, first_name, last_name, birth_date`,
      [personnelId, majorId, eSignatureFile, firstName, lastName, birthDate]
    );
    return res.rows[0] as Personnel;
  }

  static async updateStatus(personnelId: number, status: 'pending_approval' | 'approved' | 'rejected'): Promise<boolean> {
    const res = await query(
      'UPDATE personnel SET status = $1 WHERE personnel_id = $2',
      [status, personnelId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Every field here is left alone when the caller passes null — except
   * `major_id`, which used to be written unconditionally. That is how saving an
   * e-signature (a screen that has no business knowing anyone's department, and
   * sent a hardcoded `major_id: 1`) silently moved personnel between majors.
   */
  static async updatePersonnel(
    personnelId: number,
    majorId: number | null,
    eSignatureFile: string | null,
    firstName: string | null = null,
    lastName: string | null = null,
    birthDate: string | Date | null = null
  ): Promise<Personnel> {
    const res = await query(
      `UPDATE personnel
       SET major_id = COALESCE($2, major_id),
           e_signature_file = COALESCE($3, e_signature_file),
           first_name = COALESCE($4, first_name),
           last_name = COALESCE($5, last_name),
           birth_date = COALESCE($6, birth_date)
       WHERE personnel_id = $1 
       RETURNING personnel_id, major_id, e_signature_file, status, first_name, last_name, birth_date`,
      [personnelId, majorId, eSignatureFile, firstName, lastName, birthDate]
    );
    return res.rows[0] as Personnel;
  }
}
