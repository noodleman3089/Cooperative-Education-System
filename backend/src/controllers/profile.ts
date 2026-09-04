import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { StudentModel } from '../models/student';
import { PersonnelModel } from '../models/personnel';
import { MentorModel } from '../models/mentor';
import { MasterModel } from '../models/master';
import { UserModel } from '../models/user';

import { hashPassword } from '../utils/password';
import { sendUnexpectedError } from '../utils/httpError';
import { StudentProfileSetupBody, PersonnelProfileSetupBody } from '../types';

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

      // password is optional now. Only validate and hash if provided
      if (password !== undefined && password !== null && password !== '') {
        if (typeof password !== 'string' || password.length < 6) {
          res.status(400).json({ message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' });
          return;
        }
        const hashedPassword = await hashPassword(password);
        await UserModel.updatePassword(userId, hashedPassword);
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
        // ponytail: All enrolled students are eligible by default
        const seededEligible = inheritsEligibility ? eligibilityRecord!.is_eligible : true;

        // Save profile to STUDENT table
        const profile = await StudentModel.createStudent(
          userId,
          student_code,
          major_id,
          province_id !== undefined && province_id !== null ? province_id : null,
          seededGpa, // GPA is authoritative from the staff import, never self-reported
          null, // first_name
          null, // last_name
          null, // nickname
          null, // year_level
          null, // birth_date
          null, // alt_email
          null, // phone
          null, // current_address
          null, // parent_name
          null, // parent_phone
          Number(enrollment_year),
          seededEligible,
          false // orientation is confirmed by staff after the briefing session
        );

        // Assign 'student' role in USER_ROLES
        await UserModel.addRole(userId, 'student');

        res.status(201).json({
          message: eligibilityRecord
            ? 'บันทึกโปรไฟล์นักศึกษาเรียบร้อยแล้ว'
            : 'บันทึกโปรไฟล์นักศึกษาเรียบร้อยแล้ว (ยังไม่พบรายชื่อในบัญชีผู้มีสิทธิ์สหกิจศึกษา กรุณาติดต่อเจ้าหน้าที่)',
          profile,
        });
        return;

      } else {
        const body = req.body as PersonnelProfileSetupBody;
        const { major_id, e_signature_file, first_name, last_name } = body;

        if (major_id === undefined) {
          res.status(400).json({ message: 'กรุณาระบุข้อมูลสาขาวิชา' });
          return;
        }

        // ── Option A: Admin pre-creates accounts ──
        // Verify this user already has a personnel role assigned by admin.
        // Self-registration is NOT allowed; admin must create the account
        // with the correct role(s) before the user logs in.
        const PERSONNEL_ROLES = ['advisor', 'dean', 'staff', 'dept_head'];
        const currentUser = await UserModel.findById(userId);
        const personnelRoles = (currentUser?.roles || []).filter((r: string) =>
          PERSONNEL_ROLES.includes(r)
        );

        if (personnelRoles.length === 0) {
          res.status(403).json({
            message: 'บัญชีของคุณยังไม่ได้ผ่านการลงทะเบียนล่วงหน้าโดยผู้ดูแลระบบ กรุณาติดต่อเจ้าหน้าที่เพื่อสร้างบัญชีพร้อมระบุบทบาทที่ถูกต้อง'
          });
          return;
        }

        // Check if personnel profile already exists
        const existingProfile = await PersonnelModel.findByPersonnelId(userId);
        if (existingProfile) {
          res.status(400).json({ message: 'บัญชีนี้ได้รับการตั้งค่าโปรไฟล์บุคลากรเรียบร้อยแล้ว' });
          return;
        }

        // Validate major existence
        const majorExists = await MasterModel.verifyMajorExists(major_id);
        if (!majorExists) {
          res.status(400).json({ message: 'รหัสสาขาวิชาไม่ถูกต้อง ไม่พบข้อมูลสาขาวิชานี้ในระบบ' });
          return;
        }

        // Save profile to PERSONNEL table
        // Roles are already assigned by admin — no role mutation here.
        const profile = await PersonnelModel.createPersonnel(
          userId,
          major_id,
          e_signature_file || null,
          first_name || null,
          last_name || null
        );

        res.status(201).json({
          message: 'เปิดใช้งานโปรไฟล์บุคลากรเรียบร้อยแล้ว',
          profile,
          assignedRoles: personnelRoles
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
        res.status(200).json({ roles, profile });
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
        lockedEnrollmentYear
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
      const { major_id, first_name, last_name, birth_date } = req.body;

      // Omitting major_id keeps whatever is on record. It used to be mandatory,
      // which forced callers that only wanted to update something else — the
      // e-signature pad, for one — to invent a value to send.
      const parsedMajorId =
        major_id === undefined || major_id === null || major_id === '' ? null : parseInt(major_id, 10);

      if (parsedMajorId !== null && isNaN(parsedMajorId)) {
        res.status(400).json({ message: 'major_id must be a valid integer.' });
        return;
      }

      const cleanBirthDate = birth_date !== undefined && birth_date !== null && birth_date !== '' ? birth_date : null;

      const existingProfile = await PersonnelModel.findByPersonnelId(userId);
      if (!existingProfile) {
        res.status(404).json({ message: 'Personnel profile not found. Please set up profile first.' });
        return;
      }

      // Validate major (only when one was actually supplied)
      if (parsedMajorId !== null) {
        const majorExists = await MasterModel.verifyMajorExists(parsedMajorId);
        if (!majorExists) {
          res.status(400).json({ message: 'Invalid major_id. Referenced major does not exist.' });
          return;
        }
      }

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

      const updated = await PersonnelModel.updatePersonnel(
        userId,
        parsedMajorId,
        signatureFile,
        first_name !== undefined ? first_name : null,
        last_name !== undefined ? last_name : null,
        cleanBirthDate
      );

      res.status(200).json({
        message: 'Personnel profile updated successfully.',
        profile: updated,
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
