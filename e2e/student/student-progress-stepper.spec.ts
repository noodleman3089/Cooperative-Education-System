import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, withDb } from '../helpers/db';

/**
 * ไทม์ไลน์หน้าแรกนักศึกษา เฟส 2–4 — ทุกขั้นต้องเดินตามแถวจริงในฐาน
 *
 * ⛔ บั๊กที่ไฟล์นี้คุม (พบ 2026-09-21):
 *   - ขั้น 2.1/2.2 ติ๊กเสร็จเองทันทีที่บริษัทตอบรับ — ยังไม่ได้แจ้งที่พักหรือส่งแผนงานเลย
 *   - ขั้น 3.x/4.x เป็น `&& false` — นักศึกษาค้างที่ "ส่งโครงร่าง" ตลอดการฝึก
 * อ่านผลผ่าน "ขั้นตอนที่ต้องทำตอนนี้" (`now-card`) ซึ่งแสดงขั้นแรกที่ยังไม่เสร็จ
 * · และสองกับดักของข้อมูล: โครงร่างที่ยังรอพี่เลี้ยงไม่นับว่าส่งแล้ว · ร่างเล่มที่พี่เลี้ยงอนุมัติ
 *   (`reviewer_kind = 'mentor'`) ไม่ใช่เล่มสมบูรณ์
 */

interface Ctx { studentId: number; companyId: number; supervisorId: number }

