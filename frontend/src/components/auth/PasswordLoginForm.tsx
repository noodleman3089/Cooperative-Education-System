import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';

interface PasswordLoginFormProps {
  /**
   * Students may type a student code instead of an address, and personnel sign
   * in with a bare username, so those pages need `text`. Only the company form
   * is a strict address. E2E selects the field by this type — keep it stable.
   */
  identifierType?: 'text' | 'email';
  identifierLabel: string;
  identifierPlaceholder: string;
  submitLabel: string;
  isSubmitting: boolean;
  onSubmit: (identifier: string, password: string) => void;
}

/**
 * The identifier + password pair shared by all three login pages. The submit
 * button here is the only `type="submit"` on any of them; every other control
 * is `type="button"` so a click on "log in" is never ambiguous.
 */
export const PasswordLoginForm: React.FC<PasswordLoginFormProps> = ({
  identifierType = 'text',
  identifierLabel,
  identifierPlaceholder,
  submitLabel,
  isSubmitting,
  onSubmit,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const inputClass =
    'w-full pl-10 py-2.5 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue/20 bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white transition-all';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(identifier, password);
      }}
      className="space-y-4"
    >
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          {identifierLabel}
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type={identifierType}
            required
            disabled={isSubmitting}
            placeholder={identifierPlaceholder}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className={`${inputClass} pr-4`}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          รหัสผ่าน
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type={showPassword ? 'text' : 'password'}
            required
            disabled={isSubmitting}
            placeholder="กรอกรหัสผ่านของท่าน"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="text-right">
        <button
          type="button"
          onClick={() => navigate('/forgot-password')}
          className="text-xs text-brand-blue hover:text-brand-navy font-medium transition-colors dark:text-blue-400 dark:hover:text-blue-300"
        >
          ลืมรหัสผ่าน?
        </button>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-2.5 px-4 rounded-xl bg-brand-blue hover:bg-brand-navy text-white font-medium text-sm transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 disabled:opacity-50"
      >
        {isSubmitting ? 'กำลังประมวลผล...' : submitLabel}
      </button>
    </form>
  );
};

export default PasswordLoginForm;
