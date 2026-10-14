import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';
import RequestQueue, { type QueueKind } from './RequestQueue';

/**
 * E0 · หน้าแรกของเจ้าหน้าที่ — แบบ ข “แถวเดียว 5 ช่อง รวมงานที่รอคุณไว้ในช่องเดียวกัน” (2026-10-10)
 *
 * ⛔ ตัวเลขทุกตัวมาจากเซิร์ฟเวอร์ — `GET /api/staff/home`
 * ⛔ หน้าจอไม่ตัดสินฤดูกาลเอง และไม่เทียบวันเอง
 */

type Season =
  | 'overdue'
  | 'request'
  | 'acceptance'
  | 'supervision'
  | 'evaluation'
  | 'idle';

type TileKind = 'request' | 'acceptance' | 'dispatch' | 'appointment';

interface Tile {
  count: number;
  overdue: number;
  note: string | null;
  oldest_days: number | null;
  next_date: string | null;
}

interface StaffHomePayload {
  today: string;
  semester: { semester_id: number; label: string; is_active: boolean } | null;
  season: Season;
  other_semesters: {
    semester_id: number;
    label: string;
    closed: boolean;
    open_forms: number;
    on_placement: number;
    evaluations_missing: number;
  }[];
  cohort_total: number | null;
  cohort_steps: {
    filed: number;
    awaiting_dean: number;
    letter_signed: number;
    company_accepted: number;
    dispatch_issued: number;
  } | null;
  season_detail: {
    deadline: string | null;
    days_left: number | null;
  };
  missing_cover_letters: {
    form_id: number;
    student_code: string;
    student_name: string | null;
    company_name: string;
    document_no: string | null;
  }[];
  tiles: Record<TileKind, Tile>;
  work_total: number;
  calendar_warnings: { activity_key: string | null; label: string }[];
}

type Dest = Record<string, string>;

interface CohortBoxDef {
  key: keyof NonNullable<StaffHomePayload['cohort_steps']>;
  label: string;
  queue: QueueKind | null;
  badgeField: TileKind | null;
  badgePrefix: string | null;
}

const COHORT_BOXES: CohortBoxDef[] = [
  {
    key: 'filed',
    label: 'ยื่นคำร้องมาแล้ว',
    queue: 'request',
    badgeField: 'request',
    badgePrefix: 'รอคุณรับ',
  },
  {
    key: 'awaiting_dean',
    label: 'รอคณบดีลงนาม',
    queue: null,
    badgeField: null,
    badgePrefix: null,
  },
  {
    key: 'letter_signed',
    label: 'ส่งหนังสือให้นักศึกษาแล้ว',
    queue: null,
    badgeField: null,
    badgePrefix: null,
  },
  {
    key: 'company_accepted',
    label: 'บริษัทตอบรับแล้ว',
    queue: 'acceptance',
    badgeField: 'acceptance',
    badgePrefix: 'รอคุณตรวจ',
  },
  {
    key: 'dispatch_issued',
    label: 'ออกหนังสือส่งตัวแล้ว',
    queue: 'dispatch',
    badgeField: 'dispatch',
    badgePrefix: 'รอออก',
  },
];

const isQueueKind = (v: string | null): v is QueueKind =>
  v === 'request' || v === 'acceptance' || v === 'dispatch';

const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function weekdayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `วัน${THAI_WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}ที่ ${formatThaiDate(iso)}`;
}

