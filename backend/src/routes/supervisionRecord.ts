import { Router } from 'express';
import { SupervisionRecordController } from '../controllers/supervisionRecord';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

/**
 * สหกิจ 13 — แบบบันทึกการนิเทศงาน · **ระบบล้วน ไม่มีเส้นทางออกเป็นเอกสาร**
 *
 * ⛔ **ไม่มี route สำหรับบริษัทและนักศึกษาโดยตั้งใจ** — ส่วนที่ 1 คือความเห็นของ
 * อาจารย์ต่อ*สถานประกอบการ* ส่วนที่ 2 คือความเห็นต่อ*ตัวนักศึกษา* ทั้งคู่เป็นข้อมูล
 * ภายในของคณะ (ตรรกะเดียวกับที่ผลประเมิน สหกิจ 15 ถูกกั้นไว้)
 */
const router = Router();

router.use(authenticateToken);

// โครงของแบบฟอร์ม (37 หัวข้อ + สเกล) — หน้าจอไม่ประกาศหัวข้อซ้ำ
router.get(
  '/form',
  authorizeRoles('advisor', 'dept_head', 'staff'),
  SupervisionRecordController.getForm
);

// ⚠️ ต้องอยู่หลัง `/form` ไม่งั้น express จับ 'form' เป็น studentId
router.get(
  '/student/:studentId',
  authorizeRoles('advisor', 'dept_head', 'staff'),
  SupervisionRecordController.getByStudent
);

router.put(
  '/student/:studentId',
  authorizeRoles('advisor', 'dept_head'),
  SupervisionRecordController.submit
);

export default router;
