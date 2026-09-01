import { ThaiPdf } from './thaiPdf';
import { formatThaiDate } from './thaiDate';
import { memoType } from '../config/memoTypes';

/**
 * บันทึกข้อความของนักศึกษา — วาดตามแบบฟอร์มจริงในคู่มือ (PDF หน้า 45 · ตัวอย่างหน้า 48)
 *
 * ใบนี้เป็น **ขาเข้า** เหมือนแบบคำร้องเอกสารหมายเลข 1 คือสิ่งที่นักศึกษาเขียนถึงคณบดี
 * ไม่ใช่หนังสือที่คณะออกให้ · นักศึกษาพิมพ์จากระบบ ลงลายมือชื่อบนกระดาษ แล้วเดินเรื่อง
 * ตามขั้นตอน (เจ้าของเลือกทางเลือก ก. 2026-08-27: ระบบพิมพ์ให้ คนเดินเอกสารเอง)
 *
 * ⚠️ **ไม่มีตราครุฑ** เพราะโปรเจคไม่มีไฟล์ภาพตราครุฑ และการหามาจากอินเทอร์เน็ต
 * เป็นเรื่องเดียวกับที่ทำให้ลายเซ็นคณบดีมีปัญหามาแล้ว · หนังสือขาออกที่คณบดีลงนาม
 * (`coverLetterPdf.ts`) ก็ไม่มีตราเช่นกัน — ถ้าคณะให้ไฟล์ตรามา ใส่ทั้งสองใบพร้อมกัน
 *
 * ⛔ ช่อง "ที่" เว้นว่างโดยตั้งใจ — เลขหนังสือเป็นของงานสารบรรณ ไม่ใช่ของนักศึกษา
 * (บนฟอร์มจริงก็เว้นว่างไว้ให้เจ้าหน้าที่กรอก)
 */

export interface StudentMemoData {
  memo_type: string;
  reason: string;
  faculty_name_th: string | null;
  student_prefix?: string | null;
  first_name: string | null;
  last_name: string | null;
  student_code: string | null;
  major_name_th: string | null;
  student_phone: string | null;
  academic_year: number | null;
  semester: string | null;
  /** วันที่บนหัวกระดาษ · ค่าเริ่มต้นคือวันที่สร้างเอกสาร */
  issued_date?: string | null;
}

/** ตัดคำว่า "สาขาวิชา" ที่ติดมากับค่าในฐาน — เหตุผลเดียวกับใน `coverLetterPdf.ts` */
const stripMajorPrefix = (name: string | null | undefined): string =>
  (name ?? '').trim().replace(/^สาขาวิชา\s*/, '') || '-';

/**
 * "นายพหล ยั่งยืน" — คำนำหน้าติดกับชื่อต้น เว้นวรรคเฉพาะก่อนนามสกุล
 * ตามที่ตัวอย่างในคู่มือเขียนไว้ (การเว้นวรรคหลังคำนำหน้าเป็นรูปแบบที่ผิด)
 */
const fullName = (d: StudentMemoData): string => {
  const given = `${(d.student_prefix ?? '').trim()}${(d.first_name ?? '').trim()}`;
  return [given, (d.last_name ?? '').trim()].filter(Boolean).join(' ');
};

/**
 * ฟิลด์ที่ **ต้องมี** ก่อนจะพิมพ์ได้ — ทั้งสี่ถูกพิมพ์ลงเอกสารราชการที่เสนอคณบดี
 *
 * บทเรียนจากรอบ 49: หนังสือเคยออกไปพร้อม `( ..................... )` วงเล็บเปล่า
 * เพราะโปรไฟล์คณบดีไม่มีชื่อ · ด่านต้องอยู่ตรงต้นทาง ไม่ใช่ปล่อยให้พิมพ์แล้วค่อยรู้
 */
