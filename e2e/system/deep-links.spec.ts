import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { APP_URL } from '../helpers/env';

/**
 * หน้าจอทุกหน้ามี URL ของตัวเอง (`/dashboard?menu=<id>`)
 *
 * ก่อน 2026-09-07 ทั้งแอปหลังล็อกอินอยู่ที่ `/dashboard` อันเดียว แล้วเมนูเก็บอยู่ใน
 * `useState` ของ `Dashboard.tsx` แปลว่า **กด F5 กลางงานเด้งกลับหน้าแรกทุกครั้ง**
 * ปุ่ม Back ของเบราว์เซอร์พาออกจากแอป และบุ๊กมาร์ก/ส่งลิงก์หน้าที่ทำค้างไม่ได้เลย
 *
 * ไฟล์นี้คุมสามอย่าง เรียงจากที่พังแล้วเจ็บที่สุด:
 *   1. เปิด URL ตรงๆ แล้วได้หน้าจอที่ถูก (= เคส F5 และเคสลิงก์จากอีเมล)
 *   2. ปุ่ม Back ย้อนเมนู ไม่ใช่ออกจากแอป
 *   3. ⛔ **URL ไม่ใช่ด่านสิทธิ์** — นักศึกษาพิมพ์ `?menu=users` เองต้องไม่เห็นหน้าเจ้าหน้าที่
 *      ข้อนี้สำคัญที่สุด เพราะการทำให้เมนูอยู่บน URL คือการเปิดทางให้ "เดา" ที่เมื่อก่อนไม่มี
 */
