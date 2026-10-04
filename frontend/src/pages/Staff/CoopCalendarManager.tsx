import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, Save, ChevronDown } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate, formatThaiRange } from '../../utils/thaiDate';
import type {
  CalendarDateKind,
  CalendarStatus,
  CoopCalendarActivity,
  CoopCalendarResponse,
  CoopCalendarSemester,
} from '../../types/api';

/**
 * ปฏิทินสหกิจศึกษาของเจ้าหน้าที่ (E5 · CoopCalendar.dc.html)
 *
 * รายการกิจกรรมมาจากเซิร์ฟเวอร์ทั้งหมด (backend/src/utils/coopCalendar.ts)
 * คุณกรอกได้แค่ "วันที่" ตามชนิดที่กระดาษกำหนด · เพิ่มกิจกรรมของคณะเองได้ที่ท้ายตาราง
 *
 * Fail-open โดยตั้งใจ:
 * กิจกรรมที่ยังไม่ตั้งช่วงเวลา = ระบบเปิดให้นักศึกษาทำรายการได้ตามปกติ (ไม่ล็อก)
 */

const STATUS_TEXT: Record<CalendarStatus, string> = {
  not_configured: 'ยังไม่ได้ตั้ง',
  upcoming: 'ยังไม่ถึง',
  open: 'เปิดอยู่',
  // ⛔ ต้องบอกผลของมันด้วย ไม่ใช่แค่ “ผ่อนผัน” — เจ้าหน้าที่ต้องรู้ว่ายังรับอยู่ แต่ใบที่เข้ามา
  //    ถูกปั๊มว่าส่งช้า (ของเดิมก่อนรีเมคเขียนไว้ครบ และ E2E late-submission L8 คุมคำนี้)
  late: 'ผ่อนผัน (รับแต่นับเป็นส่งช้า)',
  closed: 'ปิดแล้ว',
};

const KIND_LABEL: Record<string, string> = {
  range: 'ช่วง',
  deadline: 'เส้นตาย',
  single: 'วันเดียว',
  derived: 'ช่วง (สืบค่า)',
  relative: 'ข้อความ',
  external: 'ข้อความ',
};

interface DraftRow {
  start_date: string;
  end_date: string;
  late_end_date: string;
  detail_text: string;
  note: string;
}

const emptyDraft = (): DraftRow => ({
  start_date: '',
  end_date: '',
  late_end_date: '',
  detail_text: '',
  note: '',
});

const draftOf = (a: CoopCalendarActivity): DraftRow => ({
  start_date: a.start_date ?? '',
  end_date: a.end_date ?? '',
  late_end_date: a.late_end_date ?? '',
  detail_text: a.detail_text ?? '',
  note: a.note ?? '',
});

