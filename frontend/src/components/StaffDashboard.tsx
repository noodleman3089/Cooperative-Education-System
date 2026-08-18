import React, { useState } from 'react';
import PageSkeleton, { skeletonFor } from './ui/Skeleton';
import { useDashboardData } from '../hooks/useDashboardData';
import api, { API_BASE_URL } from '../services/api';
import AlertBanner from './ui/AlertBanner';
import Modal, { ModalBody } from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';
import { Megaphone, Pin, BarChart3, ChevronRight, Check, Plus } from 'lucide-react';
import Button from './ui/Button';
import { getErrorMessage } from '../utils/errors';
import { Input, Select, Textarea } from './ui/Input';
import type {
  Announcement,
  ImportSummary,
  JobPostRow,
  MajorOption,
  PreseedPersonnelRow,
  UserRow,
} from '../types/api';

interface StaffDashboardProps {
  activeMenu?: string;
  defaultTab?: string;
}

interface StudentIntent {
  form_id: number;
  student_id: number;
  student_code: string;
  student_name?: string;
  first_name?: string;
  last_name?: string;
  company_id: number;
  company_name_th: string;
  job_id: number;
  job_title?: string;
  status: string;
}

/**
 * `student_name` is declared on the type but `/api/intents` never sends it — the
 * query returns `first_name` and `last_name`. The placement list fell back to
 * the literal "นักศึกษาสหกิจ" and the generation panel had no fallback at all,
 * so the officer issuing an official letter read "นักศึกษา: (640101001)".
 * (The same fix was made in AdvisorDashboard; these were the two sites left.)
 */
const intentStudentName = (intent?: StudentIntent | null): string =>
  [intent?.first_name, intent?.last_name].filter(Boolean).join(' ').trim()
  || intent?.student_name
  || intent?.student_code
  || 'ไม่ระบุชื่อ';

interface DocumentTemplate {
  template_id: number;
  name: string;
  type: string;
  file_path: string;
}

interface GeneratedDocument {
  doc_id: number;
  type: string;
  student_id: number;
  company_id: number;
  template_id: number;
  generated_file_path: string | null;
  status: string;
  dean_signature_date: string | null;
  student_code: string;
  company_name_th: string;
}

interface ParsedStudent {
  student_code: string;
  /**
   * Three states, not two. A blank cell means the file says nothing about this
   * student's eligibility and it must be left alone — the same rule
   * `cumulative_gpa` in the very next column has always followed. It used to be
   * a plain boolean defaulting to `true`, so a roster carrying only student
   * codes granted co-op eligibility to everyone in it.
   */
  is_eligible: boolean | null;
  /** Blank keeps whatever GPA is already on record instead of overwriting it. */
  cumulative_gpa: string;
  /** Binds the student_code to one SSO account at profile setup. */
  email: string;
}

/** Column headings accepted for the eligibility column, in either language. */
const ELIGIBLE_HEADERS = ['is_eligible', 'ผ่านเกณฑ์', 'สถานะผ่านเกณฑ์'];
const ELIGIBLE_TRUE = ['true', '1', 'yes', 'y', 'ผ่าน'];
const ELIGIBLE_FALSE = ['false', '0', 'no', 'n', 'ไม่ผ่าน'];

/**
 * The four stages an intent passes through, in order, as the staff dashboard
 * shows them. `waitingOn` replaces what used to be the raw database value
 * printed under each figure: what a co-op officer needs from a queue is who it
 * is stuck behind, not the name of the column it lives in.
 */
const PIPELINE_STEPS: {
  status: string;
  title: string;
  waitingOn: string;
  done?: boolean;
  count: (s: Record<string, number>) => number;
}[] = [
  {
    status: 'pending_advisor',
    title: 'ยื่นใบความจำนงแล้ว',
    waitingOn: 'รออาจารย์ที่ปรึกษาพิจารณา',
    count: (s) => s.pending_advisor || 0,
  },
  {
    status: 'approved_by_advisor',
    title: 'ที่ปรึกษาอนุมัติแล้ว',
    waitingOn: 'รอหัวหน้าสาขาวิชาพิจารณา',
    count: (s) => s.approved_by_advisor || 0,
  },
  {
    status: 'approved_by_dept_head',
    title: 'สาขาวิชาอนุมัติแล้ว',
    waitingOn: 'รอเจ้าหน้าที่ออกหนังสือและคณบดีลงนาม',
    count: (s) => s.approved_by_dept_head || 0,
  },
  {
    status: 'accepted',
    title: 'สถานประกอบการตอบรับ',
    waitingOn: 'ออกหนังสือส่งตัวได้ทันที',
    done: true,
    count: (s) => s.dispatch_eligible || s.accepted || 0,
  },
];

