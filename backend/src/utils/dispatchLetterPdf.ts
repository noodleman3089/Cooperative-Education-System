import fs from 'fs';
import path from 'path';
import { ThaiPdf } from './thaiPdf';
import { formatThaiDate } from './thaiDate';
import { query } from '../config/database';
import { signingPositionLines } from './coverLetterPdf';

/**
 * หนังสือส่งตัวนักศึกษาเข้าปฏิบัติงานสหกิจศึกษา — เอกสาร **ขาออก** ใบที่สอง
 *
 * ⛔ **ไม่ใช่ใบเดียวกับหนังสือขอความอนุเคราะห์**
 *   ขอความอนุเคราะห์ = "จะรับนักศึกษาคนนี้ไหม" ออก**ก่อน**สถานประกอบการตอบ
 *   ส่งตัว          = "ตกลงแล้ว ขอส่งตัวไปเริ่มงาน" ออก**หลัง**เจ้าหน้าที่รับแบบตอบรับ
 *   (คู่มือ ๑๓ ขั้นตอน ข้อ ๙: นักศึกษารับหนังสือส่งตัวแล้วนำส่งสถานประกอบการเอง)
 *
 * ⛔ **ของเดิมถูกลบเมื่อ `efc4219` และเอากลับมาไม่ได้** — มันเป็นแม่แบบ HTML ที่
 * hardcode คณะวิทยาศาสตร์ฯ · ที่อยู่บางพระ · ชื่อคณบดีที่เป็น placeholder · ภาคเรียน
 * ๒/๒๕๖๘ ไว้ในตัวไฟล์ ใบนี้จึงเขียนใหม่ทั้งใบด้วย `ThaiPdf` แบบเดียวกับ
 * `coverLetterPdf.ts` — ทุกค่ามาจากฐาน และ **ตำแหน่งลายเซ็นมาจากบรรทัดสุดท้ายจริง**
 *
 * สิ่งที่ใบนี้พูดถึงและใบขอความอนุเคราะห์ไม่มี:
 *   - **ช่วงเวลาปฏิบัติงาน** ตั้งแต่วันที่ … ถึงวันที่ … (เจ้าหน้าที่คีย์ `end_date`)
 *   - **พนักงานที่ปรึกษา (พี่เลี้ยง)** ที่สถานประกอบการมอบหมายมาในแบบตอบรับ
 *   - **อ้างถึงแบบตอบรับ** ลงวันที่ที่เจ้าหน้าที่อ่านจากกระดาษแล้วคีย์ไว้ (รอบ 53)
 */

export interface DispatchLetterData {
  document_no: string | null;
  faculty_name_th: string | null;
  first_name: string | null;
  last_name: string | null;
  student_code: string | null;
  major_name_th: string | null;
  year_level: number | null;
  company_name: string | null;
  company_address: string | null;
  company_district: string | null;
  company_province: string | null;
  company_postal_code: string | null;
  /** ผู้รับหนังสือ — คนที่ลงนามอนุมัติในแบบตอบรับ ถ้าไม่มีค่อยใช้ผู้ประสานงานของบริษัท */
  recipient_name: string | null;
  recipient_position: string | null;
  acceptance_signed_date: string | null;
  start_date: string | null;
  end_date: string | null;
  mentor_name: string | null;
  mentor_position: string | null;
  academic_year: number | null;
  semester: string | null;
  dean_name?: string | null;
  /** ตำแหน่งทางวิชาการหน้าชื่อ และตำแหน่งใต้ชื่อ (ว่าง = "คณบดี…") — เหมือนหนังสือขอความอนุเคราะห์ */
  dean_title?: string | null;
  dean_position?: string | null;
}

/** ตัดคำว่า "สาขาวิชา" ที่ติดมากับค่าในฐาน — เหตุผลเดียวกับใน `coverLetterPdf.ts` */
const stripMajorPrefix = (name: string | null | undefined): string =>
  (name ?? '').trim().replace(/^สาขาวิชา\s*/, '') || '-';

const fullAddress = (d: DispatchLetterData): string =>
  [d.company_address, d.company_district, d.company_province, d.company_postal_code]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');

