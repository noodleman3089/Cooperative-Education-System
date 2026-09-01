/**
 * ปฏิทินสหกิจศึกษา — แหล่งความจริงเดียวของ "กิจกรรมที่เจ้าหน้าที่ตั้งช่วงเวลาได้"
 *
 * กฎที่ทั้งฟีเจอร์ยืนอยู่บนมัน และต้องคงไว้:
 *   มี activity_key = ล็อกการทำรายการจริงที่ endpoint
 *   ไม่มี key       = รายการอิสระที่เจ้าหน้าที่พิมพ์เอง แค่โผล่ในปฏิทิน ไม่ล็อกอะไร
 *
 * → กิจกรรมอย่าง "ปฐมนิเทศ" หรือ "ช่วงออกปฏิบัติงาน" เป็นรายการอิสระ
 *   อย่าเอามาใส่เป็น key เพราะไม่มี endpoint ให้ล็อก
 *
 * ฝั่ง React ไม่ประกาศรายการนี้ซ้ำ — `GET /api/calendar` ส่ง label ไปให้
 * เพิ่มกิจกรรมใหม่จึงแก้ไฟล์นี้ไฟล์เดียว หน้าจอขึ้นเอง
 */

export const COOP_ACTIVITY_KEYS = [
  'coop_application',
  'intent_submission',
  'accommodation_plan',
  'weekly_log',
  'report_outline',
  'final_report',
] as const;

export type CoopActivityKey = (typeof COOP_ACTIVITY_KEYS)[number];

/** ลำดับในอาร์เรย์ = ลำดับที่แสดงบนหน้าจอ (ตามลำดับจริงของกระบวนการสหกิจ) */
export const COOP_ACTIVITIES: { key: CoopActivityKey; label: string }[] = [
  { key: 'coop_application', label: 'ยื่นใบสมัครเข้าโครงการสหกิจศึกษา (สหกิจ 01)' },
  { key: 'intent_submission', label: 'ยื่นแบบแจ้งความจำนงไปสถานประกอบการ' },
  { key: 'accommodation_plan', label: 'ส่งข้อมูลที่พัก และแผนปฏิบัติงาน 16 สัปดาห์' },
  { key: 'weekly_log', label: 'บันทึกการปฏิบัติงานรายสัปดาห์' },
  { key: 'report_outline', label: 'ส่งโครงร่างรายงานการปฏิบัติงาน (สหกิจ 11)' },
  { key: 'final_report', label: 'ส่งรายงานการปฏิบัติงานฉบับสมบูรณ์' },
];

const LABEL_BY_KEY = new Map<string, string>(COOP_ACTIVITIES.map((a) => [a.key, a.label]));

/** ชื่อไทยของกิจกรรมตายตัว — คืน null ถ้าไม่รู้จัก key นั้น */
export function activityLabel(key: string): string | null {
  return LABEL_BY_KEY.get(key) ?? null;
}

export function isCoopActivityKey(value: unknown): value is CoopActivityKey {
  return typeof value === 'string' && LABEL_BY_KEY.has(value);
}

export type CalendarStatus = 'not_configured' | 'upcoming' | 'open' | 'late' | 'closed';

/**
 * สถานะของช่วงเวลาหนึ่งช่วง เทียบกับ "วันนี้"
 *
 * มีวันปิดสองวัน ไม่ใช่วันเดียว (2026-09-01):
 *
 *   start ────── end ────── lateEnd ──────>
 *   upcoming │ open │  late  │  closed
 *
 * "late" = เลยกำหนดปกติแล้วแต่ยังอยู่ในช่วงผ่อนผัน — **ยังทำรายการได้**
 * แต่ต้องชี้แจงเหตุผลและถูกประทับว่าส่งช้า (เจ้าของเคาะ: "ส่งได้แต่เข้าข่ายส่งช้า")
 *
 * lateEnd เป็น optional โดยตั้งใจ ผู้เรียกที่ไม่ส่งมาจะได้พฤติกรรมเดิมเป๊ะ —
 * สำคัญกับ finalEvaluation.controller.ts ซึ่งใช้ฟังก์ชันนี้แบบ fail-closed เพื่อกัน
 * นักศึกษาเห็นผลประเมินก่อนเวลา **ตรงนั้นต้องไม่มีวันผ่อนผัน**
 *
 * รับเป็นสตริง `YYYY-MM-DD` ล้วนและเทียบด้วยการเรียงตัวอักษร — **ห้าม new Date()**
 * รูปแบบนี้เรียงตามลำดับเวลาอยู่แล้ว ส่วนการ parse เป็น Date จะดึง timezone
 * เข้ามาแล้วเลื่อนวันไปหนึ่งวัน (เคยทำให้ 2020-01-01 ถูกเก็บเป็น 2019-12-31)
 *
 * `today` ต้องมาจาก Postgres — `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`
 * ไม่ใช่นาฬิกาของเซิร์ฟเวอร์หรือของเบราว์เซอร์ เพื่อให้แบนเนอร์ที่นักศึกษาเห็น
 * กับตัวล็อกที่ปฏิเสธคำขอ ตอบตรงกันเสมอ
 */
export function calendarStatus(
  today: string,
  start: string | null,
  end: string | null,
  lateEnd?: string | null
): CalendarStatus {
  if (!start || !end) return 'not_configured';
  if (today < start) return 'upcoming';
  if (today <= end) return 'open';
  // lateEnd ว่าง = ไม่เปิดผ่อนผัน ไม่ใช่ผ่อนผันไม่จำกัด
  if (lateEnd && today <= lateEnd) return 'late';
  return 'closed';
}
