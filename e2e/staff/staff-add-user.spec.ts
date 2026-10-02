import { test, expect } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbValue } from '../helpers/db';

/**
 * ปุ่ม "เพิ่มบัญชี" ในหน้าบัญชี สิทธิ์ และข้อมูลหลัก (เจ้าหน้าที่)
 *
 * บั๊กที่ไฟล์นี้คุม (พบ 2026-09-24): ฟอร์มส่ง `roles: [...]` (checkbox หลายบทบาท แบบเดียวกับ
 * PUT /users/:id) แต่ `createUser` อ่านแค่ `role` ตัวเดียว → **ทุกครั้งที่กดสร้างบัญชีจากหน้าจอได้ 400**
 * และ error ไปขึ้นที่แถบหลังกล่อง ผู้ใช้เลยไม่เห็นอะไรเลย
 *
 * ⛔ สิ่งที่คุม:
 *   1. ฟอร์มจริงสร้างบัญชีได้ · ได้ทุกบทบาทที่ติ๊ก · ลง audit_log · ล็อกอินด้วยรหัสที่ตั้งได้
 *   2. **ที่ปรึกษา/หัวหน้าสาขาต้องเลือกสาขาตอนสร้าง** (เจ้าของสั่ง 2026-09-24) — ไม่มีแถว `personnel`
 *      = ใช้ฝ่ายอาจารย์ไม่ได้ (403) จนกว่าจะมีคนแก้อีกรอบ · สร้างแล้วต้องเข้าหน้าอาจารย์ได้ทันที
 *   3. หัวหน้าสาขามีคนเดียวต่อสาขา (SB-G2) — ฟอร์มเตือนก่อนกด และคนเดิมถูกถอดจริง
 *   4. บทบาทที่ไม่มีในระบบ (เช่น `admin` ที่ checkbox ยังมีให้ติ๊ก) · สาขาที่ไม่มี · สาขากับบัญชี
 *      ที่ไม่ใช่บุคลากร ต้อง 400 **ก่อน INSERT** — ไม่มีบัญชีครึ่งทางค้างในฐาน
 *   5. error ต้องขึ้น**ในกล่อง** และกล่องไม่ปิด — ทั้งกล่องเพิ่มและกล่องแก้ไข · เส้นนี้เป็นของเจ้าหน้าที่เท่านั้น
 *   6. ไม่มี checkbox "ผู้ดูแลระบบ" (`admin`) — ไม่มีใน VALID_ROLES และ DB CHECK ติ๊กได้ก็ใช้ไม่ได้
 *      · โมดัลแก้ไขไม่มีช่องรหัสผ่าน — backend ไม่เคยอ่าน กรอกแล้วเงียบ
 * `role: 'company'` ถูกปฏิเสธ (บริษัทไม่มีบัญชีแล้ว) คุมอยู่ใน security/company-role-removed.spec.ts
 */

const NEW_EMAIL = 'add-user-e2e@rmutto.ac.th';
const countUsers = (email: string) => dbValue<number>('SELECT COUNT(*)::int FROM users WHERE email = $1', [email]);
const uid = (email: string) => dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;
const majorOf = (userId: number) => dbValue<number>('SELECT major_id FROM personnel WHERE personnel_id = $1', [userId]);
const rolesOf = (userId: number) =>
  dbValue<string>(`SELECT string_agg(role_name, ',' ORDER BY role_name) FROM user_roles WHERE user_id = $1`, [userId]);

