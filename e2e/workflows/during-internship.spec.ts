import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { apiLoginAs, loginAs } from '../helpers/auth';
import pool from '../../backend/src/config/database';
import { dbExec, dbValue, withDb } from '../helpers/db';
import { goToMenu, logout } from '../helpers/nav';
import { API_URL } from '../helpers/env';

test.describe('Phase 3: Operation & Supervision Workflow', () => {

  const injectAcceptedIntent = async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const studentId = studentRes.rows[0].user_id;

      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      const companyId = companyRes.rows[0].company_id;

      const jobRes = await client.query("SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1", [companyId]);
      const jobId = jobRes.rows[0].job_id;

      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");
      const semesterId = semesterRes.rows[0].semester_id;

      // พี่เลี้ยง = mentor1 (seed ไว้แล้ว role mentor ล้วน แยกจาก company1)
      const mentorId = (await client.query("SELECT user_id FROM users WHERE email = 'mentor1@test.com'")).rows[0].user_id;

      await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, mentor_id, start_date)
         VALUES ($1, $2, $3, $4, 'accepted', $5, $6)`,
        [studentId, companyId, semesterId, jobId, mentorId, new Date().toISOString()]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to inject intent form:', error);
      throw error;
    } finally {
      client.release();
    }
  };

  test.beforeEach(async ({ page }) => {
    // Intercept and block Google Maps API calls
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");'
      });
    });
  });

  test('1. Student submits Weekly Log and Report Outline', async ({ page }) => {
    test.setTimeout(120000);
    await seedTestData();
    await injectAcceptedIntent();

    await loginAs(page, 'student2');

    // Submit Report Outline
    await goToMenu(page, 'report_outline'); // assuming Sidebar matches this
    await expect(page.getByRole('heading', { name: 'โครงร่างรายงาน (สหกิจ 11)' })).toBeVisible();
    
    // หน้าจอใหม่: หัวข้อ + โครงร่างเนื้อหาเป็นช่องบังคับ ไฟล์แนบเป็นทางเลือก และต้องกดส่งเอง
    // (เดิมเลือกไฟล์แล้วส่งทันที)
    await page.getByTestId('outline-title').fill('การพัฒนาระบบติดตามผลการทดสอบฮาร์ดดิสก์');
    await page.getByTestId('outline-text').fill('บทที่ 1 บทนำ\nบทที่ 2 ข้อมูลสถานประกอบการ\nบทที่ 3 วิธีดำเนินงาน');
    await page.getByTestId('outline-file-input').setInputFiles({
      name: 'coop11-draft.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('test pdf content')
    });
    await page.getByTestId('outline-submit').click();
    // ส่งถึงพี่เลี้ยงทันที — กล่องยืนยันแสดงหัวข้อและไฟล์ที่จะส่ง (2026-09-22)
    await expect(page.getByTestId('confirm-summary')).toContainText('coop11-draft.pdf');
    await page.getByTestId('outline-confirm').click();

    // Wait for the status to change to "รอตรวจสอบ" after successful upload
    // หัวข้อเปลี่ยนตอนรีเมคหน้าโครงร่าง — ตัวเลขในวงเล็บคือจำนวนฉบับที่ส่งจริง ต้องเป็น 1
    await expect(page.getByRole('heading', { name: 'ประวัติการส่งและผลตรวจ (1 เวอร์ชัน)' })).toBeVisible();

    // Submit Weekly Log — หน้ารีเมค: การ์ดความคืบหน้า + แท็บ 08/09/10 · แท็บ "รายสัปดาห์ · สหกิจ 09"
    // เป็นค่าตั้งต้น (ไม่มีสวิตช์แบบฟอร์มบริษัท → 5 ช่องบังคับ 4 ช่องแรก)
    await goToMenu(page, 'weekly_log');
    await expect(page.getByRole('heading', { name: 'บันทึกการปฏิบัติงาน', exact: true })).toBeVisible();
    await expect(page.getByTestId('worklog-tab-weekly')).toBeVisible();

    await page.getByTestId('weekly-assigned-work').fill('พัฒนาหน้าจอติดตามผลการทดสอบฮาร์ดดิสก์');
    await page.getByTestId('weekly-methods').fill('ออกแบบ UI แล้วเขียน React ต่อ API ที่มีอยู่');
    await page.getByTestId('weekly-tools').fill('React, TypeScript, Playwright');
    await page.getByTestId('weekly-achievements').fill('ทำหน้าจอเสร็จและเชื่อม API ได้');
    await page.getByTestId('worklog-submit').click();

    await expect(page.getByText('ส่งบันทึกการปฏิบัติงานรายสัปดาห์เรียบร้อยแล้ว')).toBeVisible();

    // สัปดาห์ที่ 1 ต้องขึ้นสถานะ "รอพี่เลี้ยงรับรอง" ในชิปความคืบหน้า
    await expect(page.getByTestId('worklog-week-1')).toContainText('รอ');
  });

  // ⛔ เดิมชื่อ "Advisor drafts Appointment -> Staff sends -> Mentor Reschedules -> Advisor accepts"
  //    แต่เนื้อเทสต์ไม่เคยร่าง ส่ง หรือเลื่อนนัดเลย — ตรวจแค่ว่าสองหน้าจอเปิดได้ ชื่อนั้นทำให้
  //    เข้าใจผิดว่าเส้นนัดนิเทศมีเทสต์คุม · เส้นจริงอยู่ที่ supervision-appointment-flow.spec.ts
  test('2. หน้านิเทศของอาจารย์และคิวนัดของเจ้าหน้าที่เปิดได้ (ยังไม่มีนัด = คิวว่าง)', async ({ page }) => {
    test.setTimeout(120000);
    await seedTestData();

    await loginAs(page, 'advisor1');

    // spec-F ข้อ 1: นัดหมายนิเทศย้ายไปอยู่ฝ่ายนิเทศ — สลับฝ่ายก่อน
    await page.getByTestId('role-btn-supervisor').click();
    await goToMenu(page, 'supervision');
    // Was "แผนที่การกระจายตัวของนักศึกษา" — a placeholder box that claimed to
    // plot a fixed 15 students. Replaced by a province breakdown of the real list.
    await expect(page.locator('text="พื้นที่ที่ต้องเดินทางไปนิเทศ"')).toBeVisible();

    await logout(page);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'appointments');
    
    // ยังไม่ได้ seed ร่างนัดหมายไว้ ตารางจึงต้องว่าง — หน้ารีเมค (E9) รวมทุกสถานะไว้ตารางเดียว
    // ข้อความตอนว่างจึงเปลี่ยนจาก “ไม่มีแบบร่างนัดหมายที่รอส่ง” เป็นข้อความรวม
    await expect(page.getByText('ไม่มีรายการนัดหมายในขณะนี้')).toBeVisible();
  });

  test('3. Mentor reviews and approves student report outline (Part 1.1)', async ({ page }) => {
    test.setTimeout(120000);
    await seedTestData();
    await injectAcceptedIntent();

    // 1. Student uploads outline
    const client = await pool.connect();
    let outlineId: number;
    try {
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const studentId = studentRes.rows[0].user_id;
      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      const companyId = companyRes.rows[0].company_id;

      const insRes = await client.query(
        `INSERT INTO report_outlines (student_id, company_id, status) VALUES ($1, $2, 'pending_mentor') RETURNING outline_id`,
        [studentId, companyId]
      );
      outlineId = insRes.rows[0].outline_id;

      await client.query(
        `INSERT INTO report_outline_versions (outline_id, file_path, status) VALUES ($1, 'report_outlines/test-outline.pdf', 'submitted')`,
        [outlineId]
      );
    } finally {
      client.release();
    }

    // 2. Mentor logs in (mentor1 — ฝั่งบริษัทเห็นคิวแต่พิจารณาไม่ได้ ตามที่ company-mentor-permissions คุมไว้)
    await loginAs(page, 'mentor1');

    // Navigate to Report Outlines tab
    await goToMenu(page, 'report_outlines');
    await expect(page.locator('text="โครงร่างรายงานการปฏิบัติงานสหกิจศึกษา (สหกิจ 11)"')).toBeVisible();
    await expect(page.locator('text="รอพี่เลี้ยงตรวจ"')).toBeVisible();

    // Click "ตรวจอนุมัติ" button
    await page.click('button:has-text("ตรวจอนุมัติ")');
    await expect(page.locator('text="พิจารณาโครงร่างรายงาน (สหกิจ 11)"')).toBeVisible();

    // Fill comment and approve
    await page.locator('textarea').fill('เนื้อหาโครงร่างสมบูรณ์ พี่เลี้ยงเห็นชอบตามนี้');
    await page.click('button:has-text("อนุมัติและส่งต่ออาจารย์ที่ปรึกษา")');

    // Verify success banner and status change to "พี่เลี้ยงอนุมัติแล้ว (รอ อ.ที่ปรึกษา)"
    await expect(page.locator('text="พี่เลี้ยงอนุมัติแล้ว (รอ อ.ที่ปรึกษา)"')).toBeVisible();

    // Check DB status directly
    await withDb(async (db) => {
      const res = await db.query('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId]);
      expect(res.rows[0].status).toBe('pending_advisor');
    });
  });

  test('4. Advisor reviews and approves student report outline (Part 1.2)', async ({ page }) => {
    test.setTimeout(120000);
    await seedTestData();
    await injectAcceptedIntent();

    // 1. Student uploads outline and mentor approves it to pending_advisor state
    const client = await pool.connect();
    let outlineId: number;
    try {
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const studentId = studentRes.rows[0].user_id;
      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      const companyId = companyRes.rows[0].company_id;

      const insRes = await client.query(
        `INSERT INTO report_outlines (student_id, company_id, status) VALUES ($1, $2, 'pending_advisor') RETURNING outline_id`,
        [studentId, companyId]
      );
      outlineId = insRes.rows[0].outline_id;

      await client.query(
        `INSERT INTO report_outline_versions (outline_id, file_path, status) VALUES ($1, 'report_outlines/test-outline.pdf', 'submitted')`,
        [outlineId]
      );
    } finally {
      client.release();
    }

    // 2. Advisor logs in
    await loginAs(page, 'advisor1');

    // Navigate to Report Outlines tab — หน้ารีเมค: แท็บซ้าย + แผงตรวจขวา (spec-F ข้อ 5)
    // แท็บ pending_advisor เป็นค่าตั้งต้น และเลือกแถวแรกให้อัตโนมัติเมื่อไม่มี ?outline=
    await goToMenu(page, 'report_outlines');
    await expect(page.getByTestId('outline-tab-pending_advisor')).toBeVisible();
    await expect(page.getByTestId(`outline-row-${outlineId}`)).toBeVisible();
    await expect(page.getByTestId('outline-review-panel')).toBeVisible();

    // Fill comment and approve
    await page.getByTestId('outline-review-comment').fill('อาจารย์ที่ปรึกษาพิจารณาแล้วอนุมัติโครงร่างรายงาน');
    await page.getByTestId('outline-approve').click();

    // Verify success status — ข้อความสำเร็จบอกชื่อนักศึกษา ไม่ใช่ป้ายตายตัว
    await expect(page.getByText('เห็นชอบโครงร่างรายงานของ')).toBeVisible();
    await expect(page.getByText('เรียบร้อยแล้ว')).toBeVisible();

    // แผงพลิกเป็นอ่านอย่างเดียวทันทีตามสถานะจริงของใบ ไม่ต้องรอเปลี่ยนแท็บ
    await expect(page.getByTestId('outline-approve')).not.toBeVisible();

    // Check DB status directly
    await withDb(async (db) => {
      const res = await db.query('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId]);
      expect(res.rows[0].status).toBe('approved');
    });
  });

  test('5. Advisor views student Weekly Log modal (Part 1.3)', async ({ page }) => {
    test.setTimeout(120000);
    await seedTestData();
    await injectAcceptedIntent();

    // 1. Student submits a weekly log
    await withDb(async (db) => {
      const studentRes = await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const studentId = studentRes.rows[0].user_id;

      await db.query(
        `INSERT INTO weekly_logs (student_id, week_number, achievements, problems) 
         VALUES ($1, 1, 'ออกแบบและพัฒนา RESTful API ด้วย Express TypeScript', 'มีคำถามเกี่ยวกับ Auth Token')`,
        [studentId]
      );
    });

    // 2. Advisor logs in
    await loginAs(page, 'advisor1');

    // Navigate to Student List — F2 (spec-F ข้อ 4 · 17): โมดัลบันทึกรายสัปดาห์ย้ายมาเป็นแท็บในแผงขวา
    await goToMenu(page, 'students');
    await expect(page.getByRole('heading', { name: 'นักศึกษาในสาขา', level: 1 })).toBeVisible();
    // ค่าตั้งต้น = เฉพาะที่ฉันดูแล · student2 เป็นนักศึกษาในที่ปรึกษาของ advisor1 ใน seed
    await expect(page.getByTestId('advisor-students-scope')).toHaveAttribute('data-scope', 'mine');

    const studentId = await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'");
    await page.getByTestId(`advisor-student-row-${studentId}`).click();

    const panel = page.getByTestId('advisor-student-panel');
    await expect(panel).toBeVisible();
    await panel.getByTestId('advisor-student-tab-weekly').click();
    await expect(panel.getByText('ออกแบบและพัฒนา RESTful API ด้วย Express TypeScript')).toBeVisible();
  });
});

/**
 * สิทธิ์ของบันทึกการปฏิบัติงานรายสัปดาห์ (สหกิจ 09) — **เพิ่มเมื่อ 2026-09-04**
 *
 * ⚠️ ก่อนหน้านี้บันทึกรายสัปดาห์ไม่มี assertion เชิงลบเลยสักตัวทั้งชุด
 * ตัวโค้ดมีด่านครบสามชั้นอยู่แล้ว (นักศึกษาเห็นของตัวเอง · พี่เลี้ยงเห็นเฉพาะคนที่
 * ผูกกับตน · อาจารย์ผ่าน `assertCanReviewStudentWork`) — ชุดนี้เป็นตัวกันไม่ให้
 * ด่านพวกนั้นหายไประหว่างการรื้อ สหกิจ 09 ให้ครบ 5 หัวข้อที่กำลังจะทำ
 *
 * 🟡 **ยังไม่ครอบคลุมสาขาของพี่เลี้ยง** — บัญชีพี่เลี้ยงเกิดจากลิงก์เชิญ ไม่ได้อยู่ใน
 *    ชุดบัญชีซีด · เติมตอนทำ สหกิจ 09 ซึ่งจะมีขั้น "พี่เลี้ยงกดรับรอง" อยู่แล้ว
 */
test.describe('สิทธิ์บันทึกรายสัปดาห์ (สหกิจ 09)', () => {
  test.beforeEach(async () => {
    await seedTestData();
  });

  const logsOf = (studentId: number) => `${API_URL}/weekly-logs/student/${studentId}`;

  test('WL1: นักศึกษาอ่านบันทึกของเพื่อนไม่ได้ แต่ของตัวเองได้', async ({ request }) => {
    const student2 = (await dbValue<number>(
      "SELECT user_id FROM users WHERE email = 'student2@test.com'"
    ))!;
    const student1 = (await dbValue<number>(
      "SELECT user_id FROM users WHERE email = 'student1@test.com'"
    ))!;

    await dbExec(
      `INSERT INTO weekly_logs (student_id, week_number, achievements, problems)
       VALUES ($1, 1, 'งานที่ทำสัปดาห์แรก', 'ยังไม่พบปัญหา')`,
      [student2]
    );

    await apiLoginAs(request, 'student2');
    const own = await request.get(logsOf(student2));
    expect(own.status(), await own.text()).toBe(200);

    // ⛔ เดา id ของเพื่อนแล้วอ่านได้ คือรู IDOR ตรงๆ
    await apiLoginAs(request, 'student1');
    expect((await request.get(logsOf(student2))).status()).toBe(403);
    // ของตัวเองยังเปิดได้ (ว่างเปล่าก็ต้องเป็น 200 ไม่ใช่ 403)
    expect((await request.get(logsOf(student1))).status()).toBe(200);
  });

  test('WL2: อาจารย์นอกความดูแลอ่านไม่ได้ · ที่ปรึกษาของนักศึกษาคนนั้นอ่านได้', async ({
    request,
  }) => {
    const student2 = (await dbValue<number>(
      "SELECT user_id FROM users WHERE email = 'student2@test.com'"
    ))!;

    await apiLoginAs(request, 'advisor2');
    expect((await request.get(logsOf(student2))).status()).toBe(403);

    // ตัวคุมว่าเทสต์ข้างบนผ่านเพราะด่านทำงาน ไม่ใช่เพราะทั้งเส้นทางพัง
    await apiLoginAs(request, 'advisor1');
    expect((await request.get(logsOf(student2))).status()).toBe(200);
  });

  test('WL3: ไม่ล็อกอิน → 401 · สถานประกอบการ → 403 · id ไม่ใช่ตัวเลข → 400', async ({
    request,
  }) => {
    const student2 = (await dbValue<number>(
      "SELECT user_id FROM users WHERE email = 'student2@test.com'"
    ))!;

    expect((await request.get(logsOf(student2))).status()).toBe(401);

    // ⛔ บทบาท `company` ไม่อยู่ใน allow-list ของเส้นทางนี้ — บันทึกรายสัปดาห์เป็น
    //    ของนักศึกษากับผู้ดูแลการปฏิบัติงาน ไม่ใช่ของฝ่ายบุคคล
    await apiLoginAs(request, 'company1');
    expect((await request.get(logsOf(student2))).status()).toBe(403);

    await apiLoginAs(request, 'student2');
    expect((await request.get(`${API_URL}/weekly-logs/student/abc`)).status()).toBe(400);
  });

  test('WL4: นักศึกษาส่งบันทึกให้คนอื่นไม่ได้ — เจ้าของมาจาก cookie ไม่ใช่จาก body', async ({
    request,
  }) => {
    const student1 = (await dbValue<number>(
      "SELECT user_id FROM users WHERE email = 'student1@test.com'"
    ))!;

    await apiLoginAs(request, 'student2');
    // ยัด `student_id` ของคนอื่นมาใน body — คอนโทรลเลอร์ต้องเมินแล้วใช้ตัวตนจาก token
    const res = await request.post(`${API_URL}/weekly-logs`, {
      data: {
        student_id: student1,
        week_number: 5,
        achievements: 'พยายามเขียนลงบัญชีคนอื่น',
        problems: '',
      },
    });

    // จะผ่าน (201) หรือถูกปฏิเสธก็ได้ แต่ **ห้ามมีแถวของ student1 เกิดขึ้น**
    expect([200, 201, 400, 403]).toContain(res.status());
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM weekly_logs WHERE student_id = $1', [student1])
    ).toBe('0');
  });
});

