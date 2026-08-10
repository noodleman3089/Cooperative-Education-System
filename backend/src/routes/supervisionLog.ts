import { Router } from 'express';
import { SupervisionLogController } from '../controllers/supervisionLog';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { uploadSupervisionPhoto } from '../middlewares/multer';

const router = Router();

// POST /api/supervision-logs (Save draft or submit final)
router.post(
  '/',
  authenticateToken,
  authorizeRoles('advisor'),
  SupervisionLogController.saveLog
);

// POST /api/supervision-logs/upload-evidence (Upload photos via multer)
router.post(
  '/upload-evidence',
  authenticateToken,
  authorizeRoles('advisor'),
  uploadSupervisionPhoto.array('photos', 5), // allow up to 5 photos
  SupervisionLogController.uploadEvidence
);

export default router;
