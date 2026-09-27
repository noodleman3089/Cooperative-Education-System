import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { withDb } from '../helpers/db';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

test.describe('Self-Found Placement Workflow E2E Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Block Google Maps API to prevent loading external resources
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");'
      });
    });
  });

  test('Test E1: Self-Found Company Intent Submission', async ({ page }) => {
    // ==========================================
    // Business Rule: Student can submit an application specifying their own self-found internship venue.
    // This creates an unverified company entry and links it to a new intent form with 'pending_advisor' status.
    // ==========================================

    // 1. Reset and seed test database
    console.log('Seeding database for Test E1...');
    await seedTestData();

    // 2. Student logs in
    await loginAs(page, 'student2');

    // Go to Smart Job Board tab
    await goToMenu(page, 'jobs');

    // 3. Click the self-found placement button
    //    ปุ่มเปลี่ยนป้ายเป็น "ระบุที่ฝึกงานด้วยตนเอง" ตอนรีเมคหน้าหาที่ฝึกงาน (`7a105bf`)
    //    · ช่องในฟอร์มไม่มี label ผูก input จึงยังต้องหาด้วย placeholder แต่ scope ในโมดัล
    const selfFoundBtn = page.getByRole('button', { name: 'ระบุที่ฝึกงานด้วยตนเอง' });
    await expect(selfFoundBtn).toBeVisible();
    await selfFoundBtn.click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'ระบุสถานที่ฝึกงานด้วยตนเอง' });
    await expect(dialog).toBeVisible();

    // 4. Fill in the Self-Found Company details
    await dialog.getByPlaceholder('เช่น บริษัท เอสซีจี แพคเกจจิ้ง จำกัด (มหาชน)').fill('บริษัท สมมติสุข จำกัด');
    await dialog.getByPlaceholder('e.g. SCG Packaging Public Company Limited').fill('Sommutisuk Co., Ltd.');
    await dialog.getByPlaceholder('เช่น 1 ถ.ปูนซิเมนต์ไทย แขวงบางซื่อ').fill('456/78 ถนนสุขุมวิท แขวงคลองเตย');
    await dialog.locator('select').first().selectOption('กรุงเทพมหานคร');
    await dialog.getByPlaceholder('เช่น บางซื่อ หรือ ศรีราชา').fill('คลองเตย');
    await dialog.getByPlaceholder('เช่น 10800').fill('10110');
    await dialog.getByPlaceholder('เช่น 02-586-3333').fill('029998888');
    await dialog.getByPlaceholder('เช่น คุณสมหญิง วงศ์สวัสดิ์').fill('นายสมหวัง ตั้งใจ');
    await dialog.getByPlaceholder('เช่น ผู้จัดการฝ่ายทรัพยากรบุคคล').fill('HR Specialist');

    // 5. Submit the self-found form
    await dialog.getByRole('button', { name: 'บันทึกและเลือกสถานที่นี้' }).click();
    // กล่องยืนยันต้องแสดงชื่อและผู้ประสานงานที่จะถูกพิมพ์ลงหนังสือ · กลับไปแก้ = ยังไม่ยื่น (2026-09-22)
    const summary = page.getByTestId('confirm-summary');
    await expect(summary).toContainText('บริษัท สมมติสุข จำกัด');
    await expect(summary).toContainText('นายสมหวัง ตั้งใจ');
    await page.getByTestId('self-found-confirm-cancel').click();
    await expect(summary).toHaveCount(0);
    await dialog.getByRole('button', { name: 'บันทึกและเลือกสถานที่นี้' }).click();
    await page.getByTestId('self-found-confirm').click();

    // 6. Verify success toaster message
    await expect(
      page.getByText('ลงทะเบียนและยื่นความจำนงไปยัง บริษัท สมมติสุข จำกัด เรียบร้อยแล้ว', { exact: false })
    ).toBeVisible();

    // 7. Verify DB state: intent form created, points to the new company, and status is pending_advisor
    await withDb(async (db) => {
      const companyRes = await db.query(
        "SELECT company_id, is_verified, created_by FROM companies WHERE name_th = 'บริษัท สมมติสุข จำกัด'"
      );
      expect(companyRes.rowCount).toBe(1);
      const company = companyRes.rows[0];
      expect(company.is_verified).toBe(false); // Should be unverified

      const intentRes = await db.query(
        "SELECT status, company_id FROM intent_forms WHERE company_id = $1",
        [company.company_id]
      );
      expect(intentRes.rowCount).toBe(1);
      expect(intentRes.rows[0].status).toBe('pending_advisor');
    });
  });

});
