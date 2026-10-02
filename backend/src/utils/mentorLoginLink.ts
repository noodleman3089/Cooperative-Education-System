import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { query } from '../config/database';

/**
 * ลิงก์เข้าสู่ระบบของพี่เลี้ยง — คนนอกไม่มีรหัสผ่าน เข้าด้วยลิงก์ใช้ครั้งเดียวที่ส่งทางอีเมล (ขั้นทดลอง 2026-10-02)
 *
 * ลิงก์เข้าระบบ = **ออก session จริง** (ต่างจาก `acceptanceLinkToken.ts` ที่ไม่สร้าง session) จึงเข้มกว่า:
 *   ⛔ ออกให้ได้เฉพาะ "บัญชีพี่เลี้ยงล้วน" (SEC-03) = มีแถวใน `mentors` + บทบาทเดียวคือ 'mentor' + ยังไม่ถูกระงับ
 *      เจ้าหน้าที่/อาจารย์/หัวหน้าสาขา/คณบดี/นักศึกษา/บริษัท ต้องไม่ผ่านด่านนี้เด็ดขาด — ตรวจทั้งตอนออกและตอนใช้
 *   ⛔ ใช้ครั้งเดียว (burn ด้วย UPDATE เดียวที่มีเงื่อนไข ที่ controller) · ขอซ้ำถี่ๆ ไม่ได้ (cooldown ใน SQL เดียวกับ INSERT)
 *   ⛔ `target` เป็น path ภายในเท่านั้น (`safeTarget`) — ไม่งั้นลิงก์ในอีเมลกลายเป็นตัว redirect ไปเว็บอื่น
 *   ⛔ ปลายทางของอีเมลมาจากทะเบียน (`users.email`) เสมอ ไม่รับจากคำขอ
 */

/** ลิงก์ที่ระบบส่งให้เองตอนเจ้าหน้าที่กดรับ — พี่เลี้ยงอาจเปิดอ่านเมลช้า */
export const MENTOR_LINK_TTL_SYSTEM_MS = 7 * 24 * 60 * 60 * 1000;
/** ลิงก์ที่พี่เลี้ยงกดขอเอง (หน้าเข้าสู่ระบบ / ขอใหม่จากลิงก์ที่หมดอายุ) — สั้น เพราะอยู่หน้าเครื่องแล้ว */
export const MENTOR_LINK_TTL_REQUESTED_MS = 30 * 60 * 1000;
/** ห่างกันอย่างน้อยกี่วินาทีระหว่างลิงก์สองใบของบัญชีเดียวกัน */
export const MENTOR_LINK_COOLDOWN_SEC = 60;

export const mentorLoginUrl = (token: string): string =>
  `${process.env.FRONTEND_URL || 'http://localhost:5173'}/m?token=${encodeURIComponent(token)}`;

/** หน้าที่พี่เลี้ยงกดขอลิงก์ใหม่เอง — ใช้บอกในอีเมล */
export const mentorLoginPageUrl = (): string =>
  `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login/mentor`;

/**
 * กัน open redirect — รับเฉพาะ path ภายในของเว็บเรา (`/abc?x=1`) นอกนั้นคืน null
 * ปฏิเสธ: `//host` · `\` · ช่องว่าง/อักขระควบคุม · มี `://` ที่ไหนก็ตาม · ยาวเกิน 300
 */
export const safeTarget = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 300) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\') || raw.includes('://')) return null;
  // ช่องว่าง (รวม unicode) + อักขระควบคุม (0x00-0x1f, 0x7f) — เขียนเป็น charCode เพราะ lint ห้าม control char ใน regex
  if (/\s/.test(raw) || [...raw].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  return raw;
};

/**
 * ตัวเดียวที่ตัดสินว่า "บทบาทชุดนี้คือพี่เลี้ยงล้วน" — มี 'mentor' และไม่มีบทบาทอื่นเลย
 * (ท่อนเดียวกับ `hasForeignRole` ใน acceptance.ts approveByOfficer เผื่อวันหน้าเรียกใช้ร่วมกัน)
 */
export const hasOnlyMentorRole = (roles: string[]): boolean =>
  roles.includes('mentor') && roles.every((r) => r === 'mentor');

