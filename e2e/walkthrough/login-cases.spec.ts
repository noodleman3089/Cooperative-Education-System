import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { attemptLogin, loginAs, DEFAULT_PASSWORD } from '../helpers/auth';
import { logout } from '../helpers/nav';
import { dbExec } from '../helpers/db';
import { createWalk } from '../helpers/walkthrough';

/**
 * Walkthrough: หน้าเข้าสู่ระบบทุกแบบ (ไม่ใช่เทสต์ในชุดเต็ม)
 *
 * หน้าเลือกสถานะ → นักศึกษา (สำเร็จ · รหัสผ่านผิด) → บุคลากร → พี่เลี้ยง (ขอลิงก์ · ลิงก์ใช้ไม่ได้ · ลิงก์ใช้ได้)
 * → ลืมรหัสผ่าน → เปิดหน้าในระบบโดยยังไม่ล็อกอิน → ออกจากระบบ
 *
 * ทางลัดมีที่เดียว และบอกไว้ใน caption: ลิงก์เข้าระบบของพี่เลี้ยงถูกสร้างตรงในฐาน —
 * ในโลกจริงอยู่ในอีเมลที่ระบบส่ง (MAIL_DRY_RUN จึงไม่มีเมลออกจริง)
 *
 * ผลลัพธ์: `เอกสาร/walkthrough/login-cases/index.html` (+ ภาพ NN.png)
 * ⛔ ข้อมูลทั้งหมดเป็นของปลอม · รีเซ็ตฐานเหมือน E2E ทุกครั้งที่รัน
 */


