import { formatThaiDateLong, toThaiDigits } from './thaiDate';
import { query } from '../config/database';
import {
  LETTER,
  LetterFrameData,
  closeLetter,
  letterBody,
  letterLabelled,
  letterPair,
  openLetter,
} from './coverLetterPdf';

/**
 * หนังสือส่งตัวนักศึกษาเข้าฝึกสหกิจศึกษา — เอกสาร **ขาออก** ใบที่สอง
 *
 * ⛔ **ไม่ใช่ใบเดียวกับหนังสือขอความอนุเคราะห์**
 *   ขอความอนุเคราะห์ = "จะรับนักศึกษาคนนี้ไหม" ออก**ก่อน**สถานประกอบการตอบ
 *   ส่งตัว          = "ตกลงแล้ว ขอส่งตัวไปเริ่มงาน" ออก**หลัง**เจ้าหน้าที่รับแบบตอบรับ
 *   (คู่มือ ๑๓ ขั้นตอน ข้อ ๙: นักศึกษารับหนังสือส่งตัวแล้วนำส่งสถานประกอบการเอง)
 *
 * 🆕 2026-10-09 **วาดตามตัวอย่างในคู่มือคณะ** ("ตัวอย่าง เอกสารส่งตัวเข้าสหกิจศึกษา" · `เอกสาร/manual-pages/pdf14-…jpg`)
 * หัวกระดาษ ท้ายกระดาษ ระยะ และบล็อกลงนามใช้ชุดเดียวกับหนังสือขอความอนุเคราะห์ (`coverLetterPdf.ts` — กระดาษหัวเดียวกัน)
 * · ⛔ ฉบับจริง **ไม่มี** บรรทัด "อ้างถึง" · "สิ่งที่ส่งมาด้วย" · ที่อยู่สถานประกอบการ · จำนวนสัปดาห์ · ชื่อพี่เลี้ยง — อย่าเอากลับมา
 *   (ของเดิมที่ระบบร่างเองพิมพ์ครบทุกอย่างนั้น)
 * · ⛔ ผู้รับ = คนเดียวกับหนังสือขอความอนุเคราะห์ (`companies.contact_person`) **ไม่ใช่ผู้ลงนามแบบตอบรับ**
 * · ⛔ ถ้อยคำคัดจากตัวอย่างในคู่มือ ห้ามเรียบเรียงใหม่เอง — รวมย่อหน้า "ขอส่งแบบประเมินผล…" ที่คงไว้ตามฉบับจริง
 *   ทั้งที่ระบบประเมินออนไลน์ (เจ้าของตัดสิน 2026-10-09)
 * · ⚠️ ฉบับที่มี "สิ่งที่ส่งมาด้วย แบบประเมินผลการฝึกงาน" คือของ **ฝึกงานวิชาชีพ** (คู่มือ PDF 24) ไม่ใช่ใบนี้
 */

export interface DispatchLetterData extends LetterFrameData {
  student_prefix: string | null;
  first_name: string | null;
  last_name: string | null;
  student_code: string | null;
  major_name_th: string | null;
  year_level: number | null;
  company_name: string | null;
  /** ผู้รับหนังสือ — ผู้ประสานงานของสถานประกอบการ คนเดียวกับที่หนังสือขอความอนุเคราะห์เรียนถึง */
  contact_person: string | null;
  start_date: string | null;
  end_date: string | null;
  academic_year: number | null;
  semester: string | null;
}

const { LEFT, SIZE, LINE, PARA_GAP, INDENT, UNIVERSITY, BLANK } = LETTER;

/**
 * สร้างหนังสือส่งตัว · แนบลายเซ็นเมื่อส่ง `signatureFile` มาเท่านั้น
 *
 * ฉบับที่ยังไม่ลงนามกับฉบับที่ลงนามแล้วเป็น **คนละไฟล์** โดยตั้งใจ (บรรทัดฐานเดียว
 * กับหนังสือขอความอนุเคราะห์) — ตีกลับได้จริง และกดเซ็นซ้ำก็ไม่มีลายเซ็นซ้อน
 * · วันที่บนหนังสือ = วันที่คณบดีลงนาม (`signedDate`) · ฉบับร่างใช้วันที่วาด
 */
