import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  UploadCloud,
  Printer,
  Trash2,
  ExternalLink,
  Loader2,
  Send,
  Save,
} from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import EmptyState from '../../components/ui/EmptyState';
import CalendarGate, { useCalendarGate } from '../../components/ui/CalendarGate';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { getErrorMessage } from '../../utils/errors';

interface WeeklyLogItem {
  weekly_log_id: number;
  student_id: number;
  week_number: number;
  assigned_work: string | null;
  methods: string | null;
  tools_used: string | null;
  achievements: string | null;
  problems: string | null;
  status: 'draft' | 'submitted' | 'returned';
  start_date: string | null;
  end_date: string | null;
  external_file_path: string | null;
  summary: string | null;
  mentor_certified_by: number | null;
  mentor_certified_at: string | null;
  mentor_certified_name?: string | null;
  returned_comment: string | null;
  submitted_at: string | null;
}

interface MonthlyLogItem {
  monthly_log_id: number;
  student_id: number;
  year: number;
  month: number;
  work_summary: string | null;
  effectiveness: string | null;
  status: 'draft' | 'submitted' | 'returned';
  start_date: string | null;
  end_date: string | null;
  external_file_path: string | null;
  summary: string | null;
  mentor_certified_by: number | null;
  mentor_certified_at: string | null;
  mentor_certified_name?: string | null;
  returned_comment: string | null;
  submitted_at: string | null;
}

interface DailyLogDay {
  daily_log_id: number;
  log_date: string;
  work_detail: string | null;
  remark: string | null;
}

interface DailyLogWeek {
  week_number: number;
  status: 'draft' | 'submitted' | 'returned';
  returned_comment: string | null;
  mentor_certified_at: string | null;
  certified_by_name: string | null;
  days: DailyLogDay[];
}

interface DailyIntent {
  form_id: number;
  start_date: string | null;
  end_date: string | null;
  daily_log_required: boolean;
  mentor_id: number | null;
  mentor_name: string | null;
}

