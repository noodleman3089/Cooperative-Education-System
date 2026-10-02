import { Router } from 'express';
import { JobOfferController } from '../controllers/jobOffer';
import { JobOfferStaffController } from '../controllers/jobOfferStaff';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * แบบเสนองานสหกิจศึกษา (สหกิจ 02)
 *
 * ไฟล์นี้มีเฉพาะ **ฝั่งเจ้าหน้าที่** (ส่งไปถาม · ตรวจ · เปิดตำแหน่ง) — บริษัทตอบทางลิงก์สาธารณะ
 * ⛔ พี่เลี้ยงไม่เกี่ยวกับใบนี้เลย — พนักงานที่ปรึกษาดูแลนักศึกษา
 *    ส่วนฝ่ายบุคคลเป็นคนตอบแบบสำรวจ
 * ⛔ **ไม่มีด่านปฏิทิน** โดยตั้งใจ — วันปิดรับของแบบสำรวจอยู่ที่ `due_date` ของใบเอง
 *    ซึ่งเจ้าหน้าที่ตั้งตอนส่งไปถาม ไม่ใช่ช่วงเวลากลางของปฏิทินสหกิจ
 *    และการปฏิเสธคำตอบที่ส่งช้าคือการทำให้คณะไม่ได้คำตอบเลย ซึ่งแย่กว่าได้ช้า
 */
router.use(authenticateToken);

// POST /api/job-offers/send — เจ้าหน้าที่ส่งแบบสำรวจให้บริษัทที่เลือกจากทำเนียบ
//
router.post('/send', authorizeRoles('staff'), JobOfferController.sendSurvey);

/* ── ฝั่งเจ้าหน้าที่ ──────────────────────────────────────────────────── */
router.get('/recipients', authorizeRoles('staff'), JobOfferStaffController.listRecipients);
router.get('/staff', authorizeRoles('staff'), JobOfferStaffController.listOffers);
router.get('/staff/:offerId', authorizeRoles('staff'), JobOfferStaffController.getOffer);
// ปุ่มที่ปิดวงจร: ตรวจผ่านทั้งใบ = ตำแหน่งข้างในขึ้นกระดานหางาน
router.put('/:offerId/review', authorizeRoles('staff'), JobOfferStaffController.reviewOffer);
router.post('/:offerId/reject', authorizeRoles('staff'), JobOfferStaffController.rejectOffer);
router.post('/:offerId/resend-link', authorizeRoles('staff'), JobOfferStaffController.resendLink);

// ⛔ ฝั่งบริษัทไม่มีบัญชี — current/history/PUT/copy-previous/submit/decline ของบัญชี `company`
//    ถูกลบแล้ว บริษัทตอบผ่านลิงก์ใช้ครั้งเดียวที่ /api/public/job-offer (routes/publicJobOffer.ts)

export default router;
