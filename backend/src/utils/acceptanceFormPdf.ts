import fs from 'fs';
import path from 'path';
import { rgb } from 'pdf-lib';
import { ThaiPdf } from './thaiPdf';
import { formatThaiDateLong } from './thaiDate';

/**
 * เอกสารหมายเลข ๒ — แบบยืนยันแบบตอบรับนักศึกษาสหกิจศึกษา
 *
 * **สถานประกอบการเป็นผู้กรอกและลงนาม** ไม่ใช่นักศึกษาและไม่ใช่เจ้าหน้าที่
 * คณะออกให้คู่กับหนังสือขอความอนุเคราะห์ นักศึกษาถือไปทั้งสองใบ บริษัทกรอกและ
 * ลงนาม+ประทับตรา แล้วนักศึกษาถือกลับมาอัปโหลดเข้าระบบ
 *
 * ที่มาของแบบ: ไฟล์ตัวจริงจากเจ้าของ (ฉบับฝึกงานวิชาชีพ · ปรับปรุง ๑ ก.ย.๒๕๖๔)
 * เทียบกับฉบับสหกิจศึกษาในคู่มือ `เอกสาร/manual-pages/pdf09-*.jpg` — **สองฉบับ
 * ต่างกันแค่คำว่า "ฝึกงานวิชาชีพ" ↔ "สหกิจศึกษา" เท่านั้น** โครงเหมือนกันทุกช่อง
 * · ระบบนี้ทำเฉพาะเส้นสหกิจศึกษา จึงวาดฉบับสหกิจฯ อย่างเดียว
 *   ถ้าวันหนึ่งรองรับฝึกงานวิชาชีพด้วย ให้เปลี่ยนสามคำในไฟล์นี้ (หัวเรื่อง · หัวตาราง
 *   · ท้ายคำชี้แจง) ไม่ต้องรื้ออะไรอีก
 *
 * ⛔ **สิ่งที่ระบบเติมให้ ต่างจากฟอร์มกระดาษโดยตั้งใจ**
 * บนกระดาษจริงบริษัทเขียนเองทั้งใบ รวมชื่อบริษัทและชื่อนักศึกษา · เราเติมสามช่องนั้น
 * ให้เพราะระบบรู้อยู่แล้ว เหลือให้บริษัททำแค่ติ๊ก รับ/ไม่รับ กรอกผู้ประสานงาน และลงนาม
 * — ความสามารถเท่าเดิม กลไกเบาลง (บรรทัดฐานเดียวกับเอกสารหมายเลข 1)
 *
 * ⚠️ **ช่อง "ส่วนของเจ้าหน้าที่ประจำมหาวิทยาลัยฯ" เว้นว่างจนกว่าจะออกหนังสือส่งตัว**
 * เลขที่หนังสือส่งตัวออก *หลัง* ได้ใบนี้กลับมาแล้ว ตอนที่นักศึกษาพิมพ์เอาไปให้บริษัท
 * จึงยังไม่มีเลข · พอเจ้าหน้าที่ออกหนังสือส่งตัวแล้ว ใบนี้ถูกวาดสดใหม่พร้อมเลข
 * (ใบนี้ไม่เก็บไฟล์ จึงไม่มีฉบับเก่าค้างที่ขัดกับฐาน)
 * ⛔ **ช่อง "ลงชื่อ" ยังเว้นเสมอ** — เป็นลายมือชื่อเจ้าหน้าที่บนกระดาษ ระบบไม่มีสิทธิ์เติมให้
 */

const SEAL_PATH = () =>
  path.join(process.cwd(), 'secure_private', 'emblems', 'rmutto_seal.png');

export interface AcceptanceFormData {
  faculty_name_th: string | null;
  company_name: string | null;
  student_prefix?: string | null;
  first_name: string | null;
  last_name: string | null;
  major_name_th: string | null;
  /** เลขที่หนังสือส่งตัว — มีค่าเมื่อเจ้าหน้าที่ออกหนังสือส่งตัวไปแล้วเท่านั้น */
  dispatch_document_no?: string | null;
  /**
   * ค่าที่สถานประกอบการพิมพ์บนหน้าลิงก์ตอบรับ — ส่งมา (แม้ว่างทุกช่อง) = ทำเครื่องหมาย √ ช่อง "รับ" แถว ๑ ด้วย
   * ⛔ ลงกระดาษอย่างเดียว ไม่มีที่ไหนเก็บ · ช่อง "ลงชื่อ" กล่องตราประทับ และส่วนของเจ้าหน้าที่ยังว่างเสมอ
   */
  filled?: AcceptanceFormFill;
}

