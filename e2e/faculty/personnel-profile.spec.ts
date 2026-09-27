import { test, expect } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRow, dbValue } from '../helpers/db';
import { hashPassword } from '../../backend/src/utils/password';

/**
 * โปรไฟล์บุคลากร (PersonnelProfile) — รื้อใหม่ 2026-09-23
 *
 * ⛔ สิ่งที่ไฟล์นี้คุมคือ "ใครแก้อะไรได้" ก่อนหน้าตา:
 *   1. **สาขาของบุคลากรแก้เองไม่ได้** — `resolveMajorScope` ใช้สาขานี้ตัดสินว่าที่ปรึกษา/หัวหน้าสาขา
 *      เห็นนักศึกษาและคำร้องของใคร · เดิมหน้าโปรไฟล์มี dropdown = ย้ายตัวเองไปดูสาขาอื่นได้
 *      (แบบเดียวกับ SEC-05 ฝั่งนักศึกษา) · backend เมิน `major_id` เงียบ ๆ
 *   2. **เจ้าหน้าที่เป็นคนเดียวที่ย้ายสาขาได้** ผ่าน `PUT /users/:id` + ลง audit_log
 *   3. **ชื่อแก้ได้ทุกฝ่าย รวมเจ้าหน้าที่** (เดิมซ่อนไว้สำหรับ staff — เจ้าของตัดสินให้เปิด
 *      เพราะชื่อคือสิ่งที่บอกว่าใครทำอะไรในระบบ)
 *   4. กระดานวาดลายเซ็นคณบดีอยู่ที่เมนู signature ที่เดียว — หน้าโปรไฟล์แค่พาไป
 *   5. หน้าตาแบบ B (หัวโปรไฟล์ + สองคอลัมน์ · เจ้าของเลือกบน canvas 2026-09-23) — ตัวเลข
 *      "นักศึกษาในความดูแล" ต้องตรงฐาน และแถว "หน้าที่ของคุณ" ต้องพาไปฝ่ายนั้นจริง (P8)
 */

const uid = (email: string) => dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;
const majorOf = (userId: number) => dbValue<number>('SELECT major_id FROM personnel WHERE personnel_id = $1', [userId]);

