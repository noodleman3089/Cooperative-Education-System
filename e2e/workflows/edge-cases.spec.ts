import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import path from 'path';
import fs from 'fs';
import { API_URL } from '../helpers/env';
import { withDb, dbValue, ensureLegacyTemplate } from '../helpers/db';
import { approveIntentThroughOfficer, submitRequestToDirectoryCompany, placementCard } from '../helpers/intent';
import { loginAs, attemptLogin } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';

test.describe('Cooperative Education System Advanced E2E Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Block Google Maps API to prevent loading external scripts or credentials issues
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");'
      });
    });
  });

  test('Test 1: Browser Back & Re-submission (State Desynchronization)', async ({ page }) => {
    // 1. Reset and seed test database
    console.log('Seeding database for Test 1...');
    await seedTestData();

    // 2. Student logs in and submits intent form
    await loginAs(page, 'student2');

    // ไปหน้ายื่นคำร้องขอหนังสือ (เมนู jobs) แล้วยื่นถึงบริษัทในทำเนียบ
    await goToMenu(page, 'jobs');
    await submitRequestToDirectoryCompany(page);

    // Verify application success
    await expect(page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')).toBeVisible();

    // 3. Simulate Back button
    await page.goBack();

    // ⛔ ตั้งแต่ 2026-09-07 หน้าจอเก็บไว้ใน URL (`/dashboard?menu=<id>`) ปุ่ม Back
    //    จึง**ย้อนหน้าจอจริง** ไม่ใช่ไม่ทำอะไร — เดิมมันกลับมาเส้นทางเดิมคือ `/dashboard`
    //    React ไม่ remount เมนูจึงค้างอยู่ที่ `jobs` แล้วเทสต์นี้อ่านว่า "ยังอยู่หน้าเดิม"
    //    ทั้งที่จริงๆ คือปุ่ม Back ใช้ไม่ได้ · ดู e2e/deep-links.spec.ts
    expect(new URL(page.url()).searchParams.get('menu')).toBeNull();

    // 4. ตัวคงสภาพที่เทสต์นี้คุมจริงคือ **กลับมาแล้วต้องสมัครซ้ำไม่ได้** ไม่ใช่ว่าอยู่หน้าไหน
    //    กลับเข้าหน้ายื่นคำร้องอีกครั้ง ฟอร์มต้องไม่อยู่บนจอแล้ว พร้อมบอกเหตุผล
    await goToMenu(page, 'jobs');
    await expect(page.locator('text=คุณมีคำร้องที่ดำเนินการอยู่แล้ว')).toBeVisible();
    await expect(page.getByTestId('request-submit')).toHaveCount(0);

    // 5. The other half: the server refuses a second one regardless of what the
    //    client offers. This used to be driven by clicking the button, which no
    //    longer exists — but the button was never what was being tested. Going
    //    at the API directly is a closer reading of the same invariant, and it
    //    keeps working whatever the board decides to render.
    const activeSemester = await page.request.get(`${API_URL}/semesters/active`).then(r => r.json());
    const duplicate = await page.request.post(`${API_URL}/intents`, {
      data: {
        company_id: 1,
        semester_id: activeSemester.semester_id,
      }
    });
    expect(duplicate.ok()).toBeFalsy();
    expect(await duplicate.text()).toContain('มีใบแจ้งความจำนงที่ยังดำเนินการอยู่');
  });

  test('Test 2: Multi-Context Concurrency (Real-time Collaboration)', async ({ browser }) => {
    // 1. Reset and seed test database
    console.log('Seeding database for Test 2...');
    await seedTestData();

    // 2. Create isolated student session
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await loginAs(studentPage, 'student2');

    // Student applies to Seagate job
    await goToMenu(studentPage, 'jobs');
    await submitRequestToDirectoryCompany(studentPage);
    await expect(studentPage.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')).toBeVisible();

    // 3. Create isolated advisor session
    const advisorContext = await browser.newContext();
    const advisorPage = await advisorContext.newPage();
    await loginAs(advisorPage, 'advisor1');

    // อาจารย์ที่ปรึกษาเห็นใบความจำนงทันทีที่นักศึกษายื่น — แต่ไม่มีปุ่มอนุมัติแล้ว
    // (ตั้งแต่ 2026-08-26 ลายเซ็นอยู่บนกระดาษ) สิ่งที่เทสต์นี้คุมคือ "อีก session
    // เห็นของที่เพิ่งเกิดขึ้นจริงไหม" ซึ่งยังคุมได้ด้วยการปรากฏของแถว
    // ตารางติดตามพับอยู่ใต้การ์ดตั้งแต่ F6 (spec-F ข้อ 3.3) — ต้องกดเปิดก่อน
    await advisorPage.getByRole('button', { name: 'เปิดตารางติดตาม' }).click();
    await expect(advisorPage.locator('main').getByText('640101001')).toBeVisible();
    await expect(advisorPage.locator('main button:has-text("อนุมัติ")')).toHaveCount(0);

    // 4. เจ้าหน้าที่รับคำร้องผ่านเส้นทางจริง แล้วหน้านักศึกษาต้องเห็นสถานะใหม่
    const formId = await dbValue<number>(
      `SELECT form_id FROM intent_forms
        WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')
        ORDER BY form_id DESC LIMIT 1`
    );
    await approveIntentThroughOfficer(advisorPage.request, formId as number);

    // เจ้าหน้าที่กดรับ = ออกหนังสือเข้าคิวคณบดีในทรานแซกชันเดียวกัน หน้านักศึกษาจึง
    // อ่านสถานะจาก **หนังสือ** ไม่ใช่จากใบความจำนงที่ค้างอยู่ที่ `approved_by_dept_head`
    // (ก่อน 2026-08-27 ป้ายค้างคำว่า "รอออกหนังสือ" ทั้งที่หนังสือออกไปแล้ว)
    await studentPage.goto('/dashboard');
    await expect(placementCard(studentPage).getByText('ออกหนังสือแล้ว · รอคณบดีลงนาม')).toBeVisible();

    await studentContext.close();
    await advisorContext.close();
  });

  test('Test 3: RBAC API Security Guard Bypass', async ({ page }) => {
    // 1. Seed database state
    await seedTestData();

    // 2. Student logs in to get JWT token
    await loginAs(page, 'student2');

    // 3. Make direct backend request mimicking student attempting advisor/dean APIs
    const context = page.request;

    // Test GET /api/intents (Advisor/Dean list endpoint)
    const listRes = await context.get(`${API_URL}/intents`);
    expect(listRes.status()).toBe(403);

    // ⛔ สองเส้นนี้ **ถูกลบทิ้งจาก backend แล้ว** เมื่อ 2026-08-27 — การอนุมัติของ
    //    อาจารย์ที่ปรึกษา/หัวหน้าสาขาย้ายไปอยู่บนกระดาษ (แบบคำร้อง เอกสารหมายเลข 1)
    //    404 คือคำตอบที่ถูกและแข็งแรงกว่า 403 เพราะไม่มีอะไรให้ยิงแล้ว
    //    · เคสนี้จึงกลายเป็นด่านกันไม่ให้ใครเผลอเอา endpoint กลับมา
    const approveRes = await context.patch(`${API_URL}/intents/1/status`, {
      data: { status: 'approved_by_advisor' }
    });
    expect(approveRes.status(), 'PATCH /intents/:id/status ต้องไม่มีอยู่แล้ว').toBe(404);

    const deptHeadRes = await context.patch(`${API_URL}/intents/1/dept-head-status`, {
      data: { status: 'approved_by_dept_head' }
    });
    expect(deptHeadRes.status(), 'PATCH /intents/:id/dept-head-status ต้องไม่มีอยู่แล้ว').toBe(404);

    // Test POST /api/documents/batch-sign (Dean signature endpoint)
    const signRes = await context.post(`${API_URL}/documents/batch-sign`, {
      data: { doc_ids: [1] }
    });
    expect(signRes.status()).toBe(403);
  });

  test('Test 4: Double-Click Action Button (Rapid Clicking)', async ({ page }) => {
    // 1. Reset and seed test database
    await seedTestData();

    // 2. Student logs in and applies
    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');
    
    await submitRequestToDirectoryCompany(page);

    // Wait for the success toast message
    await expect(
      page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')
    ).toBeVisible();

    // 3. นักศึกษาอัปโหลดกระดาษที่ลงนามแล้ว เพื่อให้มีของรอเจ้าหน้าที่ตรวจ
    //    (ทำก่อน logout — `page.request` ใช้คุกกี้ของ session ที่ล็อกอินอยู่)
    //
    // ⚠️ ปุ่มที่เทสต์นี้เคยกดรัวคือ "อนุมัติ" ของอาจารย์ที่ปรึกษา ซึ่งถูกถอดออกเมื่อ
    // 2026-08-26 (ลายเซ็นย้ายไปอยู่บนกระดาษ) · ปุ่มที่ต้องคุมแทนคือ **ปุ่มรับคำร้อง
    // ของเจ้าหน้าที่** เพราะมันออกเลขที่หนังสือราชการ กดซ้ำแล้วต้องไม่ออกซ้ำ
    const formId = await dbValue<number>(
      `SELECT form_id FROM intent_forms
        WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')
        ORDER BY form_id DESC LIMIT 1`
    );
    await page.request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: {
        request_form: {
          name: 'signed.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.resolve(process.cwd(), 'e2e/fixtures/mock_official_letter.pdf')),
        },
      },
    });

    await logout(page);
    await loginAs(page, 'staff1');

    // 4. เจ้าหน้าที่เปิดคำร้อง กรอกเลขที่หนังสือ (ช่องเดียว · ชื่อผู้ลงนามระบบดึงเอง) แล้วกดยืนยันรัวๆ
    await page.getByTestId(`review-request-${formId}`).click();
    // ชื่อผู้ลงนามมาจากระบบแล้ว — เจ้าหน้าที่เห็นไว้เทียบกับกระดาษ ไม่ต้องคีย์
    await expect(page.getByTestId('officer-signers')).not.toContainText('ผู้ลงนาม: —');
    await page.getByTestId('officer-document-no').fill('อว 0656.10/777');
    await page.getByTestId('officer-approve-open').click();

    const confirmBtn = page.locator('[role="dialog"] button:has-text("ออกเลขและรับคำร้อง")');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click({ clickCount: 2 });

    // ไม่พัง และผลลัพธ์เกิดครั้งเดียว — เลขที่หนังสือต้องเป็นของรอบแรกเท่านั้น
    await expect(page.locator('text=ไม่มีคำร้องรอตรวจในขณะนี้')).toBeVisible();
    expect(
      await dbValue<string>('SELECT officer_document_no FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe('อว 0656.10/777');
    expect(
      await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe('approved_by_dept_head');
  });

  test('Test 5: Network Error / API Failure Injection (Fault Tolerance)', async ({ page }) => {
    // 1. Seed database state
    await seedTestData();

    // 2. Insert a document in 'pending_sign' status for student2 directly in the database
    await withDb(async (db) => {
      const templateId = await ensureLegacyTemplate();
      const studentRes = await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const studentId = studentRes.rows[0].user_id;
      const companyRes = await db.query("SELECT company_id FROM companies LIMIT 1");
      const companyId = companyRes.rows[0].company_id;

      await db.query("DELETE FROM official_documents");
      await db.query(`
        INSERT INTO official_documents (type, student_id, company_id, template_id, generated_file_path, status)
        VALUES ('cover_letter', $1, $2, $3, 'secure_private/documents/mock_doc.pdf', 'pending_sign')
      `, [studentId, companyId, templateId]);
    });

    // 3. Dean logs in
    await loginAs(page, 'dean1');

    // 4. Mock the batch-sign API request to return a 500 error to simulate a DocuSign offline crash
    await page.route('**/api/documents/batch-sign', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'DocuSign service is currently offline. Please try again later.' })
      });
    });

    // Dean clicks check box and signs. Applying the dean's signature to official
    // letters is irreversible, so it goes through a confirmation first.
    await page.locator('input[type="checkbox"]').nth(1).check();
    await page.locator('button:has-text("ลงนามแบบกลุ่มที่เลือก")').click();
    await page.locator('[role="dialog"] button:has-text("ลงนาม")').click();

    // Expect the custom offline message to be gracefully presented as an error in the UI
    await expect(
      page.locator('text=DocuSign service is currently offline. Please try again later.')
    ).toBeVisible();
  });

  test('Test 6: File Type Spoofing & Header Validation', async ({ page }) => {
    // 1. Seed database state
    await seedTestData();

    // 2. Manually insert approved_by_dept_head intent for student2
    await withDb(async (db) => {
      const studentRes = await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const companyRes = await db.query("SELECT company_id FROM companies LIMIT 1");
      const semesterRes = await db.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");
      
      const studentId = studentRes.rows[0].user_id;
      const companyId = companyRes.rows[0].company_id;
      const semesterId = semesterRes.rows[0].semester_id;

      await db.query("DELETE FROM intent_forms");
      // ⛔ `acceptance_due_date` แทนข้อเท็จจริงว่าคณบดีลงนามหนังสือแล้ว — ฟอร์มรายงานผลของนักศึกษา
      //    (`proof-*`) โผล่บนแดชบอร์ดเฉพาะหลังลงนาม (2026-09-29) ไม่ตั้งไว้ก็ไม่มีฟอร์มให้กรอก
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, acceptance_due_date)
         VALUES ($1, $2, $3, 'approved_by_dept_head',
                 (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 15)`,
        [studentId, companyId, semesterId]
      );
    });

    // 3. Student logs in
    await loginAs(page, 'student2');

    // ฟอร์มรายงานผลพับอยู่หลังปุ่ม "บริษัทคืนเอกสารตอบรับมาที่ฉัน" — ต้องกดเปิดก่อน
    await page.getByTestId('proof-open').click();

    // 4. Fill the placement reporting form (ไม่มีช่องพี่เลี้ยงและไม่มีช่องวันเริ่มงานแล้ว — วันเริ่มมาจากปฏิทินสหกิจ)
    // ผู้ลงนามบนแบบตอบรับ — นักศึกษากรอกเอง (2026-09-21) · วันที่ต้องไม่เป็นอนาคต
    await page.getByTestId('proof-signer-name').fill('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
    await page.getByTestId('proof-signer-position').fill('ผู้จัดการฝ่ายบุคคล');
    await page.getByTestId('proof-signed-date').fill(
      new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    );

    // ไฟล์ปลอม: ข้อความล้วนที่ตั้งชื่อลงท้าย .pdf — คุมด่าน magic bytes ของ multer
    // ซึ่งเป็นด่านเดียวกับที่การอัปโหลดคำร้อง (เอกสาร 1) จะพึ่ง ไม่เกี่ยวกับใบยินยอม
    // ที่ถูกตัดทิ้งไปแล้ว — ชื่อไฟล์เดิม spoofed_consent.pdf ทำให้เข้าใจผิดว่าเกี่ยวกัน
    const fixturesDir = path.join(process.cwd(), 'e2e', 'fixtures');
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    const spoofedFilePath = path.join(fixturesDir, 'spoofed_evidence.pdf');
    fs.writeFileSync(spoofedFilePath, 'plain text content that is not a valid PDF file structure');

    // Upload spoofed file
    await page.locator('input[type="file"]').setInputFiles(spoofedFilePath);

    // Click submit
    await page.locator('button:has-text("ส่งรายงานตัวเข้าปฏิบัติงาน")').click();
    // ส่งแล้วแก้เองไม่ได้ — ต้องผ่านกล่องยืนยัน (2026-09-21)
    await page.getByTestId('proof-confirm').click();

    // Expect the backend magic bytes validation error message to display in the UI alert box
    await expect(
      page.locator('text=เนื้อหาไฟล์ไม่ตรงกับชนิดไฟล์ที่อนุญาต')
    ).toBeVisible();

    // Clean up temporary spoofed file
    if (fs.existsSync(spoofedFilePath)) {
      fs.unlinkSync(spoofedFilePath);
    }
  });

  test('Test 7: Authentication Validation and Error Handling', async ({ page }) => {
    // 1. Visit student login page
    await page.goto('/login/student');
    // หน้านักศึกษาเปิดที่ Google SSO ก่อน — ฟอร์มรหัสผ่านอยู่หลังแท็บ (แบบเดียวกับ helpers/auth.ts)
    await page.getByRole('button', { name: 'รหัสผ่านเฉพาะระบบ' }).click();

    // 2. Test invalid identifier format
    await page.locator('input[type="text"]').fill('not-a-valid-email-or-code!');
    await page.locator('input[type="password"]').fill('somepassword');
    await page.click('button[type="submit"]');
    
    // Expect format validation error
    await expect(page.locator('text=รูปแบบอีเมลหรือรหัสนักศึกษาไม่ถูกต้อง')).toBeVisible();

    // 3. Test correct format but wrong password
    await page.locator('input[type="text"]').fill('student2@test.com');
    await page.locator('input[type="password"]').fill('wrongpassword123');
    await page.click('button[type="submit"]');

    // Expect invalid credentials error
    await expect(page.locator('text=อีเมล/ชื่อผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง')).toBeVisible();
  });

  /**
   * เดิมชื่อ "Advisor Rejection empty reason block validation"
   *
   * ⛔ ปุ่มตีกลับของอาจารย์ที่ปรึกษาถูกถอดออกเมื่อ 2026-08-26 และ endpoint ถูกลบเมื่อ
   *    2026-08-27 · **ด่านที่เคสนี้คุมไม่ได้หายไป** — "ตีกลับต้องมีเหตุผท" ย้ายมาอยู่ที่
   *    ปุ่มของเจ้าหน้าที่ ซึ่งเป็นคนเดียวที่ตีกลับได้ในระบบตอนนี้
   *    · ฝั่ง API มี `document-01-request.spec.ts` D10 คุมอยู่แล้ว เคสนี้จึงคุม **ฝั่ง UI**:
   *      ปุ่มยืนยันต้องกดไม่ได้จนกว่าจะพิมพ์เหตุผล
   */
  test('Test 8: เจ้าหน้าที่ตีกลับคำร้องโดยไม่กรอกเหตุผลไม่ได้ (ด่านฝั่งหน้าจอ)', async ({ page }) => {
    await seedTestData();

    // 1. นักศึกษายื่นใบความจำนงแล้วอัปโหลดกระดาษที่ลงนามกลับ → เข้าคิวเจ้าหน้าที่
    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');
    await submitRequestToDirectoryCompany(page);
    await expect(page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')).toBeVisible();

    const formId = await dbValue<number>(
      `SELECT form_id FROM intent_forms
        WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')
        ORDER BY form_id DESC LIMIT 1`
    );
    const upload = await page.request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: {
        request_form: {
          name: 'signed.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.resolve(process.cwd(), 'e2e/fixtures/mock_official_letter.pdf')),
        },
      },
    });
    expect(upload.status(), await upload.text()).toBe(200);
    await logout(page);

    // 2. เจ้าหน้าที่เปิดคำร้องในคิว
    await loginAs(page, 'staff1');
    await page.locator('button:has-text("ตรวจคำร้อง")').first().click();
    const dialog = page.locator('[role="dialog"]');
    // หัวแผงแบบ A (2026-10-07): บรรทัดบนบอกว่าเป็นเอกสารใบไหน หัวเรื่องคือชื่อนักศึกษา
    await expect(dialog.getByText(/เอกสารหมายเลข 1 · คำร้องที่ \d+/)).toBeVisible();

    // 3. กดตีกลับ — ปุ่มยืนยันต้องยังกดไม่ได้เพราะยังไม่มีเหตุผล
    await dialog.locator('button:has-text("ตีกลับให้แก้ไข")').click();
    const confirmRejectBtn = dialog.locator('button:has-text("ยืนยันตีกลับ")');
    await expect(confirmRejectBtn).toBeDisabled();

    // 4. พิมพ์เหตุผลแล้วจึงกดได้
    await dialog.locator('textarea').fill('ไฟล์ที่อัปโหลดขาดลายเซ็นหัวหน้าสาขาวิชา');
    await expect(confirmRejectBtn).toBeEnabled();
    await confirmRejectBtn.click();

    // 5. ใบหลุดจากคิว และเหตุผลถูกเก็บบนแถวให้นักศึกษาอ่าน (ไม่ใช่แค่ audit_log — SEC-07)
    await expect(page.getByTestId('staff-queue-request')).toContainText('คำร้องรอรับ · 0 คน');
    expect(
      await dbValue<string>('SELECT reject_reason FROM intent_forms WHERE form_id = $1', [formId])
    ).toContain('ขาดลายเซ็นหัวหน้าสาขาวิชา');
  });

  test('Test S1: RBAC - Mentor session → Student APIs → 403', async ({ page }) => {
    // 1. Seed database state
    await seedTestData();

    // 2. Mentor logs in (link login) to get a session cookie
    await loginAs(page, 'mentor1');

    // 3. Make direct backend request mimicking a mentor attempting student-only APIs
    const context = page.request;

    // Test GET /api/students/dashboard
    const dashboardRes = await context.get(`${API_URL}/students/dashboard`);
    expect(dashboardRes.status()).toBe(403);

    // Test POST /api/intents
    const postIntentRes = await context.post(`${API_URL}/intents`, {
      data: { company_id: 1, semester_id: 1, is_self_found: false }
    });
    expect(postIntentRes.status()).toBe(403);

    // Test GET /api/intents/me
    const intentsMeRes = await context.get(`${API_URL}/intents/me`);
    expect(intentsMeRes.status()).toBe(403);

    // Test PUT /api/profile/student
    const studentProfileRes = await context.put(`${API_URL}/profile/student`);
    expect(studentProfileRes.status()).toBe(403);
  });

  test('Test S5: Deactivated Account Login Block', async ({ page }) => {
    // 1. Seed database state
    await seedTestData();

    // 2. Set is_active = FALSE for student2@test.com
    await withDb(async (db) => {
      await db.query("UPDATE users SET is_active = FALSE WHERE email = 'student2@test.com'");
      console.log('Deactivated student2@test.com');
    });

    // 3. Attempt student login — this one is meant to be refused, so it must
    //    not assert the dashboard.
    await attemptLogin(page, 'student2');

    // 4. Expect block message
    await expect(page.locator('text=บัญชีผู้ใช้งานของคุณถูกระงับการใช้งาน')).toBeVisible();
  });

  test('Test E2: Dean Missing E-Signature → Error', async ({ page }) => {
    // 1. Seed database state
    await seedTestData();

    const client = await pool.connect();
    let templateId: number;
    let studentId: number;
    let companyId: number;
    let docId: number;
    try {
      // Clear dean's e-signature file
      await client.query(
        "UPDATE personnel SET e_signature_file = NULL WHERE personnel_id = (SELECT user_id FROM users WHERE email = 'dean1@test.com')"
      );

      templateId = await ensureLegacyTemplate();
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      studentId = studentRes.rows[0].user_id;
      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      companyId = companyRes.rows[0].company_id;

      await client.query("DELETE FROM official_documents");
      const docRes = await client.query(`
        INSERT INTO official_documents (type, student_id, company_id, template_id, generated_file_path, status)
        VALUES ('cover_letter', $1, $2, $3, 'secure_private/documents/mock_doc.pdf', 'pending_sign')
        RETURNING doc_id
      `, [studentId, companyId, templateId]);
      docId = docRes.rows[0].doc_id;
    } finally {
      client.release();
    }

    // 2. Dean logs in
    await loginAs(page, 'dean1');

    // 3. Call batch sign API expecting 400 error due to missing signature
    const apiRes = await page.request.post(`${API_URL}/documents/batch-sign`, {
      data: { doc_ids: [docId] }
    });

    expect(apiRes.status()).toBe(400);
    const body = await apiRes.json();
    // ข้อความเป็นภาษาไทยตั้งแต่ 2026-08-26 เพราะคณบดีเป็นคนอ่านเอง ไม่ใช่ developer
    expect(body.message).toContain('ยังไม่ได้อัปโหลดลายมือชื่อดิจิทัล');
  });

  // เคส E3 (ออกเอกสารแล้วบริษัทไม่มีข้อมูลติดต่อ -> 400) ถูกลบเมื่อ 2026-08-26
  // พร้อมกับ POST /documents/generate — ไม่มีทางออกเอกสารจากระบบแล้ว
  // ⛔ เมื่อสร้างวิธีออกเอกสารแบบใหม่ ต้องเอาด่านนี้กลับมาพร้อมเทสต์

  test('Test E4: Batch Sign Already-Signed Document → Skip', async ({ page }) => {
    // 1. Seed database state
    await seedTestData();

    const client = await pool.connect();
    let templateId: number;
    let studentId: number;
    let companyId: number;
    let docId: number;
    try {
      templateId = await ensureLegacyTemplate();
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      studentId = studentRes.rows[0].user_id;
      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      companyId = companyRes.rows[0].company_id;

      await client.query("DELETE FROM official_documents");
      
      // Insert document that is ALREADY SIGNED
      const docRes = await client.query(`
        INSERT INTO official_documents (type, student_id, company_id, template_id, generated_file_path, status)
        VALUES ('cover_letter', $1, $2, $3, 'secure_private/documents/mock_doc.pdf', 'signed')
        RETURNING doc_id
      `, [studentId, companyId, templateId]);
      docId = docRes.rows[0].doc_id;
    } finally {
      client.release();
    }

    // 2. Dean logs in
    await loginAs(page, 'dean1');

    // 3. Call batch sign API on already signed document
    const apiRes = await page.request.post(`${API_URL}/documents/batch-sign`, {
      data: { doc_ids: [docId] }
    });

    // Expect 200 response but signed_count is 0 and failed_documents contains the error
    expect(apiRes.status()).toBe(200);
    const body = await apiRes.json();
    expect(body.signed_count).toBe(0);
    // กันเซ็นซ้ำย้ายไปตรวจที่สถานะ signed โดยตรง (ชัดกว่าการเทียบชื่อสถานะที่อนุญาต)
    expect(body.failed_documents[0].error).toContain('ลงนามไปแล้ว');
  });

  test('Test E5: Oversized File Upload → Error', async ({ page }) => {
    // 1. Seed database state
    await seedTestData();

    const client = await pool.connect();
    let intentFormId: number;
    try {
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");

      const studentId = studentRes.rows[0].user_id;
      const companyId = companyRes.rows[0].company_id;
      const semesterId = semesterRes.rows[0].semester_id;

      await client.query("DELETE FROM intent_forms");
      // ⛔ `acceptance_due_date` แทนข้อเท็จจริงว่าคณบดีลงนามหนังสือแล้ว — ฟอร์มรายงานผลของนักศึกษา
      //    (`proof-*`) โผล่บนแดชบอร์ดเฉพาะหลังลงนาม (2026-09-29) ไม่ตั้งไว้ก็ไม่มีฟอร์มให้กรอก
      const insertRes = await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, acceptance_due_date)
         VALUES ($1, $2, $3, 'approved_by_dept_head',
                 (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 15) RETURNING form_id`,
        [studentId, companyId, semesterId]
      );
      intentFormId = insertRes.rows[0].form_id;
    } finally {
      client.release();
    }

    // Create a mock oversized file (> 5MB) in e2e/fixtures
    const bigFilePath = path.join(process.cwd(), 'e2e/fixtures/oversized_file.png');
    // Multer validation checks magic bytes first, so write correct PNG headers then fill it up
    const bigFile = Buffer.alloc(6 * 1024 * 1024); // 6MB
    // PNG magic bytes
    bigFile[0] = 0x89;
    bigFile[1] = 0x50;
    bigFile[2] = 0x4E;
    bigFile[3] = 0x47;
    bigFile[4] = 0x0D;
    bigFile[5] = 0x0A;
    bigFile[6] = 0x1A;
    bigFile[7] = 0x0A;
    fs.writeFileSync(bigFilePath, bigFile);

    try {
      // 2. Student logs in
      await loginAs(page, 'student2');

      // ฟอร์มรายงานผลพับอยู่หลังปุ่ม "บริษัทคืนเอกสารตอบรับมาที่ฉัน" — ต้องกดเปิดก่อน
      await page.getByTestId('proof-open').click();

      // Fill in details (ไม่มีช่องพี่เลี้ยงและไม่มีช่องวันเริ่มงานแล้ว — วันเริ่มมาจากปฏิทินสหกิจ)
      // ผู้ลงนามบนแบบตอบรับ — นักศึกษากรอกเอง (2026-09-21) · วันที่ต้องไม่เป็นอนาคต
      await page.getByTestId('proof-signer-name').fill('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
      await page.getByTestId('proof-signer-position').fill('ผู้จัดการฝ่ายบุคคล');
      await page.getByTestId('proof-signed-date').fill(
        new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
      );

      // Upload oversized file
      await page.locator('input[type="file"]').setInputFiles(bigFilePath);

      // Submit
      await page.locator('button:has-text("ส่งรายงานตัวเข้าปฏิบัติงาน")').click();
      // ส่งแล้วแก้เองไม่ได้ — ต้องผ่านกล่องยืนยัน (2026-09-21)
      await page.getByTestId('proof-confirm').click();

      // ⛔ เดิมยิงกระสุนสี่นัด (`File too large` / `Error` / `ไม่สามารถ` / `validation failed`)
      //    เพราะไฟล์ที่ multer ปฏิเสธเคยตกไปที่ตัวจัดการ error กลางแล้วได้ **500 +
      //    "เกิดข้อผิดพลาดของระบบ"** ซึ่งไม่บอกผู้ใช้ว่าต้องแก้อะไร
      //    · ตั้งแต่ 2026-09-03 มันตอบ **413 + ข้อความไทยที่แน่นอน** จึงปักได้ตรงๆ
      //      (ครอบทุกตัวอัปโหลดในระบบ ไม่ใช่แค่หลักฐานการตอบรับ)
      await expect(page.getByText('ไฟล์มีขนาดใหญ่เกินกำหนด')).toBeVisible();
    } finally {
      // Clean up file
      if (fs.existsSync(bigFilePath)) {
        fs.unlinkSync(bigFilePath);
      }
    }
  });

});

