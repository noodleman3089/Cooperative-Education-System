import React, { useState, useEffect, useContext, useRef } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import { AuthContext } from '../../context/AuthContext';
import api, { API_BASE_URL } from '../../services/api';
import {
  CheckCircle2,
  ExternalLink,
  Printer,
  Copy,
  Info,
  ChevronDown,
} from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';
import type { WeeklyPlan } from '../../types/api';
import { loadThaiAddressData, type ProvinceItem } from '../../data/thaiAddress';
import type { AddressComponent } from '../../types/googleMaps';
import AccommodationMapPicker from './AccommodationMapPicker';

interface Accommodation {
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

interface CompanyJobInfo {
  job_title: string | null;
  job_description: string | null;
  mentor_name: string | null;
  mentor_position: string | null;
  mentor_phone: string | null;
  company_name: string | null;
  submitted_at: string | null;
}

interface EmergencyContact {
  name: string | null;
  relationship: string | null;
  phone: string | null;
  address: string | null;
}

interface ApprovalItem {
  approval_id: number;
  approver_role: string;
  approver_id: number;
  status: string;
  approved_at: string | null;
  comment: string | null;
  personnel_first_name?: string | null;
  personnel_last_name?: string | null;
  mentor_name?: string | null;
}

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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [accommodation, setAccommodation] = useState<Accommodation>(BLANK_ACCOMMODATION);
  const [legacyAddress, setLegacyAddress] = useState('');
  const [thaiAddress, setThaiAddress] = useState<ProvinceItem[]>([]);

  const [jobInfo, setJobInfo] = useState<CompanyJobInfo | null>(null);
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact>({
    name: '',
    relationship: '',
    phone: '',
    address: '',
  });

