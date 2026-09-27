import { test, expect } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { withDb } from '../helpers/db';

/**
 * ปุ่ม "พิมพ์ใบ 07 (PDF)" — `GET /api/form07/print`
 *
 * เดิมปุ่มนี้อยู่บนจอแต่ไม่มี route ข้างหลัง กดแล้วได้ 404 (พบ 2026-09-21)
 * · คุมสามเรื่อง: บริษัทพิมพ์ได้และได้ PDF จริง · role อื่นพิมพ์ไม่ได้ · ปุ่มบนจอเปิด PDF ได้จริง
 * · บริษัทมาจาก token เท่านั้น — route ไม่รับ `:id` จึงไม่มีทางขอใบของบริษัทอื่น
 */

/** นักศึกษาที่ตอบรับแล้ว (student2 — seed มีโปรไฟล์ `students` แค่คนนี้) พร้อมลักษณะงานภาษาไทยยาวพอให้ตัดบรรทัดในตาราง */
async function acceptStudentAtCompany(): Promise<void> {
  await withDb(async (db) => {
    const studentId = (await db.query(`SELECT user_id FROM users WHERE email = 'student2@test.com'`)).rows[0].user_id;
    const company = (await db.query(
      `SELECT c.company_id FROM companies c JOIN users u ON u.user_id = c.created_by
        WHERE u.email = 'company1@test.com' ORDER BY c.company_id LIMIT 1`
    )).rows[0];
    const job = await db.query('SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1', [company.company_id]);
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
    await db.query(
      `UPDATE companies SET contact_mode = 'delegate', contact_person = 'สมหญิง ประสานดี' WHERE company_id = $1`,
      [company.company_id]
    );
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, start_date,
                                 job_position, job_description)
       VALUES ($1, $2, $3, $4, 'accepted', CURRENT_DATE, 'นักพัฒนาซอฟต์แวร์ฝึกหัด',
               'พัฒนาระบบจัดการคลังสินค้าภายในองค์กรด้วยเว็บแอปพลิเคชัน ออกแบบฐานข้อมูลและเขียนเอกสารประกอบการใช้งานสำหรับผู้ใช้ทุกฝ่าย')`,
      [studentId, company.company_id, semester.rows[0].semester_id, job.rows[0]?.job_id ?? null]
    );
  });
}

test.describe('สหกิจ 07 — พิมพ์ PDF หน้า 1–2', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('บริษัทพิมพ์ใบของตัวเองได้ และได้ PDF จริง', async ({ request }) => {
    await acceptStudentAtCompany();
    await apiLoginAs(request, 'company1');
    const res = await request.get(`${API_URL}/form07/print`);
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    const body = await res.body();
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('role อื่นพิมพ์ไม่ได้ · ไม่ล็อกอินพิมพ์ไม่ได้', async ({ request, playwright }) => {
    const anon = await playwright.request.newContext();
    expect((await anon.get(`${API_URL}/form07/print`)).status()).toBe(401);
    await anon.dispose();

    for (const who of ['student1', 'staff1'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(`${API_URL}/form07/print`)).status(), who).toBe(403);
    }
  });

  test('ปุ่มบนหน้าจอเปิด PDF ได้จริง ไม่ใช่ 404', async ({ page }) => {
    await loginAs(page, 'company1');
    await goToMenu(page, 'form07');

    // ฟังระดับ context ก่อนกด — แท็บใหม่ยิงคำขอเร็วกว่าที่จะผูก listener บน popup ทัน
    const [response] = await Promise.all([
      page.context().waitForEvent('response', (r) => r.url().includes('/api/form07/print')),
      page.getByTestId('form07-print').click(),
    ]);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
  });
});
