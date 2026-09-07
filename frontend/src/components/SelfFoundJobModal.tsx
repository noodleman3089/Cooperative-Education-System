import React, { useState, useEffect, useRef } from 'react';
import {
  Building2,
  MapPin,
  Users,
  Briefcase,
  Search,
  X,
  ArrowRight,
} from 'lucide-react';
import api from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal from './ui/Modal';
import { getErrorMessage } from '../utils/errors';
import useLateWindow from '../hooks/useLateWindow';
import { formatThaiDate } from '../utils/thaiDate';

import {
  googleMaps,
  type AddressComponent,
  type PlaceResult,
  type PlacesAutocomplete,
} from '../types/googleMaps';

interface Province {
  province_id: number;
  province_name_th: string;
}

interface SelfFoundJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  provinceList: Province[];
  mapsLoaded: boolean;
}

const SelfFoundJobModal: React.FC<SelfFoundJobModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  provinceList,
  mapsLoaded,
}) => {
  // ยื่นหลังวันปิดปกติแต่ยังไม่เลยวันผ่อนผัน = รับได้ แต่ต้องชี้แจงเหตุผล
  const lateWindow = useLateWindow('intent_submission');
  const [lateReason, setLateReason] = useState('');

  const autocompleteInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<PlacesAutocomplete | null>(null);

  const [selfFoundForm, setSelfFoundForm] = useState({
    company_name_th: '',
    company_name_en: '',
    company_address: '',
    company_province: '',
    company_district: '',
    company_postal_code: '',
    company_phone: '',
    contact_person: '',
    contact_position: '',
    job_position: '',
  });

  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [placeCheckMessage, setPlaceCheckMessage] = useState<string | null>(null);
  const [existingCompanyId, setExistingCompanyId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePlaceSelected = async (place: PlaceResult) => {
    if (!place || !place.place_id) return;

    setPlaceCheckMessage(null);
    setExistingCompanyId(null);
    setSelectedPlaceId(place.place_id);

    const address = place.formatted_address || '';
    let province = '';
    let district = '';
    let postalCode = '';

    if (place.address_components) {
      const provComp = place.address_components.find((c: AddressComponent) =>
        c.types.includes('administrative_area_level_1')
      );
      if (provComp) {
        province = provComp.long_name;
        if (province.startsWith('จังหวัด')) {
          province = province.replace('จังหวัด', '').trim();
        }
      }

      const districtComp = place.address_components.find(
        (c: AddressComponent) =>
          c.types.includes('administrative_area_level_2') ||
          c.types.includes('sublocality_level_1') ||
          c.types.includes('locality')
      );
      if (districtComp) {
        district = districtComp.long_name;
        if (district.startsWith('อำเภอ')) {
          district = district.replace('อำเภอ', '').trim();
        } else if (district.startsWith('เขต')) {
          district = district.replace('เขต', '').trim();
        }
      }

      const zipComp = place.address_components.find((c: AddressComponent) =>
        c.types.includes('postal_code')
      );
      if (zipComp) {
        postalCode = zipComp.long_name;
      }
    }

    let cleanAddress = address;
    if (cleanAddress.endsWith(', ประเทศไทย')) {
      cleanAddress = cleanAddress.replace(', ประเทศไทย', '');
    }
    if (cleanAddress.endsWith(' ประเทศไทย')) {
      cleanAddress = cleanAddress.replace(' ประเทศไทย', '');
    }

    let phone = place.formatted_phone_number || '';
    phone = phone.replace(/[\s-]/g, '');
    if (phone.startsWith('+66')) {
      phone = '0' + phone.slice(3);
    }

    setSelfFoundForm((prev) => ({
      ...prev,
      company_name_th: place.name || prev.company_name_th,
      company_address: cleanAddress || prev.company_address,
      company_province: province || prev.company_province,
      company_district: district || prev.company_district,
      company_postal_code: postalCode || prev.company_postal_code,
      company_phone: phone || prev.company_phone,
    }));

    try {
      const res = await api.post('/companies/google-search', {
        google_place_id: place.place_id,
      });
      if (res && res.company_id) {
        setExistingCompanyId(res.company_id);
        setPlaceCheckMessage('พบสถานประกอบการนี้ในสารบบเรียบร้อยแล้ว ระบบจะยื่นใบสมัครไปยังที่ตั้งที่มีอยู่นี้');
      }
    } catch {
      console.log('Place checks out: New company profile registration required.');
    }
  };

  useEffect(() => {
    if (!isOpen || !mapsLoaded || !autocompleteInputRef.current) return;

    const maps = googleMaps();
    if (!maps?.places) {
      console.warn('Google Maps Places API is not available. Falling back to manual entry.');
      return;
    }

    autocompleteRef.current = new maps.places.Autocomplete(autocompleteInputRef.current, {
      types: ['establishment'],
      componentRestrictions: { country: 'th' },
      fields: ['place_id', 'name', 'formatted_address', 'address_components', 'formatted_phone_number'],
    });

    const listener = autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace();
      if (place) {
        handlePlaceSelected(place);
      }
    });

    return () => {
      if (listener) {
        googleMaps()?.event.removeListener(listener);
      }
    };
  }, [isOpen, mapsLoaded]);

  const handleSelfFoundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const {
      company_name_th,
      company_address,
      company_province,
      company_district,
      company_postal_code,
      company_phone,
    } = selfFoundForm;

    if (
      !company_name_th ||
      !company_address ||
      !company_province ||
      !company_district ||
      !company_postal_code ||
      !company_phone
    ) {
      setError('กรุณากรอกข้อมูลสถานที่ฝึกงานที่จำเป็นให้ครบถ้วน');
      return;
    }

    setIsSubmitting(true);

    try {
      const activeSemester = await api.get('/semesters/active');
      let targetCompanyId = existingCompanyId;

      if (selectedPlaceId && !targetCompanyId) {
        try {
          const createCompanyRes = await api.post('/companies/google-search', {
            google_place_id: selectedPlaceId,
            name_th: company_name_th,
            name_en: selfFoundForm.company_name_en || undefined,
            address: company_address,
            province: company_province,
            district: company_district,
            postal_code: company_postal_code,
            phone: company_phone,
          });
          targetCompanyId = createCompanyRes.company_id;
        } catch (createErr) {
          throw new Error(
            getErrorMessage(createErr, 'ไม่สามารถลงทะเบียนที่อยู่จาก Google Maps เข้าระบบได้'),
            { cause: createErr }
          );
        }
      }

      if (targetCompanyId) {
        const payload = {
          is_self_found: false,
          company_id: targetCompanyId,
          semester_id: activeSemester.semester_id,
          job_id: null,
          late_reason: lateWindow.isLate ? lateReason.trim() : undefined,
        };
        await api.post('/intents', payload);
      } else {
        const payload = {
          company_name_th,
          company_name_en: selfFoundForm.company_name_en || undefined,
          company_address,
          company_province,
          company_district,
          company_postal_code,
          company_phone,
          contact_person: selfFoundForm.contact_person || undefined,
          contact_position: selfFoundForm.contact_position || undefined,
          is_self_found: true,
          semester_id: activeSemester.semester_id,
          late_reason: lateWindow.isLate ? lateReason.trim() : undefined,
        };
        await api.post('/intents', payload);
      }

      onSuccess(
        `ลงทะเบียนและยื่นความจำนงไปยัง ${company_name_th} เรียบร้อยแล้ว — พิมพ์แบบคำร้องไปให้ลงนาม แล้วอัปโหลดกลับที่หน้าแรก`
      );
    } catch (err) {
      setError(getErrorMessage(err, 'การส่งข้อมูลสถานที่ฝึกงานล้มเหลว กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      onClose={onClose}
      size="2xl"
      closeOnBackdrop={false}
      className="!max-w-[680px] !rounded-[20px]"
    >
      {/* Modal Header */}
      <div className="px-7 py-5 border-b border-gray-100 dark:border-gray-800 flex items-start justify-between gap-4 shrink-0 bg-white dark:bg-gray-900">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">ระบุสถานที่ฝึกงานด้วยตนเอง</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            กรอกข้อมูลสถานประกอบการที่นักศึกษาติดต่อประสานงานไว้แล้วเพื่อให้อาจารย์และเจ้าหน้าที่ตรวจสอบ
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 flex items-center justify-center transition-colors shrink-0"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Modal Body (Form) */}
      <form onSubmit={handleSelfFoundSubmit} className="flex flex-col flex-1 min-h-0">
        <div className="px-7 py-6 overflow-y-auto space-y-6 flex-1 min-h-0 bg-white dark:bg-gray-900">
          <AlertBanner variant="error" message={error} className="mb-2" />

          {/* Google Maps Autocomplete Search */}
          {mapsLoaded && (
            <div className="bg-blue-50/60 dark:bg-blue-950/20 p-4 rounded-xl border border-blue-100 dark:border-blue-900/40 space-y-2">
              <label className="block text-xs font-bold text-blue-700 dark:text-blue-400">
                ค้นหาและดึงที่อยู่สถานประกอบการอัตโนมัติด้วย Google Maps
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-blue-400 absolute left-3.5 top-3 pointer-events-none" />
                <input
                  ref={autocompleteInputRef}
                  type="text"
                  placeholder="พิมพ์ชื่อบริษัท ห้างร้าน หรือค้นหาพิกัดบนแผนที่..."
                  className="w-full pl-10 pr-3.5 py-2 text-sm rounded-xl border border-blue-200 dark:border-blue-800/80 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all"
                />
              </div>
              {placeCheckMessage && (
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">
                  {placeCheckMessage}
                </p>
              )}
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                * เมื่อเลือกสถานที่จากรายการแนะนำ ระบบจะกรอกฟอร์มที่อยู่ เบอร์โทรศัพท์ และพิกัดด้านล่างให้โดยอัตโนมัติ
              </p>
            </div>
          )}

          {/* 1. ข้อมูลสถานประกอบการ */}
          <div className="space-y-3.5">
            <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400 shrink-0" />
              1. ข้อมูลสถานประกอบการ
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อสถานประกอบการ (ภาษาไทย) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น บริษัท เอสซีจี แพคเกจจิ้ง จำกัด (มหาชน)"
                  value={selfFoundForm.company_name_th}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, company_name_th: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อสถานประกอบการ (ภาษาอังกฤษ)
                </label>
                <input
                  type="text"
                  placeholder="e.g. SCG Packaging Public Company Limited"
                  value={selfFoundForm.company_name_en}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, company_name_en: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100 dark:bg-gray-800" />

          {/* 2. สถานที่ตั้งสถานประกอบการ */}
          <div className="space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <MapPin className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400 shrink-0" />
                2. สถานที่ตั้งสถานประกอบการ
              </h3>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ระบุตามที่อยู่จริงเพื่อใช้ออกหนังสือขอความอนุเคราะห์
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ที่อยู่ (เลขที่, อาคาร, ซอย, ถนน) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น 1 ถ.ปูนซิเมนต์ไทย แขวงบางซื่อ"
                  value={selfFoundForm.company_address}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, company_address: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  จังหวัด <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={selfFoundForm.company_province}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, company_province: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all"
                >
                  <option value="">-- เลือกจังหวัด --</option>
                  {provinceList.map((p) => (
                    <option key={p.province_id} value={p.province_name_th}>
                      {p.province_name_th}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  อำเภอ / เขต <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น บางซื่อ หรือ ศรีราชา"
                  value={selfFoundForm.company_district}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, company_district: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  รหัสไปรษณีย์ <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  pattern="[0-9]{5}"
                  placeholder="เช่น 10800"
                  value={selfFoundForm.company_postal_code}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, company_postal_code: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  เบอร์โทรศัพท์สำนักงาน <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น 02-586-3333"
                  value={selfFoundForm.company_phone}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, company_phone: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100 dark:bg-gray-800" />

          {/* 3. บุคคลที่ติดต่อประสานงาน */}
          <div className="space-y-3.5">
            <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Users className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400 shrink-0" />
              3. บุคคลที่ติดต่อประสานงาน (HR หรือผู้ควบคุมดูแล)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ชื่อ-นามสกุล ผู้ประสานงาน <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="เช่น คุณสมหญิง วงศ์สวัสดิ์"
                  value={selfFoundForm.contact_person}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, contact_person: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  ตำแหน่ง <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="เช่น ผู้จัดการฝ่ายทรัพยากรบุคคล"
                  value={selfFoundForm.contact_position}
                  onChange={(e) =>
                    setSelfFoundForm({ ...selfFoundForm, contact_position: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-gray-100 dark:bg-gray-800" />

          {/* 4. ตำแหน่งงานที่ต้องการไปฝึกงาน */}
          <div className="space-y-3.5">
            <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Briefcase className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400 shrink-0" />
              4. ตำแหน่งงานที่ต้องการไปฝึกงาน
            </h3>

            <div>
              <label className="block text-[13px] font-semibold text-gray-700 dark:text-gray-300 mb-1">
                ชื่อตำแหน่งงานที่ตกลงไว้ <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="เช่น นักศึกษาฝึกงานแผนกพัฒนาระบบสารสนเทศ"
                value={selfFoundForm.job_position}
                onChange={(e) =>
                  setSelfFoundForm({ ...selfFoundForm, job_position: e.target.value })
                }
                className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition-all placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* ผ่อนผัน / Late Submission Window */}
          {lateWindow.isLate && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                การยื่นครั้งนี้เลยกำหนดปกติแล้ว จึงนับเป็นการส่งช้า
              </p>
              <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
                {lateWindow.lateEndDate
                  ? `ระบบยังรับได้ถึงวันที่ ${formatThaiDate(lateWindow.lateEndDate)} `
                  : 'ระบบยังรับได้ '}
                และจะพิมพ์บันทึกข้อความชี้แจงให้พร้อมแบบคำร้อง
                เพื่อนำไปเสนออาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชาตามขั้นตอน
              </p>
              <label
                htmlFor="self-found-late-reason"
                className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mt-2"
              >
                เหตุผลที่ยื่นล่าช้า <span className="text-red-500">*</span>
              </label>
              <textarea
                id="self-found-late-reason"
                required
                minLength={20}
                rows={3}
                placeholder="เขียนด้วยคำของตัวเอง ข้อความนี้จะถูกพิมพ์ลงบันทึกข้อความที่เสนอถึงคณบดี"
                value={lateReason}
                onChange={(e) => setLateReason(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-xl outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-4.5 bg-gray-50/80 dark:bg-gray-800/60 border-t border-gray-200 dark:border-gray-800 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ช่องที่มี * จำเป็นต้องกรอกให้ครบถ้วน
          </span>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4.5 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold text-sm hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm shadow-sm transition-all disabled:opacity-50"
            >
              {isSubmitting ? 'กำลังบันทึกข้อมูล...' : 'บันทึกและเลือกสถานที่นี้'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default SelfFoundJobModal;
