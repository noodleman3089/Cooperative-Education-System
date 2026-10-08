import React from 'react';
import { Check } from 'lucide-react';
import type { PhaseGroup } from './CoopStepperBar';

/**
 * หนึ่งขั้นบนเส้นทาง = การรวบ subStep จริงหลายอันเข้าเป็นเรื่องเดียวที่นักศึกษาพูดถึง
 *
 * `subStepIds` อ้าง id ของ subStep ใน `phases` — **สถานะไม่ได้คำนวณใหม่ที่นี่**
 * แต่อ่านจากของจริงแล้วสรุป: เสร็จทุกอันคือเสร็จ · มีอันไหน active คืออยู่ตรงนี้
 */
export interface JourneyStep {
  label: string;
  subStepIds: string[];
  /** ข้อความสถานะตอนที่ยังไม่ถึง — บางขั้นรอคนอื่น ไม่ใช่รอเรา */
  pendingLabel?: string;
  /**
   * บังคับสถานะ แทนการสรุปจาก subStep
   *
   * มีไว้สำหรับขั้นที่ **ไม่มี subStep ใน `phases` เพราะมันเกิดก่อนหน้านั้น** —
   * เช่น 'กรอกประวัติ' ซึ่งจบไปแล้วเสมอเมื่อหน้าจอนี้ถูกเรนเดอร์ (ไม่มีแถวใน
   * `students` แดชบอร์ดจะตอบ 404 แล้วขึ้นหน้าให้ไปกรอกประวัติแทน)
   */
  state?: StepState;
}

interface CoopJourneyBarProps {
  phases: PhaseGroup[];
  steps: JourneyStep[];
}

export type StepState = 'completed' | 'active' | 'pending';

/**
 * เส้นทางสหกิจแบบย่อ — เห็นทั้งเส้นทางในแถวเดียว
 *
 * ของเดิมคือ `CoopStepperBar` ซึ่งมีแท็บเฟส ปุ่มพับ/กาง และการ์ดขั้นย่อยเต็มจอ
 * มันตอบได้ทุกคำถามแต่ต้องอ่านก่อนถึงจะเจอคำตอบ ส่วนแถบนี้ตอบคำถามเดียว —
 * *"ไปถึงไหนแล้ว และเหลืออีกเท่าไหร่"* — โดยไม่ต้องกดอะไรเลย
 *
 * ⛔ ตัวเต็มยังอยู่ ไม่ได้ลบทิ้ง — หน้าแรกซ่อนไว้ใต้ปุ่ม "ดูรายละเอียดทุกขั้นตอน"
 * เพราะขั้นย่อยบางอันมีปุ่มลงมือของตัวเอง การตัดทิ้งเท่ากับตัดความสามารถ
 */
const CoopJourneyBar: React.FC<CoopJourneyBarProps> = ({ phases, steps }) => {
  const allSubSteps = phases.flatMap(p => p.subSteps);
  const statusOf = (id: string) => allSubSteps.find(s => s.id === id)?.status;

  const resolved: { label: string; pendingLabel?: string; state: StepState }[] = steps.map(step => {
    if (step.state) return { ...step, state: step.state };
    const statuses = step.subStepIds.map(statusOf).filter(Boolean) as StepState[];
    if (statuses.length > 0 && statuses.every(s => s === 'completed')) {
      return { ...step, state: 'completed' };
    }
    if (statuses.some(s => s === 'active')) return { ...step, state: 'active' };
    return { ...step, state: 'pending' };
  });

  const doneCount = resolved.filter(s => s.state === 'completed').length;

  return (
    <section
      data-testid="journey-bar"
      className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">เส้นทางสหกิจของคุณ</h3>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          ผ่านแล้ว {doneCount} จาก {resolved.length} ขั้น
        </span>
      </div>

      {/* แถวเดียวบนจอกว้าง · จอแคบไหลเป็นสองคอลัมน์แทนการบีบจนอ่านไม่ออก */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {resolved.map(step => (
          <div key={step.label} data-testid="journey-step" data-state={step.state} className="flex flex-col gap-2.5">
            <div
              className={`h-1.5 rounded-full ${
                step.state === 'completed'
                  ? 'bg-emerald-700 dark:bg-emerald-500'
                  : step.state === 'active'
                    ? 'bg-brand-blue'
                    : 'bg-gray-200 dark:bg-gray-700'
              }`}
            />

            {step.state === 'completed' ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} />
                เสร็จแล้ว
              </span>
            ) : step.state === 'active' ? (
              <span className="flex items-center gap-1.5 text-xs font-bold text-brand-blue dark:text-blue-400">
                <span className="h-2 w-2 shrink-0 rounded-full bg-current" />
                ตอนนี้
              </span>
            ) : (
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {step.pendingLabel ?? 'ยังไม่ถึง'}
              </span>
            )}

            <span
              className={`text-xs leading-relaxed ${
                step.state === 'active'
                  ? 'font-semibold text-gray-900 dark:text-white'
                  : step.state === 'completed'
                    ? 'text-gray-700 dark:text-gray-300'
                    : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default CoopJourneyBar;
