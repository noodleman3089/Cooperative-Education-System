import fs from 'fs';
import { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { FONT_PATH } from './thaiPdf';
import { RequestFormData } from './requestFormHtml';

/**
 * เอกสารหมายเลข ๑ — แบบคำร้องขอหนังสือขอความอนุเคราะห์ **ฉบับที่ระบบกรอกให้แล้ว**
 *
 * วางตัวหนังสือทับแบบฟอร์มตัวจริงของคณะ (`secure_private/templates/request_form_template.pdf`)
 * เดิมระบบส่งแบบฟอร์มเปล่าให้นักศึกษาเขียนเองทั้งใบ ทั้งที่ข้อมูลทุกช่องอยู่ในฐานแล้ว
 * และคู่มือหน้า 4 กำหนดว่าใบนี้ต้อง "พิมพ์เท่านั้น" (อาจารย์ที่ปรึกษาโปรเจคทัก 2026-10-05)
 *
 * ⛔ **พิกัดตายตัวถูกแล้วที่นี่** — ต่างจาก `ThaiPdf` ที่ห้ามนับพิกัดเอง เพราะที่นั่นเนื้อหา
 *    ยาวไม่เท่ากันทุกใบ ส่วนที่นี่เส้นประอยู่บนแม่แบบซึ่งไม่ขยับ · พิกัดวัดจากตำแหน่งป้าย
 *    ในแม่แบบ (หน้า Letter 612×792pt) **เปลี่ยนไฟล์แม่แบบเมื่อไหร่ต้องวัดใหม่ทั้งชุด**
 *
 * สิ่งที่ยังเว้นให้ปากกา: **ลายมือชื่อ** นักศึกษา · อาจารย์ที่ปรึกษา · หัวหน้าสาขาวิชา
 * และกรอบของเจ้าหน้าที่ในหน้า 2 — ระบบไม่มีสิทธิ์เติมลายมือชื่อแทนใคร (SEC-04)
 *
 * ค่าที่ฐานไม่มี → ไม่วาดอะไร เส้นประของแม่แบบยังอยู่ให้เขียนมือได้เป็นทางสำรอง
 * ส่วน **โทรศัพท์บ้าน · มือถือและโทรสารของสถานประกอบการ** ระบบไม่เก็บโดยตั้งใจ จึงขีด "-"
 */

export interface RequestFormPdfData extends RequestFormData {
  /** วันนี้ตามเวลาไทย จาก Postgres (`YYYY-MM-DD`) — วันที่ยื่นคำร้องบนหัวกระดาษ */
  today: string | null;
  /** วันเริ่ม/สิ้นสุดการปฏิบัติงานจากปฏิทินสหกิจของภาคเรียนที่ยื่น */
  coop_start_date: string | null;
  coop_end_date: string | null;
}

const SIZE = 14;
const MIN_SIZE = 9;
/** ขอบขวาของเส้นประทุกบรรทัดบนแม่แบบ */
const RIGHT = 558;
/** ยกตัวหนังสือขึ้นจาก baseline ของป้าย ให้นั่งอยู่เหนือเส้นประ ไม่ทับกัน */
const LIFT = 2;

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const clean = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

/** แยกสตริง `YYYY-MM-DD` ตรงๆ ไม่ผ่าน `new Date()` — การ parse ทำให้วันเลื่อนได้ */
function thaiDateParts(iso: string | null): { day: string; month: string; year: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(iso));
  if (!match) return null;
  const month = THAI_MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return { day: String(Number(match[3])), month, year: String(Number(match[1]) + 543) };
}

