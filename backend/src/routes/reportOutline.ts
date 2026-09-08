import { Router } from 'express';
import { ReportOutlineController } from '../controllers/reportOutline';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { uploadReportOutline } from '../middlewares/multer';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

// POST /api/outlines (Student upload)
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  // ต้องอยู่ *ก่อน* multer — ไม่งั้นคำขอที่อยู่นอกช่วงจะเขียนไฟล์ลงดิสก์ก่อนถูกปฏิเสธ
  // แล้วเหลือไฟล์กำพร้าที่ไม่มีแถวในฐานอ้างถึงทุกครั้ง
  requireCalendarWindow('report_outline'),
  uploadReportOutline.single('outline'),
  ReportOutlineController.uploadOutline
);

// GET /api/outlines/company (Fetch outlines for mentor's company)
router.get(
  '/company',
  authenticateToken,
  authorizeRoles('mentor', 'company'),
  ReportOutlineController.getCompanyOutlines
);

// GET /api/outlines/advisor (Fetch outlines for advisor's students)
router.get(
  '/advisor',
  authenticateToken,
  authorizeRoles('advisor'),
  ReportOutlineController.getAdvisorOutlines
);

// PUT /api/outlines/:id/status (Mentor/Advisor approve/reject)
router.put(
  '/:id/status',
  authenticateToken,
  // ⛔ ตัด 'company' ออกแล้ว (spec-D ข้อ 14.1) — คนที่เห็นชอบหัวข้อรายงานต้องเป็น
  //    **พนักงานที่ปรึกษา** ซึ่งเป็นคนที่รู้ว่าอะไรเป็นความลับของบริษัท ไม่ใช่ฝ่ายบุคคล
  //    · บัญชีสถานประกอบการยังเห็นรายการและสถานะครบผ่าน GET /outlines/company
  authorizeRoles('mentor', 'advisor'),
  ReportOutlineController.updateStatus
);

// GET /api/outlines/student/:id (Fetch versions)
router.get(
  '/student/:id',
  authenticateToken,
  authorizeRoles('student', 'mentor', 'advisor'),
  ReportOutlineController.getVersions
);

export default router;

