import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';

interface Major {
  major_id: number;
  major_code: string;
  major_name_th: string;
}

const OnboardingStudent: React.FC = () => {
  const [majors, setMajors] = useState<Major[]>([]);
  const [studentCode, setStudentCode] = useState('');
  const [selectedMajorId, setSelectedMajorId] = useState<number | ''>('');
  const [enrollmentYear, setEnrollmentYear] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Using an object for field-level errors (API Integration Pattern #2/#5 inspired)
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  
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

    const loadMasterData = async () => {
      try {
        const response = await api.get('/master-data');
        setMajors(response.majors || []);
      } catch (err) {
        console.error('Failed to load master data:', err);
        setGlobalError('ไม่สามารถเรียกข้อมูลคณะ/สาขาวิชาจากเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง');
      }
    };

    loadMasterData();
  }, [auth, navigate]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!studentCode) {
      newErrors.studentCode = 'กรุณากรอกรหัสนักศึกษา';
    } else if (!/^\d{12}-\d$/.test(studentCode.trim())) {
      newErrors.studentCode = 'รูปแบบรหัสนักศึกษาไม่ถูกต้อง ต้องเป็นตัวเลข 12 หลัก ตามด้วยขีดกลางและเลข 1 หลัก';
    }
    
    if (selectedMajorId === '') {
      newErrors.major = 'กรุณาเลือกสาขาวิชาที่สังกัด';
    }
    
    if (!enrollmentYear) {
      newErrors.enrollmentYear = 'กรุณาระบุปีการศึกษาที่เข้าศึกษา';
    }
    
    if (!password) {
      newErrors.password = 'กรุณากำหนดรหัสผ่านสำหรับการใช้งานครั้งถัดไป';
    } else if (password.length < 8) {
      newErrors.password = 'รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร';
    } else if (!/[A-Z]/.test(password)) {
      newErrors.password = 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว';
    } else if (!/[a-z]/.test(password)) {
      newErrors.password = 'รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว';
    } else if (!/[0-9]/.test(password)) {
      newErrors.password = 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว';
    }
    
    if (password !== confirmPassword) {
      newErrors.confirmPassword = 'รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน';
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
      const payload = {
        type: 'student',
        student_code: studentCode,
        major_id: Number(selectedMajorId),
        password,
        enrollment_year: Number(enrollmentYear)
      };

      await api.post('/profile/setup', payload);

      if (auth && auth.user) {
        const updatedUser = {
          ...auth.user,
          isFirstTime: false,
          hasPassword: true
        };
        auth.login(updatedUser);
        localStorage.removeItem('onboarding_type');
        navigate('/dashboard');
      }
    } catch (err) {
      setGlobalError(getErrorMessage(err, 'การบันทึกข้อมูลล้มเหลว กรุณาติดต่อผู้ดูแลระบบ'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 dark:bg-gray-950">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl shadow-lg border border-gray-100 dark:bg-gray-900 dark:border-gray-800">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-950 dark:text-white">
            ข้อมูลเริ่มต้นใช้งานสำหรับนักศึกษา
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            กรุณากรอกข้อมูลเพื่อเปิดใช้งานบัญชีผู้ใช้
          </p>
        </div>
        
        <AlertBanner variant="error" message={globalError} />

        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              รหัสนักศึกษา (Student ID)
            </label>
            <input
              type="text"
              disabled={isSubmitting}
              placeholder="กรอกรหัสนักศึกษาของคุณ"
              value={studentCode}
              onChange={(e) => {
                setStudentCode(e.target.value);
                if (errors.studentCode) setErrors(prev => ({ ...prev, studentCode: '' }));
              }}
              className={`w-full px-4 py-2 text-sm rounded-lg border focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 dark:text-white ${
                errors.studentCode 
                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' 
                : 'border-gray-200 focus:border-brand-blue focus:ring-brand-blue/20 dark:border-gray-700'
              }`}
            />
            {errors.studentCode && <p className="mt-1 text-xs text-red-500">{errors.studentCode}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              สาขาวิชา (Major)
            </label>
            <select
              disabled={isSubmitting}
              value={selectedMajorId}
              onChange={(e) => {
                setSelectedMajorId(e.target.value ? Number(e.target.value) : '');
                if (errors.major) setErrors(prev => ({ ...prev, major: '' }));
              }}
              className={`w-full px-4 py-2 text-sm rounded-lg border focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 dark:text-white cursor-pointer ${
                errors.major
                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                : 'border-gray-200 focus:border-brand-blue focus:ring-brand-blue/20 dark:border-gray-700'
              }`}
            >
              <option value="">-- กรุณาเลือกสาขาวิชา --</option>
              {majors.map((m) => (
                <option key={m.major_id} value={m.major_id}>
                  {m.major_name_th}
                </option>
              ))}
            </select>
            {errors.major && <p className="mt-1 text-xs text-red-500">{errors.major}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              ปีการศึกษาที่เข้าศึกษา (Enrollment Academic Year) *
            </label>
            <select
              disabled={isSubmitting}
              value={enrollmentYear}
              onChange={(e) => {
                setEnrollmentYear(e.target.value);
                if (errors.enrollmentYear) setErrors(prev => ({ ...prev, enrollmentYear: '' }));
              }}
              className={`w-full px-4 py-2 text-sm rounded-lg border focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 dark:text-white cursor-pointer ${
                errors.enrollmentYear
                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                : 'border-gray-200 focus:border-brand-blue focus:ring-brand-blue/20 dark:border-gray-700'
              }`}
            >
              <option value="">-- เลือกปีการศึกษา --</option>
              {[2564, 2565, 2566, 2567, 2568, 2569, 2570, 2571, 2572].map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
            {errors.enrollmentYear && <p className="mt-1 text-xs text-red-500">{errors.enrollmentYear}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              กำหนดรหัสผ่านใหม่ (New Password)
            </label>
            <input
              type="password"
              disabled={isSubmitting}
              placeholder="อย่างน้อย 8 ตัวอักษร (มีพิมพ์ใหญ่, เล็ก และตัวเลข)"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) setErrors(prev => ({ ...prev, password: '' }));
                if (errors.confirmPassword && e.target.value === confirmPassword) {
                  setErrors(prev => ({ ...prev, confirmPassword: '' }));
                }
              }}
              className={`w-full px-4 py-2 text-sm rounded-lg border focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 dark:text-white ${
                errors.password
                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                : 'border-gray-200 focus:border-brand-blue focus:ring-brand-blue/20 dark:border-gray-700'
              }`}
            />
            {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              ยืนยันรหัสผ่านใหม่ (Confirm Password)
            </label>
            <input
              type="password"
              disabled={isSubmitting}
              placeholder="กรอกรหัสผ่านอีกครั้งเพื่อยืนยัน"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.confirmPassword) setErrors(prev => ({ ...prev, confirmPassword: '' }));
              }}
              className={`w-full px-4 py-2 text-sm rounded-lg border focus:outline-none focus:ring-1 bg-white dark:bg-gray-800 dark:text-white ${
                errors.confirmPassword
                ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20'
                : 'border-gray-200 focus:border-brand-blue focus:ring-brand-blue/20 dark:border-gray-700'
              }`}
            />
            {errors.confirmPassword && <p className="mt-1 text-xs text-red-500">{errors.confirmPassword}</p>}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 mt-6 rounded-xl bg-brand-blue hover:bg-brand-navy text-white font-medium text-sm transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 disabled:opacity-50"
          >
            {isSubmitting ? 'กำลังจัดเก็บ...' : 'บันทึกข้อมูลเริ่มต้น'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default OnboardingStudent;