const StaffDashboard: React.FC<StaffDashboardProps> = ({ activeMenu = 'dashboard', defaultTab }) => {
  const currentTab = defaultTab || (['jobs', 'announcements', 'users', 'import'].includes(activeMenu) ? activeMenu : 'dashboard');

  const [intents, setIntents] = useState<StudentIntent[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Job Approval Queue state
  const [allJobs, setAllJobs] = useState<JobPostRow[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [publishingJobId, setPublishingJobId] = useState<number | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState<'all' | 'pending_approval' | 'published' | 'rejected' | 'closed'>('all');
  const [rejectingJob, setRejectingJob] = useState<JobPostRow | null>(null);
  const [jobRejectReason, setJobRejectReason] = useState('');
  const [jobRejectCustom, setJobRejectCustom] = useState('');
  const [jobRejectError, setJobRejectError] = useState<string | null>(null);
  const [isRejectingJob, setIsRejectingJob] = useState(false);

  // PR Announcements state
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annImage, setAnnImage] = useState('');
  const [annPinned, setAnnPinned] = useState(false);
  const [isSubmittingAnn, setIsSubmittingAnn] = useState(false);

  // CSV/Excel Import states
  const [dragOver, setDragOver] = useState(false);
  const [parsedStudents, setParsedStudents] = useState<ParsedStudent[]>([]);
  /** Whether the dropped file carried an eligibility column at all. */
  const [eligibleColumnPresent, setEligibleColumnPresent] = useState(false);
  /** Rows the file gave up on, named individually rather than as one failure. */
  const [rejectedRows, setRejectedRows] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Student sub-tab states
  const [studentSubTab, setStudentSubTab] = useState<'bulk' | 'manual'>('bulk');
  const [manualStudentCode, setManualStudentCode] = useState('');
  const [manualStudentEligible, setManualStudentEligible] = useState(true);
  const [manualStudentGpa, setManualStudentGpa] = useState('');
  const [manualStudentEmail, setManualStudentEmail] = useState('');
  const [isAddingStudent, setIsAddingStudent] = useState(false);

  // Document Generation states
  const [selectedIntent, setSelectedIntent] = useState<StudentIntent | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);

  // User list states (for user mgmt tab)
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersSubTab, setUsersSubTab] = useState<'active' | 'preseed'>('active');

  // Pre-seed personnel states
  const [preseededPersonnel, setPreseededPersonnel] = useState<PreseedPersonnelRow[]>([]);
  const [loadingPreseed, setLoadingPreseed] = useState(false);
  const [majors, setMajors] = useState<MajorOption[]>([]);
  const [preseedEmployeeCode, setPreseedEmployeeCode] = useState('');
  const [preseedRoleName, setPreseedRoleName] = useState('advisor');
  const [preseedMajorId, setPreseedMajorId] = useState<number | ''>('');
  const [preseedFirstName, setPreseedFirstName] = useState('');
  const [preseedLastName, setPreseedLastName] = useState('');
  const [preseedEmail, setPreseedEmail] = useState('');
  const [preseedActiveTab, setPreseedActiveTab] = useState<'csv' | 'manual'>('csv');
  const [preseedDragOver, setPreseedDragOver] = useState(false);
  const [isUploadingPreseed, setIsUploadingPreseed] = useState(false);
  const [preseedImportResult, setPreseedImportResult] = useState<{ summary: ImportSummary } | null>(null);

  // Active User modals & editing
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [userIsActive, setUserIsActive] = useState(true);
  const [isSubmittingUser, setIsSubmittingUser] = useState(false);
  const [resendingInvite, setResendingInvite] = useState<number | null>(null);

  const [pipelineSummary, setPipelineSummary] = useState<Record<string, number>>({
    pending_advisor: 0,
    approved_by_advisor: 0,
    approved_by_dept_head: 0,
    accepted: 0,
    dispatch_eligible: 0,
  });

  const loadData = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);

      // Fetch intents, templates, documents, and pipeline summary in parallel
      const [intentsData, templatesData, docsData, summaryData] = await Promise.all([
        api.get('/intents'),
        api.get('/documents/templates'),
        api.get('/documents'),
        api.get('/intents/pipeline-summary').catch(() => null)
      ]);

      setIntents(intentsData || []);
      setTemplates(templatesData || []);
      setDocuments(docsData || []);
      if (summaryData) {
        setPipelineSummary(summaryData);
      }

      if (currentTab === 'users') {
        await loadUsers();
        await loadPreseedAndMajors();
      } else if (currentTab === 'jobs') {
        await loadAllJobs();
      } else if (currentTab === 'announcements') {
        await loadAnnouncements();
      }
    } catch (err) {
      console.error('Failed to load Staff dashboard data:', err);
      if (!isBackground) setError('ไม่สามารถดึงข้อมูลสหกิจศึกษาได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const loadAllJobs = async () => {
    try {
      setLoadingJobs(true);
      const jobsRes = await api.get('/jobs');
      setAllJobs(jobsRes || []);
    } catch (err) {
      console.error('Failed to load job posts:', err);
    } finally {
      setLoadingJobs(false);
    }
  };

  const handlePublishJob = async (jobId: number) => {
    try {
      setPublishingJobId(jobId);
      setError(null);
      await api.put(`/jobs/${jobId}/publish`);
      setSuccess('อนุมัติเผยแพร่ตำแหน่งงานเรียบร้อยแล้ว');
      await loadAllJobs();
    } catch (err) {
      console.error('Publish job error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถอนุมัติตำแหน่งงานได้'));
    } finally {
      setPublishingJobId(null);
    }
  };

  /**
   * The queue only ever had an approve button, so a posting that should not go
   * out could be neither refused nor explained. The reasons below are the ones
   * a co-op officer actually judges a posting on — the same standard the advisor
   * and the department head have been held to since they gained reject dialogs.
   */
  const handleRejectJob = async () => {
    const finalReason = (jobRejectReason === 'custom' ? jobRejectCustom : jobRejectReason).trim();
    if (!finalReason) {
      setJobRejectError('กรุณาเลือกหรือระบุเหตุผลที่ไม่อนุมัติ');
      return;
    }
    if (!rejectingJob) return;

    try {
      setIsRejectingJob(true);
      setJobRejectError(null);
      await api.put(`/jobs/${rejectingJob.job_id}/reject`, { reason: finalReason });
      setSuccess(`ไม่อนุมัติประกาศ "${rejectingJob.title}" แล้ว สถานประกอบการจะเห็นเหตุผลนี้ในหน้าประกาศของตนเอง`);
      setRejectingJob(null);
      setJobRejectReason('');
      setJobRejectCustom('');
      await loadAllJobs();
    } catch (err) {
      console.error('Reject job error:', err);
      setJobRejectError(getErrorMessage(err, 'ไม่สามารถบันทึกการไม่อนุมัติได้'));
    } finally {
      setIsRejectingJob(false);
    }
  };

  const loadAnnouncements = async () => {
    try {
      setLoadingAnnouncements(true);
      const res = await api.get('/announcements');
      setAnnouncements(res?.data || []);
    } catch (err) {
      console.error('Failed to load announcements:', err);
    } finally {
      setLoadingAnnouncements(false);
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle.trim() || !annContent.trim()) return;

    try {
      setIsSubmittingAnn(true);
      setError(null);
      await api.post('/announcements', {
        title: annTitle.trim(),
        content: annContent.trim(),
        image_url: annImage.trim() || null,
        is_pinned: annPinned
      });
      setSuccess('สร้างข่าวประชาสัมพันธ์สำเร็จ');
      setAnnTitle('');
      setAnnContent('');
      setAnnImage('');
      setAnnPinned(false);
      await loadAnnouncements();
    } catch (err) {
      console.error('Create announcement error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถสร้างข่าวประชาสัมพันธ์ได้'));
    } finally {
      setIsSubmittingAnn(false);
    }
  };

  const handleTogglePin = async (id: number) => {
    try {
      await api.patch(`/announcements/${id}/pin`);
      await loadAnnouncements();
    } catch (err) {
      console.error('Toggle pin error:', err);
    }
  };

  /**
   * The four destructive actions on this screen used to be guarded by
   * window.confirm. They share one dialog rather than four pieces of state,
   * because what differs between them is only the wording and the callback.
   */
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    destructive?: boolean;
    run: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const runPendingConfirm = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      await pendingConfirm.run();
    } finally {
      setConfirmBusy(false);
      setPendingConfirm(null);
    }
  };

  const handleDeleteAnnouncement = async (id: number) => {
    try {
      await api.delete(`/announcements/${id}`);
      setSuccess('ลบข่าวประชาสัมพันธ์เรียบร้อยแล้ว');
      await loadAnnouncements();
    } catch (err) {
      console.error('Delete announcement error:', err);
    }
  };

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const usersData = await api.get('/users');
      setUsers(usersData || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadPreseedAndMajors = async () => {
    try {
      setLoadingPreseed(true);
      const [preseedData, masterData] = await Promise.all([
        api.get('/personnel/preseed'),
        api.get('/master-data')
      ]);
      setPreseededPersonnel(preseedData || []);
      setMajors(masterData.majors || []);
    } catch (err) {
      console.error('Failed to load preseed personnel or majors:', err);
    } finally {
      setLoadingPreseed(false);
    }
  };

  useDashboardData(loadData, [currentTab]);

  // Drag and drop events
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setError(null);
    setSuccess(null);
    setImportSummary(null);

    const file = e.dataTransfer.files[0];
    if (file) {
      parseFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccess(null);
    setImportSummary(null);

    const file = e.target.files?.[0];
    if (file) {
      parseFile(file);
    }
  };

  // Parse Excel or CSV file client-side using SheetJS
  const parseFile = (file: File) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) return;

        // SheetJS is half a megabyte and only this one handler needs it, so it
        // is fetched when a file is actually dropped rather than shipped to
        // every staff member who opens the dashboard.
        const XLSX = await import('xlsx');

        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // The header row has to be read separately: sheet_to_json omits keys for
        // empty cells, so a row object alone cannot tell "the file has no
        // eligibility column" apart from "this row left it blank" — and those
        // two now mean different things.
        const headerRow: string[] = (XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 })[0] || [])
          .map((h) => String(h ?? '').trim());
        const hasEligibleColumn = headerRow.some(h => ELIGIBLE_HEADERS.includes(h));

        // defval keeps blank cells present as '' so a cleared cell is visible.
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

        // One bad row used to throw out of the whole .map(), so a single wrong
        // grade in a file of 300 meant nothing was imported and only that row
        // was named. The backend has reported per-row failures in
        // `summary.invalidRows` all along — it just never got the chance,
        // because this threw first. Rows are collected here the same way.
        const formatted: ParsedStudent[] = [];
        const rejected: string[] = [];

        rawRows.forEach((row, idx) => {
          const rowNo = idx + 2; // +1 for the header, +1 because sheets are 1-based
          const student_code = String(row.student_code || row['รหัสนักศึกษา'] || '').trim();

          // `||` was wrong here: Excel hands back a real boolean for a FALSE
          // cell, and `false || undefined` fell through to the "no column at
          // all" branch, which then set eligibility to true. Typing FALSE
          // flipped to eligible — the opposite of what was written.
          const eligValue = ELIGIBLE_HEADERS
            .map(h => row[h])
            .find(v => v !== undefined && String(v).trim() !== '');

          let is_eligible: boolean | null = null;
          if (eligValue !== undefined) {
            const normalized = String(eligValue).trim().toLowerCase();
            if (ELIGIBLE_TRUE.includes(normalized)) {
              is_eligible = true;
            } else if (ELIGIBLE_FALSE.includes(normalized)) {
              is_eligible = false;
            } else {
              rejected.push(`แถวที่ ${rowNo}: ค่าสิทธิ์ '${eligValue}' ไม่ใช่ true/false`);
              return;
            }
          }

          if (!student_code) {
            rejected.push(`แถวที่ ${rowNo}: ไม่พบรหัสนักศึกษา`);
            return;
          }

          const rawGpa = row.cumulative_gpa ?? row['เกรดเฉลี่ย'] ?? row['GPAX'];
          const cumulative_gpa =
            rawGpa === undefined || rawGpa === null || String(rawGpa).trim() === ''
              ? ''
              : String(rawGpa).trim();

          if (cumulative_gpa !== '') {
            const gpaNum = Number(cumulative_gpa);
            if (isNaN(gpaNum) || gpaNum < 0 || gpaNum > 4) {
              rejected.push(`แถวที่ ${rowNo}: เกรดเฉลี่ย '${cumulative_gpa}' ต้องอยู่ระหว่าง 0.00-4.00`);
              return;
            }
          }

          const email = String(row.email ?? row['อีเมล'] ?? '').trim().toLowerCase();

          // These four values are handed to the importer as CSV, and its parser
          // is a plain split(',') with no quoting. A comma inside a value would
          // silently shift every column after it — the write-side twin of the
          // export bug fixed on the progress board. None of these four fields
          // can legitimately contain one, so the row is named and dropped
          // rather than quoted into a format the reader cannot parse back.
          const offending = [student_code, cumulative_gpa, email].find(v => /[",\r\n]/.test(v));
          if (offending !== undefined) {
            rejected.push(`แถวที่ ${rowNo}: ค่า '${offending}' มีจุลภาคหรือเครื่องหมายคำพูด ซึ่งใช้ในไฟล์นำเข้าไม่ได้`);
            return;
          }

          formatted.push({ student_code, is_eligible, cumulative_gpa, email });
        });

        if (formatted.length === 0) {
          throw new Error(
            rejected.length > 0
              ? `ไม่มีแถวที่นำเข้าได้เลย · ${rejected.slice(0, 3).join(' · ')}`
              : 'ไม่พบข้อมูลนักศึกษาในไฟล์'
          );
        }

        setParsedStudents(formatted);
        setRejectedRows(rejected);
        setEligibleColumnPresent(hasEligibleColumn);
        setSuccess(
          rejected.length > 0
            ? `อ่านไฟล์สำเร็จ นำเข้าได้ ${formatted.length} รายการ ข้าม ${rejected.length} แถว (ดูรายการด้านล่าง)`
            : `อ่านไฟล์สำเร็จ พบข้อมูลนักศึกษา ${formatted.length} รายการ (กรุณาตรวจสอบข้อมูลและกดปุ่มยืนยัน)`
        );
      } catch (err) {
        console.error('File parsing error:', err);
        setError(`ไม่สามารถอ่านไฟล์ได้: ${getErrorMessage(err, 'โครงสร้างไฟล์ไม่ถูกต้อง')}`);
        setParsedStudents([]);
        setRejectedRows([]);
        setEligibleColumnPresent(false);
      }
    };

    reader.onerror = () => {
      setError('เกิดข้อผิดพลาดในการอ่านไฟล์');
    };

    reader.readAsBinaryString(file);
  };

  // Upload parsed data as CSV formatted text to backend
  const handleConfirmImport = async () => {
    if (parsedStudents.length === 0) return;

    setIsImporting(true);
    setError(null);
    setSuccess(null);

    try {
      // Build CSV content string matching expected schema.
      // An unstated eligibility travels as an empty cell, which is what the
      // importer reads as "leave this student's eligibility alone".
      const csvHeader = 'student_code,is_eligible,cumulative_gpa,email';
      const csvLines = parsedStudents.map(
        s => `${s.student_code},${s.is_eligible === null ? '' : s.is_eligible},${s.cumulative_gpa},${s.email}`
      );
      const csvString = [csvHeader, ...csvLines].join('\n');

      const res = await api.post('/students/import', { csv: csvString });
      setImportSummary(res.summary);
      setSuccess('นำเข้าและซิงโครไนซ์ข้อมูลรายชื่อนักศึกษากับระบบฐานข้อมูลสำเร็จแล้ว');
      setParsedStudents([]);
      setRejectedRows([]);
    } catch (err) {
      console.error('Import sync error:', err);
      setError(getErrorMessage(err, 'การเชื่อมต่อส่งไฟล์เพื่อซิงค์ข้อมูลกับฐานข้อมูลล้มเหลว'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleManualStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualStudentCode) {
      setError('กรุณากรอกรหัสนักศึกษา');
      return;
    }
    if (!/^\d{12}-\d$/.test(manualStudentCode.trim())) {
      setError('รูปแบบรหัสนักศึกษาไม่ถูกต้อง ต้องเป็นตัวเลข 12 หลักตามด้วยขีดและตัวเลข 1 หลัก (เช่น 123456789012-3)');
      return;
    }

    setIsAddingStudent(true);
    setError(null);
    setSuccess(null);

    try {
      const csvString = `student_code,is_eligible,cumulative_gpa,email\n${manualStudentCode.trim()},${manualStudentEligible},${manualStudentGpa.trim()},${manualStudentEmail.trim().toLowerCase()}`;
      await api.post('/students/import', { csv: csvString });
      
      setSuccess(`เพิ่มรายชื่อนักศึกษา ${manualStudentCode} สำเร็จเรียบร้อยแล้ว`);
      setManualStudentCode('');
      setManualStudentGpa('');
      setManualStudentEmail('');
    } catch (err) {
      console.error('Manual student add error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลนักศึกษาได้'));
    } finally {
      setIsAddingStudent(false);
    }
  };

  const handleManualPreseedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preseedEmployeeCode || !preseedFirstName || !preseedLastName || !preseedEmail) {
      setError('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน');
      return;
    }
    if (['advisor', 'dept_head'].includes(preseedRoleName) && !preseedMajorId) {
      setError('กรุณาระบุสาขาวิชาที่อาจารย์สังกัด');
      return;
    }

    setIsUploadingPreseed(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        employee_code: preseedEmployeeCode.trim(),
        role_name: preseedRoleName,
        major_id: ['advisor', 'dept_head'].includes(preseedRoleName) ? Number(preseedMajorId) : null,
        first_name: preseedFirstName.trim(),
        last_name: preseedLastName.trim(),
        email: preseedEmail.trim().toLowerCase(),
      };

      await api.post('/personnel/add', payload);
      setSuccess('เพิ่มข้อมูลรายชื่อบุคลากรล่วงหน้าสำเร็จ');
      setPreseedEmployeeCode('');
      setPreseedFirstName('');
      setPreseedLastName('');
      setPreseedEmail('');
      setPreseedMajorId('');
      await loadPreseedAndMajors();
    } catch (err) {
      console.error('Manual preseed error:', err);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูลบุคลากรล่วงหน้า'));
    } finally {
      setIsUploadingPreseed(false);
    }
  };

  const handlePreseedCSVUpload = async (file: File) => {
    if (!file) return;
    
    setIsUploadingPreseed(true);
    setError(null);
    setSuccess(null);
    setPreseedImportResult(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.post('/personnel/import', formData);
      setPreseedImportResult(response);
      setSuccess('นำเข้าข้อมูลบุคลากรผ่านไฟล์ CSV สำเร็จ');
      await loadPreseedAndMajors();
    } catch (err) {
      console.error('Preseed CSV upload error:', err);
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการนำเข้าไฟล์ CSV'));
    } finally {
      setIsUploadingPreseed(false);
    }
  };

  const handleDeletePreseed = async (employeeCode: string) => {
    setError(null);
    setSuccess(null);

    try {
      await api.delete(`/personnel/preseed/${employeeCode}`);
      setSuccess('ลบรายชื่อบุคลากรล่วงหน้าสำเร็จ');
      await loadPreseedAndMajors();
    } catch (err) {
      console.error('Delete preseed error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถลบข้อมูลบุคลากรล่วงหน้าได้'));
    }
  };

  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmail || !userPassword || userRoles.length === 0) {
      setError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    setIsSubmittingUser(true);
    setError(null);
    setSuccess(null);

    try {
      await api.post('/users', {
        email: userEmail.trim().toLowerCase(),
        password: userPassword,
        role: userRoles[0]
      });

      setSuccess('สร้างบัญชีผู้ใช้งานระบบสำเร็จ');
      setIsAddUserModalOpen(false);
      setUserEmail('');
      setUserPassword('');
      setUserRoles([]);
      await loadUsers();
    } catch (err) {
      console.error('Create user error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถสร้างบัญชีผู้ใช้ได้'));
    } finally {
      setIsSubmittingUser(false);
    }
  };

  const handleEditUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !userEmail || userRoles.length === 0) {
      setError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    setIsSubmittingUser(true);
    setError(null);
    setSuccess(null);

    try {
      await api.put(`/users/${selectedUser.user_id}`, {
        email: userEmail.trim().toLowerCase(),
        roles: userRoles,
        is_active: userIsActive
      });

      setSuccess('อัปเดตข้อมูลบัญชีผู้ใช้สำเร็จ');
      setIsEditUserModalOpen(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (err) {
      console.error('Update user error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกข้อมูลผู้ใช้ได้'));
    } finally {
      setIsSubmittingUser(false);
    }
  };

  const handleDeleteUser = async (userId: number) => {
    setError(null);
    setSuccess(null);

    try {
      await api.delete(`/users/${userId}`);
      setSuccess('ลบบัญชีผู้ใช้สำเร็จ');
      await loadUsers();
    } catch (err) {
      console.error('Delete user error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถลบบัญชีผู้ใช้ได้'));
    }
  };

  /**
   * Companies and mentors reach the system only through their invitation link,
   * so if it expires or never arrives this is their way back in — there is no
   * self-service route for an account that has never had a password.
   */
  const handleResendInvite = async (userId: number, email: string) => {
    setError(null);
    setSuccess(null);
    setResendingInvite(userId);

    try {
      const res = await api.post(`/users/${userId}/resend-invite`);
      setSuccess(res.message || `ส่งลิงก์เชิญไปที่ ${email} เรียบร้อยแล้ว`);
    } catch (err) {
      console.error('Resend invite error:', err);
      setError(getErrorMessage(err, 'ไม่สามารถส่งลิงก์เชิญได้'));
    } finally {
      setResendingInvite(null);
    }
  };

  // Generate official PDF document
  const handleGenerateDocSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIntent || !selectedTemplateId) return;

    setIsGeneratingDoc(true);
    setError(null);
    setSuccess(null);

    try {
      await api.post('/documents/generate', {
        student_id: selectedIntent.student_id,
        company_id: selectedIntent.company_id,
        template_id: selectedTemplateId
      });

      setSuccess(`ออกเอกสารราชการให้กับนักศึกษาและส่งเรื่องให้คณบดีพิจารณาเรียบร้อยแล้ว`);
      setSelectedIntent(null);
      setSelectedTemplateId('');
      // ต้องเป็น background reload — loadData() เปล่าๆ ตั้ง loading = true ซึ่งทำให้ทั้งหน้า
      // ถูกแทนด้วย PageSkeleton แถบ "ออกเอกสาร...เรียบร้อยแล้ว" ที่เพิ่งตั้งจึงหายจากจอ
      // จนกว่าการโหลดจะเสร็จ — เป็นเหตุผลเดียวกับที่ useDashboardData มี isBackground มาแต่ต้น
      await loadData(true);
    } catch (err) {
      console.error('Document generation error:', err);
      setError(getErrorMessage(err, 'การสร้างเอกสารล้มเหลว ตรวจสอบข้อมูลติดต่อ HR บริษัทปลายทาง'));
    } finally {
      setIsGeneratingDoc(false);
    }
  };

  // Filter student intents that have placement accepted
  const acceptedPlacements = intents.filter(i => i.status === 'accepted');

  /**
   * The queue mixed published, pending and closed postings in one undifferentiated
   * list ordered by id, so the badge could say "3 awaiting approval" while the
   * officer scrolled looking for them. Waiting work sorts to the top, and the
   * filter is there for when the list is long enough that sorting is not enough.
   */
  const JOB_STATUS_ORDER: Record<string, number> = {
    pending_approval: 0,
    published: 1,
    rejected: 2,
    closed: 3,
  };

  const visibleJobs = allJobs
    .filter(j => jobStatusFilter === 'all' || j.status === jobStatusFilter)
    .slice()
    .sort((a, b) => (JOB_STATUS_ORDER[a.status] ?? 9) - (JOB_STATUS_ORDER[b.status] ?? 9));

  const eligibilityPlan = {
    grant: parsedStudents.filter(s => s.is_eligible === true).length,
    revoke: parsedStudents.filter(s => s.is_eligible === false).length,
    untouched: parsedStudents.filter(s => s.is_eligible === null).length,
  };

  const getDocTypeLabel = (type: string) => {
    if (type === 'cover_letter') return 'หนังสือขอความอนุเคราะห์';
    if (type === 'send_letter') return 'หนังสือส่งตัวนักศึกษา';
    return type;
  };

  if (loading) {
    return (
      <PageSkeleton variant={skeletonFor('staff', currentTab)} />
    );
  }

  return (
    <div className="space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">
          {currentTab === 'import' 
            ? 'จัดการรายชื่อและตรวจสอบคุณสมบัตินักศึกษา (Student Eligibility)' 
            : currentTab === 'users' 
            ? 'การจัดการสิทธิ์ & บัญชีผู้ใช้ (User & Role Management)' 
            : currentTab === 'jobs'
            ? 'คิวตรวจอนุมัติประกาศรับสมัครงาน (Smart Job Board Queue)'
            : currentTab === 'announcements'
            ? 'จัดการข่าวสารและประกาศปักหมุดประชาสัมพันธ์ (PR Announcements)'
            : 'ภาพรวมออกเอกสารจัดส่งตัว (Official Document Control)'}
        </h2>
        {/* gray-600, not gray-500 like the descriptions inside cards: this one
            sits on the page's gray background rather than on white, which costs
            it just enough contrast to fall under AA (4.39:1 measured). */}
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
          {currentTab === 'import'
            ? 'ตรวจสอบความพร้อมในการสมัครสหกิจ นำเข้าเกรดเฉลี่ย และคัดกรองคุณสมบัตินักศึกษา' 
            : currentTab === 'users'
            ? 'สร้าง แก้ไข และลบสิทธิ์บัญชีผู้ใช้ระบบ พร้อมเตรียมสิทธิ์นำเข้าบุคลากรล่วงหน้า'
            : currentTab === 'jobs'
            ? 'ตรวจสอบตำแหน่งงานที่สถานประกอบการโพสต์เข้ามา และกดอนุมัติเผยแพร่ไปยังกระดานหางานของนักศึกษา'
            : currentTab === 'announcements'
            ? 'ลงประกาศข่าวสาร กำหนดการ และข่าวประชาสัมพันธ์สำคัญของคณะพร้อมการปักหมุดด่วน'
            : 'ออกจดหมายนำส่งตัวนักศึกษาอย่างเป็นทางการเพื่อให้คณบดีเซ็นอนุมัติผ่านระบบลายเซ็นอิเล็กทรอนิกส์'}
        </p>
      </div>

      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={success} />

      {currentTab === 'import' ? (
        <div className="space-y-6">
          {/* Sub-tabs for Student Import/Management */}
          <div className="flex border-b border-gray-200 dark:border-gray-800">
            <button
              onClick={() => setStudentSubTab('bulk')}
              className={`py-2.5 px-4 font-semibold text-xs border-b-2 transition-all ${
                studentSubTab === 'bulk'
                  ? 'border-brand-blue text-brand-blue dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
              }`}
            >
              นำเข้าด้วยไฟล์ (Bulk Import)
            </button>
            <button
              onClick={() => setStudentSubTab('manual')}
              className={`py-2.5 px-4 font-semibold text-xs border-b-2 transition-all ${
                studentSubTab === 'manual'
                  ? 'border-brand-blue text-brand-blue dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
              }`}
            >
              เพิ่มรายบุคคล (Manual Add Student)
            </button>
          </div>

          {studentSubTab === 'bulk' ? (
            <div className="space-y-6">
          {/* Drag and Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center transition-all ${
              dragOver
                ? 'border-brand-blue bg-blue-50/10 dark:bg-blue-950/10'
                : 'border-gray-300 hover:border-brand-blue dark:border-gray-800 bg-white dark:bg-gray-900'
            }`}
          >
            <div className="h-12 w-12 rounded-xl bg-blue-50 text-brand-blue flex items-center justify-center mb-4 dark:bg-gray-800 dark:text-blue-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            
            <p className="text-sm font-bold text-gray-700 dark:text-gray-200 text-center">
              ลากและวางไฟล์ตรวจสอบรายชื่อนักศึกษาผู้มีสิทธิ์ฝึกงาน (CSV, XLSX, XLS) หรือคลิกเพื่อค้นหา
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
              รองรับโครงสร้างคอลัมน์: student_code (รหัสนักศึกษา), is_eligible (สิทธิ์สมัคร: true/false — เว้นว่างหรือไม่มีคอลัมน์นี้ = คงสิทธิ์เดิมไว้ ไม่ใช่ให้สิทธิ์), cumulative_gpa (เกรดเฉลี่ย — เว้นว่างเพื่อคงค่าเดิม), email (อีเมลผูกบัญชี)
            </p>
            
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
              id="file-import-input"
            />
            <label
              htmlFor="file-import-input"
              className="mt-6 py-2 px-4 rounded-xl border border-brand-blue text-brand-blue hover:bg-blue-50/10 text-xs font-bold cursor-pointer transition-all dark:text-blue-400"
            >
              เลือกไฟล์จากเครื่อง
            </label>
          </div>

          {/* Import Summary Results */}
          {importSummary && (
            <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 space-y-4">
              <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">ผลการเชื่อมโยงซิงโครไนซ์ข้อมูลล่าสุด</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <span className="text-gray-500 dark:text-gray-400 block font-medium">รายการที่อ่านพบทั้งสิ้น</span>
                  <span className="text-lg font-bold text-gray-800 dark:text-white mt-1 block">{importSummary.totalProcessed} ราย</span>
                </div>
                <div className="p-3 bg-green-50 dark:bg-green-950/15 rounded-lg text-green-700 dark:text-green-400">
                  <span className="text-gray-500 dark:text-gray-400 block font-medium">นำเข้าเพิ่มใหม่</span>
                  <span className="text-lg font-bold mt-1 block">{importSummary.importedCount} ราย</span>
                </div>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/15 rounded-lg text-brand-blue dark:text-blue-400">
                  <span className="text-gray-500 dark:text-gray-400 block font-medium">มีบัญชีในระบบแล้ว</span>
                  <span className="text-lg font-bold mt-1 block">{importSummary.updatedCount} ราย</span>
                </div>
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/15 rounded-lg text-yellow-700 dark:text-yellow-400">
                  <span className="text-gray-500 dark:text-gray-400 block font-medium">ไม่พบการเปลี่ยนแปลง</span>
                  <span className="text-lg font-bold mt-1 block">{importSummary.unchangedCount} ราย</span>
                </div>
              </div>

              <p className="text-xs text-gray-600 dark:text-gray-400">
                ไฟล์รายชื่อใช้กำหนดว่า <span className="font-medium">ใครมีสิทธิ์ยื่นใบสมัคร</span> เท่านั้น
                · สิทธิ์เข้าร่วมสหกิจศึกษาของนักศึกษาที่ลงทะเบียนแล้วจะไม่ถูกไฟล์นี้เขียนทับ
                ให้แก้ที่เมนู “ตรวจสอบคุณสมบัตินักศึกษา” หรือผ่านการอนุมัติใบสมัคร (สหกิจ 01)
              </p>

              {/* The importer has always returned these; nothing ever rendered
                  them, so a row the server refused vanished without a word. */}
              {((importSummary.invalidRows?.length ?? 0) > 0 || (importSummary.skippedCodes?.length ?? 0) > 0) && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/20">
                  <p className="font-bold text-amber-800 dark:text-amber-300 mb-1">
                    แถวที่ฐานข้อมูลไม่รับ ({(importSummary.invalidRows?.length || 0) + (importSummary.skippedCodes?.length || 0)} รายการ)
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5 text-amber-800 dark:text-amber-300">
                    {[...(importSummary.invalidRows || []), ...(importSummary.skippedCodes || [])].map((r: string, i: number) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Rows this browser could not read. They are listed next to the ones
              that did parse, so the officer can fix a handful of cells and drop
              the file again instead of hunting for one failure at a time. */}
          {rejectedRows.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs dark:border-amber-900/40 dark:bg-amber-950/20">
              <p className="font-bold text-amber-800 dark:text-amber-300 mb-1.5">
                ข้ามไป {rejectedRows.length} แถว — แถวที่เหลือยังนำเข้าได้ตามปกติ
              </p>
              <ul className="list-disc pl-4 space-y-0.5 max-h-40 overflow-y-auto text-amber-800 dark:text-amber-300">
                {rejectedRows.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {parsedStudents.length > 0 && (
            <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 space-y-4">
              {/* What this file is about to do, before it does it. Withdrawing
                  eligibility is the one line here that is hard to walk back, so
                  it is stated in its own colour rather than left to be inferred
                  from a table the officer would have to scroll. */}
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs dark:border-blue-950/40 dark:bg-blue-950/20">
                {!eligibleColumnPresent ? (
                  <p className="text-gray-700 dark:text-gray-200">
                    ไฟล์นี้<strong>ไม่มีคอลัมน์สิทธิ์</strong> — จะอัปเดตเฉพาะเกรดเฉลี่ยและอีเมล
                    <strong> ไม่แตะสิทธิ์สหกิจของใครทั้งสิ้น</strong>
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-gray-700 dark:text-gray-200">
                    <span>
                      ให้สิทธิ์ <strong className="text-green-700 dark:text-green-400">{eligibilityPlan.grant}</strong> คน
                    </span>
                    <span>
                      ถอนสิทธิ์ <strong className="text-red-700 dark:text-red-400">{eligibilityPlan.revoke}</strong> คน
                    </span>
                    <span>
                      ไม่แตะ <strong className="text-gray-600 dark:text-gray-300">{eligibilityPlan.untouched}</strong> คน
                    </span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center border-b border-gray-100 pb-4 dark:border-gray-800">
                <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                  มีไฟล์พร้อมนำเข้า ({parsedStudents.length} รายการ)
                </span>
                <Button size="sm" onClick={handleConfirmImport} loading={isImporting} loadingLabel="กำลังประมวลผลซิงค์ข้อมูล...">
                  ยืนยันเซฟเข้าฐานข้อมูล
                </Button>
              </div>

              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800 sticky top-0">
                      <th className="p-3 font-semibold">รหัสนักศึกษา</th>
                      <th className="p-3 font-semibold">สิทธิ์สมัครสหกิจหลังนำเข้า</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {parsedStudents.map((student, idx) => (
                      <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                        <td className="p-3 font-bold text-gray-800 dark:text-gray-200">
                          {student.student_code}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${
                            student.is_eligible === true
                              ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400'
                              : student.is_eligible === false
                              ? 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                          }`}>
                            {student.is_eligible === true
                              ? 'ให้สิทธิ์สหกิจ'
                              : student.is_eligible === false
                              ? 'ถอนสิทธิ์สหกิจ'
                              : 'คงสิทธิ์เดิมไว้'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
            /* Manual Student Add Form */
            <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 max-w-lg">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-4">เพิ่มรายชื่อนักศึกษาผู้มีสิทธิ์ฝึกงานรายบุคคล</h3>
              <form onSubmit={handleManualStudentSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    รหัสนักศึกษา (Student Code) *
                  </label>
                  <Input
                    type="text"
                    required
                    disabled={isAddingStudent}
                    placeholder="ตัวอย่าง 123456789012-3"
                    value={manualStudentCode}
                    onChange={(e) => setManualStudentCode(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    สิทธิ์การสมัครเข้าร่วมโครงการสหกิจศึกษา *
                  </label>
                  <Select
                    value={manualStudentEligible ? 'true' : 'false'}
                    onChange={(e) => setManualStudentEligible(e.target.value === 'true')}
                    className="cursor-pointer"
                  >
                    <option value="true">ผ่านเกณฑ์ (Eligible)</option>
                    <option value="false">ไม่ผ่านเกณฑ์ (Ineligible)</option>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    เกรดเฉลี่ยสะสม (GPAX)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="4"
                    disabled={isAddingStudent}
                    placeholder="เว้นว่างไว้เพื่อคงค่าเดิม"
                    value={manualStudentGpa}
                    onChange={(e) => setManualStudentGpa(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    เกรดเฉลี่ยแก้ไขได้จากที่นี่เท่านั้น นักศึกษาไม่สามารถกรอกเองได้
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    อีเมลสำหรับเข้าใช้งาน (SSO)
                  </label>
                  <Input
                    type="email"
                    disabled={isAddingStudent}
                    placeholder="s123456789012@rmutto.ac.th"
                    value={manualStudentEmail}
                    onChange={(e) => setManualStudentEmail(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    ระบุเพื่อผูกรหัสนักศึกษากับบัญชีเดียว ป้องกันการสวมรหัสของผู้อื่น
                  </p>
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" size="sm" loading={isAddingStudent} loadingLabel="กำลังบันทึกข้อมูล...">
                    บันทึกข้อมูลนักศึกษา
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      ) : currentTab === 'users' ? (
        <div className="space-y-6">
          {/* Sub-tabs for User & Role Management */}
          <div className="flex border-b border-gray-200 dark:border-gray-800">
            <button
              onClick={() => setUsersSubTab('active')}
              className={`py-2.5 px-4 font-semibold text-xs border-b-2 transition-all ${
                usersSubTab === 'active'
                  ? 'border-brand-blue text-brand-blue dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
              }`}
            >
              บัญชีผู้ใช้งานระบบ (Active Users)
            </button>
            <button
              onClick={() => setUsersSubTab('preseed')}
              className={`py-2.5 px-4 font-semibold text-xs border-b-2 transition-all ${
                usersSubTab === 'preseed'
                  ? 'border-brand-blue text-brand-blue dark:text-blue-400'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
              }`}
            >
              เตรียมรายชื่อบุคลากรล่วงหน้า (Pre-seed Personnel)
            </button>
          </div>

          {usersSubTab === 'active' ? (
            <div className="space-y-6">
              {/* Active Users Section */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex justify-between items-center">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                    รายชื่อสมาชิกและสิทธิ์ในระบบทั้งหมด
                  </span>
                  <Button
                    size="sm"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setUserEmail('');
                      setUserPassword('');
                      setUserRoles(['student']);
                      setIsAddUserModalOpen(true);
                    }}
                  >
                    เพิ่มบัญชีผู้ใช้ใหม่
                  </Button>
                </div>

                {loadingUsers ? (
                  <div className="p-6 text-center text-gray-500 dark:text-gray-400">กำลังโหลดรายการผู้ใช้งาน...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                          <th className="p-4 font-semibold">รหัสผู้ใช้</th>
                          <th className="p-4 font-semibold">อีเมลบัญชีผู้ใช้</th>
                          <th className="p-4 font-semibold">สิทธิ์ (Roles)</th>
                          <th className="p-4 font-semibold">สถานะบัญชี</th>
                          <th className="p-4 font-semibold text-center">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {users.map((u) => (
                          <tr key={u.user_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                            <td className="p-4 font-bold text-gray-800 dark:text-gray-300">#{u.user_id}</td>
                            <td className="p-4 text-gray-700 dark:text-gray-300">{u.email}</td>
                            <td className="p-4 flex gap-1">
                              {u.roles.map((r: string) => (
                                <span key={r} className="px-2 py-0.5 rounded bg-blue-50 text-brand-blue font-bold text-xs dark:bg-gray-800 dark:text-blue-300">
                                  {r}
                                </span>
                              ))}
                            </td>
                            <td className="p-4">
                              <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${u.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                              {u.is_active ? 'เปิดใช้งาน' : 'ระงับบัญชี'}
                            </td>
                            <td className="p-4 text-center">
                              <div className="flex flex-wrap gap-2 justify-center">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedUser(u);
                                    setUserEmail(u.email);
                                    setUserRoles(u.roles);
                                    setUserIsActive(u.is_active);
                                    setIsEditUserModalOpen(true);
                                  }}
                                  className="border-brand-blue text-brand-blue dark:text-blue-400 dark:border-blue-800"
                                >
                                  แก้ไข
                                </Button>
                                {/* External partners have no other way back in —
                                    they cannot reach the login form, and so cannot
                                    reach "forgot password", without their email. */}
                                {u.roles.some((r: string) => ['company', 'mentor'].includes(r)) && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    loading={resendingInvite === u.user_id}
                                    loadingLabel="กำลังส่ง..."
                                    onClick={() => setPendingConfirm({ title: 'ส่งลิงก์เชิญใหม่', message: `ส่งลิงก์เชิญเข้าใช้งานใหม่ไปที่ ${u.email}? ลิงก์เดิม (ถ้ามี) จะใช้ไม่ได้ทันที`, confirmLabel: 'ส่งลิงก์เชิญ', run: () => handleResendInvite(u.user_id, u.email) })}
                                    className="border-amber-500 text-amber-700 dark:text-amber-400 dark:border-amber-800"
                                    title="ส่งลิงก์ตั้งรหัสผ่านเข้าใช้งานใหม่ทางอีเมล"
                                  >
                                    ส่งลิงก์เชิญใหม่
                                  </Button>
                                )}
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setPendingConfirm({ title: 'ลบบัญชีผู้ใช้', message: `ลบบัญชี ${u.email} และข้อมูลโปรไฟล์ที่เกี่ยวข้องทั้งหมด? การลบนี้ไม่สามารถย้อนคืนได้`, confirmLabel: 'ลบบัญชีถาวร', destructive: true, run: () => handleDeleteUser(u.user_id) })}
                                  className="border-red-500 text-red-700 dark:text-red-400 dark:border-red-800"
                                >
                                  ลบ
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Add User Modal */}
              {isAddUserModalOpen && (
                <Modal
                  onClose={() => setIsAddUserModalOpen(false)}
                  size="md"
                  closeOnBackdrop={false}
                  title="เพิ่มบัญชีผู้ใช้งานระบบด้วยตนเอง"
                >
                  <ModalBody>
                    <form onSubmit={handleAddUserSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">อีเมลผู้ใช้งาน (Email)</label>
                        <Input
                          type="email"
                          required
                          placeholder="เช่น user@test.com"
                          value={userEmail}
                          onChange={(e) => setUserEmail(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">รหัสผ่านสำหรับเข้าระบบ (Password)</label>
                        <Input
                          type="password"
                          required
                          placeholder="กำหนดรหัสผ่านอย่างน้อย 6 หลัก"
                          value={userPassword}
                          onChange={(e) => setUserPassword(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">สิทธิ์เข้าใช้งานหลัก (Role)</label>
                        <Select
                          value={userRoles[0] || 'student'}
                          onChange={(e) => setUserRoles([e.target.value])}
                          className="cursor-pointer"
                        >
                          <option value="student">นักศึกษา (Student)</option>
                          <option value="advisor">อาจารย์ที่ปรึกษา (Advisor)</option>
                          <option value="dept_head">หัวหน้าสาขาวิชา (Department Head)</option>
                          <option value="staff">เจ้าหน้าที่สหกิจศึกษา (Staff)</option>
                          <option value="dean">คณบดี (Dean)</option>
                        </Select>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 pt-4">
                        <Button variant="secondary" size="sm" onClick={() => setIsAddUserModalOpen(false)}>
                          ยกเลิก
                        </Button>
                        <Button type="submit" size="sm" loading={isSubmittingUser} loadingLabel="กำลังบันทึก...">
                          สร้างบัญชี
                        </Button>
                      </div>
                    </form>
                  </ModalBody>
                </Modal>
              )}

              {/* Edit User Modal */}
              {isEditUserModalOpen && selectedUser && (
                <Modal
                  onClose={() => {
                    setIsEditUserModalOpen(false);
                    setSelectedUser(null);
                  }}
                  size="md"
                  closeOnBackdrop={false}
                  title={`แก้ไขข้อมูลบัญชีผู้ใช้งาน #${selectedUser.user_id}`}
                >
                  <ModalBody>
                    <form onSubmit={handleEditUserSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">อีเมลผู้ใช้งาน (Email)</label>
                        <Input
                          type="email"
                          required
                          value={userEmail}
                          onChange={(e) => setUserEmail(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">สถานะบัญชี</label>
                        <Select
                          value={userIsActive ? 'true' : 'false'}
                          onChange={(e) => setUserIsActive(e.target.value === 'true')}
                          className="cursor-pointer"
                        >
                          <option value="true">เปิดใช้งาน (Active)</option>
                          <option value="false">ระงับการใช้งาน (Inactive)</option>
                        </Select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">สิทธิ์เข้าใช้งานระบบ (Roles)</label>
                        <div className="space-y-2 max-h-36 overflow-y-auto p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50/50 dark:bg-gray-800 text-xs">
                          {['student', 'advisor', 'dept_head', 'staff', 'dean', 'company', 'mentor'].map((r) => {
                            const hasRole = userRoles.includes(r);
                            return (
                              <label key={r} className="flex items-center gap-2 cursor-pointer py-0.5">
                                <input
                                  type="checkbox"
                                  checked={hasRole}
                                  onChange={() => {
                                    if (hasRole) {
                                      setUserRoles(userRoles.filter(role => role !== r));
                                    } else {
                                      setUserRoles([...userRoles, r]);
                                    }
                                  }}
                                  className="rounded border-gray-300 text-brand-blue focus:ring-brand-blue dark:border-gray-700 dark:text-blue-400"
                                />
                                <span className="capitalize">{r}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 pt-4">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setIsEditUserModalOpen(false);
                            setSelectedUser(null);
                          }}
                        >
                          ยกเลิก
                        </Button>
                        <Button type="submit" size="sm" loading={isSubmittingUser} loadingLabel="กำลังบันทึก...">
                          บันทึกการแก้ไข
                        </Button>
                      </div>
                    </form>
                  </ModalBody>
                </Modal>
              )}
            </div>
          ) : (
            /* Pre-seed tab */
            <div className="space-y-6">
              {/* Split into Import and Manual seed forms */}
              <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4">
                <button
                  type="button"
                  onClick={() => setPreseedActiveTab('csv')}
                  /* The dark: colours used to sit outside the ternary, so in
                     dark mode both tabs were blue and the active one could not
                     be told apart. They belong to their own branch. */
                  className={`py-2 px-4 font-semibold text-xs border-b-2 transition-colors ${preseedActiveTab === 'csv' ? 'border-brand-blue text-brand-blue dark:text-blue-400' : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'}`}
                >
                  นำเข้าด้วยไฟล์ CSV (Bulk Import)
                </button>
                <button
                  type="button"
                  onClick={() => setPreseedActiveTab('manual')}
                  className={`py-2 px-4 font-semibold text-xs border-b-2 transition-colors ${preseedActiveTab === 'manual' ? 'border-brand-blue text-brand-blue dark:text-blue-400' : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'}`}
                >
                  เพิ่มรายบุคคล (Manual Add)
                </button>
              </div>

              {preseedActiveTab === 'csv' ? (
                <div className="space-y-4">
                  <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-xl border border-blue-100 dark:border-blue-950/20 text-xs space-y-1 text-gray-600 dark:text-gray-400">
                    <p className="font-bold text-brand-blue mb-1 dark:text-blue-400">คำแนะนำรูปแบบไฟล์ CSV สำหรับอัปโหลด:</p>
                    <p>คอลัมน์: <code className="bg-white dark:bg-gray-800 px-1 py-0.5 rounded text-red-500">employee_code, role_name, major_id, first_name, last_name, email</code></p>
                    <p className="mt-1">คอลัมน์ <strong>email</strong> จำเป็นต่อการยืนยันสิทธิ์ — แถวที่ไม่มีอีเมลจะนำเข้าได้แต่เจ้าตัวจะ claim ไม่ได้</p>
                    <p>บทบาท (role_name): advisor, dept_head, staff, หรือ dean</p>
                  </div>

                  <div
                    onDragOver={(e) => { e.preventDefault(); setPreseedDragOver(true); }}
                    onDragLeave={() => setPreseedDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setPreseedDragOver(false);
                      const file = e.dataTransfer.files[0];
                      if (file) handlePreseedCSVUpload(file);
                    }}
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${preseedDragOver ? 'border-brand-blue bg-blue-50/10' : 'border-gray-300 hover:border-brand-blue dark:border-gray-800'}`}
                    onClick={() => document.getElementById('preseed-csv-input')?.click()}
                  >
                    <input
                      type="file"
                      id="preseed-csv-input"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePreseedCSVUpload(file);
                      }}
                    />
                    <div className="flex flex-col items-center justify-center space-y-2 text-xs">
                      <svg className="w-10 h-10 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="font-bold text-gray-700 dark:text-gray-300">ลากวางไฟล์ CSV ของบุคลากรที่นี่ หรือคลิกเพื่ออัปโหลด</p>
                    </div>
                  </div>

                  {preseedImportResult && preseedImportResult.summary && (
                    <div className="p-4 bg-green-50 dark:bg-green-950/10 border border-green-200 dark:border-green-800/30 rounded-xl text-xs space-y-2">
                      <p className="font-bold text-green-700 dark:text-green-400">นำเข้าเรียบร้อยแล้ว:</p>
                      <div className="grid grid-cols-3 gap-2">
                        <div>ประมวลผล: {preseedImportResult.summary.totalProcessed} รายการ</div>
                        <div className="text-green-700 dark:text-green-400">เพิ่มใหม่: {preseedImportResult.summary.importedCount} รายการ</div>
                        <div className="text-brand-blue dark:text-blue-400">อัปเดตใหม่: {preseedImportResult.summary.updatedCount} รายการ</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Manual Add Personnel */
                <form onSubmit={handleManualPreseedSubmit} className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 space-y-4 max-w-2xl">
                  <h3 className="text-xs font-bold text-gray-800 dark:text-white">เพิ่มรายชื่อบุคลากรเพื่อรอการเปิดสิทธิ์ครั้งแรก</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">รหัสประจำตัวบุคลากร (Employee Code) *</label>
                      <Input
                        type="text"
                        required
                        placeholder="เช่น EMP9901"
                        value={preseedEmployeeCode}
                        onChange={(e) => setPreseedEmployeeCode(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">บทบาทสิทธิ์ในระบบ *</label>
                      <Select
                        value={preseedRoleName}
                        onChange={(e) => {
                          setPreseedRoleName(e.target.value);
                          if (!['advisor', 'dept_head'].includes(e.target.value)) setPreseedMajorId('');
                        }}
                        className="cursor-pointer"
                      >
                        <option value="advisor">อาจารย์ที่ปรึกษา (Advisor)</option>
                        <option value="dept_head">หัวหน้าสาขาวิชา (Department Head)</option>
                        <option value="staff">เจ้าหน้าที่สหกิจศึกษา (Staff)</option>
                        <option value="dean">คณบดี (Dean)</option>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">ชื่อจริง (ภาษาไทย) *</label>
                      <Input
                        type="text"
                        required
                        value={preseedFirstName}
                        onChange={(e) => setPreseedFirstName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">นามสกุล (ภาษาไทย) *</label>
                      <Input
                        type="text"
                        required
                        value={preseedLastName}
                        onChange={(e) => setPreseedLastName(e.target.value)}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        อีเมลสำหรับเข้าใช้งาน (SSO) *
                      </label>
                      <Input
                        type="email"
                        required
                        value={preseedEmail}
                        onChange={(e) => setPreseedEmail(e.target.value)}
                        placeholder="somchai.k@rmutto.ac.th"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        รหัสบุคลากรจะยืนยันสิทธิ์ได้เฉพาะบัญชีที่ใช้อีเมลนี้เท่านั้น
                      </p>
                    </div>
                    {['advisor', 'dept_head'].includes(preseedRoleName) && (
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">สาขาวิชาสังกัด *</label>
                        <Select
                          required
                          value={preseedMajorId}
                          onChange={(e) => setPreseedMajorId(Number(e.target.value))}
                          className="cursor-pointer"
                        >
                          <option value="">-- เลือกสาขาวิชา --</option>
                          {majors.map((m) => (
                            <option key={m.major_id} value={m.major_id}>{m.major_name_th}</option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button type="submit" size="sm" loading={isUploadingPreseed} loadingLabel="กำลังบันทึก...">
                      เพิ่มข้อมูลบุคลากร
                    </Button>
                  </div>
                </form>
              )}

              {/* Preseed Personnel List Table */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">รายชื่อรหัสบุคลากรล่วงหน้าในฐานข้อมูล</span>
                </div>
                {loadingPreseed ? (
                  <div className="p-6 text-center text-gray-500 dark:text-gray-400">กำลังโหลดข้อมูล...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                          <th className="p-4 font-semibold">รหัสพนักงาน</th>
                          <th className="p-4 font-semibold">ชื่อ - นามสกุล</th>
                          <th className="p-4 font-semibold">บทบาท (Role)</th>
                          <th className="p-4 font-semibold">สาขาวิชาสังกัด</th>
                          <th className="p-4 font-semibold">สถานะเคลมสิทธิ์</th>
                          <th className="p-4 font-semibold text-center">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {preseededPersonnel.map((p) => (
                          <tr key={p.employee_code} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                            <td className="p-4 font-bold text-gray-800 dark:text-gray-300">{p.employee_code}</td>
                            <td className="p-4 text-gray-700 dark:text-gray-300">{p.first_name} {p.last_name}</td>
                            <td className="p-4 text-gray-600 dark:text-gray-400 capitalize">{p.role_name}</td>
                            <td className="p-4 text-gray-600 dark:text-gray-400">{p.major_name_th || '-'}</td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded-full font-bold text-xs ${p.is_claimed ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}`}>
                                {p.is_claimed ? 'ยืนยันตัวตนแล้ว' : 'รอยืนยันสิทธิ์'}
                              </span>
                            </td>
                            <td className="p-4 text-center">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setPendingConfirm({ title: 'ลบรหัสบุคลากรล่วงหน้า', message: `ลบรหัสบุคลากรล่วงหน้า ${p.employee_code} ออกจากรายชื่อ? เจ้าของรหัสนี้จะยืนยันตัวตนผ่าน SSO ไม่ได้อีก`, confirmLabel: 'ลบรหัสนี้', destructive: true, run: () => handleDeletePreseed(p.employee_code) })}
                                disabled={p.is_claimed}
                                title={p.is_claimed ? 'ยืนยันตัวตนไปแล้ว ลบรหัสนี้ไม่ได้' : undefined}
                                className={p.is_claimed ? '' : 'border-red-500 text-red-700 dark:text-red-400 dark:border-red-800'}
                              >
                                ลบ
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : currentTab === 'jobs' ? (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex flex-col md:flex-row md:justify-between md:items-center gap-3">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                คิวตรวจสอบอนุมัติโพสต์รับสมัครงานของบริษัท
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                  รออนุมัติ: {allJobs.filter(j => j.status === 'pending_approval').length} รายการ
                </span>
                <Select
                  value={jobStatusFilter}
                  onChange={(e) => setJobStatusFilter(e.target.value as typeof jobStatusFilter)}
                  aria-label="กรองตามสถานะประกาศ"
                  className="cursor-pointer" size="sm"
                >
                  <option value="all">ทุกสถานะ ({allJobs.length})</option>
                  <option value="pending_approval">รอตรวจอนุมัติ ({allJobs.filter(j => j.status === 'pending_approval').length})</option>
                  <option value="published">เผยแพร่แล้ว ({allJobs.filter(j => j.status === 'published').length})</option>
                  <option value="rejected">ไม่อนุมัติ ({allJobs.filter(j => j.status === 'rejected').length})</option>
                  <option value="closed">ปิดรับสมัคร ({allJobs.filter(j => j.status === 'closed').length})</option>
                </Select>
              </div>
            </div>

            {loadingJobs ? (
              <PageSkeleton variant="table" />
            ) : visibleJobs.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleJobs.map((job) => (
                  <div key={job.job_id} className="p-6 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base text-gray-900 dark:text-white">{job.title}</span>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          job.status === 'published'
                            ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400'
                            : job.status === 'pending_approval'
                            /* Was animate-pulse. A permanent status is not an
                               event, and twenty of them blinking at once is
                               twenty things demanding attention forever. */
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                            : job.status === 'rejected'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {job.status === 'published'
                            ? 'เผยแพร่แล้ว'
                            : job.status === 'pending_approval'
                            ? 'รอเจ้าหน้าที่ตรวจอนุมัติ'
                            : job.status === 'rejected'
                            ? 'ไม่อนุมัติ'
                            : 'ปิดรับสมัคร'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        สถานประกอบการ: <span className="font-semibold text-gray-700 dark:text-gray-300">{job.company_name_th || 'บริษัท'}</span> | 
                        โควตารับสมัคร: <span className="font-semibold text-gray-700 dark:text-gray-300">{job.applied_count} / {job.quota} คน</span> | 
                        วันปิดรับสมัคร: <span className="font-semibold text-gray-700 dark:text-gray-300">{job.expire_date ? new Date(job.expire_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'}</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">{job.description}</p>
                      {job.status === 'rejected' && job.reject_reason && (
                        <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                          เหตุผลที่ไม่อนุมัติ: {job.reject_reason}
                        </p>
                      )}
                    </div>

                    {job.status === 'pending_approval' && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="success"
                          size="sm"
                          icon={<Check className="h-3.5 w-3.5" />}
                          onClick={() => setPendingConfirm({
                            title: 'อนุมัติเผยแพร่ตำแหน่งงาน',
                            message: `เผยแพร่ "${job.title}" ของ ${job.company_name_th || 'สถานประกอบการ'} ขึ้นกระดานหางาน? นักศึกษาทุกคนจะเห็นและยื่นความจำนงได้ทันที`,
                            confirmLabel: 'อนุมัติเผยแพร่',
                            run: () => handlePublishJob(job.job_id),
                          })}
                          loading={publishingJobId === job.job_id}
                          loadingLabel="กำลังอนุมัติ..."
                        >
                          อนุมัติเผยแพร่
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setRejectingJob(job);
                            setJobRejectReason('');
                            setJobRejectCustom('');
                            setJobRejectError(null);
                          }}
                          className="border-red-500 text-red-700 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
                        >
                          ไม่อนุมัติ
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : allJobs.length > 0 ? (
              <div className="text-center py-12 text-sm space-y-2">
                <p className="text-gray-500 dark:text-gray-400">ไม่มีประกาศที่ตรงกับตัวกรองนี้</p>
                <button
                  type="button"
                  onClick={() => setJobStatusFilter('all')}
                  className="text-xs font-bold text-brand-blue dark:text-blue-400 hover:underline"
                >
                  แสดงทุกสถานะ ({allJobs.length} รายการ)
                </button>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">ไม่มีรายการตำแหน่งงานในขณะนี้</div>
            )}
          </div>

          {rejectingJob && (
            <Modal
              onClose={() => setRejectingJob(null)}
              size="md"
              closeOnBackdrop={false}
              title="ไม่อนุมัติประกาศรับสมัครงาน"
            >
              <ModalBody>
                <div className="space-y-4">
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs">
                    <div className="font-bold text-gray-800 dark:text-white">{rejectingJob.title}</div>
                    <div className="text-gray-500 dark:text-gray-400 mt-0.5">
                      โดย {rejectingJob.company_name_th || 'สถานประกอบการ'}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      เหตุผลที่ไม่อนุมัติ * (สถานประกอบการจะเห็นข้อความนี้)
                    </label>
                    <Select
                      value={jobRejectReason}
                      onChange={(e) => setJobRejectReason(e.target.value)}
                      className="cursor-pointer"
                    >
                      <option value="">-- เลือกเหตุผล --</option>
                      <option value="รายละเอียดงานไม่ครบถ้วน นักศึกษาใช้ตัดสินใจไม่ได้">รายละเอียดงานไม่ครบถ้วน นักศึกษาใช้ตัดสินใจไม่ได้</option>
                      <option value="ลักษณะงานไม่ตรงกับหลักสูตรสหกิจศึกษา">ลักษณะงานไม่ตรงกับหลักสูตรสหกิจศึกษา</option>
                      <option value="สถานประกอบการยังไม่ผ่านการตรวจสอบข้อมูลจากคณะ">สถานประกอบการยังไม่ผ่านการตรวจสอบข้อมูลจากคณะ</option>
                      <option value="จำนวนที่รับหรือวันปิดรับสมัครไม่สอดคล้องกับปฏิทินสหกิจศึกษา">จำนวนที่รับหรือวันปิดรับสมัครไม่สอดคล้องกับปฏิทินสหกิจศึกษา</option>
                      <option value="ประกาศซ้ำกับตำแหน่งที่เผยแพร่อยู่แล้ว">ประกาศซ้ำกับตำแหน่งที่เผยแพร่อยู่แล้ว</option>
                      <option value="custom">ระบุเหตุผลเอง</option>
                    </Select>
                  </div>

                  {jobRejectReason === 'custom' && (
                    <Textarea
                      rows={3}
                      value={jobRejectCustom}
                      onChange={(e) => setJobRejectCustom(e.target.value)}
                      placeholder="ระบุสิ่งที่สถานประกอบการต้องแก้ไขก่อนส่งประกาศเข้ามาใหม่"
                    />
                  )}

                  {/* The error belongs inside the dialog: a banner behind an
                      open modal is a banner nobody reads. */}
                  <AlertBanner variant="error" message={jobRejectError} />

                  <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <Button variant="secondary" size="sm" onClick={() => setRejectingJob(null)}>
                      ยกเลิก
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={handleRejectJob}
                      loading={isRejectingJob}
                      loadingLabel="กำลังบันทึก..."
                    >
                      ยืนยันไม่อนุมัติ
                    </Button>
                  </div>
                </div>
              </ModalBody>
            </Modal>
          )}
        </div>
      ) : currentTab === 'announcements' ? (
        <div className="space-y-6">
          {/* Create Announcement Form */}
          <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 shadow-sm">
            <h3 className="text-base font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2"><Megaphone className="h-5 w-5 text-brand-blue dark:text-blue-400" /> ประกาศข่าวประชาสัมพันธ์ใหม่</h3>
            <form onSubmit={handleCreateAnnouncement} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">หัวข้อประกาศข่าวสาร *</label>
                <Input
                  type="text"
                  required
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder="เช่น กำหนดการยื่นแบบสมัครสหกิจศึกษา ภาคการศึกษา 1/2026"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">รายละเอียดและเนื้อหาประกาศ *</label>
                <Textarea
                  required
                  rows={4}
                  value={annContent}
                  onChange={(e) => setAnnContent(e.target.value)}
                  placeholder="กรอกรายละเอียดข่าว กำหนดการ สถานที่ หรือสิ่งที่นักศึกษาต้องเตรียมตัว..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">รูปภาพประกอบ (URL ถ้ามี)</label>
                  <Input
                    type="url"
                    value={annImage}
                    onChange={(e) => setAnnImage(e.target.value)}
                    placeholder="https://example.com/banner.jpg"
                  />
                </div>

                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={annPinned}
                      onChange={(e) => setAnnPinned(e.target.checked)}
                      className="w-4 h-4 rounded text-brand-blue focus:ring-brand-blue dark:text-blue-400"
                    />
                    ปักหมุดด่วนบน Banner นักศึกษา
                  </label>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button type="submit" loading={isSubmittingAnn} loadingLabel="กำลังลงประกาศ...">
                  เผยแพร่ข่าวประชาสัมพันธ์
                </Button>
              </div>
            </form>
          </div>

          {/* Announcements List */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800 flex justify-between items-center">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">รายการข่าวประชาสัมพันธ์ทั้งหมด</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">ทั้งหมด {announcements.length} รายการ</span>
            </div>

            {loadingAnnouncements ? (
              <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">กำลังโหลดประกาศข่าวสาร...</div>
            ) : announcements.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {announcements.map((ann) => (
                  <div key={ann.announcement_id} className="p-6 hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        {ann.is_pinned && <span className="text-xs font-bold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded-full inline-flex items-center gap-1"><Pin className="h-3 w-3" /> ปักหมุดด่วน</span>}
                        <span className="font-bold text-base text-gray-900 dark:text-white">{ann.title}</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        ประกาศเมื่อ: {new Date(ann.created_at).toLocaleString('th-TH')} | โดย: {ann.author_name || 'เจ้าหน้าที่'}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 mt-1">{ann.content}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleTogglePin(ann.announcement_id)}
                        className={ann.is_pinned ? 'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800' : ''}
                      >
                        {ann.is_pinned ? 'ถอนปักหมุด' : 'ปักหมุด'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPendingConfirm({ title: 'ลบข่าวประชาสัมพันธ์', message: `ลบประกาศ "${ann.title}" ออกจากระบบ?`, confirmLabel: 'ลบประกาศ', destructive: true, run: () => handleDeleteAnnouncement(ann.announcement_id) })}
                        className="border-red-300 text-red-700 dark:text-red-400 dark:border-red-900"
                      >
                        ลบประกาศ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">ยังไม่มีข่าวประชาสัมพันธ์ในขณะนี้</div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Workflow Pipeline Tracker.
              Was a hardcoded dark gradient, which made it the one panel that
              stayed dark in light mode — an island among the white cards either
              side of it. It is an ordinary surface now, and the four steps read
              as a sequence rather than four unrelated tiles. */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2 text-gray-800 dark:text-white">
                  <BarChart3 className="h-5 w-5 shrink-0 text-brand-blue dark:text-blue-400" />
                  ภาพรวมสถานะขั้นตอนนักศึกษาสหกิจศึกษา
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  จำนวนนักศึกษาที่ค้างอยู่ในแต่ละด่าน เรียงตามลำดับการอนุมัติ
                </p>
              </div>
              {/* Was "Real-time Status" in a mono font, which said nothing.
                  useDashboardData refreshes this every ten seconds. */}
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50 self-start md:self-auto">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                อัปเดตอัตโนมัติทุก 10 วินาที
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {PIPELINE_STEPS.map((step, i) => {
                const count = step.count(pipelineSummary);
                return (
                  <div key={step.status} className="relative">
                    {/* The chevron between tiles is what says "then". It is
                        decorative, so it is hidden from assistive tech and
                        disappears once the tiles stack. */}
                    {i > 0 && (
                      <ChevronRight
                        aria-hidden="true"
                        className="hidden lg:block absolute -left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-300 dark:text-gray-700"
                      />
                    )}
                    <div
                      className={`h-full rounded-xl border p-4 flex flex-col gap-2 transition-colors ${
                        step.done
                          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20'
                          : 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                            step.done
                              ? 'bg-emerald-700 text-white'
                              : 'bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                          {step.title}
                        </span>
                      </div>

                      <div className="flex items-baseline gap-1.5">
                        {/* An empty queue should read as quieter than a busy
                            one, but a zero still has to be legible — dimming it
                            to gray-300 made it the least readable thing on the
                            page, which is the mistake this pass exists to fix. */}
                        <span
                          className={`text-3xl font-extrabold tabular-nums ${
                            step.done
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : count > 0
                                ? 'text-gray-800 dark:text-white'
                                : 'text-gray-500 dark:text-gray-400'
                          }`}
                        >
                          {count}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">คน</span>
                      </div>

                      {/* Was the raw column value (pending_advisor). This says
                          who the queue is actually waiting on. */}
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
                        {step.waitingOn}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Document Generation Tab */}
          {/* Top Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Action 1: Placement list of students */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
              <div>
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                    นักศึกษาผ่านการสัมภาษณ์ & รอจดหมายส่งตัว ({acceptedPlacements.length} รายการ)
                  </span>
                </div>
                
                {acceptedPlacements.length > 0 ? (
                  <div className="max-h-[250px] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                    {acceptedPlacements.map((intent) => (
                      <div key={intent.form_id} className="p-4 flex justify-between items-center hover:bg-gray-50/50 dark:hover:bg-gray-800/10 text-xs">
                        <div>
                          <span className="block font-bold text-gray-800 dark:text-gray-200">{intentStudentName(intent)}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">รหัส: {intent.student_code} | บริษัท: {intent.company_name_th}</span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSelectedIntent(intent)}
                          className="shrink-0 border-brand-blue text-brand-blue dark:text-blue-400 dark:border-blue-800"
                        >
                          เลือกออกจดหมาย
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-xs">
                    ไม่มีนักศึกษาที่ได้รับการตอบรับและรอออกจดหมายส่งตัวในขณะนี้
                  </div>
                )}
              </div>
            </div>

            {/* Action 2: Generation Setup Form (visible when student selected) */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 flex flex-col justify-between">
              {selectedIntent ? (
                <form onSubmit={handleGenerateDocSubmit} className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">ขั้นตอนทำจดหมายจดทะเบียนกลุ่ม</h3>
                  
                  <div className="p-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg text-xs space-y-1">
                    <div><span className="text-gray-500 dark:text-gray-400">นักศึกษา:</span> <span className="font-bold text-gray-800 dark:text-white">{intentStudentName(selectedIntent)} ({selectedIntent.student_code})</span></div>
                    <div><span className="text-gray-500 dark:text-gray-400">สถานประกอบการ:</span> <span className="font-bold text-gray-800 dark:text-white">{selectedIntent.company_name_th}</span></div>
                    <div><span className="text-gray-500 dark:text-gray-400">ตำแหน่งงาน:</span> <span className="font-bold text-gray-800 dark:text-white">{selectedIntent.job_title || 'ระบุทั่วไป'}</span></div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      เลือกแม่แบบฟอร์มเอกสาร (Template)
                    </label>
                    <Select
                      required
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
                    >
                      <option value="">-- กรุณาเลือกแม่แบบเอกสาร --</option>
                      {templates.map((t) => (
                        <option key={t.template_id} value={t.template_id}>
                          {t.name} (ประเภท: {t.type === 'cover_letter' ? 'ขอความอนุเคราะห์' : 'ส่งตัวนักศึกษา'})
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 pt-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedIntent(null);
                        setSelectedTemplateId('');
                      }}
                    >
                      ยกเลิก
                    </Button>
                    <Button type="submit" size="sm" loading={isGeneratingDoc} loadingLabel="กำลังออกเอกสาร...">
                      ยืนยันการออกเอกสาร
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="text-center py-16 text-gray-500 dark:text-gray-400 text-xs">
                  กรุณาเลือกนักศึกษาจากตารางซ้ายมือเพื่อทำการออกเอกสารจดหมายราชการ
                </div>
              )}
            </div>

          </div>

          {/* Generated Documents Log */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 dark:border-gray-800">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                ประวัติการทำจดหมายออกส่งตัว & สถานะการเซ็นของคณบดี
              </span>
            </div>

            {documents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-800">
                      <th className="p-4 font-semibold">รหัสอ้างอิงเอกสาร</th>
                      <th className="p-4 font-semibold">ประเภทจดหมาย</th>
                      <th className="p-4 font-semibold">รหัสนักศึกษา</th>
                      <th className="p-4 font-semibold">บริษัทปลายทาง</th>
                      <th className="p-4 font-semibold text-center">สถานะลายเซ็น</th>
                      <th className="p-4 font-semibold text-right">ลิงก์อ่านไฟล์</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {documents.map((doc) => (
                      <tr key={doc.doc_id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                        <td className="p-4 font-bold text-gray-800 dark:text-gray-300">#DOC-{doc.doc_id}</td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">{getDocTypeLabel(doc.type)}</td>
                        <td className="p-4 text-gray-700 dark:text-gray-300 font-medium">{doc.student_code}</td>
                        <td className="p-4 text-gray-600 dark:text-gray-400">{doc.company_name_th}</td>
                        <td className="p-4 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full font-bold text-xs ${
                            doc.status === 'signed'
                              ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400'
                              /* Same reasoning as the job queue badge above. */
                              : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-400'
                          }`}>
                            {doc.status === 'signed' ? 'ลงนามเสร็จสิ้น' : 'รอลงนาม'}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          {doc.generated_file_path ? (
                            <a
                              href={`${API_BASE_URL}/files/documents/${doc.doc_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 rounded-lg border border-gray-200 hover:border-brand-blue hover:text-brand-blue transition-all dark:border-gray-800 dark:hover:text-blue-400"
                            >
                              เปิดไฟล์ PDF
                            </a>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">ไม่มีไฟล์</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400 text-sm">
                ยังไม่มีการออกจดหมายอย่างเป็นทางการบันทึกในระบบในขณะนี้
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        confirmLabel={pendingConfirm?.confirmLabel}
        destructive={pendingConfirm?.destructive}
        busy={confirmBusy}
        onConfirm={runPendingConfirm}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
};

export default StaffDashboard;
