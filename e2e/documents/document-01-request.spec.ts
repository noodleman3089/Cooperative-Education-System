import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { approveIntentThroughOfficer } from '../helpers/intent';
import { PDFParse } from 'pdf-parse';

/**
 * เอกสารหมายเลข 1 — แบบคำร้องขอหนังสือขอความอนุเคราะห์
 *
 * ชุดนี้คุม **การพิมพ์แบบคำร้อง** (ก้อน 1 ของแผน) — การอัปโหลดกระดาษที่เซ็นแล้ว
 * และการกดผ่านของเจ้าหน้าที่อยู่ในก้อนถัดไป
 *
 * สองเรื่องที่พังเงียบได้ และเป็นเหตุผลที่ชุดนี้มีอยู่:
 *   1. **ใครเปิดดูได้** — คำร้องมีชื่อ เบอร์โทร อีเมล และที่ฝึกงานของนักศึกษา
 *      นักศึกษาคนอื่นหรืออาจารย์นอกความดูแลต้องเปิดไม่ได้ (SEC-06 fail closed)
 *   2. **XSS** — ชื่อสถานประกอบการเป็นข้อความที่นักศึกษาพิมพ์เอง แล้วถูกประกอบ
 *      เป็น HTML จริง ถ้าลืม escape หน้าที่เจ้าหน้าที่เปิดจะรันสคริปต์ของคนยื่น
 */

