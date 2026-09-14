import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import Button from '../../components/ui/Button';
import AlertBanner from '../../components/ui/AlertBanner';
import PageSkeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import Modal, { ModalBody, ModalFooter } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/Input';
import { getErrorMessage } from '../../utils/errors';
import {
  CheckCircle,
  AlertTriangle,
  Clock,
  FileText,
  Calendar,
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
  job_position: string | null;
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

interface WorkPlanTopic {
  topic_id: number;
  seq: number;
  topic: string;
  months: number[];
}

// เดือนจริงจาก backend เป็นตัวเลขล้วน (ปี ค.ศ. + เดือน) — หน้าจอเป็นคนแปลงเป็นชื่อเดือนไทย/พ.ศ. เอง
interface WorkPlanMonth {
  index: number;
  year: number;
  month: number;
}

interface WorkPlanApproval {
  approver_role: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_at?: string | null;
  comment?: string | null;
  created_at?: string;
  approver_name?: string | null;
}

interface WorkPlanWeeklyItem {
  week_number: number;
  start_date: string | null;
  end_date: string | null;
  tasks: string | null;
}

interface WorkPlanData {
  student: {
    student_id?: number;
    student_code?: string;
    full_name?: string;
    major_name_th?: string | null;
    faculty_name_th?: string | null;
    company_name?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };
  months: WorkPlanMonth[];
  topics: WorkPlanTopic[];
  weekly: WorkPlanWeeklyItem[];
  student_signed_at: string | null;
  approvals: {
    mentor?: WorkPlanApproval;
    advisor?: WorkPlanApproval;
  };
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
  const activeTab = (searchParams.get('tab') as 'logs' | 'plan' | 'draft') || 'logs';

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

  // Return modal state
  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [returnComment, setReturnComment] = useState<string>('');
  const [isReturning, setIsReturning] = useState<boolean>(false);

  // Tab 2: Work Plan state
  const [workPlan, setWorkPlan] = useState<WorkPlanData | null>(null);
  const [isPlanApproving, setIsPlanApproving] = useState<boolean>(false);
  const [isPlanRejectModalOpen, setIsPlanRejectModalOpen] = useState<boolean>(false);
  const [planRejectComment, setPlanRejectComment] = useState<string>('');
  const [isPlanRejecting, setIsPlanRejecting] = useState<boolean>(false);

  // Tab 3: Report Draft state
  const [drafts, setDrafts] = useState<FinalReportDraft[]>([]);
  const [outlineTopic, setOutlineTopic] = useState<string>('');
  const [draftComment, setDraftComment] = useState<string>('');
  const [isDraftReviewing, setIsDraftReviewing] = useState<boolean>(false);

  // เดือนจาก backend เป็นเลข 1–12 ล้วน (ไม่ได้ผูกกับปฏิทินตายตัวว่าเริ่ม พ.ย.) — แปลงเป็นชื่อย่อไทย + ปี พ.ศ. ที่นี่
  const THAI_MONTH_SHORT = [
    '', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];
  const formatMonthColumn = (m: WorkPlanMonth) => {
    const shortLabel = `${THAI_MONTH_SHORT[m.month] || '–'} ${String((m.year + 543) % 100).padStart(2, '0')}`;
    return { label: `เดือนที่ ${m.index}`, shortLabel };
  };

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
  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const pendingRes = await api.get('/mentor/pending');
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
      console.error('Failed to load mentor students:', err);
      setError(getErrorMessage(err, 'ไม่สามารถโหลดรายชื่อนักศึกษาได้'));
    } finally {
      setLoading(false);
    }
  }, [studentIdParam, setSearchParams]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Load logs for current student (Tab 1)
  const loadStudentLogs = useCallback(async (studentId: number) => {
    try {
      setError(null);
      const [weeklyRes, monthlyRes] = await Promise.allSettled([
        api.get(`/weekly-logs/student/${studentId}`),
        api.get(`/monthly-logs/student/${studentId}`),
      ]);

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

  // Load work plan for current student (Tab 2)
  // ⛔ เส้นเดียวคือ GET /students/:id/work-plan — ไม่มีทาง fallback ไปที่อื่นและไม่มีการแต่งข้อมูลปลอม
  //    ไม่มีหัวข้อ/ไม่มีเดือน = EmptyState ที่ฝั่ง render (ดู activeTab === 'plan' ด้านล่าง)
  const loadStudentWorkPlan = useCallback(async (studentId: number) => {
    try {
      setError(null);
      const res = await api.get(`/students/${studentId}/work-plan`);
      setWorkPlan(res);
    } catch (err) {
      console.error('Failed to load work plan:', err);
      setWorkPlan(null);
      setError(getErrorMessage(err, 'ไม่สามารถโหลดแผนปฏิบัติงานได้'));
    }
  }, []);

  // Load report draft (Tab 3) — เส้นเดียวคือ GET /final-reports/mentor (spec-D 15.7 · B10)
  // ⛔ ไม่มีการแต่งเวอร์ชัน/ไฟล์/ความเห็นปลอมอีกต่อไป — คืนเฉพาะร่างจริงของนักศึกษาคนนี้
  //    หัวข้อรายงาน (report_title) มากับแถวนี้อยู่แล้ว ไม่ต้องยิง /outlines/company แยก
  const loadStudentDraft = useCallback(async (studentId: number) => {
    try {
      setError(null);
      const rows: FinalReportDraft[] = await api.get('/final-reports/mentor');
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

    if (activeTab === 'logs') {
      loadStudentLogs(sId);
    } else if (activeTab === 'plan') {
      loadStudentWorkPlan(sId);
    } else if (activeTab === 'draft') {
      loadStudentDraft(sId);
    }
  }, [selectedStudent, activeTab, loadStudentLogs, loadStudentWorkPlan, loadStudentDraft]);

  // Handle Tab Switch
  const handleTabChange = (tab: 'logs' | 'plan' | 'draft') => {
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

  // Approve Work Plan (Tab 2)
  const handleApproveWorkPlan = async () => {
    if (!selectedStudent) return;
    try {
      setIsPlanApproving(true);
      setError(null);
      await api.patch(`/students/${selectedStudent.student_id}/work-plan/approve`);
      setSuccess('ลงนามรับรองแผนปฏิบัติงานสหกิจศึกษาเรียบร้อยแล้ว ระบบจะส่งต่อให้อาจารย์ที่ปรึกษาโดยอัตโนมัติ');
      await loadStudentWorkPlan(selectedStudent.student_id);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถลงนามรับรองแผนปฏิบัติงานได้'));
    } finally {
      setIsPlanApproving(false);
    }
  };

  // Reject Work Plan (Tab 2)
  const handleConfirmRejectPlan = async () => {
    if (!selectedStudent) return;
    if (!planRejectComment.trim()) {
      setError('กรุณาระบุเหตุผลหรือข้อเสนอแนะในการขอให้นักศึกษาแก้ไขแผนงาน');
      return;
    }
    try {
      setIsPlanRejecting(true);
      setError(null);
      await api.patch(`/students/${selectedStudent.student_id}/work-plan/reject`, {
        comment: planRejectComment.trim(),
      });
      setSuccess('ส่งกลับแผนปฏิบัติงานให้นักศึกษาแก้ไขเรียบร้อยแล้ว');
      setIsPlanRejectModalOpen(false);
      setPlanRejectComment('');
      await loadStudentWorkPlan(selectedStudent.student_id);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถส่งกลับแผนปฏิบัติงานได้'));
    } finally {
      setIsPlanRejecting(false);
    }
  };

  // Review Draft (Tab 3)
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
          <span className="text-2xs text-gray-400 dark:text-gray-500">
            รับรองย้อนหลังได้เสมอ ไม่มีกำหนดปิด
          </span>
        </div>
      </div>

      {error && (
        <AlertBanner
          message={error}
          variant="error"
        />
      )}

      {success && (
        <AlertBanner
          message={success}
          variant="success"
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
            data-testid="certify-tab-plan"
            type="button"
            onClick={() => handleTabChange('plan')}
            className={`flex items-center gap-2 py-3.5 px-4 font-bold text-sm border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'plan'
                ? 'border-brand-blue text-brand-blue dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Calendar className="w-4 h-4" />
            แผนปฏิบัติงาน (สหกิจ 07 หน้า 3)
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
                    className="text-xs font-semibold text-brand-blue hover:underline cursor-pointer"
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
                    onClick={handleExecuteBatchCertify}
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
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleBatchItem(log);
                            }}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
                          />
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
                        className="text-amber-700 border-amber-300 hover:bg-amber-50"
                      >
                        ขอให้นักศึกษาแก้ไข
                      </Button>
                      <Button
                        variant="primary"
                        data-testid="certify-approve"
                        disabled={isCertifyingSingle || isReturning}
                        onClick={handleCertifySingle}
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

        {/* Tab 2: Work Plan (07 Page 3) */}
        {activeTab === 'plan' && (
          <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            {!workPlan || workPlan.months.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                <EmptyState
                  title="ยังไม่มีวันเริ่ม/สิ้นสุดปฏิบัติงาน"
                  description="ระบบยังคำนวณเดือนปฏิบัติงานไม่ได้ เพราะสถานประกอบการยังไม่ได้ยืนยันวันเริ่ม/สิ้นสุด"
                />
              </div>
            ) : workPlan.topics.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                <EmptyState
                  title="นักศึกษายังไม่ได้ส่งแผนปฏิบัติงาน"
                  description="เมื่อนักศึกษากรอกและส่งแผนปฏิบัติงาน (สหกิจ 07 หน้า 3) แล้ว รายการจะปรากฏที่นี่ให้ท่านตรวจและลงนาม"
                />
              </div>
            ) : (
              <>
                {/* Header info card */}
                <div className="border border-gray-200 dark:border-gray-800 rounded-xl bg-gray-50/60 dark:bg-gray-800/30 p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <span className="text-2xs text-gray-500 dark:text-gray-400 block font-medium">
                      ชื่อ – นามสกุล นักศึกษา
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {workPlan.student.full_name || selectedStudent?.full_name}
                    </span>
                  </div>
                  <div>
                    <span className="text-2xs text-gray-500 dark:text-gray-400 block font-medium">
                      รหัสประจำตัวนักศึกษา
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {workPlan.student.student_code || selectedStudent?.student_code}
                    </span>
                  </div>
                  <div>
                    <span className="text-2xs text-gray-500 dark:text-gray-400 block font-medium">
                      สาขาวิชา
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {workPlan.student.major_name_th || selectedStudent?.major_name_th}
                    </span>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <span className="text-2xs text-gray-500 dark:text-gray-400 block font-medium">
                      สถานประกอบการ
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {workPlan.student.company_name || '–'}
                    </span>
                  </div>
                </div>

                {/* Matrix Table */}
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">
                      เมทริกซ์หัวข้องาน × เดือนที่ปฏิบัติงาน
                    </h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      จำนวนเดือนคำนวณจากวันจริง ไม่ได้ตายตัวที่ 4 เดือน (สเปก D ข้อ 8.1)
                    </span>
                  </div>

                  <div
                    data-testid="plan-matrix"
                    className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-xs"
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800 text-xs font-bold text-gray-600 dark:text-gray-300">
                            <th className="py-3.5 px-4 w-12 text-center">ลำดับ</th>
                            <th className="py-3.5 px-4">หัวข้องาน</th>
                            {workPlan.months.map((m) => {
                              const col = formatMonthColumn(m);
                              return (
                                <th key={m.index} className="py-3.5 px-3 text-center w-24">
                                  {col.label}
                                  <span className="block text-2xs font-normal text-gray-400">
                                    ({col.shortLabel})
                                  </span>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {workPlan.topics.map((t) => (
                            <tr
                              key={t.seq}
                              data-testid={`plan-topic-${t.seq}`}
                              className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20"
                            >
                              <td className="py-3.5 px-4 text-center font-bold text-gray-500 text-xs">
                                {t.seq}
                              </td>
                              <td className="py-3.5 px-4 font-semibold text-gray-900 dark:text-gray-100">
                                {t.topic}
                              </td>
                              {workPlan.months.map((m) => {
                                const isMarked = t.months.includes(m.index);
                                return (
                                  <td
                                    key={m.index}
                                    data-testid={`plan-cell-${t.seq}-${m.index}`}
                                    className="py-3.5 px-3 text-center"
                                  >
                                    {isMarked ? (
                                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-900/40 text-brand-blue dark:text-blue-400">
                                        <Check className="w-4 h-4 stroke-[3]" />
                                      </span>
                                    ) : (
                                      <span className="text-gray-300 dark:text-gray-600 font-bold">–</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Expandable weekly plans if available */}
                {workPlan.weekly.length > 0 && (
                  <details className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-gray-50/30 dark:bg-gray-800/20">
                    <summary className="text-xs font-bold text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                      ดูแผนรายสัปดาห์ประกอบ (ข้อมูลสนับสนุน ไม่ได้พิมพ์ลงหน้า 3)
                    </summary>
                    <div className="mt-3 space-y-2 text-xs text-gray-600 dark:text-gray-400">
                      {workPlan.weekly.map((wp) => (
                        <div key={wp.week_number} className="flex gap-2">
                          <span className="font-bold shrink-0">สัปดาห์ที่ {wp.week_number}:</span>
                          <span>{wp.tasks || '–'}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Signatures Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  {/* Student Signature */}
                  <div
                    data-testid="plan-sign-student"
                    className="border border-green-200 dark:border-green-900/40 bg-green-50/40 dark:bg-green-950/20 rounded-xl p-4 space-y-1.5"
                  >
                    <span className="text-xs font-bold text-green-700 dark:text-green-400 block">
                      ฝ่ายนักศึกษา
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white block">
                      {workPlan.student.full_name || selectedStudent?.full_name}
                    </span>
                    {workPlan.student_signed_at ? (
                      <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        ยืนยันแผนนี้แล้วเมื่อ {formatThaiDateTime(workPlan.student_signed_at)}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        ยังไม่ได้ส่งให้ท่านลงนาม
                      </span>
                    )}
                  </div>

                  {/* Mentor Signature */}
                  <div
                    data-testid="plan-sign-mentor"
                    className={`border rounded-xl p-4 space-y-1.5 ${
                      workPlan.approvals.mentor?.status === 'approved'
                        ? 'border-green-200 dark:border-green-900/40 bg-green-50/40 dark:bg-green-950/20'
                        : 'border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20'
                    }`}
                  >
                    <span
                      className={`text-xs font-bold block ${
                        workPlan.approvals.mentor?.status === 'approved'
                          ? 'text-green-700 dark:text-green-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      ฝ่ายพนักงานที่ปรึกษา (พี่เลี้ยง)
                    </span>
                    {workPlan.approvals.mentor?.status === 'approved' ? (
                      <>
                        <span className="text-sm font-bold text-gray-900 dark:text-white block">
                          {workPlan.approvals.mentor.approver_name || 'ลงนามแล้ว'}
                        </span>
                        <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          ลงนามรับรองแล้วเมื่อ {formatThaiDateTime(workPlan.approvals.mentor.approved_at)}
                        </span>
                      </>
                    ) : !workPlan.student_signed_at ? (
                      <span className="text-sm font-bold text-gray-900 dark:text-white block">
                        รอนักศึกษาส่งแผนงานก่อน
                      </span>
                    ) : (
                      <>
                        <span className="text-sm font-bold text-gray-900 dark:text-white block">
                          รอท่านลงนาม
                        </span>
                        <span className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed block">
                          เมื่อท่านลงนาม แผนงานนี้จะถูกส่งต่อไปยังอาจารย์ที่ปรึกษาเพื่อพิจารณาต่อโดยอัตโนมัติ
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions for Work Plan — กดได้ก็ต่อเมื่อนักศึกษาส่งแล้วเท่านั้น */}
                {workPlan.approvals.mentor?.status !== 'approved' && workPlan.student_signed_at && (
                  <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      ท่านเป็นด่านแรก · อาจารย์ที่ปรึกษาจะเห็นแผนนี้หลังจากท่านลงนามแล้วเท่านั้น
                    </span>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="secondary"
                        data-testid="plan-reject"
                        disabled={isPlanApproving || isPlanRejecting}
                        onClick={() => setIsPlanRejectModalOpen(true)}
                        className="text-amber-700 border-amber-300 hover:bg-amber-50"
                      >
                        ขอให้นักศึกษาแก้ไข
                      </Button>
                      <Button
                        variant="primary"
                        data-testid="plan-approve"
                        disabled={isPlanApproving || isPlanRejecting}
                        onClick={handleApproveWorkPlan}
                        className="shadow-sm"
                      >
                        {isPlanApproving ? 'กำลังลงนาม...' : 'ลงนามรับรองแผนนี้'}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tab 3: Report Draft (16) */}
        {activeTab === 'draft' && (
          <div className="p-4 sm:p-6 lg:p-8 space-y-6">
            {/* Outline Topic Banner */}
            <div className="border border-blue-200 dark:border-blue-800/80 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-bold text-brand-blue dark:text-blue-400 block">
                  หัวข้อรายงานที่อาจารย์ที่ปรึกษาเห็นชอบในโครงร่าง (สหกิจ 11)
                </span>
                <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                  {outlineTopic || 'ยังไม่มีโครงร่างที่อาจารย์ที่ปรึกษาอนุมัติ'}
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
                  <span className="text-2xs text-gray-400 dark:text-gray-500">
                    การตรวจร่างของพี่เลี้ยงเป็นการตรวจความถูกต้องเชิงการปฏิบัติงานและข้อมูลความลับของสถานประกอบการ
                  </span>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="secondary"
                      disabled={isDraftReviewing}
                      onClick={() => handleReviewDraft('rejected')}
                      className="text-amber-700 border-amber-300 hover:bg-amber-50"
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

      {/* Reject Work Plan Modal */}
      {isPlanRejectModalOpen && (
        <Modal
          onClose={() => setIsPlanRejectModalOpen(false)}
          title="ขอให้นักศึกษาแก้ไขแผนปฏิบัติงาน"
        >
          <ModalBody>
            <div className="space-y-4">
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                กรุณาระบุข้อเสนอแนะในการปรับปรุงแผนงาน แผนจะกลับไปเป็นร่างของนักศึกษาเพื่อแก้ไขและส่งให้ท่านตรวจใหม่อีกครั้ง
              </p>
              <Textarea
                data-testid="plan-reject-comment"
                rows={4}
                value={planRejectComment}
                onChange={(e) => setPlanRejectComment(e.target.value)}
                placeholder="ระบุเหตุผล เช่น หัวข้อที่ 2 ควรกินระยะเวลาถึงเดือนที่ 3 เพื่อให้ครอบคลุมการทดสอบระบบ"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsPlanRejectModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                variant="primary"
                disabled={isPlanRejecting || !planRejectComment.trim()}
                onClick={handleConfirmRejectPlan}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {isPlanRejecting ? 'กำลังส่งกลับ...' : 'ยืนยันขอให้แก้ไข'}
              </Button>
            </div>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};

export default MentorCertify;
