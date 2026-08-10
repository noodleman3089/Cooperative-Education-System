import { Router } from 'express';
import { AcceptanceController } from '../controllers/acceptance';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { uploadEvidence, validateUploadedFile } from '../middlewares/multer';

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
router.post(
  '/student/:intent_id/upload-proof',
  authorizeRoles('student'),
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
