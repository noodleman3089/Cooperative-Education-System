import React, { useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Link2Off, SearchX, ShieldX, TriangleAlert } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { AuthContext } from '../../context/AuthContext';
import { getErrorMessage, getErrorStatus } from '../../utils/errors';

/**
 * ปลายทางของลิงก์ในอีเมลพี่เลี้ยง — สาธารณะ (route `/m?token=`)
 *
 * เปิดแล้วแลกโทเค็นเป็น session ทันที แล้ว `navigate(target, { replace: true })`
 * เพื่อไม่ให้ URL ที่มี `?token=` ค้างในประวัติเบราว์เซอร์
 *
 * ⛔ **แลกได้ครั้งเดียว** — ลิงก์ใช้ครั้งเดียว ถ้าเรียกซ้ำจะได้ 410 แล้วขึ้นหน้า "ใช้ไม่ได้แล้ว" ทั้งที่
 * เข้าระบบสำเร็จไปแล้ว React StrictMode (dev) รัน effect สองรอบ จึงกันด้วย `useRef`
 * ไม่ใช้ธง `cancelled` แบบหน้าอื่น — รอบแรกถูกยกเลิก รอบสองถูก ref ข้าม = ค้างที่หน้า loading ตลอดไป
 */

type Phase = 'loading' | 'gone' | 'notfound' | 'forbidden' | 'error';

/** ปลายทางต้องเป็นพาธภายในแอปเท่านั้น — `//evil.com` หรือ `/\evil.com` เบราว์เซอร์ตีเป็นโฮสต์อื่น */
const safeTarget = (target: unknown): string =>
  typeof target === 'string' && target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\')
    ? target
    : '/dashboard';

const ResultShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen flex-col bg-gray-100 dark:bg-gray-900">
    <header className="bg-brand-navy px-5 py-4 text-white sm:px-8">
      <div className="text-sm font-semibold sm:text-base">งานสหกิจศึกษา มทร.ตะวันออก</div>
      <div className="text-xs text-blue-200">เข้าสู่ระบบพี่เลี้ยง</div>
    </header>
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 px-4 py-10 text-center sm:px-6">
      {children}
    </main>
  </div>
);

const IconBadge: React.FC<{ tone: 'gray' | 'amber' | 'red'; children: React.ReactNode }> = ({ tone, children }) => {
  const toneClass = {
    gray: 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  }[tone];
  return <div className={`flex h-16 w-16 items-center justify-center rounded-full ${toneClass}`}>{children}</div>;
};

const GoLoginLink: React.FC<{ label: string }> = ({ label }) => (
  <Link
    to="/login/mentor"
    data-testid="ml-go-login"
    className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-brand-blue px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-500/20 transition-colors hover:bg-brand-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
  >
    {label}
  </Link>
);