/** ทุกช่องไม่บังคับ — ช่องที่ไม่ส่งมายังเป็นเส้นประให้เขียนมือ */
export interface AcceptanceFormFill {
  coordinator_name?: string;
  coordinator_position?: string;
  office_phone?: string;
  mobile_phone?: string;
  fax?: string;
  email?: string;
  additional_info?: string;
  approver_name?: string;
  approver_position?: string;
  /** YYYY-MM-DD */
  approved_date?: string;
}

/** ตัดคำว่า "สาขาวิชา" ที่ติดมากับค่าในฐาน — เหตุผลเดียวกับใน `coverLetterPdf.ts` */
const stripMajorPrefix = (name: string | null | undefined): string =>
  (name ?? '').trim().replace(/^สาขาวิชา\s*/, '') || '-';

const fullName = (d: AcceptanceFormData): string => {
  const given = `${(d.student_prefix ?? '').trim()}${(d.first_name ?? '').trim()}`;
  return [given, (d.last_name ?? '').trim()].filter(Boolean).join(' ') || '-';
};

/**
 * ต่อเส้นประจาก `label` ไปจนสุดพิกัด `toX`
 *
 * ⛔ อย่านับจำนวนจุดเอาเอง — ความกว้างของ "." ในฟอนต์ TH Sarabun New ไม่ตรงกับ
 * ที่สายตาเดา และความยาวของ label ก็เปลี่ยนตามข้อมูลจริง (ชื่อบริษัทยาวไม่เท่ากัน)
 * ผลคือเส้นประสั้นบ้างยาวบ้างไม่เท่ากันสักบรรทัด ซึ่งเห็นชัดมากบนแบบฟอร์ม
 */
const dotsTo = (
  pdf: ThaiPdf,
  label: string,
  fromX: number,
  toX: number,
  size: number
): string => {
  const dotWidth = pdf.textWidth('.', size);
  const remaining = toX - fromX - pdf.textWidth(label, size);
  const count = Math.max(0, Math.floor(remaining / dotWidth));
  return label + '.'.repeat(count);
};

