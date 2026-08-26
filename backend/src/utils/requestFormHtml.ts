import { escapeHtml } from '../middlewares/validation';

/**
 * แบบคำร้องขอหนังสือขอความอนุเคราะห์นักศึกษาสหกิจศึกษา (เอกสารหมายเลข 1)
 *
 * เป็น **หน้า HTML สำหรับสั่งพิมพ์** ไม่ใช่ PDF โดยตั้งใจ — ปลายทางของเอกสารใบนี้
 * คือกระดาษที่นักศึกษาถือไปให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาเซ็นด้วยปากกา
 * `window.print()` ให้ผลเดียวกันโดยไม่ต้องมีตัว render ฝั่งเซิร์ฟเวอร์
 * (โปรเจคนี้ถอด puppeteer ออกไปแล้วเมื่อ 2026-08-26)
 *
 * ⛔ **ทุกค่าที่มาจากฐานข้อมูลต้องผ่าน `escapeHtml`** — ชื่อสถานประกอบการกับชื่อ
 * ผู้ติดต่อเป็นข้อความที่นักศึกษาพิมพ์เองตอนยื่นคำร้อง XSS จัดการที่จุดประกอบ HTML
 * ไม่ใช่ตอนบันทึกลงฐาน (ดูเหตุผลใน `middlewares/validation.ts`)
 *
 * ช่องที่ระบบไม่ได้เก็บ — **โทรศัพท์บ้าน · โทรสาร · วันสิ้นสุดฝึกงาน** — พิมพ์เป็น
 * เส้นประไว้ให้เขียนด้วยมือ เจ้าของเคาะแล้วว่าไม่ต้องเพิ่มคอลัมน์เพื่อสามช่องนี้
 */

export interface RequestFormData {
  student_code: string | null;
  first_name: string | null;
  last_name: string | null;
  year_level: number | null;
  phone: string | null;
  university_email: string | null;
  alt_email: string | null;
  major_name_th: string | null;
  faculty_name_th: string | null;
  company_name: string | null;
  company_address: string | null;
  company_district: string | null;
  company_province: string | null;
  company_postal_code: string | null;
  contact_person: string | null;
  contact_position: string | null;
  company_phone: string | null;
  company_email: string | null;
  academic_year: number | null;
  semester: string | null;
  start_date: string | null;
}

/** ค่าที่ระบบมี → ข้อความ escape แล้ว · ค่าที่ยังไม่มี → เส้นประให้เขียนมือ */
const filled = (value: unknown, dashes = 24): string => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) return `<span class="blank">${'.'.repeat(dashes)}</span>`;
  return `<span class="filled">${escapeHtml(text)}</span>`;
};

/** ช่องที่ระบบไม่เก็บเลย — เส้นประเสมอ ไม่ต้องส่งค่าเข้ามา */
const blank = (dashes = 24): string => `<span class="blank">${'.'.repeat(dashes)}</span>`;

const fullAddress = (d: RequestFormData): string => {
  const parts = [d.company_address, d.company_district, d.company_province, d.company_postal_code]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.join(' ');
};

/** วัน/เดือน/ปี แยกช่องตามที่กระดาษถาม — คืนเส้นประเมื่อยังไม่มีวันที่ */
const splitThaiDate = (iso: string | null): { day: string; month: string; year: string } => {
  if (!iso) return { day: blank(8), month: blank(12), year: blank(8) };
  const [y, m, d] = iso.split('-');
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  const monthName = months[Number(m) - 1];
  if (!monthName) return { day: blank(8), month: blank(12), year: blank(8) };
  return {
    day: `<span class="filled">${Number(d)}</span>`,
    month: `<span class="filled">${monthName}</span>`,
    year: `<span class="filled">${Number(y) + 543}</span>`,
  };
};

