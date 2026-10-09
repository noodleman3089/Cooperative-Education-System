import { Router } from 'express';
import { MentorFollowupController } from '../controllers/mentorFollowup';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * คณะตามพี่เลี้ยง — staff / dept_head / advisor ดูและเตือนได้ (ขอบเขตกรองที่ controller · fail closed)
 * ⛔ ยืนยันพี่เลี้ยง · ส่งลิงก์เปล่า · แก้อีเมลพี่เลี้ยง = staff เท่านั้น
 */
router.use(authenticateToken);
router.use(authorizeRoles('staff', 'dept_head', 'advisor'));

router.get('/', MentorFollowupController.list);
router.post('/:mentorId/remind', MentorFollowupController.remind);
router.post('/:mentorId/confirm', authorizeRoles('staff'), MentorFollowupController.confirm);
router.post('/:mentorId/send-link', authorizeRoles('staff'), MentorFollowupController.sendLink);
router.put('/:mentorId/email', authorizeRoles('staff'), MentorFollowupController.updateEmail);

export default router;
