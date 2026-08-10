import { Router } from 'express';
import { CoopSemesterController } from '../controllers/semester';

const router = Router();

// Route: GET /api/semesters/active
router.get('/active', CoopSemesterController.getActiveSemester);

export default router;
