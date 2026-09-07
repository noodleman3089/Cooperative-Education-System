import React from 'react';
import { Clock } from 'lucide-react';
import Button from './ui/Button';
import type { PhaseGroup } from './CoopStepperBar';

interface CoopNowCardProps {
  phases: PhaseGroup[];
  /** กำหนดส่งของขั้นปัจจุบัน ถ้ามี — คำนวณมาจากหน้าจอที่เรียก ไม่ใช่จากในนี้ */
  deadline?: { label: string; date: string; daysLeft: number; overdue: boolean } | null;
}

// ตัดเลขนำหน้าออก ("1.2 ลงนามบนแบบคำร้อง" → "ลงนามบนแบบคำร้อง") — เลขข้อมีที่อยู่ของมัน
// อยู่แล้วบนแถบความคืบหน้า การแบกมาไว้บนหัวเรื่องใหญ่ทำให้อ่านเหมือนสารบัญ ไม่ใช่คำสั่ง
const stripNumber = (text: string): string => text.replace(/^[\d.]+\s*/, '').trim();

/**
 * การ์ดใบเดียวที่ตอบว่า **"ตอนนี้ต้องทำอะไร"**
 *
 * หน้าแรกของนักศึกษาเดิมเปิดด้วยแบนเนอร์โปรไฟล์ — รูป ชื่อ เกรด อาจารย์ที่ปรึกษา
 * คือมันตอบว่า *"คุณคือใคร"* ซึ่งเป็นข้อมูลที่นักศึกษารู้อยู่แล้ว ส่วนคำถามที่เขาเปิด
 * หน้านี้มาถามจริงๆ คือ *"แล้วตอนนี้ฉันต้องทำอะไร"* ซึ่งเดิมต้องไล่หาเอาจากแถบ
 * ความคืบหน้าที่อยู่ถัดลงไปอีกจอหนึ่ง
 *
 * ⛔ **ไม่มีการตัดสินขั้นตอนเกิดขึ้นในไฟล์นี้เลย** — มันอ่าน `phases` ชุดเดียวกับที่
 * `CoopStepperBar` ใช้ แล้วหยิบ subStep แรกที่ `status === 'active'` การคำนวณว่าใคร
 * อยู่ขั้นไหนยังอยู่ที่เดิมที่เดียว ถ้าเขียนเงื่อนไขซ้ำในนี้ วันหนึ่งการ์ดกับแถบความคืบหน้า
 * จะบอกคนละเรื่องกัน แล้วไม่มีทางรู้ว่าอันไหนถูก
 */
const CoopNowCard: React.FC<CoopNowCardProps> = ({ phases, deadline }) => {
  const activePhase = phases.find(p => p.status === 'active');
  const current =
    phases.flatMap(p => p.subSteps).find(s => s.status === 'active') ?? null;

  // ทุกขั้นเสร็จหมดแล้ว — ไม่ต้องเสกงานขึ้นมาให้ทำ
  if (!current) return null;

  return (
    <section
      className="page-enter flex overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
      data-testid="now-card"
    >
      <div className="w-1.5 shrink-0 bg-brand-blue" aria-hidden="true" />

      <div className="flex flex-1 flex-col gap-6 p-6 md:flex-row md:items-start md:gap-7 md:p-7">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <span className="text-xs font-bold tracking-wider text-brand-blue dark:text-blue-400">
            ขั้นตอนที่ต้องทำตอนนี้
            {activePhase ? ` · ${stripNumber(activePhase.title)}` : ''}
          </span>

          <h2 className="text-2xl font-extrabold leading-snug text-gray-900 dark:text-white">
            {stripNumber(current.title)}
          </h2>

          <p className="max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {current.description}
          </p>

          {/* ปุ่มมาจาก subStep เดียวกัน — ขั้นที่ระบบทำอะไรให้ไม่ได้ (รอเจ้าหน้าที่ รอคณบดี
              ลงนาม) จะไม่มี actionLabel มาด้วย และการ์ดก็ไม่ควรมีปุ่มให้กดเล่น */}
          {current.actionLabel && current.onAction && (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Button onClick={current.onAction} data-testid="now-card-action">
                {current.actionLabel}
              </Button>
            </div>
          )}
        </div>

        {deadline && (
          <div
            className={`flex w-full shrink-0 flex-col gap-2 rounded-xl border p-4 md:w-60 ${
              deadline.overdue
                ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
                : 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30'
            }`}
          >
            <div className="flex items-center gap-2">
              <Clock
                className={`h-4 w-4 shrink-0 ${
                  deadline.overdue
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              />
              <span
                className={`text-xs font-bold ${
                  deadline.overdue
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {deadline.label}
              </span>
            </div>

            <span
              className={`text-lg font-extrabold ${
                deadline.overdue
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {deadline.date}
            </span>

            <span
              className={`text-xs leading-relaxed ${
                deadline.overdue
                  ? 'text-red-800 dark:text-red-300'
                  : 'text-amber-800 dark:text-amber-300'
              }`}
            >
              {deadline.overdue
                ? `เลยกำหนดมาแล้ว ${Math.abs(deadline.daysLeft)} วัน — ติดต่อเจ้าหน้าที่สหกิจศึกษา`
                : deadline.daysLeft === 0
                  ? 'ครบกำหนดวันนี้'
                  : `เหลืออีก ${deadline.daysLeft} วัน`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
};

export default CoopNowCard;
