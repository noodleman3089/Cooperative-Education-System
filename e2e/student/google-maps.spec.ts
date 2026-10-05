import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { loginAs } from '../helpers/auth';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { goToMenu } from '../helpers/nav';

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
});
