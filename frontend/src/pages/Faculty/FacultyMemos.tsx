import React, { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton from '../../components/ui/Skeleton';
import { skeletonFor } from '../../components/ui/skeletonFor';
import { useDashboardData } from '../../hooks/useDashboardData';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import StatusBadge from '../../components/ui/StatusBadge';
import { getErrorMessage } from '../../utils/errors';
import { Search, FileText, ExternalLink, RefreshCw } from 'lucide-react';
import Button from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Input';
import { formatThaiDate } from '../../utils/thaiDate';
import type { MemoDecisionStatus, StudentMemoItem } from '../../types/api';

/**
 * บันทึกข้อความนักศึกษา (มุมมองบุคลากร) — ดีไซน์ B: รายการซ้าย + รายละเอียดขวา (เจ้าของเลือก 2026-10-18)
 *
 * คณบดี (`canDecide`) อ่านเรื่องครบทางขวาแล้วตัดสินในหน้าเดียว — ตัดสินแล้วแก้ไม่ได้ จึงมี ConfirmDialog ก่อนส่งทุกครั้ง
 * อาจารย์/หัวหน้าสาขาเห็นหน้าเดียวกันแบบอ่านอย่างเดียว · ขอบเขตสาขามาจากเซิร์ฟเวอร์ (`GET /memos`)
 */

interface MemoTypeInfo {
  key: string;
  label: string;
  subject?: string;
  intent?: string;
  hint?: string;
  outcome?: string;
}

const TONE_BY_TYPE: Record<string, string> = {
  early_departure: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/50',
  change_company: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50',
  terminated: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/50',
  late_submission: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-900/50',
};
const DEFAULT_TONE = 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';

const STATUS_TEXT: Record<MemoDecisionStatus, string> = {
  pending: 'รอคณบดีพิจารณา',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
};

const STATUS_TONE: Record<MemoDecisionStatus, string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
};

/** ชื่อเอกสารที่ขอผ่อนผัน — กิจกรรมที่เปิดรอบพิเศษได้ (ตรงกับ `isRoundableActivity` ฝั่ง backend) */
const ACTIVITY_LABEL: Record<string, string> = {
  intent_submission: 'ใบแจ้งความจำนง (เอกสาร 1)',
  acceptance_form: 'แบบตอบรับ (เอกสาร 2)',
  accommodation_plan: 'ข้อมูลที่พัก (สหกิจ 06)',
  report_outline: 'โครงร่างรายงาน (สหกิจ 11)',
  final_report: 'รายงานฉบับสมบูรณ์',
};

/** หัวข้อที่อนุมัติแล้วเจ้าหน้าที่นำไปเปิดรอบพิเศษได้ — ตรงกับ `ROUND_MEMO_TYPES` ฝั่ง backend */
const ROUND_TYPES = ['early_departure', 'late_submission'];

const DECISION_NOTE_MIN_LENGTH = 10;

const studentNameOf = (m: StudentMemoItem) =>
  m.first_name ? `${m.first_name} ${m.last_name || ''}`.trim() : `รหัส: ${m.student_code}`;

const shortDate = (iso?: string | null) => (iso ? formatThaiDate(String(iso).slice(0, 10)) : '–');

interface FacultyMemosProps {
  showMajorFilter?: boolean;
  /** คณบดีเท่านั้นที่ตัดสินได้ — ปุ่มอนุมัติ/ไม่อนุมัติ · เซิร์ฟเวอร์ตรวจ role อีกชั้น */
  canDecide?: boolean;
}

