import fs from 'fs';
import path from 'path';
import { ThaiPdf } from './thaiPdf';
import { formatThaiDateLong, toThaiDigits } from './thaiDate';
import { query } from '../config/database';

/**
 * หนังสือขอความอนุเคราะห์รับนักศึกษาสหกิจศึกษา — เอกสาร **ขาออก**
 *
 * คนละใบกับแบบคำร้อง (เอกสารหมายเลข 1) ที่นักศึกษาเขียนถึงคณบดี: ใบนั้นคือขาเข้า
 * ใบนี้คือสิ่งที่คณะออกให้ นักศึกษารับไปยื่นสถานประกอบการเอง
 *
 * 🆕 2026-10-07 **วาดตามหนังสือฉบับจริงของคณะ** (เจ้าของให้ตัวอย่าง): ครุฑกลางหัวกระดาษ · ที่อยู่หน่วยงานมุมขวา ·
 * รายการ ๑ นักศึกษา / ๒ ระยะเวลา (ตัวหนา) · เลขไทยทั้งฉบับ · ท้ายกระดาษเป็นช่องทางติดต่องานสหกิจศึกษา
 * · ⛔ ฉบับจริง **ไม่มีที่อยู่สถานประกอบการ** — อย่าเอากลับมา (ของเดิมที่ระบบร่างเองพิมพ์ "ที่ตั้ง …")
 * · ⛔ ถ้อยคำสามย่อหน้าคัดจากฉบับจริง ห้ามเรียบเรียงใหม่เอง
 *
 * วาดเองทั้งใบด้วย `ThaiPdf` — ไม่มีแม่แบบให้ทายพิกัด **ตำแหน่งลายเซ็นคณบดีจึงมาจาก
 * `cursorY` หลังบรรทัดสุดท้ายจริง** ชื่อสถานประกอบการยาวจนขึ้นบรรทัดใหม่ก็เลื่อนตามเองทั้งบล็อก
 */

export interface CoverLetterData {
  document_no: string | null;
  faculty_name_th: string | null;
  /** หัวกระดาษมุมขวาและท้ายกระดาษ — มาจาก `master_faculty` (migration 052) ว่าง = ข้ามบรรทัดนั้น */
  campus_name: string | null;
  faculty_address: string | null;
  faculty_phone: string | null;
  /** อีเมลท้ายกระดาษ = บัญชีเจ้าหน้าที่ที่กดรับคำร้องใบนี้ (คนที่สถานประกอบการส่งแบบตอบรับกลับ) */
  officer_email: string | null;
  student_prefix: string | null;
  first_name: string | null;
  last_name: string | null;
  student_code: string | null;
  major_name_th: string | null;
  year_level: number | null;
  company_name: string | null;
  contact_person: string | null;
  /** วันเริ่ม/สิ้นสุดของใบ (มีหลังสถานประกอบการตอบรับ) — ก่อนนั้นใช้ช่วงจากปฏิทินสหกิจของภาคเรียน */
  start_date: string | null;
  end_date: string | null;
  coop_start_date: string | null;
  coop_end_date: string | null;
  academic_year: number | null;
  semester: string | null;
  dean_title: string | null;
  dean_name: string | null;
  /** ตำแหน่งใต้ชื่อ (ขึ้นบรรทัดใหม่ได้) — ว่าง = พิมพ์ "คณบดี" + ชื่อคณะ · ตั้งที่ `personnel.signing_position` */
  dean_position?: string | null;
}

