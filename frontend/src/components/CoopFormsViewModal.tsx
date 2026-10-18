import React, { useEffect, useState } from 'react';
import api, { API_BASE_URL } from '../services/api';
import FileViewButton from './FileViewButton';
import Modal, { ModalBody, ModalFooter } from './ui/Modal';
import Button from './ui/Button';
import AlertBanner from './ui/AlertBanner';
import { getErrorMessage } from '../utils/errors';
import { formatThaiDate } from '../utils/thaiDate';

/**
 * ดูรายละเอียด สหกิจ 03 (ใบสมัครงาน) และ สหกิจ 06 (แบบแจ้งที่พัก) ของนักศึกษาหนึ่งคน
 * สำหรับเจ้าหน้าที่ (ก่อนออกหนังสือส่งตัว) และอาจารย์นิเทศ (ก่อนเดินทางไปนิเทศ) — อ่านอย่างเดียว
 *
 * ⛔ สิทธิ์ตัดสินที่เซิร์ฟเวอร์ (`assertCanReviewStudentWork`) — 403 ขึ้นเป็นข้อความในแท็บ ไม่ใช่หน้าว่าง
 * ⛔ แท็บ 03 มีเลขบัตร/เชื้อชาติ/ศาสนาค่าจริง และ **ทุกครั้งที่เปิดแท็บนี้ถูกบันทึกลง audit_log**
 *    จึงโหลดเมื่อกดแท็บเท่านั้น (ไม่โหลดล่วงหน้า) และจำผลไว้ ไม่ยิงซ้ำตอนสลับแท็บไปมา
 */

type Row = Record<string, string>;

interface FamilyInfo {
  father?: Row;
  mother?: Row;
  sibling_count?: string;
  birth_order?: string;
  siblings?: Row[];
}

interface Coop03View {
  company_name: string | null;
  start_date: string | null;
  end_date: string | null;
  first_name: string | null;
  last_name: string | null;
  first_name_en: string | null;
  last_name_en: string | null;
  student_code: string | null;
  major_name_th: string | null;
  year_level: number | null;
  advisor_name: string | null;
  cumulative_gpa: string | null;
  national_id: string | null;
  national_id_issued_district: string | null;
  national_id_expiry_date: string | null;
  birth_date: string | null;
  gender: string | null;
  ethnicity: string | null;
  nationality: string | null;
  religion: string | null;
  current_address: string | null;
  phone: string | null;
  mobile_phone: string | null;
  fax: string | null;
  alt_email: string | null;
  emergency_contact_name: string | null;
  emergency_relationship: string | null;
  emergency_address: string | null;
  emergency_phone: string | null;
  family_info: FamilyInfo | null;
  career_objective: string | null;
  interested_job_types: string[] | null;
  activity_history: Row[] | null;
  language_proficiency: Row[] | null;
  education_history: Row[] | null;
  training_history: Row[] | null;
  none_sections: string[];
  missing_required: string[];
  /** `resumes/<ชื่อไฟล์>` — เรซูเม่ที่นักศึกษาอัปโหลด (บังคับมีก่อนยื่นคำร้อง) */
  resume_file: string | null;
}

interface Coop06View {
  section: string | null;
  accommodation: {
    formatted_address?: string | null;
    phone?: string | null;
    mobile_phone?: string | null;
    fax?: string | null;
    email?: string | null;
    latitude?: string | number | null;
    longitude?: string | number | null;
  } | null;
  company_job_info: {
    company_name?: string | null;
    mentor_name?: string | null;
    mentor_position?: string | null;
    mentor_phone?: string | null;
  } | null;
  emergency_contact: {
    name?: string | null;
    relationship?: string | null;
    phone?: string | null;
    address?: string | null;
  };
}

