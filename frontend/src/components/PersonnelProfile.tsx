import React, { useContext, useEffect, useRef, useState } from 'react';
import { Lock, PenLine, ArrowRight } from 'lucide-react';
import PageSkeleton from './ui/Skeleton';
import api, { API_BASE_URL } from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Button from './ui/Button';
import { Input } from './ui/Input';
import { AuthContext } from '../context/AuthContext';
import { getErrorMessage, getErrorStatus } from '../utils/errors';

interface PersonnelProfileData {
  /** ตำแหน่งทางวิชาการ — พิมพ์หน้าชื่อใต้ลายมือชื่อในหนังสือที่คณบดีลงนาม */
  academic_title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  e_signature_file?: string | null;
  email?: string;
  major_name_th?: string | null;
  faculty_name_th?: string | null;
}

/** นับจาก `students.advisor_id` / `supervisor_id` — มีเฉพาะบัญชีที่ถือ role `advisor` */
interface Caseload {
  advisees: number;
  supervisees: number;
}

interface PersonnelProfileProps {
  /** ไปเมนูอื่นในฝ่ายเดิม — คณบดีใช้ไปหน้าลายมือชื่อ */
  onNavigate?: (menu: string) => void;
  /** สลับไปหน้าแรกของอีกฝ่าย — แถวในการ์ด "หน้าที่ของคุณในระบบ" */
  onSwitchView?: (view: string) => void;
}

/**
 * ป้ายและหน้าที่ของแต่ละ "ฝ่าย" (view ไม่ใช่ role — ฝ่ายนิเทศคำนวณจากการจัดสรร · `utils/facultyViews.ts`)
 * ข้อความหน้าที่ลอกจากเมนูจริงใน `Sidebar.tsx` — แก้เมนูเมื่อไหร่ให้แก้ที่นี่ด้วย
 */
const VIEW_INFO: Record<string, { label: string; duties: string }> = {
  advisor: {
    label: 'อาจารย์ที่ปรึกษา',
    duties: 'เห็นชอบโครงร่าง (สหกิจ 11) · บันทึกข้อความนักศึกษา · ตรวจรับเล่มรายงาน (สหกิจ 14)',
  },
  supervisor: {
    label: 'อาจารย์นิเทศ',
    duties: 'นัดหมายนิเทศ (สหกิจ 12) · บันทึกการนิเทศ (สหกิจ 13)',
  },
  dept_head: {
    label: 'หัวหน้าสาขาวิชา',
    duties: 'จัดสรรอาจารย์ที่ปรึกษาและนิเทศ · ติดตามคำร้อง (เอกสารหมายเลข 1) · ติดตามเอกสารและผลประเมิน',
  },
  dean: {
    label: 'คณบดี',
    duties: 'ลงนามหนังสือราชการ · ตั้งค่าลายมือชื่อ · บันทึกข้อความนักศึกษา',
  },
  staff: {
    label: 'เจ้าหน้าที่สหกิจศึกษา',
    duties: 'คิวคำร้องและแบบตอบรับ · นัดหมายนิเทศ · รายชื่อนักศึกษา บัญชีผู้ใช้ และปฏิทินสหกิจ',
  },
};

/**
 * โปรไฟล์ของบุคลากรในมหาวิทยาลัย (ที่ปรึกษา · นิเทศ · หัวหน้าสาขา · คณบดี · เจ้าหน้าที่)
 * แบบ B ที่เจ้าของเลือก 2026-09-23: หัวโปรไฟล์ + สองคอลัมน์
 *
 * - **สังกัด — แก้เองไม่ได้** สาขาคือสิ่งที่ `resolveMajorScope` ใช้ตัดสินว่าเห็นนักศึกษาคนไหน
 *   เดิมมี dropdown ให้เลือกเอง = ขยายสิทธิ์ตัวเองได้ · เจ้าหน้าที่แก้ที่ `PUT /users/:id` ทางเดียว
 * - **ชื่อ · วันเกิด — แก้เองได้** ทุกฝ่ายรวมเจ้าหน้าที่ เพราะชื่อคือสิ่งที่บอกว่าใครทำอะไร
 * - กระดานวาดลายเซ็นคณบดีอยู่ที่เมนู `signature` ที่เดียว (มี ConfirmDialog) — หน้านี้แค่พาไป
 */
