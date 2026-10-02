import crypto from 'crypto';
import { PoolClient } from 'pg';
import { query } from '../config/database';

/**
 * ลิงก์ตอบแบบเสนองานสหกิจ (สหกิจ 02) ทางอีเมล
 *
 * ของจริงคนที่ตอบแบบสำรวจคือฝ่ายบุคคล ซึ่งมักไม่มีบัญชีในระบบและไม่อยากมี —
 * เขาได้อีเมลจากคณะแล้วอยากตอบให้จบในนั้น การบังคับให้สมัครบัญชีก่อนตอบ
 * คือเหตุผลที่แบบสำรวจกระดาษยังชนะแบบออนไลน์อยู่ทุกวันนี้
 *
 * ⛔ **token นี้เปิดได้หน้าเดียวคือแบบเสนองาน ซึ่งไม่มีข้อมูลนักศึกษาอยู่เลย**
 *    ทุกหน้าที่มีข้อมูลนักศึกษา (ใบสมัคร สหกิจ 03 · แบบประเมิน 15/16 ·
 *    บันทึกการปฏิบัติงาน) ต้องล็อกอินเต็มเสมอ ห้ามเปิดด้วย token เด็ดขาด
 * ⛔ **ไม่สร้าง session และไม่ให้สิทธิ์อะไรนอกจากใบสำรวจใบเดียวที่ผูกไว้**
 *
 * TTL สั้นกว่าลิงก์เชิญ (48 ชม.) โดยตั้งใจ — ลิงก์เชิญพาไปหน้าตั้งรหัสผ่านซึ่ง
 * เจ้าตัวต้องตั้งเอง แต่ลิงก์นี้ **เขียนคำตอบลงฐานได้ทันทีโดยไม่มีการยืนยันตัวตนใด ๆ**
 * อีเมลของฝ่ายบุคคลมักเป็นกล่องรวม (hr@, contact@) ที่มีคนเข้าถึงหลายคน
 * ช่วงเวลาที่ลิงก์ยังมีชีวิตอยู่จึงต้องสั้นที่สุดเท่าที่ยังใช้งานได้จริง
 */
export const JOB_OFFER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** ใช้ในเนื้ออีเมลและข้อความบนหน้าจอ — ประกาศที่เดียว */
export const JOB_OFFER_TOKEN_TTL_LABEL = '24 ชั่วโมง';

/** ขอลิงก์ใหม่ได้ทุกกี่นาที ต่อหนึ่งใบ — กันคนกดรัวจนเมลของบริษัทเต็ม */
export const JOB_OFFER_RESEND_COOLDOWN_MS = 10 * 60 * 1000;

/** หน้าเดียวที่ token นี้เปิดได้ */
export const jobOfferAnswerUrl = (token: string): string =>
  `${process.env.FRONTEND_URL || 'http://localhost:5173'}/offer?token=${encodeURIComponent(token)}`;

export interface IssuedJobOfferToken {
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * ออก token ใหม่ให้ใบสำรวจหนึ่งใบ
 *
 * เก็บเป็นค่าดิบแบบเดียวกับ `users.reset_token` โดยตั้งใจ ให้ทั้งระบบมีแบบแผนเดียว
 * — คนที่อ่านตารางนี้ได้ก็อ่าน `users.reset_token` ได้อยู่แล้ว การ hash เฉพาะที่นี่
 * จึงไม่ได้เพิ่มอะไรนอกจากความไม่สม่ำเสมอ
 *
 * @param client ส่ง client ของทรานแซกชันมาด้วยเมื่อการออก token ต้อง commit
 *               หรือ rollback ไปพร้อมกับสิ่งที่มันผูกอยู่ (เช่นตอนเจ้าหน้าที่ส่งแบบสำรวจเป็นชุด)
 */
export const createJobOfferToken = async (
  offerId: number,
  createdBy?: number | null,
  client?: PoolClient
): Promise<IssuedJobOfferToken> => {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + JOB_OFFER_TOKEN_TTL_MS);

  const sql = `INSERT INTO job_offer_tokens (token, offer_id, expires_at, created_by)
               VALUES ($1, $2, $3, $4)`;
  const params = [token, offerId, expiresAt, createdBy ?? null];

  if (client) {
    await client.query(sql, params);
  } else {
    await query(sql, params);
  }

  return { token, url: jobOfferAnswerUrl(token), expiresAt };
};
