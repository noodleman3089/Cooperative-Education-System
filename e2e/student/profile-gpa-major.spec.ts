import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { addSecondFaculty, withDb, dbRow, dbValue } from '../helpers/db';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * หน้าโปรไฟล์นักศึกษา — เกรดกับสาขาแก้เองได้ (เจ้าของเปลี่ยน SEC-05 เมื่อ 2026-10-04)
 *
 *   • เกรด: แก้ได้เสรี ตรวจช่วง 0.00–4.00 ที่เซิร์ฟเวอร์ · ไม่มีป้าย "แจ้งเอง" ไม่มีเกรดสองช่อง
 *   • สาขา: แก้ได้เฉพาะตอน **ไม่มีใบแจ้งความจำนงที่ยังเดินอยู่** · เปลี่ยนแล้วล้างที่ปรึกษา/อาจารย์นิเทศ
 *     เพราะสาขากำหนดว่าหัวหน้าสาขาคนไหนเห็นคำร้อง (`resolveMajorScope`)
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

/** สาขาใน**คณะอื่น** — หน้าโปรไฟล์กรองสาขาตามคณะ จึงต้องเปลี่ยนคณะก่อนถึงจะเห็นสาขานี้ */
const otherFacultyMajor = () =>
  dbRow<{ major_id: number; faculty_id: number }>(
    `SELECT m.major_id, m.faculty_id FROM master_major m
      WHERE m.faculty_id <> (SELECT mm.faculty_id FROM students s JOIN master_major mm ON mm.major_id = s.major_id
                              WHERE s.student_id = $1)
      ORDER BY m.major_id DESC LIMIT 1`,
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

  test('P1: แก้เกรดกับสาขาจากหน้าจอ → ลงฐาน · ล้างที่ปรึกษา · ลง audit · กล่องทะเบียนใหญ่หายไป', async ({ page }) => {
    await resetStudent2();
    // seed มีคณะเดียว — สร้างคณะที่สองไว้เป็นปลายทางของการย้าย
    await addSecondFaculty();
    // ย้ายข้ามคณะ — คุมด้วยว่าช่องคณะกรองรายการสาขาจริง (เลือกคณะก่อน สาขาของคณะนั้นถึงโผล่)
    const { major_id: target, faculty_id: targetFaculty } = (await otherFacultyMajor())!;
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
    await page.getByTestId('profile-gpa').fill('3.10');
    // สาขาของคณะอื่นต้องยังไม่อยู่ในรายการ จนกว่าจะเปลี่ยนคณะ
    await expect(page.getByTestId('profile-major').locator(`option[value="${target}"]`)).toHaveCount(0);
    await page.getByTestId('profile-faculty').selectOption(String(targetFaculty));
    await page.getByTestId('profile-major').selectOption(String(target));
    await page.getByTestId('profile-save').click();
    await expect(page.getByText('บันทึกข้อมูลส่วนตัวและเรซูเม่เรียบร้อยแล้ว')).toBeVisible();

    await withDb(async (db) => {
      const row = (await db.query(
        'SELECT cumulative_gpa, major_id, advisor_id, supervisor_id FROM students WHERE student_id = $1', [STUDENT_ID]
      )).rows[0];
      expect(Number(row.cumulative_gpa)).toBe(3.1);
      expect(row.major_id).toBe(target);
      expect(row.advisor_id).toBeNull();
      expect(row.supervisor_id).toBeNull();
    });

    // writeAudit เป็น fire-and-forget — แถวมาหลัง response
    await expect
      .poll(
        () => dbValue<number>(
          `SELECT COUNT(*)::int FROM audit_log
            WHERE action = 'student.registry_changed' AND entity_id = $1
              AND detail->>'changed_by' = 'student'
              AND (detail->>'major_id_after')::int = $2`,
          [String(STUDENT_ID), target]
        ),
        { timeout: 5000 }
      )
      .toBe(1);
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

  test('P3: มีใบแจ้งความจำนงที่เดินอยู่ → เปลี่ยนสาขาไม่ได้ (409) · ใบถูกปฏิเสธแล้วเปลี่ยนได้', async ({ request }) => {
    await resetStudent2();
    const target = (await otherMajorId())!;
    const original = (await dbValue<number>('SELECT major_id FROM students WHERE student_id = $1', [STUDENT_ID]))!;
    await apiLoginAs(request, 'student2');

    await insertIntent('pending_advisor');

    // เลือกสาขาเดิมซ้ำระหว่างมีใบค้าง ต้องไม่ถูกขวาง (ไม่ได้เปลี่ยนอะไร)
    const same = await request.put(`${API_URL}/profile/student`, { multipart: { major_id: String(original) } });
    expect(same.status()).toBe(200);

    const blocked = await request.put(`${API_URL}/profile/student`, {
      multipart: { major_id: String(target), cumulative_gpa: '1.00' },
    });
    expect(blocked.status()).toBe(409);
    // คำขอที่ตกด่านต้องไม่เขียนอะไรเลย — เกรดที่มาพร้อมกันก็ต้องไม่เข้า
    expect(await dbValue('SELECT major_id FROM students WHERE student_id = $1', [STUDENT_ID])).toBe(original);
    expect(Number(await dbValue('SELECT cumulative_gpa FROM students WHERE student_id = $1', [STUDENT_ID]))).toBe(3.75);

    // ใบที่ถูกปฏิเสธไม่นับว่าเดินอยู่
    await withDb(async (db) => {
      await db.query("UPDATE intent_forms SET status = 'rejected' WHERE student_id = $1", [STUDENT_ID]);
    });
    const allowed = await request.put(`${API_URL}/profile/student`, { multipart: { major_id: String(target) } });
    expect(allowed.status()).toBe(200);
    expect(await dbValue('SELECT major_id FROM students WHERE student_id = $1', [STUDENT_ID])).toBe(target);

    // สาขาที่ไม่มีอยู่จริง
    const missing = await request.put(`${API_URL}/profile/student`, { multipart: { major_id: '999999' } });
    expect(missing.status()).toBe(400);
  });
});
