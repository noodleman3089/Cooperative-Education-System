import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import {
  submitRequestToDirectoryCompany,
  placementCard,
  approveIntentThroughOfficer,
  setCoopStart,
  confirmMentor,
} from '../helpers/intent';
import { dbValue, dbExec } from '../helpers/db';

/**
 * ฟังก์ชันช่วย: ให้คะแนนเต็มทุกข้อของฟอร์มประเมินที่เปิดอยู่
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

test.describe('วงจรสหกิจศึกษาฉบับสมบูรณ์ไร้รอยต่อ (Unbroken Full Student Journey E2E - R1)', () => {
  test.beforeEach(async ({ page }) => {
    // ดักและจำลอง Google Maps API เพื่อป้องกันการเรียกภายนอก
    await page.route('**/maps.googleapis.com/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");',
      });
    });
  });

  test('การเดินทางของนักศึกษาตัวอย่างคนเดียวตั้งแต่ยื่นคำร้องจนเห็นผลประเมิน 100% ครบวงจร', async ({
    page,
  }) => {
    test.setTimeout(300_000); // 5 minutes for full lifecycle test

    // 0. เตรียมฐานข้อมูลและตั้งวันเริ่มปฏิบัติงาน
    await seedTestData();
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    await setCoopStart(todayStr);

    // เตรียมข้อมูลผู้ติดต่อฉุกเฉินในโปรไฟล์นักศึกษา (สหกิจ 03)
    await dbExec(
      `UPDATE students
          SET emergency_contact_name = 'นางสมศรี สายดี',
              emergency_relationship = 'มารดา',
              emergency_phone = '0898765432'
        WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')`
    );

    // ตั้งให้ mentor1 ยังไม่ active เพื่อให้จำลองการระบุพี่เลี้ยงใหม่และอาจารย์นิเทศเป็นผู้กดยืนยันเปิดบัญชี
    await dbExec("UPDATE users SET is_active = FALSE WHERE email = 'mentor1@test.com'");

    let formId: number;

    // ── Phase 1: ยื่นคำร้องขอหนังสือ (สหกิจ 01) ──
    await test.step('1. นักศึกษายื่นคำร้องขอหนังสือ (สหกิจ 01) ถึงสถานประกอบการในทำเนียบ', async () => {
      await loginAs(page, 'student2');
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(placementCard(page)).toBeVisible();

      await goToMenu(page, 'jobs');
      await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();

      await submitRequestToDirectoryCompany(page, 'ซีเกท');
      await expect(
        page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')
      ).toBeVisible();

      formId = (await dbValue<number>(
        `SELECT form_id FROM intent_forms
          WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')
          ORDER BY form_id DESC LIMIT 1`
      ))!;
      expect(formId).toBeTruthy();

      await logout(page);
    });

    // ── Phase 2: อาจารย์/หัวหน้าสาขาลงนามกระดาษ → เจ้าหน้าที่กดผ่าน ──
    await test.step('2. นักศึกษาอัปโหลดกระดาษที่อาจารย์ลงนามแล้ว → เจ้าหน้าที่อนุมัติคำร้อง', async () => {
      await approveIntentThroughOfficer(page.request, formId);

      const statusAfterOfficer = await dbValue<string>(
        'SELECT status FROM intent_forms WHERE form_id = $1',
        [formId]
      );
      expect(statusAfterOfficer).toBe('approved_by_dept_head');
    });

    // ── Phase 3: คณบดีลงนามหนังสือขอความอนุเคราะห์ (Dean Batch Sign) ──
    await test.step('3. คณบดีลงนามแบบกลุ่ม (Dean Batch Sign) ในหนังสือขอความอนุเคราะห์', async () => {
      await loginAs(page, 'dean1');
      await expect(page.locator('text=พิจารณาอนุมัติลงนามกลุ่ม (Dean Document Signing)')).toBeVisible();
      await expect(page.locator('text=640101001')).toBeVisible();

      // ติ๊กเลือกเอกสารของนักศึกษา
      await page.locator('input[type="checkbox"]').nth(1).check();

      // กดลงนามและยืนยันในกล่องสนทนา
      await page.locator('button:has-text("ลงนามแบบกลุ่มที่เลือก")').click();
      await expect(page.locator('[role="dialog"]')).toBeVisible();
      await page.locator('[role="dialog"] button:has-text("ลงนาม")').click();

      // 2026-10-18: ลงนามเพียงฉบับเดียว (ติ๊กหนึ่งรายการ) ได้ข้อความของฉบับเดียว — ข้อความ "แบบกลุ่ม" ขึ้นเมื่อเลือกหลายฉบับ
      await expect(page.locator('text=ลงนามเรียบร้อยแล้ว — นักศึกษาได้รับหนังสือและเห็นในระบบทันที')).toBeVisible();
      await logout(page);

      // ยืนยันว่าหนังสือได้รับการลงนามและมี acceptance_due_date แล้ว
      const acceptanceDue = await dbValue<string | null>(
        'SELECT acceptance_due_date FROM intent_forms WHERE form_id = $1',
        [formId]
      );
      expect(acceptanceDue).not.toBeNull();
    });

    // ── Phase 4: อัปโหลดหลักฐานการตอบรับ (สหกิจ 02) & เจ้าหน้าที่อนุมัติ ──
    await test.step('4. นักศึกษาอัปโหลดหลักฐานการตอบรับ (สหกิจ 02) → เจ้าหน้าที่ตรวจสอบรับรอง', async () => {
      await loginAs(page, 'student2');
      await expect(placementCard(page).getByText('คณบดีลงนามแล้ว · รอสถานประกอบการตอบรับ')).toBeVisible();

      // เปิดฟอร์มรายงานผลการตอบรับ
      await page.getByTestId('proof-open').click();
      await page.getByTestId('proof-signer-name').fill('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
      await page.getByTestId('proof-signer-position').fill('ผู้จัดการฝ่ายบุคคล');

      const evidencePath = path.resolve(process.cwd(), 'e2e/fixtures/mock_evidence.png');
      await page.locator('input[type="file"]').setInputFiles(evidencePath);

      await page.locator('button:has-text("ส่งรายงานตัวเข้าปฏิบัติงาน")').click();
      await page.getByTestId('proof-confirm').click();

      await expect(placementCard(page).getByText('ส่งหลักฐานแล้ว · รอเจ้าหน้าที่ตรวจสอบ')).toBeVisible();
      await logout(page);

      // เจ้าหน้าที่กดรับรองแบบตอบรับ
      await apiLoginAs(page.request, 'staff1');
      const approveRes = await page.request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
        data: { action: 'accepted' },
      });
      expect(approveRes.status()).toBe(200);

      // ยืนยันสถานะเป็น accepted
      const acceptedStatus = await dbValue<string>(
        'SELECT status FROM intent_forms WHERE form_id = $1',
        [formId]
      );
      expect(acceptedStatus).toBe('accepted');
    });

    let assignedMentorId: number;

    // ── Phase 5: ระบุข้อมูลพนักงานที่ปรึกษา (พี่เลี้ยง) หลังตอบรับ ──
    await test.step('5. นักศึกษาระบุข้อมูลพี่เลี้ยงประจำสถานประกอบการ (Post-Acceptance Mentor)', async () => {
      await loginAs(page, 'student2');
      await goToMenu(page, 'my_mentor');
      await expect(page.getByRole('heading', { name: 'พี่เลี้ยงของฉัน' })).toBeVisible();

      // กรอกข้อมูลพี่เลี้ยง
      await page.getByTestId('mentor-name').fill('นายสุรเดช ใจดี');
      await page.getByTestId('mentor-email').fill('mentor1@test.com');
      await page.getByTestId('mentor-phone').fill('0812223333');
      await page.getByTestId('mentor-position').fill('หัวหน้าแผนกพัฒนาซอฟต์แวร์');
      await page.getByTestId('mentor-department').fill('ฝ่ายวิจัยและพัฒนา');
      await page.getByTestId('mentor-submit').click();

      // การ์ดพี่เลี้ยงเปลี่ยนเป็นสถานะรอยืนยันจากอาจารย์นิเทศ
      await expect(page.getByTestId('mentor-card')).toHaveAttribute('data-state', 'unconfirmed');
      await expect(page.getByText('รออาจารย์นิเทศยืนยันพี่เลี้ยง')).toBeVisible();

      assignedMentorId = (await dbValue<number>(
        'SELECT mentor_id FROM intent_forms WHERE form_id = $1',
        [formId]
      ))!;
      expect(assignedMentorId).toBeTruthy();

      await logout(page);
    });

    // ── Phase 6: อาจารย์นิเทศยืนยันพี่เลี้ยงและเปิดใช้งานบัญชี ──
    await test.step('6. อาจารย์นิเทศยืนยันพี่เลี้ยง (Supervisor Confirm Mentor)', async () => {
      await apiLoginAs(page.request, 'advisor1');
      const confirmRes = await confirmMentor(page.request, assignedMentorId);
      expect(confirmRes.status()).toBe(200);

      const isMentorActive = await dbValue<boolean>(
        'SELECT is_active FROM users WHERE user_id = $1',
        [assignedMentorId]
      );
      expect(isMentorActive).toBe(true);
    });

    // ── Phase 7: แบบแจ้งรายละเอียดที่พัก (สหกิจ 06) ──
    await test.step('7. นักศึกษากรอกแบบแจ้งรายละเอียดที่พักระหว่างปฏิบัติงาน (สหกิจ 06)', async () => {
      await loginAs(page, 'student2');
      await goToMenu(page, 'accommodation_plan');
      await expect(page.getByRole('heading', { name: /แจ้งรายละเอียดที่พัก/ })).toBeVisible();

      await page.getByTestId('acc-province').selectOption('ชลบุรี');
      await page.getByTestId('acc-district').selectOption('ศรีราชา');
      await page.getByTestId('acc-subdistrict').selectOption('บางพระ');
      await page.getByTestId('acc-house-no').fill('199/8');
      await page.getByTestId('acc-building').fill('หอพักบ้านสวน');
      await page.getByTestId('acc-room-no').fill('502');
      await page.getByTestId('acc-mobile').fill('0891234567');

      await page.getByTestId('acc-save').click();
      await expect(page.getByText('บันทึกข้อมูลที่พัก (สหกิจ 06) เรียบร้อยแล้ว')).toBeVisible();
    });

    // ── Phase 8: บันทึกการปฏิบัติงานรายสัปดาห์ (สหกิจ 09) ──
    await test.step('8. นักศึกษาส่งบันทึกการปฏิบัติงานรายสัปดาห์ (สหกิจ 09)', async () => {
      await goToMenu(page, 'weekly_log');
      await expect(page.getByRole('heading', { name: 'บันทึกการปฏิบัติงาน', exact: true })).toBeVisible();

      await page.getByTestId('weekly-assigned-work').fill('ศึกษาระบบคลังสินค้าและพัฒนา REST API');
      await page.getByTestId('weekly-methods').fill('ออกแบบ PostgreSQL schema และเขียน Node.js TypeScript');
      await page.getByTestId('weekly-tools').fill('React, Node.js, PostgreSQL, Docker');
      await page.getByTestId('weekly-achievements').fill('ส่งมอบ API คลังสินค้าชุดแรกพร้อม Unit Test ผ่าน 100%');

      await page.getByTestId('worklog-submit').click();
      await expect(page.getByText('ส่งบันทึกการปฏิบัติงานรายสัปดาห์เรียบร้อยแล้ว')).toBeVisible();
      await expect(page.getByTestId('worklog-week-1')).toContainText('รอ');
    });

    // ── Phase 9: โครงร่างรายงาน (สหกิจ 11) & การพิจารณาเห็นชอบ ──
    let outlineId: number;
    await test.step('9. นักศึกษาส่งโครงร่างรายงาน (สหกิจ 11) → พี่เลี้ยงและอาจารย์นิเทศเห็นชอบ', async () => {
      await goToMenu(page, 'report_outline');
      await expect(page.getByRole('heading', { name: 'โครงร่างรายงาน (สหกิจ 11)' })).toBeVisible();

      await page.getByTestId('outline-title').fill('การพัฒนาระบบตรวจสอบย้อนกลับสินค้าในคลังสินค้า');
      await page
        .getByTestId('outline-text')
        .fill('บทที่ 1 บทนำและที่มา\nบทที่ 2 ทฤษฎีและเทคโนโลยี\nบทที่ 3 การออกแบบและพัฒนาระบบ\nบทที่ 4 ผลการทดลอง');
      await page.getByTestId('outline-file-input').setInputFiles({
        name: 'outline-final.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock Outline PDF Content'),
      });

      await page.getByTestId('outline-submit').click();
      await page.getByTestId('outline-confirm').click();
      await expect(page.getByRole('heading', { name: 'ประวัติการส่งและผลตรวจ (1 เวอร์ชัน)' })).toBeVisible();
      await logout(page);

      outlineId = (await dbValue<number>(
        `SELECT outline_id FROM report_outlines
          WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')`
      ))!;

      // พี่เลี้ยงเห็นชอบโครงร่างรายงาน
      await apiLoginAs(page.request, 'mentor1');
      const mentorOutlineApprove = await page.request.put(`${API_URL}/outlines/${outlineId}/status`, {
        data: { status: 'pending_advisor', comment: 'พี่เลี้ยงเห็นชอบโครงร่างรายงาน' },
      });
      expect(mentorOutlineApprove.status()).toBe(200);

      // อาจารย์นิเทศเห็นชอบโครงร่างรายงาน
      await apiLoginAs(page.request, 'advisor1');
      const advisorOutlineApprove = await page.request.put(`${API_URL}/outlines/${outlineId}/status`, {
        data: { status: 'approved', comment: 'อาจารย์นิเทศเห็นชอบโครงร่างรายงาน' },
      });
      expect(advisorOutlineApprove.status()).toBe(200);
    });

    // ── Phase 10: ส่งเล่มรายงานฉบับสมบูรณ์ & พี่เลี้ยงประเมินผล (สหกิจ 15 และ 16) ──
    await test.step('10. นักศึกษาส่งเล่มรายงาน → พี่เลี้ยงกรอกแบบประเมิน สหกิจ 15 (100 คะแนน) และ 16 (70 คะแนน)', async () => {
      await loginAs(page, 'student2');
      await goToMenu(page, 'final_report');
      await expect(page.getByRole('heading', { name: 'รายงานฉบับสมบูรณ์', exact: true })).toBeVisible();

      // ขั้นที่ 1: ร่างให้พี่เลี้ยงตรวจ
      await page.getByTestId('finalreport-step1-upload').setInputFiles({
        name: 'final_report_draft.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock Final Report Draft Content'),
      });
      await page.getByTestId('finalreport-upload-confirm').click();
      await expect(page.getByTestId('finalreport-step1-status')).toContainText('รอพี่เลี้ยงตรวจ');

      // ขั้นที่ 2: ฉบับสมบูรณ์ให้อาจารย์ที่ปรึกษาตรวจ
      await page.getByTestId('finalreport-upload').setInputFiles({
        name: 'final_report_complete.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock Final Complete Report Content'),
      });
      await page.getByTestId('finalreport-upload-confirm').click();
      await expect(page.getByTestId('finalreport-version-1')).toBeVisible();

      await logout(page);

      // พี่เลี้ยงเข้าสู่ระบบและประเมินผล
      await loginAs(page, 'mentor1');
      await goToMenu(page, 'final_evaluation');
      await expect(page.getByRole('heading', { name: 'รายชื่อประเมินผลนักศึกษาสหกิจศึกษา' })).toBeVisible();

      await page.click('text="สมชาย สายดี"');
      await expect(page.locator('text="ผู้รับประเมิน: สมชาย สายดี"')).toBeVisible();

      // สหกิจ 15 (18 ข้อ เต็ม 100)
      await fillEveryScoreWithMax(page);
      await expect(page.locator('text="ให้คะแนนครบทุกข้อแล้ว"')).toBeVisible();
      await page.getByLabel('จุดเด่นของนักศึกษา / Strength').fill('มีความรับผิดชอบสูง ตรงต่อเวลา');
      await page.getByLabel('ข้อควรปรับปรุงของนักศึกษา / Improvement').fill('เพิ่มการสื่อสารในทีมให้มากขึ้น');
      await page.getByLabel('ข้อคิดเห็นเพิ่มเติม / Other comments').fill('ปฏิบัติงานได้ดีเยี่ยม');
      await page.getByRole('radio', { name: 'รับ / Yes' }).check();

      await page.click('button:has-text("ส่งผลประเมิน")');
      await page.click('button:has-text("ยืนยันส่งคะแนน")');
      await expect(page.locator('text="บันทึกแบบประเมิน สหกิจ 15 เรียบร้อยแล้ว"')).toBeVisible();

      // สหกิจ 16 (14 ข้อ เต็ม 70)
      await page.click('text="สมชาย สายดี"');
      await page.click('button:has-text("สหกิจ 16")');
      await page.getByLabel('หัวข้อรายงาน (ภาษาไทย)').fill('ระบบตรวจสอบย้อนกลับสินค้าในคลัง');
      await page.getByLabel('Report title (English)').fill('Inventory Traceability System');
      await fillEveryScoreWithMax(page);
      await expect(page.locator('text="ให้คะแนนครบทุกข้อแล้ว"')).toBeVisible();
      await page.getByLabel('ข้อคิดเห็นเพิ่มเติม / Other comments').fill('รูปเล่มเรียบร้อยและเนื้อหาสมบูรณ์');

      await page.click('button:has-text("ส่งผลประเมิน")');
      await page.click('button:has-text("ยืนยันส่งคะแนน")');
      await expect(page.locator('text="บันทึกแบบประเมิน สหกิจ 16 เรียบร้อยแล้ว"')).toBeVisible();

      await logout(page);
    });

    // ── Phase 11: อาจารย์ตรวจรับรองเล่มรายงาน (สหกิจ 14) & เจ้าหน้าที่ตรวจความสมบูรณ์ ──
    await test.step('11. อาจารย์นิเทศตรวจรับรองรายงาน (สหกิจ 14) → เจ้าหน้าที่เห็นความคืบหน้าสมบูรณ์ 100%', async () => {
      await loginAs(page, 'advisor1');
      await goToMenu(page, 'final_evaluation');
      await expect(page.getByRole('heading', { name: 'ตรวจเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14)' })).toBeVisible();

      await page.click('text="สมชาย สายดี"');
      await expect(page.getByTestId('final-report-panel')).toContainText('รายละเอียดการส่งเล่มของนักศึกษา');

      await page.getByTestId('final-report-approve').click();
      await expect(page.locator('text="อนุมัติเล่มรายงานเรียบร้อยแล้ว"')).toBeVisible();

      // อาจารย์เห็นคะแนนผลประเมิน สหกิจ 15/16 ของพี่เลี้ยงครบถ้วน
      await page.click('text="สมชาย สายดี"');
      await expect(page.locator('text="สหกิจ 15: 100/100"')).toBeVisible();
      await expect(page.locator('text="สหกิจ 16: 70/70"')).toBeVisible();

      await logout(page);

      // เจ้าหน้าที่เข้าสู่ระบบ ตรวจสอบกระดานติดตามสถานะและความคืบหน้า
      await loginAs(page, 'staff1');
      await goToMenu(page, 'final_progress');
      await expect(page.locator('h1:has-text("กระดานติดตามสถานะและผลการประเมิน")')).toBeVisible();
      await expect(page.locator('text=640101001')).toBeVisible();
      await expect(page.locator('text="สมชาย สายดี"')).toBeVisible();

      await logout(page);
    });
  });
});
