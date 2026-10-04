import React, { useState, useCallback, useContext } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import { useDashboardData } from '../../hooks/useDashboardData';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import type { IntentForm, StudentRow } from '../../types/api';
import { Search, Calendar, Check, AlertCircle } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { intentDisplayStatus } from '../../utils/intentStatus';
import IntentReviewModal from '../../components/IntentReviewModal';

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

interface WorkPlanTopic {
  topic_id: number;
  seq: number;
  topic: string;
  months: number[];
}

interface WorkPlanData {
  student: {
    student_id: number;
    student_code: string;
    full_name: string;
    company_name?: string | null;
  };
  months: Array<{ index: number; year: number; month: number; name?: string }>;
  topics: WorkPlanTopic[];
  weekly: Array<{ week_number: number; tasks?: string | null }>;
  student_signed_at?: string | null;
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
  const activeTab = searchParams.get('tab') || 'weekly';

  const [intents, setIntents] = useState<IntentForm[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search filter
  const [searchText, setSearchText] = useState('');

  // Intent Modal
  const [selectedIntentId, setSelectedIntentId] = useState<number | null>(null);

  // Panel data state for selected student
  const studentIdParam = searchParams.get('student');
  const selectedStudentId = studentIdParam ? parseInt(studentIdParam, 10) : null;

  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [weeklyLogs, setWeeklyLogs] = useState<WeeklyLogItem[]>([]);
  const [monthlyLogs, setMonthlyLogs] = useState<MonthlyLogItem[]>([]);
  const [dailyData, setDailyData] = useState<DailyLogResponse | null>(null);
  const [workPlan, setWorkPlan] = useState<WorkPlanData | null>(null);

  const loadData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      setError(null);
      const [intentsRes, studentsRes] = await Promise.all([
        api.get('/intents'),
        api.get('/students'),
      ]);
      setIntents(intentsRes || []);
      setStudents(studentsRes || []);
    } catch (err) {
      console.error('Failed to load students data:', err);
      if (!isBackground) setError('ไม่สามารถโหลดข้อมูลรายชื่อนักศึกษาได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useDashboardData(loadData, []);

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
        } else if (activeTab === 'plan') {
          const res = await api.get(`/students/${selectedStudentId}/work-plan`);
          if (!cancelled) setWorkPlan(res || null);
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
  });

  const selectedStudent = students.find(s => s.student_id === selectedStudentId) || null;
  const selectedStudentIntent = selectedStudent ? intents.find(i => i.student_id === selectedStudent.student_id) : null;

