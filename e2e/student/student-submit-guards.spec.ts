import { test, expect } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbValue, withDb } from '../helpers/db';

/**
 * ด่านของการส่งที่นักศึกษาแก้เองไม่ได้ — พบตอนออกแบบกล่องยืนยัน 7 จุด (2026-09-22)
 *
 *   1. ปุ่ม "บันทึกร่าง" โครงร่าง (สหกิจ 11) เคย POST จริง = ส่งถึงพี่เลี้ยง · backend ไม่มีสถานะร่าง
 *      → ร่างเก็บในเครื่อง ไม่แตะฐาน
 *   2. ส่งโครงร่างทับใบที่พี่เลี้ยงเห็นชอบ/อาจารย์อนุมัติแล้วได้ = ล้างการอนุมัติเงียบ ๆ → 409
 *   3. ขอใบรับรอง สหกิจ 14 ซ้ำหลังอาจารย์รับรองแล้ว = ลบการรับรองทิ้ง → 409
 */

async function acceptedStudent2(): Promise<{ studentId: number; companyId: number }> {
  return withDb(async (db) => {
    const studentId = (await db.query(`SELECT user_id FROM users WHERE email = 'student2@test.com'`)).rows[0].user_id;
    const companyId = (await db.query('SELECT company_id FROM companies ORDER BY company_id LIMIT 1')).rows[0].company_id;
    const job = await db.query('SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1', [companyId]);
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, start_date)
       VALUES ($1, $2, $3, $4, 'accepted', CURRENT_DATE)`,
      [studentId, companyId, semester.rows[0].semester_id, job.rows[0]?.job_id ?? null]
    );
    return { studentId, companyId };
  });
}

test.describe('ด่านการส่งของนักศึกษา', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('G1: บันทึกร่างโครงร่างเก็บในเครื่อง ไม่ส่งถึงพี่เลี้ยง และกลับมาแล้วยังอยู่', async ({ page }) => {
    const { studentId } = await acceptedStudent2();
    await loginAs(page, 'student2');
    await goToMenu(page, 'report_outline');

    await page.getByTestId('outline-title').fill('ระบบติดตามงานซ่อมบำรุง');
    await page.getByTestId('outline-text').fill('บทที่ 1 บทนำ');
    await page.getByTestId('outline-save-draft').click();
    await expect(page.getByText(/บันทึกร่างไว้ในเครื่องนี้แล้ว/)).toBeVisible();

    // ⛔ เดิมตรงนี้มีแถว pending_mentor เกิดขึ้น = พี่เลี้ยงเห็นร่างในคิว
    expect(await dbValue<string>('SELECT COUNT(*) FROM report_outlines WHERE student_id = $1', [studentId])).toBe('0');

    await page.reload();
    await expect(page.getByTestId('outline-text')).toHaveValue('บทที่ 1 บทนำ');
  });

  test('G2: โครงร่างที่พี่เลี้ยงเห็นชอบ/อาจารย์อนุมัติแล้ว ส่งทับไม่ได้ (409) และสถานะไม่ขยับ', async ({ request }) => {
    const { studentId, companyId } = await acceptedStudent2();
    for (const status of ['pending_advisor', 'approved']) {
      await dbExec('DELETE FROM report_outlines WHERE student_id = $1', [studentId]);
      await dbExec(`INSERT INTO report_outlines (student_id, company_id, status) VALUES ($1, $2, $3)`, [
        studentId,
        companyId,
        status,
      ]);
      await apiLoginAs(request, 'student2');
      const res = await request.post(`${API_URL}/outlines`, {
        multipart: { report_title: 'หัวข้อใหม่', outline_text: 'บทที่ 1' },
      });
      expect(res.status(), status).toBe(409);
      expect(await dbValue<string>('SELECT status FROM report_outlines WHERE student_id = $1', [studentId])).toBe(status);
    }

    // ถูกตีกลับแล้วส่งใหม่ได้ตามปกติ
    await dbExec(`UPDATE report_outlines SET status = 'rejected' WHERE student_id = $1`, [studentId]);
    const again = await request.post(`${API_URL}/outlines`, {
      multipart: { report_title: 'หัวข้อที่แก้แล้ว', outline_text: 'บทที่ 1' },
    });
    expect([200, 201]).toContain(again.status());
  });

  test('G3: ขอใบรับรอง สหกิจ 14 ซ้ำหลังอาจารย์รับรองแล้วไม่ได้ (409) และการรับรองเดิมไม่หาย', async ({ request }) => {
    const { studentId } = await acceptedStudent2();
    const reportId = await dbValue<number>(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/final.pdf', 'approved', 1, 'advisor') RETURNING report_id`,
      [studentId]
    );
    const advisorId = await dbValue<number>(`SELECT user_id FROM users WHERE email = 'advisor1@test.com'`);
    await dbExec(
      `INSERT INTO report_confirmations (student_id, report_id, status, certified_by, certified_at)
       VALUES ($1, $2, 'certified', $3, NOW())`,
      [studentId, reportId, advisorId]
    );

    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/report-confirmations`);
    expect(res.status()).toBe(409);
    expect(
      await dbValue<number>('SELECT certified_by FROM report_confirmations WHERE student_id = $1', [studentId])
    ).toBe(advisorId);
  });
});
