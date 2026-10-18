import React, { useContext, useEffect, useRef, useState } from 'react';
import { AuthContext } from '../../context/authContextValue';
import { clearCoop03Draft, loadCoop03Draft, saveCoop03Draft } from '../../utils/coop03Draft';
import { ShieldCheck, Lock } from 'lucide-react';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import api from '../../services/api';
import { getErrorMessage } from '../../utils/errors';
import type { StudentProfile } from '../../types/api';

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
  /** หมวดตารางที่ยืนยัน "ไม่มีข้อมูล" (education · training · activity · language) */
  none_sections?: string[];
  missing_required?: string[];
}

const COOP03_FIELD_LABELS: Record<string, string> = {
  first_name_en: 'ชื่อภาษาอังกฤษ',
  last_name_en: 'นามสกุลภาษาอังกฤษ',
  gender: 'เพศ',
  nationality: 'สัญชาติ',
  phone: 'เบอร์โทรศัพท์',
  national_id: 'เลขประจำตัวประชาชน',
  national_id_issued_district: 'อำเภอ/เขตที่ออกบัตร',
  national_id_expiry_date: 'วันหมดอายุบัตร',
  emergency_contact_name: 'ชื่อผู้ติดต่อฉุกเฉิน',
  emergency_relationship: 'ความสัมพันธ์ผู้ติดต่อฉุกเฉิน',
  emergency_phone: 'เบอร์โทรผู้ติดต่อฉุกเฉิน',
  education: 'ประวัติการศึกษา (กรอกหรือติ๊กไม่มี)',
  training: 'ประวัติการฝึกอบรม/ปฏิบัติงาน (กรอกหรือติ๊กไม่มี)',
  activity: 'กิจกรรมที่เคยเข้าร่วม (กรอกหรือติ๊กไม่มี)',
  language: 'ความสามารถทางภาษา (กรอกหรือติ๊กไม่มี)',
};

/** แถวหนึ่งของตารางประวัติ — คีย์ที่เซิร์ฟเวอร์ยอมรับต่างกันไปตามตาราง */
type Row = Record<string, string>;

interface FamilyInfo {
  father?: Row;
  mother?: Row;
  sibling_count?: string;
  birth_order?: string;
  siblings?: Row[];
}

/** หนึ่งคอลัมน์ของตารางกรอก — `key` ต้องตรงกับ allow-list ฝั่งเซิร์ฟเวอร์ (`coopApplicationHistory.ts`) */
interface Col {
  key: string;
  label: string;
  /** มีรายการให้เลือก (dropdown) · เป็นฟังก์ชันได้ เมื่อตัวเลือกขึ้นกับช่องอื่นในแถวเดียวกัน */
  options?: string[] | ((row: Row) => string[]);
  /** เพิ่มตัวเลือก "อื่น ๆ (ระบุเอง)" ต่อท้าย — ค่าที่เก็บคือข้อความที่พิมพ์ตรง ๆ */
  other?: boolean;
  type?: 'number';
  /** ตัวเลือกขึ้นกับช่องนี้ — แก้ช่องนั้นแล้วช่องนี้ถูกล้าง (เช่น เปลี่ยนระดับแล้ววุฒิเดิมใช้ไม่ได้) */
  dependsOn?: string;
}

const EDUCATION_LEVELS = ['มัธยมต้น', 'มัธยมปลาย', 'ต่ำกว่าอนุปริญญา', 'อนุปริญญา', 'ปริญญาตรี'];
/** วุฒิที่เลือกได้ของแต่ละระดับ — ไม่อยู่ในรายการให้เลือก "อื่น ๆ" แล้วพิมพ์เอง */
const DEGREE_BY_LEVEL: Record<string, string[]> = {
  มัธยมต้น: ['มัธยมศึกษาตอนต้น (ม.3)'],
  มัธยมปลาย: ['มัธยมศึกษาตอนปลาย (ม.6)'],
  ต่ำกว่าอนุปริญญา: ['ประกาศนียบัตรวิชาชีพ (ปวช.)'],
  อนุปริญญา: ['ประกาศนียบัตรวิชาชีพชั้นสูง (ปวส.)', 'อนุปริญญา'],
  ปริญญาตรี: [
    'บริหารธุรกิจบัณฑิต (บธ.บ.)',
    'วิทยาศาสตรบัณฑิต (วท.บ.)',
    'ศิลปศาสตรบัณฑิต (ศศ.บ.)',
    'เทคโนโลยีบัณฑิต (ทล.บ.)',
  ],
};
/** ปี พ.ศ. ให้เลือก — ล่วงหน้า 6 ปี (ปีที่คาดว่าจะจบ) ถอยหลัง 40 ปี */
const BE_NOW = new Date().getFullYear() + 543;
const YEAR_OPTIONS = Array.from({ length: 47 }, (_, i) => String(BE_NOW + 6 - i));

