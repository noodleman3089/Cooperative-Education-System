import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { withDb, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { approveIntentThroughOfficer } from '../helpers/intent';

/**
 * เอกสารหมายเลข 2 — แบบยืนยันแบบตอบรับนักศึกษาสหกิจศึกษา
 *
 * คณะออกให้ **คู่กับ** หนังสือขอความอนุเคราะห์ (คู่มือ 13 ขั้นตอน ข้อ 3) นักศึกษา
 * ถือไปทั้งสองใบ สถานประกอบการกรอกและลงนาม+ประทับตรา แล้วนักศึกษาถือกลับมาส่งคณะ
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **ลำดับ** — ออกก่อนคณบดีลงนามไม่ได้ เพราะคำชี้แจงบนฟอร์มบอกให้บริษัทตอบ
 *      "หลังจากได้รับหนังสือขอความอนุเคราะห์ฯ" · ให้ใบตอบรับไปก่อนคือให้ไปตอบสิ่งที่ยังไม่มี
 *   2. **ใครเปิดได้** — ใบนี้มีชื่อนักศึกษาและชื่อสถานประกอบการอยู่ (SEC-06 fail closed)
 *   3. **ได้ PDF จริง** ไม่ใช่หน้า error ที่ถูกส่งมาด้วย 200
 */

/** สร้างใบความจำนงให้ student2 แล้วคืน form_id */
async function seedIntent(): Promise<number> {
  return withDb(async (db) => {
    const studentId = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      .company_id;

    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'pending_advisor', '2026-11-02') RETURNING form_id`,
      [studentId, companyId, semesterId]
    );
    return res.rows[0].form_id as number;
  });
}

/** เดินให้ครบจนคณบดีลงนามหนังสือขอความอนุเคราะห์ */
async function signByDean(request: APIRequestContext, formId: number): Promise<void> {
  await approveIntentThroughOfficer(request, formId);
  const docId = await dbValue<number>(
    "SELECT doc_id FROM official_documents WHERE type = 'cover_letter' ORDER BY doc_id DESC LIMIT 1"
  );
  await apiLoginAs(request, 'dean1');
  const signed = await request.post(`${API_URL}/documents/batch-sign`, {
    data: { doc_ids: [docId] },
  });
  expect(signed.status(), await signed.text()).toBe(200);
}

test.describe('เอกสารหมายเลข 2 — แบบยืนยันแบบตอบรับ', () => {
  test('A1: คณบดียังไม่ลงนาม → ยังออกแบบตอบรับไม่ได้ (409)', async ({ request }) => {
    await seedTestData();
    const formId = await seedIntent();

    await apiLoginAs(request, 'student2');
    const tooEarly = await request.get(`${API_URL}/intents/${formId}/acceptance-form`);
    expect(tooEarly.status()).toBe(409);
    expect((await tooEarly.json()).message as string).toContain('คณบดีลงนาม');

    // แม้เจ้าหน้าที่รับคำร้องแล้วก็ยังไม่ได้ ตราบใดที่ยังไม่ลงนาม (สถานะหนังสือ = pending_sign)
    await approveIntentThroughOfficer(request, formId);
    await apiLoginAs(request, 'student2');
    expect((await request.get(`${API_URL}/intents/${formId}/acceptance-form`)).status()).toBe(409);
  });

  test('A2: คณบดีลงนามแล้ว → ได้ไฟล์ PDF จริง', async ({ request }) => {
    test.setTimeout(180_000);
    await seedTestData();
    const formId = await seedIntent();
    await signByDean(request, formId);

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/intents/${formId}/acceptance-form`);
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');

    // ⛔ ใบนี้เป็นฟอร์มเปล่าที่วาดสด ต้องไม่ไปสร้างแถวใน official_documents
    //    (ไม่มีลายเซ็นอยู่บนไฟล์ จึงไม่มีอะไรต้องเก็บ)
    expect(
      await dbValue<string>(
        "SELECT COUNT(*) FROM official_documents WHERE type <> 'cover_letter'"
      )
    ).toBe('0');
  });

  test('A3: นักศึกษาคนอื่นเปิดไม่ได้ (403) · ใบที่ไม่มีอยู่ → 404', async ({ request }) => {
    test.setTimeout(180_000);
    await seedTestData();
    const formId = await seedIntent();
    await signByDean(request, formId);

    await apiLoginAs(request, 'student1');
    expect((await request.get(`${API_URL}/intents/${formId}/acceptance-form`)).status()).toBe(403);

    await apiLoginAs(request, 'student2');
    expect((await request.get(`${API_URL}/intents/999999/acceptance-form`)).status()).toBe(404);
  });

  test('A4: อาจารย์ที่ดูแลเปิดได้ · อาจารย์นอกความดูแลเปิดไม่ได้', async ({ request }) => {
    test.setTimeout(180_000);
    await seedTestData();
    const formId = await seedIntent();
    await signByDean(request, formId);

    await apiLoginAs(request, 'advisor1');
    expect((await request.get(`${API_URL}/intents/${formId}/acceptance-form`)).status()).toBe(200);

    await apiLoginAs(request, 'advisor2');
    expect((await request.get(`${API_URL}/intents/${formId}/acceptance-form`)).status()).toBe(403);
  });

  test('A5: หน้าจอนักศึกษา — ปุ่มพิมพ์แบบตอบรับโผล่หลังคณบดีลงนามเท่านั้น', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await seedTestData();
    const formId = await seedIntent();

    await loginAs(page, 'student2');
    await expect(page.getByTestId('open-acceptance-form')).toHaveCount(0);

    await signByDean(request, formId);

    await page.reload();
    await expect(page.getByTestId('open-acceptance-form')).toBeVisible();
    await expect(page.getByText(/ภายใน 15 วันทำการ/)).toBeVisible();

    // ลิงก์ต้องชี้ไปที่ใบของตัวเองจริง ไม่ใช่ค่าตายตัว
    await expect(page.getByTestId('open-acceptance-form')).toHaveAttribute(
      'href',
      new RegExp(`/intents/${formId}/acceptance-form$`)
    );
  });

  test('A6: ตราคณะที่ฝังในเอกสารต้องเป็น PNG โปร่งใสจริง', async () => {
    // บทเรียนจากลายเซ็นคณบดี: ไฟล์ที่ "นามสกุล .png" อาจเป็น JPEG ที่เปลี่ยนชื่อ
    // ซึ่งไม่มี alpha ในสเปก แล้วพื้นหลังขาวทึบจะติดไปบนเอกสารทุกใบ
    const fs = await import('fs');
    const path = await import('path');
    const seal = path.join(BACKEND_ROOT, 'secure_private', 'emblems', 'rmutto_seal.png');
    expect(fs.existsSync(seal)).toBe(true);
    const bytes = fs.readFileSync(seal);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    // colorType 6 = RGBA · 4 = gray+alpha — อย่างอื่นแปลว่าไม่มีช่องโปร่งใส
    expect([4, 6]).toContain(bytes[25]);
  });

});
