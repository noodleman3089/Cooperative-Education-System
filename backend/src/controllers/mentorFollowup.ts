import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { MentorFollowupModel } from '../models/mentorFollowup';
import { AccessDeniedError, sendAccessError } from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendMentorLoginLinkEmail, sendMentorReminderEmail } from '../utils/email';
import { sendUnexpectedError } from '../utils/httpError';
import {
  AUTO_REMIND_AFTER_DAYS,
  AUTO_REMIND_EVERY_DAYS,
  AUTO_REMIND_MAX,
  isAutoRemindEnabled,
} from '../utils/mentorAutoRemind';
import {
  MENTOR_LINK_TTL_SYSTEM_MS,
  hasOnlyMentorRole,
  isPureMentor,
  issueMentorLoginLink,
  revokeMentorLoginLink,
} from '../utils/mentorLoginLink';
import { recordStageEvent } from '../utils/stageEvents';

/**
 * คณะตามพี่เลี้ยง (Phase 2) — เห็นว่าพี่เลี้ยงคนไหนมีงานค้าง เตือนได้ และเจ้าหน้าที่แก้อีเมลได้
 *
 * ขอบเขตการมองเห็น (SEC-06 fail closed): staff ทั้งหมด · dept_head เฉพาะสาขาตัวเอง · advisor เฉพาะพี่เลี้ยงของนักศึกษาที่ดูแล
 * ⛔ ยืนยันพี่เลี้ยง = อาจารย์นิเทศของนักศึกษาเท่านั้น (เจ้าหน้าที่ยืนยันไม่ได้) · แก้อีเมล/ส่งลิงก์เปล่า = เจ้าหน้าที่เท่านั้น (route + ตรวจซ้ำที่นี่)
 * ⛔ ปลายทางของเมลมาจากทะเบียน (`users.email`) เสมอ ไม่รับจากคำขอ ยกเว้น PUT /email ที่เป็นตัวแก้ทะเบียนเอง
 * ⛔ ทุก endpoint ไม่ส่งข้อมูลส่วนตัวของพี่เลี้ยงเกินที่ระบุ (ไม่มีเบอร์โทร)
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEND_FAILED_MESSAGE = 'ส่งอีเมลไม่สำเร็จ';
const NOT_PURE_MENTOR_MESSAGE = 'บัญชีนี้ไม่ใช่บัญชีพี่เลี้ยง หรือถูกระงับอยู่';

/** `:mentorId` ต้องเป็นเลขจำนวนเต็มล้วน — `parseInt('12abc')` จะผ่านเงียบ ๆ ถ้าไม่ตรวจ */
const parseMentorId = (raw: string): number | null => (/^\d+$/.test(raw) ? parseInt(raw, 10) : null);

