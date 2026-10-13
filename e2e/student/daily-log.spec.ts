import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRows, dbValue, mentor1Id, withDb } from '../helpers/db';
import { API_URL } from '../helpers/env';

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

    // หน้าจอมีครบ 7 วันของสัปดาห์ (สัปดาห์นับจากวันเริ่มฝึก ไม่จำเป็นต้องเริ่มวันจันทร์) — กรอกเฉพาะวันที่ทำงาน
    // เดิมมี 5 วันแรก: เริ่มฝึกกลางสัปดาห์แล้ววันทำงานบางวันไม่มีแถวให้กรอกเลย
    const inputs = page.locator('[data-testid^="daily-input-"]');
    await expect(inputs).toHaveCount(7);
    const firstDay = await dbValue<string>(`SELECT to_char(CURRENT_DATE - 6, 'YYYY-MM-DD')`);
    const lastDay = await dbValue<string>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD')`);
    await expect(page.getByTestId(`daily-row-${firstDay}`)).toBeVisible();
    await expect(page.getByTestId(`daily-row-${lastDay}`)).toBeVisible();
    // ⛔ วันที่ไม่ได้กรอกต้องไม่กลายเป็นแถวว่างในฐาน — กรอก 5 จาก 7 วัน ฐานต้องมี 5 แถว
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

  test('รายสัปดาห์และรายเดือนที่พี่เลี้ยงรับรองแล้ว — บันทึกร่างต้องเจอกล่องเตือนก่อน ยกเลิกแล้วการรับรองยังอยู่', async ({
    page,
  }) => {
    const { studentId, mentorId } = await attachMentorTo('student2@test.com', false, 40);

    await dbExec(
      `INSERT INTO weekly_logs (student_id, week_number, assigned_work, methods, tools_used, achievements,
                                 status, submitted_at, mentor_certified_by, mentor_certified_at)
       VALUES ($1, 1, 'งานเดิม', 'วิธีเดิม', 'เครื่องมือเดิม', 'ผลเดิม', 'submitted', NOW(), $2, NOW())`,
      [studentId, mentorId]
    );
    await dbExec(
      `INSERT INTO monthly_logs (student_id, year, month, work_summary, effectiveness,
                                  status, submitted_at, mentor_certified_by, mentor_certified_at)
       VALUES ($1, EXTRACT(YEAR FROM CURRENT_DATE - 40)::int, EXTRACT(MONTH FROM CURRENT_DATE - 40)::int,
               'สรุปเดิม', 'ประสิทธิภาพเดิม', 'submitted', NOW(), $2, NOW())`,
      [studentId, mentorId]
    );
    const startMonth = await dbValue<number>('SELECT EXTRACT(MONTH FROM CURRENT_DATE - 40)::int');

    const weeklyCert = () =>
      dbValue<string | null>(
        'SELECT mentor_certified_at FROM weekly_logs WHERE student_id = $1 AND week_number = 1',
        [studentId]
      );
    const monthlyCert = () =>
      dbValue<string | null>('SELECT mentor_certified_at FROM monthly_logs WHERE student_id = $1', [studentId]);

    await loginAs(page, 'student2');
    await goToMenu(page, 'weekly_log');

    // ── รายสัปดาห์ ──
    await page.getByTestId('worklog-week-select').selectOption('1');
    await expect(page.getByText('พี่เลี้ยงรับรองแล้ว (สมศักดิ์ รักเรียน)')).toBeVisible();
    await page.getByTestId('worklog-save-draft').click();

    // ⛔ ต้องเจอกล่องเตือนก่อนเสมอ — ปุ่มบันทึกร่างเคยยิงทันทีและล้างการรับรองเงียบๆ
    await expect(page.getByText('สัปดาห์นี้พี่เลี้ยงรับรองไปแล้ว')).toBeVisible();
    await page.getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(page.getByText('สัปดาห์นี้พี่เลี้ยงรับรองไปแล้ว')).toHaveCount(0);
    expect(await weeklyCert()).not.toBeNull();

    await page.getByTestId('worklog-save-draft').click();
    await page.getByTestId('worklog-confirm-overwrite').click();
    await expect.poll(weeklyCert).toBeNull();

    // ── รายเดือน ──
    await page.getByTestId('worklog-tab-monthly').click();
    await page.getByTestId(`monthly-month-${startMonth}`).click();
    await expect(page.getByText('พี่เลี้ยงรับรองแล้ว (สมศักดิ์ รักเรียน)')).toBeVisible();
    await page.getByTestId('worklog-save-draft').click();

    await expect(page.getByText('เดือนนี้พี่เลี้ยงรับรองไปแล้ว')).toBeVisible();
    await page.getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(page.getByText('เดือนนี้พี่เลี้ยงรับรองไปแล้ว')).toHaveCount(0);
    expect(await monthlyCert()).not.toBeNull();

    await page.getByTestId('worklog-save-draft').click();
    await page.getByTestId('worklog-confirm-overwrite').click();
    await expect.poll(monthlyCert).toBeNull();
  });

  test('สัปดาห์ที่ยังไม่เริ่มส่งให้พี่เลี้ยงรับรองไม่ได้ ทั้งหน้าจอและ API — บันทึกร่างยังได้', async ({ page }) => {
    // เริ่มฝึกเมื่อ 3 วันก่อน: สัปดาห์ที่ 1 กำลังเดิน · สัปดาห์ที่ 2 เริ่มอีก 4 วัน
    const { studentId } = await attachMentorTo('student2@test.com', false, 3);
    const fields = { assigned_work: 'งาน', methods: 'วิธี', tools_used: 'เครื่องมือ', achievements: 'ผล', problems: '', summary: '' };
    const post = (week: number, status: 'draft' | 'submitted') =>
      page.request.post(`${API_URL}/weekly-logs`, {
        multipart: { ...fields, week_number: String(week), status },
      });

    await loginAs(page, 'student2');
    await goToMenu(page, 'weekly_log');

    // หน้าเปิดมาที่สัปดาห์ปัจจุบัน ไม่ใช่สัปดาห์อนาคต
    await expect(page.getByTestId('worklog-week-select')).toHaveValue('1');
    await expect(page.getByTestId('worklog-submit')).toBeEnabled();

    await page.getByTestId('worklog-week-select').selectOption('2');
    await expect(page.getByTestId('worklog-submit')).toBeDisabled();
    await expect(page.getByTestId('worklog-save-draft')).toBeEnabled();
    await expect(page.getByTestId('worklog-week-not-started')).toContainText('สัปดาห์ที่ 2 ยังไม่เริ่ม');

    // ⛔ ด่านจริงอยู่ที่เซิร์ฟเวอร์ — ยิงตรงก็ต้องไม่ผ่าน และต้องไม่มีแถวสถานะ submitted เกิดขึ้น
    const blocked = await post(2, 'submitted');
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).code).toBe('week_not_started');
    expect((await post(2, 'draft')).ok()).toBe(true);
    expect((await post(1, 'submitted')).ok()).toBe(true);

    const rows = await dbRows<{ week_number: number; status: string }>(
      'SELECT week_number, status FROM weekly_logs WHERE student_id = $1 ORDER BY week_number',
      [studentId]
    );
    expect(rows).toEqual([
      { week_number: 1, status: 'submitted' },
      { week_number: 2, status: 'draft' },
    ]);
  });

  test('แถบสัปดาห์บอกใบที่ถูกส่งกลับ · แท็บอยู่ใน URL และรอดจากการรีเฟรช · กดเลขสัปดาห์จากแท็บรายวันไม่ถูกพาไปรายสัปดาห์', async ({
    page,
  }) => {
    const { studentId } = await attachMentorTo('student2@test.com', true, 20);
    await dbExec(
      `INSERT INTO weekly_logs (student_id, week_number, assigned_work, methods, tools_used, achievements,
                                 status, returned_comment)
       VALUES ($1, 2, 'งาน', 'วิธี', 'เครื่องมือ', 'ผล', 'returned', 'ขอรายละเอียดเพิ่ม')`,
      [studentId]
    );

    await loginAs(page, 'student2');
    await goToMenu(page, 'weekly_log');

    // ใบที่พี่เลี้ยงส่งกลับต้องเห็นจากแถบ — เดิมหน้าตาเหมือนสัปดาห์ที่ยังไม่ถึง
    await expect(page.getByTestId('worklog-week-2')).toContainText('แก้');
    await expect(page.getByTestId('worklog-week-2')).toHaveAttribute('title', /ส่งกลับมาแก้ไข/);

    await page.getByTestId('worklog-tab-monthly').click();
    await expect(page).toHaveURL(/tab=monthly/);
    await page.reload();
    await expect(page.locator('[data-testid^="monthly-month-"]').first()).toBeVisible();
    await expect(page.getByTestId('worklog-week-select')).toHaveCount(0);

    await page.getByTestId('worklog-tab-daily').click();
    await expect(page).toHaveURL(/tab=daily/);
    await page.getByTestId('worklog-week-2').click();
    await expect(page.getByTestId('daily-week-select')).toHaveValue('2');
    await expect(page.locator('[data-testid^="daily-row-"]')).toHaveCount(7);
  });
});
