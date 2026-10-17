import { Request, Response, NextFunction } from 'express';
import { CoopCalendarModel } from '../models/coopCalendar';
import { CoopSemesterModel } from '../models/semester';
import { CoopSpecialRoundModel } from '../models/coopSpecialRound';
import {
  CoopActivityKey,
  activityByKey,
  activityLabel,
  calendarStatus,
  isRoundableActivity,
} from '../utils/coopCalendar';
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
 * (ข้อยกเว้นเดียว: นักศึกษาที่เจ้าหน้าที่ปิดใบที่ฝึก — ดู `REPLACEMENT_PASS_ACTIVITIES` ข้างล่าง)
 * ตัวด่านไม่บังคับให้ชี้แจงเหตุผลเอง เพราะมันถูกใช้ร่วมกันหลาย endpoint และ
 * แต่ละอันเก็บเหตุผลคนละที่ — คนที่บังคับคือ controller ที่รู้ว่าตัวเองเก็บที่ไหน
 *
 * วางไว้ที่ไฟล์ route **ก่อน multer** สำหรับ endpoint ที่รับไฟล์ (outlines,
 * final-reports) เพื่อให้คำขอนอกช่วงถูกปฏิเสธก่อนไฟล์ถูกเขียนลงดิสก์
 * ถ้าย้ายไปเช็คใน controller จะได้ไฟล์กำพร้าทุกครั้งที่นักศึกษายิงตอนหมดช่วง
 */
/**
 * หน้าต่างของ "ภาคไหน" ที่ด่านต้องอ่าน (R0-3 ของ `design_semester_lifecycle.md`)
 *
 *   active        ภาคที่เปิดอยู่ — การกระทำที่ยังไม่มีใบ (ยื่นคำร้องใหม่)
 *   student       ภาคของใบที่นักศึกษาผู้เรียกยังเดินอยู่ (ไม่มี = ภาค active) — ที่พัก · บันทึก · โครงร่าง · เล่มรายงาน
 *   intent_param  ภาคของใบที่ระบุใน `:intent_id` เฉพาะใบของผู้เรียกเอง (ไม่ใช่ของเขา/ไม่มี = ภาค active)
 *   link          ภาคของใบที่ผูกกับลิงก์ตอบรับของบริษัท (`acceptanceTokenGate` ตั้ง `res.locals.acceptanceLink`)
 *
 * ⛔ ห้ามให้เหตุที่หาใบไม่เจอกลายเป็นการปฏิเสธ — ถอยไปภาค active (fail-open เหมือนเดิม) แล้วให้ controller
 *   ตอบ 404/403 เรื่องความเป็นเจ้าของของมันเอง · ด่านนี้เป็นเรื่องกำหนดการ ไม่ใช่สิทธิ์
 */
export type CalendarScope = 'active' | 'student' | 'intent_param' | 'link';

async function resolveSemesterId(
  scope: CalendarScope,
  req: Request,
  res: Response
): Promise<number | null> {
  if (scope === 'link') {
    return (res.locals.acceptanceLink?.semester_id as number | undefined) ?? null;
  }
  const userId = req.user?.userId;
  if (!userId) return null;
  if (scope === 'student') return CoopSemesterModel.findStudentSemesterId(userId);
  if (scope === 'intent_param') {
    // route ของใบคำร้องเองใช้ `:id` (`/intents/:id/request-form`) · route อื่นใช้ `:intent_id`
    const formId = Number(req.params.intent_id ?? req.params.id);
    return Number.isInteger(formId) && formId > 0
      ? CoopSemesterModel.findIntentSemesterId(formId, userId)
      : null;
  }
  return null;
}

/**
 * สิทธิ์ผ่านของนักศึกษาที่เจ้าหน้าที่ปิดใบที่ฝึก (ขั้น 9 · 2026-10-11) — ถูกส่งตัวกลับ/เปลี่ยนที่ฝึกหลังพ้นช่วงปฏิทินไปแล้ว
 * จึงต้องเดินเรื่องที่ใหม่นอกช่วงได้ · ใครมีสิทธิ์ = `CoopSemesterModel.hasReplacementPass` (นิยามเดียว)
 *
 * ⛔ ใช้กับสามกิจกรรมของการหาที่ใหม่เท่านั้น — บันทึกการปฏิบัติงาน · โครงร่าง · เล่มรายงาน ไม่ยกเว้น
 * ⛔ ยกเว้นเฉพาะ "พ้นช่วง" (`late` · `closed`) — ยังไม่ถึงช่วง (`upcoming`) ไม่ยกเว้น
 * ⛔ นักศึกษาที่ไม่มีสิทธิ์ต้องโดนด่านเหมือนเดิมทุกจุด (`workflows/placement-replacement` คุม)
 */