export class MentorFollowupController {
  /**
   * รายการพี่เลี้ยงพร้อมงานค้าง
   * Route: GET /api/mentor-followup
   */
  static async list(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const scope = await MentorFollowupModel.resolveScope(req.user.userId, req.user.roles);
      const mentors = await MentorFollowupModel.list(
        scope,
        req.user.roles.includes('advisor') ? req.user.userId : null
      );
      res.status(200).json({
        // แก้อีเมล · ส่งลิงก์เปล่า = เจ้าหน้าที่ · ยืนยันพี่เลี้ยงดูที่ `can_confirm` ของแต่ละแถว (อาจารย์นิเทศเท่านั้น)
        can_edit: req.user.roles.includes('staff'),
        mentors,
        // ใบที่ตอบรับแล้วแต่นักศึกษายังไม่ระบุพี่เลี้ยง (ขอบเขตเดียวกับ `mentors`)
        unassigned: await MentorFollowupModel.unassignedInScope(scope),
        // เฟส 3: ให้หน้าจอรู้ว่าระบบเตือนเองอยู่หรือไม่ + กติกา (ค่าเดียวกับที่ตัวเตือนใช้จริง)
        auto_remind: {
          enabled: isAutoRemindEnabled(),
          after_days: AUTO_REMIND_AFTER_DAYS,
          every_days: AUTO_REMIND_EVERY_DAYS,
          max: AUTO_REMIND_MAX,
        },
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Mentor followup list error', 'ไม่สามารถโหลดรายการพี่เลี้ยงได้');
    }
  }

  /**
   * เตือนพี่เลี้ยง — อีเมลสรุปงานค้างฉบับเดียว + ลิงก์เข้าสู่ระบบใช้ครั้งเดียว
   * Route: POST /api/mentor-followup/:mentorId/remind
   */
  static async remind(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const mentorId = parseMentorId(req.params.mentorId);
      if (mentorId === null) {
        res.status(400).json({ message: 'Invalid mentor ID.' });
        return;
      }

      // ต้องมีนักศึกษาในขอบเขตอย่างน้อยหนึ่งคน ไม่งั้นเตือนพี่เลี้ยงของคนอื่นได้ (SEC-06)
      const scope = await MentorFollowupModel.resolveScope(req.user.userId, req.user.roles);
      if ((await MentorFollowupModel.placementsInScope(scope, mentorId)).length === 0) {
        res.status(403).json({ message: 'พี่เลี้ยงคนนี้ไม่ได้อยู่ในความดูแลของท่าน' });
        return;
      }

      if (!(await isPureMentor(mentorId))) {
        res.status(403).json({ message: NOT_PURE_MENTOR_MESSAGE });
        return;
      }

      if (await MentorFollowupModel.remindedWithin24h(mentorId)) {
        res.status(429).json({ message: 'เตือนพี่เลี้ยงคนนี้ไปแล้วภายใน 24 ชั่วโมง' });
        return;
      }

      const summary = await MentorFollowupModel.fullSummary(mentorId);
      if (summary.items.length === 0 && summary.evalMissingStudents === 0) {
        res.status(400).json({ message: 'พี่เลี้ยงคนนี้ไม่มีงานค้าง' });
        return;
      }

      // จองสิทธิ์ก่อนส่ง (INSERT เงื่อนไข cooldown ในคำสั่งเดียว) แล้วคืนสิทธิ์ถ้าส่งไม่สำเร็จ
      // — ดีกว่า "ส่งเสร็จค่อยบันทึก" ที่สองคำขอซ้อนกันส่งเมลซ้ำได้
      const claim = await MentorFollowupModel.claimReminder(mentorId, req.user.userId);
      if (!claim) {
        res.status(429).json({ message: 'เตือนพี่เลี้ยงคนนี้ไปแล้วภายใน 24 ชั่วโมง' });
        return;
      }

      const issued = await issueMentorLoginLink({
        userId: mentorId,
        target: '/dashboard',
        ttlMs: MENTOR_LINK_TTL_SYSTEM_MS,
        skipCooldown: true,
      });
      if (!issued || 'cooledDown' in issued) {
        await MentorFollowupModel.releaseReminder(claim.reminderId);
        res.status(403).json({ message: NOT_PURE_MENTOR_MESSAGE });
        return;
      }

      // ปลายทาง = ทะเบียนเสมอ (users.email / mentors.name)
      const target = await query(
        `SELECT u.email, m.name FROM users u JOIN mentors m ON m.mentor_id = u.user_id WHERE u.user_id = $1`,
        [mentorId]
      );
      const sent =
        (target.rowCount ?? 0) > 0 &&
        (await sendMentorReminderEmail(target.rows[0].email, target.rows[0].name, summary, issued.url, issued.expiresAt));
      if (!sent) {
        await revokeMentorLoginLink(issued.tokenId);
        await MentorFollowupModel.releaseReminder(claim.reminderId);
        res.status(502).json({ message: SEND_FAILED_MESSAGE });
        return;
      }

      await writeAudit(
        {
          action: AuditAction.MENTOR_REMINDER_SENT,
          entityType: 'mentor_reminder',
          entityId: claim.reminderId,
          subjectId: mentorId,
          detail: { mentor_id: mentorId, items: summary.items.length, reminder_id: claim.reminderId },
        },
        req
      );

      const stats = await MentorFollowupModel.reminderStats(mentorId);
      res.status(200).json({
        message: 'ส่งอีเมลเตือนพี่เลี้ยงแล้ว',
        reminder_count: stats.count,
        last_reminded_at: stats.last_at,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Mentor followup remind error', 'ไม่สามารถส่งอีเมลเตือนได้');
    }
  }

  /**
   * อาจารย์นิเทศยืนยันพี่เลี้ยงที่นักศึกษาระบุ — จุดเดียวที่บัญชีพี่เลี้ยงถูกเปิดและลิงก์เข้าระบบฉบับแรกถูกส่ง
   * Route: POST /api/mentor-followup/:mentorId/confirm · อาจารย์นิเทศของนักศึกษาเท่านั้น
   *
   * ⛔ ผู้เรียกต้องเป็น `supervisor_id` ของนักศึกษาเจ้าของใบ `accepted` ที่ระบุพี่เลี้ยงคนนี้อย่างน้อยหนึ่งใบ — ตรวจหลังล็อกใบ
   *    ในทรานแซกชันเดียวกับการยืนยัน · หาใบแบบนั้นไม่ได้ = 403 (SEC-06) · เจ้าหน้าที่ยืนยันไม่ได้ ไม่มีทางสำรอง
   *    (เจ้าของสั่ง 2026-10-10: เจ้าหน้าที่ไม่รู้เรื่องฝั่งพี่เลี้ยง · อาจารย์นิเทศคือคนที่ติดต่อสถานประกอบการจริง)
   * ⛔ ก้อนนี้ย้ายมาจาก `AcceptanceController.approveByOfficer` (เดิมเปิดบัญชีตอนกดรับแบบตอบรับ) — ด่าน SEC-03/15 ต้องอยู่ครบ:
   *    ล็อกแถวบัญชี · ปฏิเสธเมื่อมีบทบาทอื่นหรือไม่มีแถว `mentors` · ไม่ตั้งรหัสผ่าน · อีเมลออกหลัง COMMIT เท่านั้น
   * ⛔ ด่านอยู่ระดับบัญชี ไม่ใช่ระดับใบ — บัญชีที่เปิดอยู่แล้ว = 409 (ไม่มีอะไรต้องยืนยัน · ต้องการส่งลิงก์ใช้ send-link)
   *    ต้องมีใบ `accepted` ที่ระบุพี่เลี้ยงคนนี้อย่างน้อยหนึ่งใบ ไม่งั้นเป็นทางเปิดบัญชีพี่เลี้ยงที่ไม่มีนักศึกษา
   */
  static async confirm(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      if (!req.user.roles.includes('advisor')) {
        throw new AccessDeniedError('Forbidden. You do not have access to this resource.');
      }
      const mentorId = parseMentorId(req.params.mentorId);
      if (mentorId === null) {
        res.status(400).json({ message: 'Invalid mentor ID.' });
        return;
      }

      await client.query('BEGIN');

      // ล็อกใบก่อนบัญชี — `setMentorWithTransaction` ล็อกใบเดียวกันก่อนอ่าน `is_active`
      // นักศึกษาจึงเปลี่ยนพี่เลี้ยงสวนกับการยืนยันไม่ได้
      const forms = await client.query(
        `SELECT i.form_id, s.supervisor_id
           FROM intent_forms i
           JOIN students s ON s.student_id = i.student_id
          WHERE i.mentor_id = $1 AND i.status = 'accepted'
          ORDER BY i.form_id FOR UPDATE OF i`,
        [mentorId]
      );
      // SEC-06: ไม่มีใบที่ผู้เรียกเป็นอาจารย์นิเทศ = ปฏิเสธ (รวมกรณีไม่มีใบเลย — ไม่บอกว่าพี่เลี้ยงคนนี้มีอยู่หรือไม่)
      const me = req.user.userId;
      const supervised = forms.rows.some((r: { supervisor_id: number | null }) => r.supervisor_id === me);
      if (!supervised) {
        await client.query('ROLLBACK');
        res.status(403).json({
          message:
            'ยืนยันพี่เลี้ยงได้เฉพาะอาจารย์นิเทศของนักศึกษาที่ระบุพี่เลี้ยงคนนี้ — หากนักศึกษาเพิ่งเปลี่ยนพี่เลี้ยง กรุณาโหลดหน้าใหม่',
        });
        return;
      }
      const formIds: number[] = forms.rows.map((r: { form_id: number }) => Number(r.form_id));

      const found = await client.query(
        `SELECT u.email, u.is_active,
                EXISTS (SELECT 1 FROM mentors m WHERE m.mentor_id = u.user_id) AS has_mentor_profile,
                ARRAY(SELECT r.role_name FROM user_roles r WHERE r.user_id = u.user_id) AS roles
           FROM users u WHERE u.user_id = $1 FOR UPDATE OF u`,
        [mentorId]
      );
      const row = found.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'ไม่พบบัญชีนี้' });
        return;
      }

