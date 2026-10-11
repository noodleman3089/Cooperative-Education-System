import React, { useState, useCallback } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { goToMenu } from '../../utils/calendarMenus';
import CoopCalendarModal from '../CoopCalendarModal';
import { useCalendarGate, type CalendarGateState } from './useCalendarGate';

export type { CalendarGateState };

export interface CalendarGateProps {
  /** รหัสกิจกรรมในปฏิทิน เช่น 'report_outline', 'weekly_log', 'final_report' */
  activityKey: string;
  /** ข้อความระบุการกระทำ เช่น 'ส่งโครงร่างรายงาน', 'ส่งบันทึกการปฏิบัติงาน' */
  actionLabel: string;
  /** ข้อความบนปุ่มส่งเมื่อปิดใช้งาน (ดีฟอลต์ใช้ actionLabel เช่น 'ส่งโครงร่าง') */
  actionButtonLabel?: string;
  /** ชื่อกิจกรรมที่จะแสดงในการ์ด (ดีฟอลต์อ่านจาก label ในปฏิทิน) */
  activityTitle?: string;
  /** เมื่อคลิกลิงก์ "ดูปฏิทินสหกิจทั้งหมด" (หากไม่ระบุ จะเปิด CoopCalendarModal อัตโนมัติ) */
  onViewCalendar?: () => void;
  /** เมื่อคลิกปุ่ม "ยื่นคำร้องขอส่งย้อนหลัง" (หากไม่ระบุ จะพาไปเมนู 'memos') */
  onRequestLate?: () => void;
  /** โค้ดลูก หรือฟังก์ชัน render ที่รับสถานะ gate เข้าไป */
  children?: React.ReactNode | ((gate: CalendarGateState) => React.ReactNode);
  className?: string;
}

/**
 * คอมโพเนนต์ด่านปฏิทินสหกิจศึกษา ตามร่าง CalendarGate.dc.html
 *
 * กรณี ก: ยังไม่ถึงช่วงที่เปิดให้ทำ -> แสดงการ์ดสีเทา/ขาว แจ้งช่วงวันและนับถอยหลัง ปุ่มส่งปิด แต่ฟอร์มกรอกร่างได้
 * กรณี ข: เลยช่วงมาแล้ว -> แสดงการ์ดสีแดง แจ้งว่าปิดแล้ว พร้อมปุ่มยื่นคำร้องขอส่งย้อนหลัง (ไปหน้า memos)
 * กรณี ค: ในช่วง หรือระบบไม่รู้สถานะ -> ไม่แสดงการ์ดเตือนใดๆ (fail-open)
 */
export const CalendarGate: React.FC<CalendarGateProps> = ({
  activityKey,
  actionLabel,
  actionButtonLabel,
  activityTitle: customActivityTitle,
  onViewCalendar,
  onRequestLate,
  children,
  className = '',
}) => {
  const gate = useCalendarGate(activityKey);
  const [modalOpen, setModalOpen] = useState(false);

  const handleOpenCalendar = useCallback(() => {
    if (onViewCalendar) {
      onViewCalendar();
    } else {
      setModalOpen(true);
    }
  }, [onViewCalendar]);

  const handleRequestLate = useCallback(() => {
    if (onRequestLate) {
      onRequestLate();
    } else {
      goToMenu('memos');
    }
  }, [onRequestLate]);

  const resolvedActivityTitle =
    customActivityTitle || gate.activity?.label || actionLabel;

  const renderBanner = () => {
    // กรณี ก: ยังไม่ถึงช่วงที่เปิดให้ทำ
    if (gate.isUpcoming) {
      return (
        <div
          data-testid="calendar-gate-upcoming"
          className={`rounded-2xl border border-gray-200 bg-white p-5 md:p-6 shadow-sm flex items-start gap-4 dark:border-gray-800 dark:bg-gray-900 ${className}`}
        >
          <div className="w-[42px] h-[42px] rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="flex flex-col gap-2 grow">
            <span className="text-base font-bold text-gray-900 dark:text-gray-100">
              ยังไม่เปิดให้{actionLabel}
            </span>
            <span className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              ช่วง{resolvedActivityTitle}เปิด{' '}
              <strong className="text-gray-900 dark:text-gray-100">{gate.formattedRange}</strong>{' '}
              ตามปฏิทินสหกิจศึกษา
              {gate.daysRemaining !== null && gate.daysRemaining > 0
                ? ` · ตอนนี้ยังเหลืออีก ${gate.daysRemaining} วันจึงจะเปิด`
                : ''}
            </span>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <button
                type="button"
                disabled
                className="px-5 py-2.5 rounded-xl bg-gray-200 text-gray-400 dark:bg-gray-800 dark:text-gray-600 font-semibold text-sm cursor-not-allowed"
              >
                {actionButtonLabel || actionLabel}
              </button>
              <button
                type="button"
                data-testid="calendar-gate-btn-view-calendar"
                onClick={handleOpenCalendar}
                className="text-xs md:text-sm font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
              >
                ดูปฏิทินสหกิจทั้งหมด
              </button>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              กรอกเก็บไว้เป็นร่างได้ตั้งแต่ตอนนี้ — ที่ปิดคือปุ่มส่ง ไม่ใช่ทั้งหน้า
            </span>
          </div>
        </div>
      );
    }

    // กรณี ข: เลยช่วงมาแล้ว
    if (gate.isClosed) {
      return (
        <div
          data-testid="calendar-gate-closed"
          className={`rounded-2xl border border-red-200 bg-red-50 p-5 md:p-6 shadow-sm flex items-start gap-4 dark:border-red-900/50 dark:bg-red-950/30 ${className}`}
        >
          <div className="w-[42px] h-[42px] rounded-xl bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900/60 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-red-700 dark:text-red-400" />
          </div>
          <div className="flex flex-col gap-2 grow">
            <span className="text-base font-bold text-red-800 dark:text-red-300">
              เลยกำหนด{actionLabel}แล้ว
            </span>
            <span className="text-sm leading-relaxed text-red-800 dark:text-red-300">
              ช่วงส่งปิดไปเมื่อ <strong className="font-bold">{gate.formattedEndDate}</strong>{' '}
              · ระบบส่งให้ไม่ได้แล้ว ต้องยื่นคำร้องต่อคณบดีเพื่อขอส่งย้อนหลัง
            </span>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <button
                type="button"
                data-testid="calendar-gate-btn-late-memo"
                onClick={handleRequestLate}
                className="px-5 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 text-white font-semibold text-sm shadow-sm transition-colors cursor-pointer"
              >
                ยื่นคำร้องขอส่งย้อนหลัง
              </button>
              <button
                type="button"
                data-testid="calendar-gate-btn-view-calendar"
                onClick={handleOpenCalendar}
                className="text-xs md:text-sm font-semibold text-red-700 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 transition-colors"
              >
                ดูปฏิทินสหกิจทั้งหมด
              </button>
            </div>
          </div>
        </div>
      );
    }

    // กรณี ค: ในช่วง หรือ ไม่รู้สถานะ (fail-open)
    return null;
  };

  return (
    <>
      {renderBanner()}
      {typeof children === 'function' ? children(gate) : children}
      {modalOpen && gate.calendarData && (
        <CoopCalendarModal
          data={gate.calendarData}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
};

export default CalendarGate;
