import React from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type AlertVariant = 'error' | 'success' | 'info' | 'warning';

const VARIANTS: Record<AlertVariant, { Icon: typeof AlertCircle; box: string; icon: string }> = {
  error: {
    Icon: AlertCircle,
    box: 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-800/50 dark:text-red-400',
    icon: 'text-red-500',
  },
  success: {
    Icon: CheckCircle2,
    box: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800/50 dark:text-emerald-400',
    icon: 'text-emerald-500',
  },
  info: {
    Icon: Info,
    box: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800/50 dark:text-blue-400',
    icon: 'text-blue-500',
  },
  // ไม่ใช่ error แต่ก็ไม่ใช่ข่าวดี — "มีบางอย่างยังไม่ได้ตั้งค่า ระบบจึงยังไม่บังคับกฎ"
  // amber-800 บนพื้น amber-50 ผ่าน 4.5:1 ส่วน amber-400 บนพื้นมืดผ่านเช่นกัน
  warning: {
    Icon: AlertTriangle,
    box: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800/50 dark:text-amber-400',
    icon: 'text-amber-600 dark:text-amber-500',
  },
};

interface AlertBannerProps {
  variant: AlertVariant;
  /** Renders nothing when empty, so call sites need no `{error && ...}` wrapper. */
  message?: ReactNode;
  /** Layout only — margins the surrounding page needs. Appearance lives here. */
  className?: string;
}

/**
 * The one error/success/info banner. Every screen used to write its own, and
 * they had diverged into a dozen shapes — rounded-lg vs rounded-xl, p-3 vs p-4,
 * with a border or a ring or neither, some with an icon. Restyling feedback
 * meant finding all fifty of them, so in practice it never happened evenly.
 */
export const AlertBanner: React.FC<AlertBannerProps> = ({ variant, message, className = '' }) => {
  if (!message) return null;

  const { Icon, box, icon } = VARIANTS[variant];

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${box} ${className}`.trim()}
    >
      <Icon className={`h-5 w-5 shrink-0 ${icon}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">{message}</div>
    </div>
  );
};

export default AlertBanner;
