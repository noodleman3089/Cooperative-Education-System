import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import AlertBanner from '../components/ui/AlertBanner';
import { getErrorMessage } from '../utils/errors';

const SetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const auth = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth?.isLoading && !auth?.isAuthenticated) {
      navigate('/login');
    }
  }, [auth, navigate]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!password) {
      newErrors.password = 'กรุณากำหนดรหัสผ่าน';
    } else if (password.length < 8) {
      newErrors.password = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
    } else if (!/[A-Z]/.test(password)) {
      newErrors.password = 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว';
    } else if (!/[a-z]/.test(password)) {
      newErrors.password = 'รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว';
    } else if (!/[0-9]/.test(password)) {
      newErrors.password = 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว';
    }
    
    if (password !== confirmPassword) {
      newErrors.confirmPassword = 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      await api.post('/auth/set-password', { password, confirmPassword });

      if (auth && auth.user) {
        const updatedUser = { ...auth.user, hasPassword: true };
        auth.login(updatedUser);
      }

      navigate('/dashboard');
    } catch (err) {
      setGlobalError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการตั้งรหัสผ่าน'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (auth?.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F3F4F6] dark:bg-[#111827]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] px-4 dark:bg-[#111827]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-100 dark:bg-[#1F2937] dark:border-gray-800 page-enter">
        <div className="text-center mb-8">
          <div className="mx-auto h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center text-brand-blue mb-3 dark:bg-blue-950/30 dark:text-blue-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-brand-navy dark:text-white">
            ตั้งรหัสผ่านสำหรับบัญชีของท่าน
          </h2>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            ท่านเข้าสู่ระบบด้วย Google สำเร็จแล้ว กรุณาตั้งรหัสผ่านเพื่อใช้เข้าสู่ระบบในครั้งถัดไป
          </p>
        </div>

        <AlertBanner variant="error" message={globalError} className="mb-4" />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              รหัสผ่าน
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 dark:text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                disabled={isSubmitting}
                placeholder="อย่างน้อย 8 ตัวอักษร (มีตัวพิมพ์ใหญ่, เล็ก และตัวเลข)"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors(prev => ({ ...prev, password: '' }));
                  if (errors.confirmPassword && e.target.value === confirmPassword) {
                    setErrors(prev => ({ ...prev, confirmPassword: '' }));
                  }
                }}
                className={`w-full pl-10 pr-10 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 dark:text-white transition-all ${
                  errors.password
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                  : 'border-gray-200 focus:border-brand-blue focus:ring-brand-blue/20 dark:border-gray-700'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              ยืนยันรหัสผ่าน
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 dark:text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                disabled={isSubmitting}
                placeholder="กรอกรหัสผ่านอีกครั้ง"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (errors.confirmPassword) setErrors(prev => ({ ...prev, confirmPassword: '' }));
                }}
                className={`w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 dark:text-white transition-all ${
                  errors.confirmPassword
                  ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                  : 'border-gray-200 focus:border-brand-blue focus:ring-brand-blue/20 dark:border-gray-700'
                }`}
              />
            </div>
            {errors.confirmPassword && <p className="mt-1 text-xs text-red-500">{errors.confirmPassword}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 rounded-xl bg-brand-blue hover:bg-brand-navy text-white font-medium text-sm transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 disabled:opacity-50"
          >
            {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกและเข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SetPassword;