const REPLACEMENT_PASS_ACTIVITIES: readonly CoopActivityKey[] = [
  'intent_submission',
  'acceptance_form',
  'accommodation_plan',
];

async function passesAsReplacement(
  activityKey: CoopActivityKey,
  semesterId: number | null,
  studentId: number | null | undefined
): Promise<boolean> {
  if (!studentId || !REPLACEMENT_PASS_ACTIVITIES.includes(activityKey)) return false;
  return CoopSemesterModel.hasReplacementPass(studentId, semesterId);
}

/**
 * รอบพิเศษ — เจ้าหน้าที่เปิดให้นักศึกษาที่เลือกรายคนส่งกิจกรรมที่ติ๊กไว้ได้หลังพ้นช่วง
 * (แทนขั้นตอนกระดาษ: อาจารย์ที่ปรึกษา → หัวหน้าสาขา → คณะ) · สิทธิ์ = `CoopSpecialRoundModel.isOpenForStudent` (นิยามเดียว)
 *
 * ผ่านทั้ง `closed` (พ้นช่วง · นับเป็นส่งช้า) และ `upcoming` (ยังไม่ถึงช่วง = ออกปฏิบัติงานก่อนกำหนด · ไม่นับส่งช้า)
 * สถานะ `late` ผ่านอยู่แล้วโดยช่วงผ่อนผัน
 * ⛔ เฉพาะกิจกรรมที่ล็อกจริงและไม่ใช่ช่วงที่คำนวณจากกิจกรรมอื่น (`weekly_log`) — ตรงกับที่หน้าจอเจ้าหน้าที่ให้ติ๊ก
 * ⛔ ค้นรอบพัง = โยน error (500) ไม่ใช่ผ่าน · คนละทิศกับ fail-open ของปฏิทิน เพราะนี่คือการให้สิทธิ์พิเศษ
 */
async function passesBySpecialRound(
  activityKey: CoopActivityKey,
  semesterId: number | null,
  studentId: number | null | undefined
): Promise<boolean> {
  if (!studentId || !isRoundableActivity(activityKey)) return false;
  return CoopSpecialRoundModel.isOpenForStudent(activityKey, semesterId, studentId);
}

/**
 * พ้นช่วงของกิจกรรมในภาคนั้นแล้วหรือยัง (พ้นช่วงผ่อนผันด้วย) — สำหรับจุดที่ไม่ได้เป็น middleware
 * (ด่านลิงก์ตอบรับของบริษัท · นักศึกษากดส่งหนังสือ · งานปิดใบอัตโนมัติ)
 *
 * ⚠️ fail-open เหมือนด่านข้างล่าง: ไม่มีภาค · ยังไม่ตั้งวัน · ช่วงผ่อนผัน = `false` ทั้งหมด
 * `studentId` = เจ้าของใบ — ส่งมาเมื่อจุดนั้นต้องเคารพสิทธิ์ผ่านของนักศึกษาที่ถูกปิดใบ (ข้างบน)
 */
export async function isCalendarClosed(
  activityKey: CoopActivityKey,
  semesterId: number | null,
  studentId?: number | null
): Promise<boolean> {
  const window = await CoopCalendarModel.findWindow(activityKey, semesterId);
  if (!window) return false;
  const closed =
    calendarStatus(window.today, window.start_date, window.end_date, window.late_end_date) === 'closed';
  return (
    closed &&
    !(await passesAsReplacement(activityKey, semesterId, studentId)) &&
    !(await passesBySpecialRound(activityKey, semesterId, studentId))
  );
}

