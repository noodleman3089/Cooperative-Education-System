import { Router, type RequestHandler } from 'express';
import { query } from '../config/database';
import { IntentFormController } from '../controllers/intent';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { MentorController } from '../controllers/mentor';
import { AcceptanceController } from '../controllers/acceptance';
import { requireStudentProfile } from '../middlewares/validation';
import { uploadRequestForm, validateUploadedFile } from '../middlewares/multer';
import { requireCalendarWindow } from '../middlewares/calendarGate';

const router = Router();

// Protect intent form endpoints with authentication and student role authorization
router.use(authenticateToken);

// Route: GET /api/intents/me (Student only lists own intents)
router.get(
  '/me',
  authorizeRoles('student'),
  IntentFormController.getStudentIntents
);

// Route: GET /api/intents (Advisor, Dept Head, Staff, Dean list intents)
router.get(
  '/',
  authorizeRoles('advisor', 'dept_head', 'staff', 'dean'),
  IntentFormController.getIntents
);

// Route: GET /api/intents/pipeline-summary (Advisor, Dept Head, Staff, Dean view summary)
router.get(
  '/pipeline-summary',
  authorizeRoles('advisor', 'dept_head', 'staff', 'dean'),
  IntentFormController.getPipelineSummary
);

// Route: GET /api/intents/:id (Student owner, Advisor, Dept Head, Staff, Dean view detail)
router.get(
  '/:id',
  authorizeRoles('student', 'advisor', 'dept_head', 'staff', 'dean'),
  IntentFormController.getIntentDetail
);

// Route: POST /api/intents (Students submit their intent)
router.post(
  '/',
  authorizeRoles('student'),
  // โปรไฟล์มาก่อนปฏิทิน — คนที่ยังไม่มีโปรไฟล์ควรได้คำตอบว่า "ไปตั้งโปรไฟล์" ไม่ใช่ "ปิดรับ"
  // ⛔ ไม่มีด่านคุณสมบัติ/สิทธิ์สหกิจแล้ว (SEC-02 · ตัดออก 2026-09-14)
  requireStudentProfile,
  requireCalendarWindow('intent_submission'),
  IntentFormController.submitIntent
);

// Route: POST /api/intents/request-form/preview (ตัวอย่างเอกสารหมายเลข 1 ก่อนกดยื่น)
// ⛔ ไม่ผ่านด่านปฏิทิน — ดูตัวอย่างไม่ใช่การยื่น · ไม่เขียนฐานข้อมูล
router.post(
  '/request-form/preview',
  authorizeRoles('student'),
  requireStudentProfile,
  IntentFormController.previewRequestForm
);

// ⛔ ถอดออกเมื่อ 2026-08-27 — **ห้ามเอากลับมา**
//    `PATCH /:id/status` (advisor) และ `PATCH /:id/dept-head-status` (dept_head)
//    คือการอนุมัติของเส้นทางเดิม ซึ่งย้ายไปอยู่บนกระดาษ (แบบคำร้อง เอกสารหมายเลข 1)
//    ตั้งแต่ 2026-08-26 · เจ้าหน้าที่เป็นคนเดียวที่กดผ่านในระบบ ผ่าน `/officer-approve`
//    · สถานะ `approved_by_advisor` / `rejected_by_dept_head` ที่สองเส้นนี้เคยสร้าง
//      จึงไม่มีทางเกิดขึ้นอีก

/**
 * กำหนดส่งของ "ยื่นคำร้อง" นับที่ **วันอัปโหลดกระดาษที่ลงนามครั้งแรก** (เจ้าของตัดสิน 2026-10-06)
 * — เดิมนับที่วันกดยื่น ยื่นทันแล้วอัปโหลดช้าเท่าไหร่ก็ได้
 *
 * ผูกปฏิทินเฉพาะครั้งแรก: ใบที่เคยอัปโหลดแล้ว (เปลี่ยนไฟล์ระหว่างรอ · ส่งใหม่หลังเจ้าหน้าที่ตีกลับ) ผ่านเลย
 * เพราะครั้งแรกทันกำหนดไปแล้ว และการตีกลับไม่ใช่ความล่าช้าของนักศึกษา
 * ⛔ ต้องอยู่ **ก่อน multer** — คำขอนอกช่วงต้องไม่เขียนไฟล์ลงดิสก์
 */
