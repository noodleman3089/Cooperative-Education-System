import { Router } from 'express';
import { ApplicationController } from '../controllers/application.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Student routes
router.post(
  '/',
  authenticateToken,
  authorizeRoles('student'),
  ApplicationController.submitApplication
);

router.get(
  '/me',
  authenticateToken,
  authorizeRoles('student'),
  ApplicationController.getMyApplications
);

// Common route for viewing list (Filtered internally by major/role)
router.get(
  '/',
  authenticateToken,
  authorizeRoles('advisor', 'dept_head', 'dean', 'staff'),
  ApplicationController.getApplications
);

// Advisor evaluation route (Step 1)
router.put(
  '/:id/evaluate',
  authenticateToken,
  authorizeRoles('advisor'),
  ApplicationController.evaluateByAdvisor
);

// Dept Head approval route (Step 2)
router.put(
  '/:id/approve',
  authenticateToken,
  authorizeRoles('dept_head'),
  ApplicationController.approveByDeptHead
);

export default router;
