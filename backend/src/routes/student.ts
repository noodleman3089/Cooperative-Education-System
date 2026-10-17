import { Router } from 'express';
import { StudentController } from '../controllers/student';
import { StaffImportController } from '../controllers/staffImport';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

// Protect student endpoints with authentication
router.use(authenticateToken);

// Route: GET /api/students/dashboard (Student only)
router.get(
  '/dashboard',
  authorizeRoles('student'),
  StudentController.getStudentDashboard
);

// Route: GET|PUT /api/students/coop-application (สหกิจ 03 — นักศึกษาของตัวเองเท่านั้น)
// ⛔ ไม่มี `:id` ในเส้นทางโดยตั้งใจ — ใบนี้มีข้อมูลอ่อนไหว (SEC-12) การรับ id
//    จากผู้เรียกคือการเปิดช่อง IDOR ให้ตัวเองโดยไม่จำเป็น ใช้ userId จาก token พอ
// ⚠️ **ต้องมาก่อน `/:id` ทุกเส้น** ไม่งั้น express จับ 'coop-application' เป็น id
router.get(
  '/coop-application',
  authorizeRoles('student'),
  StudentController.getCoopApplication
);
router.put(
  '/coop-application',
  authorizeRoles('student'),
  StudentController.updateCoopApplication
);

// Route: GET /api/students (Staff, Dept Head, Advisor only)
router.get(
  '/',
  authorizeRoles('staff', 'dept_head', 'advisor'),
  StudentController.getStudents
);

// Route: GET /api/students/status-board (Advisor & Dept Head — ทั้งสาขา เรียงตามความสำคัญ)
router.get(
  '/status-board',
  authorizeRoles('advisor', 'dept_head'),
  StudentController.getStatusBoard
);

// Route: POST /api/students/import (Staff & Dept Head only)
router.post(
  '/import',
  authorizeRoles('staff', 'dept_head'),
  StaffImportController.importStudents
);

// ⛔ PUT /:id/verify-eligibility ถูกลบ 2026-09-14 — ระบบไม่ตรวจสิทธิ์สหกิจ (SEC-02 · migration 031)

// Route: PUT /api/students/:id/registry (Staff & Dept Head only)
// Registry fields are no longer student-editable; this is the supported way to
// correct a student_code, major, enrollment year or GPA entered by mistake.
router.put(
  '/:id/registry',
  authorizeRoles('staff', 'dept_head'),
  StudentController.updateRegistryFields
);

// Route: PUT /api/students/:id/assign-advisor (Dept Head & Staff only) - DEPRECATED
router.put(
  '/:id/assign-advisor',
  authorizeRoles('dept_head', 'staff'),
  StudentController.assignAdvisor
);

// Route: PUT /api/students/batch-assign-personnel (Dept Head & Staff only)
router.put(
  '/batch-assign-personnel',
  authorizeRoles('dept_head', 'staff'),
  StudentController.batchAssignPersonnel
);

// Route: GET /api/students/:id/accommodation-plan (Student, Advisor, Dept Head, Staff)
router.get(
  '/:id/accommodation-plan',
  authorizeRoles('student', 'advisor', 'dept_head', 'staff'),
  StudentController.getAccommodationAndPlan
);

// Route: GET /api/students/:id/coop-application (สหกิจ 03 — ผู้ตรวจเปิดดู · ถอดรหัสค่าอ่อนไหว + ลง audit)
// ⛔⛔ **เส้นทางเดียวที่ทำให้ค่าจริงของเลขบัตร/เชื้อชาติ/ศาสนาออกจากฐาน** (SEC-12)
//    ห้ามเพิ่ม role (นักศึกษา/บริษัท/พี่เลี้ยงไม่เข้า) · ด่านจริงอยู่ใน controller (SEC-06)
router.get(
  '/:id/coop-application',
  authorizeRoles('advisor', 'dept_head', 'staff'),
  StudentController.getCoopApplicationForReview
);

// Route: POST /api/students/:id/accommodation-plan (Student only)
router.post(
  '/:id/accommodation-plan',
  authorizeRoles('student'),
  requireCalendarWindow('accommodation_plan', 'student'),
  StudentController.submitAccommodationAndPlan
);

export default router;
