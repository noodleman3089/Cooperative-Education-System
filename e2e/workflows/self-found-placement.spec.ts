import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { withDb, dbValue } from '../helpers/db';
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

    // 3. หน้ายื่นคำร้องขอหนังสือ (เมนู jobs) — ฟอร์มอยู่บนหน้าเลย ไม่มีโมดัลแล้ว (2026-10-05)
    await goToMenu(page, 'jobs');
    await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();

    // ข้อมูลนักศึกษาต้องมาจากโปรไฟล์ ไม่ใช่ให้กรอกซ้ำ
    const studentCode = await dbValue<string>(
      "SELECT student_code FROM students WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')"
    );
    await expect(page.getByTestId('request-student-summary')).toContainText(studentCode as string);

    // 4. กรอกสถานประกอบการที่ยังไม่อยู่ในทำเนียบ
    await page.getByTestId('request-company-name').fill('บริษัท สมมติสุข จำกัด');
    await page.getByTestId('request-address').fill('456/78 ถนนสุขุมวิท แขวงคลองเตย');
    await page.getByTestId('request-district').fill('คลองเตย');
    await page.getByTestId('request-province').selectOption('กรุงเทพมหานคร');
    await page.getByTestId('request-postal').fill('10110');
    await page.getByTestId('request-phone').fill('029998888');

    // ผู้รับหนังสือบังคับ — ชื่อนี้ถูกพิมพ์ลงแบบคำร้องและหนังสือขอความอนุเคราะห์
    await page.getByTestId('request-submit').click();
    await expect(page.getByText('กรุณากรอกชื่อและตำแหน่งของผู้รับหนังสือที่สถานประกอบการ')).toBeVisible();
    await expect(page.getByTestId('confirm-summary')).toHaveCount(0);

    await page.getByTestId('request-contact-person').fill('นายสมหวัง ตั้งใจ');
    await page.getByTestId('request-contact-position').fill('HR Specialist');

    // ตัวอย่างกระดาษต้องขึ้นค่าที่เพิ่งพิมพ์ทันที
    const paper = page.getByTestId('request-paper-preview');
    await expect(paper).toContainText('บริษัท สมมติสุข จำกัด');
    await expect(paper).toContainText('นายสมหวัง ตั้งใจ');
    await expect(paper).toContainText(studentCode as string);

    // 5. ยื่น — กล่องยืนยันต้องแสดงชื่อและผู้รับหนังสือที่จะถูกพิมพ์ · กลับไปแก้ = ยังไม่ยื่น (2026-09-22)
    await page.getByTestId('request-submit').click();
    const summary = page.getByTestId('confirm-summary');
    await expect(summary).toContainText('บริษัท สมมติสุข จำกัด');
    await expect(summary).toContainText('นายสมหวัง ตั้งใจ');
    await page.getByTestId('request-confirm-cancel').click();
    await expect(summary).toHaveCount(0);
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM intent_forms')).toBe(0);
    await page.getByTestId('request-submit').click();
    await page.getByTestId('request-confirm').click();

    // 6. Verify success message
    await expect(
      page.getByText('ยื่นคำร้องถึง บริษัท สมมติสุข จำกัด เรียบร้อยแล้ว', { exact: false })
    ).toBeVisible();

    // 7. Verify DB state: intent form created, points to the new company, and status is pending_advisor
    await withDb(async (db) => {
      const companyRes = await db.query(
        "SELECT company_id, is_verified, created_by, contact_person, contact_position FROM companies WHERE name_th = 'บริษัท สมมติสุข จำกัด'"
      );
      expect(companyRes.rowCount).toBe(1);
      const company = companyRes.rows[0];
      expect(company.is_verified).toBe(false); // Should be unverified
      // ผู้รับหนังสือที่กรอกต้องลงฐานจริง — ถูกพิมพ์ลงแบบคำร้องและหนังสือขอความอนุเคราะห์
      expect(company.contact_person).toBe('นายสมหวัง ตั้งใจ');
      expect(company.contact_position).toBe('HR Specialist');

      const intentRes = await db.query(
        "SELECT status, company_id FROM intent_forms WHERE company_id = $1",
        [company.company_id]
      );
      expect(intentRes.rowCount).toBe(1);
      expect(intentRes.rows[0].status).toBe('pending_advisor');
    });
  });

});
