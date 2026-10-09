import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Input, Textarea } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate, formatThaiDateTime } from '../../utils/thaiDate';
import { Search, ExternalLink } from 'lucide-react';
import RequestReviewPanel from './RequestReviewPanel';

export interface RequestFormRow {
  form_id: number;
  student_id: number;
  student_code?: string;
  first_name?: string | null;
  last_name?: string | null;
  major_name_th?: string | null;
  cumulative_gpa?: number | string | null;
  company_name_th?: string;
  company_id: number;
  request_form_path?: string | null;
  /** ชื่อผู้ลงนามแบบคำร้อง — ระบบดึงเอง/นักศึกษากรอกตอนอัปโหลด (มากับ `GET /intents`) */
  advisor_signer_name?: string | null;
  dept_head_signer_name?: string | null;
  /** ชื่อที่ระบบรู้เอง (ที่ปรึกษาของนักศึกษา · หัวหน้าสาขา) — ไว้เทียบว่าชื่อบนใบเป็นของที่นักศึกษาระบุหรือไม่ */
  system_advisor_name?: string | null;
  system_dept_head_name?: string | null;
  submitted_late?: boolean;
  late_reason?: string | null;
  created_at?: string | null;
  start_date?: string | null;
  /** รอเจ้าหน้าที่มากี่วัน นับจากอัปโหลดกระดาษล่าสุด — เซิร์ฟเวอร์นับให้ · null = ไม่ทราบ (ห้ามนับเองที่หน้าจอ) */
  request_wait_days?: number | null;
  request_overdue?: boolean;
  /** เลขที่หนังสือที่เจ้าหน้าที่ออกไว้ — ใบที่หนังสือถูกถอนกลับยังคงเลขเดิม ช่องเลขในแผงเติมให้ */
  officer_document_no?: string | null;
  /** หนังสือถูกถอนกลับมาและยังไม่ถูกตีกลับถึงนักศึกษาหลังจากนั้น — เจ้าหน้าที่เท่านั้นที่ได้ค่านี้ */
  letter_recall?: 'dean_returned' | 'staff_recalled' | null;
}

export interface AcceptanceRow {
  form_id: number;
  student_code?: string;
  first_name?: string | null;
  last_name?: string | null;
  major_name_th?: string | null;
  company_name_th?: string;
  acceptance_evidence_path?: string | null;
  acceptance_due_date?: string | null;
  acceptance_submitted_late?: boolean;
  start_date?: string | null;
  /** ผู้ลงนามบนแบบตอบรับ — นักศึกษากรอกตอนอัปโหลด (มากับ `GET /intents`) */
  acceptance_signer_name?: string | null;
  acceptance_signer_position?: string | null;
  acceptance_signed_date?: string | null;
  /** ที่มาของคำตอบรับ — 'link' = บริษัทตอบผ่านลิงก์ในอีเมล · 'student' = นักศึกษาอัปโหลดเอง */
  acceptance_source?: 'link' | 'student' | null;
}

export interface DispatchRow {
  form_id: number;
  student_code?: string;
  first_name?: string | null;
  last_name?: string | null;
  major_name_th?: string | null;
  company_name_th?: string;
  company_contact_person?: string | null;
  accommodation_submitted?: boolean;
  coop03_missing_count?: number;
  start_date?: string | null;
  end_date?: string | null;
  acceptance_signer_name?: string | null;
  acceptance_signer_position?: string | null;
  acceptance_signed_date?: string | null;
  dispatch_document_no?: string | null;
  dispatch_recall?: {
    by: 'dean' | 'staff';
    reason?: string | null;
    at?: string | null;
    actor_name?: string | null;
  } | null;
}

const COOP_DEFAULT_DAYS = 111;

const isDispatchPrepIncomplete = (row: DispatchRow | null): boolean => {
  if (!row) return false;
  return (
    row.accommodation_submitted === false ||
    (typeof row.coop03_missing_count === 'number' && row.coop03_missing_count > 0)
  );
};

const getDispatchPrepBadgeText = (row: DispatchRow): string | null => {
  const parts: string[] = [];
  if (row.accommodation_submitted === false) {
    parts.push('ยังไม่ส่งสหกิจ 06');
  }
  if (typeof row.coop03_missing_count === 'number' && row.coop03_missing_count > 0) {
    parts.push(`สหกิจ 03 ขาด ${row.coop03_missing_count} ช่อง`);
  }
  if (parts.length === 0) return null;
  return `รอนักศึกษา: ${parts.join(' และ ')}`;
};

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
};

