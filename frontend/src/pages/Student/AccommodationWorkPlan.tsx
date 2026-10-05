import React, { useState, useEffect, useContext, useRef } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import { AuthContext } from '../../context/AuthContext';
import api, { API_BASE_URL } from '../../services/api';
import {
  ExternalLink,
  Printer,
  Info,
} from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';
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

interface EmergencyContact {
  name: string | null;
  relationship: string | null;
  phone: string | null;
  address: string | null;
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

  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact>({
    name: '',
    relationship: '',
    phone: '',
    address: '',
  });

  const [restoredDraft, setRestoredDraft] = useState(false);
  const DRAFT_KEY = `accommodation_plan_draft_${auth?.user?.userId ?? 'anon'}`;
  const savedSnapshot = useRef<string>('');

  const snapshotOf = (a: Accommodation) => JSON.stringify({ accommodation: a });

  const loadData = async () => {
    setIsLoading(true);
    let loadedAcc: Accommodation = BLANK_ACCOMMODATION;
    let loadedLegacy = '';

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

      if (res.emergency_contact) {
        setEmergencyContact(res.emergency_contact);
        // keep acc-emg-name in sync
        loadedAcc.emergency_contact = res.emergency_contact.name || '';
        loadedAcc.emergency_relationship = res.emergency_contact.relationship || '';
        loadedAcc.emergency_phone = res.emergency_contact.phone || '';
      }

    } catch (err) {
      console.error('Failed to load accommodation:', err);
      setError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลที่พักได้'));
    } finally {
      setAccommodation(loadedAcc);
      setLegacyAddress(loadedLegacy);

      savedSnapshot.current = snapshotOf(loadedAcc);

      // Check draft
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw && raw !== savedSnapshot.current) {
          const draft = JSON.parse(raw);
          if (draft.accommodation) setAccommodation(draft.accommodation);
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
    const current = snapshotOf(accommodation);
    try {
      if (current === savedSnapshot.current) {
        localStorage.removeItem(DRAFT_KEY);
      } else {
        localStorage.setItem(DRAFT_KEY, current);
      }
    } catch {
      /* ignore */
    }
  }, [accommodation, isLoading, DRAFT_KEY]);

  const discardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setRestoredDraft(false);
    loadData();
  };

  const handleSubmit = async () => {
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
      setError(`กรุณากรอกข้อมูลที่พักให้ครบก่อนบันทึก: ${missing.join(' · ')}`);
      return;
    }

    // ⛔ ผู้ติดต่อฉุกเฉินเป็นช่องบังคับของใบ สหกิจ 06 — อาจารย์นิเทศใช้ตอนเกิดเหตุ
    //    หน้านี้แสดงอย่างเดียว (แหล่งจริงคือใบสมัคร สหกิจ 03) จึงต้องบอกให้ไปกรอกที่นั่น
    //    ไม่ใช่ปล่อยให้บันทึกใบที่มีช่องฉุกเฉินว่าง
    if (!emergencyContact.name?.trim() || !emergencyContact.phone?.trim()) {
      setError(
        'ใบ สหกิจ 06 ต้องมีผู้ติดต่อกรณีฉุกเฉิน — กรอกชื่อและเบอร์โทรที่หน้า "ใบสมัครงานสหกิจ" (สหกิจ 03) ก่อน แล้วกลับมาบันทึกอีกครั้ง'
      );
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // ส่งเฉพาะที่พัก — ไม่ส่ง weekly_plans / work_plan_topics / submit_to_mentor (ตัดแผนปฏิบัติงาน สหกิจ 07 หน้า 3
      // ออกจากนักศึกษา 2026-10-05 · เซิร์ฟเวอร์ไม่แตะแผนเดิมเมื่อไม่ได้ส่งมา)
      await api.post(`/students/${auth?.user?.userId}/accommodation-plan`, { accommodation });

      setSuccessMsg('บันทึกข้อมูลที่พัก (สหกิจ 06) เรียบร้อยแล้ว');

      savedSnapshot.current = snapshotOf(accommodation);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      setRestoredDraft(false);
      await loadData();
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <PageSkeleton variant="form" />;
  }

  const isAccSubmitted = Boolean(accommodation.house_no && accommodation.province);

  return (
    <div className="max-w-5xl mx-auto space-y-6 page-enter pb-16">
      {/* Top Banner */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">
            แจ้งรายละเอียดที่พัก (สหกิจ 06)
          </h1>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
            หน้านี้แทนกระดาษ <strong className="text-gray-800 dark:text-gray-200">สหกิจ 06</strong> แบบแจ้งรายละเอียดที่พัก — คณะใช้ข้อมูลนี้ออกหนังสือส่งตัวและจัดอาจารย์นิเทศก่อนเริ่มฝึก
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
            {isAccSubmitted ? 'ที่พัก · บันทึกแล้ว' : 'ที่พัก · ยังไม่ได้บันทึก'}
          </span>
        </div>
      </div>

      <AlertBanner variant="error" message={error} scrollOnShow />
      <AlertBanner variant="success" message={successMsg} scrollOnShow />

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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue disabled:opacity-50"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue disabled:opacity-50"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
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
            href="/dashboard?menu=job_application"
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

      {/* บันทึก + พิมพ์ สหกิจ 06 — หน้านี้เหลือกระดาษใบเดียว (ตัดแผนปฏิบัติงาน สหกิจ 07 หน้า 3 ออกจากนักศึกษา 2026-10-05) */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
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

          <button
            type="button"
            data-testid="acc-save"
            disabled={isSubmitting}
            onClick={handleSubmit}
            className="px-5 py-2.5 rounded-xl bg-brand-blue hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกข้อมูลที่พัก'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccommodationWorkPlan;
