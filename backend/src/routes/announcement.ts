import { Router } from 'express';
import { AnnouncementController } from '../controllers/announcement';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Protect all announcement endpoints with authentication
router.use(authenticateToken);

// Route: GET /api/announcements (Fetch all announcements for users)
router.get('/', AnnouncementController.getAnnouncements);

// Route: POST /api/announcements (Create PR announcement - Staff/Admin)
router.post(
  '/',
  authorizeRoles('staff', 'advisor', 'dean', 'dept_head'),
  AnnouncementController.createAnnouncement
);

// Route: DELETE /api/announcements/:id (Delete PR announcement - Staff/Admin)
router.delete(
  '/:id',
  authorizeRoles('staff', 'advisor', 'dean', 'dept_head'),
  AnnouncementController.deleteAnnouncement
);

// Route: PATCH /api/announcements/:id/pin (Toggle pin status - Staff/Admin)
router.patch(
  '/:id/pin',
  authorizeRoles('staff', 'advisor', 'dean', 'dept_head'),
  AnnouncementController.togglePin
);

export default router;
