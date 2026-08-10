import { Router } from 'express';
import { JobPostController } from '../controllers/job';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Protect all job board endpoints with authentication
router.use(authenticateToken);

// Route: GET /api/jobs (List available jobs for students/staff)
router.get(
  '/',
  JobPostController.getAvailableJobs
);

// Route: POST /api/jobs (Allows staff or company to create job posts)
router.post(
  '/',
  authorizeRoles('staff', 'advisor', 'dean', 'company'),
  JobPostController.createJobPost
);

// Route: PUT /api/jobs/:id/publish (Admin/Staff only)
router.put(
  '/:id/publish',
  authorizeRoles('staff', 'advisor', 'dean'),
  JobPostController.publishJobPost
);

export default router;
