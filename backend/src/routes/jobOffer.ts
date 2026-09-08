import { Router } from 'express';
import { JobOfferController } from '../controllers/jobOffer';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * แบบเสนองานสหกิจศึกษา (สหกิจ 02)
 *
 * ⛔ ทุกเส้นเป็นของบัญชี `company` เท่านั้น — พี่เลี้ยงไม่เกี่ยวกับใบนี้
 *    (พนักงานที่ปรึกษาดูแลนักศึกษา ส่วนฝ่ายบุคคลเป็นคนตอบแบบสำรวจ)
 * ⛔ **ไม่มีด่านปฏิทิน** โดยตั้งใจ — วันปิดรับของแบบสำรวจอยู่ที่ `due_date` ของใบเอง
 *    ซึ่งเจ้าหน้าที่ตั้งตอนส่งไปถาม ไม่ใช่ช่วงเวลากลางของปฏิทินสหกิจ
 *    และการปฏิเสธคำตอบที่ส่งช้าคือการทำให้คณะไม่ได้คำตอบเลย ซึ่งแย่กว่าได้ช้า
 */
router.use(authenticateToken);
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
