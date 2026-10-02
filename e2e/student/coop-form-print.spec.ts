import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { PDFParse } from 'pdf-parse';

/**
 * อ่านข้อความจริงในไฟล์ PDF
 *
 * ⛔ **อย่าเทียบไบต์ดิบเพื่อดูเนื้อหา** — `pdf-lib` เก็บทั้งหน้าไว้ใน object stream
 * ที่ถูกบีบอัด ทั้ง `/Type /Page` และตัวหนังสือจึงหาไม่เจอในไบต์ตรงๆ · การเช็คแบบนั้น
 * จะ "ผ่าน" หรือ "ตก" ด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่เราอยากรู้เลย
 */
async function readPdf(bytes: Buffer): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return { text: result.text, pages: result.pages.length };
  } finally {
    await parser.destroy();
  }
}

/**
 * ปุ่มพิมพ์ของ **สหกิจ 03** (ใบสมัครงาน ๓ หน้า) และ **สหกิจ 06** (แบบแจ้งที่พัก ๑ หน้า)
 *
 * ทั้งสองใบเป็น **ทางออกสำรอง** ไม่ใช่ขั้นตอนบังคับ — สถานประกอบการที่มีบัญชีอ่านใบสมัคร
 * ในระบบได้อยู่แล้ว และอาจารย์นิเทศเปิดที่พัก/หมุดในระบบได้เลย · ไม่มีใครกดเลย ระบบต้องเดินครบ
 *
 * สิ่งที่ชุดนี้คุมเรียงตามความสำคัญ:
 *   1. ⛔⛔ **ใครเปิดใบ สหกิจ 03 ได้** — ใบนี้คือ *จุดเดียวในระบบ* ที่เลขบัตรประชาชน
 *      เชื้อชาติ และศาสนาถูกถอดรหัสออกมาเป็นค่าจริง (SEC-12) เส้นทางจึงต้องไม่รับ `id`
 *      จากผู้เรียก และต้องไม่มี role อื่นเปิดได้เลย แม้แต่เจ้าหน้าที่หรือบริษัทที่ผูกกันอยู่
 *   2. **ทุกครั้งที่เปิดต้องมีแถวใน `audit_log`** — SEC-07 · การเปิดค่าจริงต้องตามย้อนได้
 *   3. **สหกิจ 06 ใช้ด่านเดียวกับหน้าอ่านที่พัก** (SEC-06 fail closed) ไม่ใช่ด่านใหม่ที่หลวมกว่า
 *   4. **ได้ PDF จริง** ไม่ใช่หน้า error ที่ถูกส่งมาพร้อม 200
 *   5. **"ห้อง" ลงคอลัมน์ของ `students` ไม่ใช่ของ `accommodations`** — ฟอร์มจริงถามไว้
 *      ข้าง "ชั้นปีที่" (รอบ 55 เคยเดาผิดว่าเป็นเลขห้องพัก ตอนที่ยังไม่มีไฟล์ `.docx`)
 */

const ADDRESS = {
  section: '4/1',
  house_no: '88/9',
  building: 'ลาดยาวเพลส',
  room_no: '512',
  soi: 'ลาดยาว 7',
  road: 'งามวงศ์วาน',
  subdistrict: 'ลาดยาว',
  district: 'เขตจตุจักร',
  province: 'กรุงเทพมหานคร',
  postal_code: '10900',
  phone: '02-123-4567',
  mobile_phone: '0891234567',
  fax: '02-123-4568',
  email: 'stay@example.com',
  latitude: 13.8459123,
  longitude: 100.5612345,
  emergency_contact: 'นางสมศรี ใจดี',
  emergency_relationship: 'มารดา',
  emergency_phone: '0898765432',
};

const WEEKS = Array.from({ length: 16 }, (_, i) => ({
  week_number: i + 1,
  start_date: '2026-11-02',
  end_date: '2026-11-06',
  tasks: `สัปดาห์ที่ ${i + 1} ทดสอบระบบ`,
}));

