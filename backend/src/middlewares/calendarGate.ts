import { Request, Response, NextFunction } from 'express';
import { CoopCalendarModel } from '../models/coopCalendar';
import { CoopActivityKey, activityLabel, calendarStatus } from '../utils/coopCalendar';
import { formatThaiDate } from '../utils/thaiDate';
import { sendUnexpectedError } from '../utils/httpError';

/**
 * ด่านปฏิทินสหกิจศึกษา — ปฏิเสธการทำรายการที่อยู่นอกช่วงที่เจ้าหน้าที่ตั้งไว้
 *
 * ⚠️ ตัวนี้ **fail-open** ซึ่งตรงข้ามกับ SEC-06 โดยตั้งใจ อย่าเผลอ "แก้" ให้เหมือนกัน
 *
 *   SEC-06 เป็นเรื่อง *สิทธิ์* — ไม่รู้ว่าผู้เรียกอยู่สาขาไหน = ปฏิเสธ
 *                                  เพราะการเดาผิดคือการเปิดข้อมูลของคนอื่น
 *   ตัวนี้เป็นเรื่อง *กำหนดการ* — เจ้าหน้าที่ยังไม่ตั้งช่วง = ยังไม่มีกฎ = ผ่าน
 *                                  เพราะการเดาผิดคือการปิดระบบใส่นักศึกษาทั้งรุ่น
 *                                  ในวันที่ deploy ก่อนที่ใครจะทันกรอกปฏิทิน
 *
 * หน้าจอจัดการปฏิทินของเจ้าหน้าที่ขึ้นแถบเตือนว่ากิจกรรมไหนยังไม่ได้ตั้งและ
 * ตอนนี้ยังไม่ล็อก — fail-open จึงไม่ใช่ความเงียบ แต่มีคนเห็น
 *
 * ตั้งแต่ 2026-09-01 ด่านนี้มีสามทางออก ไม่ใช่สองอย่างเดิม:
 *   open  → ผ่านเงียบๆ
 *   late  → **ผ่าน** แต่ปั๊มธงไว้ให้ controller รู้ว่านี่คือการส่งช้า
 *   ที่เหลือ → 403
 * ตัวด่านไม่บังคับให้ชี้แจงเหตุผลเอง เพราะมันถูกใช้ร่วมกันหลาย endpoint และ
 * แต่ละอันเก็บเหตุผลคนละที่ — คนที่บังคับคือ controller ที่รู้ว่าตัวเองเก็บที่ไหน
 *
 * วางไว้ที่ไฟล์ route **ก่อน multer** สำหรับ endpoint ที่รับไฟล์ (outlines,
 * final-reports) เพื่อให้คำขอนอกช่วงถูกปฏิเสธก่อนไฟล์ถูกเขียนลงดิสก์
 * ถ้าย้ายไปเช็คใน controller จะได้ไฟล์กำพร้าทุกครั้งที่นักศึกษายิงตอนหมดช่วง
 */
export const requireCalendarWindow =
  (activityKey: CoopActivityKey) =>
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const window = await CoopCalendarModel.findActiveWindow(activityKey);

      // ไม่มีภาคการศึกษาที่เปิดใช้งาน = ยังไม่มีปฏิทินให้อ้าง → ปล่อยผ่าน
      if (!window) {
        next();
        return;
      }

      const status = calendarStatus(
        window.today,
        window.start_date,
        window.end_date,
        window.late_end_date
      );
      if (status === 'not_configured' || status === 'open') {
        next();
        return;
      }

      if (status === 'late') {
        res.locals.calendarLate = true;
        next();
        return;
      }

      const label = activityLabel(activityKey) ?? activityKey;

      // ข้อความบอกสองอย่างเสมอตามแนวทางของโปรเจค: ไปถึงไหนแล้ว + ตอนนี้ต้องทำอะไรต่อ
      const message =
        status === 'upcoming'
          ? `ยังไม่ถึงช่วง "${label}" ตามปฏิทินสหกิจศึกษา ระบบจะเปิดให้ทำรายการวันที่ ${formatThaiDate(
              window.start_date as string
            )} ถึง ${formatThaiDate(
              window.end_date as string
            )} — ระหว่างนี้รอเจ้าหน้าที่งานสหกิจศึกษาเปิดช่วงตามกำหนด`
          : `หมดช่วง "${label}" แล้ว (${
              window.late_end_date
                ? `เปิดถึงวันที่ ${formatThaiDate(
                    window.end_date as string
                  )} และผ่อนผันถึงวันที่ ${formatThaiDate(window.late_end_date)}`
                : `เปิดถึงวันที่ ${formatThaiDate(window.end_date as string)}`
            }) ระบบจึงไม่รับรายการใหม่ — หากจำเป็นต้องส่งย้อนหลัง ให้ติดต่ออาจารย์ที่ปรึกษาพร้อมบันทึกข้อความชี้แจงเหตุผล อาจารย์จะเสนอหัวหน้าสาขาวิชาและส่งเรื่องต่อไปที่คณะให้ (นักศึกษายื่นเรื่องเองไม่ได้)`;

      res.status(403).json({ message });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'requireCalendarWindow error',
        'เกิดข้อผิดพลาดขณะตรวจสอบปฏิทินสหกิจศึกษา'
      );
    }
  };

/**
 * ธงที่ `requireCalendarWindow` ปั๊มไว้เมื่อคำขอนี้อยู่ในช่วงผ่อนผัน
 *
 * controller ที่รับคำขอในช่วงนี้ **ต้องบังคับให้มีเหตุผลชี้แจง** และบันทึกไว้
 * กับแถวข้อมูลของตัวเอง — ห้ามคำนวณย้อนหลังจากวันที่ในภายหลัง เพราะเจ้าหน้าที่
 * แก้ปฏิทินได้ แล้วหลักฐานว่าใครส่งช้าจะหายไปเงียบๆ
 */
export function isLateWindow(res: Response): boolean {
  return res.locals.calendarLate === true;
}
