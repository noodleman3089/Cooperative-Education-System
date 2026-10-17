import React, { useState, useCallback, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton from '../../components/ui/Skeleton';
import { skeletonFor } from '../../components/ui/skeletonFor';
import { useDashboardData } from '../../hooks/useDashboardData';
import { AuthContext } from '../../context/authContextValue';
import api from '../../services/api';
import type { IntentForm, StudentRow } from '../../types/api';
import { Search, Calendar, AlertCircle, ArrowLeft } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import StatusBadge from '../../components/ui/StatusBadge';
import { intentDisplayStatus } from '../../utils/intentStatus';
import IntentReviewModal from '../../components/IntentReviewModal';
import CoopFormsViewModal from '../../components/CoopFormsViewModal';
import StudentAvatar from '../../components/StudentAvatar';
import {
  STEP_LABEL,
  STEP_LINE,
  TIER_LABEL,
  TIER_ORDER,
  isUrgentIssue,
  issueText,
  type StatusBoardPayload,
  type StatusBoardStudent,
} from '../../utils/studentAttention';
import { getErrorMessage } from '../../utils/errors';

interface WeeklyLogItem {
  weekly_log_id: number;
  student_id: number;
  week_number: number;
  assigned_work?: string | null;
  methods?: string | null;
  tools_used?: string | null;
  achievements?: string | null;
  problems?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  mentor_certified_at?: string | null;
  mentor_certified_name?: string | null;
  returned_comment?: string | null;
}

interface MonthlyLogItem {
  monthly_log_id: number;
  student_id: number;
  year: number;
  month: number;
  work_summary?: string | null;
  effectiveness?: string | null;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  mentor_certified_at?: string | null;
  returned_comment?: string | null;
}

interface DailyLogItem {
  daily_log_id: number;
  week_number: number;
  log_date: string;
  work_detail?: string | null;
  remark?: string | null;
  status: string;
  returned_comment?: string | null;
  mentor_certified_at?: string | null;
}

interface DailyLogResponse {
  intent?: {
    daily_log_required?: boolean;
    mentor_name?: string;
  } | null;
  weeks?: Array<{
    week_number: number;
    logs: DailyLogItem[];
  }>;
}

interface SupervisorScoreRow {
  studentId: number;
  sahatkit15Score: number | null;
  sahatkit16Score: number | null;
}

/** ข้อมูลติดต่อของนักศึกษาหนึ่งคน (ที่พัก · พี่เลี้ยง · ฉุกเฉิน) จาก `GET /students/:id/accommodation-plan` */
interface StudentContactInfo {
  accommodation: {
    formatted_address?: string | null;
    phone?: string | null;
    mobile_phone?: string | null;
    latitude?: string | number | null;
    longitude?: string | number | null;
  } | null;
  company_job_info: {
    company_name?: string | null;
    mentor_name?: string | null;
    mentor_phone?: string | null;
  } | null;
  emergency_contact: { name?: string | null; relationship?: string | null; phone?: string | null };
}

interface AdvisorStudentsProps {
  currentRole?: string;
}

const AdvisorStudents: React.FC<AdvisorStudentsProps> = ({ currentRole: propRole }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useContext(AuthContext);
  const currentUserId = auth?.user?.userId;

  // Determine current view: prop -> searchParams 'role' -> 'advisor'
  const currentRole = propRole || searchParams.get('role') || 'advisor';
  const isSupervisorView = currentRole === 'supervisor';

  // Scope: 'mine' (default) vs 'major'
  const scope = searchParams.get('scope') === 'major' ? 'major' : 'mine';
  const tabParam = searchParams.get('tab');
  const activeTab: 'weekly' | 'monthly' | 'daily' =
    tabParam === 'monthly' ? 'monthly' : tabParam === 'daily' ? 'daily' : 'weekly';

  const [intents, setIntents] = useState<IntentForm[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [supervisorScores, setSupervisorScores] = useState<SupervisorScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search filter
  const [searchText, setSearchText] = useState('');

  // Intent Modal
  const [selectedIntentId, setSelectedIntentId] = useState<number | null>(null);
  const [viewingForms, setViewingForms] = useState(false);
  // สถานะ/ปัญหาของทุกคนในสาขา (เซิร์ฟเวอร์จัดชั้นให้ — ดู utils/studentAttention) และข้อมูลติดต่อของคนที่เปิดอยู่
  const [board, setBoard] = useState<Map<number, StatusBoardStudent>>(new Map());
  // เก็บคู่กับ student_id — เปลี่ยนคนแล้วผลของคนก่อนหน้าต้องไม่โผล่ค้าง
  const [contactState, setContactState] = useState<{
    id: number;
    data?: StudentContactInfo;
    error?: string;
  } | null>(null);

  // Panel data state for selected student
  const studentIdParam = searchParams.get('student');
  const selectedStudentId = studentIdParam ? parseInt(studentIdParam, 10) : null;

  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [weeklyLogs, setWeeklyLogs] = useState<WeeklyLogItem[]>([]);
  const [monthlyLogs, setMonthlyLogs] = useState<MonthlyLogItem[]>([]);
  const [dailyData, setDailyData] = useState<DailyLogResponse | null>(null);

  const loadData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const [intentsRes, studentsRes, scoresRes, boardRes] = await Promise.all([
        api.get('/intents'),
        api.get('/students'),
        // คะแนนสหกิจ 15 · 16 — ฝ่ายนิเทศเท่านั้น ฝ่ายที่ปรึกษาไม่ยิง endpoint นี้
        isSupervisorView ? api.get('/coop-progress/dashboard?view=supervisor') : null,
        api.get('/students/status-board'),
      ]);
      setBoard(new Map(((boardRes as StatusBoardPayload).students || []).map((s) => [s.student_id, s])));
      setIntents(intentsRes || []);
      setStudents(studentsRes || []);
      setSupervisorScores(scoresRes?.data ?? []);
    } catch (err) {
      console.error('Failed to load students data:', err);
      if (!isBackground) setError(getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลรายชื่อนักศึกษาได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [isSupervisorView]);

  useDashboardData(loadData, [isSupervisorView]);

  // Fetch panel details when selectedStudentId or activeTab changes
  React.useEffect(() => {
    if (!selectedStudentId) return;

    let cancelled = false;

    const run = async () => {
      try {
        if (activeTab === 'weekly') {
          const res = await api.get(`/weekly-logs/student/${selectedStudentId}`);
          if (!cancelled) setWeeklyLogs(res?.data || []);
        } else if (activeTab === 'monthly') {
          const res = await api.get(`/monthly-logs/student/${selectedStudentId}`);
          if (!cancelled) setMonthlyLogs(res?.data || []);
        } else if (activeTab === 'daily') {
          const res = await api.get(`/daily-logs/student/${selectedStudentId}`);
          if (!cancelled) setDailyData(res || null);
        }
        if (!cancelled) {
          setPanelError(null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const errorObj = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
        if (errorObj?.response?.status === 403) {
          setPanelError(errorObj.response.data?.message || 'คุณไม่ได้เป็นที่ปรึกษาหรือผู้นิเทศของนักศึกษาคนนี้ (403)');
        } else {
          setPanelError(errorObj?.response?.data?.message || errorObj?.message || 'ไม่สามารถโหลดข้อมูลของนักศึกษาได้');
        }
      } finally {
        if (!cancelled) {
          setPanelLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [selectedStudentId, activeTab]);

  // ข้อมูลติดต่อ (ที่พัก · พี่เลี้ยง · ฉุกเฉิน) ของคนที่เปิดอยู่ — 403 ขึ้นเป็นข้อความ ไม่ใช่การ์ดว่าง
  React.useEffect(() => {
    if (!selectedStudentId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/students/${selectedStudentId}/accommodation-plan`);
        if (!cancelled) setContactState({ id: selectedStudentId, data });
      } catch (err) {
        if (!cancelled) {
          setContactState({ id: selectedStudentId, error: getErrorMessage(err, 'ไม่สามารถโหลดข้อมูลติดต่อได้') });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedStudentId]);

  if (loading) {
    return <PageSkeleton variant={skeletonFor('advisor', 'students')} />;
  }

  // Determine list for current scope
  // "ที่ฉันดูแล": advisor view = advisor_id === currentUserId; supervisor view = supervisor_id === currentUserId
  const mineStudents = students.filter(s => {
    if (isSupervisorView) return s.supervisor_id === currentUserId;
    return s.advisor_id === currentUserId;
  });

  const currentScopeList = scope === 'mine' ? mineStudents : students;

  // Filter based on search input
  const filteredStudents = currentScopeList.filter(student => {
    const fullName = `${student.first_name || ''} ${student.last_name || ''}`.toLowerCase();
    const studentCode = (student.student_code || '').toLowerCase();
    const company = (student.company_name || '').toLowerCase();
    const search = searchText.toLowerCase().trim();
    if (!search) return true;
    return fullName.includes(search) || studentCode.includes(search) || company.includes(search);
  }).sort(
    // ต้องรีบขึ้นก่อน — ลำดับในชั้นเดียวกันคงตามรหัสนักศึกษาที่เซิร์ฟเวอร์เรียงมาให้ (sort เสถียร)
    (a, b) =>
      TIER_ORDER.indexOf(board.get(a.student_id)?.tier ?? 'ontrack') -
      TIER_ORDER.indexOf(board.get(b.student_id)?.tier ?? 'ontrack')
  );

  const selectedStudent = students.find(s => s.student_id === selectedStudentId) || null;
  const selectedBoard = selectedStudent ? board.get(selectedStudent.student_id) ?? null : null;
  const contactInfo = contactState && contactState.id === selectedStudentId ? contactState : null;
  const contactData = contactInfo?.data ?? null;
  const pin = contactData?.accommodation;
  const mapsLink =
    pin && pin.latitude != null && pin.longitude != null &&
    Number.isFinite(Number(pin.latitude)) && Number.isFinite(Number(pin.longitude))
      ? `https://maps.google.com/?q=${Number(pin.latitude)},${Number(pin.longitude)}`
      : null;
  const selectedStudentIntent = selectedStudent ? intents.find(i => i.student_id === selectedStudent.student_id) : null;

  const handleSelectStudent = (s: StudentRow) => {
    if (s.student_id !== selectedStudentId) {
      setPanelLoading(true);
      setPanelError(null);
      setWeeklyLogs([]);
      setMonthlyLogs([]);
      setDailyData(null);
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('student', s.student_id.toString());
      if (!next.has('tab')) next.set('tab', 'weekly');
      return next;
    });
  };

  const handleClosePanel = () => {
    setWeeklyLogs([]);
    setMonthlyLogs([]);
    setDailyData(null);
    setPanelError(null);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('student');
      next.delete('tab');
      return next;
    });
  };

  const handleScopeChange = (newScope: 'mine' | 'major') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (newScope === 'mine') next.delete('scope');
      else next.set('scope', 'major');
      return next;
    });
  };

  const handleTabChange = (newTab: 'weekly' | 'monthly' | 'daily') => {
    if (newTab !== activeTab) {
      setPanelLoading(true);
      setPanelError(null);
    }
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', newTab);
      return next;
    });
  };

  return (
    <div className="space-y-5 page-enter">
      {/* Header section matching AdvisorStudents.dc.html */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          {isSupervisorView ? 'นักศึกษาที่ฉันนิเทศ' : 'นักศึกษาในสาขา'}
        </h1>
        <p className="text-[13px] leading-relaxed text-gray-600 dark:text-gray-400 m-0">
          เทคโนโลยีสารสนเทศและนวัตกรรมดิจิทัล · รายชื่อนักศึกษาในสาขาวิชา · ตั้งต้นที่ “เฉพาะที่ฉันดูแล” — รายชื่อทั้งสาขาเปิดดูได้ แต่บันทึกของนักศึกษาเปิดได้เฉพาะคนที่คุณเป็นที่ปรึกษาหรือผู้นิเทศ
        </p>
      </div>

      <AlertBanner variant="error" message={error} />

      {/* Main Layout: 2 Columns when student is selected */}
      <div className="flex gap-5 items-start flex-col xl:flex-row">
        {/* รายชื่อ — เปิดรายคนแล้วรายชื่อหลบ หน้านักศึกษากว้างเต็ม (แบบ B · URL `?student=`) */}
        {!selectedStudent && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden flex flex-col flex-grow min-w-0 w-full">
          {/* Top Bar with Scope Pill Switcher and Search */}
          <div className="p-4 sm:p-5 flex flex-wrap items-center gap-3 border-b border-gray-100 dark:border-gray-800">
            {/* Scope Pill Toggle */}
            <div
              data-testid="advisor-students-scope"
              data-scope={scope}
              className="inline-flex gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl border border-gray-200/60 dark:border-gray-700/60 shrink-0"
            >
              <button
                type="button"
                onClick={() => handleScopeChange('mine')}
                className={`px-3 py-1.5 rounded-[9px] text-[13px] font-sans transition-all cursor-pointer border-none ${
                  scope === 'mine'
                    ? 'bg-white dark:bg-gray-700 font-bold text-[#1E3A8A] dark:text-blue-300 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.08)]'
                    : 'bg-transparent font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {isSupervisorView ? `เฉพาะที่ฉันนิเทศ (${mineStudents.length})` : `เฉพาะที่ฉันดูแล (${mineStudents.length})`}
              </button>
              <button
                type="button"
                onClick={() => handleScopeChange('major')}
                className={`px-3 py-1.5 rounded-[9px] text-[13px] font-sans transition-all cursor-pointer border-none ${
                  scope === 'major'
                    ? 'bg-white dark:bg-gray-700 font-bold text-[#1E3A8A] dark:text-blue-300 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.08)]'
                    : 'bg-transparent font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                ทั้งสาขา ({students.length})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative flex-grow min-w-[220px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="ค้นหาชื่อ รหัส หรือสถานประกอบการ"
                className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-[#F9FAFB] dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
                  <th className="py-3 px-4 font-bold text-gray-600 dark:text-gray-300">นักศึกษา</th>
                  <th className="py-3 px-4 font-bold text-gray-600 dark:text-gray-300">สถานประกอบการ</th>
                  <th className="py-3 px-4 font-bold text-gray-600 dark:text-gray-300">ขั้นตอนตอนนี้</th>
                  <th className="py-3 px-4 font-bold text-gray-600 dark:text-gray-300">คุณเป็น</th>
                  {isSupervisorView && (
                    <>
                      <th className="py-3 px-4 font-bold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        สหกิจ 15 (เต็ม 100)
                      </th>
                      <th className="py-3 px-4 font-bold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                        สหกิจ 16 (เต็ม 70)
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredStudents.length > 0 ? (
                  filteredStudents.map((student) => {
                    const studentIntent = intents.find(i => i.student_id === student.student_id);
                    const isSelected = selectedStudentId === student.student_id;

                    const isAdvisor = student.advisor_id === currentUserId;
                    const isSupervisor = student.supervisor_id === currentUserId;
                    const scoreRow = supervisorScores.find((s) => s.studentId === student.student_id);
                    // ไม่มีแถวคะแนน = ไม่ใช่นักศึกษาที่ฉันนิเทศ (ขอบเขต "ทั้งสาขา") — ห้ามขึ้น "ยังไม่ประเมิน"
                    // ซึ่งหมายถึงพี่เลี้ยงยังไม่ส่ง
                    const scoreText = (score: number | null) =>
                      !scoreRow ? '–' : score === null ? 'ยังไม่ประเมิน' : String(score);

                    const companyDisplay = student.company_name || studentIntent?.company_name_th;
                    const provinceDisplay = student.company_province;

                    return (
                      <tr
                        key={student.student_id}
                        data-testid={`advisor-student-row-${student.student_id}`}
                        onClick={() => handleSelectStudent(student)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#EFF6FF] dark:bg-blue-950/30'
                            : 'hover:bg-gray-50/70 dark:hover:bg-gray-800/40'
                        }`}
                      >
                        {/* Student Column */}
                        <td className="py-3.5 px-4 align-top">
                          <StudentAvatar
                            firstName={student.first_name}
                            lastName={student.last_name}
                            image={board.get(student.student_id)?.profile_image}
                            size={36}
                          />
                          <span className="mt-1.5 block text-[14px] font-bold text-gray-900 dark:text-white">
                            {student.first_name ? `${student.first_name} ${student.last_name}` : 'ไม่ระบุชื่อ'}
                          </span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                            {student.student_code}
                          </span>
                          {/* Quick action button to satisfy phase3-workflow E2E test */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectStudent(student);
                            }}
                            className="mt-1.5 text-xs text-brand-blue dark:text-blue-400 font-bold hover:underline flex items-center gap-1"
                          >
                            ดูบันทึกรายสัปดาห์ (Weekly Log) <Calendar className="h-3 w-3" />
                          </button>
                        </td>

                        {/* Company Column */}
                        <td className="py-3.5 px-4 align-top">
                          {companyDisplay ? (
                            <>
                              <span className="block font-semibold text-gray-800 dark:text-gray-200">
                                {companyDisplay}
                              </span>
                              {provinceDisplay && (
                                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                  {provinceDisplay.startsWith('จ.') ? provinceDisplay : `จ.${provinceDisplay}`}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400 text-xs">ยังไม่ได้ยื่นใบความจำนง</span>
                          )}
                        </td>

                        {/* Status Column */}
                        <td className="py-3.5 px-4 align-top">
                          {(board.get(student.student_id)?.issues ?? []).length > 0 && (
                            <div className="mb-1.5 flex flex-wrap gap-1">
                              {board.get(student.student_id)!.issues.map((i) => (
                                <span
                                  key={i.code}
                                  className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                                    isUrgentIssue(i)
                                      ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                                      : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                                  }`}
                                >
                                  {issueText(i)}
                                </span>
                              ))}
                            </div>
                          )}
                          {studentIntent?.status === 'accepted' ? (
                            <div>
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0] dark:bg-green-950/40 dark:text-green-300 dark:border-green-800">
                                ปฏิบัติงานอยู่
                              </span>
                              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {studentIntent.company_name_th || 'เริ่มปฏิบัติงานแล้ว'}
                              </span>
                            </div>
                          ) : studentIntent ? (
                            <div>
                              <StatusBadge
                                status={intentDisplayStatus(studentIntent.status, studentIntent.cover_letter_status)}
                                domain="intent"
                              />
                            </div>
                          ) : (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                              ยังไม่มีที่ฝึก
                            </span>
                          )}
                        </td>

                        {/* You Are Column */}
                        <td className="py-3.5 px-4 align-top">
                          {isAdvisor && isSupervisor ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EFF6FF] text-[#1E3A8A] border border-[#BFDBFE] dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 whitespace-nowrap">
                              ที่ปรึกษา &amp; นิเทศ
                            </span>
                          ) : isAdvisor ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EFF6FF] text-[#1E3A8A] border border-[#BFDBFE] dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 whitespace-nowrap">
                              ที่ปรึกษา
                            </span>
                          ) : isSupervisor ? (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 whitespace-nowrap">
                              นิเทศ
                            </span>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400 font-bold">–</span>
                          )}
                        </td>

                        {/* Supervisor Evaluation Scores */}
                        {isSupervisorView && (
                          <>
                            <td className="py-3.5 px-4 align-top whitespace-nowrap">
                              <span
                                data-testid={`sup-score15-${student.student_id}`}
                                className="font-medium text-gray-800 dark:text-gray-200"
                              >
                                {scoreText(scoreRow?.sahatkit15Score ?? null)}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 align-top whitespace-nowrap">
                              <span
                                data-testid={`sup-score16-${student.student_id}`}
                                className="font-medium text-gray-800 dark:text-gray-200"
                              >
                                {scoreText(scoreRow?.sahatkit16Score ?? null)}
                              </span>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={isSupervisorView ? 6 : 4} className="py-10 text-center text-gray-500 dark:text-gray-400 text-xs">
                      {error ? 'เกิดข้อผิดพลาดในการโหลดข้อมูลรายชื่อนักศึกษา' : 'ไม่พบข้อมูลนักศึกษาที่ตรงตามเงื่อนไข'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="py-3 px-5 border-t border-gray-100 dark:border-gray-800 text-[13px] text-gray-500 dark:text-gray-400">
            {isSupervisorView && (
              <p
                data-testid="sup-score-note"
                className="text-xs text-gray-500 dark:text-gray-400 mb-1"
              >
                ระบบไม่ตัดเกรด คะแนนนี้ใช้ประกอบการตัดเกรดของท่าน
              </p>
            )}
            <div>
              แสดง {filteredStudents.length} จาก {currentScopeList.length} คน · ไม่มีคอลัมน์เกรด — เกรดดูได้ในรายละเอียดใบความจำนง
            </div>
          </div>
        </div>
        )}

        {/* หน้านักศึกษารายคน */}
        {selectedStudent && (
          <div
            data-testid="advisor-student-panel"
            className="w-full min-w-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden flex flex-col"
          >
            {/* Panel Top Header */}
            <div className="p-5 pb-0 flex flex-col gap-4">
              <div>
                <button
                  type="button"
                  data-testid="advisor-student-back"
                  onClick={handleClosePanel}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-blue hover:underline dark:text-blue-400"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> กลับรายชื่อ
                </button>
              </div>

              {/* หัวหน้านักศึกษา — รูป · ชื่อ · สถานะ · ปุ่มเอกสาร */}
              <div className="flex flex-wrap items-start gap-4">
                <StudentAvatar
                  firstName={selectedStudent.first_name}
                  lastName={selectedStudent.last_name}
                  image={selectedBoard?.profile_image}
                  size={84}
                  portrait
                />
                <div className="min-w-0 flex-[1_1_240px]">
                  <h3 className="break-words text-xl font-extrabold text-gray-900 dark:text-white">
                    {selectedStudent.first_name ? `${selectedStudent.first_name} ${selectedStudent.last_name}` : 'ไม่ระบุชื่อ'}
                  </h3>
                  <p className="mt-0.5 break-words text-[13px] text-gray-700 dark:text-gray-300">
                    {selectedStudent.student_code}
                    {selectedStudent.major_name_th ? ` · ${selectedStudent.major_name_th}` : ''}
                    {selectedStudent.cumulative_gpa != null && selectedStudent.cumulative_gpa !== ''
                      ? ` · เกรด ${selectedStudent.cumulative_gpa}`
                      : ''}
                  </p>
                  {selectedBoard && (
                    <div data-testid="advisor-student-status" data-tier={selectedBoard.tier} className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-xs font-bold text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
                        {TIER_LABEL[selectedBoard.tier]} · {STEP_LABEL[selectedBoard.step]}
                      </span>
                      {selectedBoard.issues.map((i) => (
                        <span
                          key={i.code}
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                            isUrgentIssue(i)
                              ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200'
                              : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                          }`}
                        >
                          {issueText(i)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="advisor-student-view-forms"
                    onClick={() => setViewingForms(true)}
                    className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    สหกิจ 03 · 06
                  </button>
                  {selectedStudentIntent && (
                    <button
                      type="button"
                      onClick={() => setSelectedIntentId(selectedStudentIntent.form_id)}
                      className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      ใบความจำนง
                    </button>
                  )}
                </div>
              </div>

              {/* เส้นสถานะ — ถึงขั้นไหนแล้ว */}
              {selectedBoard && selectedBoard.step !== 'rejected' && selectedBoard.step !== 'other' && selectedBoard.step !== 'no_request' && (
                <ol data-testid="advisor-student-steps" className="flex flex-wrap gap-1.5 text-xs">
                  {STEP_LINE.map((st, idx) => {
                    const currentIdx = STEP_LINE.findIndex((x) => x.key === selectedBoard.step);
                    const state = idx < currentIdx ? 'past' : idx === currentIdx ? 'now' : 'next';
                    return (
                      <li
                        key={st.key}
                        data-state={state}
                        className={`rounded-full border px-2.5 py-1 ${
                          state === 'now'
                            ? 'border-blue-600 bg-blue-600 font-bold text-white dark:border-blue-500 dark:bg-blue-600'
                            : state === 'past'
                              ? 'border-green-300 bg-green-50 font-medium text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200'
                              : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                        }`}
                      >
                        {st.label}
                      </li>
                    );
                  })}
                </ol>
              )}

              {/* ข้อมูลติดต่อ — ที่อาจารย์ต้องใช้ตอนเดินทางไปนิเทศ */}
              {contactInfo?.error ? (
                <AlertBanner variant="warning" message={contactInfo.error} />
              ) : (
                <div data-testid="advisor-student-contact" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    {
                      title: 'ติดต่อนักศึกษา',
                      lines: [
                        contactData?.accommodation?.mobile_phone || selectedStudent.phone || null,
                      ],
                    },
                    {
                      title: 'สถานประกอบการและพี่เลี้ยง',
                      lines: [
                        contactData?.company_job_info?.company_name || selectedStudent.company_name || null,
                        contactData?.company_job_info?.mentor_name
                          ? `${contactData.company_job_info.mentor_name}${contactData.company_job_info.mentor_phone ? ` · ${contactData.company_job_info.mentor_phone}` : ''}`
                          : null,
                      ],
                    },
                    {
                      title: 'ที่พัก',
                      lines: [
                        contactData?.accommodation?.formatted_address || null,
                        contactData?.accommodation?.phone || null,
                      ],
                      link: mapsLink,
                    },
                    {
                      title: 'ผู้ติดต่อฉุกเฉิน',
                      lines: [
                        contactData?.emergency_contact?.name
                          ? `${contactData.emergency_contact.name}${contactData.emergency_contact.relationship ? ` (${contactData.emergency_contact.relationship})` : ''}`
                          : null,
                        contactData?.emergency_contact?.phone || null,
                      ],
                    },
                  ].map((card) => {
                    const filled = card.lines.filter((l): l is string => Boolean(l));
                    return (
                      <div
                        key={card.title}
                        className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60"
                      >
                        <div className="text-xs font-medium text-gray-600 dark:text-gray-400">{card.title}</div>
                        {!contactInfo ? (
                          <div className="mt-1 text-[13px] text-gray-600 dark:text-gray-400">กำลังโหลด...</div>
                        ) : filled.length === 0 ? (
                          <div className="mt-1 text-[13px] text-gray-600 dark:text-gray-400">ยังไม่ได้กรอก</div>
                        ) : (
                          filled.map((l) => (
                            <div key={l} className="mt-1 break-words text-[13px] font-semibold text-gray-900 dark:text-gray-100">
                              {l}
                            </div>
                          ))
                        )}
                        {'link' in card && card.link && (
                          <a
                            href={card.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="advisor-student-maps"
                            className="mt-1.5 inline-block text-[13px] font-bold text-brand-blue underline hover:no-underline dark:text-blue-400"
                          >
                            เปิดแผนที่
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 4 Tabs matching AdvisorStudents.dc.html */}
              <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto text-[14px]">
                <button
                  type="button"
                  data-testid="advisor-student-tab-weekly"
                  onClick={() => handleTabChange('weekly')}
                  className={`pb-2.5 px-3 border-b-2 font-sans cursor-pointer transition-colors whitespace-nowrap ${
                    activeTab === 'weekly'
                      ? 'border-[#2563EB] text-[#1E3A8A] dark:text-blue-400 font-bold'
                      : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  รายสัปดาห์ (09)
                </button>
                <button
                  type="button"
                  data-testid="advisor-student-tab-monthly"
                  onClick={() => handleTabChange('monthly')}
                  className={`pb-2.5 px-3 border-b-2 font-sans cursor-pointer transition-colors whitespace-nowrap ${
                    activeTab === 'monthly'
                      ? 'border-[#2563EB] text-[#1E3A8A] dark:text-blue-400 font-bold'
                      : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  รายเดือน (10)
                </button>
                <button
                  type="button"
                  data-testid="advisor-student-tab-daily"
                  onClick={() => handleTabChange('daily')}
                  className={`pb-2.5 px-3 border-b-2 font-sans cursor-pointer transition-colors whitespace-nowrap ${
                    activeTab === 'daily'
                      ? 'border-[#2563EB] text-[#1E3A8A] dark:text-blue-400 font-bold'
                      : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  รายวัน (08)
                </button>
              </div>
            </div>

            {/* Panel Tab Content */}
            <div className="p-4 sm:p-5 flex flex-col gap-3 min-h-[300px]">
              {panelLoading ? (
                <div className="py-12 text-center text-xs text-gray-500 dark:text-gray-400">
                  กำลังโหลดข้อมูล...
                </div>
              ) : panelError ? (
                /* Error state matching AdvisorStudents.dc.html lines 196-200 */
                <div className="p-5 flex flex-col gap-2 items-center text-center rounded-2xl border border-red-200 bg-[#FEF2F2] dark:bg-red-950/20 dark:border-red-900/50">
                  <span className="self-start text-xs font-bold text-red-700 bg-red-100 border border-red-300 rounded px-2 py-0.5">
                    โหมด “ทั้งสาขา” · คนที่ไม่ใช่ของคุณ
                  </span>
                  <div className="flex items-center gap-1.5 text-red-900 dark:text-red-300 font-bold text-base mt-2">
                    <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
                    คุณไม่ได้เป็นที่ปรึกษาหรือผู้นิเทศของนักศึกษาคนนี้
                  </div>
                  <p className="text-xs text-red-700 dark:text-red-400 m-0">
                    {panelError}
                  </p>
                </div>
              ) : activeTab === 'weekly' ? (
                /* Tab 1: Weekly Logs */
                <div className="space-y-3">
                  <div className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    บันทึกการปฏิบัติงานรายสัปดาห์ (Weekly Log)
                  </div>
                  {weeklyLogs.length > 0 ? (
                    weeklyLogs.map((item) => {
                      const isCertified = Boolean(item.mentor_certified_at);
                      const isReturned = item.status === 'returned';

                      return (
                        <div
                          key={item.weekly_log_id}
                          className={`p-3.5 rounded-xl border transition-all ${
                            isCertified
                              ? 'border-[#BFDBFE] bg-[#F8FAFF] dark:bg-blue-950/20 dark:border-blue-900/40'
                              : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/60'
                          }`}
                        >
                          <div className="flex justify-between items-center mb-2">
                            <div>
                              <span className="font-bold text-sm text-gray-900 dark:text-white">
                                สัปดาห์ที่ {item.week_number}
                              </span>
                              {item.start_date && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                                  {item.start_date} – {item.end_date || ''}
                                </span>
                              )}
                            </div>
                            {isCertified ? (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0] dark:bg-green-950/40 dark:text-green-300 dark:border-green-800">
                                พี่เลี้ยงรับรองแล้ว
                              </span>
                            ) : isReturned ? (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA] dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                                ส่งกลับแก้
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                ส่งแล้ว · รอพี่เลี้ยงรับรอง
                              </span>
                            )}
                          </div>

                          {(item.assigned_work || item.achievements) && (
                            <div className="text-xs leading-relaxed text-gray-700 dark:text-gray-300 space-y-1 mt-1 border-t border-gray-100 dark:border-gray-700/60 pt-2">
                              <p>
                                <strong>งานที่ได้รับมอบหมาย:</strong> {item.assigned_work || item.achievements}
                              </p>
                              {item.problems && (
                                <p>
                                  <strong>ปัญหา/อุปสรรค:</strong> {item.problems}
                                </p>
                              )}
                              {item.returned_comment && (
                                <p className="text-red-600 dark:text-red-400">
                                  <strong>ความเห็นการส่งกลับ:</strong> {item.returned_comment}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-10 text-center text-xs text-gray-500 dark:text-gray-400">
                      ยังไม่มีการส่งบันทึกรายสัปดาห์
                    </div>
                  )}
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">
                    อ่านอย่างเดียว · การรับรองรายงานเป็นของพนักงานที่ปรึกษา (ท้ายแบบ สหกิจ 08/09/10)
                  </p>
                </div>
              ) : activeTab === 'monthly' ? (
                /* Tab 2: Monthly Logs */
                <div className="space-y-3">
                  <div className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    รายงานผลการปฏิบัติงานรายเดือน (สหกิจ 10)
                  </div>
                  {monthlyLogs.length > 0 ? (
                    monthlyLogs.map((item) => {
                      const isCertified = Boolean(item.mentor_certified_at);
                      return (
                        <div
                          key={item.monthly_log_id}
                          className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/60"
                        >
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-bold text-sm text-gray-900 dark:text-white">
                              งวดเดือนที่ {item.month} / {item.year}
                            </span>
                            {isCertified ? (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0] dark:bg-green-950/40 dark:text-green-300 dark:border-green-800">
                                พี่เลี้ยงรับรองแล้ว
                              </span>
                            ) : item.status === 'returned' ? (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA] dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                                ส่งกลับแก้
                              </span>
                            ) : (
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                รอพี่เลี้ยงรับรอง
                              </span>
                            )}
                          </div>
                          {item.work_summary && (
                            <div className="text-xs leading-relaxed text-gray-700 dark:text-gray-300 space-y-1 mt-1 border-t border-gray-100 dark:border-gray-700/60 pt-2">
                              <p>
                                <strong>สรุปผลการปฏิบัติงาน:</strong> {item.work_summary}
                              </p>
                              {item.effectiveness && (
                                <p>
                                  <strong>ประสิทธิผล:</strong> {item.effectiveness}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-10 text-center text-xs text-gray-500 dark:text-gray-400">
                      ยังไม่มีการส่งบันทึกรายเดือน
                    </div>
                  )}
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">
                    อ่านอย่างเดียว · การรับรองรายงานเป็นของพนักงานที่ปรึกษา
                  </p>
                </div>
              ) : (
                /* Tab 3: Daily Logs */
                <div className="space-y-3">
                  {dailyData?.intent && dailyData.intent.daily_log_required === false ? (
                    /* Disabled by mentor per AdvisorStudents.dc.html lines 191-195 */
                    <div className="p-5 flex flex-col gap-2 items-center text-center rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40">
                      <span className="self-start text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-0.5">
                        แท็บ “รายวัน (08)” ว่าง
                      </span>
                      <h4 className="text-base font-bold text-gray-900 dark:text-white mt-1">
                        พนักงานที่ปรึกษายังไม่ได้เปิดใช้รายงานประจำวัน
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 m-0">
                        คู่มือไม่บังคับ สหกิจ 08 ทุกคน — พี่เลี้ยงเป็นคนเปิดสวิตช์ตามลักษณะงาน
                      </p>
                    </div>
                  ) : dailyData?.weeks && dailyData.weeks.length > 0 ? (
                    dailyData.weeks.map((w) => (
                      <div key={w.week_number} className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/60 space-y-2">
                        <span className="font-bold text-sm text-gray-900 dark:text-white block">
                          สัปดาห์ที่ {w.week_number}
                        </span>
                        <div className="space-y-1.5 divide-y divide-gray-100 dark:divide-gray-700">
                          {w.logs.map((d) => (
                            <div key={d.daily_log_id} className="pt-1.5 text-xs text-gray-700 dark:text-gray-300">
                              <span className="font-semibold text-gray-900 dark:text-white">{d.log_date}:</span>{' '}
                              {d.work_detail || 'ไม่มีบันทึกรายละเอียด'}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="py-10 text-center text-xs text-gray-500 dark:text-gray-400">
                      เปิดใช้รายงานประจำวันแล้ว แต่ยังไม่มีการบันทึกข้อมูล
                    </div>
                  )}
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">
                    อ่านอย่างเดียว · การรับรองรายงานเป็นของพนักงานที่ปรึกษา
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {viewingForms && selectedStudent && (
        <CoopFormsViewModal
          // key: เปลี่ยนนักศึกษาแล้วต้องเริ่มโหลดใหม่ ไม่ใช่โชว์ข้อมูลของคนก่อนหน้า
          key={selectedStudent.student_id}
          studentId={selectedStudent.student_id}
          studentName={[selectedStudent.first_name, selectedStudent.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ'}
          studentCode={selectedStudent.student_code}
          onClose={() => setViewingForms(false)}
        />
      )}

      {/* Intent Review Modal */}
      <IntentReviewModal
        intentId={selectedIntentId}
        onClose={() => setSelectedIntentId(null)}
      />
    </div>
  );
};

export default AdvisorStudents;