const firstUploadWindow: RequestHandler = async (req, res, next) => {
  try {
    const formId = Number(req.params.id);
    const uploadedBefore =
      Number.isInteger(formId) && formId > 0
        ? await query(
            `SELECT 1 FROM intent_stage_events WHERE form_id = $1 AND stage = 'request_uploaded' LIMIT 1`,
            [formId]
          )
        : null;
    if ((uploadedBefore?.rowCount ?? 0) > 0) {
      next();
      return;
    }
    await requireCalendarWindow('intent_submission', 'intent_param')(req, res, next);
  } catch (error) {
    next(error);
  }
};

// Route: POST /api/intents/:id/request-form (นักศึกษาอัปโหลดกระดาษที่ลงนามแล้ว)
router.post(
  '/:id/request-form',
  authorizeRoles('student'),
  firstUploadWindow,
  uploadRequestForm.single('request_form'),
  validateUploadedFile(['pdf', 'png', 'jpg']),
  IntentFormController.uploadRequestForm
);

// Route: POST /api/intents/:id/withdraw (นักศึกษายกเลิกคำร้องของตัวเองก่อนเจ้าหน้าที่รับ)
// ⛔ ไม่ผูกปฏิทินกิจกรรม — การยกเลิกไม่ใช่การยื่น นอกช่วงเปิดรับก็ต้องยกเลิกได้
router.post('/:id/withdraw', authorizeRoles('student'), IntentFormController.withdrawIntent);

// Route: PUT /api/intents/:id/company (นักศึกษาแก้สถานประกอบการของคำร้อง ก่อนอัปโหลดกระดาษที่ลงนาม)
// ⛔ ไม่ผูกปฏิทินกิจกรรม — แก้ใบที่ยื่นไปแล้ว ไม่ใช่การยื่นใหม่
router.put('/:id/company', authorizeRoles('student'), IntentFormController.updateIntentCompany);

// Route: PATCH /api/intents/:id/officer-approve (เจ้าหน้าที่รับคำร้อง)
router.patch(
  '/:id/officer-approve',
  authorizeRoles('staff'),
  IntentFormController.officerApproveRequest
);

// Route: PATCH /api/intents/:id/officer-reject (เจ้าหน้าที่ตีกลับ)
router.patch(
  '/:id/officer-reject',
  authorizeRoles('staff'),
  IntentFormController.officerRejectRequest
);

// Route: PATCH /api/intents/:id/document-no (เจ้าหน้าที่แก้เลขที่หนังสือออก — ได้จนกว่าคณบดีจะลงนาม)
router.patch(
  '/:id/document-no',
  authorizeRoles('staff'),
  IntentFormController.changeOfficerDocumentNo
);

// Route: POST /api/intents/:id/cover-letter/reissue
// สร้างหนังสือขอความอนุเคราะห์อีกครั้ง เมื่อรับคำร้องแล้วแต่การวาด/บันทึกหนังสือล้ม (ใบจะค้างถาวรถ้าไม่มีทางนี้)
router.post(
  '/:id/cover-letter/reissue',
  authorizeRoles('staff'),
  IntentFormController.reissueCoverLetter
);

// Route: POST /api/intents/:id/cover-letter/recall
// เจ้าหน้าที่ดึงหนังสือที่ยังไม่ลงนามกลับ (บริษัทหรือนักศึกษาแจ้งเปลี่ยนข้อมูลหลังรับคำร้อง) — ใบถอยไป pending_officer_request
router.post(
  '/:id/cover-letter/recall',
  authorizeRoles('staff'),
  IntentFormController.recallCoverLetter
);

