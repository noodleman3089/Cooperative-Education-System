import { Router } from 'express';
import { ReportOutlineController } from '../controllers/reportOutline';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { uploadReportOutline } from '../middlewares/multer';

const router = Router();

// POST /api/outlines (Student upload)
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
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
  authorizeRoles('mentor', 'advisor', 'company'),
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

