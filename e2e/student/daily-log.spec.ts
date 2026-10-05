import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbValue, mentor1Id, withDb } from '../helpers/db';

/**
 * ข้อ 4 ของ PROMPT-sonnet-R1-close-company.md — แท็บบันทึกรายวัน (สหกิจ 08)
 * ฝั่งนักศึกษา ปลายทางของสวิตช์ `intent_forms.daily_log_required` ที่พี่เลี้ยงเปิด
 * (ก่อนหน้านี้พี่เลี้ยงกดเปิดแล้วนักศึกษาไม่เห็นอะไรเลย เพราะแท็บยังไม่มี)
 */

/** ผูกพี่เลี้ยงกับนักศึกษา พร้อมตั้งสวิตช์บันทึกรายวันตามที่ต้องการ */
async function attachMentorTo(
  studentEmail: string,
  dailyLogRequired: boolean,
  startDaysAgo: number
): Promise<{ mentorId: number; companyId: number; studentId: number }> {
  return withDb(async (db) => {
    const student = await db.query('SELECT user_id FROM users WHERE email = $1', [studentEmail]);
    const studentId = student.rows[0].user_id as number;

    const company = await db.query('SELECT company_id FROM companies LIMIT 1');
    const companyId = company.rows[0].company_id as number;
    const mentorId = await mentor1Id();

    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');

    // ⛔ start_date ต้องไม่ใหม่เกินไป ไม่งั้นวันของ "สัปดาห์ที่ 1" ตกไปอยู่ในอนาคต
    //    ทั้งหมด ซึ่งหน้าจอปิดช่องกรอกไว้โดยตั้งใจ (ยังไม่ถึงวัน)
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id,
                                  start_date, end_date, daily_log_required)
       VALUES ($1, $2, $3, 'accepted', $4, CURRENT_DATE - $5::int, CURRENT_DATE + 60, $6)`,
      [studentId, companyId, semester.rows[0].semester_id, mentorId, startDaysAgo, dailyLogRequired]
    );

    return { mentorId, companyId, studentId };
  });
}

test.describe('บันทึกรายวัน (สหกิจ 08) — ฝั่งนักศึกษา', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('สวิตช์ปิด = ไม่มีแท็บรายวัน', async ({ page }) => {
    await attachMentorTo('student2@test.com', false, 6);

    await loginAs(page, 'student2');
    await goToMenu(page, 'weekly_log');

    await expect(page.getByTestId('worklog-tab-daily')).toHaveCount(0);
    // ⛔ ต้องยังมีอีกสองแท็บอยู่ตามปกติ — ไม่ใช่ทั้งหน้าพัง
    await expect(page.getByTestId('worklog-tab-weekly')).toBeVisible();
    await expect(page.getByTestId('worklog-tab-monthly')).toBeVisible();
  });

  test('สวิตช์เปิด = กรอก 5 วันแล้วส่ง → ฐานมี 5 แถว', async ({ page }) => {
    const { studentId } = await attachMentorTo('student2@test.com', true, 6);

    await loginAs(page, 'student2');
    await goToMenu(page, 'weekly_log');
    await page.getByTestId('worklog-tab-daily').click();

    const inputs = page.locator('[data-testid^="daily-input-"]');
    await expect(inputs).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await inputs.nth(i).fill(`วันที่ ${i + 1} ทำงานทดสอบระบบบันทึกรายวัน`);
    }

    await page.getByTestId('daily-submit').click();
    await expect(page.getByText('ส่งบันทึกรายวันสัปดาห์ที่ 1 ให้พนักงานที่ปรึกษารับรองแล้ว')).toBeVisible();

    const count = await dbValue<string>(
      'SELECT COUNT(*) FROM daily_logs WHERE student_id = $1 AND week_number = 1',
      [studentId]
    );
    expect(count).toBe('5');
  });

  test('แก้สัปดาห์ที่พี่เลี้ยงรับรองแล้ว ต้องเจอกล่องเตือนก่อนบันทึกจริง', async ({ page }) => {
    const { studentId, mentorId } = await attachMentorTo('student2@test.com', true, 6);

    // สร้างบันทึกที่รับรองไปแล้ว ตรงในฐาน — ไม่ต้องเดินผ่านหน้าจอพี่เลี้ยงเพื่อตั้งสภาพเทสต์
    await dbExec(
      `INSERT INTO daily_logs (student_id, week_number, log_date, work_detail, status, submitted_at,
                                mentor_certified_by, mentor_certified_at)
       VALUES ($1, 1, CURRENT_DATE - 6, 'งานเดิมที่รับรองแล้ว', 'submitted', NOW(), $2, NOW())`,
      [studentId, mentorId]
    );

    await loginAs(page, 'student2');
    await goToMenu(page, 'weekly_log');
    await page.getByTestId('worklog-tab-daily').click();

    await expect(page.getByText('พี่เลี้ยงรับรองแล้ว (สมศักดิ์ รักเรียน)')).toBeVisible();

    await page.locator('[data-testid^="daily-input-"]').first().fill('แก้ไขงานหลังรับรอง');
    await page.getByTestId('daily-save-draft').click();

    // ⛔ ต้องเจอกล่องเตือนก่อนเสมอ ไม่ใช่บันทึกทับเงียบๆ
    await expect(page.getByText('สัปดาห์นี้พี่เลี้ยงรับรองไปแล้ว')).toBeVisible();
    await page.getByTestId('daily-confirm-overwrite').click();

    await expect(page.getByText('บันทึกร่างของสัปดาห์ที่ 1 เรียบร้อยแล้ว')).toBeVisible();

    const cert = await dbValue<string | null>(
      `SELECT mentor_certified_at FROM daily_logs WHERE student_id = $1 AND week_number = 1 AND log_date = CURRENT_DATE - 6`,
      [studentId]
    );
    expect(cert).toBeNull();
  });
});
