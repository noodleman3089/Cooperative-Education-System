import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ExternalLink, FileText, Link2Off, SearchX, Upload, User } from 'lucide-react';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import PageSkeleton from '../../components/ui/Skeleton';
import { Input, Textarea } from '../../components/ui/Input';
import { getErrorMessage, getErrorStatus } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';

/**
 * หน้าลิงก์ตอบรับของสถานประกอบการ — สาธารณะ ไม่ต้องล็อกอิน (route `/accept?token=`)
 *
 * คอมโพเนนต์เดียวปรับตามจอ: จอกว้าง (lg+) = แผงเอกสารซ้าย + ฟอร์มทีละขั้นขวา (แบบ C)
 * จอแคบ = ทีละขั้น แผงเอกสารกลายเป็นลิงก์เปิดไฟล์ (แบบ B)
 *
 * ⛔ ไม่มีสหกิจ 03 บนหน้านี้ (ใบสั่งงาน D3) · ⛔ ไม่มีปุ่ม "ขอลิงก์ใหม่" — ลิงก์ต้องมาจากนักศึกษา
 */

interface StudentCard {
  full_name: string;
  student_code: string;
  major_name_th: string;
  faculty_name_th: string;
  semester_label: string;
  email: string;
}

type Phase = 'loading' | 'form' | 'sent' | 'gone' | 'notfound' | 'loaderror';
type Decision = '' | 'accept' | 'decline';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

const formatThaiDateTime = (d: Date): string =>
  new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(d);

