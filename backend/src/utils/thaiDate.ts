/**
 * แปลงวันที่ `YYYY-MM-DD` (ค.ศ.) เป็นข้อความไทย พ.ศ. เช่น `1 ก.ย. 2569`
 *
 * ทำจาก `split('-')` ล้วนโดยตั้งใจ — ห้าม `new Date()` เพราะคอลัมน์ DATE ถูก `pg`
 * ส่งมาเป็นสตริงดิบ พอ parse จะได้เที่ยงคืน UTC แล้วเลื่อนวันไปหนึ่งวันเมื่อ
 * format ด้วยเวลาไทย
 *
 * ⚠️ มีคู่แฝดที่ frontend/src/utils/thaiDate.ts — แก้ที่นี่ต้องแก้อีกที่ด้วย
 * (โปรเจคนี้ไม่มี shared package ระหว่างสองฝั่ง จึงยอมให้ซ้ำ 12 บรรทัด)
 */

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export function formatThaiDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const monthName = THAI_MONTHS_SHORT[Number(month) - 1];
  if (!monthName) return isoDate;
  return `${Number(day)} ${monthName} ${Number(year) + 543}`;
}

const THAI_MONTHS_LONG = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/**
 * วันที่แบบหนังสือราชการ — ชื่อเดือนเต็ม เช่น `30 กันยายน 2569` (ยังเป็นเลขอารบิก ผู้เรียกแปลงเลขไทยเอง)
 * รับ `YYYY-MM-DD` (มีเวลาต่อท้ายได้) · แยกสตริงตรง ๆ ไม่ผ่าน `new Date()` · อ่านไม่ออกคืน null ไม่แต่งวันให้
 */
export function formatThaiDateLong(isoDate: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? '').trim());
  if (!match) return null;
  const monthName = THAI_MONTHS_LONG[Number(match[2]) - 1];
  if (!monthName) return null;
  return `${Number(match[3])} ${monthName} ${Number(match[1]) + 543}`;
}

/** เลขอารบิก → เลขไทย (๐–๙) ตัวอื่นคงเดิม — หนังสือราชการใช้เลขไทยทั้งฉบับ */
export function toThaiDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => String.fromCharCode(0x0e50 + Number(d)));
}
