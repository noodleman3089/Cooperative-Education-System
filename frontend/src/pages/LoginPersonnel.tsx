import React from 'react';
import { Users } from 'lucide-react';
import SsoLoginPage from '../components/auth/SsoLoginPage';

const LoginPersonnel: React.FC = () => (
  <SsoLoginPage
    onboardingType="personnel"
    icon={<Users className="h-6 w-6" />}
    title="เข้าสู่ระบบสำหรับบุคลากร"
    subtitle="อาจารย์ที่ปรึกษา, เจ้าหน้าที่ดูแลงานสหกิจศึกษา และคณบดี"
    identifierLabel="อีเมลของบุคลากร (Email)"
    identifierPlaceholder="กรอกอีเมลบุคลากร"
    submitLabel="เข้าสู่ระบบบุคลากร"
    firstTimeHint={
      <>
        หากเข้าสู่ระบบเป็น<span className="font-semibold text-brand-blue dark:text-blue-400">ครั้งแรก</span> กรุณาใช้{' '}
        <span className="font-semibold">Sign in with Google</span> ด้วยอีเมลมหาวิทยาลัยเพื่อเปิดใช้งานและยืนยันสิทธิ์บัญชีผู้ใช้
      </>
    }
  />
);

export default LoginPersonnel;
