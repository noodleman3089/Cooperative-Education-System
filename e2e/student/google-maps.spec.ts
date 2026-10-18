import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { API_URL } from '../helpers/env';
import { dbExec, dbRows, dbValue } from '../helpers/db';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { goToMenu } from '../helpers/nav';
import { startPlacesStub } from '../helpers/placesStub';

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../../backend/.env.test') });
// Fallback to default .env if .env.test is missing
if (!process.env.DB_USER) {
  dotenv.config({ path: path.join(__dirname, '../../backend/.env') });
}

let pool: Pool;

test.describe('Google Maps Integration & Fallback Tests', () => {
  test.beforeAll(async () => {
    // Setup test pool (used purely if we need manual assertions, mostly seeding covers it)
    pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_DATABASE,
      password: process.env.DB_PASSWORD,
      port: parseInt(process.env.DB_PORT || '5432'),
    });
  });

  test.beforeEach(async ({ page }) => {
    // 1. Reset and seed DB before every test
    console.log('Seeding database for Google Maps Fallback Test...');
    await seedTestData();

    // 2. BLOCK Google Maps API requests across all tests in this suite
    await page.route('**/*maps.googleapis.com/**', route => {
      console.log('Blocked Google Maps API Request:', route.request().url());
      route.abort(); // Simulates network failure or blocked API
    });
  });

  test('Test 1: โหลด Google Maps ไม่ได้ หน้ายื่นคำร้องยังใช้ได้ และยังค้นจากทำเนียบของคณะได้', async ({ page }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');

    // หน้าต้องขึ้นครบทั้งที่สคริปต์แผนที่ถูกบล็อก
    await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();

    // ป้ายต้องไม่สัญญาสิ่งที่ใช้ไม่ได้ — ไม่มีคำว่า Google Maps เมื่อโหลดแผนที่ไม่ขึ้น
    const searchLabel = page.locator('label[for="request-company-search"]');
    await expect(searchLabel).toHaveText('ค้นหาจากทำเนียบของคณะ');

    // ทำเนียบเป็นข้อมูลของระบบเอง ไม่พึ่ง Google — ต้องค้นเจอและเลือกได้
    await page.getByTestId('request-company-search').fill('ซีเกท');
    const match = page.getByTestId('request-directory-matches').getByRole('button').first();
    await expect(match).toContainText('บริษัท ซีเกท เทคโนโลยี');
    await match.click();
    await expect(page.getByTestId('request-company-locked')).toBeVisible();
    // เลือกจากทำเนียบแล้ว ข้อมูลเป็นของทำเนียบ — ช่องต้องแก้ไม่ได้
    await expect(page.getByTestId('request-company-name')).toBeDisabled();
    await expect(page.getByTestId('request-company-name')).toHaveValue(/ซีเกท/);
  });

  test('Test 2: โหลด Google Maps ไม่ได้ ยังพิมพ์สถานประกอบการเองแล้วยื่นได้', async ({ page }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');
    await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();

    await page.getByTestId('request-company-name').fill('บริษัท ทดสอบจำกัด (E2E Test)');
    await page.getByTestId('request-address').fill('123/45 ถนนทดสอบ');
    await page.getByTestId('request-district').fill('เขตจตุจักร');
    await page.getByTestId('request-province').selectOption({ label: 'กรุงเทพมหานคร' });
    await page.getByTestId('request-postal').fill('10900');
    await page.getByTestId('request-phone').fill('021112222');
    // ผู้รับหนังสือเป็นช่องบังคับ (ถูกพิมพ์ลงแบบคำร้องและหนังสือขอความอนุเคราะห์)
    await page.getByTestId('request-contact-person').fill('นางสาวทดสอบ ระบบ');
    await page.getByTestId('request-contact-position').fill('HR Manager');

    await page.getByTestId('request-submit').click();
    // ส่งแล้วแก้เองไม่ได้ — ต้องผ่านกล่องยืนยัน (2026-09-22)
    await page.getByTestId('request-confirm').click();

    await expect(page.getByText('ยื่นคำร้องถึง บริษัท ทดสอบจำกัด (E2E Test) เรียบร้อยแล้ว', { exact: false })).toBeVisible();

    const checkDbResult = await pool.query(
      `SELECT i.status, c.is_verified, c.google_place_id FROM intent_forms i JOIN companies c ON i.company_id = c.company_id WHERE c.name_th = $1`,
      ['บริษัท ทดสอบจำกัด (E2E Test)']
    );
    expect(checkDbResult.rows.length).toBe(1);
    expect(checkDbResult.rows[0].status).toBe('pending_advisor');
    expect(checkDbResult.rows[0].is_verified).toBe(false);
    expect(checkDbResult.rows[0].google_place_id).toBeNull();
  });

  const mapsCompany = async () => ({
    is_self_found: true,
    semester_id: await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'),
    company_address: '1 ถนนทดสอบ',
    company_province: 'ชลบุรี',
    company_district: 'ศรีราชา',
    company_postal_code: '20110',
    company_phone: '020000000',
    contact_person: 'นางสาวทดสอบ ระบบ',
    contact_position: 'HR Manager',
  });
  const withdrawStudent2Form = () =>
    dbExec("DELETE FROM intent_forms WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')");

  test('Test 3: สถานที่ที่ค้นจาก Google Maps (place id ที่ Google ยืนยัน) รับรองทันที · กรอกเองรอเจ้าหน้าที่ (เจ้าของยืนยัน 2026-10-18)', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const company = await mapsCompany();
    const stub = await startPlacesStub({ 'place-e2e-maps-verified': 'OPERATIONAL' });
    try {
      // เส้นทาง Google Maps: place id ที่ Google ยืนยัน → รับรองทันที ไม่ต้องรอเจ้าหน้าที่
      const viaMaps = await request.post(`${API_URL}/intents`, {
        data: { ...company, company_name_th: 'บริษัท จากแผนที่ จำกัด (E2E)', google_place_id: 'place-e2e-maps-verified' },
      });
      expect(viaMaps.status(), await viaMaps.text()).toBe(201);
      expect(stub.requests).toEqual(['place-e2e-maps-verified']);

      // ถอนใบนั้นก่อนยื่นใหม่ — มีใบที่ยังเดินอยู่ได้ทีละใบ
      await withdrawStudent2Form();

      // เส้นทางกรอกเอง: ไม่มี place id → รอเจ้าหน้าที่รับรองตอนกดผ่านคำร้อง (SEC-04) · ไม่ถาม Google
      const typed = await request.post(`${API_URL}/intents`, {
        data: { ...company, company_name_th: 'บริษัท กรอกเอง จำกัด (E2E)' },
      });
      expect(typed.status(), await typed.text()).toBe(201);
      expect(stub.requests).toHaveLength(1);
    } finally {
      await stub.close();
    }

    const rows = await dbRows<{ name_th: string; is_verified: boolean; google_place_id: string | null }>(
      `SELECT name_th, is_verified, google_place_id FROM companies WHERE name_th LIKE '%(E2E)' ORDER BY name_th`
    );
    expect(rows.map((r) => [r.name_th, r.is_verified])).toEqual([
      ['บริษัท กรอกเอง จำกัด (E2E)', false],
      ['บริษัท จากแผนที่ จำกัด (E2E)', true],
    ]);
    expect(rows.find((r) => r.is_verified)?.google_place_id).toBe('place-e2e-maps-verified');
  });

  test('Test 4: place id ที่แต่งเอง / Google ไม่ยืนยัน → ไม่ถูกรับรอง แต่ยื่นคำร้องได้ตามปกติ (SEC-04)', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const company = await mapsCompany();
    const stub = await startPlacesStub({ 'place-e2e-closed': 'CLOSED_PERMANENTLY' });
    try {
      // ยิง POST /intents ตรงด้วย id ที่ Google ไม่รู้จัก · id ของที่ปิดถาวรแล้ว → ยื่นได้ แต่ไม่รับรอง ไม่เก็บ id
      for (const [placeId, name] of [
        ['place-e2e-forged', 'บริษัท แต่งเลข จำกัด (E2E)'],
        ['place-e2e-closed', 'บริษัท ปิดถาวร จำกัด (E2E)'],
      ]) {
        const res = await request.post(`${API_URL}/intents`, {
          data: { ...company, company_name_th: name, google_place_id: placeId },
        });
        expect(res.status(), await res.text()).toBe(201);
        await withdrawStudent2Form();
      }
      expect(stub.requests).toEqual(['place-e2e-forged', 'place-e2e-closed']);

      // เส้นแก้สถานประกอบการของใบที่ยื่นแล้ว (PUT /intents/:id/company) ต้องผ่านด่านเดียวกัน
      const first = await request.post(`${API_URL}/intents`, {
        data: { ...company, company_name_th: 'บริษัท ก่อนแก้ จำกัด (E2E)' },
      });
      expect(first.status(), await first.text()).toBe(201);
      const formId = (await first.json()).intentForm.form_id as number;
      const { is_self_found: _s, semester_id: _m, ...typed } = company;
      const edited = await request.put(`${API_URL}/intents/${formId}/company`, {
        data: { ...typed, company_name_th: 'บริษัท หลังแก้ จำกัด (E2E)', google_place_id: 'place-e2e-forged-edit' },
      });
      expect(edited.status(), await edited.text()).toBe(200);
    } finally {
      await stub.close();
    }

    // Google ตอบไม่ได้เลย (ไม่มี stub รันอยู่ = เชื่อมต่อไม่ได้) → fail closed ไม่ใช่ปฏิเสธการยื่น
    await withdrawStudent2Form();
    const offline = await request.post(`${API_URL}/intents`, {
      data: { ...company, company_name_th: 'บริษัท Google ล่ม จำกัด (E2E)', google_place_id: 'place-e2e-offline' },
    });
    expect(offline.status(), await offline.text()).toBe(201);

    const rows = await dbRows<{ name_th: string; is_verified: boolean; google_place_id: string | null }>(
      `SELECT name_th, is_verified, google_place_id FROM companies WHERE name_th LIKE '%(E2E)' ORDER BY name_th`
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect(row.is_verified, row.name_th).toBe(false);
      expect(row.google_place_id, row.name_th).toBeNull();
    }
  });
});