const CoopCalendarManager: React.FC = () => {
  const [semesters, setSemesters] = useState<CoopCalendarSemester[]>([]);
  const [semesterId, setSemesterId] = useState<number | null>(null);
  const [data, setData] = useState<CoopCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  /** ร่างของแต่ละกิจกรรม เก็บแยกตาม activity_key */
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});

  /** ฟอร์มเพิ่มรายการอิสระ */
  const [customTitle, setCustomTitle] = useState('');
  const [customDraft, setCustomDraft] = useState<DraftRow>(emptyDraft());
  const [addingCustom, setAddingCustom] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<
    { event_id: number; label: string; isCustom: boolean } | null
  >(null);

  const loadSemesters = useCallback(async () => {
    try {
      const master = await api.get('/master-data');
      const list = (master?.semesters ?? []) as CoopCalendarSemester[];
      setSemesters(list);
      const active = list.find((s) => s.is_active);
      if (active) setSemesterId(active.semester_id);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดรายชื่อภาคการศึกษาได้'));
    }
  }, []);

  const loadCalendar = useCallback(async (id: number | null, isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const res = (await api.get(
        id ? `/calendar?semester_id=${id}` : '/calendar'
      )) as CoopCalendarResponse;
      setData(res);
      setDrafts(Object.fromEntries(res.activities.map((a) => [a.activity_key, draftOf(a)])));
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดปฏิทินสหกิจศึกษาได้'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSemesters();
  }, [loadSemesters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCalendar(semesterId);
  }, [semesterId, loadCalendar]);

  const unconfigured = useMemo(
    () => (data?.activities ?? []).filter((a) => a.status === 'not_configured'),
    [data]
  );

  const setDraft = (key: string, patch: Partial<DraftRow>) =>
    setDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? emptyDraft()), ...patch } }));

  const handleSaveActivity = async (activity: CoopCalendarActivity) => {
    const draft = drafts[activity.activity_key] ?? emptyDraft();
    setSavingKey(activity.activity_key);
    setError('');
    setSuccess('');
    try {
      const body = {
        semester_id: semesterId,
        activity_key: activity.activity_key,
        start_date: draft.start_date || null,
        end_date: draft.end_date || null,
        late_end_date: draft.late_end_date || null,
        detail_text: draft.detail_text || null,
        note: draft.note || null,
      };
      if (activity.event_id) {
        await api.put(`/calendar/${activity.event_id}`, body);
      } else {
        await api.post('/calendar', body);
      }
      setSuccess(`บันทึกช่วงเวลาของ "${activity.label}" เรียบร้อยแล้ว`);
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกกำหนดการได้'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveAll = async () => {
    if (!data?.activities) return;
    setSavingAll(true);
    setError('');
    setSuccess('');
    let savedCount = 0;
    try {
      for (const activity of data.activities) {
        if (activity.derived) continue;
        const draft = drafts[activity.activity_key];
        if (!draft) continue;
        // หากมีการกรอกข้อมูลวัน
        if (draft.start_date || draft.end_date || draft.note) {
          const body = {
            semester_id: semesterId,
            activity_key: activity.activity_key,
            start_date: draft.start_date || null,
            end_date: draft.end_date || null,
            late_end_date: draft.late_end_date || null,
            detail_text: draft.detail_text || null,
            note: draft.note || null,
          };
          if (activity.event_id) {
            await api.put(`/calendar/${activity.event_id}`, body);
          } else {
            await api.post('/calendar', body);
          }
          savedCount++;
        }
      }
      setSuccess(`บันทึกกำหนดการทั้งหมดเรียบร้อยแล้ว (${savedCount} กิจกรรม)`);
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูลบางรายการ'));
    } finally {
      setSavingAll(false);
    }
  };

  const handleAddCustom = async () => {
    if (!customTitle.trim()) return;
    setAddingCustom(true);
    setError('');
    setSuccess('');
    try {
      await api.post('/calendar', {
        semester_id: semesterId,
        activity_key: null,
        title: customTitle,
        date_kind: 'range' as CalendarDateKind,
        start_date: customDraft.start_date || null,
        end_date: customDraft.end_date || null,
        detail_text: customDraft.detail_text || null,
        note: customDraft.note || null,
      });
      setSuccess('เพิ่มกำหนดการเรียบร้อยแล้ว');
      setCustomTitle('');
      setCustomDraft(emptyDraft());
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถเพิ่มกำหนดการได้'));
    } finally {
      setAddingCustom(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setError('');
    setSuccess('');
    try {
      await api.delete(`/calendar/${target.event_id}`);
      setSuccess(
        target.isCustom
          ? `ลบกำหนดการ "${target.label}" เรียบร้อยแล้ว`
          : `ล้างช่วงเวลาของ "${target.label}" แล้ว — กิจกรรมนี้กลับไปเป็นไม่ล็อก`
      );
      await loadCalendar(semesterId, true);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถลบกำหนดการได้'));
    }
  };

  if (loading) return <PageSkeleton variant="table" />;

  return (
    <div className="max-w-[1360px] mx-auto space-y-4 pb-12">
      {/* 1. Header Bar matching CoopCalendar.dc.html */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            ปฏิทินสหกิจศึกษา
          </h1>
          <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">
            รายการกิจกรรมมาจากเซิร์ฟเวอร์ทั้งหมด — คุณกรอกได้แค่ <em className="italic font-semibold">วันที่</em> ตามชนิดที่กระดาษกำหนด · เพิ่มกิจกรรมของคณะเองได้ที่ท้ายตาราง
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="relative">
            <select
              id="calendar-semester"
              aria-label="เลือกภาคการศึกษา"
              value={semesterId ?? ''}
              onChange={(e) => setSemesterId(e.target.value ? Number(e.target.value) : null)}
              className="appearance-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-xl px-3.5 py-2.5 pr-8 text-sm font-bold shadow-sm cursor-pointer hover:bg-gray-50 focus:outline-none"
            >
              {semesters.length === 0 && <option value="">— ยังไม่มีภาคการศึกษา —</option>}
              {semesters.map((s) => (
                <option key={s.semester_id} value={s.semester_id}>
                  ภาคเรียนที่ {s.semester}/{s.academic_year} {s.is_active ? '(กำลังใช้งาน)' : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={savingAll}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow active:scale-95 transition-all disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {savingAll ? 'กำลังบันทึก...' : 'บันทึกทั้งหน้า'}
          </button>
        </div>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {!data?.semester && (
        <AlertBanner
          variant="info"
          message="ยังไม่มีภาคการศึกษาที่เปิดใช้งาน จึงยังกำหนดปฏิทินไม่ได้ กรุณาเปิดใช้งานภาคการศึกษาก่อน"
        />
      )}

      {/* 2. Fail-Open Warning Card matching CoopCalendar.dc.html */}
      <div className="border border-amber-300 dark:border-amber-800 bg-[#FFFBEB] dark:bg-amber-950/30 rounded-2xl p-4 sm:p-5 text-amber-900 dark:text-amber-200 shadow-sm space-y-2">
        <div className="text-sm font-bold text-amber-900 dark:text-amber-300">
          ช่องที่เว้นว่าง = ระบบยังไม่ล็อกขั้นตอนนั้น (fail-open โดยตั้งใจ)
        </div>
        <div className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-300/90">
          ปฏิทินเดาผิดแล้วปิดระบบใส่นักศึกษาทั้งรุ่น แย่กว่าปล่อยผ่าน — ปฏิทินจึงไม่ fail closed แบบด่านสิทธิ์ <strong className="font-bold">แต่ต้องไม่เงียบ</strong> หน้านี้และหน้าแรกจึงบอกเสมอว่าอันไหนยังว่าง<br />
          “วันนี้” ที่ใช้ตัดสินมาจากฐานข้อมูลตามเวลาไทยเสมอ ไม่ใช่นาฬิกาเบราว์เซอร์ — ตัวเลขที่นักศึกษาเห็นกับด่านที่ปฏิเสธคำขอจึงตอบตรงกัน
        </div>

        {/* Text required by e2e test coop-calendar.spec.ts */}
        {unconfigured.length > 0 && (
          <div className="pt-2 border-t border-amber-200/80 dark:border-amber-800/80 text-xs font-semibold text-amber-900 dark:text-amber-200">
            ⚠️ ยังไม่ได้ตั้งช่วงเวลา {unconfigured.length} กิจกรรม: {unconfigured.map((a) => a.label).join(' · ')}
            <br />
            ระหว่างที่ยังไม่ตั้ง ระบบเปิดให้นักศึกษาทำรายการได้ตามปกติ (ไม่ล็อก)
          </div>
        )}
      </div>

      {/* 3. Main Activities Table Card matching CoopCalendar.dc.html */}
      <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden">
        {/* Table Header */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-3 px-5 py-3.5 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300">
          <div className="lg:col-span-5">กิจกรรม</div>
          <div className="lg:col-span-1">ชนิดวันที่</div>
          <div className="lg:col-span-2">วันเริ่ม</div>
          <div className="lg:col-span-2">วันสิ้นสุด</div>
          <div className="lg:col-span-1">ผ่อนผันถึง</div>
          <div className="lg:col-span-1 text-center">สถานะวันนี้</div>
        </div>

        {/* List Items (uses <ul> and <li> to satisfy both table look & Playwright locator('li')) */}
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/60 m-0 p-0 list-none">
          {data?.activities.map((activity) => {
            const draft = drafts[activity.activity_key] ?? emptyDraft();
            const isSaving = savingKey === activity.activity_key;
            const isUnconfiguredAndLocks = activity.status === 'not_configured' && activity.locks;

            return (
              <li
                key={activity.activity_key}
                data-testid={`calendar-row-${activity.activity_key}`}
                className={`p-4 lg:px-5 lg:py-4 flex flex-col lg:grid lg:grid-cols-12 gap-3 lg:gap-3 lg:items-center transition-colors ${
                  isUnconfiguredAndLocks
                    ? 'bg-amber-50/40 dark:bg-amber-950/20'
                    : 'hover:bg-gray-50/60 dark:hover:bg-gray-700/30'
                }`}
              >
                {/* 1. กิจกรรม (col-span-5) */}
                <div className="lg:col-span-5 space-y-1">
                  <span className="text-[14px] font-bold text-gray-900 dark:text-white leading-snug block">
                    {activity.label}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activity.locks ? (
                      <span className="tag inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-[#FEE2E2] text-[#B91C1C] dark:bg-red-950/60 dark:text-red-300">
                        ล็อกจริง
                      </span>
                    ) : (
                      <span className="tag inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-[#F3F4F6] text-[#4B5563] dark:bg-gray-700 dark:text-gray-300">
                        หมุดบอกเวลา
                      </span>
                    )}

                    {activity.paper_row && (
                      <span className="hint text-[12px] text-gray-500 dark:text-gray-400">
                        {activity.paper_row}
                      </span>
                    )}
                    {activity.hint && (
                      <span className="hint text-[12px] text-gray-500 dark:text-gray-400">
                        · {activity.hint}
                      </span>
                    )}
                  </div>

                  {isUnconfiguredAndLocks && (
                    <div className="text-[12px] font-semibold text-[#92400E] dark:text-amber-400">
                      ยังไม่ได้ตั้ง — ตอนนี้นักศึกษาส่งได้ตลอด
                    </div>
                  )}

                  {/* Note Input (Preserves #note-<key> for tests/staff notes) */}
                  {!activity.derived && (
                    <div className="pt-1">
                      <input
                        type="text"
                        id={`note-${activity.activity_key}`}
                        value={draft.note}
                        onChange={(e) => setDraft(activity.activity_key, { note: e.target.value })}
                        placeholder="หมายเหตุ (ถ้ามี) เช่น ส่งที่ห้องงานสหกิจศึกษา..."
                        className="w-full max-w-sm text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>

                {/* 2. ชนิดวันที่ (col-span-1) */}
                <div className="lg:col-span-1 text-[13px] text-gray-600 dark:text-gray-300 font-medium">
                  <span className="lg:hidden text-xs text-gray-600 dark:text-gray-400 font-bold mr-1">ชนิด: </span>
                  {activity.derived ? 'ช่วง (สืบค่า)' : KIND_LABEL[activity.date_kind] || activity.date_kind}
                </div>

                {/* 3. วันเริ่ม (col-span-2) */}
                <div className="lg:col-span-2">
                  <span className="lg:hidden text-xs text-gray-600 dark:text-gray-400 font-bold mr-1">วันเริ่ม: </span>
                  {activity.date_kind === 'deadline' ? (
                    <span className="text-[12px] text-gray-600 dark:text-gray-400">— ไม่ต้องกรอก</span>
                  ) : activity.derived ? (
                    <span className="text-[12px] font-mono text-gray-600 dark:text-gray-300">
                      {activity.start_date || 'คำนวณอัตโนมัติ'}
                    </span>
                  ) : (
                    <input
                      type="date"
                      id={`start-${activity.activity_key}`}
                      data-testid={`calendar-start-${activity.activity_key}`}
                      value={draft.start_date}
                      onChange={(e) => setDraft(activity.activity_key, { start_date: e.target.value })}
                      className="inp w-full max-w-[135px] px-2.5 py-1.5 text-[13px] text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                </div>

                {/* 4. วันสิ้นสุด (col-span-2) */}
                <div className="lg:col-span-2">
                  <span className="lg:hidden text-xs text-gray-600 dark:text-gray-400 font-bold mr-1">วันสิ้นสุด: </span>
                  {activity.date_kind === 'single' ? (
                    <span className="text-[12px] text-gray-600 dark:text-gray-400">= วันเริ่ม</span>
                  ) : activity.derived ? (
                    <span className="text-[12px] font-mono text-gray-600 dark:text-gray-300">
                      {activity.end_date || 'คำนวณอัตโนมัติ'}
                    </span>
                  ) : (
                    <input
                      type="date"
                      id={`end-${activity.activity_key}`}
                      data-testid={`calendar-end-${activity.activity_key}`}
                      value={draft.end_date}
                      onChange={(e) => setDraft(activity.activity_key, { end_date: e.target.value })}
                      className={`inp w-full max-w-[135px] px-2.5 py-1.5 text-[13px] text-gray-900 dark:text-white bg-white dark:bg-gray-700 border rounded-lg focus:ring-1 focus:ring-blue-500 ${
                        isUnconfiguredAndLocks
                          ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/30'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    />
                  )}
                </div>

                {/* 5. ผ่อนผันถึง (col-span-1) */}
                <div className="lg:col-span-1">
                  <span className="lg:hidden text-xs text-gray-600 dark:text-gray-400 font-bold mr-1">ผ่อนผัน: </span>
                  {activity.derived ? (
                    <span className="hint text-[11px] text-gray-500 dark:text-gray-400">
                      ผ่อนผันที่แถว “วันสิ้นสุด”
                    </span>
                  ) : !activity.allow_late ? (
                    <span className="text-[12px] text-gray-600 dark:text-gray-400">—</span>
                  ) : (
                    <input
                      type="date"
                      id={`late-${activity.activity_key}`}
                      data-testid={`calendar-late-${activity.activity_key}`}
                      value={draft.late_end_date}
                      onChange={(e) => setDraft(activity.activity_key, { late_end_date: e.target.value })}
                      className="inp w-full max-w-[135px] px-2.5 py-1.5 text-[13px] text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-1 focus:ring-blue-500"
                    />
                  )}
                </div>

                {/* 6. สถานะวันนี้ & บันทึก (col-span-1) */}
                <div className="lg:col-span-1 flex flex-row lg:flex-col items-center lg:items-end justify-between gap-1.5">
                  {activity.status === 'not_configured' ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-[#FFFBEB] text-[#B45309] border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 whitespace-nowrap">
                      ยังไม่ได้ตั้ง
                    </span>
                  ) : activity.status === 'open' ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 whitespace-nowrap">
                      เปิดอยู่
                    </span>
                  ) : activity.status === 'upcoming' ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-[#EFF6FF] text-[#1E3A8A] border-[#BFDBFE] dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 whitespace-nowrap">
                      ยังไม่ถึง
                    </span>
                  ) : activity.status === 'late' ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 text-center">
                      {STATUS_TEXT.late}
                    </span>
                  ) : !activity.locks ? (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB] dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 whitespace-nowrap">
                      ไม่ล็อกอยู่แล้ว
                    </span>
                  ) : (
                    <span className="pill px-2.5 py-1 rounded-full text-[12px] font-bold border bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700 whitespace-nowrap">
                      {STATUS_TEXT[activity.status] || activity.status}
                    </span>
                  )}

                  {!activity.derived && (
                    <button
                      type="button"
                      onClick={() => handleSaveActivity(activity)}
                      disabled={isSaving}
                      data-testid="calendar-save"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all shadow-sm disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 4. Bottom Grid (2 Columns) matching CoopCalendar.dc.html */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Left: รายการอิสระของคณะ */}
        <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              รายการอิสระของคณะ
            </h3>
            <p className="hint text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">
              แถวบนกระดาษที่ระบบไม่ได้อ้างอิง — โผล่ในปฏิทินให้นักศึกษาเห็น แต่ไม่ล็อกอะไร
            </p>
          </div>

          <div className="space-y-2">
            {(data?.custom_events ?? []).length === 0 ? (
              <div className="text-xs text-gray-600 dark:text-gray-400 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                ยังไม่มีรายการอิสระของคณะในภาคการศึกษานี้
              </div>
            ) : (
              data?.custom_events.map((evt) => (
                <div
                  key={evt.event_id}
                  className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-center justify-between gap-3 bg-gray-50/50 dark:bg-gray-800/40"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {evt.title}
                    </div>
                    <div className="hint text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {evt.start_date && evt.start_date === evt.end_date
                        ? `วันเดียว · ${formatThaiDate(evt.start_date)}`
                        : evt.start_date && evt.end_date
                        ? formatThaiRange(evt.start_date, evt.end_date)
                        : evt.detail_text || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDelete({
                        event_id: evt.event_id,
                        label: evt.title,
                        isCustom: true,
                      })
                    }
                    className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 p-1.5 rounded-lg transition-colors"
                    title="ลบรายการ"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Form to add custom event */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50/40 dark:bg-gray-800/20 space-y-3">
            <div className="text-xs font-bold text-gray-700 dark:text-gray-300">
              เพิ่มรายการอิสระใหม่
            </div>
            <div className="space-y-2">
              <input
                id="custom-title"
                type="text"
                placeholder="ชื่อกำหนดการ เช่น ปฐมนิเทศนักศึกษาสหกิจศึกษา..."
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-300"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="custom-start" className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
                    วันเริ่ม
                  </label>
                  <input
                    id="custom-start"
                    type="date"
                    value={customDraft.start_date}
                    onChange={(e) => setCustomDraft({ ...customDraft, start_date: e.target.value })}
                    className="w-full text-xs px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label htmlFor="custom-end" className="block text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">
                    วันสิ้นสุด
                  </label>
                  <input
                    id="custom-end"
                    type="date"
                    value={customDraft.end_date}
                    onChange={(e) => setCustomDraft({ ...customDraft, end_date: e.target.value })}
                    className="w-full text-xs px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddCustom}
              disabled={addingCustom || !customTitle.trim()}
              data-testid="calendar-custom-add"
              className="btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {addingCustom ? 'กำลังเพิ่ม...' : 'เพิ่มกำหนดการ'}
            </button>
          </div>
        </div>

        {/* Right: สองอย่างที่หน้านี้ห้ามทำ */}
        <div className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            สองอย่างที่หน้านี้ห้ามทำ
          </h3>
          <div className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-300 space-y-3">
            <p>
              ⛔ <strong className="font-bold text-gray-900 dark:text-white">ห้ามให้เจ้าหน้าที่เพิ่ม “กิจกรรมที่ล็อกได้” เอง</strong> — รายการที่ล็อกจริงต้องมีโค้ดฝั่งเซิร์ฟเวอร์เรียกใช้ กิจกรรมที่ไม่มีใครเรียกคือคำสัญญาลอย ๆ ว่าระบบทำอะไรให้
            </p>
            <p>
              ⛔ <strong className="font-bold text-gray-900 dark:text-white">ห้ามกรอกวันเดียวกันลงทั้งช่องเริ่มและช่องสิ้นสุดของแถวชนิด “เส้นตาย”</strong> — จะกลับหัวจากกระดาษทันที (“ภายในวันที่ 10” จะกลายเป็น “เฉพาะวันที่ 10”) หน้าจอจึงปิดช่องวันเริ่มของแถวชนิดนี้ไปเลย
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="ยืนยันการลบกำหนดการ"
        message={`ต้องการลบ "${pendingDelete?.label}" หรือไม่?`}
        confirmLabel="ลบกำหนดการ"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

export default CoopCalendarManager;
