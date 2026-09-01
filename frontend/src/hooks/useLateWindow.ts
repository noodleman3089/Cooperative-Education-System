import { useEffect, useState } from 'react';
import api from '../services/api';
import type { CoopCalendarResponse } from '../types/api';

/**
 * "ตอนนี้อยู่ในช่วงผ่อนผันของกิจกรรมนี้หรือเปล่า"
 *
 * ใช้เพื่อ **ถามเหตุผลก่อนที่นักศึกษาจะเสียเวลากรอกทั้งฟอร์ม** เท่านั้น
 * ตัวตัดสินจริงคือเซิร์ฟเวอร์ (`middlewares/calendarGate.ts` + `submitIntent`)
 * ซึ่งปฏิเสธ 400 ถ้าส่งมาโดยไม่มีเหตุผล — ฝั่งนี้จึงพลาดได้โดยไม่เกิดช่องโหว่
 *
 * ปฏิทินโหลดไม่ขึ้น = ถือว่าไม่ใช่ช่วงผ่อนผัน (fail-open ทางหน้าจอ) เพราะการเดาผิด
 * ทางนี้คือถามเหตุผลใส่คนที่ยื่นตรงเวลา ซึ่งแย่กว่าปล่อยให้เซิร์ฟเวอร์เป็นคนบอก
 */
export interface LateWindow {
  isLate: boolean;
  /** วันสุดท้ายที่ยังยื่นได้ · null เมื่อกิจกรรมนี้ไม่ได้เปิดผ่อนผัน */
  lateEndDate: string | null;
}

export function useLateWindow(activityKey: string): LateWindow {
  const [state, setState] = useState<LateWindow>({ isLate: false, lateEndDate: null });

  useEffect(() => {
    let cancelled = false;
    api
      .get('/calendar')
      .then((res) => {
        if (cancelled) return;
        const found = (res as CoopCalendarResponse).activities.find(
          (a) => a.activity_key === activityKey
        );
        setState({
          isLate: found?.status === 'late',
          lateEndDate: found?.late_end_date ?? null,
        });
      })
      .catch(() => {
        /* เงียบโดยตั้งใจ — ดูเหตุผลในคอมเมนต์หัวไฟล์ */
      });
    return () => {
      cancelled = true;
    };
  }, [activityKey]);

  return state;
}

export default useLateWindow;
