import { test, expect } from '@playwright/test';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, APP_URL } from '../helpers/env';
import { loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { placementCard, coverLetterDocId } from '../helpers/intent';
import { dbValue, dbExec } from '../helpers/db';
import { createWalk } from '../helpers/walkthrough';

/**
 * Walkthrough: เส้นทางขอที่ฝึกงานตั้งแต่ยื่นแบบแจ้งความจำนงจนบริษัทตอบรับ (ไม่ใช่เทสต์ในชุดเต็ม 515)
 *
 * นักศึกษายื่นแบบแจ้งความจำนง → อัปโหลดแบบคำร้องที่ลงนามแล้ว → เจ้าหน้าที่ผ่านคำร้อง (ยืนยันสถานประกอบการ)
 * → คณบดีลงนาม → นักศึกษาส่งหนังสือถึงบริษัททางอีเมล → บริษัทเปิดลิงก์ /accept แล้วตอบรับ
 * → เจ้าหน้าที่รับแบบตอบรับ → นักศึกษาเห็นผล
 *
 * ทุกการกระทำที่คนใช้ทำจริงทำผ่านหน้าเว็บ · ทางลัดมีสองที่ และบอกไว้ใน caption:
 *   1. ไฟล์ PDF จำลองแทนกระดาษที่เซ็นจริง (นักศึกษาอัปโหลด + บริษัทแนบแบบตอบรับ)
 *   2. token ลิงก์ของบริษัทอ่านจากฐาน — ในโลกจริงอยู่ในอีเมลที่ระบบส่ง (MAIL_DRY_RUN จึงไม่มีเมลออกจริง)
 *
 * ผลลัพธ์: `เอกสาร/walkthrough/placement-journey/index.html` (+ ภาพ NN.png)
 * ⛔ ข้อมูลทั้งหมดเป็นของปลอม · รีเซ็ตฐานเหมือน E2E ทุกครั้งที่รัน
 */

const PDF = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const SHORTCUT_PDF = '(ทางลัด: ใช้ไฟล์ PDF จำลองแทนกระดาษที่ลงนามจริง)';

test.describe('walkthrough: เส้นทางขอที่ฝึกงาน', () => {
  test('placement-journey', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const walk = createWalk('placement-journey', 'เส้นทางขอที่ฝึกงาน — ยื่นความจำนง → บริษัทตอบรับ');
    walk.watch(page);

    // บริษัทไม่มีบัญชี — เปิดลิงก์ในบริบทแยกที่ไม่มี cookie ใดๆ
    const companyCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const companyPage = await companyCtx.newPage();
    walk.watch(companyPage);

    try {
      await page.route('**/maps.googleapis.com/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: 'console.log("Mocked Google Maps API loaded successfully.");',
        })
      );
      await companyPage.route('**/maps.googleapis.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
      );
      await seedTestData();
      // ชุด E2E baseline ไม่ให้ staff1 มีโปรไฟล์โดยตั้งใจ (เทสต์ onboarding บุคลากร/SEC-06 พึ่งข้อนี้)
      // แต่ภาพ walkthrough ต้องเหมือนเจ้าหน้าที่จริง: แถบบนโชว์ชื่อ และไม่มี 404 จาก /profile/me
      // SQL เดียวกับ seedDevDemoData() ใน backend/src/db/setup.ts
      await dbExec(
        `INSERT INTO personnel (personnel_id, major_id, status, first_name, last_name)
         SELECT user_id, (SELECT major_id FROM master_major LIMIT 1), 'approved', 'สมใจ', 'เจ้าหน้าที่ดี'
           FROM users WHERE email = 'staff1@test.com'
         ON CONFLICT (personnel_id) DO NOTHING`
      );

      // ───────── นักศึกษา: ยื่นแบบแจ้งความจำนง ─────────
      await page.request.post(`${API_URL}/auth/logout`);
      await page.goto('/login/student');
      await walk.step(page, 'นักศึกษา', 'เปิดหน้าล็อกอินนักศึกษา');

      await loginAs(page, 'student2');
      await expect(placementCard(page)).toBeVisible();
      await walk.step(page, 'นักศึกษา', 'ล็อกอินแล้ว — หน้าแรกนักศึกษา ยังไม่มีใบความจำนง');

      await goToMenu(page, 'jobs');
      await expect(page.getByText('Full-Stack Developer (Seagate)')).toBeVisible();
      await walk.step(page, 'นักศึกษา', 'เปิดเมนูหาที่ฝึกงาน — กระดานตำแหน่งงาน');

      await page.locator('[data-testid="apply-job"]:enabled').first().click();
      const applyDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันเลือกสถานประกอบการ' });
      await expect(applyDialog).toBeVisible();
      await walk.step(page, 'นักศึกษา', 'กดสมัครตำแหน่งแรก — กล่องยืนยันเลือกสถานประกอบการ');

      await applyDialog.getByRole('button', { name: 'เลือกที่นี่' }).click();
      await expect(page.getByText('ส่งใบสมัครไปยัง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')).toBeVisible();
      await walk.step(page, 'นักศึกษา', 'กดยืนยัน — ระบบแจ้งว่าส่งใบสมัครแล้ว');

      await goToMenu(page, 'dashboard');
      await expect(page.getByTestId('print-request-form')).toBeVisible();
      await walk.step(page, 'นักศึกษา', 'กลับหน้าแรก — การ์ดสถานะและแบบคำร้อง (เอกสารหมายเลข 1) ให้พิมพ์ไปลงนาม');

      await page.getByTestId('upload-request-form').setInputFiles(PDF);
      await expect(page.getByTestId('request-form-uploaded')).toBeVisible();
      await walk.step(page, 'นักศึกษา', `อัปโหลดแบบคำร้องที่ลงนามแล้ว — รอเจ้าหน้าที่ตรวจ ${SHORTCUT_PDF}`);

      const formId = (await dbValue<number>(
        `SELECT form_id FROM intent_forms
          WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')
          ORDER BY form_id DESC LIMIT 1`
      )) as number;

      await logout(page);

      // ───────── อาจารย์ที่ปรึกษา / หัวหน้าสาขา: ติดตามอย่างเดียว (ลงนามบนกระดาษ) ─────────
      await loginAs(page, 'advisor1');
      await walk.step(page, 'อาจารย์ที่ปรึกษา', 'ล็อกอินอาจารย์ที่ปรึกษา — หน้าแรก (ไม่มีปุ่มอนุมัติ ลงนามบนกระดาษ)');
      await page.getByRole('button', { name: 'เปิดตารางติดตาม' }).click();
      await expect(page.locator('main').getByText('640101001')).toBeVisible();
      await walk.step(page, 'อาจารย์ที่ปรึกษา', 'เปิดตารางติดตามใบความจำนง — เห็นรายการของนักศึกษา');
      await logout(page);

      await loginAs(page, 'head1');
      await goToMenu(page, 'approval');
      await expect(page.getByText('640101001').first()).toBeVisible();
      await walk.step(page, 'หัวหน้าสาขา', 'หัวหน้าสาขาเปิดเมนูติดตามใบความจำนง — ดูอย่างเดียว');
      await logout(page);

      // ───────── เจ้าหน้าที่: รับคำร้อง + ยืนยันสถานประกอบการ ─────────
      await loginAs(page, 'staff1');
      await expect(page.getByTestId(`review-request-${formId}`)).toBeVisible();
      await walk.step(page, 'เจ้าหน้าที่', 'ล็อกอินเจ้าหน้าที่ — หน้าแรกพร้อมคิวคำร้องรอตรวจ');

      await page.getByTestId(`review-request-${formId}`).click();
      await expect(page.getByTestId('officer-document-no')).toBeVisible();
      await walk.step(page, 'เจ้าหน้าที่', 'กด "ตรวจคำร้อง" — แผงรับคำร้อง (เห็นกระดาษที่นักศึกษาอัปโหลด)');

      await page.getByTestId('officer-document-no').fill('อว 0656.10/ตัวอย่าง-001');
      await walk.step(page, 'เจ้าหน้าที่', 'กรอกเลขที่หนังสือออก');

      await page.getByTestId('officer-approve-open').click();
      const approveDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการรับคำร้องและออกเลขหนังสือ' });
      await expect(approveDialog).toBeVisible();
      await walk.step(page, 'เจ้าหน้าที่', 'กด "รับคำร้อง" — กล่องยืนยัน (รับรองสถานประกอบการ + ออกหนังสือเข้าคิวคณบดี)');

      await approveDialog.getByRole('button', { name: 'ออกเลขและรับคำร้อง' }).click();
      await expect(page.getByText(/รับคำร้องของ .* แล้ว เลขที่หนังสือ/)).toBeVisible();
      await walk.step(page, 'เจ้าหน้าที่', 'ยืนยันแล้ว — ระบบแจ้งว่ารับคำร้องและออกเลขที่หนังสือแล้ว');
      await logout(page);

      // ───────── คณบดี: ลงนามหนังสือขอความอนุเคราะห์ ─────────
      const docId = await coverLetterDocId();
      await loginAs(page, 'dean1');
      await expect(page.getByTestId(`dean-doc-row-${docId}`)).toBeVisible();
      await walk.step(page, 'คณบดี', 'ล็อกอินคณบดี — คิวหนังสือรอลงนาม (หนังสือของนักศึกษาเข้ามาแล้ว)');

      await page.getByTestId(`dean-doc-row-${docId}`).locator('input[type="checkbox"]').check();
      await walk.step(page, 'คณบดี', 'ติ๊กเลือกหนังสือที่จะลงนาม');

      await page.getByTestId('dean-sign-selected').click();
      const signDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการลงนามเอกสารราชการ' });
      await expect(signDialog).toBeVisible();
      await walk.step(page, 'คณบดี', 'กด "ลงนามแบบกลุ่มที่เลือก" — กล่องยืนยัน (ยกเลิกจากหน้านี้ไม่ได้)');

      await signDialog.getByRole('button', { name: /^ลงนาม \d+ ฉบับ/ }).click();
      await expect(page.getByText('ลงนามแบบกลุ่มสำเร็จเรียบร้อยแล้ว')).toBeVisible();
      await walk.step(page, 'คณบดี', 'ยืนยันแล้ว — ระบบประทับลายมือชื่อและแจ้งว่าลงนามสำเร็จ');

      await page.getByTestId('dean-view-signed').click();
      await expect(page.getByTestId(`dean-doc-row-${docId}`)).toBeVisible();
      await walk.step(page, 'คณบดี', 'สลับไปแท็บ "ลงนามแล้ว" — หนังสือย้ายมาอยู่ในรายการนี้');
      await logout(page);

      // ───────── นักศึกษา: ส่งหนังสือถึงบริษัททางอีเมล ─────────
      await loginAs(page, 'student2');
      await expect(page.getByTestId('company-mail-box')).toBeVisible();
      await walk.step(page, 'นักศึกษา', 'ล็อกอินนักศึกษา — คณบดีลงนามแล้ว การ์ดขึ้นกล่องส่งหนังสือให้สถานประกอบการ');

      await page.getByTestId('company-mail-input').fill('hr-demo@example.com');
      await walk.step(page, 'นักศึกษา', 'กรอกอีเมลฝ่ายบุคคลของบริษัท');

      await page.getByTestId('company-mail-send').click();
      await expect(page.getByRole('dialog')).toContainText('hr-demo@example.com');
      await walk.step(page, 'นักศึกษา', 'กด "ส่งหนังสือทางอีเมล" — กล่องยืนยันก่อนส่ง');

      await page.getByTestId('company-mail-confirm').click();
      await expect(page.getByTestId('company-mail-status')).toContainText('ส่งถึง hr-demo@example.com');
      await walk.step(page, 'นักศึกษา', 'ยืนยันแล้ว — การ์ดแสดงว่าส่งถึงบริษัทเมื่อไร (ระบบไม่ส่งเมลจริงตอนทดสอบ)');
      await logout(page);

      // ───────── บริษัท: เปิดลิงก์ /accept (ไม่มีบัญชี) ─────────
      const token = (await dbValue<string>(
        'SELECT token FROM acceptance_link_tokens WHERE form_id = $1 ORDER BY token_id DESC LIMIT 1',
        [formId]
      )) as string;
      expect(token).toBeTruthy();
      const today = (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;

      await companyPage.goto(`${APP_URL}/accept?token=${token}`);
      await expect(companyPage.getByTestId('al-student-name')).toBeVisible();
      await walk.step(companyPage, 'บริษัท(ลิงก์)', 'บริษัทเปิดลิงก์ในอีเมล (ทางลัด: อ่าน token จากฐาน แทนการเปิดจากอีเมลจริง) — หน้าตอบรับ ไม่ต้องล็อกอิน');

      await companyPage.getByTestId('al-decision-accept').check();
      await companyPage.getByTestId('al-next').click();
      await expect(companyPage.getByTestId('al-error')).toBeVisible();
      await walk.step(companyPage, 'บริษัท(ลิงก์)', 'เลือก "รับ" แล้วกดถัดไปทั้งที่ยังว่าง — ระบบบอกว่าขาดอะไร');

      await companyPage.getByTestId('al-signer-name').fill('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
      await companyPage.getByTestId('al-signer-position').fill('ผู้จัดการฝ่ายบุคคล');
      await companyPage.getByTestId('al-signed-date').fill(today);
      await companyPage.getByTestId('al-start-date').fill('2026-11-02');
      await companyPage.getByTestId('al-evidence').setInputFiles(PDF);
      await walk.step(companyPage, 'บริษัท(ลิงก์)', `ขั้น 1: กรอกผู้ลงนาม วันที่ และแนบแบบตอบรับ ${SHORTCUT_PDF}`);

      await companyPage.getByTestId('al-next').click();
      await expect(companyPage.getByTestId('al-manager-name')).toBeVisible();
      await walk.step(companyPage, 'บริษัท(ลิงก์)', 'ขั้น 2: ข้อมูลสถานประกอบการ (สหกิจ 07) พี่เลี้ยง และงานที่มอบหมาย — ยังว่าง');

      await companyPage.getByTestId('al-company-phone').fill('038111222');
      await companyPage.getByTestId('al-manager-name').fill('คุณผู้จัดการ ทดสอบ');
      await companyPage.getByTestId('al-mentor-name').fill('สุรเดช ใจดี');
      await companyPage.getByTestId('al-mentor-position').fill('Supervisor');
      await companyPage.getByTestId('al-mentor-phone').fill('0812223333');
      await companyPage.getByTestId('al-mentor-email').fill('mentor-walk@example.com');
      await companyPage.getByTestId('al-job-position').fill('Software Tester');
      await companyPage.getByTestId('al-job-description').fill('ทดสอบระบบและเขียนรายงานผลการทดสอบ');
      await walk.step(companyPage, 'บริษัท(ลิงก์)', 'ขั้น 2: กรอกข้อมูลครบแล้ว');

      await companyPage.getByTestId('al-next').click();
      await expect(companyPage.getByTestId('confirm-summary')).toBeVisible();
      await walk.step(companyPage, 'บริษัท(ลิงก์)', 'ขั้น 3: ตรวจสรุปก่อนส่ง');

      await companyPage.getByTestId('al-submit').click();
      await expect(companyPage.getByRole('dialog')).toBeVisible();
      await walk.step(companyPage, 'บริษัท(ลิงก์)', 'กดส่ง — กล่องยืนยันการตอบรับ');

      await companyPage.getByTestId('al-confirm').click();
      await expect(companyPage.getByTestId('al-done')).toBeVisible();
      await walk.step(companyPage, 'บริษัท(ลิงก์)', 'ยืนยันแล้ว — หน้า "ส่งแล้ว" ของบริษัท');

      await companyPage.reload();
      await expect(companyPage.getByTestId('al-gone')).toBeVisible();
      await walk.step(companyPage, 'บริษัท(ลิงก์)', 'เปิดลิงก์เดิมซ้ำ — หน้า "ลิงก์ถูกใช้ตอบไปแล้ว"');

      // ───────── เจ้าหน้าที่: รับแบบตอบรับ ─────────
      await loginAs(page, 'staff1');
      await expect(page.getByTestId(`review-acceptance-${formId}`)).toBeVisible();
      await walk.step(page, 'เจ้าหน้าที่', 'ล็อกอินเจ้าหน้าที่ — คิวแบบตอบรับมีรายการจากบริษัทเข้ามา');

      await page.getByTestId(`review-acceptance-${formId}`).click();
      await expect(page.getByTestId('acceptance-source-link')).toBeVisible();
      await walk.step(page, 'เจ้าหน้าที่', 'กด "ตรวจแบบตอบรับ" — เห็นว่าบริษัทตอบผ่านลิงก์ พร้อมข้อมูลพี่เลี้ยงและ สหกิจ 07');

      await page.getByTestId('acceptance-approve-submit').click();
      await expect(page.getByTestId('acceptance-approve-confirm')).toBeVisible();
      await walk.step(page, 'เจ้าหน้าที่', 'กด "รับแบบตอบรับ" — กล่องยืนยัน (เปิดบัญชีพี่เลี้ยงและส่งอีเมลเชิญ)');

      await page.getByTestId('acceptance-approve-confirm').click();
      await expect(page.getByText(/รับแบบตอบรับเรียบร้อยแล้ว/)).toBeVisible();
      await walk.step(page, 'เจ้าหน้าที่', 'ยืนยันแล้ว — ระบบแจ้งว่ารับแบบตอบรับเรียบร้อย');
      await logout(page);

      // ───────── นักศึกษา: เห็นผล ─────────
      await loginAs(page, 'student2');
      await expect(placementCard(page).getByText('สถานประกอบการตอบรับแล้ว', { exact: false })).toBeVisible();
      await walk.step(page, 'นักศึกษา', 'ล็อกอินนักศึกษา — การ์ดแสดงว่าสถานประกอบการตอบรับแล้ว เข้าสู่ขั้นเตรียมปฏิบัติงาน');
    } finally {
      await walk.finish();
      await companyCtx.close();
    }
  });
});
