import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import PageSkeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import { Select } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';

/**
 * แดชบอร์ด "นักศึกษาตอนนี้" ของเจ้าหน้าที่ — ขั้น · ใครต้องขยับ · ค้างนานแค่ไหน
 *
 * ⛔ **ขั้นและคนถือเรื่องตัดสินที่เซิร์ฟเวอร์ที่เดียว** (`controllers/staffPipeline.ts`) — หน้านี้แค่แสดง
 *    ห้ามเทียบสถานะ/วันเองที่นี่ (ถ้าแยกสองที่ วันหนึ่งจะบอกคนละเรื่องกัน)
 * ⛔ **อายุที่ค้างเป็น null ได้** = ระบบไม่เก็บเวลาของขั้นนั้น → เขียนว่า "ไม่ทราบ" ห้ามเดา
 * ⛔ **ตัวหาร = รุ่นของภาคเรียน** — รุ่นว่าง = บอกให้ไปนำเข้ารายชื่อ ไม่แต่งตัวเลข
 */

type Holder = 'student' | 'staff' | 'company' | 'dean' | 'clear';

interface StagePayload {
  key: string;
  label: string;
  count: number;
  holders: Record<Holder, number>;
  median_age_days: number | null;
  known_age: number;
}

interface LongestRow {
  form_id: number | null;
  student_code: string;
  name: string | null;
  major_name_th: string | null;
  company_name: string | null;
  stage: string;
  stage_label: string;
  holder: Holder;
  age_days: number;
}

interface PipelinePayload {
  today: string;
  semester: { semester_id: number; label: string; is_active: boolean } | null;
  semesters: { semester_id: number; label: string; is_active: boolean }[];
  majors: { major_id: number; major_name_th: string }[];
  cohort_total: number;
  stages: StagePayload[];
  holders: { holder: Holder; count: number }[];
  kpis: {
    total: number;
    placed: number;
    awaiting_company: number;
    awaiting_company_overdue: number;
    exited: number;
    no_intent: number;
  } | null;
  gaps: { key: string; label: string; count: number }[];
  longest: LongestRow[];
  unknown_age: number;
}

/** ถ้อยคำ + สีของคนถือเรื่อง — สีต้องคู่กับข้อความเสมอ (ไม่ใช้สีอย่างเดียว) */
const HOLDER: Record<Holder, { label: string; text: string; bar: string; hint: string }> = {
  student: {
    label: 'นักศึกษา',
    text: 'text-amber-800 dark:text-amber-300',
    bar: 'bg-amber-600',
    hint: 'ตามผ่านการ์ดหน้าแรกของนักศึกษาและอีเมล',
  },
  staff: {
    label: 'เจ้าหน้าที่ (คุณ)',
    text: 'text-blue-900 dark:text-blue-300',
    bar: 'bg-blue-800',
    hint: 'คำร้อง · แบบตอบรับ · หนังสือส่งตัว',
  },
  company: {
    label: 'บริษัท / พี่เลี้ยง',
    text: 'text-gray-700 dark:text-gray-300',
    bar: 'bg-gray-500',
    hint: 'ตามผ่านนักศึกษา — คณะไม่มีช่องทางตามบริษัทโดยตรง',
  },
  dean: {
    label: 'คณบดี',
    text: 'text-purple-800 dark:text-purple-300',
    bar: 'bg-purple-600',
    hint: 'ไม่ใช่งานของเจ้าหน้าที่ · อ่านอย่างเดียว',
  },
  clear: {
    label: 'ไม่มีงานค้าง',
    text: 'text-emerald-800 dark:text-emerald-300',
    bar: 'bg-emerald-600',
    hint: 'ตอบรับแล้วและเอกสารครบ หรือกำลังฝึกอยู่',
  },
};

const HOLDER_ORDER: Holder[] = ['student', 'staff', 'company', 'dean', 'clear'];

