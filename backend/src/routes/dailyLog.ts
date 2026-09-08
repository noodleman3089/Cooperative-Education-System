import { Router } from 'express';
import { DailyLogController } from '../controllers/dailyLog';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

// GET /api/daily-logs/me (นักศึกษาดูของตัวเอง)
router.get('/me', authenticateToken, authorizeRoles('student'), DailyLogController.getMyLogs);

// POST /api/daily-logs (นักศึกษาบันทึกทั้งสัปดาห์ในครั้งเดียว)
// ⛔ ด่านปฏิทินต้องมาก่อนเสมอ · ใช้คีย์ `weekly_log` เดียวกับบันทึกอีกสองชนิด
//    **ห้ามเพิ่มคีย์กิจกรรมใหม่ใน coopCalendar.ts โดยไม่ถามเจ้าของ**
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  requireCalendarWindow('weekly_log'),
  DailyLogController.submitWeek
);

// GET /api/daily-logs/student/:id
router.get(
  '/student/:id',
  authenticateToken,
  authorizeRoles('student', 'mentor', 'advisor', 'dept_head', 'staff'),
  DailyLogController.getStudentLogs
);

// PATCH /api/daily-logs/week/:weekNumber/certify?student=<id>
// ⛔ รับรอง **ทั้งสัปดาห์** ไม่ใช่รายวัน · ฝั่งพี่เลี้ยงไม่มีด่านปฏิทิน รับรองย้อนหลังได้เสมอ
router.patch(
  '/week/:weekNumber/certify',
  authenticateToken,
  authorizeRoles('mentor'),
  DailyLogController.certifyWeek
);

// PATCH /api/daily-logs/week/:weekNumber/return?student=<id> — บังคับเหตุผล
router.patch(
  '/week/:weekNumber/return',
  authenticateToken,
  authorizeRoles('mentor'),
  DailyLogController.returnWeek
);

export default router;
