import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal, { ModalBody } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { getErrorMessage } from '../../utils/errors';
import { Printer, Send, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react';

interface StaffJobOfferSummary {
  offer_id: number;
  company_id: number;
  company_name_th: string;
  status: 'draft' | 'submitted' | 'reviewed' | 'declined';
  due_date: string | null;
  days_left: number | null;
  is_overdue: boolean;
  submitted_at: string | null;
  item_count: number;
  quota_total: number;
  informant_name: string | null;
}

interface StaffJobOfferDetailResponse {
  semester: { semester_id: number; label: string };
  offer: {
    offer_id: number;
    company_id: number;
    semester_id: number;
    status: 'draft' | 'submitted' | 'reviewed' | 'declined';
    due_date: string | null;
    days_left: number | null;
    is_overdue: boolean;
    submitted_at: string | null;
    reviewed_at: string | null;
    informant_name: string | null;
    informant_position: string | null;
    decline_reason: string | null;
    reject_reason: string | null;
  };
  company: {
    company_id: number;
    name_th: string;
    name_en: string | null;
    address: string | null;
    province: string | null;
    district: string | null;
    postal_code: string | null;
    phone: string | null;
    fax: string | null;
    email: string | null;
    is_verified: boolean;
    business_type: string | null;
    employee_count: number | null;
    manager_name: string | null;
    manager_position: string | null;
    manager_department: string | null;
    manager_phone: string | null;
    manager_fax: string | null;
    contact_mode: string | null;
    contact_person: string | null;
    contact_position: string | null;
    contact_department: string | null;
    contact_phone: string | null;
    contact_fax: string | null;
  };
  items: Array<{
    job_id: number;
    title: string;
    description: string | null;
    quota: number;
    applied_count: number;
    duration_term: string | null;
    skills_required: string | null;
    other_requirements: string | null;
    pay_amount: number | null;
    pay_unit: string | null;
    accommodation: string | null;
    accommodation_cost: number | null;
    welfare_other: string | null;
    status: 'pending_approval' | 'published' | 'rejected' | 'closed';
    reject_reason: string | null;
    major_ids: number[];
    can_delete: boolean;
  }>;
  previous: {
    offer_id: number;
    semester_label: string;
    item_count: number;
    quota_total: number;
    accepted_count: number;
  } | null;
  majors: Array<{ major_id: number; major_name_th: string }>;
  sent_at: string | null;
  sent_by_name: string | null;
  changed_fields: string[];
}

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

function formatThaiDateShort(isoDate?: string | null): string {
  if (!isoDate) return '—';
  try {
    const parts = isoDate.slice(0, 10).split('-');
    if (parts.length === 3) {
      const d = Number(parts[2]);
      const m = THAI_MONTHS_SHORT[Number(parts[1]) - 1];
      return `${d} ${m}`;
    }
  } catch {
    // ponytail: fallback to raw string if parsing fails
  }
  return isoDate;
}

function formatThaiDateTime(isoStr?: string | null): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = d.getDate();
    const month = THAI_MONTHS_SHORT[d.getMonth()];
    const year = d.getFullYear() + 543;
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year} ${hours}:${mins} น.`;
  } catch {
    return isoStr;
  }
}

function formatDurationTerm(term?: string | null): string {
  if (!term) return 'ตลอดปีการศึกษา';
  if (term === 'term1') return 'ภาคเรียนที่ 1';
  if (term === 'term2') return 'ภาคเรียนที่ 2';
  if (term === 'full_year') return 'ตลอดปีการศึกษา';
  return term;
}

export const JobOfferReview: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const offerParam = searchParams.get('offer');
  const tabParam = searchParams.get('tab');

  const [statusFilter, setStatusFilter] = useState<'submitted' | 'declined' | 'reviewed' | 'draft' | 'all'>(
    tabParam === 'all' ? 'all' : 'submitted'
  );

  const [semester, setSemester] = useState<{ semester_id: number; label: string } | null>(null);
  const [counts, setCounts] = useState<{ draft: number; submitted: number; reviewed: number; declined: number }>({
    draft: 0,
    submitted: 0,
    reviewed: 0,
    declined: 0,
  });
  const [offers, setOffers] = useState<StaffJobOfferSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(() => {
    const id = offerParam ? parseInt(offerParam, 10) : null;
    return id && Number.isInteger(id) ? id : null;
  });

  const [offerDetail, setOfferDetail] = useState<StaffJobOfferDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reject all state
  const [showRejectAllBox, setShowRejectAllBox] = useState(false);
  const [rejectAllReason, setRejectAllReason] = useState('');
  const [isRejectingAll, setIsRejectingAll] = useState(false);

  // Resend link state
  const [isResendingLink, setIsResendingLink] = useState(false);

  // Single line-item reject state
  const [rejectingItem, setRejectingItem] = useState<{ job_id: number; title: string } | null>(null);
  const [rejectItemReason, setRejectItemReason] = useState('');
  const [isRejectingItem, setIsRejectingItem] = useState(false);

  // Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Load offer list (SB2)
  const loadOfferList = useCallback(async (currentStatus: string, keepSelectedId?: number | null) => {
    try {
      setLoadingList(true);
      const url = currentStatus === 'all'
        ? '/job-offers/staff'
        : `/job-offers/staff?status=${currentStatus}`;
      const res = await api.get(url);
      setSemester(res.semester || null);
      setCounts(res.counts || { draft: 0, submitted: 0, reviewed: 0, declined: 0 });
      const list: StaffJobOfferSummary[] = res.offers || [];
      setOffers(list);

      // Determine selected offer
      if (keepSelectedId && list.some((o) => o.offer_id === keepSelectedId)) {
        setSelectedOfferId(keepSelectedId);
      } else if (list.length > 0) {
        // If current selected offer is not in list, select the first one
        setSelectedOfferId(list[0].offer_id);
      } else {
        setSelectedOfferId(null);
        setOfferDetail(null);
      }
    } catch (err) {
      console.error('Failed to load job offers list:', err);
      setError(getErrorMessage(err, 'ไม่สามารถโหลดรายการแบบเสนองานได้'));
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Load selected offer detail (SB3)
  const loadOfferDetail = useCallback(async (offerId: number) => {
    try {
      setLoadingDetail(true);
      setShowRejectAllBox(false);
      setRejectAllReason('');
      const res: StaffJobOfferDetailResponse = await api.get(`/job-offers/staff/${offerId}`);
      setOfferDetail(res);
    } catch (err) {
      console.error(`Failed to load offer #${offerId}:`, err);
      setError(getErrorMessage(err, `ไม่สามารถโหลดแบบเสนองานใบที่ #${offerId} ได้`));
      setOfferDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // Sync offer list on statusFilter change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOfferList(statusFilter, selectedOfferId);
  }, [statusFilter, selectedOfferId, loadOfferList]);

  // Sync offer selection with URL and load detail
  useEffect(() => {
    if (selectedOfferId) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('menu', 'jobs');
          next.set('tab', 'review');
          next.set('offer', String(selectedOfferId));
          return next;
        },
        { replace: true }
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadOfferDetail(selectedOfferId);
    }
  }, [selectedOfferId, setSearchParams, loadOfferDetail]);

  const handleSelectOffer = (offerId: number) => {
    setSelectedOfferId(offerId);
    setError(null);
    setSuccess(null);
  };

  // SB4: Approve whole offer
  const handleApproveAll = async () => {
    if (!selectedOfferId || !offerDetail) return;
    const pendingItems = offerDetail.items.filter((i) => i.status === 'pending_approval');
    const pendingQuota = pendingItems.reduce((acc, i) => acc + (i.quota || 0), 0);

    setConfirmDialog({
      title: 'ยืนยันอนุมัติแบบเสนองานทั้งใบ',
      message: `กดผ่านทั้งใบจะเปลี่ยนสถานะของแบบเสนองานฉบับนี้เป็น "ตรวจผ่านแล้ว" และเปิด ${pendingItems.length} ตำแหน่ง รวม ${pendingQuota} อัตรา ให้นักศึกษาเห็นบนกระดานหางานพร้อมกันทันที (รายการที่คุณกด "ไม่เปิด" ไปก่อนหน้านี้จะไม่ถูกเปิดตาม) ยืนยันที่จะดำเนินการหรือไม่?`,
      confirmLabel: 'ยืนยันผ่านทั้งใบ · เปิดรับสมัคร',
      onConfirm: async () => {
        try {
          setError(null);
          const res = await api.put(`/job-offers/${selectedOfferId}/review`);
          setSuccess(
            res.message ||
              (res.published_count === 0
                ? 'ไม่มีตำแหน่งงานที่รออนุมัติ จึงไม่มีรายการใดถูกเปิดให้นักศึกษาเห็น'
                : `เปิดตำแหน่งงานให้นักศึกษาเห็นแล้ว ${res.published_count ?? pendingItems.length} รายการ`)
          );
          await loadOfferList(statusFilter, selectedOfferId);
          await loadOfferDetail(selectedOfferId);
        } catch (err) {
          console.error('Approve offer error:', err);
          setError(getErrorMessage(err, 'ไม่สามารถอนุมัติแบบเสนองานได้'));
        }
      },
    });
  };

  // SB5: Reject whole offer
  const handleRejectAll = async () => {
    if (!selectedOfferId) return;
    const trimmedReason = rejectAllReason.trim();
    if (!trimmedReason) {
      setError('กรุณาระบุเหตุผลในการตีกลับทั้งใบ');
      return;
    }

    try {
      setIsRejectingAll(true);
      setError(null);
      const res = await api.post(`/job-offers/${selectedOfferId}/reject`, {
        reason: trimmedReason,
      });
      setSuccess(
        res.message || `ตีกลับแบบเสนองานฉบับที่ #${selectedOfferId} กลับเป็นฉบับร่างเรียบร้อยแล้ว`
      );
      setShowRejectAllBox(false);
      setRejectAllReason('');
      await loadOfferList(statusFilter, selectedOfferId);
      await loadOfferDetail(selectedOfferId);
    } catch (err) {
      console.error('Reject offer error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถตีกลับแบบเสนองานได้'));
    } finally {
      setIsRejectingAll(false);
    }
  };

  // Line-item reject: PUT /api/jobs/:id/reject
  const handleRejectItem = async () => {
    if (!rejectingItem || !selectedOfferId) return;
    const trimmedReason = rejectItemReason.trim();
    if (!trimmedReason) {
      setError('กรุณาระบุเหตุผลที่ไม่เปิดรับตำแหน่งนี้');
      return;
    }

    try {
      setIsRejectingItem(true);
      setError(null);
      await api.put(`/jobs/${rejectingItem.job_id}/reject`, { reason: trimmedReason });
      setSuccess(`ไม่เปิดรับตำแหน่ง "${rejectingItem.title}" แล้ว รายการนี้จะไม่ถูกเปิดตามเมื่อกดผ่านทั้งใบ`);
      setRejectingItem(null);
      setRejectItemReason('');
      await loadOfferDetail(selectedOfferId);
    } catch (err) {
      console.error('Reject job item error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถปฏิเสธตำแหน่งงานได้'));
    } finally {
      setIsRejectingItem(false);
    }
  };

  // SB6: Resend link to company email
  const handleResendLink = async () => {
    if (!selectedOfferId) return;
    try {
      setIsResendingLink(true);
      setError(null);
      const res = await api.post(`/job-offers/${selectedOfferId}/resend-link`);
      setSuccess(res.message || 'ส่งลิงก์แบบเสนองานใหม่ไปยังอีเมลสถานประกอบการเรียบร้อยแล้ว');
    } catch (err) {
      console.error('Resend link error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถส่งลิงก์ใหม่ได้'));
    } finally {
      setIsResendingLink(false);
    }
  };

  const runConfirm = async () => {
    if (!confirmDialog) return;
    setConfirmBusy(true);
    try {
      await confirmDialog.onConfirm();
    } finally {
      setConfirmBusy(false);
      setConfirmDialog(null);
    }
  };

  const getMajorNames = (majorIds: number[]): string => {
    if (!offerDetail?.majors || !majorIds || majorIds.length === 0) return 'ทุกสาขาวิชา';
    const names = majorIds
      .map((id) => offerDetail.majors.find((m) => m.major_id === id)?.major_name_th)
      .filter(Boolean);
    return names.length > 0 ? names.join(', ') : 'ทุกสาขาวิชา';
  };

  const isFieldChanged = (fieldName: string): boolean => {
    return (offerDetail?.changed_fields || []).includes(fieldName);
  };

  const pendingItems = offerDetail?.items.filter((i) => i.status === 'pending_approval') || [];
  const pendingQuota = pendingItems.reduce((acc, i) => acc + (i.quota || 0), 0);

  return (
    <div className="space-y-6 page-enter">
      {/* Header title */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            ตรวจแบบเสนองาน (สหกิจ 02)
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            ตรวจ <strong>ทั้งใบ</strong> ไม่ใช่ทีละตำแหน่ง — บริษัทตอบมาเป็นหนึ่งใบ กดผ่านครั้งเดียวแล้วทุกตำแหน่งในใบนั้นขึ้นกระดานหางานพร้อมกัน
          </p>
        </div>
        {selectedOfferId && (
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-md">
            URL: /dashboard?menu=jobs&tab=review&offer={selectedOfferId}
          </span>
        )}
      </div>

      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* Main 2-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* ══ Column 1: รายการใบที่รอตรวจ (330px) ══ */}
        <div
          data-testid="offer-review-list"
          className="w-full lg:w-[330px] shrink-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm flex flex-col"
        >
          {/* Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
            <span className="font-bold text-sm text-gray-900 dark:text-white">
              {statusFilter === 'submitted'
                ? `รอตรวจ ${counts.submitted} ใบ`
                : statusFilter === 'declined'
                ? `ยังไม่รับ ${counts.declined} ใบ`
                : statusFilter === 'reviewed'
                ? `ตรวจแล้ว ${counts.reviewed} ใบ`
                : statusFilter === 'draft'
                ? `ฉบับร่าง ${counts.draft} ใบ`
                : `ทั้งหมด ${offers.length} ใบ`}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              {semester ? semester.label : '—'}
            </span>
          </div>

          {/* Quick status filter pills */}
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-900/50 flex flex-wrap gap-1.5 text-xs">
            <button
              onClick={() => setStatusFilter('submitted')}
              className={`px-2 py-0.5 rounded-full font-semibold transition-colors ${
                statusFilter === 'submitted'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              รอตรวจ ({counts.submitted})
            </button>
            <button
              onClick={() => setStatusFilter('declined')}
              className={`px-2 py-0.5 rounded-full font-semibold transition-colors ${
                statusFilter === 'declined'
                  ? 'bg-amber-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              ยังไม่รับ ({counts.declined})
            </button>
            <button
              onClick={() => setStatusFilter('reviewed')}
              className={`px-2 py-0.5 rounded-full font-semibold transition-colors ${
                statusFilter === 'reviewed'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              ผ่านแล้ว ({counts.reviewed})
            </button>
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2 py-0.5 rounded-full font-semibold transition-colors ${
                statusFilter === 'all'
                  ? 'bg-gray-700 text-white dark:bg-gray-600'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              ทั้งหมด
            </button>
          </div>

          {/* List items */}
          <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-[700px] overflow-y-auto">
            {loadingList ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : offers.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500 dark:text-gray-400">
                {semester
                  ? `ไม่มีแบบเสนองานในสถานะนี้สำหรับ ${semester.label}`
                  : 'ยังไม่มีการส่งแบบสำรวจในระบบ'}
              </div>
            ) : (
              offers.map((offer) => {
                const isSelected = offer.offer_id === selectedOfferId;
                const isOverdue = offer.is_overdue;

                return (
                  <div
                    key={offer.offer_id}
                    data-testid={`offer-review-row-${offer.offer_id}`}
                    // แถวที่กดได้ต้องกดด้วยคีย์บอร์ดได้ด้วย — div เปล่า ๆ Tab ไปไม่ถึง
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectOffer(offer.offer_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectOffer(offer.offer_id);
                      }
                    }}
                    className={`p-3.5 px-4 flex flex-col gap-1 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/40 border-l-4 border-blue-600 dark:border-blue-500'
                        : isOverdue
                        ? 'bg-amber-50/70 dark:bg-amber-950/20 hover:bg-amber-100/60 dark:hover:bg-amber-950/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                    }`}
                  >
                    <span
                      className={`text-sm font-bold truncate ${
                        isSelected
                          ? 'text-blue-900 dark:text-blue-300'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {offer.company_name_th}
                    </span>
                    <div className="flex items-center justify-between text-xs">
                      {isOverdue ? (
                        <span className="text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          ตอบกลับ {formatThaiDateShort(offer.submitted_at)} · ค้างมา{' '}
                          {Math.abs(offer.days_left || 0)} วัน
                        </span>
                      ) : (
                        <span
                          className={
                            isSelected
                              ? 'text-blue-700 dark:text-blue-400'
                              : 'text-gray-500 dark:text-gray-400'
                          }
                        >
                          ตอบกลับ {formatThaiDateShort(offer.submitted_at)} · {offer.item_count} ตำแหน่ง ·{' '}
                          {offer.quota_total} อัตรา
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer note matching OfferReview.dc.html */}
          <div className="p-3.5 px-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 flex flex-col gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              ใบที่บริษัทตอบว่า <strong>“ภาคนี้ยังไม่รับ”</strong> ไม่เข้าคิวรอตรวจ แต่ยังเก็บไว้เป็นคำตอบ ดูได้ที่ปุ่มข้างล่าง
            </span>
            {statusFilter !== 'declined' && (
              <button
                onClick={() => setStatusFilter('declined')}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline text-left"
              >
                ดูใบที่ตอบว่ายังไม่รับ ({counts.declined})
              </button>
            )}
            {statusFilter === 'declined' && (
              <button
                onClick={() => setStatusFilter('submitted')}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline text-left"
              >
                ← กลับไปดูใบที่รอตรวจ ({counts.submitted})
              </button>
            )}
          </div>
        </div>

        {/* ══ Column 2: ใบที่เปิดอยู่ (Selected Offer Detail) ══ */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 w-full">
          {loadingDetail ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-44 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !offerDetail ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-12 shadow-sm">
              <EmptyState
                title="ยังไม่ได้เลือกแบบเสนองาน"
                description="กรุณาเลือกแบบเสนองานจากรายการด้านซ้ายเพื่อเปิดดูรายละเอียดและดำเนินการตรวจ"
              />
            </div>
          ) : (
            <>
              {/* 1. Header Card */}
              <div
                data-testid="offer-review-header"
                className="p-5 sm:p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-start justify-between gap-4"
              >
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold tracking-wide text-blue-600 dark:text-blue-400">
                    แบบเสนองานฉบับที่ #{offerDetail.offer.offer_id} · {offerDetail.semester.label}
                  </span>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
                    {offerDetail.company.name_th}
                  </h2>
                  <span className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                    {offerDetail.offer.submitted_at
                      ? `ตอบกลับเมื่อ ${formatThaiDateTime(offerDetail.offer.submitted_at)} · ตอบผ่านระบบแบบสำรวจ`
                      : 'ยังไม่ได้ส่งคำตอบกลับ'}
                    {offerDetail.sent_by_name && (
                      <span className="text-gray-500 dark:text-gray-400">
                        {' '}· ส่งแบบสำรวจโดย {offerDetail.sent_by_name}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex sm:flex-col items-start sm:items-end gap-2 shrink-0">
                  {offerDetail.offer.status === 'submitted' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
                      <Clock className="w-3.5 h-3.5" />
                      รอเจ้าหน้าที่ตรวจ
                    </span>
                  )}
                  {offerDetail.offer.status === 'reviewed' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      ตรวจผ่านแล้ว
                    </span>
                  )}
                  {offerDetail.offer.status === 'declined' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                      <XCircle className="w-3.5 h-3.5" />
                      สถานประกอบการไม่รับในภาคนี้
                    </span>
                  )}
                  {offerDetail.offer.status === 'draft' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-800/50">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      ฉบับร่าง (ถูกตีกลับ)
                    </span>
                  )}

                  <div className="flex items-center gap-2 mt-1">
                    {offerDetail.offer.status !== 'reviewed' && offerDetail.company.email && (
                      <button
                        onClick={handleResendLink}
                        disabled={isResendingLink}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                        title="ส่งลิงก์แบบสำรวจไปยังอีเมลบริษัทอีกครั้ง"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {isResendingLink ? 'กำลังส่ง...' : 'ส่งลิงก์ใหม่'}
                      </button>
                    )}
                    <button
                      data-testid="offer-print"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      พิมพ์เป็น PDF
                    </button>
                  </div>
                </div>
              </div>

              {/* 2. ส่วนที่ 1 · รายละเอียดเกี่ยวกับสถานประกอบการ */}
              <div className="p-5 sm:p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                  <span className="text-xs font-bold tracking-wider text-blue-600 dark:text-blue-400 uppercase">
                    ส่วนที่ 1 · รายละเอียดเกี่ยวกับสถานประกอบการ
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ค่าที่บริษัทแก้เข้ามาจะขึ้นแถบเหลือง
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-xs leading-relaxed">
                  <div className="flex gap-3">
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">ชื่อ (ไทย)</span>
                    <span className="font-bold text-gray-900 dark:text-white">
                      {offerDetail.company.name_th}
                    </span>
                  </div>

                  <div
                    className={`flex gap-3 ${
                      isFieldChanged('name_en')
                        ? 'bg-amber-50 dark:bg-amber-950/40 rounded-lg p-1.5 px-2.5 -m-1.5 border border-amber-200 dark:border-amber-800/60'
                        : ''
                    }`}
                  >
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">ชื่อ (อังกฤษ)</span>
                    <span className="text-gray-800 dark:text-gray-200">
                      {offerDetail.company.name_en || '—'}
                    </span>
                  </div>

                  <div
                    className={`flex gap-3 ${
                      isFieldChanged('address') ||
                      isFieldChanged('district') ||
                      isFieldChanged('province') ||
                      isFieldChanged('postal_code')
                        ? 'bg-amber-50 dark:bg-amber-950/40 rounded-lg p-1.5 px-2.5 -m-1.5 border border-amber-200 dark:border-amber-800/60'
                        : ''
                    }`}
                  >
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">ที่อยู่</span>
                    <span className="text-gray-800 dark:text-gray-200">
                      {offerDetail.company.address || ''}
                      {offerDetail.company.district ? ` อ.${offerDetail.company.district}` : ''}
                      {offerDetail.company.province ? ` จ.${offerDetail.company.province}` : ''}
                      {offerDetail.company.postal_code ? ` ${offerDetail.company.postal_code}` : ''}
                    </span>
                  </div>

                  <div
                    className={`flex gap-3 ${
                      isFieldChanged('phone') || isFieldChanged('fax')
                        ? 'bg-amber-50 dark:bg-amber-950/40 rounded-lg p-1.5 px-2.5 -m-1.5 border border-amber-200 dark:border-amber-800/60'
                        : ''
                    }`}
                  >
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">โทรศัพท์ / โทรสาร</span>
                    <span className="text-gray-800 dark:text-gray-200">
                      {offerDetail.company.phone || '—'}
                      {offerDetail.company.fax ? ` / ${offerDetail.company.fax}` : ''}
                    </span>
                  </div>

                  <div
                    className={`flex gap-3 ${
                      isFieldChanged('email')
                        ? 'bg-amber-50 dark:bg-amber-950/40 rounded-lg p-1.5 px-2.5 -m-1.5 border border-amber-200 dark:border-amber-800/60'
                        : ''
                    }`}
                  >
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">อีเมล</span>
                    <span className="text-gray-800 dark:text-gray-200">
                      {offerDetail.company.email || '—'}
                    </span>
                  </div>

                  <div
                    className={`flex gap-3 ${
                      isFieldChanged('business_type')
                        ? 'bg-amber-50 dark:bg-amber-950/40 rounded-lg p-1.5 px-2.5 -m-1.5 border border-amber-200 dark:border-amber-800/60'
                        : ''
                    }`}
                  >
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">ลักษณะการดำเนินงาน</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">
                      {offerDetail.company.business_type || '—'}
                    </span>
                  </div>

                  <div
                    className={`flex gap-3 ${
                      isFieldChanged('employee_count')
                        ? 'bg-amber-50 dark:bg-amber-950/40 rounded-lg p-1.5 px-2.5 -m-1.5 border border-amber-200 dark:border-amber-800/60'
                        : ''
                    }`}
                  >
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">จำนวนพนักงาน</span>
                    <span className="text-gray-800 dark:text-gray-200 font-medium">
                      {offerDetail.company.employee_count
                        ? `${Number(offerDetail.company.employee_count).toLocaleString()} คน`
                        : '—'}
                    </span>
                  </div>

                  <div
                    className={`flex gap-3 ${
                      isFieldChanged('manager_name') ||
                      isFieldChanged('manager_position') ||
                      isFieldChanged('manager_department') ||
                      isFieldChanged('manager_phone') ||
                      isFieldChanged('manager_fax')
                        ? 'bg-amber-50 dark:bg-amber-950/40 rounded-lg p-1.5 px-2.5 -m-1.5 border border-amber-200 dark:border-amber-800/60'
                        : ''
                    }`}
                  >
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">ผู้จัดการ</span>
                    <span className="text-gray-800 dark:text-gray-200">
                      {offerDetail.company.manager_name || '—'}
                      {offerDetail.company.manager_position ? ` · ${offerDetail.company.manager_position}` : ''}
                      {offerDetail.company.manager_department ? ` · ${offerDetail.company.manager_department}` : ''}
                      {offerDetail.company.manager_phone ? ` · โทร ${offerDetail.company.manager_phone}` : ''}
                      {offerDetail.company.manager_fax ? ` · แฟกซ์ ${offerDetail.company.manager_fax}` : ''}
                    </span>
                  </div>

                  <div
                    className={`flex gap-3 ${
                      isFieldChanged('contact_person') ||
                      isFieldChanged('contact_mode') ||
                      isFieldChanged('contact_position') ||
                      isFieldChanged('contact_department') ||
                      isFieldChanged('contact_phone') ||
                      isFieldChanged('contact_fax')
                        ? 'bg-amber-50 dark:bg-amber-950/40 rounded-lg p-1.5 px-2.5 -m-1.5 border border-amber-200 dark:border-amber-800/60'
                        : ''
                    }`}
                  >
                    <span className="w-32 shrink-0 text-gray-500 dark:text-gray-400">การติดต่อ</span>
                    <span className="text-gray-800 dark:text-gray-200">
                      {offerDetail.company.contact_mode === 'direct'
                        ? 'ติดต่อโดยตรงกับผู้จัดการ'
                        : 'ติดต่อกับบุคคลที่มอบหมาย'}
                      {offerDetail.company.contact_person ? ` — คุณ${offerDetail.company.contact_person}` : ''}
                      {offerDetail.company.contact_position ? ` (${offerDetail.company.contact_position}` : ''}
                      {offerDetail.company.contact_department
                        ? ` · ${offerDetail.company.contact_department})`
                        : offerDetail.company.contact_position
                        ? ')'
                        : ''}
                      {offerDetail.company.contact_phone ? ` · โทร ${offerDetail.company.contact_phone}` : ''}
                      {offerDetail.company.contact_fax ? ` · แฟกซ์ ${offerDetail.company.contact_fax}` : ''}
                    </span>
                  </div>
                </div>

                <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ⛔ <strong>ชื่อสถานประกอบการแก้ผ่านใบนี้ไม่ได้</strong> — ถ้าชื่อผิด{' '}
                    <Link
                      to={`/dashboard?menu=companies&company=${offerDetail.company.company_id}`}
                      className="text-blue-600 dark:text-blue-400 underline font-semibold"
                    >
                      ต้องไปแก้ที่ทำเนียบสถานประกอบการ
                    </Link>{' '}
                    เพราะชื่อเดียวกันนี้ถูกพิมพ์ลงหนังสือราชการที่คณบดีลงนามไปแล้ว
                  </span>
                </div>
              </div>

              {/* 3. ส่วนที่ 2 · งาน สวัสดิการ และคุณสมบัติที่ต้องการ */}
              <div className="p-5 sm:p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                  <span className="text-xs font-bold tracking-wider text-blue-600 dark:text-blue-400 uppercase">
                    ส่วนที่ 2 · งาน สวัสดิการ และคุณสมบัติที่ต้องการ
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    กระดาษหน้า 2 หนึ่งแผ่นต่อหนึ่งรายการ · ใบนี้มี {offerDetail.items.length} แผ่น
                  </span>
                </div>

                {/* Items list */}
                <div className="space-y-4">
                  {offerDetail.items.map((item) => (
                    <div
                      key={item.job_id}
                      data-testid={`offer-item-${item.job_id}`}
                      className="border border-gray-200 dark:border-gray-700/80 rounded-2xl overflow-hidden bg-white dark:bg-gray-900 shadow-sm"
                    >
                      {/* Item header */}
                      <div className="p-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-bold text-gray-900 dark:text-white">
                            {item.title} · {item.quota} อัตรา
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            สาขา{getMajorNames(item.major_ids)} · {formatDurationTerm(item.duration_term)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.status === 'pending_approval' && (
                            <>
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50">
                                ยังไม่เปิดให้นักศึกษาเห็น
                              </span>
                              {offerDetail.offer.status === 'submitted' && (
                                <button
                                  data-testid={`offer-item-reject-${item.job_id}`}
                                  onClick={() => setRejectingItem({ job_id: item.job_id, title: item.title })}
                                  className="px-3 py-1 rounded-xl text-xs font-bold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                                >
                                  ไม่เปิดรายการนี้
                                </button>
                              )}
                            </>
                          )}
                          {item.status === 'published' && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
                              เปิดให้นักศึกษาเห็นแล้ว
                            </span>
                          )}
                          {item.status === 'rejected' && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-800/50">
                              ไม่เปิดรายการนี้ (ปฏิเสธ)
                            </span>
                          )}
                          {item.status === 'closed' && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              ปิดรับแล้ว
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Item rejection reason banner if rejected */}
                      {item.status === 'rejected' && item.reject_reason && (
                        <div className="px-4 py-2.5 bg-red-50/70 dark:bg-red-950/20 border-b border-red-100 dark:border-red-900/40 text-xs text-red-800 dark:text-red-300">
                          <strong>เหตุผลที่ไม่อนุมัติ:</strong> {item.reject_reason}
                        </div>
                      )}

                      {/* Item body KV grid */}
                      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-xs leading-relaxed">
                        <div className="flex gap-3">
                          <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">ลักษณะงาน</span>
                          <span className="text-gray-800 dark:text-gray-200 font-medium">
                            {item.description || '—'}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">ทักษะที่ควรมี</span>
                          <span className="text-gray-800 dark:text-gray-200 font-medium">
                            {item.skills_required || '—'}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">ข้อกำหนดอื่น</span>
                          <span className="text-gray-800 dark:text-gray-200">
                            {item.other_requirements || '—'}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">ค่าตอบแทน</span>
                          <span className="text-gray-800 dark:text-gray-200 font-medium">
                            {item.pay_amount
                              ? `${item.pay_amount.toLocaleString()} บาท / ${
                                  item.pay_unit === 'day'
                                    ? 'วัน'
                                    : item.pay_unit === 'month'
                                    ? 'เดือน'
                                    : item.pay_unit || ''
                                }`
                              : 'ไม่มี'}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">ที่พัก</span>
                          <span className="text-gray-800 dark:text-gray-200">
                            {item.accommodation === 'free'
                              ? 'มี · ไม่เสียค่าใช้จ่าย'
                              : item.accommodation === 'paid'
                              ? `มี · เสียค่าใช้จ่าย (${
                                  item.accommodation_cost
                                    ? `${item.accommodation_cost.toLocaleString()} บาท/เดือน`
                                    : ''
                                })`
                              : 'ไม่มี'}
                          </span>
                        </div>
                        <div className="flex gap-3">
                          <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">สวัสดิการอื่น</span>
                          <span className="text-gray-800 dark:text-gray-200">
                            {item.welfare_other || '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bottom informant & coordinator note */}
                <div className="border-t border-gray-100 dark:border-gray-800 pt-3 flex flex-col gap-1.5 text-xs">
                  <div className="flex gap-3">
                    <span className="w-36 shrink-0 text-gray-500 dark:text-gray-400">ผู้ให้ข้อมูล</span>
                    <span className="font-bold text-gray-900 dark:text-white">
                      {offerDetail.offer.informant_name || '—'}
                      {offerDetail.offer.informant_position ? ` · ${offerDetail.offer.informant_position}` : ''}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-36 shrink-0 text-gray-500 dark:text-gray-400">เจ้าหน้าที่ผู้ประสานงาน</span>
                    <span className="text-red-600 dark:text-red-400 font-semibold">
                      — ระบบยังไม่มีช่องนี้ (ดูสเปกหัวข้อ 12 ข้อ 5)
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. แถบตัดสิน (Decision Bar) & ตีกลับ (Reject Form) */}
              {offerDetail.offer.status === 'submitted' && (
                <>
                  <div className="p-5 sm:p-6 rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                    <div className="flex flex-col gap-1">
                      <span className="text-base font-extrabold text-blue-900 dark:text-blue-300">
                        กดผ่านทั้งใบ = เปิด {pendingItems.length} ตำแหน่ง {pendingQuota} อัตรา ให้นักศึกษาเห็นพร้อมกัน
                      </span>
                      <span className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
                        รายการที่คุณกด “ไม่เปิด” ไปก่อนหน้านี้จะไม่ถูกเปิดตาม — ปุ่มนี้แตะเฉพาะรายการที่ยังรออนุมัติอยู่
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={() => setShowRejectAllBox((prev) => !prev)}
                        className="px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-800/80 bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 font-bold text-sm hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      >
                        ตีกลับทั้งใบ
                      </button>
                      <button
                        data-testid="offer-approve-all"
                        onClick={handleApproveAll}
                        className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-sm transition-colors"
                      >
                        ผ่านทั้งใบ · เปิดให้นักศึกษาเห็น
                      </button>
                    </div>
                  </div>

                  {/* Reject all form card */}
                  {showRejectAllBox && (
                    <div className="p-5 sm:p-6 rounded-2xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-gray-900 shadow-sm flex flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-base font-bold text-gray-900 dark:text-white">
                          ตีกลับทั้งใบ — บังคับใส่เหตุผล
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ใบจะกลับไปเป็นฉบับร่างและบริษัทสามารถแก้แล้วส่งใหม่ได้ · เหตุผลเดียวกันนี้จะถูกบันทึกให้ทุกตำแหน่งในใบ
                        </span>
                      </div>

                      <Textarea
                        data-testid="offer-reject-reason"
                        rows={3}
                        value={rejectAllReason}
                        onChange={(e) => setRejectAllReason(e.target.value)}
                        placeholder="ระบุเหตุผลในการตีกลับ เช่น ลักษณะงานไม่ตรงกับสาขาที่เปิด หรือข้อมูลค่าตอบแทนไม่ชัดเจน..."
                        className="text-sm"
                      />

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <div className="flex items-center gap-2">
                          <button
                            data-testid="offer-reject-all"
                            onClick={handleRejectAll}
                            disabled={!rejectAllReason.trim() || isRejectingAll}
                            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm shadow-sm transition-colors disabled:opacity-50"
                          >
                            {isRejectingAll ? 'กำลังบันทึก...' : 'ยืนยันตีกลับทั้งใบ'}
                          </button>
                          <button
                            onClick={() => {
                              setShowRejectAllBox(false);
                              setRejectAllReason('');
                            }}
                            className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                          >
                            ยกเลิก
                          </button>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ⛔ ตำแหน่งที่มีนักศึกษาสมัครไปแล้วจะถูกปฏิเสธการตีกลับโดยอัตโนมัติ
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Status info notes for non-submitted offers */}
              {offerDetail.offer.status === 'reviewed' && (
                <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    แบบเสนองานฉบับนี้ผ่านการตรวจแล้ว เมื่อ {formatThaiDateTime(offerDetail.offer.reviewed_at)} · ตำแหน่งงานทั้งหมดในใบนี้ได้ถูกเปิดให้นักศึกษาเห็นบนกระดานหางานแล้ว
                  </span>
                </div>
              )}

              {offerDetail.offer.status === 'declined' && (
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 flex flex-col gap-1">
                  <span className="font-bold flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-gray-500" />
                    สถานประกอบการแจ้งว่ายังไม่สะดวกรับนักศึกษาในภาคเรียนนี้
                  </span>
                  {offerDetail.offer.decline_reason && (
                    <span className="text-gray-600 dark:text-gray-400 pl-5">
                      เหตุผลที่ระบุ: {offerDetail.offer.decline_reason}
                    </span>
                  )}
                </div>
              )}

              {offerDetail.offer.status === 'draft' && (
                <div className="p-4 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/50 dark:bg-red-950/20 text-xs text-red-800 dark:text-red-300 flex flex-col gap-1">
                  <span className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    แบบเสนองานฉบับนี้อยู่ในสถานะฉบับร่าง (รอสถานประกอบการส่งคำตอบกลับมาใหม่)
                  </span>
                  {offerDetail.offer.reject_reason && (
                    <span className="pl-5 text-red-700 dark:text-red-400">
                      เหตุผลที่ตีกลับ: {offerDetail.offer.reject_reason}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal for rejecting single job item */}
      {rejectingItem && (
        <Modal
          onClose={() => {
            setRejectingItem(null);
            setRejectItemReason('');
          }}
          title={`ไม่เปิดรับตำแหน่ง: ${rejectingItem.title}`}
        >
          <ModalBody>
            <div className="space-y-4">
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                การปฏิเสธตำแหน่งงานรายรายการจะทำให้ตำแหน่งนี้อยู่ในสถานะ <strong>“ไม่อนุมัติ”</strong> และเมื่อคุณกด <strong>“ผ่านทั้งใบ”</strong> ในภายหลัง รายการนี้จะไม่ถูกเปิดให้นักศึกษาเห็น
              </p>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  เหตุผลที่ไม่เปิดรับตำแหน่งนี้ <span className="text-red-600 dark:text-red-400">*</span>
                </label>
                <Textarea
                  rows={3}
                  value={rejectItemReason}
                  onChange={(e) => setRejectItemReason(e.target.value)}
                  placeholder="เช่น ลักษณะงานไม่ตรงกับสาขาวิชาที่เปิดรับ หรือไม่สอดคล้องกับวัตถุประสงค์ของสหกิจศึกษา..."
                  className="text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setRejectingItem(null);
                    setRejectItemReason('');
                  }}
                  className="px-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleRejectItem}
                  disabled={!rejectItemReason.trim() || isRejectingItem}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
                >
                  {isRejectingItem ? 'กำลังบันทึก...' : 'ยืนยันไม่เปิดรายการนี้'}
                </button>
              </div>
            </div>
          </ModalBody>
        </Modal>
      )}

      {/* ConfirmDialog level 3 */}
      {confirmDialog && (
        <ConfirmDialog
          open={true}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={runConfirm}
          onCancel={() => setConfirmDialog(null)}
          busy={confirmBusy}
        />
      )}
    </div>
  );
};

export default JobOfferReview;
