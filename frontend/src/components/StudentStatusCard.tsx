import React from 'react';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import Button from './ui/Button';
import type { IntentForm } from '../types/api';

/**
 * การ์ด "สิ่งที่ต้องทำตอนนี้" ของแดชบอร์ดนักศึกษา (แบบ A) — ช่วงขอที่ฝึกงาน
 *
 * ไฟล์นี้ **แค่จัดหน้า** ไม่มี state ของฟอร์ม ไม่ยิง API — กล่องส่งอีเมล ฟอร์มอัปโหลดคำร้อง
 * และฟอร์มรายงานผลยังเป็นของ `StudentDashboard` (ตัวแปรกับ handler อยู่ที่นั่น)
 * แล้วส่งเข้ามาเป็น slot · การ์ดตัดสินแค่ว่า "สถานะนี้ต้องเห็นอะไร" จึงไม่มีทางไปเขียนเงื่อนไขซ้ำ
 * กับหน้าจอ
 *
 * ⛔ เงื่อนไขเลือกสถานะอยู่ที่ `deriveStatusState` ใน `StudentDashboard.tsx` ที่เดียว — ค่าที่ใช้ตัดสินมาจากฟิลด์เดียวกับที่เซิร์ฟเวอร์ใช้
 *    (`status` · `acceptance_due_date` · `reject_reason` · `company_mail_sent_at`) ไม่คำนวณวันทำการซ้ำ
 */

export type StatusCardState =
  | 'submit-paper'
  | 'wait-staff'
  | 'wait-dean'
  | 'returned'
  | 'send'
  | 'wait-company'
  | 'add-mentor'
  | 'wait-confirm'
  | 'company-rejected'
  | 'rejected'
  | 'withdrawn';

/** ฟิลด์ที่ `GET /students/dashboard` ส่งมาแต่ `IntentForm` ยังไม่ได้ประกาศ — optional ทั้งหมด */
export type StatusIntent = Pick<IntentForm, 'status'> & Partial<Omit<IntentForm, 'status'>> & {
  /** `'link'` = บริษัทตอบผ่านลิงก์ · `'student'` = นักศึกษาอัปโหลดเอง · ยังไม่มี = null */
  acceptance_source?: 'link' | 'student' | null;
  mentor?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    position?: string | null;
    department?: string | null;
  } | null;
};

type Tone = 'act' | 'wait';

const TONE: Record<StatusCardState, Tone> = {
  'submit-paper': 'act',
  returned: 'act',
  send: 'act',
  'add-mentor': 'act',
  'company-rejected': 'act',
  rejected: 'act',
  withdrawn: 'act',
  'wait-staff': 'wait',
  'wait-dean': 'wait',
  'wait-company': 'wait',
  'wait-confirm': 'wait',
};

// ขอบสีเต็มความหมายเดียวกันทุกสถานะ: ฟ้า = ต้องทำ · เทา = รอคนอื่น
// (ได้ที่ฝึกงานแล้ว = การ์ดนี้หายไป เหลือการ์ด "ขั้นตอนที่ต้องทำตอนนี้" ของ CoopNowCard ใบเดียว)
const TONE_STYLE: Record<Tone, { box: string; label: string }> = {
  act: {
    box: 'border-blue-600 dark:border-blue-500',
    label: 'text-blue-700 dark:text-blue-400',
  },
  wait: {
    box: 'border-gray-300 dark:border-gray-600',
    label: 'text-gray-700 dark:text-gray-300',
  },
};

/** ขั้นที่ "กำลังอยู่" ในรายการ 6 ขั้น (นับจาก 0) */
const ACTIVE_STEP: Record<StatusCardState, number> = {
  'submit-paper': 0,
  'wait-staff': 1,
  'wait-dean': 2,
  send: 3,
  'wait-company': 4,
  returned: 4,
  'add-mentor': 5,
  'wait-confirm': 6,
  // เริ่มขั้น 1 ใหม่ — ใบเดิมปิดแล้ว
  'company-rejected': 0,
  rejected: 0,
  withdrawn: 0,
};

const STEPS = [
  'ยื่นคำร้อง (เอกสาร 1)',
  'เจ้าหน้าที่รับคำร้อง ออกเลขหนังสือ',
  'คณบดีลงนาม',
  'ส่งหนังสือให้บริษัท',
  'บริษัทตอบรับ',
  'ระบุพี่เลี้ยง',
  'เจ้าหน้าที่ยืนยัน',
];

