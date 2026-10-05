import React, { useContext, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

/* The login pages stay eager: they are the first thing an unauthenticated
   visitor sees, and splitting them would only add a round trip before the
   form appears. They are also small, and share components/auth between them. */
import LoginSelection from '../pages/LoginSelection';
import LoginStudent from '../pages/LoginStudent';
import LoginPersonnel from '../pages/LoginPersonnel';
import LoginMentor from '../pages/LoginMentor';
import ForgotPassword from '../pages/ForgotPassword';
import ResetPassword from '../pages/ResetPassword';

/* Everything past the front door is split. Splitting only inside Dashboard.tsx
   would have achieved nothing while these same pages were still named here —
   an eager import anywhere pulls the module into the entry chunk. */
const Dashboard = lazy(() => import('../pages/Dashboard'));
const OnboardingStudent = lazy(() => import('../pages/Student/OnboardingStudent'));
const OnboardingPersonnel = lazy(() => import('../pages/Staff/OnboardingPersonnel'));
const SetPassword = lazy(() => import('../pages/SetPassword'));
const AppointmentResponse = lazy(() => import('../pages/Mentor/AppointmentResponse'));
const AcceptanceLink = lazy(() => import('../pages/CompanyLink/AcceptanceLink'));
const MentorLinkLanding = lazy(() => import('../pages/Mentor/MentorLinkLanding'));
const FinalReportSubmission = lazy(() => import('../pages/Student/FinalReportSubmission'));
const AdvisorEvaluation = lazy(() => import('../pages/Advisor/AdvisorEvaluation'));
const FinalProgressDashboard = lazy(() => import('../pages/Staff/FinalProgressDashboard'));

/** Same spinner ProtectedRoute shows while the session is being checked, so a
 *  cold load is one continuous wait rather than two different ones. */
const RouteFallback: React.FC = () => (
  <div
    data-testid="screen-loading"
    className="flex h-screen items-center justify-center bg-[#F3F4F6] dark:bg-[#111827]"
  >
    <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent"></div>
  </div>
);

interface ProtectedRouteProps {
  children: React.ReactElement;
  requireOnboarded?: boolean;
  requiredRoles?: string[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireOnboarded = true, requiredRoles }) => {
  const auth = useContext(AuthContext);

  if (!auth) return null;
  const { isAuthenticated, isLoading, user } = auth;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F3F4F6] dark:bg-[#111827]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRoles && requiredRoles.length > 0 && user) {
    const userRoles: string[] = user.roles || [];
    const hasRole = userRoles.some(r => requiredRoles.includes(r));
    if (!hasRole) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  // If user is first time sso and trying to bypass onboarding page
  const storedUserStr = localStorage.getItem('auth_user');
  const isFirstTime = storedUserStr ? JSON.parse(storedUserStr).isFirstTime : false;

  if (requireOnboarded && isFirstTime) {
    const onboardingType = localStorage.getItem('onboarding_type') || 'student';
    return <Navigate to={`/onboarding/${onboardingType}`} replace />;
  }

  return children;
};

const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/login" element={<LoginSelection />} />
      <Route path="/login/student" element={<LoginStudent />} />
      <Route path="/login/personnel" element={<LoginPersonnel />} />
      <Route path="/login/mentor" element={<LoginMentor />} />
      <Route path="/m" element={<MentorLinkLanding />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/appointment-response" element={<AppointmentResponse />} />
      <Route path="/accept" element={<AcceptanceLink />} />

      <Route
        path="/set-password"
        element={
          <ProtectedRoute requireOnboarded={false}>
            <SetPassword />
          </ProtectedRoute>
        }
      />
      
      <Route 
        path="/onboarding" 
        element={
          <ProtectedRoute requireOnboarded={false}>
            <OnboardingStudent />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/onboarding/student" 
        element={
          <ProtectedRoute requireOnboarded={false}>
            <OnboardingStudent />
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/onboarding/personnel" 
        element={
          <ProtectedRoute requireOnboarded={false}>
            <OnboardingPersonnel />
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } 
      />

      {/* Phase 4 Routes */}
      <Route 
        path="/student/final-report" 
        element={
          <ProtectedRoute requiredRoles={['student']}>
            <FinalReportSubmission />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/advisor/evaluation" 
        element={
          <ProtectedRoute requiredRoles={['advisor']}>
            <AdvisorEvaluation />
          </ProtectedRoute>
        } 
      />
      <Route 
        path="/staff/final-progress" 
        element={
          // ไม่มี dean — GET /coop-progress/dashboard ไม่ให้คณบดี (ได้ 403 หน้าว่าง) · เจ้าของตัดสิน 2026-09-22
          <ProtectedRoute requiredRoles={['staff']}>
            <FinalProgressDashboard />
          </ProtectedRoute>
        } 
      />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  );
};

export default AppRoutes;
