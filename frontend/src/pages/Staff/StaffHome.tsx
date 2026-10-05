import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';
import RequestQueue from './RequestQueue';

/**
 * E0 · หน้าแรกของเจ้าหน้าที่ — “คิวงานวันนี้” (StaffHome.dc.html · สเปกหัวข้อ 4)
 *
 * ⛔ **ทุกตัวเลขบนหน้านี้มาจาก `GET /api/staff/home` คำขอเดียว** — ห้ามยิงเส้นอื่น
 *    มาประกอบตัวเลขเพิ่ม เพราะ “วันนี้” ต้องเป็นก้อนเดียวกันทั้งหน้า ถ้าแยกหลายคำขอ
 *    แต่ละอันจะอ่านนาฬิกาคนละครั้งและตอบคนละวันได้ในช่วงเที่ยงคืน
 *
 * ⛔ **หน้าจอไม่ตัดสินฤดูกาลเอง** — อ่าน `season` ที่เซิร์ฟเวอร์ส่งมาอย่างเดียว
 *    ตรรกะที่อยู่สองที่จะเพี้ยนคนละทางแน่นอน และเบราว์เซอร์ไม่รู้ “วันนี้” ของฐานข้อมูล
 *
 * ⛔ **ห้ามเทียบวันเอง** — `season_detail.days_left` คิดมาจากเซิร์ฟเวอร์แล้ว
 *
 * ตารางคิวงานสามกอง (E1) ยังเป็น `RequestQueue` ตัวเดิม ซึ่งโหลดข้อมูลของตัวเอง —
 * นั่นคือ “หน้าจออีกหน้าที่วางอยู่บนหน้าเดียวกัน” (ข้อตัดสิน 14.1) ไม่ใช่การเอาเส้นอื่น
 * มาประกอบสรุปของหน้าแรก
 */

type Season =
  | 'overdue'
  | 'request'
  | 'acceptance'
  | 'supervision'
  | 'evaluation'
  | 'idle';

type CalendarState = 'not_configured' | 'upcoming' | 'open' | 'late' | 'closed';

type TileKind = 'request' | 'acceptance' | 'dispatch' | 'appointment' | 'dean';

interface Tile {
  count: number;
  overdue: number;
  note: string | null;
}

interface TimelineEntry {
  key: string;
  label: string;
  state: CalendarState;
  start: string | null;
  end: string | null;
  late_end: string | null;
}

interface StaffHomePayload {
  today: string;
  semester: { semester_id: number; label: string; is_active: boolean } | null;
  season: Season;
  /** ภาคอื่นที่ยังมีเรื่องค้าง — ภาคที่ไม่มีอะไรค้างไม่ถูกส่งมา */
  other_semesters: {
    semester_id: number;
    label: string;
    closed: boolean;
    open_forms: number;
    on_placement: number;
    evaluations_missing: number;
  }[];
  season_detail: {
    headline_count: number;
    deadline: string | null;
    days_left: number | null;
    secondary_count: number;
  };
  tiles: Record<TileKind, Tile>;
  timeline: TimelineEntry[];
  calendar_warnings: { activity_key: string | null; label: string }[];
}

interface GeneratedDocument {
  doc_id: number;
  document_number?: string | null;
  type: string;
  student_id: number;
  company_id: number;
  template_id: number;
  generated_file_path: string | null;
  status: string;
  dean_signature_date: string | null;
  student_code: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name_th: string;
}

/** ปลายทางของปุ่ม — คีย์ query ที่ `Dashboard.tsx` อ่าน (`menu` หายไป = หน้าแรก) */
type Dest = Record<string, string>;

/**
 * กองงานทั้ง 5 · เรียงตามลำดับของสเปกข้อ 4.3
 *
 * ⛔ **กองที่นับได้ 0 ยังต้องแสดง** พร้อมคำอธิบายว่าทำไมถึงว่าง — ซ่อนแล้วคนใช้
 *    จะไม่รู้ว่ากองนั้นมีอยู่ (เคยเป็นเหตุผลที่งานทั้งกองหายไปจากสายตา)
 * ⛔ **“ค้างที่คณบดี” ไม่มีปุ่ม** — บอกให้รู้ว่าค้างที่ใคร ไม่ใช่งานของเจ้าหน้าที่ (ข้อ 14.8)
 */
