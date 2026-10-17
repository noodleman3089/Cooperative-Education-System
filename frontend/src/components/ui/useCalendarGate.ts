import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../services/api';
import type { CoopCalendarResponse, CoopCalendarActivity, CalendarStatus } from '../../types/api';
import { formatThaiDate, formatThaiRange } from '../../utils/thaiDate';

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
    // รอบพิเศษ: เซิร์ฟเวอร์ตัดสินมาให้ (`special_round_open`) — ผ่านด่านได้ทั้งสองทิศ
    //   พ้นช่วง (closed)  → ถือเป็น 'late'  (ผ่านแต่นับส่งช้า ตรงกับที่ด่านฝั่งเซิร์ฟเวอร์ปั๊ม — หน้าจอที่ขอเหตุผลตอน late จะถามตามปกติ)
    //   ยังไม่ถึง (upcoming) → ถือเป็น 'open' (ออกก่อนกำหนด ไม่นับส่งช้า)
    const rawStatus = activity?.status ?? 'not_configured';
    const status: CalendarStatus = activity?.special_round_open
      ? rawStatus === 'closed'
        ? 'late'
        : rawStatus === 'upcoming'
          ? 'open'
          : rawStatus
      : rawStatus;
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
