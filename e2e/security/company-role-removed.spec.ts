import { test, expect, request as playwrightRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { dbExec, dbRow, dbRows, dbValue } from '../helpers/db';

/**
 * บทบาท `company` ถูกลบออกจากระบบ (2026-10-02, migration 042)
 *
 * บริษัทไม่มีบัญชี — ตอบทางลิงก์สาธารณะใช้ครั้งเดียว (`/accept` · `/offer`) เท่านั้น
 * ไฟล์นี้คุมว่า "ประตูที่ปิดไปแล้วต้องไม่เปิดกลับมา":
 *   R1 สร้างบัญชี role company ผ่าน API ไม่ได้ · R2 ฐานไม่รับแถว role 'company' (CHECK)
 *   R3 ผลของ migration 042 กับข้อมูลเก่า · R4 route เดิมตอบ 404
 *   R5 หน้าเข้าสู่ระบบ/เมนูของบริษัทหายไป · R6 ลิงก์สาธารณะยังทำงาน
 *
 * ข้อมูลทั้งหมดเป็นของปลอม · ไม่มีการส่งเมลจริง (`MAIL_DRY_RUN=true`)
 */

const MIGRATION = path.resolve(__dirname, '../../backend/src/db/migrations/042_remove_company_role.sql');

const rolesOf = async (email: string): Promise<string[]> =>
  (
    await dbRows<{ role_name: string }>(
      `SELECT role_name FROM user_roles
        WHERE user_id = (SELECT user_id FROM users WHERE email = $1) ORDER BY role_name`,
      [email]
    )
  ).map((r) => r.role_name);

const userCount = (email: string) =>
  dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [email]);