/** สีแท่งของขั้น — ขั้นที่ "ยังไม่ถึงช่วง" (ไม่มีใครอยู่) วาดเป็นลายเทา ไม่ใช่แท่งว่างเฉย ๆ */
const STAGE_BAR: Record<string, string> = {
  not_registered: 'bg-gray-500',
  no_intent: 'bg-gray-500',
  await_upload: 'bg-amber-600',
  await_officer_request: 'bg-blue-800',
  await_dean: 'bg-purple-600',
  await_send: 'bg-amber-600',
  await_company: 'bg-gray-500',
  await_mentor: 'bg-amber-600',
  await_officer_accept: 'bg-blue-800',
  accepted_prep: 'bg-emerald-600',
  on_placement: 'bg-emerald-600',
  post_placement: 'bg-emerald-600',
  done: 'bg-emerald-600',
  exit: 'bg-red-700',
};

const holderSummary = (h: Record<Holder, number>): string =>
  HOLDER_ORDER.filter((k) => h[k] > 0)
    .map((k) => `${HOLDER[k].label} ${h[k]}`)
    .join(' · ');

export const StudentPipeline: React.FC = () => {
  const [data, setData] = useState<PipelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = ใช้ค่าเริ่มต้นของเซิร์ฟเวอร์ (ภาคที่เปิดใช้งาน / ทุกสาขา)
  // หน้าแรกเจ้าหน้าที่ลิงก์มาที่ภาคเก่าด้วย ?semester_id= — ใช้เป็นค่าเริ่มต้นครั้งแรกเท่านั้น
  const [searchParams] = useSearchParams();
  const [semesterId, setSemesterId] = useState<string>(searchParams.get('semester_id') ?? '');
  const [majorId, setMajorId] = useState<string>('');

  const load = useCallback(async (sem: string, major: string, isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (sem) params.set('semester_id', sem);
      if (major) params.set('major_id', major);
      const qs = params.toString();
      setData(await api.get(`/staff/pipeline${qs ? `?${qs}` : ''}`));
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดแดชบอร์ดนักศึกษาตอนนี้ได้'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(semesterId, majorId);
  }, [load, semesterId, majorId]);

  if (loading && !data) return <PageSkeleton variant="stats" />;

  if (!data) {
    return (
      <div className="space-y-4 page-enter">
        <AlertBanner variant="error" message={error || 'ไม่สามารถโหลดแดชบอร์ดนักศึกษาตอนนี้ได้'} />
      </div>
    );
  }

  const { kpis } = data;
  const maxStage = Math.max(1, ...data.stages.map((s) => s.count));
  const staffCount = data.holders.find((h) => h.holder === 'staff')?.count ?? 0;

  const columns: Column<LongestRow>[] = [
    {
      key: 'student',
      header: 'นักศึกษา',
      cell: (r) => (
        <>
          <span className="block font-semibold text-gray-900 dark:text-white">{r.name ?? '—'}</span>
          <span className="block text-xs text-gray-600 dark:text-gray-400">{r.student_code}</span>
        </>
      ),
    },
    { key: 'major', header: 'สาขา', cell: (r) => r.major_name_th ?? '—' },
    { key: 'stage', header: 'ขั้นปัจจุบัน', cell: (r) => r.stage_label },
    {
      key: 'holder',
      header: 'ใครต้องขยับ',
      cell: (r) => <span className={`font-bold ${HOLDER[r.holder].text}`}>{HOLDER[r.holder].label}</span>,
    },
    {
      key: 'age',
      header: 'ค้างมา',
      align: 'right',
      cell: (r) => <span className="font-extrabold tabular-nums">{r.age_days} วัน</span>,
    },
    { key: 'company', header: 'ที่ฝึกที่ขอ', cell: (r) => r.company_name ?? '—' },
  ];

  return (
    <div className="space-y-5 page-enter" data-testid="student-pipeline">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">นักศึกษาตอนนี้</h1>
          <p className="max-w-2xl text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
            นักศึกษาแต่ละคนอยู่ขั้นไหน · ใครต้องเป็นคนขยับ · ค้างนานแค่ไหน — ภาพรวมของรุ่นในภาคเรียนที่เลือก
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="ภาคเรียน"
            data-testid="pipeline-semester"
            value={semesterId || String(data.semester?.semester_id ?? '')}
            onChange={(e) => setSemesterId(e.target.value)}
            className="min-h-11 sm:w-56"
          >
            {data.semesters.map((s) => (
              <option key={s.semester_id} value={s.semester_id}>
                {s.label}
                {s.is_active ? ' (กำลังใช้งาน)' : ''}
              </option>
            ))}
          </Select>
          <Select
            aria-label="สาขา"
            data-testid="pipeline-major"
            value={majorId}
            onChange={(e) => setMajorId(e.target.value)}
            className="min-h-11 sm:w-56"
          >
            <option value="">ทุกสาขา</option>
            {data.majors.map((m) => (
              <option key={m.major_id} value={m.major_id}>
                {m.major_name_th}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />

      {!data.semester ? (
        <EmptyState
          icon={Users}
          title="ยังไม่มีภาคเรียน"
          description="ไปเปิดภาคเรียนก่อน — แดชบอร์ดนี้นับนักศึกษาต่อภาคเรียน"
        />
      ) : data.cohort_total === 0 || !kpis ? (
        <div data-testid="pipeline-empty">
          <EmptyState
            icon={Users}
            title="ยังไม่มีรายชื่อรุ่นของภาคเรียนนี้"
            description={
              majorId
                ? 'ไม่พบนักศึกษาของสาขานี้ในรุ่นของภาคเรียนที่เลือก — ลองเลือก "ทุกสาขา"'
                : 'นำเข้ารายชื่อนักศึกษาที่เมนู "รายชื่อนักศึกษา & เกรด" รายชื่อที่นำเข้าจะเข้ารุ่นของภาคที่กำลังใช้งานอัตโนมัติ — คนที่ยื่นคำร้องแล้วจะถูกนับให้เองแม้ไม่อยู่ในรายชื่อ'
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { id: 'total', label: 'นักศึกษาในรุ่น', value: kpis.total, sub: data.semester.label, tone: '' },
              {
                id: 'placed',
                label: 'ได้ที่ฝึกแล้ว',
                value: kpis.placed,
                sub: `${Math.round((kpis.placed / kpis.total) * 100)}% ของรุ่น`,
                tone: 'text-emerald-800 dark:text-emerald-300',
              },
              {
                id: 'company',
                label: 'รอบริษัทตอบรับ',
                value: kpis.awaiting_company,
                sub: kpis.awaiting_company_overdue > 0 ? `${kpis.awaiting_company_overdue} คนค้างเกิน 10 วัน` : 'ไม่มีใครค้างเกิน 10 วัน',
                tone: '',
              },
              {
                id: 'exit',
                label: 'ต้องหาที่ฝึกใหม่',
                value: kpis.exited,
                sub: 'บริษัทไม่รับ / คำร้องไม่ผ่าน / ยกเลิกเอง',
                tone: 'text-red-800 dark:text-red-300',
              },
              {
                id: 'none',
                label: 'ยังไม่ยื่นคำร้อง',
                value: kpis.no_intent,
                sub: 'รวมคนที่ยังไม่เข้าระบบ',
                tone: 'text-amber-800 dark:text-amber-300',
              },
            ].map((k) => (
              <div
                key={k.id}
                data-testid={`pipeline-kpi-${k.id}`}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="text-xs text-gray-600 dark:text-gray-400">{k.label}</div>
                <div className={`mt-1 text-3xl font-extrabold tabular-nums ${k.tone}`}>{k.value}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:col-span-2">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">ท่อสถานะ — ทางที่นักศึกษาเดิน</h2>
              <p className="mb-3 mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                ทุกขั้นนับจากข้อมูลจริงของใบคำร้อง · ขั้นที่ยังไม่ถึงช่วงจะว่าง · &quot;ค้าง&quot; คือมัธยฐานของคนที่ระบบรู้เวลา (ไม่รู้ = ไม่แสดง)
              </p>
              <ol className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.stages.map((s) => (
                  <li
                    key={s.key}
                    data-testid={`pipeline-stage-${s.key}`}
                    className="grid grid-cols-1 items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,11rem)]"
                  >
                    <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{s.label}</span>
                    <div className="flex items-center gap-3">
                      <div className="h-5 flex-1 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700">
                        {s.count > 0 && (
                          <div
                            className={`h-5 ${STAGE_BAR[s.key] ?? 'bg-gray-500'}`}
                            style={{ width: `${Math.max(2, Math.round((s.count / maxStage) * 100))}%` }}
                          />
                        )}
                      </div>
                      <span
                        data-testid={`pipeline-stage-${s.key}-count`}
                        className="w-9 text-right text-base font-extrabold tabular-nums text-gray-900 dark:text-white"
                      >
                        {s.count}
                      </span>
                    </div>
                    <div className="text-xs">
                      {s.count > 0 ? (
                        <>
                          <span className="block font-bold text-gray-700 dark:text-gray-200">{holderSummary(s.holders)}</span>
                          <span className="block text-gray-600 dark:text-gray-400">
                            {s.median_age_days !== null ? `ค้าง ${s.median_age_days} วัน` : 'ไม่ทราบว่าค้างนานเท่าไร'}
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-500 dark:text-gray-400">ยังไม่มีใคร</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <div className="space-y-5">
              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">ใครถือเรื่องอยู่</h2>
                <p className="mb-3 mt-1 text-xs text-gray-600 dark:text-gray-400">
                  {staffCount} คนรออยู่ที่คุณ · ที่เหลือคุณตามได้ถูกคนว่าอยู่กับใคร
                </p>
                <div className="space-y-3">
                  {HOLDER_ORDER.map((k) => {
                    const n = data.holders.find((h) => h.holder === k)?.count ?? 0;
                    return (
                      <div key={k} data-testid={`pipeline-holder-${k}`}>
                        <div className="flex justify-between text-[13px]">
                          <span className="font-semibold text-gray-800 dark:text-gray-100">{HOLDER[k].label}</span>
                          <span data-testid={`pipeline-holder-${k}-count`} className="font-extrabold tabular-nums">
                            {n} คน
                          </span>
                        </div>
                        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                          {n > 0 && (
                            <div
                              className={`h-2.5 ${HOLDER[k].bar}`}
                              style={{ width: `${Math.max(2, Math.round((n / kpis.total) * 100))}%` }}
                            />
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{HOLDER[k].hint}</div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">ข้อมูลที่ยังขาด</h2>
                <p className="mb-2 mt-1 text-xs text-gray-600 dark:text-gray-400">นับเฉพาะนักศึกษาที่ตอบรับแล้ว — ตรวจให้ครบก่อนออกฝึก</p>
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.gaps.map((g) => (
                    <li key={g.key} data-testid={`pipeline-gap-${g.key}`} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-[13px] text-gray-800 dark:text-gray-100">{g.label}</span>
                      <span
                        data-testid={`pipeline-gap-${g.key}-count`}
                        className={`text-base font-extrabold tabular-nums ${g.count > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}
                      >
                        {g.count} คน
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">ค้างนานที่สุด — ตามคนไหนก่อน</h2>
            <p className="mb-3 mt-1 text-xs text-gray-600 dark:text-gray-400">
              เรียงตามวันที่ค้างในขั้นปัจจุบัน · แสดงเฉพาะคนที่ระบบรู้เวลา
              {data.unknown_age > 0 && ` · อีก ${data.unknown_age} คนยังมีเรื่องค้างแต่ระบบไม่ได้เก็บเวลา (ใบที่เกิดก่อนระบบเริ่มเก็บเวลาแต่ละขั้น)`}
            </p>
            <DataTable
              rows={data.longest}
              columns={columns}
              rowKey={(r) => r.student_code}
              minWidth={820}
              testId="pipeline-longest"
              rowTestId={(r) => `pipeline-longest-${r.student_code}`}
              empty={
                <EmptyState
                  title="ไม่มีนักศึกษาที่ค้างเกินและรู้อายุ"
                  description="ทุกคนที่มีเรื่องค้างยังอยู่ในขั้นที่ระบบไม่เก็บเวลา หรือไม่มีใครค้างอยู่เลย"
                />
              }
            />
          </section>
        </>
      )}
    </div>
  );
};

export default StudentPipeline;