      // SEC-03: การยืนยันเปิดใช้บัญชีและส่งลิงก์ที่ออก session ได้ — ใช้ได้กับบัญชีที่มีไว้เป็นพี่เลี้ยงอย่างเดียวเท่านั้น
      // ไม่งั้นอีเมลของเจ้าหน้าที่/อาจารย์/นักศึกษาที่ถูกระบุเป็นพี่เลี้ยงจะถูกเปิดทางเข้าให้
      const roles = row.roles as string[];
      if (roles.some((r) => r !== 'mentor') || row.has_mentor_profile !== true) {
        await client.query('ROLLBACK');
        res.status(403).json({ message: 'บัญชีนี้ไม่ใช่บัญชีพี่เลี้ยงโดยเฉพาะ จึงยืนยันและส่งลิงก์เข้าสู่ระบบให้ไม่ได้ กรุณาตรวจสอบข้อมูลพี่เลี้ยง' });
        return;
      }
      if (row.is_active === true) {
        await client.query('ROLLBACK');
        res.status(409).json({
          message: 'บัญชีพี่เลี้ยงคนนี้เปิดใช้งานอยู่แล้ว ไม่มีอะไรต้องยืนยัน — หากต้องการส่งลิงก์เข้าระบบอีกครั้ง กรุณาแจ้งเจ้าหน้าที่สหกิจศึกษา',
        });
        return;
      }