const TILES: { kind: TileKind; label: string; dest: Dest | null; emptyNote: string }[] = [
  {
    kind: 'request',
    label: 'คำร้องรอออกเลขหนังสือ',
    dest: { queue: 'request' },
    emptyNote: 'ยังไม่มีนักศึกษาอัปโหลดคำร้องที่ลงนามแล้วกลับเข้ามา',
  },
  {
    kind: 'acceptance',
    label: 'แบบตอบรับรอตรวจ',
    dest: { queue: 'acceptance' },
    emptyNote: 'ยังไม่มีแบบตอบรับ (เอกสารหมายเลข 2) ส่งเข้ามา',
  },
  {
    kind: 'dispatch',
    label: 'หนังสือส่งตัวรอออกเลข',
    dest: { queue: 'dispatch' },
    emptyNote: 'ยังไม่มีนักศึกษาที่สถานประกอบการตอบรับแล้ว',
  },
  {
    kind: 'appointment',
    label: 'ร่างนัดหมายนิเทศรอส่ง',
    dest: { menu: 'appointments' },
    emptyNote: 'ยังไม่ถึงช่วงนิเทศ',
  },
  {
    kind: 'dean',
    label: 'ค้างที่คณบดี',
    dest: null,
    emptyNote: 'ไม่มีหนังสือค้างรอลงนาม',
  },
];

