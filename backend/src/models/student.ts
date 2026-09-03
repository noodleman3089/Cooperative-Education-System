import { query } from '../config/database';
import { Student } from '../types';

export class StudentModel {
  static async findByStudentId(studentId: number): Promise<Student | null> {
    const res = await query(
      `SELECT student_id, student_code, major_id, province_id, cumulative_gpa, resume_file, profile_image, is_eligible, is_orientation_passed, advisor_id, supervisor_id,
              first_name, last_name, nickname, year_level, birth_date, alt_email, phone, current_address, parent_name, parent_phone, enrollment_year,
              skills_and_activities, language_proficiency, preferred_work_region, interested_job_types
       FROM students 
       WHERE student_id = $1`,
      [studentId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Student;
  }

  static async existsByStudentCode(studentCode: string): Promise<boolean> {
    const res = await query(
      'SELECT 1 FROM students WHERE student_code = $1 LIMIT 1',
      [studentCode]
    );
    return (res.rowCount ?? 0) > 0;
  }

  static async existsByStudentCodeExcludeUser(studentCode: string, studentId: number): Promise<boolean> {
    const res = await query(
      'SELECT 1 FROM students WHERE student_code = $1 AND student_id != $2 LIMIT 1',
      [studentCode, studentId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  static async createStudent(
    studentId: number,
    studentCode: string,
    majorId: number,
    provinceId: number | null,
    cumulativeGpa: number | null,
    firstName: string | null = null,
    lastName: string | null = null,
    nickname: string | null = null,
    yearLevel: number | null = null,
    birthDate: string | Date | null = null,
    altEmail: string | null = null,
    phone: string | null = null,
    currentAddress: string | null = null,
    parentName: string | null = null,
    parentPhone: string | null = null,
    enrollmentYear: number | null = null,
    isEligible: boolean = false,
    isOrientationPassed: boolean = false
  ): Promise<Student> {
    // SEC-02: eligibility defaults to FALSE. It is granted only by the staff
    // eligibility import or an explicit staff/dept_head verification — never as a
    // side effect of a student creating their own profile.
    const res = await query(
      `INSERT INTO students (student_id, student_code, major_id, province_id, cumulative_gpa, resume_file, is_eligible, is_orientation_passed, advisor_id, supervisor_id,
                            first_name, last_name, nickname, year_level, birth_date, alt_email, phone, current_address, parent_name, parent_phone, enrollment_year)
       VALUES ($1, $2, $3, $4, $5, NULL, $17, $18, NULL, NULL, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [studentId, studentCode, majorId, provinceId, cumulativeGpa, firstName, lastName, nickname, yearLevel, birthDate, altEmail, phone, currentAddress, parentName, parentPhone, enrollmentYear, isEligible, isOrientationPassed]
    );
    return res.rows[0] as Student;
  }

  /**
   * Look up a student_code in the staff-managed eligibility staging list.
   * Returns null when the code was never imported by staff.
   */
  static async findEligibilityRecord(
    studentCode: string
  ): Promise<{ cumulative_gpa: number; is_eligible: boolean; email: string | null } | null> {
    const res = await query(
      'SELECT cumulative_gpa, is_eligible, email FROM eligible_students_list WHERE student_code = $1 LIMIT 1',
      [studentCode]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0];
  }

  static async updateStudent(
    studentId: number,
    studentCode: string,
    majorId: number,
    provinceId: number | null,
    cumulativeGpa: number | null,
    resumeFile: string | null,
    firstName: string | null,
    lastName: string | null,
    nickname: string | null,
    yearLevel: number | null,
    birthDate: string | Date | null,
    altEmail: string | null,
    phone: string | null,
    currentAddress: string | null,
    parentName: string | null,
    parentPhone: string | null,
    enrollmentYear: number | null
  ): Promise<Student> {
    const res = await query(
      `UPDATE students 
       SET student_code = $2, major_id = $3, province_id = $4, cumulative_gpa = $5, resume_file = COALESCE($6, resume_file),
           first_name = $7, last_name = $8, nickname = $9, year_level = $10, birth_date = $11, alt_email = $12, phone = $13, current_address = $14, parent_name = $15, parent_phone = $16,
           enrollment_year = $17
       WHERE student_id = $1 
       RETURNING *`,
      [studentId, studentCode, majorId, provinceId, cumulativeGpa, resumeFile, firstName, lastName, nickname, yearLevel, birthDate, altEmail, phone, currentAddress, parentName, parentPhone, enrollmentYear]
    );
    return res.rows[0] as Student;
  }

  /**
   * ตั้งรูปโปรไฟล์ · คืน path เดิมมาให้ผู้เรียกไปลบไฟล์ที่ไม่มีใครอ้างถึงแล้ว
   *
   * แยกจาก `updateStudent` โดยตั้งใจ — ตัวนั้นเขียนทับทุกคอลัมน์ที่รับเข้ามา
   * (ไม่มี COALESCE ยกเว้น `resume_file`) การยัดรูปเข้าไปด้วยแปลว่าการอัปโหลดรูป
   * ต้องส่งฟิลด์โปรไฟล์มาครบทั้งชุด ไม่งั้นข้อมูลที่ไม่ได้ส่งกลายเป็น NULL
   */
  static async updateProfileImage(
    studentId: number,
    imagePath: string
  ): Promise<{ previousPath: string | null } | null> {
    // อ่านของเดิมก่อนเขียนทับ · **ห้ามใช้ sub-SELECT ใน RETURNING เพื่อเอาค่าเก่า**
    // มันได้ค่าเก่าจริงเพราะกฎ snapshot ของ Postgres ซึ่งอ่านโค้ดแล้วไม่มีทางรู้
    // — สองคำสั่งตรงไปตรงมาอ่านง่ายกว่า และไฟล์ค้างบนดิสก์ไม่ใช่เรื่องคอขาดบาดตาย
    const current = await query('SELECT profile_image FROM students WHERE student_id = $1', [
      studentId,
    ]);
    if ((current.rowCount ?? 0) === 0) return null;

    await query('UPDATE students SET profile_image = $2 WHERE student_id = $1', [
      studentId,
      imagePath,
    ]);
    return { previousPath: (current.rows[0].profile_image as string) ?? null };
  }

  /**
   * Staff-only correction of registry-owned fields (SEC-05 counterpart).
   */
  static async updateRegistryFields(
    studentId: number,
    studentCode: string,
    majorId: number,
    cumulativeGpa: number | null,
    enrollmentYear: number | null
  ): Promise<Student | null> {
    const res = await query(
      `UPDATE students
       SET student_code = $2, major_id = $3, cumulative_gpa = $4, enrollment_year = $5
       WHERE student_id = $1
       RETURNING *`,
      [studentId, studentCode, majorId, cumulativeGpa, enrollmentYear]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Student;
  }

  static async updateEligibility(
    studentId: number,
    isEligible: boolean,
    isOrientationPassed: boolean
  ): Promise<Student | null> {
    const res = await query(
      `UPDATE students 
       SET is_eligible = $2, is_orientation_passed = $3
       WHERE student_id = $1 
       RETURNING *`,
      [studentId, isEligible, isOrientationPassed]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Student;
  }

  /**
   * Assign advisor and supervisor for a student.
   */
  static async assignAdvisorAndSupervisor(
    studentId: number,
    advisorId: number | null,
    supervisorId: number | null
  ): Promise<Student | null> {
    const res = await query(
      `UPDATE students 
       SET advisor_id = $2, supervisor_id = $3
       WHERE student_id = $1 
       RETURNING student_id, student_code, major_id, province_id, cumulative_gpa, resume_file, is_eligible, is_orientation_passed, advisor_id, supervisor_id`,
      [studentId, advisorId, supervisorId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Student;
  }

  /**
   * ⛔ language_proficiency กับ interested_job_types เป็นคอลัมน์ JSONB และค่าที่ส่งมาเป็น
   * "อาร์เรย์" — ต้อง JSON.stringify ก่อนเสมอ ห้ามส่งอาร์เรย์ดิบเข้าไป
   *
   * node-pg แปลงค่าพารามิเตอร์ตามชนิดของ JS ไม่ใช่ตามชนิดของคอลัมน์ปลายทาง:
   * object ธรรมดาถูก stringify ให้เอง แต่ **อาร์เรย์ถูกแปลงเป็น array literal ของ
   * Postgres** ซึ่งไม่ใช่ JSON ที่ถูกต้อง → pg คืน 22P02 → sendUnexpectedError แปลงเป็น
   * 400 "ข้อมูลที่กรอกยาวเกินกำหนดหรือมีรูปแบบไม่ถูกต้อง" ผู้ใช้จึงเห็นกรอบแดงที่ไม่ได้
   * บอกอะไรเลย ทั้งที่กรอกถูกต้องทุกช่อง
   *
   * อีก 3 คอลัมน์ JSONB ในระบบ (evidence_photos · scores_detail · audit_log.detail)
   * stringify ไว้แล้วทั้งหมด — จุดนี้เป็นจุดเดียวที่ตกหล่น
   */
  static async updateOptionalProfile(
    studentId: number,
    skillsAndActivities: string | null,
    languageProficiency: unknown,
    preferredWorkRegion: string | null,
    interestedJobTypes: unknown
  ): Promise<Student | null> {
    const res = await query(
      `UPDATE students 
       SET skills_and_activities = $2, language_proficiency = $3, preferred_work_region = $4, interested_job_types = $5
       WHERE student_id = $1 
       RETURNING *`,
      [
        studentId,
        skillsAndActivities,
        languageProficiency == null ? null : JSON.stringify(languageProficiency),
        preferredWorkRegion,
        interestedJobTypes == null ? null : JSON.stringify(interestedJobTypes),
      ]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Student;
  }
}
