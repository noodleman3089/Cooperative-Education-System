import QRCode from 'qrcode';
import { rgb } from 'pdf-lib';
import { ThaiPdf } from './thaiPdf';
import { query } from '../config/database';
import { formatAccommodationAddress, mapsLinkFor } from './accommodationAddress';

/**
 * สหกิจ 06 — แบบแจ้งรายละเอียดของสถานประกอบการในปฏิบัติงานสหกิจศึกษา (ที่พัก)
 *
 * ที่มาของแบบ: ไฟล์ `.docx` ตัวจริงจากเจ้าของ
 * `เอกสาร/เอกสารสำหรับเทมเพลต/สหกิจศึกษา-06-…-ปรับปรุง-1-4-63.docx`
 * (ฉบับปรับปรุง ๑๑ ก.พ. ๖๓) — ถอดคำต่อคำ **ห้ามแต่งถ้อยคำเอง**
 *
 * ⚠️ **ฟอร์มต้นฉบับเรียกชื่อตัวเองไม่ตรงกันสามที่** และเราคงไว้ตามเดิมทั้งหมด:
 *   - หัวเรื่อง  : "รายละเอียด**ของสถานประกอบการ**ในปฏิบัติงานสหกิจศึกษา"
 *   - ตัวเนื้อหา : "ขอแจ้งรายละเอียดเกี่ยวกับ**ที่พัก**ระหว่างปฏิบัติงาน" ← ช่องที่กรอกจริง
 *   - หัวกล่องแผนที่ : "ตำแหน่งที่ตั้ง**ของสถานประกอบการ**"
 *   ระบบเก็บ **ที่พัก** (นั่นคือสิ่งที่ตัวเนื้อหาถาม และเป็นสิ่งที่หมุดในหน้าจอปัก)
 *   จึงเติมที่พักลงกล่องแผนที่ พร้อมพิมพ์ที่อยู่สถานประกอบการกำกับไว้อีกบรรทัด
 *   เพื่อไม่ให้อาจารย์นิเทศเข้าใจผิดว่าหมุดคือที่ทำงาน
 *
 * ⛔ **ช่องลงชื่อนักศึกษาเว้นว่างเสมอ** — ใบนี้พิมพ์ไปเซ็นด้วยมือ ระบบไม่มีลายมือชื่อ
 * ของนักศึกษาและไม่ควรมี (มีเฉพาะคณบดีสำหรับหนังสือราชการ)
 */

export interface AccommodationFormData {
  first_name: string | null;
  last_name: string | null;
  student_code: string | null;
  major_name_th: string | null;
  year_level: number | null;
  section: string | null;
  company_name_th: string | null;
  company_name_en: string | null;
  company_address: string | null;
  house_no: string | null;
  building: string | null;
  room_no: string | null;
  soi: string | null;
  road: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postal_code: string | null;
  address_legacy: string | null;
  phone: string | null;
  mobile_phone: string | null;
  fax: string | null;
  email: string | null;
  latitude: string | null;
  longitude: string | null;
  emergency_contact_name: string | null;
  emergency_relationship: string | null;
  emergency_phone: string | null;
}

/** อ่านทุกอย่างที่ใบนี้ต้องใช้ในคำสั่งเดียว — สถานประกอบการมาจากใบความจำนงที่ตอบรับแล้ว */
export async function fetchAccommodationFormData(
  studentId: number
): Promise<AccommodationFormData | null> {
  const res = await query(
    `SELECT s.first_name, s.last_name, s.student_code, s.year_level, s.section,
            mj.major_name_th,
            c.name_th  AS company_name_th,
            c.name_en  AS company_name_en,
            c.address  AS company_address,
            a.house_no, a.building, a.room_no, a.soi, a.road,
            a.subdistrict, a.district, a.province, a.postal_code, a.address_legacy,
            a.phone, a.mobile_phone, a.fax, a.email,
            a.latitude::text AS latitude, a.longitude::text AS longitude,
            s.emergency_contact_name, s.emergency_relationship, s.emergency_phone
       FROM students s
       JOIN master_major mj ON s.major_id = mj.major_id
       LEFT JOIN accommodations a ON a.student_id = s.student_id
       -- ใบความจำนงที่ตอบรับแล้วคือที่เดียวที่บอกว่านักศึกษาไปทำงานที่ไหนจริง
       LEFT JOIN LATERAL (
         SELECT company_id FROM intent_forms
          WHERE student_id = s.student_id AND status = 'accepted'
          ORDER BY form_id DESC LIMIT 1
       ) i ON TRUE
       LEFT JOIN companies c ON c.company_id = i.company_id
      WHERE s.student_id = $1`,
    [studentId]
  );
  if ((res.rowCount ?? 0) === 0) return null;
  return res.rows[0] as AccommodationFormData;
}

