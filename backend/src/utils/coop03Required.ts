/**
 * ช่องบังคับของใบสมัครงานสหกิจศึกษา (สหกิจ 03) — **ประกาศที่นี่ที่เดียว**
 *
 * ใช้สองที่: ด่านก่อนออกหนังสือส่งตัว (`issueDispatchLetter` — คู่มือคณะ: หนังสือส่งตัวออกหลังนักศึกษาส่งสหกิจ 03 · 06)
 * และรายการ "ยังขาดช่องไหน" ที่หน้าสหกิจ 03 ของนักศึกษาแสดง (`GET /students/coop-application`)
 *
 * ⛔ **เชื้อชาติ ศาสนา ไม่บังคับ** — ข้อมูลอ่อนไหวพิเศษ PDPA ม.26 ต้องยินยอมแยก บังคับกรอก = บังคับยินยอม
 * ⛔ ตารางครอบครัว ไม่บังคับ
 * ✅ **การศึกษา · ฝึกอบรม · กิจกรรม · ภาษา บังคับ (เจ้าของสั่ง 2026-10-18)** — ครบเมื่อมีอย่างน้อย 1 แถว **หรือ** นักศึกษาติ๊ก "ไม่มีข้อมูล"
 *    ในหมวดนั้น (`students.coop03_none_sections`) · ห้ามบังคับแบบไม่มีทางออก — คนที่ไม่เคยฝึกอบรมจริง ๆ จะตัน ไม่มีทางได้หนังสือส่งตัว
 * ⛔ ด่านดูแค่ "มีค่า" ไม่ตรวจเนื้อ และไม่ถอดรหัสเลขบัตร (SEC-12) — เจ้าหน้าที่ตรวจเนื้อจากกระดาษที่นักศึกษาส่งเหมือนเดิม
 * ⛔ คนที่ไม่ใช่นักศึกษาเจ้าของใบได้แค่ **จำนวน** ช่องที่ขาด ไม่ได้ชื่อช่องและไม่ได้ค่า
 */

/** คีย์ที่หน้าจอใช้แปลเป็นชื่อช่องภาษาไทย — ลำดับเดียวกับบนฟอร์ม */
export const COOP03_REQUIRED_KEYS = [
  'first_name_en',
  'last_name_en',
  'gender',
  'nationality',
  'phone',
  'national_id',
  'national_id_issued_district',
  'national_id_expiry_date',
  'emergency_contact_name',
  'emergency_relationship',
  'emergency_phone',
  // ตารางประวัติ: มีแถว หรือติ๊ก "ไม่มีข้อมูล" (คีย์ตรงกับ `coop03_none_sections`)
  'education',
  'training',
  'activity',
  'language',
] as const;

/** หมวดตารางที่บังคับ → คอลัมน์ JSONB ที่เก็บแถว · คีย์เดียวกับค่าใน `coop03_none_sections` */
export const COOP03_TABLE_COLUMNS = {
  education: 'education_history',
  training: 'training_history',
  activity: 'activity_history',
  language: 'language_proficiency',
} as const;
export type Coop03TableSection = keyof typeof COOP03_TABLE_COLUMNS;
export const COOP03_TABLE_SECTIONS = Object.keys(COOP03_TABLE_COLUMNS) as Coop03TableSection[];

export type Coop03RequiredKey = (typeof COOP03_REQUIRED_KEYS)[number];

/** คอลัมน์ของ `students` ที่ `coop03MissingKeys` อ่าน — ผู้เรียกที่ query เองต้องเลือกให้ครบชุดนี้ */
export const COOP03_REQUIRED_COLUMNS = [
  'first_name_en',
  'last_name_en',
  'gender',
  'nationality',
  'phone',
  'mobile_phone',
  'national_id_ciphertext',
  'national_id_issued_district',
  'national_id_expiry_date',
  'emergency_contact_name',
  'emergency_relationship',
  'emergency_phone',
  'education_history',
  'training_history',
  'activity_history',
  'language_proficiency',
  'coop03_none_sections',
] as const;

const filled = (value: unknown): boolean =>
  value !== null && value !== undefined && String(value).trim() !== '';

/** ช่องบังคับที่ยังว่างของแถว `students` หนึ่งแถว (ต้องมีคอลัมน์ตาม `COOP03_REQUIRED_COLUMNS`) */
export function coop03MissingKeys(row: Record<string, unknown>): Coop03RequiredKey[] {
  return COOP03_REQUIRED_KEYS.filter((key) => {
    // โทรศัพท์: มือถือหรือเบอร์ในโปรไฟล์อย่างใดอย่างหนึ่ง
    if (key === 'phone') return !filled(row.mobile_phone) && !filled(row.phone);
    // เลขบัตรเก็บเข้ารหัส — มี ciphertext = กรอกแล้ว
    if (key === 'national_id') return !filled(row.national_id_ciphertext);
    // ตารางประวัติ: มีอย่างน้อย 1 แถว หรือยืนยัน "ไม่มีข้อมูล" แล้ว
    if (key in COOP03_TABLE_COLUMNS) {
      const rows = row[COOP03_TABLE_COLUMNS[key as Coop03TableSection]];
      const none = row.coop03_none_sections;
      return !(Array.isArray(rows) && rows.length > 0) && !(Array.isArray(none) && none.includes(key));
    }
    return !filled(row[key]);
  });
}
