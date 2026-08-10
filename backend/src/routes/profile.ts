import { Router } from 'express';
import { ProfileController } from '../controllers/profile';
import { StudentController } from '../controllers/student';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { validateProfileSetup } from '../middlewares/validation';
import { uploadResume, uploadSignature, validateUploadedFile } from '../middlewares/multer';

const router = Router();

// Route: POST /api/profile/setup (First-time user onboarding)
router.post('/setup', authenticateToken, validateProfileSetup, ProfileController.setupProfile);

// Route: GET /api/profile/me (Retrieve logged-in user profile details)
router.get('/me', authenticateToken, ProfileController.getMyProfile);

// Route: PUT /api/profile/student (Update student profile and upload resume)
router.put(
  '/student',
  authenticateToken,
  authorizeRoles('student'),
  uploadResume.single('resume'),
  validateUploadedFile(['pdf', 'doc', 'docx']),
  ProfileController.updateStudentProfile
);

// Route: PUT /api/profile/student/optional (Update optional student profile fields)
router.put(
  '/student/optional',
  authenticateToken,
  authorizeRoles('student'),
  StudentController.updateOptionalProfile
);

// Route: PUT /api/profile/personnel (Update personnel profile and upload signature)
router.put(
  '/personnel',
  authenticateToken,
  authorizeRoles('advisor', 'dean', 'staff', 'dept_head'),
  uploadSignature.single('signature'),
  validateUploadedFile(['png', 'jpg']),
  ProfileController.updatePersonnelProfile
);

export default router;
