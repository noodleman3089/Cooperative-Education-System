import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, Clock } from 'lucide-react';
import api from '../../services/api';
import type { CoopCalendarResponse, CoopCalendarActivity, CalendarStatus } from '../../types/api';
import { formatThaiDate, formatThaiRange } from '../../utils/thaiDate';
import { goToMenu } from '../../utils/calendarMenus';
import CoopCalendarModal from '../CoopCalendarModal';

/**
 * คำนวณจำนวนวันระหว่างวันที่ 2 วัน (YYYY-MM-DD)
 * ใช้ Date.UTC เพื่อป้องกันปัญหา timezone skew
 */
function diffDays(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

// Shared in-memory cache to prevent multiple concurrent requests to /api/calendar
let cachedCalendarPromise: Promise<CoopCalendarResponse | null> | null = null;
let cachedCalendarData: CoopCalendarResponse | null = null;

async function fetchCalendarCached(force = false): Promise<CoopCalendarResponse | null> {
  if (!force && cachedCalendarData) {
    return cachedCalendarData;
  }
  if (!force && cachedCalendarPromise) {
    return cachedCalendarPromise;
  }

  cachedCalendarPromise = api
    .get('/calendar')
    .then((res) => {
      cachedCalendarData = res as CoopCalendarResponse;
      return cachedCalendarData;
    })
    .catch(() => {
      // Fail-open: คืน null เมื่อดึงข้อมูลไม่ได้ เพื่อให้ระบบเปิดใช้งานตามปกติ
      return null;
    })
    .finally(() => {
      cachedCalendarPromise = null;
    });

  return cachedCalendarPromise;
}

export interface CalendarGateState {
  loading: boolean;
  status: CalendarStatus;
  activity: CoopCalendarActivity | null;
  today: string | null;
  daysRemaining: number | null;
  startDate: string | null;
  endDate: string | null;
  lateEndDate: string | null;
  formattedRange: string;
  formattedEndDate: string;
  isUpcoming: boolean;
  isClosed: boolean;
  isOpen: boolean;
  canSubmit: boolean;
  calendarData: CoopCalendarResponse | null;
  refresh: () => Promise<void>;
}

/**
 * Hook สำหรับอ่านสถานะของกิจกรรมในปฏิทิน
 * ด่านจริงอยู่ที่เซิร์ฟเวอร์ (middlewares/calendarGate.ts)
 * Hook นี้ใช้สำหรับควบคุม UI ล่วงหน้าไม่ให้ผู้ใช้เสียเวลากรอก
 */
export function useCalendarGate(activityKey: string): CalendarGateState {
  const [loading, setLoading] = useState(true);
  const [calendarData, setCalendarData] = useState<CoopCalendarResponse | null>(cachedCalendarData);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    const data = await fetchCalendarCached(force);
    setCalendarData(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCalendarCached().then((data) => {
      if (cancelled) return;
      setCalendarData(data);
      setLoading(false);
    });

    const handleFocus = () => {
      fetchCalendarCached(true).then((data) => {
        if (cancelled) return;
        setCalendarData(data);
      });
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  return useMemo(() => {
    if (!calendarData || !calendarData.activities) {
      // fail-open: หากไม่มีข้อมูลปฏิทิน ให้ถือว่า open / not_configured เพื่อไม่ให้ปิดกั้นผู้ใช้
      return {
        loading,
        status: 'not_configured' as CalendarStatus,
        activity: null,
        today: null,
        daysRemaining: null,
        startDate: null,
        endDate: null,
        lateEndDate: null,
        formattedRange: '',
        formattedEndDate: '',
        isUpcoming: false,
        isClosed: false,
        isOpen: true,
        canSubmit: true,
        calendarData,
        refresh: () => load(true),
      };
    }

    const activity = calendarData.activities.find((a) => a.activity_key === activityKey) ?? null;
    const status = activity?.status ?? 'not_configured';
    const today = calendarData.today;

    const startDate = activity?.start_date ?? null;
    const endDate = activity?.end_date ?? null;
    const lateEndDate = activity?.late_end_date ?? null;

    let daysRemaining: number | null = null;
    if (status === 'upcoming' && startDate && today) {
      const d = diffDays(today, startDate);
      daysRemaining = d > 0 ? d : 0;
    }

    let formattedRange = '';
    if (startDate && endDate) {
      formattedRange = formatThaiRange(startDate, endDate);
    } else if (endDate) {
      formattedRange = formatThaiDate(endDate);
    }

    const formattedEndDate = endDate ? formatThaiDate(endDate) : '';

    const isUpcoming = status === 'upcoming';
    const isClosed = status === 'closed';
    const isOpen = status === 'open';
    // canSubmit = true สำหรับ open, late (ช่วงผ่อนผัน), และ not_configured (fail-open)
    const canSubmit = status === 'open' || status === 'late' || status === 'not_configured';

    return {
      loading,
      status,
      activity,
      today,
      daysRemaining,
      startDate,
      endDate,
      lateEndDate,
      formattedRange,
      formattedEndDate,
      isUpcoming,
      isClosed,
      isOpen,
      canSubmit,
      calendarData,
      refresh: () => load(true),
    };
  }, [loading, calendarData, activityKey, load]);
}

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
