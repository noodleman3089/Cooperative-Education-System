import React from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-blue text-white hover:bg-brand-navy shadow-sm shadow-blue-500/20 hover:shadow-blue-500/30',
  secondary:
    'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-500/20',
  // emerald-700, not -600: white on emerald-600 measures 3.65:1, under the 4.5:1
  // AA needs for normal-size text, and these are live buttons so the disabled
  // exemption in WCAG 1.4.3 does not apply. -700 gives about 5.2:1.
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm shadow-emerald-500/20',
  ghost:
    'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'w-full px-4 py-3 text-sm gap-2',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the label for a spinner and disables the button. */
  loading?: boolean;
  /** Shown in place of children while `loading`. */
  loadingLabel?: string;
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * There were 55 primary buttons written by hand, in 44 different class strings.
 * They disagreed about the hover colour (bg-blue-600 or bg-brand-navy), the
 * radius (lg, xl or full), the weight (bold or medium) and whether pressing one
 * did anything visible at all. None of that was a decision; it was just what
 * whoever wrote that screen happened to type.
 *
 * `type` defaults to "button". A button inside a form that forgets to say so
 * submits it, which is a bug that only shows up once someone presses Enter.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center rounded-xl font-semibold transition-all cursor-pointer active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim()}
    {...rest}
  >
    {loading ? (
      <>
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
        {loadingLabel ?? children}
      </>
    ) : (
      <>
        {icon}
        {children}
      </>
    )}
  </button>
);

export default Button;
