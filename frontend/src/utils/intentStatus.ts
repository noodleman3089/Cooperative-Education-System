/**
 * สถานะที่ควรเอาไปขึ้นป้ายสำหรับใบความจำนงหนึ่งใบ
 *
 * ใบความจำนง **หยุดอยู่ที่ `approved_by_dept_head` ตลอดไป** ตั้งแต่เจ้าหน้าที่กดรับ
 * คำร้อง — ความคืบหน้าที่เหลือ (`pending_sign` → `signed`) ไปอยู่บนหนังสือขาออก
 * หน้าจอที่อ่านแต่ `intent_forms.status` จึงค้างคำว่า "รอออกหนังสือ" ทั้งที่คณบดี
 * เซ็นไปแล้ว (เจอทั้งหน้านักศึกษา ที่ปรึกษา และหัวหน้าสาขา ตอนเดินจริง 2026-08-27)
 *
 * ⛔ อยู่ที่นี่ที่เดียวเพราะมีผู้เรียกสามหน้าจอ — อย่าก็อปตรรกะนี้ไปไว้ในหน้าใดหน้าหนึ่ง
 * ⛔ **อย่าย้ายกลับไปไว้ใน `ui/StatusBadge.tsx`** — ไฟล์นั้น export component อยู่แล้ว
 *    การเพิ่ม export ที่ไม่ใช่ component ทำให้ `react-refresh/only-export-components`
 *    แดงเพิ่ม ซึ่งดันตัวเลข lint ที่โปรเจคนี้ตรึงไว้ที่ 33
 *
 * `coverLetterStatus` มาจาก `GET /api/intents` (คอลัมน์ `cover_letter_status`)
 * สำหรับหน้าบุคลากร · หน้านักศึกษาส่งมาจาก `documents` ของตัวเองแทน
 */
export const intentDisplayStatus = (
  status: string,
  coverLetterStatus?: string | null
): string => (status === 'approved_by_dept_head' && coverLetterStatus ? coverLetterStatus : status);

export type DeptHeadIntentStage = 'paper' | 'staff' | 'dean' | 'company' | 'accepted' | 'other';

/**
 * จัดกลุ่ม stage ของใบความจำนงสำหรับฝ่ายหัวหน้าสาขาวิชา (spec-G ข้อ 5 / SB-G1)
 *
 * ⚠️ ฟังก์ชันเดียวในระบบ ห้ามคิดนิยามใหม่:
 * - paper: pending_advisor (กำลังเดินเรื่องกระดาษ)
 * - staff: pending_officer_request / pending_officer_approval (เจ้าหน้าที่รับและตรวจ)
 * - dean: approved_by_dept_head และยังไม่ออกหนังสือเสร็จ (coverLetterStatus !== 'signed')
 * - company: approved_by_dept_head และออกหนังสือเสร็จแล้ว (coverLetterStatus === 'signed')
 * - accepted: ตอบรับแล้ว
 */
export const getIntentStage = (
  status: string,
  coverLetterStatus?: string | null
): DeptHeadIntentStage => {
  if (status === 'pending_advisor') return 'paper';
  if (status === 'pending_officer_request' || status === 'pending_officer_approval') return 'staff';
  if (status === 'approved_by_dept_head') {
    return coverLetterStatus === 'signed' ? 'company' : 'dean';
  }
  if (status === 'accepted') return 'accepted';
  return 'other';
};

