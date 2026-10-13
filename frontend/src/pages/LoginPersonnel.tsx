import React from 'react';
import { Users } from 'lucide-react';
import SsoLoginPage from '../components/auth/SsoLoginPage';

const LoginPersonnel: React.FC = () => (
  <SsoLoginPage
    onboardingType="personnel"
    icon={<Users className="h-6 w-6" />}
    title="เข้าสู่ระบบสำหรับบุคลากร"
    subtitle="อาจารย์ที่ปรึกษา อาจารย์นิเทศ หัวหน้าสาขาวิชา เจ้าหน้าที่งานสหกิจศึกษา และคณบดี"
    identifierLabel="อีเมลของบุคลากร (Email)"
    identifierPlaceholder="กรอกอีเมลบุคลากร"
    submitLabel="เข้าสู่ระบบบุคลากร"
  />
);

export default LoginPersonnel;
