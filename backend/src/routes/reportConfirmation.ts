import { Router } from 'express';
import { ReportConfirmationController } from '../controllers/reportConfirmation.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Student routes
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  ReportConfirmationController.requestConfirmation
);

router.get(
  '/me',
  authenticateToken,
  authorizeRoles('student'),
  ReportConfirmationController.getMyConfirmation
);

router.get(
  '/print',
  authenticateToken,
  authorizeRoles('student'),
  ReportConfirmationController.printConfirmation
);

// Advisor certification route
// ⛔ สิทธิ์ advisor เท่านั้นตาม spec-B ข้อ 3.2
router.patch(
  '/:id/certify',
  authenticateToken,
  authorizeRoles('advisor'),
  ReportConfirmationController.certifyConfirmation
);

export default router;
