import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { dbValue } from '../helpers/db';

/**
 * ทางที่ error ของใบแก้ G/H-1..6 (`83e1f6a`) — เดิมไม่มี E2E คุมเลย (2026-09-22 เติม)
 *
 * ของที่พังเงียบได้ในหน้าจอเหล่านี้ไม่ใช่ตอนโหลดสำเร็จ แต่คือตอนโหลดพัง:
 * บอกผิดเรื่อง (โปรไฟล์โหลดไม่ได้ ≠ ขาดลายมือชื่อ) หรือแถบ error หายเองในรอบ poll ถัดไป
 */
test.describe('G/H — หน้าจอฝ่ายคณะเมื่อโหลดพัง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('GH1-2: คณบดี — /profile/me พัง ขึ้นข้อความจริง ไม่ขึ้น "ขาดลายมือชื่อ"', async ({ page }) => {
    await page.route('**/api/profile/me', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'โปรไฟล์ล่มทดสอบ' }) })
    );
    await loginAs(page, 'dean1');

    await expect(page.getByText('โปรไฟล์ล่มทดสอบ')).toBeVisible();
    // กล่องความพร้อมลงนามต้องไม่ขึ้นเลย — เดิมขึ้น "ขาดลายมือชื่อ" ทั้งที่แค่โหลดไม่ได้
    await expect(page.getByText('ยังลงนามไม่ได้')).toHaveCount(0);
    await expect(page.getByText('ขาดลายมือชื่อ')).toHaveCount(0);
  });

  test('GH3-5: หัวหน้าสาขา — ติดตามคำร้องโหลดพัง แถบ error ต้องอยู่ข้ามรอบ poll ไม่หายเอง', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/intents', (route) => {
      calls++;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'คำร้องล่มทดสอบ' }) });
    });
    await loginAs(page, 'head1');
    await goToMenu(page, 'approval');

    const banner = page.getByText('คำร้องล่มทดสอบ');
    await expect(banner).toBeVisible();
    // สั่งรอบพื้นหลังเอง (useDashboardData ฟัง `intent-updated` เหมือนรอบ poll 10 วิ) — นับเฉพาะคำขอ
    // ที่เกิด *หลัง* แถบขึ้นแล้ว แล้วรอให้ React เรนเดอร์ผลของรอบนั้นก่อนตรวจ
    const before = calls;
    await page.evaluate(() => window.dispatchEvent(new Event('intent-updated')));
    await expect.poll(() => calls).toBeGreaterThan(before);
    await page.waitForTimeout(1_000);
    await expect(banner).toBeVisible();
  });

  test('GH3-5: หัวหน้าสาขา — หน้าแรกได้ 403 ขึ้นหน้าไม่มีสิทธิ์พร้อมข้อความจาก server', async ({ page }) => {
    await page.route('**/api/faculty/home/dept-head', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'ไม่พบสาขาทดสอบ' }) })
    );
    await loginAs(page, 'head1');

    await expect(page.getByText('ไม่มีสิทธิ์เข้าถึงข้อมูลสาขาวิชา')).toBeVisible();
    await expect(page.getByText('ไม่พบสาขาทดสอบ')).toBeVisible();
  });

  test('GH6: เจ้าหน้าที่ตั้งหัวหน้าสาขาในสาขาที่ยังไม่มีหัวหน้า → บันทึกทันที ไม่มีกล่องยืนยัน · สาขาที่มีหัวหน้าแล้วต้องมีกล่อง', async ({
    page,
  }) => {
    const advisor1 = (await dbValue<number>("SELECT user_id FROM users WHERE email = 'advisor1@test.com'"))!;
    const advisor2 = (await dbValue<number>("SELECT user_id FROM users WHERE email = 'advisor2@test.com'"))!;
    // สมมติฐานของ seeder: head1 อยู่สาขาเดียวกับ advisor1 · สาขาของ advisor2 ไม่มีหัวหน้า
    expect(
      await dbValue<number>(
        `SELECT COUNT(*)::int FROM user_roles r JOIN personnel p ON p.personnel_id = r.user_id
          WHERE r.role_name = 'dept_head' AND p.major_id = (SELECT major_id FROM personnel WHERE personnel_id = $1)`,
        [advisor2]
      )
    ).toBe(0);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');
    const dialog = page.locator('[role="dialog"]');

    // สาขาที่มีหัวหน้าแล้ว — ต้องถามก่อน (ตัวควบคุม: พิสูจน์ว่ากล่องยังทำงาน)
    await page.getByTestId(`user-row-${advisor1}`).getByRole('button', { name: 'แก้ไข' }).click();
    await dialog.getByLabel('หัวหน้าสาขาวิชา').check();
    await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
    await expect(page.getByText('ยืนยันการเปลี่ยนหัวหน้าสาขาวิชา')).toBeVisible();
    await page.getByRole('button', { name: 'ยกเลิก' }).last().click();
    await dialog.getByRole('button', { name: 'ยกเลิก' }).click();

    // สาขาที่ยังไม่มีหัวหน้า — บันทึกทันที
    await page.getByTestId(`user-row-${advisor2}`).getByRole('button', { name: 'แก้ไข' }).click();
    await dialog.getByLabel('หัวหน้าสาขาวิชา').check();
    await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
    await expect(page.getByText('อัปเดตข้อมูลบัญชี advisor2@test.com เรียบร้อยแล้ว')).toBeVisible();
    await expect(page.getByText('ยืนยันการเปลี่ยนหัวหน้าสาขาวิชา')).toHaveCount(0);
    expect(
      await dbValue<number>(
        "SELECT COUNT(*)::int FROM user_roles WHERE user_id = $1 AND role_name = 'dept_head'",
        [advisor2]
      )
    ).toBe(1);
  });
});