export function renderRequestFormHtml(d: RequestFormData): string {
  const studentName = [d.first_name, d.last_name].filter(Boolean).join(' ').trim();
  const email = (d.university_email ?? '').trim() || (d.alt_email ?? '').trim();
  const start = splitThaiDate(d.start_date);

  // `coop_semesters.academic_year` เก็บเป็น **ค.ศ.** โดยตั้งใจ (BUG-01) และแปลงเป็น
  // พ.ศ. ตอนแสดงผล — เอกสารราชการใบนี้จึงต้อง +543 ไม่ใช่พิมพ์ค่าดิบลงไป
  const academicYearBE =
    d.academic_year === null || d.academic_year === undefined ? null : d.academic_year + 543;

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>แบบคำร้องขอหนังสือขอความอนุเคราะห์ — ${escapeHtml(d.student_code ?? '')}</title>
<style>
  /* ฟอนต์ราชการที่มีในเครื่องผู้ใช้ ไม่โหลดจากภายนอก — หน้านี้ต้องพิมพ์ได้แม้ออฟไลน์ */
  body { font-family: 'TH SarabunPSK', 'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif;
         font-size: 16pt; line-height: 1.6; color: #000; background: #fff;
         margin: 0; padding: 1.5cm 2cm; }
  h1 { font-size: 18pt; text-align: center; margin: 0 0 4pt; }
  .sub { text-align: center; font-size: 14pt; margin-bottom: 18pt; }
  .row { margin-bottom: 6pt; }
  .blank { letter-spacing: 1px; color: #555; }
  .filled { font-weight: 600; }
  .sign-student { margin-top: 22pt; text-align: right; padding-right: 40pt; }
  table.boxes { width: 100%; border-collapse: collapse; margin-top: 20pt; }
  table.boxes td { border: 1px solid #000; padding: 8pt; vertical-align: top; width: 50%;
                   font-size: 15pt; }
  .box-title { font-weight: 700; margin-bottom: 6pt; }
  .officer { border: 1px solid #000; padding: 8pt; font-size: 15pt; }
  .foot { margin-top: 14pt; font-size: 12pt; text-align: right; color: #333; }
  .hint { margin-top: 10pt; font-size: 12pt; color: #444; }
  @media print {
    body { padding: 1.2cm 1.6cm; }
    .hint { display: none; }
    @page { size: A4; margin: 0; }
  }
</style>
</head>
<body>
<h1>แบบคำร้องขอหนังสือขอความอนุเคราะห์นักศึกษาสหกิจศึกษา</h1>
<div class="sub">วันที่ ${blank(8)} เดือน ${blank(14)} พ.ศ. ${blank(8)}</div>

<div class="row"><strong>เรียน</strong> คณบดี${filled(d.faculty_name_th, 40)}</div>
<div class="row"><strong>เรื่อง</strong> ขอหนังสือขอความอนุเคราะห์เพื่อใช้ในงานสหกิจศึกษา</div>

<div class="row">ข้าพเจ้า นาย / นาง / นางสาว ${filled(studentName, 40)}</div>
<div class="row">รหัสประจำตัวนักศึกษา ${filled(d.student_code, 16)}
  &nbsp;&nbsp;สาขาวิชา ${filled(d.major_name_th, 30)}</div>
<div class="row">ชั้นปีที่ ${filled(d.year_level, 6)}
  &nbsp;&nbsp;โทรศัพท์บ้าน ${blank(16)}
  &nbsp;&nbsp;โทรศัพท์มือถือ ${filled(d.phone, 16)}</div>
<div class="row">E-mail ${filled(email, 34)}</div>

<div class="row">มีความประสงค์จะขอหนังสือขอความอนุเคราะห์สถานประกอบการ เพื่อเข้ารับการสหกิจศึกษา
  ในภาคการศึกษาที่ ${filled(d.semester, 8)} ปีการศึกษา ${filled(academicYearBE, 8)}
  โดยมีรายละเอียด ดังนี้</div>

<div class="row">ชื่อสถานประกอบการ ${filled(d.company_name, 46)}</div>
<div class="row">ที่อยู่ของสถานประกอบการ ${filled(fullAddress(d), 60)}</div>
<div class="row">ชื่อของผู้รับหนังสือขอความอนุเคราะห์ ${filled(d.contact_person, 30)}
  &nbsp;&nbsp;ตำแหน่ง ${filled(d.contact_position, 20)}</div>
<div class="row">โทรศัพท์ที่ทำงาน ${filled(d.company_phone, 16)}
  &nbsp;&nbsp;โทรศัพท์มือถือ ${blank(16)}
  &nbsp;&nbsp;โทรสาร ${blank(14)}</div>
<div class="row">E-mail ${filled(d.company_email, 30)}</div>
<div class="row">กำหนดการเริ่มฝึกงานตั้งแต่วันที่ ${start.day} เดือน ${start.month} พ.ศ. ${start.year}</div>
<div class="row">และสิ้นสุดการฝึกถึงวันที่ ${blank(8)} เดือน ${blank(14)} พ.ศ. ${blank(8)}</div>

<div class="sign-student">
  ลงชื่อ ${blank(30)} นักศึกษา<br>
  ( ${filled(studentName, 30)} )
</div>

<table class="boxes">
  <tr>
    <td>
      <div class="box-title">ความเห็นของอาจารย์ที่ปรึกษา</div>
      เมื่อทำการตรวจสอบลักษณะงานที่ออกสหกิจศึกษาแล้ว<br>
      ☐ เห็นควรอนุญาต<br>
      ☐ อื่น ๆ ระบุ ${blank(20)}<br><br>
      ลงชื่อ ${blank(30)}<br>
      ( ${blank(30)} )<br>
      ${blank(8)} / ${blank(10)} / ${blank(8)}
    </td>
    <td>
      <div class="box-title">ความเห็นของอาจารย์หัวหน้าสาขาวิชา</div>
      ☐ อนุญาต<br>
      ☐ ไม่อนุญาต ระบุ ${blank(18)}<br><br><br>
      ลงชื่อ ${blank(30)}<br>
      ( ${blank(30)} )<br>
      ${blank(8)} / ${blank(10)} / ${blank(8)}
    </td>
  </tr>
</table>

<div class="officer" style="margin-top: 10pt;">
  <div class="box-title">ส่วนของเจ้าหน้าที่ฝ่ายวิชาการและวิจัย (ส่วนงานสหกิจศึกษา)</div>
  ☐ ดำเนินการแล้ว เลขที่หนังสือออก ${blank(40)}<br><br>
  ลงชื่อ ${blank(30)} &nbsp;&nbsp; ( ${blank(30)} ) &nbsp;&nbsp;
  ${blank(8)} / ${blank(10)} / ${blank(8)}
</div>

<div class="foot">ฉบับปรับปรุง ๑ ก.ย. ๒๕๖๔ บังคับใช้ ๖ ก.ย. ๒๕๖๔</div>

<p class="hint">พิมพ์หน้านี้ออกมา (Ctrl+P) แล้วกรอกช่องที่เว้นไว้ด้วยปากกา
จากนั้นนำไปให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาวิชาลงนาม
แล้วสแกนหรือถ่ายรูปอัปโหลดกลับเข้าระบบ</p>
</body>
</html>`;
}
