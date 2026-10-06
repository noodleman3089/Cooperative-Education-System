import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import { hashPassword } from '../../backend/src/utils/password';
import { API_URL } from '../helpers/env';
import { withDb } from '../helpers/db';

/**
 * หน้ากรอกข้อมูลครั้งแรกของนักศึกษา — **ชั้นที่ 1**
 *
 * เจ้าของตัดสินเมื่อ 2026-09-07 ว่าการกรอกข้อมูลแบ่งสองชั้น: ข้อมูลทั่วไปตอนล็อกอินแรก
 * ส่วนเลขบัตรประชาชน/เชื้อชาติ/ศาสนา ขอตอนเริ่มยื่นเรื่องจริง เพราะ SEC-12 บังคับให้
 * เข้ารหัสและลบใน 90 วัน ระบบจึงต้องไม่ถือไว้ตั้งแต่วันแรกสำหรับคนที่สุดท้ายอาจไม่ได้ไปสหกิจ
 *
 * ไฟล์นี้คุมสี่อย่าง เรียงจากที่พังแล้วเจ็บที่สุด:
 *   1. ⛔ เส้นแบ่งชั้นที่ 1/ชั้นที่ 2 — หน้าจอต้องไม่มีช่องอ่อนไหว และ API ต้องไม่รับ
 *   2. เกรดที่นักศึกษากรอกลง `cumulative_gpa` ตรงๆ และถูกตรวจช่วง 0–4 ที่เซิร์ฟเวอร์ (SEC-05 แก้ 2026-10-04)
 *   3. ข้อมูลติดต่อที่ชั้นที่ 1 เก็บ ต้องลงฐานจริง (ก่อนหน้านี้ controller ส่ง null ทิ้งหมด)
 *   4. เดินไปขั้นที่ 2 แล้วย้อนกลับ ค่าที่กรอกต้องไม่หาย (ขั้นที่ 1 ถูก unmount)
 */

const NEW_STUDENT_EMAIL = 'freshstudent@test.com';
const NEW_STUDENT_CODE = '256799000001-7';

/**
 * บัญชีที่มีอยู่จริงแต่ยังไม่มี role และยังไม่มีแถวใน `students`
 * — คือสภาพของคนที่เพิ่งเข้าระบบครั้งแรกด้วย SSO
 *
 * session เป็น httpOnly cookie จึงปลอมด้วย localStorage ไม่ได้ ต้องล็อกอินจริงผ่าน API
 * ส่วน `isFirstTime` เป็นธงฝั่งหน้าจอ ไม่ได้อยู่ใน session — เขียนลง localStorage เอง
 */
async function arriveAsFirstTimeStudent(page: Page): Promise<number> {
  const client = await pool.connect();
  let userId: number;
  try {
    const hash = await hashPassword('password123');
    userId = (await client.query(
      `INSERT INTO users (email, password_hash, is_active) VALUES ($1, $2, TRUE)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE
       RETURNING user_id`,
      [NEW_STUDENT_EMAIL, hash]
    )).rows[0].user_id;
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM students WHERE student_id = $1', [userId]);
    await client.query('DELETE FROM students WHERE student_code = $1', [NEW_STUDENT_CODE]);
  } finally {
    client.release();
  }

  await page.goto('/');
  const res = await page.request.post(`${API_URL}/auth/login`, {
    data: { email: NEW_STUDENT_EMAIL, password: 'password123' },
  });
  expect(res.status()).toBe(200);

  await page.evaluate(({ id, mail }) => {
    localStorage.setItem('onboarding_type', 'student');
    localStorage.setItem('auth_user', JSON.stringify({
      userId: id,
      email: mail,
      roles: [],
      isFirstTime: true,
    }));
  }, { id: userId, mail: NEW_STUDENT_EMAIL });

  return userId;
}