export const StaffHome: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queueParam = searchParams.get('queue');
  const [home, setHome] = useState<StaffHomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reissuingForm, setReissuingForm] = useState<number | null>(null);

  const loadHome = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const data = await api.get('/staff/home');
      setHome(data);
    } catch (err) {
      if (!isBackground) setError(getErrorMessage(err, 'ไม่สามารถโหลดคิวงานวันนี้ได้'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHome();
  }, [loadHome]);

  const go = (dest: Dest) => {
    const next = new URLSearchParams();
    Object.entries(dest).forEach(([k, v]) => next.set(k, v));
    navigate({ pathname: '/dashboard', search: next.toString() });
  };

  /** รับคำร้องแล้วแต่หนังสือไม่ออก — สั่งสร้างอีกครั้ง (เซิร์ฟเวอร์ปฏิเสธถ้ามีหนังสืออยู่แล้ว) */
  const reissueCoverLetter = async (formId: number, studentCode: string) => {
    setReissuingForm(formId);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/intents/${formId}/cover-letter/reissue`);
      setSuccess(`สร้างหนังสือขอความอนุเคราะห์ของ ${studentCode} แล้ว · รอคณบดีลงนาม`);
    } catch (err) {
      setError(getErrorMessage(err, 'สร้างหนังสือไม่สำเร็จ'));
    } finally {
      setReissuingForm(null);
      await loadHome(true);
    }
  };

  if (loading) return <PageSkeleton variant="stats" />;

  if (!home) {
    return (
      <div className="space-y-4 page-enter">
        <AlertBanner
          variant="error"
          message={error || 'ไม่สามารถโหลดคิวงานวันนี้ได้ กรุณาลองใหม่อีกครั้ง'}
        />
      </div>
    );
  }

  const { tiles, calendar_warnings: warnings } = home;
  // หัวหน้านับเฉพาะสามคิวที่หน้านี้แสดง (ร่างนัดนิเทศไม่อยู่บนหน้าแรกแล้ว — `work_total` ของเซิร์ฟเวอร์ยังรวมอยู่ จึงไม่ใช้)
  const shownWork = tiles.request.count + tiles.acceptance.count + tiles.dispatch.count;
  const overdueWork = tiles.request.overdue + tiles.acceptance.overdue;

  const activeQueue: QueueKind | null = isQueueKind(queueParam)
    ? queueParam
    : tiles.request.count > 0
      ? 'request'
      : tiles.acceptance.count > 0
        ? 'acceptance'
        : tiles.dispatch.count > 0
          ? 'dispatch'
          : null;

  return (
    <div className="space-y-4 page-enter">
      {/* ── 1. Heading line (semester · date · "งานที่รอคุณ N เรื่อง") — keep, one line ── */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-brand-blue dark:text-blue-400">
            {home.semester ? home.semester.label : 'ยังไม่ได้เปิดภาคเรียน'} · {weekdayDate(home.today)}
          </span>
          <span className="text-sm text-gray-400 dark:text-gray-500">·</span>
          <h1 className="inline text-base sm:text-lg font-extrabold text-gray-900 dark:text-white">
            {shownWork > 0 ? `งานที่รอคุณ ${shownWork} เรื่อง` : 'ตอนนี้ไม่มีงานรอคุณ'}
          </h1>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* ── 2. Warning rows that appear ONLY when there is a problem ── */}
      {/* 2a. รับคำร้องแล้วแต่ไม่มีหนังสือเข้าคิวคณบดี */}
      {home.missing_cover_letters.length > 0 && (
        <section data-testid="staff-home-missing-letters" className="space-y-2">
          {home.missing_cover_letters.map((m) => (
            <div
              key={m.form_id}
              data-testid={`staff-home-missing-letter-${m.form_id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/40"
            >
              <div className="min-w-0 flex-[1_1_280px]">
                <p className="text-[15px] font-bold text-red-900 dark:text-red-200">
                  รับคำร้องแล้ว แต่ยังไม่มีหนังสือเข้าคิวคณบดี
                </p>
                <p className="text-sm text-red-900 dark:text-red-200">
                  {[m.student_name, m.student_code].filter(Boolean).join(' · ')} · {m.company_name}
                  {m.document_no ? ` · เลขที่ ${m.document_no}` : ''}
                </p>
              </div>
              <Button
                variant="danger"
                className="min-h-11 bg-red-700 hover:bg-red-800"
                loading={reissuingForm === m.form_id}
                disabled={reissuingForm !== null}
                data-testid={`staff-home-reissue-${m.form_id}`}
                onClick={() => reissueCoverLetter(m.form_id, m.student_code)}
              >
                สร้างหนังสืออีกครั้ง
              </Button>
            </div>
          ))}
        </section>
      )}

      {/* 2b. ภาคก่อนที่ยังมีเรื่องค้าง */}
      {home.other_semesters.length > 0 && (
        <section
          data-testid="staff-home-other-semesters"
          className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">ภาคก่อนที่ยังมีเรื่องค้าง</h2>
          <p className="mb-2 mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            ภาคที่หยุดรับหรือปิดไปแล้วแต่ยังมีนักศึกษาที่ต้องตาม — ยังไม่ถูกย้ายหรือเปลี่ยนสถานะ
          </p>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {home.other_semesters.map((s) => (
              <li
                key={s.semester_id}
                data-testid={`staff-home-other-semester-${s.semester_id}`}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <span className="block text-[13px] font-bold text-gray-900 dark:text-white">
                    {s.label}
                    {s.closed && <span className="ml-2 text-xs font-semibold text-gray-600 dark:text-gray-400">(ปิดภาคแล้ว)</span>}
                  </span>
                  <span className="block text-xs text-gray-700 dark:text-gray-300">
                    ใบรอผล {s.open_forms} · กำลังฝึก {s.on_placement} · ผลประเมินยังไม่ครบ {s.evaluations_missing}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`staff-home-other-semester-go-${s.semester_id}`}
                  onClick={() => go({ menu: 'pipeline', semester_id: String(s.semester_id) })}
                  className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  ดูนักศึกษาภาคนี้
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2c. แถบเตือนปฏิทิน — เหลือหนึ่งบรรทัดพร้อมปุ่ม */}
      {warnings.length > 0 && (
        <div
          data-testid="staff-home-calendar-warning"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-800 dark:bg-amber-950/30"
        >
          {/* fail-open ต้องไม่เงียบ: ปฏิทินที่ยังไม่ตั้ง = ระบบยังไม่ล็อกใครในขั้นนั้น — บอกจำนวน รายชื่อเต็มอยู่ที่หน้าปฏิทิน */}
          <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {home.semester
              ? `ยังไม่ได้ตั้งช่วงเวลาในปฏิทินสหกิจ ${warnings.length} รายการ`
              : 'ยังไม่ได้เปิดภาคเรียน'}
          </span>
          <button
            type="button"
            onClick={() => go({ menu: 'calendar' })}
            className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-200 dark:hover:bg-gray-700"
          >
            ไปตั้งช่วงเวลา
          </button>
        </div>
      )}

      {/* 2d. เตือนงานเลยกำหนด (ถ้ามี) */}
      {home.season === 'overdue' && (
        <div
          data-testid="staff-home-season"
          data-season="overdue"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          มีงานเลยกำหนด {overdueWork} เรื่อง
          {tiles.request.overdue > 0 ? ` · คำร้องรอรับ ${tiles.request.overdue}` : ''}
          {tiles.acceptance.overdue > 0 ? ` · แบบตอบรับรอตรวจ ${tiles.acceptance.overdue}` : ''}
        </div>
      )}

      {/* ── 3. ONE row of five boxes from cohort_steps ── */}
      {!home.cohort_steps ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          {home.semester ? 'ยังไม่มีนักศึกษาในรุ่นของภาคเรียนนี้' : 'ยังไม่ได้เปิดภาคเรียน — ไปตั้งที่ปฏิทินสหกิจศึกษา'}
        </p>
      ) : (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-extrabold text-gray-900 dark:text-white">
              {home.cohort_total !== null ? `นักศึกษารุ่นนี้ ${home.cohort_total} คน` : 'นักศึกษารุ่นนี้'}
            </h2>
            <button
              type="button"
              data-testid="staff-home-pipeline-open"
              onClick={() => go({ menu: 'pipeline' })}
              // py-3 -my-3 = พื้นที่กดสูง 44px โดยข้อความอยู่ที่เดิม
              className="py-3 -my-3 text-xs font-semibold text-brand-blue hover:underline dark:text-blue-400"
            >
              ดูรายคน
            </button>
          </div>

          <div data-testid="staff-home-steps" className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {COHORT_BOXES.map((box) => {
              const count = home.cohort_steps![box.key];
              const badgeCount = box.badgeField ? home.tiles[box.badgeField].count : 0;
              const hasBadge = badgeCount > 0;
              const isClickable = hasBadge && box.queue !== null;
              const isSelected = isClickable && activeQueue === box.queue;

              const baseCardClass = `rounded-xl p-3 text-left transition-colors flex flex-col justify-between ${
                isSelected
                  ? 'border-2 border-brand-blue bg-blue-50 dark:border-blue-500 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100'
                  : 'border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              } ${isClickable ? 'hover:border-blue-400 dark:hover:border-blue-600 cursor-pointer' : 'cursor-default'}`;

              const content = (
                <>
                  <div>
                    <b className="block text-2xl sm:text-[26px] font-extrabold leading-tight text-brand-blue dark:text-blue-400 tabular-nums">
                      {count}
                    </b>
                    <span className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mt-1">
                      {box.label}
                    </span>
                  </div>
                  {hasBadge && (
                    <div>
                      <span
                        data-testid={`staff-home-step-badge-${box.key}`}
                        className="inline-block mt-2 rounded-full px-2.5 py-0.5 text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                      >
                        {box.badgePrefix} {badgeCount}
                      </span>
                    </div>
                  )}
                </>
              );

              return isClickable ? (
                <button
                  key={box.key}
                  type="button"
                  data-testid={`staff-home-step-${box.key}`}
                  aria-pressed={isSelected}
                  onClick={() => go({ queue: box.queue! })}
                  className={baseCardClass}
                >
                  {content}
                </button>
              ) : (
                <div
                  key={box.key}
                  data-testid={`staff-home-step-${box.key}`}
                  className={baseCardClass}
                >
                  {content}
                </div>
              );
            })}
          </div>

        </section>
      )}

      {/* รายการเดียวของกล่องที่เลือก — อยู่นอกแถวห้าช่องโดยตั้งใจ: กองงานไม่ผูกภาคเรียน
          ไม่มีภาคที่เปิดอยู่ (ไม่มีกล่อง) งานที่ค้างจากภาคก่อนก็ยังต้องขึ้นให้ทำ */}
      {activeQueue && (
        <RequestQueue
          queue={activeQueue}
          onDataChanged={() => {
            void loadHome(true);
          }}
        />
      )}
    </div>
  );
};

export default StaffHome;
