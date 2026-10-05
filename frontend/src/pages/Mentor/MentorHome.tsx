import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import Button from '../../components/ui/Button';
import AlertBanner from '../../components/ui/AlertBanner';
import PageSkeleton, { skeletonFor } from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { getErrorMessage } from '../../utils/errors';
import {
  Clock,
  AlertTriangle,
  FileText,
  Calendar,
  Info,
  ArrowRight,
  ClipboardList,
} from 'lucide-react';

interface PendingItem {
  kind: 'weekly_log' | 'monthly_log' | 'daily_log' | 'work_plan' | 'report_outline' | 'report_draft';
  id: number;
  student_id: number;
  student_name: string;
  label: string;
  period_start: string | null;
  period_end: string | null;
  submitted_at: string;
  due_date: string | null;
  days_waiting: number | null;
  is_overdue: boolean;
}

interface StudentItem {
  intent_form_id: number;
  student_id: number;
  student_code: string;
  full_name: string;
  major_name_th: string;
  start_date: string;
  end_date: string;
  daily_log_required: boolean;
  uses_company_log_form: boolean;
  draft_due_date: string | null;
  week_total: number;
  week_current: number;
  submitted_count: number;
  certified_count: number;
  eval15_submitted: boolean;
  eval16_submitted: boolean;
}

