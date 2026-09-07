import React from 'react';
import { GraduationCap } from 'lucide-react';
import SsoLoginPage from '../components/auth/SsoLoginPage';

const LoginStudent: React.FC = () => (
  <SsoLoginPage
    onboardingType="student"
    icon={<GraduationCap className="h-6 w-6" />}
    title="เข้าสู่ระบบสำหรับนักศึกษา"
    subtitle="เข้าสู่ระบบเพื่อดำเนินงานสหกิจศึกษา"
    identifierLabel="อีเมลมหาวิทยาลัย หรือ รหัสนักศึกษา"
    identifierPlaceholder="กรอกอีเมลนักศึกษา"
    submitLabel="เข้าสู่ระบบ"
  />
);

export default LoginStudent;
