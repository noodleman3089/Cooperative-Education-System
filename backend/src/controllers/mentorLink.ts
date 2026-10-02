import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { query } from '../config/database';
import { UserModel } from '../models/user';
import { AuditAction, writeAudit } from '../utils/audit';
import { setAuthCookie } from '../utils/authCookie';
import { resolveViews } from '../utils/facultyViews';
import { sendUnexpectedError } from '../utils/httpError';
import { sendMentorLoginLinkEmail } from '../utils/email';
import {
  MENTOR_LINK_TTL_REQUESTED_MS,
  isPureMentor,
  issueMentorLoginLink,
  revokeMentorLoginLink,
  safeTarget,
} from '../utils/mentorLoginLink';

/**
 * พี่เลี้ยงเข้าสู่ระบบด้วยลิงก์ในอีเมล (ขั้นทดลอง) — ไม่มี middleware ยืนยันตัวตน เพราะนี่คือทางเข้า
 *
 * กติกาที่ผิดไม่ได้ในไฟล์นี้:
 *   ⛔ ลิงก์ = session จริง → ตรวจ "พี่เลี้ยงล้วน + ยังไม่ถูกระงับ" (SEC-03) **ซ้ำตอนใช้ลิงก์** ไม่ใช่แค่ตอนออก
 *      บทบาทอาจถูกเพิ่มทีหลังลิงก์ออกไปแล้ว
 *   ⛔ burn ด้วย UPDATE เดียวที่มีเงื่อนไข (0 แถว = มีคำขออื่นชนะก่อน = 410) · ไม่ผ่านด่านสิทธิ์ = ไม่ burn
 *   ⛔ ขอลิงก์ (`request`) ตอบ 200 เหมือนกันทุกกรณีที่ผู้ถามแยกไม่ได้ว่าอีเมลมีจริงหรือไม่ (SEC: ไม่เปิดช่อง enumerate)
 *   ⛔ ปลายทางของเมลมาจากทะเบียนเสมอ — `resend` ไม่รับอีเมลจากคำขอ
 *   ⛔ ไม่มี JWT/token ใน response body (SEC-08) — session อยู่ใน httpOnly cookie เท่านั้น · ไม่ log ตัว token
 */

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUEST_OK_MESSAGE = 'ถ้าอีเมลนี้เป็นพี่เลี้ยงในระบบ จะได้รับลิงก์เข้าสู่ระบบภายในไม่กี่นาที';
const SEND_FAILED_MESSAGE = 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
const INELIGIBLE_MESSAGE = 'บัญชีนี้ไม่สามารถเข้าสู่ระบบด้วยลิงก์นี้ได้';

interface TokenRow {
  token_id: number;
  user_id: number;
  target: string | null;
  used_at: Date | null;
  is_expired: boolean;
  email: string;
}

/** token ไม่ใช่ UUID = ไม่มีทางมีอยู่จริง ไม่ต้องส่งให้ Postgres (ไม่งั้นได้ 22P02) */
const findToken = async (raw: unknown): Promise<TokenRow | null> => {
  if (typeof raw !== 'string' || !UUID_REGEX.test(raw)) return null;
  const found = await query(
    `SELECT t.token_id, t.user_id, t.target, t.used_at, (t.expires_at <= NOW()) AS is_expired, u.email
       FROM mentor_login_tokens t
       JOIN users u ON u.user_id = t.user_id
      WHERE t.token = $1`,
    [raw]
  );
  return (found.rows[0] as TokenRow | undefined) ?? null;
};

