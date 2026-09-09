import { Router } from 'express';
import { JobOfferController } from '../controllers/jobOffer';
import { JobOfferStaffController } from '../controllers/jobOfferStaff';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * แบบเสนองานสหกิจศึกษา (สหกิจ 02)
 *
 * ไฟล์นี้มีสองบล็อก: **ฝั่งเจ้าหน้าที่** (ส่งไปถาม · ตรวจ · เปิดตำแหน่ง) อยู่ข้างบน
 * และ **ฝั่งบริษัท** (ตอบ) อยู่ใต้ `router.use(authorizeRoles('company'))`
 * ⛔ พี่เลี้ยงไม่เกี่ยวกับใบนี้เลย — พนักงานที่ปรึกษาดูแลนักศึกษา
 *    ส่วนฝ่ายบุคคลเป็นคนตอบแบบสำรวจ
 * ⛔ **ไม่มีด่านปฏิทิน** โดยตั้งใจ — วันปิดรับของแบบสำรวจอยู่ที่ `due_date` ของใบเอง
 *    ซึ่งเจ้าหน้าที่ตั้งตอนส่งไปถาม ไม่ใช่ช่วงเวลากลางของปฏิทินสหกิจ
 *    และการปฏิเสธคำตอบที่ส่งช้าคือการทำให้คณะไม่ได้คำตอบเลย ซึ่งแย่กว่าได้ช้า
 */
router.use(authenticateToken);

// POST /api/job-offers/send — เจ้าหน้าที่ส่งแบบสำรวจให้บริษัทที่เลือกจากทำเนียบ
//
// ⛔ **ต้องอยู่เหนือ `router.use(authorizeRoles('company'))` บรรทัดล่าง** — ไม่งั้นบัญชี
//    เจ้าหน้าที่จะถูกด่านนั้นปฏิเสธก่อนถึงที่นี่ · เส้นนี้เป็นเส้นเดียวในไฟล์ที่ไม่ใช่ของบริษัท
//    เพราะ "การเปิดใบ" เป็นการกระทำของมหาวิทยาลัย ส่วนที่เหลือทั้งไฟล์คือ "การตอบ" ของบริษัท
router.post('/send', authorizeRoles('staff'), JobOfferController.sendSurvey);

/* ── ฝั่งเจ้าหน้าที่ — ทุกเส้นในบล็อกนี้ต้องอยู่เหนือด่าน `company` ข้างล่าง ────
 *
 * ⛔ ห้ามย้ายลงไปหลัง `router.use(authorizeRoles('company'))` — บัญชีเจ้าหน้าที่
 *    จะถูกด่านนั้นปฏิเสธก่อนถึง handler และหน้าจอจะได้ 403 โดยไม่มีอะไรบอกว่าทำไม
 * ⛔ `/recipients` และ `/staff` ต้องอยู่**ก่อน** `PUT /:id` ของฝั่งบริษัทเสมอ
 *    ไม่งั้น Express จับ `staff` เป็นค่าของ `:id`
 */
router.get('/recipients', authorizeRoles('staff'), JobOfferStaffController.listRecipients);
router.get('/staff', authorizeRoles('staff'), JobOfferStaffController.listOffers);
router.get('/staff/:offerId', authorizeRoles('staff'), JobOfferStaffController.getOffer);
// ปุ่มที่ปิดวงจร: ตรวจผ่านทั้งใบ = ตำแหน่งข้างในขึ้นกระดานหางาน
router.put('/:offerId/review', authorizeRoles('staff'), JobOfferStaffController.reviewOffer);
router.post('/:offerId/reject', authorizeRoles('staff'), JobOfferStaffController.rejectOffer);

router.use(authorizeRoles('company'));

// GET /api/job-offers/current — ใบของภาคที่กำลังถูกสำรวจ + คำตอบเดิมไว้เทียบ
router.get('/current', JobOfferController.getCurrent);

// GET /api/job-offers/history — ประวัติความร่วมมือกับคณะ
router.get('/history', JobOfferController.getHistory);

// PUT /api/job-offers/:id — บันทึกคำตอบทั้งใบ
router.put('/:id', JobOfferController.updateOffer);

// POST /api/job-offers/:id/copy-previous — ใช้คำตอบของภาคเรียนที่แล้ว
router.post('/:id/copy-previous', JobOfferController.copyPrevious);

// POST /api/job-offers/:id/submit — ส่งคำตอบกลับให้มหาวิทยาลัย
router.post('/:id/submit', JobOfferController.submitOffer);

// POST /api/job-offers/:id/decline — ภาคเรียนนี้ยังไม่รับนักศึกษา
router.post('/:id/decline', JobOfferController.declineOffer);

export default router;
