import { Router } from 'express';
import { DocumentController } from '../controllers/document';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Route: GET /api/documents/signing-complete (Callback from DocuSign - Public browser redirect)
router.get(
  '/signing-complete',
  DocumentController.signingComplete
);

// Protect subsequent document endpoints with authentication
router.use(authenticateToken);

// Route: GET /api/documents/templates (Staff, Advisor, Dept Head, Dean only)
router.get(
  '/templates',
  authorizeRoles('staff', 'advisor', 'dept_head', 'dean'),
  DocumentController.listTemplates
);

// Route: GET /api/documents (Staff, Dean only)
router.get(
  '/',
  authorizeRoles('staff', 'dean'),
  DocumentController.listDocuments
);

// Route: POST /api/documents/generate (Staff only)
router.post(
  '/generate',
  authorizeRoles('staff'),
  DocumentController.generateDocument
);

// Route: POST /api/documents/batch-sign (Dean only)
router.post(
  '/batch-sign',
  authorizeRoles('dean'),
  DocumentController.batchSignDocuments
);

import rateLimit from 'express-rate-limit';

const generateDispatchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per `window` (here, per minute)
  message: 'Too many dispatch letters generated from this IP, please try again after a minute',
});

// Route: GET /api/documents/dispatch-eligible (Staff only)
router.get(
  '/dispatch-eligible',
  authorizeRoles('staff'),
  DocumentController.getDispatchEligibleStudents
);

// Route: POST /api/documents/generate-dispatch (Staff only)
router.post(
  '/generate-dispatch',
  authorizeRoles('staff'),
  generateDispatchLimiter,
  DocumentController.generateDispatchLetter
);

export default router;
