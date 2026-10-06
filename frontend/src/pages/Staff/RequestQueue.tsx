import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { API_BASE_URL } from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Input, Textarea } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';
import { formatThaiDate } from '../../utils/thaiDate';
import { Search, FileText, ExternalLink, AlertTriangle, ShieldCheck } from 'lucide-react';

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
  submitted_late?: boolean;
  late_reason?: string | null;
  created_at?: string | null;
  start_date?: string | null;
}

export interface RequestDetailData {
  form_id: number;
  student_id: number;
  student_code?: string;
  first_name?: string | null;
  last_name?: string | null;
  cumulative_gpa?: number | string | null;
  year_level?: number | string | null;
  major_name_th?: string | null;
  faculty_name_th?: string | null;
  company_id: number;
  company_name_th?: string;
  company_address?: string | null;
  company_district?: string | null;
  company_province?: string | null;
  company_postal_code?: string | null;
  company_contact_person?: string | null;
  company_contact_position?: string | null;
  start_date?: string | null;
  request_form_path?: string | null;
  submitted_late?: boolean;
  late_reason?: string | null;
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
  mentor_name?: string | null;
  mentor_email?: string | null;
  mentor_phone?: string | null;
  mentor_position?: string | null;
  mentor_department?: string | null;
}

export interface DispatchRow {
  form_id: number;
  student_code?: string;
  first_name?: string | null;
  last_name?: string | null;
  major_name_th?: string | null;
  company_name_th?: string;
  start_date?: string | null;
  end_date?: string | null;
  mentor_name?: string | null;
  acceptance_signer_name?: string | null;
  acceptance_signer_position?: string | null;
  acceptance_signed_date?: string | null;
  dispatch_document_no?: string | null;
}

const COOP_DEFAULT_DAYS = 111;

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
};

const REJECT_PRESET_CHIPS = [
  'ลายเซ็นหัวหน้าสาขาวิชายังไม่ครบ',
  'ชื่อ/ที่อยู่สถานประกอบการไม่ตรงกับหนังสือ',
  'ไฟล์ที่แนบอ่านไม่ออก',
  'อื่น ๆ',
];

interface RequestQueueProps {
  onDataChanged?: () => void;
  showAllIfNoQueueFilter?: boolean;
}

