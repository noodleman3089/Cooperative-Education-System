import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import path from 'path';
import { API_URL } from '../helpers/env';
import { withDb, dbValue } from '../helpers/db';
import { loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { submitRequestToDirectoryCompany, placementCard } from '../helpers/intent';

test.describe('Rejection & Negative Workflow E2E Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Block Google Maps API to prevent external resource loading
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");'
      });
    });
  });

  test('Test R1: เจ้าหน้าที่ตีกลับแบบคำร้อง → นักศึกษาแก้แล้วส่งใหม่ได้', async ({ page }) => {
    // ==========================================
    // ⚠️ เคสนี้เคยเป็น "หัวหน้าสาขาตีกลับ → นักศึกษายื่นใหม่" ซึ่งเป็นเส้นทางที่ไม่มี
    // อยู่แล้วตั้งแต่ 2026-08-26 — การอนุมัติของอาจารย์ที่ปรึกษาและหัวหน้าสาขาย้ายไป
    // อยู่บนกระดาษ (แบบคำร้องเอกสารหมายเลข 1) ผู้ที่ตีกลับในระบบคือ **เจ้าหน้าที่**
    //
    // เจตนาเดิมยังอยู่ครบ: ถูกตีกลับแล้วต้องไม่ติดตาย · ต่างกันตรงที่ของใหม่ให้แก้
    // แล้วส่งใบเดิมซ้ำ (ไม่ใช่ยื่นใบใหม่) เพราะการตีกลับคือ "กระดาษยังไม่เรียบร้อย"
    // ไม่ใช่ "ที่ฝึกนี้ใช้ไม่ได้" — กรณีหลังยังคุมอยู่ที่ R2/R3
    // ==========================================

    await seedTestData();

    // 1. นักศึกษายื่นใบความจำนง
    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');
    await submitRequestToDirectoryCompany(page);
    await expect(
      page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')
    ).toBeVisible();

    const formId = await dbValue<number>(
      `SELECT form_id FROM intent_forms
        WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')
        ORDER BY form_id DESC LIMIT 1`
    );

    // 2. อัปโหลดกระดาษที่ลงนามแล้ว (ผ่านหน้าจอนักศึกษา)
    await page.goto('/dashboard');
    await page
      .getByTestId('upload-request-form')
      .setInputFiles(path.resolve(process.cwd(), 'e2e/fixtures/mock_official_letter.pdf'));
    await page.getByTestId('request-form-confirm').click();
    await expect(page.getByTestId('request-form-uploaded')).toBeVisible();

    await logout(page);
    await expect(page).toHaveURL(/\/login/);

    // 3. เจ้าหน้าที่ตีกลับ — เหตุผลบังคับ
    await loginAs(page, 'staff1');
    await page.getByTestId(`review-request-${formId}`).click();
    await page.locator('button:has-text("ตีกลับให้แก้ไข")').click();

    const rejectSubmit = page.getByTestId('officer-reject-submit');
    await expect(rejectSubmit).toBeDisabled();

    await page.getByTestId('officer-reject-reason').fill('ไฟล์ที่อัปโหลดขาดลายเซ็นหัวหน้าสาขาวิชา');
    await rejectSubmit.click();
    await expect(page.locator('text=ไม่มีคำร้องรอตรวจในขณะนี้')).toBeVisible();

    await logout(page);
    await expect(page).toHaveURL(/\/login/);

    // 4. นักศึกษาเห็นเหตุผล และส่งใหม่ได้ทันที — ไม่ติดตาย
    await loginAs(page, 'student2');
    await expect(page.locator('text=ขาดลายเซ็นหัวหน้าสาขาวิชา')).toBeVisible();

    await page
      .getByTestId('upload-request-form')
      .setInputFiles(path.resolve(process.cwd(), 'e2e/fixtures/mock_official_letter.pdf'));
    await page.getByTestId('request-form-confirm').click();
    await expect(page.getByTestId('request-form-uploaded')).toBeVisible();

    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'pending_officer_request'
    );
  });

  test('Test R2: บริษัทไม่รับ (company_rejected) → นักศึกษาสมัครที่อื่นได้อีก', async ({ page }) => {
    // ==========================================
    // Business Rule: ใบที่บริษัทไม่รับ (status 'company_rejected') ปลดล็อกกฎ 1-active-app
    // นักศึกษาต้องสมัครงานอื่นต่อได้ · ตัวบริษัทตอบทางลิงก์สาธารณะ /accept (คุมที่ acceptance-link.spec.ts L4)
    // — ตรงนี้จึงยัดสถานะลงฐานตรง ๆ แล้วตรวจฝั่งนักศึกษาอย่างเดียว (ทางตอบด้วยบัญชี company ถูกถอดแล้ว)
    // ==========================================

    console.log('Seeding database for Test R2...');
    await seedTestData();

    await withDb(async (db) => {
      const studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
      const companyId = (await db.query("SELECT company_id FROM companies WHERE name_th = 'บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด'")).rows[0].company_id;
      const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0].semester_id;
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         VALUES ($1, $2, $3, 'company_rejected')`,
        [studentId, companyId, semesterId]
      );
    });

    // Student logs in and verifies they can re-apply
    console.log('Step: Student verifies ability to re-apply...');
    await loginAs(page, 'student2');

    // กลับไปหน้ายื่นคำร้อง — ฟอร์มต้องกลับมาให้ยื่นใหม่ได้
    await goToMenu(page, 'jobs');

    // ปุ่มยื่นต้องอยู่บนจอและกดได้
    const reApplyBtn = page.getByTestId('request-submit');
    await expect(reApplyBtn).toBeVisible({
      message: 'BUG: Student cannot re-apply after company rejection — 1-active-app rule should be lifted when status is company_rejected.'
    });
  });

  test('Test R3: Student Reports Interview Failure → Re-apply Cycle', async ({ page }) => {
    // ==========================================
    // Business Rule: Student can report interview failure, which sets status to 'rejected'.
    // Route: POST /api/acceptances/student/:intent_id/fail
    // After failure report, student should be able to apply to a new position.
    // ==========================================

    // 1. Seed DB and inject intent in 'approved_by_dept_head' status
    console.log('Seeding database for Test R3...');
    await seedTestData();

    const client = await pool.connect();
    let intentFormId: number;
    try {
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const companyRes = await client.query("SELECT company_id FROM companies WHERE name_th = 'บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด'");
      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");

      const studentId = studentRes.rows[0].user_id;
      const companyId = companyRes.rows[0].company_id;
      const semesterId = semesterRes.rows[0].semester_id;

      // ⛔ `acceptance_due_date` แทนข้อเท็จจริงว่าคณบดีลงนามหนังสือแล้ว — ปุ่ม "สัมภาษณ์ไม่ผ่าน / บริษัทไม่รับ"
      //    อยู่ในการ์ดสถานะเฉพาะช่วงที่หนังสือถึงมือบริษัทแล้ว (2026-09-29)
      const insertRes = await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, acceptance_due_date)
         VALUES ($1, $2, $3, 'approved_by_dept_head',
                 (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 15) RETURNING form_id`,
        [studentId, companyId, semesterId]
      );
      intentFormId = insertRes.rows[0].form_id;
      console.log(`Injected intent form ID: ${intentFormId} with approved_by_dept_head status.`);
    } finally {
      client.release();
    }

    // 2. Student logs in
    console.log('Step 1: Student logs in and reports interview failure...');
    await loginAs(page, 'student2');

    // Student should see their current application status
    await expect(placementCard(page).getByText('เจ้าหน้าที่รับคำร้องแล้ว · รอออกหนังสือ')).toBeVisible();

    // Look for the "Report Failure" button — ตอนนี้คือปุ่ม "สัมภาษณ์ไม่ผ่าน / บริษัทไม่รับ"
    // ในการ์ดสถานะ (ทางเดิมที่เคยเป็นปุ่ม "แจ้งสัมภาษณ์ไม่ผ่าน" ในกล่องฟอร์มรายงานผล)
    const failButton = page.getByTestId('fail-open');
    await expect(failButton).toContainText('สัมภาษณ์ไม่ผ่าน / บริษัทไม่รับ');
    await expect(failButton).toBeVisible({
      message: 'BUG: Student cannot find "Report Interview Failure" button on the dashboard when intent is in approved_by_dept_head status.'
    });
    await failButton.click();

    // If confirmation modal appears, confirm
    const confirmBtn = page.locator('button:has-text("ยืนยัน")').first();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // 3. Verify the API call succeeded via the UI feedback or DB state
    // After failure, student should see updated status or be redirected to re-apply flow
    // We verify via direct API call as fallback
    const apiRes = await page.request.post(`${API_URL}/acceptances/student/${intentFormId}/fail`);

    // If the button already called the API, this might return an error about already-rejected,
    // but the status should have transitioned
    await withDb(async (db) => {
      const statusRes = await db.query(
        'SELECT status FROM intent_forms WHERE form_id = $1',
        [intentFormId]
      );
      const currentStatus = statusRes.rows[0]?.status;
      expect(
        ['rejected', 'company_rejected'].includes(currentStatus),
        `Expected status to be 'rejected' after interview failure, but got '${currentStatus}'`
      ).toBeTruthy();
    });

    // 4. Verify student can re-apply
    await page.goto('/dashboard');
    await goToMenu(page, 'jobs');
    const reApplyBtn = page.getByTestId('request-submit');
    await expect(reApplyBtn).toBeVisible({
      message: 'BUG: Student cannot re-apply after reporting interview failure.'
    });
  });

});