      // Heal records created before the mentor role was consistently written.
      if (!roles.includes('mentor')) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'mentor') ON CONFLICT DO NOTHING`,
          [mentorId]
        );
      }

      // No password is ever set (SEC-15): the mentor enters through a one-time emailed login link.
      // The token row is written on the same client, so a rollback discards it too.
      await client.query(`UPDATE users SET password_hash = NULL, is_active = TRUE WHERE user_id = $1`, [mentorId]);
      const issued = await issueMentorLoginLink(
        { userId: mentorId, ttlMs: MENTOR_LINK_TTL_SYSTEM_MS, skipCooldown: true },
        client
      );
      // ด่าน SEC-03 ข้างบนรับประกันสิทธิ์แล้ว — ได้ null/cooldown ตรงนี้คือบั๊ก ให้ rollback ทั้งหมด
      if (!issued || 'cooledDown' in issued) {
        throw new Error('issueMentorLoginLink refused a mentor that passed the SEC-03 gate');
      }

      for (const formId of formIds) {
        await recordStageEvent(client, formId, 'mentor_confirmed');
      }
      await writeAudit(
        {
          action: AuditAction.MENTOR_CONFIRMED,
          entityType: 'user',
          entityId: mentorId,
          subjectId: mentorId,
          detail: { mentor_id: mentorId, form_ids: formIds, token_id: issued.tokenId },
        },
        req,
        client
      );

      await client.query('COMMIT');

      // ส่งเมลหลัง COMMIT เท่านั้น — ลิงก์ในเมลต้องมีแถวอยู่จริงในฐานตอนพี่เลี้ยงกด
      const sent = await sendMentorLoginLinkEmail(row.email as string, issued.url, {
        expiresAt: issued.expiresAt,
        kind: 'welcome',
      });
      if (!sent) {
        // ลิงก์ที่ไม่เคยถึงมือพี่เลี้ยงต้องไม่ค้างในฐาน · บอกตามจริง ไม่กลืน (บัญชีเปิดแล้ว ยืนยันซ้ำไม่ได้)
        await revokeMentorLoginLink(issued.tokenId);
        res.status(200).json({
          mentor_email_sent: false,
          message: 'ยืนยันพี่เลี้ยงและเปิดใช้งานบัญชีแล้ว แต่ส่งอีเมลลิงก์เข้าสู่ระบบไม่สำเร็จ — กรุณาแจ้งเจ้าหน้าที่สหกิจศึกษาให้ส่งลิงก์เข้าระบบใหม่',
        });
        return;
      }
      res.status(200).json({
        mentor_email_sent: true,
        message: 'ยืนยันพี่เลี้ยงแล้ว ระบบส่งลิงก์เข้าสู่ระบบไปที่อีเมลของพี่เลี้ยง',
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Mentor followup confirm error', 'ไม่สามารถยืนยันพี่เลี้ยงได้');
    } finally {
      client.release();
    }
  }

  /**
   * ส่งลิงก์เข้าสู่ระบบเปล่า ๆ ให้พี่เลี้ยง (เช่น หลังแก้อีเมล) — เจ้าหน้าที่เท่านั้น
   * Route: POST /api/mentor-followup/:mentorId/send-link
   */
  static async sendLink(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      if (!req.user.roles.includes('staff')) {
        throw new AccessDeniedError('Forbidden. You do not have access to this resource.');
      }
      const mentorId = parseMentorId(req.params.mentorId);
      if (mentorId === null) {
        res.status(400).json({ message: 'Invalid mentor ID.' });
        return;
      }

      if (!(await isPureMentor(mentorId))) {
        res.status(403).json({ message: NOT_PURE_MENTOR_MESSAGE });
        return;
      }

      // ไม่ข้าม cooldown 60 วินาที — ปุ่มนี้กดรัวไม่ได้
      const issued = await issueMentorLoginLink({ userId: mentorId, target: '/dashboard', ttlMs: MENTOR_LINK_TTL_SYSTEM_MS });
      if (!issued) {
        res.status(403).json({ message: NOT_PURE_MENTOR_MESSAGE });
        return;
      }
      if ('cooledDown' in issued) {
        res.status(429).json({ message: 'ส่งลิงก์ไปเมื่อสักครู่ กรุณารอ 1 นาทีแล้วลองใหม่' });
        return;
      }

      const target = await query(`SELECT email FROM users WHERE user_id = $1`, [mentorId]);
      const sent =
        (target.rowCount ?? 0) > 0 &&
        (await sendMentorLoginLinkEmail(target.rows[0].email, issued.url, { expiresAt: issued.expiresAt, kind: 'welcome' }));
      if (!sent) {
        await revokeMentorLoginLink(issued.tokenId);
        res.status(502).json({ message: SEND_FAILED_MESSAGE });
        return;
      }

      await writeAudit(
        {
          action: AuditAction.MENTOR_LINK_SENT_BY_STAFF,
          entityType: 'mentor_login_token',
          entityId: issued.tokenId,
          subjectId: mentorId,
          detail: { mentor_id: mentorId, token_id: issued.tokenId },
        },
        req
      );
      res.status(200).json({ message: 'ส่งลิงก์เข้าสู่ระบบไปที่อีเมลของพี่เลี้ยงแล้ว' });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Mentor followup send-link error', 'ไม่สามารถส่งลิงก์เข้าสู่ระบบได้');
    }
  }

  /**
   * แก้อีเมลพี่เลี้ยง — เจ้าหน้าที่เท่านั้น · ลิงก์ที่ยังไม่ใช้ของอีเมลเก่าถูกลบทิ้งทั้งหมด
   * Route: PUT /api/mentor-followup/:mentorId/email
   *
   * ⛔ SEC-03: ใช้ได้กับ "โปรไฟล์พี่เลี้ยงล้วน" เท่านั้น (มีแถว mentors + บทบาทเดียวคือ mentor) — ห้ามเป็นทางเปลี่ยนอีเมล
   *    ของเจ้าหน้าที่/อาจารย์/นักศึกษา ซึ่งเท่ากับยึดบัญชีผ่านลิงก์/รีเซ็ตรหัสผ่านที่ไปที่อีเมลใหม่
   * อีเมลของพี่เลี้ยงอยู่ที่ `users.email` ที่เดียว (`mentors` ไม่มีคอลัมน์อีเมล) — `companies.email` และ
   * `intent_forms.company_mail_to` เป็นอีเมลของสถานประกอบการ ไม่ใช่ของพี่เลี้ยง จึงไม่แตะ
   * ไม่ส่งลิงก์ให้อัตโนมัติ — เจ้าหน้าที่กด send-link ต่อเอง
   */
  static async updateEmail(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      if (!req.user.roles.includes('staff')) {
        throw new AccessDeniedError('Forbidden. You do not have access to this resource.');
      }
      const mentorId = parseMentorId(req.params.mentorId);
      if (mentorId === null) {
        res.status(400).json({ message: 'Invalid mentor ID.' });
        return;
      }

      const raw = req.body?.email;
      const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
        res.status(400).json({ message: 'รูปแบบอีเมลไม่ถูกต้อง' });
        return;
      }

      await client.query('BEGIN');

      // ล็อกแถวบัญชี แล้วตรวจ "พี่เลี้ยงล้วน" ในทรานแซกชันเดียวกับการแก้ — บทบาทเปลี่ยนระหว่างทางไม่ได้
      const found = await client.query(
        `SELECT u.email,
                EXISTS (SELECT 1 FROM mentors m WHERE m.mentor_id = u.user_id) AS has_mentor_profile,
                ARRAY(SELECT r.role_name FROM user_roles r WHERE r.user_id = u.user_id) AS roles
           FROM users u WHERE u.user_id = $1 FOR UPDATE OF u`,
        [mentorId]
      );
      const row = found.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'ไม่พบบัญชีนี้' });
        return;
      }
      if (row.has_mentor_profile !== true || !hasOnlyMentorRole(row.roles as string[])) {
        await client.query('ROLLBACK');
        res.status(403).json({ message: 'แก้อีเมลได้เฉพาะบัญชีพี่เลี้ยง' });
        return;
      }

      const before = row.email as string;
      if (before.toLowerCase() === email) {
        await client.query('ROLLBACK');
        res.status(200).json({ email: before });
        return;
      }

      const taken = await client.query(
        `SELECT 1 FROM users WHERE lower(email) = $1 AND user_id <> $2 LIMIT 1`,
        [email, mentorId]
      );
      if ((taken.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ message: 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว' });
        return;
      }

      await client.query(
        `UPDATE users SET email = $1, reset_token = NULL, reset_token_expires = NULL WHERE user_id = $2`,
        [email, mentorId]
      );
      // ลิงก์ที่ส่งไปอีเมลเก่าต้องตายพร้อมกัน ไม่งั้นคนที่ยังเข้าถึงกล่องเก่าได้ใช้เข้าระบบแทนพี่เลี้ยงได้ต่อ
      await client.query(`DELETE FROM mentor_login_tokens WHERE user_id = $1 AND used_at IS NULL`, [mentorId]);

      await writeAudit(
        {
          action: AuditAction.MENTOR_EMAIL_CHANGED,
          entityType: 'user',
          entityId: mentorId,
          subjectId: mentorId,
          detail: { email_before: before, email_after: email },
        },
        req,
        client
      );

      await client.query('COMMIT');
      res.status(200).json({ email });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (sendAccessError(res, error)) return;
      // ชนกับคำขออื่นที่ใช้อีเมลเดียวกันพร้อมกัน (UNIQUE ของ users.email)
      if ((error as { code?: string } | undefined)?.code === '23505') {
        res.status(409).json({ message: 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว' });
        return;
      }
      sendUnexpectedError(res, error, 'Mentor followup update email error', 'ไม่สามารถแก้อีเมลได้');
    } finally {
      client.release();
    }
  }
}
