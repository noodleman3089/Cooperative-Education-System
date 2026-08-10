import { query } from '../config/database';

export interface FacultyData {
  faculty_id: number;
  faculty_name_th: string;
}

export interface MajorData {
  major_id: number;
  faculty_id: number;
  faculty_name_th: string;
  major_code: string;
  major_name_th: string;
}

export interface ProvinceData {
  province_id: number;
  province_name_th: string;
}

export interface SemesterData {
  semester_id: number;
  academic_year: number;
  semester: string;
  is_active: boolean;
}

export class MasterModel {
  static async getFaculties(): Promise<FacultyData[]> {
    const res = await query('SELECT faculty_id, faculty_name_th FROM master_faculty ORDER BY faculty_id');
    return res.rows as FacultyData[];
  }

  static async getMajors(): Promise<MajorData[]> {
    const res = await query(
      `SELECT m.major_id, m.faculty_id, f.faculty_name_th, m.major_code, m.major_name_th 
       FROM master_major m
       JOIN master_faculty f ON m.faculty_id = f.faculty_id
       ORDER BY m.major_id`
    );
    return res.rows as MajorData[];
  }

  static async getProvinces(): Promise<ProvinceData[]> {
    const res = await query('SELECT province_id, province_name_th FROM master_province ORDER BY province_name_th');
    return res.rows as ProvinceData[];
  }

  static async getSemesters(): Promise<SemesterData[]> {
    const res = await query('SELECT semester_id, academic_year, semester, is_active FROM coop_semesters ORDER BY academic_year DESC, semester DESC');
    return res.rows as SemesterData[];
  }

  static async verifyMajorExists(majorId: number): Promise<boolean> {
    const res = await query('SELECT 1 FROM master_major WHERE major_id = $1 LIMIT 1', [majorId]);
    return (res.rowCount ?? 0) > 0;
  }

  static async verifyProvinceExists(provinceId: number): Promise<boolean> {
    const res = await query('SELECT 1 FROM master_province WHERE province_id = $1 LIMIT 1', [provinceId]);
    return (res.rowCount ?? 0) > 0;
  }
}
