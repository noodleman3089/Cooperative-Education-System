import { Router } from 'express';
import { CoopProgressController } from '../controllers/coopProgress.controller';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Progress Dashboard for Personnel
router.get(
  '/dashboard',
  authenticateToken,
  authorizeRoles('advisor', 'staff', 'dept_head'),
  CoopProgressController.getDashboardProgress
);

export default router;
