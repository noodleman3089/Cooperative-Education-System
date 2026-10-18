import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { APP_URL } from '../helpers/env';
import { loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { coverLetterDocId, placementCard, setCoopStart, statusBoardRow } from '../helpers/intent';
import { dbExec, dbValue } from '../helpers/db';

/**
 * วิดีโอ: ขั้นตอนสหกิจศึกษาสายหลักตั้งแต่ยื่นคำร้องจนเห็นผลประเมิน (ทุกฝ่ายทำงานผ่านหน้าเว็บจริง)
 *
 * ไม่ใช่เทสต์ในชุดเต็ม — รันด้วย `npm.cmd run test:video` (`playwright.video.config.ts`)
 * ผลลัพธ์: `เอกสาร/walkthrough/full-journey-video/สหกิจ-ต้นสายถึงปลายสาย.webm` (gitignore ทั้งโฟลเดอร์ `เอกสาร/`)
 *
 * แถบคำบรรยายด้านล่างจอบอกว่า "ตอนนี้ฝ่ายไหนกำลังทำอะไร" — ฝังด้วย `addInitScript` อ่านจาก sessionStorage
 * จึงอยู่รอดข้ามการโหลดหน้าใหม่ตอนล็อกเอาต์/ล็อกอิน
 *
 * ทางลัดที่บอกไว้บนจอ:
 *   · ไฟล์ PDF/รูปจำลองแทนกระดาษที่ลงนามจริง
 *   · token ลิงก์ของบริษัทอ่านจากฐาน — ของจริงอยู่ในอีเมลที่ระบบส่ง (MAIL_DRY_RUN จึงไม่มีเมลออกจริง)
 *   · วันเริ่มปฏิบัติงานตั้งเป็น "วันนี้" ในปฏิทินสหกิจ เพื่อให้ระบุพี่เลี้ยงได้ทันทีในคลิปเดียว
 * ⛔ ข้อมูลทั้งหมดเป็นของปลอม · รีเซ็ตฐานเหมือน E2E ห้ามรันซ้อนกับ E2E
 */

const OUT_DIR = path.resolve(__dirname, '../../เอกสาร/walkthrough/full-journey-video');
const OUT_FILE = path.join(OUT_DIR, 'สหกิจ-ต้นสายถึงปลายสาย.webm');
const PDF = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');

/** ฝังแถบคำบรรยาย — อ่านข้อความจาก sessionStorage ทุก 250 ms จึงกลับมาเองหลังโหลดหน้าใหม่ */
async function installNarration(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const render = () => {
      let raw: string | null = null;
      try {
        raw = sessionStorage.getItem('__narration');
      } catch {
        return;
      }
      let el = document.getElementById('__narration');
      if (!raw) {
        el?.remove();
        return;
      }
      const { role, text } = JSON.parse(raw) as { role: string; text: string };
      if (!el) {
        el = document.createElement('div');
        el.id = '__narration';
        el.setAttribute(
          'style',
          [
            'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483647', 'pointer-events:none',
            'display:flex', 'align-items:center', 'gap:16px', 'padding:14px 28px',
            'background:rgba(15,23,42,.94)', 'color:#fff',
            'font:600 22px/1.45 "Noto Sans Thai","Sarabun",Tahoma,sans-serif',
            'border-top:4px solid #2563eb',
          ].join(';')
        );
        document.documentElement.appendChild(el);
      }
      const html = `<span style="background:#2563eb;border-radius:999px;padding:4px 18px;white-space:nowrap">${role}</span><span>${text}</span>`;
      if (el.innerHTML !== html) el.innerHTML = html;
    };
    setInterval(render, 250);
    window.addEventListener('DOMContentLoaded', render);
  });
}

/** บอกผู้ชมว่าตอนนี้ใครทำอะไร แล้วหยุดให้อ่าน */
async function say(page: Page, role: string, text: string, holdMs = 2600): Promise<void> {
  await page.evaluate(
    ([r, t]) => sessionStorage.setItem('__narration', JSON.stringify({ role: r, text: t })),
    [role, text]
  );
  await page.waitForTimeout(holdMs);
}