const EDUCATION_COLS: Col[] = [
  { key: 'level', label: 'ระดับการศึกษา', options: EDUCATION_LEVELS },
  { key: 'institution', label: 'สถานศึกษา' },
  { key: 'start_year', label: 'ปีที่เริ่ม (พ.ศ.)', options: YEAR_OPTIONS },
  { key: 'end_year', label: 'ปีที่จบ (พ.ศ.)', options: YEAR_OPTIONS },
  {
    key: 'degree',
    label: 'วุฒิการศึกษา',
    options: (row) => DEGREE_BY_LEVEL[row.level] ?? [],
    other: true,
    dependsOn: 'level',
  },
  { key: 'major', label: 'วิชา' },
];
const TRAINING_COLS: Col[] = [
  { key: 'period', label: 'ระยะเวลา' },
  { key: 'institution', label: 'หน่วยงาน/สถาบัน' },
  { key: 'topic', label: 'หลักสูตร/เรื่องที่อบรม' },
];
// `position` = "ตำแหน่งและหน้าที่" ช่องเดียวตามฟอร์มจริง (เดิมแยกจาก `duty` — migration 061 รวมของเก่าให้แล้ว)
const ACTIVITY_COLS: Col[] = [
  { key: 'period', label: 'ระยะเวลา' },
  { key: 'position', label: 'ตำแหน่งและหน้าที่' },
];
const SIBLING_COLS: Col[] = [
  { key: 'name', label: 'ชื่อ-นามสกุล' },
  { key: 'age', label: 'อายุ (ปี)', type: 'number' },
  { key: 'occupation', label: 'อาชีพ' },
];
/**
 * ⛔ เขียนลงคอลัมน์ `language_proficiency` **ตัวเดียวกับที่หน้า "ข้อมูลส่วนตัว & เรซูเม่" แก้**
 * หน้านั้นใช้ `language` + `level` ก้อนเดียว ส่วนใบนี้ใช้สามช่องตามฟอร์มจริง
 * · แถวเดียวกันถือคีย์ของทั้งสองหน้าได้ และหน้าโปรไฟล์แก้แถวโดยไม่สร้าง object ใหม่
 *   คีย์ที่มันไม่รู้จักจึงไม่หาย — ถ้าวันหนึ่งไปเขียนใหม่เป็น `map(l => ({...}))` ตรงนั้น
 *   ข้อมูลสามช่องนี้จะหายเงียบๆ ทันที
 */
const LANGUAGE_LEVELS = ['ดีมาก', 'ดี', 'พอใช้', 'พื้นฐาน'];
/** ภาษาอังกฤษมีแถวประจำบนฟอร์มจริง · ภาษาอื่นเลือกจากรายการหรือระบุเอง */
const ENGLISH = 'ภาษาอังกฤษ';
const isEnglishRow = (r: Row) => /อังกฤษ|english/i.test(r.language ?? '');
const OTHER_LANGUAGES = [
  'ภาษาจีน',
  'ภาษาญี่ปุ่น',
  'ภาษาเกาหลี',
  'ภาษาฝรั่งเศส',
  'ภาษาเยอรมัน',
  'ภาษามลายู',
  'ภาษาเวียดนาม',
];
const LANGUAGE_SKILLS = [
  { key: 'reading', label: 'อ่าน' },
  { key: 'speaking', label: 'พูด' },
  { key: 'writing', label: 'เขียน' },
];
const OTHER_LANGUAGE_COLS: Col[] = [
  { key: 'language', label: 'ภาษา', options: OTHER_LANGUAGES, other: true },
  ...LANGUAGE_SKILLS.map((s) => ({ key: s.key, label: s.label, options: LANGUAGE_LEVELS })),
];

/** ความสัมพันธ์ของผู้ติดต่อฉุกเฉินที่พบบ่อย — ค่าที่เก็บคือข้อความนี้ตรง ๆ (ไม่มีรหัสแยก) */
const RELATION_OPTIONS = [
  'บิดา',
  'มารดา',
  'ผู้ปกครอง',
  'พี่ชาย',
  'พี่สาว',
  'น้องชาย',
  'น้องสาว',
  'ปู่/ตา',
  'ย่า/ยาย',
  'ลุง/ป้า/น้า/อา',
  'คู่สมรส',
];
const RELATION_OTHER = '__other';

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
const OTHER = '__other';

