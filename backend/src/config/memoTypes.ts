/**
 * หัวข้อของบันทึกข้อความที่นักศึกษายื่นถึงคณบดี — **แหล่งความจริงเดียว**
 *
 * ทั้งชุดค่าที่ยอมรับ (validation) ชื่อไทยบนหน้าจอ และถ้อยคำที่ถูกพิมพ์ลงกระดาษ
 * อยู่ในไฟล์นี้ไฟล์เดียว เหมือนที่ `evaluationRubric.ts` ทำกับเกณฑ์ประเมิน
 * เพิ่มหัวข้อใหม่จึงแก้ที่นี่ที่เดียว แล้ว dropdown กับด่านตรวจขึ้นตามเอง
 *
 * ⛔ **นักศึกษาเป็นคนเลือกหัวข้อเอง** (เจ้าของเคาะ 2026-09-01) — ระบบเลือกไว้ให้
 * ล่วงหน้าตามบริบทได้ แต่ห้ามตัดสินแทน เพราะเอกสารนี้ไปถึงคณบดีและระบบไม่มีทาง
 * รู้เรื่องที่เกิดนอกระบบ (เช่นบริษัทส่งตัวกลับ)
 *
 * ⚠️ **ถ้อยคำที่ยืนยันแล้วมีหัวข้อเดียว**: `early_departure` ลอกมาจากตัวอย่างจริง
 * ในคู่มือ (`เอกสาร/manual-pages/pdf45-*.jpg` และ `pdf48-*.jpg`)
 * อีกสามหัวข้อ **ร่างขึ้นตามรูปแบบเดียวกัน ยังไม่ได้ตรวจกับของจริง** — ถ้าวันหนึ่ง
 * ได้ถ้อยคำตัวจริงจากคณะ ให้เปลี่ยนทันที (กติกาโปรเจค: ยึดแบบฟอร์มจริงเสมอ)
 */

import { isRoundableActivity } from '../utils/coopCalendar';

export interface MemoType {
  key: string;
  /** ชื่อหัวข้อบน dropdown ของนักศึกษา */
  label: string;
  /** บรรทัด "เรื่อง" บนกระดาษ */
  subject: string;
  /** ท่อนนำของบรรทัด "มีความประสงค์" — ต่อด้วยเหตุผลที่นักศึกษาเขียนเอง */
  intent: string;
  /** คำอธิบายใต้ตัวเลือกให้นักศึกษารู้ว่าควรเลือกอันไหน */
  hint: string;
  /** "ถ้าอนุมัติ จะเกิดอะไรต่อ" — แสดงในแผงข้างฟอร์มนักศึกษาและหน้าคณบดี (เขียนตามสิ่งที่ระบบทำจริง) */
  outcome: string;
  /** ตัวอย่างในช่องเหตุผล — ต่างกันตามหัวข้อ (เดิมใช้ตัวอย่างของ early_departure ทุกหัวข้อ) */
  placeholder: string;
}

export const MEMO_TYPES: MemoType[] = [
  {
    key: 'early_departure',
    label: 'ขอออกปฏิบัติงานก่อนกำหนด',
    subject: 'ขออนุญาตให้นักศึกษาออกปฏิบัติสหกิจศึกษาก่อนกำหนด',
    intent: 'ขออนุญาตออกปฏิบัติสหกิจศึกษาก่อนกำหนดตามปฏิทินสหกิจศึกษาของคณะ',
    hint: 'สถานประกอบการต้องการให้เริ่มงานก่อนวันที่คณะกำหนดไว้ในปฏิทิน',
    outcome: 'เจ้าหน้าที่เปิดรอบพิเศษ ให้ส่งเอกสารก่อนช่วงปกติได้ (ไม่นับว่าช้า)',
    placeholder:
      'เช่น สถานประกอบการกำหนดเงื่อนไขการเข้าร่วมสหกิจศึกษาไม่น้อยกว่า 6 เดือน จึงจำเป็นต้องเริ่มปฏิบัติงานก่อนวันที่คณะกำหนด',
  },
  {
    key: 'change_company',
    label: 'ขอเปลี่ยนสถานประกอบการ',
    subject: 'ขอเปลี่ยนแปลงสถานประกอบการสหกิจศึกษา',
    intent: 'ขอเปลี่ยนแปลงสถานประกอบการที่จะเข้าปฏิบัติสหกิจศึกษา',
    hint: 'ได้รับการตอบรับจากที่หนึ่งแล้ว แต่จำเป็นต้องย้ายไปอีกที่หนึ่ง (ต้องทำเอกสารหมายเลข 1 ของที่ใหม่ด้วย)',
    outcome: 'เจ้าหน้าที่ปิดใบที่ฝึกเดิม แล้วนักศึกษายื่นใบแจ้งความจำนงของที่ใหม่ได้',
    placeholder: 'เช่น สถานที่เดิมแจ้งว่าไม่มีงานตรงสาขา และได้รับการตอบรับจากสถานที่ใหม่แล้ว',
  },
  {
    key: 'terminated',
    label: 'ถูกส่งตัวกลับ / ยุติการปฏิบัติงาน',
    subject: 'ขอรายงานกรณียุติการปฏิบัติสหกิจศึกษาก่อนครบกำหนด',
    intent: 'ขอรายงานกรณียุติการปฏิบัติสหกิจศึกษาก่อนครบกำหนดระยะเวลา',
    hint: 'สถานประกอบการส่งตัวกลับ หรือมีเหตุให้ต้องยุติการปฏิบัติงานกลางคัน',
    outcome: 'เจ้าหน้าที่ดำเนินการปิดใบที่ฝึกของนักศึกษาตามคำตัดสินของคณบดี',
    placeholder: 'เช่น สถานประกอบการแจ้งยุติการปฏิบัติงานเนื่องจากโครงการที่ได้รับมอบหมายสิ้นสุดลง',
  },
  {
    key: 'late_submission',
    label: 'ส่งเอกสารล่าช้ากว่ากำหนด',
    subject: 'ขอผ่อนผันการส่งเอกสารสหกิจศึกษาล่าช้ากว่ากำหนด',
    intent: 'ขอผ่อนผันการส่งเอกสารสหกิจศึกษาที่ล่าช้ากว่ากำหนดตามปฏิทินสหกิจศึกษา',
    hint: 'ยื่นเอกสารหลังวันปิดรับตามปฏิทิน ขอผ่อนผันให้ส่งได้',
    outcome: 'เจ้าหน้าที่เปิดรอบพิเศษ ให้ส่งเอกสารที่เลือกได้ (นับว่าช้า ต้องระบุเหตุผลตอนส่ง)',
    placeholder: 'เช่น ป่วยเข้ารักษาตัวที่โรงพยาบาลช่วงวันที่ 10–15 ต.ค. จึงส่งเอกสารไม่ทันกำหนด',
  },
];

