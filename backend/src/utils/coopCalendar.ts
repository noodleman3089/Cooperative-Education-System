/**
 * ปฏิทินสหกิจศึกษา — แหล่งความจริงเดียวของ "กิจกรรมที่เจ้าหน้าที่ตั้งช่วงเวลาได้"
 *
 * รายการในไฟล์นี้ถอดมาจาก **ปฏิทินสหกิจศึกษา ประจำปีการศึกษา 2569 ตัวจริง**
 * ของคณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ (เจ้าของส่งภาพมาให้ 2026-09-04)
 * เทียบบรรทัดต่อบรรทัดไว้ที่ `เอกสาร/analysis_calendar_2569.md`
 *
 * กฎที่ทั้งฟีเจอร์ยืนอยู่บนมัน และต้องคงไว้:
 *   มี activity_key + locks = ล็อกการทำรายการจริงที่ endpoint
 *   มี activity_key แต่ไม่ locks = หมุดบอกเวลา (ระบบอ้างอิงได้ แต่ไม่ปฏิเสธคำขอใคร)
 *   ไม่มี key = รายการอิสระที่เจ้าหน้าที่พิมพ์เอง แค่โผล่ในปฏิทิน ไม่ล็อกอะไร
 *
 * ⛔ **key ต้องมีคนเรียกใช้ในโค้ดจริงเท่านั้น** — แถวบนกระดาษที่ระบบไม่ได้อ้างอิง
 *   (เช่น "รับหนังสือส่งตัว ภายใน 3 วันทำการ" · "ลงทะเบียนเรียน" · "ประกาศผล")
 *   ให้เจ้าหน้าที่เพิ่มเป็น**รายการอิสระ** พร้อม date_kind relative/external
 *   อย่าเติมเป็น key เพราะ key ที่ไม่มีใครเรียกคือคำสัญญาลอยๆ ว่าระบบทำอะไรให้
 *
 * ฝั่ง React ไม่ประกาศรายการนี้ซ้ำ — `GET /api/calendar` ส่ง label/ชนิดวันไปให้
 * เพิ่มกิจกรรมใหม่จึงแก้ไฟล์นี้ไฟล์เดียว หน้าจอขึ้นเอง
 */

export const COOP_ACTIVITY_KEYS = [
  'coop_application',
  'intent_submission',
  'acceptance_form',
  'accommodation_plan',
  'coop_start',
  'weekly_log',
  'report_outline',
  'coop_end',
  'final_report',
  'coop_exam',
] as const;

export type CoopActivityKey = (typeof COOP_ACTIVITY_KEYS)[number];

/**
 * ชนิดของ "เซลล์วันที่" บนปฏิทิน — กระดาษจริงมี 5 แบบ ไม่ใช่แบบเดียว
 *
 * ที่ต้องมีชนิดเพราะ **"ภายในวันที่ 5 มิถุนายน" ไม่เท่ากับ "5 มิ.ย. – 5 มิ.ย."**
 * ถ้าบังคับให้ทุกอย่างเป็นช่วงสองช่อง เจ้าหน้าที่จะกรอกวันเดียวกันลงทั้งคู่
 * แล้วระบบจะเปิดเฉพาะวันนั้นวันเดียว **และปฏิเสธทุกวันก่อนหน้า** ซึ่งกลับหัวจากกระดาษ
 *
 *   range    ช่วงปกติ            ต้องมี start และ end
 *   deadline "ภายในวันที่ X"     มีแค่ end · เปิดตั้งแต่ต้นจนถึง X
 *   single   วันเดียว            start = end
 *   relative "ภายใน 3 วันทำการ"  ไม่มีวันจริง เก็บเป็นข้อความ
 *   external "ตามปฏิทินมหาวิทยาลัย" / "ให้เป็นไปตามสาขาวิชากำหนด" — ไม่มีวันจริง
 *
 * ⛔ relative และ external **ต้องไม่ล็อกอะไรเลยโดยตั้งใจ** — มันเป็นข้อมูลประกอบ
 *   ที่ระบบไม่ได้เป็นเจ้าของวัน อย่า "แก้" ให้มันคำนวณวันแล้วปฏิเสธคำขอ
 */
export const CALENDAR_DATE_KINDS = ['range', 'deadline', 'single', 'relative', 'external'] as const;
export type CalendarDateKind = (typeof CALENDAR_DATE_KINDS)[number];

export function isCalendarDateKind(value: unknown): value is CalendarDateKind {
  return typeof value === 'string' && (CALENDAR_DATE_KINDS as readonly string[]).includes(value);
}

