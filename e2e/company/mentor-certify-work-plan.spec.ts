import { test, expect } from '@playwright/test';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { API_URL } from '../helpers/env';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbValue, mentor1Id, withDb } from '../helpers/db';

/**
 * ข้อ 1 ของ PROMPT-sonnet-R1-close-company.md
 *
 * `pages/Mentor/MentorCertify.tsx` เคยแสดงแผนปฏิบัติงานปลอมทั้งหน้าให้พี่เลี้ยงกดรับรอง —
 * ไม่ใช่เพราะ backend พัง แต่เพราะหน้าจออ่าน `res?.data` / `res.data.data` ทั้งที่
 * `services/api.ts` คืน body ของ fetch ตรง ๆ (ไม่มี `.data` ห่ออีกชั้นแบบ axios)
 * เมื่อ `GET /students/:id/work-plan` ได้ 200 จริงแต่ `res.data` เป็น `undefined`
 * หน้าจอจะไหลไปเข้าทาง fallback `.catch(() => null)` → 403 ที่ `/accommodation-plan`
 * (เส้นของนักศึกษา ไม่ใช่ของพี่เลี้ยง) → สุดท้ายแต่งหัวข้องาน/เดือน/บริษัทขึ้นมาเองทั้งชุด
 *
 * ชุดนี้กันไม่ให้กลับมา: ต้องเห็นหัวข้อจริงของนักศึกษาคนนั้นเท่านั้น ไม่มีหัวข้อปลอม 5 อัน
 * ที่เคยฮาร์ดโค้ดไว้ ('ศึกษาระบบงานเดิม...') หลุดออกมาแม้แต่คำเดียว
 */

