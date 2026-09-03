import { Request, Response } from 'express';
import { StudentModel } from '../models/student';
import { MasterModel } from '../models/master';
import { VerifyEligibilityBody } from '../types';
import pool, { query } from '../config/database';
import {
  assertCanAccessStudent,
  assertCanReviewStudentWork,
  resolveMajorScope,
  sendAccessError,
} from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendPersonnelAssignmentEmail } from '../utils/email';
import { sendUnexpectedError } from '../utils/httpError';
import { formatAccommodationAddress, isValidCoordinate } from '../utils/accommodationAddress';
import { decryptSensitive, encryptSensitive, maskNationalId } from '../utils/encryption';

export class StudentController {
  /**
   * Get Student Dashboard overview: profile, milestones, active intent, and official documents.
   * Route: GET /api/students/dashboard
   * Access: Student only
   */
  static async getStudentDashboard(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const userId = req.user.userId;

      // 1. Fetch student profile with major, faculty, province, advisor email, and supervisor email
      const studentQuery = await query(
        `SELECT s.student_id, s.student_code, s.cumulative_gpa, s.resume_file, s.profile_image, s.is_eligible, s.is_orientation_passed,
                s.major_id, m.major_name_th, m.major_code, f.faculty_name_th, s.province_id, p.province_name_th,
                s.first_name, s.last_name,
                s.advisor_id, u_adv.email as advisor_email, p_adv.first_name as advisor_first_name, p_adv.last_name as advisor_last_name,
                s.supervisor_id, u_sup.email as supervisor_email, p_sup.first_name as supervisor_first_name, p_sup.last_name as supervisor_last_name
         FROM students s
         JOIN master_major m ON s.major_id = m.major_id
         JOIN master_faculty f ON m.faculty_id = f.faculty_id
         LEFT JOIN master_province p ON s.province_id = p.province_id
         LEFT JOIN users u_adv ON s.advisor_id = u_adv.user_id
         LEFT JOIN personnel p_adv ON s.advisor_id = p_adv.personnel_id
         LEFT JOIN users u_sup ON s.supervisor_id = u_sup.user_id
         LEFT JOIN personnel p_sup ON s.supervisor_id = p_sup.personnel_id
         WHERE s.student_id = $1`,
        [userId]
      );

      if ((studentQuery.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Student profile not found. Please setup profile first.' });
        return;
      }

      const student = studentQuery.rows[0];

      // 2. Fetch current active semester (to filter active intent form)
      const semesterQuery = await query(
        `SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1`
      );
      
      let activeIntent = null;
      if ((semesterQuery.rowCount ?? 0) > 0) {
        const semesterId = semesterQuery.rows[0].semester_id;
        
        // Fetch student's intent form for this semester (not rejected/failed)
        const intentQuery = await query(
          `SELECT i.form_id, i.company_id, c.name_th as company_name_th, c.name_en as company_name_en,
                  i.job_id, j.title as job_title, i.status, i.start_date, i.acceptance_evidence_path,
                  i.request_form_path, i.reject_reason, i.officer_document_no,
                  i.submitted_late, i.acceptance_due_date, i.acceptance_submitted_late,
                  i.mentor_id, m.name as mentor_name, u_men.email as mentor_email, m.phone as mentor_phone,
                  m.position as mentor_position, m.department as mentor_department
           FROM intent_forms i
           JOIN companies c ON i.company_id = c.company_id
           LEFT JOIN job_posts j ON i.job_id = j.job_id
           LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
           LEFT JOIN users u_men ON i.mentor_id = u_men.user_id
           WHERE i.student_id = $1 AND i.semester_id = $2
             AND i.status NOT IN ('rejected', 'company_rejected')
           ORDER BY i.form_id DESC
           LIMIT 1`,
          [userId, semesterId]
        );

        if ((intentQuery.rowCount ?? 0) > 0) {
          const row = intentQuery.rows[0];
          activeIntent = {
            form_id: row.form_id,
            company_id: row.company_id,
            company_name_th: row.company_name_th,
            company_name_en: row.company_name_en,
            job_id: row.job_id,
            job_title: row.job_title,
            status: row.status,
            start_date: row.start_date,
            acceptance_evidence_path: row.acceptance_evidence_path,
            request_form_path: row.request_form_path,
            reject_reason: row.reject_reason,
            officer_document_no: row.officer_document_no,
            // ยื่นล่าช้า + กำหนดตอบกลับ ๑๕ วันทำการ — หน้าแรกของนักศึกษาอ่านจากตรงนี้
            // ไม่ใช่จาก `documents` ซึ่งจะกลายเป็นแหล่งความจริงที่สอง
            submitted_late: row.submitted_late,
            acceptance_due_date: row.acceptance_due_date,
            acceptance_submitted_late: row.acceptance_submitted_late,
            mentor: row.mentor_id ? {
              mentor_id: row.mentor_id,
              name: row.mentor_name,
              email: row.mentor_email,
              phone: row.mentor_phone,
              position: row.mentor_position,
              department: row.mentor_department
            } : null
          };
        }
      }

      // 3. Fetch generated official documents for this student
      const docQuery = await query(
        `SELECT d.doc_id, d.type, d.status, d.generated_file_path, d.dean_signature_date, d.docusign_envelope_id,
                c.name_th as company_name_th
         FROM official_documents d
         JOIN companies c ON d.company_id = c.company_id
         WHERE d.student_id = $1
         ORDER BY d.doc_id DESC`,
        [userId]
      );

      res.status(200).json({
        student: {
          student_id: student.student_id,
          student_code: student.student_code,
          first_name: student.first_name,
          last_name: student.last_name,
          cumulative_gpa: parseFloat(student.cumulative_gpa),
          resume_file: student.resume_file,
          // รูปโปรไฟล์ — หน้าแรกแสดงแทนตัวอักษรแรกของชื่อเมื่อมีค่า
          profile_image: student.profile_image,
          is_eligible: student.is_eligible,
          is_orientation_passed: student.is_orientation_passed,
          major_id: student.major_id,
          major_name_th: student.major_name_th,
          major_code: student.major_code,
          faculty_name_th: student.faculty_name_th,
          province_id: student.province_id,
          province_name_th: student.province_name_th,
          advisor: student.advisor_id ? {
            personnel_id: student.advisor_id,
            email: student.advisor_email,
            name: `${student.advisor_first_name || ''} ${student.advisor_last_name || ''}`.trim()
          } : null,
          supervisor: student.supervisor_id ? {
            personnel_id: student.supervisor_id,
            email: student.supervisor_email,
            name: `${student.supervisor_first_name || ''} ${student.supervisor_last_name || ''}`.trim()
          } : null
        },
        activeIntent,
        documents: docQuery.rows
      });

    } catch (error) {
      sendUnexpectedError(res, error, 'Get Student Dashboard Error', 'An internal server error occurred while retrieving student dashboard.');
    }
  }

