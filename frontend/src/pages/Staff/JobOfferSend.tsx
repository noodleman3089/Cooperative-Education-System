import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import AlertBanner from '../../components/ui/AlertBanner';
import Modal from '../../components/ui/Modal';
import { getErrorMessage } from '../../utils/errors';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  ExternalLink,
  Send,
  Loader2,
  Copy,
  Check,
  ArrowRight,
} from 'lucide-react';

export interface CompanyRecipient {
  company_id: number;
  name_th: string;
  province: string | null;
  district: string | null;
  email: string | null;
  contact_person: string | null;
  status: 'ready' | 'already_sent' | 'no_email';
  offer_id: number | null;
  sent_at: string | null;
  offer_status: string | null;
  history?: {
    semesters_offered?: number;
    accepted_total?: number;
    last_semester_label?: string | null;
  };
}

export interface SemesterOption {
  semester_id: number;
  label?: string;
  academic_year: number;
  semester: number;
  is_active: boolean;
}

export interface SkippedItem {
  company_id: number;
  name_th: string | null;
  reason: string;
}

export interface SendResult {
  created: number;
  emailed: number;
  skipped: SkippedItem[];
}

interface JobOfferSendProps {
  onNavigateTab?: (tab: 'send' | 'review' | 'posts') => void;
}

const getDefaultDueDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().split('T')[0];
};

const getTodayDate = () => {
  return new Date().toISOString().split('T')[0];
};

