import React, { useContext, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import type { Company, CoopCalendarResponse, StudentProfile } from '../../types/api';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { getErrorMessage, getErrorStatus } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';
import { loadGoogleMapsScript } from '../../utils/googleMapsLoader';
import {
  googleMaps,
  type AddressComponent,
  type PlaceResult,
  type PlacesAutocomplete,
} from '../../types/googleMaps';

/**
 * ยื่นคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1) — เมนู `jobs` ของนักศึกษา
 *
 * มาแทนบอร์ดประกาศงาน (`SmartJobBoard`) ที่อาจารย์ที่ปรึกษาโปรเจคให้ตัด 2026-10-05:
 * คู่มือคณะเริ่มที่เอกสารหมายเลข 1 ตรงๆ ไม่มีขั้นเลือกจากประกาศ · หน้านี้จึงเป็น
 * **ฟอร์มของกระดาษใบนั้น** — นักศึกษากรอกแค่ส่วนสถานประกอบการ ที่เหลือระบบดึงจาก
 * โปรไฟล์กับปฏิทินสหกิจ แล้วพิมพ์ลงแบบฟอร์มตัวจริงให้ (`backend/utils/requestFormPdf.ts`)
 *
 * ⛔ ตัวอย่างกระดาษฝั่งขวาเป็นภาพจำลองบนหน้าจอ ไม่ใช่ไฟล์จริง — ไฟล์จริงเกิดหลังยื่น
 *    (ต้องมีแถว `intent_forms` ก่อน) และเปิดจากการ์ดสถานะบนหน้าแรก
 */

interface Province {
  province_id: number;
  province_name_th: string;
}

interface ActiveIntent {
  company_name_th?: string;
  status: string;
}

const EMPTY_FORM = {
  company_name_th: '',
  company_address: '',
  company_province: '',
  company_district: '',
  company_postal_code: '',
  company_phone: '',
  contact_person: '',
  contact_position: '',
};

const CLOSED_INTENT_STATUSES = ['rejected', 'company_rejected'];
const LATE_REASON_MIN = 20;

const labelClass = 'mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300';
const required = <span className="text-red-600 dark:text-red-400">*</span>;

const goTo = (menu: string) => window.dispatchEvent(new CustomEvent('navigate', { detail: menu }));

const RequestLetter: React.FC = () => {
  const auth = useContext(AuthContext);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [hasProfile, setHasProfile] = useState(true);
  const [currentIntent, setCurrentIntent] = useState<ActiveIntent | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [provinceList, setProvinceList] = useState<Province[]>([]);
  const [calendar, setCalendar] = useState<CoopCalendarResponse | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState('');
  /** บริษัทที่มีในระบบอยู่แล้ว — ยื่นด้วย company_id ข้อมูลในฟอร์มเป็นของทำเนียบ แก้ที่นี่ไม่ได้ */
  const [existingCompanyId, setExistingCompanyId] = useState<number | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [lateReason, setLateReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [googleMapsApiKey, setGoogleMapsApiKey] = useState('');
  const [mapsLoaded, setMapsLoaded] = useState(false);

  const alertRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<PlacesAutocomplete | null>(null);

  const activity = (key: string) => calendar?.activities.find((a) => a.activity_key === key);
  const submission = activity('intent_submission');
  const isLate = submission?.status === 'late';
  const coopStart = activity('coop_start')?.start_date ?? null;
  const coopEnd = activity('coop_end')?.end_date ?? null;

  const blockingIntent =
    currentIntent && !CLOSED_INTENT_STATUSES.includes(currentIntent.status) ? currentIntent : null;
  const canSubmit = hasProfile && blockingIntent === null;
  const locked = existingCompanyId !== null;

  const loadData = async () => {
    try {
      const [me, profileRes, companiesData, masterData, calendarData] = await Promise.all([
        api.get('/students/dashboard').then(
          (d) => ({ ok: true as const, d }),
          (e) => ({ ok: false as const, e })
        ),
        api.get('/profile/me').then(
          (d) => ({ ok: true as const, d }),
          (e) => ({ ok: false as const, e })
        ),
        api.get('/companies'),
        api.get('/master-data'),
        // ตั้งใจเงียบ: ปฏิทินเป็น fail-open ทั้งระบบ (CLAUDE.md) — อ่านไม่ได้ต้องไม่ปิดฟอร์มยื่น
        // ผลคือไม่ถามเหตุผลส่งช้าล่วงหน้า และช่วงปฏิบัติงานขึ้นว่า "ยังไม่ได้ตั้ง" · เซิร์ฟเวอร์ยังเป็นด่านจริง
        // eslint-disable-next-line no-restricted-syntax
        api.get('/calendar').catch(() => null),
      ]);

      setCompanies(companiesData || []);
      setProvinceList(masterData.provinces || []);
      if (masterData.googleMapsApiKey) setGoogleMapsApiKey(masterData.googleMapsApiKey);
      setCalendar(calendarData as CoopCalendarResponse | null);

      if (me.ok) {
        setHasProfile(true);
        setCurrentIntent(me.d?.activeIntent ?? null);
      } else if (getErrorStatus(me.e) === 404) {
        setHasProfile(false);
        setCurrentIntent(null);
      } else {
        throw me.e;
      }
      setProfile(profileRes.ok ? ((profileRes.d?.profile as StudentProfile) ?? null) : null);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลสำหรับยื่นคำร้องได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // โหลดครั้งเดียวตอนเปิดหน้า — รูปแบบเดียวกับทุกหน้าจอในโปรเจคนี้ · ปิดกฎตรงจุดพร้อมเหตุผล
    // แทนการเพิ่มหนี้ lint (ดูคอมเมนต์เดียวกันใน CoopJobApplication.tsx)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, []);

  useEffect(() => {
    if (googleMapsApiKey) {
      loadGoogleMapsScript(
        googleMapsApiKey,
        () => setMapsLoaded(true),
        // โหลดแผนที่ไม่ได้ = ไม่มีรายการแนะนำจาก Google · ยังค้นทำเนียบและพิมพ์เองได้ครบ
        () => setMapsLoaded(false)
      );
    }
  }, [googleMapsApiKey]);

  const fillFromCompany = (company: Company) => {
    setExistingCompanyId(company.company_id);
    setSelectedPlaceId(null);
    setSearch(company.name_th);
    setForm({
      company_name_th: company.name_th,
      company_address: company.address,
      company_province: company.province,
      company_district: company.district,
      company_postal_code: company.postal_code,
      company_phone: company.phone,
      contact_person: company.contact_person ?? '',
      contact_position: company.contact_position ?? '',
    });
  };

  const clearCompany = () => {
    setExistingCompanyId(null);
    setSelectedPlaceId(null);
    setSearch('');
    setForm(EMPTY_FORM);
  };

  const handlePlaceSelected = async (place: PlaceResult) => {
    if (!place?.place_id) return;

    const components = place.address_components ?? [];
    const pick = (...types: string[]) =>
      components.find((c: AddressComponent) => types.some((t) => c.types.includes(t)))?.long_name ?? '';

    const province = pick('administrative_area_level_1').replace(/^จังหวัด/, '').trim();
    const district = pick('administrative_area_level_2', 'sublocality_level_1', 'locality')
      .replace(/^(อำเภอ|เขต)/, '')
      .trim();
    const address = (place.formatted_address || '').replace(/,?\s*ประเทศไทย$/, '');
    let phone = (place.formatted_phone_number || '').replace(/[\s-]/g, '');
    if (phone.startsWith('+66')) phone = '0' + phone.slice(3);

    setExistingCompanyId(null);
    setSelectedPlaceId(place.place_id);
    setSearch(place.name || '');
    setForm((prev) => ({
      ...prev,
      company_name_th: place.name || prev.company_name_th,
      company_address: address || prev.company_address,
      company_province: province || prev.company_province,
      company_district: district || prev.company_district,
      company_postal_code: pick('postal_code') || prev.company_postal_code,
      company_phone: phone || prev.company_phone,
    }));

    // สถานที่เดียวกันอาจอยู่ในทำเนียบแล้ว (นักศึกษาคนอื่นเคยยื่น) — ใช้แถวนั้นแทนการสร้างซ้ำ
    const known = companies.find((c) => c.google_place_id === place.place_id);
    if (known) fillFromCompany(known);
  };

  useEffect(() => {
    if (!mapsLoaded || !searchInputRef.current || !canSubmit) return;
    const maps = googleMaps();
    if (!maps?.places) return;

    autocompleteRef.current = new maps.places.Autocomplete(searchInputRef.current, {
      types: ['establishment'],
      componentRestrictions: { country: 'th' },
      fields: ['place_id', 'name', 'formatted_address', 'address_components', 'formatted_phone_number'],
    });
    const listener = autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace();
      if (place) handlePlaceSelected(place);
    });
    return () => {
      if (listener) googleMaps()?.event.removeListener(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsLoaded, canSubmit, loading]);

  const query = search.trim().toLowerCase();
  const directoryMatches =
    !locked && query.length >= 2
      ? companies
          .filter(
            (c) =>
              c.name_th.toLowerCase().includes(query) ||
              (c.name_en ?? '').toLowerCase().includes(query)
          )
          .slice(0, 5)
      : [];

  const scrollToAlert = () =>
    requestAnimationFrame(() => alertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const missingCompany = (
      ['company_name_th', 'company_address', 'company_province', 'company_district', 'company_postal_code', 'company_phone'] as const
    ).some((key) => !form[key].trim());
    let problem: string | null = null;
    if (missingCompany) {
      problem = 'กรุณากรอกข้อมูลสถานประกอบการที่มีเครื่องหมาย * ให้ครบ';
    } else if (!locked && !/^\d{5}$/.test(form.company_postal_code.trim())) {
      problem = 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก';
    } else if (!locked && (!form.contact_person.trim() || !form.contact_position.trim())) {
      // ชื่อนี้ถูกพิมพ์ลงแบบคำร้องและหนังสือขอความอนุเคราะห์ — ว่างแล้วหนังสือไม่มีผู้รับ
      problem = 'กรุณากรอกชื่อและตำแหน่งของผู้รับหนังสือที่สถานประกอบการ';
    } else if (isLate && lateReason.trim().length < LATE_REASON_MIN) {
      problem = `กรุณาเขียนเหตุผลที่ยื่นล่าช้าอย่างน้อย ${LATE_REASON_MIN} ตัวอักษร`;
    }

    if (problem) {
      setError(problem);
      scrollToAlert();
      return;
    }
    setConfirmOpen(true);
  };

  const submit = async () => {
    setIsSubmitting(true);
    try {
      const activeSemester = await api.get('/semesters/active');
      const late_reason = isLate ? lateReason.trim() : undefined;

      if (existingCompanyId !== null) {
        await api.post('/intents', {
          company_id: existingCompanyId,
          semester_id: activeSemester.semester_id,
          late_reason,
        });
      } else {
        await api.post('/intents', {
          is_self_found: true,
          semester_id: activeSemester.semester_id,
          company_name_th: form.company_name_th.trim(),
          company_address: form.company_address.trim(),
          company_province: form.company_province,
          company_district: form.company_district.trim(),
          company_postal_code: form.company_postal_code.trim(),
          company_phone: form.company_phone.trim(),
          contact_person: form.contact_person.trim(),
          contact_position: form.contact_position.trim(),
          google_place_id: selectedPlaceId ?? undefined,
          late_reason,
        });
      }

      setSuccess(
        `ยื่นคำร้องถึง ${form.company_name_th.trim()} เรียบร้อยแล้ว — ไปที่หน้าแรกเพื่อพิมพ์แบบคำร้องที่ระบบกรอกให้ นำไปลงนาม แล้วอัปโหลดกลับ`
      );
      clearCompany();
      setLateReason('');
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'ยื่นคำร้องไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSubmitting(false);
      setConfirmOpen(false);
      scrollToAlert();
    }
  };

  if (loading) return <PageSkeleton variant="form" />;

  const studentName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  const majorName = (profile?.major_name_th ?? '').replace(/^สาขาวิชา\s*/, '');
  const email = auth?.user?.email || profile?.alt_email || '';
  const fullAddress = [form.company_address, form.company_district, form.company_province, form.company_postal_code]
    .map((v) => v.trim())
    .filter(Boolean)
    .join(' ');
  const period =
    coopStart && coopEnd ? `${formatThaiDate(coopStart)} – ${formatThaiDate(coopEnd)}` : null;
  const semesterLabel = calendar?.semester
    ? `ภาคเรียนที่ ${calendar.semester.semester}/${calendar.semester.academic_year + 543}`
    : null;

  const field = (key: keyof typeof EMPTY_FORM) => ({
    value: form[key],
    disabled: locked || isSubmitting,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value })),
  });

  /** ค่าที่ระบบพิมพ์ให้บนกระดาษ — ว่าง = เส้นประ เหมือนบนแบบฟอร์มจริง */
  const typed = (value: string | number | null | undefined) =>
    value === null || value === undefined || value === '' ? (
      <span className="text-gray-400 dark:text-gray-500">……………</span>
    ) : (
      <b className="font-semibold text-brand-navy dark:text-blue-300">{value}</b>
    );

  return (
    <div className="space-y-5 page-enter">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-xs font-semibold text-brand-blue dark:text-blue-400">
            ก่อนออกฝึก · เอกสารหมายเลข 1
          </span>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            ยื่นคำร้องขอหนังสือขอความอนุเคราะห์
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            กรอกแค่ข้อมูลสถานประกอบการ ที่เหลือระบบดึงจากโปรไฟล์และปฏิทินสหกิจให้
          </p>
        </div>
        {semesterLabel && (
          <span className="rounded-full border border-blue-200 bg-blue-100 px-3.5 py-1.5 text-xs font-bold text-brand-navy dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
            {semesterLabel}
            {submission?.end_date ? ` · เปิดรับถึง ${formatThaiDate(submission.end_date)}` : ''}
          </span>
        )}
      </div>

      <div ref={alertRef} className="empty:hidden space-y-4">
        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={success} />
      </div>

      {!hasProfile && (
        <AlertBanner
          variant="info"
          message={
            <div className="space-y-2">
              <p className="font-bold">ยังยื่นคำร้องไม่ได้ — ต้องกรอกประวัตินักศึกษาก่อน</p>
              <p>ระบบต้องใช้ข้อมูลประวัติของคุณพิมพ์ลงแบบคำร้องและหนังสือถึงสถานประกอบการ</p>
              <Button size="sm" onClick={() => goTo('profile')}>
                ไปกรอกประวัตินักศึกษา
              </Button>
            </div>
          }
        />
      )}

      {blockingIntent && (
        <AlertBanner
          variant="info"
          message={
            <div className="space-y-2" data-testid="request-blocking-intent">
              <p className="font-bold">คุณมีคำร้องที่ดำเนินการอยู่แล้ว</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{blockingIntent.company_name_th || 'สถานประกอบการที่ยื่นไว้'}</span>
                <StatusBadge status={blockingIntent.status} domain="intent" />
              </p>
              <p>
                ยื่นได้ครั้งละ 1 แห่งต่อภาคการศึกษา หากต้องการเปลี่ยนที่ ต้องรอผลของใบนี้ก่อน หรือติดต่ออาจารย์ที่ปรึกษา
              </p>
              <Button variant="secondary" size="sm" onClick={() => goTo('dashboard')}>
                ไปพิมพ์แบบคำร้องและดูความคืบหน้าที่หน้าแรก
              </Button>
            </div>
          }
        />
      )}

      {canSubmit && (
        <div className="flex flex-wrap items-start gap-5">
          {/* ══ ซ้าย: ฟอร์ม ══ */}
          <form onSubmit={handleSubmit} noValidate className="min-w-0 flex-[999_1_560px] space-y-4">
            <section className="space-y-3.5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-gray-900 dark:text-white">ข้อมูลของคุณ</h2>
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  ดึงจากโปรไฟล์ ·{' '}
                  <button
                    type="button"
                    onClick={() => goTo('profile')}
                    className="font-bold text-brand-blue underline dark:text-blue-400"
                  >
                    แก้ที่หน้าข้อมูลส่วนตัว
                  </button>
                </span>
              </div>
              <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-3" data-testid="request-student-summary">
                {[
                  ['ชื่อ-นามสกุล', studentName],
                  ['รหัสนักศึกษา', profile?.student_code],
                  ['สาขาวิชา · ชั้นปี', [majorName, profile?.year_level ? `ปี ${profile.year_level}` : ''].filter(Boolean).join(' · ')],
                  ['โทรศัพท์มือถือ', profile?.phone],
                  ['E-mail', email],
                  ['ช่วงปฏิบัติงาน (จากปฏิทินสหกิจ)', period ?? 'เจ้าหน้าที่ยังไม่ได้ตั้งในปฏิทิน'],
                ].map(([label, value]) => (
                  <div key={label as string} className="min-w-0">
                    <dt className="text-xs text-gray-600 dark:text-gray-400">{label}</dt>
                    <dd className="break-words font-semibold text-gray-900 dark:text-gray-100">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-white">สถานประกอบการที่ขอหนังสือถึง</h2>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  ชื่อและที่อยู่ชุดนี้ถูกพิมพ์ลงหนังสือที่คณบดีลงนาม
                </p>
              </div>

              <div>
                <label htmlFor="request-company-search" className="mb-1 block text-xs font-semibold text-brand-navy dark:text-blue-300">
                  ค้นหาจากทำเนียบของคณะ{mapsLoaded ? ' หรือ Google Maps' : ''}
                </label>
                {/* อยู่ **เหนือ** ช่องค้นหาโดยตั้งใจ — รายการแนะนำของ Google Maps กางลงใต้ช่อง
                    ถ้าวางไว้ข้างล่างจะถูกบังมิด (เจอตอนลองบนหน้าจริง 2026-10-05) */}
                {directoryMatches.length > 0 && (
                  <ul className="mb-2 space-y-1.5" data-testid="request-directory-matches">
                    {directoryMatches.map((c) => (
                      <li key={c.company_id}>
                        <button
                          type="button"
                          onClick={() => fillFromCompany(c)}
                          className="flex w-full flex-wrap items-baseline justify-between gap-x-3 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 text-left text-sm hover:border-green-400 dark:border-green-900 dark:bg-green-950/30 dark:hover:border-green-600"
                        >
                          <span className="font-semibold text-gray-900 dark:text-gray-100">{c.name_th}</span>
                          <span className="text-xs text-green-800 dark:text-green-300">
                            ในทำเนียบของคณะ · {c.district} {c.province}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-brand-blue dark:text-blue-400" />
                  <input
                    id="request-company-search"
                    ref={searchInputRef}
                    type="text"
                    data-testid="request-company-search"
                    value={search}
                    disabled={locked || isSubmitting}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="พิมพ์ชื่อสถานประกอบการ"
                    className="h-11 w-full rounded-xl border border-blue-600 bg-blue-50 pl-10 pr-3.5 text-sm font-medium text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:opacity-70 dark:border-blue-700 dark:bg-blue-950/30 dark:text-white dark:placeholder:text-gray-400"
                  />
                </div>
                {locked && (
                  <div
                    className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300"
                    data-testid="request-company-locked"
                  >
                    <span>อยู่ในทำเนียบของคณะแล้ว — ระบบใช้ข้อมูลจากทำเนียบ แก้ที่นี่ไม่ได้</span>
                    <button type="button" onClick={clearCompany} className="font-bold underline">
                      เลือกที่อื่น
                    </button>
                  </div>
                )}
              </div>

              {/* lg: ไม่ใช่ sm: — คอลัมน์ฟอร์มแคบกว่าจอมาก (มีแถบเมนู + ตัวอย่างกระดาษ) 4 ช่องที่จอ 800px จะบีบจนอ่านไม่ออก */}
              <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
                <div className="col-span-2 lg:col-span-4">
                  <label htmlFor="request-company-name" className={labelClass}>ชื่อสถานประกอบการ {required}</label>
                  <Input id="request-company-name" data-testid="request-company-name" maxLength={255} {...field('company_name_th')} />
                </div>
                <div className="col-span-2 lg:col-span-4">
                  <label htmlFor="request-address" className={labelClass}>ที่อยู่ (เลขที่ อาคาร ซอย ถนน ตำบล) {required}</label>
                  <Input id="request-address" data-testid="request-address" maxLength={255} {...field('company_address')} />
                </div>
                <div>
                  <label htmlFor="request-district" className={labelClass}>อำเภอ/เขต {required}</label>
                  <Input id="request-district" data-testid="request-district" maxLength={100} {...field('company_district')} />
                </div>
                <div>
                  <label htmlFor="request-province" className={labelClass}>จังหวัด {required}</label>
                  <Select id="request-province" data-testid="request-province" {...field('company_province')}>
                    <option value="">-- เลือก --</option>
                    {/* จังหวัดจากทำเนียบ/Google ที่สะกดไม่ตรงรายการ ต้องยังแสดงค่าเดิม ไม่ใช่กลายเป็นว่าง */}
                    {form.company_province &&
                      !provinceList.some((p) => p.province_name_th === form.company_province) && (
                        <option value={form.company_province}>{form.company_province}</option>
                      )}
                    {provinceList.map((p) => (
                      <option key={p.province_id} value={p.province_name_th}>
                        {p.province_name_th}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="request-postal" className={labelClass}>รหัสไปรษณีย์ {required}</label>
                  <Input id="request-postal" data-testid="request-postal" inputMode="numeric" maxLength={5} {...field('company_postal_code')} />
                </div>
                <div>
                  <label htmlFor="request-phone" className={labelClass}>โทรศัพท์ที่ทำงาน {required}</label>
                  <Input id="request-phone" data-testid="request-phone" maxLength={20} {...field('company_phone')} />
                </div>
                <div className="col-span-2">
                  <label htmlFor="request-contact-person" className={labelClass}>ชื่อผู้รับหนังสือ {required}</label>
                  <Input id="request-contact-person" data-testid="request-contact-person" maxLength={255} placeholder="เช่น คุณสมหญิง วงศ์สวัสดิ์" {...field('contact_person')} />
                </div>
                <div className="col-span-2">
                  <label htmlFor="request-contact-position" className={labelClass}>ตำแหน่ง {required}</label>
                  <Input id="request-contact-position" data-testid="request-contact-position" maxLength={255} placeholder="เช่น ผู้จัดการฝ่ายทรัพยากรบุคคล" {...field('contact_position')} />
                </div>
              </div>
            </section>

            {isLate && (
              <section className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900/40 dark:bg-amber-950/20">
                <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                  การยื่นครั้งนี้เลยกำหนดปกติแล้ว จึงนับเป็นการส่งช้า
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {submission?.late_end_date ? `ระบบยังรับได้ถึงวันที่ ${formatThaiDate(submission.late_end_date)} ` : 'ระบบยังรับได้ '}
                  และจะพิมพ์บันทึกข้อความชี้แจงให้พร้อมแบบคำร้อง เพื่อนำไปเสนออาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชาตามขั้นตอน
                </p>
                <label htmlFor="request-late-reason" className={labelClass}>เหตุผลที่ยื่นล่าช้า {required}</label>
                <Textarea
                  id="request-late-reason"
                  data-testid="request-late-reason"
                  rows={3}
                  value={lateReason}
                  disabled={isSubmitting}
                  onChange={(e) => setLateReason(e.target.value)}
                  placeholder="เขียนด้วยคำของตัวเอง ข้อความนี้จะถูกพิมพ์ลงบันทึกข้อความที่เสนอถึงคณบดี"
                />
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-gray-600 dark:text-gray-400">ยื่นได้ครั้งละ 1 แห่งต่อภาคการศึกษา</span>
              <Button type="submit" data-testid="request-submit" loading={isSubmitting}>
                ตรวจแล้ว ยื่นคำร้อง
              </Button>
            </div>
          </form>

          {/* ══ ขวา: ตัวอย่างกระดาษ + ขั้นถัดไป ══ */}
          <aside className="min-w-0 flex-[1_1_340px] space-y-4">
            <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4.5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">ตัวอย่างเอกสารที่จะได้</h2>
              <div
                data-testid="request-paper-preview"
                className="space-y-1.5 rounded-md border border-gray-300 bg-white p-4 text-[11px] leading-relaxed text-gray-700 shadow-md dark:border-gray-600 dark:bg-gray-950 dark:text-gray-300"
              >
                <p className="text-center text-xs font-bold text-gray-900 dark:text-white">
                  แบบคำร้องขอหนังสือขอความอนุเคราะห์นักศึกษาสหกิจศึกษา
                </p>
                <p className="text-right">วันที่ {typed(calendar?.today ? formatThaiDate(calendar.today) : '')}</p>
                <p>ข้าพเจ้า {typed(studentName)} รหัส {typed(profile?.student_code)}</p>
                <p>สาขาวิชา {typed(majorName)} ชั้นปีที่ {typed(profile?.year_level)}</p>
                <p>โทรศัพท์มือถือ {typed(profile?.phone)}</p>
                <p>ชื่อสถานประกอบการ {typed(form.company_name_th.trim())}</p>
                <p>ที่อยู่ {typed(fullAddress)}</p>
                <p>ผู้รับหนังสือ {typed(form.contact_person.trim())} ตำแหน่ง {typed(form.contact_position.trim())}</p>
                <p>โทรศัพท์ที่ทำงาน {typed(form.company_phone.trim())}</p>
                <p>
                  เริ่มฝึกงาน {typed(coopStart ? formatThaiDate(coopStart) : '')} ถึง{' '}
                  {typed(coopEnd ? formatThaiDate(coopEnd) : '')}
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1.5 text-center text-gray-600 dark:text-gray-400">
                  <div className="rounded border border-dashed border-gray-400 p-2 dark:border-gray-600">ลงนาม<br />อาจารย์ที่ปรึกษา</div>
                  <div className="rounded border border-dashed border-gray-400 p-2 dark:border-gray-600">ลงนาม<br />หัวหน้าสาขาวิชา</div>
                </div>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                ตัวหนังสือสีน้ำเงินคือสิ่งที่ระบบพิมพ์ลงแบบฟอร์มตัวจริงให้ — ไม่มีช่องให้เขียนมือ
              </p>
            </section>

            <section className="space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              <h2 className="text-sm font-bold">หลังกดยื่น</h2>
              {[
                'พิมพ์แบบคำร้องที่กรอกแล้วจากหน้าแรก และลงชื่อ',
                'ให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชาลงนาม',
                'สแกนหรือถ่ายรูป อัปโหลดกลับที่หน้าแรก',
              ].map((step, i) => (
                <p key={step} className="flex gap-2.5">
                  <b className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-900 text-[11px] text-amber-50 dark:bg-amber-200 dark:text-amber-950">
                    {i + 1}
                  </b>
                  <span>{step}</span>
                </p>
              ))}
            </section>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันยื่นคำร้อง"
        confirmLabel="ยืนยันยื่นคำร้อง"
        cancelLabel="กลับไปแก้"
        confirmTestId="request-confirm"
        cancelTestId="request-confirm-cancel"
        busy={isSubmitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={submit}
        message={
          <ConfirmSummary
            lead="ยื่นแล้วระบบเริ่มเดินเรื่องขอหนังสือกับสถานประกอบการนี้ให้"
            rows={[
              { label: 'สถานประกอบการ', value: form.company_name_th.trim() },
              { label: 'ที่อยู่', value: fullAddress },
              {
                label: 'ผู้รับหนังสือ',
                value: [form.contact_person.trim(), form.contact_position.trim()].filter(Boolean).join(' · ') || '—',
              },
              ...(isLate ? [{ label: 'เหตุผลที่ยื่นช้า', value: lateReason.trim() }] : []),
            ]}
            lockNote="ชื่อและที่อยู่นี้จะถูกพิมพ์ลงแบบคำร้องและหนังสือขอความอนุเคราะห์ · เปลี่ยนสถานประกอบการได้จนกว่าเจ้าหน้าที่จะออกเลขหนังสือ"
          />
        }
      />
    </div>
  );
};

export default RequestLetter;
