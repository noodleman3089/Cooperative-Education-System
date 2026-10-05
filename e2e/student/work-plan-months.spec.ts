import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue, mentor1Id, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * คอลัมน์ "เดือนที่ 1..N" ของตารางแผนปฏิบัติงาน สหกิจ 07 หน้า 3
 *
 * ⛔ สิ่งที่คุม: **นักศึกษาและผู้ตรวจต้องเห็นเดือนชุดเดียวกัน** — เดิมมีสองสูตร
 *    (หน้านักศึกษาคิดใน Node ส่งแค่ `months_count` · หน้าผู้ตรวจคิดใน SQL ส่ง `months`)
 *    ถ้าเพี้ยนกัน นักศึกษาจะติ๊กเดือนที่พี่เลี้ยง/อาจารย์มองไม่เห็นตอนลงนาม
 *    และหน้านักศึกษาเรียก `GET /:id/work-plan` ไม่ได้ (403) จึงต้องได้ `months` จากเส้นของตัวเอง
 */

const accept = async (start: string | null, end: string | null): Promise<number> => {
  const studentId = (await dbValue<number>(
    "SELECT user_id FROM users WHERE email = 'student2@test.com'"
  ))!;
  await dbExec('DELETE FROM intent_forms WHERE student_id = $1', [studentId]);
  await dbExec(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date, end_date)
     SELECT $1, c.company_id, s.semester_id, 'accepted', $2::date, $3::date
       FROM companies c, coop_semesters s
      WHERE s.is_active = TRUE
      LIMIT 1`,
    [studentId, start, end]
  );
  return studentId;
};

test.describe('เดือนของแผนปฏิบัติงาน (สหกิจ 07 หน้า 3)', () => {
  test('ช่วงข้ามปีได้เดือนปฏิทินครบ และนักศึกษากับผู้ตรวจเห็นชุดเดียวกัน', async ({ request, playwright }) => {
    await seedTestData();
    // 2 พ.ย. 2569 → 26 ก.พ. 2570 = พ.ย. ธ.ค. ม.ค. ก.พ. (นับเดือนปฏิทิน ไม่ใช่ 30 วัน)
    const studentId = await accept('2026-11-02', '2027-02-26');
    const expected = [
      { index: 1, year: 2026, month: 11 },
      { index: 2, year: 2026, month: 12 },
      { index: 3, year: 2027, month: 1 },
      { index: 4, year: 2027, month: 2 },
    ];

    await apiLoginAs(request, 'student2');
    const own = await request.get(`${API_URL}/students/${studentId}/accommodation-plan`);
    expect(own.status(), await own.text()).toBe(200);
    expect((await own.json()).months).toEqual(expected);

    // ผู้ตรวจใช้ cookie jar แยก จะได้ไม่ทับ session ของนักศึกษา
    const reviewer = await playwright.request.newContext();
    try {
      await apiLoginAs(reviewer, 'staff1');
      const review = await reviewer.get(`${API_URL}/students/${studentId}/work-plan`);
      expect(review.status(), await review.text()).toBe(200);
      expect((await review.json()).months).toEqual(expected);
    } finally {
      await reviewer.dispose();
    }
  });

  test('ยังไม่มีวันเริ่ม/สิ้นสุด → months ว่าง ไม่เดาจำนวนเดือนให้', async ({ request }) => {
    await seedTestData();
    const studentId = await accept(null, null);

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/students/${studentId}/accommodation-plan`);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).months).toEqual([]);
  });

  /**
   * ข้อ 5 ของ PROMPT-sonnet-R1-close-company.md — ฝั่งหน้าจอของเมทริกซ์
   * (API ฝั่งบนคุมเรื่อง "เดือนชุดเดียวกัน" ไว้แล้ว เคสนี้เพิ่มเฉพาะฝั่งจอ)
   */
  const acceptWithMentor = async (
    start: string,
    end: string
  ): Promise<{ studentId: number; mentorId: number; companyId: number }> =>
    withDb(async (db) => {
      const student = await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const studentId = student.rows[0].user_id as number;
      const company = await db.query('SELECT company_id FROM companies LIMIT 1');
      const companyId = company.rows[0].company_id as number;
      const mentorId = await mentor1Id();
      const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');

      await db.query('DELETE FROM intent_forms WHERE student_id = $1', [studentId]);
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date, end_date)
         VALUES ($1, $2, $3, 'accepted', $4, $5::date, $6::date)`,
        [studentId, companyId, semester.rows[0].semester_id, mentorId, start, end]
      );

      return { studentId, mentorId, companyId };
    });

  test('หน้าที่พักของนักศึกษาไม่มีเมทริกซ์แผนงานแล้ว · แผนที่ส่งทาง API ยังถึงหน้ารับรองของพี่เลี้ยง ติ๊กช่องเดียวกัน', async ({
    page,
    request,
  }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    const { studentId } = await acceptWithMentor('2026-08-06', '2026-11-25');

    await loginAs(page, 'student2');
    await goToMenu(page, 'accommodation_plan');
    // ⛔ ตัดแผนปฏิบัติงาน (สหกิจ 07 หน้า 3) ออกจากนักศึกษา 2026-10-05 — ไม่มีเมทริกซ์และไม่มีปุ่มส่งพี่เลี้ยง
    await expect(page.getByTestId('acc-house-no')).toBeVisible();
    await expect(page.getByTestId('plan-matrix')).toHaveCount(0);
    await expect(page.getByTestId('plan-add-topic')).toHaveCount(0);
    await expect(page.getByTestId('workplan-submit-mentor')).toHaveCount(0);

    // ฝั่งพี่เลี้ยงเก็บไว้ — endpoint ของนักศึกษายังรับแผนอยู่ (ยังไม่มีหน้าจอให้กรอก) · ส่งทาง API แทน
    await apiLoginAs(request, 'student2');
    const saved = await request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
      data: {
        accommodation: {
          house_no: '199/8',
          subdistrict: 'บางพระ',
          district: 'ศรีราชา',
          province: 'ชลบุรี',
          postal_code: '20110',
        },
        work_plan_topics: [
          { topic: 'ออกแบบฐานข้อมูลสำหรับระบบเบิกจ่ายพัสดุ', months: [1] },
          { topic: 'พัฒนา API เชื่อมต่อระบบเบิกจ่ายกับคลังสินค้า', months: [2] },
        ],
        submit_to_mentor: true,
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    // พี่เลี้ยงเปิดหน้ารับรอง (ข้อ 1) ต้องเห็นติ๊กตรงช่องเดียวกัน — คนละหน้าจอ คนละ query
    await loginAs(page, 'mentor1');
    await goToMenu(page, 'certify');
    await page.getByTestId('certify-tab-plan').click();

    await expect(page.getByText('ออกแบบฐานข้อมูลสำหรับระบบเบิกจ่ายพัสดุ')).toBeVisible();
    await expect(page.getByText('พัฒนา API เชื่อมต่อระบบเบิกจ่ายกับคลังสินค้า')).toBeVisible();
    // เมทริกซ์ของ MentorCertify ใช้ seq ของแถวที่บันทึกจริง (1, 2 ตามลำดับที่ส่ง)
    await expect(page.getByTestId('plan-cell-1-1').locator('svg')).toBeVisible();
    await expect(page.getByTestId('plan-cell-2-2').locator('svg')).toBeVisible();
  });
});