async function acceptedStudent2(): Promise<Ctx> {
  return withDb(async (db) => {
    const s = (await db.query(
      `SELECT s.student_id, s.supervisor_id FROM students s JOIN users u ON u.user_id = s.student_id
        WHERE u.email = 'student2@test.com'`
    )).rows[0];
    const company = (await db.query('SELECT company_id FROM companies ORDER BY company_id LIMIT 1')).rows[0];
    const job = await db.query('SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1', [company.company_id]);
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, start_date, acceptance_due_date)
       VALUES ($1, $2, $3, $4, 'accepted', CURRENT_DATE, CURRENT_DATE + 21)`,
      [s.student_id, company.company_id, semester.rows[0].semester_id, job.rows[0]?.job_id ?? null]
    );
    // เฟส 1 ต้องจบครบจริง — ขั้น 1.4 อ่านจากหนังสือขอความอนุเคราะห์ที่คณบดีลงนามแล้ว
    await db.query(
      `INSERT INTO official_documents (document_number, type, student_id, company_id, status)
       VALUES ('ST/1', 'cover_letter', $1, $2, 'signed')`,
      [s.student_id, company.company_id]
    );
    return { studentId: s.student_id, companyId: company.company_id, supervisorId: s.supervisor_id };
  });
}

/** รีโหลดหน้าแรกแล้วอ่านขั้นที่การ์ด "ขั้นตอนที่ต้องทำตอนนี้" ชี้ */
async function expectNow(page: Page, title: string) {
  await page.reload();
  await expect(page.getByTestId('now-card').getByRole('heading', { level: 2 })).toHaveText(title);
  // ใบมี acceptance_due_date แต่ได้ที่ฝึกงานแล้ว — กำหนดส่งหลักฐานตอบรับต้องไม่ค้างข้างขั้นถัดไป
  await expect(page.getByTestId('now-card')).not.toContainText('กำหนดส่งหลักฐานตอบรับ');
  // ได้ที่ฝึกงานแล้ว = การ์ดสถานะของช่วงขอที่ฝึกงานต้องหายไป เหลือการ์ด "ทำอะไรตอนนี้" ใบเดียว
  await expect(page.getByTestId('status-card')).toHaveCount(0);
  await expect(page.getByTestId('request-progress')).toHaveCount(0);
}

test.describe('ไทม์ไลน์นักศึกษา เฟส 2–4 อ่านจากข้อมูลจริง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('แต่ละขั้นเสร็จเมื่อมีแถวจริงเท่านั้น จนผลประเมินครบ', async ({ page }) => {
    const { studentId, companyId, supervisorId } = await acceptedStudent2();
    await loginAs(page, 'student2');

    // เฟส 2 — บริษัทตอบรับแล้วแต่ยังไม่ได้กรอกอะไร ต้องยังค้างที่ที่พัก (เดิมกระโดดไปเฟส 3)
    await expectNow(page, 'แบบแจ้งรายละเอียดที่พัก (สหกิจ 06)');

    await dbExec(`INSERT INTO accommodations (student_id, house_no) VALUES ($1, '1')`, [studentId]);
    await expectNow(page, 'แผนปฏิบัติงาน 4 เดือน (สหกิจ 07)');

    // แผนงานลงนามสองฝ่าย — รอพี่เลี้ยงอยู่ยังไม่นับ
    await dbExec(
      `INSERT INTO work_plan_approvals (student_id, approver_role, status) VALUES ($1, 'mentor', 'pending')`,
      [studentId]
    );
    await expectNow(page, 'แผนปฏิบัติงาน 4 เดือน (สหกิจ 07)');
    await dbExec(
      `UPDATE work_plan_approvals SET status = 'approved', approved_at = NOW() WHERE student_id = $1`,
      [studentId]
    );

    // เฟส 3 — โครงร่างที่ยังรอพี่เลี้ยงตรวจ ยังไม่ถึงมืออาจารย์ จึงไม่นับว่าส่งแล้ว
    await expectNow(page, 'ส่งโครงร่างรายงาน (สหกิจ 11)');
    await dbExec(
      `INSERT INTO report_outlines (student_id, company_id, status) VALUES ($1, $2, 'pending_mentor')`,
      [studentId, companyId]
    );
    await expectNow(page, 'ส่งโครงร่างรายงาน (สหกิจ 11)');
    await dbExec(`UPDATE report_outlines SET status = 'pending_advisor' WHERE student_id = $1`, [studentId]);
    await expectNow(page, 'อาจารย์อนุมัติโครงร่างรายงาน');
    await dbExec(`UPDATE report_outlines SET status = 'approved' WHERE student_id = $1`, [studentId]);

    // นิเทศ 2 ครั้งตามคู่มือ — ครั้งเดียวยังไม่ครบ และต้องบอกว่าไปแล้วกี่ครั้ง
    await expectNow(page, 'การนิเทศงาน (ครั้งที่ 1 และ 2)');
    await expect(page.getByTestId('now-card')).toContainText('นิเทศแล้ว 0 จาก 2 ครั้ง');
    const visit = (n: number) =>
      dbExec(
        `INSERT INTO supervision_records (student_id, supervisor_id, company_id, visit_number, visit_date, scores)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, '{}')`,
        [studentId, supervisorId, companyId, n]
      );
    await visit(1);
    await expectNow(page, 'การนิเทศงาน (ครั้งที่ 1 และ 2)');
    await expect(page.getByTestId('now-card')).toContainText('นิเทศแล้ว 1 จาก 2 ครั้ง');
    await visit(2);

    // เฟส 4 — ร่างที่พี่เลี้ยงอนุมัติไม่ใช่เล่มสมบูรณ์
    await expectNow(page, 'รายงานฉบับสมบูรณ์ (สหกิจ 14)');
    await dbExec(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/draft.pdf', 'approved', 1, 'mentor')`,
      [studentId]
    );
    await expectNow(page, 'รายงานฉบับสมบูรณ์ (สหกิจ 14)');
    await dbExec(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/final.pdf', 'approved', 1, 'advisor')`,
      [studentId]
    );

    // สหกิจ 15 และ 16 ต้องครบทั้งสองใบ
    await expectNow(page, 'พี่เลี้ยงประเมินผล (สหกิจ 15/16)');
    const evaluate = (form: string, score: number) =>
      dbExec(
        `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
         VALUES ($1, 'mentor', $2, '{}', $3)`,
        [studentId, form, score]
      );
    await evaluate('sahatkit_15', 80);
    await expectNow(page, 'พี่เลี้ยงประเมินผล (สหกิจ 15/16)');
    await evaluate('sahatkit_16', 60);

    // ครบทุกขั้น — ไม่มีขั้นที่ต้องทำเหลือ การ์ดจึงหายไป · ไม่มีคำว่าเกรดเพราะระบบไม่เก็บเกรด
    await page.reload();
    await expect(page.getByTestId('now-card')).toHaveCount(0);
    await expect(page.getByTestId('status-card')).toHaveCount(0);

    // `page.request` ใช้ cookie jar เดียวกับเบราว์เซอร์ = session ของ student2
    const progress = (await (await page.request.get(`${API_URL}/students/dashboard`)).json()).progress;
    expect(progress).toEqual({
      accommodation_submitted: true,
      work_plan_certified: true,
      outline_submitted: true,
      outline_approved: true,
      supervision_visits: 2,
      final_report_approved: true,
      mentor_evaluations: 2,
    });
  });

  test('ความคืบหน้าเป็นของตัวเองเท่านั้น — role อื่นเรียก /students/dashboard ไม่ได้', async ({ request }) => {
    await acceptedStudent2();
    for (const who of ['company1', 'advisor1'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(`${API_URL}/students/dashboard`)).status(), who).toBe(403);
    }
  });
});