/** หยุดสั้น ๆ หลังการกระทำสำคัญ ให้เห็นผลบนจอ */
const beat = (page: Page, ms = 1400) => page.waitForTimeout(ms);

/** ให้คะแนนเต็มทุกข้อของฟอร์มประเมินที่เปิดอยู่ */
async function fillEveryScoreWithMax(page: Page): Promise<void> {
  const selects = page.locator('form select');
  const count = await selects.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    const max = await select.locator('option').last().getAttribute('value');
    await select.selectOption(max as string);
  }
}

test.describe('video: สหกิจศึกษาต้นสายถึงปลายสาย', () => {
  test.beforeAll(async () => {
    // เตรียมฐานก่อนเปิดเบราว์เซอร์ — ต้นวิดีโอจะได้ไม่มีช่วงจอขาว
    await seedTestData();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    await setCoopStart(today);
    await dbExec(
      `UPDATE students SET emergency_contact_name = 'นางสมศรี สายดี', emergency_relationship = 'มารดา', emergency_phone = '0898765432'
        WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')`
    );
    // mentor1 ยังไม่เปิดบัญชี — ให้เห็นขั้นอาจารย์นิเทศยืนยันพี่เลี้ยงจริง
    await dbExec("UPDATE users SET is_active = FALSE WHERE email = 'mentor1@test.com'");
    // เจ้าหน้าที่ต้องมีโปรไฟล์ แถบบนจะโชว์ชื่อ (SQL เดียวกับ walkthrough อื่น)
    await dbExec(
      `INSERT INTO personnel (personnel_id, major_id, status, first_name, last_name)
       SELECT user_id, (SELECT major_id FROM master_major LIMIT 1), 'approved', 'สมใจ', 'เจ้าหน้าที่ดี'
         FROM users WHERE email = 'staff1@test.com'
       ON CONFLICT (personnel_id) DO NOTHING`
    );
  });

  test('full-journey-video', async ({ page }) => {
    test.setTimeout(30 * 60_000);
    await installNarration(page);
    await page.route('**/maps.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );

    try {
      const today = (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;
      const studentId = (await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'")) as number;

      // ═════════ 1 · นักศึกษา: ยื่นคำร้องขอหนังสือ (เอกสารหมายเลข 1) ═════════
      await page.goto('/login/student');
      await say(page, 'เริ่มต้น', 'ระบบสหกิจศึกษา — เส้นทางหลักตั้งแต่ยื่นคำร้องจนเห็นผลประเมิน (ข้อมูลทั้งหมดเป็นของปลอม)', 3500);

      await loginAs(page, 'student2');
      await expect(placementCard(page)).toBeVisible();
      await say(page, 'นักศึกษา', 'ล็อกอินเข้าระบบ — หน้าแรกยังไม่มีคำร้อง');

      await goToMenu(page, 'jobs');
      await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();
      await say(page, 'นักศึกษา', 'เมนูยื่นคำร้องขอหนังสือ — ค้นหาสถานประกอบการ');
      await page.getByTestId('request-company-search').fill('ซีเกท');
      await page.getByTestId('request-directory-matches').getByRole('button').first().click();
      await expect(page.getByTestId('request-company-locked')).toBeVisible();
      await say(page, 'นักศึกษา', 'เลือกสถานประกอบการจากทำเนียบ — ระบบเติมข้อมูลและตัวอย่างแบบคำร้องให้');
      await page.getByTestId('request-submit').click();
      await expect(page.getByRole('dialog').filter({ hasText: 'ยืนยันยื่นคำร้อง' })).toBeVisible();
      await say(page, 'นักศึกษา', 'กดยื่นคำร้อง — กล่องยืนยันบอกชื่อและที่อยู่ที่จะถูกพิมพ์ลงหนังสือ');
      await page.getByTestId('request-confirm').click();
      await expect(page.getByText('ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')).toBeVisible();
      await say(page, 'นักศึกษา', 'ยื่นคำร้องเรียบร้อย');

      await goToMenu(page, 'dashboard');
      await expect(page.getByTestId('print-request-form')).toBeVisible();
      await say(page, 'นักศึกษา', 'พิมพ์แบบคำร้องไปให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาลงนามบนกระดาษ');
      await page.getByTestId('upload-request-form').setInputFiles(PDF);
      await page.getByTestId('request-form-confirm').click();
      await expect(page.getByTestId('request-form-uploaded')).toBeVisible();
      await say(page, 'นักศึกษา', 'อัปโหลดแบบคำร้องที่ลงนามแล้ว — (ทางลัด: ใช้ไฟล์ PDF จำลองแทนกระดาษจริง)');
      await logout(page);

      // ═════════ 2 · อาจารย์ที่ปรึกษา · หัวหน้าสาขา: ติดตามสถานะ (ลงนามบนกระดาษ) ═════════
      await loginAs(page, 'advisor1');
      await expect(await statusBoardRow(page, studentId)).toContainText('640101001');
      await say(page, 'อาจารย์ที่ปรึกษา', 'บอร์ด "ตรวจสอบสถานะนักศึกษา" — เห็นนักศึกษาที่ยื่นคำร้องแล้ว (ลายเซ็นอยู่บนกระดาษ ระบบใช้ติดตามอย่างเดียว)', 3800);
      await logout(page);

      await loginAs(page, 'head1');
      const headRow = await statusBoardRow(page, studentId);
      await expect(headRow.getByRole('button', { name: 'ดูคำร้อง' })).toBeVisible();
      await say(page, 'หัวหน้าสาขา', 'หัวหน้าสาขาเห็นบอร์ดสถานะของสาขา — ปุ่ม "ดูคำร้อง" เปิดรายละเอียดและผู้ลงนามบนกระดาษ', 3800);
      await logout(page);

      // ═════════ 3 · เจ้าหน้าที่: รับคำร้อง ═════════
      await loginAs(page, 'staff1');
      const formId = (await dbValue<number>(
        `SELECT form_id FROM intent_forms WHERE student_id = ${studentId} ORDER BY form_id DESC LIMIT 1`
      )) as number;
      await expect(page.getByTestId(`review-request-${formId}`)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'หน้าแรกเจ้าหน้าที่ — คิวคำร้องรอตรวจ');
      await page.getByTestId(`review-request-${formId}`).click();
      await expect(page.getByTestId('officer-document-no')).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'เปิดแผงตรวจคำร้อง — เห็นกระดาษที่นักศึกษาอัปโหลด ตรวจกับข้อมูลสถานประกอบการ', 3200);
      await page.getByTestId('officer-document-no').fill('อว 0656.10/ตัวอย่าง-001');
      await say(page, 'เจ้าหน้าที่สหกิจ', 'กรอกเลขที่หนังสือออก');
      await page.getByTestId('officer-approve-open').click();
      const approveDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการรับคำร้องและออกเลขหนังสือ' });
      await expect(approveDialog).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'กล่องยืนยัน — รับรองสถานประกอบการและออกหนังสือเข้าคิวคณบดีในคราวเดียว', 3200);
      await approveDialog.getByRole('button', { name: 'รับคำร้องและออกเลข', exact: true }).click();
      await expect(page.getByText(/รับคำร้องของ .* แล้ว เลขที่หนังสือ/)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'รับคำร้องแล้ว — ระบบออกหนังสือขอความอนุเคราะห์ส่งให้คณบดีลงนาม');
      await logout(page);

      // ═════════ 4 · คณบดี: ลงนามหนังสือ ═════════
      const docId = await coverLetterDocId();
      await loginAs(page, 'dean1');
      await expect(page.getByTestId(`dean-doc-row-${docId}`)).toBeVisible();
      await say(page, 'คณบดี', 'คิวหนังสือรอลงนาม — หนังสือของนักศึกษาเข้ามาแล้ว');
      await page.getByTestId(`dean-doc-row-${docId}`).locator('input[type="checkbox"]').check();
      await say(page, 'คณบดี', 'ติ๊กเลือกหนังสือที่จะลงนาม');
      await page.getByTestId('dean-sign-selected').click();
      const signDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการลงนามเอกสารราชการ' });
      await expect(signDialog).toBeVisible();
      await say(page, 'คณบดี', 'กล่องยืนยันการลงนาม — ยกเลิกจากหน้านี้ไม่ได้', 3000);
      await signDialog.getByRole('button', { name: /^ลงนาม \d+ ฉบับ/ }).click();
      await expect(page.getByText('ลงนามเรียบร้อยแล้ว — นักศึกษาได้รับหนังสือและเห็นในระบบทันที')).toBeVisible();
      await say(page, 'คณบดี', 'ลงนามแล้ว — ระบบประทับลายมือชื่อดิจิทัลลงหนังสือ นักศึกษาเห็นในระบบทันที');
      await logout(page);

      // ═════════ 5 · นักศึกษา: ส่งหนังสือถึงสถานประกอบการ ═════════
      await loginAs(page, 'student2');
      await expect(page.getByTestId('company-mail-box')).toBeVisible();
      await say(page, 'นักศึกษา', 'คณบดีลงนามแล้ว — การ์ดขึ้นกล่องส่งหนังสือให้สถานประกอบการ');
      await page.getByTestId('company-mail-input').fill('hr-demo@example.com');
      await page.getByTestId('company-mail-send').click();
      await expect(page.getByRole('dialog')).toContainText('hr-demo@example.com');
      await say(page, 'นักศึกษา', 'กรอกอีเมลฝ่ายบุคคลแล้วกดส่ง — กล่องยืนยันก่อนส่งหนังสือ');
      await page.getByTestId('company-mail-confirm').click();
      await expect(page.getByTestId('company-mail-status')).toContainText('ส่งถึง hr-demo@example.com');
      await say(page, 'นักศึกษา', 'ส่งหนังสือถึงบริษัทแล้ว (ระบบไม่ส่งอีเมลจริงตอนอัดคลิป)');
      await logout(page);

      // ═════════ 6 · สถานประกอบการ: ตอบรับผ่านลิงก์ (ไม่มีบัญชี) ═════════
      const token = (await dbValue<string>(
        'SELECT token FROM acceptance_link_tokens WHERE form_id = $1 ORDER BY token_id DESC LIMIT 1',
        [formId]
      )) as string;
      expect(token).toBeTruthy();
      await page.goto(`${APP_URL}/accept?token=${token}`);
      await expect(page.getByTestId('al-student-name')).toBeVisible();
      await say(page, 'สถานประกอบการ', 'บริษัทเปิดลิงก์ในอีเมล — ไม่ต้องมีบัญชี (ทางลัด: อ่าน token จากฐานแทนเปิดจากอีเมลจริง)', 3600);
      await page.getByTestId('al-decision-accept').check();
      await page.getByTestId('al-signer-name').fill('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
      await page.getByTestId('al-signer-position').fill('ผู้จัดการฝ่ายบุคคล');
      await page.getByTestId('al-signed-date').fill(today);
      await page.getByTestId('al-evidence').setInputFiles(PDF);
      await say(page, 'สถานประกอบการ', 'เลือก "รับ" กรอกผู้ลงนามและแนบแบบตอบรับ — (ทางลัด: ไฟล์ PDF จำลอง)', 3200);
      await page.getByTestId('al-submit').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await say(page, 'สถานประกอบการ', 'กล่องยืนยันการตอบรับ');
      await page.getByTestId('al-confirm').click();
      await expect(page.getByTestId('al-done')).toBeVisible();
      await say(page, 'สถานประกอบการ', 'ตอบรับเรียบร้อย — ลิงก์ใช้ได้ครั้งเดียว');

      // ═════════ 7 · เจ้าหน้าที่: รับแบบตอบรับ ═════════
      await loginAs(page, 'staff1');
      await expect(page.getByTestId(`review-acceptance-${formId}`)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'คิวแบบตอบรับ — มีรายการจากบริษัทเข้ามา');
      await page.getByTestId(`review-acceptance-${formId}`).click();
      await expect(page.getByTestId('acceptance-source-link')).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'ตรวจแบบตอบรับ — เห็นว่าบริษัทตอบผ่านลิงก์');
      await page.getByTestId('acceptance-approve-submit').click();
      await expect(page.getByTestId('acceptance-approve-confirm')).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'กล่องยืนยันรับแบบตอบรับ — นักศึกษา บริษัท วันเริ่มงาน');
      await page.getByTestId('acceptance-approve-confirm').click();
      await expect(page.getByText(/รับแบบตอบรับเรียบร้อยแล้ว/)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'รับแบบตอบรับแล้ว — นักศึกษาได้ที่ฝึกงาน');
      await logout(page);

      // ═════════ 8 · นักศึกษา: ได้ที่ฝึกงาน → ระบุพี่เลี้ยง ═════════
      await loginAs(page, 'student2');
      await expect(placementCard(page).getByText('สถานประกอบการตอบรับแล้ว', { exact: false })).toBeVisible();
      await say(page, 'นักศึกษา', 'ได้ที่ฝึกงานแล้ว — การ์ด "ที่ฝึกงานของคุณ" ขึ้นสถานประกอบการที่ตอบรับ');
      await goToMenu(page, 'my_mentor');
      await expect(page.getByTestId('mentor-card')).toHaveAttribute('data-state', 'none');
      await page.getByTestId('mentor-name').fill('นายสุรเดช ใจดี');
      await page.getByTestId('mentor-email').fill('mentor1@test.com');
      await page.getByTestId('mentor-phone').fill('0812223333');
      await page.getByTestId('mentor-position').fill('หัวหน้าแผนกพัฒนาซอฟต์แวร์');
      await page.getByTestId('mentor-department').fill('ฝ่ายวิจัยและพัฒนา');
      await say(page, 'นักศึกษา', 'เมนู "พี่เลี้ยงของฉัน" — กรอกข้อมูลพี่เลี้ยงประจำสถานประกอบการ (เปิดให้ระบุเมื่อถึงวันเริ่มฝึก)', 3200);
      await page.getByTestId('mentor-submit').click();
      await expect(page.getByTestId('mentor-card')).toHaveAttribute('data-state', 'unconfirmed');
      await say(page, 'นักศึกษา', 'บันทึกแล้ว — รออาจารย์นิเทศยืนยันพี่เลี้ยง');
      await logout(page);

      // ═════════ 9 · อาจารย์นิเทศ: ยืนยันพี่เลี้ยง ═════════
      await loginAs(page, 'advisor1');
      await page.goto('/dashboard?role=supervisor&menu=mentor_followup');
      const mentorId = (await dbValue<number>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId])) as number;
      await expect(page.getByTestId(`mf-inactive-${mentorId}`)).toHaveText('รอยืนยัน');
      await say(page, 'อาจารย์นิเทศ', 'เมนู "ติดตามพี่เลี้ยง" — พี่เลี้ยงที่นักศึกษาระบุขึ้นป้ายรอยืนยัน');
      await page.getByTestId(`mf-confirm-${mentorId}`).click();
      await expect(page.getByTestId('mf-confirm-submit')).toBeVisible();
      await say(page, 'อาจารย์นิเทศ', 'กล่องยืนยันบอกชื่อ อีเมล บริษัท และนักศึกษา');
      await page.getByTestId('mf-confirm-submit').click();
      await expect(page.getByTestId(`mf-inactive-${mentorId}`)).toHaveCount(0);
      await say(page, 'อาจารย์นิเทศ', 'ยืนยันแล้ว — บัญชีพี่เลี้ยงเปิด ระบบส่งลิงก์เข้าระบบไปที่อีเมลพี่เลี้ยง');
      await logout(page);

      // ═════════ 10 · นักศึกษา: ที่พัก · บันทึกรายสัปดาห์ · โครงร่างรายงาน ═════════
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
      await say(page, 'นักศึกษา', 'แบบแจ้งรายละเอียดที่พัก (สหกิจ 06) — ให้อาจารย์นิเทศรู้ที่พักก่อนเดินทางไปนิเทศ', 3000);
      await page.getByTestId('acc-save').click();
      await expect(page.getByText('บันทึกข้อมูลที่พัก (สหกิจ 06) เรียบร้อยแล้ว')).toBeVisible();
      await say(page, 'นักศึกษา', 'บันทึกที่พักแล้ว');

      await goToMenu(page, 'weekly_log');
      await expect(page.getByRole('heading', { name: 'บันทึกการปฏิบัติงาน', exact: true })).toBeVisible();
      await page.getByTestId('weekly-assigned-work').fill('ศึกษาระบบคลังสินค้าและพัฒนา REST API');
      await page.getByTestId('weekly-methods').fill('ออกแบบ PostgreSQL schema และเขียน Node.js TypeScript');
      await page.getByTestId('weekly-tools').fill('React, Node.js, PostgreSQL, Docker');
      await page.getByTestId('weekly-achievements').fill('ส่งมอบ API คลังสินค้าชุดแรกพร้อม Unit Test ผ่าน 100%');
      await say(page, 'นักศึกษา', 'บันทึกการปฏิบัติงานรายสัปดาห์ (สหกิจ 09) — กรอกงานที่ทำ วิธีการ เครื่องมือ และผลงาน', 3000);
      await page.getByTestId('worklog-submit').click();
      await expect(page.getByText('ส่งบันทึกการปฏิบัติงานรายสัปดาห์เรียบร้อยแล้ว')).toBeVisible();
      await say(page, 'นักศึกษา', 'ส่งบันทึกสัปดาห์ที่ 1 แล้ว — รอพี่เลี้ยงรับรอง');

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
      await say(page, 'นักศึกษา', 'โครงร่างรายงาน (สหกิจ 11) — กรอกหัวข้อ เนื้อหา และแนบไฟล์ (ทางลัด: ไฟล์ PDF จำลอง)', 3000);
      await page.getByTestId('outline-submit').click();
      await expect(page.getByTestId('confirm-summary')).toBeVisible();
      await page.getByTestId('outline-confirm').click();
      await expect(page.getByRole('heading', { name: 'ประวัติการส่งและผลตรวจ (1 เวอร์ชัน)' })).toBeVisible();
      await say(page, 'นักศึกษา', 'ส่งโครงร่างแล้ว — ถึงพี่เลี้ยงตรวจเป็นลำดับแรก');
      await logout(page);

      // ═════════ 11 · พี่เลี้ยง: ตรวจโครงร่าง ═════════
      await loginAs(page, 'mentor1');
      await goToMenu(page, 'report_outlines');
      await expect(page.locator('text="โครงร่างรายงานการปฏิบัติงานสหกิจศึกษา (สหกิจ 11)"')).toBeVisible();
      await expect(page.locator('text="รอพี่เลี้ยงตรวจ"')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'พี่เลี้ยงเข้าระบบด้วยลิงก์ที่ได้รับ — เมนูโครงร่างรายงาน มีรายการรอตรวจ');
      await page.click('button:has-text("ตรวจอนุมัติ")');
      await expect(page.locator('text="พิจารณาโครงร่างรายงาน (สหกิจ 11)"')).toBeVisible();
      await page.locator('textarea').fill('เนื้อหาโครงร่างสมบูรณ์ พี่เลี้ยงเห็นชอบตามนี้');
      await say(page, 'พี่เลี้ยง', 'ตรวจโครงร่างและเขียนความเห็น', 2800);
      await page.click('button:has-text("อนุมัติและส่งต่ออาจารย์นิเทศ")');
      await expect(page.getByText('ส่งต่อแล้วท่านจะดึงกลับเองไม่ได้')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'กล่องยืนยัน — ส่งต่อแล้วดึงกลับเองไม่ได้');
      await page.getByTestId('outline-mentor-approve-confirm').click();
      await expect(page.locator('text="พี่เลี้ยงอนุมัติแล้ว (รอ อ.นิเทศ)"')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'พี่เลี้ยงเห็นชอบ — ส่งต่ออาจารย์นิเทศ');
      await logout(page);

      // ═════════ 12 · อาจารย์นิเทศ: เห็นชอบโครงร่าง ═════════
      await loginAs(page, 'advisor1');
      await page.getByTestId('role-btn-supervisor').click();
      await goToMenu(page, 'report_outlines');
      await expect(page.getByTestId('outline-review-panel')).toBeVisible();
      await say(page, 'อาจารย์นิเทศ', 'ฝ่ายนิเทศ — โครงร่างที่พี่เลี้ยงเห็นชอบแล้วมาถึง อ่านแล้วให้ความเห็น');
      await page.getByTestId('outline-review-comment').fill('อาจารย์นิเทศพิจารณาแล้วอนุมัติโครงร่างรายงาน');
      await page.getByTestId('outline-approve').click();
      await expect(page.getByText('เห็นชอบโครงร่างรายงานของ')).toBeVisible();
      await say(page, 'อาจารย์นิเทศ', 'เห็นชอบโครงร่างรายงานแล้ว');
      await logout(page);

      // ═════════ 13 · นักศึกษา: ส่งรายงานฉบับสมบูรณ์ ═════════
      await loginAs(page, 'student2');
      await goToMenu(page, 'final_report');
      await expect(page.getByRole('heading', { name: 'รายงานฉบับสมบูรณ์', exact: true })).toBeVisible();
      await page.getByTestId('finalreport-step1-upload').setInputFiles({
        name: 'final_report_draft.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock Final Report Draft Content'),
      });
      await page.getByTestId('finalreport-upload-confirm').click();
      await expect(page.getByTestId('finalreport-step1-status')).toContainText('รอพี่เลี้ยงตรวจ');
      await say(page, 'นักศึกษา', 'รายงานฉบับสมบูรณ์ ขั้นที่ 1 — ส่งร่างให้พี่เลี้ยงตรวจ (ทางลัด: ไฟล์ PDF จำลอง)');
      await page.getByTestId('finalreport-upload').setInputFiles({
        name: 'final_report_complete.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock Final Complete Report Content'),
      });
      await page.getByTestId('finalreport-upload-confirm').click();
      await expect(page.getByTestId('finalreport-version-1')).toBeVisible();
      await say(page, 'นักศึกษา', 'ขั้นที่ 2 — ส่งเล่มฉบับสมบูรณ์ให้อาจารย์ตรวจ');
      await logout(page);

      // ═════════ 14 · พี่เลี้ยง: ประเมินผล สหกิจ 15 และ 16 ═════════
      await loginAs(page, 'mentor1');
      await goToMenu(page, 'final_evaluation');
      await expect(page.getByRole('heading', { name: 'รายชื่อประเมินผลนักศึกษาสหกิจศึกษา' })).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'เมนูประเมินผลนักศึกษา — พี่เลี้ยงกรอกแบบประเมินสหกิจ 15 และสหกิจ 16');
      await page.click('text="สมชาย สายดี"');
      await expect(page.locator('text="ผู้รับประเมิน: สมชาย สายดี"')).toBeVisible();
      await fillEveryScoreWithMax(page);
      await expect(page.locator('text="ให้คะแนนครบทุกข้อแล้ว"')).toBeVisible();
      await page.getByLabel('จุดเด่นของนักศึกษา / Strength').fill('มีความรับผิดชอบสูง ตรงต่อเวลา');
      await page.getByLabel('ข้อควรปรับปรุงของนักศึกษา / Improvement').fill('เพิ่มการสื่อสารในทีมให้มากขึ้น');
      await page.getByLabel('ข้อคิดเห็นเพิ่มเติม / Other comments').fill('ปฏิบัติงานได้ดีเยี่ยม');
      await page.getByRole('radio', { name: 'รับ / Yes' }).check();
      await say(page, 'พี่เลี้ยง', 'สหกิจ 15 — ประเมินการปฏิบัติงาน 18 ข้อ เต็ม 100 คะแนน (ใช้ตัดเกรด)', 3200);
      await page.click('button:has-text("ส่งผลประเมิน")');
      await say(page, 'พี่เลี้ยง', 'กล่องยืนยันส่งคะแนน — ส่งแล้วแก้ไม่ได้', 2400);
      await page.click('button:has-text("ยืนยันส่งคะแนน")');
      await expect(page.locator('text="บันทึกแบบประเมิน สหกิจ 15 เรียบร้อยแล้ว"')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'บันทึกสหกิจ 15 แล้ว');

      await page.click('text="สมชาย สายดี"');
      await page.click('button:has-text("สหกิจ 16")');
      await page.getByLabel('หัวข้อรายงาน (ภาษาไทย)').fill('ระบบตรวจสอบย้อนกลับสินค้าในคลัง');
      await page.getByLabel('Report title (English)').fill('Inventory Traceability System');
      await fillEveryScoreWithMax(page);
      await expect(page.locator('text="ให้คะแนนครบทุกข้อแล้ว"')).toBeVisible();
      await page.getByLabel('ข้อคิดเห็นเพิ่มเติม / Other comments').fill('รูปเล่มเรียบร้อยและเนื้อหาสมบูรณ์');
      await say(page, 'พี่เลี้ยง', 'สหกิจ 16 — ประเมินรายงาน 14 ข้อ เต็ม 70 คะแนน', 3000);
      await page.click('button:has-text("ส่งผลประเมิน")');
      await page.click('button:has-text("ยืนยันส่งคะแนน")');
      await expect(page.locator('text="บันทึกแบบประเมิน สหกิจ 16 เรียบร้อยแล้ว"')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'บันทึกสหกิจ 16 แล้ว — พี่เลี้ยงประเมินครบสองใบ');
      await logout(page);

      // ═════════ 15 · อาจารย์ที่ปรึกษา: ตรวจรับรองเล่มรายงาน (สหกิจ 14) ═════════
      await loginAs(page, 'advisor1');
      await goToMenu(page, 'final_evaluation');
      await expect(page.getByRole('heading', { name: 'ตรวจเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14)' })).toBeVisible();
      await page.click('text="สมชาย สายดี"');
      await expect(page.getByTestId('final-report-panel')).toContainText('รายละเอียดการส่งเล่มของนักศึกษา');
      await say(page, 'อาจารย์ที่ปรึกษา', 'ตรวจเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14) — เห็นรายละเอียดการส่งเล่มของนักศึกษา', 3200);
      await page.getByTestId('final-report-approve').click();
      await expect(page.locator('text="อนุมัติเล่มรายงานเรียบร้อยแล้ว"')).toBeVisible();
      await say(page, 'อาจารย์ที่ปรึกษา', 'อนุมัติเล่มรายงานแล้ว');
      await page.click('text="สมชาย สายดี"');
      await expect(page.locator('text="สหกิจ 15: 100/100"')).toBeVisible();
      await expect(page.locator('text="สหกิจ 16: 70/70"')).toBeVisible();
      await say(page, 'อาจารย์ที่ปรึกษา', 'เห็นคะแนนที่พี่เลี้ยงประเมิน — สหกิจ 15: 100/100 · สหกิจ 16: 70/70 (ระบบไม่ตัดเกรดให้ อาจารย์ตัดเองนอกระบบ)', 4200);
      await logout(page);

      // ═════════ 16 · นักศึกษา: เห็นผลประเมิน ═════════
      await loginAs(page, 'student2');
      await goToMenu(page, 'evaluation_result');
      await beat(page, 800);
      await say(page, 'นักศึกษา', 'นักศึกษาเปิดดูผลประเมินของตัวเอง', 3600);
      await logout(page);

      // ═════════ 17 · เจ้าหน้าที่: ภาพรวมความคืบหน้า ═════════
      await loginAs(page, 'staff1');
      await goToMenu(page, 'final_progress');
      await expect(page.locator('h1:has-text("กระดานติดตามสถานะและผลการประเมิน")')).toBeVisible();
      await expect(page.locator('text=640101001')).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'กระดานติดตามสถานะและผลการประเมิน — เห็นนักศึกษาเดินครบทุกขั้นแล้ว', 3800);
      await say(page, 'จบ', 'ครบสายตั้งแต่ยื่นคำร้องจนถึงผลประเมิน — นักศึกษา · เจ้าหน้าที่ · คณบดี · สถานประกอบการ · อาจารย์ที่ปรึกษา · อาจารย์นิเทศ · พี่เลี้ยง', 5000);
    } finally {
      // วิดีโอเขียนไฟล์เมื่อปิดหน้า — ปิดก่อนแล้วค่อยบันทึกซ้ำลงโฟลเดอร์เอกสาร
      const video = page.video();
      await page.close();
      if (video) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        await video.saveAs(OUT_FILE);
      }
    }
  });
});
