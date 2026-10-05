import { Router } from 'express';
import { CoopSemesterController } from '../controllers/semester';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Route: GET /api/semesters/active
router.get('/active', CoopSemesterController.getActiveSemester);

// วงจรภาคเรียน — เจ้าหน้าที่เท่านั้น (เปลี่ยนภาคที่เปิดอยู่ = เปลี่ยนหน้าต่างปฏิทินที่ล็อกนักศึกษาทั้งรุ่น)
router.get('/', authenticateToken, authorizeRoles('staff'), CoopSemesterController.list);
router.post('/', authenticateToken, authorizeRoles('staff'), CoopSemesterController.create);
router.post('/:id/activate', authenticateToken, authorizeRoles('staff'), CoopSemesterController.activate);
router.post('/:id/close', authenticateToken, authorizeRoles('staff'), CoopSemesterController.close);

export default router;