const FacultyMemos: React.FC<FacultyMemosProps> = ({ showMajorFilter = false, canDecide = false }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedType = searchParams.get('type') || 'all';
  const selectedMajor = searchParams.get('major') || 'all';

  const [memos, setMemos] = useState<StudentMemoItem[]>([]);
  const [memoTypes, setMemoTypes] = useState<MemoTypeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  /** ผลที่รอยืนยัน + หมายเหตุที่คณบดีพิมพ์ — ยืนยันในกล่องเล็กเพราะตัดสินแล้วแก้ไม่ได้ */
  const [confirming, setConfirming] = useState<'approved' | 'rejected' | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState('');

  const loadData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);

      const [memosRes, typesRes] = await Promise.all([
        api.get('/memos'),
        api.get('/memos/types'),
      ]);

      const memoList: StudentMemoItem[] = Array.isArray(memosRes)
        ? memosRes
        : memosRes?.data || [];
      setMemos(memoList);

      const rawTypes = typesRes?.types;
      if (Array.isArray(rawTypes)) {
        setMemoTypes(rawTypes);
      } else if (rawTypes && typeof rawTypes === 'object') {
        const mapped = Object.entries(rawTypes).map(([k, v]) => ({
          key: k,
          label: typeof v === 'string' ? v : (v as { label?: string }).label || k,
        }));
        setMemoTypes(mapped);
      }
    } catch (err) {
      console.error('Failed to load faculty memos:', err);
      if (!isBackground) {
        setError(getErrorMessage(err, 'ดึงรายการบันทึกข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useDashboardData(loadData, []);

  const typeLabels = useMemo(() => {
    const map: Record<string, string> = {};
    memoTypes.forEach((t) => {
      map[t.key] = t.label;
    });
    return map;
  }, [memoTypes]);

  const handleTypeSelect = (typeKey: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (typeKey === 'all') {
        next.delete('type');
      } else {
        next.set('type', typeKey);
      }
      return next;
    });
  };

  const availableMajors = useMemo(() => {
    const majors = new Set<string>();
    memos.forEach((m) => {
      if (m.major_name_th) majors.add(m.major_name_th);
    });
    return Array.from(majors).sort();
  }, [memos]);

  const filteredMemos = useMemo(() => {
    return memos.filter((item) => {
      if (selectedType !== 'all' && item.memo_type !== selectedType) {
        return false;
      }
      if (showMajorFilter && selectedMajor !== 'all' && item.major_name_th !== selectedMajor) {
        return false;
      }
      if (searchTerm.trim()) {
        const query = searchTerm.trim().toLowerCase();
        const fullName = `${item.first_name || ''} ${item.last_name || ''}`.toLowerCase();
        const code = (item.student_code || '').toLowerCase();
        const reason = (item.reason || '').toLowerCase();
        const major = (item.major_name_th || '').toLowerCase();
        if (!fullName.includes(query) && !code.includes(query) && !reason.includes(query) && !major.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [memos, selectedType, selectedMajor, showMajorFilter, searchTerm]);

  const countsByType = useMemo(() => {
    const counts: Record<string, number> = { all: memos.length };
    memos.forEach((m) => {
      counts[m.memo_type] = (counts[m.memo_type] || 0) + 1;
    });
    return counts;
  }, [memos]);

  /** รอพิจารณาขึ้นก่อน — ที่ต้องลงมือคือกลุ่มนี้ ที่เหลือเป็นประวัติ */
  const pendingMemos = filteredMemos.filter((m) => m.status === 'pending');
  const decidedMemos = filteredMemos.filter((m) => m.status !== 'pending');

  /** เรื่องที่เปิดอยู่ทางขวา — ตัวที่เลือก ถ้าหายไปจากตัวกรองใช้ตัวแรกที่รอพิจารณา */
  const selected =
    filteredMemos.find((m) => m.memo_id === selectedId) ?? pendingMemos[0] ?? decidedMemos[0] ?? null;
  const otherMemosOfStudent = selected
    ? memos.filter((m) => m.student_id === selected.student_id && m.memo_id !== selected.memo_id).length
    : 0;

  const selectMemo = (memoId: number) => {
    setSelectedId(memoId);
    setDecisionNote('');
    setDecisionError('');
  };

  const askConfirm = (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && decisionNote.trim().length < DECISION_NOTE_MIN_LENGTH) {
      setDecisionError(`กรุณาระบุเหตุผลที่ไม่อนุมัติอย่างน้อย ${DECISION_NOTE_MIN_LENGTH} ตัวอักษร นักศึกษาจะอ่านเหตุผลนี้`);
      return;
    }
    setDecisionError('');
    setConfirming(decision);
  };

  const submitDecision = async () => {
    if (!selected || !confirming) return;
    setDecisionBusy(true);
    setDecisionError('');
    try {
      await api.patch(`/memos/${selected.memo_id}/decision`, {
        decision: confirming,
        note: decisionNote.trim() || undefined,
      });
      setSuccess(
        confirming === 'approved'
          ? 'อนุมัติบันทึกข้อความแล้ว — แจ้งนักศึกษาให้แล้ว เจ้าหน้าที่จะเห็นรายการนี้เพื่อดำเนินการต่อ'
          : 'บันทึกการไม่อนุมัติแล้ว — นักศึกษาจะเห็นเหตุผล'
      );
      setConfirming(null);
      setDecisionNote('');
      await loadData(true);
    } catch (err) {
      setConfirming(null);
      setDecisionError(getErrorMessage(err, 'บันทึกผลการตัดสินไม่สำเร็จ'));
    } finally {
      setDecisionBusy(false);
    }
  };

  if (loading) {
    return <PageSkeleton variant={skeletonFor('advisor', 'memos')} />;
  }

  const renderRow = (item: StudentMemoItem) => {
    const isSelected = selected?.memo_id === item.memo_id;
    const tone = TONE_BY_TYPE[item.memo_type] || DEFAULT_TONE;
    return (
      <li key={item.memo_id}>
        <button
          type="button"
          onClick={() => selectMemo(item.memo_id)}
          aria-current={isSelected ? 'true' : undefined}
          data-testid={`memo-row-${item.memo_id}`}
          className={`flex w-full cursor-pointer flex-col gap-1 border-b border-gray-100 px-4 py-3 text-left transition-colors dark:border-gray-800 ${
            isSelected
              ? 'bg-blue-50 shadow-[inset_4px_0_0_0_#2563EB] dark:bg-blue-950/30'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
          }`}
        >
          <span className="flex items-start justify-between gap-2">
            <span className="text-sm font-bold text-gray-900 dark:text-white">{studentNameOf(item)}</span>
            <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">{shortDate(item.created_at)}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={`inline-block self-start rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`}>
              {typeLabels[item.memo_type] || item.memo_type}
            </span>
            {item.status !== 'pending' && (
              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[item.status]}`}>
                {STATUS_TEXT[item.status]}
              </span>
            )}
          </span>
          <span className="line-clamp-1 text-xs text-gray-600 dark:text-gray-400">{item.reason}</span>
        </button>
      </li>
    );
  };

  const details = selected?.details ?? {};
  const detailRows: { label: string; value: string }[] = [];
  if (details.start_date) detailRows.push({ label: 'ขอเริ่มปฏิบัติงานวันที่', value: formatThaiDate(details.start_date) });
  if (details.activities?.length) {
    detailRows.push({ label: 'เอกสารที่ขอผ่อนผัน', value: details.activities.map((k) => ACTIVITY_LABEL[k] ?? k).join(' · ') });
  }
  if (details.expected_date) detailRows.push({ label: 'คาดว่าจะส่งได้', value: formatThaiDate(details.expected_date) });
  if (details.new_company) detailRows.push({ label: 'สถานที่ที่จะย้ายไป', value: details.new_company });
  if (details.end_date) detailRows.push({ label: 'สิ้นสุดการปฏิบัติงานวันที่', value: formatThaiDate(details.end_date) });

  const outcomeOf = (memoType: string) => memoTypes.find((t) => t.key === memoType)?.outcome;

  return (
    <div className="space-y-6 page-enter pb-10">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            บันทึกข้อความนักศึกษา
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
            {canDecide ? (
              <>
                เรื่องที่นักศึกษายื่นถึงคณบดี —{' '}
                <strong className="font-semibold text-gray-800 dark:text-gray-200">เลือกเรื่องจากรายการซ้าย อ่านรายละเอียดทางขวา แล้วอนุมัติหรือไม่อนุมัติได้ที่นี่</strong>{' '}
                · ตัดสินแล้วแก้ไม่ได้ และระบบแจ้งนักศึกษาให้เอง
              </>
            ) : (
              <>
                เรื่องที่นักศึกษาในสาขายื่นถึงคณบดี ·{' '}
                <strong className="font-semibold text-gray-800 dark:text-gray-200">อ่านอย่างเดียว</strong>{' '}
                — คณบดีเป็นผู้ตัดสินในระบบ
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadData(false)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors self-start md:self-auto cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          รีเฟรช
        </button>
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          data-testid="memo-type-filter-all"
          onClick={() => handleTypeSelect('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
            selectedType === 'all'
              ? 'bg-brand-navy text-white shadow-sm'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          ทุกหัวข้อ ({countsByType.all || 0})
        </button>
        {memoTypes.map((t) => (
          <button
            key={t.key}
            type="button"
            data-testid={`memo-type-filter-${t.key}`}
            onClick={() => handleTypeSelect(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              selectedType === t.key
                ? 'bg-brand-navy text-white shadow-sm'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {t.label} ({countsByType[t.key] || 0})
          </button>
        ))}
        {showMajorFilter && availableMajors.length > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">สาขาวิชา:</span>
            <select
              data-testid="memo-major-filter"
              aria-label="ตัวกรองสาขาวิชา"
              value={selectedMajor}
              onChange={(e) => {
                const val = e.target.value;
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  if (val === 'all') {
                    next.delete('major');
                  } else {
                    next.set('major', val);
                  }
                  return next;
                });
              }}
              className="px-2.5 py-1 text-xs rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-blue cursor-pointer"
            >
              <option value="all">ทุกสาขาวิชา</option>
              {availableMajors.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <div className="card w-full shrink-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 lg:w-[22rem]">
          <div className="border-b border-gray-100 p-3 dark:border-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="ค้นหาชื่อ รหัส หรือเหตุผล..."
                aria-label="ค้นหาบันทึกข้อความ"
                className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-9 pr-3 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-brand-blue dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
          </div>

          {filteredMemos.length === 0 ? (
            <div className="p-10 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-500" />
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">ยังไม่มีนักศึกษายื่นบันทึกข้อความ</p>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                รายการจะขึ้นเมื่อนักศึกษายื่นจากเมนู &ldquo;บันทึกถึงคณบดี&rdquo;
              </p>
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              <h2 className="border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300">
                รอพิจารณา · {pendingMemos.length}
              </h2>
              {pendingMemos.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">ไม่มีเรื่องที่รอพิจารณา</p>
              ) : (
                <ul>{pendingMemos.map(renderRow)}</ul>
              )}
              <h2 className="border-b border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-300">
                ตัดสินแล้ว · {decidedMemos.length}
              </h2>
              {decidedMemos.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">ยังไม่มีเรื่องที่ตัดสินแล้ว</p>
              ) : (
                <ul>{decidedMemos.map(renderRow)}</ul>
              )}
            </div>
          )}
        </div>

        {selected ? (
          <div
            className="card w-full min-w-0 flex-1 space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-6"
            data-testid="memo-detail"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">{studentNameOf(selected)}</h2>
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                  {selected.student_code}
                  {selected.major_name_th ? ` · ${selected.major_name_th}` : ''} · ยื่นเมื่อ {shortDate(selected.created_at)}
                </p>
              </div>
              <span
                className={`inline-block rounded-full border px-3 py-1 text-xs font-bold ${TONE_BY_TYPE[selected.memo_type] || DEFAULT_TONE}`}
              >
                {typeLabels[selected.memo_type] || selected.memo_type}
              </span>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">เหตุผลที่นักศึกษาเขียน</h3>
              <p className="mt-2 whitespace-pre-line rounded-xl bg-gray-50 p-4 text-[15px] leading-relaxed text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                {selected.reason}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {detailRows.map((r) => (
                <div key={r.label} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
                  <p className="text-xs text-gray-600 dark:text-gray-400">{r.label}</p>
                  <p className="mt-0.5 text-sm font-bold text-gray-900 dark:text-gray-100">{r.value}</p>
                </div>
              ))}
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
                <p className="text-xs text-gray-600 dark:text-gray-400">สถานที่ฝึก</p>
                <p className="mt-0.5 text-sm font-bold text-gray-900 dark:text-gray-100">
                  {selected.intent_company_name_th || 'ไม่ได้อ้างถึงใบแจ้งความจำนง'}
                </p>
                {selected.intent_status && (
                  <div className="mt-1">
                    <StatusBadge status={selected.intent_status} />
                  </div>
                )}
              </div>
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
                <p className="text-xs text-gray-600 dark:text-gray-400">เรื่องอื่นของนักศึกษาคนนี้</p>
                <p className="mt-0.5 text-sm font-bold text-gray-900 dark:text-gray-100">
                  {otherMemosOfStudent === 0 ? 'ไม่มี — ยื่นครั้งแรก' : `${otherMemosOfStudent} เรื่อง`}
                </p>
              </div>
              <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-950/30 sm:col-span-2">
                <p className="text-xs text-blue-900 dark:text-blue-200">ถ้าอนุมัติ</p>
                <p className="mt-0.5 text-sm font-bold text-blue-950 dark:text-blue-100">
                  {outcomeOf(selected.memo_type) ?? 'เจ้าหน้าที่ดำเนินการต่อตามคำตัดสิน'}
                </p>
              </div>
            </div>

            <div className="space-y-3 border-t border-gray-200 pt-5 dark:border-gray-800">
              {selected.status === 'pending' && canDecide ? (
                <>
                  <div>
                    <label htmlFor="memo-decision-note" className="block text-sm font-medium text-gray-800 dark:text-gray-300">
                      หมายเหตุถึงนักศึกษา{' '}
                      <span className="font-normal text-gray-600 dark:text-gray-400">
                        (ไม่อนุมัติต้องกรอกอย่างน้อย {DECISION_NOTE_MIN_LENGTH} ตัวอักษร)
                      </span>
                    </label>
                    <Textarea
                      id="memo-decision-note"
                      className="mt-2"
                      rows={3}
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      placeholder="นักศึกษาจะอ่านข้อความนี้ที่หน้าบันทึกข้อความของตน"
                    />
                  </div>
                  <AlertBanner variant="error" message={decisionError} />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="success"
                      onClick={() => askConfirm('approved')}
                      data-testid={`memo-approve-${selected.memo_id}`}
                    >
                      อนุมัติ
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => askConfirm('rejected')}
                      data-testid={`memo-reject-${selected.memo_id}`}
                    >
                      ไม่อนุมัติ
                    </Button>
                    <span className="text-xs text-gray-600 dark:text-gray-400">ตัดสินแล้วแก้ไม่ได้ · ระบบแจ้งนักศึกษาให้เอง</span>
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <span
                    data-testid={`memo-status-${selected.memo_id}`}
                    data-status={selected.status}
                    className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${STATUS_TONE[selected.status] ?? STATUS_TONE.pending}`}
                  >
                    {STATUS_TEXT[selected.status] ?? STATUS_TEXT.pending}
                  </span>
                  {selected.decided_at && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">ตัดสินเมื่อ {shortDate(selected.decided_at)}</p>
                  )}
                  {selected.decision_note && (
                    <p className="text-sm text-gray-800 dark:text-gray-200">
                      <span className="font-semibold">หมายเหตุ:</span> {selected.decision_note}
                    </p>
                  )}
                  {selected.status === 'approved' && ROUND_TYPES.includes(selected.memo_type) && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">รอเจ้าหน้าที่เปิดรอบพิเศษ</p>
                  )}
                </div>
              )}
              <a
                href={`${API_BASE_URL}/memos/${selected.memo_id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`memo-pdf-${selected.memo_id}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-blue underline dark:text-blue-400"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                เปิดเอกสารบันทึกข้อความ (PDF)
              </a>
            </div>
          </div>
        ) : (
          <div className="card w-full flex-1 rounded-2xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
            เลือกเรื่องจากรายการซ้ายเพื่ออ่านรายละเอียด
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null && !!selected}
        title={confirming === 'approved' ? 'ยืนยันการอนุมัติ' : 'ยืนยันการไม่อนุมัติ'}
        confirmLabel={confirming === 'approved' ? 'ยืนยันอนุมัติ' : 'ยืนยันไม่อนุมัติ'}
        confirmTestId="memo-decision-confirm"
        destructive={confirming === 'rejected'}
        busy={decisionBusy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void submitDecision()}
        message={
          selected ? (
            <>
              <p>
                <span className="font-bold">{studentNameOf(selected)}</span> ({selected.student_code}) ·{' '}
                {typeLabels[selected.memo_type] || selected.memo_type}
              </p>
              <p className="mt-2">
                {confirming === 'approved'
                  ? 'ตัดสินแล้วแก้ไม่ได้ และระบบจะแจ้งนักศึกษาทันที'
                  : 'นักศึกษาจะเห็นเหตุผลที่คุณระบุ ตัดสินแล้วแก้ไม่ได้'}
              </p>
            </>
          ) : null
        }
      />
    </div>
  );
};

export default FacultyMemos;
