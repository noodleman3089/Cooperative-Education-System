import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock } from 'lucide-react';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import api from '../../services/api';
import { getErrorMessage } from '../../utils/errors';

/**
 * ใบสมัครงานสหกิจศึกษา (สหกิจ 03) — **ส่วนตัวตน · ติดต่อ · ฉุกเฉิน**
 *
 * ⛔ **หน้านี้ไม่เคยเห็นเลขบัตรประชาชนของจริง** — เซิร์ฟเวอร์ส่งมาเป็นมาสก์
 * (`x-xxxx-xxxxx-xx-3`) เสมอ ส่วนเชื้อชาติ/ศาสนาส่งมาแค่ธงว่า "กรอกแล้ว"
 * การถอดรหัสมีที่เดียวคือตอนวาดเอกสารจริง (SEC-12 ข้อ 2)
 * → ผลคือ **เว้นช่องอ่อนไหวไว้ว่างแล้วกดบันทึก = ไม่แก้ค่าเดิม** ไม่ใช่ลบทิ้ง
 *
 * ⛔ **เชื้อชาติ/ศาสนาเป็นข้อมูลอ่อนไหวพิเศษตาม PDPA ม.26** ต้องติ๊กยินยอมแยกต่างหาก
 * ไม่ใช่เหมารวมกับเงื่อนไขการใช้งานทั่วไป — ด่านจริงอยู่ที่เซิร์ฟเวอร์ ตรงนี้เป็นด่านคู่
 *
 * 🔴 ส่วนครอบครัว · การศึกษา · ฝึกอบรม · กิจกรรม **ยังไม่ได้ทำ** (ก้อนถัดไป)
 */

interface CoopApplication {
  first_name: string | null;
  last_name: string | null;
  student_code: string | null;
  first_name_en: string | null;
  last_name_en: string | null;
  gender: string | null;
  nationality: string | null;
  phone: string | null;
  mobile_phone: string | null;
  fax: string | null;
  alt_email: string | null;
  emergency_contact_name: string | null;
  emergency_relationship: string | null;
  emergency_address: string | null;
  emergency_phone: string | null;
  national_id_issued_district: string | null;
  national_id_expiry_date: string | null;
  /** มาสก์เท่านั้น — ค่าจริงไม่เคยออกจากเซิร์ฟเวอร์ */
  national_id_masked: string | null;
  has_ethnicity: boolean;
  has_religion: boolean;
  sensitive_data_consented_at: string | null;
}

const BLANK = {
  first_name_en: '',
  last_name_en: '',
  gender: '',
  nationality: '',
  mobile_phone: '',
  fax: '',
  emergency_contact_name: '',
  emergency_relationship: '',
  emergency_address: '',
  emergency_phone: '',
  national_id_issued_district: '',
  national_id_expiry_date: '',
  national_id: '',
  ethnicity: '',
  religion: '',
};