  const handleSelectStudent = (s: StudentRow) => {
    if (s.student_id !== selectedStudentId) {
      setPanelLoading(true);
      setPanelError(null);
      setWeeklyLogs([]);
      setMonthlyLogs([]);
      setDailyData(null);
      setWorkPlan(null);
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
    setWorkPlan(null);
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

  const handleTabChange = (newTab: string) => {
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
        {/* Left Column: Student Table Card */}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredStudents.length > 0 ? (
                  filteredStudents.map((student) => {
                    const studentIntent = intents.find(i => i.student_id === student.student_id);
                    const isSelected = selectedStudentId === student.student_id;

                    const isAdvisor = student.advisor_id === currentUserId;
                    const isSupervisor = student.supervisor_id === currentUserId;

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
                          <span className="block text-[14px] font-bold text-gray-900 dark:text-white">
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
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
                                {intentDisplayStatus(studentIntent.status, studentIntent.cover_letter_status)}
                              </span>
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
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-gray-500 dark:text-gray-400 text-xs">
                      ไม่พบข้อมูลนักศึกษาที่ตรงตามเงื่อนไข
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="py-3 px-5 border-t border-gray-100 dark:border-gray-800 text-[13px] text-gray-500 dark:text-gray-400">
            แสดง {filteredStudents.length} จาก {currentScopeList.length} คน · ไม่มีคอลัมน์เกรด — เกรดดูได้ในรายละเอียดใบความจำนง
          </div>
        </div>

        {/* Right Column: Student Details Panel matching AdvisorStudents.dc.html */}
        {selectedStudent && (
          <div
            data-testid="advisor-student-panel"
            className="w-full xl:w-[470px] shrink-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden flex flex-col"
          >
            {/* Panel Top Header */}
            <div className="p-5 pb-0 flex flex-col gap-3">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <h3 className="text-[17px] font-bold text-gray-900 dark:text-white truncate">
                    {selectedStudent.first_name ? `${selectedStudent.first_name} ${selectedStudent.last_name}` : 'ไม่ระบุชื่อ'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    {selectedStudent.student_code}
                    {selectedStudentIntent?.company_contact_person
                      ? ` · พี่เลี้ยง: ${selectedStudentIntent.company_contact_person}`
                      : selectedStudent.major_name_th
                        ? ` · ${selectedStudent.major_name_th}`
                        : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {selectedStudentIntent && (
                    <button
                      type="button"
                      onClick={() => setSelectedIntentId(selectedStudentIntent.form_id)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    >
                      ใบความจำนง
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleClosePanel}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    ปิดหน้าต่าง
                  </button>
                </div>
              </div>

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
                <button
                  type="button"
                  data-testid="advisor-student-tab-plan"
                  onClick={() => handleTabChange('plan')}
                  className={`pb-2.5 px-3 border-b-2 font-sans cursor-pointer transition-colors whitespace-nowrap ${
                    activeTab === 'plan'
                      ? 'border-[#2563EB] text-[#1E3A8A] dark:text-blue-400 font-bold'
                      : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  แผนงาน (07)
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
              ) : activeTab === 'daily' ? (
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
              ) : (
                /* Tab 4: Work Plan (07 Page 3) */
                <div className="space-y-3">
                  <div className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    แผนปฏิบัติงานสหกิจศึกษา (สหกิจ 07 หน้า 3)
                  </div>
                  {workPlan?.topics && workPlan.topics.length > 0 ? (
                    <div className="space-y-3">
                      <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                            <tr>
                              <th className="py-2.5 px-3 text-center font-bold text-gray-600 dark:text-gray-300 w-8">#</th>
                              <th className="py-2.5 px-3 font-bold text-gray-600 dark:text-gray-300">หัวข้องาน</th>
                              {workPlan.months?.map((m) => (
                                <th key={m.index} className="py-2.5 px-2 text-center font-bold text-gray-600 dark:text-gray-300">
                                  {m.name || `เดือน ${m.index}`}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {workPlan.topics.map((t) => (
                              <tr key={t.seq} data-testid={`plan-topic-${t.seq}`} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                <td className="py-2.5 px-3 text-center font-bold text-gray-600 dark:text-gray-400">{t.seq}</td>
                                <td className="py-2.5 px-3 font-medium text-gray-800 dark:text-gray-200">{t.topic}</td>
                                {workPlan.months?.map((m) => {
                                  const isMarked = t.months.includes(m.index);
                                  return (
                                    <td key={m.index} data-testid={`plan-cell-${t.seq}-${m.index}`} className="py-2.5 px-2 text-center">
                                      {isMarked ? (
                                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-50 dark:bg-blue-950/40 text-brand-blue dark:text-blue-400">
                                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                                        </span>
                                      ) : (
                                        <span className="text-gray-300 dark:text-gray-400 font-bold">–</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Student confirmation status */}
                      {workPlan.student_signed_at && (
                        <div className="p-3 bg-green-50/50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 rounded-xl text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5">
                          <Check className="h-4 w-4 text-green-600 shrink-0" />
                          นักศึกษายืนยันแผนการปฏิบัติงานนี้เรียบร้อยแล้ว
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-10 text-center text-xs text-gray-500 dark:text-gray-400">
                      นักศึกษายังไม่ได้จัดทำแผนปฏิบัติงาน (สหกิจ 07 หน้า 3)
                    </div>
                  )}
                  <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">
                    อ่านอย่างเดียว · แผนงาน สหกิจ 07 หน้า 3 ลงนามโดยนักศึกษาและพนักงานที่ปรึกษา (ไม่มีปุ่มรับรอง)
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Intent Review Modal */}
      <IntentReviewModal
        intentId={selectedIntentId}
        onClose={() => setSelectedIntentId(null)}
      />
    </div>
  );
};

export default AdvisorStudents;
