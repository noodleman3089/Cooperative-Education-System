import { Router } from 'express';
import { DocumentController } from '../controllers/document';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

/**
 * ⛔ เส้นทาง **ออก** เอกสารราชการถูกโละเมื่อ 2026-08-26 พร้อมแม่แบบ HTML
 * (`POST /generate` · `POST /generate-dispatch` · `GET /dispatch-eligible`
 * · `GET /templates`) — เจ้าของสั่งโละก่อนแล้วออกแบบวิธีใหม่ทีหลัง
 *
 * ที่เหลือคือการอ่านและการลงนามเอกสารที่ออกไปแล้ว ซึ่งทำงานกับไฟล์ใน
 * `secure_private/documents/` ไม่ใช่แม่แบบ จึงไม่ได้รับผลกระทบ
 */

const router = Router();

// Route: GET /api/documents/signing-complete (Callback from DocuSign - Public browser redirect)
router.get(
  '/signing-complete',
  DocumentController.signingComplete
);

// Protect subsequent document endpoints with authentication
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
