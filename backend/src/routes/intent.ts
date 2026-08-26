import { Router } from 'express';
import { IntentFormController } from '../controllers/intent';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { checkStudentEligibility } from '../middlewares/validation';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

// Protect intent form endpoints with authentication and student role authorization
router.use(authenticateToken);

// Route: GET /api/intents/me (Student only lists own intents)
router.get(
  '/me',
  authorizeRoles('student'),
  IntentFormController.getStudentIntents
);

// Route: GET /api/intents (Advisor, Dept Head, Staff, Dean, Company list intents)
router.get(
  '/',
  authorizeRoles('advisor', 'dept_head', 'staff', 'dean', 'company'),
  IntentFormController.getIntents
);

// Route: GET /api/intents/pipeline-summary (Advisor, Dept Head, Staff, Dean view summary)
router.get(
  '/pipeline-summary',
  authorizeRoles('advisor', 'dept_head', 'staff', 'dean'),
  IntentFormController.getPipelineSummary
);

// Route: GET /api/intents/:id (Student owner, Advisor, Dept Head, Staff, Dean, Company view detail)
router.get(
  '/:id',
  authorizeRoles('student', 'advisor', 'dept_head', 'staff', 'dean', 'company'),
  IntentFormController.getIntentDetail
);

// Route: POST /api/intents (Students submit their intent)
router.post(
  '/',
  authorizeRoles('student'),
  // ปฏิทินมาหลังคุณสมบัติโดยตั้งใจ — "คุณสมบัติไม่ผ่านเกณฑ์" เป็นคำตอบที่ตรงกว่า
  // สำหรับคนที่ยังไม่ผ่านคัดกรอง ต่อให้ตอนนี้จะอยู่ในช่วงเปิดรับพอดีก็ตาม
  checkStudentEligibility,
  requireCalendarWindow('intent_submission'),
  IntentFormController.submitIntent
);

// Route: PATCH /api/intents/:id/status (Advisor status update: approve/reject)
router.patch(
  '/:id/status',
  authorizeRoles('advisor'),
  IntentFormController.updateIntentStatus
);

// Route: PATCH /api/intents/:id/dept-head-status (Dept Head status update: approve/reject)
router.patch(
  '/:id/dept-head-status',
  authorizeRoles('dept_head'),
  IntentFormController.updateIntentStatusByDeptHead
);


export default router;
