import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarDays, Plus, Trash2, Save, Eraser } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Input, Select } from '../../components/ui/Input';
import PageSkeleton from '../../components/ui/Skeleton';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate, formatThaiRange } from '../../utils/thaiDate';
import type {
  CalendarStatus,
  CoopCalendarActivity,
  CoopCalendarCustomEvent,
  CoopCalendarResponse,
  CoopCalendarSemester,
} from '../../types/api';

/**
 * ปฏิทินสหกิจศึกษาของเจ้าหน้าที่
 *
 * หน้านี้ไม่ใช่ "ที่ประกาศข่าว" — ประกาศประชาสัมพันธ์ยังอยู่ที่เมนูของมันเหมือนเดิม
 * ช่วงเวลาที่ตั้งตรงนี้ **ล็อกการทำรายการของนักศึกษาจริงที่เซิร์ฟเวอร์**
 * (`middlewares/calendarGate.ts`) นอกช่วงแล้วยิงเข้ามาจะได้ 403 ไม่ใช่แค่ปุ่มจาง
 *
 * กิจกรรมที่ยังไม่ได้ตั้งช่วง = ยังไม่ล็อก (fail-open) โดยตั้งใจ ไม่งั้นวันที่
 * อัปเกรดระบบนักศึกษาทั้งรุ่นจะทำอะไรไม่ได้เลยจนกว่าจะมีคนกรอกปฏิทินครบ
 * — แถบเตือนด้านบนจึงมีหน้าที่ทำให้ fail-open ไม่เงียบ
 */

/** ข้อความสถานะของหน้านี้ จงใจไม่ไปรวมกับ `ui/StatusBadge` ซึ่งเป็นคำแปล
 *  17 สถานะของเอกสารสหกิจ — key จะชนกันข้ามโดเมนแล้วได้ภาษาไทยที่ผิดอย่างมั่นใจ */
const STATUS_TEXT: Record<CalendarStatus, string> = {
  not_configured: 'ยังไม่ได้กำหนดช่วงเวลา (ระบบยังไม่ล็อก)',
  upcoming: 'ยังไม่ถึงกำหนด',
  open: 'เปิดให้ทำรายการอยู่ตอนนี้',
  late: 'อยู่ในช่วงผ่อนผัน (รับแต่นับเป็นส่งช้า)',
  closed: 'หมดช่วงแล้ว',
};

const STATUS_TONE: Record<CalendarStatus, string> = {
  not_configured:
    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  upcoming: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  open: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  late: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  closed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const StatusChip: React.FC<{ status: CalendarStatus }> = ({ status }) => (
  <span
    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}
  >
    {STATUS_TEXT[status]}
  </span>
);

/** ค่าที่กำลังพิมพ์อยู่ในแต่ละแถว ก่อนกดบันทึก */
interface DraftRow {
  start_date: string;
  end_date: string;
  late_end_date: string;
  note: string;
}

const emptyDraft = (): DraftRow => ({ start_date: '', end_date: '', late_end_date: '', note: '' });

const draftOf = (a: CoopCalendarActivity): DraftRow => ({
  start_date: a.start_date ?? '',
  end_date: a.end_date ?? '',
  late_end_date: a.late_end_date ?? '',
  note: a.note ?? '',
});