/** ตัดข้อความให้พอดีความกว้างของช่อง (ต่อท้าย ... เมื่อถูกตัด) — ช่องบนฟอร์มกว้างตายตัว ข้อความล้นจะทับช่องข้างๆ */
const fitText = (pdf: ThaiPdf, text: string, maxWidth: number, size: number): string => {
  if (pdf.textWidth(text, size) <= maxWidth) return text;
  let cut = text;
  while (cut && pdf.textWidth(`${cut}...`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}...`;
};

export async function buildAcceptanceFormPdf(d: AcceptanceFormData): Promise<Buffer> {
  // ขอบบนแคบกว่าเอกสารอื่นเพราะใบนี้แน่นและต้องจบในหน้าเดียวเหมือนของจริง
  const pdf = await ThaiPdf.create({ margin: 60, top: 46, bottom: 34 });
  const page = pdf.currentPage;
  const LEFT = 60;
  const RIGHT = pdf.pageWidth - 60;
  const ink = rgb(0, 0, 0);

  // ── หัวกระดาษ: ตราคณะซ้าย · ชื่อหน่วยงาน · "เอกสารหมายเลข ๒" ขวา ────────────
  const sealPath = SEAL_PATH();
  if (fs.existsSync(sealPath) && fs.statSync(sealPath).size > 0) {
    // วางโดยรักษาสัดส่วน — ไฟล์จริงเป็น RGBA 83x147 พื้นหลังโปร่งจริง
    await pdf.drawImageKeepingRatio(fs.readFileSync(sealPath), {
      x: LEFT,
      y: pdf.cursorY - 26,
      height: 44,
    });
  }

  pdf.line(d.faculty_name_th ?? 'คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ', {
    size: 14,
    x: LEFT + 42,
    gap: 18,
  });
  pdf.line('มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก เขตพื้นที่จักรพงษภูวนารถ', {
    size: 14,
    x: LEFT + 42,
    gap: 0,
  });
  pdf.line('เอกสารหมายเลข ๒', { size: 14, x: RIGHT - 92, gap: 26 });

  pdf.line('แบบยืนยันแบบตอบรับนักศึกษาสหกิจศึกษา', { size: 16, align: 'center', gap: 22 });

  // ── คำชี้แจง ────────────────────────────────────────────────────────────────
  pdf.line('คำชี้แจง  กรุณากรอกข้อมูลเพื่อยืนยันความประสงค์รับนักศึกษาสหกิจศึกษา', {
    size: 14,
    gap: 17,
  });
  pdf.line('ที่ได้รับการพิจารณาจากมหาวิทยาลัยฯ ภายใน ๑๕ วันทำการ และส่งกลับงานฝึกงานและ', {
    size: 14,
    x: LEFT + 52,
    gap: 17,
  });
  pdf.line('สหกิจศึกษา โดยมอบให้กับนักศึกษาหรือส่งทางโทรสารหรือทางไปรษณีย์ตามที่อยู่ในเอกสาร', {
    size: 14,
    x: LEFT + 52,
    gap: 17,
  });
  pdf.line('หลังจากได้รับหนังสือขอความอนุเคราะห์รับนักศึกษาสหกิจศึกษา', {
    size: 14,
    x: LEFT + 52,
    gap: 20,
  });

  // ── ข้อมูลสถานประกอบการ ─────────────────────────────────────────────────────
  // ชื่อบริษัทเติมให้ ที่เหลือเว้นเส้นประ เพราะมีแต่บริษัทที่รู้
  const F = 14;
  const MID = 300;
  const fill = (label: string, fromX: number, toX: number) => dotsTo(pdf, label, fromX, toX, F);
  // ช่องที่บริษัทพิมพ์มาจากหน้าลิงก์: ป้าย + ค่า (ตัดให้พอดีช่อง) แล้วต่อเส้นประจนสุด · ไม่มีค่า = เส้นประล้วนเหมือนเดิม
  const v = d.filled ?? {};
  const field = (label: string, value: string | undefined, fromX: number, toX: number) =>
    value
      ? fill(`${label} ${fitText(pdf, value, toX - fromX - pdf.textWidth(`${label}  `, F), F)} `, fromX, toX)
      : fill(label, fromX, toX);

  pdf.line(fill(`ชื่อสถานประกอบการ  ${d.company_name ?? ''} `, LEFT, RIGHT), { size: F, gap: 19 });
  pdf.line(field('ชื่อผู้ประสานงาน ', v.coordinator_name, LEFT, RIGHT), { size: F, gap: 19 });
  pdf.line(field('ตำแหน่ง ', v.coordinator_position, LEFT, MID - 12), { size: F, gap: 0 });
  pdf.line(field('โทรศัพท์ที่ทำงาน ', v.office_phone, MID, RIGHT), { size: F, x: MID, gap: 19 });
  pdf.line(field('โทรศัพท์มือถือ ', v.mobile_phone, LEFT, MID - 12), { size: F, gap: 0 });
  pdf.line(field('โทรสาร ', v.fax, MID, RIGHT), { size: F, x: MID, gap: 19 });
  pdf.line(field('E-mail ', v.email, LEFT, RIGHT), { size: F, gap: 22 });

  // ── ตารางรายชื่อนักศึกษา ────────────────────────────────────────────────────
  pdf.line('รายชื่อนักศึกษาสหกิจศึกษา', { size: 15, align: 'center', gap: 18 });
  pdf.line('โปรดระบุชื่อนักศึกษาและทำเครื่องหมาย  √  หน้าข้อความที่ท่านต้องการ', {
    size: 14,
    gap: 8,
  });

  // ตารางวาดเองด้วยพิกัดตรงๆ — `ThaiPdf` จงใจไม่มี API ตาราง เพราะที่นี่คือผู้เรียก
  // เดียวในทั้งโปรเจค การใส่ตัวช่วยเข้าไปจะเป็น abstraction ที่ไม่มีใครใช้ซ้ำ
  const COLS = [LEFT, LEFT + 52, LEFT + 232, LEFT + 382, LEFT + 428, RIGHT];
  const HEADERS = ['ลำดับที่', 'ชื่อ-นามสกุล', 'สาขาวิชา', 'รับ', 'ไม่รับ'];
  const ROW_H = 26;
  const tableTop = pdf.cursorY;
  const rowCount = 3; // หัวตาราง + 2 แถวตามฟอร์มจริง (บริษัทเดียวรับได้หลายคน)

  for (let r = 0; r <= rowCount; r++) {
    const y = tableTop - r * ROW_H;
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.8, color: ink });
  }
  for (const x of COLS) {
    page.drawLine({
      start: { x, y: tableTop },
      end: { x, y: tableTop - rowCount * ROW_H },
      thickness: 0.8,
      color: ink,
    });
  }

  /** ข้อความในเซลล์ — พิกัดสัมบูรณ์ ไม่ผ่าน cursor เพราะตารางไม่ได้ไหลตามเนื้อหา */
  const drawCell = (text: string, col: number, row: number) => {
    pdf.drawAt(text, COLS[col] + 6, tableTop - row * ROW_H - 18, 13);
  };

  HEADERS.forEach((h, i) => drawCell(h, i, 0));
  drawCell('๑', 0, 1);
  drawCell(fullName(d), 1, 1);
  drawCell(stripMajorPrefix(d.major_name_th), 2, 1);
  drawCell('๒', 0, 2);
  // บริษัทกรอกมาจากทาง "รับ" ของหน้าลิงก์ — ทำเครื่องหมายช่อง "รับ" ของนักศึกษาแถว ๑ ให้ (กลางช่อง)
  if (d.filled) {
    pdf.drawAt('√', (COLS[3] + COLS[4] - pdf.textWidth('√', 14)) / 2, tableTop - ROW_H - 18, 14);
  }

  pdf.space(rowCount * ROW_H + 20);

  // ── ข้อมูลเพิ่มเติม ─────────────────────────────────────────────────────────
  // สามบรรทัดตายตัวตามฟอร์ม (ใบต้องจบหน้าเดียว) — ข้อความที่กรอกตัดบรรทัดตามคำไทย เกินสามบรรทัดถูกตัดท้าย
  const INFO_LABEL = 'ข้อมูลเพิ่มเติม  ';
  const infoWidths = [RIGHT - (LEFT + 40) - pdf.textWidth(`${INFO_LABEL} `, F), RIGHT - LEFT, RIGHT - LEFT];
  const infoLines = v.additional_info
    ? pdf.wrapThai(v.additional_info, F, (i) => infoWidths[Math.min(i, 2)] - pdf.textWidth('  ', F))
    : [];
  const info = (i: number): string => {
    if (!infoLines[i]) return '';
    const text = i === 2 && infoLines.length > 3 ? `${infoLines[2]}...` : infoLines[i];
    return `${fitText(pdf, text, infoWidths[i] - pdf.textWidth('  ', F), F)} `;
  };
  pdf.line(fill(INFO_LABEL + info(0), LEFT + 40, RIGHT), { size: F, x: LEFT + 40, gap: 18 });
  pdf.line(fill(info(1), LEFT, RIGHT), { size: F, gap: 18 });
  pdf.line(fill(info(2), LEFT, RIGHT), { size: F, gap: 26 });

  // ── กล่องตราประทับ + บล็อกลงนามของบริษัท ────────────────────────────────────
  const stampTop = pdf.cursorY;
  const STAMP_W = 150;
  const STAMP_H = 110;
  page.drawRectangle({
    x: LEFT,
    y: stampTop - STAMP_H,
    width: STAMP_W,
    height: STAMP_H,
    borderWidth: 0.8,
    borderColor: ink,
  });
  pdf.drawAt('ที่ประทับตราสถานประกอบการ', LEFT + 4, stampTop - STAMP_H - 14, 12);

  const signX = LEFT + STAMP_W + 40;
  // สองบรรทัดแรกมีข้อความปิดท้าย จึงลากเส้นประถึงจุดที่เผื่อความกว้างของท้ายบรรทัดไว้แล้ว
  const suffix = ' ผู้อนุมัตินักศึกษา';
  pdf.drawAt(
    fill('ลงชื่อ ', signX, RIGHT - pdf.textWidth(suffix, F)) + suffix,
    signX,
    stampTop - 16,
    F
  );
  // ⛔ บรรทัด "ลงชื่อ" ข้างบนเว้นเสมอ — ลายมือชื่อและตราต้องเป็นของจริงบนกระดาษ · ชื่อในวงเล็บ ตำแหน่ง วันที่ พิมพ์ให้ได้
  const parenRight = RIGHT - pdf.textWidth(' )', F);
  pdf.drawAt(field('( ', v.approver_name, signX + 26, parenRight) + ' )', signX + 26, stampTop - 38, F);
  pdf.drawAt(field('ตำแหน่ง ', v.approver_position, signX, RIGHT), signX, stampTop - 60, F);
  pdf.drawAt(
    field('วันที่ ', formatThaiDateLong(v.approved_date) ?? undefined, signX, RIGHT),
    signX,
    stampTop - 82,
    F
  );

  pdf.space(STAMP_H + 26);

  // ── ส่วนของเจ้าหน้าที่ (ว่างจนกว่าจะออกหนังสือส่งตัว) ─────────────────────────
  const boxTop = pdf.cursorY;
  const BOX_X = LEFT + 190;
  const BOX_W = RIGHT - BOX_X;
  const BOX_H = 96;
  page.drawRectangle({
    x: BOX_X,
    y: boxTop - BOX_H,
    width: BOX_W,
    height: BOX_H,
    borderWidth: 0.8,
    borderColor: ink,
  });
  pdf.drawAt('ส่วนของเจ้าหน้าที่ประจำมหาวิทยาลัยฯ', BOX_X + 60, boxTop - 16, 13);
  const boxRight = BOX_X + BOX_W - 10;
  const dispatchNo = (d.dispatch_document_no ?? '').trim();
  pdf.drawAt(
    dotsTo(pdf, `เลขที่หนังสือส่งตัว ${dispatchNo}${dispatchNo ? ' ' : ''}`, BOX_X + 10, boxRight, 13),
    BOX_X + 10,
    boxTop - 38,
    13
  );
  pdf.drawAt(dotsTo(pdf, 'ลงชื่อ ', BOX_X + 10, boxRight, 13), BOX_X + 10, boxTop - 58, 13);
  pdf.drawAt(
    dotsTo(pdf, '( ', BOX_X + 30, boxRight - pdf.textWidth(' )', 13), 13) + ' )',
    BOX_X + 30,
    boxTop - 74,
    13
  );
  pdf.drawAt(dotsTo(pdf, 'วันที่ ', BOX_X + 10, boxRight, 13), BOX_X + 10, boxTop - 90, 13);

  pdf.space(BOX_H + 22);

  // ── หมายเหตุ ────────────────────────────────────────────────────────────────
  pdf.line('หมายเหตุ  หนังสือฉบับนี้จะสมบูรณ์ได้ก็ต่อเมื่อต้องมีการลงนามและประทับตรา', {
    size: 13,
    gap: 16,
  });
  pdf.line('ในแบบยืนยันแบบตอบรับนักศึกษาสหกิจศึกษา หรือหนังสือรับรองของสถานประกอบการ', {
    size: 13,
    x: LEFT + 52,
    gap: 16,
  });
  pdf.line('หน่วยงานราชการ รัฐวิสาหกิจ เท่านั้น', { size: 13, x: LEFT + 52, gap: 20 });

  pdf.line('ฉบับปรับปรุง ๑ ก.ย.๒๕๖๔  บังคับใช้ ๖ ก.ย.๒๕๖๔', {
    size: 12,
    align: 'center',
    gap: 0,
  });

  return pdf.save();
}
