import { Router } from 'express';
import { FinalReportController } from '../controllers/finalReport.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { uploadFinalReport } from '../middlewares/multer';

const router = Router();

// Student routes
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  uploadFinalReport.single('report'),
  FinalReportController.submitReport
);

router.get(
  '/my-report',
  authenticateToken,
  authorizeRoles('student'),
  FinalReportController.getMyReport
);

// Review & administration routes
router.get(
  '/student/:studentId',
  authenticateToken,
  authorizeRoles('advisor', 'staff', 'dept_head'),
  FinalReportController.getStudentReports
);

router.patch(
  '/:id/status',
  authenticateToken,
  authorizeRoles('advisor', 'staff', 'dept_head'),
  FinalReportController.reviewReport
);

router.post(
  '/notify-mentor/:studentId',
  authenticateToken,
  authorizeRoles('advisor', 'staff', 'dept_head'),
  FinalReportController.notifyMentor
);

export default router;