/**
 * ต่อเส้นประจาก `label` ไปจนสุดพิกัด — สำเนาแนวคิดเดียวกับ `acceptanceFormPdf.ts`
 * (ทั้งสองไฟล์วาดแบบฟอร์มที่มีเส้นประ แต่ตัวช่วยตัวนี้สั้นกว่าการ import ข้ามไฟล์
 *  แล้วผูกสองแบบฟอร์มที่ไม่เกี่ยวกันเข้าด้วยกัน)
 */
const dotsTo = (pdf: ThaiPdf, label: string, fromX: number, toX: number, size: number): string => {
  const dotWidth = pdf.textWidth('.', size);
  const remaining = toX - fromX - pdf.textWidth(label, size);
  return label + '.'.repeat(Math.max(0, Math.floor(remaining / dotWidth)));
};

const clean = (v: string | null | undefined): string => (v ?? '').trim();

export async function buildAccommodationFormPdf(d: AccommodationFormData): Promise<Buffer> {
  const pdf = await ThaiPdf.create({ margin: 56, top: 44, bottom: 34 });
  const page = pdf.currentPage;
  const LEFT = 56;
  const RIGHT = pdf.pageWidth - 56;
  const F = 14;
  const ink = rgb(0, 0, 0);
  const fill = (label: string, fromX: number, toX: number) => dotsTo(pdf, label, fromX, toX, F);

  // ── หัวกระดาษ ──────────────────────────────────────────────────────────────
  pdf.drawAt('(สหกิจ 06)', LEFT, pdf.cursorY + 4, 13);
  pdf.line('คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ', { size: 13, x: RIGHT - 210, gap: 15 });
  pdf.line('มหาวิทยาลัยเทคโนโลยีราชมงคลตะวันออก วิทยาเขตจักรพงษภูวนารถ', {
    size: 13,
    x: RIGHT - 275,
    gap: 24,
  });

  pdf.line('แบบแจ้งรายละเอียดของสถานประกอบการในปฏิบัติงานสหกิจศึกษา', {
    size: 16,
    align: 'center',
    gap: 18,
  });
  pdf.line('(ผู้ให้ข้อมูล : นักศึกษา)', { size: F, align: 'center', gap: 20 });
  pdf.line('เรียน  หัวหน้าสหกิจศึกษาและการฝึกงานวิชาชีพประจำคณะ', { size: F, gap: 22 });

  // ── ตัวตนนักศึกษา ──────────────────────────────────────────────────────────
  const MID = 320;
  const name = [clean(d.first_name), clean(d.last_name)].filter(Boolean).join(' ');
  pdf.line(fill(`ชื่อ – นามสกุล ${name}${name ? ' ' : ''}`, LEFT, MID - 10), { size: F, gap: 0 });
  pdf.line(fill(`เลขรหัสประจำตัว ${clean(d.student_code)} `, MID, RIGHT), {
    size: F,
    x: MID,
    gap: 20,
  });

  // "สาขาวิชา" ในฐานมีคำว่า "สาขาวิชา" นำอยู่แล้วบ้าง — ตัดทิ้งเหมือน `coverLetterPdf`
  const major = clean(d.major_name_th).replace(/^สาขาวิชา\s*/, '');
  const YEAR_X = 300;
  const SECTION_X = 452;
  pdf.line(fill(`สาขาวิชา ${major}${major ? ' ' : ''}`, LEFT, YEAR_X - 10), { size: F, gap: 0 });
  pdf.line(
    fill(`นักศึกษาชั้นปีที่ ${d.year_level ?? ''} `, YEAR_X, SECTION_X - 10),
    { size: F, x: YEAR_X, gap: 0 }
  );
  pdf.line(fill(`ห้อง ${clean(d.section)} `, SECTION_X, RIGHT), { size: F, x: SECTION_X, gap: 22 });

  // ── สถานประกอบการ ─────────────────────────────────────────────────────────
  const NAME_X = LEFT + 148;
  pdf.line('ชื่อสถานประกอบการ  (ภาษาไทย)', { size: F, gap: 0 });
  pdf.line(fill(`${clean(d.company_name_th)} `, NAME_X, RIGHT), { size: F, x: NAME_X, gap: 19 });
  pdf.line('(ภาษาอังกฤษ)', { size: F, x: LEFT + 56, gap: 0 });
  pdf.line(fill(`${clean(d.company_name_en)} `, NAME_X, RIGHT), { size: F, x: NAME_X, gap: 22 });

  // ── ที่พัก ─────────────────────────────────────────────────────────────────
  pdf.line('ขอแจ้งรายละเอียดเกี่ยวกับที่พักระหว่างปฏิบัติงานสหกิจศึกษา  ดังนี้', { size: F, gap: 20 });

  /** วาดหนึ่งบรรทัดที่มีหลายช่อง — แบ่งความกว้างเท่าๆ กันตามจำนวนช่อง */
  const fieldRow = (fields: { label: string; value: string }[], gap: number) => {
    const span = (RIGHT - LEFT) / fields.length;
    fields.forEach((f, i) => {
      const x = LEFT + i * span;
      const end = i === fields.length - 1 ? RIGHT : x + span - 10;
      const text = fill(`${f.label} ${f.value}${f.value ? ' ' : ''}`, x, end);
      pdf.line(text, { size: F, x, gap: i === fields.length - 1 ? gap : 0 });
    });
  };

  fieldRow(
    [
      { label: 'เลขที่', value: clean(d.house_no) },
      { label: 'อาคาร', value: clean(d.building) },
      { label: 'ถนน', value: clean(d.road) },
      { label: 'ซอย', value: clean(d.soi) },
    ],
    19
  );
  fieldRow(
    [
      { label: 'ตำบล/แขวง', value: clean(d.subdistrict) },
      { label: 'อำเภอ/เขต', value: clean(d.district) },
      { label: 'จังหวัด', value: clean(d.province) },
    ],
    19
  );
  fieldRow(
    [
      { label: 'รหัสไปรษณีย์', value: clean(d.postal_code) },
      { label: 'โทรศัพท์', value: clean(d.phone) },
      { label: 'โทรศัพท์เคลื่อนที่', value: clean(d.mobile_phone) },
    ],
    19
  );
  fieldRow(
    [
      { label: 'โทรสาร', value: clean(d.fax) },
      { label: 'อีเมล์', value: clean(d.email) },
    ],
    22
  );

  pdf.line('ผู้ที่สามารถติดต่อได้ในกรณีฉุกเฉิน', { size: F, gap: 19 });
  fieldRow(
    [
      { label: 'ชื่อ – นามสกุล', value: clean(d.emergency_contact_name) },
      { label: 'ความสัมพันธ์', value: clean(d.emergency_relationship) },
      { label: 'เบอร์โทรที่ติดต่อได้', value: clean(d.emergency_phone) },
    ],
    24
  );

  // ── กล่องแผนที่ ────────────────────────────────────────────────────────────
  pdf.line('แผนที่แสดงตำแหน่งที่ตั้งของสถานประกอบการ', { size: F, gap: 17 });
  pdf.line(
    'เพื่อความสะดวกในการนิเทศงานของคณาจารย์ โปรดระบุชื่อถนน สถานที่สำคัญใกล้เคียงที่สามารถ',
    { size: 12, gap: 14 }
  );
  pdf.line(
    'เข้าใจง่าย โดยใช้ระบบข้อมูลจากเครือข่ายอินเตอร์เน็ต (โดยให้เริ่มจากมหาวิทยาลัยฯ ถึงที่ปฏิบัติทำงาน)',
    { size: 12, gap: 10 }
  );

  const BOX_H = 196;
  const boxTop = pdf.cursorY;
  page.drawRectangle({
    x: LEFT,
    y: boxTop - BOX_H,
    width: RIGHT - LEFT,
    height: BOX_H,
    borderWidth: 0.8,
    borderColor: ink,
  });

  const mapsLink = mapsLinkFor(d.latitude, d.longitude);
  const stayAddress = formatAccommodationAddress(d);

  let textY = boxTop - 20;
  const boxTextRight = mapsLink ? RIGHT - 130 : RIGHT - 12;

  /** ตัดบรรทัดตามความกว้างจริงในกล่อง — `paragraph` ใช้ไม่ได้เพราะมันเดินตาม cursor */
  const boxParagraph = (text: string, size: number) => {
    const maxWidth = boxTextRight - (LEFT + 12);
    let current = '';
    for (const word of text.split(' ')) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && pdf.textWidth(candidate, size) > maxWidth) {
        pdf.drawAt(current, LEFT + 12, textY, size);
        textY -= size + 3;
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) {
      pdf.drawAt(current, LEFT + 12, textY, size);
      textY -= size + 3;
    }
  };

  if (clean(d.company_address) || clean(d.company_name_th)) {
    boxParagraph(
      `สถานประกอบการ: ${clean(d.company_name_th) || '-'} ${clean(d.company_address)}`.trim(),
      12
    );
    textY -= 4;
  }
  if (stayAddress) {
    boxParagraph(`ที่พักของนักศึกษา: ${stayAddress}`, 12);
    textY -= 4;
  }

  if (mapsLink) {
    boxParagraph(`พิกัด: ${clean(d.latitude)}, ${clean(d.longitude)}`, 12);
    boxParagraph(mapsLink, 11);

    // QR ให้สแกนบนกระดาษได้ตรงๆ — บนกระดาษลิงก์ยาวๆ ไม่มีใครพิมพ์ตาม และการปักหมุด
    // ที่นักศึกษาทำไว้ในระบบจะสูญเปล่าทันทีถ้าใบที่พิมพ์ออกมาพามันไปด้วยไม่ได้
    const qrPng = await QRCode.toBuffer(mapsLink, {
      type: 'png',
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
    });
    await pdf.drawImageKeepingRatio(qrPng, {
      x: RIGHT - 118,
      y: boxTop - 118,
      height: 106,
    });
    pdf.drawAt('สแกนเพื่อเปิดแผนที่', RIGHT - 118, boxTop - 130, 10);
  } else {
    boxParagraph('(ยังไม่ได้ปักหมุดที่พักในระบบ — โปรดวาดแผนที่หรือแนบภาพในกรอบนี้)', 12);
  }

  pdf.space(BOX_H + 26);

  // ── ลงชื่อ ────────────────────────────────────────────────────────────────
  // ⛔ เว้นว่างทั้งบล็อก — นักศึกษาเซ็นด้วยมือบนกระดาษที่พิมพ์ออกไป
  const SIGN_X = 300;
  pdf.ensureSpace(76);
  const signTop = pdf.cursorY;
  const suffix = ' นักศึกษา';
  pdf.drawAt(
    dotsTo(pdf, '(ลงชื่อ) ', SIGN_X, RIGHT - pdf.textWidth(suffix, F), F) + suffix,
    SIGN_X,
    signTop,
    F
  );
  pdf.drawAt(
    dotsTo(pdf, '( ', SIGN_X + 30, RIGHT - pdf.textWidth(' )', F), F) + ' )',
    SIGN_X + 30,
    signTop - 22,
    F
  );
  pdf.drawAt(dotsTo(pdf, 'วันที่ ', SIGN_X + 30, RIGHT, F), SIGN_X + 30, signTop - 44, F);

  pdf.space(62);
  pdf.line('ปรับปรุงเมื่อ ๑๑ ก.พ. ๖๓', { size: 11, x: LEFT, gap: 0 });

  return pdf.save();
}