/** บรรทัดตำแหน่งใต้ลายมือชื่อ — ค่าที่ผู้ลงนามตั้งเองชนะ · ว่าง = "คณบดี…" ตามเดิม */
export const signingPositionLines = (position: string | null | undefined, fallback: string): string[] => {
  const lines = (position ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [fallback];
};

const UNIVERSITY = 'มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก';

/** ตราครุฑหัวกระดาษ — ไฟล์วางเองที่เครื่อง ไม่เข้า git (เหมือนตรามหาวิทยาลัย) · ไม่มีไฟล์ = ไม่วาด */
const GARUDA_PATH = () => path.join(process.cwd(), 'secure_private', 'emblems', 'garuda.png');

// ── ระยะของหน้ากระดาษ (pt) วัดจากเส้นฐานของตัวหนังสือในไฟล์ฉบับจริง: ขอบซ้าย 3 ซม. ขวา 2 ซม. ──
// บรรทัดห่างกัน 18 · เว้น 6 ก่อนย่อหน้าใหม่ · เลขที่หนังสืออยู่ที่ y=719 · ท้ายกระดาษ 81/65/49
// ⛔ บล็อกลงนามพอดีหน้าแรกด้วยระยะชุดนี้ (เหลือ ~12pt) — ขยายระยะบรรทัดแล้วลายมือชื่อจะตกไปหน้า 2
const LEFT = 85;
const RIGHT = 57;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const HEAD_Y = 719;
const SIZE = 16;
const LINE = 18;
const PARA_GAP = 6;
/** ย่อหน้าบรรทัดแรก 2.5 ซม. */
const INDENT = 71;
/** ที่อยู่หน่วยงานมุมขวา · บรรทัดวันที่ · แกนกลางของบล็อกลงนาม */
const HEAD_X = 365;
const DATE_X = 315;
const SIGN_AXIS = 362;
/** รายการ ๑ / ๒: เลขข้อ · คอลัมน์ที่สองของบรรทัดชื่อ */
const LIST_X = 160;
const LIST_COL2_X = 302;
/** เส้นฐานบรรทัดแรกของท้ายกระดาษ (3 บรรทัด ขนาด 14 ห่างกัน 16) */
const FOOTER_Y = 81;
const FOOTER_LINE = 16;
/** ที่ว่างสำหรับลายมือชื่อ ระหว่าง "ขอแสดงความนับถือ" กับบรรทัดชื่อ */
const SIGN_ROOM = 54;

const BLANK = '..............................';

/**
 * ตัดคำว่า "สาขาวิชา" ที่ติดมากับค่าในฐานออก
 *
 * `master_major.major_name_th` เก็บว่า "สาขาวิชาวิทยาการคอมพิวเตอร์" ส่วนบรรทัดในหนังสือมีคำว่า
 * "สาขาวิชา" นำอยู่แล้ว ปล่อยไว้จะได้ "สาขาวิชาสาขาวิชาวิทยาการ…" (เจอตอนอ่านฉบับจริง 2026-08-27)
 */
const stripMajorPrefix = (name: string | null | undefined): string =>
  (name ?? '').trim().replace(/^สาขาวิชา\s*/, '') || '-';

const semesterPhrase = (d: CoverLetterData): string => {
  const year = d.academic_year ?? '-';
  // ภาค '3' คือภาคฤดูร้อน (ดู utils/semesterLabel.ts)
  return d.semester === '3'
    ? `ประจำภาคฤดูร้อน ปีการศึกษา ${year}`
    : `ประจำภาคการศึกษาที่ ${d.semester ?? '-'} ปีการศึกษา ${year}`;
};

/**
 * สร้างหนังสือ · แนบลายเซ็นเมื่อส่ง `signatureFile` มาเท่านั้น
 *
 * ฉบับที่ยังไม่ลงนามกับฉบับที่ลงนามแล้วเป็น **คนละไฟล์** โดยตั้งใจ — ผู้เรียกเก็บ
 * ต้นฉบับไว้เสมอ ตีกลับได้จริงและกดเซ็นซ้ำก็ไม่มีลายเซ็นซ้อน
 * · วันที่บนหนังสือ = วันที่คณบดีลงนาม (`signedDate`) · ฉบับร่างใช้วันที่วาด
 */
export async function buildCoverLetterPdf(
  d: CoverLetterData,
  options: { signatureFile?: string | null; signedDate?: Date | null } = {}
): Promise<Buffer> {
  // บรรทัดแรก (ที่ … / ชื่อคณะ) อยู่ระดับฐานครุฑ · ขอบล่าง = เส้นฐานบรรทัดแรกของท้ายกระดาษ
  // (`line()` กันที่ว่างใต้เส้นฐานอีกหนึ่งบรรทัดเสมอ บรรทัดสุดท้ายของบล็อกลงนามจึงไม่ชนท้ายกระดาษ)
  const pdf = await ThaiPdf.create({
    margin: LEFT,
    marginRight: RIGHT,
    top: PAGE_HEIGHT - HEAD_Y,
    bottom: FOOTER_Y,
    bold: true,
  });
  const faculty = d.faculty_name_th?.trim() || 'คณะ';
  const campus = d.campus_name?.trim() || '';

  // ── ครุฑ ──
  const garuda = GARUDA_PATH();
  if (fs.existsSync(garuda) && fs.statSync(garuda).size > 0) {
    await pdf.drawImageKeepingRatio(fs.readFileSync(garuda), {
      x: PAGE_WIDTH / 2,
      centered: true,
      y: pdf.cursorY - 2,
      height: 78,
    });
  }

  // ── ท้ายกระดาษของหน้าแรก (ตำแหน่งตายตัว ไม่ไหลตามเนื้อหา) ──
  const contact = [
    d.faculty_phone?.trim() ? `โทร. ${toThaiDigits(d.faculty_phone.trim())}` : null,
    // อีเมลคงตัวอักษรเดิม ไม่แปลงเลข
    d.officer_email?.trim() ? `อีเมล. ${d.officer_email.trim()}` : null,
  ].filter(Boolean);
  const footer = [
    `งานสหกิจศึกษาและฝึกงาน ${faculty}`,
    [UNIVERSITY, campus].filter(Boolean).join(' '),
    contact.join(' '),
  ].filter(Boolean);
  footer.forEach((text, i) => pdf.drawAt(text, LEFT, FOOTER_Y - i * FOOTER_LINE, 14));

  // ── หัวกระดาษ: เลขที่หนังสือซ้าย · ที่อยู่หน่วยงานขวา ──
  const headTop = pdf.cursorY;
  pdf.drawAt(`ที่ ${d.document_no ? toThaiDigits(d.document_no) : BLANK}`, LEFT, headTop, SIZE);
  const sender = [
    faculty,
    UNIVERSITY,
    campus,
    ...(d.faculty_address ?? '').split('\n').map((l) => toThaiDigits(l.trim())),
  ].filter(Boolean);
  sender.forEach((text, i) => pdf.drawAt(text, HEAD_X, headTop - i * LINE, SIZE));
  pdf.space(sender.length * LINE + PARA_GAP);

  const letterDate = options.signedDate ?? new Date();
  const iso = `${letterDate.getFullYear()}-${String(letterDate.getMonth() + 1).padStart(2, '0')}-${String(
    letterDate.getDate()
  ).padStart(2, '0')}`;
  pdf.line(toThaiDigits(formatThaiDateLong(iso) ?? ''), { x: DATE_X, gap: LINE });
  pdf.space(PARA_GAP);

  // ── เรื่อง · เรียน · สิ่งที่ส่งมาด้วย ── (ข้อความยาวขึ้นบรรทัดใหม่ตรงแนวเดิม ไม่กลับไปชิดขอบซ้าย)
  const labelled = (label: string, text: string, textX: number) => {
    pdf.drawAt(label, LEFT, pdf.cursorY, SIZE);
    pdf.block(text, { x: textX, gap: LINE });
    pdf.space(PARA_GAP);
  };
  labelled('เรื่อง', toThaiDigits(`ขอความอนุเคราะห์รับนักศึกษาสหกิจศึกษา ${semesterPhrase(d)}`), LEFT + 36);
  // ผู้รับ + ชื่อสถานประกอบการบรรทัดเดียวตามฉบับจริง · ไม่แปลงเลขในชื่อ (เป็นชื่อเฉพาะ)
  labelled(
    'เรียน',
    [d.contact_person?.trim() || 'ผู้จัดการฝ่ายบุคคล', d.company_name?.trim()].filter(Boolean).join(' '),
    LEFT + 36
  );
  labelled('สิ่งที่ส่งมาด้วย', 'แบบยืนยันแบบตอบรับนักศึกษาสหกิจศึกษา', LEFT + 72);

  const body = (text: string) => pdf.paragraph(text, { indent: INDENT, gap: LINE, thaiWrap: true });

  body(
    `ด้วย${faculty} ${UNIVERSITY}${campus ? ` ${campus}` : ''} ` +
      'ได้จัดการเรียนการสอนระดับปริญญาตรี ตามหลักสูตร นักศึกษาจะต้องได้รับการฝึกสหกิจศึกษาในองค์กรต่างๆ ' +
      'ที่มีมาตรฐาน เพื่อเพิ่มพูนและสามารถนำความรู้ ทักษะ และประสบการณ์จากการฝึกสหกิจศึกษาไปใช้ในการทำงาน' +
      `ที่มีคุณภาพต่อไปในอนาคต ${faculty}ได้เล็งเห็นถึงความสำคัญของการฝึกสหกิจศึกษาและพิจารณาแล้ว` +
      'เห็นว่าหน่วยงานของท่านมีความพร้อมในด้านต่างๆ ที่เป็นประโยชน์ต่อนักศึกษาในการได้ฝึกปฏิบัติงานจริง ' +
      'จึงขอความอนุเคราะห์จากหน่วยงานของท่านรับนักศึกษาเข้าฝึกสหกิจศึกษา ดังต่อไปนี้'
  );

  // ── รายการ ๑ / ๒ (ตัวหนา) ──
  const textX = LIST_X + pdf.textWidth('๑.  ', SIZE, true);
  const rightEdge = PAGE_WIDTH - RIGHT;
  /** สองช่องบนบรรทัดเดียว · ช่องขวาเลื่อนตามความยาวช่องซ้าย · ไม่พอ = ขึ้นบรรทัดใหม่ ไม่เขียนทับกัน */
  const pair = (left: string, right: string) => {
    const col2 = Math.max(LIST_COL2_X, textX + pdf.textWidth(left, SIZE, true) + 14);
    if (col2 + pdf.textWidth(right, SIZE, true) <= rightEdge) {
      pdf.drawAt(left, textX, pdf.cursorY, SIZE, undefined, true);
      pdf.line(right, { x: col2, gap: LINE, bold: true });
    } else {
      pdf.block(left, { x: textX, gap: LINE, bold: true });
      pdf.block(right, { x: textX, gap: LINE, bold: true });
    }
  };

  pdf.ensureSpace(PARA_GAP + LINE * 5);
  pdf.space(PARA_GAP);
  pdf.line('๑.  รายชื่อนักศึกษาสหกิจศึกษา', { x: LIST_X, gap: LINE, bold: true });
  const studentName =
    [`${d.student_prefix?.trim() ?? ''}${d.first_name?.trim() ?? ''}`, d.last_name?.trim()]
      .filter(Boolean)
      .join(' ') || '-';
  pair(studentName, `รหัสนักศึกษา ${toThaiDigits(d.student_code ?? '-')}`);
  pair(
    `นักศึกษาชั้นปีที่ ${toThaiDigits(String(d.year_level ?? '-'))}`,
    `สาขาวิชา${stripMajorPrefix(d.major_name_th)}`
  );

  const start = formatThaiDateLong(d.start_date) ?? formatThaiDateLong(d.coop_start_date);
  const end = formatThaiDateLong(d.end_date) ?? formatThaiDateLong(d.coop_end_date);
  pdf.line('๒.  ระยะเวลาการฝึกสหกิจศึกษา', { x: LIST_X, gap: LINE, bold: true });
  // ปฏิทินสหกิจของภาคนั้นยังไม่ได้ตั้ง = เว้นเส้นประให้เขียนมือ ไม่เดาวัน
  pdf.block(toThaiDigits(`ระหว่างวันที่ ${start ?? BLANK} ถึง ${end ?? BLANK}`), {
    x: textX,
    gap: LINE,
    bold: true,
  });

  body(
    `ในการนี้ ${faculty} จึงขอความอนุเคราะห์จากหน่วยงานของท่านรับนักศึกษาเข้าฝึกสหกิจศึกษา ` +
      'พร้อมกับขอความกรุณาตอบแบบตอบรับส่งคืนมหาวิทยาลัยฯ และหวังเป็นอย่างยิ่งว่าจะได้รับความอนุเคราะห์จากหน่วยงานของท่าน'
  );
  body('จึงเรียนมาเพื่อโปรดพิจารณา และขอขอบคุณเป็นอย่างสูงมา ณ โอกาสนี้');

  // ── บล็อกลงนาม ─────────────────────────────────────────────────────────
  // ⛔ ทุกตำแหน่งด้านล่างอ้างอิง `cursorY` ปัจจุบัน ไม่ใช่พิกัดคงที่ — ถ้าเนื้อหา
  // ด้านบนยาวขึ้น บล็อกนี้เลื่อนลงทั้งก้อน และขึ้นหน้าใหม่เองถ้าที่ไม่พอ
  // ความสูงของทั้งบล็อก (เว้น 12 + คำลงท้าย + ที่ลายมือชื่อ + สามบรรทัดชื่อ) — ต้องไม่ถูกตัดข้ามหน้า
  const positionLines = signingPositionLines(d.dean_position, `คณบดี${d.faculty_name_th?.trim() ?? ''}`);
  pdf.ensureSpace(12 + LINE + SIGN_ROOM + LINE * (2 + positionLines.length));
  pdf.space(12);
  pdf.line('ขอแสดงความนับถือ', { centerX: SIGN_AXIS, gap: LINE });

  const sigPath = options.signatureFile
    ? path.isAbsolute(options.signatureFile)
      ? options.signatureFile
      : path.join(process.cwd(), options.signatureFile)
    : null;
  // เว้นที่เท่ากันทั้งฉบับร่างและฉบับลงนาม — ตัวอย่างที่เจ้าหน้าที่ตรวจต้องหน้าตาเหมือนฉบับจริง
  pdf.space(SIGN_ROOM);
  if (sigPath && fs.existsSync(sigPath)) {
    // ลายมือชื่อวางเหนือบรรทัดชื่อ รักษาสัดส่วนเดิมของรูป
    await pdf.drawImageKeepingRatio(fs.readFileSync(sigPath), {
      x: SIGN_AXIS,
      centered: true,
      y: pdf.cursorY + 14,
      height: SIGN_ROOM - 8,
    });
  }

  // ตำแหน่งทางวิชาการพิมพ์ติดหน้าชื่อ ตามฉบับจริง: "(ผู้ช่วยศาสตราจารย์ละอองศรี  เหนี่ยงแจ่ม)"
  const deanName = d.dean_name?.trim()
    ? `${d.dean_title?.trim() ?? ''}${d.dean_name.trim()}`
    : '.....................................................';
  pdf.line(`(${deanName})`, { centerX: SIGN_AXIS, gap: LINE });
  positionLines.forEach((text) => pdf.line(text, { centerX: SIGN_AXIS, gap: LINE }));
  pdf.line(UNIVERSITY, { centerX: SIGN_AXIS, gap: LINE });

  return pdf.save();
}

/**
 * ข้อมูลทั้งหมดที่หนังสือต้องใช้ ดึงจากใบความจำนง
 *
 * อยู่ที่นี่ (ไม่ใช่ใน controller) เพราะมีผู้เรียกสามที่แล้ว: ตอนเจ้าหน้าที่ดูตัวอย่าง
 * ตอนออกเอกสาร และตอนคณบดีลงนาม — สามที่นี้ต้องพิมพ์ข้อมูลชุดเดียวกันเสมอ
 *
 * ชื่อคณบดีมาจาก `personnel` ของบัญชี role 'dean' ไม่ hardcode เพราะคณบดีเปลี่ยนได้
 * และชื่อนี้ถูกพิมพ์ลงหนังสือราชการจริง
 * · ช่วงฝึกจากปฏิทินสหกิจ = SQL เดียวกับเอกสารหมายเลข 1 (`loadRequestFormData`) สองใบต้องพิมพ์วันเดียวกัน
 */
const COVER_LETTER_SELECT = `
  SELECT i.form_id, i.student_id, i.company_id, i.officer_document_no,
         to_char(i.start_date, 'YYYY-MM-DD') AS start_date,
         to_char(i.end_date, 'YYYY-MM-DD')   AS end_date,
         (SELECT to_char(e.start_date, 'YYYY-MM-DD') FROM coop_calendar_events e
           WHERE e.semester_id = sem.semester_id AND e.activity_key = 'coop_start'
           LIMIT 1) AS coop_start_date,
         (SELECT to_char(e.end_date, 'YYYY-MM-DD') FROM coop_calendar_events e
           WHERE e.semester_id = sem.semester_id AND e.activity_key = 'coop_end'
           LIMIT 1) AS coop_end_date,
         s.student_code, s.name_prefix, s.first_name, s.last_name, s.year_level,
         mj.major_name_th,
         f.faculty_name_th, f.campus_name, f.address AS faculty_address, f.phone AS faculty_phone,
         c.name_th AS company_name, c.contact_person,
         sem.academic_year, sem.semester,
         officer.email AS officer_email,
         dean.first_name AS dean_first_name, dean.last_name AS dean_last_name,
         dean.academic_title AS dean_title, dean.signing_position AS dean_position
    FROM intent_forms i
    JOIN students s         ON i.student_id = s.student_id
    JOIN master_major mj    ON s.major_id = mj.major_id
    JOIN master_faculty f   ON mj.faculty_id = f.faculty_id
    JOIN companies c        ON i.company_id = c.company_id
    JOIN coop_semesters sem ON i.semester_id = sem.semester_id
    LEFT JOIN users officer ON officer.user_id = i.officer_approved_by
    LEFT JOIN LATERAL (
      SELECT p.first_name, p.last_name, p.academic_title, p.signing_position
        FROM personnel p
        JOIN user_roles ur ON ur.user_id = p.personnel_id AND ur.role_name = 'dean'
       ORDER BY p.personnel_id
       LIMIT 1
    ) dean ON TRUE
`;

export async function fetchCoverLetterData(
  formId: number
): Promise<Record<string, unknown> | null> {
  const res = await query(`${COVER_LETTER_SELECT} WHERE i.form_id = $1`, [formId]);
  return (res.rowCount ?? 0) === 0 ? null : (res.rows[0] as Record<string, unknown>);
}

/**
 * เวอร์ชันที่เริ่มจากเอกสารในคิวคณบดี — จับคู่กลับไปหาใบความจำนงด้วย
 * นักศึกษา + สถานประกอบการ + เลขที่หนังสือ
 *
 * `official_documents` ไม่มี form_id โดยตรง (ตารางนี้มีมาก่อนเส้นทางใหม่) จึงต้อง
 * เทียบสามค่านี้ · เลขที่หนังสือคือตัวที่ทำให้ไม่ชนกันเองเมื่อนักศึกษาคนเดิมยื่นซ้ำ
 */
export async function fetchCoverLetterDataByDoc(
  docId: number
): Promise<Record<string, unknown> | null> {
  const res = await query(
    `${COVER_LETTER_SELECT}
      WHERE i.student_id = (SELECT student_id FROM official_documents WHERE doc_id = $1)
        AND i.company_id = (SELECT company_id FROM official_documents WHERE doc_id = $1)
        AND i.officer_document_no IS NOT DISTINCT FROM
            (SELECT document_number FROM official_documents WHERE doc_id = $1)
      ORDER BY i.form_id DESC
      LIMIT 1`,
    [docId]
  );
  return (res.rowCount ?? 0) === 0 ? null : (res.rows[0] as Record<string, unknown>);
}

/** แปลงแถวจากฐานเป็น payload ของตัววาดหนังสือ */
export function toCoverLetterData(row: Record<string, unknown>): CoverLetterData {
  const text = (key: string): string | null => (row[key] as string | null | undefined) ?? null;
  return {
    document_no: text('officer_document_no'),
    faculty_name_th: text('faculty_name_th'),
    campus_name: text('campus_name'),
    faculty_address: text('faculty_address'),
    faculty_phone: text('faculty_phone'),
    officer_email: text('officer_email'),
    student_prefix: text('name_prefix'),
    first_name: text('first_name'),
    last_name: text('last_name'),
    student_code: text('student_code'),
    major_name_th: text('major_name_th'),
    year_level: (row.year_level as number) ?? null,
    company_name: text('company_name'),
    contact_person: text('contact_person'),
    start_date: text('start_date'),
    end_date: text('end_date'),
    coop_start_date: text('coop_start_date'),
    coop_end_date: text('coop_end_date'),
    academic_year: (row.academic_year as number) ?? null,
    semester: text('semester'),
    dean_title: text('dean_title'),
    dean_position: text('dean_position'),
    // ฉบับจริงเว้นสองเคาะระหว่างชื่อกับนามสกุลของผู้ลงนาม
    dean_name: [row.dean_first_name, row.dean_last_name].filter(Boolean).join('  ').trim() || null,
  };
}
