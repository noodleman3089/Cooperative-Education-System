import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue, withDb } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';
import { hashPassword } from '../../backend/src/utils/password';

/**
 * SB-G2 · หัวหน้าสาขาวิชามีคนเดียวต่อสาขา — เจ้าของตัดสิน 2026-09-15
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **เจ้าหน้าที่ตั้งคนใหม่ = ถอด role ของคนเก่าอัตโนมัติ** (PUT /users/:id · claim จากรายชื่อที่เจ้าหน้าที่เตรียม)
 *      · บัญชีคนเก่ายังอยู่และยังเปิดใช้งาน · ลง audit_log · สิทธิ์หายทันที (role อ่านจากฐานทุกคำขอ)
 *      · คนเก่าที่ไม่เหลือบทบาทอื่น → เติม `advisor` ให้ (U1b) ไม่งั้นล็อกอินแล้วตกไปหน้ากรอกข้อมูลนักศึกษา
 *   2. **ต่างสาขาไม่กระทบกัน**
 *   3. **ผู้ใช้เลือกสาขาเองแล้วชนหัวหน้าสาขาที่มีอยู่ = 409** ไม่ถอดคนเก่าให้
 *      — ไม่งั้นหัวหน้าสาขาแก้สาขาในโปรไฟล์ตัวเองแล้วปลดหัวหน้าสาขาอื่นได้
 */

const uid = (email: string) => dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;
const roleCount = (userId: number, role: string) =>
  dbValue<number>('SELECT COUNT(*)::int FROM user_roles WHERE user_id = $1 AND role_name = $2', [userId, role]);

