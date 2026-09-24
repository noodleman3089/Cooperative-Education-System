import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { StudentModel } from '../models/student';
import { PersonnelModel } from '../models/personnel';
import { MentorModel } from '../models/mentor';
import { MasterModel } from '../models/master';
import { UserModel } from '../models/user';
import { query } from '../config/database';

import { hashPassword } from '../utils/password';
import { sendUnexpectedError } from '../utils/httpError';
import { StudentProfileSetupBody } from '../types';

export class ProfileController {
  /**
   * Set up a user's profile for the first time.
   * Route: POST /api/profile/setup
   * Security: Authenticated users only
   */
  static async setupProfile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'ไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบ' });
        return;
      }

      const { userId } = req.user;
      const { type, password } = req.body;

      if (!type || !['student', 'personnel'].includes(type)) {
        res.status(400).json({ message: "ประเภทโปรไฟล์ไม่ถูกต้อง ต้องเป็น 'student' หรือ 'personnel'" });
        return;
      }

      // บุคลากรไม่ตั้งโปรไฟล์เองทางนี้แล้ว (2026-09-24) — ทางนี้ให้เลือกสาขาเองได้ ซึ่งคือ scope
      // ของ `resolveMajorScope` (แบบเดียวกับ SEC-05) และไม่มีหน้าจอไหนเรียกอยู่แล้ว
      // แถว personnel เกิดได้จากสิ่งที่เจ้าหน้าที่เตรียมเท่านั้น: claim รหัสบุคลากร · นำเข้าผู้ใช้
      // · `PUT /users/:id` ช่อง `major_id`
      if (type === 'personnel') {
        res.status(403).json({
          message: 'บุคลากรตั้งค่าสาขาเองไม่ได้ — กรุณายืนยันตัวตนด้วยรหัสบุคลากร หรือติดต่อเจ้าหน้าที่สหกิจศึกษา',
        });
        return;
      }

      // password is optional now. Only validate and hash if provided
      // ⛔ ตรวจและ hash ตรงนี้ แต่ **เขียนลงฐานหลังด่านตรวจทุกด่านของแต่ละสาขาผ่านแล้ว**
      //    เดิมเขียนทันที — คำขอที่ตกด่านทีหลัง (รหัสนักศึกษาซ้ำ ฯลฯ) ได้ 400 แต่รหัสผ่านเปลี่ยนไปแล้ว
      let hashedPassword: string | null = null;
      if (password !== undefined && password !== null && password !== '') {
        // กฎชุดเดียวกับหน้า OnboardingStudent — เดิมเซิร์ฟเวอร์ตรวจแค่ 6 ตัว
        // ยิง API ตรงจึงตั้งรหัสที่หน้าจอไม่ยอมรับได้
        if (typeof password !== 'string' || password.length < 8) {
          res.status(400).json({ message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร' });
          return;
        }
        if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
          res.status(400).json({ message: 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลขอย่างน้อยอย่างละ 1 ตัว' });
          return;
        }
        hashedPassword = await hashPassword(password);
      }

      if (type === 'student') {
        const body = req.body as StudentProfileSetupBody;
        let { student_code } = body;
        const { major_id, province_id, enrollment_year } = body;

        // Auto-extract student code if missing
        if (!student_code) {
          const email = req.user.email || '';
          const emailLocalPart = email.split('@')[0].toLowerCase();
          student_code = (emailLocalPart.startsWith('s') && /^s\d+/.test(emailLocalPart))
            ? emailLocalPart.substring(1)
            : emailLocalPart;
        }

        // Validation: Required fields (student_code, major_id, and enrollment_year)
        if (!student_code || major_id === undefined || enrollment_year === undefined || enrollment_year === null) {
          res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็น: รหัสนักศึกษา, สาขาวิชา, และปีการศึกษาที่เข้าศึกษา' });
          return;
        }

        // Check if student profile already exists
        const existingProfile = await StudentModel.findByStudentId(userId);
        if (existingProfile) {
          res.status(400).json({ message: 'บัญชีนี้ได้รับการตั้งค่าโปรไฟล์นักศึกษาเรียบร้อยแล้ว' });
          return;
        }

        // Check if student code is already registered
        const isCodeTaken = await StudentModel.existsByStudentCode(student_code);
        if (isCodeTaken) {
          res.status(400).json({ message: 'รหัสนักศึกษานี้ได้รับการลงทะเบียนในระบบแล้ว' });
          return;
        }

        // Validate major existence
        const majorExists = await MasterModel.verifyMajorExists(major_id);
        if (!majorExists) {
          res.status(400).json({ message: 'รหัสสาขาวิชาไม่ถูกต้อง ไม่พบข้อมูลสาขาวิชานี้ในระบบ' });
          return;
        }

        // Validate province if provided
        if (province_id !== undefined && province_id !== null) {
          const provinceExists = await MasterModel.verifyProvinceExists(province_id);
          if (!provinceExists) {
            res.status(400).json({ message: 'รหัสจังหวัดไม่ถูกต้อง ไม่พบข้อมูลจังหวัดนี้ในระบบ' });
            return;
          }
        }

        // SEC-02: eligibility and GPA come from the staff-managed staging list only.
        // A student creating their own profile must NOT be able to grant themselves
        // the right to submit an intent form — that is the whole point of Co-op 01.
        //
        // Inheriting a staging row also means we must be sure the caller owns that
        // student_code, otherwise claiming a classmate's code would inherit their
        // eligibility. The code counts as bound when either the account email is
        // itself the student code, or staff recorded the email on the staging row.
        const accountEmail = (req.user.email || '').trim().toLowerCase();
        const accountLocalPart = accountEmail.split('@')[0];
        const emailIsStudentCode = /^s?[\d-]+$/.test(accountLocalPart);

        const eligibilityRecord = await StudentModel.findEligibilityRecord(student_code);
        const stagedEmail = (eligibilityRecord?.email || '').trim().toLowerCase();

        const codeIsBoundToCaller =
          emailIsStudentCode || (!!stagedEmail && stagedEmail === accountEmail);

        if (eligibilityRecord && stagedEmail && stagedEmail !== accountEmail && !emailIsStudentCode) {
          console.warn(
            `[SEC-02] Rejected profile setup: user ${userId} (${accountEmail}) attempted to claim student_code ${student_code} bound to ${stagedEmail}.`
          );
          res.status(403).json({
            message: 'รหัสนักศึกษานี้ผูกกับบัญชีอีเมลอื่น กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา',
          });
          return;
        }

        const inheritsEligibility = !!eligibilityRecord && codeIsBoundToCaller;
        const seededGpa = inheritsEligibility ? Number(eligibilityRecord!.cumulative_gpa) : null;

        /**
         * ช่องติดต่อที่หน้ากรอกครั้งแรกเก็บมาด้วย (2026-09-07)
         *
         * เดิมส่ง `null` เข้าไปทุกช่องทั้งที่ `createStudent` รับได้อยู่แล้ว นักศึกษาจึงต้อง
         * เข้าระบบแล้วไปกรอกชื่อตัวเองซ้ำอีกรอบในหน้าโปรไฟล์ ทั้งที่เพิ่งกรอกไปเมื่อครู่
         *
         * ⛔ **สี่ช่องนี้เท่านั้น** — เป็นข้อมูลติดต่อที่เจ้าตัวเป็นแหล่งความจริง
         * ห้ามเปิดรับเพิ่มจากตรงนี้: `cumulative_gpa` ยังมาจากรายชื่อที่เจ้าหน้าที่นำเข้า
         * เท่านั้น (`seededGpa`) และ **เลขบัตร/เชื้อชาติ/ศาสนาไม่อยู่ในขั้นนี้โดยตั้งใจ**
         * — สามอย่างนั้นขอตอนเริ่มยื่นเรื่องจริง เพราะ SEC-12 บังคับให้เข้ารหัสและลบใน
         * 90 วัน ระบบจึงต้องไม่ถือไว้ตั้งแต่วันแรกสำหรับคนที่สุดท้ายอาจไม่ได้ไปสหกิจ
         */
        const text = (value: unknown, max: number): string | null => {
          if (typeof value !== 'string') return null;
          const trimmed = value.trim();
          return trimmed ? trimmed.slice(0, max) : null;
        };

        /**
         * เกรดที่นักศึกษาแจ้งเอง — ลง `students.claimed_gpa` **ไม่ใช่ `cumulative_gpa`**
         *
         * อาจารย์ที่ปรึกษาโปรเจคขอให้นักศึกษากรอกเกรดได้ตั้งแต่ต้น (2026-09-07) ซึ่งจำเป็นจริง
         * เพราะที่เดิมสำหรับค่านี้คือ `coop_applications.claimed_gpa` ของ สหกิจ 01 ที่ถูกข้ามไปแล้ว
         * — ไม่เหลือที่ให้แจ้งเกรดเลย
         *
         * ⛔ แต่ยังลง `cumulative_gpa` ตรงๆ ไม่ได้ (SEC-05): เลขทะเบียนถูกพิมพ์ลง
         * **หนังสือราชการที่คณบดีเซ็น** ตัวเลขที่ยังไม่มีมนุษย์ยืนยันจึงกลายเป็นเอกสารเท็จได้
         * การคัดลอกเข้าทะเบียนต้องผ่านการยืนยันของเจ้าหน้าที่เหมือนที่หัวหน้าสาขาเคยทำใน สหกิจ 01
         *
         * ⛔ ตรวจ **ก่อน** สร้างแถว — เดิมตรวจหลัง `createStudent` เกรดผิดช่วงจึงได้ 400
         *    แต่แถว students ค้างอยู่โดยไม่มี role และส่งซ้ำไม่ได้อีก ("ตั้งค่าเรียบร้อยแล้ว")
         */
        let claimedGpa: number | null = null;
        if (body.claimed_gpa !== undefined && body.claimed_gpa !== null && body.claimed_gpa !== '') {
          const parsed = Number(body.claimed_gpa);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 4) {
            res.status(400).json({ message: 'เกรดเฉลี่ยสะสมต้องเป็นตัวเลขระหว่าง 0.00 ถึง 4.00' });
            return;
          }
          claimedGpa = Math.round(parsed * 100) / 100;
        }

        // ด่านตรวจของสาขานักศึกษาผ่านครบแล้ว — จากนี้ไปคือการเขียน
        if (hashedPassword) {
          await UserModel.updatePassword(userId, hashedPassword);
        }

        // Save profile to STUDENT table
        const profile = await StudentModel.createStudent(
          userId,
          student_code,
          major_id,
          province_id !== undefined && province_id !== null ? province_id : null,
          seededGpa, // GPA is authoritative from the staff import, never self-reported
          text(body.first_name, 255),
          text(body.last_name, 255),
          null, // nickname
          null, // year_level
          null, // birth_date
          text(body.alt_email, 255),
          text(body.phone, 50),
          null, // current_address
          null, // parent_name
          null, // parent_phone
          Number(enrollment_year)
        );

        /**
         * งานที่สนใจ — เก็บในขั้นตอนเดียวกันโดยตั้งใจ
         *
         * มี `PUT /profile/student/optional` อยู่แล้วก็จริง แต่เส้นนั้นบังคับ role
         * `student` ซึ่ง **ยังไม่มีอยู่ใน token ตอนนี้** — role เพิ่งถูกเพิ่มบรรทัดถัดไป
         * และ token ที่ผู้เรียกถืออยู่ออกก่อนหน้านั้น ให้หน้าจอยิงตามหลังจึงได้ 403
         * เขียนจากตรงนี้แทน หน้าจอจึงส่งครั้งเดียวจบตามที่ผู้ใช้เห็น
         *
         * ปลอดภัยที่จะเขียนทับ เพราะแถวเพิ่งถูกสร้าง ทุกคอลัมน์ยังเป็น NULL อยู่
         * (`updateOptionalProfile` ไม่มี COALESCE — บนแถวที่มีข้อมูลแล้วมันล้างของเดิม)
         */
        if (claimedGpa !== null) {
          await StudentModel.updateClaimedGpa(userId, claimedGpa);
        }

        const region = text(body.preferred_work_region, 255);
        const jobTypes = Array.isArray(body.interested_job_types)
          ? body.interested_job_types.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 20)
          : null;

        if (region || (jobTypes && jobTypes.length > 0)) {
          await StudentModel.updateOptionalProfile(userId, null, null, region, jobTypes);
        }

        // Assign 'student' role in USER_ROLES
        await UserModel.addRole(userId, 'student');

        res.status(201).json({
          message: eligibilityRecord
            ? 'บันทึกโปรไฟล์นักศึกษาเรียบร้อยแล้ว'
            : 'บันทึกโปรไฟล์นักศึกษาเรียบร้อยแล้ว (ยังไม่พบรายชื่อในบัญชีผู้มีสิทธิ์สหกิจศึกษา กรุณาติดต่อเจ้าหน้าที่)',
          profile,
        });
        return;

      }
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Profile Setup Error',
        'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์ระหว่างการตั้งค่าโปรไฟล์'
      );
    }
  }

  /**
   * Get the current user's profile details.
   * Route: GET /api/profile/me
   */
  static async getMyProfile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { userId, roles } = req.user;

      if (roles.includes('student')) {
        const profile = await StudentModel.findByStudentId(userId);
        if (!profile) {
          res.status(404).json({ message: 'Student profile not set up yet.' });
          return;
        }
        res.status(200).json({ roles, profile });
      } else if (roles.some((r) => ['advisor', 'dean', 'staff', 'dept_head'].includes(r))) {
        const profile = await PersonnelModel.findByPersonnelId(userId);
        if (!profile) {
          res.status(404).json({ message: 'Personnel profile not set up yet.' });
          return;
        }
        // การ์ด "นักศึกษาในความดูแล" บนหน้าโปรไฟล์ — นับจากคอลัมน์เดียวกับที่ `resolveViews`
        // ใช้ตัดสินว่ามีฝ่ายที่ปรึกษา/นิเทศ ตัวเลขกับเมนูที่เห็นจึงตรงกันเสมอ
        let caseload: { advisees: number; supervisees: number } | null = null;
        if (roles.includes('advisor')) {
          const c = await query(
            `SELECT COUNT(*) FILTER (WHERE advisor_id = $1)::int    AS advisees,
                    COUNT(*) FILTER (WHERE supervisor_id = $1)::int AS supervisees
               FROM students`,
            [userId]
          );
          caseload = c.rows[0];
        }
        res.status(200).json({ roles, profile, caseload });
      } else if (roles.includes('mentor')) {
        // A mentor's details live in `mentors`, never in `personnel`. Falling
        // through to the 400 below is what left the mentor profile screen with
        // nothing to show but an error.
        const profile = await MentorModel.findProfileById(userId);
        if (!profile) {
          res.status(404).json({ message: 'Mentor profile not found.' });
          return;
        }
        res.status(200).json({ roles, profile });
      } else {
        res.status(400).json({ message: `Profile retrieval is not supported for current roles.` });
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Profile Error', 'An internal server error occurred while retrieving profile.');
    }
  }

  /**
   * Update student profile (including resume file upload).
   * Route: PUT /api/profile/student
   */
  static async updateStudentProfile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { userId } = req.user;
      const {
        province_id,
        first_name,
        last_name,
        nickname,
        year_level,
        section,
        birth_date,
        alt_email,
        phone,
        current_address,
        parent_name,
        parent_phone,
      } = req.body;

      // SEC-05: student_code, major_id, cumulative_gpa and enrollment_year are
      // registry data, not profile data. Letting students write them meant they
      // could award themselves a GPA, move into another department to dodge the
      // major-matching approval guards, or push enrollment_year forward to escape
      // the graduation auto-deactivation. They are read from the existing record
      // below and any values in the request body are ignored.
      const parsedProvinceId = province_id !== undefined && province_id !== null && province_id !== '' ? parseInt(province_id, 10) : null;
      const parsedYearLevel = year_level !== undefined && year_level !== null && year_level !== '' ? parseInt(year_level, 10) : null;

      const cleanFirstName = first_name || null;
      const cleanLastName = last_name || null;
      const cleanNickname = nickname || null;
      const cleanSection = section ? String(section).trim() : null;
      const cleanBirthDate = birth_date || null;
      const cleanAltEmail = alt_email || null;
      const cleanPhone = phone || null;
      const cleanCurrentAddress = current_address || null;
      const cleanParentName = parent_name || null;
      const cleanParentPhone = parent_phone || null;

      const existingProfile = await StudentModel.findByStudentId(userId);
      if (!existingProfile) {
        res.status(404).json({ message: 'Student profile not found. Please set up profile first.' });
        return;
      }

      // Registry fields are carried over untouched from the stored record.
      const lockedStudentCode = existingProfile.student_code;
      const lockedMajorId = existingProfile.major_id;
      const lockedGpa = existingProfile.cumulative_gpa !== null && existingProfile.cumulative_gpa !== undefined
        ? Number(existingProfile.cumulative_gpa)
        : null;
      const lockedEnrollmentYear = existingProfile.enrollment_year ?? null;

      // Validate province only — major is not user-supplied any more.
      if (parsedProvinceId !== null) {
        const provinceExists = await MasterModel.verifyProvinceExists(parsedProvinceId);
        if (!provinceExists) {
          res.status(400).json({ message: 'Invalid province_id. Referenced province does not exist.' });
          return;
        }
      }

      let resumeFile = null;
      if (req.file) {
        resumeFile = `resumes/${req.file.filename}`;

        // Delete old resume file if exists
        if (existingProfile.resume_file) {
          const oldFilePath = path.join(process.cwd(), 'uploads', existingProfile.resume_file);
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
          }
        }
      }

      const updated = await StudentModel.updateStudent(
        userId,
        lockedStudentCode,
        lockedMajorId,
        parsedProvinceId,
        lockedGpa,
        resumeFile,
        cleanFirstName,
        cleanLastName,
        cleanNickname,
        parsedYearLevel,
        cleanBirthDate,
        cleanAltEmail,
        cleanPhone,
        cleanCurrentAddress,
        cleanParentName,
        cleanParentPhone,
        lockedEnrollmentYear,
        cleanSection
      );

      res.status(200).json({
        message: 'Student profile updated successfully.',
        profile: updated,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Update Student Profile Error',
        'เกิดข้อผิดพลาดระหว่างบันทึกข้อมูลนักศึกษา'
      );
    }
  }

  /**
   * Update personnel profile (including signature file upload).
   * Route: PUT /api/profile/personnel
   */
  static async updatePersonnelProfile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { userId } = req.user;
      // major_id is ignored on purpose (same reasoning as SEC-05 for students):
      // `resolveMajorScope` reads it to decide whose students an advisor or
      // department head can see, so letting people pick it here let them widen
      // their own access. Staff change it at PUT /users/:id.
      const { first_name, last_name, birth_date } = req.body;

      const existingProfile = await PersonnelModel.findByPersonnelId(userId);
      if (!existingProfile) {
        res.status(404).json({ message: 'Personnel profile not found. Please set up profile first.' });
        return;
      }

      // วันเกิดตั้งเองได้ครั้งเดียว (ตอนยังว่าง) — หลังจากนั้นเมิน เพราะ `DeactivationScheduler`
      // ใช้ปิดบัญชีบุคลากรตอนอายุ 60 แก้เองได้ = เลื่อนตัวเองพ้นเกณฑ์ (แบบเดียวกับ `enrollment_year`
      // ของนักศึกษาใน SEC-05) · เจ้าหน้าที่แก้ที่ `PUT /users/:id` ช่อง `birth_date`
      const cleanBirthDate =
        existingProfile.birth_date === null &&
        birth_date !== undefined && birth_date !== null && birth_date !== ''
          ? birth_date
          : null;

      let signatureFile = null;
      if (req.file) {
        signatureFile = `signatures/${req.file.filename}`;

        // Delete old signature file if exists
        if (existingProfile.e_signature_file) {
          const oldFilePath = path.join(process.cwd(), 'uploads', existingProfile.e_signature_file);
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
          }
        }
      }

      await PersonnelModel.updatePersonnel(
        userId,
        null,
        signatureFile,
        first_name !== undefined ? first_name : null,
        last_name !== undefined ? last_name : null,
        cleanBirthDate
      );

      res.status(200).json({
        message: 'Personnel profile updated successfully.',
        profile: await PersonnelModel.findByPersonnelId(userId),
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Update Personnel Profile Error',
        'เกิดข้อผิดพลาดระหว่างบันทึกข้อมูลบุคลากร'
      );
    }
  }

  /**
   * Update the mentor's own contact details.
   * Route: PUT /api/profile/mentor
   *
   * The company registers these four fields on the mentor's behalf when it
   * accepts a student, and until now nothing in the system could correct them —
   * not the mentor, not staff. `company_id` is not accepted here on purpose:
   * it is set by the placement and is server-owned.
   */
  static async updateMentorProfile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { userId } = req.user;
      const { name, position, department, phone } = req.body;

      const cleanName = typeof name === 'string' ? name.trim() : '';
      const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

      // Both columns are NOT NULL in the schema; refuse rather than let the
      // database raise a 500 the caller cannot act on.
      if (!cleanName || !cleanPhone) {
        res.status(400).json({ message: 'กรุณากรอกชื่อ-นามสกุล และเบอร์โทรศัพท์ติดต่อ' });
        return;
      }

      const updated = await MentorModel.updateProfile(userId, {
        name: cleanName,
        position: typeof position === 'string' && position.trim() ? position.trim() : null,
        department: typeof department === 'string' && department.trim() ? department.trim() : null,
        phone: cleanPhone,
      });

      if (!updated) {
        res.status(404).json({ message: 'Mentor profile not found.' });
        return;
      }

      res.status(200).json({
        message: 'บันทึกข้อมูลพี่เลี้ยงเรียบร้อยแล้ว',
        profile: updated,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Update Mentor Profile Error',
        'เกิดข้อผิดพลาดระหว่างบันทึกข้อมูลพนักงานที่ปรึกษา'
      );
    }
  }

  /**
   * นักศึกษาอัปโหลดรูปโปรไฟล์ของตัวเอง
   * Route: POST /api/profile/student/avatar
   * Access: student (ของตัวเองเสมอ — ใช้ userId จาก token ไม่รับ id จากผู้เรียก)
   *
   * ⛔ **แยกจาก `PUT /profile/student` โดยตั้งใจ** — เส้นนั้นตีความ `req.file`
   * เป็นเรซูเม่เสมอ และ `StudentModel.updateStudent` เขียนทับทุกคอลัมน์ที่รับเข้ามา
   * (ไม่มี COALESCE ยกเว้น `resume_file`) การยัดรูปเข้าไปด้วยแปลว่าการเปลี่ยนรูป
   * ต้องส่งฟิลด์โปรไฟล์มาครบทั้งชุด ไม่งั้นสิ่งที่ไม่ได้ส่งกลายเป็น NULL เงียบๆ
   *
   * ⛔ **ระบบไม่ตรวจว่าเป็นรูปตามระเบียบ** (สัดส่วน · พื้นหลังฟ้า · หน้าตรง)
   * เจ้าของเคาะ 2026-09-03 ว่าฐานรูปของมหาวิทยาลัยบังคับอยู่แล้ว — ที่ยังตรวจคือ
   * ชนิดไฟล์จริงจาก magic bytes กับขนาด ซึ่งเป็นด่านเดียวกับทุกการอัปโหลดในระบบ
   */
  static async updateStudentAvatar(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ message: 'กรุณาแนบไฟล์รูปโปรไฟล์' });
        return;
      }

      const imagePath = `avatars/${req.file.filename}`;
      const result = await StudentModel.updateProfileImage(req.user.userId, imagePath);

      if (!result) {
        // ไม่มีประวัตินักศึกษา = ยังตั้งโปรไฟล์ไม่เสร็จ · ลบไฟล์ที่เพิ่งรับมาทิ้ง
        // ไม่งั้นดิสก์สะสมไฟล์ที่ไม่มีแถวไหนอ้างถึงตลอดไป
        fs.promises
          .unlink(path.join(process.cwd(), 'uploads', imagePath))
          .catch(() => undefined);
        res.status(404).json({ message: 'ไม่พบประวัตินักศึกษา กรุณาตั้งค่าโปรไฟล์ก่อน' });
        return;
      }

      // รูปเก่าไม่มีใครอ้างถึงแล้ว — ลบแบบ fire-and-forget เพราะการลบไฟล์ล้มเหลว
      // ไม่ควรทำให้การเปลี่ยนรูปที่บันทึกลงฐานไปแล้วรายงานว่าล้มเหลว
      if (result.previousPath && result.previousPath !== imagePath) {
        fs.promises
          .unlink(path.join(process.cwd(), 'uploads', result.previousPath))
          .catch(() => undefined);
      }

      res.status(200).json({
        message: 'อัปโหลดรูปโปรไฟล์เรียบร้อยแล้ว',
        profile_image: imagePath,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Update Student Avatar Error',
        'เกิดข้อผิดพลาดระหว่างอัปโหลดรูปโปรไฟล์'
      );
    }
  }
}
