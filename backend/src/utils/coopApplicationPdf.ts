import fs from 'fs';
import path from 'path';
import { rgb } from 'pdf-lib';
import { ThaiPdf } from './thaiPdf';
import { query } from '../config/database';
import { decryptSensitive } from './encryption';

/**
 * สหกิจ 03 — ใบสมัครงานสหกิจศึกษา (๓ หน้า)
 *
 * ที่มาของแบบ: ไฟล์ `.docx` ตัวจริงจากเจ้าของ
 * `เอกสาร/เอกสารสำหรับเทมเพลต/สหกิจศึกษา-03-ใบสมัครงานสหกิจศึกษา-แก้ไข-2-ข้อ7.docx`
 * (ฉบับปรับปรุง ๑๑ ก.พ. ๖๓) — ถอดคำต่อคำ **ห้ามแต่งถ้อยคำเอง**
 *
 * ⛔⛔ **นี่คือจุดเดียวในระบบที่เห็นค่าจริงของเลขบัตรประชาชน เชื้อชาติ และศาสนา**
 * ทุกที่อื่นเห็นแค่มาสก์ (`GET /students/coop-application`) หรือไม่เห็นเลย
 * (`…/company-view` ตัดชั้น C ออกทั้งหมด) · เหตุผลที่ต้องถอดรหัสตรงนี้คือ
 * **สามช่องนี้ถูกพิมพ์ลงกระดาษจริง** ซึ่งเป็นเหตุผลเดียวกับที่ SEC-12 เลือกเข้ารหัส
 * แบบถอดกลับได้แทน hash · ผลที่ตามมา:
 *   1. endpoint ที่เรียกไฟล์นี้ **ต้องเป็นของนักศึกษาเจ้าของข้อมูลเท่านั้น**
 *      ห้ามรับ `:id` จากผู้เรียก และห้ามเปิดให้บริษัท/เจ้าหน้าที่
 *   2. ทุกครั้งที่ถูกเรียก ต้องมีแถวใน `audit_log` (ผู้เรียกเป็นคนเขียน ไม่ใช่ที่นี่)
 *
 * ⛔ **ช่องลงชื่อเว้นว่างเสมอ** — ใบนี้พิมพ์ไปเซ็นด้วยมือแล้วยื่นให้สถานประกอบการ
 */

const A4_H = 841.89;

export interface CoopApplicationPdfData {
  // ─ หัวใบ: ตำแหน่งที่สมัคร
  company_name: string | null;
  position: string | null;
  start_date: string | null;
  end_date: string | null;
  // ─ ตัวตน
  first_name: string | null;
  last_name: string | null;
  first_name_en: string | null;
  last_name_en: string | null;
  student_code: string | null;
  major_name_th: string | null;
  year_level: number | null;
  advisor_name: string | null;
  cumulative_gpa: string | null;
  /** ⛔ ค่าจริงหลังถอดรหัส — ห้ามส่งออกจากกระบวนการวาดเอกสาร */
  national_id: string | null;
  national_id_issued_district: string | null;
  national_id_expiry_date: string | null;
  birth_date: string | null;
  gender: string | null;
  /** ⛔ ค่าจริงหลังถอดรหัส */
  ethnicity: string | null;
  nationality: string | null;
  /** ⛔ ค่าจริงหลังถอดรหัส */
  religion: string | null;
  current_address: string | null;
  phone: string | null;
  mobile_phone: string | null;
  fax: string | null;
  alt_email: string | null;
  emergency_contact_name: string | null;
  emergency_relationship: string | null;
  emergency_address: string | null;
  emergency_phone: string | null;
  profile_image: string | null;
  // ─ JSONB
  family_info: FamilyInfo | null;
  career_objective: string | null;
  interested_job_types: string[] | null;
  activity_history: Row[] | null;
  language_proficiency: Row[] | null;
  education_history: Row[] | null;
  training_history: Row[] | null;
}

type Row = Record<string, string>;
interface FamilyInfo {
  father?: Row;
  mother?: Row;
  sibling_count?: string;
  birth_order?: string;
  siblings?: Row[];
}

/** ถอดรหัสให้ปลอดภัยต่อการล้มเหลว — กุญแจเปลี่ยนแล้วต้องไม่ทำให้ทั้งใบพิมพ์ไม่ออก */
const tryDecrypt = (
  ciphertext: unknown,
  iv: unknown,
  authTag: unknown
): string | null => {
  if (!ciphertext || !iv || !authTag) return null;
  try {
    return decryptSensitive({
      ciphertext: ciphertext as string,
      iv: iv as string,
      authTag: authTag as string,
    });
  } catch {
    return null;
  }
};

