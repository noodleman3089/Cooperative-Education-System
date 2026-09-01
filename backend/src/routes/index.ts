import { Router } from 'express';
import authRoutes from './auth';
import masterDataRoutes from './masterData';
import profileRoutes from './profile';
import userRoutes from './user';
import companyRoutes from './company';
import jobRoutes from './job';
import intentRoutes from './intent';
import documentRoutes from './document';
import acceptanceRoutes from './acceptance';
import studentRoutes from './student';
import semesterRoutes from './semester';
import personnelRoutes from './personnel';
import reportOutlineRoutes from './reportOutline';
import appointmentRoutes from './appointment';
import supervisionLogRoutes from './supervisionLog';
import weeklyLogRoutes from './weeklyLog';
import applicationRoutes from './application';
import finalReportRoutes from './finalReport';
import finalEvaluationRoutes from './finalEvaluation';
import coopProgressRoutes from './coopProgress';
import announcementRoutes from './announcement';
import coopCalendarRoutes from './coopCalendar';
import memoRoutes from './memo';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// 1. Module Routes
router.use('/auth', authRoutes);
router.use('/master-data', masterDataRoutes);
router.use('/profile', profileRoutes);
router.use('/users', userRoutes);
router.use('/companies', companyRoutes);
router.use('/jobs', jobRoutes);
router.use('/intents', intentRoutes);
router.use('/documents', documentRoutes);
router.use('/acceptances', acceptanceRoutes);
router.use('/students', studentRoutes);
router.use('/semesters', semesterRoutes);
router.use('/personnel', personnelRoutes);

// Phase 3 Routes
router.use('/outlines', reportOutlineRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/supervision-logs', supervisionLogRoutes);
router.use('/weekly-logs', weeklyLogRoutes);
router.use('/applications', applicationRoutes);

// Phase 4 Routes
router.use('/final-reports', finalReportRoutes);
router.use('/final-evaluations', finalEvaluationRoutes);
router.use('/coop-progress', coopProgressRoutes);
router.use('/announcements', announcementRoutes);
router.use('/calendar', coopCalendarRoutes);
router.use('/memos', memoRoutes);


if (process.env.ENABLE_TEST_ROUTES === 'true') {
  // 2. Role-Based Access Control (RBAC) Testing Routes
  // These routes allow validating that the authorization middleware verifies role access correctly.
  router.get(
  '/test/student-only',
  authenticateToken,
  authorizeRoles('student'),
  (req, res) => {
    res.status(200).json({
      message: 'Access granted to Student Role.',
      user: req.user
    });
  }
);

router.get(
  '/test/advisor-only',
  authenticateToken,
  authorizeRoles('advisor'),
  (req, res) => {
    res.status(200).json({
      message: 'Access granted to Advisor Role.',
      user: req.user
    });
  }
);

router.get(
  '/test/dean-only',
  authenticateToken,
  authorizeRoles('dean'),
  (req, res) => {
    res.status(200).json({
      message: 'Access granted to Dean Role.',
      user: req.user
    });
  }
);

router.get(
  '/test/staff-only',
  authenticateToken,
  authorizeRoles('advisor', 'dean', 'staff'),
  (req, res) => {
    res.status(200).json({
      message: 'Access granted to Personnel/Staff roles.',
      user: req.user
    });
  }
);
}

export default router;