const MentorLinkLanding: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const auth = useContext(AuthContext);

  const [phase, setPhase] = useState<Phase>(token ? 'loading' : 'notfound');
  const [serverMessage, setServerMessage] = useState('');

  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const consumedRef = useRef(false);

  useEffect(() => {
    if (!token || consumedRef.current) return;
    consumedRef.current = true;

    (async () => {
      try {
        const res = await api.post('/auth/mentor-link/consume', { token });
        if (!res?.user) {
          setServerMessage('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
          setPhase('error');
          return;
        }
        auth?.login(res.user);
        navigate(safeTarget(res.target), { replace: true });
      } catch (err) {
        const status = getErrorStatus(err);
        if (status === 404) {
          setPhase('notfound');
        } else if (status === 410) {
          setPhase('gone');
        } else if (status === 403) {
          setServerMessage(getErrorMessage(err, ''));
          setPhase('forbidden');
        } else {
          setServerMessage(getErrorMessage(err, 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
          setPhase('error');
        }
      }
    })();
    // `auth` และ `navigate` เปลี่ยนตัวทุก render — ใส่ใน deps แล้ว effect วิ่งซ้ำ ซึ่ง ref กันไว้อยู่ แต่ไม่จำเป็นต้องฟัง
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const resend = async () => {
    setResending(true);
    setResendError(null);
    try {
      const res = await api.post('/auth/mentor-link/resend', { token });
      setResendMessage(
        typeof res?.message === 'string' && res.message.trim()
          ? res.message
          : 'ส่งลิงก์ใหม่ไปที่อีเมลของท่านแล้ว กรุณาตรวจอีเมล'
      );
    } catch (err) {
      setResendError(getErrorMessage(err, 'ส่งลิงก์ใหม่ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setResending(false);
    }
  };

  if (phase === 'loading') {
    return (
      <div
        data-testid="ml-loading"
        className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-100 px-4 dark:bg-gray-900"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" aria-hidden="true" />
        <p role="status" className="text-sm text-gray-700 dark:text-gray-200">กำลังเข้าสู่ระบบ…</p>
      </div>
    );
  }

  if (phase === 'gone') {
    return (
      <ResultShell>
        <div data-testid="ml-gone" className="flex w-full flex-col items-center gap-3">
          <IconBadge tone="amber">
            <Link2Off className="h-8 w-8" aria-hidden="true" />
          </IconBadge>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">ลิงก์ใช้ไม่ได้แล้ว</h1>
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">
            ลิงก์เข้าสู่ระบบใช้ได้ครั้งเดียวและมีอายุจำกัด ลิงก์นี้ถูกใช้ไปแล้วหรือหมดอายุแล้ว
            กดปุ่มด้านล่างเพื่อให้ระบบส่งลิงก์ใหม่ไปที่อีเมลของท่าน
          </p>

          <div className="w-full text-left" data-testid="ml-resend-feedback">
            <AlertBanner variant="success" message={resendMessage} />
            <AlertBanner variant="error" message={resendError} />
          </div>

          <Button
            size="lg"
            className="min-h-[44px]"
            data-testid="ml-resend"
            onClick={resend}
            loading={resending}
            loadingLabel="กำลังส่งลิงก์..."
          >
            {resendMessage ? 'ส่งอีกครั้ง' : 'ส่งลิงก์ใหม่ไปที่อีเมลที่ลงทะเบียนไว้'}
          </Button>
          <Link
            to="/login/mentor"
            className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-blue hover:text-brand-navy dark:text-blue-400 dark:hover:text-blue-300"
          >
            ใช้อีเมลอื่น
          </Link>
        </div>
      </ResultShell>
    );
  }

  if (phase === 'notfound') {
    return (
      <ResultShell>
        <div data-testid="ml-notfound" className="flex w-full flex-col items-center gap-3">
          <IconBadge tone="gray">
            <SearchX className="h-8 w-8" aria-hidden="true" />
          </IconBadge>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">ไม่พบลิงก์นี้</h1>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            ลิงก์ไม่ถูกต้องหรือไม่ครบ กรุณาเปิดจากปุ่มในอีเมลที่ได้รับโดยตรง
            หรือขอลิงก์ใหม่จากหน้าเข้าสู่ระบบ
          </p>
          <GoLoginLink label="ไปหน้าเข้าสู่ระบบพี่เลี้ยง" />
        </div>
      </ResultShell>
    );
  }

  if (phase === 'forbidden') {
    return (
      <ResultShell>
        <div data-testid="ml-forbidden" className="flex w-full flex-col items-center gap-3">
          <IconBadge tone="red">
            <ShieldX className="h-8 w-8" aria-hidden="true" />
          </IconBadge>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">บัญชีนี้ใช้ลิงก์นี้ไม่ได้</h1>
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">
            {serverMessage || 'บัญชีที่ผูกกับลิงก์นี้ไม่ได้รับอนุญาตให้เข้าสู่ระบบด้วยลิงก์ทางอีเมล'}
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            หากเห็นว่าไม่ถูกต้อง กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษา
          </p>
        </div>
      </ResultShell>
    );
  }

  return (
    <ResultShell>
      <div data-testid="ml-error" className="flex w-full flex-col items-center gap-3">
        <IconBadge tone="red">
          <TriangleAlert className="h-8 w-8" aria-hidden="true" />
        </IconBadge>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">เข้าสู่ระบบไม่สำเร็จ</h1>
        <div className="w-full text-left">
          <AlertBanner variant="error" message={serverMessage} />
        </div>
        <GoLoginLink label="ขอลิงก์ใหม่ที่หน้าเข้าสู่ระบบ" />
      </div>
    </ResultShell>
  );
};

export default MentorLinkLanding;