test.describe('walkthrough: หน้าเข้าสู่ระบบ', () => {
  test('login-cases', async ({ page }) => {
    test.setTimeout(300_000);
    const walk = createWalk('login-cases', 'หน้าเข้าสู่ระบบทุกแบบ — นักศึกษา · บุคลากร · พี่เลี้ยง');
    walk.watch(page);

    const loginResponse = () =>
      page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST');

    try {
      await seedTestData();
      // ชุด E2E baseline ไม่ให้ staff1 มีโปรไฟล์โดยตั้งใจ — ภาพ walkthrough ต้องเหมือนเจ้าหน้าที่จริง (ไม่มี 404 จาก /profile/me)
      // SQL เดียวกับ `placement-journey.spec.ts`
      await dbExec(
        `INSERT INTO personnel (personnel_id, major_id, status, first_name, last_name)
         SELECT user_id, (SELECT major_id FROM master_major LIMIT 1), 'approved', 'สมใจ', 'เจ้าหน้าที่ดี'
           FROM users WHERE email = 'staff1@test.com'
         ON CONFLICT (personnel_id) DO NOTHING`
      );
      await page.request.post(`${API_URL}/auth/logout`);

      // ───────── หน้าเลือกสถานะ ─────────
      await page.goto('/login');
      await expect(page.getByTestId('login-as-student')).toBeVisible();
      await walk.step(page, 'ทุกคน', 'หน้าแรกของการเข้าสู่ระบบ — เลือกว่าเป็นนักศึกษา หรืออาจารย์/เจ้าหน้าที่ (ไม่มีปุ่มของพี่เลี้ยง พี่เลี้ยงเข้าจากลิงก์ในอีเมล)');

      // ───────── นักศึกษา ─────────
      await page.getByTestId('login-as-student').click();
      await expect(page).toHaveURL(/\/login\/student/);
      await walk.step(page, 'นักศึกษา', 'หน้าเข้าสู่ระบบของนักศึกษา');

      // หน้าล็อกอินเปิดมาที่แท็บบัญชีมหาวิทยาลัย — ฟอร์มอีเมล/รหัสผ่านอยู่อีกแท็บ (แบบเดียวกับ `attemptLogin`)
      const studentPwdTab = page.locator('button:has-text("รหัสผ่านเฉพาะระบบ")');
      if (await studentPwdTab.isVisible({ timeout: 1500 }).catch(() => false)) {
        await studentPwdTab.click();
        await walk.step(page, 'นักศึกษา', 'เลือกแท็บ "รหัสผ่านเฉพาะระบบ" — ฟอร์มอีเมลและรหัสผ่าน');
      }

      await page.locator('input[type="text"]').first().fill('student2@test.com', { timeout: 15_000 });
      await page.locator('input[type="password"]').fill('wrong-password');
      await walk.step(page, 'นักศึกษา', 'กรอกอีเมลและรหัสผ่าน (รหัสผ่านในภาพนี้ผิดโดยตั้งใจ)');

      const wrong = loginResponse();
      await page.click('button[type="submit"]');
      expect((await wrong).status()).toBe(401);
      await walk.step(page, 'นักศึกษา', 'รหัสผ่านผิด — ระบบแจ้งข้อผิดพลาดและอยู่หน้าเดิม');

      await page.locator('input[type="password"]').fill(DEFAULT_PASSWORD);
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/\/dashboard/);
      await walk.step(page, 'นักศึกษา', 'รหัสผ่านถูก — เข้าหน้าแรกของนักศึกษา');

      await logout(page);
      await walk.step(page, 'นักศึกษา', 'กดออกจากระบบ — หน้าที่ระบบพากลับมา');

      // ───────── บุคลากร (อาจารย์ · หัวหน้าสาขา · เจ้าหน้าที่ · คณบดี ใช้หน้าเดียวกัน) ─────────
      await page.goto('/login');
      await page.getByTestId('login-as-personnel').click();
      await expect(page).toHaveURL(/\/login\/personnel/);
      await walk.step(page, 'บุคลากร', 'หน้าเข้าสู่ระบบของบุคลากร — อาจารย์ หัวหน้าสาขา เจ้าหน้าที่ และคณบดีใช้หน้านี้');

      const pwdTab = page.locator('button:has-text("รหัสผ่านเฉพาะระบบ")');
      if (await pwdTab.isVisible({ timeout: 1500 }).catch(() => false)) {
        await pwdTab.click();
        await walk.step(page, 'บุคลากร', 'เลือกแท็บ "รหัสผ่านเฉพาะระบบ"');
      }

      await loginAs(page, 'staff1');
      await walk.step(page, 'บุคลากร', 'เจ้าหน้าที่เข้าสู่ระบบสำเร็จ — หน้าแรกของเจ้าหน้าที่');
      await logout(page);

      // ───────── พี่เลี้ยง: ไม่มีรหัสผ่าน เข้าด้วยลิงก์ในอีเมล ─────────
      await page.goto('/login/mentor');
      await expect(page.getByTestId('login-mentor-form')).toBeVisible();
      await walk.step(page, 'พี่เลี้ยง', 'หน้าเข้าสู่ระบบของพี่เลี้ยง — ไม่มีช่องรหัสผ่าน กรอกอีเมลเพื่อขอลิงก์');

      await page.getByTestId('login-mentor-email').fill('mentor1@test.com');
      const requested = page.waitForResponse((r) => r.url().includes('/auth/mentor-link/request'));
      await page.getByTestId('login-mentor-submit').click();
      await requested;
      await walk.step(page, 'พี่เลี้ยง', 'กดขอลิงก์ — ระบบแจ้งว่าส่งลิงก์ไปที่อีเมลแล้ว (ข้อความเดียวกันไม่ว่าอีเมลจะมีในระบบหรือไม่)');

      const consumed = page.waitForResponse((r) => r.url().includes('/auth/mentor-link/consume'));
      await page.goto(`/m?token=${crypto.randomUUID()}`);
      await consumed;
      await walk.step(page, 'พี่เลี้ยง', 'เปิดลิงก์ที่ใช้ไม่ได้ (หมดอายุ ใช้ไปแล้ว หรือไม่มีอยู่จริง) — ระบบปฏิเสธ');

      await attemptLogin(page, 'mentor1');
      await expect(page).toHaveURL(/\/dashboard/);
      await walk.step(page, 'พี่เลี้ยง', 'เปิดลิงก์ที่ใช้ได้ — เข้าหน้าแรกของพี่เลี้ยงทันที (ทางลัด: ลิงก์ถูกสร้างตรงในฐาน ของจริงอยู่ในอีเมล)');
      await logout(page);

      // ───────── ลืมรหัสผ่าน ─────────
      await page.goto('/forgot-password');
      await walk.step(page, 'นักศึกษา · บุคลากร', 'หน้าลืมรหัสผ่าน');

      // ───────── ยังไม่ล็อกอินแล้วเปิดหน้าในระบบ ─────────
      await page.request.post(`${API_URL}/auth/logout`);
      await page.goto('/dashboard');
      await page.waitForURL((u) => !u.pathname.startsWith('/dashboard'), { timeout: 10_000 }).catch(() => {});
      await walk.step(page, 'ทุกคน', 'เปิดหน้าในระบบโดยยังไม่ได้เข้าสู่ระบบ — หน้าที่ระบบพาไป');
    } finally {
      await walk.finish();
    }
  });
});