/**
 * จำนวนสัปดาห์ของช่วงปฏิบัติงาน — นับแบบรวมวันแรกและวันสุดท้าย
 *
 * ⛔ คำนวณด้วย `Date.UTC` ล้วนจากสตริง `YYYY-MM-DD` เหมือน `workingDays.ts`
 * ห้าม `new Date(iso)` เพราะมันเลื่อนวันตาม timezone แล้วสัปดาห์จะขาดหรือเกินหนึ่ง
 * · คืน `null` เมื่อวันใดวันหนึ่งหายไป ผู้เรียกจะได้ไม่พิมพ์ "รวม 0 สัปดาห์" ลงหนังสือ
 */
export function weeksBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const days = (toUtc(endIso) - toUtc(startIso)) / 86_400_000 + 1;
  if (!Number.isFinite(days) || days <= 0) return null;
  return Math.round(days / 7);
}

/**
 * สร้างหนังสือส่งตัว · แนบลายเซ็นเมื่อส่ง `signatureFile` มาเท่านั้น
 *
 * ฉบับที่ยังไม่ลงนามกับฉบับที่ลงนามแล้วเป็น **คนละไฟล์** โดยตั้งใจ (บรรทัดฐานเดียว
 * กับหนังสือขอความอนุเคราะห์) — ตีกลับได้จริง และกดเซ็นซ้ำก็ไม่มีลายเซ็นซ้อน
 */
export async function buildDispatchLetterPdf(
  d: DispatchLetterData,
  options: { signatureFile?: string | null; signedDate?: Date | null } = {}
): Promise<Buffer> {
  const pdf = await ThaiPdf.create();
  const studentName = [d.first_name, d.last_name].filter(Boolean).join(' ').trim() || '-';
  const faculty = d.faculty_name_th ?? 'คณะ';

  pdf.line(`ที่ ${d.document_no ?? '..............................'}`, { size: 16 });
  pdf.space(4);
  pdf.line(faculty, { size: 16, align: 'center' });
  pdf.line('มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก', { size: 16, align: 'center' });
  pdf.space(10);

  const today = options.signedDate ?? new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;
  pdf.line(`วันที่ ${formatThaiDate(iso)}`, { size: 16, x: 360 });
  pdf.space(6);

  pdf.line('เรื่อง  ส่งตัวนักศึกษาเข้าปฏิบัติงานสหกิจศึกษา', { size: 16 });
  pdf.line(`เรียน  ${d.recipient_name?.trim() || 'ผู้จัดการฝ่ายบุคคล'}`, { size: 16 });
  if (d.company_name) pdf.line(`         ${d.company_name}`, { size: 16 });
  if (d.acceptance_signed_date) {
    pdf.line(
      `อ้างถึง  แบบยืนยันแบบตอบรับนักศึกษาสหกิจศึกษา ลงวันที่ ${formatThaiDate(
        d.acceptance_signed_date
      )}`,
      { size: 16 }
    );
  }
  pdf.space(8);

  pdf.paragraph(
    `ตามที่ ${d.company_name ?? 'สถานประกอบการ'} ได้ตอบรับนักศึกษาของ${faculty} ` +
      `มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก เข้าปฏิบัติงานสหกิจศึกษา ` +
      `ในภาคการศึกษาที่ ${d.semester ?? '-'} ปีการศึกษา ` +
      `${d.academic_year ?? '-'} นั้น`,
    { indent: 40 }
  );
  pdf.space(4);

  const weeks = weeksBetween(d.start_date, d.end_date);
  const period =
    d.start_date && d.end_date
      ? ` ตั้งแต่วันที่ ${formatThaiDate(d.start_date)} ถึงวันที่ ${formatThaiDate(d.end_date)}` +
        (weeks ? ` รวมระยะเวลา ${weeks} สัปดาห์` : '')
      : '';

  pdf.paragraph(
    `บัดนี้ ${faculty} ขอส่งตัว ${studentName} ` +
      `รหัสประจำตัวนักศึกษา ${d.student_code ?? '-'} ` +
      `นักศึกษาชั้นปีที่ ${d.year_level ?? '-'} สาขาวิชา${stripMajorPrefix(d.major_name_th)} ` +
      `เข้าปฏิบัติงานสหกิจศึกษา ณ ${d.company_name ?? '-'} ` +
      `ที่ตั้ง ${fullAddress(d) || '-'}${period}` +
      (d.mentor_name
        ? ` โดยมี ${d.mentor_name}${
            d.mentor_position ? ` ตำแหน่ง ${d.mentor_position}` : ''
          } เป็นพนักงานที่ปรึกษา`
        : ''),
    { indent: 40 }
  );
  pdf.space(4);

  pdf.paragraph(
    'ในการนี้ คณะขอความอนุเคราะห์ท่านมอบหมายงาน ควบคุมดูแลการปฏิบัติงาน ' +
      'และประเมินผลการปฏิบัติงานของนักศึกษาตามแบบประเมินที่คณะกำหนด ' +
      'เพื่อนำผลไปใช้ในการวัดผลการศึกษาต่อไป',
    { indent: 40 }
  );
  pdf.space(4);

  pdf.paragraph('จึงเรียนมาเพื่อโปรดพิจารณา และขอขอบคุณมา ณ โอกาสนี้', { indent: 40 });

  // ── บล็อกลงนาม ─────────────────────────────────────────────────────────
  // ⛔ ทุกตำแหน่งอ้างอิง `cursorY` ปัจจุบัน ไม่ใช่พิกัดคงที่ — เนื้อหายาวขึ้นแล้ว
  //    บล็อกนี้เลื่อนลงทั้งก้อน และขึ้นหน้าใหม่เองถ้าที่ไม่พอ
  const positionLines = signingPositionLines(d.dean_position, `คณบดี${faculty}`);
  pdf.ensureSpace(150 + 18 * (positionLines.length - 1));
  pdf.space(20);

  const signX = 330;
  pdf.line('ขอแสดงความนับถือ', { size: 16, x: signX + 20 });

  if (options.signatureFile) {
    const sigPath = path.isAbsolute(options.signatureFile)
      ? options.signatureFile
      : path.join(process.cwd(), options.signatureFile);

    if (fs.existsSync(sigPath)) {
      const height = 40;
      pdf.space(height + 4);
      await pdf.drawImageKeepingRatio(fs.readFileSync(sigPath), {
        x: signX + 10,
        y: pdf.cursorY + 8,
        height,
      });
    } else {
      pdf.space(48);
    }
  } else {
    // ฉบับที่ยังไม่ลงนาม — เว้นที่เท่ากับตอนมีลายเซ็น เพื่อให้ตัวอย่างที่เจ้าหน้าที่
    // ตรวจมีหน้าตาเหมือนฉบับจริง
    pdf.space(48);
  }

  const deanName = d.dean_name?.trim()
    ? `${d.dean_title?.trim() ?? ''}${d.dean_name.trim()}`
    : '.....................................................';
  pdf.line(`( ${deanName} )`, { size: 16, x: signX });
  positionLines.forEach((text) => pdf.line(text, { size: 16, x: signX }));

  return pdf.save();
}

