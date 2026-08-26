import { Router } from 'express';
import { DocumentController } from '../controllers/document';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

/**
 * เอกสารราชการหลังการรื้อ 2026-08-26
 *
 * การ **ออก** หนังสือย้ายไปอยู่ที่ `PATCH /api/intents/:id/officer-approve` —
 * เจ้าหน้าที่รับคำร้อง (เอกสารหมายเลข 1) แล้วระบบวาดหนังสือขอความอนุเคราะห์
 * จากโค้ดทันที ที่นี่จึงเหลือเฉพาะการดูรายการและการลงนามของคณบดี
 *
 * ⛔ **ไม่มี route สาธารณะแล้ว** — `/signing-complete` ของ DocuSign ถูกถอดออก
 * ทั้งเส้น `router.use(authenticateToken)` จึงครอบทุก endpoint ในไฟล์นี้
 */

const router = Router();

router.use(authenticateToken);

// Route: GET /api/documents (Staff, Dean only)
router.get(
  '/',
  authorizeRoles('staff', 'dean'),
  DocumentController.listDocuments
);

// Route: POST /api/documents/batch-sign (Dean only)
router.post(
  '/batch-sign',
  authorizeRoles('dean'),
  DocumentController.batchSignDocuments
);

export default router;
