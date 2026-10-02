import React, { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Briefcase } from 'lucide-react';
import LoginCard from '../components/auth/LoginCard';
import PasswordLoginForm from '../components/auth/PasswordLoginForm';
import SetPasswordForm from '../components/auth/SetPasswordForm';
import { useAuthLogin } from '../hooks/useAuthLogin';

/**
 * The one address external partners ever need. Companies and mentors have no
 * university Google account, so there is no SSO half here.
 *
 * An invitation email points at this same page carrying `?token=`, which turns
 * it into "choose your password" for that one visit. Keeping activation here
 * rather than on a separate page means a partner can bookmark this URL on their
 * first visit and it keeps working forever.
 */
const LoginCompany: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('token');

  const { error, isSubmitting, loginWithPassword, isAuthenticated } = useAuthLogin();

  useEffect(() => {
    // An invited partner is not signed in yet; do not bounce them off the form.
    if (isAuthenticated && !inviteToken) navigate('/dashboard');
  }, [isAuthenticated, inviteToken, navigate]);

  if (inviteToken) {
    return (
      <LoginCard
        icon={<Briefcase className="h-6 w-6" />}
        title="ตั้งรหัสผ่านเพื่อเปิดใช้งานบัญชี"
        subtitle="ยินดีต้อนรับสู่ระบบสหกิจศึกษา RMUTTO กรุณาตั้งรหัสผ่านของท่านเพื่อเริ่มใช้งาน"
        backTo="/login/company"
        backLabel="ข้ามไปหน้าเข้าสู่ระบบ"
      >
        <SetPasswordForm
          token={inviteToken}
          passwordLabel="รหัสผ่าน"
          confirmLabel="ยืนยันรหัสผ่าน"
          submitLabel="ตั้งรหัสผ่านและเข้าใช้งาน"
          submittingLabel="กำลังเปิดใช้งานบัญชี..."
          successText="ตั้งรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านที่ท่านตั้งไว้"
          continueLabel="ไปหน้าเข้าสู่ระบบ"
          onContinue={() => navigate('/login/company', { replace: true })}
        />
      </LoginCard>
    );
  }

  return (
    <LoginCard
      icon={<Briefcase className="h-6 w-6" />}
      title="เข้าสู่ระบบสถานประกอบการ"
      subtitle="พี่เลี้ยง (Mentor) และผู้ประสานงานของบริษัทคู่ค้า"
      error={error}
      backTo="/login"
      backLabel="ย้อนกลับไปหน้าเลือกสถานะ"
    >
      <PasswordLoginForm
        identifierType="email"
        identifierLabel="อีเมลประสานงาน (Company Email)"
        identifierPlaceholder="กรอกอีเมลสถานประกอบการ"
        submitLabel="เข้าสู่ระบบสถานประกอบการ"
        isSubmitting={isSubmitting}
        onSubmit={loginWithPassword}
      />

      <p className="mt-5 text-center text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
        หากท่านเพิ่งได้รับอีเมลเชิญเข้าใช้งาน กรุณากดลิงก์{' '}
        <span className="font-semibold">ตั้งรหัสผ่านและเข้าใช้งาน</span> ในอีเมลก่อนเข้าสู่ระบบครั้งแรก
      </p>

      <p className="mt-3 text-center text-xs text-gray-600 dark:text-gray-400">
        <Link
          to="/login/mentor"
          className="font-medium text-brand-blue hover:text-brand-navy dark:text-blue-400 dark:hover:text-blue-300"
        >
          พี่เลี้ยง: เข้าด้วยลิงก์ทางอีเมล
        </Link>
      </p>
    </LoginCard>
  );
};

export default LoginCompany;
