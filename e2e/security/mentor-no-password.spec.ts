import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbRows, dbValue } from '../helpers/db';
import { apiLoginAs, ACCOUNTS, DEFAULT_PASSWORD } from '../helpers/auth';

/**
 * SEC-15 — พี่เลี้ยงไม่มีรหัสผ่านเลย (2026-10-02) เข้าด้วยลิงก์อีเมลครั้งเดียวเท่านั้น
 *
 * ด่านสิทธิ์ทั้งหมดต้องปิด "ประตูรหัสผ่าน" ของบัญชีพี่เลี้ยงล้วนแม้ในฐานจะมี hash ค้างอยู่
 * (ข้อมูลเก่า / ใครยัดมา) · บัญชีอื่น (นักศึกษา · บุคลากร · เจ้าหน้าที่ · mentor+บทบาทอื่น) ต้องไม่เปลี่ยน
 *
 * N1 login ด้วยรหัสผ่าน · N2 set-password · N3 forgot-password · N4 reset-password
 * N5 เจ้าหน้าที่สร้างบัญชี mentor ด้วยมือ · N6 เติมบทบาท mentor ให้บัญชีอื่น · N7 resend-invite
 * N8 ผลของ migration 041 (ล้าง hash เฉพาะพี่เลี้ยงล้วน)
 *
 * ข้อมูลทั้งหมดเป็นของปลอม · ไม่มีการส่งเมลจริง (`MAIL_DRY_RUN=true`)
 */

const MENTOR1 = ACCOUNTS.mentor1.email;
const FORGOT_OK = { message: 'หากอีเมลนี้มีอยู่ในระบบ เราจะส่งลิงก์รีเซ็ตรหัสผ่านให้ท่านทางอีเมล' };
const MIGRATION = path.resolve(__dirname, '../../backend/src/db/migrations/041_mentor_link_only.sql');

const userRow = (email: string) =>
  dbRow<{ user_id: number; has_hash: boolean; has_reset: boolean }>(
    `SELECT user_id, (password_hash IS NOT NULL) AS has_hash,
            (reset_token IS NOT NULL OR reset_token_expires IS NOT NULL) AS has_reset
       FROM users WHERE email = $1`,
    [email]
  );

const rolesOf = async (email: string): Promise<string[]> =>
  (
    await dbRows<{ role_name: string }>(
      `SELECT role_name FROM user_roles
        WHERE user_id = (SELECT user_id FROM users WHERE email = $1) ORDER BY role_name`,
      [email]
    )
  ).map((r) => r.role_name);

/** ให้บัญชีนั้นมีรหัสผ่านค้างอยู่ (ยืม hash ของ student1 — password123) — จำลองข้อมูลเก่า */
const giveHash = (email: string) =>
  dbExec(
    `UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE email = 'student1@test.com')
      WHERE email = $1`,
    [email]
  );

