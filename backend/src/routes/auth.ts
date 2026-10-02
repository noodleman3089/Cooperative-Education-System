import { Router } from 'express';
import { AuthController } from '../controllers/auth';
import { MentorLinkController } from '../controllers/mentorLink';
import { validateLogin } from '../middlewares/validation';
import { authenticateToken } from '../middlewares/auth';

const router = Router();

// Route: POST /api/auth/login
router.post('/login', validateLogin, AuthController.login);

// Route: POST /api/auth/google
router.post('/google', AuthController.googleSSO);

// Route: GET /api/auth/me (authenticated — the frontend cannot read the httpOnly session cookie)
router.get('/me', authenticateToken, AuthController.me);

// Route: POST /api/auth/logout (public — clears the session cookie)
router.post('/logout', AuthController.logout);

// Route: POST /api/auth/set-password (authenticated — set first password after Google SSO)
router.post('/set-password', authenticateToken, AuthController.setPassword);

// Route: POST /api/auth/forgot-password (public — request reset email)
router.post('/forgot-password', AuthController.forgotPassword);

// Route: POST /api/auth/reset-password (public — reset with token)
router.post('/reset-password', AuthController.resetPassword);

// Route: POST /api/auth/claim-personnel (authenticated — claim profile with employee code)
router.post('/claim-personnel', authenticateToken, AuthController.claimPersonnelProfile);

// Routes: POST /api/auth/mentor-link/{request,consume,resend} (public — พี่เลี้ยงเข้าสู่ระบบด้วยลิงก์ในอีเมล ไม่มีรหัสผ่าน)
router.post('/mentor-link/request', MentorLinkController.request);
router.post('/mentor-link/consume', MentorLinkController.consume);
router.post('/mentor-link/resend', MentorLinkController.resend);

export default router;