/** สร้างใบความจำนงให้ student2 แล้วคืน form_id */
async function seedIntent(companyNameTh?: string): Promise<number> {
  return withDb(async (db) => {
    const studentId = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;

    let companyId: number;
    if (companyNameTh) {
      companyId = (
        await db.query(
          `INSERT INTO companies (name_th, address, province, district, postal_code, phone,
                                  created_by, is_verified, contact_person, contact_position, email)
           VALUES ($1, '1 ถนนทดสอบ', 'ชลบุรี', 'ศรีราชา', '20110', '020000000',
                   (SELECT user_id FROM users WHERE email = 'staff1@test.com'), FALSE,
                   'ฝ่ายบุคคล', 'ผู้จัดการ', 'hr@test.com')
           RETURNING company_id`,
          [companyNameTh]
        )
      ).rows[0].company_id;
    } else {
      companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
    }

    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'pending_advisor', '2026-11-02') RETURNING form_id`,
      [studentId, companyId, semesterId]
    );
    return res.rows[0].form_id as number;
  });
}

/** นักศึกษาอัปโหลดกระดาษที่ลงนามแล้ว — ขั้นก่อนที่เจ้าหน้าที่จะตรวจได้ */
async function uploadSignedForm(request: APIRequestContext, formId: number): Promise<void> {
  await apiLoginAs(request, 'student2');
  const res = await request.post(`${API_URL}/intents/${formId}/request-form`, {
    multipart: {
      request_form: {
        name: 'signed.pdf',
        mimeType: 'application/pdf',
        buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
      },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('เอกสารหมายเลข 1 — แบบคำร้องขอหนังสือ', () => {
  test('D1: นักศึกษาเปิดแบบคำร้องของตัวเองได้ทันทีที่ยื่น และมีข้อมูลจริงอยู่ในนั้น', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/intents/${formId}/request-form`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    const pdfBytes = await res.body();
    expect(pdfBytes.subarray(0, 4).toString()).toBe('%PDF');

    const htmlRes = await request.get(`${API_URL}/intents/${formId}/request-form?format=html`);
    expect(htmlRes.status()).toBe(200);
    expect(htmlRes.headers()['content-type']).toContain('text/html');
    const html = await htmlRes.text();
    // ข้อมูลที่ระบบเติมให้ ต้องมาจากฐานจริง ไม่ใช่แบบฟอร์มเปล่า
    const studentCode = await dbValue<string>(
      "SELECT student_code FROM students WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')"
    );
    expect(html).toContain(studentCode as string);
    expect(html).toContain('แบบคำร้องขอหนังสือขอความอนุเคราะห์');
    // วันเริ่มฝึกงานต้องเป็น พ.ศ. ไม่ใช่ ค.ศ. (2026 -> 2569) และไม่เลื่อนวัน
    expect(html).toContain('2569');
    expect(html).toMatch(/กำหนดการเริ่มฝึกงานตั้งแต่วันที่[\s\S]{0,80}2[\s\S]{0,80}พฤศจิกายน/);

    // ⚠️ ปีการศึกษาต้องเป็น พ.ศ. ด้วย — `coop_semesters.academic_year` เก็บเป็น ค.ศ.
    // โดยตั้งใจ (BUG-01) แล้วแปลงตอนแสดงผล · เคยพลาดตรงนี้มาแล้วตอนเขียนครั้งแรก
    // และเทสต์ชุดแรกจับไม่ได้เพราะดูแค่ว่ามีเลข 2569 อยู่ในหน้า (วันเริ่มฝึกก็ให้ 2569)
    const yearAD = await dbValue<number>(
      'SELECT academic_year FROM coop_semesters WHERE is_active = TRUE LIMIT 1'
    );
    expect(html).toMatch(new RegExp(`ปีการศึกษา[\\s\\S]{0,60}${Number(yearAD) + 543}`));
    expect(html).not.toMatch(new RegExp(`ปีการศึกษา[\\s\\S]{0,60}>${yearAD}<`));

    // ช่องที่ระบบไม่เก็บต้องเป็นเส้นประให้เขียนมือ ไม่ใช่คำว่า null หรือ undefined
    expect(html).toContain('โทรสาร');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null<');
  });

  test('D1b: แบบคำร้องที่พิมพ์เป็นฉบับที่ระบบกรอกให้แล้ว ไม่ใช่ฟอร์มเปล่าให้เขียนมือ', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    await seedTestData();

    // ใบที่ยังไม่มีวันเริ่มจากสถานประกอบการ — วันเริ่ม/สิ้นสุดต้องมาจากปฏิทินสหกิจ
    const formId = await seedIntent();
    await withDb(async (db) => {
      await db.query('UPDATE intent_forms SET start_date = NULL WHERE form_id = $1', [formId]);
      for (const [key, day] of [
        ['coop_start', '2026-11-16'],
        ['coop_end', '2027-03-05'],
      ]) {
        await db.query(
          `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date)
           SELECT semester_id, $1, 'single', $2, $2 FROM coop_semesters WHERE is_active = TRUE LIMIT 1`,
          [key, day]
        );
      }
    });

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/intents/${formId}/request-form`);
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    // มีชื่อ เบอร์โทร อีเมลของนักศึกษา — ห้ามค้างในแคช
    expect(res.headers()['cache-control']).toContain('no-store');

    const parser = new PDFParse({ data: new Uint8Array(await res.body()) });
    let text = '';
    let pages = 0;
    try {
      const parsed = await parser.getText();
      text = parsed.text;
      pages = parsed.pages.length;
    } finally {
      await parser.destroy();
    }
    // แม่แบบตัวจริงของคณะมี 2 หน้า (หน้า 2 คือกรอบของเจ้าหน้าที่) — ต้องยังอยู่ครบ
    expect(pages).toBe(2);

    const row = await dbRow<{ student_code: string; first_name: string; phone: string; company: string }>(
      `SELECT s.student_code, s.first_name, s.phone, c.name_th AS company
         FROM intent_forms i
         JOIN students s ON s.student_id = i.student_id
         JOIN companies c ON c.company_id = i.company_id
        WHERE i.form_id = $1`,
      [formId]
    );
    expect(text).toContain(row!.student_code);
    expect(text).toContain(row!.first_name);
    expect(text).toContain(row!.company);
    if (row!.phone) expect(text).toContain(row!.phone);

    // วันเริ่ม–สิ้นสุดจากปฏิทิน เป็น พ.ศ. และไม่เลื่อนวัน
    expect(text).toMatch(/16[\s\S]{0,40}พฤศจิกายน[\s\S]{0,40}2569/);
    expect(text).toMatch(/5[\s\S]{0,40}มีนาคม[\s\S]{0,40}2570/);

    // วันที่ยื่น = วันนี้ตามเวลาไทย (ปี พ.ศ. ต้องอยู่บนหัวกระดาษ)
    const todayYearBE = await dbValue<number>(
      "SELECT EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Bangkok'))::int + 543"
    );
    expect(text).toContain(String(todayYearBE));
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  test('D2: นักศึกษาคนอื่นเปิดคำร้องนี้ไม่ได้ (403)', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();

    await apiLoginAs(request, 'student1');
    const res = await request.get(`${API_URL}/intents/${formId}/request-form`);
    expect(res.status()).toBe(403);
  });

  test('D3: อาจารย์ที่ดูแลเปิดได้ · อาจารย์นอกความดูแลเปิดไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();

    // seeder ผูก advisor1 เป็นที่ปรึกษาของ student2 อยู่แล้ว
    await apiLoginAs(request, 'advisor1');
    const allowed = await request.get(`${API_URL}/intents/${formId}/request-form`);
    expect(allowed.status(), await allowed.text()).toBe(200);

    await apiLoginAs(request, 'advisor2');
    const denied = await request.get(`${API_URL}/intents/${formId}/request-form`);
    expect(denied.status()).toBe(403);
  });

  test('D4: ไม่ได้ล็อกอิน → 401 · คำร้องที่ไม่มีอยู่ → 404', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();

    await request.post(`${API_URL}/auth/logout`);
    const anon = await request.get(`${API_URL}/intents/${formId}/request-form`);
    expect(anon.status()).toBe(401);

    await apiLoginAs(request, 'staff1');
    const missing = await request.get(`${API_URL}/intents/999999/request-form`);
    expect(missing.status()).toBe(404);
  });

  test('D5: ชื่อสถานประกอบการที่มีสคริปต์ต้องถูก escape ไม่ใช่ฝังลงหน้า', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const evil = '<script>alert(1)</script>บริษัททดสอบ';
    const formId = await seedIntent(evil);

    await apiLoginAs(request, 'staff1');
    const res = await request.get(`${API_URL}/intents/${formId}/request-form?format=html`);
    expect(res.status(), await res.text()).toBe(200);

    const html = await res.text();
    // ชื่อยังต้องอ่านออก แต่แท็บต้องถูกแปลงเป็น entity แล้ว
    expect(html).toContain('บริษัททดสอบ');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  // ───────── ก้อน 2: อัปโหลดกระดาษที่ลงนามแล้ว + เจ้าหน้าที่กดผ่าน ─────────

  test('D6: อัปโหลดกระดาษที่ลงนามแล้ว → สถานะไปรอเจ้าหน้าที่', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();

    await uploadSignedForm(request, formId);

    expect(
      await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe('pending_officer_request');
    expect(
      await dbValue<string>('SELECT request_form_path FROM intent_forms WHERE form_id = $1', [formId])
    ).toContain('request_forms/');
  });

  test('D7: นักศึกษาคนอื่นอัปโหลดใส่คำร้องนี้ไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();

    await apiLoginAs(request, 'student1');
    const res = await request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: {
        request_form: {
          name: 'signed.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
        },
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('ของตัวเอง');

    // และคำร้องของคนอื่นต้องไม่ถูกแตะเลย
    expect(
      await dbValue<string | null>('SELECT request_form_path FROM intent_forms WHERE form_id = $1', [
        formId,
      ])
    ).toBeNull();
  });

  // ⛔ เจ้าของตัดสิน 2026-09-21: ชื่อผู้ลงนาม (ที่ปรึกษา · หัวหน้าสาขา) ระบบดึงเอง ไม่ใช่ให้เจ้าหน้าที่คีย์
  //    จากกระดาษทุกใบ · ระบบไม่รู้ชื่อไหน นักศึกษากรอกเองตอนอัปโหลด · เจ้าหน้าที่กรอกแค่เลขที่หนังสือ
  test('D8: อัปโหลดแล้วชื่อผู้ลงนามมาจากระบบเอง · เจ้าหน้าที่ไม่กรอกเลขที่หนังสือ → 400', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();
    await uploadSignedForm(request, formId);

    // ที่ปรึกษา = students.advisor_id · หัวหน้าสาขา = dept_head ของสาขาเดียวกับนักศึกษา
    const expected = await dbRow<{ advisor_name: string; dept_head_name: string }>(
      `SELECT (SELECT TRIM(CONCAT_WS(' ', p.first_name, p.last_name)) FROM personnel p WHERE p.personnel_id = s.advisor_id) AS advisor_name,
              (SELECT TRIM(CONCAT_WS(' ', p.first_name, p.last_name)) FROM user_roles r JOIN personnel p ON p.personnel_id = r.user_id
                WHERE r.role_name = 'dept_head' AND p.major_id = s.major_id ORDER BY r.user_id LIMIT 1) AS dept_head_name
         FROM students s JOIN intent_forms i ON i.student_id = s.student_id WHERE i.form_id = $1`,
      [formId]
    );
    expect(expected?.advisor_name, 'seed ต้องมีที่ปรึกษาที่มีชื่อ').toBeTruthy();
    expect(expected?.dept_head_name, 'seed ต้องมีหัวหน้าสาขาที่มีชื่อ').toBeTruthy();
    const row = await dbRow<{ advisor_signer_name: string; dept_head_signer_name: string }>(
      'SELECT advisor_signer_name, dept_head_signer_name FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row?.advisor_signer_name).toBe(expected!.advisor_name);
    expect(row?.dept_head_signer_name).toBe(expected!.dept_head_name);

    await apiLoginAs(request, 'staff1');
    const res = await request.patch(`${API_URL}/intents/${formId}/officer-approve`, { data: {} });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain('เลขที่หนังสือ');
    expect(
      await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe('pending_officer_request');
  });

  test('D8.1: ระบบไม่รู้ชื่อผู้ลงนาม → นักศึกษาต้องกรอกเอง ไม่กรอกอัปโหลดไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();
    // ยังไม่มีที่ปรึกษา และสาขานี้ยังไม่มีหัวหน้าสาขา
    await withDb(async (db) => {
      const sid = (await db.query('SELECT student_id FROM intent_forms WHERE form_id = $1', [formId])).rows[0].student_id;
      await db.query('UPDATE students SET advisor_id = NULL WHERE student_id = $1', [sid]);
      await db.query(
        `DELETE FROM user_roles r USING personnel p, students s
          WHERE r.role_name = 'dept_head' AND p.personnel_id = r.user_id AND s.student_id = $1 AND p.major_id = s.major_id`,
        [sid]
      );
    });

    const file = {
      name: 'signed.pdf',
      mimeType: 'application/pdf',
      buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
    };
    await apiLoginAs(request, 'student2');
    const noNames = await request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: { request_form: file },
    });
    expect(noNames.status()).toBe(400);
    expect((await noNames.json()).message).toContain('ชื่ออาจารย์ที่ปรึกษา');
    expect(
      await dbValue<string | null>('SELECT request_form_path FROM intent_forms WHERE form_id = $1', [formId])
    ).toBeNull();

    const ok = await request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: {
        request_form: file,
        advisor_signer_name: 'อาจารย์สมชาย ใจดี',
        dept_head_signer_name: 'อาจารย์สมหญิง รักเรียน',
      },
    });
    expect(ok.status(), await ok.text()).toBe(200);
    const row = await dbRow<{ advisor_signer_name: string; dept_head_signer_name: string }>(
      'SELECT advisor_signer_name, dept_head_signer_name FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row?.advisor_signer_name).toBe('อาจารย์สมชาย ใจดี');
    expect(row?.dept_head_signer_name).toBe('อาจารย์สมหญิง รักเรียน');
  });

  test('D8.2: ระบบรู้ชื่อแล้ว ชื่อที่นักศึกษาพิมพ์มาทับไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();
    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: {
        request_form: {
          name: 'signed.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
        },
        advisor_signer_name: 'ชื่อปลอม',
        dept_head_signer_name: 'ชื่อปลอม',
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const row = await dbRow<{ advisor_signer_name: string; dept_head_signer_name: string }>(
      'SELECT advisor_signer_name, dept_head_signer_name FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row?.advisor_signer_name).not.toBe('ชื่อปลอม');
    expect(row?.dept_head_signer_name).not.toBe('ชื่อปลอม');
  });

  test('D8.3: หน้าจอ — ระบบไม่รู้ชื่อ นักศึกษาเห็นช่องกรอก และเลือกไฟล์ก่อนกรอกไม่ได้', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    const formId = await seedIntent();
    await withDb(async (db) => {
      const sid = (await db.query('SELECT student_id FROM intent_forms WHERE form_id = $1', [formId])).rows[0].student_id;
      await db.query('UPDATE students SET advisor_id = NULL WHERE student_id = $1', [sid]);
    });

    await loginAs(page, 'student2');
    const signers = page.getByTestId('request-signers');
    // หัวหน้าสาขาระบบรู้ → แสดงชื่อ ไม่มีช่อง · ที่ปรึกษาระบบไม่รู้ → มีช่องให้กรอก
    await expect(signers).toContainText('หัวหน้าสาขาวิชา:');
    await expect(page.getByTestId('signer-dept-head')).toHaveCount(0);
    await expect(page.getByTestId('signer-advisor')).toBeVisible();

    const pdf = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
    await page.getByTestId('upload-request-form').setInputFiles(pdf);
    await expect(page.getByText('กรุณากรอก ชื่ออาจารย์ที่ปรึกษาที่ลงนาม ก่อนเลือกไฟล์')).toBeVisible();
    expect(
      await dbValue<string | null>('SELECT request_form_path FROM intent_forms WHERE form_id = $1', [formId])
    ).toBeNull();

    await page.getByTestId('signer-advisor').fill('อาจารย์สมชาย ใจดี');
    await page.getByTestId('upload-request-form').setInputFiles(pdf);
    await expect(page.getByTestId('request-form-uploaded')).toBeVisible();
    expect(
      await dbValue<string>('SELECT advisor_signer_name FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe('อาจารย์สมชาย ใจดี');
  });

  test('D9: เจ้าหน้าที่กรอกแค่เลขที่หนังสือ → ผ่านขั้น + รับรองบริษัทในตัว · กดซ้ำไม่ได้', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent('บริษัทที่ยังไม่ถูกรับรอง จำกัด');
    await uploadSignedForm(request, formId);

    const companyId = await dbValue<number>(
      'SELECT company_id FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(
      await dbValue<boolean>('SELECT is_verified FROM companies WHERE company_id = $1', [companyId])
    ).toBe(false);

    await apiLoginAs(request, 'staff1');
    const res = await request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
      // ชื่อที่เจ้าหน้าที่ส่งมาถูกเมิน — ต้องไม่ทับชื่อที่ได้ตอนอัปโหลด
      data: { document_no: 'อว 0656.10/123', advisor_signer_name: 'ชื่อจากเจ้าหน้าที่' },
    });
    expect(res.status(), await res.text()).toBe(200);

    const row = await dbRow<{
      status: string;
      advisor_signer_name: string;
      officer_document_no: string;
      officer_approved_by: number;
    }>(
      `SELECT status, advisor_signer_name, officer_document_no, officer_approved_by
         FROM intent_forms WHERE form_id = $1`,
      [formId]
    );
    expect(row?.status).toBe('approved_by_dept_head');
    expect(row?.advisor_signer_name).toBeTruthy();
    expect(row?.advisor_signer_name).not.toBe('ชื่อจากเจ้าหน้าที่');
    expect(row?.officer_document_no).toBe('อว 0656.10/123');
    expect(row?.officer_approved_by).toBeTruthy();

    // SEC-04: การรับรองสถานประกอบการเกิดพร้อมกัน เพราะเป็นการตรวจกระดาษใบเดียวกัน
    expect(
      await dbValue<boolean>('SELECT is_verified FROM companies WHERE company_id = $1', [companyId])
    ).toBe(true);

    // กดผ่านซ้ำต้องไม่ได้ — สถานะออกจาก allow-list ไปแล้ว และเลขเดิมต้องไม่ถูกทับ
    const again = await request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
      data: { document_no: 'อว 0656.10/999' },
    });
    expect(again.status()).toBe(400);
    expect(
      await dbValue<string>('SELECT officer_document_no FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe('อว 0656.10/123');
  });

  test('D10: ตีกลับต้องมีเหตุผล และล้างไฟล์เดิมให้ส่งใหม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();
    await uploadSignedForm(request, formId);

    await apiLoginAs(request, 'staff1');
    const noReason = await request.patch(`${API_URL}/intents/${formId}/officer-reject`, {
      data: {},
    });
    expect(noReason.status()).toBe(400);

    const res = await request.patch(`${API_URL}/intents/${formId}/officer-reject`, {
      data: { reason: 'ไฟล์ที่อัปโหลดขาดลายเซ็นหัวหน้าสาขาวิชา' },
    });
    expect(res.status(), await res.text()).toBe(200);

    const row = await dbRow<{
      status: string;
      request_form_path: string | null;
      reject_reason: string;
    }>('SELECT status, request_form_path, reject_reason FROM intent_forms WHERE form_id = $1', [
      formId,
    ]);
    // กลับไปสถานะเดิมเพื่อให้ส่งใหม่ได้ และเหตุผลอยู่บนแถวให้นักศึกษาอ่าน (SEC-07)
    expect(row?.status).toBe('pending_advisor');
    expect(row?.request_form_path).toBeNull();
    expect(row?.reject_reason).toContain('ลายเซ็นหัวหน้าสาขา');
  });

  test('D11: บทบาทอื่นกดผ่านคำร้องไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();
    await uploadSignedForm(request, formId);

    const payload = { document_no: 'อว 0656.10/1' };

    for (const account of ['advisor1', 'head1', 'student2'] as const) {
      await apiLoginAs(request, account);
      const res = await request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
        data: payload,
      });
      expect(res.status(), `${account} กดผ่านได้ ทั้งที่ไม่ควร`).toBe(403);
    }

    expect(
      await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe('pending_officer_request');
  });

  // ───────── ก้อน 3: หนังสือขาออก + คณบดีลงนาม ─────────

  test('D12: เจ้าหน้าที่ดูตัวอย่างหนังสือได้ · บทบาทอื่นดูไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();
    await uploadSignedForm(request, formId);

    await apiLoginAs(request, 'staff1');
    const preview = await request.get(`${API_URL}/intents/${formId}/cover-letter/preview`);
    expect(preview.status(), await preview.text()).toBe(200);
    expect(preview.headers()['content-type']).toContain('pdf');

    const bytes = Buffer.from(await preview.body());
    // ต้องเป็น PDF จริงที่เปิดได้ ไม่ใช่ไฟล์เปล่าหรือ JSON ที่ status 200
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.subarray(-1024).toString('latin1')).toContain('%%EOF');
    expect(bytes.length).toBeGreaterThan(1_000);

    await apiLoginAs(request, 'student2');
    expect((await request.get(`${API_URL}/intents/${formId}/cover-letter/preview`)).status()).toBe(403);
  });

  test('D13: รับคำร้องแล้วหนังสือเข้าคิวคณบดี · คณบดีลงนามได้ครั้งเดียว', async ({ request }) => {
    test.setTimeout(180_000);
    await seedTestData();
    const formId = await seedIntent();
    await approveIntentThroughOfficer(request, formId, { documentNo: 'อว 0656.10/555' });

    const doc = await dbRow<{
      doc_id: number;
      status: string;
      generated_file_path: string;
      document_number: string;
      template_id: number | null;
    }>(
      `SELECT doc_id, status, generated_file_path, document_number, template_id
         FROM official_documents ORDER BY doc_id DESC LIMIT 1`
    );
    expect(doc?.status).toBe('pending_sign');
    expect(doc?.document_number).toBe('อว 0656.10/555');
    // หนังสือถูกวาดจากโค้ด ไม่ได้มาจากแม่แบบ (migration 005 ทำให้คอลัมน์เป็น NULL ได้)
    expect(doc?.template_id).toBeNull();

    const draftPath = doc!.generated_file_path;
    expect(fs.existsSync(path.resolve(process.cwd(), 'backend', draftPath))).toBe(true);

    // นักศึกษายังโหลดไม่ได้ เพราะยังไม่ลงนาม
    await apiLoginAs(request, 'student2');
    expect((await request.get(`${API_URL}/files/documents/${doc!.doc_id}`)).status()).toBe(403);

    await apiLoginAs(request, 'dean1');
    const signed = await request.post(`${API_URL}/documents/batch-sign`, {
      data: { doc_ids: [doc!.doc_id] },
    });
    expect(signed.status(), await signed.text()).toBe(200);
    expect((await signed.json()).signed_count).toBe(1);

    const after = await dbRow<{ status: string; generated_file_path: string }>(
      'SELECT status, generated_file_path FROM official_documents WHERE doc_id = $1',
      [doc!.doc_id]
    );
    expect(after?.status).toBe('signed');
    // ⛔ ฉบับลงนามต้องเป็น **คนละไฟล์** กับต้นฉบับ — ของเดิมเขียนทับไฟล์เดิม
    // ทำให้ไม่มีต้นฉบับให้ถอย และกดซ้ำแล้วลายเซ็นซ้อนกัน
    expect(after?.generated_file_path).not.toBe(draftPath);
    expect(fs.existsSync(path.resolve(process.cwd(), 'backend', draftPath))).toBe(true);

    // กดซ้ำต้องไม่ได้ และไฟล์ต้องไม่เปลี่ยนอีก
    const again = await request.post(`${API_URL}/documents/batch-sign`, {
      data: { doc_ids: [doc!.doc_id] },
    });
    expect((await again.json()).signed_count).toBe(0);
    expect(
      await dbValue<string>('SELECT generated_file_path FROM official_documents WHERE doc_id = $1', [
        doc!.doc_id,
      ])
    ).toBe(after?.generated_file_path);

    // ลงนามแล้วนักศึกษาโหลดได้
    await apiLoginAs(request, 'student2');
    const download = await request.get(`${API_URL}/files/documents/${doc!.doc_id}`);
    expect(download.status(), await download.text()).toBe(200);
  });

  test('D14: ที่อยู่ยาวสุดที่ระบบยอม — หนังสือต้องยาวขึ้นตาม ไม่ใช่เขียนทับกัน', async ({
    request,
  }) => {
    test.setTimeout(180_000);

    /**
     * เคสนี้คือสิ่งที่โค้ดเดิมพัง: พิกัดลายเซ็นฝังตายที่ `y: 165` พอที่อยู่ยาวขึ้น
     * เนื้อหาก็ไหลลงไปทับลายเซ็น (หรือกลับกัน) · ตัววาดใหม่ไล่ `cursorY` เอง
     *
     * วัดด้วยการเทียบ **สองใบ**: ที่อยู่สั้นกับที่อยู่ยาวสุดเท่าที่คอลัมน์ยอม
     * (`companies.address` เป็น VARCHAR(255)) — ใบที่ยาวกว่าต้องมีเนื้อหามากกว่าจริง
     * ถ้าตัววาดตัดข้อความทิ้งหรือเขียนทับที่เดิม ขนาดจะไม่ต่างกัน
     */
    const longAddress = `เลขที่ 999/888 อาคารสำนักงานใหญ่ ชั้นที่ 45 ${'ถนนทดสอบความยาว '.repeat(11)}`;
    expect(longAddress.length).toBeLessThanOrEqual(255);

    const render = async (address: string): Promise<Buffer> => {
      await seedTestData();
      const formId = await seedIntent('บริษัท ทดสอบความยาวที่อยู่ จำกัด');
      await withDb(async (db) => {
        await db.query(
          `UPDATE companies SET address = $1
            WHERE company_id = (SELECT company_id FROM intent_forms WHERE form_id = $2)`,
          [address, formId]
        );
      });
      await uploadSignedForm(request, formId);
      await apiLoginAs(request, 'staff1');
      const res = await request.get(`${API_URL}/intents/${formId}/cover-letter/preview`);
      expect(res.status(), await res.text()).toBe(200);
      return Buffer.from(await res.body());
    };

    const short = await render('1 ถนนสั้น');
    const long = await render(longAddress);

    for (const [label, bytes] of [
      ['ที่อยู่สั้น', short],
      ['ที่อยู่ยาว', long],
    ] as const) {
      expect(bytes.subarray(0, 5).toString('latin1'), `${label} ไม่ใช่ PDF`).toBe('%PDF-');
      expect(bytes.subarray(-1024).toString('latin1'), `${label} เขียนไม่จบ`).toContain('%%EOF');
    }

    expect(
      long.length,
      'ที่อยู่ยาวขึ้นแล้วขนาดไฟล์ไม่ต่างเลย = ข้อความถูกตัดทิ้งหรือเขียนทับที่เดิม'
    ).toBeGreaterThan(short.length);

    // และฉบับที่ลงนามจริงก็ต้องออกได้โดยไม่พัง (เส้นทางเดียวกับที่คณบดีกด)
    const formId = await dbValue<number>('SELECT form_id FROM intent_forms ORDER BY form_id DESC LIMIT 1');
    await approveIntentThroughOfficer(request, formId as number);
    const docId = await dbValue<number>(
      'SELECT doc_id FROM official_documents ORDER BY doc_id DESC LIMIT 1'
    );

    await apiLoginAs(request, 'dean1');
    const signed = await request.post(`${API_URL}/documents/batch-sign`, {
      data: { doc_ids: [docId] },
    });
    expect((await signed.json()).signed_count).toBe(1);

    const signedPath = await dbValue<string>(
      'SELECT generated_file_path FROM official_documents WHERE doc_id = $1',
      [docId]
    );
    const signedBytes = fs.readFileSync(path.resolve(process.cwd(), 'backend', signedPath as string));
    expect(signedBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // ฉบับลงนามต้องใหญ่กว่าฉบับร่างของที่อยู่เดียวกัน เพราะมีรูปลายเซ็นฝังอยู่
    expect(signedBytes.length).toBeGreaterThan(long.length);
  });
});
