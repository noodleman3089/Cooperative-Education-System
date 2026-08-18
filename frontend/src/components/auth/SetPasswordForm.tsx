import React, { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';

interface SetPasswordFormProps {
  token: string;
  passwordLabel: string;
  confirmLabel: string;
  submitLabel: string;
  submittingLabel: string;
  successText: string;
  continueLabel: string;
  onContinue: () => void;
}

/**
 * Choosing a password against a one-time token. Shared by the password reset
 * page and by the company login page when it is reached from an invitation
 * link — both post to the same endpoint, which clears the token on use.
 */
export const SetPasswordForm: React.FC<SetPasswordFormProps> = ({
  token,
  passwordLabel,
  confirmLabel,
  submitLabel,
  submittingLabel,
  successText,
  continueLabel,
  onContinue,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputClass =
    'w-full pl-10 py-2.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/20 bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white transition-all';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (password !== confirmPassword) {
      setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/auth/reset-password', { token, password, confirmPassword });
      setSuccess(true);
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการตั้งรหัสผ่าน'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{successText}</p>
        <button
          type="button"
          onClick={onContinue}
          className="w-full py-2.5 px-4 rounded-xl bg-brand-blue hover:bg-brand-navy text-white font-medium text-sm transition-all"
        >
          {continueLabel}
        </button>
      </div>
    );
  }

  return (
    <>
      <AlertBanner variant="error" message={error} className="mb-4" />

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            {passwordLabel}
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 dark:text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              disabled={isSubmitting}
              placeholder="อย่างน้อย 8 ตัวอักษร"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            {confirmLabel}
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-600 dark:text-gray-400" />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              disabled={isSubmitting}
              placeholder="กรอกรหัสผ่านอีกครั้ง"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={`${inputClass} pr-4`}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 rounded-xl bg-brand-blue hover:bg-brand-navy text-white font-medium text-sm transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 disabled:opacity-50"
        >
          {isSubmitting ? submittingLabel : submitLabel}
        </button>
      </form>
    </>
  );
};

export default SetPasswordForm;
