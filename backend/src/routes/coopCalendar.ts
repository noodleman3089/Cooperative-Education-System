import { Router } from 'express';
import { CoopCalendarController } from '../controllers/coopCalendar';
import { CoopSpecialRoundController } from '../controllers/coopSpecialRound';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// ทุก endpoint ต้องล็อกอิน — นักศึกษาต้องอ่านปฏิทินได้ ไม่งั้นแบนเนอร์ว่างเปล่า
router.use(authenticateToken);

// GET /api/calendar — อ่านได้ทุก role ที่ล็อกอิน
router.get('/', CoopCalendarController.getCalendar);

// การแก้ปฏิทินจำกัดที่ staff อย่างเดียว (announcements เปิดถึง 4 role)
// เพราะช่วงเวลาที่ตั้งตรงนี้ล็อกการทำรายการของนักศึกษาทั้งรุ่น ไม่ใช่แค่ประกาศข่าว
// รอบพิเศษ — เปิดให้นักศึกษาที่เลือกรายคนส่งกิจกรรมได้หลังพ้นช่วงปกติ (staff อย่างเดียวด้วยเหตุผลเดียวกัน)
// ⛔ ต้องอยู่ก่อน `/:id` · path สองชั้นไม่ชน `/:id` อยู่แล้ว แต่เก็บลำดับไว้กันคนเพิ่ม route ทีหลังพลาด
router.get('/special-rounds/students', authorizeRoles('staff'), CoopSpecialRoundController.searchStudents);
router.get('/special-rounds/memos', authorizeRoles('staff'), CoopSpecialRoundController.listApprovedMemos);
router.post('/special-rounds', authorizeRoles('staff'), CoopSpecialRoundController.create);
router.put('/special-rounds/:id', authorizeRoles('staff'), CoopSpecialRoundController.update);
router.delete('/special-rounds/:id', authorizeRoles('staff'), CoopSpecialRoundController.remove);

// ล้างช่วงเวลาทุกกิจกรรมของภาค — ⛔ ต้องอยู่ก่อน `/:id` ไม่งั้น "activities" ถูกอ่านเป็นรหัสกำหนดการ
router.delete('/activities', authorizeRoles('staff'), CoopCalendarController.clearActivityWindows);

router.post('/', authorizeRoles('staff'), CoopCalendarController.createEvent);
router.put('/:id', authorizeRoles('staff'), CoopCalendarController.updateEvent);
router.delete('/:id', authorizeRoles('staff'), CoopCalendarController.deleteEvent);

export default router;
