import { Request, Response } from 'express';
import { UserModel, VALID_ROLES } from '../models/user';
import { PersonnelModel } from '../models/personnel';
import { MasterModel } from '../models/master';
import { query } from '../config/database';
import { hashPassword } from '../utils/password';
import { AuditAction, writeAudit } from '../utils/audit';
import { MENTOR_ROLE_EXCLUSIVE_MESSAGE, sendUnexpectedError } from '../utils/httpError';
import { replaceDeptHeadInMajor } from '../utils/deptHead';

/** บทบาทที่มีแถวใน `personnel` — ตรงกับ PERSONNEL_CLAIMABLE_ROLES ใน auth.ts */
const PERSONNEL_ROLES = ['advisor', 'dean', 'staff', 'dept_head'];



export class UserController {
  /**
   * Get all user accounts with their roles.
   * Route: GET /api/users
   */
  static async getAllUsers(_req: Request, res: Response): Promise<void> {
    try {
      const users = await UserModel.getAll();
      res.status(200).json(users);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get All Users Error', 'An internal server error occurred while fetching users.');
    }
  }

  /**
   * Get a single user by ID.
   * Route: GET /api/users/:id
   */
  static async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'Invalid user ID.' });
        return;
      }

      const user = await UserModel.findById(id);
      if (!user) {
        res.status(404).json({ message: 'User not found.' });
        return;
      }

      // Exclude password hash
      const { password_hash: _, ...userWithoutHash } = user;
      res.status(200).json(userWithoutHash);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get User By ID Error', 'An internal server error occurred while fetching the user.');
    }
  }

  /**
   * Create a user account manually (staff only).
   * Route: POST /api/users
   */
  static async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, role, roles, major_id } = req.body;

      // The staff form sends `roles` (several checkboxes, same shape as PUT /:id);
      // a single `role` string is still accepted for API callers.
      const rawRoles: unknown[] = Array.isArray(roles) ? roles : role ? [role] : [];
      const roleList = [...new Set(rawRoles.map((r) => (typeof r === 'string' ? r.trim().toLowerCase() : '')))];

      if (!email || roleList.length === 0) {
        res.status(400).json({ message: 'Email and role are required.' });
        return;
      }
      // Checked before the INSERT — addRole throwing afterwards would leave an
      // account with no role behind.
      const invalidRole = roleList.find((r) => !VALID_ROLES.includes(r));
      if (invalidRole !== undefined) {
        res.status(400).json({ message: `Invalid role: '${invalidRole}'.` });
        return;
      }

      // SEC-15: บัญชีพี่เลี้ยงต้องมีแถว `mentors` ซึ่งมีแต่ขั้นรับแบบตอบรับเท่านั้นที่สร้าง — สร้างด้วยมือได้แค่บัญชีกำพร้า
      if (roleList.includes('mentor')) {
        // mentor ร่วมกับบทบาทอื่น = ผิดกติกา "พี่เลี้ยงเป็นได้บทบาทเดียว" (trigger ฐานข้อมูล · migration 043) ก่อนจะถึงข้อความนี้
        res.status(400).json({
          message: roleList.some((r) => r !== 'mentor')
            ? MENTOR_ROLE_EXCLUSIVE_MESSAGE
            : 'พี่เลี้ยงถูกเปิดบัญชีอัตโนมัติเมื่อเจ้าหน้าที่กดรับแบบตอบรับ ไม่ต้องเพิ่มด้วยมือ',
        });
        return;
      }

      // ที่ปรึกษา/หัวหน้าสาขาที่ไม่มีแถว personnel ใช้ฝ่ายอาจารย์ไม่ได้เลย (resolveMajorScope → 403)
      // จึงต้องเลือกสาขาตั้งแต่ตอนสร้าง — ตรวจทั้งหมดก่อน INSERT
      const parsedMajorId =
        major_id === undefined || major_id === null || major_id === '' ? null : Number(major_id);
      if (parsedMajorId !== null && (!Number.isInteger(parsedMajorId) || !(await MasterModel.verifyMajorExists(parsedMajorId)))) {
        res.status(400).json({ message: 'ไม่พบสาขาวิชาที่เลือก' });
        return;
      }
      if (parsedMajorId !== null && !roleList.some((r) => PERSONNEL_ROLES.includes(r))) {
        res.status(400).json({ message: 'บัญชีนี้ไม่มีบทบาทบุคลากร จึงตั้งสาขาไม่ได้' });
        return;
      }
      if (parsedMajorId === null && roleList.some((r) => r === 'advisor' || r === 'dept_head')) {
        res.status(400).json({ message: 'บัญชีอาจารย์ที่ปรึกษาหรือหัวหน้าสาขาวิชาต้องเลือกสาขาวิชา' });
        return;
      }

      if (!password) {
        res.status(400).json({ message: 'Password is required.' });
        return;
      }

      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        res.status(400).json({ message: 'อีเมลนี้มีบัญชีในระบบอยู่แล้ว' });
        return;
      }

      const passwordHash = await hashPassword(password);
      const user = await UserModel.createUser(email, passwordHash, roleList[0]);
      for (const extraRole of roleList.slice(1)) {
        await UserModel.addRole(user.user_id, extraRole);
      }
      user.roles = roleList;

      if (parsedMajorId !== null) {
        await PersonnelModel.createPersonnel(user.user_id, parsedMajorId);
      }
      // SB-G2: หัวหน้าสาขามีคนเดียวต่อสาขา — เหมือน PUT /:id
      const replacedDeptHeads = roleList.includes('dept_head') ? await replaceDeptHeadInMajor(user.user_id, req) : [];

      writeAudit({
        action: AuditAction.USER_CREATED,
        entityType: 'user',
        entityId: user.user_id,
        subjectId: user.user_id,
        detail: { email, roles: roleList, ...(parsedMajorId !== null && { major_id: parsedMajorId }) },
      }, req).catch(() => undefined);

      // password_hash never belongs in a response, not even to staff.
      const { password_hash: _omitted, ...safeUser } = user;

      res.status(201).json({
        message: 'User created successfully.',
        user: safeUser,
        replaced_dept_heads: replacedDeptHeads,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Create User Error', 'An internal server error occurred while creating the user.');
    }
  }

  /**
   * Update an existing user's details and multiple roles (e.g. adding 'dept_head' to an 'advisor').
   * Route: PUT /api/users/:id
   */
  static async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'Invalid user ID.' });
        return;
      }

      const { email, roles, is_active, major_id, birth_date } = req.body;

      if (!email || !roles || !Array.isArray(roles) || is_active === undefined) {
        res.status(400).json({ message: 'Email, roles array, and is_active are required.' });
        return;
      }

      // major_id / birth_date are optional and only mean something for personnel.
      // This is the one place either can change after setup — the person can't
      // change their major at all, and their birth date only once (profile.ts),
      // because the major is their access scope and the birth date drives the
      // age-60 auto-deactivation.
      const parsedMajorId =
        major_id === undefined || major_id === null || major_id === '' ? null : Number(major_id);
      const parsedBirthDate =
        birth_date === undefined || birth_date === null || birth_date === '' ? null : String(birth_date);
      if (parsedMajorId !== null && (!Number.isInteger(parsedMajorId) || !(await MasterModel.verifyMajorExists(parsedMajorId)))) {
        res.status(400).json({ message: 'ไม่พบสาขาวิชาที่เลือก' });
        return;
      }
      if (parsedBirthDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(parsedBirthDate)) {
        res.status(400).json({ message: 'รูปแบบวันเกิดไม่ถูกต้อง' });
        return;
      }

      const beforePersonnel =
        parsedMajorId !== null || parsedBirthDate !== null ? await PersonnelModel.findByPersonnelId(id) : null;
      // บัญชีบุคลากรที่ยังไม่มีแถว personnel (เจ้าหน้าที่สร้างบัญชีเองโดยไม่ผ่านรายชื่อรหัสบุคลากร)
      // ใช้งานฝ่ายอาจารย์ไม่ได้เลย (resolveMajorScope → 403) — เลือกสาขาที่นี่ = สร้างแถวให้
      if (!beforePersonnel && (parsedMajorId !== null || parsedBirthDate !== null)) {
        if (!roles.some((r: string) => PERSONNEL_ROLES.includes(r))) {
          res.status(400).json({ message: 'บัญชีนี้ไม่มีบทบาทบุคลากร จึงตั้งสาขาหรือวันเกิดไม่ได้' });
          return;
        }
        if (parsedMajorId === null) {
          res.status(400).json({ message: 'บัญชีนี้ยังไม่มีโปรไฟล์บุคลากร กรุณาเลือกสาขาวิชาก่อน' });
          return;
        }
      }

      const existingUser = await UserModel.findByEmail(email);
      if (existingUser && existingUser.user_id !== id) {
        res.status(400).json({ message: 'Email is already used by another account.' });
        return;
      }

      // Capture the prior state so the audit row shows what actually changed —
      // this endpoint can rewrite any account's email and role set.
      const before = await UserModel.findById(id);

      // พี่เลี้ยงเป็นได้บทบาทเดียว (trigger ฐานข้อมูล · migration 043) — ตอบ 400 ไทยก่อนถึงฐาน ไม่ปล่อยให้เป็น 500
      //   · ชุดบทบาทใหม่มี mentor ปนบทบาทอื่น
      //   · บัญชีเดิมเป็นพี่เลี้ยง แต่ชุดใหม่มีบทบาทอื่น (ทั้งเพิ่มและเปลี่ยนไปเป็นบทบาทอื่น)
      const wantedRoles = roles.map((r: unknown) => (typeof r === 'string' ? r.trim() : '')).filter(Boolean);
      const wantsOtherRole = wantedRoles.some((r: string) => r !== 'mentor');
      if (
        (wantedRoles.includes('mentor') && wantsOtherRole) ||
        (before?.roles.includes('mentor') && wantsOtherRole)
      ) {
        res.status(400).json({ message: MENTOR_ROLE_EXCLUSIVE_MESSAGE });
        return;
      }

      // SEC-15: เติมบทบาท mentor ให้บัญชีที่ไม่ใช่พี่เลี้ยงไม่ได้ — พี่เลี้ยงมีทางเกิดทางเดียวคือขั้นรับแบบตอบรับ
      if (before && roles.includes('mentor') && !before.roles.includes('mentor')) {
        // บัญชีที่ถือบทบาทอื่นอยู่ (แล้วเปลี่ยนเป็น mentor ล้วน) = ผิดกติกาเป็นพี่เลี้ยงได้บทบาทเดียวเหมือนกัน
        res.status(400).json({
          message: before.roles.length > 0
            ? MENTOR_ROLE_EXCLUSIVE_MESSAGE
            : 'พี่เลี้ยงถูกเปิดบัญชีอัตโนมัติเมื่อเจ้าหน้าที่กดรับแบบตอบรับ ไม่ต้องเพิ่มด้วยมือ',
        });
        return;
      }

      const updatedUser = await UserModel.update(id, email, roles, is_active);
      if (!updatedUser) {
        res.status(404).json({ message: 'User not found.' });
        return;
      }

      const personnelCreated = !beforePersonnel && parsedMajorId !== null;
      if (personnelCreated) {
        await PersonnelModel.createPersonnel(id, parsedMajorId, null, null, null, parsedBirthDate);
      }

      const majorChanged = beforePersonnel !== null && parsedMajorId !== null && parsedMajorId !== beforePersonnel.major_id;
      if (majorChanged) {
        await PersonnelModel.updatePersonnel(id, parsedMajorId, null);
      }

      // เทียบเป็นสตริง YYYY-MM-DD — `Date` จาก pg เพี้ยนตามโซนเวลา (กฎ backend-db)
      const birthDateBefore: string | null =
        beforePersonnel && parsedBirthDate !== null
          ? ((await query('SELECT birth_date::text AS b FROM personnel WHERE personnel_id = $1', [id])).rows[0]?.b ?? null)
          : null;
      const birthDateChanged = beforePersonnel !== null && parsedBirthDate !== null && parsedBirthDate !== birthDateBefore;
      if (birthDateChanged) {
        await PersonnelModel.updatePersonnel(id, null, null, null, null, parsedBirthDate);
      }

      // SB-G2: หัวหน้าสาขามีคนเดียวต่อสาขา — เจ้าหน้าที่ตั้งคนนี้ = ถอดคนเก่าในสาขาเดียวกัน
      // (ต้องอยู่หลังการย้าย/สร้างสาขา — มันอ่านสาขาจากแถว personnel)
      const replacedDeptHeads = roles.includes('dept_head') ? await replaceDeptHeadInMajor(id, req) : [];

      writeAudit({
        action: AuditAction.USER_UPDATED,
        entityType: 'user',
        entityId: id,
        subjectId: id,
        detail: {
          email_before: before?.email ?? null,
          email_after: email,
          roles_before: before?.roles ?? [],
          roles_after: roles,
          is_active_before: before?.is_active ?? null,
          is_active_after: is_active,
          ...(personnelCreated && { personnel_created: true, major_id_after: parsedMajorId, birth_date_after: parsedBirthDate }),
          ...(majorChanged && {
            major_id_before: beforePersonnel.major_id,
            major_id_after: parsedMajorId,
          }),
          ...(birthDateChanged && { birth_date_before: birthDateBefore, birth_date_after: parsedBirthDate }),
        },
      }, req).catch(() => undefined);

      res.status(200).json({
        message: 'User updated successfully.',
        user: updatedUser,
        replaced_dept_heads: replacedDeptHeads,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Update User Error', 'An internal server error occurred while updating the user.');
    }
  }

  /**
   * Delete a user account (foreign key cascades to student and personnel profiles).
   * Route: DELETE /api/users/:id
   */
  static async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'Invalid user ID.' });
        return;
      }

      const target = await UserModel.findById(id);

      const deleted = await UserModel.delete(id);
      if (!deleted) {
        res.status(404).json({ message: 'User not found.' });
        return;
      }

      writeAudit({
        action: AuditAction.USER_DELETED,
        entityType: 'user',
        entityId: id,
        detail: { email: target?.email ?? null, roles: target?.roles ?? [] },
      }, req).catch(() => undefined);

      res.status(200).json({ message: 'User and all associated profiles deleted successfully.' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Delete User Error', 'An internal server error occurred while deleting the user.');
    }
  }
}
