import { Router } from 'express';
import { ProfileController } from '../controllers/profile';
import { StudentController } from '../controllers/student';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';
import { validateProfileSetup } from '../middlewares/validation';
import {
  uploadAvatar,
  uploadResume,
  uploadSignature,
  validateUploadedFile,
} from '../middlewares/multer';

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

// Route: POST /api/profile/student/avatar (นักศึกษาอัปโหลดรูปโปรไฟล์ของตัวเอง)
// ⛔ แยกจาก PUT /student เพราะเส้นนั้นตีความ req.file เป็นเรซูเม่เสมอ และ
//    updateStudent เขียนทับทุกคอลัมน์ — ดูคอมเมนต์เต็มที่ ProfileController
router.post(
  '/student/avatar',
  authenticateToken,
  authorizeRoles('student'),
  uploadAvatar.single('avatar'),
  validateUploadedFile(['png', 'jpg']),
  ProfileController.updateStudentAvatar
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

// Route: PUT /api/profile/mentor (Mentor corrects their own contact details)
router.put(
  '/mentor',
  authenticateToken,
  authorizeRoles('mentor'),
  ProfileController.updateMentorProfile
);

export default router;
