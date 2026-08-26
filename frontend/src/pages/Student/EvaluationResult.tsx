import React, { useState } from 'react';
import { ClipboardCheck, Lock } from 'lucide-react';
import PageSkeleton from '../../components/ui/Skeleton';
import AlertBanner from '../../components/ui/AlertBanner';
import { useDashboardData } from '../../hooks/useDashboardData';
import api from '../../services/api';
import { getErrorMessage, getErrorStatus } from '../../utils/errors';
import {
  SAHATKIT_15_SECTIONS,
  SAHATKIT_16_ITEMS,
  SAHATKIT_16_SCALE,
  WOULD_HIRE_CHOICES,
} from '../../config/evaluationRubric';

/**
 * ผลประเมินที่พนักงานที่ปรึกษา (พี่เลี้ยง) ให้ — ฝั่งนักศึกษา อ่านอย่างเดียว
 *
 * บนกระดาษ สหกิจ 15/16 ใส่ซองปิดผนึกประทับตรา "ลับ" ซึ่งเจตนาคือกันนักศึกษาแก้คะแนน
 * ระหว่างถือซองมาส่ง — ในระบบพี่เลี้ยงกรอกเข้าฐานข้อมูลตรงๆ นักศึกษาแก้ไม่ได้อยู่แล้ว
 * จึงเปิดให้ดูได้ **หลังสิ้นสุดช่วงปฏิบัติงานตามปฏิทิน** (เจ้าของเคาะ 2026-08-26)
 *
 * เซิร์ฟเวอร์เป็นคนตัดสินว่าเปิดหรือยัง (`GET /final-evaluations/my-result` ตอบ 403
 * พร้อมข้อความที่บอกวันที่) — หน้านี้ไม่คิดเงื่อนไขเวลาเองซ้ำ เพราะสองที่จะเพี้ยนกันได้
 */

interface FormResult {
  form_code: string;
  scores_detail: Record<string, unknown>;
  total_score: number | null;
  max_total: number | null;
  submitted_at: string | null;
}

interface MyResult {
  sahatkit_15: FormResult | null;
  sahatkit_16: FormResult | null;
}

/** คะแนนหนึ่งข้อจาก JSONB — คืน null เมื่อพี่เลี้ยงติ๊ก "–" หรือไม่มีค่า */
const readScore = (detail: Record<string, unknown>, key: string): number | null => {
  const raw = detail[key];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
};

const readText = (detail: Record<string, unknown>, key: string): string => {
  const raw = detail[key];
  return typeof raw === 'string' ? raw.trim() : '';
};

const formatThai = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
};

/** แถวคะแนนหนึ่งข้อ — ใช้ร่วมกันทั้งสองใบ */
const ScoreRow: React.FC<{ no: string; label: string; score: number | null; max: number }> = ({
  no,
  label,
  score,
  max,
}) => (
  <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2 last:border-0 dark:border-gray-800">
    <p className="text-sm text-gray-700 dark:text-gray-300">
      <span className="mr-2 font-semibold text-gray-500 dark:text-gray-400">{no}</span>
      {label}
    </p>
    <p className="shrink-0 text-sm font-bold text-gray-900 dark:text-gray-100">
      {score === null ? (
        <span className="font-normal text-gray-500 dark:text-gray-400">ไม่มีข้อมูล</span>
      ) : (
        <>
          {score}
          <span className="font-normal text-gray-500 dark:text-gray-400"> / {max}</span>
        </>
      )}
    </p>
  </div>
);

/** กล่องข้อความที่พี่เลี้ยงเขียนถึงนักศึกษา — ไม่แสดงเลยถ้าเว้นว่างไว้ */
const CommentBlock: React.FC<{ title: string; body: string }> = ({ title, body }) =>
  body ? (
    <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/60">
      <p className="mb-1 text-sm font-bold text-gray-800 dark:text-gray-200">{title}</p>
      <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{body}</p>
    </div>
  ) : null;

const TotalBadge: React.FC<{ total: number | null; max: number | null }> = ({ total, max }) => (
  <span className="rounded-full bg-blue-50 px-4 py-1.5 text-lg font-extrabold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
    {total ?? '-'}
    <span className="text-sm font-bold text-blue-600 dark:text-blue-400"> / {max ?? '-'}</span>
  </span>
);