// คีย์ตรงกับ `utils/coop03Required.ts` — ชื่อช่องเดียวกับที่นักศึกษาเห็นในหน้ากรอก
const MISSING_LABELS: Record<string, string> = {
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
  education: 'ประวัติการศึกษา',
  training: 'ประวัติการฝึกอบรม/ปฏิบัติงาน',
  activity: 'กิจกรรมที่เคยเข้าร่วม',
  language: 'ความสามารถทางภาษา',
};

const EDUCATION_COLS = [
  { key: 'level', label: 'ระดับ' },
  { key: 'institution', label: 'สถานศึกษา' },
  { key: 'start_year', label: 'ปีที่เริ่ม' },
  { key: 'end_year', label: 'ปีที่จบ' },
  { key: 'degree', label: 'วุฒิ' },
  { key: 'major', label: 'สาขาวิชา' },
];
const TRAINING_COLS = [
  { key: 'period', label: 'ระยะเวลา' },
  { key: 'institution', label: 'หน่วยงาน/สถาบัน' },
  { key: 'topic', label: 'หลักสูตร/เรื่อง' },
];
const ACTIVITY_COLS = [
  { key: 'period', label: 'ระยะเวลา' },
  { key: 'position', label: 'ตำแหน่ง' },
  { key: 'duty', label: 'หน้าที่' },
];
const LANGUAGE_COLS = [
  { key: 'language', label: 'ภาษา' },
  { key: 'reading', label: 'อ่าน' },
  { key: 'speaking', label: 'พูด' },
  { key: 'writing', label: 'เขียน' },
];
const SIBLING_COLS = [
  { key: 'name', label: 'ชื่อ-นามสกุล' },
  { key: 'age', label: 'อายุ' },
  { key: 'occupation', label: 'อาชีพ' },
];

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** `1234567890123` → `1-2345-67890-12-3` */
const spaceNationalId = (id: string): string => {
  const d = id.replace(/\D/g, '');
  return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : id;
};

const dateText = (v: string | null): string => {
  const iso = text(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatThaiDate(iso) : '';
};

const Field: React.FC<{ label: string; value?: string | null; wide?: boolean }> = ({ label, value, wide }) => (
  <div className={wide ? 'sm:col-span-2' : ''}>
    <dt className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</dt>
    <dd className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-gray-100 break-words whitespace-pre-line">
      {text(value) || <span className="font-normal text-gray-500 dark:text-gray-400">ไม่ได้กรอก</span>}
    </dd>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h4 className="border-b border-gray-200 pb-1.5 text-sm font-bold text-gray-900 dark:border-gray-700 dark:text-white">
      {title}
    </h4>
    {children}
  </section>
);

const Grid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
);