  const [monthsCount, setMonthsCount] = useState<number>(4);
  const [monthlyPlans, setMonthlyPlans] = useState<Record<number, string>>({});
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);

  const [restoredDraft, setRestoredDraft] = useState(false);
  const DRAFT_KEY = `accommodation_plan_draft_${auth?.user?.userId ?? 'anon'}`;
  const savedSnapshot = useRef<string>('');

  const snapshotOf = (a: Accommodation, mPlans: Record<number, string>, wPlans: WeeklyPlan[]) =>
    JSON.stringify({ accommodation: a, monthlyPlans: mPlans, weeklyPlans: wPlans });

  const loadData = async () => {
    setIsLoading(true);
    let loadedAcc: Accommodation = BLANK_ACCOMMODATION;
    let loadedLegacy = '';
    let loadedWeeks: WeeklyPlan[] = Array.from({ length: 16 }, (_, i) => ({
      week_number: i + 1,
      start_date: '',
      end_date: '',
      tasks: '',
    }));
    const loadedMonthMap: Record<number, string> = {};

    try {
      const res = await api.get(`/students/${auth?.user?.userId}/accommodation-plan`);
      const loadedSection: string = res.section || '';

      if (res.accommodation) {
        const a = res.accommodation;
        loadedAcc = {
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
          latitude: a.latitude !== null && a.latitude !== undefined ? String(a.latitude) : '',
          longitude: a.longitude !== null && a.longitude !== undefined ? String(a.longitude) : '',
          emergency_contact: a.emergency_contact || '',
          emergency_relationship: a.emergency_relationship || '',
          emergency_phone: a.emergency_phone || '',
        };
        loadedLegacy = a.house_no ? '' : a.address_legacy || '';
      } else {
        loadedAcc = { ...BLANK_ACCOMMODATION, section: loadedSection };
      }

      if (res.company_job_info) {
        setJobInfo(res.company_job_info);
      }

      if (res.emergency_contact) {
        setEmergencyContact(res.emergency_contact);
        // keep acc-emg-name in sync
        loadedAcc.emergency_contact = res.emergency_contact.name || '';
        loadedAcc.emergency_relationship = res.emergency_contact.relationship || '';
        loadedAcc.emergency_phone = res.emergency_contact.phone || '';
      }

      if (res.months_count) {
        setMonthsCount(res.months_count);
      }

      if (res.monthly_plans && res.monthly_plans.length > 0) {
        res.monthly_plans.forEach((mp: { month_index: number; topic: string }) => {
          loadedMonthMap[mp.month_index] = mp.topic || '';
        });
      }

      if (res.weekly_plans && res.weekly_plans.length > 0) {
        loadedWeeks = res.weekly_plans.map((p: WeeklyPlan) => ({
          plan_id: p.plan_id,
          week_number: p.week_number,
          start_date: p.start_date ? new Date(p.start_date).toISOString().split('T')[0] : '',
          end_date: p.end_date ? new Date(p.end_date).toISOString().split('T')[0] : '',
          tasks: p.tasks || '',
        }));
      }

      if (res.approvals) {
        setApprovals(res.approvals);
      }
    } catch (err) {
      console.error('Failed to load accommodation and plan:', err);
    } finally {
      setAccommodation(loadedAcc);
      setLegacyAddress(loadedLegacy);
      setMonthlyPlans(loadedMonthMap);
      setWeeklyPlans(loadedWeeks);

      savedSnapshot.current = snapshotOf(loadedAcc, loadedMonthMap, loadedWeeks);

      // Check draft
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw && raw !== savedSnapshot.current) {
          const draft = JSON.parse(raw);
          if (draft.accommodation) setAccommodation(draft.accommodation);
          if (draft.monthlyPlans) setMonthlyPlans(draft.monthlyPlans);
          if (draft.weeklyPlans) setWeeklyPlans(draft.weeklyPlans);
          setRestoredDraft(true);
        }
      } catch {
        /* ignore */
      }

      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
    loadThaiAddressData().then(setThaiAddress).catch(() => setThaiAddress([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableDistricts =
    thaiAddress.find((p) => p.name === accommodation.province)?.districts || [];
  const availableSubdistricts =
    availableDistricts.find((d) => d.name === accommodation.district)?.subdistricts || [];

  const pickProvince = (name: string) =>
    setAccommodation((a) => ({ ...a, province: name, district: '', subdistrict: '', postal_code: '' }));

  const pickDistrict = (name: string) =>
    setAccommodation((a) => ({ ...a, district: name, subdistrict: '', postal_code: '' }));

  const pickSubdistrict = (name: string) => {
    const zip = availableSubdistricts.find((s) => s.name === name)?.zipcode || '';
    setAccommodation((a) => ({ ...a, subdistrict: name, postal_code: zip || a.postal_code }));
  };

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

  // Local draft sync
  useEffect(() => {
    if (isLoading) return;
    const current = snapshotOf(accommodation, monthlyPlans, weeklyPlans);
    try {
      if (current === savedSnapshot.current) {
        localStorage.removeItem(DRAFT_KEY);
      } else {
        localStorage.setItem(DRAFT_KEY, current);
      }
    } catch {
      /* ignore */
    }
  }, [accommodation, monthlyPlans, weeklyPlans, isLoading, DRAFT_KEY]);

  const discardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setRestoredDraft(false);
    loadData();
  };

  // Pull weekly plans into a monthly topic
  const pullWeeklyPlanForMonth = (monthIndex: number) => {
    // Weeks associated with monthIndex: (monthIndex - 1)*4 + 1 to monthIndex*4
    const startWeek = (monthIndex - 1) * 4 + 1;
    const endWeek = monthIndex * 4;
    const weeksInThisMonth = weeklyPlans.filter(
      (w) => w.week_number >= startWeek && w.week_number <= endWeek
    );
    const joined = weeksInThisMonth
      .filter((w) => w.tasks?.trim())
      .map((w) => `สัปดาห์ที่ ${w.week_number}: ${w.tasks.trim()}`)
      .join('\n');

    if (joined) {
      setMonthlyPlans((prev) => ({
        ...prev,
        [monthIndex]: joined,
      }));
    }
  };

  const updateWeeklyTask = (weekNum: number, tasks: string) => {
    setWeeklyPlans((plans) =>
      plans.map((p) => (p.week_number === weekNum ? { ...p, tasks } : p))
    );
  };

  const handleSubmit = async (submitToMentor: boolean) => {
    // Validation for submission
    if (submitToMentor) {
      const missing = [
        ['บ้านเลขที่', accommodation.house_no],
        ['ตำบล/แขวง', accommodation.subdistrict],
        ['อำเภอ/เขต', accommodation.district],
        ['จังหวัด', accommodation.province],
        ['รหัสไปรษณีย์', accommodation.postal_code],
      ]
        .filter(([, val]) => !val?.trim())
        .map(([label]) => label);

      if (missing.length > 0) {
        setError(`กรุณากรอกข้อมูลที่พักให้ครบก่อนส่ง: ${missing.join(' · ')}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // Check if at least 1 month is filled
      const filledMonths = Object.values(monthlyPlans).filter((t) => t?.trim()).length;
      if (filledMonths === 0) {
        setError('กรุณากรอกแผนปฏิบัติงานอย่างน้อย 1 เดือนก่อนส่งให้พี่เลี้ยง');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    const monthlyPayload = Object.entries(monthlyPlans)
      .filter(([, topic]) => topic !== undefined)
      .map(([idx, topic]) => ({
        month_index: parseInt(idx, 10),
        topic: topic.trim(),
      }));

    try {
      await api.post(`/students/${auth?.user?.userId}/accommodation-plan`, {
        accommodation,
        weekly_plans: weeklyPlans,
        monthly_plans: monthlyPayload,
        submit_to_mentor: submitToMentor,
      });

      setSuccessMsg(
        submitToMentor
          ? 'ส่งแผนปฏิบัติงานให้พี่เลี้ยงรับรองเรียบร้อยแล้ว'
          : 'บันทึกฉบับร่างข้อมูลที่พักและแผนปฏิบัติงานเรียบร้อยแล้ว'
      );

      savedSnapshot.current = snapshotOf(accommodation, monthlyPlans, weeklyPlans);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      setRestoredDraft(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <PageSkeleton variant="form" />;
  }

  const isAccSubmitted = Boolean(accommodation.house_no && accommodation.province);
  const filledMonthsCount = Array.from({ length: monthsCount }, (_, i) => i + 1).filter(
    (m) => monthlyPlans[m]?.trim()
  ).length;

  const mentorApproval = approvals.find((a) => a.approver_role === 'mentor');
  const advisorApproval = approvals.find((a) => a.approver_role === 'advisor');
  const supervisorApproval = approvals.find((a) => a.approver_role === 'supervisor');

  return (
    <div className="max-w-5xl mx-auto space-y-6 page-enter pb-16">
      {/* Top Banner */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">
            ที่พักและแผนปฏิบัติงาน
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
            หน้านี้แทนกระดาษสองใบ — <strong className="text-gray-800 dark:text-gray-200">สหกิจ 06</strong> แบบแจ้งรายละเอียดที่พัก และ <strong className="text-gray-800 dark:text-gray-200">สหกิจ 07 หน้า 3</strong> แผนปฏิบัติงานที่ทำร่วมกับพี่เลี้ยง
          </p>
        </div>
        <div className="flex flex-col sm:flex-row md:flex-col lg:flex-row items-start md:items-end gap-2 shrink-0">
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              isAccSubmitted
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
            }`}
          >
            {isAccSubmitted ? 'ที่พัก · บันทึกแล้ว' : 'ที่พัก · ยังไม่สมบูรณ์ (กำหนดสัปดาห์แรก)'}
          </span>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              mentorApproval?.status === 'approved'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
            }`}
          >
            แผนปฏิบัติงาน · {mentorApproval?.status === 'approved' ? 'พี่เลี้ยงรับรองแล้ว' : 'ครบกำหนดสิ้นสัปดาห์ที่ 2'}
          </span>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={successMsg} />

      {restoredDraft && (
        <AlertBanner
          variant="info"
          message={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span>กู้คืนข้อมูลที่กรอกค้างไว้ในเบราว์เซอร์นี้แล้ว (ยังไม่ได้ส่งเข้าระบบ)</span>
              <button
                type="button"
                onClick={discardDraft}
                className="text-xs font-bold underline hover:no-underline cursor-pointer shrink-0"
              >
                ทิ้งฉบับร่าง แล้วโหลดข้อมูลเดิม
              </button>
            </div>
          }
        />
      )}

      {/* Card 1: ตำแหน่งงานและพี่เลี้ยง (สหกิจ 07 หน้า 1-2) — จากสถานประกอบการ */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              ตำแหน่งงานและพี่เลี้ยง (สหกิจ 07 หน้า 1–2)
            </h3>
          </div>
          {jobInfo ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400">
              สถานประกอบการส่งแล้ว {jobInfo.submitted_at ? `· ${new Date(jobInfo.submitted_at).toLocaleDateString('th-TH')}` : ''}
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400">
              ยังไม่ได้รับจากสถานประกอบการ
            </span>
          )}
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          ส่วนนี้<strong className="text-gray-800 dark:text-gray-200">สถานประกอบการเป็นผู้กรอก</strong> นักศึกษาแก้ไม่ได้ — แสดงไว้เพราะถ้ายังไม่ส่ง อาจารย์นิเทศจะไม่รู้ว่าใครเป็นพี่เลี้ยงและงานคืออะไร
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">ตำแหน่งงาน</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white mt-1">
              {jobInfo?.job_title || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">พนักงานที่ปรึกษา (พี่เลี้ยง)</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white mt-1">
              {jobInfo?.mentor_name || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">ตำแหน่งของพี่เลี้ยง</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white mt-1">
              {jobInfo?.mentor_position || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">โทรศัพท์พี่เลี้ยง</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white mt-1">
              {jobInfo?.mentor_phone || '—'}
            </div>
          </div>
          <div className="sm:col-span-2 lg:col-span-4 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 dark:text-gray-400">ลักษณะงานที่ได้รับมอบหมาย</div>
            <div className="text-xs font-normal text-gray-800 dark:text-gray-200 mt-1 leading-relaxed">
              {jobInfo?.job_description || 'ยังไม่มีรายละเอียดลักษณะงาน'}
            </div>
          </div>
        </div>
      </div>

      {/* Card 2: ที่พักระหว่างการปฏิบัติงาน (สหกิจ 06) */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-5">
        <div className="border-b border-gray-100 dark:border-gray-800 pb-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            ที่พักระหว่างการปฏิบัติงาน (สหกิจ 06)
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
            อาจารย์นิเทศใช้ข้อมูลชุดนี้เดินทางไปหาคุณ กรอกให้ตรงกับที่อยู่จริงที่พักอยู่ ไม่ใช่ที่อยู่ตามทะเบียนบ้าน
          </p>
        </div>

        {/* SEC-05 / E2E: Room Section according to สหกิจ 06 header */}
        <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <label htmlFor="acc-section" className="block text-xs font-bold text-blue-950 dark:text-blue-300">
              ห้องเรียน (ตามหัวใบ สหกิจ 06)
            </label>
            <p className="text-xs text-blue-800/80 dark:text-blue-400/80 mt-0.5">
              เช่น IT4/1 — แก้ไขได้ที่หน้าข้อมูลส่วนตัว
            </p>
          </div>
          <input
            id="acc-section"
            data-testid="acc-section"
            readOnly
            value={accommodation.section || ''}
            className="w-full sm:w-44 px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-bold"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              บ้านเลขที่ *
            </label>
            <input
              type="text"
              data-testid="acc-house-no"
              value={accommodation.house_no}
              onChange={(e) => setAccommodation({ ...accommodation, house_no: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              placeholder="เช่น 88/12"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ชื่ออาคาร / หอพัก
            </label>
            <input
              type="text"
              data-testid="acc-building"
              value={accommodation.building}
              onChange={(e) => setAccommodation({ ...accommodation, building: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              placeholder="เช่น หอพัก เจริญทรัพย์คอร์ท"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              เลขห้องพัก
            </label>
            <input
              type="text"
              data-testid="acc-room-no"
              value={accommodation.room_no}
              onChange={(e) => setAccommodation({ ...accommodation, room_no: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              placeholder="เช่น 304"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ตรอก / ซอย
            </label>
            <input
              type="text"
              data-testid="acc-soi"
              value={accommodation.soi}
              onChange={(e) => setAccommodation({ ...accommodation, soi: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              placeholder="เช่น สุขุมวิท 14"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ถนน
            </label>
            <input
              type="text"
              data-testid="acc-road"
              value={accommodation.road}
              onChange={(e) => setAccommodation({ ...accommodation, road: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              placeholder="เช่น สุขุมวิท"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              จังหวัด *
            </label>
            <select
              data-testid="acc-province"
              value={accommodation.province}
              onChange={(e) => pickProvince(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
            >
              <option value="">-- เลือกจังหวัด --</option>
              {thaiAddress.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              อำเภอ / เขต *
            </label>
            <select
              data-testid="acc-district"
              disabled={!accommodation.province}
              value={accommodation.district}
              onChange={(e) => pickDistrict(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue disabled:opacity-50"
            >
              <option value="">-- เลือกอำเภอ/เขต --</option>
              {availableDistricts.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              ตำบล / แขวง *
            </label>
            <select
              data-testid="acc-subdistrict"
              disabled={!accommodation.district}
              value={accommodation.subdistrict}
              onChange={(e) => pickSubdistrict(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue disabled:opacity-50"
            >
              <option value="">-- เลือกตำบล/แขวง --</option>
              {availableSubdistricts.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              รหัสไปรษณีย์ *
            </label>
            <input
              type="text"
              data-testid="acc-postal-code"
              value={accommodation.postal_code}
              onChange={(e) => setAccommodation({ ...accommodation, postal_code: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              placeholder="เช่น 20110"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              โทรศัพท์ของที่พัก
            </label>
            <input
              type="tel"
              data-testid="acc-phone"
              value={accommodation.phone}
              onChange={(e) => setAccommodation({ ...accommodation, phone: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              placeholder="ไม่มีก็เว้นว่างได้"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
              โทรศัพท์มือถือของคุณ
            </label>
            <input
              type="tel"
              data-testid="acc-mobile"
              value={accommodation.mobile_phone}
              onChange={(e) => setAccommodation({ ...accommodation, mobile_phone: e.target.value })}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
              placeholder="08X-XXX-XXXX"
            />
          </div>
        </div>

        {legacyAddress && (
          <div
            data-testid="legacy-address"
            className="flex items-start gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50"
          >
            <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <span className="font-bold text-gray-700 dark:text-gray-300">
                ที่อยู่ที่เคยกรอกไว้ก่อนระบบแยกช่อง:
              </span>{' '}
              <span className="text-gray-600 dark:text-gray-400">“{legacyAddress}”</span>
              <span className="block mt-0.5 text-gray-500 dark:text-gray-400">
                (แสดงอย่างเดียว แก้ไม่ได้ มีไว้ให้คัดลอกมาลงช่องด้านบน)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Card 3: ปักหมุดตำแหน่งที่พักบนแผนที่ */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              ปักหมุดตำแหน่งที่พักบนแผนที่
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
              บนกระดาษช่องนี้คือ “แผนที่แสดงตำแหน่งที่ตั้ง” ที่ต้องวาดเอง — ในระบบใช้ปักหมุดแทน
            </p>
          </div>
          {accommodation.latitude && accommodation.longitude ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 shrink-0">
              ปักหมุดแล้ว · {Number(accommodation.latitude).toFixed(4)}, {Number(accommodation.longitude).toFixed(4)}
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 shrink-0">
              ยังไม่ได้ปักหมุด
            </span>
          )}
        </div>

        <AccommodationMapPicker
          latitude={accommodation.latitude}
          longitude={accommodation.longitude}
          onPick={handlePin}
        />

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          ระบบเก็บเฉพาะพิกัด ไม่ได้เก็บภาพแผนที่ · ฝั่งอาจารย์นิเทศจะเห็นเป็น<strong className="text-gray-700 dark:text-gray-300"> ลิงก์เปิด Google Maps</strong> ไม่ใช่แผนที่ฝังในหน้า
        </p>
      </div>

      {/* Card 4: บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน
          </h3>
          <a
            href="/dashboard?menu=coop_application"
            className="text-xs font-bold text-brand-blue dark:text-blue-400 flex items-center gap-1 hover:underline"
          >
            แก้ที่ใบสมัครงานสหกิจ (สหกิจ 03) <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          ช่องชุดนี้เป็นชุดเดียวกับใน สหกิจ 03 — <strong className="text-gray-800 dark:text-gray-200">กรอกที่เดียวใช้ได้ทั้งสองใบ</strong> จึงไม่ให้แก้ซ้ำที่นี่ เพื่อไม่ให้สองใบขัดกันเอง
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">ชื่อ – สกุล</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white mt-1">
              {emergencyContact.name || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">ความสัมพันธ์</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white mt-1">
              {emergencyContact.relationship || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">โทรศัพท์</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white mt-1">
              {emergencyContact.phone || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400">ที่อยู่</div>
            <div className="text-xs font-bold text-gray-900 dark:text-white mt-1 truncate">
              {emergencyContact.address || '—'}
            </div>
          </div>
        </div>

        {/* Retain testids in the DOM for E2E assertions without selector breakage */}
        <div className="sr-only">
          <input
            type="text"
            data-testid="acc-emg-name"
            readOnly
            value={emergencyContact.name || accommodation.emergency_contact || ''}
            onChange={(e) => setAccommodation({ ...accommodation, emergency_contact: e.target.value })}
          />
          <input
            type="text"
            data-testid="acc-emg-relation"
            readOnly
            value={emergencyContact.relationship || accommodation.emergency_relationship || ''}
            onChange={(e) => setAccommodation({ ...accommodation, emergency_relationship: e.target.value })}
          />
          <input
            type="text"
            data-testid="acc-emg-phone"
            readOnly
            value={emergencyContact.phone || accommodation.emergency_phone || ''}
            onChange={(e) => setAccommodation({ ...accommodation, emergency_phone: e.target.value })}
          />
        </div>
      </div>

      {/* Card 5: แผนปฏิบัติงานสหกิจศึกษา (สหกิจ 07 หน้า 3) */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              แผนปฏิบัติงานสหกิจศึกษา (สหกิจ 07 หน้า 3)
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
              กระดาษกำหนดเป็น<strong className="text-gray-800 dark:text-gray-200">หัวข้องานรายเดือน เดือนที่ 1–{monthsCount}</strong> และต้องตกลงร่วมกับพี่เลี้ยงก่อนลงนามทั้งสองฝ่าย
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-brand-blue border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 shrink-0">
            กรอกแล้ว {filledMonthsCount} จาก {monthsCount} เดือน
          </span>
        </div>

        {/* Dynamic Month Boxes */}
        <div className="space-y-4">
          {Array.from({ length: monthsCount }, (_, i) => i + 1).map((m) => {
            const startW = (m - 1) * 4 + 1;
            const endW = m * 4;
            const monthWeeks = weeklyPlans.filter((w) => w.week_number >= startW && w.week_number <= endW);
            const isFilled = Boolean(monthlyPlans[m]?.trim());

            return (
              <div
                key={m}
                className={`rounded-xl border transition-all overflow-hidden ${
                  isFilled
                    ? 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                    : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/10'
                }`}
              >
                <div
                  className={`px-4 py-3 border-b flex items-center justify-between gap-3 ${
                    isFilled
                      ? 'bg-gray-50/70 dark:bg-gray-800/40 border-gray-200 dark:border-gray-800'
                      : 'bg-amber-100/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold ${
                        isFilled ? 'text-gray-900 dark:text-white' : 'text-amber-900 dark:text-amber-300'
                      }`}
                    >
                      เดือนที่ {m}
                    </span>
                    {!isFilled && (
                      <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        (ยังไม่ได้กรอก)
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => pullWeeklyPlanForMonth(m)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-gray-500" />
                    ดึงจากแผนรายสัปดาห์
                  </button>
                </div>

                <div className="p-4 space-y-3">
                  <textarea
                    rows={2}
                    data-testid={`monthly-plan-${m}`}
                    value={monthlyPlans[m] || ''}
                    onChange={(e) => setMonthlyPlans({ ...monthlyPlans, [m]: e.target.value })}
                    placeholder="ตกลงกับพี่เลี้ยงว่าเดือนนี้จะทำอะไร หรือกดปุ่ม 'ดึงจากแผนรายสัปดาห์' ด้านบน"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue resize-vertical"
                  />

                  {/* Collapsible weekly breakdown */}
                  <details className="text-xs group">
                    <summary className="cursor-pointer font-bold text-brand-blue dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                      <span>แผนรายสัปดาห์ของเดือนนี้ ({monthWeeks.length} สัปดาห์)</span>
                      <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      {monthWeeks.map((w) => (
                        <div
                          key={w.week_number}
                          data-testid="week-row"
                          aria-expanded="true"
                          className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center text-xs"
                        >
                          <span className="sm:col-span-3 font-semibold text-gray-700 dark:text-gray-300">
                            สัปดาห์ที่ {w.week_number}
                          </span>
                          <input
                            type="text"
                            data-testid={`weekly-plan-task-${w.week_number}`}
                            value={w.tasks || ''}
                            onChange={(e) => updateWeeklyTask(w.week_number, e.target.value)}
                            placeholder="ระบุหัวข้องานรายสัปดาห์"
                            className="sm:col-span-9 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-brand-blue"
                          />
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              </div>
            );
          })}
        </div>

        {/* 3-Person Approval Chain */}
        <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 space-y-3">
          <span className="text-xs font-bold text-gray-900 dark:text-white block">
            แผนงานต้องผ่านการรับรอง 3 คน
          </span>
          <div className="space-y-2 text-xs">
            {/* 1. พี่เลี้ยง */}
            <div className="flex items-center gap-3">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 font-bold text-[11px] ${
                  mentorApproval?.status === 'approved'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}
              >
                {mentorApproval?.status === 'approved' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  '1'
                )}
              </span>
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-gray-900 dark:text-white">พี่เลี้ยง</strong> · {jobInfo?.mentor_name || 'พนักงานที่ปรึกษา'} —{' '}
                {mentorApproval?.status === 'approved' ? (
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                    รับรองแล้ว {mentorApproval.approved_at ? new Date(mentorApproval.approved_at).toLocaleDateString('th-TH') : ''}
                  </span>
                ) : mentorApproval?.status === 'rejected' ? (
                  <span className="text-red-700 dark:text-red-400 font-semibold">
                    ไม่อนุมัติ: {mentorApproval.comment || 'กรุณาแก้ไขแผนงาน'}
                  </span>
                ) : (
                  <span className="text-amber-800 dark:text-amber-400 font-medium">รอตรวจ</span>
                )}
              </span>
            </div>

            {/* 2. อาจารย์ที่ปรึกษา */}
            <div className="flex items-center gap-3">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 font-bold text-[11px] ${
                  advisorApproval?.status === 'approved'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}
              >
                {advisorApproval?.status === 'approved' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  '2'
                )}
              </span>
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-gray-900 dark:text-white">อาจารย์ที่ปรึกษา</strong> —{' '}
                {advisorApproval?.status === 'approved' ? (
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                    รับรองแล้ว {advisorApproval.approved_at ? new Date(advisorApproval.approved_at).toLocaleDateString('th-TH') : ''}
                  </span>
                ) : (
                  <span className="text-amber-800 dark:text-amber-400 font-medium">รอตรวจ</span>
                )}
              </span>
            </div>

            {/* 3. อาจารย์นิเทศ */}
            <div className="flex items-center gap-3">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 font-bold text-[11px] ${
                  supervisorApproval?.status === 'approved'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                }`}
              >
                {supervisorApproval?.status === 'approved' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  '3'
                )}
              </span>
              <span className="text-gray-700 dark:text-gray-300">
                <strong className="text-gray-900 dark:text-white">อาจารย์นิเทศ</strong> —{' '}
                {supervisorApproval?.status === 'approved' ? (
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                    รับรองแล้ว {supervisorApproval.approved_at ? new Date(supervisorApproval.approved_at).toLocaleDateString('th-TH') : ''}
                  </span>
                ) : (
                  <span className="text-amber-800 dark:text-amber-400 font-medium">รอตรวจ</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-3 border-t border-gray-100 dark:border-gray-800">
          <a
            href={`${API_BASE_URL}/students/${auth?.user?.userId}/accommodation-plan/print`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="acc-print"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-bold hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Printer className="w-4 h-4 text-gray-500" />
            พิมพ์เอกสาร สหกิจ 06 (PDF)
          </a>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="workplan-save-draft"
              disabled={isSubmitting}
              onClick={() => handleSubmit(false)}
              className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-bold hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              บันทึกร่าง
            </button>
            <button
              type="button"
              data-testid="workplan-submit-mentor"
              disabled={isSubmitting}
              onClick={() => handleSubmit(true)}
              className="px-5 py-2.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'กำลังดำเนินการ...' : 'ส่งให้พี่เลี้ยงรับรองแผนงาน'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccommodationWorkPlan;