test.describe('บทบาท company ถูกลบออกแล้ว', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('R1: เจ้าหน้าที่สร้างบัญชี role company ผ่าน POST /users ไม่ได้ (4xx) · ไม่มีแถว users เกิดขึ้น', async ({
    request,
  }) => {
    await apiLoginAs(request, 'staff1');
    const email = 'r1-company@example.com';

    const password = 'Password123!'; // ใส่รหัสผ่านให้ครบ — 4xx ต้องมาจากบทบาท ไม่ใช่ "Password is required"
    for (const body of [
      { email, password, role: 'company' },
      { email, password, roles: ['company'] },
      { email, password, roles: ['student', 'company'] },
    ]) {
      const res = await request.post(`${API_URL}/users`, { data: body });
      expect(res.status(), `${JSON.stringify(body)}: ${await res.text()}`).toBeGreaterThanOrEqual(400);
      expect(res.status(), JSON.stringify(body)).toBeLessThan(500);
    }
    expect(await userCount(email)).toBe('0');

    // ตัวควบคุม: คำขอรูปแบบเดียวกันที่ใช้บทบาทที่ยังมีอยู่ = 201 (4xx ข้างบนมาจากบทบาท ไม่ใช่รูปแบบคำขอ)
    const ok = await request.post(`${API_URL}/users`, { data: { email, password, role: 'staff' } });
    expect(ok.status(), await ok.text()).toBe(201);
  });

  test('R2: ฐานไม่รับแถว user_roles ที่เป็น company (CHECK user_roles_role_name_check)', async () => {
    const email = 'r2-company@example.com';
    await dbExec('INSERT INTO users (email) VALUES ($1)', [email]);

    await expect(
      dbExec(
        `INSERT INTO user_roles (user_id, role_name)
         SELECT user_id, 'company' FROM users WHERE email = $1`,
        [email]
      )
    ).rejects.toThrow(/user_roles_role_name_check/);
    expect(await rolesOf(email)).toEqual([]);

    // ตัวควบคุม: บทบาทที่ยังมีอยู่ใส่ได้ — ข้างบนล้มเพราะ CHECK ไม่ใช่เพราะ SQL ผิด
    await dbExec(
      `INSERT INTO user_roles (user_id, role_name) SELECT user_id, 'mentor' FROM users WHERE email = $1`,
      [email]
    );
    expect(await rolesOf(email)).toEqual(['mentor']);

    await dbExec('DELETE FROM users WHERE email = $1', [email]);
  });

  test('R3: migration 042 — ปิดบัญชี company ล้วน · mentor+company เหลือ mentor และยังใช้งานได้ · CHECK กลับมา', async () => {
    const only = 'r3-company-only@example.com';
    const dual = 'r3-mentor-company@example.com';
    const constraint = 'user_roles_role_name_check';

    // จำลองฐานเก่าก่อน 042 — ถอด CHECK ออกชั่วคราวเพื่อให้ยัดแถว 'company' ได้
    await dbExec(`ALTER TABLE user_roles DROP CONSTRAINT ${constraint}`);
    try {
      await dbExec('INSERT INTO users (email) VALUES ($1), ($2)', [only, dual]);
      await dbExec(
        `INSERT INTO user_roles (user_id, role_name)
         SELECT user_id, 'company' FROM users WHERE email = $1
         UNION ALL SELECT user_id, 'company' FROM users WHERE email = $2
         UNION ALL SELECT user_id, 'mentor'  FROM users WHERE email = $2`,
        [only, dual]
      );
      expect(await rolesOf(only)).toEqual(['company']);
      expect(await rolesOf(dual)).toEqual(['company', 'mentor']);

      await dbExec(fs.readFileSync(MIGRATION, 'utf8'));

      // บัญชี company ล้วน: ปิดบัญชี · ไม่เหลือแถวบทบาท · แถว users ยังอยู่ (ไม่ลบ — FK ของประกาศ/บริษัท)
      expect(await dbValue<boolean>('SELECT is_active FROM users WHERE email = $1', [only])).toBe(false);
      expect(await rolesOf(only)).toEqual([]);
      expect(await userCount(only)).toBe('1');

      // mentor+company: เหลือ mentor อย่างเดียว และยังเปิดบัญชีอยู่
      expect(await rolesOf(dual)).toEqual(['mentor']);
      expect(await dbValue<boolean>('SELECT is_active FROM users WHERE email = $1', [dual])).toBe(true);

      // บัญชีของ seed ไม่ถูกแตะ
      expect(await rolesOf('staff1@test.com')).toEqual(['staff']);
      expect(await dbValue<boolean>("SELECT is_active FROM users WHERE email = 'staff1@test.com'")).toBe(true);

      // CHECK ถูกสร้างใหม่ และปฏิเสธ 'company'
      expect(
        await dbValue<string>(
          `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = $1 AND conrelid = 'user_roles'::regclass`,
          [constraint]
        )
      ).not.toContain('company');
      await expect(
        dbExec(`INSERT INTO user_roles (user_id, role_name) SELECT user_id, 'company' FROM users WHERE email = $1`, [dual])
      ).rejects.toThrow(new RegExp(constraint));

      // รันซ้ำได้ปลอดภัย
      await dbExec(fs.readFileSync(MIGRATION, 'utf8'));
      expect(await rolesOf(dual)).toEqual(['mentor']);
      expect(await dbValue<boolean>('SELECT is_active FROM users WHERE email = $1', [only])).toBe(false);
    } finally {
      await dbExec('DELETE FROM users WHERE email IN ($1, $2)', [only, dual]);
      // ถ้าเทสต์ล้มก่อนรัน migration — คืน CHECK ให้ฐานไม่ค้างอยู่ในสภาพไม่มีด่าน
      const exists = await dbRow(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = 'user_roles'::regclass`,
        [constraint]
      );
      if (!exists) await dbExec(fs.readFileSync(MIGRATION, 'utf8'));
    }
  });

  test('R4: route ของบทบาท company ที่ถอดแล้วตอบ 404 (ไม่ใช่ 403/500)', async ({ request }) => {
    const sid = await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'");
    const mentorId = await dbValue<number>("SELECT user_id FROM users WHERE email = 'mentor1@test.com'");

    await apiLoginAs(request, 'staff1');
    const gone: Array<[string, string, string]> = [
      ['GET', `${API_URL}/companies/my-company`, 'โปรไฟล์บริษัทของฉัน'],
      ['GET', `${API_URL}/form07/print`, 'สหกิจ 07 (พิมพ์)'],
      ['GET', `${API_URL}/form07/mine`, 'สหกิจ 07 (ของฉัน)'],
      ['POST', `${API_URL}/users/${mentorId}/resend-invite`, 'ส่งลิงก์เชิญซ้ำ'],
      ['GET', `${API_URL}/students/${sid}/coop-application/company-view`, 'มุมมองใบสมัครของบริษัท'],
      ['PATCH', `${API_URL}/acceptances/company/1/status`, 'บริษัทตอบรับด้วยบัญชี'],
      ['GET', `${API_URL}/job-offers/current`, 'แบบเสนองานของบริษัท (ปัจจุบัน)'],
      ['GET', `${API_URL}/job-offers/history`, 'แบบเสนองานของบริษัท (ประวัติ)'],
    ];
    for (const [method, url, label] of gone) {
      const res = await request.fetch(url, { method, data: method === 'GET' ? undefined : {} });
      expect(res.status(), `${label}: ${method} ${url} → ${await res.text()}`).toBe(404);
    }
  });

  test('R5: หน้า /login/company ไม่มีแล้ว · เมนูของบริษัทไม่โผล่ให้ใคร', async ({ page }) => {
    // ไม่ล็อกอิน → ตกไปประตูหน้า /login (ไม่ใช่หน้า 404 เปล่า ๆ และไม่ใช่ฟอร์มรหัสผ่านของบริษัท)
    await page.goto('/login/company');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-as-student')).toBeVisible();
    await expect(page.getByTestId('login-as-company')).toHaveCount(0);

    // ล็อกอินแล้วเข้า /login/company ก็ไม่เจอฟอร์มบริษัท
    await loginAs(page, 'staff1');
    await expect(page.getByTestId('nav-form07')).toHaveCount(0);
    await expect(page.getByTestId('nav-company_profile')).toHaveCount(0);
    await page.goto('/login/company');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await loginAs(page, 'mentor1');
    await expect(page.getByTestId('nav-certify')).toBeVisible(); // เมนูพี่เลี้ยงยังอยู่ครบ
    await expect(page.getByTestId('nav-form07')).toHaveCount(0);
    await expect(page.getByTestId('nav-company_profile')).toHaveCount(0);
  });

  test('R6: ลิงก์สาธารณะของบริษัทยังทำงาน — token ที่ไม่รู้จัก = 404 · token จริง = 200 · ไม่ต้องล็อกอิน', async () => {
    const anon = await playwrightRequest.newContext();
    try {
      // ไม่รู้จัก token → 404 (ไม่ใช่ 401 ที่แปลว่าไปติดด่านล็อกอิน หรือ 500)
      const unknown = '00000000-0000-4000-8000-000000000000';
      expect((await anon.get(`${API_URL}/public/acceptance?token=${unknown}`)).status()).toBe(404);
      expect((await anon.get(`${API_URL}/public/job-offer?token=${unknown}`)).status()).toBe(404);

      // token จริงของแบบเสนองาน (สหกิจ 02) → เปิดได้โดยไม่มี cookie — พิสูจน์ว่า 404 ข้างบนมาจาก token ไม่ใช่ route หาย
      const semesterId = await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
      const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
      const offerId = await dbValue<number>(
        `INSERT INTO coop_job_offers (company_id, semester_id, due_date, status)
         VALUES ($1, $2, CURRENT_DATE + 30, 'draft') RETURNING offer_id`,
        [companyId, semesterId]
      );
      const token = 'r6-company-removed-token';
      await dbExec(
        `INSERT INTO job_offer_tokens (token, offer_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [token, offerId]
      );
      const open = await anon.get(`${API_URL}/public/job-offer?token=${token}`);
      expect(open.status(), await open.text()).toBe(200);
    } finally {
      await anon.dispose();
    }
  });
});