/** ตารางประวัติ — ไม่มีแถว: บอกว่านักศึกษายืนยัน "ไม่มีข้อมูล" หรือยังไม่ได้กรอก (สองอย่างนี้ไม่เหมือนกัน) */
const HistoryTable: React.FC<{
  cols: { key: string; label: string }[];
  rows: Row[] | null;
  confirmedNone?: boolean;
}> = ({ cols, rows, confirmedNone }) => {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {confirmedNone ? 'นักศึกษายืนยันว่าไม่มีข้อมูลในหมวดนี้' : 'ยังไม่ได้กรอก'}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className="px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-300">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {list.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 align-top text-gray-900 dark:text-gray-100">
                  {text(r[c.key]) || '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Coop03Panel: React.FC<{ d: Coop03View }> = ({ d }) => {
  const family = d.family_info ?? {};
  const none = new Set(d.none_sections);
  const name = [d.first_name, d.last_name].filter(Boolean).join(' ');
  const nameEn = [d.first_name_en, d.last_name_en].filter(Boolean).join(' ');
  const parentText = (p?: Row): string | null =>
    [p?.name, p?.age ? `อายุ ${p.age} ปี` : '', p?.occupation, p?.phone ? `โทร ${p.phone}` : '']
      .map(text)
      .filter(Boolean)
      .join(' · ') || null;

  return (
    <div className="space-y-6" data-testid="coop-view-03">
      {d.missing_required.length > 0 ? (
        <AlertBanner
          variant="warning"
          message={
            <span data-testid="coop-view-03-missing">
              ช่องบังคับที่ยังไม่ครบ {d.missing_required.length} ช่อง:{' '}
              {d.missing_required.map((k) => MISSING_LABELS[k] ?? k).join(' · ')}
            </span>
          }
        />
      ) : (
        <AlertBanner variant="success" message={<span data-testid="coop-view-03-complete">กรอกช่องบังคับครบแล้ว</span>} />
      )}

      <Section title="ตำแหน่งที่สมัคร">
        <Grid>
          <Field label="สถานประกอบการ" value={d.company_name} wide />
          <Field
            label="ระยะเวลาปฏิบัติงาน"
            value={
              d.start_date && d.end_date
                ? `${dateText(d.start_date)} – ${dateText(d.end_date)}`
                : dateText(d.start_date)
            }
            wide
          />
        </Grid>
      </Section>

      <Section title="เรซูเม่">
        {d.resume_file ? (
          <div className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
            <span data-testid="coop-view-resume-name">{d.resume_file.split('/').pop()}</span>
            <FileViewButton
              src={`${API_BASE_URL}/files/download/resumes/${d.resume_file.split('/').pop()}`}
              title="เรซูเม่ของนักศึกษา"
              data-testid="coop-view-resume"
            />
          </div>
        ) : (
          <p data-testid="coop-view-resume-missing" className="text-sm text-gray-600 dark:text-gray-400">
            นักศึกษายังไม่ได้อัปโหลดเรซูเม่
          </p>
        )}
      </Section>

      <Section title="ข้อมูลส่วนตัว">
        <Grid>
          <Field label="ชื่อ-นามสกุล" value={name} />
          <Field label="Name & Surname" value={nameEn} />
          <Field label="รหัสนักศึกษา" value={d.student_code} />
          <Field label="สาขาวิชา" value={d.major_name_th} />
          <Field label="ชั้นปี" value={d.year_level === null ? null : String(d.year_level)} />
          <Field label="อาจารย์ที่ปรึกษา" value={d.advisor_name} />
          <Field label="เกรดเฉลี่ยรวม" value={d.cumulative_gpa} />
          <Field label="เพศ" value={d.gender} />
          <Field label="เลขประจำตัวประชาชน" value={d.national_id ? spaceNationalId(d.national_id) : null} />
          <Field label="ออกให้ ณ เขต/อำเภอ" value={d.national_id_issued_district} />
          <Field label="บัตรหมดอายุ" value={dateText(d.national_id_expiry_date)} />
          <Field label="วันเกิด" value={dateText(d.birth_date)} />
          <Field label="เชื้อชาติ" value={d.ethnicity} />
          <Field label="สัญชาติ" value={d.nationality} />
          <Field label="ศาสนา" value={d.religion} />
        </Grid>
      </Section>

      <Section title="ที่อยู่และการติดต่อ">
        <Grid>
          <Field label="ที่อยู่ปัจจุบัน" value={d.current_address} wide />
          <Field label="โทรศัพท์" value={d.phone} />
          <Field label="โทรศัพท์เคลื่อนที่" value={d.mobile_phone} />
          <Field label="โทรสาร" value={d.fax} />
          <Field label="อีเมล" value={d.alt_email} />
        </Grid>
      </Section>

      <Section title="บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน">
        <Grid>
          <Field label="ชื่อ-นามสกุล" value={d.emergency_contact_name} />
          <Field label="ความสัมพันธ์" value={d.emergency_relationship} />
          <Field label="โทรศัพท์" value={d.emergency_phone} />
          <Field label="ที่อยู่" value={d.emergency_address} wide />
        </Grid>
      </Section>

      <Section title="ข้อมูลครอบครัว">
        <Grid>
          <Field label="บิดา" value={parentText(family.father)} wide />
          <Field label="มารดา" value={parentText(family.mother)} wide />
          <Field label="จำนวนพี่น้อง" value={text(family.sibling_count) ? `${family.sibling_count} คน` : null} />
          <Field label="เป็นบุตรคนที่" value={family.birth_order} />
        </Grid>
        {Array.isArray(family.siblings) && family.siblings.length > 0 && (
          <HistoryTable cols={SIBLING_COLS} rows={family.siblings} />
        )}
      </Section>

      <Section title="จุดมุ่งหมายอาชีพและสายงานที่สนใจ">
        <Grid>
          <Field label="จุดมุ่งหมายอาชีพ" value={d.career_objective} wide />
          <Field
            label="สายงานและลักษณะงานที่สนใจ"
            value={Array.isArray(d.interested_job_types) ? d.interested_job_types.join(' · ') : null}
            wide
          />
        </Grid>
      </Section>

      <Section title="ความสามารถทางภาษา">
        <HistoryTable cols={LANGUAGE_COLS} rows={d.language_proficiency} confirmedNone={none.has('language')} />
      </Section>
      <Section title="ประวัติการศึกษา">
        <HistoryTable cols={EDUCATION_COLS} rows={d.education_history} confirmedNone={none.has('education')} />
      </Section>
      <Section title="ประวัติการฝึกอบรมและปฏิบัติงาน">
        <HistoryTable cols={TRAINING_COLS} rows={d.training_history} confirmedNone={none.has('training')} />
      </Section>
      <Section title="กิจกรรมนอกหลักสูตร">
        <HistoryTable cols={ACTIVITY_COLS} rows={d.activity_history} confirmedNone={none.has('activity')} />
      </Section>
    </div>
  );
};

const Coop06Panel: React.FC<{ d: Coop06View }> = ({ d }) => {
  const acc = d.accommodation;
  const lat = acc?.latitude;
  const lng = acc?.longitude;
  const hasPin =
    lat !== null && lat !== undefined && lng !== null && lng !== undefined &&
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const mapsLink = hasPin ? `https://maps.google.com/?q=${Number(lat)},${Number(lng)}` : null;

  if (!acc) {
    return (
      <p data-testid="coop-view-06-empty" className="py-10 text-center text-sm text-gray-600 dark:text-gray-400">
        นักศึกษายังไม่ได้ส่งแบบแจ้งที่พัก (สหกิจ 06)
      </p>
    );
  }

  return (
    <div className="space-y-6" data-testid="coop-view-06">
      <Section title="ที่พักระหว่างปฏิบัติงาน">
        <Grid>
          <Field label="ที่อยู่ที่พัก" value={acc.formatted_address} wide />
          <Field label="โทรศัพท์" value={acc.phone} />
          <Field label="โทรศัพท์เคลื่อนที่" value={acc.mobile_phone} />
          <Field label="โทรสาร" value={acc.fax} />
          <Field label="อีเมล" value={acc.email} />
          <Field label="กลุ่มเรียน (Section)" value={d.section} />
        </Grid>
        <div>
          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">ตำแหน่งที่พักบนแผนที่</span>
          <div className="mt-1">
            {mapsLink ? (
              <a
                href={mapsLink}
                target="_blank"
                rel="noreferrer"
                data-testid="coop-view-06-map"
                className="text-sm font-semibold text-brand-blue underline hover:no-underline dark:text-blue-400"
              >
                เปิดใน Google Maps ({Number(lat).toFixed(5)}, {Number(lng).toFixed(5)})
              </a>
            ) : (
              <span className="text-sm text-gray-600 dark:text-gray-400">นักศึกษายังไม่ได้ปักหมุด</span>
            )}
          </div>
        </div>
      </Section>

      <Section title="สถานประกอบการและพี่เลี้ยง">
        <Grid>
          <Field label="สถานประกอบการ" value={d.company_job_info?.company_name} wide />
          <Field label="พี่เลี้ยง" value={d.company_job_info?.mentor_name} />
          <Field label="ตำแหน่ง" value={d.company_job_info?.mentor_position} />
          <Field label="โทรศัพท์พี่เลี้ยง" value={d.company_job_info?.mentor_phone} />
        </Grid>
      </Section>

      <Section title="บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน">
        <Grid>
          <Field label="ชื่อ-นามสกุล" value={d.emergency_contact.name} />
          <Field label="ความสัมพันธ์" value={d.emergency_contact.relationship} />
          <Field label="โทรศัพท์" value={d.emergency_contact.phone} />
          <Field label="ที่อยู่" value={d.emergency_contact.address} wide />
        </Grid>
      </Section>
    </div>
  );
};

type TabKey = '03' | '06';

interface CoopFormsViewModalProps {
  studentId: number;
  studentName: string;
  studentCode?: string | null;
  initialTab?: TabKey;
  onClose: () => void;
}

export const CoopFormsViewModal: React.FC<CoopFormsViewModalProps> = ({
  studentId,
  studentName,
  studentCode,
  initialTab = '03',
  onClose,
}) => {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [form03, setForm03] = useState<Coop03View | null>(null);
  const [error03, setError03] = useState<string | null>(null);
  const [form06, setForm06] = useState<Coop06View | null>(null);
  const [error06, setError06] = useState<string | null>(null);

  // โหลดเมื่อแท็บถูกเปิดครั้งแรกเท่านั้น — แท็บ 03 ทุกครั้งที่โหลดคือหนึ่งแถว audit
  useEffect(() => {
    if (tab !== '03' || form03 || error03) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/students/${studentId}/coop-application`);
        if (!cancelled) setForm03(data);
      } catch (err) {
        if (!cancelled) setError03(getErrorMessage(err, 'ไม่สามารถโหลดสหกิจ 03 ได้'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, studentId, form03, error03]);

  useEffect(() => {
    if (tab !== '06' || form06 || error06) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/students/${studentId}/accommodation-plan`);
        if (!cancelled) setForm06(data);
      } catch (err) {
        if (!cancelled) setError06(getErrorMessage(err, 'ไม่สามารถโหลดสหกิจ 06 ได้'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, studentId, form06, error06]);

  const error = tab === '03' ? error03 : error06;
  const loaded = tab === '03' ? form03 : form06;

  return (
    <Modal
      onClose={onClose}
      size="3xl"
      data-testid="coop-forms-view"
      title={`สหกิจ 03 · 06 — ${studentName}${studentCode ? ` (${studentCode})` : ''}`}
    >
      <div role="tablist" className="flex gap-1 border-b border-gray-200 px-6 dark:border-gray-700">
        {(
          [
            ['03', 'สหกิจ 03 · ใบสมัครงาน'],
            ['06', 'สหกิจ 06 · ที่พักและแผนที่'],
          ] as [TabKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={`coop-view-tab-${key}`}
            onClick={() => setTab(key)}
            className={`min-h-11 border-b-2 px-3 text-sm transition-colors ${
              tab === key
                ? 'border-brand-blue font-bold text-brand-blue dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ModalBody>
        {tab === '03' && (
          <p className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            มีเลขบัตรประชาชน เชื้อชาติ และศาสนา — ระบบบันทึกทุกครั้งที่เปิดดูหน้านี้
          </p>
        )}
        {error ? (
          <AlertBanner variant="error" message={error} />
        ) : !loaded ? (
          <p className="py-10 text-center text-sm text-gray-600 dark:text-gray-400">กำลังโหลด...</p>
        ) : tab === '03' && form03 ? (
          <Coop03Panel d={form03} />
        ) : form06 ? (
          <Coop06Panel d={form06} />
        ) : null}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} data-testid="coop-view-close">
          ปิด
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CoopFormsViewModal;
