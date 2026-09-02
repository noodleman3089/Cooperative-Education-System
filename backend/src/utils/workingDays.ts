/**
 * วันทำการ — ใช้กับกำหนด "๑๕ วันทำการ" ที่พิมพ์อยู่บนเอกสารหมายเลข ๒
 *
 * ⚠️ **นับข้ามได้แค่เสาร์-อาทิตย์** ระบบไม่มีตารางวันหยุดนักขัตฤกษ์ของไทย
 * วันครบกำหนดที่คำนวณได้จึง **เร็วกว่าความจริงเล็กน้อย** ในช่วงที่มีวันหยุดยาว
 * → หน้าจอต้องเรียกว่า "กำหนดโดยประมาณ" ไม่ใช่เส้นตาย และเส้นทางส่งช้าต้องรับได้เสมอ
 * (ซึ่งรับอยู่แล้ว: เลยกำหนดแล้วยังอัปโหลดได้ แค่ติดธง)
 *
 * ⛔ **ทุกฟังก์ชันในไฟล์นี้รับ-คืนสตริง `YYYY-MM-DD` เท่านั้น** และคำนวณด้วย
 * `Date.UTC` ล้วน จึงไม่แตะ timezone ของเครื่องเลย — กติกาเดียวกับ `coopCalendar.ts`
 * ที่เทียบวันด้วยสตริง เพราะ `new Date('2020-01-01')` เคยทำให้วันเลื่อนไปหนึ่งวัน
 *
 * ⛔ **"วันนี้" ยังต้องมาจาก Postgres เสมอ** — ไฟล์นี้ทำแค่เลขคณิตบนวันที่ที่ผู้เรียก
 * ส่งมาให้ ห้ามให้มันไปหยิบนาฬิกาของเครื่องเอง
 */

const MS_PER_DAY = 86_400_000;

const toUtc = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** เสาร์ (6) หรือ อาทิตย์ (0) */
const isWeekend = (ms: number): boolean => {
  const day = new Date(ms).getUTCDay();
  return day === 0 || day === 6;
};

/**
 * บวกวันทำการเข้ากับวันที่ตั้งต้น
 *
 * นับแบบ "วันทำการถัดจากวันตั้งต้น" — วันตั้งต้นเองไม่ถูกนับ เหมือนที่คนอ่านประโยค
 * "ตอบกลับภายใน ๑๕ วันทำการ หลังจากได้รับหนังสือ" เข้าใจกัน
 */
export function addWorkingDays(startIso: string, days: number): string {
  let ms = toUtc(startIso);
  let remaining = days;
  while (remaining > 0) {
    ms += MS_PER_DAY;
    if (!isWeekend(ms)) remaining -= 1;
  }
  return toIso(ms);
}

/**
 * จำนวนวันทำการจาก `fromIso` ถึง `toIso`
 *
 * เป็นลบเมื่อเลยกำหนดไปแล้ว (ผู้เรียกเอาไปแสดงว่า "เลยกำหนดมา N วันทำการ")
 * และเป็น 0 เมื่อครบกำหนดวันนี้พอดี
 */
export function workingDaysBetween(fromIso: string, toIso_: string): number {
  const from = toUtc(fromIso);
  const to = toUtc(toIso_);
  if (from === to) return 0;

  const forward = to > from;
  let count = 0;
  let ms = from;
  while (ms !== to) {
    ms += forward ? MS_PER_DAY : -MS_PER_DAY;
    if (!isWeekend(ms)) count += 1;
  }
  return forward ? count : -count;
}

/** กำหนดตอบกลับของเอกสารหมายเลข ๒ ตามที่พิมพ์อยู่บนฟอร์ม */
export const ACCEPTANCE_WORKING_DAYS = 15;
