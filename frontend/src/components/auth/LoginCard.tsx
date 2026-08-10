import React from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import AlertBanner from '../ui/AlertBanner';

interface LoginCardProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  error?: string | null;
  children: ReactNode;
  /** Omit on the selection page itself; every other login page goes back to it. */
  backTo?: string;
  backLabel?: string;
}

/**
 * The card every login page sits in. Extracted because the three pages had
 * drifted apart — same structure, three sets of paddings and radii — which made
 * any visual change a three-file edit that was easy to leave half-done.
 */
export const LoginCard: React.FC<LoginCardProps> = ({
  icon,
  title,
  subtitle,
  error,
  children,
  backTo = '/login',
  backLabel = 'ย้อนกลับไปหน้าเลือกสถานะ',
}) => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] px-4 dark:bg-[#111827]">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-gray-100 dark:bg-[#1F2937] dark:border-gray-800 page-enter">
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </button>

        <div className="text-center mb-8">
          <div className="mx-auto h-12 w-12 rounded-full bg-blue-50 flex items-center justify-center text-brand-blue mb-3 dark:bg-blue-950/30 dark:text-blue-400">
            {icon}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-brand-navy dark:text-white">
            {title}
          </h2>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>

        <AlertBanner variant="error" message={error} className="mb-4" />

        {children}
      </div>
    </div>
  );
};

export default LoginCard;