export const requireCalendarWindow =
  (activityKey: CoopActivityKey, scope: CalendarScope = 'active') =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const semesterId = await resolveSemesterId(scope, req, res);
      const window = await CoopCalendarModel.findWindow(activityKey, semesterId);

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

      // นักศึกษาที่เจ้าหน้าที่ปิดใบที่ฝึก: พ้นช่วงแล้วก็ผ่าน และ **ไม่นับเป็นส่งช้า** (ไม่ปั๊ม calendarLate)
      // เจ้าของใบ = ผู้เรียก · ทางลิงก์บริษัทไม่มีผู้เรียก จึงอ่านจากใบที่ token ชี้
      if (status === 'late' || status === 'closed') {
        const studentId =
          scope === 'link'
            ? (res.locals.acceptanceLink?.student_id as number | undefined)
            : req.user?.userId;
        if (await passesAsReplacement(activityKey, semesterId, studentId)) {
          next();
          return;
        }
      }

      if (status === 'late') {
        res.locals.calendarLate = true;
        next();
        return;
      }

      // รอบพิเศษ: เจ้าหน้าที่เปิดรอบให้นักศึกษาคนนี้ — ผ่านด่านได้ทั้งสองทิศ (เจ้าของเคาะ 2026-10-18)
      //   closed   พ้นช่วงปกติแล้ว → ผ่าน และ **นับเป็นส่งช้า** (ปั๊ม calendarLate → controller บังคับเหตุผลเหมือนช่วงผ่อนผัน)
      //   upcoming ยังไม่ถึงช่วง (ออกปฏิบัติงานก่อนกำหนด) → ผ่าน และ **ไม่นับเป็นส่งช้า** (ส่งก่อนไม่ใช่ส่งช้า)
      if (status === 'closed' || status === 'upcoming') {
        const studentId =
          scope === 'link'
            ? (res.locals.acceptanceLink?.student_id as number | undefined)
            : req.user?.userId;
        if (await passesBySpecialRound(activityKey, semesterId, studentId)) {
          if (status === 'closed') res.locals.calendarLate = true;
          next();
          return;
        }
      }

      const label = activityLabel(activityKey) ?? activityKey;
      // ชนิด deadline ("ภายในวันที่ …") ไม่มีวันเริ่ม จึงห้ามพูดว่า "เปิดถึงวันที่"
      // เหมือนช่วงปกติ — คนอ่านจะนึกว่ามีวันเริ่มที่ตัวเองพลาดไป
      const isDeadline = activityByKey(activityKey)?.dateKind === 'deadline';
      const closedOn = isDeadline
        ? `กำหนดส่งคือภายในวันที่ ${formatThaiDate(window.end_date as string)}`
        : `เปิดถึงวันที่ ${formatThaiDate(window.end_date as string)}`;

      // ข้อความบอกสองอย่างเสมอตามแนวทางของโปรเจค: ไปถึงไหนแล้ว + ตอนนี้ต้องทำอะไรต่อ
      const message =
        status === 'upcoming'
          ? `ยังไม่ถึงช่วง "${label}" ตามปฏิทินสหกิจศึกษา ระบบจะเปิดให้ทำรายการวันที่ ${formatThaiDate(
              window.start_date as string
            )} ถึง ${formatThaiDate(
              window.end_date as string
            )} — ระหว่างนี้รอเจ้าหน้าที่งานสหกิจศึกษาเปิดช่วงตามกำหนด · ถ้าจำเป็นต้องออกปฏิบัติงานก่อนกำหนด ให้ยื่น "บันทึกข้อความถึงคณบดี" หัวข้อขอออกปฏิบัติงานก่อนกำหนด ถ้าคณบดีอนุมัติ เจ้าหน้าที่จะเปิด "รอบพิเศษ" ให้`
          : `หมดช่วง "${label}" แล้ว (${
              window.late_end_date
                ? `${closedOn} และผ่อนผันถึงวันที่ ${formatThaiDate(window.late_end_date)}`
                : closedOn
            }) ระบบจึงไม่รับรายการใหม่ — หากจำเป็นต้องส่งย้อนหลัง ให้ติดต่ออาจารย์ที่ปรึกษาพร้อมบันทึกข้อความชี้แจงเหตุผล อาจารย์จะเสนอหัวหน้าสาขาวิชาและส่งเรื่องต่อไปที่คณะ — ถ้าคณะอนุมัติ เจ้าหน้าที่จะเปิด "รอบพิเศษ" ให้เป็นรายบุคคล แล้วคุณส่งได้เองในรอบนั้นโดยระบบจะนับเป็นส่งช้า (นักศึกษายื่นเรื่องเองไม่ได้)`;

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
