import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbValue, withDb } from '../helpers/db';
import { API_URL } from '../helpers/env';

/**
 * ด่านของหน้าจอนักศึกษาที่พังเงียบได้ (จากการตรวจก่อนปล่อย 2026-10-13)
 *  · เส้นทางตรงที่ข้ามด่าน "ยังไม่ถึงขั้นตอนนี้"
 *  · เซิร์ฟเวอร์สะดุดแล้วหน้าจอทำเหมือน "ยังไม่มีข้อมูล" หรือ "หลุดระบบ"
 *  · ป้ายที่บอกว่าบันทึกแล้วทั้งที่ยังไม่มีอะไรถึงเซิร์ฟเวอร์
 */

/** ใบ accepted ที่ถึงวันเริ่มฝึกแล้ว — สภาพที่เมนูช่วงฝึกงานเปิดให้ใช้ */
async function acceptedIntent(studentEmail: string): Promise<void> {
  await withDb(async (db) => {
    const student = await db.query('SELECT user_id FROM users WHERE email = $1', [studentEmail]);
    const company = await db.query('SELECT company_id FROM companies LIMIT 1');
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date, end_date)
       VALUES ($1, $2, $3, 'accepted', CURRENT_DATE - 10, CURRENT_DATE + 100)`,
      [student.rows[0].user_id, company.rows[0].company_id, semester.rows[0].semester_id]
    );
  });
}

const serverError = { status: 500, json: { message: 'An unexpected error occurred on the server.' } };

test.describe('หน้าจอนักศึกษา — ด่านตามขั้นและตอนเซิร์ฟเวอร์สะดุด', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('S1: ยังไม่มีที่ฝึก — เส้นทาง /student/final-report พาไปหน้าล็อกในเมนู และเซิร์ฟเวอร์ไม่รับร่างรายงาน', async ({
    page,
  }) => {
    await loginAs(page, 'student2');

    await page.goto('/student/final-report');
    await expect(page).toHaveURL(/\/dashboard\?menu=final_report/);
    await expect(page.getByText('ยังไม่ถึงขั้นตอนนี้')).toBeVisible();
    // อยู่ในกรอบของแอป มีเมนูให้ไปต่อ — เดิมเป็นหน้าลอยไม่มีทางกลับ
    await expect(page.getByTestId('nav-dashboard')).toBeVisible();

    // ⛔ ด่านจริงอยู่ที่เซิร์ฟเวอร์ — ยิงตรงต้องไม่เกิดร่างรายงานที่ไม่มีใครตรวจได้
    const res = await page.request.post(`${API_URL}/final-reports`, {
      multipart: {
        reviewer_kind: 'mentor',
        report: { name: 'draft.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') },
      },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain('ยังไม่มีสถานประกอบการที่ตอบรับ');
    expect(await dbValue<string>('SELECT COUNT(*) FROM final_reports')).toBe('0');
  });

  test('S2: ตรวจ session ไม่ได้เพราะเซิร์ฟเวอร์สะดุด (500) ไม่ถูกเด้งไปหน้าเข้าสู่ระบบ — 401 เท่านั้นที่ถือว่าหลุด', async ({
    page,
  }) => {
    await loginAs(page, 'student2');

    await page.route('**/api/auth/me', (route) => route.fulfill(serverError));
    await page.goto('/dashboard?menu=profile');
    await expect(page.getByTestId('nav-profile')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\?menu=profile/);

    await page.unroute('**/api/auth/me');
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, json: { message: 'Unauthorized' } }));
    await page.goto('/dashboard?menu=profile');
    await expect(page).toHaveURL(/\/login/);
  });

  test('S3: โหลดข้อมูลรายงานไม่ขึ้น — ขึ้นแถบแจ้งอย่างเดียว ไม่ประกาศว่า "ยังไม่ได้ส่งร่าง" และไม่เปิดปุ่มอัปโหลด', async ({
    page,
  }) => {
    await acceptedIntent('student2@test.com');
    await loginAs(page, 'student2');

    await page.route('**/api/final-reports/my-report', (route) => route.fulfill(serverError));
    await goToMenu(page, 'final_report');

    const main = page.locator('main');
    // ข้อความกลางภาษาอังกฤษของเซิร์ฟเวอร์ต้องไม่ถึงตานักศึกษา
    await expect(main.getByRole('alert')).toHaveText('ไม่สามารถโหลดข้อมูลรายงานได้');
    await expect(main.getByText('ยังไม่ได้ส่งร่าง')).toHaveCount(0);
    await expect(main.getByRole('button')).toHaveCount(0);
  });

  test('S4: สหกิจ 06 — พิมพ์ที่อยู่แล้วยังไม่ได้บันทึก ป้ายต้องยังเป็น "ยังไม่ได้บันทึก"', async ({ page }) => {
    await acceptedIntent('student2@test.com');
    await loginAs(page, 'student2');
    await goToMenu(page, 'accommodation_plan');

    await expect(page.getByText('ที่พัก · ยังไม่ได้บันทึก')).toBeVisible();
    await page.getByTestId('acc-house-no').fill('99/1');
    await page.getByTestId('acc-province').selectOption({ index: 1 });
    // ⛔ ป้ายอ่านจากสิ่งที่เซิร์ฟเวอร์มี ไม่ใช่จากช่องที่กำลังพิมพ์ — เดิมขึ้น "บันทึกแล้ว" ทั้งที่ไม่มีคำขอออกไปเลย
    await expect(page.getByText('ที่พัก · ยังไม่ได้บันทึก')).toBeVisible();
    await expect(page.getByText('ที่พัก · บันทึกแล้ว')).toHaveCount(0);

    // รีเฟรชแล้วร่างในเครื่องถูกกู้คืน ป้ายก็ยังต้องไม่โกหก
    await page.reload();
    await expect(page.getByTestId('acc-house-no')).toHaveValue('99/1');
    await expect(page.getByText('ที่พัก · ยังไม่ได้บันทึก')).toBeVisible();
  });
});
