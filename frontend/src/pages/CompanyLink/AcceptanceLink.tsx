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

type ContactMode = 'manager' | 'delegate';

/** ฟิลด์สหกิจ 07 ส่วนบริษัท/ผู้จัดการ/ผู้ประสานงาน — ทั้งหมดนี้ (ยกเว้นชื่อ) คือ company_form07 */
interface CompanyForm07 {
  house_no: string;
  road: string;
  soi: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
  phone: string;
  fax: string;
  email: string;
  manager_name: string;
  manager_position: string;
  manager_department: string;
  manager_phone: string;
  manager_fax: string;
  manager_email: string;
  contact_mode: ContactMode;
  contact_person: string;
  contact_position: string;
  contact_department: string;
  contact_phone: string;
  contact_fax: string;
}

type Phase = 'loading' | 'form' | 'sent' | 'gone' | 'notfound' | 'loaderror';
type Decision = '' | 'accept' | 'decline';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const EMPTY_FORM07: CompanyForm07 = {
  house_no: '', road: '', soi: '', subdistrict: '', district: '', province: '', postal_code: '',
  phone: '', fax: '', email: '',
  manager_name: '', manager_position: '', manager_department: '', manager_phone: '', manager_fax: '', manager_email: '',
  contact_mode: 'manager', contact_person: '', contact_position: '', contact_department: '', contact_phone: '', contact_fax: '',
};

const asText = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

