import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import path from 'path';
import fs from 'fs';
import pool from '../../backend/src/config/database';
import { hashPassword } from '../../backend/src/utils/password';
import { API_URL } from '../helpers/env';
import { withDb } from '../helpers/db';
import { loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';

/**
 * A first-time SSO arrival is an account that exists but holds no role yet.
 * The session is an httpOnly cookie now, so the test can no longer fake one by
 * writing localStorage — it creates the account for real and logs in through
 * the API, which puts the cookie into the browser context page.request shares.
 */
async function loginAsRolelessUser(page: import('@playwright/test').Page, email: string) {
  const client = await pool.connect();
  let userId: number;
  try {
    const hash = await hashPassword('password123');
    userId = (await client.query(
      `INSERT INTO users (email, password_hash, is_active) VALUES ($1, $2, TRUE)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE
       RETURNING user_id`,
      [email, hash]
    )).rows[0].user_id;
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  } finally {
    client.release();
  }

  await page.goto('/');
  const res = await page.request.post(`${API_URL}/auth/login`, {
    data: { email, password: 'password123' },
  });
  expect(res.status()).toBe(200);

  // isFirstTime is an onboarding flag the frontend caches, not part of the session.
  await page.evaluate(({ id, mail }) => {
    localStorage.setItem('onboarding_type', 'personnel');
    localStorage.setItem('auth_user', JSON.stringify({
      userId: id,
      email: mail,
      roles: [],
      isFirstTime: true,
    }));
  }, { id: userId, mail: email });
}

test.describe('Personnel Onboarding via CSV Import and Manual Add (Experimental)', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept Google Maps to prevent external calls
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps");'
      });
    });
  });

  test('Staff can import personnel CSV and new user can claim profile', async ({ page }) => {
    await seedTestData();

    // 1. Staff logs in
    await loginAs(page, 'staff1');

    // 2. Click User Management sidebar tab
    await goToMenu(page, 'users');

    // 3. Switch to Pre-seed sub-tab
    //    หน้าจอถูกรื้อรอบฝ่ายเจ้าหน้าที่ (2026-09-10) ป้ายแท็บเปลี่ยนจาก
    //    "เตรียมรายชื่อบุคลากรล่วงหน้า" เป็น "บุคลากรตั้งต้น" ตาม spec-E ข้อ 10
    //    → คลิกด้วย testid ที่สเปกกำหนดไว้ ไม่ใช่ข้อความป้ายซึ่งเป็นของที่เปลี่ยนได้
    await page.locator('[data-testid="users-tab-preseed"]').click();
    await expect(page.locator('text=รายชื่อบุคลากรตั้งต้น (Preseed Personnel)')).toBeVisible();
    await page.locator('button:has-text("นำเข้า CSV")').click();

    // 4. Prepare mock CSV
    //    ⛔ ตัวอ่านฝั่งเซิร์ฟเวอร์อ่าน **ตามตำแหน่งคอลัมน์** ไม่ได้อ่านจากชื่อหัวตาราง
    //       (controllers/personnelImport.ts — split(',') แล้วหยิบ parts[0..5])
    //       ลำดับคือ employee_code, role_name, major_id, first_name, last_name, email
    //       สลับลำดับเมื่อไหร่ แถวถูกข้ามเงียบ ๆ — หน้าจอเคยเขียนลำดับผิดมาแล้วรอบหนึ่ง
    const csvContent = `employee_code,role_name,major_id,first_name,last_name\nEMP1001,advisor,1,อาจารย์สมรัก,รักสอน\nEMP1002,dean,,คณบดีใจดี,มีเมตตา`;
    const fixturesDir = path.join(process.cwd(), 'e2e', 'fixtures');
    const csvPath = path.join(fixturesDir, 'mock_personnel.csv');
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    fs.writeFileSync(csvPath, csvContent);

    // 5. Upload CSV
    await page.locator('input[type="file"]').setInputFiles(csvPath);

    // 6. Verify upload results
    //    ⛔ assert **ตัวเลขที่เข้าฐานจริง** ไม่ใช่แค่คำว่าสำเร็จ — ตัวอ่าน CSV ข้ามแถว
    //       ที่รูปแบบไม่ตรงแบบเงียบ ๆ ป้ายที่บอกแค่ว่าสำเร็จจึงผ่านได้ทั้งที่ไม่มีแถวไหนเข้าเลย
    await expect(page.locator('text=เพิ่มใหม่ 2 คน')).toBeVisible();
    await expect(page.locator('text=ตกไป 0 แถว')).toBeVisible();
    
    // 7. Verify DB has the imported rows
    await withDb(async (db) => {
      const res = await db.query('SELECT * FROM personnel_preseed_list WHERE employee_code = $1', ['EMP1001']);
      expect(res.rowCount).toBe(1);
      expect(res.rows[0].first_name).toBe('อาจารย์สมรัก');
      expect(res.rows[0].is_claimed).toBe(false);
    });

    // 8. Go back to dashboard to Logout Staff safely
    await page.goto('/dashboard');
    await logout(page);

    // 9. Test Claim Profile Flow via Onboarding Page
    
    await page.route('**/api/auth/claim-personnel', async route => {
      const req = route.request();
      const postData = JSON.parse(req.postData() || '{}');
      expect(postData.employee_code).toBe('EMP1001');
      
      // Fulfill with success mock
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'ยืนยันตัวตนสำเร็จ',
          token: 'mock_token',
          user: { userId: 999, email: 'somruk@test.com', roles: ['advisor'] }
        })
      });
    });

    await loginAsRolelessUser(page, 'somruk@test.com');

    // 10. Go to onboarding
    await page.goto('/onboarding/personnel');
    await expect(page.locator('text=ข้อมูลเริ่มต้นใช้งานสำหรับบุคลากร')).toBeVisible();

    // 12. Fill Employee Code and submit
    await page.locator('input[placeholder="กรอกรหัสประจำตัวบุคลากรของคุณ"]').fill('EMP1001');
    await page.locator('button:has-text("ยืนยันตัวตน")').click();

    // 13. Verify redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('Staff can manually add personnel and new user can claim profile', async ({ page }) => {
    await seedTestData();

    // 1. Staff logs in
    await loginAs(page, 'staff1');

    // 2. Click User Management sidebar tab
    await goToMenu(page, 'users');

    // 3. Switch to Pre-seed sub-tab (เหตุผลที่ใช้ testid อยู่ในเคสบน)
    await page.locator('[data-testid="users-tab-preseed"]').click();
    await expect(page.locator('text=รายชื่อบุคลากรตั้งต้น (Preseed Personnel)')).toBeVisible();

    // 4. Switch to Manual Add Tab
    await page.locator('button:has-text("เพิ่มรายคน")').click();

    // 5. Fill form — ยิงที่ id ของช่อง ไม่ใช่ลำดับ nth() ซึ่งพังทุกครั้งที่มีคนสลับช่อง
    await page.locator('#preseed-code').fill('EMP2002');
    await page.locator('#preseed-fname').fill('อาจารย์สมศักดิ์');
    await page.locator('#preseed-lname').fill('รักดี');
    await page.locator('#preseed-role').selectOption('advisor');
    // ป้ายตัวเลือกคือ "<ชื่อสาขา> (<รหัส>)" · IT01 มาจาก seeds.sql จึงคงที่ทุกรอบ
    await page.locator('#preseed-major').selectOption({ label: 'สาขาวิชาเทคโนโลยีสารสนเทศ (IT01)' });
    // SEC-01: the code must be bound to the account email that will claim it.
    await page.locator('#preseed-email').fill('somsak@test.com');

    // 6. Submit form
    await page.locator('button:has-text("เพิ่มบุคลากรตั้งต้น")').click();

    // 7. Verify success message
    await expect(
      page.locator('text=เพิ่มข้อมูลบุคลากรตั้งต้น อาจารย์สมศักดิ์ รักดี เรียบร้อยแล้ว')
    ).toBeVisible();

    // 8. Verify DB has the manually added row
    await withDb(async (db) => {
      const res = await db.query('SELECT * FROM personnel_preseed_list WHERE employee_code = $1', ['EMP2002']);
      expect(res.rowCount).toBe(1);
      expect(res.rows[0].first_name).toBe('อาจารย์สมศักดิ์');
      expect(res.rows[0].email).toBe('somsak@test.com');
      expect(res.rows[0].is_claimed).toBe(false);
    });

    // 9. Go back to dashboard to Logout Staff safely
    await page.goto('/dashboard');
    await logout(page);

    // 10. Test Claim Profile Flow for Manually Added User
    await page.route('**/api/auth/claim-personnel', async route => {
      const req = route.request();
      const postData = JSON.parse(req.postData() || '{}');
      expect(postData.employee_code).toBe('EMP2002');
      
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'ยืนยันตัวตนสำเร็จ',
          token: 'mock_token_2',
          user: { userId: 888, email: 'somsak@test.com', roles: ['advisor'] }
        })
      });
    });

    await loginAsRolelessUser(page, 'somsak@test.com');

    await page.goto('/onboarding/personnel');
    await expect(page.locator('text=ข้อมูลเริ่มต้นใช้งานสำหรับบุคลากร')).toBeVisible();

    await page.locator('input[placeholder="กรอกรหัสประจำตัวบุคลากรของคุณ"]').fill('EMP2002');
    await page.locator('button:has-text("ยืนยันตัวตน")').click();

    await expect(page).toHaveURL(/\/dashboard/);
  });
  /**
   * ลบรหัสบุคลากรตั้งต้น
   *
   * ⛔ ความสามารถนี้มีมาแต่เดิมแล้วหายไปตอนแตกไฟล์ `StaffDashboard.tsx` (2026-09-10)
   *    — ไม่มีเทสต์คุมไว้ มันจึงหายไปเงียบ ๆ โดยไม่มีอะไรแดง · เคสนี้คือด่านนั้น
   * ⛔ แถวที่ผูกบัญชีไปแล้วลบไม่ได้ (เซิร์ฟเวอร์ตอบ 400) หน้าจอต้อง **ไม่แสดงปุ่ม**
   *    ห้ามแสดงปุ่มที่กดแล้วได้ error
   */
  test('Staff can delete an unclaimed preseed code, but not a claimed one', async ({ page }) => {
    await seedTestData();

    await withDb(async (db) => {
      await db.query(
        `INSERT INTO personnel_preseed_list (employee_code, role_name, major_id, first_name, last_name, email, is_claimed)
         VALUES ('EMP3001', 'advisor', (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1),
                 'ลบได้', 'ยังไม่ผูกบัญชี', 'del1@test.com', FALSE),
                ('EMP3002', 'advisor', (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1),
                 'ลบไม่ได้', 'ผูกบัญชีแล้ว', 'del2@test.com', TRUE)
         ON CONFLICT (employee_code) DO NOTHING`
      );
    });

    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');
    await page.locator('[data-testid="users-tab-preseed"]').click();
    await expect(page.locator('text=รายชื่อบุคลากรตั้งต้น (Preseed Personnel)')).toBeVisible();

    // แถวที่ผูกบัญชีแล้วต้องไม่มีปุ่มลบให้กดเลย
    await expect(page.locator('[data-testid="preseed-delete-EMP3002"]')).toHaveCount(0);

    await page.locator('[data-testid="preseed-delete-EMP3001"]').click();
    await expect(page.locator('text=ลบรหัสบุคลากรตั้งต้น')).toBeVisible();
    await page.locator('[data-testid="preseed-delete-confirm"]').click();

    await expect(page.locator('text=ลบรหัสบุคลากรตั้งต้น EMP3001 ออกจากรายชื่อแล้ว')).toBeVisible();

    await withDb(async (db) => {
      const gone = await db.query(
        'SELECT 1 FROM personnel_preseed_list WHERE employee_code = $1', ['EMP3001']
      );
      expect(gone.rowCount).toBe(0);
      const kept = await db.query(
        'SELECT 1 FROM personnel_preseed_list WHERE employee_code = $1', ['EMP3002']
      );
      expect(kept.rowCount).toBe(1);
    });
  });
});