/** ผูกพี่เลี้ยงกับนักศึกษาให้เหมือนใบความจำนงที่ถูกตอบรับแล้ว (รูปแบบเดียวกับ company-mentor-permissions.spec.ts) */
async function attachMentorTo(
  studentEmail: string,
  durationDays: number
): Promise<{ mentorId: number; companyId: number; studentId: number }> {
  return withDb(async (db) => {
    const student = await db.query('SELECT user_id FROM users WHERE email = $1', [studentEmail]);
    const studentId = student.rows[0].user_id as number;

    const company = await db.query('SELECT company_id FROM companies LIMIT 1');
    const companyId = company.rows[0].company_id as number;
    const mentorId = await mentor1Id();

    const job = await db.query('SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1', [companyId]);
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');

    // ⛔ ต้องมีทั้ง start_date และ end_date — placementMonths() ใช้ทั้งคู่คำนวณคอลัมน์เดือน
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, mentor_id, start_date, end_date)
       VALUES ($1, $2, $3, $4, 'accepted', $5, CURRENT_DATE, CURRENT_DATE + $6::int)`,
      [studentId, companyId, semester.rows[0].semester_id, job.rows[0].job_id, mentorId, durationDays]
    );

    return { mentorId, companyId, studentId };
  });
}

/** นักศึกษาอีกคนของบริษัทเดียวกัน ไว้ทดสอบเคส "ยังไม่ได้ส่งแผน" แยกจากคนแรก */
async function makeOtherStudent(): Promise<string> {
  const email = 'student-noplan@test.com';
  await withDb(async (db) => {
    const user = await db.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'x')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING user_id`,
      [email]
    );
    const userId = user.rows[0].user_id as number;
    await db.query(
      `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student') ON CONFLICT DO NOTHING`,
      [userId]
    );
    // ⛔ enrollment_year ต้องใหม่พอที่ DeactivationScheduler จะไม่ปิดบัญชีกลางเทสต์
    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name)
       VALUES ($1, '65888888', (SELECT major_id FROM master_major LIMIT 1), 3.00, 2569, 'มานี', 'ไม่มีแผน')
       ON CONFLICT (student_id) DO NOTHING`,
      [userId]
    );
  });
  return email;
}

/** เปิดหน้ารับรองงานของพี่เลี้ยง (mentor1 ล็อกอินแล้ว) */
async function openMentorCertify(page: import('@playwright/test').Page): Promise<void> {
  await goToMenu(page, 'certify');
}

test.describe('พี่เลี้ยงรับรองแผนปฏิบัติงาน — ต้องเห็นของจริง ไม่ใช่ของปลอม', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('เห็นหัวข้อจริงทั้งสองข้อของนักศึกษา ไม่มีหัวข้อปลอมสักข้อ และลงนามได้จริง', async ({ page, request }) => {
    // ⛔ ตั้งใจให้สั้น (45 วัน = 2 เดือนปฏิทิน) กันไม่ให้ช่วงจริงคร่อมเข้า พ.ย.-มี.ค.
    //    ซึ่งเป็นเดือนที่โค้ดเก่าเคยฮาร์ดโค้ดไว้ — จะได้แยกได้ชัดว่าเดือนที่เห็นมาจากข้อมูลจริง
    const { mentorId, studentId } = await attachMentorTo('student2@test.com', 45);
    // ⛔ ตรึงช่วงไว้ มิ.ย.–ก.ค. — `CURRENT_DATE + 45` คร่อม พ.ย. เองทุกปีตั้งแต่ปลาย ก.ย. ถึง มี.ค.
    //    (แดงครั้งแรก 2026-09-21 โดยที่โค้ดไม่ได้เปลี่ยน)
    await dbExec(
      `UPDATE intent_forms SET start_date = DATE '2026-06-01', end_date = DATE '2026-07-15'
        WHERE student_id = $1 AND status = 'accepted'`,
      [studentId]
    );

    const topics: Array<[string, number[]]> = [
      ['ออกแบบฐานข้อมูลสำหรับระบบเบิกจ่ายพัสดุ', [1]],
      ['พัฒนา API เชื่อมต่อระบบเบิกจ่ายกับคลังสินค้า', [2]],
    ];
    for (let i = 0; i < topics.length; i++) {
      const [topic, months] = topics[i];
      await dbExec(
        `INSERT INTO work_plan_topics (student_id, seq, topic, months) VALUES ($1, $2, $3, $4)`,
        [studentId, i + 1, topic, months]
      );
    }
    // นักศึกษา "ลงนาม" ด้วยการกดส่ง — สร้างแถวรออนุมัติของพี่เลี้ยงแบบเดียวกับที่ backend ทำจริง
    await dbExec(
      `INSERT INTO work_plan_approvals (student_id, approver_role, approver_id, status, created_at)
       VALUES ($1, 'mentor', $2, 'pending', NOW())`,
      [studentId, mentorId]
    );

    await loginAs(page, 'mentor1');
    await openMentorCertify(page);
    await page.getByTestId('certify-tab-plan').click();

    await expect(page.getByTestId('plan-matrix')).toBeVisible();
    await expect(page.getByText('ออกแบบฐานข้อมูลสำหรับระบบเบิกจ่ายพัสดุ')).toBeVisible();
    await expect(page.getByText('พัฒนา API เชื่อมต่อระบบเบิกจ่ายกับคลังสินค้า')).toBeVisible();

    // ⛔ ห้ามมีหัวข้อปลอมที่เคยฮาร์ดโค้ดไว้หลุดออกมาแม้แต่คำเดียว
    await expect(page.getByText('ศึกษาระบบงานเดิม')).toHaveCount(0);
    // ⛔ ชื่อบริษัทปลอม (Seagate ปรากฏเป็นบริษัทฮาร์ดโค้ดในโค้ดเก่า) ต้องไม่ใช่ที่มาของค่านี้อีกต่อไป —
    //    ที่นี่บังเอิญเป็นบริษัทเดียวกับที่ seed จริงใช้ จึงเช็คว่าตารางเดือนไม่ใช่ พ.ย.-มี.ค. ตายตัวแทน
    await expect(page.getByTestId('plan-matrix').getByText('พ.ย.')).toHaveCount(0);
    await expect(page.getByTestId('plan-matrix').getByText('มี.ค.')).toHaveCount(0);

    await page.getByTestId('plan-approve').click();
    await expect(page.getByText('ลงนามรับรองแผนปฏิบัติงานสหกิจศึกษาเรียบร้อยแล้ว')).toBeVisible();

    const status = await dbValue<string>(
      `SELECT status FROM work_plan_approvals WHERE student_id = $1 AND approver_role = 'mentor'`,
      [studentId]
    );
    expect(status).toBe('approved');

    // ── สหกิจ 07 หน้า 3 ลงนามแค่นักศึกษา + พี่เลี้ยง แล้วส่งคืนงานสหกิจ (เจ้าของยืนยัน 2026-09-22) ──
    // เดิมการรับรองของพี่เลี้ยงสร้างแถว advisor/supervisor `pending` ที่ไม่มีใครกดได้
    const roles = await withDb(async (db) =>
      (await db.query(`SELECT approver_role FROM work_plan_approvals WHERE student_id = $1`, [studentId])).rows
        .map((r) => r.approver_role)
    );
    expect(roles).toEqual(['mentor']);

    // เจ้าหน้าที่ (ผู้รับใบตามกระดาษ) เห็นติ๊กสหกิจ 07 จากการรับรองของพี่เลี้ยง
    // — เดิมคอลัมน์นี้ผูกกับ intentApproved และตัวเลขนับ weekly_work_plans ซึ่งไม่ใช่ใบนี้
    await apiLoginAs(request, 'staff1');
    const progRes = await request.get(`${API_URL}/coop-progress/dashboard`);
    expect(progRes.status()).toBe(200);
    const mine = ((await progRes.json()).data as { studentId: number; progressDetails: { workPlanCertified: boolean } }[])
      .find((s) => s.studentId === studentId);
    expect(mine?.progressDetails.workPlanCertified).toBe(true);

    // API ลงนาม/ตีกลับเหลือเฉพาะพี่เลี้ยง — เจ้าหน้าที่และอาจารย์ที่ปรึกษาของนักศึกษาเองก็ไม่ได้
    for (const path of ['approve', 'reject']) {
      const r = await request.patch(`${API_URL}/students/${studentId}/work-plan/${path}`, { data: { comment: 'x' } });
      expect(r.status(), `staff ${path}`).toBe(403);
    }
    await dbExec(
      `UPDATE students SET advisor_id = (SELECT user_id FROM users WHERE email = 'advisor1@test.com') WHERE student_id = $1`,
      [studentId]
    );
    await apiLoginAs(request, 'advisor1');
    for (const path of ['approve', 'reject']) {
      const r = await request.patch(`${API_URL}/students/${studentId}/work-plan/${path}`, { data: { comment: 'x' } });
      expect(r.status(), `advisor ${path}`).toBe(403);
    }
    expect(
      await dbValue<string>(
        `SELECT status FROM work_plan_approvals WHERE student_id = $1 AND approver_role = 'mentor'`,
        [studentId]
      )
    ).toBe('approved');
  });

  test('นักศึกษาที่ยังไม่ได้ส่งแผน — เห็น EmptyState และกดรับรองไม่ได้', async ({ page }) => {
    const otherEmail = await makeOtherStudent();
    await attachMentorTo(otherEmail, 90);
    // ⛔ จงใจไม่ใส่แถวใน work_plan_topics เลย — นี่คือสถานะ "ยังไม่ได้ส่ง"

    await loginAs(page, 'mentor1');
    await openMentorCertify(page);
    await page.getByTestId('certify-tab-plan').click();

    await expect(page.getByText('นักศึกษายังไม่ได้ส่งแผนปฏิบัติงาน')).toBeVisible();
    await expect(page.getByTestId('plan-approve')).toHaveCount(0);
    await expect(page.getByTestId('plan-matrix')).toHaveCount(0);
  });
});