const formatThaiDateTime = (d: Date): string =>
  new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(d);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="border-b border-gray-200 pb-2 text-sm font-bold text-brand-navy dark:border-gray-700 dark:text-blue-300">
    {children}
  </h3>
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
  const [companyNameEn, setCompanyNameEn] = useState('');
  const [expiresText, setExpiresText] = useState('');
  const [form07, setForm07] = useState<CompanyForm07>(EMPTY_FORM07);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [decision, setDecision] = useState<Decision>('');
  const [declineReason, setDeclineReason] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerPosition, setSignerPosition] = useState('');
  const [signedDate, setSignedDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [evidence, setEvidence] = useState<File | null>(null);
  const [mentorName, setMentorName] = useState('');
  const [mentorPosition, setMentorPosition] = useState('');
  const [mentorDepartment, setMentorDepartment] = useState('');
  const [mentorPhone, setMentorPhone] = useState('');
  const [mentorFax, setMentorFax] = useState('');
  const [mentorEmail, setMentorEmail] = useState('');
  const [jobPosition, setJobPosition] = useState('');
  const [jobDescription, setJobDescription] = useState('');

  const [docTab, setDocTab] = useState<'cover' | 'form' | 'student'>('cover');
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sentInfo, setSentInfo] = useState<{ decision: Decision; mentor: string; at: string; message: string } | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const setF = <K extends keyof CompanyForm07>(key: K, value: CompanyForm07[K]) =>
    setForm07((prev) => ({ ...prev, [key]: value }));

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
        setCompanyNameEn(asText(c.name_en));
        setForm07((prev) => {
          const next = { ...prev };
          (Object.keys(EMPTY_FORM07) as (keyof CompanyForm07)[]).forEach((k) => {
            if (k === 'contact_mode') return;
            next[k] = asText(c[k]) as never;
          });
          next.contact_mode = c.contact_mode === 'delegate' ? 'delegate' : 'manager';
          return next;
        });
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

  const validateStep1 = (): string | null => {
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

  const validateStep2 = (): string | null => {
    if (!form07.manager_name.trim()) return 'กรุณากรอกชื่อผู้จัดการ';
    if (form07.contact_mode === 'delegate' && !form07.contact_person.trim()) {
      return 'กรุณากรอกชื่อผู้ประสานงาน หรือเลือก "ผู้จัดการเป็นผู้ประสานงานเอง"';
    }
    if (!mentorName.trim()) return 'กรุณากรอกชื่อพนักงานที่ปรึกษา (พี่เลี้ยง)';
    if (!mentorPosition.trim()) return 'กรุณากรอกตำแหน่งพนักงานที่ปรึกษา';
    if (!mentorPhone.trim()) return 'กรุณากรอกโทรศัพท์พนักงานที่ปรึกษา';
    if (!EMAIL_RE.test(mentorEmail.trim())) return 'กรุณากรอกอีเมลพนักงานที่ปรึกษาให้ถูกต้อง (ระบบจะส่งลิงก์เปิดบัญชีไปที่นี่)';
    if (!jobPosition.trim()) return 'กรุณากรอกตำแหน่งงานที่มอบหมาย';
    if (!jobDescription.trim()) return 'กรุณากรอกลักษณะงานที่มอบหมาย';
    return null;
  };

  const goNext = () => {
    const problem = step === 1 ? validateStep1() : validateStep2();
    if (problem) return fail(problem);
    setError(null);
    setStep(step === 1 ? 2 : 3);
  };

  const goBack = () => {
    setError(null);
    setStep(step === 3 ? 2 : 1);
  };

  /** decline = ตรวจขั้น 1 แล้วเปิดกล่องยืนยัน · accept = มาถึงขั้น 3 แล้ว (ตรวจครบไปแล้วทีละขั้น) */
  const openConfirm = () => {
    const problem = validateStep1() ?? (decision === 'accept' ? validateStep2() : null);
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
        setSentInfo({ decision, mentor: '', at: formatThaiDateTime(new Date()), message: asText(res?.message) });
      } else {
        const fd = new FormData();
        if (evidence) fd.append('evidence', evidence);
        fd.append('signer_name', signerName.trim());
        fd.append('signer_position', signerPosition.trim());
        fd.append('signed_date', signedDate);
        fd.append('start_date', startDate);
        fd.append('mentor_name', mentorName.trim());
        fd.append('mentor_email', mentorEmail.trim());
        fd.append('mentor_phone', mentorPhone.trim());
        fd.append('mentor_position', mentorPosition.trim());
        fd.append('mentor_department', mentorDepartment.trim());
        fd.append('mentor_fax', mentorFax.trim());
        fd.append('job_position', jobPosition.trim());
        fd.append('job_description', jobDescription.trim());
        fd.append('company_form07', JSON.stringify(form07));
        const res = await api.post(`/public/acceptance/accept?${q}`, fd);
        setSentInfo({
          decision,
          mentor: asText(res?.mentor_name) || mentorName.trim(),
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
          {serverMessage && <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">{serverMessage}</p>}
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            ลิงก์อาจใช้ตอบไปแล้ว หมดอายุ หรือถูกยกเลิกเมื่อนักศึกษาส่งลิงก์ใหม่
            หากต้องการตอบหรือแก้ไขคำตอบ กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษา
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
              ? 'เจ้าหน้าที่งานสหกิจศึกษาจะตรวจเอกสาร แล้วแจ้งนักศึกษาต่อ พี่เลี้ยงจะได้รับอีเมลเปิดบัญชีหลังตรวจเสร็จ'
              : 'ระบบได้แจ้งนักศึกษาแล้วว่าสถานประกอบการไม่รับในครั้งนี้'}
          </p>
          <div className="w-full space-y-1.5 rounded-2xl border border-gray-200 bg-white p-4 text-left text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
            <div><span className="text-gray-600 dark:text-gray-400">นักศึกษา</span> · {student?.full_name}</div>
            <div><span className="text-gray-600 dark:text-gray-400">ผลการพิจารณา</span> · {accepted ? 'รับ' : 'ไม่รับ'}</div>
            {accepted && <div><span className="text-gray-600 dark:text-gray-400">พี่เลี้ยง</span> · {sentInfo.mentor}</div>}
            <div><span className="text-gray-600 dark:text-gray-400">ส่งเมื่อ</span> · {sentInfo.at}</div>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            ลิงก์นี้ใช้ส่งซ้ำไม่ได้แล้ว หากต้องแก้ไข กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษา
          </p>
        </div>
      </ResultShell>
    );
  }

  const stepPills: { n: 1 | 2 | 3; label: string }[] =
    decision === 'decline'
      ? [{ n: 1, label: '1 ตอบรับ' }]
      : [
          { n: 1, label: '1 ตอบรับ' },
          { n: 2, label: '2 สหกิจ 07' },
          { n: 3, label: '3 ตรวจและส่ง' },
        ];

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

  const summaryGroups = [
    {
      title: 'การตอบรับ',
      rows: [
        { label: 'นักศึกษา', value: student?.full_name ?? '' },
        { label: 'ผู้ลงนาม', value: `${signerName.trim()} (${signerPosition.trim()})` },
        { label: 'วันที่ลงนาม', value: signedDate ? formatThaiDate(signedDate) : '' },
        { label: 'วันเริ่มปฏิบัติงาน', value: startDate ? formatThaiDate(startDate) : '' },
        { label: 'ไฟล์เอกสาร 2', value: evidence?.name ?? '' },
      ],
    },
    {
      title: 'สถานประกอบการ · ผู้จัดการ',
      rows: [
        { label: 'สถานประกอบการ', value: companyNameTh },
        { label: 'โทรศัพท์', value: form07.phone },
        { label: 'ผู้จัดการ', value: form07.manager_name },
        {
          label: 'ผู้ประสานงาน',
          value: form07.contact_mode === 'manager' ? 'ผู้จัดการเป็นผู้ประสานงานเอง' : form07.contact_person,
        },
      ],
    },
    {
      title: 'พนักงานที่ปรึกษา (พี่เลี้ยง) · ระบบจะส่งลิงก์เปิดบัญชีไปที่อีเมลนี้',
      rows: [
        { label: 'ชื่อ', value: mentorName.trim() },
        { label: 'ตำแหน่ง', value: mentorPosition.trim() },
        { label: 'โทรศัพท์', value: mentorPhone.trim() },
        { label: 'อีเมล', value: mentorEmail.trim() },
      ],
    },
    {
      title: 'งานที่มอบหมาย',
      rows: [
        { label: 'ตำแหน่งงาน', value: jobPosition.trim() },
        { label: 'ลักษณะงาน', value: jobDescription.trim() },
      ],
    },
  ];

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

          <ol className="flex flex-wrap items-center gap-2 text-xs">
            {stepPills.map((p, i) => (
              <React.Fragment key={p.n}>
                {i > 0 && <span className="text-gray-400 dark:text-gray-500" aria-hidden="true">—</span>}
                <li
                  aria-current={step === p.n ? 'step' : undefined}
                  className={`rounded-full px-3 py-1 font-semibold ${
                    step === p.n
                      ? 'bg-brand-blue text-white'
                      : 'border border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  {p.label}
                </li>
              </React.Fragment>
            ))}
          </ol>

          <div ref={errorRef} data-testid="al-error" className={error ? '' : 'hidden'}>
            <AlertBanner variant="error" message={error} />
          </div>

          {step === 1 && (
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
          )}

          {step === 2 && (
            <Card className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <SectionTitle>สถานประกอบการ</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="al-name-th" label="ชื่อภาษาไทย">
                    <Input id="al-name-th" value={companyNameTh} readOnly disabled />
                  </Field>
                  <Field id="al-name-en" label="ชื่อภาษาอังกฤษ">
                    <Input id="al-name-en" value={companyNameEn} readOnly disabled />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id="al-house-no" label="เลขที่"><Input id="al-house-no" value={form07.house_no} onChange={(e) => setF('house_no', e.target.value)} /></Field>
                  <Field id="al-road" label="ถนน"><Input id="al-road" value={form07.road} onChange={(e) => setF('road', e.target.value)} /></Field>
                  <Field id="al-soi" label="ซอย"><Input id="al-soi" value={form07.soi} onChange={(e) => setF('soi', e.target.value)} /></Field>
                  <Field id="al-subdistrict" label="ตำบล/แขวง"><Input id="al-subdistrict" value={form07.subdistrict} onChange={(e) => setF('subdistrict', e.target.value)} /></Field>
                  <Field id="al-district" label="อำเภอ/เขต"><Input id="al-district" value={form07.district} onChange={(e) => setF('district', e.target.value)} /></Field>
                  <Field id="al-province" label="จังหวัด"><Input id="al-province" value={form07.province} onChange={(e) => setF('province', e.target.value)} /></Field>
                  <Field id="al-postal" label="รหัสไปรษณีย์"><Input id="al-postal" inputMode="numeric" value={form07.postal_code} onChange={(e) => setF('postal_code', e.target.value)} /></Field>
                  <Field id="al-company-phone" label="โทรศัพท์"><Input id="al-company-phone" type="tel" data-testid="al-company-phone" value={form07.phone} onChange={(e) => setF('phone', e.target.value)} /></Field>
                  <Field id="al-company-fax" label="โทรสาร"><Input id="al-company-fax" type="tel" value={form07.fax} onChange={(e) => setF('fax', e.target.value)} /></Field>
                </div>
                <Field id="al-company-email" label="อีเมลสถานประกอบการ">
                  <Input id="al-company-email" type="email" value={form07.email} onChange={(e) => setF('email', e.target.value)} />
                </Field>
              </div>

              <div className="flex flex-col gap-3">
                <SectionTitle>ผู้จัดการ / ผู้ประสานงาน</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="al-manager-name" label="ชื่อผู้จัดการ" required>
                    <Input id="al-manager-name" data-testid="al-manager-name" value={form07.manager_name} onChange={(e) => setF('manager_name', e.target.value)} />
                  </Field>
                  <Field id="al-manager-position" label="ตำแหน่ง"><Input id="al-manager-position" value={form07.manager_position} onChange={(e) => setF('manager_position', e.target.value)} /></Field>
                  <Field id="al-manager-department" label="แผนก"><Input id="al-manager-department" value={form07.manager_department} onChange={(e) => setF('manager_department', e.target.value)} /></Field>
                  <Field id="al-manager-phone" label="โทรศัพท์"><Input id="al-manager-phone" type="tel" value={form07.manager_phone} onChange={(e) => setF('manager_phone', e.target.value)} /></Field>
                  <Field id="al-manager-fax" label="โทรสาร"><Input id="al-manager-fax" type="tel" value={form07.manager_fax} onChange={(e) => setF('manager_fax', e.target.value)} /></Field>
                  <Field id="al-manager-email" label="อีเมล"><Input id="al-manager-email" type="email" value={form07.manager_email} onChange={(e) => setF('manager_email', e.target.value)} /></Field>
                </div>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-300">ผู้ประสานงานกับมหาวิทยาลัย</legend>
                  {([
                    { v: 'manager', label: 'ผู้จัดการเป็นผู้ประสานงานเอง' },
                    { v: 'delegate', label: 'มอบหมายผู้ประสานงานอีกคน' },
                  ] as const).map((o) => (
                    <label key={o.v} className="flex cursor-pointer items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                      <input
                        type="radio"
                        name="al-contact-mode"
                        checked={form07.contact_mode === o.v}
                        onChange={() => setF('contact_mode', o.v)}
                        className="h-4 w-4 accent-brand-blue"
                      />
                      {o.label}
                    </label>
                  ))}
                </fieldset>
                {form07.contact_mode === 'delegate' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="al-contact-person" label="ชื่อผู้ประสานงาน" required><Input id="al-contact-person" value={form07.contact_person} onChange={(e) => setF('contact_person', e.target.value)} /></Field>
                    <Field id="al-contact-position" label="ตำแหน่ง"><Input id="al-contact-position" value={form07.contact_position} onChange={(e) => setF('contact_position', e.target.value)} /></Field>
                    <Field id="al-contact-department" label="แผนก"><Input id="al-contact-department" value={form07.contact_department} onChange={(e) => setF('contact_department', e.target.value)} /></Field>
                    <Field id="al-contact-phone" label="โทรศัพท์"><Input id="al-contact-phone" type="tel" value={form07.contact_phone} onChange={(e) => setF('contact_phone', e.target.value)} /></Field>
                    <Field id="al-contact-fax" label="โทรสาร"><Input id="al-contact-fax" type="tel" value={form07.contact_fax} onChange={(e) => setF('contact_fax', e.target.value)} /></Field>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <SectionTitle>พนักงานที่ปรึกษา (พี่เลี้ยง)</SectionTitle>
                <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                  หลังเจ้าหน้าที่ตรวจเอกสาร ระบบจะส่งลิงก์เปิดบัญชีพี่เลี้ยงไปที่อีเมลนี้
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="al-mentor-name" label="ชื่อ-นามสกุล" required>
                    <Input id="al-mentor-name" data-testid="al-mentor-name" value={mentorName} onChange={(e) => setMentorName(e.target.value)} />
                  </Field>
                  <Field id="al-mentor-position" label="ตำแหน่ง" required>
                    <Input id="al-mentor-position" data-testid="al-mentor-position" value={mentorPosition} onChange={(e) => setMentorPosition(e.target.value)} />
                  </Field>
                  <Field id="al-mentor-department" label="แผนก"><Input id="al-mentor-department" value={mentorDepartment} onChange={(e) => setMentorDepartment(e.target.value)} /></Field>
                  <Field id="al-mentor-phone" label="โทรศัพท์" required>
                    <Input id="al-mentor-phone" type="tel" data-testid="al-mentor-phone" value={mentorPhone} onChange={(e) => setMentorPhone(e.target.value)} />
                  </Field>
                  <Field id="al-mentor-fax" label="โทรสาร"><Input id="al-mentor-fax" type="tel" value={mentorFax} onChange={(e) => setMentorFax(e.target.value)} /></Field>
                  <Field id="al-mentor-email" label="อีเมล" required>
                    <Input id="al-mentor-email" type="email" data-testid="al-mentor-email" value={mentorEmail} onChange={(e) => setMentorEmail(e.target.value)} />
                  </Field>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <SectionTitle>งานที่มอบหมาย</SectionTitle>
                <Field id="al-job-position" label="ตำแหน่งงาน (Job Position)" required>
                  <Input id="al-job-position" data-testid="al-job-position" value={jobPosition} onChange={(e) => setJobPosition(e.target.value)} />
                </Field>
                <Field id="al-job-description" label="ลักษณะงาน (Job Description)" required>
                  <Textarea id="al-job-description" rows={4} data-testid="al-job-description" value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} />
                </Field>
              </div>
            </Card>
          )}

          {step === 3 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">ตรวจข้อมูลก่อนส่ง</h2>
              <ConfirmSummary
                groups={summaryGroups}
                lockNote="ส่งแล้วแก้เองไม่ได้ และลิงก์นี้ใช้ได้ครั้งเดียว หากต้องแก้ไขให้ติดต่อนักศึกษาหรืองานสหกิจศึกษา"
              />
            </Card>
          )}

          <div className="mt-auto flex items-center justify-between gap-3 pt-2">
            <div>
              {step > 1 && (
                <Button variant="secondary" data-testid="al-back" onClick={goBack} disabled={submitting}>
                  ย้อนกลับ
                </Button>
              )}
            </div>
            {step === 1 && decision === 'accept' && (
              <Button data-testid="al-next" onClick={goNext}>ถัดไป: สหกิจ 07</Button>
            )}
            {step === 2 && (
              <Button data-testid="al-next" onClick={goNext}>ถัดไป: ตรวจและส่ง</Button>
            )}
            {((step === 1 && decision === 'decline') || step === 3) && (
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
                { label: 'วันเริ่มปฏิบัติงาน', value: startDate ? formatThaiDate(startDate) : '' },
                { label: 'พี่เลี้ยง', value: mentorName.trim() },
                { label: 'อีเมลพี่เลี้ยง', value: mentorEmail.trim() },
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