function headerLabel(state: StatusCardState): string {
  const step = ACTIVE_STEP[state] + 1;
  switch (state) {
    case 'returned':
      return 'สิ่งที่ต้องทำตอนนี้ · กลับไปขั้น 5';
    case 'company-rejected':
    case 'rejected':
    case 'withdrawn':
      return 'สิ่งที่ต้องทำตอนนี้ · เริ่มขั้น 1 ใหม่';
    default:
      return TONE[state] === 'act'
        ? `สิ่งที่ต้องทำตอนนี้ · ขั้น ${step} จาก ${STEPS.length}`
        : `กำลังรอ · ขั้น ${step} จาก ${STEPS.length}`;
  }
}

const Pill: React.FC<{ tone?: 'neutral' | 'good' | 'bad'; children: ReactNode }> = ({ tone = 'neutral', children }) => (
  <span
    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
      tone === 'good'
        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
        : tone === 'bad'
          ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300'
          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    }`}
  >
    {children}
  </span>
);

const Tile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
    <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
    <div className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">{value}</div>
  </div>
);

const ReasonBox: React.FC<{ tone: 'warn' | 'plain'; children: ReactNode }> = ({ tone, children }) => (
  <div
    className={`rounded-xl px-3.5 py-3 text-sm ${
      tone === 'warn'
        ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
        : 'bg-gray-50 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
    }`}
  >
    {children}
  </div>
);

interface StudentStatusCardProps {
  state: StatusCardState;
  intent: StatusIntent;
  /** ย่อหน้านับถอยหลังกำหนดตอบกลับ (`acceptance-due`) — ส่งมาจากหน้าจอ ไม่คำนวณซ้ำในนี้ */
  dueNote: ReactNode;
  /** ไฟล์เอกสาร 2 ที่บริษัทแนบ (path ใต้ `/files/`) — ลิงก์ขึ้นเฉพาะ wait-confirm และเมื่อมีไฟล์ */
  evidenceHref: string | null;
  /** บล็อกเอกสารหมายเลข 1: พิมพ์ · อัปโหลดกระดาษที่ลงนามแล้ว · เหตุผลที่เจ้าหน้าที่ตีกลับ */
  requestForm: ReactNode;
  /** กล่องส่งอีเมล `company-mail-*` — หน้าจอเลือกแบบเปิด/พับตามสถานะเอง */
  mailBox: ReactNode;
  /** ฟอร์มระบุพี่เลี้ยง `mentor-*` — บริษัทตอบทางลิงก์ไม่ได้ระบุพี่เลี้ยงมา (add-mentor เปิดเสมอ · wait-confirm เปิดเมื่อกดแก้) */
  mentorForm: ReactNode;
  /** ปุ่ม "แก้ข้อมูลพี่เลี้ยง" ของ wait-confirm — null เมื่อแก้ไม่ได้ (นักศึกษาส่งเอกสารเอง พี่เลี้ยงมากับแบบตอบรับแล้ว) */
  mentorEditToggle: ReactNode;
  /** ฟอร์มรายงานผลของนักศึกษา `proof-*` — ต้องส่งเป็น null ถ้ายังไม่ควรเห็น */
  proofForm: ReactNode;
  proofOpen: boolean;
  onOpenProof: () => void;
  onFail: () => void;
  failBusy: boolean;
  onFindPlacement: () => void;
}

const StudentStatusCard: React.FC<StudentStatusCardProps> = ({
  state,
  intent,
  dueNote,
  evidenceHref,
  requestForm,
  mailBox,
  mentorForm,
  mentorEditToggle,
  proofForm,
  proofOpen,
  onOpenProof,
  onFail,
  failBusy,
  onFindPlacement,
}) => {
  const tone = TONE_STYLE[TONE[state]];
  const company = intent.company_name_th ?? 'สถานประกอบการ';

  // ทางสำรองของนักศึกษา — โผล่เฉพาะสามสถานะที่หนังสือถึงมือบริษัทแล้ว (ตรงกับที่ฟอร์มรายงานผลโผล่)
  const showFallback = state === 'send' || state === 'wait-company' || state === 'returned';

  const badge: ReactNode = (() => {
    switch (state) {
      case 'wait-dean':
        return intent.officer_document_no ? <Pill>เลขที่หนังสือ {intent.officer_document_no}</Pill> : null;
      case 'add-mentor':
      case 'wait-confirm':
        return intent.acceptance_source === 'link' ? (
          <Pill tone="good">บริษัทตอบรับผ่านลิงก์</Pill>
        ) : (
          <Pill>คุณส่งแบบตอบรับเอง</Pill>
        );
      case 'company-rejected':
        return <Pill tone="bad">บริษัทไม่รับ</Pill>;
      case 'rejected':
        return <Pill tone="bad">คำร้องถูกตีกลับ</Pill>;
      case 'withdrawn':
        return <Pill>ยกเลิกแล้ว</Pill>;
      default:
        return null;
    }
  })();

  const body: ReactNode = (() => {
    switch (state) {
      case 'submit-paper':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">ส่งแบบคำร้องที่ลงนามแล้ว</h2>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              พิมพ์แบบคำร้อง (เอกสาร 1) ให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาลงนามด้วยปากกา แล้วอัปโหลดไฟล์ที่สแกนกลับมาที่นี่
            </p>
            {requestForm}
          </>
        );
      case 'wait-staff':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">รอเจ้าหน้าที่รับคำร้อง</h2>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              เจ้าหน้าที่ตรวจลายเซ็นบนคำร้อง (เอกสาร 1) แล้วออกเลขหนังสือ · ไม่ต้องทำอะไรตอนนี้
              ระบบจะแจ้งทางอีเมลเมื่อผ่านขั้นนี้
            </p>
            {requestForm}
          </>
        );
      case 'wait-dean':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              เจ้าหน้าที่รับคำร้องแล้ว รอคณบดีลงนาม
            </h2>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              พอคณบดีลงนาม การ์ดนี้จะเปลี่ยนเป็นช่องให้กรอกอีเมลบริษัทแล้วส่งหนังสือได้ทันที ·
              ไม่ต้องทำอะไรและยังไม่ต้องติดต่อบริษัทตอนนี้
            </p>
          </>
        );
      case 'send':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              คณบดีลงนามหนังสือแล้ว ส่งให้บริษัทได้เลย
            </h2>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              ระบบจะส่งหนังสือขอความอนุเคราะห์ + แบบตอบรับ (เอกสาร 2) พร้อมลิงก์ให้บริษัทตอบรับออนไลน์ ถึง {company}
            </p>
            {dueNote}
            {mailBox}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              บริษัทอยากได้กระดาษ?{' '}
              <a href="#my-documents" className="font-semibold text-brand-blue underline dark:text-blue-400">
                ดาวน์โหลดเอกสารไปยื่นเอง
              </a>
            </p>
          </>
        );
      case 'wait-company':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">รอบริษัทตอบรับ</h2>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              บริษัทตอบผ่านลิงก์แล้วระบบจะแจ้งคุณทันที · ไม่ต้องทำอะไรตอนนี้
            </p>
            {dueNote}
            {mailBox}
          </>
        );
      case 'returned':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              เอกสารตอบรับยังใช้ไม่ได้ ต้องให้บริษัทส่งใหม่
            </h2>
            <ReasonBox tone="warn">
              <strong>เจ้าหน้าที่ตีกลับแบบตอบรับ</strong> — {intent.reject_reason}
            </ReasonBox>
            {dueNote}
            {mailBox}
          </>
        );
      case 'add-mentor':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              {company} ตอบรับแล้ว ระบุพี่เลี้ยงของคุณ
            </h2>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              บริษัทตอบรับทางลิงก์โดยไม่ได้ระบุพนักงานที่ปรึกษา (พี่เลี้ยง) — กรอกชื่อและอีเมลของพี่เลี้ยงที่คุณจะทำงานด้วย
              เจ้าหน้าที่ต้องเห็นข้อมูลนี้ก่อนจึงจะรับเข้าฝึกงานได้ · ระบบจะส่งลิงก์เข้าระบบให้พี่เลี้ยงหลังเจ้าหน้าที่รับเท่านั้น
            </p>
            {mentorForm}
            {evidenceHref && (
              <a
                href={evidenceHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-acceptance-evidence"
                className="text-sm font-semibold text-brand-blue underline dark:text-blue-400"
              >
                ดูเอกสาร 2 ที่บริษัทแนบ
              </a>
            )}
          </>
        );
      case 'wait-confirm': {
        const tiles = [
          intent.acceptance_signer_name && { label: 'ผู้อนุมัติ', value: intent.acceptance_signer_name },
          intent.mentor?.name && { label: 'พี่เลี้ยง', value: intent.mentor.name },
        ].filter((t): t is { label: string; value: string } => !!t);
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              บริษัทตอบรับแล้ว รอเจ้าหน้าที่ยืนยัน
            </h2>
            {tiles.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {tiles.map((t) => (
                  <Tile key={t.label} label={t.label} value={t.value} />
                ))}
              </div>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              เจ้าหน้าที่ตรวจเอกสาร 2 ที่แนบมา แล้วรับเข้าฝึกงาน · ไม่ต้องทำอะไรตอนนี้
            </p>
            {mentorEditToggle}
            {mentorForm}
            {evidenceHref && (
              <a
                href={evidenceHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="open-acceptance-evidence"
                className="text-sm font-semibold text-brand-blue underline dark:text-blue-400"
              >
                ดูเอกสาร 2 ที่บริษัทแนบ
              </a>
            )}
          </>
        );
      }
      case 'company-rejected':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              {company} ไม่รับครั้งนี้ เลือกที่ฝึกงานใหม่ได้เลย
            </h2>
            {intent.reject_reason && <ReasonBox tone="plain">เหตุผลจากบริษัท: {intent.reject_reason}</ReasonBox>}
            <div className="flex flex-wrap items-center gap-3">
              <Button data-testid="status-primary" onClick={onFindPlacement}>
                หาที่ฝึกงานใหม่
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">คำร้องเดิมปิดแล้ว ไม่ต้องยกเลิกเอง</span>
            </div>
          </>
        );
      case 'rejected':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              คำร้องไม่ผ่านการพิจารณา เลือกที่ฝึกงานใหม่ได้เลย
            </h2>
            {intent.reject_reason && <ReasonBox tone="plain">เหตุผล: {intent.reject_reason}</ReasonBox>}
            <div className="flex flex-wrap items-center gap-3">
              <Button data-testid="status-primary" onClick={onFindPlacement}>
                หาที่ฝึกงานใหม่
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">คำร้องเดิมปิดแล้ว ไม่ต้องยกเลิกเอง</span>
            </div>
          </>
        );
      case 'withdrawn':
        return (
          <>
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              คุณยกเลิกคำร้องนี้เอง ยื่นที่ใหม่ได้เลย
            </h2>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              คำร้องถึง {company} ถูกยกเลิกแล้ว · กระดาษที่พิมพ์หรือลงนามไว้ของใบนี้ใช้ต่อไม่ได้ ต้องพิมพ์ใบใหม่หลังยื่น
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button data-testid="status-primary" onClick={onFindPlacement}>
                ยื่นคำร้องใหม่
              </Button>
            </div>
          </>
        );
    }
  })();

  return (
    <section
      data-testid="status-card"
      data-state={state}
      className={`flex flex-col gap-3.5 rounded-2xl border-2 bg-white p-6 shadow-sm dark:bg-gray-900 md:p-7 ${tone.box}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-sm font-semibold ${tone.label}`}>{headerLabel(state)}</span>
        {badge}
      </div>

      {body}

      {showFallback && (
        <div className="flex flex-col gap-2.5 border-t border-gray-200 pt-3.5 dark:border-gray-700">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">เกิดอย่างอื่นขึ้น?</div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              data-testid="proof-open"
              aria-expanded={proofOpen}
              onClick={onOpenProof}
              className="flex flex-col gap-0.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-left transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-white">บริษัทคืนเอกสารตอบรับมาที่ฉัน</span>
              <span className="text-xs text-gray-600 dark:text-gray-400">กรอกพี่เลี้ยง + แนบเอกสาร 2 แทนบริษัท</span>
            </button>
            <button
              type="button"
              data-testid="fail-open"
              disabled={failBusy}
              onClick={onFail}
              className="flex flex-col gap-0.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-left transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              <span className="text-sm font-semibold text-gray-900 dark:text-white">สัมภาษณ์ไม่ผ่าน / บริษัทไม่รับ</span>
              <span className="text-xs text-gray-600 dark:text-gray-400">ปลดล็อกเพื่อเลือกบริษัทใหม่</span>
            </button>
          </div>
          {proofOpen && proofForm}
        </div>
      )}
    </section>
  );
};

/** รายการ "ความคืบหน้าการขอที่ฝึกงาน" 7 ขั้น — ขั้นที่ทำแล้ว ✓ · ขั้นปัจจุบัน ● · ที่เหลือ ○ */
export const RequestProgress: React.FC<{ state: StatusCardState }> = ({ state }) => {
  const active = ACTIVE_STEP[state];
  return (
    <section
      data-testid="request-progress"
      className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">ความคืบหน้าการขอที่ฝึกงาน</h3>
      <ol className="flex flex-col gap-2.5 text-sm">
        {STEPS.map((label, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li
              key={label}
              aria-current={current ? 'step' : undefined}
              className={`flex items-center gap-2.5 ${
                current
                  ? 'font-semibold text-brand-navy dark:text-blue-300'
                  : done
                    ? 'text-gray-600 dark:text-gray-400'
                    : 'text-gray-600 dark:text-gray-500'
              }`}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                {done ? (
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
                ) : current ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-blue" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                )}
              </span>
              {label}
              <span className="sr-only">{done ? ' (เสร็จแล้ว)' : current ? ' (ขั้นปัจจุบัน)' : ' (ยังไม่ถึง)'}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default StudentStatusCard;