/**
 * ข้อมูลทั้งหมดที่หนังสือส่งตัวต้องใช้
 *
 * ผู้รับหนังสือคือ **คนที่ลงนามอนุมัติในแบบตอบรับ** ซึ่งเจ้าหน้าที่อ่านจากกระดาษแล้ว
 * คีย์ไว้ตั้งแต่รอบ 53 — นี่คือจุดที่ "บันทึกผลการตอบรับ" ถูกนำไปใช้จัดทำหนังสือส่งตัวจริง
 * ถ้าใบไหนไม่มี (ข้อมูลเก่า) ค่อยถอยไปใช้ผู้ประสานงานที่ผูกไว้กับบริษัท
 */
const DISPATCH_LETTER_SELECT = `
  SELECT i.form_id, i.student_id, i.company_id, i.start_date, i.end_date,
         i.dispatch_document_no, i.acceptance_signed_date,
         i.acceptance_signer_name, i.acceptance_signer_position,
         s.student_code, s.first_name, s.last_name, s.year_level,
         mj.major_name_th, f.faculty_name_th,
         c.name_th AS company_name, c.address AS company_address,
         c.district AS company_district, c.province AS company_province,
         c.postal_code AS company_postal_code,
         c.contact_person, c.contact_position,
         men.name AS mentor_name, men.position AS mentor_position,
         sem.academic_year, sem.semester,
         dean.first_name AS dean_first_name, dean.last_name AS dean_last_name,
         dean.academic_title AS dean_title, dean.signing_position AS dean_position
    FROM intent_forms i
    JOIN students s         ON i.student_id = s.student_id
    JOIN master_major mj    ON s.major_id = mj.major_id
    JOIN master_faculty f   ON mj.faculty_id = f.faculty_id
    JOIN companies c        ON i.company_id = c.company_id
    JOIN coop_semesters sem ON i.semester_id = sem.semester_id
    LEFT JOIN mentors men   ON i.mentor_id = men.mentor_id
    LEFT JOIN LATERAL (
      SELECT p.first_name, p.last_name, p.academic_title, p.signing_position
        FROM personnel p
        JOIN user_roles ur ON ur.user_id = p.personnel_id AND ur.role_name = 'dean'
       ORDER BY p.personnel_id
       LIMIT 1
    ) dean ON TRUE
`;

