import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Mail, ArrowLeft, KeyRound } from 'lucide-react';
import AlertBanner from '../components/ui/AlertBanner';
import { getErrorMessage } from '../utils/errors';

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('กรุณากรอกอีเมล');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await api.post('/auth/forgot-password', { email: email.trim() });
      setSuccess(res.message || 'ระบบส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของท่านแล้ว');
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] px-4 dark:bg-[#111827]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-100 dark:bg-[#1F2937] dark:border-gray-800 page-enter">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          ย้อนกลับ
        </button>

        <div className="text-center mb-8">
          <div className="mx-auto h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center text-brand-blue mb-3 dark:bg-blue-950/30 dark:text-blue-400">
            <KeyRound className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-brand-navy dark:text-white">
            ลืมรหัสผ่าน
          </h2>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            กรอกอีเมลที่ใช้ลงทะเบียน ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้ท่าน
          </p>
        </div>

        <AlertBanner variant="error" message={error} className="mb-4" />

        {success ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">
              {success}
            </div>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="w-full py-2.5 px-4 rounded-xl bg-brand-blue hover:bg-brand-navy text-white font-medium text-sm transition-all"
            >
              กลับไปหน้าเข้าสู่ระบบ
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                อีเมล
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 dark:text-gray-400" />
                <input
                  type="email"
                  required
                  disabled={isSubmitting}
                  placeholder="กรอกอีเมลของท่าน"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/20 bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 rounded-xl bg-brand-blue hover:bg-brand-navy text-white font-medium text-sm transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 disabled:opacity-50"
            >
              {isSubmitting ? 'กำลังส่ง...' : 'ส่งลิงก์รีเซ็ตรหัสผ่าน'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
