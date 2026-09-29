import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import path from 'path';
import { loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { dbExec, dbValue } from '../helpers/db';

test.describe('New Systems E2E Tests (System 1, 2, 3)', () => {
  
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

  test('Continuous Workflow: Assignment -> Dispatch -> Accommodation', async ({ page }) => {
    test.setTimeout(120000); // Allow more time for full workflow
    
    // 1. Reset and seed test database
    await seedTestData();

    // Inject 'accepted' intent form for student2 to bypass System 0 UI flows
    const client = await pool.connect();
    let studentId;
    try {
      await client.query('BEGIN');
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      studentId = studentRes.rows[0].user_id;

      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      const companyId = companyRes.rows[0].company_id;

      const jobRes = await client.query("SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1", [companyId]);
      const jobId = jobRes.rows[0].job_id;

      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");
      const semesterId = semesterRes.rows[0].semester_id;

      // พี่เลี้ยง = mentor1 (seed ไว้แล้วโดย seedTestData)
      const mentorId = (await client.query("SELECT user_id FROM users WHERE email = 'mentor1@test.com'")).rows[0].user_id;

      await client.query(
        // end_date ต้องมี — หน้าแผนงานคำนวณเดือน (สหกิจ 07 หน้า 3) และจำนวนสัปดาห์จากช่วงวันจริง
        // ใบที่ตอบรับจริงผ่านสถานประกอบการมีทั้งสองวันเสมอ · 16 สัปดาห์ = 112 วัน
        `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, mentor_id, start_date, end_date)
         VALUES ($1, $2, $3, $4, 'accepted', $5, CURRENT_DATE, CURRENT_DATE + 111)`,
        [studentId, companyId, semesterId, jobId, mentorId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to inject intent form:', error);
      throw error;
    } finally {
      client.release();
    }

    await test.step('System 2: Supervisor Assignment (Dept Head)', async () => {
      await loginAs(page, 'head1');
      await goToMenu(page, 'assignment');

      // Verify student is listed
      await expect(page.locator('text=640101001')).toBeVisible();

      // Check student checkbox
      await page.locator('input[type="checkbox"]').nth(1).check();

      // Click assign button
      await page.locator('button:has-text("กำหนดอาจารย์แบบกลุ่ม")').click();

      // Scope to the dialog. A bare `select` used to be unambiguous; the screen
      // behind now has its own eligibility and advisor filters, so nth(0) was
      // picking up the filter bar. Same lesson as the `button[aria-expanded]`
      // selector that matched the notification bell.
      const assignDialog = page.locator('[role="dialog"]');

      // ⛔ อย่าเลือกด้วย `{ label: 'advisor1@test.com' }` — `selectOption` เทียบ label
      //    แบบตรงเป๊ะ ส่วนตัวเลือกจริงเป็น "ชื่อ นามสกุล (อีเมล)" เมื่อบุคลากรมีชื่อ
      //    และเหลือแค่อีเมลเมื่อไม่มี (ดู `AssignAdvisorModal.tsx:25`)
      //    เคสนี้เคยผ่านเพราะ seed ไม่ได้ใส่ชื่อให้อาจารย์ — พอเติมชื่อเมื่อ 2026-08-27
      //    label ก็เปลี่ยนทันที · หาค่า value จาก option ที่ "มีอีเมลอยู่ข้างใน" แทน
      const pickByEmail = async (index: number, email: string) => {
        const select = assignDialog.locator('select').nth(index);
        const value = await select.locator('option', { hasText: email }).getAttribute('value');
        expect(value, `ไม่พบตัวเลือกที่มีอีเมล ${email}`).toBeTruthy();
        await select.selectOption(value as string);
      };
      await pickByEmail(0, 'advisor1@test.com'); // อาจารย์ที่ปรึกษา
      await pickByEmail(1, 'advisor1@test.com'); // อาจารย์นิเทศ
      
      // Confirm assignment
      await page.locator('button:has-text("บันทึกการจัดสรร")').click();

      // Verify success
      await expect(page.locator('text=กำหนดอาจารย์สำหรับนักศึกษาจำนวน')).toBeVisible();
      
      await logout(page);

    });
    // ⛔ ขั้น 'System 1: Dispatch Letter Generation (Staff)' ถูกถอดเมื่อ 2026-08-26
    // พร้อมกับหน้าออกหนังสือส่งตัวและ POST /documents/generate-dispatch — เจ้าหน้าที่
    // ไม่มีเมนูนั้นแล้ว · ขั้นถัดไปไม่เคยพึ่งหนังสือส่งตัว ลำดับที่เหลือจึงยังสมเหตุผล
    // 🔴 เมื่อสร้างวิธีออกเอกสารแบบใหม่ ให้เขียนขั้นนี้กลับเข้ามา

    await test.step('System 3: Accommodation & Work Plan (Student)', async () => {
      await dbExec(
        `UPDATE students SET emergency_contact_name = 'นายฉุกเฉิน ทดสอบ', emergency_relationship = 'บิดา',
                emergency_phone = '089-123-4567'
         WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')`
      );
      await loginAs(page, 'student2');
      // Sidebar label (Sidebar.tsx menuConfig.student) — was 'แจ้งที่พักและแผนงาน'
      await goToMenu(page, 'accommodation_plan');

      // Step 1: Fill Accommodation
      //
      // ⛔ ที่อยู่เป็น **ช่องแยกตามใบ สหกิจ 06** ตั้งแต่ 2026-09-03 ไม่ใช่ textarea ก้อนเดียว
      //    · ตำบล/อำเภอ/จังหวัดเป็น dropdown ที่ผูกกับชุดข้อมูลจริง จึงใส่ชื่อมั่วไม่ได้แล้ว
      //    · เลือกจังหวัดแล้วต้องรอชุดข้อมูล 7,452 ตำบลโหลดเสร็จ (dynamic import)
      // หน้ารีเมคเป็นหน้าเดียว ไม่มี wizard สองขั้นแล้ว — หัวข้อส่วนที่พักเปลี่ยนตาม
      await expect(page.getByRole('heading', { name: 'ที่พักระหว่างการปฏิบัติงาน (สหกิจ 06)' })).toBeVisible();
      await page.getByTestId('acc-house-no').fill('123/45');
      await page.getByTestId('acc-road').fill('สุขุมวิท');

      await expect(page.getByTestId('acc-province')).toBeEnabled();
      await page.getByTestId('acc-province').selectOption('ชลบุรี');
      await page.getByTestId('acc-district').selectOption('ศรีราชา');
      await page.getByTestId('acc-subdistrict').selectOption('บางพระ');
      // รหัสไปรษณีย์ถูกเติมให้จากตำบล ไม่ต้องพิมพ์
      await expect(page.getByTestId('acc-postal-code')).toHaveValue('20110');

      await page.getByTestId('acc-phone').fill('02-123-4567');
      // ผู้ติดต่อฉุกเฉินไม่ได้กรอกที่หน้านี้แล้ว — อ่านอย่างเดียวจากข้อมูลที่นักศึกษากรอกในใบสมัคร สหกิจ 03
      // (ตั้งไว้ก่อนล็อกอินใน step นี้) · ขั้นอาจารย์ด้านล่างยังต้องเห็นชื่อนี้ (spec-F ข้อ 17 "คงไว้")
      await expect(page.getByTestId('acc-emg-name')).toHaveValue('นายฉุกเฉิน ทดสอบ');

      // Step 2: แผนปฏิบัติงาน — ของหลักคือเมทริกซ์หัวข้องาน × เดือน (สหกิจ 07 หน้า 3)
      //         แผนรายสัปดาห์เป็นส่วนประกอบในแถบพับ `แผนรายสัปดาห์ประกอบ`
      await page.getByTestId('plan-add-topic').click();
      await page.getByTestId('plan-topic-input-0').fill('ทดสอบระบบและศึกษาโค้ด');
      await page.getByTestId('plan-cell-0-1').click();

      await page.getByText(/แผนรายสัปดาห์ประกอบ/).click();
      const weekRows = page.getByTestId('week-row');
      const weekCount = await weekRows.count();
      expect(weekCount).toBeGreaterThanOrEqual(16);
      for (let w = 1; w <= weekCount; w++) {
        await page.getByTestId(`weekly-plan-task-${w}`).fill(`สัปดาห์ที่ ${w} ทำการทดสอบระบบและศึกษาโค้ด`);
      }

      // Submit Work Plan
      await page.getByTestId('workplan-submit-mentor').click();
      // ส่งถึงพี่เลี้ยงทันที — ต้องผ่านกล่องยืนยัน (2026-09-22)
      await page.getByTestId('workplan-confirm').click();

      // Verify Success
      await expect(page.getByText('ส่งแผนปฏิบัติงานให้พี่เลี้ยงรับรองเรียบร้อยแล้ว')).toBeVisible();
      // ⛔ แผนรายสัปดาห์ต้องถึงฐานจริง — ขั้นอาจารย์ด้านล่างอ่านข้อความนี้ (spec-F 6.1 "ต้องยังมี")
      expect(
        await dbValue<string>(
          `SELECT COUNT(*) FROM weekly_work_plans w JOIN users u ON u.user_id = w.student_id
           WHERE u.email = 'student2@test.com' AND w.tasks LIKE 'สัปดาห์ที่ 1 %'`
        )
      ).toBe('1');

      await logout(page);

    });
    await test.step('System 3: Advisor Verification', async () => {
      await loginAs(page, 'advisor1');
      // spec-F ข้อ 1: เมนูนัดหมายนิเทศย้ายไป `menuConfig.supervisor` — สลับฝ่ายก่อน
      await page.getByTestId('role-btn-supervisor').click();
      await goToMenu(page, 'supervision');

      // Verify student is listed in supervision dashboard
      await expect(page.locator('text=640101001')).toBeVisible();
      
      // ที่อยู่ถูกประกอบจากช่องย่อยที่เซิร์ฟเวอร์ (utils/accommodationAddress.ts)
      // — ถ้ารูปแบบเปลี่ยน เทสต์นี้จะแดง ซึ่งตั้งใจให้เป็นแบบนั้น
      await expect(page.getByTestId('supervision-accommodation')).toContainText(
        'เลขที่ 123/45 ถนนสุขุมวิท ตำบลบางพระ อำเภอศรีราชา จังหวัดชลบุรี 20110'
      );
      await expect(page.locator('text=นายฉุกเฉิน ทดสอบ')).toBeVisible();

      // Verify work plan is visible — แถบพับ ต้องกดเปิดก่อนถึงเห็นรายบรรทัด (SupervisionTracking.tsx)
      await page.getByText(/แผนปฏิบัติงานรายสัปดาห์:/).click();
      await expect(page.locator('text=สัปดาห์ที่ 1 ทำการทดสอบระบบและศึกษาโค้ด')).toBeVisible();
      await expect(page.locator('text=สัปดาห์ที่ 16 ทำการทดสอบระบบและศึกษาโค้ด')).toBeVisible();
      
    });
  });
});
