import { Router } from 'express';
import { WeeklyLogController } from '../controllers/weeklyLog';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

// POST /api/weekly-logs (Student submits)
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  requireCalendarWindow('weekly_log'),
  WeeklyLogController.submitLog
);

// GET /api/weekly-logs/student/:id (Fetch logs for Mentor/Advisor/Student)
router.get(
  '/student/:id',
  authenticateToken,
  authorizeRoles('student', 'mentor', 'advisor', 'dept_head'),
  WeeklyLogController.getStudentLogs
);

export default router;
