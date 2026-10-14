import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import Button from '../../components/ui/Button';
import AlertBanner from '../../components/ui/AlertBanner';
import PageSkeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ConfirmSummary from '../../components/ui/ConfirmSummary';
import { Textarea } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';
import {
  CheckCircle,
  AlertTriangle,
  Clock,
  FileText,
  Check,
  Download,
  AlertCircle,
  ClipboardList,
} from 'lucide-react';

interface StudentInfo {
  student_id: number;
  student_code: string;
  full_name: string;
  major_name_th: string;
  start_date: string;
  end_date: string;
  week_total: number;
  week_current: number;
  certified_count: number;
  submitted_count: number;
  draft_due_date: string | null;
}

interface GenericLog {
  kind: 'weekly_log' | 'monthly_log' | 'daily_log';
  id: number;
  week_or_month_label: string;
  start_date: string;
  end_date: string;
  submitted_at: string;
  status: 'draft' | 'submitted' | 'approved' | 'returned';
  mentor_certified_at: string | null;
  mentor_certified_name: string | null;
  returned_comment: string | null;
  external_file_path: string | null;
  summary: string | null;
  // Weekly specific
  assigned_work?: string;
  methods?: string;
  tools_used?: string;
  achievements?: string;
  problems?: string;
  // Monthly specific
  work_summary?: string;
  effectiveness?: string;
}

interface FinalReportDraft {
  report_id: number;
  student_id: number;
  version: number;
  file_path: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewer_comment: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  report_title: string | null;
  draft_due_date: string | null;
  is_overdue: boolean;
}

