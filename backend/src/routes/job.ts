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

// Route: POST /api/jobs (เจ้าหน้าที่คีย์ตำแหน่งเข้าระบบแทนบริษัทที่ตอบมาทางกระดาษ)
//
// ⛔ **บัญชี `company` ถูกถอดออกแล้ว** — ในระบบนี้ไม่มี "บริษัทลงประกาศรับสมัครงาน"
//    คณะเป็นฝ่ายส่งแบบเสนองาน สหกิจ 02 ไปถาม บริษัทเป็นฝ่าย **ตอบ** ผ่าน
//    PUT /api/job-offers/:id แล้วเจ้าหน้าที่เป็นคนกด publish ทีละรายการ
//    · เส้นนี้สร้างแถวที่ offer_id/semester_id เป็น NULL คือประกาศที่ไม่สังกัดใบสำรวจ
//      และไม่สังกัดภาคเรียนไหนเลย ซึ่งเป็นการข้ามขั้นตอนทั้งหมดของ สหกิจ 02
//    · ปุ่มฝั่งหน้าจอถูกเปลี่ยนไปที่ JobOffer02 แล้ว แต่ประตู API ยังเปิดค้างอยู่
//      จนถึงรอบนี้ (เจอตอนเจ้าของถามว่า "แล้วใครโพสต์งานแทน")
router.post(
  '/',
  authorizeRoles('staff', 'advisor', 'dean'),
  JobPostController.createJobPost
);

// Route: PUT /api/jobs/:id/publish (Admin/Staff only)
router.put(
  '/:id/publish',
  authorizeRoles('staff', 'advisor', 'dean'),
  JobPostController.publishJobPost
);

// Route: PUT /api/jobs/:id/reject (Admin/Staff only) — requires a reason
router.put(
  '/:id/reject',
  authorizeRoles('staff', 'advisor', 'dean'),
  JobPostController.rejectJobPost
);

export default router;
