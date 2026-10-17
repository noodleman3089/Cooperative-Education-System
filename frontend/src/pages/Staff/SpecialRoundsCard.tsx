import React, { useState } from 'react';
import { Plus, Trash2, Pencil, Search, X } from 'lucide-react';
import api from '../../services/api';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiRange } from '../../utils/thaiDate';
import type {
  ApprovedMemoForRound,
  CalendarStatus,
  CoopCalendarActivity,
  CoopSpecialRound,
  CoopSpecialRoundStudent,
} from '../../types/api';

/**
 * รอบพิเศษ — เจ้าหน้าที่เปิดให้ "นักศึกษาที่เลือกรายคน" ส่งกิจกรรมที่ติ๊กไว้ได้แม้ช่วงปกติปิดแล้ว
 * (แทนขั้นตอนกระดาษ: นักศึกษา → อาจารย์ที่ปรึกษา → หัวหน้าสาขา → คณะ) · ช่วงปกติไม่ถูกแตะ
 *
 * ที่ส่งในรอบนี้ **นับเป็นส่งช้า** (ต้องชี้แจงเหตุผลเหมือนช่วงผ่อนผัน) — ด่านอยู่ที่ `middlewares/calendarGate.ts`
 * รายการกิจกรรมที่ติ๊กได้มาจากเซิร์ฟเวอร์ (`locks` และไม่ใช่ `derived`) ฝั่งนี้ไม่ประกาศรายการซ้ำ
 */

/** ชื่อสั้นของกิจกรรมในช่องติ๊ก — label จริงของบางตัวยาวเป็นประโยค · กิจกรรมใหม่ที่ไม่อยู่ในนี้ใช้ label เต็มแทน */
const SHORT_LABEL: Record<string, string> = {
  intent_submission: 'ส่งคำร้องขอหนังสือ (เอกสาร 1)',
  acceptance_form: 'ส่งแบบตอบรับ (เอกสาร 2)',
  accommodation_plan: 'ส่งข้อมูลที่พัก (สหกิจ 06)',
  report_outline: 'ส่งโครงร่าง (สหกิจ 11)',
  final_report: 'ส่งรายงานฉบับสมบูรณ์',
};

const STATUS_TEXT: Partial<Record<CalendarStatus, string>> = {
  upcoming: 'ยังไม่ถึง',
  open: 'กำลังเปิด',
  closed: 'ปิดแล้ว',
};