/**
 * อ่านทุกอย่างที่ใบนี้ต้องใช้ **แล้วถอดรหัสให้เสร็จที่นี่**
 *
 * ตำแหน่งงานและระยะเวลามาจากใบความจำนงล่าสุด (ไม่จำกัดสถานะ) เพราะบนกระดาษ
 * นักศึกษาเขียนสามช่องนี้ตอน *กำลังจะสมัคร* ซึ่งเกิดก่อนบริษัทตอบรับเสมอ
 */
export async function fetchCoopApplicationPdfData(
  studentId: number
): Promise<CoopApplicationPdfData | null> {
  const res = await query(
    `SELECT s.first_name, s.last_name, s.first_name_en, s.last_name_en,
            s.student_code, s.year_level, s.cumulative_gpa::text AS cumulative_gpa,
            s.birth_date::text AS birth_date, s.gender, s.nationality,
            s.current_address, s.phone, s.mobile_phone, s.fax, s.alt_email,
            s.emergency_contact_name, s.emergency_relationship,
            s.emergency_address, s.emergency_phone, s.profile_image,
            s.national_id_issued_district,
            s.national_id_expiry_date::text AS national_id_expiry_date,
            s.national_id_ciphertext, s.national_id_iv, s.national_id_tag,
            s.ethnicity_ciphertext, s.ethnicity_iv, s.ethnicity_tag,
            s.religion_ciphertext, s.religion_iv, s.religion_tag,
            s.family_info, s.career_objective, s.interested_job_types,
            s.activity_history, s.language_proficiency,
            s.education_history, s.training_history,
            mj.major_name_th,
            NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '') AS advisor_name,
            c.name_th AS company_name,
            j.title   AS position,
            i.start_date::text AS start_date,
            i.end_date::text   AS end_date
       FROM students s
       JOIN master_major mj ON s.major_id = mj.major_id
       LEFT JOIN personnel p ON p.personnel_id = s.advisor_id
       LEFT JOIN LATERAL (
         SELECT company_id, job_id, start_date, end_date
           FROM intent_forms
          WHERE student_id = s.student_id
          ORDER BY form_id DESC LIMIT 1
       ) i ON TRUE
       LEFT JOIN companies c ON c.company_id = i.company_id
       LEFT JOIN job_posts j ON j.job_id = i.job_id
      WHERE s.student_id = $1`,
    [studentId]
  );
  if ((res.rowCount ?? 0) === 0) return null;

  const r = res.rows[0] as Record<string, unknown>;
  return {
    ...(r as unknown as CoopApplicationPdfData),
    national_id: tryDecrypt(r.national_id_ciphertext, r.national_id_iv, r.national_id_tag),
    ethnicity: tryDecrypt(r.ethnicity_ciphertext, r.ethnicity_iv, r.ethnicity_tag),
    religion: tryDecrypt(r.religion_ciphertext, r.religion_iv, r.religion_tag),
  };
}

const clean = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).trim();

/** `1234567890123` → `1 2345 67890 12 3` ตามช่องบนบัตร */
const spaceNationalId = (id: string): string => {
  const digits = id.replace(/\D/g, '');
  if (digits.length !== 13) return id;
  return `${digits[0]} ${digits.slice(1, 5)} ${digits.slice(5, 10)} ${digits.slice(10, 12)} ${digits[12]}`;
};

/**
 * อายุจากวันเกิด — เทียบเป็นสตริง `YYYY-MM-DD` ตลอด
 * (`new Date(iso)` ทำให้วันเพี้ยนไปหนึ่งวันตาม timezone ซึ่งเคยทำให้เกิดบั๊กมาแล้ว)
 */
const ageFrom = (birthIso: string | null): string => {
  const b = clean(birthIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return '';
  const today = new Date().toISOString().slice(0, 10);
  let age = Number(today.slice(0, 4)) - Number(b.slice(0, 4));
  if (today.slice(5) < b.slice(5)) age -= 1;
  return age >= 0 && age < 130 ? String(age) : '';
};

/** `2004-05-17` → `17 พ.ค. 2547` — สั้นพอที่จะลงช่องบนแบบฟอร์ม */
const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];
const shortThaiDate = (iso: string | null): string => {
  const d = clean(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const month = THAI_MONTHS[Number(d.slice(5, 7)) - 1];
  return `${Number(d.slice(8, 10))} ${month} ${Number(d.slice(0, 4)) + 543}`;
};

const rowsOf = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]).filter((r) => r && typeof r === 'object') : [];

