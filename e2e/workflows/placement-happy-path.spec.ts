import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import path from 'path';
import { API_URL } from '../helpers/env';
import { loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { approveIntentThroughOfficer, submitRequestToDirectoryCompany, placementCard } from '../helpers/intent';
import { dbValue } from '../helpers/db';

test.describe('Cooperative Education System Workflow E2E Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    // Intercept and block Google Maps API calls to prevent loading external resources and credentials issues
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");'
      });
    });
  });

  test('Scenario 1: Full Online Cooperative Education Workflow (Happy Path)', async ({ page }) => {
    // 1. Reset and seed test database
    await seedTestData();

    // 2. Student Logs in and Submits Intent Form
    await loginAs(page, 'student2');

    // Verify successful login by checking the student dashboard URL
    await expect(page).toHaveURL(/\/dashboard/);
    // แถบตัวตน (ชื่อ·รหัส) ถูกเอาออกจากหน้าแรกนักศึกษาใน `9309a27` — ใช้การ์ดที่ฝึกงานเป็นหลักฐานว่าเข้าหน้าแรกจริง
    await expect(placementCard(page)).toBeVisible();

    // ไปหน้ายื่นคำร้องขอหนังสือ (เมนู jobs)
    await goToMenu(page, 'jobs');

    // Find the Seagate job post and apply
    await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();
    await submitRequestToDirectoryCompany(page);

    // Verify submission success toast/banner
    await expect(page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')).toBeVisible();

    // Logout student
    await logout(page);
    await expect(page).toHaveURL(/\/login/);

    // 3. อาจารย์ที่ปรึกษาและหัวหน้าสาขาเห็นใบความจำนง แต่ **ไม่มีปุ่มอนุมัติแล้ว**
    //
    // ⚠️ ตั้งแต่ 2026-08-26 ทั้งสองบทบาทลงนามบนกระดาษ (แบบคำร้องเอกสารหมายเลข 1)
    // หน้าจอเหลือไว้ติดตามอย่างเดียว — ยืนยันตรงนี้ว่าปุ่มหายไปจริง ไม่ใช่แค่กดไม่ได้
    await loginAs(page, 'advisor1');
    // ตารางติดตามใบความจำนงพับอยู่ใต้การ์ดตั้งแต่ F6 (spec-F ข้อ 3.3)
    await page.getByRole('button', { name: 'เปิดตารางติดตาม' }).click();
    await expect(page.locator('main').getByText('640101001')).toBeVisible();
    await expect(page.locator('main button:has-text("อนุมัติ")')).toHaveCount(0);
    await logout(page);
    await expect(page).toHaveURL(/\/login/);

    await loginAs(page, 'head1');
    await goToMenu(page, 'approval');
    await expect(page.locator('text=640101001')).toBeVisible();
    await expect(page.locator('main button:has-text("อนุมัติ")')).toHaveCount(0);
    await logout(page);
    await expect(page).toHaveURL(/\/login/);

    // 4. เส้นทางจริง: นักศึกษาอัปโหลดกระดาษที่ลงนามแล้ว → เจ้าหน้าที่กดผ่าน
    const formId = await dbValue<number>(
      `SELECT form_id FROM intent_forms
        WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')
        ORDER BY form_id DESC LIMIT 1`
    );
    await approveIntentThroughOfficer(page.request, formId as number);

    // 5. (ขั้น "บริษัทล็อกอินตอบรับ" ถูกถอดแล้ว — บริษัทไม่มีบัญชี ตอบทางลิงก์ /accept ซึ่งคุมที่ acceptance-link.spec.ts)

    // 6. ไม่ต้องยัดเอกสารเข้าคิวเองแล้ว — หนังสือขอความอนุเคราะห์ถูกออกให้อัตโนมัติ
    //    ตอนเจ้าหน้าที่รับคำร้องในขั้นที่ 4 (ก้อน 3 ของแผนเอกสารหมายเลข 1)
    expect(
      await dbValue<string>(
        `SELECT status FROM official_documents ORDER BY doc_id DESC LIMIT 1`
      )
    ).toBe('pending_sign');

    // 7. Dean reviews and signs the document
    await loginAs(page, 'dean1');
    await expect(page.locator('text=พิจารณาอนุมัติลงนามกลุ่ม (Dean Document Signing)')).toBeVisible();

    // The generated document for student should be visible in the pending signing list
    await expect(page.locator('text=640101001')).toBeVisible();
    await expect(page.locator('text=บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด')).toBeVisible();

    // Select the document checkbox to sign
    await page.locator('input[type="checkbox"]').nth(1).check();

    // Click Batch Sign, then confirm — the signature is applied for real and
    // cannot be taken back, so the button alone no longer signs anything.
    await page.locator('button:has-text("ลงนามแบบกลุ่มที่เลือก")').click();
    await expect(page.locator('[role="dialog"]')).toContainText('ยกเลิกจากหน้านี้ไม่ได้');
    await page.locator('[role="dialog"] button:has-text("ลงนาม")').click();

    // ⛔ DocuSign ถูกถอดออกทั้งหมด 2026-08-26 — เหลือทางเดียวคือระบบวาดหนังสือ
    // พร้อมลายเซ็นให้เลย จึงเหลือข้อความเดียว ไม่ต้อง .or() อีก
    await expect(page.locator('text=ลงนามแบบกลุ่มสำเร็จเรียบร้อยแล้ว')).toBeVisible();

    // Logout Dean
    await logout(page);
  });

  test('Scenario 2: Manual Upload of Acceptance Proof Workflow (Alternative Path)', async ({ page }) => {
    // 1. Setup DB state with student intent in 'approved_by_dept_head' state directly
    await seedTestData();

    let studentId: number;
    const client = await pool.connect();
    try {
      // Find student and Seagate company ids
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const companyRes = await client.query("SELECT company_id FROM companies WHERE name_th = 'บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด'");
      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");
      
      studentId = studentRes.rows[0].user_id;
      const companyId = companyRes.rows[0].company_id;
      const semesterId = semesterRes.rows[0].semester_id;

      // Insert an intent form that is already 'approved_by_dept_head'
      // ⛔ `acceptance_due_date` แทนข้อเท็จจริงว่าคณบดีลงนามหนังสือไปแล้ว (รอบ 53)
      //    ซึ่งเป็นเงื่อนไขจริงของการส่งแบบตอบรับ — ไม่ตั้งไว้จะได้ 409 ตอนอัปโหลด
      await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, acceptance_due_date)
         VALUES ($1, $2, $3, 'approved_by_dept_head',
                 (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 15)`,
        [studentId, companyId, semesterId]
      );
    } finally {
      client.release();
    }

    // 2. Student logs in and uploads evidence
    await loginAs(page, 'student2');
    await expect(placementCard(page).getByText('เจ้าหน้าที่รับคำร้องแล้ว · รอออกหนังสือ')).toBeVisible();

    // ฟอร์มรายงานผลพับอยู่หลังปุ่ม "บริษัทคืนเอกสารตอบรับมาที่ฉัน" — ต้องกดเปิดก่อน
    await page.getByTestId('proof-open').click();

    // Fill the Placement Reporting form — ไม่มีช่องพี่เลี้ยงแล้ว (พี่เลี้ยงระบุหลังได้ที่ฝึกงาน · ขั้น 5 2026-10-09)
    await expect(page.getByTestId('proof-form').locator('input[type="email"], input[type="tel"]')).toHaveCount(0);
    await expect(page.getByTestId('proof-form')).not.toContainText('ชื่อ-นามสกุล พี่เลี้ยง');
    await page.getByTestId('proof-start-date').fill('2026-11-01'); // Start Date
    // ผู้ลงนามบนแบบตอบรับ — นักศึกษากรอกเอง (2026-09-21) · วันที่ต้องไม่เป็นอนาคต
    await page.getByTestId('proof-signer-name').fill('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
    await page.getByTestId('proof-signer-position').fill('ผู้จัดการฝ่ายบุคคล');
    await page.getByTestId('proof-signed-date').fill(
      new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    );

    // Prepare mock evidence file for upload
    const evidencePath = path.resolve(process.cwd(), 'e2e/fixtures/mock_evidence.png');
    await page.locator('input[type="file"]').setInputFiles(evidencePath);

    // Click submit
    await page.locator('button:has-text("ส่งรายงานตัวเข้าปฏิบัติงาน")').click();
    // ส่งแล้วแก้เองไม่ได้ — ต้องผ่านกล่องยืนยันที่แสดงค่าที่จะส่งจริง (2026-09-21)
    const summary = page.getByTestId('confirm-summary');
    await expect(summary).not.toContainText('พี่เลี้ยง'); // การส่งแบบตอบรับไม่เกี่ยวกับพี่เลี้ยง ไม่มีลิงก์เชิญออก
    await expect(summary).toContainText('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
    await expect(summary).toContainText('mock_evidence.png');
    // กลับไปแก้ = ไม่มีอะไรถูกส่ง ข้อมูลที่กรอกยังอยู่
    await page.getByTestId('proof-confirm-cancel').click();
    await expect(summary).toHaveCount(0);
    expect(
      (await client.query(
        "SELECT 1 FROM intent_forms WHERE student_id = $1 AND status = 'pending_officer_approval'",
        [studentId]
      )).rowCount
    ).toBe(0);
    await expect(page.getByTestId('proof-signer-name')).toHaveValue('คุณสมชาย ผู้จัดการฝ่ายบุคคล');

    await page.locator('button:has-text("ส่งรายงานตัวเข้าปฏิบัติงาน")').click();
    await page.getByTestId('proof-confirm').click();

    // Verify submission completed and student dashboard status is 'pending_officer_approval'
    await expect(placementCard(page).getByText('ส่งหลักฐานแล้ว · รอเจ้าหน้าที่ตรวจสอบ')).toBeVisible();

    // Query intent ID from DB
    const intentQuery = await client.query(
      "SELECT form_id FROM intent_forms WHERE student_id = $1 AND status = 'pending_officer_approval'",
      [studentId]
    );
    const intentId = intentQuery.rows[0].form_id;

    // Logout student
    await logout(page);

    // Login as Staff to perform officer approval
    await loginAs(page, 'staff1');

    // Call officer approval API
    const approveRes = await page.request.put(`${API_URL}/acceptances/${intentId}/officer-approve`, {
      headers: { 'Content-Type': 'application/json' },
      // ผู้ลงนามนักศึกษากรอกตอนส่งแล้ว — เจ้าหน้าที่กดรับอย่างเดียว (2026-09-21)
      data: { action: 'accepted' }
    });
    expect(approveRes.status()).toBe(200);

    // Logout Staff
    await logout(page);

    // Log back in as student to verify they are now accepted
    await loginAs(page, 'student2');

    // Verify accepted status
    await expect(placementCard(page).getByText('สถานประกอบการตอบรับแล้ว', { exact: false })).toBeVisible();

    // Logout student
    await logout(page);
  });
});
