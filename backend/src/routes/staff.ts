import { Router } from 'express';
import { StaffHomeController } from '../controllers/staffHome';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * เส้นทางที่เป็นของ “หน้าจอเจ้าหน้าที่งานสหกิจศึกษา” โดยเฉพาะ
 *
 * ⛔ ไม่ใช่ที่รวมของทุกอย่างที่เจ้าหน้าที่กดได้ — งานที่มีเจ้าของเป็นเอกสารหรือ
 *    ตารางอยู่แล้ว (คำร้อง · แบบตอบรับ · แบบเสนองาน · ทำเนียบ) อยู่ใต้เส้นทางของ
 *    สิ่งนั้นตามเดิม · ที่นี่มีเฉพาะของที่ **ไม่ได้เป็นของตารางไหนเลย** คือหน้าแรก
 *    ซึ่งเป็นการรวมตัวเลขข้ามหลายตารางให้จบในคำขอเดียว
 */
router.use(authenticateToken);
router.use(authorizeRoles('staff'));

// GET /api/staff/home — ฤดูกาล · กองงาน 6 กอง · แถบเวลา · คำเตือนปฏิทิน
router.get('/home', StaffHomeController.getHome);

export default router;
