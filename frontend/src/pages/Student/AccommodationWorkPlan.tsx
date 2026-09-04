import React, { useState, useEffect, useContext, useRef } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import { AuthContext } from '../../context/AuthContext';
import api, { API_BASE_URL } from '../../services/api';
import { Home, Calendar, Plus, Trash2, Check, ChevronDown, Copy, Printer } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';
import type { WeeklyPlan } from '../../types/api';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { loadThaiAddressData, type ProvinceItem } from '../../data/thaiAddress';
import type { AddressComponent } from '../../types/googleMaps';
import AccommodationMapPicker from './AccommodationMapPicker';

/**
 * ที่พักตามช่องของ **สหกิจ 06** (แบบแจ้งรายละเอียดที่พัก)
 *
 * ⛔ เดิมเป็น `address` ก้อนเดียว — พิมพ์ลงแบบฟอร์มที่มีช่องแยกไม่ได้ และอาจารย์
 * นิเทศเอาไปหาทางต่อไม่ได้ · แตกเป็นช่องย่อยเมื่อ 2026-09-03 (migration 010)
 */
interface Accommodation {
  /**
   * "ห้อง" บนหัวใบ สหกิจ 06 = **ห้องเรียน** (อยู่ข้าง "ชั้นปีที่") ไม่ใช่เลขห้องพัก
   * เลขห้องพักคือ `room_no` ด้านล่าง · เก็บบน `students` แบบเดียวกับผู้ติดต่อฉุกเฉิน
   * แต่ส่งมาในก้อนเดียวกับที่พักเพราะหน้าจอเดียวกันเป็นคนกรอก
   */
  section: string;
  house_no: string;
  building: string;
  room_no: string;
  soi: string;
  road: string;
  subdistrict: string;
  district: string;
  province: string;
  postal_code: string;
  phone: string;
  mobile_phone: string;
  fax: string;
  email: string;
  latitude: string;
  longitude: string;
  emergency_contact: string;
  emergency_relationship: string;
  emergency_phone: string;
}

const BLANK_ACCOMMODATION: Accommodation = {
  section: '',
  house_no: '',
  building: '',
  room_no: '',
  soi: '',
  road: '',
  subdistrict: '',
  district: '',
  province: '',
  postal_code: '',
  phone: '',
  mobile_phone: '',
  fax: '',
  email: '',
  latitude: '',
  longitude: '',
  emergency_contact: '',
  emergency_relationship: '',
  emergency_phone: '',
};

/**
 * จับชื่อจังหวัด/อำเภอ/ตำบลที่ Google ส่งกลับมา เข้ากับชุดข้อมูลของโปรเจคเอง
 *
 * ⛔ **ไม่เชื่อชื่อจาก Google ตรงๆ** — Google สะกดไม่เหมือนกันทุกที่ (บางที่มี
 * "ตำบล" นำ บางที่ไม่มี · เขตของ กทม. บางทีเป็น "Bang Rak") และค่าที่ไม่ตรงกับ
 * dropdown จะทำให้ช่องนั้นว่างเงียบๆ ทั้งที่ผู้ใช้เห็นว่าปักหมุดสำเร็จแล้ว
 * จึงยอมรับเฉพาะชื่อที่มีอยู่จริงในชุดข้อมูล ที่เหลือปล่อยให้เลือกเอง
 */
const matchName = (candidates: string[], names: string[]): string => {
  const strip = (s: string) =>
    s.replace(/^(จังหวัด|จ\.|อำเภอ|อ\.|เขต|ตำบล|ต\.|แขวง)\s*/, '').trim();
  for (const raw of candidates) {
    const bare = strip(raw);
    const hit = names.find((n) => n === raw || n === bare || strip(n) === bare);
    if (hit) return hit;
  }
  return '';
};

