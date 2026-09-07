import { query } from '../config/database';
import { Student } from '../types';

export class StudentModel {
  static async findByStudentId(studentId: number): Promise<Student | null> {
    const res = await query(
      `SELECT s.student_id, s.student_code, s.major_id, s.province_id, s.cumulative_gpa, s.claimed_gpa, s.section,
              s.resume_file, s.profile_image, s.is_eligible, s.is_orientation_passed, s.advisor_id, s.supervisor_id,
              s.first_name, s.last_name, s.nickname, s.year_level, s.birth_date, s.alt_email, s.phone,
              s.current_address, s.parent_name, s.parent_phone, s.enrollment_year,
              s.skills_and_activities, s.language_proficiency, s.preferred_work_region, s.interested_job_types,
              m.major_name_th, f.faculty_name_th,
              p_adv.first_name as advisor_first_name, p_adv.last_name as advisor_last_name
         FROM students s
         LEFT JOIN master_major m ON s.major_id = m.major_id
         LEFT JOIN master_faculty f ON m.faculty_id = f.faculty_id
         LEFT JOIN personnel p_adv ON s.advisor_id = p_adv.personnel_id
        WHERE s.student_id = $1`,
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
    isEligible: boolean = true,
    isOrientationPassed: boolean = true
  ): Promise<Student> {
    // ponytail: Enrolled co-op students are eligible by default
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
   * เกรดที่นักศึกษาแจ้งเอง
   *
   * ⛔ **เขียนได้เฉพาะ `claimed_gpa`** — เมธอดนี้จงใจไม่แตะ `cumulative_gpa` เลย
   * เลขทะเบียนถูกพิมพ์ลงหนังสือราชการที่คณบดีเซ็น (SEC-05) การคัดลอกจากค่าที่แจ้ง
   * เข้าทะเบียนต้องเป็นการกระทำของเจ้าหน้าที่ที่มี audit ไม่ใช่ผลข้างเคียงของการกรอกฟอร์ม
   */
  static async updateClaimedGpa(studentId: number, claimedGpa: number | null): Promise<void> {
    await query('UPDATE students SET claimed_gpa = $2 WHERE student_id = $1', [studentId, claimedGpa]);
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
    enrollmentYear: number | null,
    section: string | null = null
  ): Promise<Student> {
    const res = await query(
      `UPDATE students 
       SET student_code = $2, major_id = $3, province_id = $4, cumulative_gpa = $5, resume_file = COALESCE($6, resume_file),
           first_name = $7, last_name = $8, nickname = $9, year_level = $10, birth_date = $11, alt_email = $12, phone = $13, current_address = $14, parent_name = $15, parent_phone = $16,
           enrollment_year = $17,
           section = COALESCE($18, section)
       WHERE student_id = $1 
       RETURNING *`,
      [studentId, studentCode, majorId, provinceId, cumulativeGpa, resumeFile, firstName, lastName, nickname, yearLevel, birthDate, altEmail, phone, currentAddress, parentName, parentPhone, enrollmentYear, section]
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

  /**
   * สหกิจ 03 — ช่องตัวตน/ติดต่อ/ฉุกเฉิน + ข้อมูลอ่อนไหวที่เข้ารหัสแล้ว
   *
   * ⛔ **ช่องอ่อนไหวใช้ COALESCE ต่างจากช่องธรรมดา** — หน้าจอเห็นเลขบัตรเป็นมาสก์
   * (`x-xxxx-xxxxx-xx-3`) เสมอ ไม่เคยเห็นค่าจริง ถ้าส่งกลับมาแล้วเขียนทับตรงๆ
   * การกดบันทึกโดยไม่แตะช่องนั้นจะลบข้อมูลทิ้งเงียบๆ · ผู้เรียกส่ง `null` มาแปลว่า
   * "ไม่ได้แก้" ส่วนการล้างค่าจริงมีทางเดียวคือกลไกลบอัตโนมัติของ SEC-12
   *
   * `sensitiveConsentAt` ส่งมาเมื่อเพิ่งติ๊กยินยอมเท่านั้น (PDPA ม.26) — ยินยอมแล้ว
   * ไม่ต้องยินยอมซ้ำทุกครั้งที่บันทึก จึง COALESCE เหมือนกัน
   */
  static async updateCoopApplicationIdentity(
    studentId: number,
    fields: {
      firstNameEn: string | null;
      lastNameEn: string | null;
      gender: string | null;
      nationality: string | null;
      mobilePhone: string | null;
      fax: string | null;
      emergencyContactName: string | null;
      emergencyRelationship: string | null;
      emergencyAddress: string | null;
      emergencyPhone: string | null;
      nationalIdIssuedDistrict: string | null;
      nationalIdExpiryDate: string | null;
      careerObjective: string | null;
    },
    /**
     * ประวัติที่เป็นตาราง (JSONB) — `null` แปลว่า **ไม่ได้ส่งมา = ไม่ได้แก้**
     * ต่างจาก `[]` / `{}` ที่แปลว่า "ล้างทิ้ง" · จึงใช้ COALESCE เหมือนช่องอ่อนไหว
     * ⛔ ต้อง `JSON.stringify` ก่อนส่งให้ `pg` — คอลัมน์ JSONB อีก 3 ตัวในระบบทำแบบนี้
     *    ทั้งหมด และจุดที่เคยตกหล่นคือ `updateOptionalProfile` (ดูคอมเมนต์ที่นั่น)
     */
    history: {
      familyInfo: unknown;
      educationHistory: unknown;
      trainingHistory: unknown;
      activityHistory: unknown;
      /** ⛔ คอลัมน์เดียวกับที่หน้าโปรไฟล์แก้ — ดู `LANGUAGE_KEYS` ว่าทำไมจึงรับสองรูปแบบ */
      languageProficiency: unknown;
    },
    sensitive: {
      nationalId: { ciphertext: string; iv: string; authTag: string } | null;
      ethnicity: { ciphertext: string; iv: string; authTag: string } | null;
      religion: { ciphertext: string; iv: string; authTag: string } | null;
      consentAt: Date | null;
    }
  ): Promise<Student | null> {
    const res = await query(
      `UPDATE students
          SET first_name_en = $2, last_name_en = $3, gender = $4, nationality = $5,
              mobile_phone = $6, fax = $7,
              emergency_contact_name = $8, emergency_relationship = $9,
              emergency_address = $10, emergency_phone = $11,
              national_id_issued_district = $12, national_id_expiry_date = $13,
              career_objective = $24,
              family_info       = COALESCE($25::jsonb, family_info),
              education_history = COALESCE($26::jsonb, education_history),
              training_history  = COALESCE($27::jsonb, training_history),
              activity_history  = COALESCE($28::jsonb, activity_history),
              language_proficiency = COALESCE($29::jsonb, language_proficiency),
              national_id_ciphertext = COALESCE($14, national_id_ciphertext),
              national_id_iv         = COALESCE($15, national_id_iv),
              national_id_tag        = COALESCE($16, national_id_tag),
              ethnicity_ciphertext   = COALESCE($17, ethnicity_ciphertext),
              ethnicity_iv           = COALESCE($18, ethnicity_iv),
              ethnicity_tag          = COALESCE($19, ethnicity_tag),
              religion_ciphertext    = COALESCE($20, religion_ciphertext),
              religion_iv            = COALESCE($21, religion_iv),
              religion_tag           = COALESCE($22, religion_tag),
              sensitive_data_consented_at = COALESCE($23, sensitive_data_consented_at)
        WHERE student_id = $1
        RETURNING *`,
      [
        studentId,
        fields.firstNameEn,
        fields.lastNameEn,
        fields.gender,
        fields.nationality,
        fields.mobilePhone,
        fields.fax,
        fields.emergencyContactName,
        fields.emergencyRelationship,
        fields.emergencyAddress,
        fields.emergencyPhone,
        fields.nationalIdIssuedDistrict,
        fields.nationalIdExpiryDate,
        sensitive.nationalId?.ciphertext ?? null,
        sensitive.nationalId?.iv ?? null,
        sensitive.nationalId?.authTag ?? null,
        sensitive.ethnicity?.ciphertext ?? null,
        sensitive.ethnicity?.iv ?? null,
        sensitive.ethnicity?.authTag ?? null,
        sensitive.religion?.ciphertext ?? null,
        sensitive.religion?.iv ?? null,
        sensitive.religion?.authTag ?? null,
        sensitive.consentAt,
        fields.careerObjective,
        history.familyInfo == null ? null : JSON.stringify(history.familyInfo),
        history.educationHistory == null ? null : JSON.stringify(history.educationHistory),
        history.trainingHistory == null ? null : JSON.stringify(history.trainingHistory),
        history.activityHistory == null ? null : JSON.stringify(history.activityHistory),
        history.languageProficiency == null ? null : JSON.stringify(history.languageProficiency),
      ]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Student;
  }
}