export const StaffHome: React.FC = () => {
  const navigate = useNavigate();
  const [home, setHome] = useState<StaffHomePayload | null>(null);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  /**
   * ประวัติหนังสือราชการเป็นแผงของตัวเองที่อยู่ท้ายหน้ามาแต่เดิม ไม่ใช่ส่วนหนึ่งของ
   * สรุปด้านบน — จึงโหลดแยกและล้มแยกได้โดยไม่ทำให้คิวงานหายไปทั้งหน้า
   */
  const loadDocuments = useCallback(async () => {
    try {
      const docs = await api.get('/documents');
      setDocuments(docs || []);
    } catch {
      setDocuments([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHome();
    loadDocuments();
  }, [loadHome, loadDocuments]);

  const go = (dest: Dest) => {
    const next = new URLSearchParams();
    Object.entries(dest).forEach(([k, v]) => next.set(k, v));
    navigate({ pathname: '/dashboard', search: next.toString() });
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

  const { season, season_detail: detail, tiles, timeline, calendar_warnings: warnings } = home;
  const copy = seasonCopy(season, detail, tiles);

  // `activity_key` เป็น null = ประโยคเต็มจากเซิร์ฟเวอร์ (ยังไม่เปิดภาคเรียน) แสดงทีละบรรทัด
  // มีค่า = เป็น "ชื่อกิจกรรม" เปล่า ๆ ต้องต่อท้ายเองว่ายังไม่ได้ตั้งช่วงเวลา และผลคืออะไร
  // ตั้งแต่ 2 กิจกรรมขึ้นไปรวมเป็นบรรทัดเดียว ไม่ให้ประโยคท้ายซ้ำทุกบรรทัด
  const unsetLabels = warnings.filter((w) => w.activity_key !== null).map((w) => w.label);
  const warningLines = [
    ...warnings.filter((w) => w.activity_key === null).map((w) => w.label),
    ...(unsetLabels.length === 1
      ? [`${unsetLabels[0]} ยังไม่ได้ตั้งช่วงเวลา — ระบบจึงยังไม่ล็อกใครในขั้นนั้น`]
      : unsetLabels.length > 1
        ? [`ยังไม่ได้ตั้งช่วงเวลา: ${unsetLabels.join(' · ')} — ระบบจึงยังไม่ล็อกใครในขั้นเหล่านี้`]
        : []),
  ];

  return (
    <div className="space-y-4 page-enter">
      {/* ── หัวเรื่อง ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">คิวงานวันนี้</h1>
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
            ทุกกองที่รอมือคุณอยู่ที่เดียว — เรียงตามช่วงของปฏิทินสหกิจ ไม่ต้องเปิดทีละเมนู
          </p>
        </div>
        <div className="text-[13px] text-gray-600 dark:text-gray-400 text-right">
          <span className="block font-semibold text-gray-800 dark:text-gray-200">
            {home.semester ? home.semester.label : 'ยังไม่ได้เปิดภาคเรียน'}
          </span>
          <span>วันนี้ {formatThaiDate(home.today)}</span>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />

      {/* ── แถบฤดูกาล 5 ช่วง — ชูช่วงที่วันนี้อยู่ ── */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-xs font-bold text-gray-600 dark:text-gray-400">
            ปฏิทินสหกิจศึกษา
          </span>
          <button
            type="button"
            onClick={() => go({ menu: 'calendar' })}
            className="-my-3 py-3 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-400"
          >
            แก้ช่วงเวลา
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {timeline.map((t) => {
            const now = t.state === 'open' || t.state === 'late';
            return (
              <div
                key={t.key}
                data-testid={`staff-home-timeline-${t.key}`}
                data-state={t.state}
                className={`rounded-xl px-3 py-2 border ${
                  now
                    ? 'bg-blue-900 border-blue-900 dark:bg-blue-800 dark:border-blue-700'
                    : 'bg-gray-50 border-gray-200 dark:bg-gray-900/50 dark:border-gray-700'
                }`}
              >
                <span
                  className={`block text-[11px] font-bold ${
                    now ? 'text-white' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {t.label}
                </span>
                <span
                  className={`block mt-0.5 text-[11px] ${
                    now ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {windowText(t)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/*
        ── แถบเตือนปฏิทิน ──
        ⛔ ด่านปฏิทิน fail-open **โดยตั้งใจ** (ตรงข้ามกับ SEC-06 ซึ่งเป็นเรื่องสิทธิ์
           และต้อง fail closed) · แต่ fail-open ต้องไม่เงียบ หน้าจอเจ้าหน้าที่คือที่เดียว
           ที่บอกได้ว่าขั้นไหนยังไม่ล็อกใคร
        ⛔ ห้ามเขียนว่า “ผิดพลาด” หรือ “ระบบไม่พร้อม” — นี่คือพฤติกรรมที่ตั้งใจ
      */}
      {warnings.length > 0 && (
        <div
          data-testid="staff-home-calendar-warning"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ul className="space-y-1 min-w-0">
              {warningLines.map((line) => (
                <li key={line} className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                  {line}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => go({ menu: 'calendar' })}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-200 dark:hover:bg-gray-700"
            >
              ไปตั้งช่วงเวลา
            </button>
          </div>
        </div>
      )}

      {/* ── การ์ดใบใหญ่ประจำฤดูกาล — `season` มาจากเซิร์ฟเวอร์ ── */}
      <div
        data-testid="staff-home-season"
        data-season={season}
        className={`rounded-2xl border p-6 shadow-sm ${
          season === 'overdue'
            ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
            : season === 'idle'
              ? 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
              : 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20'
        }`}
      >
        <span className="text-xs font-bold text-blue-700 dark:text-blue-400">
          {copy.phase}
        </span>
        <h2 className="mt-1.5 text-xl font-extrabold leading-snug text-gray-900 dark:text-white">
          {copy.headline}
        </h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
          {copy.body}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {copy.action && (
            <button
              type="button"
              data-testid="staff-home-season-action"
              onClick={() => go(copy.action!.dest)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700"
            >
              {copy.action.label}
            </button>
          )}
          {detail.deadline && (
            <span className="text-xs text-gray-700 dark:text-gray-300">
              {copy.deadlineLabel} {formatThaiDate(detail.deadline)}
              {detail.days_left !== null && ` · ${daysLeftText(detail.days_left)}`}
            </span>
          )}
        </div>
      </div>

      {/*
        ── ภาคอื่นที่ยังมีเรื่องค้าง ──
        การ์ดฤดูกาลด้านบนผูกกับภาคที่เปิดอยู่ภาคเดียว · ภาคเก่าที่ยังมีใบรอผล/นักศึกษากำลังฝึก/ผลประเมินไม่ครบ
        ต้องไม่หายไปพอเปิดภาคใหม่ (ปิดภาคไม่ใช่การเคลียร์ของ) — ตัวเลขทั้งหมดมาจากเซิร์ฟเวอร์
      */}
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

      {/* ── กองงาน 5 กอง ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {TILES.map(({ kind, label, dest, emptyNote }) => {
          const tile = tiles[kind];
          const empty = tile.count === 0;
          const body = (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`text-[13px] font-bold ${
                    empty ? 'text-gray-600 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100'
                  }`}
                >
                  {label}
                </span>
                <span
                  data-testid={`staff-home-tile-${kind}-count`}
                  className={`text-2xl font-extrabold tabular-nums ${
                    empty ? 'text-gray-500 dark:text-gray-400' : 'text-blue-900 dark:text-blue-300'
                  }`}
                >
                  {tile.count}
                </span>
              </div>
              {/*
                เรียงความสำคัญ: เลยกำหนดก่อน แล้วค่อยหมายเหตุ แล้วค่อยเหตุผลที่ว่าง
                ⛔ `note` ของกองคณบดีเป็น “ไม่ทราบว่าค้างมานานเท่าไร…” ได้ — แสดงตามนั้น
                   ห้ามแปลงเป็น “ค้างมา 0 วัน” ซึ่งอ่านว่าเพิ่งเข้าคิววันนี้
              */}
              {tile.overdue > 0 && (
                <span className="block text-[11px] font-bold text-red-700 dark:text-red-300">
                  เลยกำหนดแล้ว {tile.overdue} รายการ
                </span>
              )}
              {tile.note && (
                <span className="block text-[11px] text-gray-600 dark:text-gray-400">
                  {tile.note}
                </span>
              )}
              {empty && !tile.note && (
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  {emptyNote}
                </span>
              )}
            </>
          );

          const shell =
            'rounded-2xl border p-4 flex flex-col gap-1 text-left shadow-sm bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';

          // ค้างที่คณบดี = อ่านอย่างเดียว ไม่ใช่ปุ่ม (ข้อ 14.8)
          return dest === null ? (
            <div
              key={kind}
              data-testid={`staff-home-tile-${kind}`}
              className={`${shell} border-dashed bg-gray-50 dark:bg-gray-900/40`}
            >
              {body}
              <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                ไม่ใช่งานของคุณ · รอคณบดีลงนาม
              </span>
            </div>
          ) : (
            <button
              key={kind}
              type="button"
              data-testid={`staff-home-tile-${kind}`}
              onClick={() => go(dest)}
              className={`${shell} hover:border-blue-400 dark:hover:border-blue-600`}
            >
              {body}
            </button>
          );
        })}
      </div>

      {/* ── ตารางคิวงานสามกอง (E1) ── */}
      <RequestQueue onDataChanged={() => loadHome(true)} />

      {/* ── ประวัติหนังสือราชการ & สถานะการลงนามของคณบดี ── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
            ประวัติหนังสือราชการ &amp; สถานะการลงนามของคณบดี
          </span>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            หนังสือขอความอนุเคราะห์และหนังสือส่งตัวนักศึกษา พร้อมสถานะและวันที่คณบดีลงนาม
          </p>
        </div>

        {documents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                  <th className="p-4 font-semibold">รหัสอ้างอิงเอกสาร</th>
                  <th className="p-4 font-semibold">เลขที่หนังสือ</th>
                  <th className="p-4 font-semibold">ประเภทหนังสือ</th>
                  <th className="p-4 font-semibold">นักศึกษา</th>
                  <th className="p-4 font-semibold">บริษัทปลายทาง</th>
                  <th className="p-4 font-semibold text-center">สถานะลายเซ็นคณบดี</th>
                  <th className="p-4 font-semibold text-right">ลิงก์อ่านไฟล์</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {documents.map((doc) => (
                  <tr key={doc.doc_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="p-4 font-bold text-gray-800 dark:text-gray-300">
                      #DOC-{doc.doc_id}
                    </td>
                    <td className="p-4 font-mono text-gray-700 dark:text-gray-300">
                      {doc.document_number || '-'}
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-400">
                      {docTypeLabel(doc.type)}
                    </td>
                    <td className="p-4">
                      <span className="block font-medium text-gray-800 dark:text-gray-200">
                        {[doc.first_name, doc.last_name].filter(Boolean).join(' ') || '-'}
                      </span>
                      <span className="block text-xs text-gray-600 dark:text-gray-400">
                        รหัส: {doc.student_code}
                      </span>
                    </td>
                    <td className="p-4 text-gray-600 dark:text-gray-400">{doc.company_name_th}</td>
                    <td className="p-4 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full font-bold text-xs ${
                            doc.status === 'signed'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                              : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
                          }`}
                        >
                          {doc.status === 'signed' ? 'คณบดีลงนามแล้ว' : 'รอคณบดีลงนาม'}
                        </span>
                        {doc.status === 'signed' && doc.dean_signature_date && (
                          <span className="text-[11px] text-gray-600 dark:text-gray-400">
                            ลงนามเมื่อ {formatThaiDate(doc.dean_signature_date.slice(0, 10))}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      {doc.generated_file_path ? (
                        <a
                          href={`${API_BASE_URL}/files/documents/${doc.doc_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-800 dark:hover:text-blue-400"
                        >
                          เปิดไฟล์ PDF
                        </a>
                      ) : (
                        <span className="text-gray-600 dark:text-gray-400">ไม่มีไฟล์</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-600 dark:text-gray-400 text-sm">
            ยังไม่มีการออกหนังสือราชการบันทึกในระบบ — ใบแรกจะเกิดตอนคุณกดรับคำร้องแล้วออกเลขที่หนังสือ
          </div>
        )}
      </div>
    </div>
  );
};

/* ── ข้อความประจำฤดูกาล ─────────────────────────────────────────────
 *
 * ⛔ ที่นี่แปล `season` เป็นถ้อยคำเท่านั้น **ไม่ได้ตัดสินว่าอยู่ฤดูกาลไหน**
 *    การตัดสินอยู่ที่ `controllers/staffHome.ts` ที่เดียว
 */
function seasonCopy(
  season: Season,
  detail: StaffHomePayload['season_detail'],
  tiles: Record<TileKind, Tile>
): {
  phase: string;
  headline: string;
  body: string;
  deadlineLabel: string;
  action: { label: string; dest: Dest } | null;
} {
  const n = detail.headline_count;
  const secondary = detail.secondary_count;

  switch (season) {
    case 'overdue': {
      // ปลายทางของปุ่มคือกองที่เลยกำหนดมากที่สุด — ไม่ใช่กองแรกเสมอไป
      const worst = (
        [
          { dest: { queue: 'request' }, overdue: tiles.request.overdue },
          { dest: { queue: 'acceptance' }, overdue: tiles.acceptance.overdue },
        ] as { dest: Dest; overdue: number }[]
      ).sort((a, b) => b.overdue - a.overdue);
      return {
        phase: 'ต้องตามเรื่อง',
        headline: `ของที่เลยกำหนดแล้ว ${n} รายการ`,
        body: `แบบตอบรับเลย 15 วันทำการ ${tiles.acceptance.overdue} ใบ · คำร้องค้างเกิน 7 วัน ${tiles.request.overdue} ใบ — ลำดับนี้มาก่อนทุกฤดูกาล เพราะของที่เลยกำหนดไม่ควรถูกกลบด้วยงานตามปฏิทิน`,
        deadlineLabel: 'กำหนด',
        action: { label: 'ดูรายการที่เลยกำหนด', dest: worst[0].dest },
      };
    }
    case 'request':
      return {
        phase: 'ช่วงรับคำร้องและออกหนังสือ',
        headline: `รับคำร้องขอหนังสือ ${n} ใบ แล้วออกเลขที่หนังสือ`,
        body: 'การกด “รับคำร้อง” หนึ่งครั้งทำสามอย่างในทรานแซกชันเดียว: เลื่อนสถานะคำร้อง · รับรองสถานประกอบการ · ออกหนังสือขอความอนุเคราะห์เข้าคิวคณบดี',
        deadlineLabel: 'ปิดรับ',
        action: { label: `เปิดคิวคำร้อง ${n} ใบ`, dest: { queue: 'request' } },
      };
    case 'acceptance':
      return {
        phase: 'ช่วงรับแบบตอบรับและออกหนังสือส่งตัว',
        headline: `ตรวจแบบตอบรับ ${n} ใบ และออกหนังสือส่งตัวให้ ${secondary} คน`,
        body: 'นักศึกษาอัปโหลดแบบยืนยันแบบตอบรับ (เอกสารหมายเลข 2) ที่สถานประกอบการลงนาม · คุณคีย์ชื่อผู้ลงนาม ตำแหน่ง และวันที่จากกระดาษ แล้วออกเลขหนังสือส่งตัวพร้อมวันสิ้นสุดการปฏิบัติงาน',
        deadlineLabel: 'ปิดรับ',
        action: { label: 'เปิดคิวแบบตอบรับ', dest: { queue: 'acceptance' } },
      };
    case 'supervision':
      return {
        phase: 'ช่วงระหว่างปฏิบัติงานและนิเทศ',
        headline: `ส่งหนังสือนัดหมายนิเทศ ${n} ฉบับให้สถานประกอบการ`,
        body: `อาจารย์ร่างนัดหมายไว้แล้ว รอคุณตรวจแล้วสั่งส่ง — นี่คือแบบยืนยันการนิเทศ (สหกิจ 12) บนกระดาษ · ตอนนี้มีนักศึกษาออกฝึกอยู่ ${secondary} คน`,
        deadlineLabel: 'สิ้นสุดการปฏิบัติงาน',
        action: { label: 'ตรวจร่างนัดหมาย', dest: { menu: 'appointments' } },
      };
    case 'evaluation':
      return {
        phase: 'ช่วงประเมินและปิดภาค',
        headline: `แบบประเมินยังไม่ครบ ${n} คน จาก ${secondary} คน`,
        body: 'พี่เลี้ยงต้องส่งทั้ง สหกิจ 15 (ใช้ตัดเกรด) และ สหกิจ 16 (ประเมินรายงาน) · ป้ายบนจอเขียนว่า “ครบทั้ง 2 ใบ” ไม่ใช่ “ผ่าน” เพราะระบบรู้แค่ว่ามีใบส่งเข้ามาแล้วหรือยัง อาจารย์เป็นผู้ตัดเกรด',
        deadlineLabel: 'ปิดภาค',
        action: { label: 'ดูรายชื่อที่ยังไม่ครบ', dest: { menu: 'final_progress' } },
      };
    default:
      return {
        phase: 'ช่วงว่าง',
        headline: 'ตอนนี้ไม่มีอะไรค้างรอคุณ',
        body: 'คิวเอกสารว่างและยังไม่ถึงช่วงของงานถัดไป — ถ้ายังไม่ได้เปิดภาคเรียนหรือยังไม่ได้ตั้งปฏิทิน แถบเตือนด้านบนจะบอกไว้แล้ว',
        deadlineLabel: 'กำหนด',
        action: { label: 'ดูสรุปภาคเรียนที่ผ่านมา', dest: { menu: 'final_progress' } },
      };
  }
}

/** ช่วงเวลาหนึ่งช่องบนแถบฤดูกาล — สถานะมาจากเซิร์ฟเวอร์ ไม่ได้เทียบวันที่นี่ */
function windowText(t: TimelineEntry): string {
  switch (t.state) {
    case 'not_configured':
      return 'ยังไม่ได้ตั้ง';
    case 'upcoming':
      return t.start ? `เริ่ม ${formatThaiDate(t.start)}` : 'ยังไม่ถึงช่วง';
    case 'open':
      return t.end ? `ถึง ${formatThaiDate(t.end)} · วันนี้` : 'กำลังเปิด · วันนี้';
    case 'late':
      return t.late_end ? `ช่วงผ่อนผัน ถึง ${formatThaiDate(t.late_end)}` : 'ช่วงผ่อนผัน';
    default:
      return t.end ? `ปิดแล้ว ${formatThaiDate(t.end)}` : 'ปิดแล้ว';
  }
}

/** `days_left` คิดมาจากเซิร์ฟเวอร์แล้ว ที่นี่แค่เลือกคำ — ติดลบได้แปลว่าเลยมาแล้ว */
function daysLeftText(days: number): string {
  if (days > 0) return `เหลืออีก ${days} วัน`;
  if (days === 0) return 'วันนี้วันสุดท้าย';
  return `เลยกำหนดมาแล้ว ${Math.abs(days)} วัน`;
}

function docTypeLabel(type: string): string {
  if (type === 'cover_letter') return 'หนังสือขอความอนุเคราะห์';
  if (type === 'send_letter') return 'หนังสือส่งตัวนักศึกษา';
  return type;
}

export default StaffHome;
