import { Router } from 'express';
import { StaffHomeController } from '../controllers/staffHome';
import { StaffPipelineController } from '../controllers/staffPipeline';
import { StaffSemesterSummaryController } from '../controllers/staffSemesterSummary';
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

// GET /api/staff/pipeline — นักศึกษาตอนนี้: ขั้น · ใครถือเรื่อง · ค้างนาน (ต่อภาคเรียน · กรองสาขาได้)
router.get('/pipeline', StaffPipelineController.getPipeline);

// GET /api/staff/semester-summary — สรุปภาคเรียน: ตัวเลขของภาคที่เลือก เทียบภาคก่อน + เวลาที่ใช้ในแต่ละขั้น
router.get('/semester-summary', StaffSemesterSummaryController.getSummary);

export default router;