const MentorHome: React.FC = () => {
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [items, setItems] = useState<PendingItem[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [sortBy, setSortBy] = useState<'longest' | 'student' | 'kind'>('longest');
  const [togglingStudentId, setTogglingStudentId] = useState<number | null>(null);

  // Load pending queue and students
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get('/mentor/pending');
      setItems(res?.items || []);
      setStudents(res?.students || []);
    } catch (err) {
      console.error('Failed to load mentor pending items:', err);
      setError(getErrorMessage(err, 'ไม่สามารถโหลดรายการที่รอรับรองได้ กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Sort
  const sortedItems = useMemo(() => {
    const list = [...items];
    if (sortBy === 'longest') {
      return list.sort((a, b) => (b.days_waiting ?? 0) - (a.days_waiting ?? 0));
    }
    if (sortBy === 'student') {
      return list.sort((a, b) => a.student_name.localeCompare(b.student_name, 'th'));
    }
    if (sortBy === 'kind') {
      return list.sort((a, b) => a.kind.localeCompare(b.kind));
    }
    return list;
  }, [items, sortBy]);

  // Summary of oldest pending item
  const oldestDays = useMemo(() => {
    if (items.length === 0) return 0;
    return Math.max(...items.map((i) => i.days_waiting ?? 0));
  }, [items]);

  // Navigate to item target screen
  const handleOpenItem = (item: PendingItem) => {
    if (item.kind === 'work_plan') {
      setSearchParams({ role: 'mentor', menu: 'certify', student: String(item.student_id), tab: 'plan' });
    } else if (item.kind === 'report_draft') {
      setSearchParams({ role: 'mentor', menu: 'certify', student: String(item.student_id), tab: 'draft' });
    } else if (item.kind === 'report_outline') {
      setSearchParams({ role: 'mentor', menu: 'report_outlines' });
    } else {
      // weekly_log, monthly_log, daily_log
      setSearchParams({ role: 'mentor', menu: 'certify', student: String(item.student_id), tab: 'logs' });
    }
  };

  // Toggle daily_log_required
  const handleToggleDailyLog = async (student: StudentItem) => {
    const nextValue = !student.daily_log_required;
    try {
      setTogglingStudentId(student.student_id);
      setError(null);
      await api.patch(`/intents/${student.intent_form_id}/daily-log-required`, {
        value: nextValue,
      });

      // Update state locally
      setStudents((prev) =>
        prev.map((st) =>
          st.student_id === student.student_id ? { ...st, daily_log_required: nextValue } : st
        )
      );
      setSuccess(
        `บันทึกการตั้งค่ารายวันของ ${student.full_name}: ${nextValue ? 'เปิดให้นักศึกษาบันทึกรายวัน (สหกิจ 08)' : 'ปิดการบันทึกรายวัน'}`
      );
    } catch (err) {
      setError(getErrorMessage(err, 'ไม่สามารถเปลี่ยนการตั้งค่าบันทึกรายวันได้'));
    } finally {
      setTogglingStudentId(null);
    }
  };

  // Format date helper
  const formatThaiDate = (dateStr: string | null) => {
    if (!dateStr) return '';
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

  if (loading) {
    return (
      <div className="space-y-6">
        <PageSkeleton variant={skeletonFor('mentor', 'dashboard')} />
      </div>
    );
  }

  return (
    <div className="space-y-6 page-enter pb-16">
      {/* 1. Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">
          รอคุณรับรอง
        </h1>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          งานของพี่เลี้ยงคือ “อ่านแล้วเซ็น” — ทุกอย่างที่ต้องเซ็นอยู่ในรายการเดียวนี้ ไล่จากบนลงล่างได้เลย
        </p>
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

      {/* 2. Pending Queue */}
      <div
        data-testid="mentor-queue"
        className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-sm"
      >
        <div className="p-4 sm:p-5 bg-gray-50/80 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-gray-900 dark:text-white">
              {items.length} รายการรอท่าน
            </span>
            {oldestDays > 0 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                · เก่าสุดค้างมาแล้ว {oldestDays} วัน
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">เรียงตาม:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'longest' | 'student' | 'kind')}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              <option value="longest">ค้างนานที่สุดก่อน</option>
              <option value="student">ตามนักศึกษา</option>
              <option value="kind">ตามชนิดเอกสาร</option>
            </select>
          </div>
        </div>

        {sortedItems.length === 0 ? (
          <div className="p-10">
            <EmptyState
              title="ไม่มีรายการรอรับรองในขณะนี้"
              description="เมื่อนักศึกษาในความดูแลส่งบันทึกการปฏิบัติงาน แผนงาน หรือรายงานฉบับร่าง รายการจะปรากฏที่นี่เพื่อให้ท่านตรวจรับรอง"
            />
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {sortedItems.map((item) => {
              const overdue = item.is_overdue;
              const waitingDays = item.days_waiting ?? 0;

              return (
                <div
                  key={`${item.kind}-${item.id}`}
                  data-testid={`mentor-queue-item-${item.kind}-${item.id}`}
                  className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                    overdue
                      ? 'bg-red-50/40 dark:bg-red-950/10 hover:bg-red-50/70 dark:hover:bg-red-950/20'
                      : 'hover:bg-gray-50/60 dark:hover:bg-gray-800/30'
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3.5">
                    {/* Chip */}
                    <div className="shrink-0 mt-0.5 sm:mt-0">
                      {overdue ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-white text-red-600 dark:bg-red-900/40 dark:text-red-400 border border-red-200 dark:border-red-800 shadow-xs">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                          เลยกำหนด {waitingDays} วัน
                        </span>
                      ) : waitingDays > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          ค้าง {waitingDays} วัน
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          วันนี้
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="space-y-1">
                      <div className="text-sm sm:text-base font-bold text-gray-900 dark:text-white flex flex-wrap items-center gap-1.5">
                        <span>{item.label}</span>
                        <span className="text-gray-400 dark:text-gray-500">·</span>
                        <span className="text-brand-blue dark:text-blue-400 font-semibold">{item.student_name}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                        {item.kind === 'work_plan' &&
                          `นักศึกษาลงชื่อแล้วเมื่อ ${formatThaiDate(item.submitted_at)} · กำหนดลงนามภายในสัปดาห์ที่ 2 ของการปฏิบัติงาน`}
                        {item.kind === 'weekly_log' &&
                          `ช่วงวันที่ ${formatThaiDate(item.period_start)} – ${formatThaiDate(item.period_end)} · รับรองรวดเดียวได้จากหน้าถัดไป`}
                        {item.kind === 'monthly_log' &&
                          `ช่วงวันที่ ${formatThaiDate(item.period_start)} – ${formatThaiDate(item.period_end)} · รับรองรวดเดียวได้จากหน้าถัดไป`}
                        {item.kind === 'daily_log' &&
                          `ช่วงวันที่ ${formatThaiDate(item.period_start)} – ${formatThaiDate(item.period_end)} · รับรองรวดเดียวได้จากหน้าถัดไป`}
                        {item.kind === 'report_outline' &&
                          'ท่านเห็นชอบหัวข้อก่อน แล้วอาจารย์ที่ปรึกษาจึงพิจารณาเชิงวิชาการต่อ — ท่านเป็นคนเดียวที่รู้ว่าหัวข้อไหนแตะข้อมูลลับของบริษัท'}
                        {item.kind === 'report_draft' &&
                          'คู่มือกำหนดให้นักศึกษาส่งร่างให้ท่านตรวจอย่างน้อย 2 สัปดาห์ก่อนสิ้นสุดการปฏิบัติงาน'}
                      </p>
                    </div>
                  </div>

                  {/* Open action button */}
                  <div className="shrink-0 flex sm:justify-end">
                    <Button
                      variant={overdue || item.kind === 'work_plan' || item.kind === 'weekly_log' ? 'primary' : 'secondary'}
                      size="sm"
                      data-testid="mentor-queue-open"
                      onClick={() => handleOpenItem(item)}
                      className="gap-1.5 w-full sm:w-auto shadow-xs"
                    >
                      {item.kind === 'work_plan'
                        ? 'เปิดตรวจและลงนาม'
                        : item.kind === 'report_outline'
                        ? 'เปิดพิจารณา'
                        : item.kind === 'report_draft'
                        ? 'เปิดตรวจร่างรายงาน'
                        : 'เปิดตรวจและรับรอง'}
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Students Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            นักศึกษาที่ท่านดูแล
          </h2>
          <span className="text-xs text-gray-600 dark:text-gray-400">
            เห็นเฉพาะนักศึกษาที่ผูกกับท่านในระบบเท่านั้น ({students.length} คน)
          </span>
        </div>

        {students.length === 0 ? (
          <div className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8">
            <EmptyState
              title="ยังไม่มีนักศึกษาในความดูแล"
              description="เมื่อสถานประกอบการตอบรับนักศึกษาและเจ้าหน้าที่คณะรับเข้าฝึกโดยระบุท่านเป็นพี่เลี้ยง รายชื่อจะแสดงที่นี่"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {students.map((st) => {
              const weekCurrent = st.week_current || 1;
              const weekTotal = st.week_total || 16;
              const certifiedCount = st.certified_count || 0;
              const submittedCount = st.submitted_count || 0;

              return (
                <div
                  key={st.student_id}
                  data-testid={`mentor-student-card-${st.student_id}`}
                  className="card bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm flex flex-col justify-between"
                >
                  <div className="space-y-4">
                    {/* Top Row: Student info & week badge */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-blue-50 dark:bg-blue-900/30 text-brand-blue dark:text-blue-300 flex items-center justify-center font-bold text-sm shrink-0 border border-blue-100 dark:border-blue-800">
                          {st.full_name ? st.full_name.substring(0, 2) : 'นศ'}
                        </div>
                        <div>
                          <h3 className="font-bold text-base text-gray-900 dark:text-white">
                            {st.full_name}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                            {st.student_code} · {st.major_name_th}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-brand-blue dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        สัปดาห์ที่ {weekCurrent} จาก {weekTotal}
                      </span>
                    </div>

                    {/* Progress Week Boxes */}
                    <div className="space-y-2">
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                        บันทึกประจำสัปดาห์ที่ท่านรับรองแล้ว {certifiedCount} จาก {submittedCount} ใบที่ส่งมา
                      </span>
                      <div className="flex gap-1.5 flex-wrap">
                        {Array.from({ length: weekTotal }, (_, idx) => {
                          const wNum = idx + 1;
                          const isCertified = wNum <= certifiedCount;
                          const isWaiting = wNum > certifiedCount && wNum <= submittedCount;
                          const isNow = wNum === weekCurrent;

                          let boxClass = 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700';
                          if (isCertified) {
                            boxClass = 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400 border-green-300 dark:border-green-800 font-bold';
                          } else if (isWaiting) {
                            boxClass = 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-700 font-bold';
                          } else if (isNow) {
                            boxClass = 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-brand-blue font-bold ring-1 ring-brand-blue';
                          }

                          return (
                            <span
                              key={wNum}
                              title={`สัปดาห์ที่ ${wNum}${isCertified ? ' (รับรองแล้ว)' : isWaiting ? ' (รอรับรอง)' : isNow ? ' (ปัจจุบัน)' : ''}`}
                              className={`w-7 h-7 rounded-lg border text-xs flex items-center justify-center transition-all select-none ${boxClass}`}
                            >
                              {wNum}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Daily Log Switch */}
                    <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-3.5 sm:p-4 bg-gray-50/50 dark:bg-gray-800/20 flex items-start gap-3.5">
                      <button
                        type="button"
                        data-testid={`mentor-daily-toggle-${st.student_id}`}
                        disabled={togglingStudentId === st.student_id}
                        onClick={() => handleToggleDailyLog(st)}
                        aria-pressed={st.daily_log_required}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-2 ${
                          st.daily_log_required ? 'bg-brand-blue' : 'bg-gray-300 dark:bg-gray-600'
                        } ${togglingStudentId === st.student_id ? 'opacity-50 cursor-wait' : ''}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            st.daily_log_required ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>

                      <div className="space-y-1">
                        <span className="text-sm font-bold text-gray-900 dark:text-white block">
                          ให้นักศึกษาบันทึกรายวันด้วย (สหกิจ 08)
                        </span>
                        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                          {st.daily_log_required ? (
                            <span className="text-brand-blue dark:text-blue-400 font-medium">
                              เปิดอยู่ · ท่านเป็นคนเดียวที่เปิด-ปิดสวิตช์นี้ได้ นักศึกษาปิดเองไม่ได้ · เมื่อปิด แท็บรายวันของนักศึกษายังอยู่ แต่บอกว่าพี่เลี้ยงยังไม่ได้เปิดใช้
                            </span>
                          ) : (
                            <span>
                              ปิดอยู่ (ค่าเริ่มต้น) · คู่มือให้ตกลงกันเองว่าจะใช้หรือไม่ · เปิดแล้วนักศึกษาจะกรอกจันทร์–ศุกร์ และส่งให้ท่านรับรองทีเดียวทั้งสัปดาห์
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Navigation shortcuts */}
                  <div className="pt-2 flex flex-wrap gap-2 border-t border-gray-100 dark:border-gray-800">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setSearchParams({
                          role: 'mentor',
                          menu: 'certify',
                          student: String(st.student_id),
                          tab: 'logs',
                        })
                      }
                      className="text-xs"
                    >
                      <ClipboardList className="w-3.5 h-3.5 mr-1" />
                      รับรองบันทึก
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setSearchParams({
                          role: 'mentor',
                          menu: 'certify',
                          student: String(st.student_id),
                          tab: 'plan',
                        })
                      }
                      className="text-xs"
                    >
                      <Calendar className="w-3.5 h-3.5 mr-1" />
                      แผนปฏิบัติงาน
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setSearchParams({
                          role: 'mentor',
                          menu: 'certify',
                          student: String(st.student_id),
                          tab: 'draft',
                        })
                      }
                      className="text-xs"
                    >
                      <FileText className="w-3.5 h-3.5 mr-1" />
                      ร่างรายงาน
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        navigate(`/dashboard?role=mentor&menu=final_evaluation&student=${st.student_id}`)
                      }
                      className="text-xs ml-auto"
                    >
                      แบบประเมิน 15/16
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Bottom Note: ไม่ใช่ประตูของนักศึกษา */}
      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl p-4 sm:p-5 bg-white dark:bg-gray-900/60 flex items-start gap-3.5 text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed shadow-xs">
        <Info className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
        <div>
          การรับรองของท่าน <strong>ไม่ใช่ประตูของนักศึกษา</strong> — นักศึกษากดส่งแล้วถือว่าส่งแล้วทันที การรับรองเป็นข้อมูลเพิ่มว่าพี่เลี้ยงได้อ่านจริง ดังนั้นถ้าท่านรับรองช้า นักศึกษาจะไม่ติดค้างเพราะความล่าช้าที่ไม่ใช่ความผิดของเขา · และท่านรับรองย้อนหลังได้เสมอ ไม่มีด่านปฏิทินปิดกั้นฝั่งพี่เลี้ยง
        </div>
      </div>
    </div>
  );
};

export default MentorHome;
