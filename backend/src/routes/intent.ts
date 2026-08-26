import { Router } from 'express';
import { IntentFormController } from '../controllers/intent';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { checkStudentEligibility } from '../middlewares/validation';
import { uploadRequestForm, validateUploadedFile } from '../middlewares/multer';
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

// เอกสารหมายเลข 1 — ลายเซ็นอยู่บนกระดาษ เจ้าหน้าที่เป็นคนเดียวที่กดผ่านในระบบ
// (อาจารย์ที่ปรึกษา/หัวหน้าสาขายังมี PATCH ของตัวเองอยู่ด้านบนสำหรับใบเก่าที่ค้าง
//  อยู่ในเส้นทางเดิม — ใบใหม่จะไม่มีทางไปถึงสถานะ approved_by_advisor อีก)

// Route: POST /api/intents/:id/request-form (นักศึกษาอัปโหลดกระดาษที่ลงนามแล้ว)
router.post(
  '/:id/request-form',
  authorizeRoles('student'),
  uploadRequestForm.single('request_form'),
  validateUploadedFile(['pdf', 'png', 'jpg']),
  IntentFormController.uploadRequestForm
);

// Route: PATCH /api/intents/:id/officer-approve (เจ้าหน้าที่รับคำร้อง)
router.patch(
  '/:id/officer-approve',
  authorizeRoles('staff'),
  IntentFormController.officerApproveRequest
);

// Route: PATCH /api/intents/:id/officer-reject (เจ้าหน้าที่ตีกลับ)
router.patch(
  '/:id/officer-reject',
  authorizeRoles('staff'),
  IntentFormController.officerRejectRequest
);

// Route: GET /api/intents/:id/request-form
// แบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1) — หน้า HTML สำหรับสั่งพิมพ์
// ไม่ระบุ role ที่นี่โดยตั้งใจ: นักศึกษาเปิดของตัวเอง ส่วนบุคลากรใช้กติกาของ
// `assertCanReviewStudentWork` ซึ่งตรวจถึงระดับ "นักศึกษาคนนี้อยู่ในความดูแลไหม"
// การใส่ authorizeRoles เพิ่มตรงนี้จะกลายเป็นด่านที่หลวมกว่าด่านจริงและชวนเข้าใจผิด
router.get('/:id/request-form', IntentFormController.getRequestForm);

export default router;
