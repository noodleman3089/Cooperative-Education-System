import { Router } from 'express';
import { PublicJobOfferController } from '../controllers/publicJobOffer';

const router = Router();

/**
 * ⛔ **เส้นทางชุดนี้ไม่มี `authenticateToken` โดยตั้งใจ** — เป็นหนึ่งในสองชุดในระบบที่
 *    ทำงานได้โดยไม่ต้องเข้าสู่ระบบ (อีกชุดคือ publicAcceptance.ts) สิทธิ์ทั้งหมดมาจาก token ในลิงก์ที่ส่งทางอีเมล
 *
 * ที่ทำให้มันปลอดภัยพอ ไม่ใช่ตัว token เอง แต่คือ **ขอบเขตของสิ่งที่มันเปิดได้**:
 *   · เปิดได้ใบสำรวจใบเดียวที่ผูกไว้ ซึ่งเป็นข้อมูลของบริษัทเองล้วน ๆ
 *   · **ไม่มีข้อมูลนักศึกษาอยู่ในทุก response ของเส้นทางชุดนี้**
 *   · ไม่สร้าง session ไม่แตะคุกกี้ ตอบเสร็จก็จบ
 *   · ใช้ตอบได้ครั้งเดียว อายุ 24 ชั่วโมง และขอใหม่ได้เฉพาะไปที่อีเมลในทะเบียน
 *
 * ⛔ **ห้ามเพิ่มเส้นทางอื่นเข้ามาในไฟล์นี้** ถ้าสิ่งที่จะเพิ่มแตะข้อมูลนักศึกษา
 *    (ใบสมัคร สหกิจ 03 · แบบประเมิน 15/16 · บันทึกการปฏิบัติงาน) — ของพวกนั้น
 *    ต้องล็อกอินเต็มเสมอ ไม่มีข้อยกเว้น
 *
 * มี `generalLimiter` ของ `index.ts` คุมจำนวนคำขอต่อ IP อยู่แล้ว ส่วนการกันไม่ให้
 * ยิงเมลรัวใส่บริษัทคุมด้วย cooldown รายใบใน controller
 */

// GET /api/public/job-offer?token=... — เปิดใบสำรวจ (ไม่เผา token)
router.get('/', PublicJobOfferController.getOffer);

// PUT /api/public/job-offer?token=... — ตอบแล้วส่งกลับ (เผา token)
router.put('/', PublicJobOfferController.submitOffer);

// POST /api/public/job-offer/decline?token=... — ภาคเรียนนี้ยังไม่รับ (เผา token)
router.post('/decline', PublicJobOfferController.declineOffer);

// POST /api/public/job-offer/resend?token=... — ขอลิงก์ใหม่ ส่งไปอีเมลในทะเบียนเท่านั้น
router.post('/resend', PublicJobOfferController.resendLink);

export default router;