/** ช่องเดียวของตาราง: พิมพ์ · ตัวเลข · เลือกจากรายการ (+ "อื่น ๆ" ระบุเอง) */
const RowField: React.FC<{
  col: Col;
  row: Row;
  id: string;
  testid: string;
  label: string;
  onChange: (value: string) => void;
}> = ({ col, row, id, testid, label, onChange }) => {
  const value = row[col.key] || '';
  // กด "อื่น ๆ" แล้วแต่ยังไม่ได้พิมพ์ → ช่องระบุเองต้องค้างอยู่ (ค่ายังว่าง จึงอนุมานจากค่าไม่ได้)
  const [forcedOther, setForcedOther] = useState(false);

  if (!col.options) {
    return (
      <Input
        id={id}
        size="sm"
        type={col.type}
        min={col.type === 'number' ? 0 : undefined}
        inputMode={col.type === 'number' ? 'numeric' : undefined}
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const options = typeof col.options === 'function' ? col.options(row) : col.options;
  const inList = options.includes(value);
  const isOther = !!col.other && (forcedOther || (value !== '' && !inList));
  // ค่าเดิมที่ไม่อยู่ในรายการและไม่มีช่อง "อื่น ๆ" (เช่น ข้อมูลที่เคยพิมพ์เองก่อนเปลี่ยนเป็น dropdown) — โชว์ต่อ ไม่ทำให้หายตอนบันทึก
  const legacy = !col.other && value !== '' && !inList;

  return (
    <>
      <Select
        id={id}
        size="sm"
        data-testid={testid}
        value={isOther ? OTHER : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === OTHER) {
            setForcedOther(true);
            if (inList) onChange('');
          } else {
            setForcedOther(false);
            onChange(v);
          }
        }}
      >
        <option value="">-- เลือก --</option>
        {legacy && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {col.other && <option value={OTHER}>อื่น ๆ (ระบุเอง)</option>}
      </Select>
      {isOther && (
        <Input
          size="sm"
          className="mt-2"
          aria-label={`${label} (ระบุเอง)`}
          data-testid={`${testid}-other`}
          value={inList ? '' : value}
          maxLength={100}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </>
  );
};

const RowTable: React.FC<{
  testid: string;
  label: string;
  columns: Col[];
  rows: Row[];
  onChange: (rows: Row[]) => void;
  /** ข้อความบนปุ่มเพิ่ม (ค่าเริ่มต้น "+ เพิ่มแถว") */
  addLabel?: string;
  /** แถวพิเศษที่แสดงเหนือรายการ (เช่น ภาษาอังกฤษประจำ) และ `leadHasContent` = แถวนั้นมีข้อมูลแล้ว (นับเป็น "มีข้อมูล" กับช่องติ๊กไม่มี) */
  lead?: React.ReactNode;
  leadHasContent?: boolean;
  /** ข้อความตอนยังไม่มีแถว (แทนข้อความมาตรฐาน) */
  emptyText?: string;
  /**
   * หมวดบังคับ (เจ้าของสั่ง 2026-10-18): ต้องมีอย่างน้อย 1 แถว หรือติ๊ก "ไม่มีข้อมูล" — ไม่ส่ง `onNoneChange` = หมวดไม่บังคับ
   * ⛔ ห้ามบังคับแบบไม่มีทางออก คนที่ไม่เคยฝึกอบรมจริง ๆ จะตัน
   */
  none?: boolean;
  onNoneChange?: (none: boolean) => void;
}> = ({ testid, label, columns, rows, onChange, none = false, onNoneChange, addLabel, lead, leadHasContent = false, emptyText }) => {
  const required = !!onNoneChange;
  // มีแถวที่กรอกอะไรบางอย่างแล้ว → ติ๊ก "ไม่มี" ไม่ได้ (ขัดกัน)
  const hasContent =
    leadHasContent || rows.some((r) => Object.values(r).some((v) => (v ?? '').trim() !== ''));
  const gridCols =
    columns.length <= 2 ? 'sm:grid-cols-2' : columns.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3';
  // แก้ช่องหนึ่ง → ล้างช่องที่ตัวเลือกขึ้นกับมัน (`dependsOn`)
  const setCell = (index: number, key: string, value: string) =>
    onChange(
      rows.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, [key]: value };
        for (const c of columns) if (c.dependsOn === key) delete next[c.key];
        return next;
      })
    );
  const showNone = none && !hasContent;
  return (
  <div>
    <div className="mb-2 flex items-center justify-between">
      <p className="text-xs font-bold text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="ml-1 text-red-600 dark:text-red-400">*</span>}
      </p>
      <button
        type="button"
        data-testid={`ca-${testid}-add`}
        onClick={() => {
          if (none) onNoneChange?.(false);
          onChange([...rows, {}]);
        }}
        className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-brand-blue transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
      >
        {addLabel ?? '+ เพิ่มแถว'}
      </button>
    </div>

    {required && (
      <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          data-testid={`ca-${testid}-none`}
          checked={showNone}
          disabled={hasContent}
          onChange={(e) => onNoneChange?.(e.target.checked)}
          className="h-4 w-4 accent-brand-blue disabled:cursor-not-allowed"
        />
        ไม่มีข้อมูลในหมวดนี้
      </label>
    )}

    {lead && <div className="mb-2">{lead}</div>}

    {rows.length === 0 ? (
      <p className="rounded-xl border border-dashed border-gray-300 py-4 text-center text-xs text-gray-600 dark:border-gray-700 dark:text-gray-400">
        {emptyText ??
          (!required
            ? 'ยังไม่มีข้อมูล — กด เพิ่มแถว เพื่อเริ่มกรอก (ไม่บังคับ)'
            : showNone
              ? 'ยืนยันแล้วว่าไม่มีข้อมูลในหมวดนี้'
              : 'ยังไม่มีข้อมูล — กด เพิ่มแถว เพื่อกรอก หรือติ๊ก "ไม่มีข้อมูลในหมวดนี้" (บังคับอย่างใดอย่างหนึ่ง)')}
      </p>
    ) : (
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={index}
            data-testid={`ca-${testid}-row`}
            className="flex items-start gap-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-800/30"
          >
            <span className="mt-6 w-5 shrink-0 text-xs font-bold text-gray-600 dark:text-gray-400">
              {index + 1}.
            </span>
            <div className={`grid flex-1 grid-cols-1 gap-x-2 gap-y-3 ${gridCols}`}>
              {columns.map((col) => {
                const id = `ca-${testid}-${index}-${col.key}`;
                return (
                  <div key={`${col.key}:${col.dependsOn ? (row[col.dependsOn] ?? '') : ''}`}>
                    <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-gray-700 dark:text-gray-300">
                      {col.label}
                    </label>
                    <RowField
                      col={col}
                      row={row}
                      id={id}
                      testid={id}
                      label={`${label} ${col.label}`}
                      onChange={(v) => setCell(index, col.key, v)}
                    />
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              aria-label={`ลบแถวที่ ${index + 1} ของ${label}`}
              data-testid={`ca-${testid}-${index}-remove`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              className="mt-5 shrink-0 rounded-lg border border-red-200 px-2 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              ลบ
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
  );
};

const CoopJobApplication: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [server, setServer] = useState<CoopApplication | null>(null);
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [consent, setConsent] = useState(false);

  const [family, setFamily] = useState<FamilyInfo>({});
  const [education, setEducation] = useState<Row[]>([]);
  const [training, setTraining] = useState<Row[]>([]);
  const [activities, setActivities] = useState<Row[]>([]);
  const [languages, setLanguages] = useState<Row[]>([]);
  /** กด "อื่น ๆ" แล้ว — ให้ช่องระบุเองค้างอยู่แม้ยังไม่ได้พิมพ์อะไร */
  const [relationOther, setRelationOther] = useState(false);
  /** หมวดตารางที่ติ๊ก "ไม่มีข้อมูล" — education · training · activity · language (บังคับอย่างใดอย่างหนึ่งกับการกรอกแถว) */
  const [noneSections, setNoneSections] = useState<string[]>([]);
  const setNone = (section: string, value: boolean) =>
    setNoneSections((prev) => (value ? [...new Set([...prev, section])] : prev.filter((s) => s !== section)));

  // จุดมุ่งหมายอาชีพ: เก็บเป็นข้อความบรรทัดละข้อ (คอลัมน์ TEXT เดิม ไม่ต้อง migrate) · ฟอร์มจริงมี 4 ข้อ
  // ข้อมูลเดิมที่เป็นย่อหน้าเดียวไปอยู่ข้อ 1 · มีเกิน 4 บรรทัดก็โชว์ครบ ไม่ตัดทิ้ง
  const careerLineList = form.career_objective.split('\n');
  const careerLines = Array.from({ length: Math.max(4, careerLineList.length) }, (_, i) => careerLineList[i] ?? '');

  // ภาษาอังกฤษมีช่องประจำ · ภาษาอื่นอยู่ในตาราง — สองส่วนนี้เก็บรวมในอาร์เรย์เดียว (`languages`) ลงคอลัมน์เดียว
  // ⛔ แถวอังกฤษแถวแรกคือแถวที่ช่องประจำแก้ · แถวอังกฤษอื่น (ถ้ามีจากหน้าโปรไฟล์) ถูกเก็บไว้ ไม่ทิ้ง
  const englishRows = languages.filter(isEnglishRow);
  const otherLanguages = languages.filter((r) => !isEnglishRow(r));
  const englishRow: Row = englishRows[0] ?? {};
  const setEnglish = (key: string, value: string) => {
    setNone('language', false);
    const edited = { ...englishRow, language: ENGLISH, [key]: value };
    setLanguages([edited, ...englishRows.slice(1), ...otherLanguages]);
  };

  // ร่างที่กรอกค้าง (utils/coop03Draft.ts — ข้อมูลอ่อนไหวไม่ลงที่เก็บของเบราว์เซอร์)
  const auth = useContext(AuthContext);
  const userId = auth?.user?.userId ?? null;
  const serverSnapshot = useRef('');
  const [restoredDraft, setRestoredDraft] = useState(false);

  // เก็บร่างทุกครั้งที่ฟอร์มเปลี่ยนหลังโหลดเสร็จ · เท่ากับค่าในเซิร์ฟเวอร์ = ไม่มีร่างค้าง ล้างทิ้ง
  useEffect(() => {
    if (loading || !userId) return;
    const current = { form, family, education, training, activities, languages, noneSections };
    if (JSON.stringify(current) === serverSnapshot.current) clearCoop03Draft(userId);
    else saveCoop03Draft(userId, current);
  }, [loading, userId, form, family, education, training, activities, languages, noneSections]);

  const discardDraft = () => {
    if (userId) clearCoop03Draft(userId);
    setRestoredDraft(false);
    void load();
  };

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
      const [appResult, profileResult] = await Promise.allSettled([
        api.get('/students/coop-application'),
        api.get('/profile/me'),
      ]);

      if (profileResult.status === 'fulfilled' && profileResult.value?.profile) {
        setStudentProfile(profileResult.value.profile);
      }

      if (appResult.status === 'rejected') {
        throw appResult.reason;
      }

      const data: CoopApplication = appResult.value;
      setServer(data);
      const serverForm = {
        ...BLANK,
        first_name_en: data.first_name_en || '',
        last_name_en: data.last_name_en || '',
        gender: data.gender || '',
        nationality: data.nationality || '',
        // ยังไม่เคยกรอกมือถือ → เติมจากเบอร์ในโปรไฟล์ให้ (นักศึกษาส่วนใหญ่มีเบอร์เดียว)
        mobile_phone: data.mobile_phone || data.phone || '',
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
      };
      const serverFamily = data.family_info || {};
      const serverEducation = data.education_history || [];
      const serverTraining = data.training_history || [];
      const serverActivities = data.activity_history || [];
      const serverLanguages = data.language_proficiency || [];
      const serverNone = data.none_sections || [];
      // เทียบร่างกับค่าจากเซิร์ฟเวอร์ — ต่างกัน = มีของที่กรอกค้างไว้ → กู้คืนทับ (เจ้าของแจ้งว่าสลับเมนูแล้วหาย)
      serverSnapshot.current = JSON.stringify({
        form: serverForm,
        family: serverFamily,
        education: serverEducation,
        training: serverTraining,
        activities: serverActivities,
        languages: serverLanguages,
        noneSections: serverNone,
      });
      const draft = userId ? loadCoop03Draft(userId) : null;
      const draftApplies =
        !!draft &&
        JSON.stringify({ ...draft, noneSections: draft.noneSections ?? [], form: { ...serverForm, ...draft.form } }) !==
          serverSnapshot.current;
      setForm(draftApplies && draft ? { ...serverForm, ...draft.form } : serverForm);
      setFamily(draftApplies && draft ? (draft.family as FamilyInfo) : serverFamily);
      setEducation(draftApplies && draft ? (draft.education as Row[]) : serverEducation);
      setTraining(draftApplies && draft ? (draft.training as Row[]) : serverTraining);
      setActivities(draftApplies && draft ? (draft.activities as Row[]) : serverActivities);
      setLanguages(draftApplies && draft ? (draft.languages as Row[]) : serverLanguages);
      setNoneSections(draftApplies && draft ? (draft.noneSections ?? []) : serverNone);
      setRestoredDraft(draftApplies);
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
    load();
    // โหลดครั้งเดียวตอน mount — `load` เปลี่ยนตัวทุก render (อ่าน userId) การใส่ใน deps จะโหลดซ้ำไม่จบ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (key: keyof typeof BLANK, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // ความสัมพันธ์ผู้ติดต่อฉุกเฉิน: อยู่ในรายการ → เลือกตรง ๆ · ไม่อยู่ (พิมพ์เองจากเวอร์ชันก่อน หรือกด "อื่น ๆ") → ช่องระบุเอง
  const relationSelectValue = relationOther
    ? RELATION_OTHER
    : !form.emergency_relationship
      ? ''
      : RELATION_OPTIONS.includes(form.emergency_relationship)
        ? form.emergency_relationship
        : RELATION_OTHER;

  const wantsSensitive = Boolean(form.ethnicity.trim() || form.religion.trim());
  const blockedBySensitiveConsent = wantsSensitive && !consented && !consent;

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await api.put('/students/coop-application', {
        ...form,
        // ตัดข้อว่างออกก่อนส่ง — ไม่งั้นบรรทัดว่างหัวข้อความถูกเซิร์ฟเวอร์ trim แล้วเลขข้อเลื่อน
        career_objective: careerLineList.map((l) => l.trim()).filter(Boolean).join('\n'),
        sensitive_data_consent: consent,
        family_info: family,
        education_history: education,
        training_history: training,
        activity_history: activities,
        // แถวอังกฤษที่เลือกแล้วเลือกกลับเป็น "ไม่ระบุ" จะเหลือแค่ชื่อภาษา — ไม่ส่ง ไม่งั้นนับเป็นแถวข้อมูลทั้งที่ไม่มีระดับ
        language_proficiency: languages.filter(
          (r) => !isEnglishRow(r) || r.level || LANGUAGE_SKILLS.some((s) => r[s.key])
        ),
        none_sections: noneSections,
      });
      setSuccess(res.message || 'บันทึกเรียบร้อยแล้ว');
      setConsent(false);
      // บันทึกสำเร็จ = ร่างหมดหน้าที่ — ล้างก่อนโหลดซ้ำ ไม่งั้น load() จะหยิบร่างเก่ามาทับค่าที่เพิ่งบันทึก
      if (userId) clearCoop03Draft(userId);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลได้'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSkeleton variant="form" />;

  // โหลดพัง ≠ ใบว่าง — ถ้าปล่อยฟอร์มเปล่าออกมา กดบันทึกครั้งเดียวจะเขียนค่าว่างทับทั้งใบ
  // (backend ไม่มี COALESCE ให้ช่องข้อความ) · `server` มีค่าเมื่อเคยโหลดสำเร็จอย่างน้อยหนึ่งครั้ง
  if (error && !server) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <AlertBanner variant="error" message={error} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 page-enter">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          ใบสมัครงานสหกิจศึกษา (สหกิจ 03)
        </h1>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          ข้อมูลชุดนี้จะถูกใช้จัดทำใบสมัครงานที่<strong>ส่งคณะ</strong>เพื่อประกอบการออกหนังสือส่งตัว
          ส่วนที่ระบบรู้อยู่แล้ว (ชื่อไทย · รหัสนักศึกษา · สาขา · เกรด) ดึงจากโปรไฟล์ให้อัตโนมัติ ·
          ต้องกรอกช่องบังคับให้ครบและส่งแบบแจ้งที่พัก (สหกิจ 06) ก่อน คณะจึงจะออกหนังสือส่งตัวให้
        </p>
      </div>

      {restoredDraft && (
        <AlertBanner
          variant="info"
          message={
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                กู้คืนข้อมูลที่กรอกค้างไว้แล้ว (ยังไม่ได้บันทึกเข้าระบบ) · เลขบัตร เชื้อชาติ ศาสนา
                เก็บไว้ชั่วคราวเฉพาะระหว่างที่แท็บนี้เปิดอยู่ ถ้ารีเฟรชหน้าต้องกรอกสามช่องนี้ใหม่
              </span>
              <button
                type="button"
                data-testid="ca-discard-draft"
                onClick={discardDraft}
                className="shrink-0 cursor-pointer text-xs font-bold underline hover:no-underline"
              >
                ทิ้งฉบับร่าง แล้วโหลดข้อมูลเดิม
              </button>
            </div>
          }
        />
      )}

      {/* กล่องสรุปช่องบังคับ */}
      {server && (
        <div
          data-testid="ca-required-summary"
          className={`rounded-xl border p-4 text-xs ${
            (server.missing_required?.length ?? 0) === 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          }`}
        >
          {(server.missing_required?.length ?? 0) === 0 ? (
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">
              ช่องบังคับครบแล้ว
            </p>
          ) : (
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">
                ยังขาด {server.missing_required!.length} ช่อง:
              </p>
              <p className="mt-1">
                {server.missing_required!.map((key) => COOP03_FIELD_LABELS[key] || key).join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}

      <AlertBanner variant="error" message={error} scrollOnShow />
      <AlertBanner variant="success" message={success} scrollOnShow />

      {/* ── ตัวตน ───────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          ข้อมูลส่วนตัว
        </h3>

        <div className="mb-4 rounded-xl bg-gray-50 p-4 text-xs text-gray-600 dark:bg-gray-800/40 dark:text-gray-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-gray-800 dark:text-gray-200">
              {[server?.first_name, server?.last_name].filter(Boolean).join(' ') || '-'}
            </span>
            <span>·</span>
            <span>รหัส {server?.student_code || '-'}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-900/50">
              ห้องเรียน: {studentProfile?.section || 'ยังไม่ได้ระบุ'}
            </span>
          </div>
          <span className="mt-1.5 block text-gray-500 dark:text-gray-400">
            แก้ชื่อไทย รหัสนักศึกษา และห้องเรียนได้ที่หน้า{' '}
            <a href="/dashboard?menu=profile" className="text-brand-blue hover:underline font-medium">
              “ข้อมูลส่วนตัว &amp; เรซูเม่”
            </a>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="ca-first-en" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              ชื่อ (ภาษาอังกฤษ) <span className="text-red-600 dark:text-red-400">*</span>
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
              นามสกุล (ภาษาอังกฤษ) <span className="text-red-600 dark:text-red-400">*</span>
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
              เพศ <span className="text-red-600 dark:text-red-400">*</span>
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
              สัญชาติ <span className="text-red-600 dark:text-red-400">*</span>
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
          {/* เบอร์ที่ติดต่อได้ช่องเดียว — เดิมมี "โทรศัพท์ (จากโปรไฟล์)" อ่านอย่างเดียวคู่กับ "โทรศัพท์มือถือ" ซึ่งนักศึกษาส่วนใหญ่มีเบอร์เดียว
              เลยเห็นเบอร์เดียวกันสองช่อง · ฐานข้อมูลและ PDF ยังมีสองช่องตามกระดาษ (เซิร์ฟเวอร์นับ "มือถือหรือเบอร์ในโปรไฟล์อย่างใดอย่างหนึ่ง") */}
          <div>
            <label htmlFor="ca-mobile" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              เบอร์โทรศัพท์ที่ติดต่อได้ (มือถือ){' '}
              {!server?.phone?.trim() && <span className="text-red-600 dark:text-red-400">*</span>}
            </label>
            <Input
              id="ca-mobile"
              data-testid="ca-mobile"
              value={form.mobile_phone}
              onChange={(e) => set('mobile_phone', e.target.value)}
              placeholder="089-123-4567"
            />
            <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
              {server?.phone?.trim()
                ? `เติมจากเบอร์ในโปรไฟล์ให้แล้ว (${server.phone}) แก้ได้ — ถ้าเป็นเบอร์เดียวกัน ใบพิมพ์จะแสดงเบอร์นี้ครั้งเดียว`
                : 'ต้องมีอย่างน้อย 1 เบอร์ที่ติดต่อได้'}
            </p>
          </div>
          <div>
            <label htmlFor="ca-fax" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              โทรสาร <span className="font-normal text-gray-600 dark:text-gray-400">(ถ้ามี)</span>
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
              ชื่อ-นามสกุล <span className="text-red-600 dark:text-red-400">*</span>
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
              ความสัมพันธ์ <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            {/* เลือกจากรายการ — ค่าที่เก็บคือข้อความไทยตรง ๆ (เหมือนที่เคยพิมพ์) เซิร์ฟเวอร์และ PDF ไม่ต้องแก้
                ค่าเดิมที่พิมพ์เองไม่อยู่ในรายการ → โชว์เป็น "อื่น ๆ" พร้อมข้อความเดิม ไม่หาย */}
            <Select
              id="ca-emg-relation"
              data-testid="ca-emg-relation"
              value={relationSelectValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === RELATION_OTHER) {
                  setRelationOther(true);
                  if (RELATION_OPTIONS.includes(form.emergency_relationship)) set('emergency_relationship', '');
                } else {
                  setRelationOther(false);
                  set('emergency_relationship', v);
                }
              }}
            >
              <option value="">-- เลือก --</option>
              {RELATION_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
              <option value={RELATION_OTHER}>อื่น ๆ (ระบุเอง)</option>
            </Select>
            {relationSelectValue === RELATION_OTHER && (
              <Input
                id="ca-emg-relation-other"
                data-testid="ca-emg-relation-other"
                aria-label="ระบุความสัมพันธ์"
                className="mt-2"
                value={form.emergency_relationship}
                maxLength={50}
                onChange={(e) => set('emergency_relationship', e.target.value)}
                placeholder="เช่น ลูกพี่ลูกน้อง · เพื่อนสนิท"
              />
            )}
          </div>
          <div>
            <label htmlFor="ca-emg-phone" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              เบอร์โทรศัพท์ <span className="text-red-600 dark:text-red-400">*</span>
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
              {/* red-700 ในการ์ดนี้ — พื้นเหลืองอ่อนทำให้ red-600 ได้ 4.44:1 ต่ำกว่าเกณฑ์ 4.5 */}
              เลขประจำตัวประชาชน (13 หลัก) <span className="text-red-700 dark:text-red-400">*</span>
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
              บัตรออกให้ ณ เขต/อำเภอ <span className="text-red-700 dark:text-red-400">*</span>
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
              วันหมดอายุบัตร <span className="text-red-700 dark:text-red-400">*</span>
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
              {(
                [
                  ['name', 'ชื่อ-นามสกุล'],
                  ['age', 'อายุ (ปี)'],
                  ['occupation', 'อาชีพ'],
                  ['phone', 'โทรศัพท์'],
                ] as const
              ).map(([field, fieldLabel]) => (
                <div key={field}>
                  <label
                    htmlFor={`ca-${who}-${field}`}
                    className="mb-1 block text-[11px] font-medium text-gray-700 dark:text-gray-300"
                  >
                    {fieldLabel}
                  </label>
                  <Input
                    id={`ca-${who}-${field}`}
                    data-testid={`ca-${who}-${field}`}
                    type={field === 'age' ? 'number' : undefined}
                    min={field === 'age' ? 0 : undefined}
                    value={family[who]?.[field] || ''}
                    onChange={(e) =>
                      setFamily((f) => ({ ...f, [who]: { ...(f[who] || {}), [field]: e.target.value } }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ca-sibling-count" className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
              จำนวนพี่น้อง (คน · รวมตัวเอง)
            </label>
            <Input
              id="ca-sibling-count"
              data-testid="ca-sibling-count"
              type="number"
              min={1}
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
              type="number"
              min={1}
              value={family.birth_order || ''}
              onChange={(e) => setFamily((f) => ({ ...f, birth_order: e.target.value }))}
            />
          </div>
        </div>

        <RowTable
          testid="siblings"
          label="รายละเอียดพี่น้อง (ชื่อ-นามสกุล · อายุ · อาชีพ)"
          addLabel="+ เพิ่มพี่น้อง"
          emptyText="ยังไม่มีข้อมูล — กด เพิ่มพี่น้อง เพื่อกรอกชื่อ-นามสกุล อายุ และอาชีพของพี่น้องแต่ละคน (ไม่บังคับ)"
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
            addLabel="+ เพิ่มระดับการศึกษา"
            columns={EDUCATION_COLS}
            rows={education}
            onChange={setEducation}
            none={noneSections.includes('education')}
            onNoneChange={(v) => setNone('education', v)}
          />
          <RowTable
            testid="training"
            label="ประวัติการฝึกอบรม / ปฏิบัติงาน"
            columns={TRAINING_COLS}
            rows={training}
            onChange={setTraining}
            none={noneSections.includes('training')}
            onNoneChange={(v) => setNone('training', v)}
          />
          <RowTable
            testid="activity"
            label="กิจกรรมนอกหลักสูตร"
            addLabel="+ เพิ่มกิจกรรม"
            columns={ACTIVITY_COLS}
            rows={activities}
            onChange={setActivities}
            none={noneSections.includes('activity')}
            onNoneChange={(v) => setNone('activity', v)}
          />
          <RowTable
            testid="language"
            label='ความสามารถพิเศษทางภาษา (ใช้ร่วมกับหน้า "ข้อมูลส่วนตัว & เรซูเม่")'
            addLabel="+ เพิ่มภาษาอื่น"
            columns={OTHER_LANGUAGE_COLS}
            rows={otherLanguages}
            onChange={(next) => setLanguages([...englishRows, ...next])}
            none={noneSections.includes('language')}
            onNoneChange={(v) => setNone('language', v)}
            leadHasContent={englishRows.some((r) => LANGUAGE_SKILLS.some((s) => r[s.key]) || r.level)}
            emptyText='ยังไม่มีภาษาอื่น — กด เพิ่มภาษาอื่น เพื่อระบุ (ภาษาอังกฤษกรอกในช่องด้านบน) หรือติ๊ก "ไม่มีข้อมูลในหมวดนี้" (บังคับอย่างใดอย่างหนึ่ง)'
            lead={
              <div
                data-testid="ca-language-en"
                className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-800/30"
              >
                <p className="mb-2 text-xs font-bold text-gray-800 dark:text-gray-200">{ENGLISH}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {LANGUAGE_SKILLS.map((s) => (
                    <div key={s.key}>
                      <label
                        htmlFor={`ca-language-en-${s.key}`}
                        className="mb-1 block text-[11px] font-medium text-gray-700 dark:text-gray-300"
                      >
                        {s.label}
                      </label>
                      <Select
                        id={`ca-language-en-${s.key}`}
                        size="sm"
                        data-testid={`ca-language-en-${s.key}`}
                        value={englishRow[s.key] || ''}
                        onChange={(e) => setEnglish(s.key, e.target.value)}
                      >
                        <option value="">-- ไม่ระบุ --</option>
                        {LANGUAGE_LEVELS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            }
          />

          <div>
            <p className="mb-1 text-xs font-bold text-gray-700 dark:text-gray-300">จุดมุ่งหมายในอาชีพ</p>
            <p className="mb-2 text-[11px] text-gray-600 dark:text-gray-400">
              ระบุสายงานและลักษณะงานที่สนใจ ข้อละหนึ่งเรื่อง (ไม่บังคับ)
            </p>
            <div className="space-y-2">
              {careerLines.map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs font-bold text-gray-600 dark:text-gray-400">{i + 1}.</span>
                  <Input
                    size="sm"
                    data-testid={`ca-career-${i}`}
                    aria-label={`จุดมุ่งหมายในอาชีพ ข้อ ${i + 1}`}
                    maxLength={200}
                    value={line}
                    onChange={(e) => {
                      const next = [...careerLines];
                      next[i] = e.target.value.replace(/\r?\n/g, ' ');
                      set('career_objective', next.join('\n'));
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
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
