import { Router } from 'express';
import { PersonnelController } from '../controllers/personnel';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Protect personnel routes
router.use(authenticateToken);

// Route: GET /api/personnel (staff, dept_head only)
router.get(
  '/',
  authorizeRoles('staff', 'dept_head'),
  PersonnelController.getPersonnel
);

// Route: PUT /api/personnel/:id/approve (staff only)
router.put(
  '/:id/approve',
  authorizeRoles('staff'),
  PersonnelController.approvePersonnel
);

import { PersonnelImportController } from '../controllers/personnelImport';
import multer from 'multer';

// Use memory storage for CSV upload
const upload = multer({ storage: multer.memoryStorage() });

// Route: POST /api/personnel/import (staff, dept_head only)
router.post(
  '/import',
  authorizeRoles('staff', 'dept_head'),
  upload.single('file'),
  PersonnelImportController.importPersonnel
);

// Route: POST /api/personnel/add (staff only)
router.post(
  '/add',
  authorizeRoles('staff'),
  PersonnelImportController.addSinglePersonnel
);

// Route: GET /api/personnel/preseed (staff only)
router.get(
  '/preseed',
  authorizeRoles('staff'),
  PersonnelImportController.getPreseededPersonnel
);

// Route: DELETE /api/personnel/preseed/:employee_code (staff only)
router.delete(
  '/preseed/:employee_code',
  authorizeRoles('staff'),
  PersonnelImportController.deletePreseededPersonnel
);

// Route: GET /api/personnel/supervised-students (advisor only)
router.get(
  '/supervised-students',
  authorizeRoles('advisor'),
  PersonnelController.getSupervisedStudents
);

export default router;