/** ตัดบรรทัดตามช่องว่าง · บรรทัดสุดท้ายรับส่วนที่เหลือทั้งหมด (ตัววาดจะย่อตัวอักษรให้พอดี) */
function wrap(font: PDFFont, text: string, widths: number[]): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    const isLastLine = lines.length === widths.length - 1;
    if (current && !isLastLine && font.widthOfTextAtSize(next, SIZE) > widths[lines.length]) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function buildRequestFormPdf(
  templatePath: string,
  d: RequestFormPdfData
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(fs.readFileSync(templatePath));
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(FONT_PATH()));
  const page: PDFPage = doc.getPage(0);

  /** วาดค่าหนึ่งช่อง — ยาวเกินช่องให้ย่อตัวอักษร ไม่ปล่อยล้นไปทับช่องข้างๆ */
  const put = (value: unknown, x: number, y: number, maxWidth = RIGHT - x, center = false): void => {
    const text = clean(value);
    if (!text) return;
    let size = SIZE;
    while (size > MIN_SIZE && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
    const width = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: center ? x - width / 2 : x, y: y + LIFT, size, font });
  };

  const studentName = [d.first_name, d.last_name].map(clean).filter(Boolean).join(' ');
  // `master_major.major_name_th` มีคำว่า "สาขาวิชา" ในตัวเอง ส่วนกระดาษพิมพ์ป้ายนี้ไว้แล้ว
  const majorName = clean(d.major_name_th).replace(/^สาขาวิชา\s*/, '');
  // `coop_semesters.academic_year` เก็บเป็น ค.ศ. โดยตั้งใจ (BUG-01) — เอกสารราชการต้อง +543
  const academicYearBE =
    d.academic_year === null || d.academic_year === undefined ? '' : d.academic_year + 543;
  const address = [d.company_address, d.company_district, d.company_province, d.company_postal_code]
    .map(clean)
    .filter(Boolean)
    .join(' ');

  // ── หัวกระดาษ: วันที่ยื่น ──
  const today = thaiDateParts(d.today);
  if (today) {
    put(today.day, 350, 663.8, 26, true);
    put(today.month, 441, 663.8, 80, true);
    put(today.year, 531, 663.8, 50, true);
  }

  // ── ส่วนนักศึกษา ──
  put(studentName, 242, 581.4);
  put(d.student_code, 144, 561.6, 158);
  put(majorName, 346, 561.6);
  put(d.year_level, 96, 541.8, 40, true);
  put('-', 180, 541.8);
  put(d.phone, 402, 541.8);
  put(clean(d.university_email) || d.alt_email, 86, 522.0);
  put(d.semester, 512, 502.1, 86, true);
  put(academicYearBE, 147, 482.4, 96, true);

  // ── ส่วนสถานประกอบการ ──
  put(d.company_name, 174, 462.6);
  const addressLines = wrap(font, address, [RIGHT - 195, RIGHT - 54, RIGHT - 54]);
  if (addressLines[0]) put(addressLines[0], 195, 442.8);
  if (addressLines[1]) put(addressLines[1], 54, 423.0);
  if (addressLines[2]) put(addressLines[2], 54, 403.2);
  put(d.contact_person, 234, 383.4);
  put(d.contact_position, 127, 363.5, 210);
  put(d.company_phone, 410, 363.5);
  put('-', 149, 343.7);
  put('-', 376, 343.7);
  put(d.company_email, 124, 324.1);

  // วันเริ่ม: ถ้าสถานประกอบการยืนยันวันแล้วใช้วันนั้น ไม่งั้นใช้ปฏิทินสหกิจ · วันสิ้นสุด: ปฏิทินสหกิจ
  const start = thaiDateParts(d.start_date) ?? thaiDateParts(d.coop_start_date);
  if (start) {
    put(start.day, 238, 304.3, 56, true);
    put(start.month, 333, 304.3, 84, true);
    put(start.year, 440, 304.3, 84, true);
  }
  const end = thaiDateParts(d.coop_end_date);
  if (end) {
    put(end.day, 230, 284.4, 72, true);
    put(end.month, 333, 284.4, 84, true);
    put(end.year, 440, 284.4, 84, true);
  }

  // ชื่อตัวบรรจงใต้ช่องลงชื่อ — ลายมือชื่อเองยังต้องเซ็นด้วยปากกา
  put(studentName, 423.6, 225.1, 190, true);

  return doc.save();
}