const CoopJobApplication: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [server, setServer] = useState<CoopApplication | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [consent, setConsent] = useState(false);

  const consented = Boolean(server?.sensitive_data_consented_at);

  /**
   * ⛔ **ไม่มี `setLoading(true)` ที่หัวฟังก์ชันโดยตั้งใจ** — สองเหตุผล:
   * 1. ค่าเริ่มต้นของ `loading` เป็น `true` อยู่แล้ว รอบแรกจึงขึ้น skeleton เองอยู่ดี
   * 2. `load()` ถูกเรียกซ้ำหลังกดบันทึก — ถ้าตั้ง `true` ตรงนี้ ทั้งหน้าจะกลับเป็น
   *    skeleton แล้วแถบ "บันทึกเรียบร้อย" ที่เพิ่งขึ้นจะหายไปทันที (กฎเดิมของโปรเจค:
   *    อย่าเรียกโหลดแบบ foreground หลังกดปุ่ม)
   */
  const load = async () => {
    try {
      const data: CoopApplication = await api.get('/students/coop-application');
      setServer(data);
      setForm({
        ...BLANK,
        first_name_en: data.first_name_en || '',
        last_name_en: data.last_name_en || '',
        gender: data.gender || '',
        nationality: data.nationality || '',
        mobile_phone: data.mobile_phone || '',
        fax: data.fax || '',
        emergency_contact_name: data.emergency_contact_name || '',
        emergency_relationship: data.emergency_relationship || '',
        emergency_address: data.emergency_address || '',
        emergency_phone: data.emergency_phone || '',
        national_id_issued_district: data.national_id_issued_district || '',
        national_id_expiry_date: data.national_id_expiry_date
          ? String(data.national_id_expiry_date).split('T')[0]
          : '',
      });
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถดึงข้อมูลใบสมัครงานได้'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // โหลดครั้งเดียวตอนเปิดหน้า — เป็นการดึงข้อมูลตอน mount ซึ่งเป็นรูปแบบเดียวกับ
    // ทุกหน้าจอในโปรเจคนี้ · ปิดกฎตรงจุดพร้อมเหตุผล **แทนการปล่อยให้เป็นหนี้ lint
    // ใบที่ 34** — ตัวเลข 33 คือค่าที่ใช้จับว่ามีของใหม่หลุดเข้ามาไหม ถ้าปล่อยให้ขยับ
    // ทุกครั้งที่เพิ่มหน้าจอ มันก็เลิกเป็นสัญญาณเตือน
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const set = (key: keyof typeof BLANK, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const wantsSensitive = Boolean(form.ethnicity.trim() || form.religion.trim());
  const blockedBySensitiveConsent = wantsSensitive && !consented && !consent;

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.put('/students/coop-application', {
        ...form,
        sensitive_data_consent: consent,
      });
      setSuccess(res.message || 'บันทึกเรียบร้อยแล้ว');
      setConsent(false);
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลได้'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSkeleton variant="form" />;

  return (
    <div className="max-w-4xl mx-auto space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">
          ใบสมัครงานสหกิจศึกษา (สหกิจ 03)
        </h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          ข้อมูลชุดนี้จะถูกใช้จัดทำใบสมัครงานที่ส่งให้สถานประกอบการ
          ส่วนที่ระบบรู้อยู่แล้ว (ชื่อไทย · รหัสนักศึกษา · สาขา · เกรด) ดึงจากโปรไฟล์ให้อัตโนมัติ
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* ── ตัวตน ───────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          ข้อมูลส่วนตัว
        </h3>

        <div className="mb-4 rounded-xl bg-gray-50 p-4 text-xs text-gray-600 dark:bg-gray-800/40 dark:text-gray-300">
          <span className="font-bold text-gray-800 dark:text-gray-200">
            {[server?.first_name, server?.last_name].filter(Boolean).join(' ') || '-'}
          </span>
          {' · '}รหัส {server?.student_code || '-'}
          <span className="mt-1 block text-gray-500 dark:text-gray-400">
            แก้ชื่อไทยและรหัสนักศึกษาได้ที่หน้า “ข้อมูลส่วนตัว &amp; เรซูเม่”
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ca-first-en" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              ชื่อ (ภาษาอังกฤษ)
            </label>
            <Input
              id="ca-first-en"
              data-testid="ca-first-en"
              value={form.first_name_en}
              onChange={(e) => set('first_name_en', e.target.value)}
              placeholder="Somchai"
            />
          </div>
          <div>
            <label htmlFor="ca-last-en" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              นามสกุล (ภาษาอังกฤษ)
            </label>
            <Input
              id="ca-last-en"
              data-testid="ca-last-en"
              value={form.last_name_en}
              onChange={(e) => set('last_name_en', e.target.value)}
              placeholder="Saidee"
            />
          </div>
          <div>
            <label htmlFor="ca-gender" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              เพศ
            </label>
            <Select
              id="ca-gender"
              data-testid="ca-gender"
              value={form.gender}
              onChange={(e) => set('gender', e.target.value)}
            >
              <option value="">-- เลือก --</option>
              <option value="ชาย">ชาย</option>
              <option value="หญิง">หญิง</option>
              <option value="ไม่ระบุ">ไม่ระบุ</option>
            </Select>
          </div>
          <div>
            {/* ⛔ สัญชาติ ≠ เชื้อชาติ — ตัวนี้เป็นข้อมูลทั่วไป ไม่ต้องยินยอมแยก */}
            <label htmlFor="ca-nationality" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              สัญชาติ
            </label>
            <Input
              id="ca-nationality"
              data-testid="ca-nationality"
              value={form.nationality}
              onChange={(e) => set('nationality', e.target.value)}
              placeholder="ไทย"
            />
          </div>
        </div>
      </section>

      {/* ── ติดต่อ ──────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          ข้อมูลติดต่อ
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              โทรศัพท์ (จากโปรไฟล์)
            </label>
            <Input value={server?.phone || ''} readOnly disabled />
          </div>
          <div>
            <label htmlFor="ca-mobile" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              โทรศัพท์มือถือ
            </label>
            <Input
              id="ca-mobile"
              data-testid="ca-mobile"
              value={form.mobile_phone}
              onChange={(e) => set('mobile_phone', e.target.value)}
              placeholder="089-123-4567"
            />
          </div>
          <div>
            <label htmlFor="ca-fax" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              โทรสาร
            </label>
            <Input
              id="ca-fax"
              data-testid="ca-fax"
              value={form.fax}
              onChange={(e) => set('fax', e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              E-mail (จากโปรไฟล์)
            </label>
            <Input value={server?.alt_email || ''} readOnly disabled />
          </div>
        </div>
      </section>

      {/* ── ฉุกเฉิน ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          บุคคลติดต่อกรณีฉุกเฉิน
        </h3>
        <p className="mb-4 text-xs text-gray-600 dark:text-gray-400">
          ใช้ร่วมกับแบบแจ้งที่พัก (สหกิจ 06) — แก้ที่นี่แล้วอีกใบเปลี่ยนตาม ไม่ต้องกรอกซ้ำ
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ca-emg-name" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              ชื่อ-นามสกุล
            </label>
            <Input
              id="ca-emg-name"
              data-testid="ca-emg-name"
              value={form.emergency_contact_name}
              onChange={(e) => set('emergency_contact_name', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="ca-emg-relation" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              ความสัมพันธ์
            </label>
            <Input
              id="ca-emg-relation"
              data-testid="ca-emg-relation"
              value={form.emergency_relationship}
              onChange={(e) => set('emergency_relationship', e.target.value)}
              placeholder="บิดา · มารดา · พี่ชาย"
            />
          </div>
          <div>
            <label htmlFor="ca-emg-phone" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              เบอร์โทรศัพท์
            </label>
            <Input
              id="ca-emg-phone"
              data-testid="ca-emg-phone"
              value={form.emergency_phone}
              onChange={(e) => set('emergency_phone', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ca-emg-address" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              ที่อยู่
            </label>
            <Textarea
              id="ca-emg-address"
              data-testid="ca-emg-address"
              rows={2}
              value={form.emergency_address}
              onChange={(e) => set('emergency_address', e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* ── ข้อมูลอ่อนไหว (SEC-12) ──────────────────────────────────────── */}
      <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-6 dark:border-amber-900/50 dark:bg-amber-950/10">
        <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          ข้อมูลบัตรประชาชนและข้อมูลอ่อนไหว
        </h3>
        <p className="mb-4 text-xs text-gray-700 dark:text-gray-300">
          ข้อมูลกลุ่มนี้ถูก<strong>เข้ารหัสก่อนเก็บลงฐานข้อมูล</strong>
          และจะถูก<strong>ลบอัตโนมัติภายใน 90 วัน</strong>หลังการประเมินสหกิจศึกษาเสร็จสิ้น
          · สถานประกอบการไม่มีทางเห็นข้อมูลกลุ่มนี้ไม่ว่ากรณีใด
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="ca-national-id" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              เลขประจำตัวประชาชน (13 หลัก)
            </label>
            <Input
              id="ca-national-id"
              data-testid="ca-national-id"
              inputMode="numeric"
              value={form.national_id}
              onChange={(e) => set('national_id', e.target.value)}
              placeholder={server?.national_id_masked || 'ยังไม่เคยกรอก'}
            />
            {server?.national_id_masked && (
              <p
                className="mt-1 text-xs text-gray-600 dark:text-gray-400"
                data-testid="ca-national-id-masked"
              >
                บันทึกไว้แล้ว: {server.national_id_masked} — เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน
              </p>
            )}
          </div>
          <div>
            <label htmlFor="ca-id-district" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              บัตรออกให้ ณ เขต/อำเภอ
            </label>
            <Input
              id="ca-id-district"
              data-testid="ca-id-district"
              value={form.national_id_issued_district}
              onChange={(e) => set('national_id_issued_district', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="ca-id-expiry" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              วันหมดอายุบัตร
            </label>
            <Input
              id="ca-id-expiry"
              data-testid="ca-id-expiry"
              type="date"
              value={form.national_id_expiry_date}
              onChange={(e) => set('national_id_expiry_date', e.target.value)}
            />
          </div>
        </div>

        {/* PDPA ม.26 — เชื้อชาติ/ศาสนา ต้องยินยอมแยกต่างหาก */}
        <div className="mt-6 rounded-xl border border-amber-300 bg-white p-4 dark:border-amber-900 dark:bg-gray-900">
          <div className="mb-3 flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-gray-700 dark:text-gray-300">
              <strong>เชื้อชาติและศาสนา</strong> เป็นข้อมูลส่วนบุคคลอ่อนไหวตาม
              พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล <strong>มาตรา 26</strong> —
              กรอกเฉพาะเมื่อยินยอม และ<strong>ไม่กรอกก็ส่งใบสมัครได้ตามปกติ</strong>
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ca-ethnicity" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                เชื้อชาติ
              </label>
              <Input
                id="ca-ethnicity"
                data-testid="ca-ethnicity"
                value={form.ethnicity}
                onChange={(e) => set('ethnicity', e.target.value)}
                placeholder={server?.has_ethnicity ? 'บันทึกไว้แล้ว (เข้ารหัส)' : ''}
              />
            </div>
            <div>
              <label htmlFor="ca-religion" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                ศาสนา
              </label>
              <Input
                id="ca-religion"
                data-testid="ca-religion"
                value={form.religion}
                onChange={(e) => set('religion', e.target.value)}
                placeholder={server?.has_religion ? 'บันทึกไว้แล้ว (เข้ารหัส)' : ''}
              />
            </div>
          </div>

          {consented ? (
            <p
              className="mt-3 text-xs font-medium text-emerald-700 dark:text-emerald-400"
              data-testid="ca-consent-done"
            >
              ให้ความยินยอมไว้แล้วเมื่อ{' '}
              {new Date(server!.sensitive_data_consented_at!).toLocaleDateString('th-TH')}
            </p>
          ) : (
            <label className="mt-3 flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                data-testid="ca-consent"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700"
              />
              <span>
                ข้าพเจ้ายินยอมให้มหาวิทยาลัยเก็บและใช้ข้อมูลเชื้อชาติและศาสนาของข้าพเจ้า
                เพื่อจัดทำใบสมัครงานสหกิจศึกษาเท่านั้น
              </span>
            </label>
          )}
        </div>
      </section>

      {/* ส่วนที่เหลือของใบยังไม่ได้ทำ — บอกตรงๆ ดีกว่าให้ผู้ใช้เดาว่าหายไปไหน */}
      <AlertBanner
        variant="info"
        message="ส่วนประวัติครอบครัว การศึกษา ฝึกอบรม และกิจกรรม กำลังพัฒนา จะเปิดให้กรอกในลำดับถัดไป"
      />

      <div className="flex justify-end gap-3 pb-6">
        <Button
          data-testid="ca-submit"
          loading={saving}
          disabled={blockedBySensitiveConsent}
          onClick={handleSubmit}
        >
          บันทึกข้อมูลใบสมัคร
        </Button>
      </div>
      {blockedBySensitiveConsent && (
        <p className="-mt-4 pb-6 text-right text-xs text-amber-700 dark:text-amber-400">
          ต้องติ๊กยินยอมก่อน จึงจะบันทึกเชื้อชาติ/ศาสนาได้
        </p>
      )}
    </div>
  );
};

export default CoopJobApplication;
