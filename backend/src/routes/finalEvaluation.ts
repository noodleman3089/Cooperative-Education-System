import { Router } from 'express';
import { FinalEvaluationController } from '../controllers/finalEvaluation.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// บันทึกแบบประเมิน (พี่เลี้ยงเท่านั้น — ทั้ง สหกิจ 15 และ 16 เป็นของพี่เลี้ยง)
router.post(
  '/',
  authenticateToken,
  authorizeRoles('mentor'),
  FinalEvaluationController.submitEvaluation
);

// รายชื่อนักศึกษาบนหน้าจอประเมิน (พี่เลี้ยง)
router.get(
  '/my-students',
  authenticateToken,
  authorizeRoles('mentor'),
  FinalEvaluationController.getMyStudents
);

// ผลประเมินของนักศึกษาเอง — ไม่มี :studentId โดยตั้งใจ อ่าน id จาก token เท่านั้น
// เปิดเผยเฉพาะเมื่อพ้นช่วงปฏิบัติงานแล้ว (ตัวคุมอยู่ใน controller ไม่ใช่ที่นี่
// เพราะข้อความปฏิเสธต้องบอกวันที่ที่จะเปิดให้ดู)
router.get(
  '/my-result',
  authenticateToken,
  authorizeRoles('student'),
  FinalEvaluationController.getMyResult
);

export default router;
