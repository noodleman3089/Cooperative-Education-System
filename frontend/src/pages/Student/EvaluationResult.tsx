import React, { useState } from 'react';
import { ClipboardCheck, Calendar, Clock, AlertTriangle, MessageSquare } from 'lucide-react';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import { getErrorMessage, getErrorStatus } from '../../utils/errors';
import {
  SAHATKIT_15_SECTIONS,
  SAHATKIT_16_ITEMS,
  WOULD_HIRE_CHOICES,
} from '../../config/evaluationRubric';

interface FormResult {
  form_code: string;
  scores_detail: Record<string, unknown>;
  total_score: number | null;
  max_total: number | null;
  submitted_at: string | null;
}

interface EvaluationResultData {
  is_open?: boolean;
  end_date?: string | null;
  start_date?: string | null;
  mentor_name?: string | null;
  company_name?: string | null;
  sahatkit_15: FormResult | null;
  sahatkit_16: FormResult | null;
}

const formatThaiDate = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
};

const formatShortThaiDate = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
};

const readScore = (detail: Record<string, unknown> | undefined, key: string): number | null => {
  if (!detail) return null;
  const raw = detail[key];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
};

const readText = (detail: Record<string, unknown> | undefined, key: string): string => {
  if (!detail) return '';
  const raw = detail[key];
  return typeof raw === 'string' ? raw.trim() : '';
};

