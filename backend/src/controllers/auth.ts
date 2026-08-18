import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { UserModel } from '../models/user';
import { StudentModel } from '../models/student';
import { PersonnelModel } from '../models/personnel';
import { comparePassword, hashPassword } from '../utils/password';
import pool, { query } from '../config/database';
import { LoginRequestBody, GoogleLoginRequestBody } from '../types';
import { OAuth2Client } from 'google-auth-library';
import { sendPasswordResetEmail, sendPasswordSetNoticeEmail } from '../utils/email';
import { AuditAction, writeAudit } from '../utils/audit';
import { clearAuthCookie, setAuthCookie } from '../utils/authCookie';
import { sendUnexpectedError } from '../utils/httpError';

const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not configured.');
  process.exit(1);
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/** Roles that may be granted through the personnel staging list. */
export const PERSONNEL_CLAIMABLE_ROLES = ['advisor', 'dean', 'staff', 'dept_head'];

/** Holding any of these means the account is already provisioned and must not self-claim. */
const CLAIM_BLOCKING_ROLES = [...PERSONNEL_CLAIMABLE_ROLES, 'student', 'company', 'mentor'];


export class AuthController {
  /**
   * Google SSO Login endpoint.
   * Receives Google ID Token, verifies email domain, auto-creates user if first-time, and issues JWT.
   * Route: POST /api/auth/google
   */
  static async googleSSO(req: Request<{}, {}, GoogleLoginRequestBody & { email?: string }>, res: Response): Promise<void> {
    try {
      const { token } = req.body;
      let email: string | undefined;

      // 1. Resolve email (from Google ID Token only, or simulated token in dev)
      if (!token) {
        res.status(400).json({ message: 'Google ID Token is required.' });
        return;
      }

      // Fix Task 1.3: Require explicit ALLOW_SIMULATED_SSO flag instead of defaulting on non-production NODE_ENV
      if (process.env.ALLOW_SIMULATED_SSO === 'true' && token.startsWith('simulated_token_for_')) {
        email = token.substring('simulated_token_for_'.length);
      } else {
        const ticket = await googleClient.verifyIdToken({
          idToken: token,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        email = payload?.email;
      }
      if (!email) {
        res.status(400).json({ message: 'Failed to extract email from Google ID Token.' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();

      // 2. Enforce domain constraint from environment config
      const allowedDomain = process.env.ALLOWED_SSO_DOMAIN || 'rmutto.ac.th';
      const isSimulated = process.env.ALLOW_SIMULATED_SSO === 'true' && token.startsWith('simulated_token_for_');
      if (!isSimulated && !cleanEmail.endsWith(`@${allowedDomain}`)) {
        res.status(403).json({ message: `Access denied. You must log in using an @${allowedDomain} account.` });
        return;
      }

      // 3. Query DB to check if user exists, otherwise auto-create (SSO Onboarding)
      let user = await UserModel.findByEmail(cleanEmail);
      let isFirstTime = false;

      if (!user) {
        console.log(`First-time SSO login detected for email: ${cleanEmail}. Auto-creating account...`);
        // password_hash is null for SSO-only accounts
        user = await UserModel.createUser(cleanEmail, null);
        isFirstTime = true;
      } else {
        // If the user exists, check if they have completed their profile setup.
        const hasStudentRole = user.roles.includes('student');
        const hasPersonnelRole = user.roles.some((r: string) =>
          ['advisor', 'dean', 'staff', 'dept_head'].includes(r)
        );

        if (hasStudentRole) {
          const studentProfile = await StudentModel.findByStudentId(user.user_id);
          if (!studentProfile) {
            isFirstTime = true;
          }
        } else if (hasPersonnelRole) {
          if (user.roles.includes('dean')) {
            const personnelProfile = await PersonnelModel.findByPersonnelId(user.user_id);
            if (!personnelProfile) {
              const firstMajor = await query('SELECT major_id FROM master_major LIMIT 1');
              if ((firstMajor.rowCount ?? 0) > 0) {
                const majorId = firstMajor.rows[0].major_id;
                await PersonnelModel.createPersonnel(user.user_id, majorId, null);
                await query("UPDATE personnel SET status = 'approved' WHERE personnel_id = $1", [user.user_id]);
              }
            }
            isFirstTime = false;
          } else {
            const personnelProfile = await PersonnelModel.findByPersonnelId(user.user_id);
            if (!personnelProfile) {
              isFirstTime = true;
            }
          }
        } else {
          // No role pre-assigned means student flow onboarding
          isFirstTime = true;
        }
      }

      if (!user.is_active) {
        res.status(403).json({ message: 'Your account is currently deactivated.' });
        return;
      }

      // 4. Generate system JWT Token containing user_id and roles array
      const tokenPayload = {
        userId: user.user_id,
        email: user.email,
        roles: user.roles, // holds user's multiple roles (array)
      };

      const systemToken = jwt.sign(tokenPayload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN as any,
      });

      setAuthCookie(res, systemToken);

      res.status(200).json({
        message: 'Google login successful.',
        isFirstTime,
        hasPassword: !!user.password_hash,
        user: {
          userId: user.user_id,
          email: user.email,
          roles: user.roles,
        },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Google SSO Error', 'An internal server error occurred during Google SSO authentication.');
    }
  }

  /**
   * Report the current session. The JWT lives in an httpOnly cookie, so this is
   * the only way the frontend can learn whether it is logged in and as whom.
   * Route: GET /api/auth/me
   * Access: authenticated
   */
  static async me(req: Request, res: Response): Promise<void> {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized.' });
      return;
    }

    res.status(200).json({
      user: {
        userId: req.user.userId,
        email: req.user.email,
        roles: req.user.roles,
      },
    });
  }

  /**
   * End the session by dropping the cookie. Public on purpose: logging out an
   * already-expired session must not fail.
   * Route: POST /api/auth/logout
   */
  static async logout(_req: Request, res: Response): Promise<void> {
    clearAuthCookie(res);
    res.status(200).json({ message: 'ออกจากระบบแล้ว' });
  }

  /**
   * Standard Username/Password login endpoint (primarily for companies and administrators).
   * Route: POST /api/auth/login
   */
  static async login(req: Request<{}, {}, LoginRequestBody>, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ message: 'กรุณากรอกอีเมล/เลขประจำตัวนักศึกษา และรหัสผ่าน' });
        return;
      }

      const cleanIdentifier = email.trim();

      // 1. Try finding user by email
      let user = await UserModel.findByEmail(cleanIdentifier);

      // 2. If not found by email, try finding by student code
      if (!user) {
        const studentRes = await query(
          'SELECT student_id FROM students WHERE student_code = $1 LIMIT 1',
          [cleanIdentifier]
        );
        if ((studentRes.rowCount ?? 0) > 0) {
          const studentId = studentRes.rows[0].student_id;
          user = await UserModel.findById(studentId);
        }
      }

      // 3. Handle specific warning for first-time Google SSO users
      if (!user) {
        const isUniversityAccount = 
          cleanIdentifier.toLowerCase().includes('@rmutto.ac.th') || 
          cleanIdentifier.toLowerCase().includes('@test.com') ||
          /^[\d-]+$/.test(cleanIdentifier);

        if (isUniversityAccount) {
          res.status(400).json({ 
            message: 'ไม่พบบัญชีผู้ใช้ กรุณาเข้าสู่ระบบด้วย Google Account เป็นครั้งแรกก่อนเพื่อเปิดใช้งานบัญชี' 
          });
        } else {
          res.status(401).json({ message: 'อีเมล/ชื่อผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง' });
        }
        return;
      }

      if (!user.is_active) {
        res.status(403).json({ message: 'บัญชีผู้ใช้งานของคุณถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
        return;
      }

      // If user is SSO-only (no password hash saved yet)
      // No password yet. Students and personnel get one by signing in with the
      // university Google account; companies and mentors have no such account
      // and are onboarded by an invitation link instead.
      if (!user.password_hash) {
        const isExternalPartner = user.roles.some((r: string) => ['company', 'mentor'].includes(r));
        res.status(400).json({
          message: isExternalPartner
            ? 'บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณากดลิงก์ "ตั้งรหัสผ่านและเข้าใช้งาน" ในอีเมลที่ระบบส่งให้ท่าน หรือกด "ลืมรหัสผ่าน" เพื่อขอลิงก์ใหม่'
            : 'กรุณาเข้าสู่ระบบด้วย Google Account เพื่อตั้งรหัสผ่านสำหรับการใช้งานก่อน'
        });
        return;
      }

      const isPasswordValid = await comparePassword(password, user.password_hash);
      if (!isPasswordValid) {
        res.status(401).json({ message: 'อีเมล/ชื่อผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง' });
        return;
      }

      // Issue JWT containing user_id and roles array
      const tokenPayload = {
        userId: user.user_id,
        email: user.email,
        roles: user.roles,
      };

      const token = jwt.sign(tokenPayload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN as any,
      });

      setAuthCookie(res, token);

      res.status(200).json({
        message: 'Login successful.',
        user: {
          userId: user.user_id,
          email: user.email,
          roles: user.roles,
        },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Login Error', 'An internal server error occurred during login.');
    }
  }

  /**
   * Set password for the first time (after Google SSO login).
   * Route: POST /api/auth/set-password
   * Access: authenticated users who don't have a password yet
   */
  static async setPassword(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { password, confirmPassword, currentPassword } = req.body;

      if (!password || !confirmPassword) {
        res.status(400).json({ message: 'กรุณากรอกรหัสผ่านและยืนยันรหัสผ่าน' });
        return;
      }

      if (password !== confirmPassword) {
        res.status(400).json({ message: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน' });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({ message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
        return;
      }

      const user = await UserModel.findById(req.user.userId);
      if (!user) {
        res.status(404).json({ message: 'ไม่พบบัญชีผู้ใช้' });
        return;
      }

      // Setting the FIRST password (SSO accounts have password_hash = null) needs
      // no proof beyond the session. CHANGING an existing one does: otherwise a
      // stolen token is enough to lock the real owner out permanently.
      if (user.password_hash) {
        if (!currentPassword || typeof currentPassword !== 'string') {
          res.status(400).json({ message: 'กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยันการเปลี่ยนรหัสผ่าน' });
          return;
        }
        const isCurrentValid = await comparePassword(currentPassword, user.password_hash);
        if (!isCurrentValid) {
          res.status(400).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
          return;
        }
      }

      const hashed = await hashPassword(password);
      await UserModel.updatePassword(user.user_id, hashed);

      res.status(200).json({ message: 'ตั้งรหัสผ่านสำเร็จ' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Set Password Error', 'เกิดข้อผิดพลาดในการตั้งรหัสผ่าน');
    }
  }

  /**
   * Request password reset — generates token and sends email.
   * Route: POST /api/auth/forgot-password
   * Access: public
   */
  static async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ message: 'กรุณากรอกอีเมล' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const user = await UserModel.findByEmail(cleanEmail);

      // Always return success to prevent email enumeration
      if (!user || !user.is_active) {
        res.status(200).json({ message: 'หากอีเมลนี้มีอยู่ในระบบ เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้ท่านทางอีเมล' });
        return;
      }

      // Generate token and expiry (1 hour)
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await UserModel.saveResetToken(user.user_id, token, expiresAt);

      const resetLink = `${FRONTEND_URL}/reset-password?token=${token}`;
      await sendPasswordResetEmail(cleanEmail, resetLink);

      res.status(200).json({ message: 'หากอีเมลนี้มีอยู่ในระบบ เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้ท่านทางอีเมล' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Forgot Password Error', 'เกิดข้อผิดพลาดในการร้องขอรีเซ็ตรหัสผ่าน');
    }
  }

  /**
   * Reset password using a valid token.
   * Route: POST /api/auth/reset-password
   * Access: public
   */
  static async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const { token, password, confirmPassword } = req.body;

      if (!token || !password || !confirmPassword) {
        res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
        return;
      }

      if (password !== confirmPassword) {
        res.status(400).json({ message: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน' });
        return;
      }

      if (password.length < 8) {
        res.status(400).json({ message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
        return;
      }

      const user = await UserModel.findByResetToken(token);
      if (!user) {
        res.status(400).json({ message: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง หรือหมดอายุแล้ว กรุณาขอรีเซ็ตใหม่อีกครั้ง' });
        return;
      }

      // No password before means this token was an invitation, not a reset.
      const isFirstActivation = !user.password_hash;

      const hashed = await hashPassword(password);
      await UserModel.updatePassword(user.user_id, hashed);
      await UserModel.clearResetToken(user.user_id);

      writeAudit({
        action: AuditAction.PASSWORD_RESET,
        entityType: 'user',
        entityId: user.user_id,
        subjectId: user.user_id,
        detail: { via: isFirstActivation ? 'invite_token' : 'reset_token' },
      }).catch(() => undefined);

      // Tells the real owner immediately if someone else claimed the link.
      sendPasswordSetNoticeEmail(user.email, isFirstActivation).catch(() => undefined);

      res.status(200).json({
        message: isFirstActivation
          ? 'ตั้งรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านที่ท่านตั้งไว้'
          : 'รีเซ็ตรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่',
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Reset Password Error', 'เกิดข้อผิดพลาดในการรีเซ็ตรหัสผ่าน');
    }
  }

  /**
   * Claim Personnel Profile for first-time SSO login.
   * Route: POST /api/auth/claim-personnel
   * Access: authenticated users who hold no privileged role yet
   *
   * SEC-01: An employee_code alone is NOT proof of identity — codes are short,
   * sequential and printed on public rosters. The claim therefore requires:
   *   1. the caller currently holds no privileged role (no role stacking),
   *   2. the preseed row carries an email and it matches the caller's account,
   *   3. the row is locked FOR UPDATE so two requests cannot claim it concurrently.
   */
  static async claimPersonnelProfile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
      }

      const { employee_code } = req.body;
      if (!employee_code || typeof employee_code !== 'string') {
        res.status(400).json({ message: 'กรุณากรอกรหัสประจำตัวบุคลากร' });
        return;
      }

      // Guard 1: refuse to stack a personnel role onto an account that already has
      // a role. A student must never be able to add 'dean' to their own account.
      const caller = await UserModel.findById(req.user.userId);
      if (!caller) {
        res.status(401).json({ message: 'ไม่พบบัญชีผู้ใช้' });
        return;
      }
      const blockingRoles = caller.roles.filter((r: string) => CLAIM_BLOCKING_ROLES.includes(r));
      if (blockingRoles.length > 0) {
        res.status(403).json({
          message: 'บัญชีนี้มีบทบาทในระบบอยู่แล้ว ไม่สามารถยืนยันสิทธิ์บุคลากรซ้ำได้ กรุณาติดต่อเจ้าหน้าที่',
        });
        return;
      }

      const callerEmail = (caller.email || '').trim().toLowerCase();
      if (!callerEmail) {
        res.status(400).json({ message: 'บัญชีนี้ไม่มีอีเมล ไม่สามารถยืนยันสิทธิ์ได้' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Guard 3: lock the staging row for the whole check-then-act sequence.
        const preseedResult = await client.query(
          'SELECT * FROM personnel_preseed_list WHERE employee_code = $1 FOR UPDATE',
          [employee_code.trim()]
        );

        if ((preseedResult.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          res.status(404).json({ message: 'ไม่พบรหัสประจำตัวบุคลากรนี้ในระบบ' });
          return;
        }

        const row = preseedResult.rows[0];

        if (row.is_claimed) {
          await client.query('ROLLBACK');
          res.status(400).json({ message: 'รหัสประจำตัวบุคลากรนี้ถูกยืนยันสิทธิ์ไปแล้ว' });
          return;
        }

        // Guard 2: the code must be pre-bound to this exact account.
        const preseedEmail = (row.email || '').trim().toLowerCase();
        if (!preseedEmail) {
          await client.query('ROLLBACK');
          res.status(403).json({
            message: 'รหัสประจำตัวบุคลากรนี้ยังไม่ได้ผูกกับอีเมล กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษาเพื่อระบุอีเมลก่อนยืนยันสิทธิ์',
          });
          return;
        }
        if (preseedEmail !== callerEmail) {
          console.warn(
            `[SEC-01] Rejected personnel claim: user ${req.user.userId} (${callerEmail}) attempted to claim employee_code ${row.employee_code} bound to ${preseedEmail}.`
          );
          await client.query('ROLLBACK');
          writeAudit(
            {
              action: AuditAction.PERSONNEL_CLAIM_REJECTED,
              entityType: 'personnel_preseed_list',
              entityId: row.employee_code,
              detail: { reason: 'email_mismatch', attempted_role: row.role_name },
            },
            req
          ).catch(() => undefined);
          res.status(403).json({
            message: 'รหัสประจำตัวบุคลากรนี้ไม่ได้ผูกกับบัญชีอีเมลที่ท่านใช้เข้าสู่ระบบ',
          });
          return;
        }

        // Defence in depth: never trust role_name straight out of the staging table.
        if (!PERSONNEL_CLAIMABLE_ROLES.includes(row.role_name)) {
          await client.query('ROLLBACK');
          res.status(400).json({ message: 'บทบาทที่บันทึกไว้ไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่' });
          return;
        }

        await client.query(
          `UPDATE personnel_preseed_list
           SET is_claimed = TRUE, claimed_by = $2, claimed_at = CURRENT_TIMESTAMP
           WHERE employee_code = $1`,
          [row.employee_code, req.user.userId]
        );

        // Add Role
        await client.query(
          'INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.user.userId, row.role_name]
        );

        // Create Personnel Profile
        // Note: we can use direct query here to set all fields at once
        await client.query(
          `INSERT INTO personnel (personnel_id, major_id, status, first_name, last_name)
           VALUES ($1, $2, 'approved', $3, $4)
           ON CONFLICT (personnel_id) DO UPDATE SET
             major_id = EXCLUDED.major_id,
             status = 'approved',
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name`,
          [req.user.userId, row.major_id, row.first_name, row.last_name]
        );

        // Inside the transaction: if the claim rolls back, so does its record.
        await writeAudit(
          {
            action: AuditAction.PERSONNEL_CLAIMED,
            entityType: 'personnel_preseed_list',
            entityId: row.employee_code,
            subjectId: req.user.userId,
            detail: { role_granted: row.role_name, major_id: row.major_id },
          },
          req,
          client
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Fetch updated user to generate new token
      const user = await UserModel.findById(req.user.userId);
      if (!user) throw new Error('User not found after claim');

      const tokenPayload = {
        userId: user.user_id,
        email: user.email,
        roles: user.roles,
      };

      // The claim granted a new role, so the session must be re-issued with it.
      const newToken = jwt.sign(tokenPayload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN as any,
      });

      setAuthCookie(res, newToken);

      res.status(200).json({
        message: 'ยืนยันตัวตนสำเร็จ',
        user: tokenPayload,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Claim Personnel Error', 'เกิดข้อผิดพลาดในการยืนยันตัวตนบุคลากร');
    }
  }
}
