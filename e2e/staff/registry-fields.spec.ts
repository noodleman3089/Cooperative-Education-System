import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbValue } from '../helpers/db';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';

test.describe('Student Enrollment Year & Personnel Birth Date E2E Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept Google Maps API
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps");'
      });
    });
  });

  // SEC-05: enrollment_year drives the graduation auto-deactivation, so it is
  // registry data. Students can read it but only staff may change it.
  //
  // ⛔ ปีที่ใช้ต้อง **ยังไม่จบการศึกษา** เสมอ — `runAutoDeactivation()` ปิดบัญชี
  //    นักศึกษาเมื่อ `enrollment_year + 4 <= academic_year` และ seed ตั้ง
  //    academic_year = 2026 CE (= 2569 BE) ดังนั้น 2565 คือ "จบแล้ว" พอดี
  //    · dev server เรียก scheduler เองตอน boot+5 วิ และทุก 24 ชม. โดยเทสต์
  //      คุมไม่ได้ ถ้าจังหวะมันมาตกตรงนี้ student2 จะถูกปิดบัญชีกลางเทสต์
  //      แล้วทุกคำขอถัดไปตอบ 403 "Your account has been deactivated."
  //      (ต้นเหตุที่ไฟล์นี้แกว่งจนถึง 2026-09-04 — ตกคนละเคสกันทุกรอบ)
  //    · 2568 → จบ 2572 ยังไม่ถึง จึงปลอดภัยไม่ว่า scheduler จะเดินตอนไหน
  test('Enrollment year is read-only for the student and writable only by staff', async ({ page, request }) => {
    await seedTestData();

    await withDb(async (db) => {
      await db.query('UPDATE students SET enrollment_year = 2568 WHERE student_id = 2');
    });

    // 1. Student logs in
    await loginAs(page, 'student2');

    // 2. Click Profile
    await goToMenu(page, 'profile');

    // 3. The field is displayed but not editable, and there is no select to change it
    await expect(page.locator('text=ปีการศึกษาที่เข้าศึกษา (Enrollment Year)')).toBeVisible();
    await expect(page.locator('select').filter({ hasText: 'เลือกปีการศึกษา' })).toHaveCount(0);
    await expect(page.locator('input[readonly][value="2568"]')).toBeVisible();

    // 4. Posting the field directly is silently ignored rather than applied.
    //    page.request shares the browser's cookie jar, so it carries the
    //    student's session; the standalone `request` fixture has its own jar.
    const tamper = await page.request.put(`${API_URL}/profile/student`, {
      multipart: {
        student_code: '999999999999-9',
        enrollment_year: '2572',
        first_name: 'สมชาย',
      },
    });
    expect(tamper.status()).toBe(200);

    await withDb(async (db) => {
      const res = await db.query(
        'SELECT student_code, enrollment_year FROM students WHERE student_id = 2'
      );
      expect(res.rows[0].enrollment_year).toBe(2568);
      expect(res.rows[0].student_code).toBe('640101001');
    });

    // 5. Staff can correct it through the registry endpoint
    await apiLoginAs(request, 'staff1');

    const correction = await request.put(`${API_URL}/students/2/registry`, {
      data: { enrollment_year: 2566 },
    });
    expect(correction.status()).toBe(200);

    expect(await dbValue('SELECT enrollment_year FROM students WHERE student_id = 2')).toBe(2566);

    // ...and the correction is recorded in the audit trail (SEC-07).
    // writeAudit is fire-and-forget in the controller, so the row arrives just
    // after the response — reading it once was the source of this test's flake.
    await expect
      .poll(
        () =>
          dbValue<string>(
            "SELECT actor_email FROM audit_log WHERE action = 'student.registry_changed' AND entity_id = '2'"
          ),
        { timeout: 5000 }
      )
      .toBe('staff1@test.com');

    // Logout
    await logout(page);
  });

  test('Personnel can edit and persist birth date in profile', async ({ page }) => {
    await seedTestData();

    // 1. Advisor logs in
    await loginAs(page, 'advisor1');

    // 2. Click Profile
    await goToMenu(page, 'profile');

    // 3. Fill name inputs (สาขาไม่มีให้เลือกแล้ว — แก้เองไม่ได้ตั้งแต่ 2026-09-23 · ดู faculty/personnel-profile)
    await page.getByTestId('personnel-first-name').fill('สมศักดิ์');
    await page.getByTestId('personnel-last-name').fill('ใจดี');

    // 4. Verify birth_date field exists and change it
    const birthDateInput = page.getByTestId('personnel-birth-date');
    await expect(birthDateInput).toBeVisible();
    await birthDateInput.fill('1980-05-15');

    // 5. Click Save
    await page.getByTestId('personnel-profile-save').click();
    await expect(page.getByText('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว')).toBeVisible();

    // 6. Reload and check if persisted (needs to navigate back to profile menu after reload)
    await page.reload();
    await goToMenu(page, 'profile');
    await expect(birthDateInput).toHaveValue('1980-05-15');

    // Logout
    await logout(page);
  });

});
