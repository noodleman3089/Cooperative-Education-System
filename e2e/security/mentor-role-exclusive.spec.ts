import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRows, dbValue } from '../helpers/db';
import { apiLoginAs, ACCOUNTS } from '../helpers/auth';

/**
 * บทบาท `mentor` ต้องเป็นบทบาทเดียวของบัญชี — บังคับที่ฐานข้อมูล (migration 043 · SEC-03 / SEC-15)
 *
 * เจ้าของยืนยัน: บัญชีพี่เลี้ยงถือบทบาทอื่นร่วมไม่ได้ และบัญชีที่ถือบทบาทอื่นอยู่ก็เป็นพี่เลี้ยงไม่ได้
 * ด่านจริงคือ trigger `trg_mentor_role_exclusive` บน `user_roles` (ERRCODE 23514 · ข้อความขึ้นต้น `mentor_role_exclusive:`)
 * ด่านในแอป (`hasOnlyMentorRole` · SEC-03 `hasForeignRole`) คงไว้เป็นชั้นสอง — คุมที่ mentor-followup / mentor-login-link /
 * mentor-auto-remind โดยจำลองข้อมูลเก่าด้วย `grantRoleBypassingMentorTrigger`
 *
 * X1 ใส่บทบาทอื่นให้พี่เลี้ยง · X2 ใส่ mentor ให้บัญชีอื่น (และ UPDATE) · X3 สองคำสั่งพร้อมกัน เหลือบทบาทเดียว
 * X4 API: PUT /users · POST /users ตอบ 400 ไทย · X5 migration 043 หยุดเมื่อมีบัญชีสองบทบาทเดิมค้างอยู่
 * X6 ตอบรับแบบตอบรับด้วยอีเมลของบัญชีที่ไม่ใช่พี่เลี้ยง — ไม่เขียนซ้ำที่นี่ (ดูหมายเหตุท้ายไฟล์)
 *
 * ข้อมูลทั้งหมดเป็นของปลอม (@example.com / @test.com)
 */

const MIGRATION = path.resolve(__dirname, '../../backend/src/db/migrations/043_mentor_role_exclusive.sql');
const TRIGGER = 'trg_mentor_role_exclusive';
const MENTOR1 = ACCOUNTS.mentor1.email;
const FRIENDLY = 'พี่เลี้ยงเป็นได้บทบาทเดียว';

const rolesOf = async (email: string): Promise<string[]> =>
  (
    await dbRows<{ role_name: string }>(
      `SELECT role_name FROM user_roles
        WHERE user_id = (SELECT user_id FROM users WHERE email = $1) ORDER BY role_name`,
      [email]
    )
  ).map((r) => r.role_name);

const addRole = (email: string, role: string) =>
  dbExec(`INSERT INTO user_roles (user_id, role_name) SELECT user_id, $2 FROM users WHERE email = $1`, [email, role]);

