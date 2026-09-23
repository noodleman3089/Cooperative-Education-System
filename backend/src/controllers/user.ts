import { Request, Response } from 'express';
import { UserModel } from '../models/user';
import { StudentModel } from '../models/student';
import { PersonnelModel } from '../models/personnel';
import { MasterModel } from '../models/master';
import { query } from '../config/database';
import { hashPassword } from '../utils/password';
import { sendCompanyInviteEmail, sendMentorInviteEmail } from '../utils/email';
import { createInviteLink } from '../utils/invite';
import { sanitizeCsvCell } from '../middlewares/validation';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';
import { replaceDeptHeadInMajor } from '../utils/deptHead';



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
   * Create a user account manually (e.g. for external companies).
   * Route: POST /api/users
   */
  static async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, role } = req.body;

      if (!email || !role) {
        res.status(400).json({ message: 'Email and role are required.' });
        return;
      }

      // A company account is opened with no password at all: the representative
      // sets their own through the invitation link, so nothing usable is ever
      // mailed. Every other role still needs a password supplied here.
      const isCompany = role.trim().toLowerCase() === 'company';

      if (!password && !isCompany) {
        res.status(400).json({ message: 'Password is required for non-company accounts.' });
        return;
      }

      const existingUser = await UserModel.findByEmail(email);
      if (existingUser) {
        res.status(400).json({ message: 'Email is already registered.' });
        return;
      }

      const passwordHash = password ? await hashPassword(password) : null;
      const user = await UserModel.createUser(email, passwordHash, role);

      writeAudit({
        action: AuditAction.USER_CREATED,
        entityType: 'user',
        entityId: user.user_id,
        subjectId: user.user_id,
        detail: { email, role },
      }, req).catch(() => undefined);

      // Invite the company representative to set their own password.
      let inviteLink: string | undefined;
      if (isCompany && !password) {
        inviteLink = await createInviteLink(user.user_id);
        // Run in background and do not await to respond quickly to client
        sendCompanyInviteEmail(email, inviteLink).catch((err) => {
          console.error(`Email dispatch background error for ${email}:`, err);
        });
      }

      // password_hash never belongs in a response, not even to staff.
      const { password_hash: _omitted, ...safeUser } = user;

      res.status(201).json({
        message: 'User created successfully.',
        user: safeUser,
        // Surfaced outside production so the flow stays testable without SMTP.
        inviteLink: process.env.NODE_ENV !== 'production' ? inviteLink : undefined
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Create User Error', 'An internal server error occurred while creating the user.');
    }
  }

  /**
   * Reissue an invitation link to an external partner.
   * Route: POST /api/users/:id/resend-invite
   * Access: staff
   *
   * Companies and mentors have no other way back in: they cannot reach the
   * login form without the address from their email, so they cannot reach
   * "forgot password" either. Without this, a partner who lost or never
   * received their invitation could only be recovered by editing the database.
   */
  static async resendInvite(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ message: 'Invalid user ID.' });
        return;
      }

      const user = await UserModel.findById(id);
      if (!user) {
        res.status(404).json({ message: 'ไม่พบบัญชีผู้ใช้' });
        return;
      }

      // Students and personnel sign in with their university Google account —
      // an invitation link would be a second, weaker way into those accounts.
      const isCompany = user.roles.includes('company');
      const isMentor = user.roles.includes('mentor');
      if (!isCompany && !isMentor) {
        res.status(400).json({
          message: 'ส่งลิงก์เชิญได้เฉพาะบัญชีสถานประกอบการและพี่เลี้ยงเท่านั้น',
        });
        return;
      }

      if (!user.is_active) {
        res.status(400).json({ message: 'บัญชีนี้ถูกระงับอยู่ กรุณาเปิดใช้งานบัญชีก่อนส่งลิงก์เชิญ' });
        return;
      }

      const inviteLink = await createInviteLink(user.user_id);
      const send = isCompany ? sendCompanyInviteEmail : sendMentorInviteEmail;
      send(user.email, inviteLink).catch((err) => {
        console.error(`Resend invite email failed for ${user.email}:`, err);
      });

      writeAudit({
        action: AuditAction.USER_UPDATED,
        entityType: 'user',
        entityId: user.user_id,
        subjectId: user.user_id,
        detail: { action: 'invite_resent' },
      }, req).catch(() => undefined);

      res.status(200).json({
        message: `ส่งลิงก์เชิญเข้าใช้งานไปที่ ${user.email} เรียบร้อยแล้ว`,
        inviteLink: process.env.NODE_ENV !== 'production' ? inviteLink : undefined,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Resend Invite Error', 'เกิดข้อผิดพลาดในการส่งลิงก์เชิญ');
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

      const { email, roles, is_active, major_id } = req.body;

      if (!email || !roles || !Array.isArray(roles) || is_active === undefined) {
        res.status(400).json({ message: 'Email, roles array, and is_active are required.' });
        return;
      }

      // major_id is optional and only means something for accounts with a
      // personnel row. This is the one place a major can change after setup —
      // the person can't do it from their own profile any more.
      const parsedMajorId =
        major_id === undefined || major_id === null || major_id === '' ? null : Number(major_id);
      const beforePersonnel = parsedMajorId !== null ? await PersonnelModel.findByPersonnelId(id) : null;
      if (parsedMajorId !== null) {
        if (!Number.isInteger(parsedMajorId) || !(await MasterModel.verifyMajorExists(parsedMajorId))) {
          res.status(400).json({ message: 'ไม่พบสาขาวิชาที่เลือก' });
          return;
        }
        if (!beforePersonnel) {
          res.status(400).json({ message: 'บัญชีนี้ยังไม่มีโปรไฟล์บุคลากร จึงยังตั้งสาขาไม่ได้' });
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

      const updatedUser = await UserModel.update(id, email, roles, is_active);
      if (!updatedUser) {
        res.status(404).json({ message: 'User not found.' });
        return;
      }

      const majorChanged = beforePersonnel !== null && parsedMajorId !== beforePersonnel.major_id;
      if (majorChanged) {
        await PersonnelModel.updatePersonnel(id, parsedMajorId, null);
      }

      // SB-G2: หัวหน้าสาขามีคนเดียวต่อสาขา — เจ้าหน้าที่ตั้งคนนี้ = ถอดคนเก่าในสาขาเดียวกัน
      // (ต้องอยู่หลังการย้ายสาขา — มันอ่านสาขาจากแถว personnel)
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
          ...(majorChanged && {
            major_id_before: beforePersonnel.major_id,
            major_id_after: parsedMajorId,
          }),
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

  /**
   * Import multiple users and pre-populate USER, STUDENT, and PERSONNEL tables.
   * Route: POST /api/users/import
   */
  static async importUsers(req: Request, res: Response): Promise<void> {
    try {
      interface RawImportUser {
        email: string;
        role: string; // e.g., 'student', 'advisor', 'dept_head'
        student_code?: string;
        major_code?: string; // e.g. 'CS01' to resolve major_id
        province_name?: string; // e.g. 'กรุงเทพมหานคร' to resolve province_id
        cumulative_gpa?: number;
        e_signature_file?: string;
      }

      let usersToImport: RawImportUser[] = [];

      // 1. Determine input format (JSON or CSV)
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        usersToImport = req.body.users || [];
      } else if (typeof req.body === 'string') {
        const lines = req.body.split(/\r?\n/);
        const startIdx = lines[0].toLowerCase().includes('email') ? 1 : 0;
        
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts = line.split(',');
          if (parts.length >= 2) {
            usersToImport.push({
              email: sanitizeCsvCell(parts[0] || ''),
              role: sanitizeCsvCell(parts[1] || ''),
              student_code: parts[2] ? sanitizeCsvCell(parts[2]) : undefined,
              major_code: parts[3] ? sanitizeCsvCell(parts[3]) : undefined,
              province_name: parts[4] ? sanitizeCsvCell(parts[4]) : undefined,
              cumulative_gpa: parts[5] && parts[5].trim() ? parseFloat(sanitizeCsvCell(parts[5])) : undefined,
              e_signature_file: parts[6] ? sanitizeCsvCell(parts[6]) : undefined
            });
          }
        }
      }

      if (usersToImport.length === 0) {
        res.status(400).json({ message: 'No users found to import.' });
        return;
      }

      let importedCount = 0;
      let skippedCount = 0;
      const skippedEmails: string[] = [];

      // 2. Iterate and pre-populate
      for (const item of usersToImport) {
        const email = item.email ? item.email.trim().toLowerCase() : '';
        const role = item.role ? item.role.trim().toLowerCase() : '';

        if (!email || !role) {
          skippedCount++;
          continue;
        }

        try {
          // Check duplicate
          const existingUser = await UserModel.findByEmail(email);
          if (existingUser) {
            skippedCount++;
            skippedEmails.push(email);
            continue;
          }

          // Create base user without password (password_hash is null for SSO)
          const user = await UserModel.createUser(email, null, role);

          // Populate profile tables if major_code is specified
          if (item.major_code) {
            // Resolve major_id by code
            const majorRes = await query('SELECT major_id FROM master_major WHERE major_code = $1 LIMIT 1', [item.major_code]);
            const majorId = majorRes.rowCount && majorRes.rowCount > 0 ? majorRes.rows[0].major_id : 1;

            if (role === 'student' && item.student_code) {
              // Resolve province_id
              let provinceId = 1;
              if (item.province_name) {
                const provinceRes = await query('SELECT province_id FROM master_province WHERE province_name_th = $1 LIMIT 1', [item.province_name]);
                if (provinceRes.rowCount && provinceRes.rowCount > 0) {
                  provinceId = provinceRes.rows[0].province_id;
                }
              }

              // Create Student profile
              await StudentModel.createStudent(
                user.user_id,
                item.student_code,
                majorId,
                provinceId,
                item.cumulative_gpa !== undefined ? item.cumulative_gpa : 3.00
              );
            } else if (['advisor', 'dean', 'staff', 'dept_head'].includes(role)) {
              // Create Personnel profile
              await PersonnelModel.createPersonnel(
                user.user_id,
                majorId,
                item.e_signature_file || null
              );
              // SB-G2: ไฟล์นำเข้าเป็นของเจ้าหน้าที่ — แถวหัวหน้าสาขาแทนคนเก่าในสาขานั้น
              if (role === 'dept_head') {
                await replaceDeptHeadInMajor(user.user_id, req);
              }
            }
          }

          importedCount++;
        } catch (err) {
          console.error(`Failed to import user ${email}:`, err);
          skippedCount++;
          skippedEmails.push(email);
        }
      }

      res.status(200).json({
        message: 'Import process completed.',
        summary: {
          totalProcessed: usersToImport.length,
          importedCount,
          skippedCount,
          skippedEmails
        }
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Import Users Error', 'An internal server error occurred during user import.');
    }
  }
}