const Field: React.FC<{ id: string; label: string; required?: boolean; className?: string; children: React.ReactNode }> = ({
  id, label, required, className = '', children,
}) => (
  <div className={className}>
    <label htmlFor={id} className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">
      {label}
      {required && <span className="text-red-600 dark:text-red-400"> *</span>}
    </label>
    {children}
  </div>
);

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800 ${className}`}>
    {children}
  </div>
);

/** หน้าผลลัพธ์เต็มจอ (ส่งแล้ว · ใช้ไม่ได้ · ไม่พบ) */
const ResultShell: React.FC<{ children: React.ReactNode; subtitle: string }> = ({ children, subtitle }) => (
  <div className="flex min-h-screen flex-col bg-gray-100 dark:bg-gray-900">
    <header className="bg-brand-navy px-5 py-4 text-white sm:px-8">
      <div className="text-sm font-semibold sm:text-base">งานสหกิจศึกษา มทร.ตะวันออก</div>
      <div className="text-xs text-blue-200">{subtitle}</div>
    </header>
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center gap-4 px-6 py-10 text-center">
      {children}
    </main>
  </div>
);

const AcceptanceLink: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const q = `token=${encodeURIComponent(token)}`;

  const [phase, setPhase] = useState<Phase>(token ? 'loading' : 'notfound');
  const [serverMessage, setServerMessage] = useState('');

  const [student, setStudent] = useState<StudentCard | null>(null);
  const [hasResume, setHasResume] = useState(false);
  const [companyNameTh, setCompanyNameTh] = useState('');
  const [expiresText, setExpiresText] = useState('');

  const [decision, setDecision] = useState<Decision>('');
  const [declineReason, setDeclineReason] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerPosition, setSignerPosition] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [evidence, setEvidence] = useState<File | null>(null);

  const [docTab, setDocTab] = useState<'cover' | 'form' | 'student'>('cover');
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sentInfo, setSentInfo] = useState<{ decision: Decision; at: string; message: string } | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/public/acceptance?${q}`);
        if (cancelled) return;
        const s = data.student ?? {};
        setStudent({
          full_name: asText(s.full_name),
          student_code: asText(s.student_code),
          major_name_th: asText(s.major_name_th),
          faculty_name_th: asText(s.faculty_name_th),
          semester_label: asText(s.semester_label),
          email: asText(s.email),
        });
        setHasResume(Boolean(data.has_resume));
        const c = data.company ?? {};
        setCompanyNameTh(asText(c.name_th));
        if (data.token_expires_at) {
          const exp = new Date(data.token_expires_at);
          if (!Number.isNaN(exp.getTime())) {
            setExpiresText(
              new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(exp)
            );
          }
        }
        setPhase('form');
      } catch (err) {
        if (cancelled) return;
        const status = getErrorStatus(err);
        if (status === 404) {
          setPhase('notfound');
        } else if (status === 410) {
          setServerMessage(getErrorMessage(err, ''));
          setPhase('gone');
        } else {
          setServerMessage(getErrorMessage(err, 'เปิดหน้านี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
          setPhase('loaderror');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, q]);

  // แถบ error อยู่ในการ์ดฟอร์ม — เลื่อนไปหาเสมอ ไม่งั้นบนมือถือคือกดแล้วไม่มีอะไรเกิดขึ้น
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  const fail = useCallback((msg: string) => setError(msg), []);

  const validate = (): string | null => {
    if (decision === '') return 'กรุณาเลือกว่าจะรับหรือไม่รับนักศึกษาคนนี้';
    if (decision === 'decline') return declineReason.trim() ? null : 'กรุณาระบุเหตุผลที่ไม่รับนักศึกษา';
    if (!signerName.trim()) return 'กรุณากรอกชื่อผู้ลงนาม';
    if (!signerPosition.trim()) return 'กรุณากรอกตำแหน่งผู้ลงนาม';
    if (!signedDate) return 'กรุณาเลือกวันที่ลงนาม';
    if (!startDate) return 'กรุณาเลือกวันเริ่มปฏิบัติงาน';
    if (!evidence) return 'กรุณาแนบเอกสาร 2 ที่ลงนามและประทับตราแล้ว';
    if (evidence.size > MAX_FILE_BYTES) return 'ไฟล์ใหญ่เกิน 10 MB กรุณาลดขนาดไฟล์แล้วแนบใหม่';
    return null;
  };

  const openConfirm = () => {
    const problem = validate();
    if (problem) return fail(problem);
    setError(null);
    setConfirmOpen(true);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (decision === 'decline') {
        const res = await api.post(`/public/acceptance/decline?${q}`, { reason: declineReason.trim() });
        setSentInfo({ decision, at: formatThaiDateTime(new Date()), message: asText(res?.message) });
      } else {
        const fd = new FormData();
        if (evidence) fd.append('evidence', evidence);
        fd.append('signer_name', signerName.trim());
        fd.append('signer_position', signerPosition.trim());
        fd.append('signed_date', signedDate);
        fd.append('start_date', startDate);
        const res = await api.post(`/public/acceptance/accept?${q}`, fd);
        setSentInfo({
          decision,
          at: formatThaiDateTime(new Date()),
          message: asText(res?.message),
        });
      }
      setConfirmOpen(false);
      setPhase('sent');
    } catch (err) {
      setConfirmOpen(false);
      const status = getErrorStatus(err);
      if (status === 404) {
        setPhase('notfound');
      } else if (status === 410) {
        setServerMessage(getErrorMessage(err, ''));
        setPhase('gone');
      } else {
        setError(getErrorMessage(err, 'ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fileUrl = (name: 'cover-letter' | 'acceptance-form' | 'resume') => `${API_BASE_URL}/public/acceptance/${name}?${q}`;

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6 dark:bg-gray-900">
        <div className="w-full max-w-3xl">
          <PageSkeleton variant="form" />
        </div>
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <ResultShell subtitle="ตอบรับนักศึกษา">
        <div data-testid="al-notfound" className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <SearchX className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">ไม่พบลิงก์นี้</h1>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            ลิงก์ไม่ถูกต้องหรือไม่ครบ กรุณาเปิดจากปุ่มในอีเมลที่ได้รับโดยตรง
            หากยังเปิดไม่ได้ กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษา
          </p>
        </div>
      </ResultShell>
    );
  }

  if (phase === 'gone') {
    return (
      <ResultShell subtitle="ตอบรับนักศึกษา">
        <div data-testid="al-gone" className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
            <Link2Off className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">ลิงก์นี้ใช้งานไม่ได้แล้ว</h1>
          {/* ข้อความจากเซิร์ฟเวอร์บอกสาเหตุเฉพาะอยู่แล้ว — ข้อความทั่วไปแสดงเมื่อไม่มีเท่านั้น ไม่งั้นอ่านซ้ำสองย่อหน้า */}
          <p data-testid="al-gone-message" className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">
            {serverMessage ||
              'ลิงก์อาจใช้ตอบไปแล้ว หมดอายุ หรือถูกยกเลิกเมื่อนักศึกษาส่งลิงก์ใหม่ หากต้องการตอบหรือแก้ไขคำตอบ กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษา'}
          </p>
        </div>
      </ResultShell>
    );
  }

  if (phase === 'loaderror') {
    return (
      <ResultShell subtitle="ตอบรับนักศึกษา">
        <div className="w-full text-left" data-testid="al-error">
          <AlertBanner variant="error" message={serverMessage} />
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          ลองเปิดลิงก์ใหม่อีกครั้ง หากยังไม่ได้ กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษา
        </p>
      </ResultShell>
    );
  }

  if (phase === 'sent' && sentInfo) {
    const accepted = sentInfo.decision === 'accept';
    return (
      <ResultShell subtitle="ส่งเรียบร้อย">
        <div data-testid="al-done" className="flex w-full flex-col items-center gap-4">
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400">
            <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {accepted ? 'ได้รับการตอบรับแล้ว ขอบคุณครับ/ค่ะ' : 'ได้รับคำตอบแล้ว ขอบคุณครับ/ค่ะ'}
          </h1>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {accepted
              ? 'เจ้าหน้าที่งานสหกิจศึกษาจะตรวจเอกสาร แล้วแจ้งนักศึกษาต่อ'
              : 'ระบบได้แจ้งนักศึกษาแล้วว่าสถานประกอบการไม่รับในครั้งนี้'}
          </p>
          <div className="w-full space-y-1.5 rounded-2xl border border-gray-200 bg-white p-4 text-left text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
            <div><span className="text-gray-600 dark:text-gray-400">นักศึกษา</span> · {student?.full_name}</div>
            <div><span className="text-gray-600 dark:text-gray-400">ผลการพิจารณา</span> · {accepted ? 'รับ' : 'ไม่รับ'}</div>
            <div><span className="text-gray-600 dark:text-gray-400">ส่งเมื่อ</span> · {sentInfo.at}</div>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            ลิงก์นี้ใช้ส่งซ้ำไม่ได้แล้ว หากต้องแก้ไข กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษา
          </p>
        </div>
      </ResultShell>
    );
  }

  const tabBtn = (id: typeof docTab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setDocTab(id)}
      className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
        docTab === id
          ? 'bg-brand-navy text-white dark:bg-blue-600'
          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  );

  const studentInfoRows: { label: string; value: string }[] = student
    ? [
        { label: 'ชื่อ-สกุล', value: student.full_name },
        { label: 'รหัสนักศึกษา', value: student.student_code },
        { label: 'สาขา', value: student.major_name_th },
        { label: 'คณะ', value: student.faculty_name_th },
        { label: 'ภาคเรียน', value: student.semester_label },
        { label: 'อีเมลมหาวิทยาลัย', value: student.email },
      ]
    : [];

  const docLinks = (
    <div className="flex flex-col gap-2 text-sm">
      {[
        { href: fileUrl('cover-letter'), label: 'หนังสือขอความอนุเคราะห์' },
        { href: fileUrl('acceptance-form'), label: 'แบบตอบรับ (เอกสาร 2) — พิมพ์ ลงนาม ประทับตรา' },
        ...(hasResume ? [{ href: fileUrl('resume'), label: 'Resume ของนักศึกษา' }] : []),
      ].map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2.5 font-medium text-brand-blue hover:bg-blue-50 dark:border-gray-700 dark:text-blue-400 dark:hover:bg-gray-700"
        >
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
            {l.label}
          </span>
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
        </a>
      ))}
    </div>
  );

  const studentPanel = (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5 text-sm">
        {studentInfoRows.map((r) => (
          <div key={r.label} className="flex justify-between gap-4">
            <span className="shrink-0 text-gray-600 dark:text-gray-400">{r.label}</span>
            <span className="break-words text-right font-semibold text-gray-900 dark:text-white">{r.value || '—'}</span>
          </div>
        ))}
      </div>
      {hasResume ? (
        <iframe title="Resume ของนักศึกษา" src={fileUrl('resume')} className="min-h-[420px] w-full flex-1 rounded-xl border border-gray-200 bg-white dark:border-gray-700" />
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-400">นักศึกษายังไม่ได้แนบ Resume</p>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-4 bg-brand-navy px-4 text-white sm:px-8">
        <div className="min-w-0 truncate text-sm font-semibold sm:text-base">
          งานสหกิจศึกษา มทร.ตะวันออก · ตอบรับนักศึกษา <span data-testid="al-student-name">{student?.full_name}</span>
        </div>
        {expiresText && <div className="hidden shrink-0 text-xs text-blue-200 sm:block">ลิงก์ใช้ได้ถึง {expiresText}</div>}
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        {/* แผงเอกสารซ้าย — เฉพาะจอกว้าง */}
        <aside className="hidden flex-col gap-3 border-r border-gray-200 p-6 dark:border-gray-700 lg:sticky lg:top-16 lg:flex lg:h-[calc(100vh-4rem)] lg:w-[58%] lg:self-start">
          <div className="flex flex-wrap gap-1.5">
            {tabBtn('cover', 'หนังสือขอความอนุเคราะห์')}
            {tabBtn('form', 'แบบตอบรับ (เอกสาร 2)')}
            {tabBtn('student', 'ข้อมูลนักศึกษา + Resume')}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-2xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
            {docTab === 'cover' && <iframe title="หนังสือขอความอนุเคราะห์" src={fileUrl('cover-letter')} className="h-full w-full rounded-xl" />}
            {docTab === 'form' && <iframe title="แบบตอบรับ (เอกสาร 2)" src={fileUrl('acceptance-form')} className="h-full w-full rounded-xl" />}
            {docTab === 'student' && <div className="p-4">{studentPanel}</div>}
          </div>
          <a
            href={fileUrl(docTab === 'form' ? 'acceptance-form' : docTab === 'student' && hasResume ? 'resume' : 'cover-letter')}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:text-brand-navy dark:text-blue-400 dark:hover:text-blue-300"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            เปิดไฟล์ในแท็บใหม่ (พิมพ์ได้)
          </a>
        </aside>

        {/* ฟอร์มขวา / เต็มจอบนมือถือ */}
        <section className="flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:px-8">
          {/* จอแคบ: เอกสารเป็นลิงก์ */}
          <Card className="lg:hidden">
            <div className="mb-3 flex items-start gap-2">
              <User className="mt-0.5 h-4 w-4 shrink-0 text-gray-600 dark:text-gray-400" aria-hidden="true" />
              <div className="text-sm">
                <div className="font-semibold text-gray-900 dark:text-white">{student?.full_name}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {student?.student_code} · {student?.major_name_th} · {student?.semester_label}
                </div>
              </div>
            </div>
            {docLinks}
          </Card>

          {expiresText && (
            <div className="text-xs text-gray-600 dark:text-gray-400 sm:hidden">ลิงก์ใช้ได้ถึง {expiresText}</div>
          )}

          <div ref={errorRef} data-testid="al-error" className={error ? '' : 'hidden'}>
            <AlertBanner variant="error" message={error} />
          </div>

            <Card className="flex flex-col gap-4">
              <h2 className="text-base font-semibold">
                รับ {student?.full_name} เข้าปฏิบัติสหกิจศึกษาที่ {companyNameTh || 'สถานประกอบการ'} หรือไม่
              </h2>
              <div className="grid grid-cols-2 gap-2.5">
                {([
                  { v: 'accept', label: 'รับ', testid: 'al-decision-accept' },
                  { v: 'decline', label: 'ไม่รับ', testid: 'al-decision-decline' },
                ] as const).map((o) => (
                  <label
                    key={o.v}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl border-2 p-3.5 text-[15px] font-semibold transition-colors ${
                      decision === o.v
                        ? 'border-brand-blue bg-blue-50 text-brand-navy dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200'
                        : 'border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white'
                    }`}
                  >
                    <input
                      type="radio"
                      name="al-decision"
                      value={o.v}
                      aria-label={o.label}
                      checked={decision === o.v}
                      data-testid={o.testid}
                      onChange={() => {
                        setDecision(o.v);
                        setError(null);
                      }}
                      className="h-[18px] w-[18px] accent-brand-blue"
                    />
                    {o.label}
                  </label>
                ))}
              </div>

              {decision === 'accept' && (
                <>
                  <Field id="al-signer-name" label="ผู้อนุมัตินักศึกษา (ผู้ลงนาม)" required>
                    <Input id="al-signer-name" data-testid="al-signer-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="al-signer-position" label="ตำแหน่ง" required>
                      <Input id="al-signer-position" data-testid="al-signer-position" value={signerPosition} onChange={(e) => setSignerPosition(e.target.value)} />
                    </Field>
                    <Field id="al-signed-date" label="วันที่ลงนาม" required>
                      <Input id="al-signed-date" type="date" data-testid="al-signed-date" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
                    </Field>
                  </div>
                  <Field id="al-start-date" label="วันเริ่มปฏิบัติงาน" required>
                    <Input id="al-start-date" type="date" data-testid="al-start-date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </Field>
                  <div className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-blue-300 bg-gray-50 p-4 dark:border-blue-800 dark:bg-gray-900/50">
                    <span className="text-sm font-semibold">แนบเอกสาร 2 ที่ลงนามและประทับตรา <span className="text-red-600 dark:text-red-400">*</span></span>
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      พิมพ์เอกสาร 2 (เปิดได้จากแผงเอกสาร) ลงนาม ประทับตรา แล้วสแกนหรือถ่ายรูปแนบ · PDF หรือรูปภาพ ไม่เกิน 10 MB
                    </span>
                    <label className="self-start">
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        data-testid="al-evidence"
                        onChange={(e) => setEvidence(e.target.files?.[0] ?? null)}
                        className="sr-only"
                      />
                      <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-brand-blue bg-white px-3.5 py-2 text-sm font-semibold text-brand-blue hover:bg-blue-50 dark:bg-gray-800 dark:text-blue-300 dark:hover:bg-gray-700">
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        {evidence ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}
                      </span>
                    </label>
                    {evidence && <span className="break-all text-xs text-gray-700 dark:text-gray-300">{evidence.name}</span>}
                  </div>
                </>
              )}

              {decision === 'decline' && (
                <Field id="al-decline-reason" label="เหตุผลที่ไม่รับ (ระบบจะแจ้งนักศึกษา)" required>
                  <Textarea
                    id="al-decline-reason"
                    rows={4}
                    data-testid="al-decline-reason"
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="เช่น ไม่มีตำแหน่งงานที่ตรงกับสาขาในภาคเรียนนี้"
                  />
                </Field>
              )}
            </Card>

          <div className="mt-auto flex items-center justify-end gap-3 pt-2">
            {decision !== '' && (
              <Button data-testid="al-submit" onClick={openConfirm}>
                {decision === 'decline' ? 'ส่งคำตอบไม่รับ' : 'ตรวจแล้ว ส่งคำตอบ'}
              </Button>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={decision === 'decline' ? 'ยืนยันการไม่รับนักศึกษา' : 'ยืนยันการตอบรับนักศึกษา'}
        confirmLabel="ยืนยันส่ง"
        cancelLabel="กลับไปแก้"
        confirmTestId="al-confirm"
        cancelTestId="al-confirm-cancel"
        busy={submitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={submit}
        message={
          decision === 'decline' ? (
            <ConfirmSummary
              lead="ระบบจะแจ้งนักศึกษาทันทีว่าสถานประกอบการไม่รับ"
              rows={[
                { label: 'นักศึกษา', value: student?.full_name ?? '' },
                { label: 'ผลการพิจารณา', value: 'ไม่รับ' },
                { label: 'เหตุผล', value: declineReason.trim() },
              ]}
              lockNote="ส่งแล้วแก้เองไม่ได้ และลิงก์นี้จะใช้ต่อไม่ได้"
            />
          ) : (
            <ConfirmSummary
              lead="ระบบจะส่งเอกสารให้เจ้าหน้าที่งานสหกิจศึกษาตรวจต่อ"
              rows={[
                { label: 'นักศึกษา', value: student?.full_name ?? '' },
                { label: 'ผลการพิจารณา', value: 'รับ' },
                { label: 'ผู้ลงนาม', value: `${signerName.trim()} (${signerPosition.trim()})` },
                { label: 'วันที่ลงนาม', value: signedDate ? formatThaiDate(signedDate) : '' },
                { label: 'วันเริ่มปฏิบัติงาน', value: startDate ? formatThaiDate(startDate) : '' },
                { label: 'ไฟล์เอกสาร 2', value: evidence?.name ?? '' },
              ]}
              lockNote="ส่งแล้วแก้เองไม่ได้ และลิงก์นี้จะใช้ต่อไม่ได้"
            />
          )
        }
      />
    </div>
  );
};

export default AcceptanceLink;
