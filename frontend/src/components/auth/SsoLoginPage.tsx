import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import LoginCard from './LoginCard';
import PasswordLoginForm from './PasswordLoginForm';
import { useAuthLogin } from '../../hooks/useAuthLogin';
import type { OnboardingType } from '../../hooks/useAuthLogin';
import { useGoogleSignIn } from '../../hooks/useGoogleSignIn';

const GOOGLE_BUTTON_ID = 'googleBtnContainer';

interface SsoLoginPageProps {
  onboardingType: OnboardingType;
  icon: ReactNode;
  title: string;
  subtitle: string;
  identifierLabel: string;
  identifierPlaceholder: string;
  submitLabel: string;
  firstTimeHint: ReactNode;
}

/**
 * The student and personnel login pages are the same page: sign in with the
 * university Google account, or with a password once one has been set. Only
 * the wording and where a first-time user is sent afterwards differ, so both
 * are configurations of this component rather than two near-copies.
 *
 * The company page is deliberately not built on this — external partners have
 * no university Google account, so it has no SSO half at all.
 */
export const SsoLoginPage: React.FC<SsoLoginPageProps> = ({
  onboardingType,
  icon,
  title,
  subtitle,
  identifierLabel,
  identifierPlaceholder,
  submitLabel,
  firstTimeHint,
}) => {
  const navigate = useNavigate();
  const { error, isSubmitting, loginWithPassword, loginWithGoogle, isAuthenticated } =
    useAuthLogin(onboardingType);

  useGoogleSignIn(GOOGLE_BUTTON_ID, loginWithGoogle);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard');
  }, [isAuthenticated, navigate]);

  return (
    <LoginCard icon={icon} title={title} subtitle={subtitle} error={error}>
      <div className="space-y-5">
        <div className="text-center py-2">
          <div className="flex justify-center items-center my-2 min-h-[44px]">
            <div id={GOOGLE_BUTTON_ID} className="w-full max-w-[320px] flex justify-center"></div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">หรือ</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
        </div>

        <PasswordLoginForm
          identifierType="text"
          identifierLabel={identifierLabel}
          identifierPlaceholder={identifierPlaceholder}
          submitLabel={submitLabel}
          isSubmitting={isSubmitting}
          onSubmit={loginWithPassword}
        />

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
          {firstTimeHint}
        </p>
      </div>
    </LoginCard>
  );
};

export default SsoLoginPage;
