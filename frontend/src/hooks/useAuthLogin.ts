import { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { getErrorMessage } from '../utils/errors';

/**
 * The two ways into the system, shared by every login page.
 *
 * Where a first-time Google user lands is the only thing that differs between
 * the student and personnel pages, so it is a parameter rather than a copy of
 * the whole flow.
 */
export type OnboardingType = 'student' | 'personnel';

export const useAuthLogin = (onboardingType?: OnboardingType) => {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const auth = useContext(AuthContext);
  const navigate = useNavigate();

  const loginWithPassword = async (email: string, password: string) => {
    if (!email || !password) {
      setError('กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await api.post('/auth/login', { email, password });
      if (auth && response.user) {
        auth.login(response.user);
        navigate('/dashboard');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'การเข้าสู่ระบบล้มเหลว กรุณาตรวจสอบข้อมูล'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const loginWithGoogle = async (credential: string) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.post('/auth/google', { token: credential });
      if (!auth || !res.user) return;

      auth.login({ ...res.user, isFirstTime: res.isFirstTime, hasPassword: res.hasPassword });

      if (res.isFirstTime && onboardingType) {
        localStorage.setItem('onboarding_type', onboardingType);
        navigate(`/onboarding/${onboardingType}`);
      } else if (!res.hasPassword) {
        navigate('/set-password');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Google SSO ล้มเหลว กรุณาตรวจสอบการตั้งค่าบัญชี'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return { error, setError, isSubmitting, loginWithPassword, loginWithGoogle, isAuthenticated: !!auth?.isAuthenticated };
};
