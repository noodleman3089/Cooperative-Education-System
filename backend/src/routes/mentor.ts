import { Router } from 'express';
import { MentorController } from '../controllers/mentor';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * ฝ่ายพี่เลี้ยง (พนักงานที่ปรึกษา)
 *
 * ⛔ `mentor` เท่านั้น — บัญชีสถานประกอบการกดแทนไม่ได้ พี่เลี้ยงกับฝ่ายบุคคล
 *    เป็นคนละคนตามแบบฟอร์มจริง และคนที่รับรองงานต้องเป็นคนที่นั่งอยู่ข้างนักศึกษา
 * ⛔ **ไม่มีด่านปฏิทิน** — พี่เลี้ยงรับรองย้อนหลังได้เสมอ การปิดประตูใส่เขา
 *    ทำให้นักศึกษาค้างโดยที่ไม่ใช่ความผิดของใครสักคน
 */
router.use(authenticateToken);
router.use(authorizeRoles('mentor'));

// GET /api/mentor/pending — คิว "รอคุณรับรอง" + การ์ดนักศึกษาที่ดูแล
router.get('/pending', MentorController.getPending);

// PATCH /api/mentor/certify-batch — รับรองบันทึกหลายใบพร้อมกัน (เฉพาะบันทึกการปฏิบัติงาน)
router.patch('/certify-batch', MentorController.certifyBatch);

export default router;
