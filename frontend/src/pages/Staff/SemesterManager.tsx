import React, { useCallback, useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import EmptyState from '../../components/ui/EmptyState';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import PageSkeleton from '../../components/ui/Skeleton';
import { Input, Select } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';
import { semesterLabel } from '../../utils/semesterLabel';
import SemesterCohortModal from './SemesterCohortModal';

/**
 * ภาคเรียน — สร้าง · เปิด · ปิด (เจ้าหน้าที่) · แผน `.system_memory/design_semester_lifecycle.md` เฟส 0
 *
 * ⛔ ตัวเลขทุกตัวมาจากเซิร์ฟเวอร์ (`GET /api/semesters`) และเป็น **คำเตือน ไม่ใช่ตัวขวาง**
 * ⛔ ปิดภาคไม่ลบ ไม่ย้าย ไม่เปลี่ยนสถานะใบ — ใบที่ค้างอยู่ตามเดิมและยังขึ้นในคิวเจ้าหน้าที่
 */

interface SemesterRow {
  semester_id: number;
  academic_year: number;
  semester: string;
  label: string;
  is_active: boolean;
  closed_at: string | null;
  open_forms: number;
  accepted_forms: number;
  evaluations_missing: number;
  reports_pending: number;
  cohort_total: number;
  calendar_unset: string[];
}

type Pending = { kind: 'activate' | 'close'; row: SemesterRow } | null;

const TERM_OPTIONS = [
  { value: '1', label: 'ภาคเรียนที่ 1' },
  { value: '2', label: 'ภาคเรียนที่ 2' },
  { value: '3', label: 'ภาคฤดูร้อน' },
];

const stateOf = (r: SemesterRow): { text: string; cls: string } =>
  r.is_active
    ? { text: 'เปิดรับอยู่', cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300' }
    : r.closed_at
      ? {
          text: `ปิดแล้ว ${formatThaiDate(r.closed_at.slice(0, 10))}`,
          cls: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
        }
      : { text: 'ยังไม่ได้เปิด / หยุดรับแล้ว', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300' };

const SemesterManager: React.FC = () => {
  const [rows, setRows] = useState<SemesterRow[] | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [year, setYear] = useState('');
  const [term, setTerm] = useState('1');
  const [copyFrom, setCopyFrom] = useState('');
  const [shiftYear, setShiftYear] = useState(false);
  const [formError, setFormError] = useState('');
  const [cohortOf, setCohortOf] = useState<SemesterRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = (await api.get('/semesters')) as { semesters: SemesterRow[] };
      setRows(res.semesters);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถโหลดรายการภาคเรียนได้'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (rows === null && !error) return <PageSkeleton variant="table" />;

  const active = rows?.find((r) => r.is_active) ?? null;

  const openCreate = () => {
    const latest = rows?.[0];
    setYear(String(latest ? latest.academic_year + 1 : new Date().getFullYear() + 543));
    setTerm('1');
    setCopyFrom(latest ? String(latest.semester_id) : '');
    setShiftYear(false);
    setFormError('');
    setCreating(true);
  };

  const submitCreate = async () => {
    setBusy(true);
    setFormError('');
    try {
      const res = (await api.post('/semesters', {
        academic_year: Number(year),
        semester: term,
        copy_from: copyFrom ? Number(copyFrom) : null,
        shift_year: shiftYear,
      })) as { copied_events: number };
      setCreating(false);
      setSuccess(
        `สร้าง${semesterLabel(term, Number(year))}แล้ว (ยังไม่เปิด)` +
          (copyFrom ? ` · คัดลอกปฏิทิน ${res.copied_events} รายการ` : '')
      );
      await load();
    } catch (err) {
      setFormError(getErrorMessage(err, 'สร้างภาคเรียนไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/semesters/${pending.row.semester_id}/${pending.kind}`);
      setSuccess(
        pending.kind === 'activate'
          ? `เปิด${pending.row.label}แล้ว`
          : `ปิด${pending.row.label}แล้ว — ใบที่ค้างอยู่ตามเดิม`
      );
      setPending(null);
      await load();
    } catch (err) {
      setPending(null);
      setError(getErrorMessage(err, 'ทำรายการไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  const confirmBody = () => {
    if (!pending) return null;
    const r = pending.row;
    if (pending.kind === 'activate') {
      return (
        <ConfirmSummary
          lead={
            active
              ? `เปิด${r.label} — ${active.label} จะหยุดรับ แต่ใบที่ค้างอยู่ยังอยู่ในคิวตามเดิม`
              : `เปิด${r.label} — ตอนนี้ยังไม่มีภาคที่เปิดรับอยู่`
          }
          rows={[
            ...(active
              ? [
                  { label: `ใบที่ยังค้างใน ${active.label}`, value: `${active.open_forms} ใบ (ไม่ถูกแตะ)` },
                  { label: `ตอบรับแล้วใน ${active.label}`, value: `${active.accepted_forms} ใบ (ยังฝึก/ประเมินต่อได้)` },
                ]
              : []),
            { label: `รายชื่อรุ่นของ ${r.label}`, value: `${r.cohort_total} คน` },
            {
              label: 'กิจกรรมในปฏิทินที่ยังไม่ตั้งวันปิด',
              value: r.calendar_unset.length > 0 ? `${r.calendar_unset.length} กิจกรรม (ยังไม่ล็อกใคร)` : 'ตั้งครบแล้ว',
            },
          ]}
        />
      );
    }
    return (
      <ConfirmSummary
        lead={
          r.is_active
            ? `ปิด${r.label} — จะไม่มีภาคที่เปิดรับจนกว่าจะเปิดภาคใหม่ ใบที่ค้างอยู่ตามเดิมและยังขึ้นในคิวเจ้าหน้าที่`
            : `ปิด${r.label} — ใบที่ค้างอยู่ตามเดิม ไม่เปลี่ยนสถานะ ไม่ย้ายภาค`
        }
        rows={[
          { label: 'ใบที่ยังรอผล (ยังไม่ตอบรับ/ไม่ถูกปฏิเสธ)', value: `${r.open_forms} ใบ` },
          { label: 'ตอบรับแล้วแต่ผลประเมินยังไม่ครบ 2 ใบ', value: `${r.evaluations_missing} คน` },
          { label: 'ตอบรับแล้วแต่เล่มรายงานยังไม่อนุมัติ', value: `${r.reports_pending} คน` },
        ]}
        lockNote="ตัวเลขเหล่านี้เป็นคำเตือน ไม่ได้ขวางการปิดภาค"
      />
    );
  };

  return (
    <div className="space-y-5 page-enter" data-testid="semester-manager">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">ภาคเรียน</h1>
          <p className="max-w-2xl text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
            สร้างภาคใหม่ · เปิดรับคำร้องของภาคนั้น · ปิดภาคเมื่อจบ — การเปิด/ปิดไม่ลบข้อมูลและไม่เปลี่ยนสถานะใบที่ค้างอยู่
          </p>
        </div>
        <Button onClick={openCreate} data-testid="semester-create-open">
          สร้างภาคเรียนใหม่
        </Button>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {rows && rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="ยังไม่มีภาคเรียน"
          description="กด “สร้างภาคเรียนใหม่” แล้วเปิดภาคนั้นเพื่อให้นักศึกษายื่นคำร้องได้"
        />
      ) : (
        <ul className="space-y-3">
          {rows?.map((r) => {
            const st = stateOf(r);
            return (
              <li
                key={r.semester_id}
                data-testid={`semester-row-${r.semester_id}`}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">{r.label}</h2>
                    <span
                      data-testid={`semester-state-${r.semester_id}`}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${st.cls}`}
                    >
                      {st.text}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      data-testid={`semester-cohort-${r.semester_id}`}
                      onClick={() => setCohortOf(r)}
                    >
                      รายชื่อรุ่น
                    </Button>
                    {!r.is_active && (
                      <Button
                        size="sm"
                        data-testid={`semester-activate-${r.semester_id}`}
                        onClick={() => setPending({ kind: 'activate', row: r })}
                      >
                        {r.closed_at ? 'เปิดอีกครั้ง' : 'เปิดภาคนี้'}
                      </Button>
                    )}
                    {!r.closed_at && (
                      <Button
                        size="sm"
                        variant="secondary"
                        data-testid={`semester-close-${r.semester_id}`}
                        onClick={() => setPending({ kind: 'close', row: r })}
                      >
                        ปิดภาค
                      </Button>
                    )}
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-700 dark:text-gray-300 sm:grid-cols-4">
                  <div>
                    <dt className="text-gray-600 dark:text-gray-400">ใบที่ยังรอผล</dt>
                    <dd className="text-base font-extrabold tabular-nums">{r.open_forms}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-600 dark:text-gray-400">ตอบรับแล้ว</dt>
                    <dd className="text-base font-extrabold tabular-nums">{r.accepted_forms}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-600 dark:text-gray-400">รายชื่อรุ่น</dt>
                    <dd className="text-base font-extrabold tabular-nums">{r.cohort_total} คน</dd>
                  </div>
                  <div>
                    <dt className="text-gray-600 dark:text-gray-400">ปฏิทินที่ยังไม่ตั้งวันปิด</dt>
                    <dd className="text-base font-extrabold tabular-nums">{r.calendar_unset.length} กิจกรรม</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'activate' ? `เปิด${pending.row.label}` : `ปิด${pending?.row.label ?? ''}`}
        message={confirmBody()}
        confirmLabel={pending?.kind === 'activate' ? 'เปิดภาคนี้' : 'ปิดภาค'}
        confirmTestId="semester-confirm"
        busy={busy}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />

      {cohortOf && rows && (
        <SemesterCohortModal
          semester={cohortOf}
          all={rows}
          onClose={() => setCohortOf(null)}
          onChanged={load}
        />
      )}

      {creating && (
        <Modal onClose={() => setCreating(false)} size="lg" title="สร้างภาคเรียนใหม่">
          <ModalBody className="space-y-4">
            <AlertBanner variant="error" message={formError} />
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
                ปีการศึกษา (พ.ศ.)
                <Input
                  type="number"
                  inputMode="numeric"
                  min={2500}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  data-testid="semester-create-year"
                />
              </label>
              <label className="space-y-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
                ภาค
                <Select value={term} onChange={(e) => setTerm(e.target.value)} data-testid="semester-create-term">
                  {TERM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <label className="block space-y-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
              คัดลอกปฏิทินจาก
              <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} data-testid="semester-create-copy">
                <option value="">ไม่คัดลอก</option>
                {rows?.map((r) => (
                  <option key={r.semester_id} value={r.semester_id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
            {copyFrom && (
              <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={shiftYear}
                  onChange={(e) => setShiftYear(e.target.checked)}
                  data-testid="semester-create-shift"
                />
                <span>
                  เลื่อนวันที่ไป +1 ปี ด้วย
                  <span className="block text-xs text-gray-600 dark:text-gray-400">
                    ถ้าไม่เลือก จะคัดลอกเฉพาะข้อความอ้างอิงที่ไม่มีวัน — ปฏิทินคณะเปลี่ยนทุกปี ให้ตั้งวันเองที่หน้า “ปฏิทินสหกิจศึกษา”
                    (กิจกรรมที่ยังไม่ตั้งวันจะไม่ล็อกใคร)
                  </span>
                </span>
              </label>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              ยกเลิก
            </Button>
            <Button onClick={submitCreate} loading={busy} data-testid="semester-create-submit">
              สร้างภาคเรียน
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};

export default SemesterManager;
