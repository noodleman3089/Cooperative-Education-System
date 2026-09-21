import { rgb } from 'pdf-lib';
import { ThaiPdf } from './thaiPdf';

/**
 * สหกิจ 07 หน้า 1–2 — แบบแจ้งรายละเอียดงาน ตำแหน่งงาน พนักงานที่ปรึกษา
 *
 * ที่มาของแบบ: ไฟล์ `.docx` ตัวจริงจากเจ้าของ
 * `เอกสาร/เอกสารสำหรับเทมเพลต/สหกิจศึกษา-07-แบบแจ้งรายละเอียด-ตำแหน่งงาน-พนักงานที่ปรึกษา (1).docx`
 * (ปรับปรุงเมื่อ 30 เม.ย. 57) — ถอดคำต่อคำ **ห้ามแต่งถ้อยคำเอง**
 *
 * ⛔ หน้า 3 (แผนปฏิบัติงาน) **ไม่อยู่ในไฟล์นี้** — นักศึกษาร่างร่วมกับพนักงานที่ปรึกษา
 *    และลงนามสองฝ่าย จึงพิมพ์จากเมนูของอีกฝั่ง · เลขหน้า "1/3" "2/3" คงไว้ตามกระดาษ
 * ⛔ **ช่องลงชื่อผู้ให้ข้อมูลเว้นว่างเสมอ** — ใบนี้พิมพ์ไปเซ็นด้วยมือ
 * · ช่อง E-mail ของผู้ประสานงานแทนเว้นว่าง — ระบบไม่ได้เก็บค่านี้ (ไม่มีใน `companies`)
 */

type Text = string | null | undefined;

export interface Form07PdfData {
  company: {
    name_th: Text; name_en: Text;
    house_no: Text; road: Text; soi: Text; subdistrict: Text;
    district: Text; province: Text; postal_code: Text;
    phone: Text; fax: Text;
    manager_name: Text; manager_position: Text; manager_phone: Text;
    manager_fax: Text; manager_email: Text;
    contact_mode: Text;
    contact_person: Text; contact_position: Text; contact_department: Text;
    contact_phone: Text; contact_fax: Text;
  };
  mentors: { name: Text; position: Text; department: Text; phone: Text; fax: Text; email: Text }[];
  students: { full_name: Text; job_position: Text; job_description: Text }[];
}

const clean = (v: Text): string => {
  const s = (v ?? '').trim();
  // `mentors.phone` เป็น NOT NULL จึงเก็บ '-' แทนค่าว่าง — บนกระดาษให้เป็นช่องว่างให้เขียนเอง
  return s === '-' ? '' : s;
};

/**
 * ตัดบรรทัดตามความกว้างจริง · ภาษาไทยไม่มีช่องว่างระหว่างคำ จึงตัดด้วย
 * `Intl.Segmenter` ระดับคำ — ตัดที่ขอบคำเสมอ ไม่ตัดกลางคำหรือแยกสระออกจากพยัญชนะ
 */