const formatThaiDate = (dateStr: string) => {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const yearBE = parseInt(parts[0], 10) + 543;
  const monthNames = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  const monthIndex = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${day} ${monthNames[monthIndex] || parts[1]} ${yearBE}`;
};

const formatSentAtDate = (dateStr: string | null) => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const day = d.getDate();
    const monthNames = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    return `${day} ${monthNames[d.getMonth()]}`;
  } catch {
    return dateStr;
  }
};

const getDaysLeftText = (dueDateStr: string) => {
  if (!dueDateStr) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'วันนี้';
  return `อีก ${diffDays} วัน`;
};

// 5 Reasons strictly according to spec-E-staff section 6.4
const SKIPPED_GROUPS_DEF = [
  {
    order: 1,
    testId: 'survey-skipped-group-1',
    reasonKey: 'ส่งอีเมลไม่สำเร็จ ยังไม่ได้เปิดใบให้บริษัทนี้ กรุณาลองส่งใหม่อีกครั้ง',
    title: 'ส่งอีเมลไม่สำเร็จ — ยังไม่ได้เปิดใบให้บริษัทนี้',
    why: 'ระบบถอยคืนให้เหมือนไม่เคยกดแล้ว (ลบใบและลิงก์ทิ้ง) กดส่งใหม่ได้ทันที ไม่มีใบค้างที่จะทำให้รอบหน้าถูกข้าม',
    type: 'failed_email',
  },
  {
    order: 2,
    testId: 'survey-skipped-group-2',
    reasonKey: 'ไม่มีอีเมลผู้ประสานงานในทะเบียน',
    title: 'ไม่มีอีเมลผู้ประสานงานในทะเบียน',
    why: 'แบบสำรวจส่งไปที่ อีเมลของบริษัทในทำเนียบ เท่านั้น — ไม่ตกไปที่บัญชีคนที่เพิ่มแถวนั้นเข้ามา ไม่งั้นแบบสำรวจจะวิ่งกลับเข้าเมลเจ้าหน้าที่เองแล้วขึ้นว่าส่งสำเร็จ',
    type: 'no_email',
  },
  {
    order: 3,
    testId: 'survey-skipped-group-3',
    reasonKey: 'ส่งแบบสำรวจของภาคเรียนนี้ไปแล้ว',
    title: 'ส่งแบบสำรวจของภาคเรียนนี้ไปแล้ว',
    why: 'หนึ่งบริษัทมีใบเดียวต่อหนึ่งภาคเรียน · ไม่ต้องทำอะไร — ถ้าบริษัทบอกว่าลิงก์หมดอายุ ให้เขากดขอลิงก์ใหม่จากหน้าเดิม หรือกด “ส่งลิงก์ซ้ำ” ที่ใบนั้น',
    type: 'already_sent',
  },
  {
    order: 4,
    testId: 'survey-skipped-group-4',
    reasonKey: 'ไม่พบสถานประกอบการนี้ในทะเบียน',
    title: 'ไม่พบสถานประกอบการนี้ในทะเบียน',
    why: 'แถวถูกลบไประหว่างที่หน้านี้เปิดค้างอยู่ · ระบบไม่รู้ชื่อจึงแสดงได้แค่รหัส — รีเฟรชรายชื่อแล้วเลือกใหม่',
    type: 'not_found',
  },
  {
    order: 5,
    testId: 'survey-skipped-group-5',
    reasonKey: 'เปิดใบสำรวจไม่สำเร็จ',
    title: 'เปิดใบสำรวจไม่สำเร็จ',
    why: 'เหตุผลที่ห้าที่เซิร์ฟเวอร์ส่งมาได้ · เกิดตอนเจ้าหน้าที่สองคนกดส่งภาคเดียวกันพร้อมกัน หรือฐานข้อมูลล้ม — ลองใหม่ได้ทันที',
    type: 'db_error',
  },
] as const;

export const JobOfferSend: React.FC<JobOfferSendProps> = ({ onNavigateTab }) => {
  const [, setSearchParams] = useSearchParams();

  // 1. Semesters
  const [semesters, setSemesters] = useState<SemesterOption[]>([]);
  const [selectedSemesterId, setSelectedSemesterId] = useState<number | null>(null);

  // 2. Due Date
  const [dueDate, setDueDate] = useState<string>(getDefaultDueDate());

  // 3. Recipients
  const [recipients, setRecipients] = useState<CompanyRecipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState<boolean>(false);
  const [summary, setSummary] = useState({ total: 0, ready: 0, already_sent: 0, no_email: 0 });

  // 4. Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterChip, setFilterChip] = useState<'all' | 'unsent' | 'experienced' | 'sent' | 'noemail'>('unsent');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([]);

  // 5. Modals & Actions
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [resendingOfferId, setResendingOfferId] = useState<number | null>(null);

  // 6. Notifications & Result View
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  // Load Semesters
  useEffect(() => {
    let mounted = true;
    const loadSemesters = async () => {
      try {
        const masterRes = await api.get('/master-data');
        if (mounted && masterRes && Array.isArray(masterRes.semesters) && masterRes.semesters.length > 0) {
          setSemesters(masterRes.semesters);
          const active = masterRes.semesters.find((s: SemesterOption) => s.is_active);
          if (active) {
            setSelectedSemesterId(active.semester_id);
          } else {
            setSelectedSemesterId(masterRes.semesters[0].semester_id);
          }
        } else {
          // fallback to active semester
          const activeRes = await api.get('/semesters/active');
          if (mounted && activeRes && activeRes.semester_id) {
            setSemesters([activeRes]);
            setSelectedSemesterId(activeRes.semester_id);
          }
        }
      } catch (err) {
        console.error('Failed to load semesters:', err);
      }
    };
    loadSemesters();
    return () => {
      mounted = false;
    };
  }, []);

  // Load Recipients when selectedSemesterId changes
  const loadRecipients = useCallback(async (semesterId: number) => {
    try {
      setLoadingRecipients(true);
      setError(null);
      const res = await api.get(`/job-offers/recipients?semester_id=${semesterId}`);
      if (res) {
        const comps: CompanyRecipient[] = res.companies || [];
        setRecipients(comps);
        if (res.summary) {
          setSummary(res.summary);
        } else {
          setSummary({
            total: comps.length,
            ready: comps.filter((c) => c.status === 'ready').length,
            already_sent: comps.filter((c) => c.status === 'already_sent').length,
            no_email: comps.filter((c) => c.status === 'no_email').length,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load survey recipients:', err);
      setError(getErrorMessage(err, 'ไม่สามารถโหลดรายชื่อสถานประกอบการได้'));
    } finally {
      setLoadingRecipients(false);
    }
  }, []);

  useEffect(() => {
    if (selectedSemesterId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadRecipients(selectedSemesterId);
      // Reset selected companies when semester changes
      setSelectedCompanyIds([]);
    }
  }, [selectedSemesterId, loadRecipients]);

  // Current semester label
  const currentSemesterLabel = useMemo(() => {
    if (!selectedSemesterId) return '';
    const found = semesters.find((s) => s.semester_id === selectedSemesterId);
    if (!found) return `ภาคเรียนที่ ${selectedSemesterId}`;
    if (found.label) return found.label;
    const yearDisplay = found.academic_year > 2500 ? found.academic_year : found.academic_year + 543;
    return `ภาคเรียนที่ ${found.semester}/${yearDisplay}`;
  }, [selectedSemesterId, semesters]);

  // Filtered companies
  const filteredCompanies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return recipients.filter((c) => {
      // Search
      if (q) {
        const matchName = c.name_th?.toLowerCase().includes(q);
        const matchProv = c.province?.toLowerCase().includes(q);
        const matchDist = c.district?.toLowerCase().includes(q);
        const matchEmail = c.email?.toLowerCase().includes(q);
        const matchContact = c.contact_person?.toLowerCase().includes(q);
        if (!matchName && !matchProv && !matchDist && !matchEmail && !matchContact) {
          return false;
        }
      }

      // Filter chips
      if (filterChip === 'unsent') return c.status === 'ready';
      if (filterChip === 'experienced') {
        const accepted = c.history?.accepted_total ?? 0;
        const offered = c.history?.semesters_offered ?? 0;
        return accepted > 0 || offered > 0;
      }
      if (filterChip === 'sent') return c.status === 'already_sent';
      if (filterChip === 'noemail') return c.status === 'no_email';
      return true;
    });
  }, [recipients, searchQuery, filterChip]);

  // Selectable companies in current view
  const selectableVisibleIds = useMemo(() => {
    return filteredCompanies.filter((c) => c.status === 'ready').map((c) => c.company_id);
  }, [filteredCompanies]);

  const isAllSelectableChecked =
    selectableVisibleIds.length > 0 &&
    selectableVisibleIds.every((id) => selectedCompanyIds.includes(id));

  const handleToggleSelectAll = () => {
    if (isAllSelectableChecked) {
      // Deselect visible
      setSelectedCompanyIds((prev) => prev.filter((id) => !selectableVisibleIds.includes(id)));
    } else {
      // Add visible up to 100
      const combined = Array.from(new Set([...selectedCompanyIds, ...selectableVisibleIds]));
      setSelectedCompanyIds(combined.slice(0, 100));
    }
  };

  const handleToggleRow = (companyId: number) => {
    setSelectedCompanyIds((prev) => {
      if (prev.includes(companyId)) {
        return prev.filter((id) => id !== companyId);
      } else {
        if (prev.length >= 100) return prev;
        return [...prev, companyId];
      }
    });
  };

  // Resend link on a company already sent
  const handleResendLink = async (company: CompanyRecipient) => {
    if (!company.offer_id) return;
    try {
      setResendingOfferId(company.offer_id);
      setError(null);
      const res = await api.post(`/job-offers/${company.offer_id}/resend-link`);
      setSuccess(
        res?.message || `ส่งลิงก์ตอบแบบสำรวจใหม่ไปที่ ${company.email} เรียบร้อยแล้ว (ลิงก์มีอายุ 24 ชั่วโมง)`
      );
    } catch (err) {
      console.error('Resend link error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถส่งลิงก์ใหม่ได้'));
    } finally {
      setResendingOfferId(null);
    }
  };

  // Perform send survey to selected company IDs
  const executeSendSurvey = async (idsToSend: number[]) => {
    if (!selectedSemesterId) {
      setError('กรุณาเลือกภาคเรียนที่ต้องการสำรวจ');
      return;
    }
    if (!dueDate) {
      setError('กรุณาระบุกำหนดส่งคำตอบกลับ');
      return;
    }
    if (idsToSend.length === 0) {
      setError('กรุณาเลือกสถานประกอบการอย่างน้อยหนึ่งราย');
      return;
    }

    try {
      setIsSending(true);
      setError(null);
      setIsConfirmOpen(false);

      const payload = {
        semester_id: selectedSemesterId,
        due_date: dueDate,
        company_ids: idsToSend,
      };

      const res = await api.post('/job-offers/send', payload);
      setSendResult({
        created: res.created ?? 0,
        emailed: res.emailed ?? 0,
        skipped: res.skipped ?? [],
      });
      // Clear selection upon successful send attempt
      setSelectedCompanyIds([]);
      // Reload recipients silently in background
      loadRecipients(selectedSemesterId);
    } catch (err) {
      console.error('Send survey error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถส่งแบบสำรวจได้'));
    } finally {
      setIsSending(false);
    }
  };

  // Handle retry for Group 1 failed emails
  const handleRetryFailed = async (group1Ids: number[]) => {
    if (group1Ids.length === 0) return;
    await executeSendSurvey(group1Ids);
  };

  // Copy skipped names to clipboard
  const handleCopySkippedList = () => {
    if (!sendResult || sendResult.skipped.length === 0) return;
    const text = sendResult.skipped
      .map((s) => `${s.name_th || `รหัส ${s.company_id}`}: ${s.reason}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2500);
    });
  };

  // Navigate to Company Directory to add email
  const handleGoToCompanies = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('menu', 'companies');
      next.set('filter', 'noemail');
      return next;
    });
  };

  // ═════════════════════════════════════════════════════════════════
  // RENDER: SURVEY RESULT VIEW (E2.1 - The Heart of G4)
  // ═════════════════════════════════════════════════════════════════
  if (sendResult !== null) {
    const totalAttempted = sendResult.created + sendResult.skipped.length;
    const skippedCount = sendResult.skipped.length;

    // Group skipped items into the 5 strict categories
    const groupedSkipped = SKIPPED_GROUPS_DEF.map((def) => {
      const items =
        def.order === 1
          ? sendResult.skipped.filter((s) =>
              s.reason.includes('ส่งอีเมลไม่สำเร็จ') || s.reason.includes(def.reasonKey)
            )
          : def.order === 2
          ? sendResult.skipped.filter((s) =>
              s.reason.includes('ไม่มีอีเมล') || s.reason.includes(def.reasonKey)
            )
          : def.order === 3
          ? sendResult.skipped.filter((s) =>
              s.reason.includes('ส่งแบบสำรวจของภาคเรียนนี้ไปแล้ว') || s.reason.includes(def.reasonKey)
            )
          : def.order === 4
          ? sendResult.skipped.filter((s) =>
              s.reason.includes('ไม่พบสถานประกอบการ') || s.reason.includes(def.reasonKey)
            )
          : sendResult.skipped.filter((s) => {
              const caughtKeys = [
                'ส่งอีเมลไม่สำเร็จ',
                'ไม่มีอีเมล',
                'ส่งแบบสำรวจของภาคเรียนนี้ไปแล้ว',
                'ไม่พบสถานประกอบการ',
              ];
              return (
                s.reason.includes('เปิดใบสำรวจไม่สำเร็จ') ||
                !caughtKeys.some((k) => s.reason.includes(k))
              );
            });
      return {
        ...def,
        items,
      };
    });

    const group1Items = groupedSkipped.find((g) => g.order === 1)?.items || [];

    return (
      <div className="space-y-6 page-enter max-w-5xl">
        {/* Top Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            ผลการส่งแบบสำรวจ — จอนี้คือหัวใจของหน้าส่ง
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            ส่ง {totalAttempted} ราย ข้าม {skippedCount} ราย · คนกดต้องรู้{' '}
            <strong className="text-gray-900 dark:text-white">ทันทีโดยไม่ต้องคลิกอะไรอีก</strong>{' '}
            ว่าใครไม่ได้รับ เพราะอะไร และต้องทำอะไรต่อ
            <br />
            <span className="text-red-600 dark:text-red-400 font-medium">
              ⛔ ห้ามยุบเป็นข้อความ “ส่งสำเร็จ {sendResult.created} รายการ” แล้วให้ไปหาเอาเองว่าอีก {skippedCount} หายไปไหน
            </span>
          </p>
        </div>

        <AlertBanner variant="error" message={error} />
        <AlertBanner variant="success" message={success} />

        {/* Big Gradient Summary Card */}
        <div className="bg-white dark:bg-gray-900 border border-blue-200 dark:border-blue-900/60 rounded-2xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-b from-blue-50 to-white dark:from-blue-950/30 dark:to-gray-900 p-6 md:p-7 flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="space-y-2">
              <span className="text-xs font-bold text-blue-700 dark:text-blue-400">
                {currentSemesterLabel} · กำหนดส่งกลับ {formatThaiDate(dueDate)}
              </span>
              <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white">
                ส่งอีเมลออกไปแล้ว {sendResult.created} ฉบับ · ข้าม {skippedCount} ราย
              </h2>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                ใบสำรวจถูกเปิดให้ {sendResult.created} แห่ง พร้อมลิงก์ตอบอายุ 24 ชั่วโมง
                <br />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  จำนวนใบที่เปิดกับจำนวนอีเมลที่ส่งออกเท่ากันเสมอโดยตั้งใจ — ใบที่ส่งเมลไม่ออกจะถูกลบทิ้ง ไม่นับว่าเปิดแล้ว
                </span>
              </p>
            </div>

            {/* Side-by-side Counters */}
            <div className="flex items-center gap-3 self-start shrink-0">
              <div className="w-28 text-center bg-white dark:bg-gray-800 border border-green-200 dark:border-green-800/60 rounded-2xl p-4 shadow-sm">
                <div
                  data-testid="survey-result-sent"
                  className="text-3xl font-extrabold text-green-700 dark:text-green-400 leading-none"
                >
                  {sendResult.created}
                </div>
                <div className="text-xs font-bold text-green-700 dark:text-green-400 mt-1">
                  ส่งสำเร็จ
                </div>
              </div>

              <div className="w-28 text-center bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 shadow-sm">
                <div
                  data-testid="survey-result-skipped-count"
                  className="text-3xl font-extrabold text-amber-700 dark:text-amber-400 leading-none"
                >
                  {skippedCount}
                </div>
                <div className="text-xs font-bold text-amber-700 dark:text-amber-400 mt-1">
                  ถูกข้าม
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Skipped Groups Breakdown */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {skippedCount} รายที่ไม่ได้รับ แยกตามเหตุผล
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                เรียงจาก “ต้องลงมือทันที” ลงมาหา “ไม่ต้องทำอะไร” · เหตุผลมาจากเซิร์ฟเวอร์ตรง ๆ หน้าจอไม่แต่งข้อความเอง
              </p>
            </div>
            {skippedCount > 0 && (
              <button
                type="button"
                onClick={handleCopySkippedList}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm"
              >
                {copyFeedback ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copyFeedback ? 'คัดลอกแล้ว' : 'คัดลอกรายชื่อทั้งหมด'}
              </button>
            )}
          </div>

          <div className="space-y-4">
            {groupedSkipped.map((group) => {
              const hasItems = group.items.length > 0;

              // Color styles per group
              let borderStyle = 'border-gray-200 dark:border-gray-800';
              let headerBg = 'bg-gray-50 dark:bg-gray-800/40';
              let badgeBg = 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
              let titleColor = 'text-gray-900 dark:text-white';
              let whyColor = 'text-gray-500 dark:text-gray-400';

              if (group.order === 1) {
                borderStyle = hasItems ? 'border-red-200 dark:border-red-900/60' : 'border-gray-200 dark:border-gray-800';
                headerBg = hasItems ? 'bg-red-50 dark:bg-red-950/30' : 'bg-gray-50 dark:bg-gray-800/40';
                badgeBg = hasItems ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' : badgeBg;
                titleColor = hasItems ? 'text-red-800 dark:text-red-300' : 'text-gray-500 dark:text-gray-400';
                whyColor = hasItems ? 'text-red-700 dark:text-red-400' : whyColor;
              } else if (group.order === 2) {
                borderStyle = hasItems ? 'border-amber-200 dark:border-amber-900/60' : 'border-gray-200 dark:border-gray-800';
                headerBg = hasItems ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-gray-50 dark:bg-gray-800/40';
                badgeBg = hasItems ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' : badgeBg;
                titleColor = hasItems ? 'text-amber-900 dark:text-amber-200' : 'text-gray-500 dark:text-gray-400';
                whyColor = hasItems ? 'text-amber-800 dark:text-amber-300' : whyColor;
              } else if (group.order === 3) {
                headerBg = hasItems ? 'bg-blue-50/60 dark:bg-blue-950/20' : 'bg-gray-50 dark:bg-gray-800/40';
                badgeBg = hasItems ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' : badgeBg;
              } else if (group.order === 5) {
                borderStyle = hasItems ? 'border-red-200 dark:border-red-900/60' : 'border-dashed border-gray-300 dark:border-gray-700';
                headerBg = hasItems ? 'bg-red-50/50 dark:bg-red-950/20' : 'bg-white dark:bg-gray-900';
              }

              return (
                <div
                  key={group.order}
                  data-testid={group.testId}
                  className={`border rounded-2xl overflow-hidden transition-all ${borderStyle}`}
                >
                  <div className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${headerBg}`}>
                    <div className="flex items-start sm:items-center gap-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${badgeBg}`}>
                        {group.items.length} ราย
                      </span>
                      <div>
                        <h4 className={`text-sm font-bold ${titleColor}`}>{group.title}</h4>
                        <p className={`text-xs mt-0.5 leading-relaxed ${whyColor}`}>
                          {group.why}
                          {group.order === 5 && !hasItems && (
                            <span className="block text-gray-600 dark:text-gray-400 mt-0.5 font-normal">
                              รอบนี้ไม่มี แต่หน้าจอต้องรองรับไว้ เพราะเป็นค่าที่ API ส่งมาได้จริง
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Group Action Buttons */}
                    {group.order === 1 && hasItems && (
                      <button
                        type="button"
                        data-testid="survey-retry-failed"
                        onClick={() => handleRetryFailed(group1Items.map((i) => i.company_id))}
                        disabled={isSending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 rounded-xl transition-all shrink-0 shadow-sm disabled:opacity-50"
                      >
                        {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        ส่งซ้ำเฉพาะ {group.items.length} รายนี้
                      </button>
                    )}

                    {group.order === 2 && hasItems && (
                      <button
                        type="button"
                        onClick={handleGoToCompanies}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-200 bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-xl transition-all shrink-0 shadow-sm"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        เติมอีเมลทีละราย
                      </button>
                    )}

                    {group.order === 4 && hasItems && (
                      <button
                        type="button"
                        onClick={() => selectedSemesterId && loadRecipients(selectedSemesterId)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl transition-all shrink-0 shadow-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        รีเฟรชทำเนียบ
                      </button>
                    )}
                  </div>

                  {/* Company rows inside this group */}
                  {hasItems && (
                    <div className="divide-y divide-gray-100 dark:divide-gray-800/80 px-4 py-1 bg-white dark:bg-gray-900">
                      {group.items.map((item) => {
                        const displayName =
                          item.name_th && item.name_th.trim() !== ''
                            ? item.name_th
                            : `รหัสสถานประกอบการ ${item.company_id}`;
                        const isNullName = !item.name_th || item.name_th.trim() === '';

                        return (
                          <div
                            key={item.company_id}
                            data-testid={`survey-skipped-row-${item.company_id}`}
                            className="py-2.5 flex items-center justify-between gap-4 text-xs"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`font-bold truncate ${
                                  isNullName
                                    ? 'text-gray-500 dark:text-gray-400'
                                    : 'text-gray-900 dark:text-white'
                                }`}
                              >
                                {displayName}
                              </span>
                              {isNullName && (
                                <span className="text-gray-600 dark:text-gray-400 text-[11px] shrink-0">
                                  (ไม่มีชื่อให้แสดง)
                                </span>
                              )}
                            </div>

                            {/* Row context action/note */}
                            {group.order === 2 && (
                              <button
                                type="button"
                                onClick={handleGoToCompanies}
                                className="text-blue-600 dark:text-blue-400 hover:underline shrink-0 text-xs inline-flex items-center gap-1"
                              >
                                เปิดในทำเนียบ
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            )}

                            {group.order === 3 && (
                              <span className="text-gray-500 dark:text-gray-400 text-[11px] shrink-0">
                                ส่งไปแล้ว · ไม่ต้องทำอะไร
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom Navigation Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              setSendResult(null);
              if (selectedSemesterId) loadRecipients(selectedSemesterId);
            }}
            className="px-5 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm flex items-center gap-2"
          >
            กลับไปหน้าเลือกบริษัท
          </button>
          <button
            type="button"
            onClick={() => {
              if (onNavigateTab) {
                onNavigateTab('review');
              } else {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('tab', 'review');
                  return next;
                });
              }
            }}
            className="px-5 py-2.5 rounded-xl font-bold text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm flex items-center gap-2"
          >
            ดูใบที่เปิดไว้ทั้งหมดของภาคนี้
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════
  // RENDER: SURVEY SEND SELECTION VIEW (E2)
  // ═════════════════════════════════════════════════════════════════
  const selectedCount = selectedCompanyIds.length;
  const isSendDisabled = selectedCount === 0 || selectedCount > 100 || !dueDate;

  return (
    <div className="space-y-6 page-enter max-w-6xl">
      <AlertBanner variant="error" message={error} />
      <AlertBanner variant="success" message={success} />

      {/* Batch Setup Card */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-end gap-5">
          {/* Semester Selector */}
          <div className="w-full lg:w-72 space-y-1.5">
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
              ภาคเรียนที่ต้องการสำรวจ
            </label>
            <select
              data-testid="survey-semester"
              value={selectedSemesterId ?? ''}
              onChange={(e) => setSelectedSemesterId(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all shadow-sm"
            >
              {semesters.map((s) => {
                const yearDisplay = s.academic_year > 2500 ? s.academic_year : s.academic_year + 543;
                return (
                  <option key={s.semester_id} value={s.semester_id}>
                    ภาคเรียนที่ {s.semester}/{yearDisplay} {s.is_active ? '(ภาคปัจจุบัน)' : ''}
                  </option>
                );
              })}
            </select>
            <span className="block text-[11px] text-gray-500 dark:text-gray-400">
              หนึ่งบริษัทมีใบเดียวต่อหนึ่งภาคเรียน
            </span>
          </div>

          {/* Due Date Input */}
          <div className="w-full lg:w-60 space-y-1.5">
            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
              กำหนดส่งคำตอบกลับ
            </label>
            <input
              type="date"
              data-testid="survey-due-date"
              min={getTodayDate()}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white font-medium text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all shadow-sm"
            />
            <span className="block text-[11px] text-gray-500 dark:text-gray-400">
              บรรทัดท้ายกระดาษ “กรุณาส่งกลับก่อนวันที่ …” · เป็นอดีตไม่ได้
            </span>
          </div>

          {/* Guidelines Notice */}
          <div className="flex-1 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 pt-4 lg:pt-0 lg:pl-6 space-y-1">
            <span className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              ลิงก์ตอบแบบสำรวจมีอายุ 24 ชั่วโมง
            </span>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              อีเมลจะวิ่งไปที่ <strong className="text-gray-900 dark:text-gray-200">อีเมลผู้ประสานงานในทะเบียน</strong> เท่านั้น ไม่ตกไปที่บัญชีคนที่เพิ่มแถวนั้นเข้ามา · บริษัทที่ลิงก์หมดอายุกดขอลิงก์ใหม่ได้เองจากหน้าที่ลิงก์พาไป
            </p>
          </div>
        </div>
      </div>

      {/* Filter Chips & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            data-testid="survey-search"
            placeholder="ค้นหาชื่อสถานประกอบการ หรือจังหวัด"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm"
          />
        </div>

        {/* Chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            data-testid="survey-filter-unsent"
            onClick={() => setFilterChip(filterChip === 'unsent' ? 'all' : 'unsent')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border shadow-sm ${
              filterChip === 'unsent'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 ring-1 ring-blue-500/20'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-50'
            }`}
          >
            ยังไม่ได้ส่ง ({summary.ready})
          </button>

          <button
            type="button"
            data-testid="survey-filter-experienced"
            onClick={() => setFilterChip(filterChip === 'experienced' ? 'all' : 'experienced')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border shadow-sm ${
              filterChip === 'experienced'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 ring-1 ring-blue-500/20'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-50'
            }`}
          >
            เคยรับนักศึกษา (
            {recipients.filter(
              (c) => (c.history?.accepted_total ?? 0) > 0 || (c.history?.semesters_offered ?? 0) > 0
            ).length}
            )
          </button>

          <button
            type="button"
            data-testid="survey-filter-sent"
            onClick={() => setFilterChip(filterChip === 'sent' ? 'all' : 'sent')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border shadow-sm ${
              filterChip === 'sent'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700 ring-1 ring-blue-500/20'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-50'
            }`}
          >
            ส่งแล้ว ({summary.already_sent})
          </button>

          <button
            type="button"
            data-testid="survey-filter-noemail"
            onClick={() => setFilterChip(filterChip === 'noemail' ? 'all' : 'noemail')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border shadow-sm ${
              filterChip === 'noemail'
                ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 ring-1 ring-red-500/20'
                : 'bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800/60 hover:bg-red-50'
            }`}
          >
            ไม่มีอีเมล ({summary.no_email})
          </button>
        </div>
      </div>

      {/* Warning banner if companies have no email */}
      {summary.no_email > 0 && (
        <div className="border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
              <strong className="font-bold">{summary.no_email} แห่งในทำเนียบยังไม่มีอีเมลผู้ประสานงาน</strong> —
              ติ๊กเลือกไม่ได้ และจะไม่ถูกนับรวมตอนกดส่ง · เติมอีเมลที่ทำเนียบก่อนถ้าต้องการให้ได้รับ
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFilterChip('noemail')}
            className="px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-200 bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-700 rounded-xl hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-all shrink-0 self-start sm:self-auto shadow-sm"
          >
            ดู {summary.no_email} แห่งนั้น
          </button>
        </div>
      )}

      {/* Selection Table */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300">
                <th className="p-3.5 pl-4 w-12 text-center">
                  <input
                    type="checkbox"
                    aria-label="เลือกทั้งหมด"
                    checked={isAllSelectableChecked}
                    onChange={handleToggleSelectAll}
                    disabled={selectableVisibleIds.length === 0}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 focus:ring-blue-500 cursor-pointer disabled:opacity-40"
                  />
                </th>
                <th className="p-3.5">สถานประกอบการ</th>
                <th className="p-3.5">อีเมลผู้ประสานงาน</th>
                <th className="p-3.5">ประวัติกับคณะ</th>
                <th className="p-3.5 pr-4">สถานะของ{currentSemesterLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/80">
              {loadingRecipients ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500 dark:text-gray-400 text-xs">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600 dark:text-blue-400" />
                    กำลังโหลดรายชื่อสถานประกอบการ...
                  </td>
                </tr>
              ) : filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500 dark:text-gray-400 text-xs">
                    ไม่พบข้อมูลสถานประกอบการที่ตรงกับเงื่อนไขการค้นหา
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((c) => {
                  const isChecked = selectedCompanyIds.includes(c.company_id);
                  const isReady = c.status === 'ready';
                  const isSent = c.status === 'already_sent';
                  const isNoEmail = c.status === 'no_email';

                  let rowBg = 'hover:bg-gray-50/70 dark:hover:bg-gray-800/40';
                  if (isSent) rowBg = 'bg-gray-50/60 dark:bg-gray-800/30 text-gray-500 dark:text-gray-400';
                  if (isNoEmail) rowBg = 'bg-red-50/40 dark:bg-red-950/20';

                  return (
                    <tr
                      key={c.company_id}
                      data-testid={`survey-row-${c.company_id}`}
                      className={`transition-colors ${rowBg}`}
                    >
                      {/* Checkbox */}
                      <td className="p-3.5 pl-4 text-center align-middle">
                        <input
                          type="checkbox"
                          data-testid={`survey-check-${c.company_id}`}
                          checked={isChecked}
                          disabled={!isReady}
                          onChange={() => handleToggleRow(c.company_id)}
                          className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 dark:bg-gray-700 focus:ring-blue-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                      </td>

                      {/* Company Name & Location */}
                      <td className="p-3.5 align-middle">
                        <div className="font-bold text-sm text-gray-900 dark:text-white">
                          {c.name_th}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {c.district ? `อ.${c.district} ` : ''}
                          {c.province ? `จ.${c.province}` : ''}
                        </div>
                      </td>

                      {/* Email */}
                      <td className="p-3.5 align-middle text-xs">
                        {isNoEmail ? (
                          <span className="text-red-600 dark:text-red-400 font-bold">
                            — ไม่มีในทะเบียน
                          </span>
                        ) : (
                          <span className="text-gray-700 dark:text-gray-300 font-mono">
                            {c.email || '—'}
                          </span>
                        )}
                      </td>

                      {/* History with Faculty */}
                      <td className="p-3.5 align-middle text-xs text-gray-600 dark:text-gray-400">
                        {c.history && (c.history.accepted_total ?? 0) > 0 ? (
                          <span>
                            รับ {c.history.accepted_total} คน
                            {c.history.last_semester_label ? ` · ${c.history.last_semester_label}` : ''}
                          </span>
                        ) : c.history && (c.history.semesters_offered ?? 0) > 0 ? (
                          <span>เคยเปิด {c.history.semesters_offered} ภาค</span>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">ยังไม่เคยรับ</span>
                        )}
                      </td>

                      {/* Semester Status Badge & Action Link */}
                      <td className="p-3.5 pr-4 align-middle text-xs">
                        {isReady && (
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">
                            ยังไม่ได้ส่ง
                          </span>
                        )}

                        {isSent && (
                          <div>
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                              ส่งไปแล้ว {formatSentAtDate(c.sent_at)}
                            </span>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1.5">
                              <span>รอบริษัทตอบ</span>
                              <span>·</span>
                              <button
                                type="button"
                                disabled={resendingOfferId === c.offer_id}
                                onClick={() => handleResendLink(c)}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-semibold disabled:opacity-50"
                              >
                                {resendingOfferId === c.offer_id ? 'กำลังส่ง...' : 'ส่งลิงก์ซ้ำ'}
                              </button>
                            </div>
                          </div>
                        )}

                        {isNoEmail && (
                          <div>
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                              ส่งไม่ได้
                            </span>
                            <div className="text-[11px] mt-1">
                              <button
                                type="button"
                                onClick={handleGoToCompanies}
                                className="text-red-600 dark:text-red-400 hover:underline font-semibold"
                              >
                                เติมอีเมลที่ทำเนียบ
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            แสดง {filteredCompanies.length} จาก {recipients.length} แห่งในทำเนียบ
          </span>
          {filterChip !== 'all' && (
            <button
              type="button"
              onClick={() => setFilterChip('all')}
              className="text-blue-600 dark:text-blue-400 hover:underline font-semibold"
            >
              แสดงทั้งหมด
            </button>
          )}
        </div>
      </div>

      {/* Bottom Floating/Fixed-Like Selection Summary Card */}
      <div className="bg-blue-50/90 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-2xl p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div>
            <div
              data-testid="survey-selected-count"
              className="text-lg font-extrabold text-blue-900 dark:text-blue-200"
            >
              เลือกไว้ {selectedCount} แห่ง
            </div>
            <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
              จาก {recipients.length} แห่งในทำเนียบ · ข้ามอัตโนมัติ {summary.no_email} แห่งที่ไม่มีอีเมล และ {summary.already_sent} แห่งที่ส่งไปแล้ว
            </div>
          </div>

          <div className="hidden sm:block border-l border-blue-200 dark:border-blue-800 pl-4 text-xs text-blue-800 dark:text-blue-300">
            ส่งได้ครั้งละไม่เกิน <strong className="font-bold">100 ราย</strong>
          </div>
        </div>

        <div className="flex items-center gap-3 self-end sm:self-auto">
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={() => setSelectedCompanyIds([])}
              className="px-4 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl transition-all shadow-sm"
            >
              ล้างการเลือก
            </button>
          )}

          <button
            type="button"
            data-testid="survey-open-confirm"
            disabled={isSendDisabled}
            onClick={() => setIsConfirmOpen(true)}
            className="px-5 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-all shadow-sm flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            ตรวจทานก่อนส่ง
          </button>
        </div>
      </div>

      {/* Confirmation Modal (Level 3 Confirm Dialog) */}
      {isConfirmOpen && (
        <Modal
          onClose={() => setIsConfirmOpen(false)}
          title={`ส่งแบบสำรวจให้ ${selectedCount} แห่ง`}
          size="xl"
        >
          <div className="space-y-4 pt-1">
            <span className="text-xs font-bold text-gray-500 dark:text-gray-400 block">
              กล่องยืนยัน — ขึ้นก่อนยิงคำขอจริง
            </span>

            <div className="border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex gap-4">
                <span className="w-28 text-gray-500 dark:text-gray-400">ภาคเรียน</span>
                <span className="font-bold text-gray-900 dark:text-white">{currentSemesterLabel}</span>
              </div>
              <div className="flex gap-4">
                <span className="w-28 text-gray-500 dark:text-gray-400">กำหนดส่งกลับ</span>
                <span className="font-bold text-gray-900 dark:text-white">
                  {formatThaiDate(dueDate)} ({getDaysLeftText(dueDate)})
                </span>
              </div>
              <div className="flex gap-4">
                <span className="w-28 text-gray-500 dark:text-gray-400">จะได้รับอีเมล</span>
                <span className="font-bold text-gray-900 dark:text-white">
                  {selectedCount} ฉบับ · ลิงก์อายุ 24 ชั่วโมง
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              <strong className="text-gray-900 dark:text-white">อีเมลที่ส่งออกไปแล้วเรียกคืนไม่ได้</strong> · ถ้าส่งเมลรายไหนไม่สำเร็จ ระบบจะลบใบของรายนั้นทิ้งให้เหมือนไม่เคยกด แล้วคุณกดส่งใหม่ได้ — จะไม่มีใบค้างที่ทำให้รอบหน้าถูกข้ามด้วยเหตุผล “ส่งไปแล้ว”
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(false)}
                className="px-4 py-2 text-xs font-bold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl transition-all shadow-sm"
              >
                ย้อนกลับไปแก้รายชื่อ
              </button>
              <button
                type="button"
                data-testid="survey-confirm-send"
                disabled={isSending}
                onClick={() => executeSendSurvey(selectedCompanyIds)}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                ส่งเลย {selectedCount} ฉบับ
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Indeterminate Loading Overlay while Sending (⛔ NO Numerical Counter!) */}
      {isSending && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
              ระหว่างรอผล — คำขอเดียวที่ทำหลายรอบฝั่งเซิร์ฟเวอร์ อาจใช้เวลาหลายสิบวินาที
            </span>
            <div className="flex items-center gap-3">
              <Loader2 className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
              <div>
                <h4 className="text-base font-bold text-gray-900 dark:text-white">กำลังส่งแบบสำรวจ…</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  ห้ามปิดหน้านี้ · ปุ่มส่งถูกล็อกไว้จนกว่าจะได้คำตอบ เพื่อไม่ให้กดซ้ำแล้วเปิดใบซ้อน
                </p>
              </div>
            </div>

            {/* Indeterminate Animated Progress Bar */}
            <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden relative">
              <div className="h-full bg-blue-600 w-2/5 rounded-full absolute animate-[indeterminate_1.5s_infinite_ease-in-out]" />
            </div>

            <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
              ⛔ แถบนี้เป็นแค่ตัวบอกว่าระบบยังทำงานอยู่{' '}
              <strong className="text-gray-600 dark:text-gray-400">ไม่ใช่ความคืบหน้าจริงรายบริษัท</strong>{' '}
              — API ตอบครั้งเดียวตอนจบ อย่าตั้งชื่อหรือใส่ตัวเลขที่สัญญาเกินกว่าที่ข้อมูลรู้
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobOfferSend;
