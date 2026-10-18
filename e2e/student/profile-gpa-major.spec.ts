import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbValue } from '../helpers/db';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * หน้าโปรไฟล์นักศึกษา — เกรดกับสาขาแก้เองได้ (เจ้าของเปลี่ยน SEC-05 เมื่อ 2026-10-04)
 *
 *   • เกรด: แก้ได้เสรี ตรวจช่วง 0.00–4.00 ที่เซิร์ฟเวอร์ · ไม่มีป้าย "แจ้งเอง" ไม่มีเกรดสองช่อง
 *   • สาขา: ⚠️ 2026-10-18 เจ้าของสั่ง**ล็อก** — หน้าจอเป็นช่องอ่านอย่างเดียว (P1) และ `PUT /profile/student`
 *     เมิน `major_id` ทุกกรณี (P3) เพราะสาขากำหนดว่าหัวหน้าสาขาคนไหนเห็นคำร้อง (`resolveMajorScope`)
 *     · เจ้าหน้าที่แก้ที่ `PUT /students/:id/registry` (คุมที่ staff/registry-fields)
 *   • รหัสนักศึกษากับปีที่เข้ายังล็อก — คุมที่ security-hardening SEC-05 และ staff/registry-fields
 *
 * ⛔ enrollment_year ต้อง > 2565 ไม่งั้น DeactivationScheduler ปิดบัญชีกลางเทสต์ (กฎ e2e ข้อ 12)
 */

const STUDENT_ID = 2;

async function resetStudent2() {
  await seedTestData();
  await withDb(async (db) => {
    await db.query('UPDATE students SET enrollment_year = 2568, cumulative_gpa = 3.75 WHERE student_id = $1', [STUDENT_ID]);
    await db.query('DELETE FROM intent_forms WHERE student_id = $1', [STUDENT_ID]);
  });
}

const otherMajorId = () =>
  dbValue<number>(
    'SELECT major_id FROM master_major WHERE major_id <> (SELECT major_id FROM students WHERE student_id = $1) ORDER BY major_id LIMIT 1',
    [STUDENT_ID]
  );

async function insertIntent(status: string) {
  await withDb(async (db) => {
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0]
      .semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
    await db.query(
      'INSERT INTO intent_forms (student_id, company_id, semester_id, status) VALUES ($1, $2, $3, $4)',
      [STUDENT_ID, companyId, semesterId, status]
    );
  });
}