export async function buildCoopApplicationPdf(d: CoopApplicationPdfData): Promise<Buffer> {
  const pdf = await ThaiPdf.create({ margin: 50, top: 44, bottom: 40 });
  const LEFT = 50;
  const RIGHT = pdf.pageWidth - 50;
  const F = 13;
  const ink = rgb(0, 0, 0);

  const dots = (label: string, fromX: number, toX: number, size = F): string => {
    const dotWidth = pdf.textWidth('.', size);
    const remaining = toX - fromX - pdf.textWidth(label, size);
    return label + '.'.repeat(Math.max(0, Math.floor(remaining / dotWidth)));
  };
  /** ช่อง "ป้าย + ค่า" หนึ่งช่อง — ค่ามีเว้นวรรคปิดท้ายเพื่อไม่ให้จุดชนตัวอักษร */
  const field = (label: string, value: string, fromX: number, toX: number, size = F) =>
    dots(`${label} ${value}${value ? ' ' : ''}`, fromX, toX, size);

  /**
   * วางหลายช่องในบรรทัดเดียว โดยแบ่งความกว้างตามน้ำหนักที่ให้
   * `right` ใช้เมื่อบรรทัดนั้นวิ่งไปชนของที่วางไว้แล้ว (กรอบรูปถ่ายมุมขวาบนหน้า ๑)
   */
  const row = (
    fields: { label: string; value: string; weight?: number }[],
    gap: number,
    opts: { size?: number; right?: number } = {}
  ) => {
    const size = opts.size ?? F;
    const right = opts.right ?? RIGHT;
    const total = fields.reduce((s, f) => s + (f.weight ?? 1), 0);
    let x = LEFT;
    fields.forEach((f, i) => {
      const width = ((right - LEFT) * (f.weight ?? 1)) / total;
      const end = i === fields.length - 1 ? right : x + width - 8;
      pdf.line(field(f.label, f.value, x, end, size), {
        size,
        x,
        gap: i === fields.length - 1 ? gap : 0,
      });
      x += width;
    });
  };

  /**
   * ท้ายกระดาษที่ต้นฉบับพิมพ์ไว้ — ตรึงไว้ล่างสุดของหน้า ไม่ใช่ต่อท้ายเนื้อหา
   *
   * ⚠️ **ข้อจำกัดที่ยอมรับไว้**: เขียนลง `pdf.currentPage` ณ ตอนที่ถูกเรียก จึงถูกต้อง
   * ตราบใดที่เนื้อหาแต่ละหน้าไม่ล้น · ถ้ามีคนกรอกจนเต็มเพดานทุกตาราง (การศึกษา 10 แถว
   * ฝึกอบรม 20 กิจกรรม 20 พี่น้อง 20) `table()` จะเรียก `ensureSpace` แล้วขึ้นหน้าใหม่เอง
   * ทำให้เลขหน้าเพี้ยน · **ยังไม่แก้เพราะไม่ใช่จำนวนแถวที่เกิดจริง** และการทำเลขหน้า
   * แบบไล่นับทีหลังต้องรื้อ `ThaiPdf` ทั้งคลาส — `coop-form-print` F4 ตรวจว่ายังได้ ๓ หน้า
   */
  const pageFooter = (pageNo: number) => {
    pdf.drawAt(`หน้าที่ ${pageNo}/3`, 230, 34, 11);
    pdf.drawAt('ปรับปรุงเมื่อ ๑๑ ก.พ. ๖๓', 340, 34, 11);
  };
  const formTag = () => pdf.drawAt('(สหกิจ03)', LEFT, A4_H - 32, 11);

  // ═══ หน้า ๑ — ข้อมูลส่วนตัวนักศึกษา ═══════════════════════════════════════
  formTag();
  pdf.line('คณะบริหารธุรกิจและเทศโนโลยีสารสนเทศ', { size: 12, x: LEFT + 96, gap: 14 });
  pdf.line('มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก วิทยาเขตจักรพงษภูวนารถ', {
    size: 12,
    x: LEFT + 96,
    gap: 20,
  });

  // กรอบรูปถ่าย ๑ นิ้ว (๑ นิ้ว = ๗๒ pt) — สูงตามสัดส่วนรูปติดบัตรมาตรฐาน
  const PHOTO_W = 72;
  const PHOTO_H = 96;
  const photoX = RIGHT - PHOTO_W;
  const photoTop = A4_H - 40;
  pdf.currentPage.drawRectangle({
    x: photoX,
    y: photoTop - PHOTO_H,
    width: PHOTO_W,
    height: PHOTO_H,
    borderWidth: 0.8,
    borderColor: ink,
  });
  let photoDrawn = false;
  if (clean(d.profile_image)) {
    const imagePath = path.join(process.cwd(), 'uploads', clean(d.profile_image));
    // รูปหายจากดิสก์ต้องไม่ทำให้ทั้งใบพิมพ์ไม่ออก — กรอบเปล่ายังใช้ติดรูปจริงได้
    if (fs.existsSync(imagePath) && fs.statSync(imagePath).size > 0) {
      try {
        await pdf.drawImageKeepingRatio(fs.readFileSync(imagePath), {
          x: photoX + 3,
          y: photoTop - PHOTO_H + 3,
          height: PHOTO_H - 6,
        });
        photoDrawn = true;
      } catch {
        photoDrawn = false;
      }
    }
  }
  if (!photoDrawn) {
    pdf.drawAt('รูปถ่ายหน้าตรง', photoX + 8, photoTop - 40, 9);
    pdf.drawAt('ขนาด ๑ นิ้ว', photoX + 13, photoTop - 52, 9);
    pdf.drawAt('พื้นหลังสีฟ้า', photoX + 12, photoTop - 64, 9);
  }

  pdf.line('ใบสมัครงานสหกิจศึกษา', { size: 17, x: 190, gap: 26 });

  // สามบรรทัดนี้อยู่ระดับเดียวกับกรอบรูป จึงหยุดเส้นประก่อนถึงกรอบ
  const applyRight = photoX - 14;
  row([{ label: 'ชื่อสถานที่ประกอบการที่ต้องการสมัคร', value: clean(d.company_name) }], 19, {
    right: applyRight,
  });
  row([{ label: 'สมัครงานในตำแหน่ง', value: clean(d.position) }], 19, { right: applyRight });
  const period =
    d.start_date && d.end_date
      ? `${shortThaiDate(d.start_date)} ถึง ${shortThaiDate(d.end_date)}`
      : shortThaiDate(d.start_date);
  row([{ label: 'ระยะเวลาปฏิบัติงานสหกิจศึกษา', value: period }], 22, { right: applyRight });

  pdf.line('ข้อมูลส่วนตัวนักศึกษา', { size: 14, gap: 20 });

  const thaiName = [clean(d.first_name), clean(d.last_name)].filter(Boolean).join(' ');
  const enName = [clean(d.first_name_en), clean(d.last_name_en)].filter(Boolean).join(' ');
  row([{ label: 'ชื่อ – นามสกุล (นาย/นาง/นางสาว)', value: thaiName }], 19);
  row([{ label: 'Name & Surname (Mr./ Miss / Ms.)', value: enName }], 19);
  row(
    [
      { label: 'รหัสนักศึกษา', value: clean(d.student_code) },
      {
        label: 'สาขาวิชา',
        value: clean(d.major_name_th).replace(/^สาขาวิชา\s*/, ''),
        weight: 1.4,
      },
    ],
    19
  );
  row(
    [
      { label: 'นักศึกษาชั้นปีที่', value: clean(d.year_level) },
      { label: 'อาจารย์ที่ปรึกษา', value: clean(d.advisor_name), weight: 1.6 },
    ],
    19
  );
  row([{ label: 'เกรดเฉลี่ยรวม', value: clean(d.cumulative_gpa) }], 19);
  row(
    [
      {
        label: 'เลขที่บัตรประจำตัวประชาชน',
        value: d.national_id ? spaceNationalId(d.national_id) : '',
        weight: 1.3,
      },
      { label: 'ออกให้ ณ เขต/อำเภอ', value: clean(d.national_id_issued_district) },
    ],
    19
  );
  row(
    [
      { label: 'หมดอายุวันที่', value: shortThaiDate(d.national_id_expiry_date) },
      { label: 'เกิดวันที่', value: shortThaiDate(d.birth_date) },
      { label: 'อายุ', value: ageFrom(d.birth_date) ? `${ageFrom(d.birth_date)} ปี` : '', weight: 0.6 },
      { label: 'เพศ', value: clean(d.gender), weight: 0.7 },
    ],
    19
  );
  row(
    [
      { label: 'เชื้อชาติ', value: clean(d.ethnicity) },
      { label: 'สัญชาติ', value: clean(d.nationality) },
      { label: 'ศาสนา', value: clean(d.religion) },
    ],
    19
  );

  // ที่อยู่ยาวกว่าหนึ่งบรรทัดได้ — เขียนบรรทัดแรกแล้วเว้นเส้นประต่ออีกบรรทัด
  row([{ label: 'ที่อยู่ปัจจุบัน', value: clean(d.current_address) }], 19);
  row([{ label: '', value: '' }], 19);
  row(
    [
      { label: 'โทรศัพท์', value: clean(d.phone) },
      { label: 'โทรศัพท์เคลื่อนที่', value: clean(d.mobile_phone), weight: 1.2 },
      { label: 'โทรสาร', value: clean(d.fax) },
    ],
    19
  );
  row([{ label: 'E – mail', value: clean(d.alt_email) }], 22);

  pdf.line('บุคคลที่ติดต่อได้ในกรณีฉุกเฉิน', { size: 14, gap: 20 });
  row(
    [
      { label: 'ชื่อ–สกุล (นาย/นาง/นางสาว)', value: clean(d.emergency_contact_name), weight: 1.5 },
      { label: 'ความสัมพันธ์', value: clean(d.emergency_relationship) },
    ],
    19
  );
  row([{ label: 'ที่อยู่', value: clean(d.emergency_address) }], 19);
  row([{ label: '', value: '' }], 19);
  // ⚠️ ฟอร์มมีสามช่องโทรศัพท์ แต่ระบบเก็บของผู้ติดต่อฉุกเฉินไว้เบอร์เดียว
  //    (`students.emergency_phone`) อีกสองช่องจึงเว้นให้เขียนมือ — เจตนา ไม่ใช่ลืม
  row(
    [
      { label: 'โทรศัพท์', value: clean(d.emergency_phone) },
      { label: 'โทรศัพท์เคลื่อนที่', value: '', weight: 1.2 },
      { label: 'โทรสาร', value: '' },
    ],
    0
  );
  pageFooter(1);

  // ═══ หน้า ๒ — ครอบครัว · จุดมุ่งหมาย · กิจกรรม ════════════════════════════
  pdf.newPage();
  formTag();
  pdf.line('ข้อมูลครอบครัว', { size: 14, gap: 20 });

  const family: FamilyInfo = (d.family_info as FamilyInfo) || {};
  for (const who of ['father', 'mother'] as const) {
    const p = family[who] || {};
    row(
      [
        { label: who === 'father' ? 'ชื่อบิดา' : 'ชื่อมารดา', value: clean(p.name), weight: 1.4 },
        { label: 'อายุ', value: clean(p.age) ? `${clean(p.age)} ปี` : '', weight: 0.6 },
        { label: 'อาชีพ', value: clean(p.occupation) },
      ],
      19
    );
    row([{ label: 'โทรศัพท์', value: clean(p.phone) }], 19);
  }

  row(
    [
      {
        label: 'จำนวนพี่น้อง',
        value: clean(family.sibling_count) ? `${clean(family.sibling_count)} คน` : '',
      },
      { label: 'เป็นบุตรคนที่', value: clean(family.birth_order) },
    ],
    19
  );
  // บนกระดาษข้อความนี้ต่อท้ายบรรทัดเดียวกัน แต่สองช่องข้างบนกินความกว้างหมดแล้ว
  // จึงลงบรรทัดใหม่ — ถ้าดันให้อยู่บรรทัดเดียวกันมันจะทับเส้นประ
  pdf.line('ตามรายละเอียดข้างล่างนี้', { size: F, gap: 14 });

  /**
   * ตารางที่มีเส้นกรอบ — ผู้เรียกให้ความกว้างคอลัมน์เป็นสัดส่วน
   * (`acceptanceFormPdf` วาดตารางเดียวด้วยพิกัดดิบ แต่ใบนี้มีสี่ตาราง
   *  การเขียนพิกัดซ้ำสี่รอบคือที่ที่ตัวเลขคลาดกันเงียบๆ)
   */
  const table = (
    widths: number[],
    headers: string[],
    body: string[][],
    rowHeight = 22,
    size = 11
  ) => {
    const totalWeight = widths.reduce((a, b) => a + b, 0);
    const xs: number[] = [LEFT];
    widths.forEach((w) => xs.push(xs[xs.length - 1] + ((RIGHT - LEFT) * w) / totalWeight));

    const rowCount = body.length + 1;
    pdf.ensureSpace(rowCount * rowHeight + 10);
    const top = pdf.cursorY;
    const page = pdf.currentPage;

    for (let r = 0; r <= rowCount; r++) {
      const y = top - r * rowHeight;
      page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.8, color: ink });
    }
    for (const x of xs) {
      page.drawLine({
        start: { x, y: top },
        end: { x, y: top - rowCount * rowHeight },
        thickness: 0.8,
        color: ink,
      });
    }

    const cell = (text: string, col: number, r: number) => {
      if (!text) return;
      // ตัดข้อความที่ยาวเกินช่องแทนที่จะให้ล้นทับเส้น — ความกว้างจริงของฟอนต์เท่านั้น
      const maxWidth = xs[col + 1] - xs[col] - 8;
      let shown = text;
      while (shown.length > 1 && pdf.textWidth(shown, size) > maxWidth) {
        shown = shown.slice(0, -1);
      }
      pdf.drawAt(shown, xs[col] + 4, top - r * rowHeight - rowHeight + 7, size);
    };

    headers.forEach((h, i) => cell(h, i, 0));
    body.forEach((cells, r) => cells.forEach((text, i) => cell(text, i, r + 1)));
    pdf.space(rowCount * rowHeight + 16);
  };

  const siblings = rowsOf(family.siblings);
  const siblingRows = Array.from({ length: Math.max(3, siblings.length) }, (_, i) => [
    `${i + 1}.`,
    clean(siblings[i]?.name),
    clean(siblings[i]?.age),
    clean(siblings[i]?.occupation),
  ]);
  table([0.7, 3, 0.9, 2], ['ลำดับที่', 'ชื่อ – นามสกุล', 'อายุ', 'อาชีพ'], siblingRows);

  pdf.line('จุดมุ่งหมายอาชีพ', { size: 14, gap: 18 });
  // จุดมุ่งหมายเป็นข้อความอิสระ — ตัดบรรทัดตามความกว้างจริง แล้วเติมเส้นประให้ครบสามบรรทัด
  const objective = clean(d.career_objective);
  const objectiveLines: string[] = [];
  {
    let current = '';
    for (const word of objective.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && pdf.textWidth(candidate, F) > RIGHT - LEFT - 20) {
        objectiveLines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) objectiveLines.push(current);
  }
  for (let i = 0; i < Math.max(3, objectiveLines.length); i++) {
    row([{ label: '', value: objectiveLines[i] || '' }], 19);
  }
  pdf.space(4);

  pdf.line('ระบุสายงานและลักษณะงานที่นักศึกษาสนใจ', { size: 14, gap: 18 });
  const interests = Array.isArray(d.interested_job_types)
    ? d.interested_job_types.map((v) => clean(v))
    : [];
  for (let i = 0; i < 4; i++) {
    row([{ label: `${i + 1}.`, value: interests[i] || '' }], 19);
  }
  pdf.space(4);

  pdf.line('กิจกรรมนอกหลักสูตร', { size: 14, gap: 18 });
  const activities = rowsOf(d.activity_history);
  const activityRows = Array.from({ length: Math.max(4, activities.length) }, (_, i) => [
    `${i + 1}.`,
    clean(activities[i]?.period),
    [clean(activities[i]?.position), clean(activities[i]?.duty)].filter(Boolean).join(' / '),
  ]);
  table([0.5, 2, 4], ['', 'ระยะเวลา', 'ตำแหน่งและหน้าที่'], activityRows);
  pageFooter(2);

  // ═══ หน้า ๓ — ภาษา · การศึกษา · ฝึกอบรม ═══════════════════════════════════
  pdf.newPage();
  formTag();

  pdf.line('ความสามารถพิเศษทางภาษา', { size: 14, gap: 14 });
  const languages = rowsOf(d.language_proficiency);
  // ฟอร์มมีสองแถวตายตัว: "ภาษาอังกฤษ" กับ "ภาษาอื่น โปรดระบุ"
  const english = languages.find((l) => /อังกฤษ|english/i.test(clean(l.language)));
  const others = languages.filter((l) => l !== english);
  const langRow = (label: string, item: Row | undefined) => [
    label,
    clean(item?.reading) || clean(item?.level),
    clean(item?.speaking) || clean(item?.level),
    clean(item?.writing) || clean(item?.level),
  ];
  const languageRows = [
    langRow('ภาษาอังกฤษ', english),
    ...(others.length > 0
      ? others.map((l) => langRow(`ภาษาอื่น: ${clean(l.language)}`, l))
      : [langRow('ภาษาอื่น โปรดระบุ', undefined)]),
  ];
  table([2.4, 1, 1, 1], ['', 'อ่าน', 'พูด', 'เขียน'], languageRows);

  pdf.line('ประวัติการศึกษา', { size: 14, gap: 14 });
  const education = rowsOf(d.education_history);
  // ระดับการศึกษาบนฟอร์มเป็นแถวตายตัว ๕ แถว — จับแถวที่นักศึกษากรอกเข้ากับระดับ
  // ที่ตรงกัน ส่วนที่จับไม่ได้ต่อท้ายไว้ ไม่ใช่ทิ้ง
  const LEVELS = ['มัธยมต้น', 'มัธยมปลาย', 'ต่ำกว่า อนุปริญญา', 'อนุปริญญา', 'ปริญญาตรี'];
  const usedEducation = new Set<Row>();
  const educationRows = LEVELS.map((level) => {
    const bare = level.replace(/\s/g, '');
    const hit = education.find((e) => !usedEducation.has(e) && clean(e.level).replace(/\s/g, '') === bare);
    if (hit) usedEducation.add(hit);
    return [
      level,
      clean(hit?.institution),
      clean(hit?.start_year),
      clean(hit?.end_year),
      clean(hit?.degree),
      clean(hit?.major),
    ];
  });
  for (const e of education) {
    if (usedEducation.has(e)) continue;
    educationRows.push([
      clean(e.level),
      clean(e.institution),
      clean(e.start_year),
      clean(e.end_year),
      clean(e.degree),
      clean(e.major),
    ]);
  }
  table(
    [1.6, 2.6, 0.9, 0.9, 1.6, 1.4],
    ['ระดับ', 'สถานการศึกษา', 'ปีที่เริ่ม', 'ปีที่จบ', 'วุฒิการศึกษา', 'วิชา'],
    educationRows,
    22,
    10
  );

  pdf.line('ประวัติการฝึกอบรมและปฎิบัติงานสหกิจศึกษา แนบเอกสารเพิ่มเติมมาพร้อมนี้', {
    size: 12,
    gap: 14,
  });
  const training = rowsOf(d.training_history);
  // ⚠️ ฟอร์มแยก "จาก" กับ "ถึง" เป็นสองช่อง แต่ระบบเก็บเป็นช่วงเดียว (`period`)
  //    จึงพิมพ์ลงคอลัมน์เดียวที่กว้างขึ้นแทนการเดาว่าจะตัดสตริงตรงไหน
  const trainingRows = Array.from({ length: Math.max(5, training.length) }, (_, i) => [
    clean(training[i]?.period),
    clean(training[i]?.institution),
    clean(training[i]?.topic),
  ]);
  table(
    [1.8, 2.8, 2.6],
    ['ระยะเวลาฝึก (จาก – ถึง)', 'สถานที่ปฏิบัติงาน/ที่อยู่', 'ตำแหน่ง/หัวข้ออบรม/หน้าที่'],
    trainingRows,
    22,
    10
  );

  // ⛔ ลงชื่อเว้นว่างเสมอ — นักศึกษาเซ็นด้วยมือบนกระดาษที่พิมพ์ออกไป
  pdf.ensureSpace(80);
  const SIGN_X = 300;
  const signTop = pdf.cursorY - 10;
  const suffix = ' นักศึกษาสหกิจศึกษา';
  pdf.drawAt(
    dots('ลงชื่อ ', SIGN_X, RIGHT - pdf.textWidth(suffix, F)) + suffix,
    SIGN_X,
    signTop,
    F
  );
  pdf.drawAt(
    dots('( ', SIGN_X + 26, RIGHT - pdf.textWidth(' )', F)) + ' )',
    SIGN_X + 26,
    signTop - 22,
    F
  );
  pdf.drawAt(dots('ลงวันที่ ', SIGN_X + 26, RIGHT), SIGN_X + 26, signTop - 44, F);
  pageFooter(3);

  return pdf.save();
}
