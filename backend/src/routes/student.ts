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
// ⛔⛔ **เส้นทางเดียวที่ทำให้ค่าจริงของเลขบัตร/เชื้อชาติ/ศาสนาออกจากฐาน** (SEC-12)
//    ห้ามเติม `:id` · ห้ามเพิ่ม role · ห้ามให้ role อื่นเรียกแทนนักศึกษา
//    เหตุผลเต็มอยู่ที่ `StudentController.printCoopApplication`
router.get(
  '/coop-application/print',
  authorizeRoles('student'),
  StudentController.printCoopApplication
);

// Route: GET /api/students (Staff, Dept Head, Advisor only)
router.get(
  '/',
  authorizeRoles('staff', 'dept_head', 'advisor'),
  StudentController.getStudents
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

// Route: GET /api/students/:id/accommodation-plan/print (สหกิจ 06 — ปุ่มพิมพ์สำรอง)
// สิทธิ์เท่ากับ GET ของหน้าเดียวกัน · ด่านจริงอยู่ใน controller (SEC-06)
router.get(
  '/:id/accommodation-plan/print',
  authorizeRoles('student', 'advisor', 'dept_head', 'staff'),
  StudentController.printAccommodationForm
);

// Route: POST /api/students/:id/accommodation-plan (Student only)
router.post(
  '/:id/accommodation-plan',
  authorizeRoles('student'),
  requireCalendarWindow('accommodation_plan'),
  StudentController.submitAccommodationAndPlan
);

// Route: GET /api/students/:id/work-plan (พี่เลี้ยงและอาจารย์เปิดดูก่อนลงนาม)
router.get(
  '/:id/work-plan',
  authorizeRoles('mentor', 'advisor', 'staff', 'dean', 'dept_head'),
  StudentController.getWorkPlanForReview
);

// Route: PATCH /api/students/:id/work-plan/approve (Mentor เท่านั้น — สหกิจ 07 หน้า 3 ลงนามแค่นักศึกษา + พี่เลี้ยง)
router.patch(
  '/:id/work-plan/approve',
  authorizeRoles('mentor'),
  StudentController.approveWorkPlan
);

// Route: PATCH /api/students/:id/work-plan/reject (Mentor เท่านั้น)
router.patch(
  '/:id/work-plan/reject',
  authorizeRoles('mentor'),
  StudentController.rejectWorkPlan
);

export default router;
