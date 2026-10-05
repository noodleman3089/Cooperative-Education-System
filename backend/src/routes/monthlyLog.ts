import { Router } from 'express';
import { MonthlyLogController } from '../controllers/monthlyLog';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { requireCalendarWindow } from '../middlewares/calendarGate';
import { uploadWorkLogAttachment, validateUploadedFile } from '../middlewares/multer';

const router = Router();

// GET /api/monthly-logs/me (Student gets own logs)
router.get(
  '/me',
  authenticateToken,
  authorizeRoles('student'),
  MonthlyLogController.getMyLogs
);

// POST /api/monthly-logs (Student submits or drafts monthly log)
// ⛔ requireCalendarWindow('weekly_log', 'student') ต้องอยู่ก่อน multer เสมอ (SEC rule / Calendar Gate)
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  requireCalendarWindow('weekly_log', 'student'),
  uploadWorkLogAttachment.single('file'),
  validateUploadedFile(['pdf', 'jpg', 'png', 'doc', 'docx']),
  MonthlyLogController.submitLog
);

// PATCH /api/monthly-logs/:id/certify (Mentor certifies log)
router.patch(
  '/:id/certify',
  authenticateToken,
  authorizeRoles('mentor'),
  MonthlyLogController.certifyLog
);

// PATCH /api/monthly-logs/:id/return (Mentor returns log for revision)
router.patch(
  '/:id/return',
  authenticateToken,
  authorizeRoles('mentor'),
  MonthlyLogController.returnLog
);

// GET /api/monthly-logs/student/:id (Fetch logs for Mentor/Advisor/Student)
router.get(
  '/student/:id',
  authenticateToken,
  authorizeRoles('student', 'mentor', 'advisor', 'dept_head'),
  MonthlyLogController.getStudentLogs
);

export default router;
