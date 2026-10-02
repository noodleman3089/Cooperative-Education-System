import React, { useContext, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail } from 'lucide-react';
import LoginCard from '../components/auth/LoginCard';
import AlertBanner from '../components/ui/AlertBanner';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import { getErrorMessage } from '../utils/errors';

/**
 * ทางเข้าของพี่เลี้ยง — กรอกอีเมลแล้วระบบส่งลิงก์เข้าสู่ระบบ (ใช้ครั้งเดียว) ไปให้ทางอีเมล
 *
 * ไม่มีรหัสผ่านบนหน้านี้ · คำตอบของเซิร์ฟเวอร์เป็นข้อความเดียวกันเสมอไม่ว่าอีเมลจะมีในระบบหรือไม่
 * (กันการไล่เดาอีเมล) จึงแสดงตามที่ได้รับ ไม่แต่งข้อความเอง
 * ลิงก์ในอีเมลเปิดที่ `/m?token=` (MentorLinkLanding)
 */
const LoginMentor: React.FC = () => {
  const navigate = useNavigate();
  const auth = useContext(AuthContext);
  const isAuthenticated = !!auth?.isAuthenticated;

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard');
  }, [isAuthenticated, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError('กรุณากรอกอีเมลที่ลงทะเบียนไว้');
      return;
    }
    setSending(true);
    setError(null);
    setSentMessage(null);
    try {
      const res = await api.post('/auth/mentor-link/request', { email: trimmed });
      setSentMessage(
        typeof res?.message === 'string' && res.message.trim()
          ? res.message
          : 'หากอีเมลนี้ลงทะเบียนไว้ ระบบได้ส่งลิงก์เข้าสู่ระบบไปให้แล้ว'
      );
    } catch (err) {
      setError(getErrorMessage(err, 'ส่งลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setSending(false);
    }
  };

  return (
    <LoginCard
      icon={<Mail className="h-6 w-6" />}
      title="เข้าสู่ระบบพี่เลี้ยง"
      subtitle="กรอกอีเมลที่ลงทะเบียนไว้ ระบบจะส่งลิงก์เข้าสู่ระบบให้ทางอีเมล"
      error={error}
      backTo="/login"
      backLabel="ย้อนกลับไปหน้าเลือกสถานะ"
    >
      <form onSubmit={submit} className="space-y-4" data-testid="login-mentor-form">
        <div>
          <label
            htmlFor="login-mentor-email"
            className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400"
          >
            อีเมลพี่เลี้ยง
          </label>
          <Input
            id="login-mentor-email"
            data-testid="login-mentor-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            disabled={sending}
            placeholder="กรอกอีเมลที่ลงทะเบียนไว้"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-[44px]"
          />
        </div>

        <AlertBanner variant="success" message={sentMessage} />

        <Button
          type="submit"
          size="lg"
          className="min-h-[44px]"
          data-testid="login-mentor-submit"
          loading={sending}
          loadingLabel="กำลังส่งลิงก์..."
        >
          {sentMessage ? 'ส่งอีกครั้ง' : 'ส่งลิงก์เข้าสู่ระบบ'}
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-gray-600 dark:text-gray-400">
        <Link
          to="/login/company"
          className="font-medium text-brand-blue hover:text-brand-navy dark:text-blue-400 dark:hover:text-blue-300"
        >
          เข้าสู่ระบบด้วยรหัสผ่าน
        </Link>
      </p>
    </LoginCard>
  );
};

export default LoginMentor;
