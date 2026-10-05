import fs from 'fs';
import path from 'path';
import { ThaiPdf } from './thaiPdf';
import { formatThaiDate } from './thaiDate';
import { query } from '../config/database';

/**
 * หนังสือขอความอนุเคราะห์รับนักศึกษาเข้าปฏิบัติงานสหกิจศึกษา — เอกสาร **ขาออก**
 *
 * คนละใบกับแบบคำร้อง (เอกสารหมายเลข 1) ที่นักศึกษาเขียนถึงคณบดี: ใบนั้นคือขาเข้า
 * ใบนี้คือสิ่งที่คณะออกให้ นักศึกษารับไปยื่นสถานประกอบการเอง (เจ้าของเคาะ 2026-08-26
 * ว่าไม่ส่งอีเมลหาบริษัท และไม่ใช้ DocuSign)
 *
 * วาดเองทั้งใบด้วย `ThaiPdf` — ไม่มีแม่แบบให้ทายพิกัด **ตำแหน่งลายเซ็นคณบดีจึงมาจาก
 * `cursorY` หลังบรรทัดสุดท้ายจริง** ที่อยู่บริษัทยาวขึ้นก็เลื่อนตามเองทั้งบล็อก
 */

export interface CoverLetterData {
  document_no: string | null;
  faculty_name_th: string | null;
  student_prefix?: string | null;
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
  contact_person: string | null;
  contact_position: string | null;
  start_date: string | null;
  academic_year: number | null;
  semester: string | null;
  dean_name?: string | null;
}

/**
 * ตัดคำว่า "สาขาวิชา" ที่ติดมากับค่าในฐานออก
 *
 * `master_major.major_name_th` เก็บว่า "สาขาวิชาวิทยาการคอมพิวเตอร์" ส่วนประโยคใน
 * หนังสือมีคำว่า "สาขาวิชา" นำอยู่แล้ว ปล่อยไว้จะได้ "สาขาวิชาสาขาวิชาวิทยาการ…"
 * พิมพ์ลงหนังสือที่คณบดีเซ็น (เจอตอนอ่านฉบับจริง 2026-08-27 — แบบคำร้องขาเข้าก็เป็น
 * แบบเดียวกัน ดู `requestFormHtml.ts`)
 */
const stripMajorPrefix = (name: string | null | undefined): string =>
  (name ?? '').trim().replace(/^สาขาวิชา\s*/, '') || '-';

const fullAddress = (d: CoverLetterData): string =>
  [d.company_address, d.company_district, d.company_province, d.company_postal_code]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');

/**
 * สร้างหนังสือ · แนบลายเซ็นเมื่อส่ง `signatureFile` มาเท่านั้น
 *
 * ฉบับที่ยังไม่ลงนามกับฉบับที่ลงนามแล้วเป็น **คนละไฟล์** โดยตั้งใจ — ผู้เรียกเก็บ
 * ต้นฉบับไว้เสมอ ตีกลับได้จริงและกดเซ็นซ้ำก็ไม่มีลายเซ็นซ้อน (ของเดิมเขียนทับไฟล์เดิม
 * แล้วแปะรูปเพิ่มทุกครั้งที่กด)
 */
