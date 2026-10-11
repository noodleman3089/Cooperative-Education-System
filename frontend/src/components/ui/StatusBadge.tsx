import React from 'react';

import { lookup, type Tone, type StatusDomain } from './statusLabels';

export type { StatusDomain, Tone };

const TONES: Record<Tone, string> = {
  waiting: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50',
  progress: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50',
  review: 'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-900/50',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50',
  rejected: 'bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50',
  neutral: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
};

interface StatusBadgeProps {
  status: string;
  /** ระบุเมื่อ key ของโดเมนนี้ชนกับโดเมนอื่น — ดู DOMAIN_OVERRIDES */
  domain?: StatusDomain;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, domain, className = '' }) => {
  const known = lookup(status, domain);

  // An unmapped status is a gap in this table, not something to dress up as a
  // label. Showing the raw value keeps it diagnosable instead of inventing
  // Thai for a state nobody has named yet.
  const { text, tone } = known ?? { text: status, tone: 'neutral' as Tone };

  return (
    <span
      title={known ? undefined : `สถานะที่ยังไม่ได้กำหนดคำอธิบาย: ${status}`}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap ${TONES[tone]} ${className}`.trim()}
    >
      {text}
    </span>
  );
};

export default StatusBadge;
