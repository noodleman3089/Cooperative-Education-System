import { Router } from 'express';
import { FinalEvaluationController } from '../controllers/finalEvaluation.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Submit evaluations (Mentor or Advisor)
router.post(
  '/',
  authenticateToken,
  authorizeRoles('mentor', 'advisor'),
  FinalEvaluationController.submitEvaluation
);

// View assigned students (Mentor only)
router.get(
  '/my-students',
  authenticateToken,
  authorizeRoles('mentor'),
  FinalEvaluationController.getMyStudents
);

// View evaluations for a specific student (Advisor, Dept Head, Staff)
router.get(
  '/student/:studentId',
  authenticateToken,
  authorizeRoles('advisor', 'staff', 'dept_head'),
  FinalEvaluationController.getStudentEvaluation
);

export default router;
