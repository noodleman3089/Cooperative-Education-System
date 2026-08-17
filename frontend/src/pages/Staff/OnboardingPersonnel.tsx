import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';
import { Input } from '../../components/ui/Input';

const OnboardingPersonnel: React.FC = () => {
  const [employeeCode, setEmployeeCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const auth = useContext(AuthContext);
  const navigate = useNavigate();
  
  useEffect(() => {
    const storedUserStr = localStorage.getItem('auth_user');
    const isFirstTime = storedUserStr ? JSON.parse(storedUserStr).isFirstTime : false;
    
    if (!auth?.isAuthenticated) {
      navigate('/login');
      return;
    }

    if (!isFirstTime || auth?.user?.roles?.includes('dean')) {
      navigate('/dashboard');
      return;
    }
  }, [auth, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!employeeCode) {
      setError('กรุณากรอกรหัสประจำตัวบุคลากร');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const response = await api.post('/auth/claim-personnel', { employee_code: employeeCode });
      if (auth && response.user) {
        // The server re-issued the session cookie with the newly granted role.
        auth.login({ ...response.user, isFirstTime: false });
        localStorage.removeItem('onboarding_type');
        navigate('/dashboard');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'การยืนยันตัวตนล้มเหลว กรุณาตรวจสอบรหัสบุคลากร'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 dark:bg-gray-950">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl shadow-lg border border-gray-100 dark:bg-gray-900 dark:border-gray-800">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-950 dark:text-white">
            ข้อมูลเริ่มต้นใช้งานสำหรับบุคลากร
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            กรุณากรอกข้อมูลเพื่อเปิดใช้งานบัญชีผู้ใช้
          </p>
        </div>
        
        <AlertBanner variant="error" message={error} />

        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              รหัสประจำตัวบุคลากร (Employee ID)
            </label>
            <Input
              type="text"
              required
              disabled={isSubmitting}
              placeholder="กรอกรหัสประจำตัวบุคลากรของคุณ"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value)}
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              หากระบบไม่พบรหัสของคุณ กรุณาติดต่อเจ้าหน้าที่สหกิจเพื่ออัปโหลดรายชื่อเข้าสู่ระบบ
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 mt-6 rounded-xl bg-brand-blue hover:bg-brand-navy text-white font-medium text-sm transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 disabled:opacity-50"
          >
            {isSubmitting ? 'กำลังตรวจสอบ...' : 'ยืนยันตัวตน'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default OnboardingPersonnel;
