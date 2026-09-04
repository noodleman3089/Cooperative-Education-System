import { Router } from 'express';
import { AcceptanceController } from '../controllers/acceptance';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { uploadEvidence, validateUploadedFile } from '../middlewares/multer';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

// Apply authentication to all endpoints
router.use(authenticateToken);

// Company Acceptance status update (accept/reject)
router.patch(
  '/company/:intent_id/status',
  authorizeRoles('company'),
  AcceptanceController.updateCompanyAcceptanceStatus
);

// Student Manual Acceptance Routes
// นี่คือ "เอกสารหมายเลข 2" บนปฏิทินคณะ ซึ่งเขียนว่า **ภายในวันที่ …** จึงถูกคุม
// ด้วยกิจกรรม `acceptance_form` ที่เป็นชนิด deadline (เปิดตั้งแต่ต้นจนถึงวันนั้น)
// ⛔ ด่านต้องอยู่**ก่อน multer** ไม่งั้นคำขอนอกช่วงจะเขียนไฟล์ลงดิสก์ก่อนถูกปฏิเสธ
router.post(
  '/student/:intent_id/upload-proof',
  authorizeRoles('student'),
  requireCalendarWindow('acceptance_form'),
  uploadEvidence.single('evidence'),
  validateUploadedFile(['pdf', 'png', 'jpg']),
  AcceptanceController.acceptByStudent
);

router.post(
  '/student/:intent_id/fail',
  authorizeRoles('student'),
  AcceptanceController.failByStudent
);

// Officer Acceptance approval/rejection (Staff, Dept Head only)
router.put(
  '/:intent_id/officer-approve',
  authorizeRoles('staff', 'dept_head'),
  AcceptanceController.approveByOfficer
);

export default router;