export async function buildDispatchLetterPdf(
  d: DispatchLetterData,
  options: { signatureFile?: string | null; signedDate?: Date | null } = {}
): Promise<Buffer> {
  const { pdf, faculty, campus } = await openLetter(d, options.signedDate);
  /** "คณะ… มหาวิทยาลัย… เขตพื้นที่…" ตามที่ฉบับจริงเขียนเต็มทั้งสองย่อหน้า */
  const facultyFull = [faculty, UNIVERSITY, campus].filter(Boolean).join(' ');

  // ── เรื่อง · เรียน ── (ไม่มี "อ้างถึง" และ "สิ่งที่ส่งมาด้วย")
  letterLabelled(pdf, 'เรื่อง', 'ขอส่งนักศึกษาเข้าฝึกสหกิจศึกษา', LEFT + 36);
  // ผู้รับ + ชื่อสถานประกอบการบรรทัดเดียว · ไม่แปลงเลขในชื่อ (เป็นชื่อเฉพาะ)
  letterLabelled(
    pdf,
    'เรียน',
    [d.contact_person?.trim() || 'ผู้จัดการฝ่ายบุคคล', d.company_name?.trim()].filter(Boolean).join(' '),
    LEFT + 36
  );

  letterBody(
    pdf,
    toThaiDigits(
      `ตามที่ท่านให้ความอนุเคราะห์รับนักศึกษาของ ${facultyFull} เข้าฝึกสหกิจศึกษา` +
        `${LETTER.semesterPhrase(d)} แล้วนั้น ${faculty} จึงขอส่งนักศึกษาเข้าฝึกสหกิจศึกษา ` +
        'เพื่อเข้าฝึกในหน่วยงานหรือสถานประกอบการของท่าน ได้แก่'
    )
  );

  // ── ชื่อนักศึกษา · ช่วงปฏิบัติงาน (ตัวหนา เริ่มที่แนวย่อหน้า) ──
  const textX = LEFT + INDENT;
  pdf.ensureSpace(PARA_GAP + LINE * 3);
  pdf.space(PARA_GAP);
  const studentName =
    [`${d.student_prefix?.trim() ?? ''}${d.first_name?.trim() ?? ''}`, d.last_name?.trim()]
      .filter(Boolean)
      .join(' ') || '-';
  letterPair(pdf, textX, studentName, `รหัสนักศึกษา ${toThaiDigits(d.student_code ?? '-')}`);
  letterPair(
    pdf,
    textX,
    `นักศึกษาชั้นปีที่ ${toThaiDigits(String(d.year_level ?? '-'))}`,
    `สาขาวิชา${LETTER.stripMajorPrefix(d.major_name_th)}`
  );
  pdf.block(
    toThaiDigits(
      `โดยเริ่มปฏิบัติงานตั้งแต่วันที่ ${formatThaiDateLong(d.start_date) ?? BLANK} ` +
        `ถึง วันที่ ${formatThaiDateLong(d.end_date) ?? BLANK}`
    ),
    { x: textX, size: SIZE, gap: LINE, bold: true }
  );
  pdf.space(PARA_GAP);

  letterBody(
    pdf,
    'ในการนี้ เพื่อให้นักศึกษาได้บรรลุถึงวัตถุประสงค์ของการฝึกสหกิจศึกษาในครั้งนี้ จึงใคร่ขอส่ง' +
      'แบบประเมินผลนักศึกษาสหกิจศึกษา เพื่อให้หัวหน้างานหรือผู้ดูแลได้ทำการประเมินผลการฝึกสหกิจศึกษาของนักศึกษา ' +
      `และใคร่ขอให้ท่านจัดส่งคืนภายหลังมายังที่${facultyFull} โดยตรง`
  );
  letterBody(pdf, 'จึงเรียนมาเพื่อโปรดทราบ และขอขอบพระคุณเป็นอย่างยิ่งในการให้ความอนุเคราะห์');

  await closeLetter(pdf, d, options.signatureFile);

  return pdf.save();
}

/**
 * ข้อมูลทั้งหมดที่หนังสือส่งตัวต้องใช้
 *
 * หัว-ท้ายกระดาษและผู้รับมาจากที่มาเดียวกับหนังสือขอความอนุเคราะห์ (`COVER_LETTER_SELECT`):
 * ที่อยู่/โทรของคณะจาก `master_faculty` · อีเมลท้ายกระดาษ = เจ้าหน้าที่ที่รับคำร้องใบนี้ · ผู้รับ = `companies.contact_person`
 * ⛔ ไม่ดึงผู้ลงนามแบบตอบรับและพี่เลี้ยงมาที่นี่ — ฉบับจริงไม่พิมพ์สองอย่างนั้น
 */
const DISPATCH_LETTER_SELECT = `
  SELECT i.form_id, i.student_id, i.company_id,
         to_char(i.start_date, 'YYYY-MM-DD') AS start_date,
         to_char(i.end_date, 'YYYY-MM-DD')   AS end_date,
         i.dispatch_document_no,
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
  const text = (key: string): string | null => (row[key] as string | null | undefined) ?? null;
  return {
    document_no: text('dispatch_document_no'),
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
    academic_year: (row.academic_year as number) ?? null,
    semester: text('semester'),
    dean_title: text('dean_title'),
    dean_position: text('dean_position'),
    // ฉบับจริงเว้นสองเคาะระหว่างชื่อกับนามสกุลของผู้ลงนาม (เหมือนหนังสือขอความอนุเคราะห์)
    dean_name: [row.dean_first_name, row.dean_last_name].filter(Boolean).join('  ').trim() || null,
  };
}