/** กรอกขั้นที่ 1 ให้ครบแล้วกดไปขั้นที่ 2 */
async function fillStepOne(page: Page) {
  await page.getByTestId('onboarding-first-name').fill('ธนกฤต');
  await page.getByTestId('onboarding-last-name').fill('ศรีสุวรรณ');
  await page.getByTestId('onboarding-student-code').fill(NEW_STUDENT_CODE);
  // ⛔ ปีต้อง > 2565 ไม่งั้น DeactivationScheduler ปิดบัญชีกลางเทสต์ (กฎ e2e ข้อ 12)
  await page.getByTestId('onboarding-enrollment-year').fill('2567');
  // คณะต้องเลือกก่อน — ช่องสาขาปิดอยู่จนกว่าจะเลือกคณะ และแสดงเฉพาะสาขาของคณะนั้น
  await page.getByTestId('onboarding-faculty').selectOption({ index: 1 });
  await page.getByTestId('onboarding-major').selectOption({ index: 1 });
  await page.getByTestId('onboarding-gpa').fill('3.25');
  await page.getByTestId('onboarding-phone').fill('081-234-5678');
  await page.getByTestId('onboarding-alt-email').fill('thanakrit.s@example.com');
}

test.describe('กรอกข้อมูลครั้งแรกของนักศึกษา (ชั้นที่ 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps");',
      });
    });
  });

  test('O1: ⛔ ชั้นที่ 1 ต้องไม่มีช่องข้อมูลอ่อนไหวอยู่บนจอเลย', async ({ page }) => {
    await seedTestData();
    await arriveAsFirstTimeStudent(page);
    await page.goto('/onboarding/student');

    await expect(page.getByTestId('onboarding-first-name')).toBeVisible();

    // เส้นแบ่งทั้งหมดของการออกแบบนี้อยู่ที่บรรทัดนี้ — เติมช่องพวกนี้เข้ามาเมื่อไหร่
    // ระบบจะถือเลขบัตรของคนที่ยังไม่รู้ด้วยซ้ำว่าจะได้ไปสหกิจไหม
    //
    // ⛔ วัดที่ **ช่องกรอก** ไม่ใช่ที่ข้อความบนหน้า — กล่องสีเหลืองพูดถึงสามคำนี้อยู่
    // โดยตั้งใจ (เพื่อบอกผู้ใช้ว่าจะถูกขอเมื่อไหร่) การเช็ค innerText จึงแดงผิดจุด
    const sensitiveFieldLabels = await page.evaluate(() => {
      const words = ['เลขบัตร', 'ประจำตัวประชาชน', 'เชื้อชาติ', 'สัญชาติ', 'ศาสนา'];
      return [...document.querySelectorAll('input, select, textarea')]
        .map(el => (el.closest('div')?.textContent || '') + ' ' + (el.getAttribute('placeholder') || ''))
        .filter(text => words.some(w => text.includes(w)));
    });
    expect(sensitiveFieldLabels).toEqual([]);

    // และต้องบอกผู้ใช้ว่าจะถูกขอเมื่อไหร่ ไม่ใช่เงียบแล้วไปโผล่กลางทาง
    await expect(page.getByText('ยังไม่ต้องกรอกตอนนี้', { exact: false })).toBeVisible();
  });

  test('O2: เกรดที่นักศึกษากรอกตอนตั้งค่าครั้งแรกลง cumulative_gpa ตรงๆ (SEC-05 แก้ 2026-10-04)', async ({ page }) => {
    await seedTestData();
    const userId = await arriveAsFirstTimeStudent(page);

    const majorId = await withDb(async db =>
      (await db.query('SELECT major_id FROM master_major LIMIT 1')).rows[0].major_id
    );

    const res = await page.request.post(`${API_URL}/profile/setup`, {
      data: {
        type: 'student',
        student_code: NEW_STUDENT_CODE,
        major_id: majorId,
        enrollment_year: 2567,
        first_name: 'ธนกฤต',
        last_name: 'ศรีสุวรรณ',
        cumulative_gpa: 3.25,
        password: 'Passw0rd1',
      },
    });
    expect(res.status()).toBe(201);

    await withDb(async db => {
      const row = (await db.query(
        'SELECT cumulative_gpa FROM students WHERE student_id = $1', [userId]
      )).rows[0];
      expect(Number(row.cumulative_gpa)).toBe(3.25);
    });
  });

  test('O2b: เกรดนอกช่วง 0–4 ต้องถูกปฏิเสธที่เซิร์ฟเวอร์ ไม่ใช่แค่ที่หน้าจอ', async ({ page }) => {
    await seedTestData();
    await arriveAsFirstTimeStudent(page);

    const majorId = await withDb(async db =>
      (await db.query('SELECT major_id FROM master_major LIMIT 1')).rows[0].major_id
    );

    const res = await page.request.post(`${API_URL}/profile/setup`, {
      data: {
        type: 'student',
        student_code: NEW_STUDENT_CODE,
        major_id: majorId,
        enrollment_year: 2567,
        cumulative_gpa: 4.5,
        password: 'Passw0rd1',
      },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('0.00 ถึง 4.00');
  });

  /**
   * ⛔ คำขอที่ตกด่านตรวจต้องไม่เขียนอะไรลงฐานเลย (2026-09-23)
   * เดิม `setupProfile` เขียนรหัสผ่านก่อนตรวจรหัสนักศึกษา และตรวจเกรดหลังสร้างแถว students
   * → ได้ 400 แต่รหัสผ่านเปลี่ยนไปแล้ว / แถวค้างโดยไม่มี role จนส่งใหม่ไม่ได้อีก
   */
  test('O2d: ตกด่านตรวจทีหลัง → รหัสผ่านไม่เปลี่ยน และไม่มีแถว students ค้าง · แก้แล้วส่งใหม่ได้', async ({ page }) => {
    await seedTestData();
    const userId = await arriveAsFirstTimeStudent(page);

    const majorId = await withDb(async db =>
      (await db.query('SELECT major_id FROM master_major LIMIT 1')).rows[0].major_id
    );
    const readState = () => withDb(async db => ({
      hash: (await db.query('SELECT password_hash FROM users WHERE user_id = $1', [userId])).rows[0].password_hash,
      students: (await db.query('SELECT 1 FROM students WHERE student_id = $1', [userId])).rowCount,
    }));
    const before = await readState();

    // รหัสนักศึกษาของ student2 — ถูกใช้แล้ว
    const taken = await page.request.post(`${API_URL}/profile/setup`, {
      data: { type: 'student', student_code: '640101001', major_id: majorId, enrollment_year: 2567, password: 'NewPassw0rd' },
    });
    expect(taken.status(), await taken.text()).toBe(400);
    expect(await readState()).toEqual(before);

    const badGpa = await page.request.post(`${API_URL}/profile/setup`, {
      data: { type: 'student', student_code: NEW_STUDENT_CODE, major_id: majorId, enrollment_year: 2567, cumulative_gpa: 4.5, password: 'NewPassw0rd' },
    });
    expect(badGpa.status(), await badGpa.text()).toBe(400);
    expect(await readState()).toEqual(before);

    // ไม่มีอะไรค้าง → แก้ค่าแล้วส่งใหม่ต้องผ่าน (เดิมได้ "ตั้งค่าเรียบร้อยแล้ว" เพราะแถวค้าง)
    const fixed = await page.request.post(`${API_URL}/profile/setup`, {
      data: { type: 'student', student_code: NEW_STUDENT_CODE, major_id: majorId, enrollment_year: 2567, cumulative_gpa: 3.5, password: 'NewPassw0rd' },
    });
    expect(fixed.status(), await fixed.text()).toBe(201);
    const after = await readState();
    expect(after.students).toBe(1);
    expect(after.hash).not.toBe(before.hash);
  });

  // เดิมหน้าจอบังคับ 8 ตัว + พิมพ์ใหญ่/เล็ก/ตัวเลข แต่ API ตรวจแค่ 6 ตัว (2026-09-23)
  test('O2c: รหัสผ่านที่หน้าจอไม่ยอมรับ ต้องถูกปฏิเสธที่เซิร์ฟเวอร์ด้วย · ไม่มีอะไรถูกบันทึก', async ({ page }) => {
    await seedTestData();
    const userId = await arriveAsFirstTimeStudent(page);

    const majorId = await withDb(async db =>
      (await db.query('SELECT major_id FROM master_major LIMIT 1')).rows[0].major_id
    );
    const hashBefore = await withDb(async db =>
      (await db.query('SELECT password_hash FROM users WHERE user_id = $1', [userId])).rows[0].password_hash
    );

    for (const [password, expected] of [
      ['Abc123', 'อย่างน้อย 8 ตัวอักษร'],
      ['password123', 'ตัวพิมพ์ใหญ่'],
      ['PASSWORD123', 'ตัวพิมพ์ใหญ่'],
      ['Passwordxx', 'ตัวพิมพ์ใหญ่'],
    ]) {
      const res = await page.request.post(`${API_URL}/profile/setup`, {
        data: {
          type: 'student',
          student_code: NEW_STUDENT_CODE,
          major_id: majorId,
          enrollment_year: 2567,
          password,
        },
      });
      expect(res.status(), password).toBe(400);
      expect(await res.text(), password).toContain(expected);
    }

    await withDb(async db => {
      const students = await db.query('SELECT 1 FROM students WHERE student_id = $1', [userId]);
      expect(students.rowCount).toBe(0);
      const hashAfter = (await db.query('SELECT password_hash FROM users WHERE user_id = $1', [userId])).rows[0].password_hash;
      expect(hashAfter).toBe(hashBefore);
    });
  });

  test('O3: ข้อมูลติดต่อที่กรอกในขั้นที่ 1 ต้องลงฐานจริง · ไม่มีส่วน "งานที่สนใจ" ให้กรอกแล้ว', async ({ page }) => {
    await seedTestData();
    const userId = await arriveAsFirstTimeStudent(page);
    await page.goto('/onboarding/student');

    // ถอดออก 2026-10-05 — หน้าจอเคยบอกว่า "ระบบใช้จับคู่ตำแหน่งงานให้" ทั้งที่ไม่มีอะไรจับคู่จริง
    await expect(page.getByTestId('onboarding-first-name')).toBeVisible();
    await expect(page.getByText('งานที่สนใจ')).toHaveCount(0);
    await expect(page.getByTestId('onboarding-region')).toHaveCount(0);

    await fillStepOne(page);
    await page.getByTestId('onboarding-next').click();

    await page.getByTestId('onboarding-password').fill('Passw0rd1');
    await page.getByTestId('onboarding-confirm-password').fill('Passw0rd1');
    await page.getByTestId('onboarding-submit').click();
    // ค่าทะเบียนแก้เองไม่ได้หลังบันทึก — ต้องผ่านกล่องยืนยันก่อน (2026-09-21)
    await page.getByTestId('onboarding-confirm').click();

    await page.waitForURL('**/dashboard', { timeout: 15_000 });

    await withDb(async db => {
      const row = (await db.query(
        `SELECT first_name, last_name, phone, alt_email, cumulative_gpa, interested_job_types
         FROM students WHERE student_id = $1`,
        [userId]
      )).rows[0];

      // ก่อน 2026-09-07 controller ส่ง null เข้าไปทุกช่อง นักศึกษาจึงต้องไปกรอกชื่อ
      // ตัวเองซ้ำในหน้าโปรไฟล์ ทั้งที่เพิ่งกรอกไปเมื่อครู่
      expect(row.first_name).toBe('ธนกฤต');
      expect(row.last_name).toBe('ศรีสุวรรณ');
      expect(row.phone).toBe('081-234-5678');
      expect(row.alt_email).toBe('thanakrit.s@example.com');
      expect(Number(row.cumulative_gpa)).toBe(3.25);
      expect(row.interested_job_types).toBeNull();
    });
  });

  test('O4: ย้อนกลับจากขั้นที่ 2 แล้วค่าที่กรอกไว้ต้องยังอยู่ครบ', async ({ page }) => {
    await seedTestData();
    await arriveAsFirstTimeStudent(page);
    await page.goto('/onboarding/student');

    await fillStepOne(page);
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByTestId('onboarding-password')).toBeVisible();

    // ขั้นที่ 1 ถูก unmount ตอนไปขั้นที่ 2 — ค่าอยู่ใน state ของหน้า ไม่ใช่ใน DOM
    // ถ้าใครเผลอย้ายไปเก็บใน DOM เมื่อไหร่ เทสต์นี้จะจับได้
    await page.getByRole('button', { name: 'ย้อนกลับ' }).click();

    await expect(page.getByTestId('onboarding-first-name')).toHaveValue('ธนกฤต');
    await expect(page.getByTestId('onboarding-student-code')).toHaveValue(NEW_STUDENT_CODE);
    await expect(page.getByTestId('onboarding-phone')).toHaveValue('081-234-5678');
    await expect(page.getByTestId('onboarding-alt-email')).toHaveValue('thanakrit.s@example.com');
  });

  test('O4b: เลือกคณะก่อน แล้วเห็นเฉพาะสาขาของคณะนั้น · เปลี่ยนคณะแล้วสาขาที่เลือกไว้ถูกล้าง', async ({ page }) => {
    await seedTestData();
    await arriveAsFirstTimeStudent(page);
    await page.goto('/onboarding/student');

    // seed มีสาขาเฉพาะของคณะบริหารธุรกิจฯ (คณะศิลปศาสตร์ยังไม่มีรายชื่อสาขา) — ใส่สาขาทดสอบให้คณะที่สอง
    // เพื่อให้มีสองคณะที่เลือกได้จริง
    await withDb(db =>
      db.query(
        `INSERT INTO master_major (faculty_id, major_code, major_name_th)
         SELECT faculty_id, v.code, v.name
           FROM master_faculty CROSS JOIN (VALUES ('TST01', 'สาขาวิชาทดสอบ ก'), ('TST02', 'สาขาวิชาทดสอบ ข')) AS v(code, name)
          WHERE faculty_name_th = 'คณะศิลปศาสตร์'`
      )
    );

    // คณะที่มีสาขามากกว่าหนึ่ง กับอีกคณะหนึ่ง — อ่านจากฐาน ไม่ผูกกับชื่อใน seed
    const faculties = await withDb(async db =>
      (await db.query(
        `SELECT f.faculty_id, f.faculty_name_th,
                array_agg(m.major_name_th ORDER BY m.major_id) AS majors
           FROM master_faculty f JOIN master_major m ON m.faculty_id = f.faculty_id
          GROUP BY f.faculty_id ORDER BY COUNT(*) DESC, f.faculty_id LIMIT 2`
      )).rows as { faculty_id: number; faculty_name_th: string; majors: string[] }[]
    );
    const [first, second] = faculties;

    const major = page.getByTestId('onboarding-major');
    await expect(major).toBeDisabled();

    await page.getByTestId('onboarding-faculty').selectOption(String(first.faculty_id));
    await expect(major).toBeEnabled();
    // ตัวเลือกแรกคือ placeholder ที่เหลือต้องเป็นสาขาของคณะนี้ครบและไม่มีของคณะอื่น
    expect((await major.locator('option').allTextContents()).slice(1).map(t => t.trim())).toEqual(first.majors);

    await major.selectOption({ index: 1 });
    await page.getByTestId('onboarding-faculty').selectOption(String(second.faculty_id));
    await expect(major).toHaveValue('');
    expect((await major.locator('option').allTextContents()).slice(1).map(t => t.trim())).toEqual(second.majors);

    // ไม่เลือกสาขา = ไปขั้นถัดไปไม่ได้
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByText('กรุณาเลือกสาขาวิชาที่สังกัด')).toBeVisible();
  });

  test('O5: กล่องยืนยันแสดงค่าทะเบียนจริง · กลับไปแก้แล้วไม่มีอะไรถูกบันทึก', async ({ page }) => {
    await seedTestData();
    const userId = await arriveAsFirstTimeStudent(page);
    await page.goto('/onboarding/student');

    await fillStepOne(page);
    const majorName = (await page.getByTestId('onboarding-major').locator('option:checked').textContent())!.trim();
    const facultyName = (await page.getByTestId('onboarding-faculty').locator('option:checked').textContent())!.trim();
    await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-password').fill('Passw0rd1');
    await page.getByTestId('onboarding-confirm-password').fill('Passw0rd1');
    await page.getByTestId('onboarding-submit').click();

    // ⛔ กล่องต้องแสดงค่าที่กำลังจะถูกล็อก ไม่ใช่ "แน่ใจไหม" ลอย ๆ
    const summary = page.getByTestId('confirm-summary');
    await expect(summary).toContainText(NEW_STUDENT_CODE);
    await expect(summary).toContainText(majorName);
    await expect(summary).toContainText(facultyName);
    await expect(summary).toContainText('2567');
    await expect(summary).toContainText('แก้เองไม่ได้');

    await page.getByTestId('onboarding-confirm-cancel').click();
    await expect(page.getByTestId('confirm-summary')).toHaveCount(0);
    expect(
      await withDb(async db => (await db.query('SELECT 1 FROM students WHERE student_id = $1', [userId])).rowCount)
    ).toBe(0);

    await page.getByTestId('onboarding-submit').click();
    await page.getByTestId('onboarding-confirm').click();
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    expect(
      await withDb(async db => (await db.query('SELECT student_code FROM students WHERE student_id = $1', [userId])).rows[0]?.student_code)
    ).toBe(NEW_STUDENT_CODE);
  });
});
