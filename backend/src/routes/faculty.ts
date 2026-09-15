import { Router } from 'express';
import { FacultyHomeController } from '../controllers/facultyHome';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * หน้าแรกของฝ่ายอาจารย์ (spec-F ข้อ 3 · spec-G ข้อ 3)
 * แต่ละเส้นแปะด่านบทบาทของตัวเอง — บัญชีที่เป็นทั้งอาจารย์และหัวหน้าสาขาเรียกได้ทั้งคู่
 * แต่ได้ขอบเขตของบทบาทนั้นเท่านั้น
 */
router.use(authenticateToken);

router.get('/home/advisor', authorizeRoles('advisor'), FacultyHomeController.getAdvisorHome);
router.get('/home/dept-head', authorizeRoles('dept_head'), FacultyHomeController.getDeptHeadHome);

export default router;