const CoopCalendarManager: React.FC = () => {
  const [semesters, setSemesters] = useState<CoopCalendarSemester[]>([]);
  const [semesterId, setSemesterId] = useState<number | null>(null);
  const [data, setData] = useState<CoopCalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  /** ร่างของกิจกรรมตายตัว เก็บแยกตาม activity_key */
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
    loadSemesters();
  }, [loadSemesters]);

  useEffect(() => {
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
        start_date: draft.start_date,
        end_date: draft.end_date,
        late_end_date: draft.late_end_date,
        note: draft.note,
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

  const handleAddCustom = async () => {
    setAddingCustom(true);
    setError('');
    setSuccess('');
    try {
      await api.post('/calendar', {
        semester_id: semesterId,
        activity_key: null,
        title: customTitle,
        start_date: customDraft.start_date,
        end_date: customDraft.end_date,
        note: customDraft.note,
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
    <div className="page-enter space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-white">
          <CalendarDays className="h-5 w-5 text-brand-blue dark:text-blue-400" />
          ปฏิทินสหกิจศึกษา
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          ช่วงเวลาที่กำหนดในหน้านี้มีผลจริง — เมื่อพ้นช่วง
          ระบบจะไม่รับรายการของนักศึกษาอีกและแจ้งให้ติดต่อเจ้าหน้าที่
          นักศึกษาจะเห็นช่วงที่กำลังเปิดอยู่บนหน้าแรกของตัวเอง
        </p>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <label
          htmlFor="calendar-semester"
          className="block text-sm font-medium text-gray-800 dark:text-gray-300"
        >
          ภาคการศึกษา
        </label>
        <Select
          id="calendar-semester"
          className="mt-2 sm:max-w-xs"
          value={semesterId ?? ''}
          onChange={(e) => setSemesterId(e.target.value ? Number(e.target.value) : null)}
        >
          {semesters.length === 0 && <option value="">— ยังไม่มีภาคการศึกษาในระบบ —</option>}
          {semesters.map((s) => (
            <option key={s.semester_id} value={s.semester_id}>
              ภาคเรียนที่ {s.semester}/{s.academic_year}
              {s.is_active ? ' (กำลังใช้งาน)' : ''}
            </option>
          ))}
        </Select>
      </div>

      {!data?.semester ? (
        <AlertBanner
          variant="info"
          message="ยังไม่มีภาคการศึกษาที่เปิดใช้งาน จึงยังกำหนดปฏิทินไม่ได้ กรุณาเปิดใช้งานภาคการศึกษาก่อน"
        />
      ) : (
        <>
          {unconfigured.length > 0 && (
            <AlertBanner
              variant="warning"
              message={
                <>
                  <span className="font-semibold">
                    ยังไม่ได้ตั้งช่วงเวลา {unconfigured.length} กิจกรรม:
                  </span>{' '}
                  {unconfigured.map((a) => a.label).join(' · ')}
                  <br />
                  ระหว่างที่ยังไม่ตั้ง ระบบเปิดให้นักศึกษาทำรายการได้ตามปกติ (ไม่ล็อก)
                  ถ้าต้องการควบคุมช่วงเวลา ให้กำหนดวันเริ่ม-วันสิ้นสุดด้านล่าง
                </>
              }
            />
          )}

          <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-200 p-5 dark:border-gray-800">
              <h3 className="font-bold text-gray-800 dark:text-white">
                กิจกรรมที่ระบบล็อกให้ได้
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                แต่ละกิจกรรมผูกกับหน้าจอของนักศึกษาจริง กำหนดได้ช่วงเดียวต่อภาคการศึกษา
              </p>
            </div>

            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {data.activities.map((activity) => {
                const draft = drafts[activity.activity_key] ?? emptyDraft();
                const isSaving = savingKey === activity.activity_key;
                const canSave = !!draft.start_date && !!draft.end_date && !isSaving;
                return (
                  <li key={activity.activity_key} className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-gray-800 dark:text-gray-100">
                        {activity.label}
                      </span>
                      <StatusChip status={activity.status} />
                    </div>

                    {activity.start_date && activity.end_date && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        ช่วงปัจจุบัน: {formatThaiRange(activity.start_date, activity.end_date)}
                        {activity.late_end_date && (
                          <span className="text-amber-700 dark:text-amber-400">
                            {' '}
                            · ผ่อนผันถึง {formatThaiDate(activity.late_end_date)}
                          </span>
                        )}
                      </p>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <label
                          htmlFor={`start-${activity.activity_key}`}
                          className="block text-xs font-medium text-gray-600 dark:text-gray-400"
                        >
                          วันเริ่ม
                        </label>
                        <Input
                          id={`start-${activity.activity_key}`}
                          type="date"
                          size="sm"
                          className="mt-1"
                          value={draft.start_date}
                          onChange={(e) =>
                            setDraft(activity.activity_key, { start_date: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`end-${activity.activity_key}`}
                          className="block text-xs font-medium text-gray-600 dark:text-gray-400"
                        >
                          วันสิ้นสุด
                        </label>
                        <Input
                          id={`end-${activity.activity_key}`}
                          type="date"
                          size="sm"
                          className="mt-1"
                          value={draft.end_date}
                          onChange={(e) =>
                            setDraft(activity.activity_key, { end_date: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`late-${activity.activity_key}`}
                          className="block text-xs font-medium text-gray-600 dark:text-gray-400"
                        >
                          ผ่อนผันถึง (ถ้ามี)
                        </label>
                        <Input
                          id={`late-${activity.activity_key}`}
                          type="date"
                          size="sm"
                          className="mt-1"
                          value={draft.late_end_date}
                          onChange={(e) =>
                            setDraft(activity.activity_key, { late_end_date: e.target.value })
                          }
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          ไม่กรอก = ปิดจริงตามวันสิ้นสุด · กรอกแล้วระบบยังรับถึงวันนี้
                          แต่นับเป็นส่งช้าและบังคับให้ชี้แจงเหตุผล
                        </p>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-3">
                        <label
                          htmlFor={`note-${activity.activity_key}`}
                          className="block text-xs font-medium text-gray-600 dark:text-gray-400"
                        >
                          หมายเหตุ (ถ้ามี)
                        </label>
                        <Input
                          id={`note-${activity.activity_key}`}
                          type="text"
                          size="sm"
                          className="mt-1"
                          placeholder="เช่น ส่งที่ห้องงานสหกิจศึกษา ชั้น 2"
                          value={draft.note}
                          onChange={(e) => setDraft(activity.activity_key, { note: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={!canSave}
                        onClick={() => handleSaveActivity(activity)}
                      >
                        <Save className="mr-1.5 h-3.5 w-3.5" />
                        {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                      </Button>
                      {activity.event_id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setPendingDelete({
                              event_id: activity.event_id as number,
                              label: activity.label,
                              isCustom: false,
                            })
                          }
                        >
                          <Eraser className="mr-1.5 h-3.5 w-3.5" />
                          ล้างช่วงเวลา
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-200 p-5 dark:border-gray-800">
              <h3 className="font-bold text-gray-800 dark:text-white">กำหนดการอื่นที่เพิ่มเอง</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                รายการอิสระแสดงในปฏิทินของนักศึกษาเท่านั้น ไม่มีผลล็อกการทำรายการใดๆ
                เหมาะกับวันปฐมนิเทศ ช่วงออกปฏิบัติงาน หรือวันนำเสนอผลงาน
              </p>
            </div>

            <div className="grid gap-3 border-b border-gray-200 p-5 dark:border-gray-800 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <label
                  htmlFor="custom-title"
                  className="block text-xs font-medium text-gray-600 dark:text-gray-400"
                >
                  ชื่อกำหนดการ
                </label>
                <Input
                  id="custom-title"
                  type="text"
                  size="sm"
                  className="mt-1"
                  placeholder="เช่น ปฐมนิเทศนักศึกษาสหกิจศึกษา"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="custom-start"
                  className="block text-xs font-medium text-gray-600 dark:text-gray-400"
                >
                  วันเริ่ม
                </label>
                <Input
                  id="custom-start"
                  type="date"
                  size="sm"
                  className="mt-1"
                  value={customDraft.start_date}
                  onChange={(e) =>
                    setCustomDraft((p) => ({ ...p, start_date: e.target.value }))
                  }
                />
              </div>
              <div>
                <label
                  htmlFor="custom-end"
                  className="block text-xs font-medium text-gray-600 dark:text-gray-400"
                >
                  วันสิ้นสุด
                </label>
                <Input
                  id="custom-end"
                  type="date"
                  size="sm"
                  className="mt-1"
                  value={customDraft.end_date}
                  onChange={(e) => setCustomDraft((p) => ({ ...p, end_date: e.target.value }))}
                />
              </div>
              <div className="lg:col-span-4">
                <Button
                  size="sm"
                  disabled={
                    !customTitle.trim() ||
                    !customDraft.start_date ||
                    !customDraft.end_date ||
                    addingCustom
                  }
                  onClick={handleAddCustom}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {addingCustom ? 'กำลังเพิ่ม...' : 'เพิ่มกำหนดการ'}
                </Button>
              </div>
            </div>

            {data.custom_events.length === 0 ? (
              <p className="p-5 text-sm text-gray-600 dark:text-gray-400">
                ยังไม่มีกำหนดการที่เพิ่มเองในภาคการศึกษานี้
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-800">
                {data.custom_events.map((ev: CoopCalendarCustomEvent) => (
                  <li
                    key={ev.event_id}
                    className="flex flex-wrap items-center justify-between gap-3 p-5"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 dark:text-gray-100">{ev.title}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {formatThaiRange(ev.start_date, ev.end_date)}
                        {ev.note ? ` · ${ev.note}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusChip status={ev.status} />
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          setPendingDelete({
                            event_id: ev.event_id,
                            label: ev.title,
                            isCustom: true,
                          })
                        }
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        ลบ
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          destructive
          title={pendingDelete.isCustom ? 'ยืนยันการลบกำหนดการ' : 'ยืนยันการล้างช่วงเวลา'}
          message={
            pendingDelete.isCustom
              ? `ต้องการลบกำหนดการ "${pendingDelete.label}" ออกจากปฏิทินใช่หรือไม่`
              : `ต้องการล้างช่วงเวลาของ "${pendingDelete.label}" ใช่หรือไม่ — เมื่อล้างแล้วกิจกรรมนี้จะกลับไปเป็นไม่ล็อก นักศึกษาจะทำรายการได้ตลอดเวลา`
          }
          confirmLabel={pendingDelete.isCustom ? 'ลบกำหนดการ' : 'ล้างช่วงเวลา'}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default CoopCalendarManager;
