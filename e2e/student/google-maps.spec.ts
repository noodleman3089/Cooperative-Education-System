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

  test('Test 1: Smart Job Board Map Loading Failure Gracefully Handled', async ({ page }) => {
    // Log in as student
    await loginAs(page, 'student2');
    
    // Navigate to Smart Job Board
    await goToMenu(page, 'jobs');
    
    // Ensure the page loaded successfully despite API block
    // (หัวหน้าเปลี่ยนจาก h2 "บอร์ดหาตำแหน่งงานสหกิจศึกษา" ตอนรีเมค `7a105bf`)
    await expect(page.getByRole('heading', { name: 'หาที่ฝึกงานสหกิจศึกษา' })).toBeVisible();

    // Toggle the map
    await page.getByRole('button', { name: 'แผนที่สถานประกอบการ' }).click();

    // Verify that the fallback error message is shown correctly
    await expect(page.getByText('ไม่สามารถโหลดแผนที่ได้')).toBeVisible();
    await expect(page.getByText('กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตหรือการตั้งค่า Google Maps API Key')).toBeVisible();

    // Verify that job listings are still visible and accessible
    await expect(page.locator('text=บริษัท ซีเกท เทคโนโลยี').first()).toBeVisible();
  });

  test('Test 2: Self-Found Job Modal Manual Fallback', async ({ page }) => {
    // Log in as student
    await loginAs(page, 'student2');
    
    // Navigate to Smart Job Board
    await goToMenu(page, 'jobs');
    await expect(page.getByRole('heading', { name: 'หาที่ฝึกงานสหกิจศึกษา' })).toBeVisible();

    // Open the Self-Found Job Modal (ป้ายปุ่ม/หัวโมดัลเปลี่ยนตอนรีเมค `7a105bf`)
    await page.getByRole('button', { name: 'ระบุที่ฝึกงานด้วยตนเอง' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'ระบุสถานที่ฝึกงานด้วยตนเอง' });
    await expect(dialog).toBeVisible();

    // Verify that the Google Maps Autocomplete wrapper is HIDDEN
    // Since mapsLoaded state is false (due to script block), the blue container shouldn't render
    await expect(dialog.getByText('ค้นหาและดึงที่อยู่สถานประกอบการอัตโนมัติด้วย Google Maps')).toBeHidden();

    // Verify manual entry fields are still available and interactable
    const nameInput = dialog.getByPlaceholder('เช่น บริษัท เอสซีจี แพคเกจจิ้ง จำกัด (มหาชน)');
    await expect(nameInput).toBeVisible();

    // Fill out the manual form
    await nameInput.fill('บริษัท ทดสอบจำกัด (E2E Test)');
    await dialog.getByPlaceholder('เช่น 1 ถ.ปูนซิเมนต์ไทย แขวงบางซื่อ').fill('123/45 ถนนทดสอบ');
    await dialog.locator('select').first().selectOption({ label: 'กรุงเทพมหานคร' });
    await dialog.getByPlaceholder('เช่น บางซื่อ หรือ ศรีราชา').fill('เขตจตุจักร');
    await dialog.getByPlaceholder('เช่น 10800').fill('10900');
    await dialog.getByPlaceholder('เช่น 02-586-3333').fill('021112222');
    // ผู้ประสานงานเป็นช่องบังคับ (คณะใช้ติดต่อกลับตอนออกหนังสือขอความอนุเคราะห์)
    await dialog.getByPlaceholder('เช่น คุณสมหญิง วงศ์สวัสดิ์').fill('นางสาวทดสอบ ระบบ');
    await dialog.getByPlaceholder('เช่น ผู้จัดการฝ่ายทรัพยากรบุคคล').fill('HR Manager');

    // Submit the form
    await dialog.getByRole('button', { name: 'บันทึกและเลือกสถานที่นี้' }).click();
    // ส่งแล้วแก้เองไม่ได้ — ต้องผ่านกล่องยืนยัน (2026-09-22)
    await page.getByTestId('self-found-confirm').click();

    // Wait for success message toast or banner
    await expect(page.getByText('ลงทะเบียนและยื่นความจำนงไปยัง บริษัท ทดสอบจำกัด (E2E Test) เรียบร้อยแล้ว', { exact: false })).toBeVisible();
    
    // Check database to ensure it was created as is_self_found
    const checkDbResult = await pool.query(
      `SELECT * FROM intent_forms i JOIN companies c ON i.company_id = c.company_id WHERE c.name_th = $1`,
      ['บริษัท ทดสอบจำกัด (E2E Test)']
    );
    expect(checkDbResult.rows.length).toBe(1);
    expect(checkDbResult.rows[0].job_id).toBe(null);
    expect(checkDbResult.rows[0].status).toBe('pending_advisor');
  });
});
