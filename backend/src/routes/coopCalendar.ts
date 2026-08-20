import { Router } from 'express';
import { CoopCalendarController } from '../controllers/coopCalendar';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// ทุก endpoint ต้องล็อกอิน — นักศึกษาต้องอ่านปฏิทินได้ ไม่งั้นแบนเนอร์ว่างเปล่า
router.use(authenticateToken);

// GET /api/calendar — อ่านได้ทุก role ที่ล็อกอิน
router.get('/', CoopCalendarController.getCalendar);

// การแก้ปฏิทินจำกัดที่ staff อย่างเดียว (announcements เปิดถึง 4 role)
// เพราะช่วงเวลาที่ตั้งตรงนี้ล็อกการทำรายการของนักศึกษาทั้งรุ่น ไม่ใช่แค่ประกาศข่าว
router.post('/', authorizeRoles('staff'), CoopCalendarController.createEvent);
router.put('/:id', authorizeRoles('staff'), CoopCalendarController.updateEvent);
router.delete('/:id', authorizeRoles('staff'), CoopCalendarController.deleteEvent);

export default router;