test.describe('โปรไฟล์บุคลากร · ใครแก้อะไรได้', () => {
  let advisor1: number;
  let ownMajor: number;
  let otherMajor: number;

  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    advisor1 = await uid('advisor1@test.com');
    ownMajor = (await majorOf(advisor1))!;
    otherMajor = (await majorOf(await uid('advisor2@test.com')))!;
    expect(otherMajor).not.toBe(ownMajor);
  });

  test('P1: บุคลากรส่ง major_id มาทางโปรไฟล์ → ชื่อเปลี่ยน แต่สาขาไม่ขยับ', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const res = await request.put(`${API_URL}/profile/personnel`, {
      multipart: { major_id: String(otherMajor), first_name: 'วิชัยใหม่', last_name: 'ที่ปรึกษาดี' },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.profile.major_id).toBe(ownMajor);
    expect(body.profile.first_name).toBe('วิชัยใหม่');

    expect(await majorOf(advisor1)).toBe(ownMajor);
  });

  test('P2: เจ้าหน้าที่ย้ายสาขาได้ · ลง audit_log · สาขาที่ไม่มีจริง/บัญชีที่ไม่ใช่บุคลากร = 400', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const res = await request.put(`${API_URL}/users/${advisor1}`, {
      data: { email: 'advisor1@test.com', roles: ['advisor'], is_active: true, major_id: otherMajor },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(await majorOf(advisor1)).toBe(otherMajor);

    await expect
      .poll(() =>
        dbValue(
          `SELECT COUNT(*)::int FROM audit_log
            WHERE action = 'user.updated' AND entity_id = $1
              AND (detail->>'major_id_before')::int = $2 AND (detail->>'major_id_after')::int = $3`,
          [advisor1, ownMajor, otherMajor]
        )
      )
      .toBe(1);

    const bad = await request.put(`${API_URL}/users/${advisor1}`, {
      data: { email: 'advisor1@test.com', roles: ['advisor'], is_active: true, major_id: 999999 },
    });
    expect(bad.status()).toBe(400);
    expect(await majorOf(advisor1)).toBe(otherMajor);

    const student = await uid('student2@test.com');
    const notPersonnel = await request.put(`${API_URL}/users/${student}`, {
      data: { email: 'student2@test.com', roles: ['student'], is_active: true, major_id: otherMajor },
    });
    expect(notPersonnel.status()).toBe(400);
  });

  test('P3: บุคลากรเรียก PUT /users/:id ย้ายสาขาตัวเองไม่ได้', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const res = await request.put(`${API_URL}/users/${advisor1}`, {
      data: { email: 'advisor1@test.com', roles: ['advisor'], is_active: true, major_id: otherMajor },
    });
    expect(res.status()).toBe(403);
    expect(await majorOf(advisor1)).toBe(ownMajor);
  });

  test('P4 UI: ที่ปรึกษาเห็นสาขาแบบอ่านอย่างเดียว · แก้ชื่อได้ · ไม่มีการ์ดลายเซ็น', async ({ page }) => {
    const majorName = await dbValue<string>('SELECT major_name_th FROM master_major WHERE major_id = $1', [ownMajor]);

    await loginAs(page, 'advisor1');
    await goToMenu(page, 'profile');

    const registry = page.getByTestId('personnel-profile-registry');
    await expect(registry).toContainText('แก้เองไม่ได้');
    await expect(page.getByTestId('personnel-profile-major')).toHaveText(majorName!);
    const hero = page.getByTestId('personnel-profile-hero');
    await expect(hero).toContainText('advisor1@test.com');
    await expect(hero).toContainText('อาจารย์ที่ปรึกษา');
    // ไม่มีช่องให้เลือกสาขาที่ไหนบนหน้านี้
    await expect(registry.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByTestId('personnel-profile-form').getByRole('combobox')).toHaveCount(0);
    await expect(page.getByTestId('personnel-signature-card')).toHaveCount(0);

    await page.getByTestId('personnel-first-name').fill('วิชัยแก้แล้ว');
    await page.getByTestId('personnel-profile-save').click();
    await expect(page.getByText('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว')).toBeVisible();

    expect(await dbValue('SELECT first_name FROM personnel WHERE personnel_id = $1', [advisor1])).toBe('วิชัยแก้แล้ว');
    expect(await majorOf(advisor1)).toBe(ownMajor);
  });

  test('P5 UI: เจ้าหน้าที่แก้ชื่อตัวเองได้ · ชื่อว่างบันทึกไม่ได้', async ({ page }) => {
    const staff1 = await uid('staff1@test.com');
    // seed ไม่มีแถว personnel ให้ staff1 — ของจริงได้มาตอน onboarding
    await dbExec(
      `INSERT INTO personnel (personnel_id, major_id, status) VALUES ($1, $2, 'approved') ON CONFLICT (personnel_id) DO NOTHING`,
      [staff1, ownMajor]
    );

    await loginAs(page, 'staff1');
    await goToMenu(page, 'profile');
    await expect(page.getByTestId('personnel-profile-hero')).toContainText('เจ้าหน้าที่สหกิจศึกษา');
    // เจ้าหน้าที่ไม่ถือ role advisor → ไม่มีการ์ดนักศึกษาในความดูแล
    await expect(page.getByTestId('personnel-caseload')).toHaveCount(0);

    await page.getByTestId('personnel-profile-save').click();
    await expect(page.getByText('กรุณากรอกชื่อและนามสกุล')).toBeVisible();

    await page.getByTestId('personnel-first-name').fill('มานี');
    await page.getByTestId('personnel-last-name').fill('ประสานงาน');
    await page.getByTestId('personnel-profile-save').click();
    await expect(page.getByText('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว')).toBeVisible();

    const row = await dbRow<{ first_name: string; last_name: string }>(
      'SELECT first_name, last_name FROM personnel WHERE personnel_id = $1',
      [staff1]
    );
    expect(row).toEqual({ first_name: 'มานี', last_name: 'ประสานงาน' });
  });

  test('P6 UI: คณบดีเห็นการ์ดลายมือชื่อ ไม่มีกระดานวาดซ้ำ · กดแล้วไปหน้าลายมือชื่อ', async ({ page }) => {
    await loginAs(page, 'dean1');
    await goToMenu(page, 'profile');

    const card = page.getByTestId('personnel-signature-card');
    await expect(card).toContainText('ตั้งค่าแล้ว');
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByTestId('personnel-caseload')).toHaveCount(0);
    // คณบดีเห็นทุกสาขา — สาขาในแถว personnel (สาขาแรกของตารางตอนสร้างอัตโนมัติ) ต้องไม่โผล่มาหลอก
    await expect(page.getByTestId('personnel-profile-major')).toHaveText('ทุกสาขา (สิทธิ์ระดับคณะ)');

    await page.getByTestId('personnel-go-signature').click();
    await expect(page.getByRole('heading', { name: 'ลายมือชื่อสำหรับหนังสือราชการ' })).toBeVisible();
    await expect(page).toHaveURL(/menu=signature/);
  });

  /**
   * P8: การ์ด "นักศึกษาในความดูแล" ต้องนับจากคอลัมน์เดียวกับที่ `resolveViews` ใช้ตัดสินฝ่าย
   * (`students.advisor_id` / `supervisor_id`) — ตัวเลขกับเมนูที่เห็นจะไม่ขัดกัน
   * · แถวในการ์ด "หน้าที่ของคุณ" ต้องพาไปฝ่ายนั้นจริง ไม่ใช่ปุ่มตาย
   */
  test('P8 UI: ตัวเลขนักศึกษาในความดูแลตรงกับฐาน · แถวหน้าที่พาไปฝ่ายนั้น', async ({ page }) => {
    const advisees = await dbValue<number>('SELECT COUNT(*)::int FROM students WHERE advisor_id = $1', [advisor1]);
    const supervisees = await dbValue<number>('SELECT COUNT(*)::int FROM students WHERE supervisor_id = $1', [advisor1]);
    expect(supervisees).toBeGreaterThan(0); // seed: advisor1 นิเทศ student2 ด้วย

    await loginAs(page, 'advisor1');
    await goToMenu(page, 'profile');
    await expect(page.getByTestId('personnel-caseload-advisees')).toHaveText(String(advisees));
    await expect(page.getByTestId('personnel-caseload-supervisees')).toHaveText(String(supervisees));

    await page.getByTestId('personnel-duty-supervisor').click();
    await expect(page).toHaveURL(/role=supervisor/);
    await expect(page).not.toHaveURL(/menu=profile/);
  });

  /**
   * P9: จอมือถือ 375px — ตัวสลับฝ่ายแบบ pill เคยถูกบีบจน "อาจารย์ที่ปรึกษา" ตัดเป็นสามบรรทัด
   * และกระดิ่ง/อวาตาร์ล้นออกขวาจอ (เจ้าของทัก 2026-09-23) · ตอนนี้เป็น dropdown บนจอเล็ก
   */
  test('P9 UI มือถือ: ตัวสลับฝ่ายเป็น dropdown · Navbar ไม่ล้นจอ · สลับได้จริง', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, 'advisor1');

    const mobileSwitch = page.getByTestId('role-switch-mobile');
    await expect(mobileSwitch).toBeVisible();
    await expect(page.getByTestId('role-switcher-segmented')).toBeHidden();

    const overflow = await page.evaluate(() => {
      const nav = document.querySelector('nav')!;
      return [...nav.querySelectorAll('button, select')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => el.getBoundingClientRect().right)
        .filter((right) => right > window.innerWidth);
    });
    expect(overflow).toEqual([]);

    await mobileSwitch.selectOption('supervisor');
    await expect(page).toHaveURL(/role=supervisor/);
  });

  /**
   * P10-P12 · ใช้งานครั้งแรก (2026-09-24)
   * - `POST /profile/setup` แบบ personnel ปิดแล้ว (403) — ทางเดียวที่บุคลากรเลือกสาขาเองได้ และไม่มีหน้าจอเรียก
   * - บัญชีที่เจ้าหน้าที่สร้างเอง (ถือ role แต่ไม่มีแถว personnel) เคยค้าง: ฝ่ายอาจารย์ 403 ทุกหน้า
   *   และเจ้าหน้าที่แก้ให้ไม่ได้ · ตอนนี้เลือกสาขาในโมดัลแก้บัญชี = สร้างแถวให้
   * - วันเกิดตั้งเองได้ครั้งเดียว (`DeactivationScheduler` ปิดบัญชีตอนอายุ 60) หลังจากนั้นเจ้าหน้าที่แก้
   */
  const createStuckAdvisor = async () => {
    const email = 'noprofile@test.com';
    await dbExec('DELETE FROM users WHERE email = $1', [email]);
    await dbExec('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [email, await hashPassword('password123')]);
    const id = (await uid(email))!;
    await dbExec("INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'advisor')", [id]);
    return { email, id };
  };

  test('P10: บุคลากรเลือกสาขาเองทาง /profile/setup ไม่ได้ (403) · ไม่มีแถวเกิดขึ้น', async ({ request }) => {
    const { email, id } = await createStuckAdvisor();
    const login = await request.post(`${API_URL}/auth/login`, { data: { email, password: 'password123' } });
    expect(login.status(), await login.text()).toBe(200);

    const setup = await request.post(`${API_URL}/profile/setup`, {
      data: { type: 'personnel', major_id: otherMajor, first_name: 'แอบ', last_name: 'เลือกสาขา' },
    });
    expect(setup.status(), await setup.text()).toBe(403);
    expect(await dbValue('SELECT COUNT(*)::int FROM personnel WHERE personnel_id = $1', [id])).toBe(0);
  });

  test('P11 UI: บัญชีที่ไม่มีสาขา — เจ้าหน้าที่เลือกสาขาในโมดัลแล้วใช้งานฝ่ายอาจารย์ได้', async ({ page, request }) => {
    const { email, id } = await createStuckAdvisor();
    const login = await request.post(`${API_URL}/auth/login`, { data: { email, password: 'password123' } });
    expect(login.status()).toBe(200);
    // ก่อนแก้: ไม่รู้สาขา = fail closed (SEC-06)
    expect((await request.get(`${API_URL}/faculty/home/advisor?view=advisor`)).status()).toBe(403);

    // วันเกิดอย่างเดียวโดยไม่เลือกสาขา = ยังสร้างแถวไม่ได้
    await apiLoginAs(request, 'staff1');
    const noMajor = await request.put(`${API_URL}/users/${id}`, {
      data: { email, roles: ['advisor'], is_active: true, birth_date: '1980-01-01' },
    });
    expect(noMajor.status()).toBe(400);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');
    await page.getByTestId(`user-edit-${id}`).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('บัญชีนี้ยังไม่มีสาขา');
    await dialog.getByTestId('user-edit-major').selectOption(String(ownMajor));
    await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
    await expect(page.getByText(`อัปเดตข้อมูลบัญชี ${email} เรียบร้อยแล้ว`)).toBeVisible();

    expect(await majorOf(id)).toBe(ownMajor);
    await expect
      .poll(() =>
        dbValue(
          `SELECT COUNT(*)::int FROM audit_log
            WHERE action = 'user.updated' AND entity_id = $1 AND (detail->>'personnel_created')::boolean`,
          [id]
        )
      )
      .toBe(1);

    const relogin = await request.post(`${API_URL}/auth/login`, { data: { email, password: 'password123' } });
    expect(relogin.status()).toBe(200);
    expect((await request.get(`${API_URL}/faculty/home/advisor?view=advisor`)).status()).toBe(200);
  });

  test('P12: วันเกิดตั้งเองได้ครั้งเดียว · ครั้งต่อไปเมิน · เจ้าหน้าที่แก้ได้และลง audit · หน้าจอล็อกช่อง', async ({ page, request }) => {
    const birthOf = () => dbValue<string>('SELECT birth_date::text FROM personnel WHERE personnel_id = $1', [advisor1]);
    expect(await birthOf()).toBeNull();

    await apiLoginAs(request, 'advisor1');
    const first = await request.put(`${API_URL}/profile/personnel`, { multipart: { birth_date: '1980-05-15' } });
    expect(first.status()).toBe(200);
    expect(await birthOf()).toBe('1980-05-15');

    const again = await request.put(`${API_URL}/profile/personnel`, { multipart: { birth_date: '1999-01-01' } });
    expect(again.status()).toBe(200);
    expect(await birthOf()).toBe('1980-05-15');

    await apiLoginAs(request, 'staff1');
    const byStaff = await request.put(`${API_URL}/users/${advisor1}`, {
      data: { email: 'advisor1@test.com', roles: ['advisor'], is_active: true, birth_date: '1975-01-02' },
    });
    expect(byStaff.status(), await byStaff.text()).toBe(200);
    expect(await birthOf()).toBe('1975-01-02');
    await expect
      .poll(() =>
        dbValue(
          `SELECT COUNT(*)::int FROM audit_log
            WHERE action = 'user.updated' AND entity_id = $1
              AND detail->>'birth_date_before' = '1980-05-15' AND detail->>'birth_date_after' = '1975-01-02'`,
          [advisor1]
        )
      )
      .toBe(1);

    await loginAs(page, 'advisor1');
    await goToMenu(page, 'profile');
    await expect(page.getByTestId('personnel-birth-date')).toBeDisabled();
    await expect(page.getByTestId('personnel-birth-date-hint')).toContainText('แจ้งเจ้าหน้าที่');
  });

  test('P7 UI: เจ้าหน้าที่ย้ายสาขาบุคลากรจากโมดัลแก้บัญชี', async ({ page }) => {
    const otherName = await dbValue<string>('SELECT major_name_th FROM master_major WHERE major_id = $1', [otherMajor]);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'users');
    await page.getByTestId(`user-edit-${advisor1}`).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByTestId('user-edit-major').selectOption(String(otherMajor));
    await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
    await expect(page.getByText('อัปเดตข้อมูลบัญชี advisor1@test.com เรียบร้อยแล้ว')).toBeVisible();

    expect(await majorOf(advisor1)).toBe(otherMajor);

    // ฝั่งอาจารย์เห็นสาขาใหม่ทันที
    await loginAs(page, 'advisor1');
    await goToMenu(page, 'profile');
    await expect(page.getByTestId('personnel-profile-major')).toHaveText(otherName!);
  });
});