test.describe('Deep links — ทุกหน้าจอมี URL ของตัวเอง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");',
      });
    });
  });

  test('Test 1: เดินเมนูแล้ว URL เปลี่ยนตาม และ Back ย้อนเมนูได้', async ({ page }) => {
    await seedTestData();
    await loginAs(page, 'staff1');

    // หน้าแรกต้องไม่มีพารามิเตอร์ค้าง — `/dashboard` เปล่าๆ ยังเป็น URL ของหน้าแรก
    expect(new URL(page.url()).searchParams.get('menu')).toBeNull();

    await goToMenu(page, 'companies');
    expect(new URL(page.url()).searchParams.get('menu')).toBe('companies');
    await expect(page.getByRole('heading', { name: 'ทำเนียบสถานประกอบการ' })).toBeVisible();

    await goToMenu(page, 'calendar');
    expect(new URL(page.url()).searchParams.get('menu')).toBe('calendar');

    // Back ต้องย้อนกลับไปหน้าก่อนหน้า ไม่ใช่ออกจากแอป
    await page.goBack();
    expect(new URL(page.url()).searchParams.get('menu')).toBe('companies');
    await expect(page.getByRole('heading', { name: 'ทำเนียบสถานประกอบการ' })).toBeVisible();
  });

  test('Test 2: เปิด URL ตรงๆ แล้วได้หน้าจอที่ถูก (เคส F5 และลิงก์จากอีเมล)', async ({ page }) => {
    await seedTestData();
    await loginAs(page, 'staff1');

    // โหลดหน้าใหม่ทั้งหน้าที่ URL ลึก — เหมือนผู้ใช้กด F5 หรือคลิกลิงก์ที่บุ๊กมาร์กไว้
    await page.goto(`${APP_URL}/dashboard?menu=companies`);
    await page
      .getByTestId('screen-loading')
      .waitFor({ state: 'detached', timeout: 10_000 })
      .catch(() => {});

    await expect(page.getByRole('heading', { name: 'ทำเนียบสถานประกอบการ' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('menu')).toBe('companies');
  });

  test('Test 3: URL ไม่ใช่ด่านสิทธิ์ — นักศึกษาพิมพ์ ?menu=users เองต้องไม่เห็นหน้าเจ้าหน้าที่', async ({
    page,
  }) => {
    await seedTestData();
    await loginAs(page, 'student1');

    await page.goto(`${APP_URL}/dashboard?menu=users`);
    await page
      .getByTestId('screen-loading')
      .waitFor({ state: 'detached', timeout: 10_000 })
      .catch(() => {});

    // เมนูของเจ้าหน้าที่ต้องไม่มีอยู่ในแถบข้างของนักศึกษาเลย
    await expect(page.getByTestId('nav-users')).toHaveCount(0);
    await expect(page.getByTestId('nav-import')).toHaveCount(0);
    await expect(page.getByTestId('nav-companies')).toHaveCount(0);

    // และเนื้อหาบนจอต้องเป็นของนักศึกษา ไม่ใช่หน้าจัดการบัญชีผู้ใช้
    await expect(page.getByTestId('nav-weekly_log')).toBeVisible();
    await expect(page.getByText('จัดการสิทธิ์ & บัญชีผู้ใช้')).toHaveCount(0);
  });

  /**
   * ⛔ `?role=` ก็ไม่ใช่ด่านสิทธิ์เช่นกัน และต้องตรวจกับฝ่ายที่ผู้ใช้มีจริง (สเปก F ข้อ 1.1)
   * เคยหลุดตอนทำระบบสองฝ่าย: โค้ดคืนค่า `?role=` ดิบ ๆ ใครพิมพ์อะไรก็ได้หน้าจอบทบาทนั้น
   */
  test('Test 4: ?role= ที่ผู้ใช้ไม่ได้ถือ ต้องตกกลับเป็นฝ่ายของตัวเอง', async ({ page }) => {
    await seedTestData();
    await loginAs(page, 'student1');

    await page.goto(`${APP_URL}/dashboard?role=staff`);
    await page
      .getByTestId('screen-loading')
      .waitFor({ state: 'detached', timeout: 10_000 })
      .catch(() => {});

    await expect(page.getByTestId('nav-users')).toHaveCount(0);
    await expect(page.getByTestId('nav-calendar')).toHaveCount(0);
    await expect(page.getByTestId('nav-weekly_log')).toBeVisible();
  });

  /**
   * ⛔ id เมนูที่หลายบทบาทใช้ร่วมกัน (`memos` ของนักศึกษา · `report_outlines` ของพี่เลี้ยง)
   * ห้ามพาไปฝ่ายอาจารย์ · เคยพังทั้งสองจอพร้อมกันตอนทำระบบสองฝ่าย
   */
  test('Test 5: นักศึกษาเปิด ?menu=memos ต้องได้จอบันทึกข้อความของตัวเอง ไม่ใช่จอฝ่ายอาจารย์', async ({
    page,
  }) => {
    await seedTestData();
    await loginAs(page, 'student2');

    await page.goto(`${APP_URL}/dashboard?menu=memos`);
    await page
      .getByTestId('screen-loading')
      .waitFor({ state: 'detached', timeout: 10_000 })
      .catch(() => {});

    await expect(page.getByRole('heading', { name: 'บันทึกข้อความถึงคณบดี' })).toBeVisible();
    await expect(page.getByTestId('faculty-view-empty')).toHaveCount(0);
  });

  /**
   * `/staff/final-progress` เคยเปิดให้คณบดี แต่ API `GET /coop-progress/dashboard` ไม่ให้ dean
   * → คณบดีได้หน้าว่าง 403 · ตัด dean ออกจาก route (เจ้าของตัดสิน 2026-09-22)
   * ถ้าวันหนึ่งจะให้คณบดีเห็น ต้องเปิด API + ขอบเขตทั้งคณะก่อน แล้วแก้เคสนี้
   */
  test('Test 6: /staff/final-progress — เจ้าหน้าที่เปิดได้ · คณบดีถูกส่งกลับ /dashboard', async ({ page }) => {
    await seedTestData();
    await loginAs(page, 'staff1');
    await page.goto(`${APP_URL}/staff/final-progress`);
    await expect(page.getByRole('heading', { name: 'กระดานติดตามสถานะและผลการประเมิน' })).toBeVisible();

    await page.context().clearCookies();
    await loginAs(page, 'dean1');
    await page.goto(`${APP_URL}/staff/final-progress`);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'กระดานติดตามสถานะและผลการประเมิน' })).toHaveCount(0);
  });
});
