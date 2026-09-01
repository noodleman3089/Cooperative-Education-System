import { Router } from 'express';
import { StudentMemoController } from '../controllers/studentMemo';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

router.use(authenticateToken);

// รายการหัวข้อ — ทุก role ที่ล็อกอินอ่านได้ ไม่งั้น dropdown ของนักศึกษาว่างเปล่า
router.get('/types', StudentMemoController.getTypes);

// ⛔ `/me` ต้องมาก่อน `/:id/pdf` ไม่ได้ชนกันเพราะคนละรูปแบบ แต่วางเรียงตามการใช้งาน
router.get('/me', authorizeRoles('student'), StudentMemoController.listMine);

router.get(
  '/',
  authorizeRoles('advisor', 'dept_head', 'staff', 'dean'),
  StudentMemoController.listForPersonnel
);

router.post('/', authorizeRoles('student'), StudentMemoController.create);

// ไม่ระบุ role ที่นี่โดยตั้งใจ — นักศึกษาเปิดของตัวเอง ส่วนบุคลากรใช้กติกาของ
// `assertCanAccessStudent` ซึ่งตรวจถึงระดับ "นักศึกษาคนนี้อยู่ในความดูแลไหม"
// (แนวเดียวกับ GET /intents/:id/request-form)
router.get('/:id/pdf', StudentMemoController.getPdf);

export default router;