export interface CoopActivity {
  key: CoopActivityKey;
  label: string;
  /** ชนิดวันที่ตายตัวตามกระดาษ — เจ้าหน้าที่เลือกเองไม่ได้ กรอกได้แค่ตามชนิดนี้ */
  dateKind: CalendarDateKind;
  /** true = นอกช่วงแล้ว endpoint ปฏิเสธจริง (403) · false = หมุดบอกเวลาเฉยๆ */
  locks: boolean;
  /** แถวบนปฏิทินคณะที่กิจกรรมนี้ตรงกับ — ให้เจ้าหน้าที่เทียบกระดาษได้ */
  paperRow: string | null;
  /**
   * มีช่อง "ผ่อนผันถึง" ให้กรอกไหม — จริงเฉพาะกิจกรรมที่วันปิดของมันถูกใช้ล็อกจริง
   * `coop_end` ไม่ล็อกเองแต่เป็นวันปิดของ `weekly_log` จึงต้องผ่อนผันได้
   * ส่วน `coop_start`/`coop_exam` เป็นหมุดเปล่าๆ การผ่อนผันไม่มีความหมาย
   */
  allowLate: boolean;
  /**
   * ไม่ให้เจ้าหน้าที่กรอกเอง — ช่วงมาจากกิจกรรมอื่นสองอัน
   * มีตัวเดียวคือ weekly_log (ดูคอมเมนต์ที่ DERIVED_WINDOWS)
   */
  derivedFrom?: { start: CoopActivityKey; end: CoopActivityKey };
  /** คำอธิบายใต้ช่องกรอกในหน้าจอเจ้าหน้าที่ · null = ไม่ต้องอธิบายอะไรเพิ่ม */
  hint: string | null;
}

/** ลำดับในอาร์เรย์ = ลำดับที่แสดงบนหน้าจอ (ตามลำดับจริงของกระบวนการสหกิจ) */
export const COOP_ACTIVITIES: CoopActivity[] = [
  {
    key: 'coop_application',
    label: 'ยื่นใบสมัครเข้าโครงการสหกิจศึกษา (สหกิจ 01)',
    dateKind: 'range',
    locks: true,
    // ไม่มีบนปฏิทินคณะ — เป็นด่านคัดกรองของสาขาก่อนถึงขั้นทาบทาม
    paperRow: null,
    allowLate: true,
    hint: 'ไม่มีบนปฏิทินคณะ — สาขาวิชากำหนดเอง',
  },
  {
    key: 'intent_submission',
    label: 'ยื่นแบบแจ้งความจำนงไปสถานประกอบการ',
    dateKind: 'range',
    locks: true,
    paperRow: 'แถว 1 — ขอหนังสือทาบทาม (เอกสารหมายเลข 1)',
    allowLate: true,
    hint: null,
  },
  {
    key: 'acceptance_form',
    label: 'ส่งแบบยืนยันแบบตอบรับที่สถานประกอบการลงนาม (เอกสารหมายเลข 2)',
    dateKind: 'deadline',
    locks: true,
    paperRow: 'แถว 2 — "ภายในวันที่ …"',
    allowLate: true,
    hint: 'กระดาษเขียนว่า "ภายในวันที่ …" จึงกรอกเฉพาะวันสุดท้าย — ระบบเปิดให้ส่งได้ตั้งแต่ต้นจนถึงวันนั้น ห้ามกรอกวันเดียวกันลงช่องวันเริ่มด้วย',
  },
  {
    key: 'accommodation_plan',
    label: 'ส่งข้อมูลที่พัก และแผนปฏิบัติงาน 16 สัปดาห์ (สหกิจ 06)',
    dateKind: 'range',
    locks: true,
    paperRow: 'แถว 3 — ส่ง สหกิจ 03 · 06 · 13 · 15',
    allowLate: true,
    hint: 'บนกระดาษ สหกิจ 03 ใช้ช่วงเดียวกับ 06 แต่ระบบยังไม่ได้ล็อก สหกิจ 03 ไว้ (endpoint เป็นการบันทึกร่างอัตโนมัติ)',
  },
  {
    key: 'coop_start',
    label: 'วันเริ่มปฏิบัติงานสหกิจศึกษา',
    dateKind: 'single',
    locks: false,
    paperRow: 'แถว 7 — วันเริ่มฝึกสหกิจศึกษา',
    allowLate: false,
    hint: 'ไม่ล็อกอะไร แต่เป็นวันตั้งต้นของ "บันทึกการปฏิบัติงานรายสัปดาห์" และของการนับสัปดาห์ที่ 1–16',
  },
  {
    key: 'weekly_log',
    label: 'บันทึกการปฏิบัติงานรายสัปดาห์',
    dateKind: 'range',
    locks: true,
    paperRow: 'ไม่มีแถวของตัวเองบนกระดาษ — คือช่วงระหว่างแถว 7 ถึงแถว 9',
    allowLate: false,
    derivedFrom: { start: 'coop_start', end: 'coop_end' },
    hint: 'คำนวณเองจากวันเริ่มถึงวันสิ้นสุดการปฏิบัติงาน — ไม่ต้องกรอก (ผ่อนผันได้โดยตั้งวันผ่อนผันที่ "วันสิ้นสุดการปฏิบัติงาน")',
  },
  {
    key: 'report_outline',
    label: 'ส่งโครงร่างรายงานการปฏิบัติงาน (สหกิจ 11)',
    dateKind: 'range',
    locks: true,
    paperRow: null,
    allowLate: true,
    hint: 'ไม่มีบนปฏิทินคณะ — สาขาวิชากำหนดเอง',
  },
  {
    key: 'coop_end',
    label: 'วันสิ้นสุดการปฏิบัติงาน',
    dateKind: 'single',
    locks: false,
    paperRow: 'แถว 9 — วันสิ้นสุดการปฏิบัติงาน',
    allowLate: true,
    hint: 'ไม่ล็อกอะไรเอง แต่เป็นวันปิดของบันทึกรายสัปดาห์ และเป็นวันที่ระบบใช้ตัดสินว่าหมดช่วงปฏิบัติงานแล้วจึงเปิดผลประเมินให้นักศึกษาดูได้',
  },
  {
    key: 'final_report',
    label: 'ส่งรายงานการปฏิบัติงานฉบับสมบูรณ์',
    dateKind: 'range',
    locks: true,
    paperRow: null,
    allowLate: true,
    hint: 'ไม่มีบนปฏิทินคณะ — สาขาวิชากำหนดเอง',
  },
  {
    key: 'coop_exam',
    label: 'วันสอบสหกิจศึกษา',
    dateKind: 'single',
    locks: false,
    paperRow: 'แถว 10 — "ให้เป็นไปตามสาขาวิชากำหนด"',
    allowLate: false,
    hint: 'กระดาษให้สาขาวิชาเป็นคนกำหนด เจ้าหน้าที่กรอกวันที่สาขาแจ้งมา — ไม่ล็อกอะไร',
  },
];

