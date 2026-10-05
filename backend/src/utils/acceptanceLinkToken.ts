import crypto from 'crypto';
import { query } from '../config/database';
import { ACCEPTANCE_WORKING_DAYS, addWorkingDays } from './workingDays';

/**
 * ลิงก์ตอบรับของสถานประกอบการ (เอกสารหมายเลข 2 + สหกิจ 07) — ออกตอนนักศึกษากดส่งหนังสือถึงบริษัท
 *
 * บริษัทไม่มีบัญชี ตอบผ่านลิงก์ในอีเมลอย่างเดียว (เจ้าของตัดสิน 2026-09-29)
 * ⛔ **หน้าลิงก์นี้เห็นการ์ดนักศึกษา**
 * (ชื่อ · รหัส · สาขา · อีเมลมหาวิทยาลัย · Resume) จึงจำกัดด้วย allow-list ใน
 * `controllers/publicAcceptance.ts` และห้ามมีเกรด เลขบัตร ที่อยู่ ข้อมูล SEC-12
 *
 * ⛔ ไม่สร้าง session · token เปิดได้เฉพาะใบเดียวที่ผูกไว้ · ใช้ครั้งเดียว (burn ในทรานแซกชันเดียวกับคำตอบ)
 * ⛔ นักศึกษาส่งใหม่สำเร็จ = ลิงก์เก่าที่ยังไม่ใช้ถูก revoke (ทำหลังส่งสำเร็จเท่านั้น เพื่อให้ส่งล้ม
 *    ไม่ฆ่าลิงก์ที่บริษัทถืออยู่แล้ว)
 */

/** หน้าเดียวที่ token นี้เปิดได้ */
export const acceptanceLinkUrl = (token: string): string =>
  `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept?token=${encodeURIComponent(token)}`;

export interface IssuedAcceptanceLink {
  tokenId: number;
  token: string;
  url: string;
  expiresAt: Date;
  /** วันสุดท้ายที่ใช้ได้ (YYYY-MM-DD เวลาไทย) — ใช้บอกบริษัทในอีเมล */
  lastDay: string;
}

/**
 * ออก token ใหม่ให้ใบหนึ่งใบ — หมดอายุสิ้นวัน (เวลาไทย) ของวันทำการที่ ๑๕ นับจากวันที่ส่ง
 *
 * "วันนี้" มาจาก Postgres เสมอ (กฎเดียวกับ calendarGate) · ไม่แตะความหมายของ `acceptance_due_date`
 * ซึ่งนับจากวันที่คณบดีลงนามและยังใช้ตัดสินธง "ส่งช้า"
 */
export const createAcceptanceLinkToken = async (
  formId: number,
  sentTo: string
): Promise<IssuedAcceptanceLink> => {
  const today = await query(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text AS today`);
  const lastDay = addWorkingDays(today.rows[0].today as string, ACCEPTANCE_WORKING_DAYS);
  const expiresAt = new Date(`${lastDay}T23:59:59.999+07:00`);

  const token = crypto.randomUUID();
  const inserted = await query(
    `INSERT INTO acceptance_link_tokens (token, form_id, sent_to, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING token_id`,
    [token, formId, sentTo, expiresAt]
  );

  return { tokenId: inserted.rows[0].token_id as number, token, url: acceptanceLinkUrl(token), expiresAt, lastDay };
};

/** ส่งเมลล้ม — token ใหม่ที่ยังไม่ถึงมือบริษัทต้องใช้ไม่ได้ */
export const revokeAcceptanceLinkToken = async (tokenId: number): Promise<void> => {
  await query(`UPDATE acceptance_link_tokens SET revoked_at = NOW() WHERE token_id = $1`, [tokenId]);
};

/** ส่งเมลสำเร็จ — ยกเลิกลิงก์เก่าที่ยังไม่ใช้ของใบนี้ทั้งหมด (เหลือแต่ใบล่าสุด) */
export const revokeOtherAcceptanceLinkTokens = async (formId: number, keepTokenId: number): Promise<void> => {
  await query(
    `UPDATE acceptance_link_tokens SET revoked_at = NOW()
      WHERE form_id = $1 AND token_id <> $2 AND used_at IS NULL AND revoked_at IS NULL`,
    [formId, keepTokenId]
  );
};
