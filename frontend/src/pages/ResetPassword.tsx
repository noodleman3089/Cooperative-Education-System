import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';
import SetPasswordForm from '../components/auth/SetPasswordForm';

/**
 * Password reset for accounts that already have one.
 */
const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] px-4 dark:bg-[#111827]">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-100 dark:bg-[#1F2937] dark:border-gray-800 text-center">
          <p className="text-sm text-red-700 dark:text-red-400 mb-4">
            ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง หรือหมดอายุแล้ว
          </p>
          <button
            type="button"
            onClick={() => navigate('/forgot-password')}
            className="text-sm text-brand-blue hover:text-brand-navy font-medium dark:text-blue-400 dark:hover:text-blue-300"
          >
            ขอลิงก์ใหม่ทางอีเมล
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] px-4 dark:bg-[#111827]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-100 dark:bg-[#1F2937] dark:border-gray-800 page-enter">
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปหน้าเข้าสู่ระบบ
        </button>

        <div className="text-center mb-8">
          <div className="mx-auto h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center text-brand-blue mb-3 dark:bg-blue-950/30 dark:text-blue-400">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-brand-navy dark:text-white">
            ตั้งรหัสผ่านใหม่
          </h2>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            กรอกรหัสผ่านใหม่ของท่านด้านล่าง
          </p>
        </div>

        <SetPasswordForm
          token={token}
          passwordLabel="รหัสผ่านใหม่"
          confirmLabel="ยืนยันรหัสผ่านใหม่"
          submitLabel="บันทึกรหัสผ่านใหม่"
          submittingLabel="กำลังบันทึก..."
          successText="รีเซ็ตรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่"
          continueLabel="ไปหน้าเข้าสู่ระบบ"
          onContinue={() => navigate('/login')}
        />
      </div>
    </div>
  );
};

export default ResetPassword;