export async function fetchDispatchLetterData(
  formId: number
): Promise<Record<string, unknown> | null> {
  const res = await query(`${DISPATCH_LETTER_SELECT} WHERE i.form_id = $1`, [formId]);
  return (res.rowCount ?? 0) === 0 ? null : (res.rows[0] as Record<string, unknown>);
}

/**
 * เวอร์ชันที่เริ่มจากเอกสารในคิวคณบดี — จับคู่กลับไปหาใบความจำนงด้วย
 * นักศึกษา + สถานประกอบการ + เลขที่หนังสือส่งตัว
 *
 * `official_documents` ไม่มี form_id โดยตรง (เหตุผลเดียวกับ `fetchCoverLetterDataByDoc`)
 * · ที่นี่เทียบกับ `dispatch_document_no` ไม่ใช่ `officer_document_no` — คนละเลข คนละใบ
 */
export async function fetchDispatchLetterDataByDoc(
  docId: number
): Promise<Record<string, unknown> | null> {
  const res = await query(
    `${DISPATCH_LETTER_SELECT}
      WHERE i.student_id = (SELECT student_id FROM official_documents WHERE doc_id = $1)
        AND i.company_id = (SELECT company_id FROM official_documents WHERE doc_id = $1)
        AND i.dispatch_document_no IS NOT DISTINCT FROM
            (SELECT document_number FROM official_documents WHERE doc_id = $1)
      ORDER BY i.form_id DESC
      LIMIT 1`,
    [docId]
  );
  return (res.rowCount ?? 0) === 0 ? null : (res.rows[0] as Record<string, unknown>);
}

/** แปลงแถวจากฐานเป็น payload ของตัววาดหนังสือ */
export function toDispatchLetterData(row: Record<string, unknown>): DispatchLetterData {
  return {
    document_no: (row.dispatch_document_no as string) ?? null,
    faculty_name_th: (row.faculty_name_th as string) ?? null,
    first_name: (row.first_name as string) ?? null,
    last_name: (row.last_name as string) ?? null,
    student_code: (row.student_code as string) ?? null,
    major_name_th: (row.major_name_th as string) ?? null,
    year_level: (row.year_level as number) ?? null,
    company_name: (row.company_name as string) ?? null,
    company_address: (row.company_address as string) ?? null,
    company_district: (row.company_district as string) ?? null,
    company_province: (row.company_province as string) ?? null,
    company_postal_code: (row.company_postal_code as string) ?? null,
    recipient_name:
      (row.acceptance_signer_name as string) ?? (row.contact_person as string) ?? null,
    recipient_position:
      (row.acceptance_signer_position as string) ?? (row.contact_position as string) ?? null,
    acceptance_signed_date: (row.acceptance_signed_date as string) ?? null,
    start_date: (row.start_date as string) ?? null,
    end_date: (row.end_date as string) ?? null,
    mentor_name: (row.mentor_name as string) ?? null,
    mentor_position: (row.mentor_position as string) ?? null,
    academic_year: (row.academic_year as number) ?? null,
    semester: (row.semester as string) ?? null,
    dean_name: [row.dean_first_name, row.dean_last_name].filter(Boolean).join(' ').trim() || null,
    dean_title: (row.dean_title as string) ?? null,
    dean_position: (row.dean_position as string) ?? null,
  };
}
