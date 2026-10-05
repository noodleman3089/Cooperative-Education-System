import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { mentor1Id, withDb } from '../helpers/db';

/**
 * ผลของการกดต้องอยู่ในจอ และ "โหลดพัง" ต้องไม่ถูกเล่าเป็น "ยังไม่ถึงขั้นตอน"
 * (web-preflight 2026-10-05 · P-001 · P-002)
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **กดปุ่มท้ายฟอร์มยาวแล้วแถบผลต้องอยู่ในจอ** — หน้าใน dashboard เลื่อนใน <main> ไม่ใช่ window
 *      `window.scrollTo` ที่เคยเขียนไว้จึงไม่มีผล แถบสำเร็จของ สหกิจ 03 เคยอยู่เหนือจอ 2,316px
 *      ในสายตาผู้ใช้คือ "กดแล้วไม่มีอะไรเกิดขึ้น" · ⛔ `toBeVisible` จับเรื่องนี้ไม่ได้
 *      (แถบอยู่ใน DOM และไม่ถูกซ่อน แค่อยู่นอกจอ) ต้องใช้ `toBeInViewport`
 *   2. **บันทึกการปฏิบัติงานโหลดไม่สำเร็จ ≠ ยังไม่ได้รับการตอบรับ** — เคยตกไปที่ข้อความ
 *      "ยังไม่สามารถบันทึกการปฏิบัติงานได้" ทั้งที่นักศึกษาตอบรับแล้ว
 */

/** ใบแจ้งความจำนงที่ตอบรับแล้วและเริ่มงานแล้ว — เงื่อนไขที่หน้าบันทึกการปฏิบัติงานเปิดให้ใช้ */
async function acceptPlacementFor(studentEmail: string): Promise<void> {
  await withDb(async (db) => {
    const student = await db.query('SELECT user_id FROM users WHERE email = $1', [studentEmail]);
    const company = await db.query('SELECT company_id FROM companies LIMIT 1');
    const companyId = company.rows[0].company_id as number;
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');

    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id,
                                  start_date, end_date)
       VALUES ($1, $2, $3, 'accepted', $4, CURRENT_DATE - 6, CURRENT_DATE + 60)`,
      [student.rows[0].user_id, companyId, semester.rows[0].semester_id, await mentor1Id()]
    );
  });
}

test.describe('ผลของการกดต้องอยู่ในจอ', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('V1: สหกิจ 03 บันทึกสำเร็จ → แถบสำเร็จอยู่ในจอ ไม่ใช่เหนือจอ', async ({ page }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'job_application');

    await page.getByTestId('ca-career').fill('อยากเป็นนักพัฒนาระบบ');
    await page.getByTestId('ca-submit').click();

    const banner = page.getByRole('status').filter({ hasText: 'บันทึกข้อมูลใบสมัครงานสหกิจศึกษาเรียบร้อยแล้ว' });
    await expect(banner).toBeInViewport({ ratio: 1 });
  });

  test('V2: สหกิจ 03 เซิร์ฟเวอร์ปฏิเสธ → แถบ error อยู่ในจอ และค่าที่กรอกไม่หาย', async ({ page }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'job_application');

    // ล้มเฉพาะการบันทึก — การโหลดหน้ายังต้องผ่านตามปกติ
    await page.route('**/api/students/coop-application', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'บันทึกล่มทดสอบ' }),
          })
        : route.continue()
    );

    await page.getByTestId('ca-career').fill('ค่าที่ต้องไม่หาย');
    await page.getByTestId('ca-submit').click();

    await expect(page.getByRole('alert').filter({ hasText: 'บันทึกล่มทดสอบ' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('ca-career')).toHaveValue('ค่าที่ต้องไม่หาย');
  });

  test('V3: บันทึกการปฏิบัติงานโหลดไม่สำเร็จ → บอกว่าโหลดไม่สำเร็จ ไม่ใช่ "ยังไม่สามารถบันทึกได้"', async ({
    page,
  }) => {
    await acceptPlacementFor('student2@test.com');
    await loginAs(page, 'student2');
    await goToMenu(page, 'weekly_log');

    // ตัวคุม: โหลดปกติต้องได้หน้าบันทึกจริง ไม่งั้นเคสข้างล่างผ่านได้โดยไม่ได้พิสูจน์อะไร
    await expect(page.getByTestId('worklog-tab-weekly')).toBeVisible();
    await expect(page.getByText('ยังไม่สามารถบันทึกการปฏิบัติงานได้')).toHaveCount(0);

    await page.route('**/api/weekly-logs/me', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'บันทึกการปฏิบัติงานล่มทดสอบ' }),
      })
    );
    await page.reload();

    await expect(page.getByRole('alert').filter({ hasText: 'บันทึกการปฏิบัติงานล่มทดสอบ' })).toBeVisible();
    // ⛔ ข้อความนี้แปลว่า "คุณยังไม่มีสิทธิ์" — ขึ้นตอนเซิร์ฟเวอร์ล่มคือบอกนักศึกษาผิดเรื่อง
    await expect(page.getByText('ยังไม่สามารถบันทึกการปฏิบัติงานได้')).toHaveCount(0);
  });
});