/** ผู้เรียกในทรานแซกชัน ส่ง client มา — ไม่ส่งก็ใช้ pool */
const run = (sql: string, params: unknown[], client?: PoolClient) =>
  client ? client.query(sql, params) : query(sql, params);

/**
 * บัญชีนี้เข้าสู่ระบบด้วยลิงก์พี่เลี้ยงได้หรือไม่ (SEC-03) — มีโปรไฟล์ mentors + บทบาทพี่เลี้ยงล้วน + is_active
 * ไม่มีบัญชี = false (ไม่โยน)
 */
export const isPureMentor = async (userId: number, client?: PoolClient): Promise<boolean> => {
  const res = await run(
    `SELECT u.is_active,
            EXISTS (SELECT 1 FROM mentors m WHERE m.mentor_id = u.user_id) AS has_mentor_profile,
            ARRAY(SELECT r.role_name FROM user_roles r WHERE r.user_id = u.user_id) AS roles
       FROM users u WHERE u.user_id = $1`,
    [userId],
    client
  );
  const row = res.rows[0];
  if (!row) return false;
  return row.is_active === true && row.has_mentor_profile === true && hasOnlyMentorRole(row.roles as string[]);
};

export interface IssuedMentorLink {
  tokenId: number;
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * ออกลิงก์ใหม่ — คืน `null` = บัญชีไม่เข้าเกณฑ์ · `{ cooledDown: true }` = เพิ่งออกให้ไปเมื่อสักครู่
 *
 * cooldown กับ INSERT เป็นคำสั่งเดียว (`INSERT … SELECT … WHERE NOT EXISTS`) ไม่ใช่ "อ่านแล้วค่อยเขียน"
 * แต่ READ COMMITTED ไม่ serialize สองคำสั่งที่เริ่มพร้อมกันเป๊ะ — ช่องโหว่แคบมากและผลคือได้ลิงก์เพิ่มหนึ่งใบ
 * ของบัญชีเดียวกัน (ไม่ใช่การข้ามด่านสิทธิ์) จึงยอมรับ
 *
 * `skipCooldown` — ใช้ตอนเจ้าหน้าที่กดรับแล้วบัญชีเพิ่งถูกสร้าง/เปิดใช้ (ไม่มีลิงก์เก่าให้ชน)
 */
export const issueMentorLoginLink = async (
  opts: { userId: number; target?: unknown; ttlMs: number; skipCooldown?: boolean },
  client?: PoolClient
): Promise<IssuedMentorLink | { cooledDown: true } | null> => {
  if (!(await isPureMentor(opts.userId, client))) return null;

  const token = crypto.randomUUID();
  // เวลาหมดอายุคำนวณที่ Postgres — ใช้นาฬิกาเดียวกับที่ burn ตรวจ `expires_at > NOW()`
  const inserted = await run(
    `INSERT INTO mentor_login_tokens (token, user_id, target, expires_at)
     SELECT $1::uuid, $2::int, $3::varchar, NOW() + ($4::double precision * INTERVAL '1 millisecond')
      WHERE $6::boolean
         OR NOT EXISTS (
              SELECT 1 FROM mentor_login_tokens t
               WHERE t.user_id = $2::int AND t.created_at > NOW() - ($5::int * INTERVAL '1 second')
            )
     RETURNING token_id, expires_at`,
    [token, opts.userId, safeTarget(opts.target), opts.ttlMs, MENTOR_LINK_COOLDOWN_SEC, opts.skipCooldown === true],
    client
  );
  // ผ่านด่านสิทธิ์มาแล้ว 0 แถวจึงมีสาเหตุเดียวคือ cooldown
  if ((inserted.rowCount ?? 0) === 0) return { cooledDown: true };

  return {
    tokenId: inserted.rows[0].token_id as number,
    token,
    url: mentorLoginUrl(token),
    expiresAt: inserted.rows[0].expires_at as Date,
  };
};

/** ส่งเมลล้ม — ลิงก์ที่ไม่เคยถึงมือพี่เลี้ยงต้องไม่ค้างอยู่ในฐาน */
export const revokeMentorLoginLink = async (tokenId: number): Promise<void> => {
  await query(`DELETE FROM mentor_login_tokens WHERE token_id = $1`, [tokenId]);
};
