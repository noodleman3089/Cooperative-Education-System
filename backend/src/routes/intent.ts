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

// ⛔ ถอดออกเมื่อ 2026-08-27 — **ห้ามเอากลับมา**
//    `PATCH /:id/status` (advisor) และ `PATCH /:id/dept-head-status` (dept_head)
//    คือการอนุมัติของเส้นทางเดิม ซึ่งย้ายไปอยู่บนกระดาษ (แบบคำร้อง เอกสารหมายเลข 1)
//    ตั้งแต่ 2026-08-26 · เจ้าหน้าที่เป็นคนเดียวที่กดผ่านในระบบ ผ่าน `/officer-approve`
//    · สถานะ `approved_by_advisor` / `rejected_by_dept_head` ที่สองเส้นนี้เคยสร้าง
//      จึงไม่มีทางเกิดขึ้นอีก

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

// Route: POST /api/intents/:id/dispatch-letter (เจ้าหน้าที่สั่งออกหนังสือส่งตัว)
// ⛔ ออกได้เมื่อใบอยู่สถานะ `accepted` แล้วเท่านั้น — ด่านอยู่ใน controller
router.post(
  '/:id/dispatch-letter',
  authorizeRoles('staff'),
  IntentFormController.issueDispatchLetter
);

// Route: GET /api/intents/:id/cover-letter/preview (เจ้าหน้าที่ดูตัวอย่างก่อนส่งคิวคณบดี)
router.get(
  '/:id/cover-letter/preview',
  authorizeRoles('staff'),
  IntentFormController.previewCoverLetter
);

// Route: GET /api/intents/:id/request-form
// แบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1) — หน้า HTML สำหรับสั่งพิมพ์
// ไม่ระบุ role ที่นี่โดยตั้งใจ: นักศึกษาเปิดของตัวเอง ส่วนบุคลากรใช้กติกาของ
// `assertCanReviewStudentWork` ซึ่งตรวจถึงระดับ "นักศึกษาคนนี้อยู่ในความดูแลไหม"
// การใส่ authorizeRoles เพิ่มตรงนี้จะกลายเป็นด่านที่หลวมกว่าด่านจริงและชวนเข้าใจผิด
router.get('/:id/request-form', IntentFormController.getRequestForm);

// Route: GET /api/intents/:id/acceptance-form
// เอกสารหมายเลข 2 — แบบยืนยันแบบตอบรับที่สถานประกอบการเป็นผู้กรอก
// ไม่ระบุ role ด้วยเหตุผลเดียวกับ request-form ด้านบน
router.get('/:id/acceptance-form', IntentFormController.getAcceptanceForm);

// Route: PATCH /api/intents/:id/company-log-form (นักศึกษาเปิด/ปิดสวิตช์ใช้แบบฟอร์มของบริษัท)
router.patch(
  '/:id/company-log-form',
  authorizeRoles('student'),
  IntentFormController.updateCompanyLogForm
);

export default router;