// Route: POST /api/intents/:id/dispatch-letter (เจ้าหน้าที่สั่งออกหนังสือส่งตัว)
// ⛔ ออกได้เมื่อใบอยู่สถานะ `accepted` แล้วเท่านั้น — ด่านอยู่ใน controller
router.post(
  '/:id/dispatch-letter',
  authorizeRoles('staff'),
  IntentFormController.issueDispatchLetter
);

// Route: GET /api/intents/:id/cover-letter/preview (เจ้าหน้าที่ดูตัวอย่างก่อนส่งคิวคณบดี)
router.get(
  '/:id/cover-letter/preview',
  authorizeRoles('staff'),
  IntentFormController.previewCoverLetter
);

// Route: GET /api/intents/:id/request-form
// แบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1) — หน้า HTML สำหรับสั่งพิมพ์
// ไม่ระบุ role ที่นี่โดยตั้งใจ: นักศึกษาเปิดของตัวเอง ส่วนบุคลากรใช้กติกาของ
// `assertCanReviewStudentWork` ซึ่งตรวจถึงระดับ "นักศึกษาคนนี้อยู่ในความดูแลไหม"
// การใส่ authorizeRoles เพิ่มตรงนี้จะกลายเป็นด่านที่หลวมกว่าด่านจริงและชวนเข้าใจผิด
router.get('/:id/request-form', IntentFormController.getRequestForm);

// Route: GET /api/intents/:id/acceptance-form
// เอกสารหมายเลข 2 — แบบยืนยันแบบตอบรับที่สถานประกอบการเป็นผู้กรอก
// ไม่ระบุ role ด้วยเหตุผลเดียวกับ request-form ด้านบน
router.get('/:id/acceptance-form', IntentFormController.getAcceptanceForm);

// Route: POST /api/intents/:id/send-to-company
// นักศึกษาสั่งระบบส่งหนังสือขอความอนุเคราะห์ (ลงนามแล้ว) + แบบตอบรับถึงอีเมลสถานประกอบการ
// ⛔ ไม่ผูกปฏิทินกิจกรรม (`requireCalendarWindow`) — การส่งอีเมลไม่ใช่การยื่นเอกสาร
router.post(
  '/:id/send-to-company',
  authorizeRoles('student'),
  IntentFormController.sendCoverLetterToCompany
);

// Route: POST /api/intents/:id/mentor
// นักศึกษาระบุพี่เลี้ยงหลังบริษัทตอบรับทางลิงก์ (ลิงก์ไม่ถามพี่เลี้ยงแล้ว) — เฉพาะใบรอเจ้าหน้าที่ยืนยัน
// ⛔ ไม่ผูกปฏิทินกิจกรรม: เป็นแค่ข้อมูลประกอบการตอบรับที่ยื่นไปแล้ว · บัญชีพี่เลี้ยงเปิดตอนเจ้าหน้าที่กดรับเท่านั้น
router.post('/:id/mentor', authorizeRoles('student'), AcceptanceController.setMentor);

// Route: PATCH /api/intents/:id/daily-log-required (พี่เลี้ยงเปิด/ปิดการบันทึกรายวัน สหกิจ 08)
// ⛔ role `mentor` เท่านั้น — นักศึกษาปิดเองไม่ได้ เพราะเป็นการยกเลิกภาระงานของตัวเอง
router.patch(
  '/:id/daily-log-required',
  authorizeRoles('mentor'),
  MentorController.setDailyLogRequired
);

// Route: PATCH /api/intents/:id/company-log-form (นักศึกษาเปิด/ปิดสวิตช์ใช้แบบฟอร์มของบริษัท)
router.patch(
  '/:id/company-log-form',
  authorizeRoles('student'),
  IntentFormController.updateCompanyLogForm
);

export default router;

