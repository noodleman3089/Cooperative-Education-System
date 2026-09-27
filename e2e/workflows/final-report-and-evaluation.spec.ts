import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue } from '../helpers/db';


/**
 * ให้คะแนนเต็มทุกข้อของฟอร์มที่เปิดอยู่
 *
 * อ่านค่าจาก option ตัวสุดท้ายแทนการ hardcode '10' เพราะเพดานรายข้อไม่เท่ากัน:
 * สหกิจ 15 ข้อ 1.1/1.2 เต็ม 10 ที่เหลือเต็ม 5 · สหกิจ 16 ทุกข้อเต็ม 5
 */
const fillEveryScoreWithMax = async (page: Page) => {
  const selects = page.locator('form select');
  const count = await selects.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    const max = await select.locator('option').last().getAttribute('value');
    await select.selectOption(max as string);
  }
};

test.describe('Phase 4: Evaluation & Completion Workflow', () => {

  const injectAcceptedIntentAndApprovedOutline = async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const studentId = studentRes.rows[0].user_id;

      const companyRes = await client.query("SELECT company_id, created_by FROM companies LIMIT 1");
      const companyId = companyRes.rows[0].company_id;

      const jobRes = await client.query("SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1", [companyId]);
      const jobId = jobRes.rows[0].job_id;

      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");
      const semesterId = semesterRes.rows[0].semester_id;

      // Seed Mentor profile if missing
      const mentorRes = await client.query(`
        INSERT INTO mentors (mentor_id, company_id, name, position, department, phone) 
        VALUES ($1, $2, 'สมศักดิ์ รักเรียน', 'Lead Engineer', 'Software Dept', '0819998888')
        ON CONFLICT (mentor_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING mentor_id`, 
        [companyRes.rows[0].created_by || 1, companyId]
      );
      let mentorId = mentorRes.rows[0].mentor_id;

      // Assign mentor role to the company user
      await client.query(
        `INSERT INTO user_roles (user_id, role_name) 
         VALUES ($1, 'mentor') 
         ON CONFLICT DO NOTHING`,
        [mentorId]
      );

      // Insert Accepted Intent Form
      await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, mentor_id, start_date)
         VALUES ($1, $2, $3, $4, 'accepted', $5, $6)`,
        [studentId, companyId, semesterId, jobId, mentorId, new Date().toISOString()]
      );

      // Insert Accommodation for student to gain progress points
      await client.query(
        // ที่อยู่เป็นช่องย่อยตามใบ สหกิจ 06 ตั้งแต่ 2026-09-03 (migration 010)
        `INSERT INTO accommodations (student_id, house_no, road, subdistrict, district, province, postal_code, phone)
         VALUES ($1, '99/9', 'พหลโยธิน', 'จอมพล', 'เขตจตุจักร', 'กรุงเทพมหานคร', '10900', '0812345678')
         ON CONFLICT (student_id) DO NOTHING`,
        [studentId]
      );

      // ⛔ ผู้ติดต่อฉุกเฉินอยู่บนโปรไฟล์นักศึกษาแล้ว ไม่ใช่บนแถวที่พัก (migration 013)
      await client.query(
        `UPDATE students
            SET emergency_contact_name = 'นางประมวล สายดี',
                emergency_relationship = 'มารดา',
                emergency_phone = '0898765432'
          WHERE student_id = $1`,
        [studentId]
      );

      // สหกิจ 07 หน้า 3 ที่พี่เลี้ยงรับรองแล้ว — หน้าเจ้าหน้าที่นับขั้นนี้จากแถวนี้ (ไม่ใช่ weekly_work_plans อีกต่อไป)
      await client.query(
        `INSERT INTO work_plan_approvals (student_id, approver_role, approver_id, status, approved_at)
         VALUES ($1, 'mentor', $2, 'approved', NOW())`,
        [studentId, mentorId]
      );

      // Insert Approved Report Outline (สหกิจ 11) - Required for Final Report submission
      await client.query(
        `INSERT INTO report_outlines (student_id, company_id, status)
         VALUES ($1, $2, 'approved')`,
        [studentId, companyId]
      );

      // Seed Supervision Logs to gain progress points
      const appInsert = await client.query(
        `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status)
         VALUES ((SELECT advisor_id FROM students WHERE student_id = $1), $1, $2, CURRENT_DATE, '10:00', '10:00', 'accepted')
         RETURNING appointment_id`,
        [studentId, companyId]
      );
      const appId = appInsert.rows[0].appointment_id;

      await client.query(
        `INSERT INTO supervision_logs (appointment_id, preliminary_score, behavior_notes, status)
         VALUES ($1, 95, 'นักศึกษาเรียนรู้งานเร็ว ปฏิบัติหน้าที่ได้ดี', 'submitted')`,
        [appId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to inject Phase 4 E2E scenario data:', error);
      throw error;
    } finally {
      client.release();
    }
  };

  test('1. Student submits Final Report, Mentor Evaluates, Advisor reviews, Staff monitors progress', async ({ page }) => {
    test.setTimeout(180000);
    await seedTestData();
    await injectAcceptedIntentAndApprovedOutline();

    // Four roles hand this workflow along, and a failure anywhere used to be
    // reported as one 200-line test going red. Each hand-off is a step, so the
    // report names the one that broke.
    await test.step('นักศึกษาส่งเล่มรายงานฉบับสมบูรณ์', async () => {
      await loginAs(page, 'student2');
      await goToMenu(page, 'final_report');
      // หน้ารีเมค: 3 ขั้นในหน้าเดียว — (1) ร่างให้พี่เลี้ยงตรวจ (2) ฉบับสมบูรณ์ให้อาจารย์ (3) สหกิจ 14
      await expect(page.getByRole('heading', { name: 'รายงานฉบับสมบูรณ์', exact: true })).toBeVisible();

      // ขั้นที่ 1 — ร่างให้พี่เลี้ยงตรวจ (ไม่บังคับก่อนขั้นที่ 2 แต่ต้องมีไว้ให้พี่เลี้ยงกรอกแบบประเมินอ้างอิงได้)
      await page.getByTestId('finalreport-step1-upload').setInputFiles({
        name: 'final_report_draft.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock PDF Content')
      });
      // เลือกไฟล์แล้วยังไม่ส่ง — กล่องยืนยันแสดงชื่อไฟล์ก่อน (2026-09-22)
      await expect(page.getByTestId('confirm-summary')).toContainText('final_report_draft.pdf');
      await page.getByTestId('finalreport-upload-confirm').click();
      await expect(page.getByTestId('finalreport-step1-status')).toContainText('รอพี่เลี้ยงตรวจ');

      // ขั้นที่ 2 — ฉบับสมบูรณ์เข้าระบบให้อาจารย์ที่ปรึกษาตรวจ (เปิดได้ทันทีเมื่อโครงร่างอนุมัติแล้ว)
      await page.getByTestId('finalreport-upload').setInputFiles({
        name: 'final_report_complete.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock PDF Content')
      });
      await page.getByTestId('finalreport-upload-confirm').click();
      await expect(page.getByTestId('finalreport-version-1')).toBeVisible();

      await logout(page);
      await expect(page).toHaveURL(/\/login/);
    });

    await test.step('พี่เลี้ยงกรอกแบบประเมิน สหกิจ 15 และ 16', async () => {
      await loginAs(page, 'company1');
      await goToMenu(page, 'final_evaluation');
      await expect(page.getByRole('heading', { name: 'รายชื่อประเมินผลนักศึกษาสหกิจศึกษา' })).toBeVisible();

      // นักศึกษาส่งทั้งร่าง (พี่เลี้ยง) และเล่ม (อาจารย์) เป็น version 1 ทั้งคู่ — เดิม join
      // ไม่กรอง reviewer_kind จึงได้นักศึกษาสองแถว (React เตือน duplicate key) และพี่เลี้ยง
      // ได้ path เล่มที่ส่งอาจารย์ ซึ่งฝั่งพี่เลี้ยงตั้งใจไม่ให้เห็น
      const listRes = await page.request.get(`${API_URL}/final-evaluations/my-students`);
      expect(listRes.status()).toBe(200);
      const listed = (await listRes.json()).data as { student_id: number; final_report_path: string | null }[];
      const studentId = await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const mine = listed.filter((s) => s.student_id === studentId);
      expect(mine).toHaveLength(1);
      const draftPath = await dbValue<string>(
        "SELECT file_path FROM final_reports WHERE student_id = $1 AND reviewer_kind = 'mentor'",
        [studentId]
      );
      expect(mine[0].final_report_path).toBe(draftPath);
      // ป้ายต้องบอกว่าเป็นร่าง — ไฟล์ที่พี่เลี้ยงเปิดได้คือร่าง ไม่ใช่เล่มสมบูรณ์ที่ส่งอาจารย์
      await expect(page.getByText('ส่งร่างรายงานให้ตรวจแล้ว')).toBeVisible();
      await expect(page.getByText('ส่งเล่มรายงานสมบูรณ์แล้ว')).toHaveCount(0);

      await page.click('text="สมชาย สายดี"');
      await expect(page.locator('text="ผู้รับประเมิน: สมชาย สายดี"')).toBeVisible();

      // --- สหกิจ 15: 18 ข้อ เต็ม 100 ---
      // เพดานรายข้อไม่เท่ากัน (1.1/1.2 = 10 · ที่เหลือ = 5) จึงเลือก "ตัวเลือกสุดท้าย"
      // ของแต่ละช่องแทนการ selectOption('10') ตายตัวแบบเดิม
      await fillEveryScoreWithMax(page);
      await expect(page.locator('text="ให้คะแนนครบทุกข้อแล้ว"')).toBeVisible();

      // ฟอร์ม 15 มี textarea 3 ตัว — locator แบบไม่ระบุจะเป็น strict violation
      await page.getByLabel('จุดเด่นของนักศึกษา / Strength').fill('เรียนรู้เร็ว ตรงต่อเวลา');
      await page.getByLabel('ข้อควรปรับปรุงของนักศึกษา / Improvement').fill('ควรกล้าถามมากขึ้น');
      await page.getByLabel('ข้อคิดเห็นเพิ่มเติม / Other comments').fill('นักศึกษาปฏิบัติงานได้ดีเยี่ยม');

      // คำถามรับเข้าทำงานเป็นช่องติ๊กบนกระดาษ จึงบังคับตอบ
      await page.getByRole('radio', { name: 'รับ / Yes' }).check();

      await page.click('button:has-text("ส่งผลประเมิน")');
      await page.click('button:has-text("ยืนยันส่งคะแนน")');
      await expect(page.locator('text="บันทึกแบบประเมิน สหกิจ 15 เรียบร้อยแล้ว"')).toBeVisible();

      // --- สหกิจ 16: 14 ข้อ ระดับ 1-5 เต็ม 70 ---
      // ใบที่สองต้องอยู่ร่วมกับใบแรกได้ เดิม UNIQUE (student_id, evaluator_role)
      // ทำให้ ON CONFLICT ทับใบแรกทิ้ง
      await page.click('text="สมชาย สายดี"');
      await page.click('button:has-text("สหกิจ 16")');
      await expect(page.getByRole('link', { name: 'เปิดอ่านร่างรายงานที่ส่งให้ท่านตรวจ' })).toBeVisible();

      await page.getByLabel('หัวข้อรายงาน (ภาษาไทย)').fill('ระบบบริหารคลังสินค้า');
      await page.getByLabel('Report title (English)').fill('Warehouse Management System');
      await fillEveryScoreWithMax(page);
      await expect(page.locator('text="ให้คะแนนครบทุกข้อแล้ว"')).toBeVisible();
      await page.getByLabel('ข้อคิดเห็นเพิ่มเติม / Other comments').fill('รูปเล่มเรียบร้อย');

      await page.click('button:has-text("ส่งผลประเมิน")');
      await page.click('button:has-text("ยืนยันส่งคะแนน")');
      await expect(page.locator('text="บันทึกแบบประเมิน สหกิจ 16 เรียบร้อยแล้ว"')).toBeVisible();

      await logout(page);
    });

    await test.step('อาจารย์นิเทศอนุมัติเล่ม และเห็นผลประเมินแบบอ่านอย่างเดียว', async () => {
      await loginAs(page, 'advisor1');
      await goToMenu(page, 'final_evaluation');
      await expect(page.getByRole('heading', { name: 'ตรวจเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14)' })).toBeVisible();

      await page.click('text="สมชาย สายดี"');
      await expect(page.getByTestId('final-report-panel')).toContainText('รายละเอียดการส่งเล่มของนักศึกษา');

      await page.getByTestId('final-report-approve').click();
      await expect(page.locator('text="อนุมัติเล่มรายงานเรียบร้อยแล้ว"')).toBeVisible();

      await page.click('text="สมชาย สายดี"');
      await expect(page.locator('text="เล่มรายงานสหกิจศึกษานี้ได้รับการอนุมัติเรียบร้อยแล้ว"')).toBeVisible();

      // อาจารย์ไม่ได้ประเมินอีกแล้ว — ฟอร์ม 10 ข้อที่ระบบคิดขึ้นเองต้องหายไปจริง
      // ไม่มีแบบฟอร์มไหนในชุด 01-16 ที่อาจารย์เป็นผู้ประเมินผลหรือประเมินรายงาน
      await expect(page.locator('form select')).toHaveCount(0);
      await expect(page.locator('text="สหกิจ 15: 100/100"')).toBeVisible();
      await expect(page.locator('text="สหกิจ 16: 70/70"')).toBeVisible();

      await logout(page);
    });

    await test.step('เจ้าหน้าที่เห็นความคืบหน้า 100% และคะแนนสองใบ', async () => {
      await loginAs(page, 'staff1');
      await goToMenu(page, 'final_progress');
      await expect(page.locator('h1:has-text("กระดานติดตามสถานะและผลการประเมิน")')).toBeVisible();

      await expect(page.locator('text="สมชาย สายดี"')).toBeVisible();
      // ครบทุกขั้นแล้ว — แถวขึ้น "จบการปฏิบัติงานแล้ว" แทนเปอร์เซ็นต์ (ความคืบหน้า N% โชว์เฉพาะกรณียังไม่ครบ)
      await expect(page.locator('text="จบการปฏิบัติงานแล้ว"')).toBeVisible();

      // scope ด้วยแถว ไม่งั้น text="100" จะไปแมตช์ "100%" และหัวคอลัมน์ "(100)"
      const row = page.locator('tr', { hasText: 'สมชาย สายดี' });
      await expect(row).toContainText('100');
      await expect(row).toContainText('70');

      // สองใบคนละมาตร ห้ามมีช่องรวมกลับมาอีก
      await expect(page.locator('text="คะแนนสะสม (200)"')).toHaveCount(0);
    });
  });
});

/**
 * สิทธิ์ของเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14) — **เพิ่มเมื่อ 2026-09-04**
 *
 * ⚠️ ก่อนหน้านี้ทั้งระบบเล่มรายงาน **ไม่มี assertion เชิงลบเลยสักตัว** ทั้งในไฟล์นี้
 * และในไฟล์ฝั่งความปลอดภัย · ตัวโค้ดเรียก `assertCanReviewStudentWork` ครบทั้งสาม
 * endpoint อยู่แล้ว (คอมเมนต์ในคอนโทรลเลอร์บอกว่าเคย**ไม่มี**การตรวจเลย แล้วถูกแก้
 * ทีหลัง) — ชุดนี้จึงเป็นตัวกันไม่ให้การแก้ครั้งนั้นถูกถอยกลับโดยไม่มีใครรู้
 *
 * ⛔ เล่มรายงานมีชื่อนักศึกษาและเนื้องานของสถานประกอบการอยู่ข้างใน การเปิดให้
 * "อาจารย์คนไหนก็ได้" อ่านหรืออนุมัติ คือรูแบบเดียวกับที่ SEC-06 ถูกเขียนขึ้นมาปิด
 */
test.describe('สิทธิ์เล่มรายงานฉบับสมบูรณ์ (สหกิจ 14)', () => {
  const REPORT_ROUTES = (studentId: number, reportId: number) => ({
    read: `${API_URL}/final-reports/student/${studentId}`,
    review: `${API_URL}/final-reports/${reportId}/status`,
    notify: `${API_URL}/final-reports/notify-mentor/${studentId}`,
  });

  /** วางเล่มรายงานของ student2 ลงฐานตรงๆ — ชุดนี้ตรวจสิทธิ์ ไม่ได้ตรวจการอัปโหลด */
  async function seedReport(): Promise<{ studentId: number; reportId: number }> {
    const studentId = (await dbValue<number>(
      "SELECT user_id FROM users WHERE email = 'student2@test.com'"
    ))!;
    const reportId = (await dbValue<number>(
      `INSERT INTO final_reports (student_id, file_path, status, version)
       VALUES ($1, 'final_reports/seeded-report.pdf', 'submitted', 1)
       RETURNING report_id`,
      [studentId]
    ))!;
    return { studentId, reportId };
  }

  test.beforeEach(async () => {
    await seedTestData();
  });

  test('FR1: อาจารย์นอกความดูแล อ่าน/อนุมัติ/แจ้งพี่เลี้ยง เล่มของนักศึกษาคนอื่นไม่ได้', async ({
    request,
  }) => {
    const { studentId, reportId } = await seedReport();
    const r = REPORT_ROUTES(studentId, reportId);

    await apiLoginAs(request, 'advisor2');
    expect((await request.get(r.read)).status(), 'อ่านประวัติเล่ม').toBe(403);
    expect(
      (await request.patch(r.review, { data: { status: 'approved' } })).status(),
      'อนุมัติเล่ม'
    ).toBe(403);
    expect((await request.post(r.notify)).status(), 'สั่งแจ้งพี่เลี้ยง').toBe(403);

    // ⛔ สถานะต้องไม่ขยับแม้แต่นิดเดียว — 403 ที่ปล่อยให้ UPDATE ผ่านไปแล้วคือรูที่แย่กว่า
    expect(
      await dbValue<string>('SELECT status FROM final_reports WHERE report_id = $1', [reportId])
    ).toBe('submitted');

    // อาจารย์ที่ดูแลจริงต้องทำได้ — ไม่งั้นเทสต์นี้ผ่านเพราะระบบพังทั้งระบบ
    await apiLoginAs(request, 'advisor1');
    expect((await request.get(r.read)).status()).toBe(200);
  });

  test('FR2: นักศึกษาและสถานประกอบการ เข้าเส้นทางของบุคลากรไม่ได้', async ({ request }) => {
    const { studentId, reportId } = await seedReport();
    const r = REPORT_ROUTES(studentId, reportId);

    for (const who of ['student2', 'company1'] as const) {
      await apiLoginAs(request, who);
      // ⛔ แม้แต่เจ้าของเล่มเองก็อนุมัติเล่มตัวเองไม่ได้ — นั่นคือประเด็นของด่านนี้
      expect((await request.get(r.read)).status(), `${who} อ่านประวัติเล่ม`).toBe(403);
      expect(
        (await request.patch(r.review, { data: { status: 'approved' } })).status(),
        `${who} อนุมัติเล่ม`
      ).toBe(403);
      expect((await request.post(r.notify)).status(), `${who} สั่งแจ้งพี่เลี้ยง`).toBe(403);
    }

    expect(
      await dbValue<string>('SELECT status FROM final_reports WHERE report_id = $1', [reportId])
    ).toBe('submitted');
  });

  test('FR3: /my-report คืนของตัวเองเสมอ · บุคลากรเรียกไม่ได้', async ({ request }) => {
    const { reportId } = await seedReport();

    // ⛔ เส้นทางนี้จงใจไม่รับ id — ตัวตนมาจาก cookie เท่านั้น
    await apiLoginAs(request, 'student2');
    const mine = await request.get(`${API_URL}/final-reports/my-report`);
    expect(mine.status(), await mine.text()).toBe(200);
    expect(JSON.stringify(await mine.json())).toContain(String(reportId));

    // นักศึกษาอีกคนเรียกเส้นทางเดียวกัน ต้องไม่เห็นเล่มของ student2
    await apiLoginAs(request, 'student1');
    const other = await request.get(`${API_URL}/final-reports/my-report`);
    expect(other.status()).toBe(200);
    expect(JSON.stringify(await other.json())).not.toContain(String(reportId));

    // บุคลากรใช้เส้นทางของนักศึกษาไม่ได้ ต้องไปทาง /student/:id ที่มีด่าน SEC-06
    await apiLoginAs(request, 'advisor1');
    expect((await request.get(`${API_URL}/final-reports/my-report`)).status()).toBe(403);
  });

  test('FR4: ไม่ล็อกอิน → 401 · เล่มที่ไม่มีอยู่ → 404 · id ไม่ใช่ตัวเลข → 400', async ({
    request,
  }) => {
    const { studentId } = await seedReport();

    // 401 ต้องมาก่อน 403 เสมอ — คนที่ยังไม่ล็อกอินไม่ควรถูกบอกว่า "ไม่มีสิทธิ์"
    expect((await request.get(`${API_URL}/final-reports/my-report`)).status()).toBe(401);
    expect((await request.get(`${API_URL}/final-reports/student/${studentId}`)).status()).toBe(401);

    await apiLoginAs(request, 'advisor1');
    expect(
      (await request.patch(`${API_URL}/final-reports/999999/status`, {
        data: { status: 'approved' },
      })).status()
    ).toBe(404);
    expect((await request.get(`${API_URL}/final-reports/student/abc`)).status()).toBe(400);
  });

  test('FR5: ตีกลับเล่มต้องมีเหตุผล และเหตุผลต้องถูกเก็บบนแถว ไม่ใช่แค่ audit_log', async ({
    request,
  }) => {
    const { reportId } = await seedReport();
    await apiLoginAs(request, 'advisor1');
    const url = `${API_URL}/final-reports/${reportId}/status`;

    // สถานะนอก allow-list ต้องไม่ผ่าน
    const bogus = await request.patch(url, { data: { status: 'ผ่านแบบมีเงื่อนไข' } });
    expect(bogus.status(), await bogus.text()).toBe(400);

    // ⛔ คนที่ต้องอ่านเหตุผลคือนักศึกษา และ `audit_log` จงใจไม่มี read API (SEC-07)
    //    เหตุผลจึงต้องอยู่บนแถว ไม่ใช่ในบันทึกที่หน้าจอเปิดดูไม่ได้
    expect(
      (await request.patch(url, { data: { status: 'rejected', comment: 'บทที่ 3 ยังไม่ครบ' } })).status()
    ).toBe(200);
    const row = await dbRow<{ status: string; rejection_comment: string; reviewed_by: number }>(
      'SELECT status, rejection_comment, reviewed_by FROM final_reports WHERE report_id = $1',
      [reportId]
    );
    expect(row?.status).toBe('rejected');
    expect(row?.rejection_comment).toContain('บทที่ 3');
    expect(row?.reviewed_by).toBeTruthy();
  });
});