/** รัน SQL ที่ต้องถูกฐานปฏิเสธ แล้วคืน error ของ pg — ถ้าสำเร็จเฉย ๆ ให้เทสต์ล้ม (ไม่ใช่ผ่านเงียบ) */
async function expectRejected(sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  try {
    await dbExec(sql, params as any[]);
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error('คาดว่าฐานจะปฏิเสธคำสั่งนี้ แต่มันสำเร็จ');
}

const triggerCount = async (): Promise<number> =>
  Number(
    await dbValue<string>(
      `SELECT COUNT(*) FROM pg_trigger WHERE tgname = $1 AND tgrelid = 'user_roles'::regclass AND NOT tgisinternal`,
      [TRIGGER]
    )
  );

test.describe('mentor เป็นบทบาทเดียว — trigger ที่ฐานข้อมูล', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('X1: ใส่บทบาทอื่นให้พี่เลี้ยงล้วน — ฐานปฏิเสธ (23514 · mentor_role_exclusive) แถวบทบาทไม่เปลี่ยน', async () => {
    expect(await rolesOf(MENTOR1)).toEqual(['mentor']);

    for (const role of ['advisor', 'staff', 'student', 'dean', 'dept_head']) {
      const err = await expectRejected(
        `INSERT INTO user_roles (user_id, role_name) SELECT user_id, $2 FROM users WHERE email = $1`,
        [MENTOR1, role]
      );
      expect(err.code, role).toBe('23514');
      expect(err.message, role).toContain('mentor_role_exclusive');
      expect(await rolesOf(MENTOR1), role).toEqual(['mentor']);
    }

    // ตัวควบคุม: คำสั่งเดียวกันกับบัญชีที่ไม่ใช่พี่เลี้ยง ผ่าน — ข้างบนล้มเพราะ trigger ไม่ใช่เพราะ SQL ผิด
    await addRole('advisor1@test.com', 'dean');
    expect(await rolesOf('advisor1@test.com')).toEqual(['advisor', 'dean']);
    // ใส่ mentor ซ้ำให้พี่เลี้ยงเอง (ON CONFLICT DO NOTHING แบบที่แอปเขียน) ไม่ถูกขวาง
    await dbExec(
      `INSERT INTO user_roles (user_id, role_name) SELECT user_id, 'mentor' FROM users WHERE email = $1 ON CONFLICT DO NOTHING`,
      [MENTOR1]
    );
    expect(await rolesOf(MENTOR1)).toEqual(['mentor']);
  });

  test('X2: ใส่ mentor ให้บัญชีที่มีบทบาทอยู่แล้ว (เจ้าหน้าที่ · นักศึกษา) ฐานปฏิเสธ · UPDATE ก็ถูกกัน แต่เปลี่ยนชื่อบทบาทของบัญชีแถวเดียวไม่ถูกกันผิด', async () => {
    for (const email of ['staff1@test.com', 'student1@test.com', 'advisor1@test.com']) {
      const before = await rolesOf(email);
      const err = await expectRejected(
        `INSERT INTO user_roles (user_id, role_name) SELECT user_id, 'mentor' FROM users WHERE email = $1`,
        [email]
      );
      expect(err.code, email).toBe('23514');
      expect(err.message, email).toContain('mentor_role_exclusive');
      expect(await rolesOf(email), email).toEqual(before);
    }

    // UPDATE: บัญชีสองบทบาท (advisor+dean) เปลี่ยนแถว advisor เป็น mentor → ถูกกัน (อีกแถวคือ dean)
    await addRole('advisor1@test.com', 'dean');
    const upd = await expectRejected(
      `UPDATE user_roles SET role_name = 'mentor'
        WHERE role_name = 'advisor' AND user_id = (SELECT user_id FROM users WHERE email = $1)`,
      ['advisor1@test.com']
    );
    expect(upd.code).toBe('23514');
    expect(upd.message).toContain('mentor_role_exclusive');
    expect(await rolesOf('advisor1@test.com')).toEqual(['advisor', 'dean']);

    // UPDATE: บัญชีที่มีบทบาทเดียวเปลี่ยนชื่อบทบาทเป็นอย่างอื่น — ไม่นับแถวตัวเอง จึงไม่ถูกกันผิด
    await dbExec(`INSERT INTO users (email) VALUES ('x2-single@example.com')`);
    await addRole('x2-single@example.com', 'mentor');
    await dbExec(
      `UPDATE user_roles SET role_name = 'staff' WHERE user_id = (SELECT user_id FROM users WHERE email = 'x2-single@example.com')`
    );
    expect(await rolesOf('x2-single@example.com')).toEqual(['staff']);
    await dbExec(
      `UPDATE user_roles SET role_name = 'dean' WHERE user_id = (SELECT user_id FROM users WHERE email = 'x2-single@example.com')`
    );
    expect(await rolesOf('x2-single@example.com')).toEqual(['dean']);
  });

  test('X3: สอง INSERT พร้อมกัน (mentor กับ advisor) ให้บัญชีที่ยังไม่มีบทบาท — เหลือบทบาทเดียวเสมอ', async () => {
    // ทำซ้ำหลายบัญชี — ถ้า serialize ไม่ได้ จะมีสักรอบที่ทั้งคู่ผ่านแล้วบัญชีได้ mentor+advisor
    const emails = Array.from({ length: 8 }, (_, i) => `x3-race-${i}@example.com`);
    for (const e of emails) await dbExec('INSERT INTO users (email) VALUES ($1)', [e]);

    for (const [i, email] of emails.entries()) {
      // ลำดับเริ่มสลับกันไปมา · dbExec แต่ละตัวยืมคนละ connection จาก pool
      const jobs = i % 2 === 0 ? ['mentor', 'advisor'] : ['advisor', 'mentor'];
      const results = await Promise.allSettled(jobs.map((role) => addRole(email, role)));

      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok, `${email}: ต้องผ่านพอดี 1`).toHaveLength(1);
      expect(failed, `${email}: ต้องถูกปฏิเสธพอดี 1`).toHaveLength(1);
      expect(failed[0].reason.code, email).toBe('23514');
      expect(String(failed[0].reason.message), email).toContain('mentor_role_exclusive');

      const roles = await rolesOf(email);
      expect(roles, email).toHaveLength(1);
      expect(['mentor', 'advisor'], email).toContain(roles[0]);
    }
  });

  test('X4: API — PUT/POST /users ที่ทำให้บัญชีพี่เลี้ยงมีหลายบทบาท = 400 ข้อความไทย · บทบาทและแถวผู้ใช้ไม่เปลี่ยน', async ({
    request,
  }) => {
    await apiLoginAs(request, 'staff1');
    const idOf = async (email: string) => (await dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]))!;
    const mentorId = await idOf(MENTOR1);
    const advisorId = await idOf('advisor1@test.com');

    // พี่เลี้ยงล้วน + ชุดบทบาทที่มีบทบาทอื่นปน (ทั้งเพิ่ม และเปลี่ยนเป็นบทบาทอื่น)
    for (const roles of [['mentor', 'advisor'], ['advisor'], ['staff', 'mentor']]) {
      const res = await request.put(`${API_URL}/users/${mentorId}`, { data: { email: MENTOR1, roles, is_active: true } });
      const text = await res.text();
      expect(res.status(), `${JSON.stringify(roles)}: ${text}`).toBe(400);
      expect(JSON.parse(text).message, JSON.stringify(roles)).toContain(FRIENDLY);
      expect(await rolesOf(MENTOR1), JSON.stringify(roles)).toEqual(['mentor']);
    }

    // บัญชีเจ้าหน้าที่/อาจารย์ที่ถูกขอให้ถือ mentor ร่วม → 400 · บทบาทเดิมต้องอยู่ครบ (ไม่ใช่ถูกล้างครึ่งทาง)
    const advisorBefore = await rolesOf('advisor1@test.com');
    for (const roles of [['advisor', 'mentor'], ['mentor']]) {
      const res = await request.put(`${API_URL}/users/${advisorId}`, {
        data: { email: 'advisor1@test.com', roles, is_active: true },
      });
      expect(res.status(), `${JSON.stringify(roles)}: ${await res.text()}`).toBe(400);
      expect(await rolesOf('advisor1@test.com'), JSON.stringify(roles)).toEqual(advisorBefore);
    }

    // POST /users: บทบาทหลายอย่างที่มี mentor ปน → 400 ข้อความ "เป็นได้บทบาทเดียว" · ไม่มีแถว users เกิดขึ้น
    const email = 'x4-new@example.com';
    const created = await request.post(`${API_URL}/users`, {
      data: { email, password: 'Passw0rd!x1', roles: ['advisor', 'mentor'] },
    });
    const createdText = await created.text();
    expect(created.status(), createdText).toBe(400);
    expect(JSON.parse(createdText).message).toContain(FRIENDLY);
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [email])).toBe('0');

    // ตัวควบคุม: พี่เลี้ยงล้วนแก้อย่างอื่น (ปิด/เปิดบัญชี) ผ่านปกติ — 400 ข้างบนมาจากด่านบทบาทเท่านั้น
    const ok = await request.put(`${API_URL}/users/${mentorId}`, { data: { email: MENTOR1, roles: ['mentor'], is_active: false } });
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await rolesOf(MENTOR1)).toEqual(['mentor']);

    // และ PUT ที่ล้มเพราะ trigger ต้องไม่ทิ้งบัญชีไว้ครึ่งทาง: เปลี่ยนอีเมลพร้อมชุดบทบาทผิด → อีเมลต้องไม่เปลี่ยน
    const bad = await request.put(`${API_URL}/users/${advisorId}`, {
      data: { email: 'x4-changed@example.com', roles: ['advisor', 'mentor'], is_active: true },
    });
    expect(bad.status()).toBe(400);
    expect(await dbValue<string>('SELECT email FROM users WHERE user_id = $1', [advisorId])).toBe('advisor1@test.com');
  });

  test('X5: migration 043 — มีบัญชีสองบทบาทค้างอยู่ = หยุดทั้งไฟล์ บอกอีเมล ไม่สร้าง trigger · เคลียร์แล้วรันซ้ำได้ trigger กลับมา', async () => {
    test.setTimeout(60_000);
    const dual = 'x5-mentor-advisor@example.com';
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    expect(await triggerCount()).toBe(1);

    try {
      // จำลองฐานก่อน 043: ไม่มี trigger แล้วมีบัญชีสองบทบาทอยู่
      await dbExec(`DROP TRIGGER ${TRIGGER} ON user_roles`);
      await dbExec('INSERT INTO users (email) VALUES ($1)', [dual]);
      await addRole(dual, 'mentor');
      await addRole(dual, 'advisor'); // ไม่มี trigger = ยัดได้
      expect(await rolesOf(dual)).toEqual(['advisor', 'mentor']);

      const err = await expectRejected(sql);
      expect(err.message).toContain(dual);
      expect(err.message).toContain('043');
      expect(await triggerCount(), 'ล้มแล้วต้องไม่มี trigger ครึ่งเดียวค้าง').toBe(0);
      // ไม่ลบบทบาท/ข้อมูลของใครให้เอง
      expect(await rolesOf(dual)).toEqual(['advisor', 'mentor']);

      // เจ้าของข้อมูลตัดสินใจแล้วแก้เอง → รันใหม่ผ่าน trigger กลับมา
      await dbExec(`DELETE FROM user_roles WHERE role_name = 'advisor' AND user_id = (SELECT user_id FROM users WHERE email = $1)`, [dual]);
      await dbExec(sql);
      expect(await triggerCount()).toBe(1);

      // รันซ้ำอีกรอบได้ปลอดภัย และ trigger ทำงานจริง
      await dbExec(sql);
      expect(await triggerCount()).toBe(1);
      const after = await expectRejected(
        `INSERT INTO user_roles (user_id, role_name) SELECT user_id, 'staff' FROM users WHERE email = $1`,
        [dual]
      );
      expect(after.code).toBe('23514');
    } finally {
      // ไม่ว่าล้มตรงไหน คืนฐานให้มี trigger เสมอ — เคลียร์บัญชีสองบทบาทก่อน ไม่งั้นด่านตรวจข้อมูลเดิมจะหยุดการติดตั้ง
      await dbExec('DELETE FROM users WHERE email = $1', [dual]);
      if ((await triggerCount()) === 0) await dbExec(sql);
    }
    expect(await triggerCount()).toBe(1);
  });

  // X6 — ขั้นยื่นแบบตอบรับที่ใช้อีเมลของบัญชีที่ไม่ใช่พี่เลี้ยง (SEC-03) ไม่ผูกบทบาท mentor ทับบัญชีเดิม:
  // มีเคสเทียบเท่าอยู่แล้ว ไม่เขียนซ้ำ — documents/acceptance-link.spec.ts L8 (อีเมลนักศึกษา · เจ้าหน้าที่ · อาจารย์ · คณบดี
  // = 400 · ไม่มีแถว user_roles เพิ่ม) และ security/security-hardening.spec.ts SEC-03 · ด่าน `hasForeignRole` ใน
  // acceptance.ts approveByOfficer (ชั้นสอง) ไม่มีเทสต์ตรง — ตอนนี้ฐานกันบัญชีแบบนั้นไม่ให้เกิด จึงไปถึงด่านนั้นไม่ได้
  // ถ้าจะคุมต้องเดินใบตอบรับทั้งเส้นแล้วข้าม trigger (`grantRoleBypassingMentorTrigger`) — ยังไม่ทำ (เสนอให้เจ้าของตัดสิน)
});
