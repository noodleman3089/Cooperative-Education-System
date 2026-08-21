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

// รายชื่อนักศึกษาบนหน้าจอประเมิน (พี่เลี้ยง: ให้คะแนนได้ · บริษัท: อ่านอย่างเดียว)
router.get(
  '/my-students',
  authenticateToken,
  authorizeRoles('mentor', 'company'),
  FinalEvaluationController.getMyStudents
);

// ออกแบบประเมินที่กรอกแล้วเป็น PDF
// ต้องเป็น /pdf/:formCode/:studentId ไม่ใช่ /:studentId/pdf/... ไม่งั้น segment แรก
// จะเป็น param แล้วไปชนกับ /my-students
// ⛔ ไม่มี `student` โดยตั้งใจ — เอกสารนี้ใส่ซองประทับตรา "ลับ" นักศึกษาต้องเข้าไม่ถึง
router.get(
  '/pdf/:formCode/:studentId',
  authenticateToken,
  authorizeRoles('mentor', 'advisor', 'staff', 'dept_head'),
  FinalEvaluationController.exportEvaluationPdf
);

export default router;