  /**
   * Update optional student profile information (skills, language, region, job types).
   * Route: PUT /api/profile/student/optional
   * Access: Student only
   */
  static async updateOptionalProfile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.user.roles.includes('student')) {
        res.status(401).json({ message: 'Unauthorized. Only students can update this profile.' });
        return;
      }

      const studentId = req.user.userId;
      const { skills_and_activities, language_proficiency, preferred_work_region, interested_job_types } = req.body;

      const updatedStudent = await StudentModel.updateOptionalProfile(
        studentId,
        skills_and_activities || null,
        language_proficiency || null,
        preferred_work_region || null,
        interested_job_types || null
      );

      if (!updatedStudent) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Optional profile updated successfully.',
        student: updatedStudent,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Update Optional Profile Error', 'An internal server error occurred while updating optional profile.');
    }
  }

  /**
   * สหกิจ 03 — อ่านข้อมูลใบสมัครงานของตัวเอง
   * Route: GET /api/students/coop-application
   * Access: student (ของตัวเองเสมอ — ใช้ userId จาก token ไม่รับ id จากผู้เรียก)
   *
   * ⛔ **เลขบัตร/เชื้อชาติ/ศาสนาไม่เคยถูกส่งกลับเป็นค่าจริง** (SEC-12 ข้อ 2)
   * เลขบัตรส่งเป็นมาสก์ `x-xxxx-xxxxx-xx-3` ส่วนเชื้อชาติ/ศาสนาส่งแค่ธงว่า "กรอกแล้ว"
   * — การถอดรหัสมีที่เดียวคือตอนวาดเอกสารจริง ไม่ใช่ตอนเปิดหน้าจอ
   */
  static async getCoopApplication(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      // ⛔ **ไม่ใช้ `StudentModel.findByStudentId`** — เมธอดนั้นมีรายชื่อคอลัมน์ตายตัว
      //    และถูกใช้โดย `/profile/me` ด้วย · การไปเติมคอลัมน์ ciphertext เข้าไปที่นั่น
      //    เท่ากับส่งข้อมูลเข้ารหัสไปโผล่ใน endpoint ที่ไม่ได้ต้องการมันเลย
      const result = await query(
        `SELECT first_name, last_name, student_code, phone, alt_email,
                first_name_en, last_name_en, gender, nationality, mobile_phone, fax,
                emergency_contact_name, emergency_relationship, emergency_address,
                emergency_phone, national_id_issued_district,
                national_id_expiry_date::text AS national_id_expiry_date,
                national_id_ciphertext, national_id_iv, national_id_tag,
                ethnicity_ciphertext, religion_ciphertext, sensitive_data_consented_at
           FROM students WHERE student_id = $1`,
        [req.user.userId]
      );
      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบประวัตินักศึกษา กรุณาตั้งค่าโปรไฟล์ก่อน' });
        return;
      }

      const row = result.rows[0] as Record<string, unknown>;
      const hasCipher = (prefix: string) => Boolean(row[`${prefix}_ciphertext`]);

      // มาสก์ต้องถอดรหัสก่อนจึงจะรู้หลักสุดท้าย — ล้มเหลว (กุญแจเปลี่ยน/ข้อมูลเสีย)
      // ต้องไม่ทำให้ทั้งหน้าจอเปิดไม่ได้ ตกไปเป็นมาสก์กลางๆ แทน
      let nationalIdMasked: string | null = null;
      if (hasCipher('national_id')) {
        try {
          nationalIdMasked = maskNationalId(
            decryptSensitive({
              ciphertext: row.national_id_ciphertext as string,
              iv: row.national_id_iv as string,
              authTag: row.national_id_tag as string,
            })
          );
        } catch {
          nationalIdMasked = 'x-xxxx-xxxxx-xx-x';
        }
      }

      res.status(200).json({
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        student_code: row.student_code ?? null,
        first_name_en: row.first_name_en ?? null,
        last_name_en: row.last_name_en ?? null,
        gender: row.gender ?? null,
        nationality: row.nationality ?? null,
        phone: row.phone ?? null,
        mobile_phone: row.mobile_phone ?? null,
        fax: row.fax ?? null,
        alt_email: row.alt_email ?? null,
        emergency_contact_name: row.emergency_contact_name ?? null,
        emergency_relationship: row.emergency_relationship ?? null,
        emergency_address: row.emergency_address ?? null,
        emergency_phone: row.emergency_phone ?? null,
        national_id_issued_district: row.national_id_issued_district ?? null,
        national_id_expiry_date: row.national_id_expiry_date ?? null,
        // ⛔ มาสก์และธงเท่านั้น — ห้ามส่งค่าจริงออกจาก endpoint นี้ไม่ว่ากรณีใด
        national_id_masked: nationalIdMasked,
        has_ethnicity: hasCipher('ethnicity'),
        has_religion: hasCipher('religion'),
        sensitive_data_consented_at: row.sensitive_data_consented_at ?? null,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Get Coop Application Error',
        'เกิดข้อผิดพลาดขณะดึงข้อมูลใบสมัครงานสหกิจศึกษา'
      );
    }
  }

  /**
   * สหกิจ 03 — บันทึกข้อมูลใบสมัครงานของตัวเอง (ส่วนตัวตน/ติดต่อ/ฉุกเฉิน)
   * Route: PUT /api/students/coop-application
   * Access: student
   *
   * ⛔ **เชื้อชาติ/ศาสนาเขียนได้ต่อเมื่อยินยอมโดยชัดแจ้งแล้วเท่านั้น** (PDPA ม.26)
   * ไม่ใช่ยินยอมรวมอยู่ในเงื่อนไขการใช้งานทั่วไป — ต้องติ๊กแยกและระบบบันทึกเวลาที่ติ๊ก
   * ลง `audit_log` · ส่งสองช่องนี้มาโดยยังไม่เคยยินยอม = ปฏิเสธทั้งคำขอ ไม่ใช่เขียนเงียบๆ
   */
  static async updateCoopApplication(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = req.user.userId;
      const existingRes = await query(
        'SELECT sensitive_data_consented_at FROM students WHERE student_id = $1',
        [studentId]
      );
      if ((existingRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบประวัตินักศึกษา กรุณาตั้งค่าโปรไฟล์ก่อน' });
        return;
      }

      const body = req.body ?? {};
      const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
      const optional = (v: unknown): string | null => text(v) || null;

      // เลขบัตรประชาชนไทยมี 13 หลัก — ยอมให้พิมพ์ขีดคั่นได้ แล้วเก็บเฉพาะตัวเลข
      const nationalIdDigits = text(body.national_id).replace(/\D/g, '');
      if (text(body.national_id) && nationalIdDigits.length !== 13) {
        res.status(400).json({ message: 'เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก' });
        return;
      }

      const expiry = text(body.national_id_expiry_date);
      if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        res.status(400).json({ message: 'รูปแบบวันหมดอายุบัตรต้องเป็น ปี-เดือน-วัน (YYYY-MM-DD)' });
        return;
      }

      const ethnicity = text(body.ethnicity);
      const religion = text(body.religion);
      const alreadyConsented = Boolean(existingRes.rows[0].sensitive_data_consented_at);
      const consentingNow = body.sensitive_data_consent === true;

      if ((ethnicity || religion) && !alreadyConsented && !consentingNow) {
        res.status(400).json({
          message:
            'เชื้อชาติและศาสนาเป็นข้อมูลอ่อนไหวตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล มาตรา 26 — ต้องให้ความยินยอมก่อนจึงจะบันทึกได้',
        });
        return;
      }

      const updated = await StudentModel.updateCoopApplicationIdentity(
        studentId,
        {
          firstNameEn: optional(body.first_name_en),
          lastNameEn: optional(body.last_name_en),
          gender: optional(body.gender),
          nationality: optional(body.nationality),
          mobilePhone: optional(body.mobile_phone),
          fax: optional(body.fax),
          emergencyContactName: optional(body.emergency_contact_name),
          emergencyRelationship: optional(body.emergency_relationship),
          emergencyAddress: optional(body.emergency_address),
          emergencyPhone: optional(body.emergency_phone),
          nationalIdIssuedDistrict: optional(body.national_id_issued_district),
          nationalIdExpiryDate: expiry || null,
        },
        {
          // ไม่ได้ส่งมา = ไม่ได้แก้ (หน้าจอเห็นแต่มาสก์) — โมเดลใช้ COALESCE รับไม้ต่อ
          nationalId: nationalIdDigits ? encryptSensitive(nationalIdDigits) : null,
          ethnicity: ethnicity ? encryptSensitive(ethnicity) : null,
          religion: religion ? encryptSensitive(religion) : null,
          consentAt: !alreadyConsented && consentingNow ? new Date() : null,
        }
      );

      // เวลาที่ให้ความยินยอมต้องตามย้อนได้ว่าเกิดขึ้นจริงเมื่อไหร่ ไม่ใช่มีแต่คอลัมน์
      // ที่แก้ทับได้ — `audit_log` เขียนอย่างเดียว (SEC-07)
      if (!alreadyConsented && consentingNow) {
        writeAudit(
          {
            action: AuditAction.SENSITIVE_DATA_CONSENT_GIVEN,
            entityType: 'student',
            entityId: studentId,
            subjectId: studentId,
            detail: { basis: 'PDPA_s26', fields: ['ethnicity', 'religion'] },
          },
          req
        ).catch(() => undefined);
      }

      res.status(200).json({
        message: 'บันทึกข้อมูลใบสมัครงานสหกิจศึกษาเรียบร้อยแล้ว',
        sensitive_data_consented_at:
          (updated as unknown as Record<string, unknown>)?.sensitive_data_consented_at ?? null,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Update Coop Application Error',
        'เกิดข้อผิดพลาดขณะบันทึกข้อมูลใบสมัครงานสหกิจศึกษา'
      );
    }
  }

  /**
   * Manually verify student eligibility and orientation status.
   * Route: PUT /api/students/:id/verify-eligibility
   * Access: staff, dept_head
   */
  static async verifyEligibility(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      const { is_eligible, is_orientation_passed } = req.body as VerifyEligibilityBody;

      // Validate fields are provided and are booleans
      if (is_eligible === undefined || is_orientation_passed === undefined) {
        res.status(400).json({ message: 'Required fields: is_eligible, is_orientation_passed.' });
        return;
      }

      if (typeof is_eligible !== 'boolean' || typeof is_orientation_passed !== 'boolean') {
        res.status(400).json({ message: 'is_eligible and is_orientation_passed must be boolean values.' });
        return;
      }

      // SEC-06: this endpoint had no scope check at all, so any department head
      // could grant co-op eligibility to a student in another department.
      await assertCanAccessStudent(req.user.userId, req.user.roles, studentId);

      const updatedStudent = await StudentModel.updateEligibility(studentId, is_eligible, is_orientation_passed);

      if (!updatedStudent) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }

      writeAudit({
        action: AuditAction.ELIGIBILITY_CHANGED,
        entityType: 'student',
        entityId: studentId,
        subjectId: studentId,
        detail: { is_eligible, is_orientation_passed },
      }, req).catch(() => undefined);

      res.status(200).json({
        message: 'Student eligibility and orientation status updated successfully.',
        student: updatedStudent,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Verify Student Eligibility Error', 'An internal server error occurred while verifying student eligibility.');
    }
  }

  /**
   * Correct registry-owned student fields.
   * Route: PUT /api/students/:id/registry
   * Access: staff, dept_head (within their own major)
   *
   * Counterpart to SEC-05: students can no longer edit student_code, major_id,
   * enrollment_year or cumulative_gpa themselves, so the co-op office needs a
   * supported way to fix mistakes made at onboarding.
   */
  static async updateRegistryFields(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      await assertCanAccessStudent(req.user.userId, req.user.roles, studentId);

      const existing = await StudentModel.findByStudentId(studentId);
      if (!existing) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }

      const { student_code, major_id, enrollment_year, cumulative_gpa } = req.body;

      let nextStudentCode = existing.student_code;
      if (student_code !== undefined && student_code !== null && student_code !== '') {
        if (typeof student_code !== 'string' || !/^\d{12}-\d$/.test(student_code.trim())) {
          res.status(400).json({ message: 'รูปแบบรหัสนักศึกษาไม่ถูกต้อง (เช่น 123456789012-3)' });
          return;
        }
        nextStudentCode = student_code.trim();
        if (await StudentModel.existsByStudentCodeExcludeUser(nextStudentCode, studentId)) {
          res.status(400).json({ message: 'รหัสนักศึกษานี้ถูกใช้งานโดยบัญชีอื่นแล้ว' });
          return;
        }
      }

      let nextMajorId = existing.major_id;
      if (major_id !== undefined && major_id !== null && major_id !== '') {
        const parsed = parseInt(major_id, 10);
        if (isNaN(parsed) || !(await MasterModel.verifyMajorExists(parsed))) {
          res.status(400).json({ message: 'Invalid major_id. Referenced major does not exist.' });
          return;
        }
        // A dept_head may not move a student out of (or into) their own major.
        if (req.user.roles.includes('dept_head') && !req.user.roles.some((r) => ['staff', 'dean'].includes(r))) {
          const scope = await resolveMajorScope(req.user.userId, req.user.roles);
          if (scope.isScoped && parsed !== scope.majorId) {
            res.status(403).json({ message: 'Forbidden. You cannot move a student into another major.' });
            return;
          }
        }
        nextMajorId = parsed;
      }

      let nextEnrollmentYear = existing.enrollment_year ?? null;
      if (enrollment_year !== undefined && enrollment_year !== null && enrollment_year !== '') {
        const parsed = parseInt(enrollment_year, 10);
        if (isNaN(parsed) || parsed < 2500 || parsed > 2700) {
          res.status(400).json({ message: 'ปีการศึกษาที่เข้าศึกษาต้องเป็นปี พ.ศ. (เช่น 2568)' });
          return;
        }
        nextEnrollmentYear = parsed;
      }

      let nextGpa = existing.cumulative_gpa !== null && existing.cumulative_gpa !== undefined
        ? Number(existing.cumulative_gpa)
        : null;
      if (cumulative_gpa !== undefined && cumulative_gpa !== null && cumulative_gpa !== '') {
        const parsed = parseFloat(cumulative_gpa);
        if (isNaN(parsed) || parsed < 0 || parsed > 4.0) {
          res.status(400).json({ message: 'เกรดเฉลี่ยต้องอยู่ระหว่าง 0.00 ถึง 4.00' });
          return;
        }
        nextGpa = parsed;
      }

      const updated = await StudentModel.updateRegistryFields(
        studentId,
        nextStudentCode,
        nextMajorId,
        nextGpa,
        nextEnrollmentYear
      );

      writeAudit({
        action: AuditAction.REGISTRY_CHANGED,
        entityType: 'student',
        entityId: studentId,
        subjectId: studentId,
        detail: {
          student_code_before: existing.student_code,
          student_code_after: nextStudentCode,
          major_id_before: existing.major_id,
          major_id_after: nextMajorId,
          gpa_before: existing.cumulative_gpa ?? null,
          gpa_after: nextGpa,
          enrollment_year_before: existing.enrollment_year ?? null,
          enrollment_year_after: nextEnrollmentYear,
        },
      }, req).catch(() => undefined);

      res.status(200).json({
        message: 'อัปเดตข้อมูลทะเบียนนักศึกษาเรียบร้อยแล้ว',
        student: updated,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Update Registry Fields Error', 'An internal server error occurred while updating registry fields.');
    }
  }

  /**
   * Get list of all students with filtering.
   * Route: GET /api/students
   * Access: staff, dept_head, advisor
   */
  static async getStudents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const majorIdParam = req.query.major_id;
      const isEligibleParam = req.query.is_eligible;

      const { roles, userId } = req.user;
      // SEC-06: resolveMajorScope throws instead of silently returning an
      // unfiltered institution-wide list when the personnel profile is missing.
      const userMajorId = (await resolveMajorScope(userId, roles)).majorId;

      let queryStr = `
        SELECT s.student_id, s.student_code, s.cumulative_gpa, s.resume_file, s.is_eligible, s.is_orientation_passed,
               s.major_id, m.major_name_th, m.major_code, f.faculty_name_th, s.province_id, p.province_name_th,
               s.advisor_id, u_adv.email as advisor_email,
               s.supervisor_id, u_sup.email as supervisor_email,
               s.first_name, s.last_name, s.phone,
               c.name_th as company_name, c.province as company_province
        FROM students s
        JOIN master_major m ON s.major_id = m.major_id
        JOIN master_faculty f ON m.faculty_id = f.faculty_id
        LEFT JOIN master_province p ON s.province_id = p.province_id
        LEFT JOIN users u_adv ON s.advisor_id = u_adv.user_id
        LEFT JOIN users u_sup ON s.supervisor_id = u_sup.user_id
        LEFT JOIN intent_forms i ON s.student_id = i.student_id AND i.status NOT IN ('rejected', 'company_rejected')
        LEFT JOIN companies c ON i.company_id = c.company_id
        WHERE 1=1
      `;
      const queryParams: unknown[] = [];

      if (userMajorId !== null) {
        queryParams.push(userMajorId);
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      } else if (majorIdParam) {
        queryParams.push(parseInt(majorIdParam as string, 10));
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      }

      if (isEligibleParam !== undefined) {
        queryParams.push(isEligibleParam === 'true');
        queryStr += ` AND s.is_eligible = $${queryParams.length}`;
      }

      queryStr += ` ORDER BY s.student_code ASC`;

      const result = await query(queryStr, queryParams);
      res.status(200).json(result.rows);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Students List Error', 'An internal server error occurred while retrieving student list.');
    }
  }

  /**
   * Assign advisor and/or supervisor to a student.
   * Route: PUT /api/students/:id/assign-advisor
   * Access: dept_head, staff
   */
  static async assignAdvisor(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      const { advisor_id, supervisor_id } = req.body;
      const { roles, userId } = req.user;

      // 1. Fetch student's major_id
      const studentMajorRes = await query('SELECT major_id FROM students WHERE student_id = $1', [studentId]);
      if ((studentMajorRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }
      const studentMajorId = studentMajorRes.rows[0].major_id;

      // 2. Scope check — SEC-06: a dept_head with no personnel row used to skip
      // this guard entirely and could assign advisors across any major.
      await assertCanAccessStudent(userId, roles, studentId);

      // 3. Validate advisor exists, has advisor role, and matches student's major
      if (advisor_id !== undefined && advisor_id !== null) {
        const advCheck = await query(
          `SELECT 1 FROM personnel p 
           JOIN user_roles r ON p.personnel_id = r.user_id 
           WHERE p.personnel_id = $1 AND r.role_name = 'advisor' AND p.major_id = $2`,
          [advisor_id, studentMajorId]
        );
        if ((advCheck.rowCount ?? 0) === 0) {
          res.status(400).json({ message: 'Invalid advisor_id. Advisor must be in the same major as the student.' });
          return;
        }
      }

      // 4. Validate supervisor exists, has valid role, and matches student's major
      if (supervisor_id !== undefined && supervisor_id !== null) {
        const supCheck = await query(
          `SELECT 1 FROM personnel p 
           JOIN user_roles r ON p.personnel_id = r.user_id 
           WHERE p.personnel_id = $1 AND r.role_name IN ('advisor', 'staff', 'dept_head') AND p.major_id = $2`,
          [supervisor_id, studentMajorId]
        );
        if ((supCheck.rowCount ?? 0) === 0) {
          res.status(400).json({ message: 'Invalid supervisor_id. Supervisor must be in the same major as the student.' });
          return;
        }
      }

      const updated = await StudentModel.assignAdvisorAndSupervisor(
        studentId,
        advisor_id !== undefined ? advisor_id : null,
        supervisor_id !== undefined ? supervisor_id : null
      );

      if (!updated) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }

      res.status(200).json({
        message: 'Advisor/Supervisor assigned successfully.',
        student: updated
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Assign Advisor Error', 'An internal server error occurred while assigning advisor.');
    }
  }

  /**
   * Batch assign advisor and supervisor to multiple students
   * Route: PUT /api/students/batch-assign-personnel
   * Allowed Roles: Dept Head, Staff
   */
  static async batchAssignPersonnel(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { studentIds, advisor_id, supervisor_id } = req.body;
      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        res.status(400).json({ message: 'Required field: studentIds array' });
        return;
      }
      
      // According to System 2 rules, both advisor and supervisor MUST be selected
      if (!advisor_id || !supervisor_id) {
        res.status(400).json({ message: 'กรุณามอบหมายอาจารย์ให้ครบทั้ง 2 ตำแหน่ง' });
        return;
      }

      const { roles, userId } = req.user;
      // SEC-06: fails closed when the dept_head has no personnel profile.
      const deptHeadMajorId = (await resolveMajorScope(userId, roles)).majorId;

      // Fetch advisor major
      const advCheck = await query(
        `SELECT major_id FROM personnel p JOIN user_roles r ON p.personnel_id = r.user_id WHERE p.personnel_id = $1 AND r.role_name = 'advisor'`,
        [advisor_id]
      );
      if ((advCheck.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'ไม่พบข้อมูลอาจารย์ที่ปรึกษาที่เลือก หรือตำแหน่งไม่ถูกต้อง' });
        return;
      }
      const advisorMajorId = advCheck.rows[0].major_id;

      // Fetch supervisor major
      const supCheck = await query(
        `SELECT major_id FROM personnel p JOIN user_roles r ON p.personnel_id = r.user_id WHERE p.personnel_id = $1 AND r.role_name IN ('advisor', 'staff', 'dept_head')`,
        [supervisor_id]
      );
      if ((supCheck.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'ไม่พบข้อมูลอาจารย์นิเทศที่เลือก หรือตำแหน่งไม่ถูกต้อง' });
        return;
      }
      const supervisorMajorId = supCheck.rows[0].major_id;

      // Validate the whole batch BEFORE writing anything. The previous version
      // returned 403/400 from inside the write loop, so a rejected batch could
      // still leave the first N students reassigned.
      const targetIds: number[] = [];
      for (const id of studentIds) {
        const studentId = parseInt(String(id), 10);
        if (isNaN(studentId)) continue;

        const studentRes = await query('SELECT major_id FROM students WHERE student_id = $1', [studentId]);
        if ((studentRes.rowCount ?? 0) === 0) continue;
        const studentMajorId = studentRes.rows[0].major_id;

        // Dept Head Major Check
        if (deptHeadMajorId !== null && studentMajorId !== deptHeadMajorId) {
          res.status(403).json({ message: 'Forbidden. You can only assign personnel to students in your own major.' });
          return;
        }

        // Verify advisor and supervisor belong to student's major
        if (advisorMajorId !== studentMajorId || supervisorMajorId !== studentMajorId) {
          res.status(400).json({ message: 'อาจารย์ที่ปรึกษาและอาจารย์นิเทศต้องอยู่ในสาขาวิชาเดียวกันกับนักศึกษา' });
          return;
        }

        targetIds.push(studentId);
      }

      if (targetIds.length === 0) {
        res.status(400).json({ message: 'ไม่พบนักศึกษาที่สามารถมอบหมายได้' });
        return;
      }

      // Apply the whole batch atomically.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const studentId of targetIds) {
          await client.query(
            'UPDATE students SET advisor_id = $2, supervisor_id = $3 WHERE student_id = $1',
            [studentId, advisor_id, supervisor_id]
          );
        }
        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }

      // Notify only after the transaction is durable.
      for (const studentId of targetIds) {
        sendPersonnelAssignmentEmail(studentId, advisor_id, supervisor_id).catch(console.error);
      }

      res.status(200).json({
        message: `มอบหมายอาจารย์ที่ปรึกษาและอาจารย์นิเทศสำเร็จจำนวน ${targetIds.length} คน`,
        successCount: targetIds.length
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Batch Assign Personnel Error', 'An internal server error occurred while assigning personnel.');
    }
  }

  /**
   * System 3: Get existing Accommodation & Work Plan for student
   * Route: GET /api/students/:id/accommodation-plan
   */
  static async getAccommodationAndPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      // IDOR guard: students can only view their own data.
      // SEC-06: personnel are additionally scoped — this record holds the
      // student's residential address and emergency contacts, so "any advisor in
      // the university" was far too wide.
      const isPersonnel = req.user.roles.some((r: string) => ['staff', 'dean', 'advisor', 'dept_head'].includes(r));
      if (isPersonnel) {
        await assertCanReviewStudentWork(req.user.userId, req.user.roles, studentId);
      } else if (req.user.userId !== studentId) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }

      const accRes = await query('SELECT * FROM accommodations WHERE student_id = $1', [studentId]);
      const plansRes = await query('SELECT * FROM weekly_work_plans WHERE student_id = $1 ORDER BY week_number ASC', [studentId]);
      // ⛔ ผู้ติดต่อฉุกเฉินอยู่บนโปรไฟล์นักศึกษาแล้ว ไม่ใช่บนแถวที่พัก (migration 013)
      //    — มันเป็นคุณสมบัติของคน และทั้ง สหกิจ 03 กับ 06 ถามช่องเดียวกัน
      const emgRes = await query(
        `SELECT emergency_contact_name, emergency_relationship, emergency_phone
           FROM students WHERE student_id = $1`,
        [studentId]
      );
      const emg = emgRes.rows[0] ?? {};

      const accRow = accRes.rowCount && accRes.rowCount > 0 ? accRes.rows[0] : null;

      res.status(200).json({
        // `formatted_address` ประกอบจากช่องย่อยที่เซิร์ฟเวอร์ ไม่ให้ React ต่อสตริงเอง
        // — ไม่งั้นรูปแบบที่อยู่จะมีสองแหล่งความจริงทันที (ดู utils/accommodationAddress.ts)
        accommodation: accRow
          ? {
              ...accRow,
              formatted_address: formatAccommodationAddress(accRow),
              // ประกอบกลับให้หน้าจอเดิมใช้ชื่อคีย์เท่าเดิม — แหล่งความจริงคือโปรไฟล์
              emergency_contact: emg.emergency_contact_name ?? null,
              emergency_relationship: emg.emergency_relationship ?? null,
              emergency_phone: emg.emergency_phone ?? null,
            }
          : null,
        weekly_plans: plansRes.rows || []
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'getAccommodationAndPlan Error', 'Failed to retrieve accommodation and work plan');
    }
  }

  /**
   * System 3: Submit Accommodation & Work Plan
   * Route: POST /api/students/:id/accommodation-plan
   */
  static async submitAccommodationAndPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      // IDOR Guard: students can only submit their own accommodation & plan
      if (req.user.roles.includes('student') && req.user.userId !== studentId) {
        res.status(403).json({ message: 'Forbidden. You can only submit accommodation and plans for yourself.' });
        return;
      }
      const { accommodation, weekly_plans } = req.body;

      if (!accommodation || typeof accommodation !== 'object') {
        res.status(400).json({ message: 'กรุณากรอกข้อมูลที่พักระหว่างปฏิบัติงานให้ครบถ้วน' });
        return;
      }

      // ⛔ ตั้งแต่ 2026-09-03 ที่อยู่เป็น **ช่องย่อยตามฟอร์ม สหกิจ 06** ไม่ใช่ก้อนเดียว
      //    ห้าม fallback ไปรับ `address` ก้อนเดิม — ถ้ารับ ที่อยู่ครึ่งระบบจะกลับไป
      //    เป็นข้อความอิสระที่พิมพ์ลงแบบฟอร์มไม่ได้ และไม่มีใครสังเกตจนกว่าจะพิมพ์จริง
      const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
      const missing = [
        ['บ้านเลขที่', text(accommodation.house_no)],
        ['ตำบล/แขวง', text(accommodation.subdistrict)],
        ['อำเภอ/เขต', text(accommodation.district)],
        ['จังหวัด', text(accommodation.province)],
        ['รหัสไปรษณีย์', text(accommodation.postal_code)],
      ]
        .filter(([, value]) => !value)
        .map(([label]) => label);

      if (missing.length > 0) {
        res.status(400).json({ message: `กรุณากรอกข้อมูลที่พักให้ครบ: ${missing.join(' · ')}` });
        return;
      }

      if (!/^\d{5}$/.test(text(accommodation.postal_code))) {
        res.status(400).json({ message: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' });
        return;
      }

      // พิกัดเป็นของไม่บังคับ (หน้าจอโหลดแผนที่ไม่ได้ก็ยังต้องส่งฟอร์มได้) แต่ถ้าส่งมา
      // ต้องเป็นพิกัดจริง — ค่าขยะที่หลุดเข้าฐานจะพาอาจารย์นิเทศไปผิดที่
      const hasCoords =
        accommodation.latitude !== undefined &&
        accommodation.latitude !== null &&
        accommodation.latitude !== '' &&
        accommodation.longitude !== undefined &&
        accommodation.longitude !== null &&
        accommodation.longitude !== '';
      if (hasCoords && !isValidCoordinate(accommodation.latitude, accommodation.longitude)) {
        res.status(400).json({ message: 'พิกัดที่พักไม่ถูกต้อง กรุณาปักหมุดใหม่บนแผนที่' });
        return;
      }

      // Validation: Must have at least 16 weeks of plans
      if (!weekly_plans || !Array.isArray(weekly_plans) || weekly_plans.length < 16) {
        res.status(400).json({ message: 'กรุณากรอกแผนปฏิบัติงานให้ครบอย่างน้อย 16 สัปดาห์ตามเกณฑ์ของมหาวิทยาลัย' });
        return;
      }

      // Check if student has an active intent and check the start date to enforce the "first week" rule
      //
      // ⚠️ นี่คือด่านที่ *สอง* ไม่ใช่ด่านซ้ำ — อย่าลบทิ้งเพราะคิดว่าปฏิทินทำแทนแล้ว
      //   ด่านแรก  = `requireCalendarWindow('accommodation_plan')` ที่ routes/student.ts
      //              ช่วงกลางที่เจ้าหน้าที่ตั้ง เท่ากันทั้งรุ่น
      //   ด่านนี้   = 7 วันนับจาก `intent_forms.start_date` ของนักศึกษา *แต่ละคน*
      //              ซึ่งไม่เท่ากันเลยสักคน ปฏิทินกลางจึงแทนไม่ได้
      const intentRes = await query(`
        SELECT start_date FROM intent_forms 
        WHERE student_id = $1 AND status = 'accepted'
        ORDER BY form_id DESC LIMIT 1
      `, [studentId]);
      
      if (intentRes.rowCount && intentRes.rowCount > 0) {
        const startDate = new Date(intentRes.rows[0].start_date);
        const today = new Date();
        const diffTime = Math.abs(today.getTime() - startDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        
        // Block if it's more than 7 days past the start date
        // Note: For testing purposes, we'll allow this if start date is in the future.
        if (today > startDate && diffDays > 7) {
          res.status(403).json({ message: 'ไม่อนุญาตให้ส่งข้อมูลเกินกำหนด 1 สัปดาห์หลังจากเริ่มปฏิบัติงานจริง' });
          return;
        }
      } else {
        res.status(400).json({ message: 'ไม่พบข้อมูลใบตอบรับจากบริษัท' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Upsert accommodation
        // ⛔ `address_legacy` ไม่อยู่ในรายการนี้โดยตั้งใจ — เป็นค่าเก่าอ่านอย่างเดียว
        //    กรอกใหม่แล้วช่องย่อยคือความจริง ของเก่าคงไว้เป็นหลักฐานว่าเคยกรอกอะไร
        const accQuery = `
          INSERT INTO accommodations (
            student_id, house_no, building, room_no, soi, road,
            subdistrict, district, province, postal_code,
            phone, mobile_phone, fax, email, latitude, longitude
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (student_id) DO UPDATE SET
            house_no = EXCLUDED.house_no,
            building = EXCLUDED.building,
            room_no = EXCLUDED.room_no,
            soi = EXCLUDED.soi,
            road = EXCLUDED.road,
            subdistrict = EXCLUDED.subdistrict,
            district = EXCLUDED.district,
            province = EXCLUDED.province,
            postal_code = EXCLUDED.postal_code,
            phone = EXCLUDED.phone,
            mobile_phone = EXCLUDED.mobile_phone,
            fax = EXCLUDED.fax,
            email = EXCLUDED.email,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude
        `;
        const optional = (v: unknown): string | null => text(v) || null;
        await client.query(accQuery, [
          studentId,
          text(accommodation.house_no),
          optional(accommodation.building),
          optional(accommodation.room_no),
          optional(accommodation.soi),
          optional(accommodation.road),
          text(accommodation.subdistrict),
          text(accommodation.district),
          text(accommodation.province),
          text(accommodation.postal_code),
          optional(accommodation.phone),
          optional(accommodation.mobile_phone),
          optional(accommodation.fax),
          optional(accommodation.email),
          hasCoords ? Number(accommodation.latitude) : null,
          hasCoords ? Number(accommodation.longitude) : null,
        ]);

        // ⛔ ผู้ติดต่อฉุกเฉินเขียนลง **โปรไฟล์นักศึกษา** ไม่ใช่แถวที่พัก (migration 013)
        //    ทั้ง สหกิจ 03 และ 06 ถามช่องเดียวกัน เก็บสองที่คือเปิดช่องให้ข้อมูลขัดกันเอง
        //    · เขียนในทรานแซกชันเดียวกับที่พัก — ล้มกลางทางต้องไม่เหลือครึ่งเดียว
        await client.query(
          `UPDATE students
              SET emergency_contact_name = $2,
                  emergency_relationship = $3,
                  emergency_phone = $4
            WHERE student_id = $1`,
          [
            studentId,
            optional(accommodation.emergency_contact),
            optional(accommodation.emergency_relationship),
            optional(accommodation.emergency_phone),
          ]
        );

        // Handle weekly plans (delete old, insert new)
        await client.query('DELETE FROM weekly_work_plans WHERE student_id = $1', [studentId]);
        
        for (const plan of weekly_plans) {
          await client.query(`
            INSERT INTO weekly_work_plans (student_id, week_number, start_date, end_date, tasks, status)
            VALUES ($1, $2, $3, $4, $5, 'planned')
          `, [studentId, plan.week_number, plan.start_date, plan.end_date, plan.tasks]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'บันทึกข้อมูลที่พักและแผนปฏิบัติงานสำเร็จ' });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'submitAccommodationAndPlan Error', 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
    }
  }
}
