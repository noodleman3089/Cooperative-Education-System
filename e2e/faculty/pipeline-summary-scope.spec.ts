import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * `GET /intents/pipeline-summary` — ตัวเลขนับใบความจำนงแยกสถานะ
 *
 * ⛔ SEC-06: เดิมไม่กรองสาขาเลย อาจารย์/หัวหน้าสาขาได้ตัวเลขทั้งคณะ (2026-09-22 แก้)
 * advisor/dept_head เห็นเฉพาะสาขาตัวเอง · staff/dean เห็นทั้งคณะ · ไม่มีโปรไฟล์ = 403
 */
test.describe('pipeline-summary กรองตามสาขา (SEC-06)', () => {
  test.beforeEach(async () => {
    await seedTestData();
  });

  test('P1: ใบของนักศึกษาสาขาหนึ่ง — อาจารย์สาขาเดียวกันและเจ้าหน้าที่นับเห็น · อาจารย์คนละสาขาไม่เห็น', async ({
    request,
  }) => {
    const studentId = await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'");
    const studentMajor = await dbValue<number>('SELECT major_id FROM students WHERE student_id = $1', [studentId]);
    const advisor2Major = await dbValue<number>(
      "SELECT p.major_id FROM personnel p JOIN users u ON u.user_id = p.personnel_id WHERE u.email = 'advisor2@test.com'"
    );
    // สมมติฐานของเทสต์: seeder ให้ advisor2 อยู่คนละสาขากับ student2 — ถ้าเปลี่ยน เทสต์นี้ไม่พิสูจน์อะไร
    expect(advisor2Major).not.toBe(studentMajor);

    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status)
       VALUES ($1, (SELECT company_id FROM companies LIMIT 1),
               (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1),
               (SELECT job_id FROM job_posts LIMIT 1), 'rejected')`,
      [studentId]
    );
    const total = await dbValue<number>("SELECT COUNT(*)::int FROM intent_forms WHERE status = 'rejected'");
    expect(total).toBeGreaterThan(0);

    const rejectedFor = async (account: 'staff1' | 'advisor1' | 'advisor2' | 'dean1') => {
      await apiLoginAs(request, account);
      const res = await request.get(`${API_URL}/intents/pipeline-summary`);
      expect(res.status(), account).toBe(200);
      return (await res.json()).rejected as number;
    };

    expect(await rejectedFor('staff1')).toBe(total);
    expect(await rejectedFor('dean1')).toBe(total);
    expect(await rejectedFor('advisor1')).toBeGreaterThan(0);
    expect(await rejectedFor('advisor2')).toBe(0);
  });

  test('P2: อาจารย์ที่ไม่มีโปรไฟล์บุคลากร → 403 ไม่ใช่ตัวเลขทั้งคณะ (fail closed)', async ({ request }) => {
    await dbExec(
      "DELETE FROM personnel WHERE personnel_id = (SELECT user_id FROM users WHERE email = 'advisor2@test.com')"
    );
    await apiLoginAs(request, 'advisor2');
    const res = await request.get(`${API_URL}/intents/pipeline-summary`);
    expect(res.status()).toBe(403);
  });
});