export class MentorLinkController {
  /**
   * พี่เลี้ยงกรอกอีเมลขอลิงก์เข้าสู่ระบบ
   * Route: POST /api/auth/mentor-link/request
   * Access: สาธารณะ
   */
  static async request(req: Request, res: Response): Promise<void> {
    try {
      const raw = req.body?.email;
      if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 254) {
        res.status(400).json({ message: 'กรุณากรอกอีเมล' });
        return;
      }

      const user = await UserModel.findByEmail(raw.trim().toLowerCase());
      // ไม่มีบัญชี/ไม่ใช่พี่เลี้ยงล้วน/ถูกระงับ/เพิ่งขอไป → ตอบเหมือนกันหมด
      const issued = user ? await issueMentorLoginLink({ userId: user.user_id, ttlMs: MENTOR_LINK_TTL_REQUESTED_MS }) : null;
      if (!user || !issued || 'cooledDown' in issued) {
        res.status(200).json({ message: REQUEST_OK_MESSAGE });
        return;
      }

      const sent = await sendMentorLoginLinkEmail(user.email, issued.url, { expiresAt: issued.expiresAt, kind: 'requested' });
      if (!sent) {
        await revokeMentorLoginLink(issued.tokenId);
        res.status(502).json({ message: SEND_FAILED_MESSAGE });
        return;
      }

      await writeAudit(
        {
          action: AuditAction.MENTOR_LINK_ISSUED,
          entityType: 'mentor_login_token',
          entityId: issued.tokenId,
          subjectId: user.user_id,
          detail: { token_id: issued.tokenId, ttl: 'requested' },
        },
        req
      );
      res.status(200).json({ message: REQUEST_OK_MESSAGE });
    } catch (error) {
      sendUnexpectedError(res, error, 'Mentor link request error', 'ไม่สามารถส่งลิงก์เข้าสู่ระบบได้');
    }
  }

  /**
   * ใช้ลิงก์เข้าสู่ระบบ — เผา token แล้วออก session
   * Route: POST /api/auth/mentor-link/consume
   * ลำดับ: ไม่รู้จัก 404 → ใช้แล้ว/หมดอายุ 410 (ก่อนตรวจสิทธิ์ เพื่อให้หน้าจอโชว์ปุ่มขอใหม่ได้) → สิทธิ์ 403 → burn (0 แถว 410)
   */
  static async consume(req: Request, res: Response): Promise<void> {
    try {
      const raw = req.body?.token;
      if (typeof raw !== 'string' || !raw) {
        res.status(400).json({ message: 'ลิงก์ไม่ถูกต้อง กรุณาเปิดจากอีเมลที่ได้รับ' });
        return;
      }

      const row = await findToken(raw);
      if (!row) {
        res.status(404).json({ message: 'ไม่พบลิงก์นี้ในระบบ' });
        return;
      }
      if (row.used_at || row.is_expired) {
        res.status(410).json({ message: 'ลิงก์นี้ใช้ไม่ได้แล้ว (ถูกใช้ไปแล้วหรือหมดอายุ)' });
        return;
      }
      if (!(await isPureMentor(row.user_id))) {
        res.status(403).json({ message: INELIGIBLE_MESSAGE });
        return;
      }

      const burned = await query(
        `UPDATE mentor_login_tokens SET used_at = NOW()
          WHERE token_id = $1 AND used_at IS NULL AND expires_at > NOW()
          RETURNING token_id`,
        [row.token_id]
      );
      if ((burned.rowCount ?? 0) === 0) {
        res.status(410).json({ message: 'ลิงก์นี้ใช้ไม่ได้แล้ว (ถูกใช้ไปแล้วหรือหมดอายุ)' });
        return;
      }

      const user = await UserModel.findById(row.user_id);
      if (!user) {
        res.status(403).json({ message: INELIGIBLE_MESSAGE });
        return;
      }

      // session แบบเดียวกับ AuthController.login — JWT อยู่ใน httpOnly cookie เท่านั้น
      const token = jwt.sign({ userId: user.user_id, email: user.email, roles: user.roles }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'],
      });
      setAuthCookie(res, token);

      await writeAudit(
        {
          action: AuditAction.MENTOR_LINK_LOGIN,
          entityType: 'mentor_login_token',
          entityId: row.token_id,
          subjectId: user.user_id,
          detail: { token_id: row.token_id },
        },
        req
      );

      res.status(200).json({
        target: safeTarget(row.target) ?? '/dashboard',
        user: {
          userId: user.user_id,
          email: user.email,
          roles: user.roles,
          views: await resolveViews(user.user_id, user.roles),
        },
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Mentor link consume error', 'ไม่สามารถเข้าสู่ระบบด้วยลิงก์ได้');
    }
  }

  /**
   * ขอลิงก์ใหม่จากลิงก์เดิม (หมดอายุ/ใช้แล้ว/ยังใช้ได้ก็ได้) — ส่งไปอีเมลในทะเบียนของเจ้าของลิงก์เท่านั้น
   * Route: POST /api/auth/mentor-link/resend
   * ⛔ token ที่ไม่มีอยู่จริงต้องปฏิเสธ ไม่งั้นกลายเป็นปุ่มยิงเมลให้ใครก็ได้
   */
  static async resend(req: Request, res: Response): Promise<void> {
    try {
      const raw = req.body?.token;
      if (typeof raw !== 'string' || !raw) {
        res.status(400).json({ message: 'ลิงก์ไม่ถูกต้อง กรุณาเปิดจากอีเมลที่ได้รับ' });
        return;
      }

      const row = await findToken(raw);
      if (!row) {
        res.status(404).json({ message: 'ไม่พบลิงก์นี้ในระบบ' });
        return;
      }

      // ตรวจสิทธิ์ก่อน แล้วค่อยออก — `issueMentorLoginLink` ตรวจซ้ำในตัวเองด้วย (null = ไม่ผ่าน)
      const issued = await issueMentorLoginLink({
        userId: row.user_id,
        target: row.target,
        ttlMs: MENTOR_LINK_TTL_REQUESTED_MS,
      });
      if (!issued) {
        res.status(403).json({ message: INELIGIBLE_MESSAGE });
        return;
      }
      if ('cooledDown' in issued) {
        res.status(429).json({ message: 'ส่งลิงก์ไปเมื่อสักครู่ กรุณารอ 1 นาทีแล้วลองใหม่' });
        return;
      }

      // ปลายทาง = users.email ของเจ้าของลิงก์ (มาจากแถวฐาน ไม่ใช่จากคำขอ)
      const sent = await sendMentorLoginLinkEmail(row.email, issued.url, { expiresAt: issued.expiresAt, kind: 'requested' });
      if (!sent) {
        await revokeMentorLoginLink(issued.tokenId);
        res.status(502).json({ message: SEND_FAILED_MESSAGE });
        return;
      }

      await writeAudit(
        {
          action: AuditAction.MENTOR_LINK_ISSUED,
          entityType: 'mentor_login_token',
          entityId: issued.tokenId,
          subjectId: row.user_id,
          detail: { token_id: issued.tokenId, ttl: 'resend' },
        },
        req
      );
      res.status(200).json({ message: 'ส่งลิงก์ใหม่ไปที่อีเมลในทะเบียนแล้ว' });
    } catch (error) {
      sendUnexpectedError(res, error, 'Mentor link resend error', 'ไม่สามารถส่งลิงก์ใหม่ได้');
    }
  }
}