const PersonnelProfile: React.FC<PersonnelProfileProps> = ({ onNavigate, onSwitchView }) => {
  const auth = useContext(AuthContext);
  const [profile, setProfile] = useState<PersonnelProfileData | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [caseload, setCaseload] = useState<Caseload | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [academicTitle, setAcademicTitle] = useState('');
  const [birthDate, setBirthDate] = useState('');

  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** ยังไม่เคยกรอกประวัติ — สถานะปกติของบุคลากรที่เพิ่งได้รับสิทธิ์ ไม่ใช่ความผิดพลาด */
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /** มีชื่อไฟล์ในฐานแต่เปิดภาพไม่ได้ — โชว์ไอคอนแทนรูปแตก */
  const [sigImageBroken, setSigImageBroken] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  const applyProfile = (prof: PersonnelProfileData) => {
    setProfile(prof);
    setAcademicTitle(prof.academic_title || '');
    setFirstName(prof.first_name || '');
    setLastName(prof.last_name || '');
    setBirthDate(prof.birth_date ? prof.birth_date.split('T')[0] : '');
  };

  useEffect(() => {
    api
      .get('/profile/me')
      .then((res) => {
        const prof: PersonnelProfileData | undefined = res.profile;
        setRoles(res.roles || []);
        setCaseload(res.caseload ?? null);
        if (prof) {
          setProfile(prof);
          setAcademicTitle(prof.academic_title || '');
          setFirstName(prof.first_name || '');
          setLastName(prof.last_name || '');
          setBirthDate(prof.birth_date ? prof.birth_date.split('T')[0] : '');
        }
      })
      .catch((err) => {
        console.error('Failed to load personnel profile:', err);
        const notOnboarded = getErrorStatus(err) === 404;
        setNotice(notOnboarded ? 'ยังไม่มีข้อมูลประวัติของคุณในระบบ กรุณาติดต่อเจ้าหน้าที่สหกิจศึกษา' : null);
        setError(notOnboarded ? null : 'ไม่สามารถเรียกข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!firstName.trim() || !lastName.trim()) {
      setError('กรุณากรอกชื่อและนามสกุล');
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      // ส่งเสมอ (ว่างได้) — เซิร์ฟเวอร์ตั้งตามที่ส่ง จึงล้างตำแหน่งที่พิมพ์ผิดได้
      formData.append('academic_title', academicTitle.trim());
      formData.append('first_name', firstName.trim());
      formData.append('last_name', lastName.trim());
      if (!profile?.birth_date) formData.append('birth_date', birthDate);

      const res = await api.put('/profile/personnel', formData);
      if (res.profile) applyProfile(res.profile);
      setSuccess('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
    } catch (err) {
      console.error('Failed to update personnel profile:', err);
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลโปรไฟล์ได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant="form" />;
  }

  const isDean = roles.includes('dean');
  /** เซิร์ฟเวอร์เมินวันเกิดที่ส่งมาเมื่อมีค่าอยู่แล้ว — หน้าจอต้องบอกตรงกัน ไม่ใช่ให้กรอกแล้วเงียบ */
  const birthDateLocked = !!profile?.birth_date;
  // คณบดี/เจ้าหน้าที่เห็นทุกสาขา (`INSTITUTION_WIDE_ROLES`) — สาขาในแถว personnel ของสองฝ่ายนี้ไม่มีผล
  // (คณบดีได้สาขาแรกของตารางตอนสร้างอัตโนมัติ) โชว์ไปจะทำให้เข้าใจผิดว่าถูกจำกัดสาขา
  const majorScoped = roles.some((r) => r === 'advisor' || r === 'dept_head');
  const majorLabel = majorScoped ? profile?.major_name_th || '—' : 'ทุกสาขา (สิทธิ์ระดับคณะ)';
  // ฝ่ายที่ผู้ใช้เห็นในตัวสลับ — ไม่มี views (บัญชีเก่า) ใช้ role แทน
  const views = (auth?.user?.views?.length ? auth.user.views : roles).filter((v) => VIEW_INFO[v]);
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  const initials = (profile?.first_name?.[0] || '') + (profile?.last_name?.[0] || '');
  const signatureUrl = profile?.e_signature_file
    ? `${API_BASE_URL}/files/signatures/${profile.e_signature_file.split('/').pop()}`
    : null;

  const cardClass = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs';
  const labelClass = 'block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1';
  const lockBadge = (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
      <Lock className="w-3 h-3 text-gray-600 dark:text-gray-400" aria-hidden="true" />
      แก้เองไม่ได้
    </span>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 page-enter pb-16">
      <div ref={alertRef} className="space-y-3 empty:hidden">
        <AlertBanner variant="info" message={notice} />
        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={success} />
      </div>

      {!profile && (
        <div className={cardClass}>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">ข้อมูลส่วนตัวบุคลากร</h1>
        </div>
      )}

      {profile && (
        <>
          {/* หัวโปรไฟล์ */}
          <div
            data-testid="personnel-profile-hero"
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs overflow-hidden"
          >
            {/* โหมดมืดเป็นเทากลาง ไม่ใช่กรมท่า — ทั้งแอปไม่มีพื้นสีเต็มแผ่นในโหมดมืด แถบน้ำเงินเข้มจึงดูหลุดชุด */}
            <div className="h-20 bg-brand-navy dark:bg-gray-800" aria-hidden="true" />
            <div className="px-6 sm:px-8 pb-6 -mt-12 flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6">
              <div
                aria-hidden="true"
                className="w-28 h-28 shrink-0 rounded-full bg-blue-50 dark:bg-gray-900 border-4 border-white dark:border-gray-900 ring-1 ring-transparent dark:ring-gray-700 flex items-center justify-center text-4xl font-black text-brand-blue dark:text-blue-400"
              >
                {initials || '—'}
              </div>
              {/* sm:pt-14 > ระยะที่รูปยื่นขึ้นไปบนแถบ (48px) — ชื่อต้องอยู่บนพื้นการ์ดเสมอ ห่างจากแถบ 8px
                  เดิมชิดขอบพอดี ตัวดำไปติดพื้นกรมท่า อ่านยาก (เจ้าของทัก 2026-09-23) */}
              <div className="flex-1 min-w-0 space-y-1.5 sm:pt-14 sm:pb-1">
                <h1 className="text-2xl font-black text-gray-900 dark:text-white">
                  {displayName || 'ยังไม่ได้ตั้งชื่อ'}
                </h1>
                <p className="text-xs text-gray-600 dark:text-gray-400 break-words">
                  {[profile.email, majorScoped && profile.major_name_th, profile.faculty_name_th]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {views.map((v) => (
                    <span
                      key={v}
                      className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800"
                    >
                      {VIEW_INFO[v].label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* คอลัมน์ซ้าย */}
            <div className="lg:col-span-2 space-y-6">
              <form data-testid="personnel-profile-form" onSubmit={handleSubmit} className={`${cardClass} space-y-5`}>
                <div className="border-b border-gray-100 dark:border-gray-800 pb-3">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">ข้อมูลที่คุณแก้เองได้</h2>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
                    ชื่อนี้โผล่ในรายการที่คุณอนุมัติ ตีกลับ หรือให้คะแนน — นักศึกษาและพี่เลี้ยงใช้ดูว่าใครเป็นคนทำ
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="personnel-academic-title" className={labelClass}>ตำแหน่งทางวิชาการ</label>
                    <Input
                      id="personnel-academic-title"
                      data-testid="personnel-academic-title"
                      value={academicTitle}
                      maxLength={100}
                      disabled={isSubmitting}
                      placeholder="เช่น ผู้ช่วยศาสตราจารย์ · รองศาสตราจารย์ ดร."
                      onChange={(e) => setAcademicTitle(e.target.value)}
                    />
                    <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
                      ไม่มีให้เว้นว่าง · พิมพ์ติดหน้าชื่อใต้ลายมือชื่อในหนังสือที่คณบดีลงนาม
                    </span>
                  </div>
                  <div>
                    <label htmlFor="personnel-first-name" className={labelClass}>ชื่อ *</label>
                    <Input
                      id="personnel-first-name"
                      data-testid="personnel-first-name"
                      value={firstName}
                      disabled={isSubmitting}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="personnel-last-name" className={labelClass}>นามสกุล *</label>
                    <Input
                      id="personnel-last-name"
                      data-testid="personnel-last-name"
                      value={lastName}
                      disabled={isSubmitting}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="personnel-birth-date" className={labelClass}>วันเกิด</label>
                    {/* ตั้งเองได้ครั้งเดียว — ระบบใช้ปิดบัญชีอัตโนมัติตอนอายุ 60 · หลังจากนั้นเจ้าหน้าที่แก้ */}
                    <Input
                      id="personnel-birth-date"
                      data-testid="personnel-birth-date"
                      type="date"
                      value={birthDate}
                      disabled={isSubmitting || birthDateLocked}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className={birthDateLocked ? '' : 'cursor-pointer'}
                    />
                    <p data-testid="personnel-birth-date-hint" className="text-[11px] text-gray-600 dark:text-gray-400 mt-1 leading-snug">
                      {birthDateLocked
                        ? 'ตั้งแล้ว — ถ้าไม่ถูกต้องให้แจ้งเจ้าหน้าที่สหกิจศึกษาแก้ให้'
                        : 'ตั้งได้ครั้งเดียว ตรวจให้ถูกก่อนบันทึก'}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-3 border-t border-gray-100 dark:border-gray-800">
                  <Button type="submit" data-testid="personnel-profile-save" loading={isSubmitting} loadingLabel="กำลังบันทึกข้อมูล...">
                    บันทึกข้อมูลส่วนตัว
                  </Button>
                </div>
              </form>

              {views.length > 0 && (
                <section data-testid="personnel-duties" className={cardClass}>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white mb-2">หน้าที่ของคุณในระบบ</h2>
                  <ul>
                    {views.map((v) => (
                      <li key={v} className="border-t border-gray-100 dark:border-gray-800">
                        <button
                          type="button"
                          data-testid={`personnel-duty-${v}`}
                          onClick={() => onSwitchView?.(v)}
                          className="w-full flex items-center justify-between gap-4 py-3.5 text-left group cursor-pointer"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-bold text-gray-900 dark:text-white">{VIEW_INFO[v].label}</span>
                            <span className="block text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
                              {VIEW_INFO[v].duties}
                            </span>
                          </span>
                          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-bold text-brand-blue dark:text-blue-400 group-hover:underline">
                            เปิด <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* คอลัมน์ขวา */}
            <div className="space-y-6">
              <section data-testid="personnel-profile-registry" className={`${cardClass} space-y-3.5`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">สังกัด</h2>
                  {lockBadge}
                </div>
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">คณะ</div>
                  <div className="text-xs font-bold text-gray-900 dark:text-white mt-0.5">{profile.faculty_name_th || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">สาขาวิชา</div>
                  <div data-testid="personnel-profile-major" className="text-xs font-bold text-gray-900 dark:text-white mt-0.5">
                    {majorLabel}
                  </div>
                </div>
                {majorScoped && (
                  <p className="pt-3 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                    สาขากำหนดว่าคุณเห็นนักศึกษาและคำร้องของใคร —{' '}
                    <strong className="text-gray-800 dark:text-gray-200">ไม่ถูกต้องให้แจ้งเจ้าหน้าที่สหกิจศึกษา</strong>
                  </p>
                )}
              </section>

              {caseload && (
                <section data-testid="personnel-caseload" className={`${cardClass} space-y-3`}>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">นักศึกษาในความดูแล</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-800">
                      <div className="text-xs text-gray-600 dark:text-gray-400">เป็นที่ปรึกษา</div>
                      <div data-testid="personnel-caseload-advisees" className="text-3xl font-black text-gray-900 dark:text-white">
                        {caseload.advisees}
                      </div>
                      <div className="text-[11px] text-gray-600 dark:text-gray-400 leading-snug">คน · ดูแลจนส่งเล่ม</div>
                    </div>
                    {/* สีชุดเดียวกับกล่อง "เกรดที่คุณแจ้ง" ในหน้านักศึกษา */}
                    <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/60">
                      <div className="text-xs font-semibold text-blue-900 dark:text-blue-300">เป็นอาจารย์นิเทศ</div>
                      <div data-testid="personnel-caseload-supervisees" className="text-3xl font-black text-brand-blue dark:text-blue-400">
                        {caseload.supervisees}
                      </div>
                      <div className="text-[11px] text-blue-900 dark:text-blue-300 leading-snug">คน · ไปนิเทศที่บริษัท</div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                    หัวหน้าสาขาเป็นคนมอบหมายทั้งสองอย่าง — คนเดียวกันอาจอยู่ทั้งสองช่องได้ · ดูรายชื่อได้ที่เมนูของแต่ละฝ่าย
                  </p>
                </section>
              )}

              {/* ลายมือชื่อ — คณบดีเท่านั้น · ตัวกระดานวาดอยู่ที่เมนู signature ที่เดียว */}
              {isDean && (
                <section data-testid="personnel-signature-card" className={`${cardClass} space-y-3`}>
                  <h2 className="text-base font-bold text-gray-900 dark:text-white">ลายมือชื่อสำหรับหนังสือราชการ</h2>
                  <div className="h-16 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 flex items-center justify-center overflow-hidden">
                    {signatureUrl && !sigImageBroken ? (
                      <img
                        src={signatureUrl}
                        alt="ลายมือชื่อปัจจุบัน"
                        className="max-h-14 object-contain"
                        onError={() => setSigImageBroken(true)}
                      />
                    ) : (
                      <PenLine className="w-5 h-5 text-gray-500 dark:text-gray-400" aria-hidden="true" />
                    )}
                  </div>
                  <p
                    className={`text-xs font-bold ${
                      signatureUrl ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {!signatureUrl
                      ? 'ยังไม่ได้ตั้งค่า — ลงนามหนังสือไม่ได้'
                      : sigImageBroken
                        ? 'ตั้งค่าแล้ว (เปิดภาพไม่ได้)'
                        : 'ตั้งค่าแล้ว'}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                    พิมพ์ลงหนังสือพร้อมชื่อ-นามสกุลของคุณ — ขาดอย่างใดอย่างหนึ่งจะลงนามไม่ได้
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    data-testid="personnel-go-signature"
                    onClick={() => onNavigate?.('signature')}
                  >
                    {signatureUrl ? 'เปลี่ยนลายมือชื่อ' : 'ตั้งค่าลายมือชื่อ'}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PersonnelProfile;