test.describe('SEC-15: พี่เลี้ยงไม่มีรหัสผ่าน — ด่านสิทธิ์และผลข้างเคียง', () => {
  let anon: APIRequestContext;

  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    anon = await playwrightRequest.newContext();
  });

  test.afterEach(async () => {
    await anon.dispose();
  });

  test('N1: พี่เลี้ยงล้วนที่มี hash ค้างในฐาน เข้าด้วยรหัสผ่านไม่ได้ (403 ไม่มี cookie) · นักศึกษา/เจ้าหน้าที่ยังเข้าได้', async () => {
    // seed ใหม่ = ไม่มีรหัสผ่านอยู่แล้ว
    expect((await userRow(MENTOR1))!.has_hash).toBe(false);

    await giveHash(MENTOR1);
    expect((await userRow(MENTOR1))!.has_hash).toBe(true);

    const res = await anon.post(`${API_URL}/auth/login`, { data: { email: MENTOR1, password: DEFAULT_PASSWORD } });
    expect(res.status(), await res.text()).toBe(403);
    expect((await res.json()).message).toMatch(/^พี่เลี้ยงเข้าสู่ระบบด้วยลิงก์/);
    expect(res.headers()['set-cookie']).toBeUndefined();
    expect((await anon.get(`${API_URL}/auth/me`)).status()).toBe(401);

    // ตัวควบคุม: คำขอเดียวกันของบัญชีอื่น = 200 (403 ข้างบนมาจากบทบาท ไม่ใช่รหัสผ่านผิด)
    for (const key of ['student1', 'staff1'] as const) {
      const ctx = await playwrightRequest.newContext();
      try {
        const ok = await ctx.post(`${API_URL}/auth/login`, {
          data: { email: ACCOUNTS[key].email, password: DEFAULT_PASSWORD },
        });
        expect(ok.status(), `${key}: ${await ok.text()}`).toBe(200);
        expect((await ctx.get(`${API_URL}/auth/me`)).status(), key).toBe(200);
      } finally {
        await ctx.dispose();
      }
    }
  });

  test('N2: พี่เลี้ยงที่เข้าด้วยลิงก์แล้ว ตั้งรหัสผ่านไม่ได้ (403) · password_hash ยัง NULL', async ({ request }) => {
    await apiLoginAs(request, 'mentor1');
    expect((await request.get(`${API_URL}/auth/me`)).status()).toBe(200);

    const res = await request.post(`${API_URL}/auth/set-password`, {
      data: { password: 'NewPassw0rd!x', confirmPassword: 'NewPassw0rd!x' },
    });
    expect(res.status(), await res.text()).toBe(403);
    expect((await userRow(MENTOR1))!.has_hash).toBe(false);

    // ตัวควบคุม: บัญชีอื่นเปลี่ยนรหัสผ่านได้ตามปกติ (403 ข้างบนมาจากบทบาท)
    await apiLoginAs(request, 'staff1');
    const staffRes = await request.post(`${API_URL}/auth/set-password`, {
      data: { password: DEFAULT_PASSWORD, confirmPassword: DEFAULT_PASSWORD, currentPassword: DEFAULT_PASSWORD },
    });
    expect(staffRes.status(), await staffRes.text()).toBe(200);
  });

  test('N3: forgot-password ของพี่เลี้ยง — ตอบ 200 เหมือนอีเมลที่ไม่มีในระบบเป๊ะ · ไม่มี reset_token', async () => {
    const real = await anon.post(`${API_URL}/auth/forgot-password`, { data: { email: MENTOR1 } });
    const ghost = await anon.post(`${API_URL}/auth/forgot-password`, { data: { email: 'nobody-n3@example.com' } });
    expect(real.status(), await real.text()).toBe(200);
    expect(ghost.status()).toBe(200);
    expect(await real.json()).toEqual(FORGOT_OK);
    expect(await ghost.json()).toEqual(FORGOT_OK);
    expect((await userRow(MENTOR1))!.has_reset).toBe(false);

    // ตัวควบคุม: บัญชีอื่นได้ reset_token จริง (เส้นทางนี้ยังทำงาน)
    const other = await anon.post(`${API_URL}/auth/forgot-password`, { data: { email: 'student1@test.com' } });
    expect(other.status()).toBe(200);
    expect((await userRow('student1@test.com'))!.has_reset).toBe(true);
  });

  test('N4: reset-password ด้วย token ที่ค้างของพี่เลี้ยง = 400 · ไม่แก้อะไร · token ของบัญชีอื่นยังใช้ได้', async () => {
    await dbExec(
      `UPDATE users SET reset_token = 'n4-mentor-token', reset_token_expires = NOW() + INTERVAL '1 hour'
        WHERE email = $1`,
      [MENTOR1]
    );
    const res = await anon.post(`${API_URL}/auth/reset-password`, {
      data: { token: 'n4-mentor-token', password: 'NewPassw0rd!x', confirmPassword: 'NewPassw0rd!x' },
    });
    expect(res.status(), await res.text()).toBe(400);
    const after = await userRow(MENTOR1);
    expect(after!.has_hash).toBe(false);
    // ไม่แตะแถว — token ยังอยู่ (ไม่ใช่ "ใช้แล้วเผา")
    expect(await dbValue<string>('SELECT reset_token FROM users WHERE email = $1', [MENTOR1])).toBe('n4-mentor-token');

    // ตัวควบคุม: token แบบเดียวกันของนักศึกษา ใช้ได้
    await dbExec(
      `UPDATE users SET reset_token = 'n4-student-token', reset_token_expires = NOW() + INTERVAL '1 hour'
        WHERE email = 'student1@test.com'`
    );
    const ok = await anon.post(`${API_URL}/auth/reset-password`, {
      data: { token: 'n4-student-token', password: 'NewPassw0rd!x', confirmPassword: 'NewPassw0rd!x' },
    });
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('N5: เจ้าหน้าที่สร้างบัญชี role mentor ด้วยมือ = 400 · ไม่มีแถว users เกิดขึ้น', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const email = 'manual-mentor-n5@example.com';

    for (const body of [{ email, role: 'mentor' }, { email, roles: ['mentor'] }, { email, roles: ['student', 'mentor'] }]) {
      const res = await request.post(`${API_URL}/users`, { data: body });
      expect(res.status(), `${JSON.stringify(body)}: ${await res.text()}`).toBe(400);
    }
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [email])).toBe('0');
  });

  test('N6: เจ้าหน้าที่เติมบทบาท mentor ให้บัญชีนักศึกษา = 400 · บทบาทไม่เปลี่ยน · บัญชีที่เป็นพี่เลี้ยงอยู่แล้วแก้อย่างอื่นได้', async ({
    request,
  }) => {
    await apiLoginAs(request, 'staff1');
    const student = await userRow('student1@test.com');
    const rolesBefore = await rolesOf('student1@test.com');
    expect(rolesBefore).toEqual(['student']);

    const res = await request.put(`${API_URL}/users/${student!.user_id}`, {
      data: { email: 'student1@test.com', roles: ['student', 'mentor'], is_active: true },
    });
    expect(res.status(), await res.text()).toBe(400);
    expect(await rolesOf('student1@test.com')).toEqual(rolesBefore);

    // ตัวควบคุม: PUT เดิมที่ไม่มี mentor ผ่าน — 400 ข้างบนมาจากด่านบทบาท
    const ok = await request.put(`${API_URL}/users/${student!.user_id}`, {
      data: { email: 'student1@test.com', roles: ['student'], is_active: true },
    });
    expect(ok.status(), await ok.text()).toBe(200);

    // พี่เลี้ยงเดิม (มี mentor อยู่แล้ว) ไม่ถูกด่านนี้ขวาง — เช่นปิด/เปิดบัญชี
    const mentor = await userRow(MENTOR1);
    const keep = await request.put(`${API_URL}/users/${mentor!.user_id}`, {
      data: { email: MENTOR1, roles: ['mentor'], is_active: true },
    });
    expect(keep.status(), await keep.text()).toBe(200);
    expect(await rolesOf(MENTOR1)).toEqual(['mentor']);
  });

  test('N7: resend-invite ของพี่เลี้ยง = 400 · ไม่มี reset_token ไม่มี login token · บัญชีอื่นยังส่งได้', async ({
    request,
  }) => {
    await apiLoginAs(request, 'staff1');
    const mentor = await userRow(MENTOR1);

    const res = await request.post(`${API_URL}/users/${mentor!.user_id}/resend-invite`);
    expect(res.status(), await res.text()).toBe(400);
    expect((await userRow(MENTOR1))!.has_reset).toBe(false);
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens WHERE user_id = $1', [mentor!.user_id])
    ).toBe('0');

    // ตัวควบคุม: บริษัท (ไม่ใช่พี่เลี้ยง) ยังส่งลิงก์เชิญได้
    const company = await userRow('company1@test.com');
    const ok = await request.post(`${API_URL}/users/${company!.user_id}/resend-invite`);
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await userRow('company1@test.com'))!.has_reset).toBe(true);
  });

  test('N8: migration 041 — ล้าง hash/reset_token เฉพาะพี่เลี้ยงล้วน · นักศึกษา เจ้าหน้าที่ และ mentor+advisor ไม่ถูกแตะ', async () => {
    const dual = 'mentor-advisor-n8@test.com';
    await dbExec(`INSERT INTO users (email) VALUES ($1)`, [dual]);
    await dbExec(
      `INSERT INTO user_roles (user_id, role_name)
       SELECT user_id, r FROM users, unnest(ARRAY['mentor', 'advisor']) r WHERE email = $1`,
      [dual]
    );

    // ทุกบัญชีมี hash + reset_token ค้าง
    for (const email of [MENTOR1, 'student1@test.com', 'staff1@test.com', dual]) {
      await giveHash(email);
      await dbExec(
        `UPDATE users SET reset_token = 'n8-' || user_id, reset_token_expires = NOW() + INTERVAL '1 hour'
          WHERE email = $1`,
        [email]
      );
      expect(await userRow(email), email).toMatchObject({ has_hash: true, has_reset: true });
    }

    await dbExec(fs.readFileSync(MIGRATION, 'utf8'));

    expect(await userRow(MENTOR1)).toMatchObject({ has_hash: false, has_reset: false });
    for (const email of ['student1@test.com', 'staff1@test.com', dual]) {
      expect(await userRow(email), email).toMatchObject({ has_hash: true, has_reset: true });
    }

    // รันซ้ำได้ปลอดภัย
    await dbExec(fs.readFileSync(MIGRATION, 'utf8'));
    expect(await userRow(MENTOR1)).toMatchObject({ has_hash: false, has_reset: false });
    expect(await userRow(dual)).toMatchObject({ has_hash: true, has_reset: true });
  });
});