const MentorCertify: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const studentIdParam = searchParams.get('student');
  const tabParam = searchParams.get('tab');
  const activeTab: 'logs' | 'draft' = tabParam === 'draft' ? 'draft' : 'logs';

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Available students list
  const [studentsList, setStudentsList] = useState<StudentInfo[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentInfo | null>(null);

  // Tab 1: Logs state
  const [logs, setLogs] = useState<GenericLog[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [selectedLogKind, setSelectedLogKind] = useState<string>('weekly_log');
  const [selectedBatchIds, setSelectedBatchIds] = useState<Array<{ kind: string; id: number }>>([]);
  const [isBatchCertifying, setIsBatchCertifying] = useState<boolean>(false);
  const [isCertifyingSingle, setIsCertifyingSingle] = useState<boolean>(false);
  // รับรอง/ลงนามแล้วพี่เลี้ยงยกเลิกเองไม่ได้ — ทุกทางต้องผ่านกล่องยืนยันที่บอกว่ากำลังทำกับใคร ใบไหน
  const [pendingConfirm, setPendingConfirm] = useState<'single' | 'batch' | null>(null);

  // Return modal state
  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [returnComment, setReturnComment] = useState<string>('');
  const [isReturning, setIsReturning] = useState<boolean>(false);

  // Tab 2: Report Draft state
  const [drafts, setDrafts] = useState<FinalReportDraft[]>([]);
  const [outlineTopic, setOutlineTopic] = useState<string>('');
  const [draftComment, setDraftComment] = useState<string>('');
  const [isDraftReviewing, setIsDraftReviewing] = useState<boolean>(false);

  // Format date helper
  const formatThaiDate = (dateStr?: string | null) => {
    if (!dateStr) return '–';
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat('th-TH', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
      }).format(d);
    } catch {
      return dateStr;
    }
  };

  // Format full date-time helper
  const formatThaiDateTime = (dateStr?: string | null) => {
    if (!dateStr) return '–';
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat('th-TH', {
        day: 'numeric',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return dateStr;
    }
  };

  // Initial load: Fetch mentor students
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const pendingRes = await api.get('/mentor/pending');
        if (cancelled) return;
        setError(null);
        const stdList: StudentInfo[] = pendingRes?.students || [];
        setStudentsList(stdList);

        let targetStudent: StudentInfo | null = null;
        if (studentIdParam) {
          targetStudent = stdList.find((s) => s.student_id === Number(studentIdParam)) || null;
        }
        if (!targetStudent && stdList.length > 0) {
          targetStudent = stdList[0];
          // Sync URL with first student
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set('student', String(targetStudent?.student_id));
              if (!next.get('tab')) next.set('tab', 'logs');
              return next;
            },
            { replace: true }
          );
        }
        setSelectedStudent(targetStudent);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load mentor students:', err);
        setError(getErrorMessage(err, 'ไม่สามารถโหลดรายชื่อนักศึกษาได้'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [studentIdParam, setSearchParams]);

  // Load logs for current student (Tab 1)
  const loadStudentLogs = useCallback(async (studentId: number) => {
    try {
      const [weeklyRes, monthlyRes] = await Promise.allSettled([
        api.get(`/weekly-logs/student/${studentId}`),
        api.get(`/monthly-logs/student/${studentId}`),
      ]);
      setError(null);

      const unifiedLogs: GenericLog[] = [];

      if (weeklyRes.status === 'fulfilled' && weeklyRes.value?.data) {
        const wRows = weeklyRes.value.data;
        for (const w of wRows) {
          unifiedLogs.push({
            kind: 'weekly_log',
            id: w.weekly_log_id,
            week_or_month_label: `บันทึกประจำสัปดาห์ที่ ${w.week_number} (สหกิจ 09)`,
            start_date: w.start_date,
            end_date: w.end_date,
            submitted_at: w.submitted_at,
            status: w.mentor_certified_at ? 'approved' : w.returned_comment ? 'returned' : w.status,
            mentor_certified_at: w.mentor_certified_at,
            mentor_certified_name: w.mentor_certified_name,
            returned_comment: w.returned_comment,
            external_file_path: w.external_file_path,
            summary: w.summary,
            assigned_work: w.assigned_work,
            methods: w.methods,
            tools_used: w.tools_used,
            achievements: w.achievements,
            problems: w.problems,
          });
        }
      }

      if (monthlyRes.status === 'fulfilled' && monthlyRes.value?.data) {
        const mRows = monthlyRes.value.data;
        for (const m of mRows) {
          unifiedLogs.push({
            kind: 'monthly_log',
            id: m.monthly_log_id,
            week_or_month_label: `บันทึกประจำเดือน (สหกิจ 10)`,
            start_date: m.start_date,
            end_date: m.end_date,
            submitted_at: m.submitted_at,
            status: m.mentor_certified_at ? 'approved' : m.returned_comment ? 'returned' : m.status,
            mentor_certified_at: m.mentor_certified_at,
            mentor_certified_name: m.mentor_certified_name,
            returned_comment: m.returned_comment,
            external_file_path: m.external_file_path,
            summary: m.summary,
            work_summary: m.work_summary,
            effectiveness: m.effectiveness,
          });
        }
      }

      // Sort logs: uncertified first, then by date desc
      unifiedLogs.sort((a, b) => {
        const aPending = a.status === 'submitted';
        const bPending = b.status === 'submitted';
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;
        return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
      });

      setLogs(unifiedLogs);
      if (unifiedLogs.length > 0) {
        setSelectedLogId(unifiedLogs[0].id);
        setSelectedLogKind(unifiedLogs[0].kind);
      } else {
        setSelectedLogId(null);
      }
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  }, []);

  // Load report draft (Tab 2) — เส้นเดียวคือ GET /final-reports/mentor (spec-D 15.7 · B10)
  // ⛔ ไม่มีการแต่งเวอร์ชัน/ไฟล์/ความเห็นปลอมอีกต่อไป — คืนเฉพาะร่างจริงของนักศึกษาคนนี้
  //    หัวข้อรายงาน (report_title) มากับแถวนี้อยู่แล้ว ไม่ต้องยิง /outlines/company แยก
  const loadStudentDraft = useCallback(async (studentId: number) => {
    try {
      const rows: FinalReportDraft[] = await api.get('/final-reports/mentor');
      setError(null);
      const studentDrafts = rows.filter((r) => r.student_id === studentId);
      setDrafts(studentDrafts);
      setOutlineTopic(studentDrafts[0]?.report_title || '');
    } catch (err) {
      console.error('Failed to load student draft:', err);
      setDrafts([]);
      setOutlineTopic('');
      setError(getErrorMessage(err, 'ไม่สามารถโหลดร่างรายงานได้'));
    }
  }, []);

  // Effect to load tab data when student or tab changes
  useEffect(() => {
    if (!selectedStudent?.student_id) return;
    const sId = selectedStudent.student_id;
    let cancelled = false;

    const load = async () => {
      if (activeTab === 'logs') {
        try {
          const [weeklyRes, monthlyRes] = await Promise.allSettled([
            api.get(`/weekly-logs/student/${sId}`),
            api.get(`/monthly-logs/student/${sId}`),
          ]);
          if (cancelled) return;
          setError(null);
          const unifiedLogs: GenericLog[] = [];
          if (weeklyRes.status === 'fulfilled' && weeklyRes.value?.data) {
            const wRows = weeklyRes.value.data;
            for (const w of wRows) {
              unifiedLogs.push({
                kind: 'weekly_log',
                id: w.weekly_log_id,
                week_or_month_label: `บันทึกประจำสัปดาห์ที่ ${w.week_number} (สหกิจ 09)`,
                start_date: w.start_date,
                end_date: w.end_date,
                submitted_at: w.submitted_at,
                status: w.mentor_certified_at ? 'approved' : w.returned_comment ? 'returned' : w.status,
                mentor_certified_at: w.mentor_certified_at,
                mentor_certified_name: w.mentor_certified_name,
                returned_comment: w.returned_comment,
                external_file_path: w.external_file_path,
                summary: w.summary,
                assigned_work: w.assigned_work,
                methods: w.methods,
                tools_used: w.tools_used,
                achievements: w.achievements,
                problems: w.problems,
              });
            }
          }
          if (monthlyRes.status === 'fulfilled' && monthlyRes.value?.data) {
            const mRows = monthlyRes.value.data;
            for (const m of mRows) {
              unifiedLogs.push({
                kind: 'monthly_log',
                id: m.monthly_log_id,
                week_or_month_label: `บันทึกประจำเดือน (สหกิจ 10)`,
                start_date: m.start_date,
                end_date: m.end_date,
                submitted_at: m.submitted_at,
                status: m.mentor_certified_at ? 'approved' : m.returned_comment ? 'returned' : m.status,
                mentor_certified_at: m.mentor_certified_at,
                mentor_certified_name: m.mentor_certified_name,
                returned_comment: m.returned_comment,
                external_file_path: m.external_file_path,
                summary: m.summary,
                work_summary: m.work_summary,
                effectiveness: m.effectiveness,
              });
            }
          }
          unifiedLogs.sort((a, b) => {
            const aPending = a.status === 'submitted';
            const bPending = b.status === 'submitted';
            if (aPending && !bPending) return -1;
            if (!aPending && bPending) return 1;
            return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
          });
          setLogs(unifiedLogs);
          if (unifiedLogs.length > 0) {
            setSelectedLogId(unifiedLogs[0].id);
            setSelectedLogKind(unifiedLogs[0].kind);
          } else {
            setSelectedLogId(null);
          }
        } catch (err) {
          if (cancelled) return;
          console.error('Failed to load logs:', err);
        }
      } else if (activeTab === 'draft') {
        try {
          const rows: FinalReportDraft[] = await api.get('/final-reports/mentor');
          if (cancelled) return;
          setError(null);
          const studentDrafts = rows.filter((r) => r.student_id === sId);
          setDrafts(studentDrafts);
          setOutlineTopic(studentDrafts[0]?.report_title || '');
        } catch (err) {
          if (cancelled) return;
          console.error('Failed to load student draft:', err);
          setDrafts([]);
          setOutlineTopic('');
          setError(getErrorMessage(err, 'ไม่สามารถโหลดร่างรายงานได้'));
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedStudent?.student_id, activeTab]);

  // Handle Tab Switch
  const handleTabChange = (tab: 'logs' | 'draft') => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      },
      { replace: false }
    );
  };

  // Handle Student Switch
  const handleStudentChange = (studentIdStr: string) => {
    const sId = Number(studentIdStr);
    const target = studentsList.find((s) => s.student_id === sId) || null;
    setSelectedStudent(target);
    setSelectedBatchIds([]);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('student', studentIdStr);
        return next;
      },
      { replace: false }
    );
  };

  // Selected Log
  const currentLog = useMemo(() => {
    return logs.find((l) => l.id === selectedLogId && l.kind === selectedLogKind) || logs[0] || null;
  }, [logs, selectedLogId, selectedLogKind]);

  // Pending logs count
  const pendingLogsCount = useMemo(() => {
    return logs.filter((l) => l.status === 'submitted').length;
  }, [logs]);

  // Batch Select / Unselect
  const handleToggleBatchItem = (log: GenericLog) => {
    const exists = selectedBatchIds.some((b) => b.kind === log.kind && b.id === log.id);
    if (exists) {
      setSelectedBatchIds((prev) => prev.filter((b) => !(b.kind === log.kind && b.id === log.id)));
    } else {
      setSelectedBatchIds((prev) => [...prev, { kind: log.kind, id: log.id }]);
    }
  };

  const handleSelectAllPending = () => {
    const pendingLogs = logs.filter((l) => l.status === 'submitted');
    if (selectedBatchIds.length === pendingLogs.length) {
      setSelectedBatchIds([]);
    } else {
      setSelectedBatchIds(pendingLogs.map((l) => ({ kind: l.kind, id: l.id })));
    }
  };

  // Batch Certify Submit
  const handleExecuteBatchCertify = async () => {
    if (selectedBatchIds.length === 0) return;
    try {
      setIsBatchCertifying(true);
      setError(null);
      const res = await api.patch('/mentor/certify-batch', {
        items: selectedBatchIds,
      });

      setSuccess(res?.message || `รับรองบันทึกที่เลือกเรียบร้อยแล้ว ${selectedBatchIds.length} รายการ`);
      setSelectedBatchIds([]);
      if (selectedStudent) {
        await loadStudentLogs(selectedStudent.student_id);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถรับรองบันทึกเป็นชุดได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsBatchCertifying(false);
    }
  };

  // Certify Single Log
  const handleCertifySingle = async () => {
    if (!currentLog) return;
    try {
      setIsCertifyingSingle(true);
      setError(null);
      const endpoint =
        currentLog.kind === 'weekly_log'
          ? `/weekly-logs/${currentLog.id}/certify`
          : `/monthly-logs/${currentLog.id}/certify`;

      await api.patch(endpoint);
      setSuccess(`รับรอง${currentLog.week_or_month_label}เรียบร้อยแล้ว`);
      if (selectedStudent) {
        await loadStudentLogs(selectedStudent.student_id);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถรับรองบันทึกได้'));
    } finally {
      setIsCertifyingSingle(false);
    }
  };

  // Return Log with Comment
  const handleConfirmReturnLog = async () => {
    if (!currentLog) return;
    if (!returnComment.trim()) {
      setError('กรุณาระบุข้อเสนอแนะหรือเหตุผลในการส่งกลับให้แก้ไข');
      return;
    }
    try {
      setIsReturning(true);
      setError(null);
      const endpoint =
        currentLog.kind === 'weekly_log'
          ? `/weekly-logs/${currentLog.id}/return`
          : `/monthly-logs/${currentLog.id}/return`;

      await api.patch(endpoint, { comment: returnComment.trim() });
      setSuccess(`ส่งกลับ${currentLog.week_or_month_label}ให้นักศึกษาแก้ไขเรียบร้อยแล้ว`);
      setIsReturnModalOpen(false);
      setReturnComment('');
      if (selectedStudent) {
        await loadStudentLogs(selectedStudent.student_id);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถส่งกลับบันทึกได้'));
    } finally {
      setIsReturning(false);
    }
  };

  // Review Draft (Tab 2)
  const handleReviewDraft = async (status: 'approved' | 'rejected') => {
    const targetDraft = drafts.find((d) => d.status === 'pending') || drafts[0];
    if (!targetDraft) return;

    if (status === 'rejected' && !draftComment.trim()) {
      setError('กรุณาระบุความเห็นหรือข้อเสนอแนะในการแก้ไขร่างรายงาน');
      return;
    }

    try {
      setIsDraftReviewing(true);
      setError(null);
      await api.patch(`/final-reports/${targetDraft.report_id}/mentor-review`, {
        status,
        comment: draftComment.trim() || (status === 'approved' ? 'ผ่านในส่วนของสถานประกอบการ' : ''),
      });

      setSuccess(
        status === 'approved'
          ? 'บันทึกผลการตรวจร่างรายงานเรียบร้อยแล้ว'
          : 'ส่งกลับร่างรายงานให้นักศึกษาแก้ไขเรียบร้อยแล้ว'
      );
      setDraftComment('');
      if (selectedStudent) {
        await loadStudentDraft(selectedStudent.student_id);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกผลการตรวจร่างรายงานได้'));
    } finally {
      setIsDraftReviewing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageSkeleton variant="form" />
      </div>
    );
  }

  return (
    <div className="space-y-6 page-enter pb-16">
      {/* 1. Header Bar with Student Select */}
      <div className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white">
              รับรองงานของ {selectedStudent?.full_name || 'นักศึกษา'}
            </h1>
            {studentsList.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">สลับนักศึกษา:</span>
                <select
                  data-testid="certify-student-select"
                  value={selectedStudent?.student_id || ''}
                  onChange={(e) => handleStudentChange(e.target.value)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                >
                  {studentsList.map((st) => (
                    <option key={st.student_id} value={st.student_id}>
                      {st.full_name} · {st.student_code}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            สัปดาห์ที่ {selectedStudent?.week_current ?? 6} จาก {selectedStudent?.week_total ?? 16} · เริ่มปฏิบัติงาน{' '}
            {formatThaiDate(selectedStudent?.start_date)} · สิ้นสุด {formatThaiDate(selectedStudent?.end_date)}
          </p>
        </div>

        <div className="flex flex-col md:items-end gap-1 shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <Clock className="w-3.5 h-3.5" />
            รอท่านรับรอง {pendingLogsCount} ใบ
          </span>
          <span className="text-2xs text-gray-500 dark:text-gray-400">
            รับรองย้อนหลังได้เสมอ ไม่มีกำหนดปิด
          </span>
        </div>
      </div>

      {error && (
        <AlertBanner
          message={error}
          variant="error"
          scrollOnShow
        />
      )}

      {success && (
        <AlertBanner
          message={success}
          variant="success"
          scrollOnShow
        />
      )}

      {/* 2. Main Tabs Container */}
      <div className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        {/* Tab Headers */}
        <div className="flex border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/30 px-3 sm:px-6 overflow-x-auto">
          <button
            data-testid="certify-tab-logs"
            type="button"
            onClick={() => handleTabChange('logs')}
            className={`flex items-center gap-2 py-3.5 px-4 font-bold text-sm border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'logs'
                ? 'border-brand-blue text-brand-blue dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            บันทึกการปฏิบัติงาน (08 / 09 / 10)
            {pendingLogsCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 font-bold">
                {pendingLogsCount}
              </span>
            )}
          </button>

          <button
            data-testid="certify-tab-draft"
            type="button"
            onClick={() => handleTabChange('draft')}
            className={`flex items-center gap-2 py-3.5 px-4 font-bold text-sm border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'draft'
                ? 'border-brand-blue text-brand-blue dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            ร่างรายงานก่อนประเมิน (สหกิจ 16)
          </button>
        </div>

        {/* Tab 1: Logs */}
        {activeTab === 'logs' && (
          <div className="p-4 sm:p-6 lg:p-8 flex flex-col lg:flex-row gap-6 items-start">
            {/* Left Column: Logs List & Batch Certification */}
            <div className="w-full lg:w-96 shrink-0 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  ใบที่ส่งเข้ามา ({logs.length})
                </span>
                {logs.some((l) => l.status === 'submitted') && (
                  <button
                    type="button"
                    data-testid="certify-select-all"
                    onClick={handleSelectAllPending}
                    className="-my-3 py-3 text-xs font-semibold text-brand-blue dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    {selectedBatchIds.length === logs.filter((l) => l.status === 'submitted').length
                      ? 'ยกเลิกเลือกทั้งหมด'
                      : 'เลือกที่รอรับรองทั้งหมด'}
                  </button>
                )}
              </div>

              {/* Batch Action Banner */}
              {selectedBatchIds.length > 0 && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-brand-blue dark:text-blue-300">
                    เลือกไว้ {selectedBatchIds.length} ใบ
                  </span>
                  <Button
                    size="sm"
                    variant="primary"
                    data-testid="certify-batch"
                    disabled={isBatchCertifying}
                    onClick={() => setPendingConfirm('batch')}
                    className="text-xs shadow-xs"
                  >
                    {isBatchCertifying ? 'กำลังรับรอง...' : 'รับรองที่เลือกทั้งหมด'}
                  </Button>
                </div>
              )}

              {logs.length === 0 ? (
                <div className="p-6 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl text-center">
                  <EmptyState
                    title="ยังไม่มีบันทึกส่งเข้ามา"
                    description="เมื่อนักศึกษาเริ่มบันทึกและส่งรายงาน รายการจะปรากฏที่นี่"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => {
                    const isSelected = selectedLogId === log.id && selectedLogKind === log.kind;
                    const isChecked = selectedBatchIds.some((b) => b.kind === log.kind && b.id === log.id);
                    const isPending = log.status === 'submitted';
                    const isApproved = log.status === 'approved';

                    return (
                      <div
                        key={`${log.kind}-${log.id}`}
                        data-testid={`certify-list-item-${log.kind}-${log.id}`}
                        onClick={() => {
                          setSelectedLogId(log.id);
                          setSelectedLogKind(log.kind);
                        }}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                          isSelected
                            ? 'border-brand-blue bg-blue-50/50 dark:bg-blue-950/20 shadow-xs'
                            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'
                        }`}
                      >
                        {/* Checkbox for batch */}
                        {isPending ? (
                          // label ครอบ + padding หักด้วย margin ลบ = เป้าแตะ 40x44 โดยเลย์เอาต์เท่าเดิม
                          <label className="-m-3 flex shrink-0 cursor-pointer p-3">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleToggleBatchItem(log);
                              }}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
                            />
                          </label>
                        ) : (
                          <span className="mt-1 h-4 w-4 flex items-center justify-center shrink-0">
                            {isApproved ? (
                              <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <Clock className="w-4 h-4 text-gray-400" />
                            )}
                          </span>
                        )}

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-sm font-bold text-gray-900 dark:text-white truncate">
                              {log.week_or_month_label}
                            </span>
                            {isPending ? (
                              <span className="shrink-0 px-2 py-0.5 rounded-full text-2xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                                รอรับรอง
                              </span>
                            ) : isApproved ? (
                              <span className="shrink-0 px-2 py-0.5 rounded-full text-2xs font-bold bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300 border border-green-200 dark:border-green-800">
                                รับรองแล้ว
                              </span>
                            ) : (
                              <span className="shrink-0 px-2 py-0.5 rounded-full text-2xs font-bold bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-800">
                                ส่งกลับแก้ไข
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            ช่วง {formatThaiDate(log.start_date)} – {formatThaiDate(log.end_date)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Detail of selected log */}
            <div className="flex-1 min-w-0 w-full space-y-5">
              {currentLog ? (
                <div className="space-y-5">
                  {/* Title & Status header */}
                  <div className="p-4 sm:p-5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        {currentLog.week_or_month_label}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        ระยะเวลาปฏิบัติงาน: {formatThaiDate(currentLog.start_date)} – {formatThaiDate(currentLog.end_date)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {currentLog.status === 'approved' ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300 border border-green-200 dark:border-green-800">
                          <CheckCircle className="w-3.5 h-3.5" />
                          รับรองแล้วเมื่อ {formatThaiDate(currentLog.mentor_certified_at)}
                        </span>
                      ) : currentLog.status === 'returned' ? (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-800">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          ส่งกลับให้แก้ไข
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          <Clock className="w-3.5 h-3.5" />
                          รอดำเนินการรับรอง
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Returned Comment Banner */}
                  {currentLog.returned_comment && (
                    <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300 leading-relaxed">
                      <span className="font-bold block mb-1">เหตุผลที่ส่งกลับให้นักศึกษาแก้ไข:</span>
                      {currentLog.returned_comment}
                    </div>
                  )}

                  {/* Content details based on log type */}
                  {currentLog.kind === 'weekly_log' && (
                    <div className="space-y-4">
                      <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-1.5">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                          1. งานที่ได้รับมอบหมายในสัปดาห์นี้
                        </span>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                          {currentLog.assigned_work || '–'}
                        </p>
                      </div>

                      <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-1.5">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                          2. วิธีการปฏิบัติงานและขั้นตอนการทำงาน
                        </span>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                          {currentLog.methods || '–'}
                        </p>
                      </div>

                      <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-1.5">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                          3. เครื่องมือ / เทคโนโลยี / โปรแกรมที่ใช้
                        </span>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                          {currentLog.tools_used || '–'}
                        </p>
                      </div>

                      <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-1.5">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                          4. ผลการปฏิบัติงานและสิ่งที่ได้เรียนรู้
                        </span>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                          {currentLog.achievements || '–'}
                        </p>
                      </div>

                      <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-1.5">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                          5. ปัญหาและอุปสรรคในการทำงาน (ถ้ามี)
                        </span>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                          {currentLog.problems || '–'}
                        </p>
                      </div>
                    </div>
                  )}

                  {currentLog.kind === 'monthly_log' && (
                    <div className="space-y-4">
                      <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-1.5">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                          1. สรุปผลการปฏิบัติงานในรอบเดือน
                        </span>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                          {currentLog.work_summary || '–'}
                        </p>
                      </div>

                      <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 space-y-1.5">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">
                          2. ประสิทธิผลและการประยุกต์ใช้องค์ความรู้ในการทำงาน
                        </span>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
                          {currentLog.effectiveness || '–'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Company format attachment if used */}
                  {currentLog.external_file_path && (
                    <div className="border border-blue-200 dark:border-blue-800 rounded-xl p-4 bg-blue-50/40 dark:bg-blue-950/20 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-brand-blue" />
                        <div>
                          <span className="text-xs font-bold text-gray-900 dark:text-white block">
                            ไฟล์แนบแบบฟอร์มการบันทึกงานของบริษัท
                          </span>
                          <span className="text-2xs text-gray-500 dark:text-gray-400">
                            นักศึกษาเลือกใช้แบบฟอร์มของสถานประกอบการแทนแบบฟอร์มมาตรฐาน
                          </span>
                        </div>
                      </div>
                      <a
                        href={currentLog.external_file_path}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-brand-blue border border-blue-200 shadow-xs hover:bg-blue-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        ดาวน์โหลดไฟล์
                      </a>
                    </div>
                  )}

                  {/* Submission metadata */}
                  <div className="p-4 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      นักศึกษาส่งเมื่อ: {formatThaiDateTime(currentLog.submitted_at)}
                    </span>
                    {currentLog.mentor_certified_name && (
                      <span>
                        ผู้รับรอง: {currentLog.mentor_certified_name} ({formatThaiDateTime(currentLog.mentor_certified_at)})
                      </span>
                    )}
                  </div>

                  {/* Actions for current log */}
                  {currentLog.status === 'submitted' && (
                    <div className="pt-2 flex items-center justify-end gap-3">
                      <Button
                        variant="secondary"
                        data-testid="certify-return"
                        disabled={isCertifyingSingle || isReturning}
                        onClick={() => setIsReturnModalOpen(true)}
                        className="text-amber-800! border-amber-300! hover:bg-amber-50! dark:text-amber-300! dark:border-amber-700! dark:hover:bg-amber-950/40!"
                      >
                        ขอให้นักศึกษาแก้ไข
                      </Button>
                      <Button
                        variant="primary"
                        data-testid="certify-approve"
                        disabled={isCertifyingSingle || isReturning}
                        onClick={() => setPendingConfirm('single')}
                        className="shadow-sm"
                      >
                        {isCertifyingSingle ? 'กำลังบันทึก...' : 'รับรองบันทึกนี้'}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-12 text-center border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                  <EmptyState
                    title="เลือกบันทึกจากรายการทางซ้าย"
                    description="คลิกเลือกบันทึกที่ต้องการเพื่อตรวจดูรายละเอียดและลงนามรับรอง"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Report Draft (16) */}
        {activeTab === 'draft' && (
          <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            {/* Outline Topic Banner */}
            <div className="border border-blue-200 dark:border-blue-800/80 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-bold text-brand-blue dark:text-blue-400 block">
                  หัวข้อรายงานที่อาจารย์นิเทศเห็นชอบในโครงร่าง (สหกิจ 11)
                </span>
                <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                  {outlineTopic || 'ยังไม่มีโครงร่างที่อาจารย์นิเทศอนุมัติ'}
                </h3>
              </div>
              <span className="shrink-0 px-3 py-1 rounded-full text-xs font-bold bg-white text-brand-blue dark:bg-gray-800 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                {selectedStudent?.full_name} · {selectedStudent?.student_code}
              </span>
            </div>

            {/* Version List */}
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                  ร่างรายงานที่ส่งมาให้ท่านตรวจ
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  ท่านเห็นเฉพาะร่างที่ส่งถึงพี่เลี้ยงเท่านั้น
                </span>
              </div>

              {drafts.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                  <EmptyState
                    title="ยังไม่มีร่างรายงานส่งเข้ามา"
                    description="เมื่อนักศึกษาส่งร่างรายงานฉบับสมบูรณ์ให้ท่านตรวจ รายการจะปรากฏที่นี่"
                  />
                </div>
              ) : (
                drafts.map((d) => (
                  <div
                    key={d.report_id}
                    className={`border rounded-xl p-4 sm:p-5 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      d.status === 'pending'
                        ? 'border-blue-300 dark:border-blue-800 bg-blue-50/20 dark:bg-blue-950/10'
                        : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'
                    }`}
                  >
                    <div className="flex items-start sm:items-center gap-3.5">
                      <FileText className="w-8 h-8 text-red-500 shrink-0 mt-1 sm:mt-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm sm:text-base text-gray-900 dark:text-white">
                            ร่างรายงาน ครั้งที่ {d.version} ({d.file_path})
                          </span>
                          {d.status === 'pending' ? (
                            <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              รอท่านตรวจ
                            </span>
                          ) : d.status === 'approved' ? (
                            <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-green-50 text-green-800 border border-green-200">
                              ตรวจแล้ว
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-red-50 text-red-800 border border-red-200">
                              ส่งกลับแก้ไข
                            </span>
                          )}
                          {d.status === 'pending' && d.is_overdue && (
                            <span className="px-2 py-0.5 rounded-full text-2xs font-bold bg-red-50 text-red-700 border border-red-200">
                              เลยกำหนดส่งร่างแล้ว
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          ส่งเมื่อ {formatThaiDateTime(d.submitted_at)}
                          {d.draft_due_date && ` · กำหนดส่งร่าง ${formatThaiDate(d.draft_due_date)}`}
                          {d.reviewer_comment && ` · ความเห็น: “${d.reviewer_comment}”`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => window.open(`/api/documents/${d.file_path}`, '_blank')}
                        className="text-xs"
                      >
                        <Download className="w-3.5 h-3.5 mr-1" />
                        เปิดอ่านไฟล์ร่าง
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Comment & Review Box — แสดงก็ต่อเมื่อมีร่างจริงให้ตรวจ */}
            {drafts.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-5 bg-white dark:bg-gray-900 space-y-3">
                <span className="text-sm font-bold text-gray-900 dark:text-white block">
                  ความเห็นของท่านต่อร่างรายงาน
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  นักศึกษาจะเห็นข้อความนี้โดยตรง · หากส่งกลับให้แก้ไข กรุณาระบุจุดที่ต้องปรับปรุงเสมอ
                </p>
                <Textarea
                  rows={3}
                  value={draftComment}
                  onChange={(e) => setDraftComment(e.target.value)}
                  placeholder="เช่น เนื้อหาบทที่ 3 อธิบายการทำงานครบถ้วนดี ให้ปรับปรุงคำผิดในบทสรุปเล็กน้อย หรือ ผ่านในส่วนของสถานประกอบการ"
                />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <span className="text-2xs text-gray-500 dark:text-gray-400">
                    การตรวจร่างของพี่เลี้ยงเป็นการตรวจความถูกต้องเชิงการปฏิบัติงานและข้อมูลความลับของสถานประกอบการ
                  </span>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={isDraftReviewing}
                      onClick={() => handleReviewDraft('rejected')}
                      className="text-amber-800! border-amber-300! hover:bg-amber-50! dark:text-amber-300! dark:border-amber-700! dark:hover:bg-amber-950/40!"
                    >
                      ส่งกลับให้แก้ไข
                    </Button>
                    <Button
                      variant="primary"
                      disabled={isDraftReviewing}
                      onClick={() => handleReviewDraft('approved')}
                      className="shadow-sm"
                    >
                      {isDraftReviewing ? 'กำลังบันทึก...' : 'บันทึกว่าตรวจแล้ว'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Bridge to Final Evaluation 15/16 Warning */}
            <div className="border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="text-sm font-bold text-amber-900 dark:text-amber-200 block">
                    ท่านยังไม่ได้บันทึกผลการประเมินนักศึกษาในภาคเรียนนี้
                  </span>
                  <p className="text-xs text-amber-800/80 dark:text-amber-300/80 leading-relaxed max-w-2xl">
                    แบบประเมินรายงาน (สหกิจ 16) ให้คะแนนเล่มรายงาน — ท่านสามารถตรวจร่างฉบับนี้ก่อนแล้วค่อยให้คะแนน
                    อย่างไรก็ตาม ระบบไม่ได้ล็อกการให้คะแนน ท่านสามารถไปทำแบบประเมินได้ตลอดเวลา
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  navigate(
                    `/dashboard?role=mentor&menu=final_evaluation&student=${selectedStudent?.student_id}&form=16`
                  )
                }
                className="shrink-0 text-amber-800 border-amber-300 hover:bg-amber-100"
              >
                ไปกรอกแบบประเมิน 15/16
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Return Log Modal */}
      {isReturnModalOpen && (
        <Modal
          onClose={() => setIsReturnModalOpen(false)}
          title="ส่งกลับบันทึกให้นักศึกษาแก้ไข"
        >
          <ModalBody>
            <div className="space-y-4">
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                กรุณาระบุข้อเสนอแนะหรือจุดที่ต้องการให้นักศึกษาแก้ไขเพิ่มเติม ข้อความนี้จะแสดงในหน้าจอของนักศึกษาโดยตรง
              </p>
              <Textarea
                data-testid="certify-return-comment"
                rows={4}
                value={returnComment}
                onChange={(e) => setReturnComment(e.target.value)}
                placeholder="ระบุเหตุผล เช่น ข้อมูลในข้อ 4 ยังไม่ระบุผลลัพธ์เชิงตัวเลข ขอให้ระบุยอดผลผลิตที่เพิ่มขึ้น"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsReturnModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                variant="primary"
                disabled={isReturning || !returnComment.trim()}
                onClick={handleConfirmReturnLog}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {isReturning ? 'กำลังส่งกลับ...' : 'ยืนยันส่งกลับให้แก้ไข'}
              </Button>
            </div>
          </ModalFooter>
        </Modal>
      )}

      {/* ยืนยันก่อนรับรอง/ลงนาม — ทำแล้วพี่เลี้ยงยกเลิกเองไม่ได้ */}
      <ConfirmDialog
        open={pendingConfirm !== null}
        title="ยืนยันการรับรองบันทึก"
        message={
          <ConfirmSummary
            lead="รับรองบันทึกการปฏิบัติงานของนักศึกษา"
            rows={[
              {
                label: 'นักศึกษา',
                value: selectedStudent ? `${selectedStudent.full_name} (${selectedStudent.student_code})` : '—',
              },
              {
                label: 'สิ่งที่รับรอง',
                value:
                  pendingConfirm === 'single'
                    ? currentLog?.week_or_month_label || 'บันทึกการปฏิบัติงาน'
                    : `บันทึกที่เลือก ${selectedBatchIds.length} รายการ`,
              },
            ]}
            lockNote="ยืนยันแล้วท่านจะยกเลิกเองไม่ได้ กรุณาตรวจว่าอ่านเนื้อหาครบแล้ว"
          />
        }
        confirmLabel="ยืนยันรับรอง"
        cancelLabel="กลับไปอ่าน"
        confirmTestId="certify-confirm"
        busy={isCertifyingSingle || isBatchCertifying}
        onConfirm={async () => {
          if (pendingConfirm === 'single') await handleCertifySingle();
          if (pendingConfirm === 'batch') await handleExecuteBatchCertify();
          setPendingConfirm(null);
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
};

export default MentorCertify;
