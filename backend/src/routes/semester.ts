import { Router } from 'express';
import { CoopSemesterController } from '../controllers/semester';
import { SemesterCohortController } from '../controllers/semesterCohort';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Route: GET /api/semesters/active
router.get('/active', CoopSemesterController.getActiveSemester);

// วงจรภาคเรียน — เจ้าหน้าที่เท่านั้น (เปลี่ยนภาคที่เปิดอยู่ = เปลี่ยนหน้าต่างปฏิทินที่ล็อกนักศึกษาทั้งรุ่น)
router.get('/', authenticateToken, authorizeRoles('staff'), CoopSemesterController.list);
router.post('/', authenticateToken, authorizeRoles('staff'), CoopSemesterController.create);
router.post('/:id/activate', authenticateToken, authorizeRoles('staff'), CoopSemesterController.activate);
router.post('/:id/close', authenticateToken, authorizeRoles('staff'), CoopSemesterController.close);


// รายชื่อรุ่นต่อภาค · ยกยอดจากภาคก่อน (⛔ /cohort/carry-over ต้องมาก่อน /cohort/:code)
router.get('/:id/cohort', authenticateToken, authorizeRoles('staff'), SemesterCohortController.list);
router.get('/:id/cohort/carry-over', authenticateToken, authorizeRoles('staff'), SemesterCohortController.previewCarryOver);
router.post('/:id/cohort/carry-over', authenticateToken, authorizeRoles('staff'), SemesterCohortController.carryOver);
router.delete('/:id/cohort/:code', authenticateToken, authorizeRoles('staff'), SemesterCohortController.remove);

export default router;
