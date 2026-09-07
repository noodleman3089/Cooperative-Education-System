import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody } from './ui/Modal';
import Button from './ui/Button';
import { getErrorMessage } from '../utils/errors';
import { Input, Select, Textarea } from './ui/Input';
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
  // ฟอร์มนี้เป็นฟอร์มยาวอยู่แล้ว จึงใส่ช่องเหตุผลไว้ในฟอร์มเลย ไม่เปิดกล่องซ้อน
  const lateWindow = useLateWindow('intent_submission');
  const [lateReason, setLateReason] = useState('');

  const autocompleteInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<PlacesAutocomplete | null>(null);

  // ponytail: contact_email ถูกตัดออกตามคำขอเพราะไม่จำเป็นสำหรับ workflow ปัจจุบัน
  const [selfFoundForm, setSelfFoundForm] = useState({
    company_name_th: '',
    company_name_en: '',
    company_address: '',
    company_province: '',
    company_district: '',
    company_postal_code: '',
    company_phone: '',
    contact_person: '',
    contact_position: ''
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
      const provComp = place.address_components.find((c: AddressComponent) => c.types.includes('administrative_area_level_1'));
      if (provComp) {
        province = provComp.long_name;
        if (province.startsWith('จังหวัด')) {
          province = province.replace('จังหวัด', '').trim();
        }
      }

      const districtComp = place.address_components.find((c: AddressComponent) => 
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

      const zipComp = place.address_components.find((c: AddressComponent) => c.types.includes('postal_code'));
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

    setSelfFoundForm(prev => ({
      ...prev,
      company_name_th: place.name || '',
      company_address: cleanAddress,
      company_province: province,
      company_district: district,
      company_postal_code: postalCode,
      company_phone: phone || prev.company_phone
    }));

    try {
      const res = await api.post('/companies/google-search', {
        google_place_id: place.place_id
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
      fields: ['place_id', 'name', 'formatted_address', 'address_components', 'formatted_phone_number']
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
      company_phone
    } = selfFoundForm;

    if (!company_name_th || !company_address || !company_province || !company_district || !company_postal_code || !company_phone) {
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
            phone: company_phone
          });
          targetCompanyId = createCompanyRes.company_id;
        } catch (createErr) {
          throw new Error(getErrorMessage(createErr, 'ไม่สามารถลงทะเบียนที่อยู่จาก Google Maps เข้าระบบได้'), { cause: createErr });
        }
      }

      if (targetCompanyId) {
        const payload = {
          is_self_found: false,
          company_id: targetCompanyId,
          semester_id: activeSemester.semester_id,
          job_id: null,
          late_reason: lateWindow.isLate ? lateReason.trim() : undefined
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
          late_reason: lateWindow.isLate ? lateReason.trim() : undefined
        };
        await api.post('/intents', payload);
      }

      onSuccess(`ลงทะเบียนและส่งใบสมัครไปยัง ${company_name_th} เรียบร้อยแล้ว — พิมพ์แบบคำร้องไปให้ลงนาม แล้วอัปโหลดกลับที่หน้าแรก`);
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
      title="ระบุรายละเอียดสถานที่ฝึกงานด้วยตนเอง"
    >
      <ModalBody>
        <p className="text-xs text-gray-600 dark:text-gray-400 mb-5">
          กรอกข้อมูลสถานประกอบการที่คุณติดต่อและได้รับการตอบรับเข้าฝึกงานเพื่อบันทึกประวัติ
        </p>

        <AlertBanner variant="error" message={error} className="mb-4" />

        <form onSubmit={handleSelfFoundSubmit} className="space-y-6">
          {mapsLoaded && (
            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 dark:bg-blue-950/10 dark:border-blue-900/30 space-y-2">
              <label className="block text-xs font-bold text-brand-blue dark:text-blue-400">
                ค้นหาและดึงที่อยู่สถานประกอบการอัตโนมัติด้วย Google Maps
              </label>
              <div className="relative">
                <input
                  ref={autocompleteInputRef}
                  type="text"
                  placeholder="พิมพ์ชื่อบริษัท ห้างร้าน หรือค้นหาพิกัดบนแผนที่..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-blue-200 focus:outline-none focus:border-brand-blue bg-white dark:bg-gray-800 dark:border-blue-900/50 dark:text-white"
                />
                <svg className="absolute left-3 top-2.5 h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              {/* A field-level confirmation, not page feedback — AlertBanner's
                  page-sized padding would swamp this helper box. */}
              {placeCheckMessage && (
                <p className="text-xs font-semibold text-green-700 dark:text-green-400">
                  {placeCheckMessage}
                </p>
              )}
              <p className="text-xs text-gray-600 dark:text-gray-400">
                * เมื่อเลือกสถานที่จากรายการแนะนำ ระบบจะกรอกฟอร์มที่อยู่ เบอร์โทรศัพท์ และพิกัดด้านล่างให้โดยอัตโนมัติ
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                ชื่อสถานประกอบการ (ภาษาไทย) <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <Input
                type="text"
                required
                placeholder="เช่น บริษัท ตัวอย่าง จำกัด"
                value={selfFoundForm.company_name_th}
                onChange={(e) => setSelfFoundForm({ ...selfFoundForm, company_name_th: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                ชื่อสถานประกอบการ (ภาษาอังกฤษ)
              </label>
              <Input
                type="text"
                placeholder="เช่น Example Company Co., Ltd."
                value={selfFoundForm.company_name_en}
                onChange={(e) => setSelfFoundForm({ ...selfFoundForm, company_name_en: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
              ที่ตั้ง / ที่อยู่สถานประกอบการ <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <Input
              type="text"
              required
              placeholder="เลขที่ ถนน หมู่ ซอย ตำบล"
              value={selfFoundForm.company_address}
              onChange={(e) => setSelfFoundForm({ ...selfFoundForm, company_address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                จังหวัด <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <Select
                required
                value={selfFoundForm.company_province}
                onChange={(e) => setSelfFoundForm({ ...selfFoundForm, company_province: e.target.value })}
                className="appearance-none"
              >
                <option value="">-- เลือกจังหวัด --</option>
                {provinceList.map((p) => (
                  <option key={p.province_id} value={p.province_name_th}>
                    {p.province_name_th}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                อำเภอ / เขต <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <Input
                type="text"
                required
                placeholder="เช่น เมือง"
                value={selfFoundForm.company_district}
                onChange={(e) => setSelfFoundForm({ ...selfFoundForm, company_district: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                รหัสไปรษณีย์ <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <Input
                type="text"
                required
                pattern="[0-9]{5}"
                placeholder="เช่น 10000"
                value={selfFoundForm.company_postal_code}
                onChange={(e) => setSelfFoundForm({ ...selfFoundForm, company_postal_code: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                เบอร์โทรศัพท์สถานประกอบการ <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <Input
                type="text"
                required
                placeholder="เช่น 021234567"
                value={selfFoundForm.company_phone}
                onChange={(e) => setSelfFoundForm({ ...selfFoundForm, company_phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                ชื่อผู้ติดต่อประสานงานหลัก
              </label>
              <Input
                type="text"
                placeholder="เช่น นายสมศักดิ์ รักเรียน"
                value={selfFoundForm.contact_person}
                onChange={(e) => setSelfFoundForm({ ...selfFoundForm, contact_person: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                ตำแหน่งผู้ติดต่อประสานงาน
              </label>
              <Input
                type="text"
                placeholder="เช่น เจ้าหน้าที่ฝ่ายบุคคล HR"
                value={selfFoundForm.contact_position}
                onChange={(e) => setSelfFoundForm({ ...selfFoundForm, contact_position: e.target.value })}
              />
            </div>
          </div>

          {lateWindow.isLate && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
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
                className="block text-xs font-semibold text-gray-600 dark:text-gray-300"
              >
                เหตุผลที่ยื่นล่าช้า <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <Textarea
                id="self-found-late-reason"
                required
                minLength={20}
                rows={4}
                placeholder="เขียนด้วยคำของตัวเอง ข้อความนี้จะถูกพิมพ์ลงบันทึกข้อความที่เสนอถึงคณบดี"
                value={lateReason}
                onChange={(e) => setLateReason(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-gray-100 dark:border-gray-800">
            <Button variant="secondary" size="sm" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={isSubmitting}
              loadingLabel="กำลังส่งข้อมูล..."
            >
              {/* ปุ่มนี้ยื่น "ใบความจำนง" ไม่ใช่ "รายงานตัวเข้าปฏิบัติงาน" ซึ่งเป็นคนละขั้น
                  ที่เกิดหลังบริษัทตอบรับ — ชื่อเดิมชวนให้กดผิดขั้น */}
              ยื่นใบความจำนงสหกิจศึกษา
            </Button>
          </div>
        </form>
      </ModalBody>
    </Modal>
  );
};

export default SelfFoundJobModal;