const EvaluationResult: React.FC = () => {
  const [result, setResult] = useState<MyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 403 = ยังไม่ถึงเวลาเปิด ไม่ใช่ความผิดพลาด จึงแยกออกจาก error เพื่อให้พาดหัวคนละแบบ */
  const [lockedReason, setLockedReason] = useState<string | null>(null);

  const load = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const res = await api.get('/final-evaluations/my-result');
      setResult(res.data as MyResult);
      setError(null);
      setLockedReason(null);
    } catch (err) {
      if (getErrorStatus(err) === 403) {
        setLockedReason(getErrorMessage(err, 'ยังไม่ถึงเวลาที่เปิดให้ดูผลประเมิน'));
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

  if (lockedReason) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <Lock className="mx-auto mb-3 h-10 w-10 text-gray-400 dark:text-gray-500" />
          <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">
            ยังไม่เปิดให้ดูผลประเมิน
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="eval-locked-reason">
            {lockedReason}
          </p>
        </div>
      </div>
    );
  }

  const s15 = result?.sahatkit_15 ?? null;
  const s16 = result?.sahatkit_16 ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-gray-900 dark:text-gray-100">
          <ClipboardCheck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          ผลการประเมินจากพนักงานที่ปรึกษา
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          คะแนนที่พี่เลี้ยงในสถานประกอบการให้ไว้ ตามแบบประเมิน สหกิจ 15 และ สหกิจ 16
          — ดูได้อย่างเดียว แก้ไขไม่ได้
        </p>
      </div>

      {error && <AlertBanner variant="error" message={error} />}

      {!s15 && !s16 && !error && (
        <AlertBanner
          variant="info"
          message="พี่เลี้ยงยังไม่ได้ส่งแบบประเมินของคุณเข้าระบบ เมื่อส่งแล้วคะแนนจะขึ้นที่หน้านี้"
        />
      )}

      {s15 && (
        <section
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          data-testid="eval-result-sahatkit-15"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                สหกิจ 15 — แบบประเมินผลนักศึกษา
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                คะแนนชุดนี้ใช้ประกอบการตัดเกรด
                {s15.submitted_at ? ` · ส่งเมื่อ ${formatThai(s15.submitted_at)}` : ''}
              </p>
            </div>
            <TotalBadge total={s15.total_score} max={s15.max_total} />
          </div>

          <div className="space-y-4">
            {SAHATKIT_15_SECTIONS.map((section) => (
              <div key={section.no}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">
                    {section.no}. {section.title}
                  </h3>
                  <span className="shrink-0 text-sm font-bold text-gray-700 dark:text-gray-300">
                    {section.items.reduce(
                      (sum, item) => sum + (readScore(s15.scores_detail, item.key) ?? 0),
                      0
                    )}
                    <span className="font-normal text-gray-500 dark:text-gray-400">
                      {' '}
                      / {section.max}
                    </span>
                  </span>
                </div>
                {section.items.map((item) => (
                  <ScoreRow
                    key={item.key}
                    no={item.no}
                    label={item.label}
                    score={readScore(s15.scores_detail, item.key)}
                    max={item.max}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            <CommentBlock title="จุดเด่นของนักศึกษา" body={readText(s15.scores_detail, 'strength')} />
            <CommentBlock
              title="ข้อควรปรับปรุง"
              body={readText(s15.scores_detail, 'improvement')}
            />
            <CommentBlock
              title="ความคิดเห็นเพิ่มเติม"
              body={readText(s15.scores_detail, 'other_comments')}
            />
            {(() => {
              const choice = WOULD_HIRE_CHOICES.find(
                (c) => c.value === readText(s15.scores_detail, 'would_hire')
              );
              return choice ? (
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/60">
                  <p className="mb-1 text-sm font-bold text-gray-800 dark:text-gray-200">
                    หากสำเร็จการศึกษาแล้ว สถานประกอบการจะรับเข้าทำงานหรือไม่
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{choice.label}</p>
                </div>
              ) : null;
            })()}
          </div>
        </section>
      )}

      {s16 && (
        <section
          className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          data-testid="eval-result-sahatkit-16"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                สหกิจ 16 — แบบประเมินรายงาน
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {SAHATKIT_16_SCALE}
                {s16.submitted_at ? ` · ส่งเมื่อ ${formatThai(s16.submitted_at)}` : ''}
              </p>
            </div>
            <TotalBadge total={s16.total_score} max={s16.max_total} />
          </div>

          {(readText(s16.scores_detail, 'report_title_th') ||
            readText(s16.scores_detail, 'report_title_en')) && (
            <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
              <span className="font-bold">หัวข้อรายงาน:</span>{' '}
              {readText(s16.scores_detail, 'report_title_th')}
              {readText(s16.scores_detail, 'report_title_en')
                ? ` (${readText(s16.scores_detail, 'report_title_en')})`
                : ''}
            </p>
          )}

          <div>
            {SAHATKIT_16_ITEMS.map((item) => (
              <ScoreRow
                key={item.key}
                no={item.no}
                label={item.label}
                score={readScore(s16.scores_detail, item.key)}
                max={item.max}
              />
            ))}
          </div>

          <div className="mt-5">
            <CommentBlock
              title="ความคิดเห็นเพิ่มเติม"
              body={readText(s16.scores_detail, 'other_comments')}
            />
          </div>
        </section>
      )}
    </div>
  );
};

export default EvaluationResult;