interface IntentData {
  form_id: number;
  start_date: string | null;
  end_date: string | null;
  uses_company_log_form: boolean;
  company_id: number;
  company_name_th: string;
  company_name_en: string | null;
  mentor_id: number | null;
  mentor_name: string | null;
}

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const WeeklyLog: React.FC = () => {
  const auth = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState<'weekly' | 'monthly' | 'daily'>('weekly');

  const [intent, setIntent] = useState<IntentData | null>(null);
  const [weeklyLogs, setWeeklyLogs] = useState<WeeklyLogItem[]>([]);
  const [monthlyLogs, setMonthlyLogs] = useState<MonthlyLogItem[]>([]);
  const [dailyIntent, setDailyIntent] = useState<DailyIntent | null>(null);
  const [dailyWeeks, setDailyWeeks] = useState<DailyLogWeek[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Calendar Gate state
  const { status: calendarStatus } = useCalendarGate('weekly_log');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Form State
  interface WeeklyFormFields {
    assigned_work: string;
    methods: string;
    tools_used: string;
    achievements: string;
    problems: string;
    summary: string;
  }

  interface MonthlyFormFields {
    work_summary: string;
    effectiveness: string;
    summary: string;
  }

  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [weeklyDrafts, setWeeklyDrafts] = useState<Record<number, WeeklyFormFields>>({});
  const [weeklyFile, setWeeklyFile] = useState<File | null>(null);

  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(0);
  const [monthlyDrafts, setMonthlyDrafts] = useState<Record<string, MonthlyFormFields>>({});
  const [monthlyFile, setMonthlyFile] = useState<File | null>(null);

  // Daily log (สหกิจ 08) — key เป็น `${week_number}:${log_date}` เก็บค่าที่กำลังพิมพ์
  const [dailyDrafts, setDailyDrafts] = useState<Record<string, string>>({});
  // แก้สัปดาห์ที่พี่เลี้ยงรับรองแล้ว = ล้างการรับรองทั้งสัปดาห์ทิ้ง — เตือนก่อนเสมอ
  const [pendingDailyAction, setPendingDailyAction] = useState<'draft' | 'submitted' | null>(null);

  // Calculate Weeks & Months from Intent dates
  const { totalWeeks, weekRanges, monthsList } = (() => {
    if (!intent?.start_date || !intent?.end_date) {
      return { totalWeeks: 16, weekRanges: [], monthsList: [] };
    }

    const start = new Date(intent.start_date);
    const end = new Date(intent.end_date);
    const diffTime = Math.max(0, end.getTime() - start.getTime());
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    const computedWeeks = Math.max(1, Math.ceil(totalDays / 7));

    // Week ranges
    const ranges: { week: number; start: Date; end: Date; label: string }[] = [];
    for (let i = 0; i < computedWeeks; i++) {
      const wStart = new Date(start);
      wStart.setDate(start.getDate() + i * 7);
      const wEnd = new Date(wStart);
      wEnd.setDate(wStart.getDate() + 4); // Mon-Fri default
      const startStr = `${wStart.getDate()} ${THAI_MONTHS_SHORT[wStart.getMonth()]}`;
      const endYearThai = wEnd.getFullYear() + 543;
      const endStr = `${wEnd.getDate()} ${THAI_MONTHS_SHORT[wEnd.getMonth()]} ${endYearThai}`;
      ranges.push({
        week: i + 1,
        start: wStart,
        end: wEnd,
        label: `${startStr} – ${endStr}`,
      });
    }

    // Month list
    const mList: { year: number; month: number; label: string }[] = [];
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= endMonth) {
      const y = cur.getFullYear();
      const m = cur.getMonth() + 1;
      mList.push({
        year: y,
        month: m,
        label: `${THAI_MONTHS_SHORT[m - 1]} ${y + 543}`,
      });
      cur = new Date(y, cur.getMonth() + 1, 1);
    }

    return { totalWeeks: computedWeeks, weekRanges: ranges, monthsList: mList };
  })();

  // Fetch initial data
  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [weeklyRes, monthlyRes, dailyRes] = await Promise.all([
          api.get('/weekly-logs/me'),
          api.get('/monthly-logs/me'),
          api.get('/daily-logs/me'),
        ]);

        if (!active) return;
        const weeklyData = (weeklyRes as { data?: { intent?: IntentData; logs?: WeeklyLogItem[] } })?.data || {};
        setIntent(weeklyData.intent || null);
        setWeeklyLogs(weeklyData.logs || []);
        setMonthlyLogs((monthlyRes as { data?: MonthlyLogItem[] })?.data || []);

        const dailyData = dailyRes as { intent?: DailyIntent | null; weeks?: DailyLogWeek[] } | null;
        setDailyIntent(dailyData?.intent || null);
        setDailyWeeks(dailyData?.weeks || []);

        const maxSubmittedWeek = (weeklyData.logs || []).reduce(
          (max: number, l: WeeklyLogItem) => (l.status === 'submitted' ? Math.max(max, l.week_number) : max),
          0
        );
        setSelectedWeek(Math.min(maxSubmittedWeek + 1, 16));
      } catch (err) {
        if (!active) return;
        setError(getErrorMessage(err, 'ไม่สามารถดึงข้อมูลบันทึกการปฏิบัติงานได้'));
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchData();
    return () => {
      active = false;
    };
  }, [auth?.user?.userId, refreshTrigger]);

  const currentWeeklyLog = weeklyLogs.find((l) => l.week_number === selectedWeek);
  const currentWeeklyValues: WeeklyFormFields = weeklyDrafts[selectedWeek] ?? {
    assigned_work: currentWeeklyLog?.assigned_work || '',
    methods: currentWeeklyLog?.methods || '',
    tools_used: currentWeeklyLog?.tools_used || '',
    achievements: currentWeeklyLog?.achievements || '',
    problems: currentWeeklyLog?.problems || '',
    summary: currentWeeklyLog?.summary || '',
  };

  const updateWeeklyField = (field: keyof WeeklyFormFields, val: string) => {
    setWeeklyDrafts((prev) => ({
      ...prev,
      [selectedWeek]: {
        ...currentWeeklyValues,
        [field]: val,
      },
    }));
  };

  // ── บันทึกรายวัน (สหกิจ 08) ──────────────────────────────────────────
  // ⛔ ใช้เลขสัปดาห์และช่วงวันเดียวกับแท็บรายสัปดาห์ (weekRanges คำนวณจาก
  //    intent.start_date ตัวเดียวกัน) — ห้ามคิดสูตรสัปดาห์แยกอีกชุด
  const currentDailyWeek = dailyWeeks.find((w) => w.week_number === selectedWeek);

  const currentWeekDays = (() => {
    const range = weekRanges[selectedWeek - 1];
    if (!range) return [];
    const todayIso = new Date().toISOString().slice(0, 10);
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(range.start);
      d.setDate(range.start.getDate() + i);
      const logDate = d.toISOString().slice(0, 10);
      const existing = currentDailyWeek?.days.find((day) => day.log_date === logDate);
      const draftKey = `${selectedWeek}:${logDate}`;
      return {
        logDate,
        weekday: THAI_WEEKDAYS[d.getDay()],
        label: `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + 543}`,
        isFuture: logDate > todayIso,
        workDetail: dailyDrafts[draftKey] ?? existing?.work_detail ?? '',
      };
    });
  })();

  const updateDailyField = (logDate: string, value: string) => {
    setDailyDrafts((prev) => ({ ...prev, [`${selectedWeek}:${logDate}`]: value }));
  };

  const handleSaveDaily = async (status: 'draft' | 'submitted') => {
    setError(null);
    setSuccess(null);

    if (status === 'submitted' && (calendarStatus === 'upcoming' || calendarStatus === 'closed')) {
      setError('ไม่อยู่ในช่วงเวลาที่เปิดให้ส่งตามปฏิทินสหกิจศึกษา (สามารถบันทึกร่างไว้ก่อนได้)');
      return;
    }
    if (status === 'submitted' && currentWeekDays.every((d) => !d.workDetail.trim())) {
      setError('กรุณากรอกบันทึกอย่างน้อยหนึ่งวันก่อนส่งให้พนักงานที่ปรึกษารับรอง');
      return;
    }

    try {
      setSubmitting(true);
      const res = await api.post('/daily-logs', {
        week_number: selectedWeek,
        status,
        days: currentWeekDays.map((d) => ({ log_date: d.logDate, work_detail: d.workDetail })),
      });
      setSuccess((res as { message?: string })?.message || (status === 'submitted' ? 'ส่งบันทึกรายวันเรียบร้อยแล้ว' : 'บันทึกร่างสำเร็จ'));
      setDailyDrafts((prev) => {
        const next = { ...prev };
        for (const d of currentWeekDays) delete next[`${selectedWeek}:${d.logDate}`];
        return next;
      });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถบันทึกรายวันได้'));
    } finally {
      setSubmitting(false);
    }
  };

  /** แก้สัปดาห์ที่พี่เลี้ยงรับรองแล้ว = ล้างการรับรองทิ้ง (backend ทำแบบนี้เสมอ) — เตือนก่อนเสมอ */
  const requestSaveDaily = (status: 'draft' | 'submitted') => {
    if (currentDailyWeek?.mentor_certified_at) {
      setPendingDailyAction(status);
      return;
    }
    handleSaveDaily(status);
  };

  const targetMonth = monthsList[selectedMonthIndex];
  const monthKey = targetMonth ? `${targetMonth.year}-${targetMonth.month}` : '';
  const currentMonthlyLog = targetMonth
    ? monthlyLogs.find((m) => m.year === targetMonth.year && m.month === targetMonth.month)
    : undefined;

  const currentMonthlyValues: MonthlyFormFields = (monthKey && monthlyDrafts[monthKey]) ? monthlyDrafts[monthKey] : {
    work_summary: currentMonthlyLog?.work_summary || '',
    effectiveness: currentMonthlyLog?.effectiveness || '',
    summary: currentMonthlyLog?.summary || '',
  };

  const updateMonthlyField = (field: keyof MonthlyFormFields, val: string) => {
    if (!monthKey) return;
    setMonthlyDrafts((prev) => ({
      ...prev,
      [monthKey]: {
        ...currentMonthlyValues,
        [field]: val,
      },
    }));
  };

  // Toggle company log form
  const handleToggleCompanyForm = async () => {
    if (!intent) return;
    const nextVal = !intent.uses_company_log_form;
    try {
      await api.patch(`/intents/${intent.form_id}/company-log-form`, {
        uses_company_log_form: nextVal,
      });
      setIntent({ ...intent, uses_company_log_form: nextVal });
      setSuccess(nextVal ? 'เปิดใช้งานแบบฟอร์มของสถานประกอบการแล้ว' : 'เปลี่ยนกลับมาใช้แบบฟอร์มกลางของมหาวิทยาลัยแล้ว');
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถเปลี่ยนการตั้งค่าแบบฟอร์มได้'));
    }
  };

  // Submit / Save Weekly Log
  const handleSaveWeekly = async (status: 'draft' | 'submitted') => {
    setError(null);
    setSuccess(null);

    if (status === 'submitted' && (calendarStatus === 'upcoming' || calendarStatus === 'closed')) {
      setError('ไม่อยู่ในช่วงเวลาที่เปิดให้ส่งตามปฏิทินสหกิจศึกษา (สามารถบันทึกร่างไว้ก่อนได้)');
      return;
    }

    if (status === 'submitted') {
      if (intent?.uses_company_log_form) {
        if (!weeklyFile && !currentWeeklyLog?.external_file_path) {
          setError('กรุณาแนบไฟล์บันทึกการทำงานของสถานประกอบการ');
          return;
        }
        if (!currentWeeklyValues.summary.trim()) {
          setError('กรุณากรอกสรุปสั้นๆ 1–2 บรรทัดเมื่อแนบไฟล์');
          return;
        }
      } else {
        if (
          !currentWeeklyValues.assigned_work.trim() ||
          !currentWeeklyValues.methods.trim() ||
          !currentWeeklyValues.tools_used.trim() ||
          !currentWeeklyValues.achievements.trim()
        ) {
          setError('กรุณากรอกข้อมูลให้ครบทั้ง 4 หัวข้อหลัก (งานที่ได้รับมอบหมาย, วิธีการ, เครื่องมือ, ผลการปฏิบัติงาน)');
          return;
        }
      }
    }

    try {
      setSubmitting(true);
      const formData = new FormData();
      formData.append('week_number', String(selectedWeek));
      formData.append('status', status);
      formData.append('assigned_work', currentWeeklyValues.assigned_work);
      formData.append('methods', currentWeeklyValues.methods);
      formData.append('tools_used', currentWeeklyValues.tools_used);
      formData.append('achievements', currentWeeklyValues.achievements);
      formData.append('problems', currentWeeklyValues.problems);
      formData.append('summary', currentWeeklyValues.summary);
      if (currentWeeklyLog?.external_file_path) {
        formData.append('external_file_path', currentWeeklyLog.external_file_path);
      }
      if (weeklyFile) {
        formData.append('file', weeklyFile);
      }

      const res = await api.post('/weekly-logs', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const successMsg = (res as { message?: string })?.message || (res as { data?: { message?: string } })?.data?.message;
      setSuccess(successMsg || (status === 'submitted' ? 'ส่งบันทึกเรียบร้อยแล้ว' : 'บันทึกร่างสำเร็จ'));
      setWeeklyFile(null);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'));
    } finally {
      setSubmitting(false);
    }
  };

  // Submit / Save Monthly Log
  const handleSaveMonthly = async (status: 'draft' | 'submitted') => {
    if (monthsList.length === 0) return;
    const curMonth = monthsList[selectedMonthIndex];
    if (!curMonth) return;

    setError(null);
    setSuccess(null);

    if (status === 'submitted' && (calendarStatus === 'upcoming' || calendarStatus === 'closed')) {
      setError('ไม่อยู่ในช่วงเวลาที่เปิดให้ส่งตามปฏิทินสหกิจศึกษา (สามารถบันทึกร่างไว้ก่อนได้)');
      return;
    }

    if (status === 'submitted') {
      if (intent?.uses_company_log_form) {
        if (!monthlyFile && !currentMonthlyLog?.external_file_path) {
          setError('กรุณาแนบไฟล์บันทึกการทำงานของสถานประกอบการ');
          return;
        }
        if (!currentMonthlyValues.summary.trim()) {
          setError('กรุณากรอกสรุปสั้นๆ 1–2 บรรทัดเมื่อแนบไฟล์');
          return;
        }
      } else {
        if (!currentMonthlyValues.work_summary.trim() || !currentMonthlyValues.effectiveness.trim()) {
          setError('กรุณากรอกข้อมูลให้ครบทั้ง 2 หัวข้อหลัก (สรุปผลการปฏิบัติงาน, ประสิทธิภาพและประสิทธิผลของงาน)');
          return;
        }
      }
    }

    try {
      setSubmitting(true);
      const formData = new FormData();
      formData.append('year', String(curMonth.year));
      formData.append('month', String(curMonth.month));
      formData.append('status', status);
      formData.append('work_summary', currentMonthlyValues.work_summary);
      formData.append('effectiveness', currentMonthlyValues.effectiveness);
      formData.append('summary', currentMonthlyValues.summary);
      if (currentMonthlyLog?.external_file_path) {
        formData.append('external_file_path', currentMonthlyLog.external_file_path);
      }
      if (monthlyFile) {
        formData.append('file', monthlyFile);
      }

      const res = await api.post('/monthly-logs', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const successMsg = (res as { message?: string })?.message || (res as { data?: { message?: string } })?.data?.message;
      setSuccess(successMsg || (status === 'submitted' ? 'ส่งบันทึกประจำเดือนเรียบร้อยแล้ว' : 'บันทึกร่างสำเร็จ'));
      setMonthlyFile(null);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล'));
    } finally {
      setSubmitting(false);
    }
  };

  // Helper stats for weekly
  const submittedCount = weeklyLogs.filter((l) => l.status === 'submitted').length;


  // Render Empty State if no accepted intent
  if (!loading && (!intent || !intent.start_date)) {
    return (
      <div className="max-w-5xl mx-auto py-8">
        <EmptyState
          icon={FileText}
          title="ยังไม่สามารถบันทึกการปฏิบัติงานได้"
          description="ระบบจะเปิดให้บันทึกการปฏิบัติงานรายวัน รายสัปดาห์ และรายเดือน เมื่อใบสมัครงานสหกิจศึกษาได้รับการตอบรับจากสถานประกอบการและออกหนังสือส่งตัวเรียบร้อยแล้ว"
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* 1. Header Card */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
            บันทึกการปฏิบัติงาน
          </h1>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            แบบรายงานประจำวัน (สหกิจ 08) · ประจำสัปดาห์ (สหกิจ 09) · ประจำเดือน (สหกิจ 10) — ทุกใบต้องให้พี่เลี้ยงรับรองก่อนถือว่าครบ
          </p>
        </div>
        <div className="flex flex-col md:items-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-semibold shadow-sm transition"
          >
            <Printer className="w-4 h-4" />
            พิมพ์บันทึกทั้งชุด
          </button>
          {intent?.company_name_th && (
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              {intent.company_name_th}
            </span>
          )}
        </div>
      </div>

      {/* 2. Progress Card (ความคืบหน้ารายสัปดาห์) */}
      <div
        data-testid="worklog-progress"
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 md:p-7 shadow-sm space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3">
          <span className="text-base font-bold text-gray-900 dark:text-white">
            ความคืบหน้ารายสัปดาห์ · ส่งแล้ว {submittedCount} จาก {totalWeeks} สัปดาห์
          </span>
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-emerald-400" />
              พี่เลี้ยงรับรองแล้ว
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-amber-400" />
              รอพี่เลี้ยงรับรอง
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-rose-400" />
              เลยกำหนด
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded bg-gray-200 dark:bg-gray-700" />
              ยังไม่ถึง
            </span>
          </div>
        </div>

        {/* 16 / N Week Chips */}
        <div className="flex flex-wrap gap-2 pt-1">
          {Array.from({ length: totalWeeks }, (_, idx) => {
            const wNum = idx + 1;
            const log = weeklyLogs.find((l) => l.week_number === wNum);
            const isCertified = log?.status === 'submitted' && Boolean(log.mentor_certified_at);
            const isWaiting = log?.status === 'submitted' && !log.mentor_certified_at;
            const isSelected = selectedWeek === wNum;

            let badgeClass = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500';
            if (isCertified) {
              badgeClass = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300';
            } else if (isWaiting) {
              badgeClass = 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300';
            }

            return (
              <button
                key={wNum}
                type="button"
                data-testid={`worklog-week-${wNum}`}
                onClick={() => {
                  setSelectedWeek(wNum);
                  setActiveTab('weekly');
                }}
                className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-bold border transition ${badgeClass} ${
                  isSelected ? 'ring-2 ring-blue-500 dark:ring-blue-400 shadow-sm' : 'hover:border-blue-300 dark:hover:border-blue-700'
                }`}
              >
                <span>{wNum}</span>
                {isCertified ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                ) : isWaiting ? (
                  <span className="text-[9px] font-semibold">รอ</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Main Form Container with 3 Tabs */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col">
        {/* Tab Headers */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-3 bg-gray-50/80 dark:bg-gray-900/40 items-center overflow-x-auto">
          <div className="flex shrink-0">
            {/* ⛔ โผล่เฉพาะเมื่อพี่เลี้ยงเปิดสวิตช์ intent.daily_log_required — นักศึกษาปิดเองไม่ได้
                จึงไม่มีอะไรให้ซ่อนไว้เตือนตอนปิด (14.8) */}
            {dailyIntent?.daily_log_required && (
              <button
                type="button"
                data-testid="worklog-tab-daily"
                onClick={() => setActiveTab('daily')}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition ${
                  activeTab === 'daily'
                    ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border-transparent'
                }`}
              >
                รายวัน · สหกิจ 08
              </button>
            )}
            <button
              type="button"
              data-testid="worklog-tab-weekly"
              onClick={() => setActiveTab('weekly')}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition ${
                activeTab === 'weekly'
                  ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border-transparent'
              }`}
            >
              รายสัปดาห์ · สหกิจ 09
            </button>
            <button
              type="button"
              data-testid="worklog-tab-monthly"
              onClick={() => setActiveTab('monthly')}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold border-b-2 transition ${
                activeTab === 'monthly'
                  ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border-transparent'
              }`}
            >
              รายเดือน · สหกิจ 10
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="p-6 md:p-8 space-y-6">
          <AlertBanner variant="error" message={error} />
          <AlertBanner variant="success" message={success} />

          {/* Calendar Gate Alert banner */}
          <CalendarGate activityKey="weekly_log" actionLabel="ส่งบันทึกการปฏิบัติงาน" className="mb-2" />

          {/* TAB 0: DAILY LOG (สหกิจ 08) — โผล่เฉพาะพี่เลี้ยงเปิดสวิตช์แล้วเท่านั้น */}
          {activeTab === 'daily' && dailyIntent?.daily_log_required && (
            <div className="space-y-6">
              <div className="flex items-start gap-3.5 p-4 rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/30">
                <CheckCircle2 className="w-5 h-5 text-blue-800 dark:text-blue-300 shrink-0 mt-0.5" />
                <span className="text-sm leading-relaxed text-blue-900 dark:text-blue-200">
                  พนักงานที่ปรึกษา{dailyIntent.mentor_name ? ` (${dailyIntent.mentor_name})` : ''}
                  {' '}เปิดให้บันทึกรายวันสำหรับการปฏิบัติงานครั้งนี้ — ท่านปิดเองไม่ได้เพราะเป็นการยกเลิกภาระงานของตัวเอง
                </span>
              </div>

              {/* Week Selector Bar — เลขสัปดาห์เดียวกับแท็บรายสัปดาห์ */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/30">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <span className="text-lg font-extrabold text-blue-900 dark:text-blue-200 block">
                      สัปดาห์ที่ {selectedWeek}
                    </span>
                    <span className="text-xs text-blue-700 dark:text-blue-300">
                      {weekRanges[selectedWeek - 1]?.label || `ช่วงสัปดาห์ที่ ${selectedWeek}`}
                    </span>
                  </div>
                  <select
                    data-testid="daily-week-select"
                    value={selectedWeek}
                    onChange={(e) => setSelectedWeek(Number(e.target.value))}
                    className="w-56 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-blue-500 shadow-sm"
                  >
                    {Array.from({ length: totalWeeks }, (_, idx) => idx + 1).map((w) => (
                      <option key={w} value={w}>สัปดาห์ที่ {w}</option>
                    ))}
                  </select>
                </div>

                {currentDailyWeek?.status === 'submitted' ? (
                  currentDailyWeek.mentor_certified_at ? (
                    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-xs font-bold border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      พี่เลี้ยงรับรองแล้ว ({currentDailyWeek.certified_by_name || 'พี่เลี้ยง'})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-xs font-bold border border-amber-200 dark:border-amber-800">
                      <Clock className="w-3.5 h-3.5" />
                      รอพี่เลี้ยงรับรอง
                    </span>
                  )
                ) : currentDailyWeek?.status === 'returned' ? (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200 text-xs font-bold border border-rose-200 dark:border-rose-800">
                    <AlertCircle className="w-3.5 h-3.5" />
                    ถูกส่งกลับมาแก้ไข
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold border border-gray-200 dark:border-gray-600">
                    ร่าง · ยังไม่ได้ส่ง
                  </span>
                )}
              </div>

              {/* Returned comment banner */}
              {currentDailyWeek?.status === 'returned' && currentDailyWeek.returned_comment && (
                <div
                  data-testid="worklog-returned-comment"
                  className="p-4 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 space-y-1 text-sm"
                >
                  <span className="font-bold flex items-center gap-1.5 text-rose-900 dark:text-rose-100">
                    <AlertCircle className="w-4 h-4" />
                    ข้อเสนอแนะจากพี่เลี้ยง (ส่งกลับมาแก้ไข):
                  </span>
                  <p className="leading-relaxed pl-5.5">{currentDailyWeek.returned_comment}</p>
                </div>
              )}

              {/* 5 วันทำงาน */}
              <div className="space-y-2.5">
                {currentWeekDays.map((day) => (
                  <div
                    key={day.logDate}
                    data-testid={`daily-row-${day.logDate}`}
                    className={`grid grid-cols-1 sm:grid-cols-[128px_1fr_108px] gap-3 sm:items-center ${day.isFuture ? 'opacity-60' : ''}`}
                  >
                    <div className="flex sm:flex-col gap-1.5 sm:gap-0">
                      <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{day.weekday}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{day.label}</span>
                    </div>
                    <input
                      type="text"
                      data-testid={`daily-input-${day.logDate}`}
                      value={day.workDetail}
                      disabled={day.isFuture}
                      onChange={(e) => updateDailyField(day.logDate, e.target.value)}
                      placeholder={day.isFuture ? 'ยังไม่ถึงวัน' : 'วันนี้ทำอะไรบ้าง — เขียนสั้นๆ พอให้พี่เลี้ยงตามได้'}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition disabled:bg-gray-50 dark:disabled:bg-gray-900"
                    />
                    <span
                      className={`justify-self-start px-3 py-1 rounded-full text-xs font-bold border ${
                        day.isFuture
                          ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500'
                          : day.workDetail.trim()
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {day.isFuture ? 'ยังไม่ถึง' : day.workDetail.trim() ? 'กรอกแล้ว' : 'ยังว่าง'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  บันทึกรายวัน<strong>ส่งให้พี่เลี้ยงรับรองทีเดียวทั้งสัปดาห์</strong> ไม่ใช่วันละครั้ง
                </span>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  บันทึกร่างไว้ก่อนได้ ระบบไม่ได้ส่งแจ้งเตือนใครจนกว่าจะกดส่งให้พี่เลี้ยงรับรอง
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    data-testid="daily-save-draft"
                    disabled={submitting}
                    onClick={() => requestSaveDaily('draft')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-600 transition"
                  >
                    <Save className="w-4 h-4" />
                    บันทึกร่าง
                  </button>
                  <button
                    type="button"
                    data-testid="daily-submit"
                    disabled={submitting || calendarStatus === 'upcoming' || calendarStatus === 'closed'}
                    onClick={() => requestSaveDaily('submitted')}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition shadow-sm ${
                      submitting || calendarStatus === 'upcoming' || calendarStatus === 'closed'
                        ? 'bg-blue-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'
                    }`}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    ส่งบันทึกสัปดาห์นี้ให้พี่เลี้ยงรับรอง
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: WEEKLY LOG */}
          {activeTab === 'weekly' && (
            <div className="space-y-6">
              {/* Week Selector Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-blue-100 dark:border-blue-900/50 bg-blue-50/60 dark:bg-blue-950/30">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <span className="text-lg font-extrabold text-blue-900 dark:text-blue-200 block">
                      สัปดาห์ที่ {selectedWeek}
                    </span>
                    <span className="text-xs text-blue-700 dark:text-blue-300">
                      {weekRanges[selectedWeek - 1]?.label || `ช่วงสัปดาห์ที่ ${selectedWeek}`}
                    </span>
                  </div>
                  <select
                    data-testid="worklog-week-select"
                    value={selectedWeek}
                    onChange={(e) => setSelectedWeek(Number(e.target.value))}
                    className="w-56 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-blue-500 shadow-sm"
                  >
                    {Array.from({ length: totalWeeks }, (_, idx) => {
                      const w = idx + 1;
                      const log = weeklyLogs.find((l) => l.week_number === w);
                      let labelStatus = 'ยังไม่ได้ส่ง';
                      if (log?.status === 'submitted') {
                        labelStatus = log.mentor_certified_at ? 'รับรองแล้ว' : 'รอรับรอง';
                      } else if (log?.status === 'returned') {
                        labelStatus = 'ส่งกลับมาแก้ไข';
                      }
                      return (
                        <option key={w} value={w}>
                          สัปดาห์ที่ {w} — {labelStatus}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Status Badge */}
                <div>
                  {currentWeeklyLog?.status === 'submitted' ? (
                    currentWeeklyLog.mentor_certified_at ? (
                      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-xs font-bold border border-emerald-200 dark:border-emerald-800">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        พี่เลี้ยงรับรองแล้ว ({currentWeeklyLog.mentor_certified_name || 'พี่เลี้ยง'})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-xs font-bold border border-amber-200 dark:border-amber-800">
                        <Clock className="w-3.5 h-3.5" />
                        รอพี่เลี้ยงรับรอง
                      </span>
                    )
                  ) : currentWeeklyLog?.status === 'returned' ? (
                    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200 text-xs font-bold border border-rose-200 dark:border-rose-800">
                      <AlertCircle className="w-3.5 h-3.5" />
                      ถูกส่งกลับมาแก้ไข
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold border border-gray-200 dark:border-gray-600">
                      ร่าง · ยังไม่ได้ส่ง
                    </span>
                  )}
                </div>
              </div>

              {/* Returned comment banner */}
              {currentWeeklyLog?.status === 'returned' && currentWeeklyLog.returned_comment && (
                <div
                  data-testid="worklog-returned-comment"
                  className="p-4 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 space-y-1 text-sm"
                >
                  <span className="font-bold flex items-center gap-1.5 text-rose-900 dark:text-rose-100">
                    <AlertCircle className="w-4 h-4" />
                    ข้อเสนอแนะจากพี่เลี้ยง (ส่งกลับมาแก้ไข):
                  </span>
                  <p className="leading-relaxed pl-5.5">{currentWeeklyLog.returned_comment}</p>
                </div>
              )}

              {/* Company Form Toggle */}
              <div className="flex items-start gap-3.5 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30">
                <button
                  type="button"
                  data-testid="worklog-company-form-toggle"
                  onClick={handleToggleCompanyForm}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 mt-0.5 ${
                    intent?.uses_company_log_form ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white shadow transform transition-transform absolute top-1 ${
                      intent?.uses_company_log_form ? 'translate-x-6 left-0' : 'translate-x-1 left-0'
                    }`}
                  />
                </button>
                <div className="space-y-0.5">
                  <span className="text-sm font-bold text-gray-900 dark:text-white block">
                    บริษัทให้ใช้แบบฟอร์มบันทึกของเขาเอง
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed block">
                    เปิดสวิตช์นี้แล้วช่องกรอกจะเปลี่ยนเป็นการแนบไฟล์แทน — ตั้งครั้งเดียวใช้กับทุกสัปดาห์
                  </span>
                </div>
              </div>

              {/* Weekly Form Fields */}
              {intent?.uses_company_log_form ? (
                /* Mode A: Company Form File Upload */
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      ไฟล์บันทึกประจำสัปดาห์ที่ {selectedWeek} <span className="text-rose-500">*</span>
                    </label>
                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-6 bg-gray-50/50 dark:bg-gray-900/20 text-center space-y-2 relative">
                      <input
                        type="file"
                        data-testid="worklog-file-input"
                        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                        onChange={(e) => setWeeklyFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <UploadCloud className="w-8 h-8 text-gray-400 mx-auto" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 block">
                        ลากไฟล์มาวาง หรือเลือกไฟล์จากเครื่อง
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 block">
                        PDF · JPG · PNG · Word ขนาดไม่เกิน 10 MB
                      </span>
                    </div>

                    {(weeklyFile || currentWeeklyLog?.external_file_path) && (
                      <div
                        data-testid="worklog-file-item"
                        className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                          <span className="truncate font-medium text-gray-800 dark:text-gray-200">
                            {weeklyFile ? weeklyFile.name : currentWeeklyLog?.external_file_path?.split('/').pop()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {currentWeeklyLog?.external_file_path && (
                            <a
                              href={`/api/files/${currentWeeklyLog.external_file_path}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 inline-flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" /> เปิดดู
                            </a>
                          )}
                          {weeklyFile && (
                            <button
                              type="button"
                              onClick={() => setWeeklyFile(null)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-300 inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> ลบ
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      สรุปสั้นๆ ว่าสัปดาห์นี้ทำอะไร <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block">
                      1–2 บรรทัดพอ — ระบบอ่านไฟล์แนบไม่ได้ ถ้าไม่มีบรรทัดนี้อาจารย์นิเทศกับเจ้าหน้าที่จะเห็นแค่ชื่อไฟล์
                    </span>
                    <textarea
                      data-testid="worklog-summary"
                      rows={3}
                      value={currentWeeklyValues.summary}
                      onChange={(e) => updateWeeklyField('summary', e.target.value)}
                      placeholder="สรุปงานสำคัญและผลลัพธ์ในสัปดาห์นี้..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>
                </div>
              ) : (
                /* Mode B: 5 Textarea Fields */
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      1 · งานที่ได้รับมอบหมาย <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block">
                      สัปดาห์นี้พี่เลี้ยงมอบหมายงานอะไรมาบ้าง
                    </span>
                    <textarea
                      data-testid="weekly-assigned-work"
                      rows={2}
                      value={currentWeeklyValues.assigned_work}
                      onChange={(e) => updateWeeklyField('assigned_work', e.target.value)}
                      placeholder="เช่น พัฒนาหน้าจอรายงานยอดผลิตรายวันให้ฝ่ายวางแผน..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      2 · วิธีการและขั้นตอนการปฏิบัติงาน <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block">
                      ทำอย่างไร เริ่มจากอะไรไปจบที่อะไร
                    </span>
                    <textarea
                      data-testid="weekly-methods"
                      rows={3}
                      value={currentWeeklyValues.methods}
                      onChange={(e) => updateWeeklyField('methods', e.target.value)}
                      placeholder="เช่น เก็บความต้องการจากฝ่ายวางแผน 1 รอบ แล้วเขียนคิวรีดึงยอด..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      3 · เครื่องมือและอุปกรณ์ที่ใช้ <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      data-testid="weekly-tools"
                      rows={2}
                      value={currentWeeklyValues.tools_used}
                      onChange={(e) => updateWeeklyField('tools_used', e.target.value)}
                      placeholder="เช่น React, PostgreSQL, Git, เครื่องมือทดสอบในแผนก..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      4 · ผลการปฏิบัติงาน <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      data-testid="weekly-achievements"
                      rows={2}
                      value={currentWeeklyValues.achievements}
                      onChange={(e) => updateWeeklyField('achievements', e.target.value)}
                      placeholder="เช่น หน้าจอใช้งานได้จริง ลดเวลาทำสรุปยอดลงประมาณวันละ 30 นาที..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      5 · ปัญหาและอุปสรรค
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block">
                      ไม่มีก็เว้นว่างได้ — แต่ถ้ามี พี่เลี้ยงกับอาจารย์นิเทศจะเห็นและช่วยได้ทัน
                    </span>
                    <textarea
                      data-testid="weekly-problems"
                      rows={2}
                      value={currentWeeklyValues.problems}
                      onChange={(e) => updateWeeklyField('problems', e.target.value)}
                      placeholder="เช่น ข้อมูลบางกะหาย ต้องรอฝ่ายไอทีเปิดสิทธิ์ให้..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  บันทึกร่างไว้ก่อนได้ ระบบไม่ได้ส่งแจ้งเตือนใครจนกว่าจะกดส่งให้พี่เลี้ยงรับรอง
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    data-testid="worklog-save-draft"
                    disabled={submitting}
                    onClick={() => handleSaveWeekly('draft')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-600 transition"
                  >
                    <Save className="w-4 h-4" />
                    บันทึกร่าง
                  </button>
                  <button
                    type="button"
                    data-testid="worklog-submit"
                    disabled={submitting || calendarStatus === 'upcoming' || calendarStatus === 'closed'}
                    onClick={() => handleSaveWeekly('submitted')}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition shadow-sm ${
                      submitting || calendarStatus === 'upcoming' || calendarStatus === 'closed'
                        ? 'bg-blue-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'
                    }`}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    ส่งให้พี่เลี้ยงรับรอง
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MONTHLY LOG */}
          {activeTab === 'monthly' && (
            <div className="space-y-6">
              {/* Month Selector Chips */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                  เดือนที่รายงาน
                </label>
                <div className="flex flex-wrap gap-2.5">
                  {monthsList.map((m, idx) => {
                    const log = monthlyLogs.find((l) => l.year === m.year && l.month === m.month);
                    const isDone = log?.status === 'submitted';
                    const isSelected = selectedMonthIndex === idx;

                    let chipClass = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400';
                    if (isSelected) {
                      chipClass = 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 ring-2 ring-blue-500/20';
                    } else if (isDone) {
                      chipClass = 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300';
                    }

                    return (
                      <button
                        key={`${m.year}-${m.month}`}
                        type="button"
                        data-testid={`monthly-month-${m.month}`}
                        onClick={() => setSelectedMonthIndex(idx)}
                        className={`px-4 py-2 rounded-full border text-xs font-bold transition flex items-center gap-1.5 ${chipClass}`}
                      >
                        <span>{m.label}</span>
                        {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />}
                      </button>
                    );
                  })}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block">
                  เลือกเดือนที่ต้องการส่งหรือแก้ไขบันทึกผลการปฏิบัติงานประจำเดือน (สหกิจ 10)
                </span>
              </div>

              {/* Status Badge */}
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  สถานะบันทึก {monthsList[selectedMonthIndex]?.label}
                </span>
                {currentMonthlyLog?.status === 'submitted' ? (
                  currentMonthlyLog.mentor_certified_at ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-xs font-bold border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      พี่เลี้ยงรับรองแล้ว ({currentMonthlyLog.mentor_certified_name || 'พี่เลี้ยง'})
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 text-xs font-bold border border-amber-200 dark:border-amber-800">
                      <Clock className="w-3.5 h-3.5" />
                      รอพี่เลี้ยงรับรอง
                    </span>
                  )
                ) : currentMonthlyLog?.status === 'returned' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-200 text-xs font-bold border border-rose-200 dark:border-rose-800">
                    <AlertCircle className="w-3.5 h-3.5" />
                    ส่งกลับมาแก้ไข
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold border border-gray-200 dark:border-gray-600">
                    ร่าง · ยังไม่ได้ส่ง
                  </span>
                )}
              </div>

              {/* Returned comment */}
              {currentMonthlyLog?.status === 'returned' && currentMonthlyLog.returned_comment && (
                <div
                  data-testid="worklog-returned-comment"
                  className="p-4 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 space-y-1 text-sm"
                >
                  <span className="font-bold flex items-center gap-1.5 text-rose-900 dark:text-rose-100">
                    <AlertCircle className="w-4 h-4" />
                    ข้อเสนอแนะจากพี่เลี้ยง (ส่งกลับมาแก้ไข):
                  </span>
                  <p className="leading-relaxed pl-5.5">{currentMonthlyLog.returned_comment}</p>
                </div>
              )}

              {/* Monthly Form Fields */}
              {intent?.uses_company_log_form ? (
                /* Company Form Mode */
                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      ไฟล์บันทึกประจำเดือน {monthsList[selectedMonthIndex]?.label} <span className="text-rose-500">*</span>
                    </label>
                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-2xl p-6 bg-gray-50/50 dark:bg-gray-900/20 text-center space-y-2 relative">
                      <input
                        type="file"
                        data-testid="worklog-file-input"
                        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                        onChange={(e) => setMonthlyFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <UploadCloud className="w-8 h-8 text-gray-400 mx-auto" />
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 block">
                        ลากไฟล์มาวาง หรือเลือกไฟล์จากเครื่อง
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 block">
                        PDF · JPG · PNG · Word ขนาดไม่เกิน 10 MB
                      </span>
                    </div>

                    {(monthlyFile || currentMonthlyLog?.external_file_path) && (
                      <div
                        data-testid="worklog-file-item"
                        className="flex items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <FileText className="w-5 h-5 text-blue-600 shrink-0" />
                          <span className="truncate font-medium text-gray-800 dark:text-gray-200">
                            {monthlyFile ? monthlyFile.name : currentMonthlyLog?.external_file_path?.split('/').pop()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {currentMonthlyLog?.external_file_path && (
                            <a
                              href={`/api/files/${currentMonthlyLog.external_file_path}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 inline-flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" /> เปิดดู
                            </a>
                          )}
                          {monthlyFile && (
                            <button
                              type="button"
                              onClick={() => setMonthlyFile(null)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-300 inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> ลบ
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      สรุปสั้นๆ ว่าเดือนนี้ทำอะไร <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      data-testid="monthly-summary"
                      rows={3}
                      value={currentMonthlyValues.summary}
                      onChange={(e) => updateMonthlyField('summary', e.target.value)}
                      placeholder="สรุปภาพรวมงานในเดือนนี้ 1-2 บรรทัด..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>
                </div>
              ) : (
                /* Regular 2-Field Monthly Form */
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      1 · สรุปผลการปฏิบัติงานในเดือนนี้ <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block">
                      งานหลักที่ทำไปทั้งเดือน และผลที่เกิดขึ้นจริง
                    </span>
                    <textarea
                      data-testid="monthly-summary"
                      rows={4}
                      value={currentMonthlyValues.work_summary}
                      onChange={(e) => updateMonthlyField('work_summary', e.target.value)}
                      placeholder="เช่น เดือนนี้รับผิดชอบงานพัฒนาหน้าจอรายงานยอดผลิตจนใช้งานได้จริง..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white">
                      2 · ประสิทธิภาพและประสิทธิผลของงานที่ปฏิบัติ <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block">
                      งานที่ทำช่วยหน่วยงานได้จริงแค่ไหน วัดจากอะไร
                    </span>
                    <textarea
                      data-testid="monthly-effectiveness"
                      rows={4}
                      value={currentMonthlyValues.effectiveness}
                      onChange={(e) => updateMonthlyField('effectiveness', e.target.value)}
                      placeholder="เช่น ฝ่ายวางแผนเลิกทำสรุปยอดด้วยมือ ลดเวลาลงประมาณวันละ 30 นาที..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm outline-none focus:border-blue-500 transition"
                    />
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  บันทึกร่างไว้ก่อนได้ ระบบไม่ได้ส่งแจ้งเตือนใครจนกว่าจะกดส่งให้พี่เลี้ยงรับรอง
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    data-testid="worklog-save-draft"
                    disabled={submitting}
                    onClick={() => handleSaveMonthly('draft')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-600 transition"
                  >
                    <Save className="w-4 h-4" />
                    บันทึกร่าง
                  </button>
                  <button
                    type="button"
                    data-testid="worklog-submit"
                    disabled={submitting || calendarStatus === 'upcoming' || calendarStatus === 'closed'}
                    onClick={() => handleSaveMonthly('submitted')}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition shadow-sm ${
                      submitting || calendarStatus === 'upcoming' || calendarStatus === 'closed'
                        ? 'bg-blue-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'
                    }`}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    ส่งให้พี่เลี้ยงรับรอง
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDailyAction !== null}
        title="สัปดาห์นี้พี่เลี้ยงรับรองไปแล้ว"
        message="การบันทึกครั้งนี้จะล้างการรับรองของพี่เลี้ยงทิ้งทั้งสัปดาห์ และต้องรอให้พี่เลี้ยงรับรองใหม่ ยืนยันที่จะบันทึกหรือไม่?"
        confirmLabel="ยืนยันบันทึก"
        confirmTestId="daily-confirm-overwrite"
        busy={submitting}
        onConfirm={() => {
          const action = pendingDailyAction;
          setPendingDailyAction(null);
          if (action) handleSaveDaily(action);
        }}
        onCancel={() => setPendingDailyAction(null)}
      />
    </div>
  );
};

export default WeeklyLog;