const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
function wrap(pdf: ThaiPdf, text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let current = '';
    for (const { segment } of segmenter.segment(paragraph)) {
      const candidate = current + segment;
      if (current && pdf.textWidth(candidate, size) > maxWidth) {
        lines.push(current.trimEnd());
        current = segment.trimStart();
      } else {
        current = candidate;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

export async function buildForm07Pdf(d: Form07PdfData): Promise<Buffer> {
  const pdf = await ThaiPdf.create({ margin: 56, top: 44, bottom: 50 });
  const LEFT = 56;
  const RIGHT = pdf.pageWidth - 56;
  const F = 14;
  const ink = rgb(0, 0, 0);

  const dotsTo = (label: string, fromX: number, toX: number): string => {
    const dotWidth = pdf.textWidth('.', F);
    const remaining = toX - fromX - pdf.textWidth(label, F);
    return label + '.'.repeat(Math.max(0, Math.floor(remaining / dotWidth)));
  };

  /** หนึ่งบรรทัดหลายช่อง — แบ่งความกว้างเท่า ๆ กัน (แบบเดียวกับ `accommodationFormPdf`) */
  const fieldRow = (fields: { label: string; value: Text }[], gap = 20, fromX = LEFT) => {
    const span = (RIGHT - fromX) / fields.length;
    fields.forEach((f, i) => {
      const x = fromX + i * span;
      const end = i === fields.length - 1 ? RIGHT : x + span - 8;
      const value = clean(f.value);
      pdf.line(dotsTo(`${f.label} ${value}${value ? ' ' : ''}`, x, end), {
        size: F,
        x,
        gap: i === fields.length - 1 ? gap : 0,
      });
    });
  };

  const paragraph = (text: string, size: number, indent = 0) => {
    for (const l of wrap(pdf, text, RIGHT - LEFT - indent, size)) {
      pdf.line(l, { size, x: LEFT + indent, gap: size + 5 });
    }
  };

  const pageHeader = () => pdf.drawAt('(สหกิจ07)', RIGHT - pdf.textWidth('(สหกิจ07)', 13), pdf.cursorY + 4, 13);
  const pageFooter = (label: string) => {
    pdf.drawAt(label, (pdf.pageWidth - pdf.textWidth(label, 12)) / 2, 30, 12);
    pdf.drawAt('ปรับปรุงเมื่อ 30 เม.ย. 57', LEFT, 30, 11);
  };

  // ══ หน้า 1 ═════════════════════════════════════════════════════════════
  pageHeader();
  pageFooter('หน้าที่ 1/3');
  pdf.space(14);
  pdf.line('แบบแจ้งรายละเอียดงาน ตำแหน่งงาน พนักงานที่ปรึกษา', { size: 16, align: 'center', gap: 18 });
  pdf.line('รายวิชาสหกิจศึกษา', { size: F, align: 'center', gap: 17 });
  pdf.line('(ผู้ให้ข้อมูล : ผู้จัดการฝ่ายบุคคลหรือพนักงานที่ปรึกษา)', { size: F, align: 'center', gap: 22 });

  pdf.line('คำชี้แจง', { size: F, gap: 17 });
  paragraph(
    'เพื่อให้การประสานงานระหว่างงานสหกิจศึกษา  และสถานประกอบการ เป็นไปโดยความเรียบร้อยและมีประสิทธิภาพ ' +
      'จึงใคร่ขอความกรุณาผู้จัดการฝ่ายบุคคลหรือผู้ที่รับผิดชอบดูแลการปฏิบัติงานของนักศึกษาสหกิจศึกษา' +
      'ได้โปรดประสานงานกับพนักงานที่ปรึกษา (Job Supervisor)  เพื่อจัดทำข้อมูล ตำแหน่งงาน ลักษณะงานและพนักงานที่ปรึกษา ' +
      '(Job Position, job Description and job Supervisor)  ตามแบบฟอร์มฉบับนี้    และขอได้โปรด  ส่งกลับคืนให้งานสหกิจศึกษา',
    13,
    28
  );
  pdf.space(6);
  pdf.line('เรียน  หัวหน้างานสหกิจศึกษา', { size: F, gap: 19 });
  pdf.line('ขอแจ้งรายละเอียดเกี่ยวกับตำแหน่งงาน  ลักษณะงานและพนักงานที่ปรึกษา  ดังนี้', { size: F, x: LEFT + 28, gap: 22 });

  // ── 1. ชื่อ ที่อยู่ ──
  pdf.line('1.  ชื่อ ที่อยู่ของสถานประกอบการ', { size: F, gap: 16 });
  paragraph('โปรดให้ชื่อที่เป็นทางการเพื่อจะนำไประบุในใบรับรองภาษาอังกฤษให้แก่นักศึกษาได้อย่างถูกต้อง', 12, 20);
  paragraph('(เพื่อประกอบการเดินทางไปนิเทศงานนักศึกษาที่ถูกต้อง โปรดระบุที่อยู่ตามสถานที่ที่นักศึกษาปฏิบัติงาน)', 12, 20);
  pdf.space(4);

  const NAME_X = LEFT + 150;
  pdf.line('สถานประกอบการ  (ภาษาไทย)', { size: F, x: LEFT + 20, gap: 0 });
  pdf.line(dotsTo(`${clean(d.company.name_th)} `, NAME_X, RIGHT), { size: F, x: NAME_X, gap: 20 });
  pdf.line('(ภาษาอังกฤษ)', { size: F, x: LEFT + 84, gap: 0 });
  pdf.line(dotsTo(`${clean(d.company.name_en)} `, NAME_X, RIGHT), { size: F, x: NAME_X, gap: 20 });

  fieldRow([
    { label: 'เลขที่', value: d.company.house_no },
    { label: 'ถนน', value: d.company.road },
    { label: 'ซอย', value: d.company.soi },
    { label: 'ตำบล/แขวง', value: d.company.subdistrict },
  ]);
  fieldRow([
    { label: 'อำเภอ/เขต', value: d.company.district },
    { label: 'จังหวัด', value: d.company.province },
    { label: 'รหัสไปรษณีย์', value: d.company.postal_code },
  ]);
  fieldRow([
    { label: 'โทรศัพท์', value: d.company.phone },
    { label: 'โทรสาร', value: d.company.fax },
  ], 24);

  // ── 2. ผู้จัดการ + ผู้ประสานงาน ──
  pdf.line('2.  ผู้จัดการทั่วไป / ผู้จัดการโรงงาน และผู้ได้รับมอบหมายให้ประสานงาน', { size: F, gap: 20 });
  fieldRow([{ label: 'ชื่อผู้จัดการสถานประกอบการ', value: d.company.manager_name }], 20, LEFT + 20);
  fieldRow([{ label: 'ตำแหน่ง', value: d.company.manager_position }], 20, LEFT + 20);
  fieldRow([
    { label: 'โทรศัพท์', value: d.company.manager_phone },
    { label: 'โทรสาร', value: d.company.manager_fax },
    { label: 'E-mail', value: d.company.manager_email },
  ], 22, LEFT + 20);

  pdf.line('การติดต่อประสานงานกับสถาบันฯ  (การนิเทศงานนักศึกษา และอื่นๆ) ขอมอบให้', { size: F, x: LEFT + 20, gap: 19 });
  // ติ๊กตามค่าที่บริษัทเลือกไว้ · ไม่มีค่า = เว้นทั้งสองช่องให้ติ๊กเอง ไม่เดาแทน
  const mode = clean(d.company.contact_mode);
  const box = (on: boolean) => (on ? '(  /  )' : '(      )');
  pdf.line(`${box(mode === 'manager')}  ติดต่อกับผู้จัดการโดยตรง`, { size: F, x: LEFT + 40, gap: 19 });
  pdf.line(`${box(mode === 'delegate')}  มอบหมายให้บุคคลต่อไปนี้ประสานงานแทน`, { size: F, x: LEFT + 40, gap: 20 });

  // ผู้ประสานงานแทนพิมพ์เฉพาะเมื่อเลือก "มอบหมาย" — เลือก "ผู้จัดการโดยตรง" แล้วยังมีชื่อค้างในฐาน
  // จะทำให้กระดาษขัดกันเอง (ติ๊กช่องหนึ่ง แต่มีชื่อคนอีกช่อง)
  const delegate = mode === 'delegate';
  const pick = (v: Text) => (delegate ? v : '');
  fieldRow([{ label: 'ชื่อ – นามสกุล', value: pick(d.company.contact_person) }], 20, LEFT + 60);
  fieldRow([
    { label: 'ตำแหน่ง', value: pick(d.company.contact_position) },
    { label: 'แผนก', value: pick(d.company.contact_department) },
  ], 20, LEFT + 60);
  fieldRow([
    { label: 'โทรศัพท์', value: pick(d.company.contact_phone) },
    { label: 'โทรสาร', value: pick(d.company.contact_fax) },
    { label: 'E - mail', value: '' },
  ], 20, LEFT + 60);

  // ══ หน้า 2 ═════════════════════════════════════════════════════════════
  pdf.newPage();
  pageHeader();
  pageFooter('หน้าที่  2/3');
  pdf.space(14);

  // ── 3. พนักงานที่ปรึกษา ── กระดาษมีช่องเดียว · บริษัทที่มีหลายคนพิมพ์ซ้ำทีละคน
  pdf.line('3.  พนักงานที่ปรึกษา (job Supervisor)', { size: F, gap: 20 });
  const mentors = d.mentors.length > 0 ? d.mentors : [{ name: '', position: '', department: '', phone: '', fax: '', email: '' }];
  mentors.forEach((m, i) => {
    pdf.ensureSpace(66);
    fieldRow([{ label: 'ชื่อ – นามสกุล', value: m.name }], 20, LEFT + 20);
    fieldRow([
      { label: 'ตำแหน่ง', value: m.position },
      { label: 'แผนก', value: m.department },
    ], 20, LEFT + 20);
    fieldRow([
      { label: 'โทรศัพท์', value: m.phone },
      { label: 'โทรสาร', value: m.fax },
      { label: 'E – mail', value: m.email },
    ], i === mentors.length - 1 ? 24 : 28, LEFT + 20);
  });

  // ── ตารางงานที่มอบหมาย ──
  pdf.line('งานที่มอบหมายนักศึกษา', { size: F, gap: 8 });
  const COLS = [
    { title: 'ชื่อนักศึกษา', width: 120 },
    { title: 'ตำแหน่งงานที่นักศึกษาปฏิบัติ  (Job  Position)', width: 130 },
    { title: 'ลักษณะงานที่นักศึกษาปฏิบัติ (Job  Description)', width: RIGHT - LEFT - 250 },
  ];
  const CELL = 12;
  const PAD = 5;
  const LINE_H = CELL + 4;

  const drawRow = (cells: string[], minHeight: number) => {
    const wrapped = cells.map((c, i) => wrap(pdf, c, COLS[i].width - PAD * 2, CELL));
    const height = Math.max(minHeight, Math.max(...wrapped.map((w) => w.length)) * LINE_H + PAD * 2);
    pdf.ensureSpace(height);
    const top = pdf.cursorY;
    let x = LEFT;
    wrapped.forEach((lines, i) => {
      pdf.currentPage.drawRectangle({
        x, y: top - height, width: COLS[i].width, height, borderWidth: 0.7, borderColor: ink,
      });
      lines.forEach((l, j) => pdf.drawAt(l, x + PAD, top - PAD - CELL - j * LINE_H + 2, CELL));
      x += COLS[i].width;
    });
    pdf.space(height);
  };

  drawRow(COLS.map((c) => c.title), 0);
  const rows = d.students.length > 0
    ? d.students.map((s) => [clean(s.full_name), clean(s.job_position), clean(s.job_description)])
    : [['', '', ''], ['', '', ''], ['', '', '']];
  for (const r of rows) drawRow(r, 44);

  // ── ลงชื่อผู้ให้ข้อมูล ── ⛔ เว้นว่างทั้งบล็อก — เซ็นด้วยมือ
  pdf.space(26);
  pdf.ensureSpace(90);
  const SIGN_X = 290;
  const signTop = pdf.cursorY;
  const suffix = ' (ผู้ให้ข้อมูล)';
  pdf.drawAt(dotsTo('(ลงชื่อ) ', SIGN_X, RIGHT - pdf.textWidth(suffix, F)) + suffix, SIGN_X, signTop, F);
  pdf.drawAt('(ตำแหน่ง..............................................................)', SIGN_X + 20, signTop - 22, F);
  pdf.drawAt('วันที่...............................................................', SIGN_X + 20, signTop - 44, F);
  pdf.space(72);

  paragraph(
    'โปรดส่งคืน  งานสหกิจศึกษาและการฝึกงานวิชาชีพประจำคณะ ภายในสัปดาห์แรกของการปฏิบัติงานของนักศึกษา ด้วยจักขอบคุณยิ่ง',
    13
  );

  return pdf.save();
}
