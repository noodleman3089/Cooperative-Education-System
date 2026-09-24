import { Router } from 'express';
import { AppointmentController } from '../controllers/appointment';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// GET /api/appointments
router.get(
  '/',
  authenticateToken,
  authorizeRoles('advisor', 'staff'),
  AppointmentController.getAppointments
);

// POST /api/appointments/draft (Advisor creates draft)
// บันทึกข้อความขออนุมัติเดินทางไปราชการ (ปุ่มพิมพ์สำรอง · spec-F ข้อ 6.4)
router.get(
  '/travel-request/print',
  authenticateToken,
  authorizeRoles('advisor'),
  AppointmentController.printTravelRequest
);

router.post(
  '/draft',
  authenticateToken,
  authorizeRoles('advisor'),
  AppointmentController.createDraft
);

// PUT /api/appointments/:id/audit-send (Staff clicks send email)
router.put(
  '/:id/audit-send',
  authenticateToken,
  authorizeRoles('staff'),
  AppointmentController.auditSend
);

// POST /api/appointments/:id/respond-info (Public route: what the mentor is being asked to confirm)
router.post(
  '/:id/respond-info',
  AppointmentController.respondInfo
);

// PUT /api/appointments/:id/respond (Public route for Mentor email link to accept/reschedule)
router.put(
  '/:id/respond',
  AppointmentController.respond
);

// PUT /api/appointments/:id/bypass (อาจารย์: "ตกลงนอกรอบแล้ว" · เจ้าหน้าที่: "บันทึกว่านัดทางโทรศัพท์แล้ว")
router.put(
  '/:id/bypass',
  authenticateToken,
  authorizeRoles('advisor', 'staff'),
  AppointmentController.bypass
);

// PUT /api/appointments/:id/accept-reschedule (อาจารย์หรือเจ้าหน้าที่รับวันที่บริษัทขอเลื่อน)
router.put(
  '/:id/accept-reschedule',
  authenticateToken,
  authorizeRoles('advisor', 'staff'),
  AppointmentController.acceptReschedule
);

export default router;
