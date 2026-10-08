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
 *   - ขั้น 2.1 ติ๊กเสร็จเองทันทีที่บริษัทตอบรับ — ยังไม่ได้แจ้งที่พักเลย (ขั้น 2.2 แผนงาน สหกิจ 07 ถูกตัดออกแล้ว 2026-10-05)
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
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date, acceptance_due_date)
       VALUES ($1, $2, $3, 'accepted', CURRENT_DATE, CURRENT_DATE + 21)`,
      [s.student_id, company.company_id, semester.rows[0].semester_id]
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

    // ⛔ บันทึกที่พักแล้วผ่านเฟส 2 ทันที — ไม่มีขั้นแผนปฏิบัติงาน (สหกิจ 07 หน้า 3) ให้รอพี่เลี้ยงรับรองอีก
    //    (เจ้าของสั่งตัด 2026-10-05 · แผนที่พี่เลี้ยงรับรองค้างอยู่ก็ต้องไม่บล็อกนักศึกษา)
    await dbExec(`INSERT INTO accommodations (student_id, house_no) VALUES ($1, '1')`, [studentId]);
    await dbExec(
      `INSERT INTO work_plan_approvals (student_id, approver_role, status) VALUES ($1, 'mentor', 'pending')`,
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
      outline_submitted: true,
      outline_approved: true,
      supervision_visits: 2,
      final_report_approved: true,
      mentor_evaluations: 2,
    });
  });

  test('ความคืบหน้าเป็นของตัวเองเท่านั้น — role อื่นเรียก /students/dashboard ไม่ได้', async ({ request }) => {
    await acceptedStudent2();
    for (const who of ['mentor1', 'advisor1'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(`${API_URL}/students/dashboard`)).status(), who).toBe(403);
    }
  });

  // บั๊ก 2026-10-08: ขั้น 1.4 อ่านหนังสือฉบับล่าสุดของนักศึกษาโดยไม่ดูว่าเป็นของใบที่ยังเดินอยู่ไหม
  // ใบที่ปิดไปแล้วทิ้งหนังสือที่ลงนามไว้ → แถบเส้นทางขึ้น "ตอนนี้" สองช่อง และใบใหม่ได้ ✓ คณบดีลงนามมาฟรี
  test('หนังสือที่ลงนามของใบที่ปิดแล้ว ไม่นับเป็นความคืบหน้า — แถบเส้นทางมี "ตอนนี้" ช่องเดียว ทั้งตอนไม่มีใบและตอนยื่นใบใหม่', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const ids = await withDb(async (db) => {
      const studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
      const companyId = (await db.query('SELECT company_id FROM companies ORDER BY company_id LIMIT 1')).rows[0].company_id;
      const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0]
        .semester_id;
      // ใบเดิม: คณบดีลงนามแล้ว ส่งถึงบริษัทแล้ว แล้วบริษัทตอบไม่รับ — หนังสือที่ลงนามยังอยู่ในฐาน
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, officer_document_no, acceptance_due_date, reject_reason)
         VALUES ($1, $2, $3, 'company_rejected', 'ST/OLD', CURRENT_DATE + 10, 'ไม่มีตำแหน่งที่ตรงกับสาขา')`,
        [studentId, companyId, semesterId]
      );
      await db.query(
        `INSERT INTO official_documents (document_number, type, student_id, company_id, status)
         VALUES ('ST/OLD', 'cover_letter', $1, $2, 'signed')`,
        [studentId, companyId]
      );
      return { studentId, semesterId };
    });

    const steps = page.getByTestId('journey-bar').getByTestId('journey-step');
    const active = page.getByTestId('journey-bar').locator('[data-testid="journey-step"][data-state="active"]');

    // 1) ไม่มีใบที่ยังเดินอยู่ — ต้องอยู่ที่ "เลือกสถานประกอบการ" ช่องเดียว
    await loginAs(page, 'student2');
    await expect(steps).toHaveCount(7);
    await expect(active).toHaveCount(1);
    await expect(active).toContainText('เลือกสถานประกอบการ');
    await expect(steps.filter({ hasText: 'รอหนังสือตอบรับ' })).toHaveAttribute('data-state', 'pending');

    // 2) ยื่นใบใหม่ถึงที่อื่น ยังไม่ถึงมือเจ้าหน้าที่ — หนังสือเก่าต้องไม่ทำให้ขั้นหลังได้ ✓ หรือ "ตอนนี้" ล่วงหน้า
    await withDb(async (db) => {
      const other = (
        await db.query(
          `INSERT INTO companies (name_th, address, province, district, postal_code, phone, created_by, is_verified)
           VALUES ('บริษัท ที่ใหม่ จำกัด', '1 ถนนทดสอบ', 'ชลบุรี', 'ศรีราชา', '20110', '020000000', $1, FALSE)
           RETURNING company_id`,
          [ids.studentId]
        )
      ).rows[0].company_id;
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status) VALUES ($1, $2, $3, 'pending_advisor')`,
        [ids.studentId, other, ids.semesterId]
      );
    });
    await page.reload();
    await expect(steps).toHaveCount(7);
    await expect(active).toHaveCount(1);
    await expect(active).toContainText('ขอหนังสือขอความอนุเคราะห์');
    await expect(steps.filter({ hasText: 'รอหนังสือตอบรับ' })).toHaveAttribute('data-state', 'pending');
  });
});
