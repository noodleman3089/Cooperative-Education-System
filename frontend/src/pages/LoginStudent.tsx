import React from 'react';
import { GraduationCap } from 'lucide-react';
import SsoLoginPage from '../components/auth/SsoLoginPage';

const LoginStudent: React.FC = () => (
  <SsoLoginPage
    onboardingType="student"
    icon={<GraduationCap className="h-6 w-6" />}
    title="เข้าสู่ระบบสำหรับนักศึกษา"
    subtitle="ลงชื่อเข้าใช้งานด้วยอีเมลมหาวิทยาลัย (@rmutto.ac.th) เพื่อดำเนินงานสหกิจศึกษา"
    identifierLabel="อีเมลมหาวิทยาลัย หรือ รหัสนักศึกษา"
    identifierPlaceholder="กรอกอีเมลนักศึกษา"
    submitLabel="เข้าสู่ระบบ"
    firstTimeHint={
      <>
        หากเข้าสู่ระบบเป็น<span className="font-semibold text-brand-blue dark:text-blue-400">ครั้งแรก</span> กรุณาใช้{' '}
        <span className="font-semibold">Sign in with Google</span> ด้วยอีเมลมหาวิทยาลัย เพื่อเปิดใช้งานบัญชี
      </>
    }
  />
);

export default LoginStudent;