/**
 * รายละเอียดเฉพาะหัวข้อ — เจ้าของเลือกดีไซน์ B 2026-10-18 · เก็บใน `student_memos.details` (JSONB)
 *
 *   early_departure → start_date   วันที่ขอเริ่มปฏิบัติงาน (บังคับ)
 *   late_submission → activities   เอกสารที่ขอผ่อนผัน (บังคับ ≥1 · เฉพาะกิจกรรมที่เปิดรอบพิเศษได้)
 *                     expected_date วันที่คาดว่าจะส่งได้ (บังคับ)
 *   change_company  → new_company  สถานที่ที่จะย้ายไป (ไม่บังคับ — บางคนยังไม่ได้ที่ใหม่)
 *   terminated      → end_date     วันที่สิ้นสุดการปฏิบัติงานจริง (ไม่บังคับ)
 *
 * คีย์อื่นที่ส่งมาถูกทิ้งเงียบ ๆ — ไม่มีทางยัดข้อมูลอะไรก็ได้ลงฐาน
 */
export type MemoDetails = {
  start_date?: string;
  activities?: string[];
  expected_date?: string;
  new_company?: string;
  end_date?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export type ParsedMemoDetails = { ok: true; details: MemoDetails } | { ok: false; message: string };

export function parseMemoDetails(memoType: string, raw: unknown): ParsedMemoDetails {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  if (memoType === 'early_departure') {
    if (!isRealDate(src.start_date)) {
      return { ok: false, message: 'กรุณาระบุวันที่ขอเริ่มปฏิบัติงาน' };
    }
    return { ok: true, details: { start_date: src.start_date } };
  }

  if (memoType === 'late_submission') {
    const list = Array.isArray(src.activities) ? src.activities : [];
    const keys = [...new Set(list.filter((k): k is string => typeof k === 'string'))];
    if (keys.length === 0 || keys.some((k) => !isRoundableActivity(k))) {
      return { ok: false, message: 'กรุณาเลือกเอกสารที่ขอผ่อนผันอย่างน้อยหนึ่งอย่าง' };
    }
    if (!isRealDate(src.expected_date)) {
      return { ok: false, message: 'กรุณาระบุวันที่คาดว่าจะส่งเอกสารได้' };
    }
    return { ok: true, details: { activities: keys, expected_date: src.expected_date } };
  }

  if (memoType === 'change_company') {
    const name = typeof src.new_company === 'string' ? src.new_company.trim().slice(0, 200) : '';
    return { ok: true, details: name ? { new_company: name } : {} };
  }

  if (memoType === 'terminated') {
    if (src.end_date !== undefined && src.end_date !== null && src.end_date !== '' && !isRealDate(src.end_date)) {
      return { ok: false, message: 'วันที่สิ้นสุดการปฏิบัติงานไม่ถูกต้อง' };
    }
    return { ok: true, details: isRealDate(src.end_date) ? { end_date: src.end_date } : {} };
  }

  return { ok: true, details: {} };
}

/**
 * หัวข้อที่เมื่อคณบดีอนุมัติแล้ว เจ้าหน้าที่นำเข้าไปเปิด "รอบพิเศษ" ได้ (เจ้าของเคาะ 2026-10-18)
 * อีกสองหัวข้อ (เปลี่ยนสถานประกอบการ · ยุติการปฏิบัติงาน) คณบดีตัดสินได้เหมือนกันแต่ยังไม่ผูกกับการกระทำใด
 */
export const ROUND_MEMO_TYPES = ['early_departure', 'late_submission'] as const;

const BY_KEY = new Map(MEMO_TYPES.map((t) => [t.key, t]));

export function memoType(key: string): MemoType | null {
  return BY_KEY.get(key) ?? null;
}

export function isMemoType(value: unknown): value is string {
  return typeof value === 'string' && BY_KEY.has(value);
}
