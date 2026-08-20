/**
 * แปลงวันที่ `YYYY-MM-DD` (ค.ศ.) เป็นข้อความไทย พ.ศ. เช่น `1 ก.ย. 2569`
 *
 * ทำจาก `split('-')` ล้วนโดยตั้งใจ — ห้าม `new Date()` เพราะคอลัมน์ DATE ถูก `pg`
 * ส่งมาเป็นสตริงดิบ พอ parse จะได้เที่ยงคืน UTC แล้วเลื่อนวันไปหนึ่งวันเมื่อ
 * format ด้วยเวลาไทย · โค้ดรอบๆ ที่ใช้ `new Date(x).toLocaleDateString('th-TH')`
 * ทำได้เพราะคอลัมน์พวกนั้นเป็น TIMESTAMP ไม่ใช่ DATE — อย่าลอกมาใช้กับปฏิทิน
 *
 * ⚠️ มีคู่แฝดที่ backend/src/utils/thaiDate.ts — แก้ที่นี่ต้องแก้อีกที่ด้วย
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

/** ช่วงวันที่ — ยุบเหลือวันเดียวเมื่อเริ่มและจบวันเดียวกัน */
export function formatThaiRange(start: string, end: string): string {
  if (start === end) return formatThaiDate(start);
  return `${formatThaiDate(start)} – ${formatThaiDate(end)}`;
}