const EvaluationResult: React.FC = () => {
  const [data, setData] = useState<EvaluationResultData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lockedReason, setLockedReason] = useState<string | null>(null);

  const load = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const res = await api.get('/final-evaluations/my-result');
      const resData = (res as { data?: EvaluationResultData })?.data || null;
      setData(resData);
      setError(null);
      setLockedReason(null);
    } catch (err) {
      if (getErrorStatus(err) === 403) {
        const errData = (err as { response?: { data?: { message?: string; data?: EvaluationResultData } } })?.response?.data;
        setLockedReason(errData?.message || getErrorMessage(err, 'ยังไม่ถึงเวลาที่เปิดให้ดูผลประเมิน'));
        if (errData?.data) {
          setData(errData.data);
        }
        setError(null);
      } else if (!isBackground) {
        setError(getErrorMessage(err, 'ไม่สามารถโหลดผลประเมินได้'));
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useDashboardData(load, []);

  if (loading) return <PageSkeleton variant="table" />;

  const s15 = data?.sahatkit_15 ?? null;
  const s16 = data?.sahatkit_16 ?? null;
  const hasOne = Boolean((s15 && !s16) || (!s15 && s16));
  const hasNone = !s15 && !s16;

  // Calculate dates for Empty States
  const endDate = data?.end_date ? new Date(data.end_date) : null;
  const now = new Date();
  // Final week is roughly 7 days before end_date
  const finalWeekStart = endDate ? new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000) : null;
  const isBeforeFinalWeek = finalWeekStart ? now.getTime() < finalWeekStart.getTime() : false;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm space-y-2">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2.5">
          <ClipboardCheck className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          ผลประเมิน
        </h1>
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          คะแนนที่พี่เลี้ยงในสถานประกอบการให้ไว้ ตามแบบประเมิน สหกิจ 15 และ สหกิจ 16 —{' '}
          <strong className="text-gray-900 dark:text-white font-bold">
            นี่ไม่ใช่เกรด
          </strong>{' '}
          อาจารย์ที่ปรึกษาเป็นผู้ตัดเกรดโดยใช้คะแนนชุดนี้ประกอบ
        </p>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {/* 1. Empty State ก: ยังไม่ถึงสัปดาห์สุดท้าย */}
      {hasNone && isBeforeFinalWeek && (
        <div
          data-testid="eval-empty-not-yet"
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-8 shadow-sm flex items-start gap-4"
        >
          <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Calendar className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              ยังไม่ถึงช่วงประเมิน
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              พี่เลี้ยงจะประเมินใน<strong className="text-gray-900 dark:text-white">สัปดาห์สุดท้ายของการปฏิบัติงาน</strong> ตามคู่มือ — ของคุณคือสัปดาห์ของวันที่{' '}
              <span className="font-semibold text-gray-900 dark:text-gray-200">
                {finalWeekStart && endDate
                  ? `${formatShortThaiDate(finalWeekStart.toISOString())} – ${formatThaiDate(endDate.toISOString())}`
                  : 'สัปดาห์ที่ 16'}
              </span>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              ระหว่างนี้สิ่งที่ช่วยคะแนนได้คือส่งบันทึกให้ครบและส่งรายงานให้พี่เลี้ยงตรวจก่อนกำหนด
            </p>
          </div>
        </div>
      )}

      {/* 2. Empty State ข: ถึงเวลาแล้ว แต่พี่เลี้ยงยังไม่ส่ง (หรือถูกล็อกตามปฏิทิน) */}
      {hasNone && (!isBeforeFinalWeek || lockedReason) && (
        <div
          data-testid="eval-empty-waiting"
          className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-6 md:p-8 shadow-sm flex items-start gap-4"
        >
          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Clock className="w-6 h-6" />
          </div>
          <div className="space-y-3 flex-1">
            <div>
              <h2 className="text-lg font-bold text-amber-900 dark:text-amber-200">
                พี่เลี้ยงยังไม่ได้ส่งแบบประเมินเข้าระบบ
              </h2>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                {data?.mentor_name ? `คุณ${data.mentor_name}` : 'พนักงานที่ปรึกษา (พี่เลี้ยง)'}{' '}
                ยังไม่ได้ส่งแบบประเมิน สหกิจ 15 และ สหกิจ 16
              </p>
            </div>
            <p className="text-xs text-amber-700/90 dark:text-amber-400 leading-relaxed">
              ถ้าเลยกำหนดไปมากแล้ว ติดต่อเจ้าหน้าที่งานสหกิจศึกษาประจำคณะให้ช่วยตามได้ —{' '}
              <strong>อย่าไปกดดันพี่เลี้ยงเอง เพราะแบบประเมินต้องส่งเป็นความลับ</strong>
            </p>
            <div className="pt-1">
              <a
                href="/dashboard?menu=memos"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 text-amber-900 dark:text-amber-200 text-xs font-bold hover:bg-amber-50 dark:hover:bg-gray-700 transition"
              >
                <MessageSquare className="w-4 h-4" />
                ติดต่อเจ้าหน้าที่ผ่านบันทึกข้อความ
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 3. Partial State ค: มาแล้วใบเดียว */}
      {hasOne && (
        <div
          data-testid="eval-partial"
          className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <h2 className="text-base font-bold text-blue-900 dark:text-blue-200">
              มีคะแนนแล้ว 1 จาก 2 ใบ
            </h2>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              {s15
                ? 'สหกิจ 15 (ผลการปฏิบัติงาน) เข้ามาแล้ว · สหกิจ 16 (ประเมินรายงาน) ยังไม่เข้ามา'
                : 'สหกิจ 16 (ประเมินรายงาน) เข้ามาแล้ว · สหกิจ 15 (ผลการปฏิบัติงาน) ยังไม่เข้ามา'}
            </p>
          </div>
          <span className="px-3.5 py-1 rounded-full bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-bold shrink-0">
            1 / 2 ใบ
          </span>
        </div>
      )}

      {/* Confidentiality Reminder Card */}
      <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-800/40 rounded-2xl p-4 md:p-5 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-blue-700 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs md:text-sm text-blue-900 dark:text-blue-300 leading-relaxed">
          บนกระดาษ สหกิจ 15/16 ใส่ซองปิดผนึกประทับตรา “ลับ” — เจตนาคือ
          <strong>กันนักศึกษาแก้คะแนนระหว่างทาง ไม่ใช่กันนักศึกษาเห็นผล</strong>{' '}
          ในระบบนักศึกษาจึงเห็นคะแนนรายข้อได้ แต่แก้ไม่ได้และไม่มีเส้น API ให้เขียน
        </p>
      </div>

      {/* Two Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* สหกิจ 15 Summary */}
        <div
          data-testid="eval-summary-15"
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              สหกิจ 15 · ประเมินผลการปฏิบัติงาน
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              18 หัวข้อ {data?.mentor_name ? `· ประเมินโดย คุณ${data.mentor_name}` : ''}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {s15?.submitted_at ? `ส่งเข้าระบบ ${formatThaiDate(s15.submitted_at)}` : 'ยังไม่ส่ง'}
            </p>
          </div>

          <div className="flex flex-col items-center px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 shrink-0 min-w-22 text-center">
            <span
              data-testid="eval-total-15"
              className="text-2xl font-extrabold text-blue-700 dark:text-blue-300 leading-tight"
            >
              {s15?.total_score !== null && s15?.total_score !== undefined ? s15.total_score : '–'}
            </span>
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              จาก 100
            </span>
          </div>
        </div>

        {/* สหกิจ 16 Summary */}
        <div
          data-testid="eval-summary-16"
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm flex items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              สหกิจ 16 · ประเมินรายงาน
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              14 หัวข้อ {data?.mentor_name ? `· ประเมินโดย คุณ${data.mentor_name}` : ''}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {s16?.submitted_at ? `ส่งเข้าระบบ ${formatThaiDate(s16.submitted_at)}` : 'ยังไม่ส่ง'}
            </p>
          </div>

          <div className="flex flex-col items-center px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 shrink-0 min-w-22 text-center">
            <span
              data-testid="eval-total-16"
              className="text-2xl font-extrabold text-blue-700 dark:text-blue-300 leading-tight"
            >
              {s16?.total_score !== null && s16?.total_score !== undefined ? s16.total_score : '–'}
            </span>
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              จาก 70
            </span>
          </div>
        </div>
      </div>

      {/* สหกิจ 15 รายข้อ */}
      {s15 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm space-y-6">
          <div className="flex items-baseline justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              สหกิจ 15 — คะแนนรายหัวข้อ
            </h2>
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
              เต็ม 100 คะแนน
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            {SAHATKIT_15_SECTIONS.map((sec) => {
              const secTotal = sec.items.reduce(
                (sum, it) => sum + (readScore(s15.scores_detail, it.key) ?? 0),
                0
              );
              return (
                <div key={sec.no} className="space-y-2">
                  <div className="flex items-baseline justify-between border-b border-gray-100 dark:border-gray-700/60 pb-1.5">
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {sec.no}. {sec.title.split('(')[0].trim()}
                    </span>
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                      {secTotal} / {sec.max}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {sec.items.map((it) => {
                      const sc = readScore(s15.scores_detail, it.key);
                      const pct = sc !== null ? Math.round((sc / it.max) * 100) : 0;
                      return (
                        <div
                          key={it.key}
                          data-testid={`eval-item-${it.key}`}
                          className="grid grid-cols-[28px_1fr_90px_42px] gap-2.5 items-center py-1.5 border-b border-gray-50 dark:border-gray-800 last:border-0 text-xs"
                        >
                          <span className="font-semibold text-gray-400 dark:text-gray-500">
                            {it.no}
                          </span>
                          <span className="text-gray-700 dark:text-gray-300 truncate" title={it.label}>
                            {it.label.split('(')[0].trim()}
                          </span>
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-600 dark:bg-blue-400 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-right font-bold text-gray-900 dark:text-white">
                            {sc !== null ? `${sc}/${it.max}` : '–'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dash note */}
          <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-750/50 text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-gray-500 shrink-0" />
            <span>
              ขีด “–” แปลว่าพี่เลี้ยงติ๊กว่าไม่มีโอกาสได้ประเมินหัวข้อนั้น{' '}
              <strong className="text-gray-800 dark:text-gray-200">ไม่ใช่ได้ 0 คะแนน</strong>{' '}
              และหัวข้อนั้นไม่ถูกนับในคะแนนเต็ม
            </span>
          </div>

          {/* Strength and Improvement */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div
              data-testid="eval-strength"
              className="p-4 rounded-xl border border-green-200 dark:border-green-800/60 bg-green-50/50 dark:bg-green-950/20 space-y-1"
            >
              <h3 className="text-xs font-bold text-green-700 dark:text-green-300">
                จุดเด่นของนักศึกษา
              </h3>
              <p className="text-xs md:text-sm text-green-900 dark:text-green-200 leading-relaxed">
                {readText(s15.scores_detail, 'strength') || 'ไม่มีความคิดเห็นเพิ่มเติม'}
              </p>
            </div>

            <div
              data-testid="eval-improvement"
              className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 space-y-1"
            >
              <h3 className="text-xs font-bold text-amber-700 dark:text-amber-300">
                สิ่งที่ควรปรับปรุง
              </h3>
              <p className="text-xs md:text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
                {readText(s15.scores_detail, 'improvement') || 'ไม่มีความคิดเห็นเพิ่มเติม'}
              </p>
            </div>
          </div>

          {/* Would Hire */}
          <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-800/50 bg-blue-50/40 dark:bg-blue-950/20 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs md:text-sm font-bold text-blue-900 dark:text-blue-200">
              ถ้ามีตำแหน่งงานว่าง สถานประกอบการจะรับนักศึกษาคนนี้เข้าทำงานหรือไม่
            </span>
            <span
              data-testid="eval-would-hire"
              className="px-3 py-1 rounded-full bg-white dark:bg-gray-800 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 text-xs font-bold"
            >
              {(() => {
                const wh = readText(s15.scores_detail, 'would_hire');
                const choice = WOULD_HIRE_CHOICES.find((c) => c.value === wh);
                return choice ? choice.label : wh || 'ไม่ระบุ';
              })()}
            </span>
          </div>
        </div>
      )}

      {/* สหกิจ 16 รายข้อ */}
      {s16 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 md:p-7 shadow-sm space-y-5">
          <div className="flex items-baseline justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              สหกิจ 16 — คะแนนรายงาน 14 หัวข้อ
            </h2>
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              ทุกหัวข้อเต็ม 5 คะแนน
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
            {SAHATKIT_16_ITEMS.map((it) => {
              const sc = readScore(s16.scores_detail, it.key);
              const pct = sc !== null ? Math.round((sc / it.max) * 100) : 0;
              return (
                <div
                  key={it.key}
                  data-testid={`eval-item-${it.key}`}
                  className="grid grid-cols-[28px_1fr_90px_42px] gap-2.5 items-center py-2 border-b border-gray-50 dark:border-gray-800 text-xs"
                >
                  <span className="font-semibold text-gray-400 dark:text-gray-500">
                    {it.no}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300 truncate" title={it.label}>
                    {it.label}
                  </span>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 dark:bg-blue-400 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-right font-bold text-gray-900 dark:text-white">
                    {sc !== null ? `${sc}/${it.max}` : '–'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default EvaluationResult;