const STATUS_STYLE: Partial<Record<CalendarStatus, string>> = {
  upcoming: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  open: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  closed: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

interface Props {
  semesterId: number | null;
  activities: CoopCalendarActivity[];
  rounds: CoopSpecialRound[];
  /** โหลดปฏิทินใหม่หลังบันทึก/ลบ */
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

const nameOf = (s: CoopSpecialRoundStudent) => `${s.first_name} ${s.last_name}`.trim();

const SpecialRoundsCard: React.FC<Props> = ({
  semesterId,
  activities,
  rounds,
  onChanged,
  onError,
  onSuccess,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [keys, setKeys] = useState<string[]>([]);
  const [students, setStudents] = useState<CoopSpecialRoundStudent[]>([]);

  const [term, setTerm] = useState('');
  const [results, setResults] = useState<CoopSpecialRoundStudent[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  // บันทึกข้อความที่คณบดีอนุมัติแล้ว (ออกก่อนกำหนด · ส่งเอกสารล่าช้า) — null = ยังไม่ได้เปิดดู
  const [memos, setMemos] = useState<ApprovedMemoForRound[] | null>(null);
  const [loadingMemos, setLoadingMemos] = useState(false);

  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CoopSpecialRound | null>(null);

  // กิจกรรมที่เปิดรอบพิเศษได้ = ล็อกจริงและไม่ใช่ช่วงที่คำนวณจากกิจกรรมอื่น (ตรงกับที่เซิร์ฟเวอร์ตรวจ)
  const roundable = activities.filter((a) => a.locks && !a.derived);
  const labelOf = (key: string) =>
    SHORT_LABEL[key] ?? activities.find((a) => a.activity_key === key)?.label ?? key;

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setStartDate('');
    setEndDate('');
    setNote('');
    setKeys([]);
    setStudents([]);
    setTerm('');
    setResults([]);
    setSearched(false);
  };

  const startEdit = (round: CoopSpecialRound) => {
    setEditingId(round.round_id);
    setTitle(round.title);
    setStartDate(round.start_date);
    setEndDate(round.end_date);
    setNote(round.note ?? '');
    setKeys(round.activity_keys);
    setStudents(round.students ?? []);
    document.getElementById('special-round-form')?.scrollIntoView({ block: 'nearest' });
  };

  const toggleKey = (key: string) =>
    setKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const runSearch = async () => {
    if (term.trim().length < 2) {
      onError('พิมพ์รหัสหรือชื่ออย่างน้อย 2 ตัวอักษรก่อนค้นหา');
      return;
    }
    setSearching(true);
    try {
      const found = (await api.get(
        `/calendar/special-rounds/students?q=${encodeURIComponent(term.trim())}`
      )) as CoopSpecialRoundStudent[];
      setResults(found);
      setSearched(true);
    } catch (err) {
      onError(getErrorMessage(err, 'ค้นหานักศึกษาไม่สำเร็จ'));
    } finally {
      setSearching(false);
    }
  };

  const loadMemos = async () => {
    setLoadingMemos(true);
    try {
      const qs = semesterId ? `?semester_id=${semesterId}` : '';
      setMemos((await api.get(`/calendar/special-rounds/memos${qs}`)) as ApprovedMemoForRound[]);
    } catch (err) {
      onError(getErrorMessage(err, 'ดึงบันทึกข้อความที่อนุมัติไม่สำเร็จ'));
    } finally {
      setLoadingMemos(false);
    }
  };

  const addStudent = (s: CoopSpecialRoundStudent) =>
    setStudents((prev) => (prev.some((p) => p.student_id === s.student_id) ? prev : [...prev, s]));

  const validate = (): string | null => {
    if (!title.trim()) return 'กรุณาระบุชื่อรอบพิเศษ';
    if (!startDate || !endDate) return 'กรุณาระบุวันเริ่มและวันสิ้นสุดของรอบ';
    if (endDate < startDate) return 'วันสิ้นสุดของรอบต้องไม่มาก่อนวันเริ่ม';
    if (keys.length === 0) return 'กรุณาเลือกกิจกรรมที่เปิดให้ส่งอย่างน้อย 1 รายการ';
    if (students.length === 0) return 'กรุณาเลือกนักศึกษาที่ใช้รอบนี้อย่างน้อย 1 คน';
    return null;
  };

  const handleSave = async () => {
    setConfirmSave(false);
    setSaving(true);
    onError('');
    onSuccess('');
    const body = {
      semester_id: semesterId,
      title: title.trim(),
      start_date: startDate,
      end_date: endDate,
      note: note.trim() || null,
      activity_keys: keys,
      student_ids: students.map((s) => s.student_id),
    };
    try {
      if (editingId === null) await api.post('/calendar/special-rounds', body);
      else await api.put(`/calendar/special-rounds/${editingId}`, body);
      onSuccess(
        editingId === null
          ? `เปิดรอบพิเศษ "${body.title}" ให้นักศึกษา ${students.length} คนเรียบร้อยแล้ว`
          : `แก้ไขรอบพิเศษ "${body.title}" เรียบร้อยแล้ว`
      );
      resetForm();
      await onChanged();
    } catch (err) {
      onError(getErrorMessage(err, 'ไม่สามารถบันทึกรอบพิเศษได้'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    onError('');
    onSuccess('');
    try {
      await api.delete(`/calendar/special-rounds/${target.round_id}`);
      if (editingId === target.round_id) resetForm();
      onSuccess(`ลบรอบพิเศษ "${target.title}" เรียบร้อยแล้ว — นักศึกษาในรอบนี้กลับไปโดนด่านปฏิทินปกติ`);
      await onChanged();
    } catch (err) {
      onError(getErrorMessage(err, 'ไม่สามารถลบรอบพิเศษได้'));
    }
  };

  const inputCls =
    'w-full text-xs px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-300';

  return (
    <div
      id="special-rounds"
      data-testid="special-rounds"
      className="card bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm space-y-4"
    >
      <div>
        <h3 className="text-base font-bold text-gray-900 dark:text-white">
          รอบพิเศษ (ปลดล็อกให้นักศึกษาที่เลือกส่งงานนอกช่วง)
        </h3>
        <p className="hint text-[12px] text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">
          ใช้กับนักศึกษาที่คณะตกลงให้ส่งนอกช่วงปกติ — เลือกได้ว่าเปิดกิจกรรมไหน ในช่วงวันไหน ให้ใครบ้าง
          · ช่วงปกติไม่ถูกแก้ · ผ่านด่านได้ทั้งก่อนช่วงเปิด (ออกปฏิบัติงานก่อนกำหนด{' '}
          <strong className="font-bold">ไม่นับส่งช้า</strong>) และหลังช่วงปิด (<strong className="font-bold">นับเป็นส่งช้า</strong> ต้องชี้แจงเหตุผล)
        </p>
      </div>

      <div className="space-y-2">
        {rounds.length === 0 ? (
          <div className="text-xs text-gray-600 dark:text-gray-400 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
            ยังไม่มีรอบพิเศษในภาคการศึกษานี้
          </div>
        ) : (
          rounds.map((r) => (
            <div
              key={r.round_id}
              data-testid="special-round-row"
              className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-start justify-between gap-3 bg-gray-50/50 dark:bg-gray-800/40"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white break-words">{r.title}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status] ?? ''}`}
                  >
                    {STATUS_TEXT[r.status] ?? r.status}
                  </span>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  {formatThaiRange(r.start_date, r.end_date)} · นักศึกษา {r.students?.length ?? 0} คน
                </div>
                <div className="text-xs text-gray-700 dark:text-gray-300">
                  เปิดให้ส่ง: {r.activity_keys.map(labelOf).join(' · ')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  title="แก้ไขรอบ"
                  aria-label={`แก้ไขรอบ ${r.title}`}
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(r)}
                  className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                  title="ลบรอบ"
                  aria-label={`ลบรอบ ${r.title}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div
        id="special-round-form"
        className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50/40 dark:bg-gray-800/20 space-y-3"
      >
        <div className="text-xs font-bold text-gray-700 dark:text-gray-300">
          {editingId === null ? 'เปิดรอบพิเศษใหม่' : 'แก้ไขรอบพิเศษ'}
        </div>

        <input
          type="text"
          aria-label="ชื่อรอบพิเศษ"
          placeholder="ชื่อรอบ เช่น รอบพิเศษส่งคำร้อง ตุลาคม 2569"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="special-round-title"
          className={inputCls}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label htmlFor="special-start" className="block text-[11px] text-gray-600 dark:text-gray-400 mb-0.5">
              วันเริ่มของรอบ
            </label>
            <input
              id="special-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="special-end" className="block text-[11px] text-gray-600 dark:text-gray-400 mb-0.5">
              วันสิ้นสุดของรอบ
            </label>
            <input
              id="special-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <fieldset className="space-y-1.5">
          <legend className="text-[11px] text-gray-600 dark:text-gray-400 mb-0.5">
            กิจกรรมที่เปิดให้ส่งในรอบนี้
          </legend>
          {roundable.map((a) => (
            <label
              key={a.activity_key}
              className="flex items-center gap-2 text-xs text-gray-800 dark:text-gray-200 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={keys.includes(a.activity_key)}
                onChange={() => toggleKey(a.activity_key)}
                data-testid={`special-round-activity-${a.activity_key}`}
              />
              {labelOf(a.activity_key)}
            </label>
          ))}
        </fieldset>

        <div className="space-y-2">
          <div className="text-[11px] text-gray-600 dark:text-gray-400">
            นักศึกษาที่ใช้รอบนี้ ({students.length} คน)
          </div>
          {students.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {students.map((s) => (
                <li
                  key={s.student_id}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-900 dark:bg-blue-950/60 dark:text-blue-200"
                >
                  {s.student_code} {nameOf(s)}
                  <button
                    type="button"
                    onClick={() => setStudents((prev) => prev.filter((p) => p.student_id !== s.student_id))}
                    aria-label={`เอา ${s.student_code} ออกจากรอบ`}
                    className="rounded-full hover:bg-blue-200 dark:hover:bg-blue-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="ค้นหานักศึกษาด้วยรหัสหรือชื่อ"
              placeholder="ค้นหาด้วยรหัสหรือชื่อนักศึกษา"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              data-testid="special-round-search"
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={searching}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold text-gray-800 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <Search className="w-3.5 h-3.5" />
              ค้นหา
            </button>
          </div>
          <div className="rounded-lg border border-dashed border-gray-300 p-2.5 dark:border-gray-600">
            <button
              type="button"
              onClick={() => void loadMemos()}
              disabled={loadingMemos}
              data-testid="special-round-import-memos"
              className="text-xs font-bold text-brand-blue underline disabled:opacity-50 dark:text-blue-400"
            >
              {loadingMemos ? 'กำลังโหลด…' : 'นำเข้าจากบันทึกข้อความที่คณบดีอนุมัติแล้ว'}
            </button>
            {memos !== null && memos.length === 0 && (
              <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
                ยังไม่มีบันทึก (ออกก่อนกำหนด · ส่งเอกสารล่าช้า) ที่คณบดีอนุมัติในภาคนี้
              </p>
            )}
            {memos !== null && memos.length > 0 && (
              <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700">
                {memos.map((m) => {
                  const added = students.some((p) => p.student_id === m.student_id);
                  return (
                    <li key={m.memo_id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="min-w-0 text-gray-800 dark:text-gray-200">
                        {m.student_code} · {`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()}
                        <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                          {m.memo_type === 'early_departure' ? 'ออกก่อนกำหนด' : 'ส่งเอกสารล่าช้า'}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={added}
                        data-testid={`special-round-add-memo-${m.memo_id}`}
                        onClick={() =>
                          addStudent({
                            student_id: m.student_id,
                            student_code: m.student_code ?? '',
                            first_name: m.first_name ?? '',
                            last_name: m.last_name ?? '',
                          })
                        }
                        className="shrink-0 rounded px-2 py-0.5 font-bold text-brand-blue underline disabled:no-underline disabled:text-gray-500 dark:text-blue-400"
                      >
                        {added ? 'เลือกแล้ว' : 'เพิ่ม'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {searched && results.length === 0 && (
            <p className="text-xs text-gray-600 dark:text-gray-400">ไม่พบนักศึกษาที่ตรงกับคำค้น</p>
          )}
          {results.length > 0 && (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700">
              {results.map((s) => {
                const added = students.some((p) => p.student_id === s.student_id);
                return (
                  <li key={s.student_id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                    <span className="text-gray-800 dark:text-gray-200">
                      {s.student_code} · {nameOf(s)}
                    </span>
                    <button
                      type="button"
                      onClick={() => addStudent(s)}
                      disabled={added}
                      data-testid={`special-round-add-${s.student_code}`}
                      className="rounded px-2 py-0.5 font-bold text-brand-blue underline disabled:no-underline disabled:text-gray-500 dark:text-blue-400"
                    >
                      {added ? 'เลือกแล้ว' : 'เพิ่ม'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <textarea
          aria-label="หมายเหตุของรอบ"
          placeholder="หมายเหตุ (ไม่บังคับ) เช่น ตามมติที่ประชุมวันที่…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={inputCls}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const problem = validate();
              if (problem) onError(problem);
              else setConfirmSave(true);
            }}
            disabled={saving}
            data-testid="special-round-save"
            className="btn inline-flex items-center gap-1.5 pointer-coarse:min-h-11 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            {saving ? 'กำลังบันทึก...' : editingId === null ? 'เปิดรอบพิเศษ' : 'บันทึกการแก้ไข'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              ยกเลิกการแก้ไข
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmSave}
        level={1}
        title={editingId === null ? 'ยืนยันการเปิดรอบพิเศษ' : 'ยืนยันการแก้ไขรอบพิเศษ'}
        message={`รอบ "${title.trim()}" (${startDate && endDate ? formatThaiRange(startDate, endDate) : ''}) จะให้นักศึกษา ${students.length} คน ส่ง: ${keys
          .map(labelOf)
          .join(' · ')} ได้นอกช่วงปกติ · ส่งก่อนช่วงเปิดไม่นับส่งช้า · ส่งหลังช่วงปิดนับเป็นส่งช้า`}
        confirmLabel={editingId === null ? 'เปิดรอบพิเศษ' : 'บันทึกการแก้ไข'}
        onConfirm={() => void handleSave()}
        onCancel={() => setConfirmSave(false)}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        level={1}
        title="ยืนยันการลบรอบพิเศษ"
        message={`ลบรอบ "${pendingDelete?.title}" — นักศึกษา ${pendingDelete?.students?.length ?? 0} คนในรอบนี้จะกลับไปโดนด่านปฏิทินปกติทันที (ที่ส่งไปแล้วไม่ถูกยกเลิก)`}
        confirmLabel="ลบรอบพิเศษ"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

export default SpecialRoundsCard;