const AccommodationWorkPlan: React.FC = () => {
  const auth = useContext(AuthContext);
  const [step, setStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [accommodation, setAccommodation] = useState<Accommodation>(BLANK_ACCOMMODATION);
  /** ที่อยู่ก้อนเดียวที่เคยกรอกไว้ก่อนแตกช่อง — แสดงเป็นตัวช่วยจำ ไม่ถูกส่งกลับ */
  const [legacyAddress, setLegacyAddress] = useState('');
  // 77 จังหวัด / 930 อำเภอ / 7,452 ตำบล — โหลดแบบ dynamic เมื่อฟอร์มต้องใช้จริง
  // (ดูเหตุผลใน data/thaiAddress.ts) ว่างอยู่ชั่วครู่ระหว่างรอ ซึ่ง dropdown บอกเอง
  const [thaiAddress, setThaiAddress] = useState<ProvinceItem[]>([]);

  const MIN_WEEKS = 16;
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);

  /** The one date the other 32 are derived from. Not sent to the server. */
  const [coopStartDate, setCoopStartDate] = useState<string>('');
  /** Only one week is expanded at a time; the rest are one line each. */
  const [openWeek, setOpenWeek] = useState<number | null>(1);
  /** Set when unsaved work was found in this browser and restored. */
  const [restoredDraft, setRestoredDraft] = useState(false);

  const DRAFT_KEY = `accommodation_plan_draft_${auth?.user?.userId ?? 'anon'}`;

  /** สิ่งที่ฝั่งเซิร์ฟเวอร์รู้แล้ว — ใช้เทียบว่านักศึกษาแก้อะไรจริงหรือยัง */
  const savedSnapshot = useRef<string>('');

  const snapshotOf = (a: Accommodation, plans: WeeklyPlan[], startDate: string) =>
    JSON.stringify({ accommodation: a, weeklyPlans: plans, coopStartDate: startDate });

  useEffect(() => {
    loadData();
    loadThaiAddressData().then(setThaiAddress).catch(() => setThaiAddress([]));
  }, []);

  const availableDistricts =
    thaiAddress.find((p) => p.name === accommodation.province)?.districts || [];
  const availableSubdistricts =
    availableDistricts.find((d) => d.name === accommodation.district)?.subdistricts || [];

  /**
   * เลือกจังหวัด/อำเภอใหม่ต้องล้างระดับที่ต่ำกว่าเสมอ
   * ไม่งั้นจะได้ "ตำบลบางพระ อำเภอเมือง จังหวัดเชียงใหม่" ซึ่งไม่มีอยู่จริง
   */
  const pickProvince = (name: string) =>
    setAccommodation((a) => ({ ...a, province: name, district: '', subdistrict: '', postal_code: '' }));

  const pickDistrict = (name: string) =>
    setAccommodation((a) => ({ ...a, district: name, subdistrict: '', postal_code: '' }));

  /** ตำบลรู้รหัสไปรษณีย์ของตัวเองอยู่แล้ว — ไม่ต้องให้นักศึกษาพิมพ์ */
  const pickSubdistrict = (name: string) => {
    const zip = availableSubdistricts.find((s) => s.name === name)?.zipcode || '';
    setAccommodation((a) => ({ ...a, subdistrict: name, postal_code: zip || a.postal_code }));
  };

  /**
   * หมุดถูกวาง — เก็บพิกัดเสมอ ส่วนตำบล/อำเภอ/จังหวัดเติมให้ **เฉพาะที่ตรงกับ
   * ชุดข้อมูลของเราจริง** และเฉพาะช่องที่ยังว่าง เพื่อไม่ทับสิ่งที่นักศึกษาเลือกเอง
   */
  const handlePin = (lat: number, lng: number, components: AddressComponent[]) => {
    const namesOfType = (type: string) =>
      components.filter((c) => c.types.includes(type)).flatMap((c) => [c.long_name, c.short_name]);

    setAccommodation((a) => {
      const next = { ...a, latitude: String(lat), longitude: String(lng) };
      if (thaiAddress.length === 0) return next;

      const province =
        a.province ||
        matchName(namesOfType('administrative_area_level_1'), thaiAddress.map((p) => p.name));
      if (!province) return next;
      next.province = province;

      const districts = thaiAddress.find((p) => p.name === province)?.districts || [];
      const district =
        (a.province === province && a.district) ||
        matchName(
          [...namesOfType('administrative_area_level_2'), ...namesOfType('locality')],
          districts.map((d) => d.name)
        );
      if (!district) return { ...next, district: '', subdistrict: '', postal_code: '' };
      next.district = district;

      const subs = districts.find((d) => d.name === district)?.subdistricts || [];
      const subdistrict =
        (a.district === district && a.subdistrict) ||
        matchName(
          [
            ...namesOfType('sublocality_level_1'),
            ...namesOfType('sublocality'),
            ...namesOfType('administrative_area_level_3'),
          ],
          subs.map((s) => s.name)
        );
      if (!subdistrict) return { ...next, subdistrict: '', postal_code: '' };
      next.subdistrict = subdistrict;
      next.postal_code =
        subs.find((s) => s.name === subdistrict)?.zipcode ||
        namesOfType('postal_code')[0] ||
        next.postal_code;
      return next;
    });
  };

  /**
   * Keep unsaved work in the browser. This form is agreed with the mentor, so
   * it is often filled in over a meeting rather than in one sitting — and it
   * was 48 fields with nothing behind them: one closed tab and the lot was
   * gone. Cleared on a successful submit, so a draft existing at all means
   * there are edits the server has not seen.
   *
   * ⛔ เงื่อนไขนั้นจะจริงได้ **ต้องเทียบกับสิ่งที่เซิร์ฟเวอร์ส่งมาก่อนเขียนทุกครั้ง** — ไม่ใช่
   *    แค่ `!isLoading` เพราะ effect นี้ยิงทันทีที่ `loadData()` เสร็จ (และยิงสองรอบใน
   *    StrictMode) แค่ *เปิดหน้า* ก็ได้ฉบับร่างที่เหมือนของบนเซิร์ฟเวอร์เป๊ะ แล้วรอบหน้า
   *    ขึ้นแถบ "กู้คืนข้อมูลที่กรอกค้างไว้" ทั้งที่ไม่มีใครแก้อะไรเลย
   */
  useEffect(() => {
    if (isLoading) return;
    const current = snapshotOf(accommodation, weeklyPlans, coopStartDate);
    try {
      // กลับมาเท่าของบนเซิร์ฟเวอร์ = ไม่มีอะไรค้างให้กู้คืนแล้ว
      if (current === savedSnapshot.current) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, current);
    } catch {
      /* private mode, or quota — the form still works, just without a net */
    }
  }, [accommodation, weeklyPlans, coopStartDate, isLoading, DRAFT_KEY]);

  /** Local YYYY-MM-DD. toISOString() would shift the day in UTC+7. */
  const toDateInput = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /**
   * Weeks run consecutively, so asking for 32 dates was asking the student to
   * do arithmetic the page can do. One date in, Monday–Friday out for every
   * week; individual weeks stay editable for public holidays.
   */
  const applyCoopStartDate = (iso: string) => {
    setCoopStartDate(iso);
    if (!iso) return;
    const base = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(base.getTime())) return;

    setWeeklyPlans((plans) =>
      plans.map((p, i) => {
        const start = new Date(base);
        start.setDate(base.getDate() + i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 4);
        return { ...p, start_date: toDateInput(start), end_date: toDateInput(end) };
      })
    );
  };

  const copyFromPreviousWeek = (weekNum: number) => {
    const idx = weeklyPlans.findIndex((p) => p.week_number === weekNum);
    if (idx <= 0) return;
    const previous = weeklyPlans[idx - 1];
    updatePlan(weekNum, 'tasks', previous.tasks);
  };

  const isWeekFilled = (p: WeeklyPlan) => !!(p.start_date && p.end_date && p.tasks.trim());
  const filledCount = weeklyPlans.filter(isWeekFilled).length;

  /** Build a blank 16-week plan. */
  const blankWeeks = (): WeeklyPlan[] =>
    Array.from({ length: MIN_WEEKS }, (_, i) => ({
      week_number: i + 1,
      start_date: '',
      end_date: '',
      tasks: ''
    }));

  /**
   * A draft only exists if there are edits that were never submitted, so it
   * wins over whatever the server has. Saying so out loud matters — silently
   * showing different data from what is on record is its own kind of bug — so
   * the page offers to throw it away.
   */
  const applyDraftIfAny = (): boolean => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      // ฉบับร่างที่เหมือนของบนเซิร์ฟเวอร์เป๊ะ ไม่มีอะไรให้กู้คืน — เก็บกวาดของที่ build
      // เก่าเคยเขียนทิ้งไว้ตอนเปิดหน้าเปล่าๆ ไปด้วย
      if (raw === savedSnapshot.current) {
        localStorage.removeItem(DRAFT_KEY);
        return false;
      }
      const draft = JSON.parse(raw);
      if (!draft?.weeklyPlans?.length) return false;
      setAccommodation(draft.accommodation);
      setWeeklyPlans(draft.weeklyPlans);
      setCoopStartDate(draft.coopStartDate || '');
      setRestoredDraft(true);
      return true;
    } catch {
      return false;
    }
  };

  const discardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to clear */
    }
    setRestoredDraft(false);
    loadData();
  };

  const loadData = async () => {
    setIsLoading(true);
    // เก็บไว้เป็นตัวแปรก่อน เพราะต้องเอาไปทำ snapshot ด้วย — อ่านจาก state ตรงนี้ไม่ได้
    // (setState ยังไม่มีผลจนกว่าจะ render รอบถัดไป)
    let loadedAccommodation: Accommodation = BLANK_ACCOMMODATION;
    let loadedLegacy = '';
    let loadedPlans: WeeklyPlan[] = blankWeeks();
    try {
      const res = await api.get(`/students/${auth?.user?.userId}/accommodation-plan`);

      // `section` เป็นคอลัมน์ของ `students` เซิร์ฟเวอร์จึงส่งไว้ระดับบนสุด ไม่ใช่ใน accommodation
      // ⛔ ต้องอ่าน **นอก** เงื่อนไข `res.accommodation` — นักศึกษาที่ยังไม่เคยกรอกที่พัก
      //    ก็อาจมี "ห้อง" อยู่แล้ว การอ่านในเงื่อนไขจะทำให้ค่าที่มีอยู่หายตอนเปิดหน้า
      const loadedSection: string = res.section || '';

      if (res.accommodation) {
        const a = res.accommodation;
        loadedAccommodation = {
          section: loadedSection,
          house_no: a.house_no || '',
          building: a.building || '',
          room_no: a.room_no || '',
          soi: a.soi || '',
          road: a.road || '',
          subdistrict: a.subdistrict || '',
          district: a.district || '',
          province: a.province || '',
          postal_code: a.postal_code || '',
          phone: a.phone || '',
          mobile_phone: a.mobile_phone || '',
          fax: a.fax || '',
          email: a.email || '',
          latitude: a.latitude === null || a.latitude === undefined ? '' : String(a.latitude),
          longitude: a.longitude === null || a.longitude === undefined ? '' : String(a.longitude),
          emergency_contact: a.emergency_contact || '',
          emergency_relationship: a.emergency_relationship || '',
          emergency_phone: a.emergency_phone || ''
        };
        // ⛔ แสดงของเก่าเมื่อ **ยังไม่มีใครกรอกช่องย่อย** เท่านั้น — ไม่งั้นแถวที่กรอกใหม่
        //    แล้วจะขึ้นกล่อง "ที่อยู่เดิม" ค้างตลอดไปโดยไม่มีอะไรให้ทำกับมัน
        loadedLegacy = a.house_no ? '' : a.address_legacy || '';
      } else {
        loadedAccommodation = { ...BLANK_ACCOMMODATION, section: loadedSection };
      }

      if (res.weekly_plans && res.weekly_plans.length > 0) {
        loadedPlans = res.weekly_plans.map((p: WeeklyPlan) => ({
          plan_id: p.plan_id,
          week_number: p.week_number,
          start_date: p.start_date ? new Date(p.start_date).toISOString().split('T')[0] : '',
          end_date: p.end_date ? new Date(p.end_date).toISOString().split('T')[0] : '',
          tasks: p.tasks || ''
        }));
      }
    } catch (err) {
      console.error('Failed to load accommodation and plan:', err);
      // Just show default form if no data found — ค่าตั้งต้นด้านบนคือฟอร์มเปล่าอยู่แล้ว
    } finally {
      setAccommodation(loadedAccommodation);
      setLegacyAddress(loadedLegacy);
      setWeeklyPlans(loadedPlans);
      // วันเริ่มปฏิบัติงานเป็นตัวช่วยคำนวณ ไม่ได้เก็บที่เซิร์ฟเวอร์ — โหลดใหม่ = เริ่มใหม่
      setCoopStartDate('');
      savedSnapshot.current = snapshotOf(loadedAccommodation, loadedPlans, '');
      // Unsaved edits from this browser take precedence over the stored record.
      applyDraftIfAny();
      setIsLoading(false);
    }
  };

  const handleNextStep = () => {
    // ด่านฝั่งหน้าจอคู่กับด่านฝั่ง API — รายชื่อช่องบังคับต้องตรงกันทั้งสองที่
    const missing = [
      ['บ้านเลขที่', accommodation.house_no],
      ['ตำบล/แขวง', accommodation.subdistrict],
      ['อำเภอ/เขต', accommodation.district],
      ['จังหวัด', accommodation.province],
      ['รหัสไปรษณีย์', accommodation.postal_code],
      ['ชื่อผู้ติดต่อฉุกเฉิน', accommodation.emergency_contact],
      ['ความสัมพันธ์', accommodation.emergency_relationship],
      ['เบอร์โทรฉุกเฉิน', accommodation.emergency_phone],
    ]
      .filter(([, value]) => !value.trim())
      .map(([label]) => label);

    if (missing.length > 0) {
      setError(`กรุณากรอกให้ครบ: ${missing.join(' · ')}`);
      return;
    }
    setError(null);
    setStep(2);
  };

  const handlePrevStep = () => {
    setStep(1);
    setError(null);
  };

  const handleAddWeek = () => {
    const nextWeekNum = weeklyPlans.length > 0 ? Math.max(...weeklyPlans.map(p => p.week_number)) + 1 : 1;
    setWeeklyPlans([
      ...weeklyPlans,
      { week_number: nextWeekNum, start_date: '', end_date: '', tasks: '' }
    ]);
  };

  const handleRemoveWeek = (weekNum: number) => {
    if (weeklyPlans.length <= MIN_WEEKS) {
      setError(`ไม่สามารถลบสัปดาห์ได้ ต้องมีอย่างน้อย ${MIN_WEEKS} สัปดาห์`);
      return;
    }
    setWeeklyPlans(weeklyPlans.filter(p => p.week_number !== weekNum));
    setError(null);
  };

  const updatePlan = (weekNum: number, field: keyof WeeklyPlan, value: string) => {
    setWeeklyPlans(plans => plans.map(p => 
      p.week_number === weekNum ? { ...p, [field]: value } : p
    ));
  };

  const handleSubmit = async () => {
    // Validate step 2
    if (weeklyPlans.length < MIN_WEEKS) {
      setError(`กรุณากรอกแผนปฏิบัติงานให้ครบอย่างน้อย ${MIN_WEEKS} สัปดาห์`);
      return;
    }

    const isIncomplete = weeklyPlans.some(p => !p.start_date || !p.end_date || !p.tasks.trim());
    if (isIncomplete) {
      setError('กรุณากรอกรายละเอียดแผนปฏิบัติงาน วันเริ่มต้น วันสิ้นสุด ให้ครบทุกสัปดาห์');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await api.post(`/students/${auth?.user?.userId}/accommodation-plan`, {
        accommodation,
        weekly_plans: weeklyPlans
      });
      setSuccessMsg('บันทึกข้อมูลที่พักและแผนปฏิบัติงานเรียบร้อยแล้ว ข้อมูลจะถูกส่งไปยังอาจารย์นิเทศ');
      // สิ่งที่เพิ่งส่งไปคือของบนเซิร์ฟเวอร์แล้ว — ไม่งั้นแก้อะไรต่อทีเดียวได้ฉบับร่างทันที
      savedSnapshot.current = snapshotOf(accommodation, weeklyPlans, coopStartDate);
      // On record now, so the local copy has nothing left to protect.
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* nothing to clear */
      }
      setRestoredDraft(false);
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <PageSkeleton variant='form' />
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">แบบแจ้งที่พักและแผนปฏิบัติงานสหกิจศึกษา</h2>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          กรุณากรอกข้อมูลที่พักระหว่างการฝึกงานและแผนการทำงานรายสัปดาห์ภายในสัปดาห์แรกของการฝึกงาน
        </p>
      </div>

      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={successMsg} />

      {/* Restoring silently would mean showing something other than what is on
          record without saying so. Say it, and offer the way back. */}
      {restoredDraft && (
        <AlertBanner
          variant="info"
          message={
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="flex-1">
                กู้คืนข้อมูลที่กรอกค้างไว้ในเครื่องนี้แล้ว (ยังไม่ได้ส่งเข้าระบบ)
              </span>
              <button
                type="button"
                onClick={discardDraft}
                className="shrink-0 text-xs font-bold underline hover:no-underline"
              >
                ทิ้งฉบับร่าง แล้วโหลดข้อมูลที่บันทึกไว้
              </button>
            </div>
          }
        />
      )}

      {/* Stepper */}
      <div className="flex items-center justify-center mb-8">
        <div className="flex items-center w-full max-w-sm">
          <div className={`flex flex-col items-center flex-1 transition-colors ${step >= 1 ? 'text-brand-blue' : 'text-gray-600 dark:text-gray-400'} dark:text-blue-400`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold mb-2 transition-colors ${step >= 1 ? 'bg-brand-blue text-white shadow-md' : 'bg-gray-200 dark:bg-gray-800 text-gray-500'} dark:text-gray-400`}>
              <Home className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium">ข้อมูลที่พัก</span>
          </div>
          <div className={`h-1 flex-1 mx-2 rounded-full transition-colors ${step >= 2 ? 'bg-brand-blue' : 'bg-gray-200 dark:bg-gray-800'}`}></div>
          <div className={`flex flex-col items-center flex-1 transition-colors ${step >= 2 ? 'text-brand-blue' : 'text-gray-600 dark:text-gray-400'} dark:text-blue-400`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold mb-2 transition-colors ${step >= 2 ? 'bg-brand-blue text-white shadow-md' : 'bg-gray-200 dark:bg-gray-800 text-gray-500'} dark:text-gray-400`}>
              <Calendar className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium">แผนปฏิบัติงาน</span>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
        {step === 1 ? (
          <div className="p-6 md:p-8 space-y-6">
            {/* หัวใบ สหกิจ 06 ถามห้องเรียนไว้ข้าง "ชั้นปีที่" — ที่เหลือบนหัวใบ
                (ชื่อ · รหัส · สาขา · ชั้นปี · ชื่อสถานประกอบการ) ระบบรู้อยู่แล้ว */}
            <div>
              <label htmlFor="acc-section" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                ห้องเรียน (ตามหัวใบ สหกิจ 06)
              </label>
              <Input
                id="acc-section"
                data-testid="acc-section"
                value={accommodation.section}
                onChange={e => setAccommodation({ ...accommodation, section: e.target.value })}
                placeholder="เช่น 4/1"
                className="sm:max-w-xs"
              />
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                ข้อมูลที่พักอาศัยปัจจุบัน (ระหว่างฝึกงาน)
              </h3>
              
              {/* ที่อยู่เดิมที่เคยกรอกเป็นก้อนเดียว — แยกอัตโนมัติไม่ได้ จึงโชว์ให้คัดลอก
                  ครั้งเดียวแล้วหายไปเอง (ดู migration 010) */}
              {legacyAddress && (
                <div className="mb-4">
                  <AlertBanner
                    variant="info"
                    message={
                      <span>
                        แบบฟอร์มเปลี่ยนเป็นช่องแยกตามใบ สหกิจ 06 แล้ว กรุณากรอกใหม่ครั้งเดียว ·
                        ที่อยู่เดิมที่เคยบันทึกไว้คือ{' '}
                        <strong data-testid="legacy-address">{legacyAddress}</strong>
                      </span>
                    }
                  />
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="acc-house-no" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    บ้านเลขที่ *
                  </label>
                  <Input
                    id="acc-house-no"
                    data-testid="acc-house-no"
                    value={accommodation.house_no}
                    onChange={e => setAccommodation({ ...accommodation, house_no: e.target.value })}
                    placeholder="เช่น 123/45"
                  />
                </div>
                <div>
                  <label htmlFor="acc-building" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    อาคาร / ชื่อหอพัก
                  </label>
                  <Input
                    id="acc-building"
                    data-testid="acc-building"
                    value={accommodation.building}
                    onChange={e => setAccommodation({ ...accommodation, building: e.target.value })}
                    placeholder="เช่น หอพักบ้านสวน อาคาร B"
                  />
                </div>
                <div>
                  <label htmlFor="acc-room-no" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ห้อง
                  </label>
                  <Input
                    id="acc-room-no"
                    data-testid="acc-room-no"
                    value={accommodation.room_no}
                    onChange={e => setAccommodation({ ...accommodation, room_no: e.target.value })}
                    placeholder="เช่น 502"
                  />
                </div>
                <div>
                  <label htmlFor="acc-soi" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ซอย
                  </label>
                  <Input
                    id="acc-soi"
                    data-testid="acc-soi"
                    value={accommodation.soi}
                    onChange={e => setAccommodation({ ...accommodation, soi: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="acc-road" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ถนน
                  </label>
                  <Input
                    id="acc-road"
                    data-testid="acc-road"
                    value={accommodation.road}
                    onChange={e => setAccommodation({ ...accommodation, road: e.target.value })}
                  />
                </div>

                <div>
                  <label htmlFor="acc-province" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    จังหวัด *
                  </label>
                  <Select
                    id="acc-province"
                    data-testid="acc-province"
                    disabled={thaiAddress.length === 0}
                    value={accommodation.province}
                    onChange={e => pickProvince(e.target.value)}
                  >
                    <option value="">
                      {thaiAddress.length === 0 ? 'กำลังโหลดข้อมูลจังหวัด...' : '-- เลือกจังหวัด --'}
                    </option>
                    {thaiAddress.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="acc-district" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    อำเภอ / เขต *
                  </label>
                  <Select
                    id="acc-district"
                    data-testid="acc-district"
                    disabled={!accommodation.province}
                    value={accommodation.district}
                    onChange={e => pickDistrict(e.target.value)}
                  >
                    <option value="">-- เลือกอำเภอ/เขต --</option>
                    {availableDistricts.map(d => (
                      <option key={d.name} value={d.name}>{d.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="acc-subdistrict" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ตำบล / แขวง *
                  </label>
                  <Select
                    id="acc-subdistrict"
                    data-testid="acc-subdistrict"
                    disabled={!accommodation.district}
                    value={accommodation.subdistrict}
                    onChange={e => pickSubdistrict(e.target.value)}
                  >
                    <option value="">-- เลือกตำบล/แขวง --</option>
                    {availableSubdistricts.map(s => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="acc-postal-code" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    รหัสไปรษณีย์ *
                  </label>
                  <Input
                    id="acc-postal-code"
                    data-testid="acc-postal-code"
                    inputMode="numeric"
                    maxLength={5}
                    value={accommodation.postal_code}
                    onChange={e => setAccommodation({ ...accommodation, postal_code: e.target.value.replace(/\D/g, '') })}
                    placeholder="เติมให้อัตโนมัติเมื่อเลือกตำบล"
                  />
                </div>
              </div>

              {/* กรอบ "แผนที่แสดงตำแหน่งที่ตั้ง" ของฟอร์มจริง — ไม่บังคับ */}
              <div className="mt-6 space-y-2">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  แผนที่แสดงตำแหน่งที่ตั้งที่พัก (ไม่บังคับ)
                </label>
                <AccommodationMapPicker
                  latitude={accommodation.latitude}
                  longitude={accommodation.longitude}
                  onPick={handlePin}
                />
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="acc-phone" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    โทรศัพท์ที่พัก
                  </label>
                  <Input
                    id="acc-phone"
                    data-testid="acc-phone"
                    value={accommodation.phone}
                    onChange={e => setAccommodation({ ...accommodation, phone: e.target.value })}
                    placeholder="เช่น 02-123-4567 ต่อ 101"
                  />
                </div>
                <div>
                  <label htmlFor="acc-mobile" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    โทรศัพท์มือถือ
                  </label>
                  <Input
                    id="acc-mobile"
                    data-testid="acc-mobile"
                    value={accommodation.mobile_phone}
                    onChange={e => setAccommodation({ ...accommodation, mobile_phone: e.target.value })}
                    placeholder="เช่น 089-123-4567"
                  />
                </div>
                <div>
                  <label htmlFor="acc-fax" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    โทรสาร
                  </label>
                  <Input
                    id="acc-fax"
                    data-testid="acc-fax"
                    value={accommodation.fax}
                    onChange={e => setAccommodation({ ...accommodation, fax: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="acc-email" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    E-mail
                  </label>
                  <Input
                    id="acc-email"
                    data-testid="acc-email"
                    type="email"
                    value={accommodation.email}
                    onChange={e => setAccommodation({ ...accommodation, email: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100 dark:border-gray-800">
              <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                บุคคลติดต่อกรณีฉุกเฉิน (สำคัญมาก)
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label htmlFor="acc-emg-name" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ชื่อ-นามสกุล บุคคลติดต่อฉุกเฉิน *
                  </label>
                  <Input
                    id="acc-emg-name"
                    data-testid="acc-emg-name"
                    value={accommodation.emergency_contact}
                    onChange={e => setAccommodation({...accommodation, emergency_contact: e.target.value})}
                    placeholder="เช่น นายสมชาย ใจดี"
                  />
                </div>
                <div>
                  <label htmlFor="acc-emg-relation" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ความสัมพันธ์ *
                  </label>
                  <Input
                    id="acc-emg-relation"
                    data-testid="acc-emg-relation"
                    value={accommodation.emergency_relationship}
                    onChange={e => setAccommodation({...accommodation, emergency_relationship: e.target.value})}
                    placeholder="เช่น บิดา, มารดา, พี่ชาย"
                  />
                </div>
                <div>
                  <label htmlFor="acc-emg-phone" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    เบอร์โทรศัพท์ฉุกเฉิน *
                  </label>
                  <Input
                    id="acc-emg-phone"
                    data-testid="acc-emg-phone"
                    value={accommodation.emergency_phone}
                    onChange={e => setAccommodation({...accommodation, emergency_phone: e.target.value})}
                    placeholder="เช่น 089-123-4567"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={handleNextStep}
                className="px-6 py-2.5 rounded-xl font-bold text-white bg-brand-blue hover:bg-blue-700 shadow-sm transition-all text-sm"
              >
                ถัดไป: กรอกแผนปฏิบัติงาน
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                  แผนปฏิบัติงานรายสัปดาห์ (Weekly Work Plan)
                </h3>
                <p className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                  กรุณากรอกแผนงานที่หารือร่วมกับพนักงานที่ปรึกษา (Mentor) ตลอดระยะเวลาการปฏิบัติงานอย่างน้อย {MIN_WEEKS} สัปดาห์
                </p>
              </div>
              <button
                onClick={handleAddWeek}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-brand-blue bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors border border-blue-100 dark:border-blue-800"
              >
                <Plus className="w-3.5 h-3.5" />
                เพิ่มสัปดาห์
              </button>
            </div>

            {/* One date instead of thirty-two. */}
            <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/60 dark:border-blue-900/50 dark:bg-blue-950/20 space-y-2">
              <label className="block text-sm font-bold text-gray-800 dark:text-white">
                วันแรกที่เริ่มปฏิบัติงาน
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                กรอกวันเดียว ระบบจะไล่วันจันทร์–ศุกร์ให้ครบทุกสัปดาห์ แก้รายสัปดาห์ได้ภายหลังหากติดวันหยุด
              </p>
              <input
                type="date"
                value={coopStartDate}
                onChange={(e) => applyCoopStartDate(e.target.value)}
                className="w-full sm:w-56 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-brand-blue"
              />
            </div>

            {/* ── ตัวนับความคืบหน้า ── ลบทั้งบล็อกนี้ได้ถ้าไม่ต้องการ ── */}
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-blue transition-all duration-500"
                  style={{ width: `${(filledCount / weeklyPlans.length) * 100}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
                กรอกแล้ว {filledCount} / {weeklyPlans.length} สัปดาห์
              </span>
            </div>
            {/* ── จบตัวนับความคืบหน้า ── */}

            {/* Sixteen expanded cards is what made this page four screens tall on
                a phone. Collapsed, the whole plan is readable at once and only
                the week being edited takes room. */}
            <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              {weeklyPlans.map((plan, index) => {
                const filled = isWeekFilled(plan);
                const isOpen = openWeek === plan.week_number;
                return (
                  <div key={plan.week_number} className="bg-white dark:bg-gray-900">
                    <button
                      type="button"
                      onClick={() => setOpenWeek(isOpen ? null : plan.week_number)}
                      aria-expanded={isOpen}
                      // Clicked by test id, asserted by Thai text — aria-expanded
                      // alone also matches the navbar's notification bell.
                      data-testid="week-row"
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <span
                        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          filled
                            ? 'bg-emerald-600 text-white'
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {filled ? <Check className="w-3.5 h-3.5" /> : plan.week_number}
                      </span>

                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
                          สัปดาห์ที่ {plan.week_number}
                          {plan.start_date && (
                            <span className="ml-2 font-normal text-xs text-gray-600 dark:text-gray-400">
                              {new Date(plan.start_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                              {' – '}
                              {plan.end_date &&
                                new Date(plan.end_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </span>
                        <span className={`block text-xs truncate ${plan.tasks.trim() ? 'text-gray-500 dark:text-gray-400' : 'text-gray-600 dark:text-gray-400 italic'}`}>
                          {plan.tasks.trim() || 'ยังไม่ได้กรอกลักษณะงาน'}
                        </span>
                      </span>

                      <ChevronDown
                        aria-hidden="true"
                        className={`w-4 h-4 shrink-0 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 space-y-3 bg-gray-50/60 dark:bg-gray-800/40">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                              วันที่เริ่มต้น (จันทร์) *
                            </label>
                            <input
                              type="date"
                              value={plan.start_date}
                              onChange={e => updatePlan(plan.week_number, 'start_date', e.target.value)}
                              className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-brand-blue"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                              วันที่สิ้นสุด (ศุกร์) *
                            </label>
                            <input
                              type="date"
                              value={plan.end_date}
                              onChange={e => updatePlan(plan.week_number, 'end_date', e.target.value)}
                              className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-brand-blue"
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                              ลักษณะงานที่ปฏิบัติ / หัวข้อการเรียนรู้ *
                            </label>
                            {index > 0 && (
                              <button
                                type="button"
                                onClick={() => copyFromPreviousWeek(plan.week_number)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue dark:text-blue-400 hover:underline"
                              >
                                <Copy className="w-3 h-3" />
                                คัดลอกจากสัปดาห์ที่ {weeklyPlans[index - 1].week_number}
                              </button>
                            )}
                          </div>
                          <Textarea
                            rows={3}
                            value={plan.tasks}
                            onChange={e => updatePlan(plan.week_number, 'tasks', e.target.value)}
                            placeholder="อธิบายลักษณะงานที่จะทำในสัปดาห์นี้..."
                            className="resize-none" size="sm"
                          />
                        </div>

                        {weeklyPlans.length > MIN_WEEKS && index >= MIN_WEEKS && (
                          // Was opacity-0 until hover, which on a touch screen
                          // meant a control nobody could see.
                          <button
                            type="button"
                            onClick={() => handleRemoveWeek(plan.week_number)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-400 hover:underline"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            ลบสัปดาห์นี้
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center pt-6 mt-6 border-t border-gray-100 dark:border-gray-800 gap-4">
              <button
                onClick={handlePrevStep}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all text-sm"
              >
                ย้อนกลับ: ข้อมูลที่พัก
              </button>
              
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || weeklyPlans.some(p => !p.start_date || !p.end_date || !p.tasks.trim())}
                className={`w-full sm:w-auto px-8 py-2.5 rounded-xl font-bold text-white transition-all text-sm shadow-md ${
                  isSubmitting || weeklyPlans.some(p => !p.start_date || !p.end_date || !p.tasks.trim())
                    ? 'bg-gray-400 cursor-not-allowed opacity-70'
                    : 'bg-green-600 hover:bg-green-700 hover:shadow-lg'
                }`}
              >
                {isSubmitting ? 'กำลังบันทึกข้อมูล...' : 'บันทึกและส่งแผนปฏิบัติงาน'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── พิมพ์แบบแจ้งที่พัก ─────────────────────────────────────────────
          ⛔ ไม่ใช่ขั้นตอนบังคับ — อาจารย์นิเทศเปิดที่พักและหมุดในระบบได้อยู่แล้ว
          ปุ่มนี้มีไว้ให้ใบกระดาษที่ต้องยื่นหัวหน้าสหกิจฯ พร้อมลายเซ็นจริง */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <Printer className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          พิมพ์แบบแจ้งที่พัก (สหกิจ 06)
        </h3>
        <p className="mb-4 text-xs text-gray-600 dark:text-gray-400">
          พิมพ์แล้ว<strong>ลงชื่อด้วยมือ</strong>ก่อนยื่นหัวหน้าสหกิจศึกษาฯ ประจำคณะ ·
          ถ้าปักหมุดที่พักไว้แล้ว กรอบแผนที่บนใบจะมี<strong>คิวอาร์โค้ด</strong>ให้อาจารย์นิเทศ
          สแกนเปิดตำแหน่งได้ทันที
        </p>
        <a
          href={`${API_BASE_URL}/students/${auth?.user?.userId}/accommodation-plan/print`}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="acc-print"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 transition-colors hover:border-brand-blue hover:text-brand-blue dark:border-gray-700 dark:text-gray-200 dark:hover:text-blue-400"
        >
          <Printer className="h-4 w-4" />
          เปิดแบบแจ้งที่พักเพื่อสั่งพิมพ์
        </a>
      </div>
    </div>
  );
};

export default AccommodationWorkPlan;