export const RequestQueue: React.FC<RequestQueueProps> = ({ onDataChanged, showAllIfNoQueueFilter = true }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queueParam = searchParams.get('queue'); // 'request' | 'acceptance' | 'dispatch' | null
  const formParam = searchParams.get('form'); // e.g. '41'

  /** ใบที่เปิดแผงตรวจอยู่ตอนนี้ — กันไม่ให้โหลดคิวรอบถัดไปล้างฟอร์มที่พิมพ์ค้างไว้ */
  const openedFormRef = useRef<number | null>(null);

  const [requestQueue, setRequestQueue] = useState<RequestFormRow[]>([]);
  const [acceptanceQueue, setAcceptanceQueue] = useState<AcceptanceRow[]>([]);
  const [dispatchQueue, setDispatchQueue] = useState<DispatchRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Search and quick filter
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyLate, setOnlyLate] = useState(false);

  // Modal Review States - Request (E1)
  const [reviewingRequest, setReviewingRequest] = useState<RequestFormRow | null>(null);
  const [requestDetail, setRequestDetail] = useState<RequestDetailData | null>(null);
  const [officerForm, setOfficerForm] = useState({ document_no: '' });
  const [officerBusy, setOfficerBusy] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [rejectingRequest, setRejectingRequest] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Modal Review States - Acceptance
  const [reviewingAcceptance, setReviewingAcceptance] = useState<AcceptanceRow | null>(null);
  const [acceptanceBusy, setAcceptanceBusy] = useState(false);
  const [rejectingAcceptance, setRejectingAcceptance] = useState(false);
  const [confirmingAcceptanceApprove, setConfirmingAcceptanceApprove] = useState(false);
  const [acceptanceRejectReason, setAcceptanceRejectReason] = useState('');

  // Modal Review States - Dispatch
  const [reviewingDispatch, setReviewingDispatch] = useState<DispatchRow | null>(null);
  const [dispatchForm, setDispatchForm] = useState({ document_no: '', end_date: '' });
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
      // ⛔ เฉพาะตอนโหลดจริงเท่านั้น — การเปิดแผงตรวจตั้ง `?form=` ไว้บน URL แล้ว poll
      //    เบื้องหลัง (ทุก 10 วินาที) วิ่งเข้าบล็อกนี้ซ้ำ **แล้วล้างฟอร์มผู้ลงนามเป็นค่าว่าง**
      //    เจ้าหน้าที่ที่พิมพ์ชื่อผู้ลงนามค้างไว้จึงเสียข้อความที่พิมพ์ทุก 10 วินาที
      //    และปุ่ม "รับคำร้อง" กลับไป disabled เอง
      if (formParam && !isBackground) {
        const formIdNum = Number(formParam);
        if (queueParam === 'request' || !queueParam) {
          const matched = reqRows.find((r) => r.form_id === formIdNum);
          // ⛔ เปิดอยู่แล้ว = ไม่แตะฟอร์ม · การกดเปิดแผงตั้ง `?form=` ซึ่งทำให้ loadQueues
          //    วิ่งอีกรอบ (formParam เป็น dependency) แล้วล้างชื่อผู้ลงนามที่เพิ่งพิมพ์
          if (matched && openedFormRef.current !== formIdNum) {
            openedFormRef.current = formIdNum;
            setReviewingRequest(matched);
            api
              .get(`/intents/${matched.form_id}`)
              .then(setRequestDetail)
              .catch((err) =>
                setError(getErrorMessage(err, 'ไม่สามารถเปิดรายละเอียดคำร้องได้'))
              );
            setOfficerForm({ document_no: '' });
          }
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
            setDispatchForm({
              document_no: '',
              end_date: matched.end_date || (matched.start_date ? addDays(matched.start_date, COOP_DEFAULT_DAYS) : ''),
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

  const setQueueFilter = (q: 'request' | 'acceptance' | 'dispatch' | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (q) next.set('queue', q);
        else next.delete('queue');
        next.delete('form');
        return next;
      },
      { replace: false }
    );
  };

  const openRequestReview = async (row: RequestFormRow) => {
    openedFormRef.current = row.form_id;
    setReviewingRequest(row);
    setRequestDetail(null);
    setOfficerForm({ document_no: '' });
    setRejectReason('');
    setRejectingRequest(false);
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

    try {
      const detail = await api.get(`/intents/${row.form_id}`);
      setRequestDetail(detail);
    } catch {
      // Fallback cleanly to basic row data
    }
  };

  const closeRequestReview = () => {
    openedFormRef.current = null;
    setReviewingRequest(null);
    setRequestDetail(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('form');
        return next;
      },
      { replace: false }
    );
  };

  const submitOfficerApprove = async () => {
    if (!reviewingRequest) return;
    setOfficerBusy(true);
    setError(null);
    try {
      await api.patch(`/intents/${reviewingRequest.form_id}/officer-approve`, officerForm);
      setSuccess(`รับคำร้องของ ${reviewingRequest.student_code || ''} แล้ว เลขที่หนังสือ ${officerForm.document_no}`);
      setConfirmingApprove(false);
      closeRequestReview();
      await loadQueues(true);
      onDataChanged?.();
    } catch (err) {
      setConfirmingApprove(false);
      setError(getErrorMessage(err, 'ไม่สามารถรับคำร้องได้'));
    } finally {
      setOfficerBusy(false);
    }
  };

  const submitOfficerReject = async () => {
    if (!reviewingRequest || !rejectReason.trim()) return;
    setOfficerBusy(true);
    setError(null);
    try {
      await api.patch(`/intents/${reviewingRequest.form_id}/officer-reject`, {
        reason: rejectReason.trim(),
      });
      setSuccess(`ตีกลับคำร้องของ ${reviewingRequest.student_code || ''} แล้ว`);
      closeRequestReview();
      await loadQueues(true);
      onDataChanged?.();
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถตีกลับคำร้องได้'));
    } finally {
      setOfficerBusy(false);
    }
  };

  const handleApplyPresetChip = (chip: string) => {
    if (chip === 'อื่น ๆ') {
      setRejectReason((prev) => prev.trim());
      return;
    }
    setRejectReason((prev) => {
      const clean = prev.trim();
      if (!clean) return chip;
      if (clean.includes(chip)) return clean;
      return `${clean}\n${chip}`;
    });
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
    setDispatchForm({
      document_no: '',
      end_date: row.end_date || (row.start_date ? addDays(row.start_date, COOP_DEFAULT_DAYS) : ''),
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

  const officerFormIncomplete = !officerForm.document_no.trim();

  // Filter lists based on search & late toggles
  const filteredRequests = useMemo(() => {
    return requestQueue.filter((r) => {
      if (onlyLate && !r.submitted_late) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.student_code?.toLowerCase().includes(q) ||
        r.first_name?.toLowerCase().includes(q) ||
        r.last_name?.toLowerCase().includes(q) ||
        r.company_name_th?.toLowerCase().includes(q)
      );
    });
  }, [requestQueue, searchQuery, onlyLate]);

  const filteredAcceptances = useMemo(() => {
    return acceptanceQueue.filter((r) => {
      if (onlyLate && !r.acceptance_submitted_late) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.student_code?.toLowerCase().includes(q) ||
        r.first_name?.toLowerCase().includes(q) ||
        r.last_name?.toLowerCase().includes(q) ||
        r.company_name_th?.toLowerCase().includes(q)
      );
    });
  }, [acceptanceQueue, searchQuery, onlyLate]);

  const filteredDispatches = useMemo(() => {
    return dispatchQueue.filter((r) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        r.student_code?.toLowerCase().includes(q) ||
        r.first_name?.toLowerCase().includes(q) ||
        r.last_name?.toLowerCase().includes(q) ||
        r.company_name_th?.toLowerCase().includes(q)
      );
    });
  }, [dispatchQueue, searchQuery]);

  const showRequest = queueParam === 'request' || (!queueParam && showAllIfNoQueueFilter);
  const showAcceptance = queueParam === 'acceptance' || (!queueParam && showAllIfNoQueueFilter);
  const showDispatch = queueParam === 'dispatch' || (!queueParam && showAllIfNoQueueFilter);

  const totalLateCount =
    requestQueue.filter((r) => r.submitted_late).length +
    acceptanceQueue.filter((r) => r.acceptance_submitted_late).length;

  return (
    <div className="space-y-6">
      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* Filter Queue Chips & Search Bar */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 space-y-4">
        {/* Chips for switching queues */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setQueueFilter(null)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                !queueParam
                  ? 'bg-brand-blue text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              คิวทั้งหมด ({requestQueue.length + acceptanceQueue.length + dispatchQueue.length})
            </button>
            <button
              type="button"
              onClick={() => setQueueFilter('request')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                queueParam === 'request'
                  ? 'bg-brand-blue text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              คำร้องขอหนังสือ ({requestQueue.length})
            </button>
            <button
              type="button"
              onClick={() => setQueueFilter('acceptance')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                queueParam === 'acceptance'
                  ? 'bg-brand-blue text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              แบบตอบรับ ({acceptanceQueue.length})
            </button>
            <button
              type="button"
              onClick={() => setQueueFilter('dispatch')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                queueParam === 'dispatch'
                  ? 'bg-brand-blue text-white shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              รอออกหนังสือส่งตัว ({dispatchQueue.length})
            </button>
          </div>

          {/* Quick late count badge */}
          {totalLateCount > 0 && (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 px-2.5 py-1 rounded-lg">
              ในนี้ {totalLateCount} ใบยื่นช่วงผ่อนผัน/ส่งช้า
            </span>
          )}
        </div>

        {/* Search & In-Queue Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
          <div className="relative flex-grow">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อนักศึกษา, รหัสนักศึกษา หรือสถานประกอบการ..."
              className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-xs text-gray-900 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:border-brand-blue focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>

          <button
            type="button"
            onClick={() => setOnlyLate(!onlyLate)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 shrink-0 ${
              onlyLate
                ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            เฉพาะยื่นช่วงผ่อนผัน ({totalLateCount})
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-8 text-center text-xs text-gray-500 dark:text-gray-400">
          กำลังโหลดรายการคิวงาน...
        </div>
      )}

      {/* คิวคำร้องขอหนังสือ (เอกสารหมายเลข 1) */}
      {showRequest && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
                คำร้องขอหนังสือขอความอนุเคราะห์รอตรวจ ({requestQueue.length} รายการ)
              </span>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                เปิดไฟล์ที่นักศึกษาอัปโหลด ตรวจว่าลงนามครบสองช่อง แล้วกรอกชื่อผู้ลงนามกับเลขที่หนังสือออกก่อนกดรับคำร้อง
              </p>
            </div>
            {filteredRequests.length !== requestQueue.length && (
              <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                แสดง {filteredRequests.length} จาก {requestQueue.length} รายการ
              </span>
            )}
          </div>

          {filteredRequests.length > 0 ? (
            <div className="overflow-x-auto" data-testid="staff-queue-table">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/70 text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">สถานประกอบการ</th>
                    <th className="p-4 font-semibold">สถานะ</th>
                    <th className="p-4 font-semibold text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredRequests.map((row) => (
                    <tr
                      key={row.form_id}
                      className={`hover:bg-gray-50/70 dark:hover:bg-gray-800/30 transition-colors ${
                        row.submitted_late ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="p-4">
                        <span className="font-bold text-gray-900 dark:text-gray-100 block">
                          {[row.first_name, row.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ'}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 block mt-0.5">
                          {row.student_code} {row.major_name_th ? `· ${row.major_name_th}` : ''}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-gray-800 dark:text-gray-200 block">
                          {row.company_name_th || '-'}
                        </span>
                      </td>
                      <td className="p-4">
                        {row.submitted_late ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50">
                            ยื่นช่วงผ่อนผัน
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50">
                            รอออกเลข
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid={`review-request-${row.form_id}`}
                          onClick={() => openRequestReview(row)}
                          className="shrink-0 border-brand-blue text-brand-blue hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40"
                        >
                          ตรวจคำร้อง
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-gray-500 dark:text-gray-400">
              ไม่มีคำร้องรอตรวจในขณะนี้
            </div>
          )}
        </div>
      )}

      {/* คิวแบบตอบรับ (เอกสารหมายเลข 2) */}
      {showAcceptance && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
                แบบตอบรับจากสถานประกอบการรอตรวจ ({acceptanceQueue.length} รายการ)
              </span>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                เปิดไฟล์ที่นักศึกษาอัปโหลด ตรวจว่ามีลายเซ็นและตราประทับครบ แล้วคีย์ชื่อผู้อนุมัติกับวันที่ตามที่ปรากฏบนกระดาษ
              </p>
            </div>
            {filteredAcceptances.length !== acceptanceQueue.length && (
              <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                แสดง {filteredAcceptances.length} จาก {acceptanceQueue.length} รายการ
              </span>
            )}
          </div>

          {filteredAcceptances.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/70 text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">สถานประกอบการ</th>
                    <th className="p-4 font-semibold">กำหนด / ส่งกลับ</th>
                    <th className="p-4 font-semibold text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredAcceptances.map((row) => (
                    <tr
                      key={row.form_id}
                      className={`hover:bg-gray-50/70 dark:hover:bg-gray-800/30 transition-colors ${
                        row.acceptance_submitted_late ? 'bg-amber-50/30 dark:bg-amber-950/10' : ''
                      }`}
                    >
                      <td className="p-4">
                        <span className="font-bold text-gray-900 dark:text-gray-100 block">
                          {[row.first_name, row.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ'}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 block mt-0.5">
                          {row.student_code}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-gray-800 dark:text-gray-200 block">
                          {row.company_name_th || '-'}
                        </span>
                      </td>
                      <td className="p-4">
                        {row.acceptance_submitted_late ? (
                          <span className="inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50">
                            ส่งกลับหลังพ้นกำหนด ๑๕ วันทำการ
                          </span>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">
                            {row.acceptance_due_date ? `ครบกำหนด ${formatThaiDate(row.acceptance_due_date)}` : 'ในกำหนด'}
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid={`review-acceptance-${row.form_id}`}
                          onClick={() => openAcceptanceReview(row)}
                          className="shrink-0 border-brand-blue text-brand-blue hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40"
                        >
                          ตรวจแบบตอบรับ
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-gray-500 dark:text-gray-400">
              ไม่มีแบบตอบรับรอตรวจในขณะนี้
            </div>
          )}
        </div>
      )}

      {/* คิวหนังสือส่งตัว */}
      {showDispatch && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-800 dark:bg-gray-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">
                รอออกหนังสือส่งตัว ({dispatchQueue.length} รายการ)
              </span>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                ตรวจข้อมูลที่จะถูกพิมพ์ลงหนังสือ แล้วออกเลขที่หนังสือส่งตัวและระบุวันสิ้นสุดการปฏิบัติงาน — หนังสือจะเข้าคิวให้คณบดีลงนาม
              </p>
            </div>
            {filteredDispatches.length !== dispatchQueue.length && (
              <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                แสดง {filteredDispatches.length} จาก {dispatchQueue.length} รายการ
              </span>
            )}
          </div>

          {filteredDispatches.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/70 text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                    <th className="p-4 font-semibold">นักศึกษา</th>
                    <th className="p-4 font-semibold">สถานประกอบการ</th>
                    <th className="p-4 font-semibold">วันเริ่มงาน</th>
                    <th className="p-4 font-semibold text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredDispatches.map((row) => (
                    <tr key={row.form_id} className="hover:bg-gray-50/70 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="p-4">
                        <span className="font-bold text-gray-900 dark:text-gray-100 block">
                          {[row.first_name, row.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ'}
                        </span>
                        <span className="text-gray-500 dark:text-gray-400 block mt-0.5">
                          {row.student_code}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-gray-800 dark:text-gray-200 block">
                          {row.company_name_th || '-'}
                        </span>
                      </td>
                      <td className="p-4 text-gray-600 dark:text-gray-300">
                        {row.start_date ? formatThaiDate(row.start_date) : '-'}
                      </td>
                      <td className="p-4 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid={`issue-dispatch-${row.form_id}`}
                          onClick={() => openDispatchReview(row)}
                          className="shrink-0 border-brand-blue text-brand-blue hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/40"
                        >
                          ออกหนังสือส่งตัว
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-gray-500 dark:text-gray-400">
              ไม่มีใบที่รอออกหนังสือส่งตัวในขณะนี้
            </div>
          )}
        </div>
      )}

      {/* ══ ตรวจคำร้องขอหนังสือ (เอกสารหมายเลข 1) — E1 แผงรับคำร้อง ด่าน SEC-04 ══ */}
      {reviewingRequest && (
        <Modal
          onClose={closeRequestReview}
          title={`แผงรับคำร้อง — เอกสารหมายเลข 1 (คำร้องที่ ${reviewingRequest.form_id})`}
          size="5xl"
          closeOnBackdrop={false}
        >
          <ModalBody>
            <div className="space-y-4">
              <AlertBanner variant="error" message={error} />

              {/* Student Header Summary */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-brand-blue dark:text-blue-400">
                    เอกสารหมายเลข 1 · คำร้องที่ {reviewingRequest.form_id}
                  </span>
                  <h3 className="text-base font-extrabold text-gray-900 dark:text-white mt-0.5">
                    {[reviewingRequest.first_name, reviewingRequest.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ'} · {reviewingRequest.student_code || '-'}
                  </h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {requestDetail?.major_name_th || reviewingRequest.major_name_th || 'สาขาวิชา'} 
                    {requestDetail?.year_level ? ` · ชั้นปีที่ ${requestDetail.year_level}` : ''}
                  </span>
                </div>
                {reviewingRequest.submitted_late ? (
                  <span className="self-start sm:self-auto rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                    ยื่นช่วงผ่อนผัน
                  </span>
                ) : (
                  <span className="self-start sm:self-auto rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                    ในกำหนด
                  </span>
                )}
              </div>

              {/* Two Column Layout matching RequestOfficerPanel.dc.html */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* ══ ฝั่งซ้าย: กระดาษที่นักศึกษาอัปโหลด + ข้อมูลในคำร้อง (SEC-05 อ่านอย่างเดียว) ══ */}
                <div className="space-y-4">
                  {/* กล่องไฟล์กระดาษ */}
                  <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50 space-y-3 shadow-sm">
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200 block">
                      กระดาษที่นักศึกษาอัปโหลดกลับมา
                    </span>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <FileText className="h-6 w-6 text-red-600 shrink-0" />
                        <div className="overflow-hidden">
                          <span className="block truncate text-xs font-bold text-gray-800 dark:text-gray-200">
                            {reviewingRequest.request_form_path
                              ? reviewingRequest.request_form_path.split('/').pop()
                              : `request-form-${reviewingRequest.form_id}.pdf`}
                          </span>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            เอกสารลงนามคำร้องขอความอนุเคราะห์
                          </span>
                        </div>
                      </div>
                      {reviewingRequest.request_form_path ? (
                        <a
                          href={`${API_BASE_URL}/files/${reviewingRequest.request_form_path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="open-uploaded-request-form"
                          className="inline-flex items-center gap-1 shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 shadow-sm"
                        >
                          เปิดดู
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-amber-700 dark:text-amber-400">ยังไม่มีไฟล์</span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                      ต้องเปิดอ่านก่อนกรอกชื่อผู้ลงนาม — ชื่อสองคนนี้ถูกพิมพ์ลงหนังสือราชการที่คณบดีเซ็น ระบบไม่มีทางตรวจแทนคุณได้
                    </p>
                  </div>

                  {/* กล่องข้อมูลที่นักศึกษากรอกในคำร้อง (SEC-05) */}
                  <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/50 space-y-3 shadow-sm">
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200 block">
                      ข้อมูลที่นักศึกษากรอกในคำร้อง (SEC-05 อ่านอย่างเดียว)
                    </span>
                    <dl className="grid grid-cols-1 gap-2 text-xs">
                      <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                        <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">สถานประกอบการ</dt>
                        <dd className="font-bold text-gray-900 dark:text-gray-100 text-right">
                          {reviewingRequest.company_name_th}
                        </dd>
                      </div>
                      {requestDetail?.company_address && (
                        <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                          <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">ที่อยู่</dt>
                          <dd className="text-gray-700 dark:text-gray-300 text-right text-[11px] max-w-xs">
                            {[
                              requestDetail.company_address,
                              requestDetail.company_district,
                              requestDetail.company_province,
                              requestDetail.company_postal_code,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                        <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">ผู้รับหนังสือ</dt>
                        <dd className="font-semibold text-gray-800 dark:text-gray-200 text-right">
                          {requestDetail?.company_contact_person || 'ผู้จัดการฝ่ายทรัพยากรบุคคล'}
                        </dd>
                      </div>
                      <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                        <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">ตำแหน่ง</dt>
                        <dd className="text-gray-700 dark:text-gray-300 text-right">
                          {requestDetail?.company_contact_position || 'ผู้จัดการ'}
                        </dd>
                      </div>
                      <div className="flex justify-between py-1 border-b border-gray-100 dark:border-gray-800">
                        <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">เริ่มปฏิบัติงาน</dt>
                        {requestDetail?.start_date ? (
                          <dd className="font-semibold text-gray-800 dark:text-gray-200 text-right">
                            {formatThaiDate(requestDetail.start_date)}
                          </dd>
                        ) : (
                          // start_date ถูกเซ็ตตอนสถานประกอบการตอบรับเท่านั้น — ก่อนนั้นยังไม่มีค่าเป็นเรื่องปกติ
                          <dd className="text-xs font-normal text-gray-600 dark:text-gray-400 text-right">
                            ยังไม่ระบุ — ได้จากแบบตอบรับของสถานประกอบการ
                          </dd>
                        )}
                      </div>
                      <div className="flex justify-between py-1">
                        <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">เกรดเฉลี่ยสะสม</dt>
                        <dd className="font-bold text-gray-900 dark:text-gray-100 text-right">
                          {requestDetail?.cumulative_gpa ?? reviewingRequest.cumulative_gpa ?? '-'}
                        </dd>
                      </div>
                    </dl>
                    <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                      ⛔ ค่าพวกนี้แก้ที่นี่ไม่ได้ — เป็นของแถวคำร้อง ถ้าผิดต้องตีกลับ: ข้อมูลนักศึกษาผิด = นักศึกษาแก้โปรไฟล์แล้วพิมพ์ใหม่ · ข้อมูลสถานประกอบการผิด = นักศึกษาแก้ข้อมูลในคำร้องแล้วพิมพ์ใหม่ (SEC-05: ฟิลด์ทะเบียนเป็นของเซิร์ฟเวอร์)
                    </p>
                  </div>

                  {/* กล่องเตือน SEC-04 การรับรองสถานประกอบการอัตโนมัติ */}
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    <span className="font-bold block mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0" />
                      สถานประกอบการได้รับการรับรองอัตโนมัติ (SEC-04)
                    </span>
                    <p className="text-[11px] leading-relaxed">
                      การกด “ยืนยันรับคำร้อง” จะรับรองสถานประกอบการ{' '}
                      <strong>{reviewingRequest.company_name_th}</strong> เข้าทำเนียบโดยอัตโนมัติในทรานแซกชันเดียวกัน
                      — ไม่มีปุ่มรับรองแยก และไม่ต้องไปกดที่ทำเนียบก่อน
                    </p>
                  </div>

                  {/* ลิงก์ดูตัวอย่างหนังสือขอความอนุเคราะห์ */}
                  <div>
                    <a
                      href={`${API_BASE_URL}/intents/${reviewingRequest.form_id}/cover-letter/preview`}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="preview-cover-letter"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-blue hover:underline dark:text-blue-400"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      ดูตัวอย่างหนังสือขอความอนุเคราะห์ที่จะออกให้
                    </a>
                  </div>
                </div>

                {/* ══ ฝั่งขวา: ส่วนของเจ้าหน้าที่ฝ่ายวิชาการและวิจัย ══ */}
                <div className="space-y-4">
                  {rejectingRequest ? (
                    /* ══ ตีกลับให้แก้ (เหตุผลบังคับ) ══ */
                    <div className="rounded-xl border border-red-200 bg-red-50/40 p-5 dark:border-red-900/50 dark:bg-red-950/20 space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-red-900 dark:text-red-300">
                          ตีกลับให้แก้ — บังคับใส่เหตุผล
                        </h4>
                        <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
                          เหตุผลนี้นักศึกษาเห็นบนหน้าจอตัวเอง จึงต้องบอกว่าต้องแก้อะไร ไม่ใช่แค่ว่าไม่ผ่าน
                        </p>
                      </div>

                      {/* Preset Chips */}
                      <div className="flex flex-wrap gap-1.5">
                        {REJECT_PRESET_CHIPS.map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => handleApplyPresetChip(chip)}
                            className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:border-red-400 hover:bg-red-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          >
                            + {chip}
                          </button>
                        ))}
                      </div>

                      <div>
                        <Textarea
                          rows={4}
                          value={rejectReason}
                          data-testid="officer-reject-reason"
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="ระบุเหตุผลที่ตีกลับ เช่น ลายเซ็นหัวหน้าสาขาวิชายังไม่ครบ หรือที่อยู่ไม่ตรงกับสถานที่ปฏิบัติงานจริง"
                          className="w-full text-xs"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setRejectingRequest(false)}
                        >
                          ย้อนกลับ
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={!rejectReason.trim()}
                          loading={officerBusy}
                          data-testid="officer-reject-submit"
                          onClick={submitOfficerReject}
                        >
                          ยืนยันตีกลับ
                        </Button>
                      </div>

                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        ตีกลับแล้วนักศึกษาอัปโหลดกระดาษชุดใหม่ได้ทันที · ไม่มีการออกเลขและไม่มีการรับรองบริษัทเกิดขึ้น
                      </p>
                    </div>
                  ) : (
                    /* ══ ฟอร์มกรอกส่วนของเจ้าหน้าที่ ══ */
                    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800/50 space-y-4 shadow-sm">
                      <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                          ส่วนของเจ้าหน้าที่ฝ่ายวิชาการและวิจัย
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          ตรวจลายเซ็นบนกระดาษ แล้วกรอกเลขที่หนังสือออกช่องเดียว — ชื่อผู้ลงนามระบบดึงให้แล้ว (หรือนักศึกษากรอกตอนอัปโหลด)
                        </p>
                      </div>

                      {/* ⛔ เจ้าหน้าที่ไม่ต้องคีย์ชื่อ/วันที่จากกระดาษอีก (เจ้าของตัดสิน 2026-09-21) — แสดงให้เทียบกับกระดาษเท่านั้น */}
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 space-y-1" data-testid="officer-signers">
                        <p>อาจารย์ที่ปรึกษาผู้ลงนาม: <strong>{reviewingRequest.advisor_signer_name || '—'}</strong></p>
                        <p>หัวหน้าสาขาวิชาผู้ลงนาม: <strong>{reviewingRequest.dept_head_signer_name || '—'}</strong></p>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                          เลขที่หนังสือออก <span className="text-red-600 dark:text-red-400">*</span>
                        </label>
                        <Input
                          value={officerForm.document_no}
                          data-testid="officer-document-no"
                          placeholder="เช่น อว 0651.11/ว 218"
                          onChange={(e) => setOfficerForm((f) => ({ ...f, document_no: e.target.value }))}
                        />
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 block">
                          ช่อง “เลขที่หนังสือออก” ในกรอบส่วนของเจ้าหน้าที่ · เลขนี้จะถูกพิมพ์ลงหนังสือขอความอนุเคราะห์ทันที และย้อนกลับไม่ได้
                        </span>
                      </div>

                      {/* กล่องสรุปผล 3 อย่างที่จะเกิดขึ้นพร้อมกัน */}
                      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200 space-y-1.5">
                        <span className="font-bold block text-blue-950 dark:text-blue-200">
                          กดยืนยันแล้วระบบทำสามอย่างพร้อมกัน:
                        </span>
                        <div className="space-y-1 text-[11px] text-blue-900 dark:text-blue-300">
                          <p>① เลื่อนสถานะคำร้องเป็น “ผ่านการพิจารณาแล้ว”</p>
                          <p>
                            ② <strong>รับรองบริษัท {reviewingRequest.company_name_th}</strong> เข้าทำเนียบ (นักศึกษาคนอื่นจะเห็นและเลือกได้)
                          </p>
                          <p>③ ออกหนังสือขอความอนุเคราะห์ (ยังไม่ลงนาม) เข้าคิวคณบดี</p>
                        </div>
                        <span className="text-[11px] text-blue-800 dark:text-blue-400 block pt-1">
                          ล้มข้อใดข้อหนึ่ง = ไม่เกิดขึ้นเลยทั้งสามข้อ · กดซ้ำไม่ได้ (คำร้องจะไม่อยู่ในสถานะที่รับได้อีก)
                        </span>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setRejectingRequest(true)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/40"
                        >
                          ตีกลับให้แก้ไข
                        </Button>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={officerFormIncomplete}
                            data-testid="officer-approve-open"
                            onClick={() => setConfirmingApprove(true)}
                            className="bg-brand-blue hover:bg-blue-700 text-white font-bold"
                          >
                            รับคำร้อง
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="sm" onClick={closeRequestReview}>
              ปิด
            </Button>
          </ModalFooter>
        </Modal>
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

              {/* จอกว้าง: ผู้ลงนามกับพี่เลี้ยง/งานวางคู่กัน · กล่องเดียวก็กินเต็มแถว */}
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
              {rejectingAcceptance ? (
                <div className="md:flex-1">
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
                  className="md:flex-1 rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 space-y-1"
                  data-testid="acceptance-signer"
                >
                  <p className="text-gray-600 dark:text-gray-400">ผู้ลงนามตามที่{reviewingAcceptance.acceptance_source === 'link' ? 'บริษัท' : 'นักศึกษา'}กรอก — ตรวจให้ตรงกับกระดาษก่อนรับ (ชื่อนี้ถูกพิมพ์ลงหนังสือส่งตัว)</p>
                  <p>ชื่อผู้อนุมัตินักศึกษา: <strong>{reviewingAcceptance.acceptance_signer_name || '—'}</strong></p>
                  <p>ตำแหน่ง: <strong>{reviewingAcceptance.acceptance_signer_position || '—'}</strong></p>
                  <p>วันที่บนแบบตอบรับ: <strong>{reviewingAcceptance.acceptance_signed_date ? formatThaiDate(reviewingAcceptance.acceptance_signed_date.slice(0, 10)) : '—'}</strong></p>
                </div>
              )}

              {/* พี่เลี้ยง: ทางลิงก์บริษัทไม่ได้ระบุมา นักศึกษาระบุเอง — ยังไม่มี = กดรับไม่ได้ (ปุ่มด้านล่างล็อก) */}
              {!rejectingAcceptance && (
                <div
                  className="md:flex-1 rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 space-y-1"
                  data-testid="acceptance-job-mentor"
                >
                  <p className="text-gray-600 dark:text-gray-400">พนักงานที่ปรึกษา (พี่เลี้ยง) — บัญชีจะเปิดใช้และส่งลิงก์เข้าระบบเมื่อกดรับ</p>
                  {reviewingAcceptance.mentor_name ? (
                    <>
                      <p>
                        ชื่อ: <strong>{reviewingAcceptance.mentor_name}</strong>
                        {reviewingAcceptance.mentor_position ? ` · ${reviewingAcceptance.mentor_position}` : ''}
                        {reviewingAcceptance.mentor_department ? ` · ${reviewingAcceptance.mentor_department}` : ''}
                      </p>
                      <p>
                        อีเมล: <strong>{reviewingAcceptance.mentor_email || '—'}</strong> · โทรศัพท์:{' '}
                        <strong>{reviewingAcceptance.mentor_phone || '—'}</strong>
                      </p>
                    </>
                  ) : (
                    <p data-testid="acceptance-mentor-missing" className="font-bold text-amber-700 dark:text-amber-400">
                      นักศึกษายังไม่ได้ระบุพี่เลี้ยง — รอนักศึกษากรอกก่อนจึงจะรับได้
                    </p>
                  )}
                </div>
              )}
              </div>
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
                  disabled={!reviewingAcceptance.mentor_name}
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

              <dl className="grid gap-2 rounded-xl bg-gray-50 p-4 text-xs dark:bg-gray-800/40 sm:grid-cols-2">
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">สถานประกอบการ</dt>
                  <dd className="font-bold text-gray-800 dark:text-gray-200">
                    {reviewingDispatch.company_name_th || '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">เรียน (ผู้ลงนามในแบบตอบรับ)</dt>
                  <dd className="font-bold text-gray-800 dark:text-gray-200" data-testid="dispatch-recipient">
                    {reviewingDispatch.acceptance_signer_name || '— ใช้ผู้ประสานงานของบริษัทแทน —'}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500 dark:text-gray-400">พนักงานที่ปรึกษา (พี่เลี้ยง)</dt>
                  <dd className="font-bold text-gray-800 dark:text-gray-200">
                    {reviewingDispatch.mentor_name || '— ยังไม่มีในระบบ —'}
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
                <div>
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
                  <label htmlFor="dispatch-end-date" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                    วันสิ้นสุดการปฏิบัติงาน <span className="text-red-600 dark:text-red-400">*</span>
                  </label>
                  <Input
                    id="dispatch-end-date"
                    type="date"
                    data-testid="dispatch-end-date"
                    min={reviewingDispatch.start_date || undefined}
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
              disabled={!dispatchForm.document_no.trim() || !dispatchForm.end_date}
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
              {reviewingDispatch?.start_date ? formatThaiDate(reviewingDispatch.start_date) : '-'}
              {' – '}
              {dispatchForm.end_date ? formatThaiDate(dispatchForm.end_date) : '-'}
            </strong>
            <br />
            หนังสือจะเข้าคิวให้คณบดีลงนาม · เลขที่หนังสือที่ออกแล้วย้อนกลับไม่ได้
          </>
        }
        confirmLabel="ออกเลขและส่งเข้าคิวคณบดี"
        busy={dispatchBusy}
        onConfirm={submitIssueDispatch}
        onCancel={() => setConfirmingDispatch(false)}
      />

      {/* ══ ConfirmDialog Level 3 สำหรับรับคำร้อง (E1 ด่าน SEC-04 ระบุครบ 3 ข้อ) ══ */}
      <ConfirmDialog
        open={confirmingApprove}
        title="ยืนยันการรับคำร้องและออกเลขหนังสือ"
        message={
          <div className="space-y-3 text-left">
            <p>
              คุณกำลังจะรับคำร้องของ{' '}
              <strong>
                {[reviewingRequest?.first_name, reviewingRequest?.last_name].filter(Boolean).join(' ')}
              </strong>{' '}
              ({reviewingRequest?.student_code || '-'})
            </p>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200 space-y-1">
              <p className="font-bold mb-1">การกดยืนยันนี้ ระบบจะทำ ๓ อย่างพร้อมกันในทรานแซกชันเดียว:</p>
              <p>① เลื่อนสถานะคำร้องเป็น “ผ่านการพิจารณาแล้ว” พร้อมออกเลขที่หนังสือ <strong>{officerForm.document_no}</strong></p>
              <p>② <strong>รับรองสถานประกอบการ {reviewingRequest?.company_name_th}</strong> เข้าทำเนียบโดยอัตโนมัติ (นักศึกษาคนอื่นจะเห็นและเลือกได้)</p>
              <p>③ ออกหนังสือขอความอนุเคราะห์ (ยังไม่ลงนาม) ส่งเข้าคิวรอคณบดีลงนาม</p>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              ⚠️ เลขที่หนังสือที่ออกแล้วและการรับรองสถานประกอบการย้อนกลับเองไม่ได้ หากล้มข้อใดข้อหนึ่งระบบจะไม่ดำเนินการเลยทั้งสามข้อ
            </p>
          </div>
        }
        confirmLabel="ออกเลขและรับคำร้อง"
        busy={officerBusy}
        onConfirm={submitOfficerApprove}
        onCancel={() => setConfirmingApprove(false)}
      />

      {/* ══ ConfirmDialog สำหรับรับแบบตอบรับ — กดแล้วเปิดบัญชีพี่เลี้ยงและส่งอีเมลเชิญออกนอกระบบ ══ */}
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
            lead="ระบบจะเปิดบัญชีพี่เลี้ยงและส่งอีเมลเชิญออกไปนอกระบบทันที"
            rows={[
              {
                label: 'นักศึกษา',
                value: `${[reviewingAcceptance?.first_name, reviewingAcceptance?.last_name].filter(Boolean).join(' ')} (${reviewingAcceptance?.student_code || '-'})`,
              },
              { label: 'สถานประกอบการ', value: reviewingAcceptance?.company_name_th ?? '' },
              { label: 'พี่เลี้ยง', value: reviewingAcceptance?.mentor_name ?? '' },
              { label: 'ส่งลิงก์เชิญไปที่อีเมล', value: reviewingAcceptance?.mentor_email ?? '' },
            ]}
            lockNote="อีเมลที่ส่งออกไปแล้วเรียกคืนไม่ได้"
          />
        }
      />
    </div>
  );
};

export default RequestQueue;
