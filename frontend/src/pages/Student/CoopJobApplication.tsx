import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, Printer } from 'lucide-react';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import api, { API_BASE_URL } from '../../services/api';
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
 * ประวัติที่เป็นตาราง (ครอบครัว · การศึกษา · ฝึกอบรม · กิจกรรม) เก็บเป็น JSONB
 * — คีย์ของแต่ละตารางต้องตรงกับ allow-list ฝั่งเซิร์ฟเวอร์ (`coopApplicationHistory.ts`)
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
  career_objective: string | null;
  family_info: FamilyInfo | null;
  education_history: Row[] | null;
  training_history: Row[] | null;
  activity_history: Row[] | null;
  language_proficiency: Row[] | null;
}

/** แถวหนึ่งของตารางประวัติ — คีย์ที่เซิร์ฟเวอร์ยอมรับต่างกันไปตามตาราง */
type Row = Record<string, string>;

interface FamilyInfo {
  father?: Row;
  mother?: Row;
  sibling_count?: string;
  birth_order?: string;
  siblings?: Row[];
}

/** คอลัมน์ของแต่ละตาราง — ต้องตรงกับ allow-list ฝั่งเซิร์ฟเวอร์ (`coopApplicationHistory.ts`) */
const EDUCATION_COLS: { key: string; label: string }[] = [
  { key: 'level', label: 'ระดับการศึกษา' },
  { key: 'institution', label: 'สถานศึกษา' },
  { key: 'start_year', label: 'ปีที่เริ่ม' },
  { key: 'end_year', label: 'ปีที่จบ' },
  { key: 'degree', label: 'วุฒิที่ได้รับ' },
  { key: 'major', label: 'สาขาวิชา' },
];
const TRAINING_COLS: { key: string; label: string }[] = [
  { key: 'period', label: 'ระยะเวลา' },
  { key: 'institution', label: 'หน่วยงาน/สถาบัน' },
  { key: 'topic', label: 'หลักสูตร/เรื่องที่อบรม' },
];
const ACTIVITY_COLS: { key: string; label: string }[] = [
  { key: 'period', label: 'ระยะเวลา' },
  { key: 'position', label: 'ตำแหน่ง' },
  { key: 'duty', label: 'หน้าที่ที่รับผิดชอบ' },
];
const SIBLING_COLS: { key: string; label: string }[] = [
  { key: 'name', label: 'ชื่อ-นามสกุล' },
  { key: 'age', label: 'อายุ' },
  { key: 'occupation', label: 'อาชีพ' },
];
/**
 * ⛔ เขียนลงคอลัมน์ `language_proficiency` **ตัวเดียวกับที่หน้า "ข้อมูลส่วนตัว & เรซูเม่" แก้**
 * หน้านั้นใช้ `language` + `level` ก้อนเดียว ส่วนใบนี้ใช้สามช่องตามฟอร์มจริง
 * · แถวเดียวกันถือคีย์ของทั้งสองหน้าได้ และหน้าโปรไฟล์แก้แถวโดยไม่สร้าง object ใหม่
 *   คีย์ที่มันไม่รู้จักจึงไม่หาย — ถ้าวันหนึ่งไปเขียนใหม่เป็น `map(l => ({...}))` ตรงนั้น
 *   ข้อมูลสามช่องนี้จะหายเงียบๆ ทันที
 */
const LANGUAGE_COLS: { key: string; label: string }[] = [
  { key: 'language', label: 'ภาษา' },
  { key: 'reading', label: 'อ่าน' },
  { key: 'speaking', label: 'พูด' },
  { key: 'writing', label: 'เขียน' },
];

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
  career_objective: '',
};

/**
 * ตารางกรอกแบบเพิ่ม/ลบแถวได้ — ใช้ซ้ำทั้ง 4 ตารางของใบนี้
 *
 * ⛔ **แถวว่างไม่ถูกเก็บลงฐาน** — ตัวตรวจฝั่งเซิร์ฟเวอร์ตัดแถวที่ทุกช่องว่างทิ้งอยู่แล้ว
 * ฟอร์มจึงปล่อยให้มีแถวว่างค้างได้โดยไม่ทำให้ข้อมูลสกปรก
 */
