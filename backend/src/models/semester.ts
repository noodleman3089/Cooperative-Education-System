import { query } from '../config/database';
import { CoopSemester } from '../types';

export class CoopSemesterModel {
  /**
   * Get the current active cooperative education semester.
   */
  static async findActiveSemester(): Promise<CoopSemester | null> {
    const res = await query(
      `SELECT semester_id, academic_year, semester, is_active 
       FROM coop_semesters 
       WHERE is_active = TRUE 
       LIMIT 1`
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopSemester;
  }

  /**
   * Find a cooperative semester by ID.
   */
  static async findById(semesterId: number): Promise<CoopSemester | null> {
    const res = await query(
      `SELECT semester_id, academic_year, semester, is_active 
       FROM coop_semesters 
       WHERE semester_id = $1`,
      [semesterId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as CoopSemester;
  }
}