export type QueueKind = 'request' | 'acceptance' | 'dispatch';

const QUEUE_COPY: Record<QueueKind, { title: string; order: string; empty: string }> = {
  request: {
    title: 'คำร้องรอรับ',
    order: 'เรียงจากรอนานสุด',
    empty: 'ไม่มีคำร้องรอตรวจในขณะนี้',
  },
  acceptance: {
    title: 'แบบตอบรับรอตรวจ',
    order: 'เรียงจากกำหนดส่งกลับใกล้สุด',
    empty: 'ไม่มีแบบตอบรับรอตรวจในขณะนี้',
  },
  dispatch: {
    title: 'หนังสือส่งตัวรอออก',
    order: 'เรียงจากวันเริ่มงานใกล้สุด',
    empty: 'ไม่มีใบที่รอออกหนังสือส่งตัวในขณะนี้',
  },
};

const QUEUE_ROW = 'flex flex-wrap items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5';

/** ค่าว่าง (ไม่ทราบ) ไปท้ายเสมอ — ใบที่ไม่รู้อายุต้องไม่ถูกดันขึ้นหัวรายการเหมือนรอนานสุด */
const byNullsLast =
  <T,>(pick: (row: T) => number | string | null | undefined, direction: 1 | -1) =>
  (a: T, b: T): number => {
    const x = pick(a);
    const y = pick(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x < y ? -direction : x > y ? direction : 0;
  };

/** จำนวนวันมาจากเซิร์ฟเวอร์ (`request_wait_days`) — ที่นี่แค่เลือกคำ */
function requestWaitText(row: RequestFormRow): string {
  const days = row.request_wait_days;
  const waited = days == null ? 'ไม่ทราบว่ารอมากี่วัน' : days === 0 ? 'ส่งมาวันนี้' : `รอ ${days} วัน`;
  if (row.request_overdue) return `${waited} · เลยกำหนด`;
  if (row.submitted_late) return `${waited} · ส่งช่วงผ่อนผัน`;
  return waited;
}

const QueueWho: React.FC<{
  row: { first_name?: string | null; last_name?: string | null; student_code?: string; company_name_th?: string };
}> = ({ row }) => (
  <div className="min-w-0 flex-[1_1_300px]">
    <span className="text-[15px] font-bold text-gray-900 dark:text-gray-100">
      {[row.first_name, row.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ'} · {row.student_code || '-'}
    </span>{' '}
    <span className="text-[13px] text-gray-700 dark:text-gray-300">· {row.company_name_th || '-'}</span>
  </div>
);

interface RequestQueueProps {
  /** กองที่แสดง — หน้าแรกเลือกจากการ์ดงาน (`?queue=`) */
  queue: QueueKind;
  onDataChanged?: () => void;
}

export const RequestQueue: React.FC<RequestQueueProps> = ({ queue, onDataChanged }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queueParam = searchParams.get('queue'); // 'request' | 'acceptance' | 'dispatch' | null
  const formParam = searchParams.get('form'); // e.g. '41'

  const [requestQueue, setRequestQueue] = useState<RequestFormRow[]>([]);
  const [acceptanceQueue, setAcceptanceQueue] = useState<AcceptanceRow[]>([]);
  const [dispatchQueue, setDispatchQueue] = useState<DispatchRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  // แผงรับคำร้อง (E1) — ของที่เจ้าหน้าที่พิมพ์ค้าง (เลขที่หนังสือ · เหตุผลตีกลับ) อยู่ใน `RequestReviewPanel`
  // ไม่ได้อยู่ที่นี่ การโหลดคิวซ้ำจึงล้างมันไม่ได้
  const [reviewingRequest, setReviewingRequest] = useState<RequestFormRow | null>(null);

  // Modal Review States - Acceptance
  const [reviewingAcceptance, setReviewingAcceptance] = useState<AcceptanceRow | null>(null);
  const [acceptanceBusy, setAcceptanceBusy] = useState(false);
  const [rejectingAcceptance, setRejectingAcceptance] = useState(false);
  const [confirmingAcceptanceApprove, setConfirmingAcceptanceApprove] = useState(false);
  const [acceptanceRejectReason, setAcceptanceRejectReason] = useState('');

  // Modal Review States - Dispatch
  const [reviewingDispatch, setReviewingDispatch] = useState<DispatchRow | null>(null);
  const [dispatchForm, setDispatchForm] = useState({ document_no: '', start_date: '', end_date: '' });
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [confirmingDispatch, setConfirmingDispatch] = useState(false);

  const loadQueues = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const [requestData, acceptanceData, dispatchData] = await Promise.all([
        api.get('/intents?status=pending_officer_request'),
        api.get('/intents?status=pending_officer_approval'),
        api.get('/intents?status=accepted'),
      ]);

      const reqRows = (requestData || []) as RequestFormRow[];
      const accRows = (acceptanceData || []) as AcceptanceRow[];
      const dispRows = ((dispatchData || []) as DispatchRow[]).filter((row) => !row.dispatch_document_no);

      setRequestQueue(reqRows);
      setAcceptanceQueue(accRows);
      setDispatchQueue(dispRows);

      // Auto-open modal if ?form= is specified in URL
      //
      // ⛔ เฉพาะตอนโหลดจริงเท่านั้น — การโหลดเบื้องหลังต้องไม่เปิด/รีเซ็ตแผงที่ผู้ใช้กำลังใช้อยู่
      if (formParam && !isBackground) {
        const formIdNum = Number(formParam);
        if (queueParam === 'request' || !queueParam) {
          const matched = reqRows.find((r) => r.form_id === formIdNum);
          // แผงผูก key กับ form_id — ตั้งแถวเดิมซ้ำไม่ทำให้ของที่พิมพ์ค้างในแผงหาย
          if (matched) setReviewingRequest(matched);
        }
        if (queueParam === 'acceptance') {
          const matched = accRows.find((r) => r.form_id === formIdNum);
          if (matched) {
            setReviewingAcceptance(matched);
          }
        }
        if (queueParam === 'dispatch') {
          const matched = dispRows.find((r) => r.form_id === formIdNum);
          if (matched) {
            setReviewingDispatch(matched);
            const initialStart = matched.start_date || '';
            setDispatchForm({
              document_no: '',
              start_date: initialStart,
              end_date: matched.end_date || (initialStart ? addDays(initialStart, COOP_DEFAULT_DAYS) : ''),
            });
          }
        }
      }
    } catch (err) {
      console.error('Failed to load queues:', err);
      if (!isBackground) setError('ไม่สามารถดึงข้อมูลคิวงานได้');
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [formParam, queueParam]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadQueues();
  }, [loadQueues]);

  const openRequestReview = (row: RequestFormRow) => {
    setReviewingRequest(row);
    setError(null);
    setSuccess(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('queue', 'request');
        next.set('form', String(row.form_id));
        return next;
      },
      { replace: false }
    );
  };

  const closeRequestReview = () => {
    setReviewingRequest(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('form');
        return next;
      },
      { replace: false }
    );
  };

  const openAcceptanceReview = (row: AcceptanceRow) => {
    setReviewingAcceptance(row);
    setRejectingAcceptance(false);
    setConfirmingAcceptanceApprove(false);
    setAcceptanceRejectReason('');
    setError(null);
    setSuccess(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('queue', 'acceptance');
        next.set('form', String(row.form_id));
        return next;
      },
      { replace: false }
    );
  };

  const closeAcceptanceReview = () => {
    setReviewingAcceptance(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('form');
        return next;
      },
      { replace: false }
    );
  };

  const submitAcceptanceDecision = async (action: 'accepted' | 'rejected') => {
    if (!reviewingAcceptance) return;
    setAcceptanceBusy(true);
    setError(null);
    try {
      await api.put(`/acceptances/${reviewingAcceptance.form_id}/officer-approve`, {
        action,
        ...(action === 'accepted' ? {} : { reason: acceptanceRejectReason.trim() }),
      });
      setSuccess(
        action === 'accepted'
          ? 'รับแบบตอบรับเรียบร้อยแล้ว นักศึกษาเข้าสู่ขั้นเตรียมปฏิบัติงาน'
          : 'ตีกลับแบบตอบรับเรียบร้อยแล้ว'
      );
      closeAcceptanceReview();
      await loadQueues(true);
      onDataChanged?.();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกผลการตรวจแบบตอบรับได้'));
    } finally {
      setAcceptanceBusy(false);
      setConfirmingAcceptanceApprove(false);
    }
  };

  const openDispatchReview = (row: DispatchRow) => {
    setReviewingDispatch(row);
    const initialStart = row.start_date || '';
    setDispatchForm({
      document_no: '',
      start_date: initialStart,
      end_date: row.end_date || (initialStart ? addDays(initialStart, COOP_DEFAULT_DAYS) : ''),
    });
    setConfirmingDispatch(false);
    setError(null);
    setSuccess(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('queue', 'dispatch');
        next.set('form', String(row.form_id));
        return next;
      },
      { replace: false }
    );
  };

  const closeDispatchReview = () => {
    setReviewingDispatch(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('form');
        return next;
      },
      { replace: false }
    );
  };

  const submitIssueDispatch = async () => {
    if (!reviewingDispatch) return;
    setDispatchBusy(true);
    setError(null);
    try {
      await api.post(`/intents/${reviewingDispatch.form_id}/dispatch-letter`, dispatchForm);
      setSuccess(
        `ออกหนังสือส่งตัวของ ${reviewingDispatch.student_code || ''} แล้ว เลขที่ ${dispatchForm.document_no} · รอคณบดีลงนาม`
      );
      setConfirmingDispatch(false);
      closeDispatchReview();
      await loadQueues(true);
      onDataChanged?.();
    } catch (err) {
      setConfirmingDispatch(false);
      setError(getErrorMessage(err, 'ไม่สามารถออกหนังสือส่งตัวได้'));
    } finally {
      setDispatchBusy(false);
    }
  };

  // ค้นในกองที่แสดงอยู่ แล้วเรียงตามสิ่งที่เจ้าหน้าที่ต้องหยิบก่อน
  const matchesSearch = useCallback(
    (r: { student_code?: string; first_name?: string | null; last_name?: string | null; company_name_th?: string }) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return [r.student_code, r.first_name, r.last_name, r.company_name_th].some((v) =>
        v?.toLowerCase().includes(q)
      );
    },
    [searchQuery]
  );

  const filteredRequests = useMemo(
    () => requestQueue.filter(matchesSearch).sort(byNullsLast((r) => r.request_wait_days, -1)),
    [requestQueue, matchesSearch]
  );
  const filteredAcceptances = useMemo(
    () => acceptanceQueue.filter(matchesSearch).sort(byNullsLast((r) => r.acceptance_due_date, 1)),
    [acceptanceQueue, matchesSearch]
  );
  const filteredDispatches = useMemo(
    () => dispatchQueue.filter(matchesSearch).sort(byNullsLast((r) => r.start_date, 1)),
    [dispatchQueue, matchesSearch]
  );

  const activeTotal = { request: requestQueue, acceptance: acceptanceQueue, dispatch: dispatchQueue }[queue].length;
  const activeShown = { request: filteredRequests, acceptance: filteredAcceptances, dispatch: filteredDispatches }[queue]
    .length;

  return (
    <div className="space-y-4">
      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/*
        ── รายการเดียวของกองที่เลือก (หน้าแรกแบบ B) ──
        กองถูกเลือกจากการ์ดงานของ StaffHome (`queue`) — แสดงทีละกอง ไม่วางสามตารางพร้อมกัน
        ⛔ "รอกี่วัน" และ "เลยกำหนด" มาจากเซิร์ฟเวอร์ (`request_wait_days` · `request_overdue`) หน้าจอไม่นับเอง
      */}
      <section
        data-testid={`staff-queue-${queue}`}
        className="flex flex-col gap-2.5 rounded-2xl border border-gray-200 bg-white p-[18px] shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-white">
            {QUEUE_COPY[queue].title} · {activeTotal} คน
          </h2>
          <span className="text-[13px] text-gray-600 dark:text-gray-400">
            {activeShown !== activeTotal
              ? `แสดง ${activeShown} จาก ${activeTotal} คน`
              : QUEUE_COPY[queue].order}
          </span>
        </div>

        {activeTotal > 0 && (
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="ค้นหาในรายการนี้"
              placeholder="ค้นหาชื่อ รหัสนักศึกษา หรือสถานประกอบการ"
              className="min-h-11 w-full rounded-xl border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-500 focus:border-brand-blue focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400"
            />
          </div>
        )}

        {loading && (
          <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-400">กำลังโหลดรายการคิวงาน...</p>
        )}

        {!loading && activeShown === 0 && (
          <p className="py-8 text-center text-sm text-gray-600 dark:text-gray-400">
            {activeTotal === 0 ? QUEUE_COPY[queue].empty : 'ไม่พบรายการที่ตรงกับคำค้น'}
          </p>
        )}

        {queue === 'request' &&
          filteredRequests.map((row) => (
            <div
              key={row.form_id}
              className={`${QUEUE_ROW} ${
                row.request_overdue
                  ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <QueueWho row={row} />
              {row.letter_recall && (
                <span
                  data-testid={`letter-recall-badge-${row.form_id}`}
                  className="rounded-full border border-purple-300 bg-purple-50 px-2.5 py-0.5 text-xs font-bold text-purple-900 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200"
                >
                  {row.letter_recall === 'dean_returned' ? 'คณบดีตีกลับ' : 'ดึงกลับ'}
                </span>
              )}
              <span
                className={`text-[13px] ${
                  row.request_overdue
                    ? 'font-bold text-red-700 dark:text-red-300'
                    : row.submitted_late
                      ? 'font-bold text-amber-800 dark:text-amber-300'
                      : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {requestWaitText(row)}
              </span>
              <Button
                className="min-h-11 shrink-0"
                data-testid={`review-request-${row.form_id}`}
                onClick={() => openRequestReview(row)}
              >
                ตรวจคำร้อง
              </Button>
            </div>
          ))}

        {queue === 'acceptance' &&
          filteredAcceptances.map((row) => (
            <div key={row.form_id} className={`${QUEUE_ROW} border-gray-200 dark:border-gray-700`}>
              <QueueWho row={row} />
              <span
                className={`text-[13px] ${
                  row.acceptance_submitted_late
                    ? 'font-bold text-amber-800 dark:text-amber-300'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {row.acceptance_submitted_late
                  ? 'ส่งกลับหลังพ้นกำหนด ๑๕ วันทำการ'
                  : row.acceptance_due_date
                    ? `ครบกำหนด ${formatThaiDate(row.acceptance_due_date)}`
                    : 'ในกำหนด'}
              </span>
              <Button
                className="min-h-11 shrink-0"
                data-testid={`review-acceptance-${row.form_id}`}
                onClick={() => openAcceptanceReview(row)}
              >
                ตรวจแบบตอบรับ
              </Button>
            </div>
          ))}

        {queue === 'dispatch' &&
          filteredDispatches.map((row) => (
            <div key={row.form_id} className={`${QUEUE_ROW} border-gray-200 dark:border-gray-700`}>
              <QueueWho row={row} />
              {row.dispatch_recall && (
                <span
                  data-testid={`dispatch-recall-badge-${row.form_id}`}
                  className="rounded-full border border-purple-300 bg-purple-50 px-2.5 py-0.5 text-xs font-bold text-purple-900 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-200"
                >
                  {row.dispatch_recall.by === 'dean' ? 'คณบดีตีกลับ' : 'ดึงกลับ'}
                </span>
              )}
              {getDispatchPrepBadgeText(row) && (
                <span
                  data-testid={`dispatch-prep-${row.form_id}`}
                  className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  {getDispatchPrepBadgeText(row)}
                </span>
              )}
              <span className="text-[13px] text-gray-600 dark:text-gray-400">
                {row.start_date ? `เริ่มงาน ${formatThaiDate(row.start_date)}` : 'ยังไม่มีวันเริ่มงาน'}
              </span>
              <Button
                className="min-h-11 shrink-0"
                data-testid={`issue-dispatch-${row.form_id}`}
                onClick={() => openDispatchReview(row)}
              >
                ออกหนังสือส่งตัว
              </Button>
            </div>
          ))}
      </section>

      {/* ══ แผงรับคำร้อง (เอกสารหมายเลข 1) — แถวล่าสุดของคิวถ้ายังอยู่ ไม่งั้นใช้แถวตอนกดเปิด ══ */}
      {reviewingRequest && (
        <RequestReviewPanel
          key={reviewingRequest.form_id}
          row={requestQueue.find((r) => r.form_id === reviewingRequest.form_id) ?? reviewingRequest}
          onClose={closeRequestReview}
          onChanged={() => {
            void loadQueues(true);
            onDataChanged?.();
          }}
          onDone={(message) => {
            setSuccess(message);
            closeRequestReview();
            void loadQueues(true);
            onDataChanged?.();
          }}
        />
      )}

      {/* ══ ตรวจแบบตอบรับจากสถานประกอบการ (เอกสารหมายเลข 2) ══ */}
      {reviewingAcceptance && (
        <Modal
          onClose={closeAcceptanceReview}
          title={`ตรวจแบบตอบรับ — ${[reviewingAcceptance.first_name, reviewingAcceptance.last_name].filter(Boolean).join(' ')} (${reviewingAcceptance.student_code || '-'})`}
          size="3xl"
          closeOnBackdrop={false}
        >
          <ModalBody>
            <div className="space-y-4">
              <AlertBanner variant="error" message={error} />

              {reviewingAcceptance.acceptance_submitted_late && (
                <AlertBanner
                  variant="warning"
                  message={`แบบตอบรับนี้ส่งกลับหลังพ้นกำหนด ๑๕ วันทำการ${
                    reviewingAcceptance.acceptance_due_date
                      ? ` (ครบกำหนดวันที่ ${formatThaiDate(reviewingAcceptance.acceptance_due_date)})`
                      : ''
                  } — ผ่อนผันได้ แต่ระบบบันทึกไว้แล้วว่าเป็นเคสส่งช้า`}
                />
              )}

              {reviewingAcceptance.acceptance_source === 'link' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    data-testid="acceptance-source-link"
                    className="inline-flex items-center rounded-full bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-bold text-[#1E3A8A] dark:bg-blue-950/60 dark:text-blue-300"
                  >
                    บริษัทตอบผ่านลิงก์
                  </span>
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    สถานประกอบการตอบรับและแนบแบบตอบรับเองทางลิงก์ในอีเมล
                  </span>
                </div>
              )}

              {reviewingAcceptance.acceptance_evidence_path ? (
                <a
                  href={`${API_BASE_URL}/files/${reviewingAcceptance.acceptance_evidence_path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="open-acceptance-evidence"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-blue underline dark:text-blue-400"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {reviewingAcceptance.acceptance_source === 'link'
                    ? 'เปิดไฟล์แบบตอบรับที่บริษัทแนบมา'
                    : 'เปิดไฟล์แบบตอบรับที่นักศึกษาอัปโหลด'}
                </a>
              ) : (
                <AlertBanner variant="warning" message="ยังไม่มีไฟล์แบบตอบรับในระบบ" />
              )}

              {/* ⛔ ไม่มีกล่องพี่เลี้ยงที่นี่ — พี่เลี้ยงถูกระบุหลังใบ accepted และยืนยันที่หน้า "ติดตามพี่เลี้ยง" การรับไม่ต้องรอพี่เลี้ยง */}
              {rejectingAcceptance ? (
                <div>
                  <label
                    htmlFor="acceptance-reject-reason"
                    className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                  >
                    เหตุผลที่ตีกลับ (นักศึกษาจะเห็นข้อความนี้)
                  </label>
                  <Textarea
                    id="acceptance-reject-reason"
                    rows={3}
                    data-testid="acceptance-reject-reason"
                    value={acceptanceRejectReason}
                    onChange={(e) => setAcceptanceRejectReason(e.target.value)}
                    placeholder="เช่น ไม่มีตราประทับหรือลายเซ็นของผู้อนุมัติบนแบบตอบรับ"
                  />
                </div>
              ) : (
                // ⛔ เจ้าหน้าที่ไม่ต้องคีย์ผู้ลงนามอีก (เจ้าของตัดสิน 2026-09-21) — นักศึกษากรอกตอนอัปโหลด แสดงให้เทียบกับกระดาษ
                <div
                  className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 space-y-1"
                  data-testid="acceptance-signer"
                >
                  <p className="text-gray-600 dark:text-gray-400">ผู้ลงนามตามที่{reviewingAcceptance.acceptance_source === 'link' ? 'บริษัท' : 'นักศึกษา'}กรอก — ตรวจให้ตรงกับกระดาษก่อนรับ (ชื่อนี้ถูกพิมพ์ลงหนังสือส่งตัว)</p>
                  <p>ชื่อผู้อนุมัตินักศึกษา: <strong>{reviewingAcceptance.acceptance_signer_name || '—'}</strong></p>
                  <p>ตำแหน่ง: <strong>{reviewingAcceptance.acceptance_signer_position || '—'}</strong></p>
                  <p>วันที่บนแบบตอบรับ: <strong>{reviewingAcceptance.acceptance_signed_date ? formatThaiDate(reviewingAcceptance.acceptance_signed_date.slice(0, 10)) : '—'}</strong></p>
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            {rejectingAcceptance ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setRejectingAcceptance(false)}>
                  ย้อนกลับ
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!acceptanceRejectReason.trim()}
                  loading={acceptanceBusy}
                  data-testid="acceptance-reject-submit"
                  onClick={() => submitAcceptanceDecision('rejected')}
                >
                  ยืนยันตีกลับ
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={() => setRejectingAcceptance(true)}>
                  ตีกลับให้แก้ไข
                </Button>
                <Button
                  size="sm"
                  loading={acceptanceBusy}
                  data-testid="acceptance-approve-submit"
                  onClick={() => setConfirmingAcceptanceApprove(true)}
                >
                  รับแบบตอบรับ
                </Button>
              </>
            )}
          </ModalFooter>
        </Modal>
      )}

      {/* ══ ออกหนังสือส่งตัว ══ */}
      {reviewingDispatch && (
        <Modal
          onClose={closeDispatchReview}
          title={`ออกหนังสือส่งตัว — ${[reviewingDispatch.first_name, reviewingDispatch.last_name].filter(Boolean).join(' ')} (${reviewingDispatch.student_code || '-'})`}
          size="2xl"
          closeOnBackdrop={false}
        >
          <ModalBody>
            <div className="space-y-4">
              <AlertBanner variant="error" message={error} />

              {isDispatchPrepIncomplete(reviewingDispatch) && (
                <AlertBanner
                  variant="warning"
                  data-testid="dispatch-prep-warning"
                  message={`ยังออกหนังสือส่งตัวไม่ได้ เนื่องจาก${getDispatchPrepBadgeText(reviewingDispatch)} — นักศึกษาต้องส่งเอกสารก่อนออกฝึกให้ครบก่อน`}
                />
              )}

              {reviewingDispatch.dispatch_recall && (
                <div
                  data-testid="dispatch-recall-note"
                  className="rounded-xl border border-purple-200 bg-purple-50/60 p-3.5 dark:border-purple-900/60 dark:bg-purple-950/20"
                >
                  <span className="block text-xs font-semibold text-purple-900 dark:text-purple-300">
                    {reviewingDispatch.dispatch_recall.by === 'dean' ? 'คณบดีตีกลับหนังสือ' : 'เจ้าหน้าที่ดึงหนังสือกลับ'}
                    {reviewingDispatch.dispatch_recall.at ? ` · ${formatThaiDateTime(reviewingDispatch.dispatch_recall.at)}` : ''}
                    {reviewingDispatch.dispatch_recall.actor_name ? ` โดย ${reviewingDispatch.dispatch_recall.actor_name}` : ''}
                  </span>
                  <p className="mt-1 whitespace-pre-line text-sm text-gray-900 dark:text-gray-100">
                    {reviewingDispatch.dispatch_recall.reason || 'ไม่ได้ระบุเหตุผล'}
                  </p>
                </div>
              )}

              <dl className="grid gap-2 rounded-xl bg-gray-50 p-4 text-xs dark:bg-gray-800/40 sm:grid-cols-2">
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">สถานประกอบการ</dt>
                  <dd className="font-bold text-gray-800 dark:text-gray-200">
                    {reviewingDispatch.company_name_th || '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">เรียน</dt>
                  <dd className="font-bold text-gray-800 dark:text-gray-200" data-testid="dispatch-recipient">
                    {[
                      reviewingDispatch.company_contact_person?.trim() || 'ผู้จัดการฝ่ายบุคคล',
                      reviewingDispatch.company_name_th?.trim(),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">วันเริ่มปฏิบัติงาน</dt>
                  <dd className="font-bold text-gray-800 dark:text-gray-200">
                    {reviewingDispatch.start_date ? formatThaiDate(reviewingDispatch.start_date) : '-'}
                  </dd>
                </div>
              </dl>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="dispatch-document-no" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                    เลขที่หนังสือส่งตัว <span className="text-red-600 dark:text-red-400">*</span>
                  </label>
                  <Input
                    id="dispatch-document-no"
                    data-testid="dispatch-document-no"
                    value={dispatchForm.document_no}
                    onChange={(e) => setDispatchForm((f) => ({ ...f, document_no: e.target.value }))}
                    placeholder="เช่น อว 0656.10/123"
                  />
                </div>
                <div>
                  <label htmlFor="dispatch-start-date" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                    วันเริ่มปฏิบัติงาน <span className="text-red-600 dark:text-red-400">*</span>
                  </label>
                  <Input
                    id="dispatch-start-date"
                    type="date"
                    data-testid="dispatch-start-date"
                    value={dispatchForm.start_date}
                    onChange={(e) => setDispatchForm((f) => ({ ...f, start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label htmlFor="dispatch-end-date" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                    วันสิ้นสุดการปฏิบัติงาน <span className="text-red-600 dark:text-red-400">*</span>
                  </label>
                  <Input
                    id="dispatch-end-date"
                    type="date"
                    data-testid="dispatch-end-date"
                    min={dispatchForm.start_date || undefined}
                    value={dispatchForm.end_date}
                    onChange={(e) => setDispatchForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 sm:col-span-2">
                  ระบบเติมวันสิ้นสุดไว้ให้เป็น ๑๖ สัปดาห์นับจากวันเริ่ม
                  <strong> เป็นค่าตั้งต้นเท่านั้น</strong> — แก้ให้ตรงกับที่ตกลงกับสถานประกอบการจริง
                  เพราะช่วงเวลานี้จะถูกพิมพ์ลงหนังสือที่คณบดีลงนาม
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={closeDispatchReview}>
              ยกเลิก
            </Button>
            <Button
              size="sm"
              loading={dispatchBusy}
              disabled={
                isDispatchPrepIncomplete(reviewingDispatch) ||
                !dispatchForm.document_no.trim() ||
                !dispatchForm.start_date ||
                !dispatchForm.end_date
              }
              data-testid="dispatch-submit"
              onClick={() => setConfirmingDispatch(true)}
            >
              ออกหนังสือส่งตัว
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* ══ ConfirmDialog Level 3 สำหรับหนังสือส่งตัว ══ */}
      <ConfirmDialog
        open={confirmingDispatch}
        title="ยืนยันการออกหนังสือส่งตัว"
        message={
          <>
            ออกหนังสือส่งตัวของ{' '}
            <strong>
              {[reviewingDispatch?.first_name, reviewingDispatch?.last_name].filter(Boolean).join(' ')}
            </strong>{' '}
            ({reviewingDispatch?.student_code}) เลขที่{' '}
            <strong>{dispatchForm.document_no}</strong>
            <br />
            ช่วงปฏิบัติงาน{' '}
            <strong>
              {dispatchForm.start_date ? formatThaiDate(dispatchForm.start_date) : '-'}
              {' – '}
              {dispatchForm.end_date ? formatThaiDate(dispatchForm.end_date) : '-'}
            </strong>
            <br />
            หนังสือจะเข้าคิวให้คณบดีลงนาม · ดึงกลับได้จนกว่าคณบดีจะลงนาม
          </>
        }
        confirmLabel="ออกเลขและส่งเข้าคิวคณบดี"
        busy={dispatchBusy}
        onConfirm={submitIssueDispatch}
        onCancel={() => setConfirmingDispatch(false)}
      />

      {/* ══ ConfirmDialog สำหรับรับแบบตอบรับ — รับแล้วใบเป็น "ตอบรับแล้ว" ย้อนกลับไปตีกลับไม่ได้ และระบบแจ้งนักศึกษาทางอีเมล ══ */}
      <ConfirmDialog
        open={confirmingAcceptanceApprove && !!reviewingAcceptance}
        title="ยืนยันการรับแบบตอบรับ"
        confirmLabel="ยืนยันรับแบบตอบรับ"
        cancelLabel="กลับไปตรวจ"
        confirmTestId="acceptance-approve-confirm"
        cancelTestId="acceptance-approve-cancel"
        busy={acceptanceBusy}
        onCancel={() => setConfirmingAcceptanceApprove(false)}
        onConfirm={() => submitAcceptanceDecision('accepted')}
        message={
          <ConfirmSummary
            lead="นักศึกษาจะได้ที่ฝึกงานนี้ และระบบจะส่งอีเมลแจ้งนักศึกษาทันที"
            rows={[
              {
                label: 'นักศึกษา',
                value: `${[reviewingAcceptance?.first_name, reviewingAcceptance?.last_name].filter(Boolean).join(' ')} (${reviewingAcceptance?.student_code || '-'})`,
              },
              { label: 'สถานประกอบการ', value: reviewingAcceptance?.company_name_th ?? '' },
              {
                label: 'วันเริ่มปฏิบัติงาน',
                value: reviewingAcceptance?.start_date ? formatThaiDate(reviewingAcceptance.start_date.slice(0, 10)) : '-',
              },
            ]}
            lockNote="รับแล้วตีกลับแบบตอบรับไม่ได้อีก · พี่เลี้ยงนักศึกษาระบุทีหลังเมื่อเริ่มฝึก"
          />
        }
      />
    </div>
  );
};

export default RequestQueue;