const studentId = () =>
  dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'");

/** ใบตอบรับที่ `accepted` — เงื่อนไขของการส่งแบบแจ้งที่พัก และเป็นที่มาของชื่อบริษัทบนใบ */
async function seedAcceptedIntent(): Promise<number> {
  return withDb(async (db) => {
    const sid = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'"))
      .rows[0].user_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      .company_id;

    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'accepted', (NOW() AT TIME ZONE 'Asia/Bangkok')::date)`,
      [sid, companyId, semesterId]
    );
    return sid as number;
  });
}

const submitAccommodation = (request: APIRequestContext, sid: number) =>
  request.post(`${API_URL}/students/${sid}/accommodation-plan`, {
    data: { accommodation: ADDRESS, weekly_plans: WEEKS },
  });

/** กรอกช่องอ่อนไหวของ สหกิจ 03 ผ่าน API จริง เพื่อให้มีอะไรให้ถอดรหัสตอนพิมพ์ */
async function fillSensitive(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${API_URL}/students/coop-application`, {
    data: {
      national_id: '1234567890123',
      national_id_issued_district: 'เขตจตุจักร',
      national_id_expiry_date: '2031-05-15',
      ethnicity: 'ไทย',
      religion: 'พุทธ',
      sensitive_data_consent: true,
      first_name_en: 'Somchai',
      last_name_en: 'Saidee',
      gender: 'ชาย',
      nationality: 'ไทย',
      language_proficiency: [
        { language: 'ภาษาอังกฤษ', reading: 'ดี', speaking: 'พอใช้', writing: 'ดี' },
      ],
      family_info: {
        father: { name: 'สมศักดิ์ สายดี', age: '52', occupation: 'รับราชการ' },
        siblings: [{ name: 'สมปอง สายดี', age: '25', occupation: 'พนักงานบริษัท' }],
      },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

const PRINT_03 = `${API_URL}/students/coop-application/print`;

test.describe('ปุ่มพิมพ์ สหกิจ 03 / 06', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  // ── ๑. สิทธิ์ของใบ สหกิจ 03 ────────────────────────────────────────────────

  test('F1: มีแต่นักศึกษาเจ้าของเท่านั้นที่เปิดใบ สหกิจ 03 ได้ — พี่เลี้ยง/เจ้าหน้าที่/อาจารย์เปิดไม่ได้', async ({
    request,
  }) => {
    await seedAcceptedIntent();

    // ⛔ ใบพิมพ์มีชั้น C (เลขบัตร · เชื้อชาติ · ศาสนา) ครบ — ฝั่งสถานประกอบการ (พี่เลี้ยง) ต้องเปิดไม่ได้
    for (const who of ['mentor1', 'staff1', 'advisor1', 'head1', 'dean1'] as const) {
      await apiLoginAs(request, who);
      const res = await request.get(PRINT_03);
      expect(res.status(), `${who} ต้องเปิดใบ สหกิจ 03 ไม่ได้`).toBe(403);
    }

    await apiLoginAs(request, 'student2');
    const ok = await request.get(PRINT_03);
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('F2: ไม่มีเส้นทางที่รับ id ของนักศึกษาคนอื่นสำหรับใบ สหกิจ 03', async ({ request }) => {
    const sid = await studentId();
    await apiLoginAs(request, 'student2');

    // ⛔ ด่านที่แท้จริงคือ "ไม่มี route แบบนี้" ไม่ใช่ "route มีแต่ตรวจสิทธิ์ไว้"
    //    เพราะการมีอยู่ของมันคือช่อง IDOR ที่รอให้ใครสักคนตรวจหลุด
    for (const path of [
      `${API_URL}/students/${sid}/coop-application/print`,
      `${API_URL}/students/9999/coop-application/print`,
    ]) {
      const res = await request.get(path);
      expect([403, 404], `${path} ต้องไม่ใช่เส้นทางที่ใช้งานได้`).toContain(res.status());
      if (res.status() === 200) throw new Error('เส้นทางที่รับ id ไม่ควรมีอยู่');
    }
  });

  test('F3: การพิมพ์ใบ สหกิจ 03 ลง audit_log ทุกครั้ง พร้อมบอกว่าถอดรหัสอะไรออกมา', async ({
    request,
  }) => {
    await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    const before = Number(
      await dbValue<string>(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'student.coop_application_printed'"
      )
    );

    const res = await request.get(PRINT_03);
    expect(res.status(), await res.text()).toBe(200);

    // `writeAudit` เป็น fire-and-forget — แถวลงหลัง response จึงต้อง poll
    await expect
      .poll(
        async () =>
          Number(
            await dbValue<string>(
              "SELECT COUNT(*) FROM audit_log WHERE action = 'student.coop_application_printed'"
            )
          ),
        { timeout: 10_000 }
      )
      .toBe(before + 1);

    const row = await dbRow<{ detail: { decrypted: Record<string, boolean> } }>(
      `SELECT detail FROM audit_log
        WHERE action = 'student.coop_application_printed'
        ORDER BY audit_id DESC LIMIT 1`
    );
    expect(row?.detail.decrypted).toEqual({
      national_id: true,
      ethnicity: true,
      religion: true,
    });
  });

  // ── ๒. ตัวไฟล์ ────────────────────────────────────────────────────────────

  test('F4: ใบ สหกิจ 03 ออกมาเป็น PDF จริง ๓ หน้า และยังออกได้เมื่อยังไม่ได้กรอกอะไรเลย', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');

    // ⛔ ใบสมัครที่ยังกรอกไม่ครบต้องพิมพ์ได้ — บนกระดาษนักศึกษาพิมพ์ฟอร์มเปล่าไปเขียนมือ
    //    ก็เป็นเรื่องปกติ · การบังคับกรอกครบคือการแต่งกติกาที่กระดาษไม่ได้มี
    const blank = await request.get(PRINT_03);
    expect(blank.status(), await blank.text()).toBe(200);
    expect(blank.headers()['content-type']).toContain('application/pdf');

    await fillSensitive(request);
    const filled = await request.get(PRINT_03);
    expect(filled.status()).toBe(200);

    const bytes = await filled.body();
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const { text, pages } = await readPdf(bytes);
    // ต้นฉบับพิมพ์ "หน้าที่ ๑/๓" ไว้ท้ายกระดาษ — จำนวนหน้าจึงเป็นข้อกำหนดของฟอร์ม
    // ไม่ใช่ผลพลอยได้ของความยาวเนื้อหา
    expect(pages).toBe(3);
    expect(text).toContain('หน้าที่ 3/3');

    // ⛔⛔ **หัวใจของ endpoint นี้** — ค่าจริงต้องไปถึงกระดาษ ไม่ใช่มาสก์
    //    ถ้าวันหนึ่งใครเผลอเอา `maskNationalId` มาใส่ตรงนี้ ใบสมัครจะพิมพ์ออกมา
    //    ใช้ไม่ได้จริง และไม่มีอะไรอื่นในระบบจับได้เลย เพราะทุก endpoint อื่นมาสก์หมด
    expect(text).toContain('1 2345 67890 12 3');
    expect(text).toContain('พุทธ');
    expect(text).not.toContain('x-xxxx-xxxxx');

    // ช่องที่เป็นหัวใจของฟอร์มต้องมีจริง ไม่ใช่หน้าเปล่าที่นับได้ ๓ หน้า
    for (const heading of [
      'ใบสมัครงานสหกิจศึกษา',
      'ข้อมูลส่วนตัวนักศึกษา',
      'ข้อมูลครอบครัว',
      'จุดมุ่งหมายอาชีพ',
      'ความสามารถพิเศษทางภาษา',
      'ประวัติการศึกษา',
    ]) {
      expect(text, `ใบ สหกิจ 03 ต้องมีหัวข้อ "${heading}"`).toContain(heading);
    }
  });

  test('F5: ใบ สหกิจ 06 ออกมาเป็น PDF จริง และใบที่มีพิกัดใหญ่กว่าใบที่ไม่มี (คิวอาร์โค้ด)', async ({
    request,
  }) => {
    const sid = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    // ยังไม่กรอกที่พัก → ยังพิมพ์ฟอร์มเปล่าได้
    const empty = await request.get(`${API_URL}/students/${sid}/accommodation-plan/print`);
    expect(empty.status(), await empty.text()).toBe(200);
    expect(empty.headers()['content-type']).toContain('application/pdf');
    const emptyBytes = await empty.body();
    expect(emptyBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    expect((await submitAccommodation(request, sid)).status()).toBe(200);
    const withPin = await request.get(`${API_URL}/students/${sid}/accommodation-plan/print`);
    expect(withPin.status()).toBe(200);
    const pinBytes = await withPin.body();

    // คิวอาร์โค้ดเป็นรูปฝังในไฟล์ ใบที่มีหมุดจึงต้องใหญ่กว่าอย่างเห็นได้ชัด
    // ⛔ อย่าเทียบว่า "เท่ากันเป๊ะ" กับใบที่วาดซ้ำ — `pdf-lib` ฝัง CreationDate ไว้ใน
    //    สตรีมที่ถูกบีบอัด สองครั้งจึงไม่เคยได้ขนาดเท่ากัน (บทเรียนจาก dispatch-letter D6)
    expect(pinBytes.length).toBeGreaterThan(emptyBytes.length + 300);

    const { text, pages } = await readPdf(pinBytes);
    expect(pages).toBe(1);
    expect(text).toContain('แบบแจ้งรายละเอียดของสถานประกอบการในปฏิบัติงานสหกิจศึกษา');
    // ตัวอ่านยุบช่องว่างซ้อนให้เหลือช่องเดียว — เทียบด้วยช่องเดียวเสมอ
    expect(text).toContain('เรียน หัวหน้าสหกิจศึกษาและการฝึกงานวิชาชีพประจำคณะ');
    // ที่อยู่ต้องแตกลงช่องของมันจริง ไม่ใช่ยัดก้อนเดียวลงช่องแรก
    expect(text).toContain('88/9');
    expect(text).toContain('ลาดยาว');
    // พิกัดถูกพิมพ์กำกับคิวอาร์ไว้ด้วย เผื่อพิมพ์ขาวดำแล้วสแกนไม่ติด
    expect(text).toContain('13.8459123');

    // ⛔ ห้ามมี "ยังไม่ได้ปักหมุด" เมื่อปักแล้ว — ข้อความนั้นบอกอาจารย์นิเทศผิด
    expect(text).not.toContain('ยังไม่ได้ปักหมุด');
    expect((await readPdf(emptyBytes)).text).toContain('ยังไม่ได้ปักหมุด');
  });

  // ── ๓. สิทธิ์ของใบ สหกิจ 06 ───────────────────────────────────────────────

  test('F6: ใบ สหกิจ 06 ใช้ด่านเดียวกับหน้าอ่านที่พัก — อาจารย์ที่ไม่ได้ดูแลเปิดไม่ได้', async ({
    request,
  }) => {
    const sid = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    expect((await submitAccommodation(request, sid)).status()).toBe(200);

    const printPath = `${API_URL}/students/${sid}/accommodation-plan/print`;
    const readPath = `${API_URL}/students/${sid}/accommodation-plan`;

    // ⛔ ปุ่มพิมพ์ต้องไม่หลวมกว่าหน้าอ่าน — ถ้าใครแก้ด่านหน้าอ่านให้แน่นขึ้นแล้วลืมตรงนี้
    //    เทสต์นี้จะแดง เพราะมันเทียบสองเส้นทางกันเอง ไม่ได้ตรึงตัวเลขไว้
    for (const who of ['advisor2', 'mentor1'] as const) {
      await apiLoginAs(request, who);
      const printed = await request.get(printPath);
      const read = await request.get(readPath);
      expect(printed.status(), `${who}: ปุ่มพิมพ์ต้องตอบเท่าหน้าอ่าน`).toBe(read.status());
      expect(printed.status()).not.toBe(200);
    }

    // อาจารย์ที่ปรึกษาของนักศึกษาคนนี้เปิดได้ — หัวใบเขียนว่า "เรียน หัวหน้าสหกิจศึกษาฯ"
    await apiLoginAs(request, 'advisor1');
    expect((await request.get(printPath)).status()).toBe(200);
  });

  // ── ๔. ช่องที่เพิ่มมาจากไฟล์ `.docx` ตัวจริง ────────────────────────────────

  test('F7: "ห้อง" ลงคอลัมน์ของ students ไม่ใช่ของ accommodations', async ({ request }) => {
    const sid = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    expect((await submitAccommodation(request, sid)).status()).toBe(200);

    // ⛔ ฟอร์มจริงถาม "ห้อง" ไว้ข้าง "ชั้นปีที่" = ห้องเรียน · ส่วน `room_no` คือเลขห้อง
    //    ของหอพัก ซึ่งอยู่คนละบล็อกและ **ยังต้องเก็บต่อ** ไม่ใช่ของซ้ำ
    expect(await dbValue<string>('SELECT section FROM students WHERE student_id = $1', [sid])).toBe(
      '4/1'
    );
    expect(
      await dbValue<string>('SELECT room_no FROM accommodations WHERE student_id = $1', [sid])
    ).toBe('512');

    const read = await request.get(`${API_URL}/students/${sid}/accommodation-plan`);
    expect((await read.json()).section).toBe('4/1');
  });

  test('F8: ความสามารถทางภาษาสามช่องอยู่ร่วมคอลัมน์เดียวกับหน้าโปรไฟล์โดยไม่ลบกันเอง', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    // หน้าโปรไฟล์บันทึกทับด้วยรูปทรงของตัวเอง (`language` + `level`)
    // ⛔ ระบบต้องยอมให้แถวเดียวกันถือคีย์ของทั้งสองหน้า — ไม่งั้นการแก้ที่หน้าหนึ่ง
    //    จะลบของอีกหน้าหายเงียบๆ โดยไม่มีใครรู้จนกว่าจะพิมพ์ใบออกมา
    const res = await request.put(`${API_URL}/profile/student/optional`, {
      data: {
        skills_and_activities: 'ทดสอบ',
        language_proficiency: [
          { language: 'ภาษาอังกฤษ', level: 'ดี', reading: 'ดี', speaking: 'พอใช้', writing: 'ดี' },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    const saved = await dbValue<string>(
      'SELECT language_proficiency::text FROM students WHERE student_id = $1',
      [await studentId()]
    );
    const rows = JSON.parse(saved) as Record<string, string>[];
    expect(rows[0]).toMatchObject({ language: 'ภาษาอังกฤษ', reading: 'ดี', writing: 'ดี' });
  });

  test('F9: คีย์แปลกปลอมในตารางภาษาถูกตัดทิ้ง ไม่ใช่ปฏิเสธทั้งคำขอ', async ({ request }) => {
    await apiLoginAs(request, 'student2');

    const res = await request.put(`${API_URL}/students/coop-application`, {
      data: {
        language_proficiency: [
          { language: 'ภาษาญี่ปุ่น', reading: 'พอใช้', evil_key: 'x'.repeat(50) },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    const saved = await dbValue<string>(
      'SELECT language_proficiency::text FROM students WHERE student_id = $1',
      [await studentId()]
    );
    expect(saved).toContain('ภาษาญี่ปุ่น');
    expect(saved).not.toContain('evil_key');
  });

  // ── ๕. หน้าจอ ─────────────────────────────────────────────────────────────

  test('F10: ปุ่มพิมพ์อยู่บนหน้าจอทั้งสองใบ และชี้ไปที่เส้นทางที่ถูกต้อง', async ({ page }) => {
    await seedAcceptedIntent();
    await loginAs(page, 'student2');

    await goToMenu(page, 'job_application');
    const print03 = page.getByTestId('ca-print');
    await expect(print03).toBeVisible();
    await expect(print03).toHaveAttribute('href', /\/students\/coop-application\/print$/);
    // ผู้ใช้ต้องรู้ก่อนกดว่าไฟล์นี้มีค่าจริงของข้อมูลอ่อนไหวอยู่
    await expect(page.getByText('เลขบัตรประชาชน เชื้อชาติ และศาสนาเป็นค่าจริง')).toBeVisible();

    await goToMenu(page, 'accommodation_plan');
    const sid = await studentId();
    await expect(page.getByTestId('acc-section')).toBeVisible();
    const print06 = page.getByTestId('acc-print');
    await expect(print06).toBeVisible();
    await expect(print06).toHaveAttribute(
      'href',
      new RegExp(`/students/${sid}/accommodation-plan/print$`)
    );
  });

  test('F11: ค่าจริงของข้อมูลอ่อนไหวไม่เคยออกทางหน้าจอ แม้จะพิมพ์ใบได้', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    // ⛔ ปุ่มพิมพ์ต้องไม่ทำให้ใครเผลอเปิดค่าจริงใน endpoint ที่หน้าจอใช้
    const screen = await request.get(`${API_URL}/students/coop-application`);
    const body = await screen.text();
    expect(body).toContain('x-xxxx-xxxxx-xx-3');
    expect(body).not.toContain('1234567890123');
    expect(body).not.toContain('พุทธ');

    // ค่าจริงยังอยู่ในฐานแบบเข้ารหัส — พิมพ์ได้แปลว่าถอดกลับได้ ไม่ใช่เก็บเป็น plaintext
    const cipher = await dbValue<string>(
      'SELECT national_id_ciphertext FROM students WHERE student_id = $1',
      [await studentId()]
    );
    expect(cipher).not.toContain('1234567890123');
    expect((cipher ?? '').length).toBeGreaterThan(0);
  });

  test('F12: กุญแจถอดรหัสใช้ไม่ได้ → ยังพิมพ์ใบออกมาได้ แค่ช่องนั้นว่าง', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    // ทำให้ ciphertext เสีย — จำลองกรณีกุญแจถูกหมุนโดยไม่ได้เข้ารหัสข้อมูลเดิมใหม่
    // ⛔ ใบสมัครทั้งใบต้องไม่พิมพ์ไม่ออกเพราะช่องเดียวเสีย
    await dbExec(
      "UPDATE students SET national_id_ciphertext = 'deadbeef' WHERE student_id = $1",
      [await studentId()]
    );

    const res = await request.get(PRINT_03);
    expect(res.status(), await res.text()).toBe(200);
    const { text, pages } = await readPdf(await res.body());
    expect(pages).toBe(3);
    // ช่องเลขบัตรว่าง แต่ช่องอื่นที่ถอดได้ยังต้องมีค่าจริงอยู่
    expect(text).not.toContain('1 2345 67890 12 3');
    expect(text).toContain('พุทธ');

    // บันทึกต้องบอกความจริงว่าช่องไหนถอดได้ ช่องไหนไม่ได้ (`writeAudit` ลงหลัง response)
    await expect
      .poll(
        async () =>
          (
            await dbRow<{ detail: { decrypted: Record<string, boolean> } }>(
              `SELECT detail FROM audit_log
                WHERE action = 'student.coop_application_printed'
                ORDER BY audit_id DESC LIMIT 1`
            )
          )?.detail.decrypted,
        { timeout: 10_000 }
      )
      .toEqual({ national_id: false, ethnicity: true, religion: true });
  });
});