export async function buildCoverLetterPdf(
  d: CoverLetterData,
  options: { signatureFile?: string | null; signedDate?: Date | null } = {}
): Promise<Buffer> {
  const pdf = await ThaiPdf.create();
  const studentName = [d.first_name, d.last_name].filter(Boolean).join(' ').trim() || '-';

  pdf.line(`ที่ ${d.document_no ?? '..............................'}`, { size: 16 });
  pdf.space(4);
  pdf.line(d.faculty_name_th ?? 'คณะ', { size: 16, align: 'center' });
  pdf.line('มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก', { size: 16, align: 'center' });
  pdf.space(10);

  const today = options.signedDate ?? new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;
  pdf.line(`วันที่ ${formatThaiDate(iso)}`, { size: 16, x: 360 });
  pdf.space(6);

  pdf.line('เรื่อง  ขอความอนุเคราะห์รับนักศึกษาเข้าปฏิบัติงานสหกิจศึกษา', { size: 16 });
  pdf.line(`เรียน  ${d.contact_person ?? 'ผู้จัดการฝ่ายบุคคล'}`, { size: 16 });
  if (d.company_name) pdf.line(`         ${d.company_name}`, { size: 16 });
  pdf.space(8);

  pdf.paragraph(
    `ด้วย ${d.faculty_name_th ?? 'คณะ'} มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก ` +
      `ได้จัดให้มีการเรียนการสอนในระบบสหกิจศึกษา ซึ่งกำหนดให้นักศึกษาออกปฏิบัติงานจริง ` +
      `ณ สถานประกอบการ เป็นระยะเวลาไม่น้อยกว่า 16 สัปดาห์ ` +
      `ในภาคการศึกษาที่ ${d.semester ?? '-'} ปีการศึกษา ` +
      `${d.academic_year ?? '-'}`,
    { indent: 40 }
  );
  pdf.space(4);

  pdf.paragraph(
    `ในการนี้ คณะจึงขอความอนุเคราะห์จากท่าน ในการรับ ${studentName} ` +
      `รหัสประจำตัวนักศึกษา ${d.student_code ?? '-'} ` +
      `นักศึกษาชั้นปีที่ ${d.year_level ?? '-'} สาขาวิชา${stripMajorPrefix(d.major_name_th)} ` +
      `เข้าปฏิบัติงานสหกิจศึกษา ณ ${d.company_name ?? '-'} ` +
      `ที่ตั้ง ${fullAddress(d) || '-'}` +
      (d.start_date ? ` โดยกำหนดเริ่มปฏิบัติงานตั้งแต่วันที่ ${formatThaiDate(d.start_date)}` : ''),
    { indent: 40 }
  );
  pdf.space(4);

  pdf.paragraph(
    'จึงเรียนมาเพื่อโปรดพิจารณาให้ความอนุเคราะห์ และขอขอบคุณมา ณ โอกาสนี้',
    { indent: 40 }
  );

  // ── บล็อกลงนาม ─────────────────────────────────────────────────────────
  // ⛔ ทุกตำแหน่งด้านล่างอ้างอิง `cursorY` ปัจจุบัน ไม่ใช่พิกัดคงที่ — ถ้าเนื้อหา
  // ด้านบนยาวขึ้น บล็อกนี้เลื่อนลงทั้งก้อน และขึ้นหน้าใหม่เองถ้าที่ไม่พอ
  pdf.ensureSpace(150);
  pdf.space(20);

  const signX = 330;
  pdf.line('ขอแสดงความนับถือ', { size: 16, x: signX + 20 });

  if (options.signatureFile) {
    const sigPath = path.isAbsolute(options.signatureFile)
      ? options.signatureFile
      : path.join(process.cwd(), options.signatureFile);

    if (fs.existsSync(sigPath)) {
      // วางรูปใต้บรรทัด "ขอแสดงความนับถือ" โดยเว้นที่ให้รูปก่อน แล้วค่อยเลื่อน cursor
      // ตามความสูงจริง — สัดส่วนรูปคงเดิมเสมอ (ดู drawImageKeepingRatio)
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
    // ฉบับที่ยังไม่ลงนาม — เว้นที่ให้เท่ากับตอนมีลายเซ็น เพื่อให้ตัวอย่างที่เจ้าหน้าที่
    // ตรวจมีหน้าตาเหมือนฉบับจริง
    pdf.space(48);
  }

  pdf.line(`( ${d.dean_name?.trim() || '.....................................................'} )`, {
    size: 16,
    x: signX,
  });
  pdf.line(`คณบดี${d.faculty_name_th ?? ''}`, { size: 16, x: signX });

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
 */
const COVER_LETTER_SELECT = `
  SELECT i.form_id, i.student_id, i.company_id, i.start_date, i.officer_document_no,
         s.student_code, s.first_name, s.last_name, s.year_level,
         mj.major_name_th, f.faculty_name_th,
         c.name_th AS company_name, c.address AS company_address,
         c.district AS company_district, c.province AS company_province,
         c.postal_code AS company_postal_code,
         c.contact_person, c.contact_position,
         sem.academic_year, sem.semester,
         dean.first_name AS dean_first_name, dean.last_name AS dean_last_name
    FROM intent_forms i
    JOIN students s         ON i.student_id = s.student_id
    JOIN master_major mj    ON s.major_id = mj.major_id
    JOIN master_faculty f   ON mj.faculty_id = f.faculty_id
    JOIN companies c        ON i.company_id = c.company_id
    JOIN coop_semesters sem ON i.semester_id = sem.semester_id
    LEFT JOIN LATERAL (
      SELECT p.first_name, p.last_name
        FROM personnel p
        JOIN user_roles ur ON ur.user_id = p.personnel_id AND ur.role_name = 'dean'
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
  return {
    document_no: (row.officer_document_no as string) ?? null,
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
    contact_person: (row.contact_person as string) ?? null,
    contact_position: (row.contact_position as string) ?? null,
    start_date: (row.start_date as string) ?? null,
    academic_year: (row.academic_year as number) ?? null,
    semester: (row.semester as string) ?? null,
    dean_name: [row.dean_first_name, row.dean_last_name].filter(Boolean).join(' ').trim() || null,
  };
}