test.describe('โปรไฟล์นักศึกษา: เกรดและสาขาแก้เองได้', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/javascript', body: 'console.log("Mocked Google Maps");' });
    });
  });

  test('P1: แก้เกรดจากหน้าจอ → ลงฐาน · คณะและสาขาเป็นช่องอ่านอย่างเดียว (เจ้าของตั้งใจล็อก) ไม่ล้างที่ปรึกษา', async ({ page }) => {
    await resetStudent2();
    const original = (await dbValue<number>('SELECT major_id FROM students WHERE student_id = $1', [STUDENT_ID]))!;
    await withDb(async (db) => {
      const advisor = (await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")).rows[0].user_id;
      await db.query('UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2', [advisor, STUDENT_ID]);
    });

    await loginAs(page, 'student2');
    await goToMenu(page, 'profile');

    // กล่องทะเบียนเดิม (เกรดสองช่อง · ป้าย "แก้เองไม่ได้" · คณะ) ต้องไม่อยู่แล้ว
    await expect(page.getByTestId('profile-registry-block')).toHaveCount(0);
    await expect(page.getByText('เกรดที่คุณแจ้งไว้ตอนกรอกข้อมูลครั้งแรก')).toHaveCount(0);

    await expect(page.getByTestId('profile-gpa')).toHaveValue('3.75');
    // โหมด dev (StrictMode) โหลดโปรไฟล์สองรอบ — รอบสองที่มาถึงช้าจะเขียนทับค่าที่เพิ่งพิมพ์ (เคยแดงแบบสุ่ม 2026-10-06)
    // รอให้คำขอทั้งหมดจบก่อนเริ่มพิมพ์
    await page.waitForLoadState('networkidle');
    // ⚠️ 2026-10-18 หน้าจอล็อกคณะ/สาขา (เจ้าของตั้งใจ) — เป็น <input readonly> ไม่ใช่ <select> อีกแล้ว
    //    ถ้าจะคืนการเลือกสาขาเองบนหน้าจอ เทสต์นี้ต้องแดง (ฝั่ง API เมิน major_id — คุมที่ P3)
    for (const id of ['profile-faculty', 'profile-major']) {
      const field = page.getByTestId(id);
      await expect(field).toHaveJSProperty('readOnly', true);
      expect(await field.evaluate((el) => el.tagName)).toBe('INPUT');
    }

    await page.getByTestId('profile-gpa').fill('3.10');
    await page.getByTestId('profile-save').click();
    await expect(page.getByText('บันทึกข้อมูลส่วนตัวและเรซูเม่เรียบร้อยแล้ว')).toBeVisible();

    await withDb(async (db) => {
      const row = (await db.query(
        'SELECT cumulative_gpa, major_id, advisor_id, supervisor_id FROM students WHERE student_id = $1', [STUDENT_ID]
      )).rows[0];
      expect(Number(row.cumulative_gpa)).toBe(3.1);
      // สาขาไม่เปลี่ยน → ที่ปรึกษา/อาจารย์นิเทศต้องไม่ถูกล้างตาม
      expect(row.major_id).toBe(original);
      expect(row.advisor_id).not.toBeNull();
      expect(row.supervisor_id).not.toBeNull();
    });
  });

  test('P2: เกรดนอกช่วง 0–4 ถูกปฏิเสธที่เซิร์ฟเวอร์ · ว่าง = คงค่าเดิม', async ({ request }) => {
    await resetStudent2();
    await apiLoginAs(request, 'student2');

    for (const bad of ['4.01', '-0.5', 'abc']) {
      const res = await request.put(`${API_URL}/profile/student`, { multipart: { cumulative_gpa: bad } });
      expect(res.status(), bad).toBe(400);
      expect(await res.text(), bad).toContain('0.00 ถึง 4.00');
    }
    expect(Number(await dbValue('SELECT cumulative_gpa FROM students WHERE student_id = $1', [STUDENT_ID]))).toBe(3.75);

    const keep = await request.put(`${API_URL}/profile/student`, { multipart: { cumulative_gpa: '', nickname: 'x' } });
    expect(keep.status()).toBe(200);
    expect(Number(await dbValue('SELECT cumulative_gpa FROM students WHERE student_id = $1', [STUDENT_ID]))).toBe(3.75);

    const ok = await request.put(`${API_URL}/profile/student`, { multipart: { cumulative_gpa: '2.5' } });
    expect(ok.status()).toBe(200);
    expect(Number(await dbValue('SELECT cumulative_gpa FROM students WHERE student_id = $1', [STUDENT_ID]))).toBe(2.5);
  });

  test('P3: ส่ง major_id มาที่ API ก็ไม่เปลี่ยน — เมินทุกสถานะ (ไม่มีใบ · ใบเดินอยู่ · ใบถูกปฏิเสธ) ช่องอื่นยังบันทึก', async ({ request }) => {
    await resetStudent2();
    const target = (await otherMajorId())!;
    const original = (await dbValue<number>('SELECT major_id FROM students WHERE student_id = $1', [STUDENT_ID]))!;
    await withDb(async (db) => {
      const advisor = (await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")).rows[0].user_id;
      await db.query('UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2', [advisor, STUDENT_ID]);
    });
    await apiLoginAs(request, 'student2');

    const majorNow = () => dbValue('SELECT major_id FROM students WHERE student_id = $1', [STUDENT_ID]);
    const auditCount = () =>
      dbValue<number>(
        `SELECT COUNT(*)::int FROM audit_log
          WHERE action = 'student.registry_changed' AND entity_id = $1 AND detail ? 'major_id_after'`,
        [String(STUDENT_ID)]
      );

    // ⛔ ล็อกอีกครั้ง 2026-10-18 (เจ้าของสั่ง · SEC-05) — สาขากำหนดว่าหัวหน้าสาขาคนไหนเห็นคำร้อง
    //    เมินทุกกรณี ไม่ใช่ปฏิเสธ: คำขอเดียวกันที่มีช่องอื่นมาด้วยต้องบันทึกช่องอื่นต่อได้ (หน้าเก่าที่ยังส่ง major_id ไม่แตก)
    for (const state of ['none', 'pending_advisor', 'rejected'] as const) {
      if (state === 'pending_advisor') await insertIntent('pending_advisor');
      if (state === 'rejected') {
        await withDb(async (db) => {
          await db.query("UPDATE intent_forms SET status = 'rejected' WHERE student_id = $1", [STUDENT_ID]);
        });
      }
      const res = await request.put(`${API_URL}/profile/student`, {
        multipart: { major_id: String(target), nickname: `ชื่อเล่น-${state}` },
      });
      expect(res.status(), `${state}: ${await res.text()}`).toBe(200);
      expect(await majorNow(), state).toBe(original);
      expect(await dbValue('SELECT nickname FROM students WHERE student_id = $1', [STUDENT_ID]), state).toBe(`ชื่อเล่น-${state}`);
    }

    // สาขาที่ไม่มีอยู่จริง / ค่าไม่ใช่ตัวเลข ก็ถูกเมินเช่นกัน (ไม่ใช่ 400)
    for (const bad of ['999999', 'abc']) {
      const res = await request.put(`${API_URL}/profile/student`, { multipart: { major_id: bad } });
      expect(res.status(), bad).toBe(200);
      expect(await majorNow(), bad).toBe(original);
    }

    // ที่ปรึกษา/อาจารย์นิเทศไม่ถูกล้าง และไม่มี audit ว่าเปลี่ยนสาขา
    expect(
      (await withDb(async (db) =>
        (await db.query('SELECT advisor_id, supervisor_id FROM students WHERE student_id = $1', [STUDENT_ID])).rows[0]
      )).advisor_id
    ).not.toBeNull();
    expect(await auditCount()).toBe(0);
  });
});
