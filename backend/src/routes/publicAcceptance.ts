import { Router } from 'express';
import { PublicAcceptanceController, acceptanceTokenGate } from '../controllers/publicAcceptance';
import { uploadEvidence, validateUploadedFile } from '../middlewares/multer';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

/**
 * ⛔ **เส้นทางชุดนี้ไม่มี `authenticateToken` โดยตั้งใจ** — สถานประกอบการไม่มีบัญชี ตอบผ่านลิงก์ใน
 *    อีเมลที่นักศึกษากดส่ง (เจ้าของตัดสิน 2026-09-29) · สิทธิ์ทั้งหมดมาจาก token ในลิงก์
 *    (เส้นสาธารณะชุดเดียวในระบบ — คู่ของมัน `routes/publicJobOffer.ts` ถูกลบ 2026-10-05)
 *
 * ที่ทำให้มันปลอดภัยพอ ไม่ใช่ตัว token เอง แต่คือ **ขอบเขตของสิ่งที่มันเปิดได้**:
 *   · เปิดได้ใบเดียวที่ผูกไว้ · ด่านตรวจ token ก่อนทุก endpoint (และก่อน multer) —
 *     ไม่รู้จัก 404 · ใช้แล้ว/ยกเลิก/หมดอายุ 410 · ใบเลยขั้นรอตอบรับแล้ว 410
 *   · ข้อมูลนักศึกษาที่เห็นเป็น allow-list (ชื่อ · รหัส · สาขา · คณะ · ภาคเรียน · อีเมลมหาวิทยาลัย · Resume)
 *     ไม่มีเกรด เลขบัตร ที่อยู่ ข้อมูล SEC-12 และไม่มีสหกิจ 03
 *   · ใช้ตอบได้ครั้งเดียว (burn ในทรานแซกชันเดียวกับคำตอบ) หมดอายุ ๑๕ วันทำการ และนักศึกษาส่งใหม่ = ลิงก์เก่าถูกยกเลิก
 *   · "ตอบรับ" ไม่ได้เปิดสิทธิ์อะไรทันที — ไปคิวเจ้าหน้าที่ · ข้อมูลบริษัทพักที่ใบ ไม่เขียนทะเบียนบริษัท
 *     · บัญชีพี่เลี้ยงสร้างแบบยังไม่เปิดใช้จนกว่าเจ้าหน้าที่กดรับ
 *   · ไม่สร้าง session ไม่แตะคุกกี้ · ทุกคำตอบลง audit_log พร้อม token_id
 *
 * ⛔ **ห้ามเพิ่มเส้นทางอื่นเข้ามาในไฟล์นี้** ถ้าสิ่งที่จะเพิ่มแตะข้อมูลนักศึกษานอก allow-list ข้างบน
 *    (ใบสมัคร สหกิจ 03 · แบบประเมิน 15/16 · บันทึกการปฏิบัติงาน) — ต้องล็อกอินเต็มเสมอ
 *
 * มี `generalLimiter` ของ `index.ts` คุมจำนวนคำขอต่อ IP อยู่แล้ว
 */

// ด่าน token ต้องอยู่ก่อนทุกอย่างในไฟล์นี้ — โดยเฉพาะก่อน multer ของ /accept
// (คำขอที่ไม่ผ่านต้องไม่เขียนไฟล์ลงดิสก์ · แบบเดียวกับ calendarGate)
router.use(acceptanceTokenGate);

// GET /api/public/acceptance?token=... — ข้อมูลหน้าลิงก์ (ไม่เผา token)
router.get('/', PublicAcceptanceController.getInfo);

// GET /cover-letter · /acceptance-form · /resume — ไฟล์ที่บริษัทเปิดดูในหน้าลิงก์
router.get('/cover-letter', PublicAcceptanceController.getCoverLetter);
router.get('/acceptance-form', PublicAcceptanceController.getAcceptanceForm);
router.get('/resume', PublicAcceptanceController.getResume);

// POST /decline?token=... — ไม่รับ (มีผลทันที เผา token)
router.post('/decline', PublicAcceptanceController.decline);

// POST /accept?token=... — ตอบรับ (multipart) · ปฏิทินเดียวกับทางนักศึกษาอัปโหลดเอง (`acceptance_form`)
// ⛔ ลำดับห้ามสลับ: token (ข้างบน) → ปฏิทิน → multer → ตรวจไฟล์ → controller
router.post(
  '/accept',
  requireCalendarWindow('acceptance_form'),
  uploadEvidence.single('evidence'),
  validateUploadedFile(['pdf', 'png', 'jpg']),
  PublicAcceptanceController.accept
);

export default router;
