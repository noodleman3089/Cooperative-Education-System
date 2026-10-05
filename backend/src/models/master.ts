import { query } from '../config/database';

export interface FacultyData {
  faculty_id: number;
  faculty_name_th: string;
  /** 🔴 คีย์ใหม่ (2026-09-10) — เพิ่มเข้ามา ไม่ได้เปลี่ยนรูปร่างเดิม ดู `getFaculties` */
  major_count?: number;
  student_count?: number;
}

export interface MajorData {
  major_id: number;
  faculty_id: number;
  faculty_name_th: string;
  major_code: string;
  major_name_th: string;
  /** 🔴 คีย์ใหม่ (2026-09-10) — ให้หน้าจอปิดปุ่มลบได้โดยไม่ต้องยิงคำขอเพิ่ม */
  student_count?: number;
}

/** สิ่งที่ยังอ้างสาขาอยู่ — ทั้งสองตัวนี้กันการลบที่ระดับฐาน ต้องตอบเป็น 409 ไม่ใช่ 500 */
export interface MajorBlockers {
  major_id: number;
  major_code: string;
  major_name_th: string;
  student_count: number;
  personnel_count: number;
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
  /**
   * ⛔ `major_count` / `student_count` เป็นการ **เพิ่มคีย์** ไม่ใช่เปลี่ยนรูปร่าง —
   *    dropdown ทุกหน้าในระบบอ่านผลของฟังก์ชันนี้อยู่ ห้ามตัดหรือเปลี่ยนชื่อคีย์เดิม
   *    (มีไว้ให้แท็บข้อมูลหลักปิดปุ่มลบได้เองโดยไม่ต้องยิงคำขอเพิ่มทีละแถว)
   */
  static async getFaculties(): Promise<FacultyData[]> {
    const res = await query(
      `SELECT f.faculty_id, f.faculty_name_th,
              (SELECT COUNT(*)::int FROM master_major m
                WHERE m.faculty_id = f.faculty_id) AS major_count,
              (SELECT COUNT(*)::int FROM students s
                JOIN master_major m2 ON m2.major_id = s.major_id
               WHERE m2.faculty_id = f.faculty_id) AS student_count
         FROM master_faculty f
        ORDER BY f.faculty_id`
    );
    return res.rows as FacultyData[];
  }

