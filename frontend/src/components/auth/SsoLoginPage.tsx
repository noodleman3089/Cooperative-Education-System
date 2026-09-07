import React, { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, AlertTriangle } from 'lucide-react';
import LoginCard from './LoginCard';
import PasswordLoginForm from './PasswordLoginForm';
import { useAuthLogin } from '../../hooks/useAuthLogin';
import type { OnboardingType } from '../../hooks/useAuthLogin';
import { useGoogleSignIn } from '../../hooks/useGoogleSignIn';

const GOOGLE_BUTTON_ID = 'googleBtnContainer';

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
  </svg>
);

interface SsoLoginPageProps {
  onboardingType: OnboardingType;
  icon: ReactNode;
  title: string;
  subtitle: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  submitLabel: string;
  firstTimeHint?: ReactNode;
}

/**
 * The student and personnel login pages are the same page: sign in with the
 * university Google account, or with a password once one has been set.
 *
 * To avoid the common point of confusion where first-time users attempt to log
 * in with a password (which they do not possess yet), the two paths are strictly
 * divided into tabs. First-time users default to Google SSO with helper text,
 * while password login carries an amber notice guiding new users back to Google SSO.
 */
export const SsoLoginPage: React.FC<SsoLoginPageProps> = ({
  onboardingType,
  icon,
  title,
  subtitle,
  identifierLabel,
  identifierPlaceholder,
  submitLabel,
}) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'sso' | 'pwd'>('sso');
  const { error, isSubmitting, loginWithPassword, loginWithGoogle, isAuthenticated } =
    useAuthLogin(onboardingType);

  useGoogleSignIn(GOOGLE_BUTTON_ID, loginWithGoogle);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard');
  }, [isAuthenticated, navigate]);

  return (
    <LoginCard icon={icon} title={title} subtitle={subtitle} error={error}>
      <div className="space-y-5">
        {/* 2 Clear Tabs to prevent confusion between Google SSO and password */}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setActiveTab('sso')}
            className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-all ${
              activeTab === 'sso'
                ? 'bg-white text-brand-navy shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            <GoogleIcon className="h-3.5 w-3.5" />
            เข้าด้วย Google (แนะนำ)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pwd')}
            className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-all ${
              activeTab === 'pwd'
                ? 'bg-white text-brand-navy shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5 text-amber-500" />
            รหัสผ่านเฉพาะระบบ
          </button>
        </div>

        {/* TAB 1: Google SSO (Default & ONLY path for first-time users) */}
        <div className={activeTab === 'sso' ? 'space-y-4 py-2' : 'hidden'}>
          <div className="flex justify-center items-center my-2 min-h-[44px]">
            <div id={GOOGLE_BUTTON_ID} className="w-full max-w-[320px] flex justify-center"></div>
          </div>
          <p className="text-center text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            ใช้อีเมลมหาวิทยาลัย (@rmutto.ac.th) ในการเข้าสู่ระบบ
          </p>
        </div>

        {/* TAB 2: Password Login (Only for users who previously set a local password) */}
        <div className={activeTab === 'pwd' ? 'space-y-4' : 'hidden'}>
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">เฉพาะผู้ที่เคยตั้งรหัสผ่านในระบบนี้แล้วเท่านั้น</p>
                <p className="text-amber-700/90 dark:text-amber-300/80 leading-relaxed">
                  หากเข้าใช้งานเป็นครั้งแรก <strong>จะยังไม่มีรหัสผ่านในระบบ</strong> กรุณาเลือก{' '}
                  <button
                    type="button"
                    onClick={() => setActiveTab('sso')}
                    className="font-bold underline text-brand-navy dark:text-blue-300 hover:text-blue-700"
                  >
                    เข้าด้วย Google
                  </button>{' '}
                  เพื่อเปิดใช้งานบัญชี
                </p>
              </div>
            </div>
          </div>

          <PasswordLoginForm
            identifierType="text"
            identifierLabel={identifierLabel}
            identifierPlaceholder={identifierPlaceholder}
            submitLabel={submitLabel}
            isSubmitting={isSubmitting}
            onSubmit={loginWithPassword}
          />
        </div>
      </div>
    </LoginCard>
  );
};

export default SsoLoginPage;