test.describe('เจ้าหน้าที่เพิ่มบัญชีผู้ใช้จากหน้าจอ', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('DELETE FROM users WHERE email LIKE $1', ['add-user-e2e%']);
  });

  test('A1: ฟอร์มจริงสร้างบัญชีอาจารย์พร้อมสาขา · ลง audit · เข้าหน้าอาจารย์ได้ทันที', async ({ page, request }) => {
    const major = (await majorOf(await uid('advisor1@test.com')))!;

    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');

    await page.getByTestId('user-add-open').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('user-add-major')).toHaveCount(0); // นักศึกษา (ค่าเริ่มต้น) ไม่มีช่องสาขา
    await dialog.getByTestId('user-add-email').fill(NEW_EMAIL);
    await dialog.getByTestId('user-add-password').fill('Password123!');
    await dialog.getByTestId('user-add-role-student').uncheck();
    await dialog.getByTestId('user-add-role-advisor').check();
    await dialog.getByTestId('user-add-role-staff').check();

    // ไม่เลือกสาขา = ไม่ยิงคำขอ บอกในกล่อง
    await dialog.getByTestId('user-add-submit').click();
    await expect(dialog).toContainText('กรุณาเลือกสาขาวิชา');
    expect(await countUsers(NEW_EMAIL)).toBe(0);

    await dialog.getByTestId('user-add-major').selectOption(String(major));
    await dialog.getByTestId('user-add-submit').click();

    await expect(page.getByText(`สร้างบัญชีผู้ใช้ ${NEW_EMAIL} สำเร็จเรียบร้อยแล้ว`)).toBeVisible();
    await expect(dialog).toBeHidden();

    const id = await uid(NEW_EMAIL);
    expect(id).toBeTruthy();
    await expect(page.getByTestId(`user-row-${id}`)).toBeVisible();
    expect(await rolesOf(id)).toBe('advisor,staff');
    expect(await majorOf(id)).toBe(major);

    await expect
      .poll(() => dbValue(`SELECT detail FROM audit_log WHERE action = 'user.created' AND entity_id = $1`, [id]))
      .toMatchObject({ roles: ['advisor', 'staff'], major_id: major });

    const login = await request.post(`${API_URL}/auth/login`, {
      data: { email: NEW_EMAIL, password: 'Password123!' },
    });
    expect(login.status(), await login.text()).toBe(200);
    // เดิมบัญชีแบบนี้ได้ 403 (ไม่มีแถว personnel) จนเจ้าหน้าที่ไปเลือกสาขาในโมดัลแก้ไข
    expect((await request.get(`${API_URL}/faculty/home/advisor?view=advisor`)).status()).toBe(200);
  });

  test('A2: ตั้งหัวหน้าสาขาในสาขาที่มีหัวหน้าอยู่แล้ว = เตือนในกล่อง · คนเดิมถูกถอด', async ({ page }) => {
    const oldHead = await uid('head1@test.com');
    const major = (await majorOf(oldHead))!;

    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');

    await page.getByTestId('user-add-open').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('user-add-email').fill(NEW_EMAIL);
    await dialog.getByTestId('user-add-password').fill('Password123!');
    await dialog.getByTestId('user-add-role-student').uncheck();
    await dialog.getByTestId('user-add-role-advisor').check();
    await dialog.getByTestId('user-add-role-dept_head').check();
    await dialog.getByTestId('user-add-major').selectOption(String(major));
    await expect(dialog).toContainText('สาขานี้มีหัวหน้าสาขาอยู่แล้ว คือ สมหญิง หัวหน้าสาขา');
    await dialog.getByTestId('user-add-submit').click();

    await expect(page.getByText('ถอดบทบาทหัวหน้าสาขาวิชาจาก สมหญิง หัวหน้าสาขา')).toBeVisible();
    const id = await uid(NEW_EMAIL);
    expect(await rolesOf(id)).toBe('advisor,dept_head');
    // head1 ในซีดถือ dept_head อย่างเดียว ถอดแล้วคงเป็นอาจารย์ที่ปรึกษา (dept-head-unique U1b)
    expect(await rolesOf(oldHead)).toBe('advisor');
  });

  test('A3: อีเมลซ้ำ = error ในกล่อง กล่องไม่ปิด', async ({ page }) => {
    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');

    await page.getByTestId('user-add-open').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('user-add-email').fill('advisor1@test.com');
    await dialog.getByTestId('user-add-password').fill('Password123!');
    await dialog.getByTestId('user-add-submit').click();

    await expect(dialog).toContainText('Email is already registered.');
    await expect(dialog).toBeVisible();
  });

  test('A4: คำขอที่ผิดถูกปฏิเสธก่อนสร้างแถว · คนนอกเจ้าหน้าที่เรียกไม่ได้', async ({ request }) => {
    const major = (await majorOf(await uid('advisor1@test.com')))!;
    await apiLoginAs(request, 'staff1');
    const bad = [
      { roles: ['advisor', 'admin'], major_id: major }, // บทบาทนอก VALID_ROLES
      { roles: ['nobody'] },
      { roles: [] },
      { roles: ['advisor'] }, // ที่ปรึกษาไม่มีสาขา
      { role: 'dept_head' }, // หัวหน้าสาขาไม่มีสาขา (แบบสตริงเดียว)
      { roles: ['advisor'], major_id: 999999 }, // สาขาไม่มีจริง
      { roles: ['student'], major_id: major }, // สาขากับบัญชีที่ไม่ใช่บุคลากร
    ];
    for (const body of bad) {
      const res = await request.post(`${API_URL}/users`, {
        data: { email: NEW_EMAIL, password: 'Password123!', ...body },
      });
      expect(res.status(), JSON.stringify(body)).toBe(400);
    }
    expect(await countUsers(NEW_EMAIL)).toBe(0);

    // สตริงเดียวแบบเดิมยังใช้ได้
    const legacy = await request.post(`${API_URL}/users`, {
      data: { email: NEW_EMAIL, password: 'Password123!', role: 'staff' },
    });
    expect(legacy.status(), await legacy.text()).toBe(201);
    expect((await legacy.json()).user.roles).toEqual(['staff']);

    for (const account of ['advisor1', 'dean1', 'student1'] as const) {
      await apiLoginAs(request, account);
      const res = await request.post(`${API_URL}/users`, {
        data: { email: 'add-user-e2e-2@rmutto.ac.th', password: 'Password123!', roles: ['staff'] },
      });
      expect(res.status(), account).toBe(403);
    }
    expect(await countUsers('add-user-e2e-2@rmutto.ac.th')).toBe(0);
  });

  test('A5: ไม่มีช่อง "ผู้ดูแลระบบ" (admin) ให้ติ๊ก — ระบบไม่มีบทบาทนี้ (DB CHECK ไม่รับ)', async ({ page }) => {
    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');

    await page.getByTestId('user-add-open').click();
    const addDialog = page.getByRole('dialog');
    await expect(addDialog.getByTestId('user-add-role-advisor')).toBeVisible();
    await expect(addDialog.getByTestId('user-add-role-admin')).toHaveCount(0);
    await expect(addDialog).not.toContainText('ผู้ดูแลระบบ');
    await addDialog.getByRole('button', { name: 'ยกเลิก' }).click();

    await page.getByTestId(`user-edit-${await uid('advisor1@test.com')}`).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog.getByTestId('user-edit-role-advisor')).toBeChecked();
    await expect(editDialog.getByTestId('user-edit-role-admin')).toHaveCount(0);
    await expect(editDialog).not.toContainText('ผู้ดูแลระบบ');
    // ช่อง "รหัสผ่านใหม่" ถูกถอด (เจ้าของสั่ง 2026-09-24) — PUT /users/:id ไม่เคยอ่านค่านี้
    // กรอกแล้วขึ้นว่าสำเร็จทั้งที่รหัสไม่เปลี่ยน · บุคลากรใช้ Google · คนนอกใช้ลิงก์เชิญ (SEC-09)
    await expect(editDialog.locator('input[type="password"]')).toHaveCount(0);
    await expect(editDialog).not.toContainText('รหัสผ่านใหม่');
  });

  test('A6: โมดัลแก้ไขบัญชี — บันทึกไม่ผ่าน = error ในกล่อง กล่องไม่ปิด', async ({ page, request }) => {
    // บัญชีทิ้งของเทสต์นี้ แล้วลบทิ้งระหว่างที่โมดัลเปิดอยู่ (เหมือนเจ้าหน้าที่อีกคนลบไปก่อน) → PUT ได้ 404
    await apiLoginAs(request, 'staff1');
    const created = await request.post(`${API_URL}/users`, {
      data: { email: NEW_EMAIL, password: 'Password123!', roles: ['staff'] },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = await uid(NEW_EMAIL);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');
    await page.getByTestId(`user-edit-${id}`).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`แก้ไขบัญชี: ${NEW_EMAIL}`);

    await dbExec('DELETE FROM users WHERE user_id = $1', [id]);
    await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();

    await expect(dialog).toContainText('User not found.');
    await expect(dialog).toBeVisible();
  });
});