export function missingMemoFields(d: StudentMemoData): string[] {
  const missing: string[] = [];
  if (!(d.first_name ?? '').trim() || !(d.last_name ?? '').trim()) missing.push('ชื่อ-นามสกุล');
  if (!(d.student_code ?? '').trim()) missing.push('รหัสนักศึกษา');
  if (!(d.major_name_th ?? '').trim()) missing.push('สาขาวิชา');
  if (!(d.student_phone ?? '').trim()) missing.push('เบอร์โทรศัพท์');
  return missing;
}

export async function buildStudentMemoPdf(d: StudentMemoData): Promise<Buffer> {
  const type = memoType(d.memo_type);
  if (!type) throw new Error(`ไม่รู้จักหัวข้อบันทึกข้อความ: ${d.memo_type}`);

  const pdf = await ThaiPdf.create({ margin: 70, top: 60 });
  const major = stripMajorPrefix(d.major_name_th);
  const name = fullName(d) || '-';
  const term =
    d.semester && d.academic_year
      ? ` ภาคการศึกษาที่ ${d.semester} ปีการศึกษา ${d.academic_year}`
      : '';

  pdf.line('บันทึกข้อความ', { size: 26, align: 'center', gap: 34 });

  pdf.line('ส่วนราชการ  มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก เขตพื้นที่จักรพงษภูวนารถ');

  // "ที่" ว่างไว้ให้งานสารบรรณกรอก (เลขหนังสือไม่ใช่ของนักศึกษา) · บนฟอร์มจริง
  // "วันที่" อยู่บรรทัดเดียวกัน จึงถอย cursor ขึ้นหนึ่งบรรทัดก่อนเขียนตัวที่สอง
  // แล้วปล่อยให้ตัวที่สองเป็นคนเลื่อนลง — สุทธิแล้วเลื่อนลงบรรทัดเดียวตามที่ควร
  const LINE_GAP = 22; // = size 16 + 6 ตามค่าเริ่มต้นของ ThaiPdf.line()
  pdf.line('ที่ ..............................................');
  pdf.space(-LINE_GAP);
  pdf.line(`วันที่ ${formatThaiDate(d.issued_date ?? new Date().toISOString().slice(0, 10))}`, {
    x: 320,
  });
  pdf.line(`เรื่อง  ${type.subject}${term}`);
  pdf.line(`เรียน  คณบดี${d.faculty_name_th ? d.faculty_name_th : ''}`);
  pdf.space(10);

  pdf.paragraph(`ข้าพเจ้า ${name}   รหัสนักศึกษา ${d.student_code ?? '-'}`, { indent: 40 });
  pdf.line(`สาขาวิชา ${major}   เบอร์โทรศัพท์ ${d.student_phone ?? '-'}`);

  // บรรทัดนี้คือหัวใจของเอกสาร: ท่อนนำมาจากหัวข้อที่เลือก ส่วนเหตุผลเป็นคำของนักศึกษา
  // ซึ่งคณบดีอ่านจริง — ระบบเติมแทนไม่ได้และไม่ควรพยายาม
  pdf.paragraph(`มีความประสงค์ ${type.intent} เนื่องจาก ${d.reason.trim()}`);
  pdf.space(6);
  pdf.paragraph('จึงเรียนมาเพื่อโปรดพิจารณาอนุญาต', { indent: 40 });

  // บล็อกลายมือชื่อวางต่อจากเนื้อหาจริงเสมอ — เหตุผลยาวขึ้นก็เลื่อนลงตาม
  // ไม่ใช่พิกัดตายตัวที่จะไปทับข้อความเมื่อเหตุผลยาวหลายบรรทัด
  pdf.ensureSpace(110);
  pdf.space(40);

  const signX = 300;
  pdf.line('ลงชื่อ ................................................ นักศึกษา', { x: signX });
  pdf.line(`( ${name} )`, { x: signX + 30 });
  pdf.line(`นักศึกษาสาขาวิชา ${major}`, { x: signX });
  pdf.line(`เบอร์โทรศัพท์ ${d.student_phone ?? '-'}`, { x: signX });

  return pdf.save();
}
