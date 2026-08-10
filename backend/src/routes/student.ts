import { Router } from 'express';
import { StudentController } from '../controllers/student';
import { StaffImportController } from '../controllers/staffImport';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Protect student endpoints with authentication
router.use(authenticateToken);

// Route: GET /api/students/dashboard (Student only)
router.get(
  '/dashboard',
  authorizeRoles('student'),
  StudentController.getStudentDashboard
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

// Route: PUT /api/students/:id/verify-eligibility (Staff & Dept Head only)
router.put(
  '/:id/verify-eligibility',
  authorizeRoles('staff', 'dept_head'),
  StudentController.verifyEligibility
);

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

// Route: POST /api/students/:id/accommodation-plan (Student only)
router.post(
  '/:id/accommodation-plan',
  authorizeRoles('student'),
  StudentController.submitAccommodationAndPlan
);

export default router;
