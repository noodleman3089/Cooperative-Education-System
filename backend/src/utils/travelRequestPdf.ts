import { rgb } from 'pdf-lib';
import { ThaiPdf } from './thaiPdf';
import { formatThaiDate } from './thaiDate';

/**
 * บันทึกข้อความขออนุมัติเดินทางไปราชการ สำหรับอาจารย์นิเทศ
 * — วาดตามแบบฟอร์มในคู่มือการทำเอกสารสหกิจศึกษาและฝึกงาน หน้า 33 (ตัวอย่างหน้า 34)
 *
 * ⛔ **ปุ่มพิมพ์สำรอง** (เจ้าของเคาะ 2026-09-15 · spec-F ข้อ 6.4) — การอนุมัติจริงเดินผ่าน
 *    หัวหน้าสาขาและคณบดีทางระบบสารบรรณ E-document ของมหาวิทยาลัย (คู่มือหน้า 50)
 *    ระบบนี้จึงไม่มีสถานะ "รออนุมัติ" ไม่เก็บไฟล์ และไม่มีการอัปโหลดกลับ
 *
 * ⛔ เว้นว่างโดยตั้งใจ: เลขที่หนังสือ · วันที่ · ลายมือชื่อทุกช่อง · ชื่อหัวหน้าสาขา · ความเห็นคณบดี
 *    — เลขที่หนังสือยังไม่ตัดสินว่าใครออก และระบบไม่รู้ว่าหัวหน้าสาขาคนไหนเป็นผู้ลงนาม
 * ⛔ ไม่พิมพ์ชื่อบุคลากรเฉพาะคณะที่อยู่ในตัวอย่าง (รองคณบดี · การเงิน) — ไม่ใช่ข้อมูลในระบบ
 */

export interface TravelRequestData {
  visit_number: 1 | 2;
  advisor_first_name: string | null;
  advisor_last_name: string | null;
  major_name_th: string | null;
  faculty_name_th: string | null;
  rows: Array<{
    first_name: string | null;
    last_name: string | null;
    company_name_th: string | null;
    appointment_date: string;
  }>;
}

/** แบบฟอร์มมีตาราง 10 แถว — มากกว่านั้นให้ทำเป็นอีกใบ */
export const TRAVEL_REQUEST_MAX_ROWS = 10;

const stripMajorPrefix = (name: string | null | undefined): string =>
  (name ?? '').trim().replace(/^สาขาวิชา\s*/, '') || '-';

const joinName = (first: string | null, last: string | null): string =>
  [first ?? '', last ?? ''].map((s) => s.trim()).filter(Boolean).join(' ') || '-';

export async function buildTravelRequestPdf(d: TravelRequestData): Promise<Buffer> {
  const pdf = await ThaiPdf.create({ margin: 60, top: 60 });
  const major = stripMajorPrefix(d.major_name_th);
  const advisor = joinName(d.advisor_first_name, d.advisor_last_name);
  const LINE_GAP = 22;
  const box = (checked: boolean) => (checked ? '[/]' : '[  ]');

  pdf.line('บันทึกข้อความ', { size: 26, align: 'center', gap: 34 });
  pdf.line(`ส่วนราชการ  สาขาวิชา${major}`);
  pdf.line('ที่ ..............................................');
  pdf.space(-LINE_GAP);
  pdf.line('วันที่ ..............................................', { x: 320 });
  pdf.line('เรื่อง  ขออนุมัติเดินทางไปราชการเพื่อออกนิเทศงานนักศึกษา และขอหนังสือออกนิเทศงานนักศึกษา');
  pdf.line(`เรียน  คณบดี${d.faculty_name_th ?? ''}`);
  pdf.space(6);

  pdf.paragraph(`ข้าพเจ้า ${advisor} อาจารย์ประจำสาขาวิชา ${major}`, { indent: 40 });
  pdf.line('เป็นอาจารย์นิเทศงานนักศึกษา มีความประสงค์ โดยมีรายละเอียดดังนี้');
  pdf.line(`${box(d.visit_number === 1)} ขออนุมัติเดินทางไปราชการเพื่อออกนิเทศงานนักศึกษาสหกิจศึกษา ครั้งที่ 1`, { x: 80 });
  pdf.line(`${box(d.visit_number === 2)} ขออนุมัติเดินทางไปราชการเพื่อออกนิเทศงานนักศึกษาสหกิจศึกษา ครั้งที่ 2`, { x: 80 });
  pdf.line('ให้กับนักศึกษา โดยมีรายชื่อดังต่อไปนี้');
  pdf.space(4);

  // ── ตาราง ลำดับ · ชื่อ-สกุลนักศึกษา · ชื่อสถานประกอบการ · วันนิเทศ ──
  const left = 60;
  const cols = [44, 160, 200, 71]; // รวม 475 = กว้างหน้า A4 ลบขอบซ้ายขวา
  const rowH = 20;
  const page = pdf.currentPage;
  const drawRow = (cells: string[], top: number) => {
    let x = left;
    cells.forEach((text, i) => {
      page.drawRectangle({
        x, y: top - rowH, width: cols[i], height: rowH,
        borderColor: rgb(0, 0, 0), borderWidth: 0.6,
      });
      // ย่อจนพอดีช่อง — ชื่อบริษัทยาวเป็นเรื่องปกติ ห้ามล้นทับช่องถัดไป
      let size = 14;
      while (size > 10 && pdf.textWidth(text, size) > cols[i] - 8) size -= 1;
      let shown = text;
      while (shown.length > 1 && pdf.textWidth(shown, size) > cols[i] - 8) shown = shown.slice(0, -2) + '…';
      const tx = i === 0 ? x + (cols[i] - pdf.textWidth(shown, size)) / 2 : x + 4;
      pdf.drawAt(shown, tx, top - rowH + 6, size);
      x += cols[i];
    });
  };

  let top = pdf.cursorY + 10;
  drawRow(['ลำดับที่', 'ชื่อ-นามสกุลนักศึกษา', 'ชื่อสถานประกอบการ', 'วันนิเทศ'], top);
  for (let i = 0; i < TRAVEL_REQUEST_MAX_ROWS; i += 1) {
    top -= rowH;
    const r = d.rows[i];
    drawRow(
      r
        ? [String(i + 1), joinName(r.first_name, r.last_name), r.company_name_th ?? '-', formatThaiDate(r.appointment_date)]
        : [String(i + 1), '', '', ''],
      top
    );
  }
  pdf.space(pdf.cursorY - (top - rowH) + 18);

  pdf.line('จึงเรียนมาเพื่อโปรดพิจารณา', { x: 140 });
  pdf.space(18);

  const sign = (label: string, name: string, x: number, y: number) => {
    pdf.drawAt(`ลงชื่อ ...................................... ${label}`, x, y, 14);
    pdf.drawAt(`( ${name} )`, x + 40, y - 20, 14);
    pdf.drawAt('......../................../..........', x + 30, y - 40, 14);
  };
  const yy = pdf.cursorY;
  sign('ผู้ขออนุมัติ', advisor, 60, yy);
  sign('หัวหน้าสาขาวิชา', '......................................', 310, yy);
  pdf.space(80);

  pdf.line(`ความเห็นของคณบดี${d.faculty_name_th ?? ''}   ( ) อนุมัติ   ( ) ไม่อนุมัติ`, { size: 14 });
  pdf.space(14);
  pdf.line('ลงชื่อ ......................................  ......../................../..........', { size: 14, x: 280 });

  return pdf.save();
}