test.describe('SB-G2 · หัวหน้าสาขาคนเดียวต่อสาขา', () => {
  let head1: number;
  let advisor1: number;
  let advisor2: number;
  let headMajor: number;

  test.beforeEach(async () => {
    await seedTestData();
    head1 = await uid('head1@test.com');
    advisor1 = await uid('advisor1@test.com');
    advisor2 = await uid('advisor2@test.com');
    headMajor = (await dbValue<number>('SELECT major_id FROM personnel WHERE personnel_id = $1', [head1]))!;
    // advisor1 อยู่สาขาเดียวกับ head1 · advisor2 อยู่คนละสาขา (ตาม seeder)
    expect(await dbValue('SELECT major_id FROM personnel WHERE personnel_id = $1', [advisor1])).toBe(headMajor);
    expect(await dbValue('SELECT major_id FROM personnel WHERE personnel_id = $1', [advisor2])).not.toBe(headMajor);
  });

  test('U1: เจ้าหน้าที่ตั้งหัวหน้าสาขาคนใหม่ในสาขาเดิม → คนเก่าถูกถอดทันที · บัญชียังอยู่ · ลง audit_log', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const res = await request.put(`${API_URL}/users/${advisor1}`, {
      data: { email: 'advisor1@test.com', roles: ['advisor', 'dept_head'], is_active: true },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.replaced_dept_heads).toEqual([{ user_id: head1, full_name: 'สมหญิง หัวหน้าสาขา' }]);

    expect(await roleCount(advisor1, 'dept_head')).toBe(1);
    expect(await roleCount(head1, 'dept_head')).toBe(0);
    expect(await dbValue('SELECT is_active FROM users WHERE user_id = $1', [head1])).toBe(true);
    expect(await dbValue('SELECT COUNT(*)::int FROM personnel WHERE personnel_id = $1', [head1])).toBe(1);

    await expect
      .poll(() =>
        dbValue(
          `SELECT COUNT(*)::int FROM audit_log
            WHERE action = 'user.dept_head_replaced' AND entity_id = $1
              AND (detail->>'new_dept_head_user_id')::int = $2 AND (detail->>'major_id')::int = $3`,
          [head1, advisor1, headMajor]
        )
      )
      .toBe(1);

    // สิทธิ์หายทันที ไม่ต้องรอ session หมดอายุ
    await apiLoginAs(request, 'head1');
    expect((await request.get(`${API_URL}/faculty/home/dept-head`)).status()).toBe(403);
    await apiLoginAs(request, 'advisor1');
    expect((await request.get(`${API_URL}/faculty/home/dept-head`)).status()).toBe(200);

    // บันทึกซ้ำโดยไม่เปลี่ยนอะไร — ไม่มีใครให้ถอดแล้ว
    await apiLoginAs(request, 'staff1');
    const again = await request.put(`${API_URL}/users/${advisor1}`, {
      data: { email: 'advisor1@test.com', roles: ['advisor', 'dept_head'], is_active: true },
    });
    expect((await again.json()).replaced_dept_heads).toEqual([]);
  });

  // เจ้าของเลือกแบบ A 2026-09-24 — head1 ในซีดถือ dept_head อย่างเดียว เดิมถอดแล้วไม่เหลือบทบาท
  // ล็อกอินครั้งถัดไปถูกพาไปหน้ากรอกข้อมูลนักศึกษา (auth.ts: ไม่มี role = student onboarding)
  test('U1b: คนเก่าที่ไม่เหลือบทบาทอื่น → คงเป็นอาจารย์ที่ปรึกษา · คนที่มีบทบาทอื่นอยู่แล้วไม่ถูกเติม', async ({ request }) => {
    expect(await dbValue('SELECT COUNT(*)::int FROM user_roles WHERE user_id = $1', [head1])).toBe(1);

    await apiLoginAs(request, 'staff1');
    const res = await request.put(`${API_URL}/users/${advisor1}`, {
      data: { email: 'advisor1@test.com', roles: ['advisor', 'dept_head'], is_active: true },
    });
    expect(res.status(), await res.text()).toBe(200);

    expect(await roleCount(head1, 'dept_head')).toBe(0);
    expect(await roleCount(head1, 'advisor')).toBe(1);
    expect(await dbValue('SELECT COUNT(*)::int FROM user_roles WHERE user_id = $1', [head1])).toBe(1);
    await expect
      .poll(() =>
        dbValue(
          `SELECT COUNT(*)::int FROM audit_log
            WHERE action = 'user.dept_head_replaced' AND entity_id = $1 AND (detail->>'advisor_role_added')::boolean`,
          [head1]
        )
      )
      .toBe(1);

    // ล็อกอินแล้วยังเป็นอาจารย์ และเข้าหน้าอาจารย์ที่ปรึกษาได้
    const login = await request.post(`${API_URL}/auth/login`, {
      data: { email: 'head1@test.com', password: 'password123' },
    });
    expect(login.status(), await login.text()).toBe(200);
    expect((await login.json()).user.roles).toEqual(['advisor']);
    expect((await request.get(`${API_URL}/faculty/home/advisor?view=advisor`)).status()).toBe(200);

    // สลับกลับ: advisor1 มี advisor อยู่แล้ว ถูกถอดแค่ dept_head ไม่มีอะไรถูกเติม
    await apiLoginAs(request, 'staff1');
    const back = await request.put(`${API_URL}/users/${head1}`, {
      data: { email: 'head1@test.com', roles: ['advisor', 'dept_head'], is_active: true },
    });
    expect((await back.json()).replaced_dept_heads.map((h: { user_id: number }) => h.user_id)).toEqual([advisor1]);
    expect(await dbValue(`SELECT string_agg(role_name, ',') FROM user_roles WHERE user_id = $1`, [advisor1])).toBe('advisor');
    await expect
      .poll(() =>
        dbValue(
          `SELECT COUNT(*)::int FROM audit_log
            WHERE action = 'user.dept_head_replaced' AND entity_id = $1 AND detail ? 'advisor_role_added'`,
          [advisor1]
        )
      )
      .toBe(0);
  });

  test('U2: ตั้งหัวหน้าสาขาคนละสาขา ไม่กระทบหัวหน้าสาขาเดิม · แก้บัญชีที่ไม่มี dept_head ไม่ถอดใคร', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const res = await request.put(`${API_URL}/users/${advisor2}`, {
      data: { email: 'advisor2@test.com', roles: ['advisor', 'dept_head'], is_active: true },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).replaced_dept_heads).toEqual([]);
    expect(await roleCount(head1, 'dept_head')).toBe(1);
    expect(await roleCount(advisor2, 'dept_head')).toBe(1);

    const plain = await request.put(`${API_URL}/users/${advisor1}`, {
      data: { email: 'advisor1@test.com', roles: ['advisor'], is_active: true },
    });
    expect((await plain.json()).replaced_dept_heads).toEqual([]);
    expect(await roleCount(head1, 'dept_head')).toBe(1);
  });

  /**
   * U3 เดิม (2026-09-15) คุมว่าแก้สาขาในโปรไฟล์ไปชนหัวหน้าคนอื่น = 409 · ตั้งแต่ 2026-09-23
   * `PUT /profile/personnel` **เมิน `major_id` ทั้งหมด** (สาขากำหนดสิทธิ์ `resolveMajorScope`)
   * → ไม่มีทางชนอีกแล้ว และต้องไม่มีใครถูกถอด · การย้ายสาขาไปอยู่ที่เจ้าหน้าที่ (U3b)
   */
  test('U3: หัวหน้าสาขาส่ง major_id มาทางโปรไฟล์ตัวเอง → สาขาไม่ขยับ · ไม่มีใครถูกถอด', async ({ request }) => {
    const itMajor = (await dbValue<number>('SELECT major_id FROM personnel WHERE personnel_id = $1', [advisor2]))!;
    await dbExec("INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'dept_head')", [advisor2]);

    await apiLoginAs(request, 'head1');
    const res = await request.put(`${API_URL}/profile/personnel`, { multipart: { major_id: String(itMajor) } });
    expect(res.status(), await res.text()).toBe(200);

    expect(await roleCount(advisor2, 'dept_head')).toBe(1);
    expect(await roleCount(head1, 'dept_head')).toBe(1);
    expect(await dbValue('SELECT major_id FROM personnel WHERE personnel_id = $1', [head1])).toBe(headMajor);
  });

  test('U3b: เจ้าหน้าที่ย้ายหัวหน้าสาขาไปสาขาที่มีหัวหน้าอยู่ → คนเดิมของสาขาปลายทางถูกถอด', async ({ request }) => {
    const itMajor = (await dbValue<number>('SELECT major_id FROM personnel WHERE personnel_id = $1', [advisor2]))!;
    await dbExec("INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'dept_head')", [advisor2]);

    await apiLoginAs(request, 'staff1');
    const res = await request.put(`${API_URL}/users/${head1}`, {
      data: { email: 'head1@test.com', roles: ['advisor', 'dept_head'], is_active: true, major_id: itMajor },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).replaced_dept_heads.map((h: { user_id: number }) => h.user_id)).toEqual([advisor2]);

    expect(await dbValue('SELECT major_id FROM personnel WHERE personnel_id = $1', [head1])).toBe(itMajor);
    expect(await roleCount(advisor2, 'dept_head')).toBe(0);
    expect(await roleCount(head1, 'dept_head')).toBe(1);
  });

  test('U4: claim รหัสบุคลากรที่เจ้าหน้าที่เตรียมเป็นหัวหน้าสาขา → แทนคนเก่าในสาขานั้น', async ({ request }) => {
    const email = 'newhead@test.com';
    await dbExec('DELETE FROM users WHERE email = $1', [email]);
    await dbExec('DELETE FROM personnel_preseed_list WHERE employee_code = $1', ['EMPHEAD1']);
    await dbExec('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, await hashPassword('password123')]);
    await dbExec(
      `INSERT INTO personnel_preseed_list (employee_code, role_name, major_id, first_name, last_name, email)
       VALUES ('EMPHEAD1', 'dept_head', $1, 'ใหม่', 'หัวหน้า', $2)`,
      [headMajor, email]
    );

    const login = await request.post(`${API_URL}/auth/login`, { data: { email, password: 'password123' } });
    expect(login.status(), await login.text()).toBe(200);
    const claim = await request.post(`${API_URL}/auth/claim-personnel`, { data: { employee_code: 'EMPHEAD1' } });
    expect(claim.status(), await claim.text()).toBe(200);

    const newHead = await uid(email);
    expect(await roleCount(newHead, 'dept_head')).toBe(1);
    expect(await roleCount(head1, 'dept_head')).toBe(0);
    expect(await dbValue('SELECT is_active FROM users WHERE user_id = $1', [head1])).toBe(true);
  });

  /**
   * U5: migration 035 — ฐานจริงที่มีหัวหน้าซ้อนมาก่อน SB-G2 ต้อง migrate ไม่ผ่านจนกว่าคนจะเลือก
   * (ไฟล์ไม่แก้ข้อมูลเอง เพราะเลือกแทนไม่ได้ว่าใครคือหัวหน้าตัวจริง)
   */
  test('U5: migration 035 ปฏิเสธเมื่อสาขามีหัวหน้าซ้อน · ผ่านเมื่อไม่ซ้อน', async () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../../backend/src/db/migrations/035_check_duplicate_dept_heads.sql'),
      'utf8'
    );
    const run = () =>
      withDb(async (db) => {
        await db.query('BEGIN');
        try {
          await db.query(sql);
        } finally {
          await db.query('ROLLBACK');
        }
      });

    await expect(run()).resolves.toBeUndefined();

    // ซ้อนแบบที่เกิดได้ก่อน SB-G2 — แปะ role ตรงลงฐาน ไม่ผ่าน API ที่กันไว้แล้ว
    await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'dept_head') ON CONFLICT DO NOTHING`, [advisor1]);
    await expect(run()).rejects.toThrow(/พบหัวหน้าสาขาซ้อน: major_id=\d+ \(2 คน/);
  });
});