  static async getMajors(): Promise<MajorData[]> {
    const res = await query(
      `SELECT m.major_id, m.faculty_id, f.faculty_name_th, m.major_code, m.major_name_th,
              (SELECT COUNT(*)::int FROM students s WHERE s.major_id = m.major_id) AS student_count
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

  /* ── แก้ทะเบียนคณะและสาขา (SB7) ────────────────────────────────────
   *
   * ก่อนหน้านี้ไฟล์นี้มีแต่ฝั่งอ่าน — วิธีเดียวที่จะเพิ่มสาขาใหม่คือเข้าไป INSERT
   * ในฐานข้อมูลตรง ๆ ซึ่งแปลว่าคณะเปิดสาขาใหม่แล้วระบบใช้ไม่ได้จนกว่าจะมีคนเขียน SQL
   */

  /**
   * สิ่งที่ยังอ้างสาขาพวกนี้อยู่ — **ต้องเช็คทั้งสองตาราง ไม่ใช่แค่ `students`**
   *
   * ⛔ `personnel.major_id` กันการลบที่ระดับฐานเหมือนกัน
   *    ถ้าเช็คแต่ `students` แล้วปล่อยผ่าน คำสั่ง DELETE จะตายด้วย FK error
   *    แล้วผู้ใช้ได้ 500 "เกิดข้อผิดพลาดของระบบ" ซึ่งไม่บอกว่าติดอะไร
   *    (`personnel_preseed_list.major_id` เป็น ON DELETE SET NULL จึงไม่กัน ไม่ต้องเช็ค)
   */
  static async majorBlockers(majorIds: number[]): Promise<MajorBlockers[]> {
    if (majorIds.length === 0) return [];
    const res = await query(
      `SELECT m.major_id, m.major_code, m.major_name_th,
              (SELECT COUNT(*)::int FROM students s WHERE s.major_id = m.major_id) AS student_count,
              (SELECT COUNT(*)::int FROM personnel p WHERE p.major_id = m.major_id) AS personnel_count
         FROM master_major m
        WHERE m.major_id = ANY($1::int[])
        ORDER BY m.major_id`,
      [majorIds]
    );
    return res.rows as MajorBlockers[];
  }

  /** สาขาทั้งหมดใต้คณะหนึ่ง — ใช้ทั้งตอนเตือนก่อนลบและตอนรายงานว่าลบอะไรไปบ้าง */
  static async majorsOfFaculty(facultyId: number) {
    const res = await query(
      `SELECT major_id, major_code, major_name_th FROM master_major
        WHERE faculty_id = $1 ORDER BY major_id`,
      [facultyId]
    );
    return res.rows as { major_id: number; major_code: string; major_name_th: string }[];
  }

  static async findFaculty(facultyId: number): Promise<FacultyData | null> {
    const res = await query(
      'SELECT faculty_id, faculty_name_th FROM master_faculty WHERE faculty_id = $1',
      [facultyId]
    );
    return (res.rows[0] as FacultyData | undefined) ?? null;
  }

  static async findMajor(majorId: number) {
    const res = await query(
      `SELECT major_id, faculty_id, major_code, major_name_th FROM master_major WHERE major_id = $1`,
      [majorId]
    );
    return (
      (res.rows[0] as
        | { major_id: number; faculty_id: number; major_code: string; major_name_th: string }
        | undefined) ?? null
    );
  }

  /** ชื่อคณะซ้ำ (UNIQUE) — คืนแถวที่ชนเพื่อให้บอกได้ว่าซ้ำกับอันไหน ไม่ใช่ "ชื่อซ้ำ" ลอย ๆ */
  static async findFacultyByName(name: string, exceptId?: number): Promise<FacultyData | null> {
    const res = await query(
      `SELECT faculty_id, faculty_name_th FROM master_faculty
        WHERE btrim(lower(faculty_name_th)) = btrim(lower($1))
          AND ($2::int IS NULL OR faculty_id <> $2)
        LIMIT 1`,
      [name, exceptId ?? null]
    );
    return (res.rows[0] as FacultyData | undefined) ?? null;
  }

  /** รหัสสาขาซ้ำ — `major_code` เป็น UNIQUE ทั้งตาราง ไม่ใช่ unique ต่อคณะ */
  static async findMajorByCode(code: string, exceptId?: number) {
    const res = await query(
      `SELECT major_id, major_code, major_name_th FROM master_major
        WHERE btrim(lower(major_code)) = btrim(lower($1))
          AND ($2::int IS NULL OR major_id <> $2)
        LIMIT 1`,
      [code, exceptId ?? null]
    );
    return (
      (res.rows[0] as { major_id: number; major_code: string; major_name_th: string } | undefined) ??
      null
    );
  }

  static async createFaculty(name: string): Promise<FacultyData> {
    const res = await query(
      'INSERT INTO master_faculty (faculty_name_th) VALUES ($1) RETURNING faculty_id, faculty_name_th',
      [name]
    );
    return res.rows[0] as FacultyData;
  }

  static async updateFaculty(facultyId: number, name: string): Promise<FacultyData> {
    const res = await query(
      `UPDATE master_faculty SET faculty_name_th = $2 WHERE faculty_id = $1
       RETURNING faculty_id, faculty_name_th`,
      [facultyId, name]
    );
    return res.rows[0] as FacultyData;
  }

  /** ⛔ ผู้เรียกต้องตรวจ `majorBlockers` ของทุกสาขาใต้คณะก่อนเสมอ — CASCADE ลบสาขาเงียบ ๆ */
  static async deleteFaculty(facultyId: number): Promise<void> {
    await query('DELETE FROM master_faculty WHERE faculty_id = $1', [facultyId]);
  }

  static async createMajor(facultyId: number, code: string, name: string) {
    const res = await query(
      `INSERT INTO master_major (faculty_id, major_code, major_name_th) VALUES ($1, $2, $3)
       RETURNING major_id, faculty_id, major_code, major_name_th`,
      [facultyId, code, name]
    );
    return res.rows[0];
  }

  static async updateMajor(majorId: number, facultyId: number, code: string, name: string) {
    const res = await query(
      `UPDATE master_major SET faculty_id = $2, major_code = $3, major_name_th = $4
        WHERE major_id = $1
       RETURNING major_id, faculty_id, major_code, major_name_th`,
      [majorId, facultyId, code, name]
    );
    return res.rows[0];
  }

  static async deleteMajor(majorId: number): Promise<void> {
    await query('DELETE FROM master_major WHERE major_id = $1', [majorId]);
  }
}
