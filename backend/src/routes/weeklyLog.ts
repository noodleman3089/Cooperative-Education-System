import { Router } from 'express';
import { WeeklyLogController } from '../controllers/weeklyLog';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { requireCalendarWindow } from '../middlewares/calendarGate';
import { uploadWorkLogAttachment, validateUploadedFile } from '../middlewares/multer';

const router = Router();

// GET /api/weekly-logs/me (Student gets own logs + intent)
router.get(
  '/me',
  authenticateToken,
  authorizeRoles('student'),
  WeeklyLogController.getMyLogs
);

// POST /api/weekly-logs (Student submits or drafts log)
// ⛔ requireCalendarWindow ต้องอยู่ก่อน multer เสมอ (SEC rule / Calendar Gate)
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  requireCalendarWindow('weekly_log', 'student'),
  uploadWorkLogAttachment.single('file'),
  validateUploadedFile(['pdf', 'jpg', 'png', 'doc', 'docx']),
  WeeklyLogController.submitLog
);

// PATCH /api/weekly-logs/:id/certify (Mentor certifies log)
router.patch(
  '/:id/certify',
  authenticateToken,
  authorizeRoles('mentor'),
  WeeklyLogController.certifyLog
);

// PATCH /api/weekly-logs/:id/return (Mentor returns log for revision)
router.patch(
  '/:id/return',
  authenticateToken,
  authorizeRoles('mentor'),
  WeeklyLogController.returnLog
);

// GET /api/weekly-logs/student/:id (Fetch logs for Mentor/Advisor/Student)
router.get(
  '/student/:id',
  authenticateToken,
  authorizeRoles('student', 'mentor', 'advisor', 'dept_head'),
  WeeklyLogController.getStudentLogs
);

export default router;
