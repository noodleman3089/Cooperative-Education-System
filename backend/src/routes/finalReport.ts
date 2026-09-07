import { Router } from 'express';
import { FinalReportController } from '../controllers/finalReport.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { uploadFinalReport } from '../middlewares/multer';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

// Student routes
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  // ต้องอยู่ *ก่อน* multer — ดูเหตุผลเดียวกันที่ routes/reportOutline.ts
  requireCalendarWindow('final_report'),
  uploadFinalReport.single('report'),
  FinalReportController.submitReport
);

router.get(
  '/my-report',
  authenticateToken,
  authorizeRoles('student'),
  FinalReportController.getMyReport
);

// Review & administration routes
router.get(
  '/student/:studentId',
  authenticateToken,
  authorizeRoles('advisor', 'staff', 'dept_head'),
  FinalReportController.getStudentReports
);

// ⛔ TODO(2026-09-07): รอเจ้าของยืนยันว่าจะจำกัดสิทธิ์เหลือเฉพาะ 'advisor' หรือคงเดิมไว้
// ตอนนี้ยังคง 'advisor', 'staff', 'dept_head' ไว้ตามเดิมเพื่อไม่ให้กระทบการทำงานจริง
router.patch(
  '/:id/status',
  authenticateToken,
  authorizeRoles('advisor', 'staff', 'dept_head'),
  FinalReportController.reviewReport
);

// พี่เลี้ยงตรวจร่างรายงานฉบับสมบูรณ์ (ขั้นที่ 1)
router.patch(
  '/:id/mentor-review',
  authenticateToken,
  authorizeRoles('mentor'),
  FinalReportController.mentorReview
);

router.post(
  '/notify-mentor/:studentId',
  authenticateToken,
  authorizeRoles('advisor', 'staff', 'dept_head'),
  FinalReportController.notifyMentor
);

export default router;