const ACTIVITY_BY_KEY = new Map<string, CoopActivity>(COOP_ACTIVITIES.map((a) => [a.key, a]));

/**
 * กิจกรรมที่ช่วงเวลามาจากกิจกรรมอื่น เจ้าหน้าที่ไม่ต้องกรอกซ้ำ
 *
 * `weekly_log` เป็นตัวเดียว — ปฏิทินคณะไม่มีแถว "ช่วงบันทึกรายสัปดาห์" เพราะมัน
 * **คือ** ช่วงตั้งแต่วันเริ่มถึงวันสิ้นสุดการปฏิบัติงานพอดี (ปี 2569 ทั้งสองภาค
 * เป็นจันทร์ → ศุกร์ 109 วัน = 16 สัปดาห์ทำงานเป๊ะทั้งคู่)
 * การให้กรอกสองที่คือการเปิดโอกาสให้สองที่นั้นไม่ตรงกัน โดยไม่ได้ความสามารถอะไรเพิ่ม
 */
export const DERIVED_WINDOWS: Partial<
  Record<CoopActivityKey, { start: CoopActivityKey; end: CoopActivityKey }>
> = Object.fromEntries(
  COOP_ACTIVITIES.filter((a) => a.derivedFrom).map((a) => [a.key, a.derivedFrom])
);

/** ชื่อไทยของกิจกรรมตายตัว — คืน null ถ้าไม่รู้จัก key นั้น */
export function activityLabel(key: string): string | null {
  return ACTIVITY_BY_KEY.get(key)?.label ?? null;
}

export function activityByKey(key: string): CoopActivity | null {
  return ACTIVITY_BY_KEY.get(key) ?? null;
}

export function isCoopActivityKey(value: unknown): value is CoopActivityKey {
  return typeof value === 'string' && ACTIVITY_BY_KEY.has(value);
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
 * ⛔ **`start` เป็น null ได้ และไม่ได้แปลว่า "ยังไม่ตั้ง"** (2026-09-04) —
 * มันคือชนิด `deadline` ("ภายในวันที่ X") ซึ่งเปิดตั้งแต่ต้นจนถึง `end`
 * จึง **ไม่มีสถานะ upcoming** ตัวที่บอกว่ายังไม่มีกฎคือ `end` ว่างต่างหาก
 * · ก่อนหน้านี้เขียนว่า `if (!start || !end) return 'not_configured'` ซึ่งจะทำให้
 *   แถวชนิดเส้นตาย **fail-open เงียบ ไม่ล็อกอะไรเลย** ตรงข้ามกับที่กระดาษเขียน
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
  // ไม่มีวันปิด = ยังไม่มีกฎ (relative/external ก็ตกที่นี่ ซึ่งถูกแล้ว — ไม่ล็อก)
  if (!end) return 'not_configured';
  if (start && today < start) return 'upcoming';
  if (today <= end) return 'open';
  // lateEnd ว่าง = ไม่เปิดผ่อนผัน ไม่ใช่ผ่อนผันไม่จำกัด
  if (lateEnd && today <= lateEnd) return 'late';
  return 'closed';
}
