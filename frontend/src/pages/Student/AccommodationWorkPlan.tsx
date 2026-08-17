import React, { useState, useEffect, useContext } from 'react';
import PageSkeleton from '../../components/ui/Skeleton';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import { Home, Calendar, Plus, Trash2, Check, ChevronDown, Copy } from 'lucide-react';
import AlertBanner from '../../components/ui/AlertBanner';
import { getErrorMessage } from '../../utils/errors';
import type { WeeklyPlan } from '../../types/api';

interface Accommodation {
  address: string;
  phone: string;
  emergency_contact: string;
  emergency_relationship: string;
  emergency_phone: string;
}

interface WeeklyPlan {
  plan_id?: number;
  week_number: number;
  start_date: string;
  end_date: string;
  tasks: string;
}

const AccommodationWorkPlan: React.FC = () => {
  const auth = useContext(AuthContext);
  const [step, setStep] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [accommodation, setAccommodation] = useState<Accommodation>({
    address: '',
    phone: '',
    emergency_contact: '',
    emergency_relationship: '',
    emergency_phone: ''
  });

  const MIN_WEEKS = 16;
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);

  /** The one date the other 32 are derived from. Not sent to the server. */
  const [coopStartDate, setCoopStartDate] = useState<string>('');
  /** Only one week is expanded at a time; the rest are one line each. */
  const [openWeek, setOpenWeek] = useState<number | null>(1);
  /** Set when unsaved work was found in this browser and restored. */
  const [restoredDraft, setRestoredDraft] = useState(false);

  const DRAFT_KEY = `accommodation_plan_draft_${auth?.user?.userId ?? 'anon'}`;

  useEffect(() => {
    loadData();
  }, []);

  /**
   * Keep unsaved work in the browser. This form is agreed with the mentor, so
   * it is often filled in over a meeting rather than in one sitting — and it
   * was 48 fields with nothing behind them: one closed tab and the lot was
   * gone. Cleared on a successful submit, so a draft existing at all means
   * there are edits the server has not seen.
   */
  useEffect(() => {
    if (isLoading) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ accommodation, weeklyPlans, coopStartDate })
      );
    } catch {
      /* private mode, or quota — the form still works, just without a net */
    }
  }, [accommodation, weeklyPlans, coopStartDate, isLoading, DRAFT_KEY]);

  /** Local YYYY-MM-DD. toISOString() would shift the day in UTC+7. */
  const toDateInput = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /**
   * Weeks run consecutively, so asking for 32 dates was asking the student to
   * do arithmetic the page can do. One date in, Monday–Friday out for every
   * week; individual weeks stay editable for public holidays.
   */
  const applyCoopStartDate = (iso: string) => {
    setCoopStartDate(iso);
    if (!iso) return;
    const base = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(base.getTime())) return;

    setWeeklyPlans((plans) =>
      plans.map((p, i) => {
        const start = new Date(base);
        start.setDate(base.getDate() + i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 4);
        return { ...p, start_date: toDateInput(start), end_date: toDateInput(end) };
      })
    );
  };

  const copyFromPreviousWeek = (weekNum: number) => {
    const idx = weeklyPlans.findIndex((p) => p.week_number === weekNum);
    if (idx <= 0) return;
    const previous = weeklyPlans[idx - 1];
    updatePlan(weekNum, 'tasks', previous.tasks);
  };

  const isWeekFilled = (p: WeeklyPlan) => !!(p.start_date && p.end_date && p.tasks.trim());
  const filledCount = weeklyPlans.filter(isWeekFilled).length;

  /** Build a blank 16-week plan. */
  const blankWeeks = (): WeeklyPlan[] =>
    Array.from({ length: MIN_WEEKS }, (_, i) => ({
      week_number: i + 1,
      start_date: '',
      end_date: '',
      tasks: ''
    }));

  /**
   * A draft only exists if there are edits that were never submitted, so it
   * wins over whatever the server has. Saying so out loud matters — silently
   * showing different data from what is on record is its own kind of bug — so
   * the page offers to throw it away.
   */
  const applyDraftIfAny = (): boolean => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const draft = JSON.parse(raw);
      if (!draft?.weeklyPlans?.length) return false;
      setAccommodation(draft.accommodation);
      setWeeklyPlans(draft.weeklyPlans);
      setCoopStartDate(draft.coopStartDate || '');
      setRestoredDraft(true);
      return true;
    } catch {
      return false;
    }
  };

  const discardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* nothing to clear */
    }
    setRestoredDraft(false);
    loadData();
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.get(`/students/${auth?.user?.userId}/accommodation-plan`);

      if (res.accommodation) {
        setAccommodation({
          address: res.accommodation.address || '',
          phone: res.accommodation.phone || '',
          emergency_contact: res.accommodation.emergency_contact || '',
          emergency_relationship: res.accommodation.emergency_relationship || '',
          emergency_phone: res.accommodation.emergency_phone || ''
        });
      }

      if (res.weekly_plans && res.weekly_plans.length > 0) {
        setWeeklyPlans(res.weekly_plans.map((p: WeeklyPlan) => ({
          plan_id: p.plan_id,
          week_number: p.week_number,
          start_date: p.start_date ? new Date(p.start_date).toISOString().split('T')[0] : '',
          end_date: p.end_date ? new Date(p.end_date).toISOString().split('T')[0] : '',
          tasks: p.tasks || ''
        })));
      } else {
        setWeeklyPlans(blankWeeks());
      }
    } catch (err) {
      console.error('Failed to load accommodation and plan:', err);
      // Just show default form if no data found
      setWeeklyPlans(blankWeeks());
    } finally {
      // Unsaved edits from this browser take precedence over the stored record.
      applyDraftIfAny();
      setIsLoading(false);
    }
  };

  const handleNextStep = () => {
    // Validate step 1
    if (!accommodation.address || !accommodation.emergency_contact || !accommodation.emergency_phone || !accommodation.emergency_relationship) {
      setError('กรุณากรอกข้อมูลที่พักและข้อมูลผู้ติดต่อฉุกเฉินให้ครบถ้วน');
      return;
    }
    setError(null);
    setStep(2);
  };

  const handlePrevStep = () => {
    setStep(1);
    setError(null);
  };

  const handleAddWeek = () => {
    const nextWeekNum = weeklyPlans.length > 0 ? Math.max(...weeklyPlans.map(p => p.week_number)) + 1 : 1;
    setWeeklyPlans([
      ...weeklyPlans,
      { week_number: nextWeekNum, start_date: '', end_date: '', tasks: '' }
    ]);
  };

  const handleRemoveWeek = (weekNum: number) => {
    if (weeklyPlans.length <= MIN_WEEKS) {
      setError(`ไม่สามารถลบสัปดาห์ได้ ต้องมีอย่างน้อย ${MIN_WEEKS} สัปดาห์`);
      return;
    }
    setWeeklyPlans(weeklyPlans.filter(p => p.week_number !== weekNum));
    setError(null);
  };

  const updatePlan = (weekNum: number, field: keyof WeeklyPlan, value: string) => {
    setWeeklyPlans(plans => plans.map(p => 
      p.week_number === weekNum ? { ...p, [field]: value } : p
    ));
  };

  const handleSubmit = async () => {
    // Validate step 2
    if (weeklyPlans.length < MIN_WEEKS) {
      setError(`กรุณากรอกแผนปฏิบัติงานให้ครบอย่างน้อย ${MIN_WEEKS} สัปดาห์`);
      return;
    }

    const isIncomplete = weeklyPlans.some(p => !p.start_date || !p.end_date || !p.tasks.trim());
    if (isIncomplete) {
      setError('กรุณากรอกรายละเอียดแผนปฏิบัติงาน วันเริ่มต้น วันสิ้นสุด ให้ครบทุกสัปดาห์');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await api.post(`/students/${auth?.user?.userId}/accommodation-plan`, {
        accommodation,
        weekly_plans: weeklyPlans
      });
      setSuccessMsg('บันทึกข้อมูลที่พักและแผนปฏิบัติงานเรียบร้อยแล้ว ข้อมูลจะถูกส่งไปยังอาจารย์นิเทศ');
      // On record now, so the local copy has nothing left to protect.
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* nothing to clear */
      }
      setRestoredDraft(false);
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(getErrorMessage(err, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <PageSkeleton variant='form' />
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 page-enter">
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-white">แบบแจ้งที่พักและแผนปฏิบัติงานสหกิจศึกษา</h2>
        <p className="text-xs text-gray-400 mt-1">
          กรุณากรอกข้อมูลที่พักระหว่างการฝึกงานและแผนการทำงานรายสัปดาห์ภายในสัปดาห์แรกของการฝึกงาน
        </p>
      </div>

      <AlertBanner variant="error" message={error} />

      <AlertBanner variant="success" message={successMsg} />

      {/* Restoring silently would mean showing something other than what is on
          record without saying so. Say it, and offer the way back. */}
      {restoredDraft && (
        <AlertBanner
          variant="info"
          message={
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="flex-1">
                กู้คืนข้อมูลที่กรอกค้างไว้ในเครื่องนี้แล้ว (ยังไม่ได้ส่งเข้าระบบ)
              </span>
              <button
                type="button"
                onClick={discardDraft}
                className="shrink-0 text-xs font-bold underline hover:no-underline"
              >
                ทิ้งฉบับร่าง แล้วโหลดข้อมูลที่บันทึกไว้
              </button>
            </div>
          }
        />
      )}

      {/* Stepper */}
      <div className="flex items-center justify-center mb-8">
        <div className="flex items-center w-full max-w-sm">
          <div className={`flex flex-col items-center flex-1 transition-colors ${step >= 1 ? 'text-brand-blue' : 'text-gray-400'} dark:text-blue-400`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold mb-2 transition-colors ${step >= 1 ? 'bg-brand-blue text-white shadow-md' : 'bg-gray-200 dark:bg-gray-800 text-gray-500'} dark:text-gray-400`}>
              <Home className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium">ข้อมูลที่พัก</span>
          </div>
          <div className={`h-1 flex-1 mx-2 rounded-full transition-colors ${step >= 2 ? 'bg-brand-blue' : 'bg-gray-200 dark:bg-gray-800'}`}></div>
          <div className={`flex flex-col items-center flex-1 transition-colors ${step >= 2 ? 'text-brand-blue' : 'text-gray-400'} dark:text-blue-400`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold mb-2 transition-colors ${step >= 2 ? 'bg-brand-blue text-white shadow-md' : 'bg-gray-200 dark:bg-gray-800 text-gray-500'} dark:text-gray-400`}>
              <Calendar className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium">แผนปฏิบัติงาน</span>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
        {step === 1 ? (
          <div className="p-6 md:p-8 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                ข้อมูลที่พักอาศัยปัจจุบัน (ระหว่างฝึกงาน)
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ที่อยู่ครบถ้วน (บ้านเลขที่, ซอย, ถนน, ตำบล, อำเภอ, จังหวัด, รหัสไปรษณีย์) *
                  </label>
                  <textarea
                    rows={3}
                    value={accommodation.address}
                    onChange={e => setAccommodation({...accommodation, address: e.target.value})}
                    placeholder="กรอกที่อยู่ปัจจุบันให้ชัดเจน เพื่อประโยชน์ในการติดต่อ..."
                    className="w-full px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-blue focus:border-brand-blue outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    เบอร์โทรศัพท์ที่พัก (ถ้ามี)
                  </label>
                  <input
                    type="text"
                    value={accommodation.phone}
                    onChange={e => setAccommodation({...accommodation, phone: e.target.value})}
                    placeholder="เช่น 02-123-4567 ต่อ 101"
                    className="w-full px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-blue focus:border-brand-blue outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100 dark:border-gray-800">
              <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                บุคคลติดต่อกรณีฉุกเฉิน (สำคัญมาก)
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ชื่อ-นามสกุล บุคคลติดต่อฉุกเฉิน *
                  </label>
                  <input
                    type="text"
                    value={accommodation.emergency_contact}
                    onChange={e => setAccommodation({...accommodation, emergency_contact: e.target.value})}
                    placeholder="เช่น นายสมชาย ใจดี"
                    className="w-full px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-blue focus:border-brand-blue outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    ความสัมพันธ์ *
                  </label>
                  <input
                    type="text"
                    value={accommodation.emergency_relationship}
                    onChange={e => setAccommodation({...accommodation, emergency_relationship: e.target.value})}
                    placeholder="เช่น บิดา, มารดา, พี่ชาย"
                    className="w-full px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-blue focus:border-brand-blue outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    เบอร์โทรศัพท์ฉุกเฉิน *
                  </label>
                  <input
                    type="text"
                    value={accommodation.emergency_phone}
                    onChange={e => setAccommodation({...accommodation, emergency_phone: e.target.value})}
                    placeholder="เช่น 089-123-4567"
                    className="w-full px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-blue focus:border-brand-blue outline-none transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={handleNextStep}
                className="px-6 py-2.5 rounded-xl font-bold text-white bg-brand-blue hover:bg-blue-700 shadow-sm transition-all text-sm"
              >
                ถัดไป: กรอกแผนปฏิบัติงาน
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                  แผนปฏิบัติงานรายสัปดาห์ (Weekly Work Plan)
                </h3>
                <p className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                  กรุณากรอกแผนงานที่หารือร่วมกับพนักงานที่ปรึกษา (Mentor) ตลอดระยะเวลาการปฏิบัติงานอย่างน้อย {MIN_WEEKS} สัปดาห์
                </p>
              </div>
              <button
                onClick={handleAddWeek}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-brand-blue bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors border border-blue-100 dark:border-blue-800"
              >
                <Plus className="w-3.5 h-3.5" />
                เพิ่มสัปดาห์
              </button>
            </div>

            {/* One date instead of thirty-two. */}
            <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/60 dark:border-blue-900/50 dark:bg-blue-950/20 space-y-2">
              <label className="block text-sm font-bold text-gray-800 dark:text-white">
                วันแรกที่เริ่มปฏิบัติงาน
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                กรอกวันเดียว ระบบจะไล่วันจันทร์–ศุกร์ให้ครบทุกสัปดาห์ แก้รายสัปดาห์ได้ภายหลังหากติดวันหยุด
              </p>
              <input
                type="date"
                value={coopStartDate}
                onChange={(e) => applyCoopStartDate(e.target.value)}
                className="w-full sm:w-56 px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-brand-blue"
              />
            </div>

            {/* ── ตัวนับความคืบหน้า ── ลบทั้งบล็อกนี้ได้ถ้าไม่ต้องการ ── */}
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-blue transition-all duration-500"
                  style={{ width: `${(filledCount / weeklyPlans.length) * 100}%` }}
                />
              </div>
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
                กรอกแล้ว {filledCount} / {weeklyPlans.length} สัปดาห์
              </span>
            </div>
            {/* ── จบตัวนับความคืบหน้า ── */}

            {/* Sixteen expanded cards is what made this page four screens tall on
                a phone. Collapsed, the whole plan is readable at once and only
                the week being edited takes room. */}
            <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              {weeklyPlans.map((plan, index) => {
                const filled = isWeekFilled(plan);
                const isOpen = openWeek === plan.week_number;
                return (
                  <div key={plan.week_number} className="bg-white dark:bg-gray-900">
                    <button
                      type="button"
                      onClick={() => setOpenWeek(isOpen ? null : plan.week_number)}
                      aria-expanded={isOpen}
                      // Clicked by test id, asserted by Thai text — aria-expanded
                      // alone also matches the navbar's notification bell.
                      data-testid="week-row"
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <span
                        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          filled
                            ? 'bg-emerald-600 text-white'
                            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {filled ? <Check className="w-3.5 h-3.5" /> : plan.week_number}
                      </span>

                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
                          สัปดาห์ที่ {plan.week_number}
                          {plan.start_date && (
                            <span className="ml-2 font-normal text-xs text-gray-400">
                              {new Date(plan.start_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                              {' – '}
                              {plan.end_date &&
                                new Date(plan.end_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </span>
                        <span className={`block text-xs truncate ${plan.tasks.trim() ? 'text-gray-500 dark:text-gray-400' : 'text-gray-400 italic'}`}>
                          {plan.tasks.trim() || 'ยังไม่ได้กรอกลักษณะงาน'}
                        </span>
                      </span>

                      <ChevronDown
                        aria-hidden="true"
                        className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 space-y-3 bg-gray-50/60 dark:bg-gray-800/40">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                              วันที่เริ่มต้น (จันทร์) *
                            </label>
                            <input
                              type="date"
                              value={plan.start_date}
                              onChange={e => updatePlan(plan.week_number, 'start_date', e.target.value)}
                              className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-brand-blue"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                              วันที่สิ้นสุด (ศุกร์) *
                            </label>
                            <input
                              type="date"
                              value={plan.end_date}
                              onChange={e => updatePlan(plan.week_number, 'end_date', e.target.value)}
                              className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-brand-blue"
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                              ลักษณะงานที่ปฏิบัติ / หัวข้อการเรียนรู้ *
                            </label>
                            {index > 0 && (
                              <button
                                type="button"
                                onClick={() => copyFromPreviousWeek(plan.week_number)}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue dark:text-blue-400 hover:underline"
                              >
                                <Copy className="w-3 h-3" />
                                คัดลอกจากสัปดาห์ที่ {weeklyPlans[index - 1].week_number}
                              </button>
                            )}
                          </div>
                          <textarea
                            rows={3}
                            value={plan.tasks}
                            onChange={e => updatePlan(plan.week_number, 'tasks', e.target.value)}
                            placeholder="อธิบายลักษณะงานที่จะทำในสัปดาห์นี้..."
                            className="w-full px-3 py-2 text-xs border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:border-brand-blue resize-none"
                          />
                        </div>

                        {weeklyPlans.length > MIN_WEEKS && index >= MIN_WEEKS && (
                          // Was opacity-0 until hover, which on a touch screen
                          // meant a control nobody could see.
                          <button
                            type="button"
                            onClick={() => handleRemoveWeek(plan.week_number)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            ลบสัปดาห์นี้
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center pt-6 mt-6 border-t border-gray-100 dark:border-gray-800 gap-4">
              <button
                onClick={handlePrevStep}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all text-sm"
              >
                ย้อนกลับ: ข้อมูลที่พัก
              </button>
              
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || weeklyPlans.some(p => !p.start_date || !p.end_date || !p.tasks.trim())}
                className={`w-full sm:w-auto px-8 py-2.5 rounded-xl font-bold text-white transition-all text-sm shadow-md ${
                  isSubmitting || weeklyPlans.some(p => !p.start_date || !p.end_date || !p.tasks.trim())
                    ? 'bg-gray-400 cursor-not-allowed opacity-70'
                    : 'bg-green-600 hover:bg-green-700 hover:shadow-lg'
                }`}
              >
                {isSubmitting ? 'กำลังบันทึกข้อมูล...' : 'บันทึกและส่งแผนปฏิบัติงาน'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccommodationWorkPlan;