const RowTable: React.FC<{
  testid: string;
  label: string;
  columns: { key: string; label: string }[];
  rows: Row[];
  onChange: (rows: Row[]) => void;
}> = ({ testid, label, columns, rows, onChange }) => (
  <div>
    <div className="mb-2 flex items-center justify-between">
      <p className="text-xs font-bold text-gray-700 dark:text-gray-300">{label}</p>
      <button
        type="button"
        data-testid={`ca-${testid}-add`}
        onClick={() => onChange([...rows, {}])}
        className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-brand-blue transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
      >
        + เพิ่มแถว
      </button>
    </div>

    {rows.length === 0 ? (
      <p className="rounded-xl border border-dashed border-gray-300 py-4 text-center text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
        ยังไม่มีข้อมูล — กด เพิ่มแถว เพื่อเริ่มกรอก (ไม่มีก็ส่งใบสมัครได้)
      </p>
    ) : (
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={index}
            data-testid={`ca-${testid}-row`}
            className="flex items-start gap-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-800/30"
          >
            <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
              {columns.map((col) => (
                <Input
                  key={col.key}
                  size="sm"
                  aria-label={`${label} ${col.label}`}
                  data-testid={`ca-${testid}-${index}-${col.key}`}
                  value={row[col.key] || ''}
                  placeholder={col.label}
                  onChange={(e) => {
                    const next = rows.map((r, i) =>
                      i === index ? { ...r, [col.key]: e.target.value } : r
                    );
                    onChange(next);
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              aria-label={`ลบแถวที่ ${index + 1} ของ${label}`}
              data-testid={`ca-${testid}-${index}-remove`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              className="shrink-0 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              ลบ
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

const CoopJobApplication: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [server, setServer] = useState<CoopApplication | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [consent, setConsent] = useState(false);

  const [family, setFamily] = useState<FamilyInfo>({});
  const [education, setEducation] = useState<Row[]>([]);
  const [training, setTraining] = useState<Row[]>([]);
  const [activities, setActivities] = useState<Row[]>([]);
  const [languages, setLanguages] = useState<Row[]>([]);

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
        career_objective: data.career_objective || '',
      });
      setFamily(data.family_info || {});
      setEducation(data.education_history || []);
      setTraining(data.training_history || []);
      setActivities(data.activity_history || []);
      setLanguages(data.language_proficiency || []);
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
        family_info: family,
        education_history: education,
        training_history: training,
        activity_history: activities,
        language_proficiency: languages,
      });
      setSuccess(res.message || 'บันทึกเรียบร้อยแล้ว');
      setConsent(false);
      await load();
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

      <AlertBanner variant="error" message={error} scrollOnShow />
      <AlertBanner variant="success" message={success} scrollOnShow />

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

      {/* ── ครอบครัว ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
          ประวัติครอบครัว
        </h3>

        {(['father', 'mother'] as const).map((who) => (
          <div key={who} className="mb-4">
            <p className="mb-2 text-xs font-bold text-gray-700 dark:text-gray-300">
              {who === 'father' ? 'บิดา' : 'มารดา'}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              {(['name', 'age', 'occupation', 'phone'] as const).map((field) => (
                <Input
                  key={field}
                  data-testid={`ca-${who}-${field}`}
                  aria-label={`${who === 'father' ? 'บิดา' : 'มารดา'} ${field}`}
                  value={family[who]?.[field] || ''}
                  onChange={(e) =>
                    setFamily((f) => ({ ...f, [who]: { ...(f[who] || {}), [field]: e.target.value } }))
                  }
                  placeholder={
                    {
                      name: 'ชื่อ-นามสกุล',
                      age: 'อายุ',
                      occupation: 'อาชีพ',
                      phone: 'โทรศัพท์',
                    }[field]
                  }
                />
              ))}
            </div>
          </div>
        ))}

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ca-sibling-count" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              จำนวนพี่น้อง (รวมตัวเอง)
            </label>
            <Input
              id="ca-sibling-count"
              data-testid="ca-sibling-count"
              value={family.sibling_count || ''}
              onChange={(e) => setFamily((f) => ({ ...f, sibling_count: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="ca-birth-order" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              เป็นบุตรคนที่
            </label>
            <Input
              id="ca-birth-order"
              data-testid="ca-birth-order"
              value={family.birth_order || ''}
              onChange={(e) => setFamily((f) => ({ ...f, birth_order: e.target.value }))}
            />
          </div>
        </div>

        <RowTable
          testid="siblings"
          label="พี่น้อง"
          columns={SIBLING_COLS}
          rows={family.siblings || []}
          onChange={(rows) => setFamily((f) => ({ ...f, siblings: rows }))}
        />
      </section>

      {/* ── การศึกษา / ฝึกอบรม / กิจกรรม ── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          ประวัติการศึกษา ฝึกอบรม และกิจกรรม
        </h3>

        <div className="space-y-6">
          <RowTable
            testid="education"
            label="ประวัติการศึกษา"
            columns={EDUCATION_COLS}
            rows={education}
            onChange={setEducation}
          />
          <RowTable
            testid="training"
            label="ประวัติการฝึกอบรม / ปฏิบัติงาน"
            columns={TRAINING_COLS}
            rows={training}
            onChange={setTraining}
          />
          <RowTable
            testid="activity"
            label="กิจกรรมที่เคยเข้าร่วม"
            columns={ACTIVITY_COLS}
            rows={activities}
            onChange={setActivities}
          />
          <RowTable
            testid="language"
            label='ความสามารถพิเศษทางภาษา (ใช้ร่วมกับหน้า "ข้อมูลส่วนตัว & เรซูเม่")'
            columns={LANGUAGE_COLS}
            rows={languages}
            onChange={setLanguages}
          />

          <div>
            <label htmlFor="ca-career" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              จุดมุ่งหมายในอาชีพ
            </label>
            <Textarea
              id="ca-career"
              data-testid="ca-career"
              rows={4}
              value={form.career_objective}
              onChange={(e) => set('career_objective', e.target.value)}
              placeholder="อยากทำงานด้านไหน ตั้งเป้าไว้อย่างไรหลังจบการศึกษา"
            />
          </div>
        </div>
      </section>

      {/* ── พิมพ์ใบสมัคร ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <Printer className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          พิมพ์ใบสมัครงาน (สหกิจ 03)
        </h3>
        <p className="mb-4 text-xs text-gray-600 dark:text-gray-400">
          สถานประกอบการที่มีบัญชีในระบบอ่านใบสมัครได้เลย ไม่ต้องพิมพ์ ·
          ปุ่มนี้มีไว้สำหรับที่ที่ยังไม่มีบัญชี — พิมพ์แล้ว<strong>เซ็นชื่อด้วยมือ</strong>
          ก่อนยื่นให้สถานประกอบการ
        </p>
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          ไฟล์ที่ได้จะมี<strong>เลขบัตรประชาชน เชื้อชาติ และศาสนาเป็นค่าจริง</strong>
          (เป็นครั้งเดียวที่ระบบเปิดค่าเหล่านี้ออกมา และมีการบันทึกไว้ทุกครั้ง) — โปรดเก็บไฟล์ให้ดี
        </p>
        <a
          href={`${API_BASE_URL}/students/coop-application/print`}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="ca-print"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 transition-colors hover:border-brand-blue hover:text-brand-blue dark:border-gray-700 dark:text-gray-200 dark:hover:text-blue-400"
        >
          <Printer className="h-4 w-4" />
          เปิดใบสมัครเพื่อสั่งพิมพ์
        </a>
      </section>

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
