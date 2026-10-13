import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { seedTestData } from '../helpers/test-seeder';

/**
 * ปุ่ม "ลงชื่อเข้าใช้ด้วย Google" มาจากสคริปต์ของ Google เอง — เครือข่ายที่บล็อก Google
 * หรือเน็ตหลุด = ปุ่มไม่ขึ้น หน้าล็อกอินต้องบอกสาเหตุและเปิดทางไปแท็บรหัสผ่าน ไม่ใช่เว้นที่ว่างเงียบ ๆ
 */
test.describe('หน้าเข้าสู่ระบบ — สคริปต์ Google โหลดไม่ได้', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await page.route('**/accounts.google.com/gsi/client', (route) => route.abort());
    await seedTestData();
  });

  test('G1: บอกสาเหตุ มีปุ่มโหลดหน้าใหม่ และลิงก์ในแถบเตือนพาไปแท็บรหัสผ่าน', async ({ page }) => {
    await page.goto('/login/student');

    const banner = page.getByTestId('google-signin-failed');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('โหลดปุ่มเข้าสู่ระบบด้วย Google ไม่ได้');
    await expect(banner.getByRole('button', { name: 'โหลดหน้าใหม่' })).toBeVisible();

    await banner.getByRole('button', { name: 'รหัสผ่านเฉพาะระบบ' }).click();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(banner).toBeHidden();
  });

  test('G2: ผู้ที่ตั้งรหัสผ่านไว้แล้วยังเข้าระบบด้วยแท็บรหัสผ่านได้ตามปกติ', async ({ page }) => {
    // ⛔ แถบเตือนมีปุ่มชื่อเดียวกับแท็บ "รหัสผ่านเฉพาะระบบ" — ตัวช่วยล็อกอินของเทสต์ต้องไม่สับสนระหว่างสองปุ่ม
    //    ไม่งั้นทั้งชุดเทสต์จะล็อกอินไม่ได้ทุกครั้งที่เครื่องรันเทสต์ต่อ Google ไม่ติด
    await loginAs(page, 'student2');
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
