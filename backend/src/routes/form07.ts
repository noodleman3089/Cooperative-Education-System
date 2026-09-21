import { Router } from 'express';
import { Form07Controller } from '../controllers/form07';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * สหกิจ 07 หน้า 1–2 — สถานประกอบการเป็นผู้กรอก
 *
 * ⛔ **ไม่มีด่านปฏิทิน** โดยตั้งใจ — กำหนด "ภายในสัปดาห์แรกของการปฏิบัติงาน" นับจาก
 *    วันเริ่มงานของนักศึกษา ไม่ใช่ช่วงเวลากลางของปฏิทินสหกิจ · และการปิดประตูใส่
 *    บริษัทที่ส่งช้า แปลว่าอาจารย์นิเทศจะไม่มีวันรู้ว่าใครเป็นพี่เลี้ยงเลย
 *    ซึ่งแย่กว่าได้ข้อมูลช้าไปสองวัน
 */
router.use(authenticateToken);
router.use(authorizeRoles('company'));

// GET /api/form07 — ข้อมูลบริษัท + พนักงานที่ปรึกษา + นักศึกษาที่ตอบรับไว้
router.get('/', Form07Controller.getForm);

// GET /api/form07/print — PDF หน้า 1–2 ของบริษัทตัวเอง (ปุ่ม "พิมพ์ใบ 07" ใน Form07Company)
router.get('/print', Form07Controller.printForm);

// PUT /api/form07 — บันทึกทั้งใบในทรานแซกชันเดียว (บริษัท · พี่เลี้ยง · งานที่มอบหมาย)
router.put('/', Form07Controller.updateForm);

export default router;
