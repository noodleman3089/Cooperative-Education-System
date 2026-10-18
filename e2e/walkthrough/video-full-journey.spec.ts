import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { APP_URL } from '../helpers/env';
import { loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { coverLetterDocId, placementCard, setCoopStart, statusBoardRow } from '../helpers/intent';
import { dbExec, dbValue } from '../helpers/db';

/**
 * วิดีโอ: ขั้นตอนสหกิจศึกษา **ตามคู่มือคณะ** ตั้งแต่ยื่นเอกสารหมายเลข 1 จนผลประเมิน (ทุกฝ่ายทำงานผ่านหน้าเว็บจริง)
 *
 * อ้างอิง: `เอกสาร/manual_full_notes.md` — "ขั้นตอนสหกิจศึกษา 6 ขั้น" (หน้า 3) · "สรุปขั้นตอนนักศึกษา 13 ข้อ" (หน้า 48)
 * · "ขั้นตอนอาจารย์นิเทศ ขออนุมัติเดินทางไปราชการ" (หน้า 50) · "การจัดกลุ่มอาจารย์ผู้นิเทศ" (หน้า 26) · นิเทศ 2 ครั้ง (หน้า 3)
 * แถบคำบรรยายขึ้นเลข "[คู่มือ N]" กำกับทุกขั้น และบอกตรง ๆ ว่าขั้นไหนคู่มือทำนอกระบบ (Google Forms · E-manage · ระบบทะเบียน)
 *
 * ไม่ใช่เทสต์ในชุดเต็ม — รันด้วย `npm.cmd run test:video` (`playwright.video.config.ts`)
 * ผลลัพธ์: `เอกสาร/walkthrough/full-journey-video/สหกิจ-ตามคู่มือคณะ.webm` (gitignore ทั้งโฟลเดอร์ `เอกสาร/`)
 *
 * ทางลัดที่บอกไว้บนจอ:
 *   · ไฟล์ PDF/รูปจำลองแทนกระดาษที่ลงนามจริง
 *   · token ลิงก์ของบริษัท/พี่เลี้ยงอ่านหรือเซ็นเอง — ของจริงอยู่ในอีเมลที่ระบบส่ง (MAIL_DRY_RUN จึงไม่มีเมลออกจริง)
 *   · วันเริ่มปฏิบัติงานตั้งเป็น "วันนี้" ในปฏิทินสหกิจ เพื่อให้ระบุพี่เลี้ยงได้ในคลิปเดียว
 * ⛔ ข้อมูลทั้งหมดเป็นของปลอม · รีเซ็ตฐานเหมือน E2E ห้ามรันซ้อนกับ E2E
 */

const OUT_DIR = path.resolve(__dirname, '../../เอกสาร/walkthrough/full-journey-video');
const OUT_FILE = path.join(OUT_DIR, 'สหกิจ-ตามคู่มือคณะ.webm');
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

/** บอกผู้ชมว่าตอนนี้ใครทำอะไร แล้วหยุดให้อ่าน (ยิ่งข้อความยาวยิ่งหยุดนาน) */
async function say(page: Page, role: string, text: string, holdMs?: number): Promise<void> {
  await page.evaluate(
    ([r, t]) => sessionStorage.setItem('__narration', JSON.stringify({ role: r, text: t })),
    [role, text]
  );
  await page.waitForTimeout(holdMs ?? Math.min(6500, 1800 + text.length * 38));
}

/** พิมพ์ทีละตัวอักษรให้ผู้ชมเห็นว่ากำลังกรอกอะไร (ช่องสั้น ๆ เท่านั้น) */
async function typeIn(field: Locator, value: string): Promise<void> {
  await field.click();
  await field.fill('');
  await field.pressSequentially(value, { delay: 45 });
}

/** หยุดสั้น ๆ หลังการกระทำสำคัญ ให้เห็นผลบนจอ */
const beat = (page: Page, ms = 1200) => page.waitForTimeout(ms);

/** โทเคนแบบเดียวกับที่ลิงก์ในอีเมลนัดนิเทศใช้ (วิธีเดียวกับ `faculty/supervision-appointment-edit`) */
function mentorToken(appointmentId: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    appointment_id: appointmentId,
    role: 'mentor_response',
    iat: now,
    exp: now + 7 * 24 * 3600,
  })}`;
  return `${body}.${crypto.createHmac('sha256', process.env.JWT_SECRET as string).update(body).digest('base64url')}`;
}

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

const dayFromToday = (n: number): Promise<string> =>
  dbValue<string>(`SELECT ((NOW() AT TIME ZONE 'Asia/Bangkok')::date + ${n})::text`).then((v) => v as string);

test.describe('video: สหกิจศึกษาตามคู่มือคณะ', () => {
  test.beforeAll(async () => {
    // เตรียมฐานก่อนเปิดเบราว์เซอร์ — ต้นวิดีโอจะได้ไม่มีช่วงจอขาว
    await seedTestData();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
    await setCoopStart(today);
    await dbExec(
      `UPDATE students
          SET emergency_contact_name = NULL, emergency_relationship = NULL, emergency_phone = NULL,
              resume_file = NULL,
              advisor_id = (SELECT user_id FROM users WHERE email = 'advisor1@test.com'),
              supervisor_id = NULL
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
    test.setTimeout(60 * 60_000);
    await installNarration(page);
    await page.route('**/maps.googleapis.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );

    try {
      const today = (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;
      const studentId = (await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'")) as number;

      // ═════════ ก่อนเริ่ม: เรซูเม่ (ระบบบังคับก่อนยื่นคำร้อง) ═════════
      await page.goto('/login/student');
      await say(page, 'เริ่มต้น', 'ขั้นตอนสหกิจศึกษาตามคู่มือคณะ — ตั้งแต่ยื่นเอกสารหมายเลข 1 จนผลประเมิน (ข้อมูลทั้งหมดเป็นของปลอม)', 4500);
      await say(page, 'เริ่มต้น', 'คู่มือใช้ Google Forms · E-manage · กระดาษ ส่วนระบบนี้ทำแทนในที่เดียว — ขั้นที่คู่มือทำนอกระบบจะบอกบนจอ', 5500);

      await loginAs(page, 'student2');
      await expect(placementCard(page)).toBeVisible();
      await say(page, 'นักศึกษา', 'นักศึกษาเข้าระบบด้วยบัญชีของตัวเอง');
      await goToMenu(page, 'profile');
      await expect(page.getByTestId('profile-resume-box')).toBeVisible();
      await say(page, 'นักศึกษา', 'ระบบบังคับมีเรซูเม่ก่อนยื่นคำร้อง — สถานประกอบการ อาจารย์ที่ปรึกษา และอาจารย์นิเทศจะเห็นไฟล์นี้');
      await page.getByTestId('profile-resume-input').setInputFiles(PDF);
      await page.waitForLoadState('networkidle');
      await page.getByTestId('profile-save').click();
      await expect(page.getByText('บันทึกข้อมูลส่วนตัวและเรซูเม่เรียบร้อยแล้ว')).toBeVisible();
      await say(page, 'นักศึกษา', 'อัปโหลดเรซูเม่แล้ว (ทางลัด: ใช้ไฟล์ PDF จำลอง)');

      // ═════════ คู่มือ 1 · นักศึกษายื่นเอกสารหมายเลข 1 (แทน Google Forms) ═════════
      await goToMenu(page, 'jobs');
      await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();
      await say(page, 'นักศึกษา', '[คู่มือ 1] ยื่นแบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1) — ในคู่มือส่งผ่าน Google Forms ที่นี่กรอกในระบบ', 5500);
      await typeIn(page.getByTestId('request-company-search'), 'ซีเกท');
      await page.getByTestId('request-directory-matches').getByRole('button').first().click();
      await expect(page.getByTestId('request-company-locked')).toBeVisible();
      await say(page, 'นักศึกษา', 'เลือกสถานประกอบการจากทำเนียบของคณะ — ระบบเติมที่อยู่ ผู้รับหนังสือ และตัวอย่างแบบคำร้องให้', 4500);
      await page.getByTestId('request-submit').click();
      await expect(page.getByRole('dialog').filter({ hasText: 'ยืนยันยื่นคำร้อง' })).toBeVisible();
      await say(page, 'นักศึกษา', 'กล่องยืนยัน — แสดงชื่อและที่อยู่ที่จะถูกพิมพ์ลงหนังสือ ยื่นแล้วแก้เองไม่ได้', 4200);
      await page.getByTestId('request-confirm').click();
      await expect(page.getByText('ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')).toBeVisible();
      await say(page, 'นักศึกษา', 'ยื่นคำร้องเรียบร้อย');

      await goToMenu(page, 'dashboard');
      await expect(page.getByTestId('print-request-form')).toBeVisible();
      await say(page, 'นักศึกษา', '[คู่มือ 2] พิมพ์แบบคำร้องไปให้อาจารย์ที่ปรึกษาและหัวหน้าสาขาลงนามบนกระดาษ (คู่มือ: เอกสารต้องผ่านลายเซ็นก่อนส่ง)', 5500);
      await page.getByTestId('upload-request-form').setInputFiles(PDF);
      await page.getByTestId('request-form-confirm').click();
      await expect(page.getByTestId('request-form-uploaded')).toBeVisible();
      await say(page, 'นักศึกษา', 'อัปโหลดแบบคำร้องที่ลงนามแล้วเป็น PDF (ทางลัด: ใช้ไฟล์ PDF จำลองแทนกระดาษจริง)', 4200);
      await logout(page);

      // ═════════ คู่มือ 2 · อาจารย์ที่ปรึกษา · หัวหน้าสาขา (ลงนามบนกระดาษ ระบบใช้ติดตาม) ═════════
      await loginAs(page, 'advisor1');
      await expect(await statusBoardRow(page, studentId)).toContainText('640101001');
      await say(page, 'อาจารย์ที่ปรึกษา', 'อาจารย์ที่ปรึกษาลงนามบนกระดาษ — ในระบบเห็นบอร์ด "ตรวจสอบสถานะนักศึกษา" ติดตามว่านักศึกษาอยู่ขั้นไหน', 5500);
      await logout(page);

      await loginAs(page, 'head1');
      const headRow = await statusBoardRow(page, studentId);
      await expect(headRow.getByRole('button', { name: 'ดูคำร้อง' })).toBeVisible();
      await say(page, 'หัวหน้าสาขา', 'หัวหน้าสาขาลงนามบนกระดาษเช่นกัน — ระบบแสดงสถานะนักศึกษาของสาขา ปุ่ม "ดูคำร้อง" เปิดรายละเอียด', 5000);
      await logout(page);

      // ═════════ คู่มือ 2–3 · เจ้าหน้าที่รับคำร้อง ออกหนังสือทาบทาม ═════════
      await loginAs(page, 'staff1');
      const formId = (await dbValue<number>(
        `SELECT form_id FROM intent_forms WHERE student_id = ${studentId} ORDER BY form_id DESC LIMIT 1`
      )) as number;
      await expect(page.getByTestId(`review-request-${formId}`)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', '[คู่มือ 2-3] เจ้าหน้าที่งานสหกิจรับเอกสารหมายเลข 1 — คู่มือรับทาง Google Forms / E-manage ที่นี่เข้าคิวคำร้องรอตรวจ', 5500);
      await page.getByTestId(`review-request-${formId}`).click();
      await expect(page.getByTestId('officer-document-no')).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'เปิดแผงตรวจคำร้อง — ดูกระดาษที่นักศึกษาอัปโหลด ตรวจกับข้อมูลสถานประกอบการ', 4500);
      await typeIn(page.getByTestId('officer-document-no'), 'อว 0656.10/ตัวอย่าง-001');
      await say(page, 'เจ้าหน้าที่สหกิจ', 'กรอกเลขที่หนังสือออก');
      await page.getByTestId('officer-approve-open').click();
      const approveDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการรับคำร้องและออกเลขหนังสือ' });
      await expect(approveDialog).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'กล่องยืนยัน — รับรองสถานประกอบการและออกหนังสือขอความอนุเคราะห์ (หนังสือทาบทาม) เข้าคิวคณบดีในคราวเดียว', 5500);
      await approveDialog.getByRole('button', { name: 'รับคำร้องและออกเลข', exact: true }).click();
      await expect(page.getByText(/รับคำร้องของ .* แล้ว เลขที่หนังสือ/)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'รับคำร้องแล้ว — หนังสือทาบทามพร้อมให้คณบดีลงนาม');
      await logout(page);

      // ═════════ คณบดีลงนามหนังสือทาบทาม ═════════
      const coverDocId = await coverLetterDocId();
      await loginAs(page, 'dean1');
      await expect(page.getByTestId(`dean-doc-row-${coverDocId}`)).toBeVisible();
      await say(page, 'คณบดี', 'คณบดีเห็นหนังสือขอความอนุเคราะห์รอลงนามในคิว');
      await page.getByTestId(`dean-doc-row-${coverDocId}`).locator('input[type="checkbox"]').check();
      await page.getByTestId('dean-sign-selected').click();
      const signDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการลงนามเอกสารราชการ' });
      await expect(signDialog).toBeVisible();
      await say(page, 'คณบดี', 'กล่องยืนยันการลงนามด้วยลายมือชื่อดิจิทัล — ยกเลิกจากหน้านี้ไม่ได้', 4200);
      await signDialog.getByRole('button', { name: /^ลงนาม \d+ ฉบับ/ }).click();
      await expect(page.getByText('ลงนามเรียบร้อยแล้ว — นักศึกษาได้รับหนังสือและเห็นในระบบทันที')).toBeVisible();
      await say(page, 'คณบดี', 'ลงนามแล้ว — คู่มือส่งหนังสือกลับทาง E-mail ที่นี่นักศึกษาเห็นในระบบทันที', 4500);
      await logout(page);

      // ═════════ คู่มือ 4 · นักศึกษานำหนังสือไปส่งสถานประกอบการ ═════════
      await loginAs(page, 'student2');
      await expect(page.getByTestId('company-mail-box')).toBeVisible();
      await say(page, 'นักศึกษา', '[คู่มือ 4] นักศึกษารับหนังสือทาบทามและนำส่งสถานประกอบการ — ในระบบกดส่งหนังสือถึงอีเมลฝ่ายบุคคลได้เลย', 5500);
      await typeIn(page.getByTestId('company-mail-input'), 'hr-demo@example.com');
      await page.getByTestId('company-mail-send').click();
      await expect(page.getByRole('dialog')).toContainText('hr-demo@example.com');
      await say(page, 'นักศึกษา', 'กล่องยืนยันก่อนส่งหนังสือถึงบริษัท');
      await page.getByTestId('company-mail-confirm').click();
      await expect(page.getByTestId('company-mail-status')).toContainText('ส่งถึง hr-demo@example.com');
      await say(page, 'นักศึกษา', 'ส่งหนังสือถึงบริษัทแล้ว (ระบบไม่ส่งอีเมลจริงตอนอัดคลิป)');
      await logout(page);

      // ═════════ คู่มือ 5-6 · สถานประกอบการตอบรับ (เอกสารหมายเลข 2) ═════════
      const token = (await dbValue<string>(
        'SELECT token FROM acceptance_link_tokens WHERE form_id = $1 ORDER BY token_id DESC LIMIT 1',
        [formId]
      )) as string;
      expect(token).toBeTruthy();
      await page.goto(`${APP_URL}/accept?token=${token}`);
      await expect(page.getByTestId('al-student-name')).toBeVisible();
      await say(page, 'สถานประกอบการ', '[คู่มือ 5-6] สถานประกอบการเซ็นแบบตอบรับ (เอกสารหมายเลข 2) — ที่นี่เปิดลิงก์ในอีเมล ไม่ต้องมีบัญชี (ทางลัด: อ่าน token จากฐาน)', 6000);
      await page.getByTestId('al-decision-accept').check();
      await typeIn(page.getByTestId('al-signer-name'), 'คุณสมชาย ผู้จัดการฝ่ายบุคคล');
      await typeIn(page.getByTestId('al-signer-position'), 'ผู้จัดการฝ่ายบุคคล');
      await page.getByTestId('al-signed-date').fill(today);
      await page.getByTestId('al-evidence').setInputFiles(PDF);
      await say(page, 'สถานประกอบการ', 'เลือก "รับ" กรอกผู้ลงนาม วันที่ และแนบแบบตอบรับที่ลงนามแล้ว (ทางลัด: ไฟล์ PDF จำลอง)', 4800);
      await page.getByTestId('al-submit').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await say(page, 'สถานประกอบการ', 'กล่องยืนยันการตอบรับ — คู่มือให้ตอบภายใน 15 วันทำการ');
      await page.getByTestId('al-confirm').click();
      await expect(page.getByTestId('al-done')).toBeVisible();
      await say(page, 'สถานประกอบการ', 'ตอบรับเรียบร้อย — ลิงก์ใช้ได้ครั้งเดียว');

      await loginAs(page, 'staff1');
      await expect(page.getByTestId(`review-acceptance-${formId}`)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', '[คู่มือ 6] คู่มือให้ส่งแบบตอบรับผ่าน Google Forms — ที่นี่เจ้าหน้าที่เห็นในคิวแบบตอบรับ');
      await page.getByTestId(`review-acceptance-${formId}`).click();
      await expect(page.getByTestId('acceptance-source-link')).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'ตรวจแบบตอบรับ — เห็นว่าบริษัทตอบผ่านลิงก์และไฟล์ที่แนบมา', 4500);
      await page.getByTestId('acceptance-approve-submit').click();
      await expect(page.getByTestId('acceptance-approve-confirm')).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'กล่องยืนยันรับแบบตอบรับ — นักศึกษา บริษัท วันเริ่มงาน', 4200);
      await page.getByTestId('acceptance-approve-confirm').click();
      await expect(page.getByText(/รับแบบตอบรับเรียบร้อยแล้ว/)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'รับแบบตอบรับแล้ว — นักศึกษาได้ที่ฝึกงาน');
      await logout(page);

      // ═════════ คู่มือ 7-8 · นักศึกษาส่งสหกิจ 03 และ 06 ═════════
      await loginAs(page, 'student2');
      await expect(placementCard(page).getByText('สถานประกอบการตอบรับแล้ว', { exact: false })).toBeVisible();
      await say(page, 'นักศึกษา', 'ได้ที่ฝึกงานแล้ว — การ์ด "ที่ฝึกงานของคุณ" แสดงสถานประกอบการที่ตอบรับ');
      await goToMenu(page, 'job_application');
      await expect(page.getByTestId('ca-first-en')).toBeVisible();
      await say(page, 'นักศึกษา', '[คู่มือ 7-8] นักศึกษากรอกสหกิจ 03 ใบสมัครงาน — คู่มือให้พิมพ์ส่งที่อาคาร 8 ที่นี่กรอกในระบบ', 5500);
      await typeIn(page.getByTestId('ca-first-en'), 'Somchai');
      await typeIn(page.getByTestId('ca-last-en'), 'Saidee');
      await page.getByTestId('ca-gender').selectOption('ชาย');
      await typeIn(page.getByTestId('ca-nationality'), 'ไทย');
      await typeIn(page.getByTestId('ca-mobile'), '0812345678');
      await say(page, 'นักศึกษา', 'ข้อมูลส่วนตัว — ชื่อภาษาอังกฤษ เพศ สัญชาติ เบอร์โทร', 3200);
      await typeIn(page.getByTestId('ca-national-id'), '1234567890123');
      await typeIn(page.getByTestId('ca-id-district'), 'เมืองนครราชสีมา');
      await page.getByTestId('ca-id-expiry').fill('2032-05-15');
      await say(page, 'นักศึกษา', 'เลขบัตรประชาชนเก็บแบบเข้ารหัส และลบอัตโนมัติ 90 วันหลังประเมินครบ — ไม่มีใครเห็นค่าจริงนอกจากผู้ตรวจที่มีสิทธิ์ (ลงบันทึกทุกครั้ง)', 6000);
      await typeIn(page.getByTestId('ca-emg-name'), 'นางสมศรี สายดี');
      await page.getByTestId('ca-emg-relation').selectOption('มารดา');
      await typeIn(page.getByTestId('ca-emg-phone'), '0898765432');
      await page.getByTestId('ca-education-add').click();
      await typeIn(page.getByTestId('ca-education-0-institution'), 'โรงเรียนนครราชสีมาวิทยา');
      await typeIn(page.getByTestId('ca-education-0-degree'), 'มัธยมศึกษาตอนปลาย');
      await page.getByTestId('ca-language-add').click();
      await typeIn(page.getByTestId('ca-language-0-language'), 'อังกฤษ');
      await page.getByTestId('ca-training-none').check();
      await page.getByTestId('ca-activity-none').check();
      await say(page, 'นักศึกษา', 'ตารางประวัติ — มีแถวก็กรอก ไม่มีข้อมูลให้ติ๊ก "ไม่มี" (ระบบบังคับทั้งสี่หมวด) · ช่องเชื้อชาติ/ศาสนาไม่บังคับ', 5500);
      await page.getByTestId('ca-submit').click();
      await expect(page.getByText(/บันทึก.*(สำเร็จ|เรียบร้อย)/).first()).toBeVisible({ timeout: 15_000 });
      await say(page, 'นักศึกษา', 'บันทึกสหกิจ 03 แล้ว — ช่องบังคับครบ');

      await goToMenu(page, 'accommodation_plan');
      await expect(page.getByRole('heading', { name: /แจ้งรายละเอียดที่พัก/ })).toBeVisible();
      await page.getByTestId('acc-province').selectOption('ชลบุรี');
      await page.getByTestId('acc-district').selectOption('ศรีราชา');
      await page.getByTestId('acc-subdistrict').selectOption('บางพระ');
      await typeIn(page.getByTestId('acc-house-no'), '199/8');
      await typeIn(page.getByTestId('acc-building'), 'หอพักบ้านสวน');
      await typeIn(page.getByTestId('acc-room-no'), '502');
      await typeIn(page.getByTestId('acc-mobile'), '0891234567');
      await say(page, 'นักศึกษา', 'สหกิจ 06 แจ้งที่พักระหว่างปฏิบัติงาน — อาจารย์นิเทศใช้ดูที่พักและแผนที่ก่อนเดินทางไปนิเทศ (สหกิจ 13 และ 15 ระบบทำในระบบ ไม่ต้องส่งกระดาษ)', 7000);
      await page.getByTestId('acc-save').click();
      await expect(page.getByText('บันทึกข้อมูลที่พัก (สหกิจ 06) เรียบร้อยแล้ว')).toBeVisible();
      await say(page, 'นักศึกษา', 'บันทึกสหกิจ 06 แล้ว');
      await logout(page);

      // ═════════ คู่มือ 9 · หนังสือส่งตัว ═════════
      await loginAs(page, 'staff1');
      await expect(page.getByTestId(`issue-dispatch-${formId}`)).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', '[คู่มือ 9] นักศึกษาส่งสหกิจ 03 และ 06 ครบ — คิว "หนังสือส่งตัวรอออก" ขึ้นรายชื่อนักศึกษา (ระบบไม่ออกหนังสือถ้าเอกสารยังไม่ครบ)', 6000);
      await page.getByTestId(`issue-dispatch-${formId}`).click();
      const dispatchDialog = page.getByRole('dialog').filter({ has: page.getByTestId('dispatch-document-no') });
      await expect(dispatchDialog).toBeVisible();
      await typeIn(dispatchDialog.getByTestId('dispatch-document-no'), 'อว 0656.10/ส่งตัว-001');
      const endDate = dispatchDialog.getByTestId('dispatch-end-date');
      if (!(await endDate.inputValue())) await endDate.fill(await dayFromToday(112));
      await say(page, 'เจ้าหน้าที่สหกิจ', 'ออกหนังสือส่งตัว — กรอกเลขที่หนังสือ วันเริ่มและวันสิ้นสุดการปฏิบัติงาน (ครบ 16 สัปดาห์)', 5000);
      await dispatchDialog.getByTestId('dispatch-submit').click();
      await page.getByTestId('dispatch-confirm').click();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'ออกหนังสือส่งตัวแล้ว — เข้าคิวคณบดีลงนามอีกใบ');
      await logout(page);

      const dispatchDocId = (await dbValue<number>(
        "SELECT doc_id FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1"
      )) as number;
      await loginAs(page, 'dean1');
      await expect(page.getByTestId(`dean-doc-row-${dispatchDocId}`)).toBeVisible();
      await say(page, 'คณบดี', 'คณบดีลงนามหนังสือส่งตัวนักศึกษา');
      await page.getByTestId(`dean-doc-row-${dispatchDocId}`).locator('input[type="checkbox"]').check();
      await page.getByTestId('dean-sign-selected').click();
      await expect(signDialog).toBeVisible();
      await signDialog.getByRole('button', { name: /^ลงนาม \d+ ฉบับ/ }).click();
      await expect(page.getByText('ลงนามเรียบร้อยแล้ว — นักศึกษาได้รับหนังสือและเห็นในระบบทันที')).toBeVisible();
      await say(page, 'คณบดี', 'ลงนามหนังสือส่งตัวแล้ว');
      await logout(page);

      await loginAs(page, 'student2');
      await expect(page.getByTestId('student-doc-send_letter')).toContainText('คณบดีเซ็นอนุมัติแล้ว');
      await page.getByTestId('student-doc-send_letter').scrollIntoViewIfNeeded();
      await say(page, 'นักศึกษา', 'นักศึกษาดาวน์โหลดหนังสือส่งตัวจากระบบ แล้วนำส่งสถานประกอบการ (คู่มือรับทาง E-mail)', 5000);
      await logout(page);

      // ═════════ คู่มือ 10 · หัวหน้าสาขาจัดกลุ่มอาจารย์นิเทศ ═════════
      await loginAs(page, 'head1');
      await goToMenu(page, 'assignment');
      await expect(page.getByTestId(`assign-row-${studentId}`)).toBeVisible();
      await say(page, 'หัวหน้าสาขา', '[คู่มือ 10] หัวหน้าสาขาจัดกลุ่มอาจารย์ผู้นิเทศ — คู่มือส่งแบบฟอร์มจัดกลุ่มให้เจ้าหน้าที่ ที่นี่กำหนดในระบบ นักศึกษารายนี้ยังไม่มีอาจารย์นิเทศ', 6500);
      await page.getByTestId(`assign-row-${studentId}`).getByRole('button', { name: 'แก้รายคน' }).click();
      const assignDialog = page.getByRole('dialog').filter({ hasText: 'อาจารย์นิเทศ' });
      await expect(assignDialog).toBeVisible();
      const supervisorSelect = assignDialog.locator('select').nth(1);
      const supervisorOptions = await supervisorSelect.locator('option').allTextContents();
      const advisorFirst = (await dbValue<string>(
        "SELECT p.first_name FROM personnel p JOIN users u ON u.user_id = p.personnel_id WHERE u.email = 'advisor1@test.com'"
      )) as string;
      const supervisorIndex = supervisorOptions.findIndex((t) => t.includes(advisorFirst));
      expect(supervisorIndex).toBeGreaterThan(0);
      await supervisorSelect.selectOption({ index: supervisorIndex });
      await say(page, 'หัวหน้าสาขา', 'เลือกอาจารย์นิเทศ — ระบบแสดงภาระงานของอาจารย์แต่ละคน (ที่ปรึกษา · นิเทศ) ให้ตัดสินใจ', 5000);
      await assignDialog.getByRole('button', { name: 'บันทึกการจัดสรร' }).click();
      await expect(page.getByTestId(`assign-row-${studentId}`).getByText('ยังไม่กำหนด')).toHaveCount(0);
      await say(page, 'หัวหน้าสาขา', 'จัดสรรแล้ว — อาจารย์นิเทศจะเห็นเมนูฝ่ายนิเทศหลังเข้าระบบใหม่ นักศึกษารู้กลุ่มนิเทศผ่านอาจารย์ที่ปรึกษา', 5500);
      await logout(page);

      // ═════════ คู่มือ 11-12 · ระบบทะเบียนและลงทะเบียนเรียน (นอกระบบ) ═════════
      await loginAs(page, 'student2');
      await expect(page.getByTestId('registry-reminder')).toBeVisible();
      await page.getByTestId('registry-reminder').scrollIntoViewIfNeeded();
      await say(page, 'นักศึกษา', '[คู่มือ 11-12] ลงข้อมูลสถานประกอบการในระบบทะเบียน แล้วลงทะเบียนเรียนตามกลุ่มอาจารย์นิเทศ — ทำนอกระบบนี้ ระบบแค่เตือนและมีลิงก์ไประบบทะเบียน', 7000);

      // ═════════ คู่มือ 13 · เริ่มฝึก — ระบุพี่เลี้ยง ═════════
      await goToMenu(page, 'my_mentor');
      await expect(page.getByTestId('mentor-card')).toHaveAttribute('data-state', 'none');
      await say(page, 'นักศึกษา', '[คู่มือ 13] เริ่มฝึกสหกิจศึกษา — ถึงวันเริ่มฝึกแล้วนักศึกษาระบุพี่เลี้ยง (เมนูนี้ล็อกจนกว่าจะถึงวันเริ่มฝึก)', 5500);
      await typeIn(page.getByTestId('mentor-name'), 'นายสุรเดช ใจดี');
      await typeIn(page.getByTestId('mentor-email'), 'mentor1@test.com');
      await typeIn(page.getByTestId('mentor-phone'), '0812223333');
      await typeIn(page.getByTestId('mentor-position'), 'หัวหน้าแผนกพัฒนาซอฟต์แวร์');
      await typeIn(page.getByTestId('mentor-department'), 'ฝ่ายวิจัยและพัฒนา');
      await page.getByTestId('mentor-submit').click();
      await expect(page.getByTestId('mentor-card')).toHaveAttribute('data-state', 'unconfirmed');
      await say(page, 'นักศึกษา', 'บันทึกพี่เลี้ยงแล้ว — รออาจารย์นิเทศยืนยันก่อนระบบเปิดบัญชีให้พี่เลี้ยง', 4500);
      await logout(page);

      await loginAs(page, 'advisor1');
      await page.goto('/dashboard?role=supervisor&menu=mentor_followup');
      const mentorId = (await dbValue<number>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId])) as number;
      await expect(page.getByTestId(`mf-inactive-${mentorId}`)).toHaveText('รอยืนยัน');
      await say(page, 'อาจารย์นิเทศ', 'อาจารย์นิเทศเห็นพี่เลี้ยงที่นักศึกษาระบุ ป้าย "รอยืนยัน" — ยืนยันได้เฉพาะอาจารย์นิเทศของนักศึกษาคนนั้น', 5000);
      await page.getByTestId(`mf-confirm-${mentorId}`).click();
      await expect(page.getByTestId('mf-confirm-submit')).toBeVisible();
      await page.getByTestId('mf-confirm-submit').click();
      await expect(page.getByTestId(`mf-inactive-${mentorId}`)).toHaveCount(0);
      await say(page, 'อาจารย์นิเทศ', 'ยืนยันแล้ว — บัญชีพี่เลี้ยงเปิด ระบบส่งลิงก์เข้าระบบไปที่อีเมลพี่เลี้ยง', 4500);
      await logout(page);

      // ═════════ ระหว่างฝึก · นักศึกษาบันทึกการปฏิบัติงาน (สหกิจ 09) และโครงร่าง (สหกิจ 11) ═════════
      await loginAs(page, 'student2');
      await goToMenu(page, 'weekly_log');
      await expect(page.getByRole('heading', { name: 'บันทึกการปฏิบัติงาน', exact: true })).toBeVisible();
      await say(page, 'นักศึกษา', 'ระหว่างฝึก — บันทึกประจำวัน/สัปดาห์/เดือน (สหกิจ 08-10) ขึ้นกับอาจารย์นิเทศว่าจะให้ทำแบบไหน ตัวอย่างนี้ใช้รายสัปดาห์', 6000);
      await typeIn(page.getByTestId('weekly-assigned-work'), 'ศึกษาระบบคลังสินค้าและพัฒนา REST API');
      await typeIn(page.getByTestId('weekly-methods'), 'ออกแบบ PostgreSQL schema และเขียน Node.js');
      await typeIn(page.getByTestId('weekly-tools'), 'React, Node.js, PostgreSQL');
      await typeIn(page.getByTestId('weekly-achievements'), 'ส่งมอบ API คลังสินค้าชุดแรกพร้อม Unit Test');
      await page.getByTestId('worklog-submit').click();
      await expect(page.getByText('ส่งบันทึกการปฏิบัติงานรายสัปดาห์เรียบร้อยแล้ว')).toBeVisible();
      await say(page, 'นักศึกษา', 'ส่งบันทึกสัปดาห์ที่ 1 แล้ว — รอพี่เลี้ยงรับรอง');

      await goToMenu(page, 'report_outline');
      await expect(page.getByRole('heading', { name: 'โครงร่างรายงาน (สหกิจ 11)' })).toBeVisible();
      await typeIn(page.getByTestId('outline-title'), 'การพัฒนาระบบตรวจสอบย้อนกลับสินค้าในคลังสินค้า');
      await page
        .getByTestId('outline-text')
        .fill('บทที่ 1 บทนำและที่มา\nบทที่ 2 ทฤษฎีและเทคโนโลยี\nบทที่ 3 การออกแบบและพัฒนาระบบ\nบทที่ 4 ผลการทดลอง');
      await page.getByTestId('outline-file-input').setInputFiles({
        name: 'outline-final.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock Outline PDF Content'),
      });
      await say(page, 'นักศึกษา', 'โครงร่างรายงาน (สหกิจ 11) — กรอกหัวข้อ เนื้อหา และแนบไฟล์ (ทางลัด: ไฟล์ PDF จำลอง)', 4500);
      await page.getByTestId('outline-submit').click();
      await expect(page.getByTestId('confirm-summary')).toBeVisible();
      await page.getByTestId('outline-confirm').click();
      await expect(page.getByRole('heading', { name: 'ประวัติการส่งและผลตรวจ (1 เวอร์ชัน)' })).toBeVisible();
      await say(page, 'นักศึกษา', 'ส่งโครงร่างแล้ว — ถึงพี่เลี้ยงตรวจเป็นลำดับแรก');
      await logout(page);

      // ═════════ พี่เลี้ยง: รับรองบันทึก + ตรวจโครงร่าง ═════════
      await loginAs(page, 'mentor1');
      await goToMenu(page, 'certify');
      await expect(page.getByTestId('certify-tab-logs')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'พี่เลี้ยงเข้าระบบด้วยลิงก์ที่ได้รับ (ไม่มีรหัสผ่าน) — หน้ารับรองบันทึกของนักศึกษา', 4800);
      await page.locator('[data-testid^="certify-list-item-"]').first().click();
      await say(page, 'พี่เลี้ยง', 'เปิดอ่านบันทึกสัปดาห์ที่นักศึกษาส่ง ก่อนรับรอง', 4000);
      await page.getByTestId('certify-approve').click();
      const certifyDialog = page.getByRole('dialog');
      if (await certifyDialog.isVisible().catch(() => false)) {
        await beat(page, 1500);
        await certifyDialog.getByRole('button', { name: /ยืนยัน|รับรอง/ }).last().click();
      }
      await beat(page, 1800);
      await say(page, 'พี่เลี้ยง', 'รับรองบันทึกแล้ว — พี่เลี้ยงเป็นผู้ดูแลการปฏิบัติงานของนักศึกษา ลงนามรับรองแทนลายเซ็นบนกระดาษ', 5500);

      await goToMenu(page, 'report_outlines');
      await expect(page.locator('text="รอพี่เลี้ยงตรวจ"')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'เมนูโครงร่างรายงาน — มีโครงร่างรอตรวจ');
      await page.click('button:has-text("ตรวจอนุมัติ")');
      await expect(page.locator('text="พิจารณาโครงร่างรายงาน (สหกิจ 11)"')).toBeVisible();
      await page.locator('textarea').fill('เนื้อหาโครงร่างสมบูรณ์ พี่เลี้ยงเห็นชอบตามนี้');
      await say(page, 'พี่เลี้ยง', 'อ่านโครงร่างและเขียนความเห็น', 3500);
      await page.click('button:has-text("อนุมัติและส่งต่ออาจารย์นิเทศ")');
      await expect(page.getByText('ส่งต่อแล้วท่านจะดึงกลับเองไม่ได้')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'กล่องยืนยัน — ส่งต่อแล้วดึงกลับเองไม่ได้');
      await page.getByTestId('outline-mentor-approve-confirm').click();
      await expect(page.locator('text="พี่เลี้ยงอนุมัติแล้ว (รอ อ.นิเทศ)"')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'พี่เลี้ยงเห็นชอบ — ส่งต่ออาจารย์นิเทศ');
      await logout(page);

      // ═════════ อาจารย์นิเทศ: เห็นชอบโครงร่าง ═════════
      await loginAs(page, 'advisor1');
      await page.getByTestId('role-btn-supervisor').click();
      await goToMenu(page, 'report_outlines');
      await expect(page.getByTestId('outline-review-panel')).toBeVisible();
      await say(page, 'อาจารย์นิเทศ', 'ฝ่ายนิเทศ — โครงร่างที่พี่เลี้ยงเห็นชอบแล้วมาถึง อ่านแล้วให้ความเห็น');
      await typeIn(page.getByTestId('outline-review-comment'), 'อาจารย์นิเทศพิจารณาแล้วอนุมัติโครงร่างรายงาน');
      await page.getByTestId('outline-approve').click();
      await expect(page.getByText('เห็นชอบโครงร่างรายงานของ')).toBeVisible();
      await say(page, 'อาจารย์นิเทศ', 'เห็นชอบโครงร่างรายงานแล้ว');
      await logout(page);

      // ═════════ คู่มือ 5 (หน้า 3) · นิเทศ 2 ครั้ง — ร่างนัด → เจ้าหน้าที่ส่ง → พี่เลี้ยงยืนยัน → บันทึก สหกิจ 13 ═════════
      const runVisit = async (visit: 1 | 2, dateOffset: number): Promise<void> => {
        const visitDate = await dayFromToday(dateOffset);

        await loginAs(page, 'advisor1');
        await page.getByTestId('role-btn-supervisor').click();
        await goToMenu(page, 'supervision');
        await expect(page.getByTestId(`supervision-card-${studentId}`)).toBeVisible();
        await say(
          page,
          'อาจารย์นิเทศ',
          visit === 1
            ? '[คู่มือ หน้า 3 · ขั้นที่ 5] อาจารย์ออกนิเทศ 2 ครั้ง — เริ่มจากร่างวันนัดนิเทศ (สหกิจ 12) ถึงสถานประกอบการ'
            : 'นิเทศครั้งที่ 2 — ร่างนัดครั้งที่ 2 (ระบบไม่ให้ร่างครั้งที่ 2 จนกว่าครั้งแรกจะตกลงกันแล้ว)',
          5200
        );
        await page.getByTestId(`supervision-draft-open-${studentId}`).first().click();
        await page.getByTestId('supervision-draft-date').fill(visitDate);
        await page.getByTestId('supervision-draft-student-time').fill('09:30');
        await page.getByTestId('supervision-draft-mentor-time').fill('10:30');
        await page.getByTestId('supervision-draft-tour').check();
        await say(page, 'อาจารย์นิเทศ', 'เลือกวัน เวลาที่นัดนักศึกษา เวลาที่นัดพี่เลี้ยง และขอเดินชมสถานที่ปฏิบัติงาน', 4500);
        await page.getByTestId('supervision-draft-submit').click();
        await beat(page, 1800);
        const appointmentId = (await dbValue<number>(
          `SELECT appointment_id FROM supervision_appointments WHERE student_id = ${studentId} ORDER BY appointment_id DESC LIMIT 1`
        )) as number;
        await say(page, 'อาจารย์นิเทศ', 'บันทึกร่างนัดแล้ว — ร่างยังไม่ถึงบริษัท ต้องรอเจ้าหน้าที่ตรวจแล้วสั่งส่ง', 4200);
        await logout(page);

        await loginAs(page, 'staff1');
        await goToMenu(page, 'appointments');
        const row = page.getByTestId(`appointment-row-${appointmentId}`);
        await expect(row).toBeVisible();
        await say(page, 'เจ้าหน้าที่สหกิจ', 'เมนูนัดหมายนิเทศ (สหกิจ 12) — เจ้าหน้าที่ตรวจร่างที่อาจารย์ส่งมา', 4200);
        await row.getByRole('button', { name: 'ตรวจแล้ว ส่งเลย' }).click();
        const sendDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการส่งอีเมลนัดหมายนิเทศ' });
        await expect(sendDialog).toBeVisible();
        await say(page, 'เจ้าหน้าที่สหกิจ', 'กล่องยืนยันก่อนส่งอีเมลนัดหมายถึงพี่เลี้ยง', 3800);
        await sendDialog.getByRole('button', { name: 'ตรวจแล้ว ส่งเลย' }).click();
        await beat(page, 1800);
        await say(page, 'เจ้าหน้าที่สหกิจ', 'ส่งนัดหมายถึงพี่เลี้ยงแล้ว (ระบบไม่ส่งอีเมลจริงตอนอัดคลิป)', 3800);
        await logout(page);

        await page.goto(`${APP_URL}/appointment-response?token=${mentorToken(appointmentId)}`);
        await expect(page.getByRole('button', { name: 'ยืนยันการนัดหมายตามกำหนดการ' })).toBeVisible();
        await say(page, 'พี่เลี้ยง', 'พี่เลี้ยงเปิดลิงก์นัดหมายในอีเมล (ทางลัด: เซ็นโทเคนเองแทนเปิดจากอีเมล) — เห็นวันเวลาที่อาจารย์เสนอ ยืนยันหรือขอเลื่อนได้', 6000);
        await page.getByRole('button', { name: 'ยืนยันการนัดหมายตามกำหนดการ' }).click();
        await expect(page.getByText('ยืนยันการนัดหมายเรียบร้อยแล้ว')).toBeVisible();
        await say(page, 'พี่เลี้ยง', 'ยืนยันนัดเรียบร้อย');

        await loginAs(page, 'advisor1');
        await page.getByTestId('role-btn-supervisor').click();
        await goToMenu(page, 'supervision');
        await expect(page.getByTestId(`supervision-card-${studentId}`)).toBeVisible();
        if (visit === 1) {
          await say(
            page,
            'อาจารย์นิเทศ',
            '[คู่มือ หน้า 50] นัดตกลงแล้ว — อาจารย์ทำเอกสารขออนุมัติเดินทางไปราชการ เจ้าหน้าที่เสนอคณบดี (ผ่าน E-manage นอกระบบ) ระบบมีปุ่มพิมพ์บันทึกข้อความขออนุมัติเดินทางให้',
            7500
          );
        }

        await goToMenu(page, 'supervision_record');
        await page.getByTestId('sv-student').selectOption(String(studentId));
        await expect(page.getByTestId('sv-item')).toHaveCount(37);
        if (visit === 2) await page.getByTestId('sv-visit').selectOption('2');
        // วันที่บันทึกการนิเทศห้ามเป็นอนาคต — ในเรื่องราว "ไปนิเทศมาแล้ว" จึงลงวันนี้ (วันนัดในร่างเป็นอนาคตได้)
        await page.getByTestId('sv-date').fill(today);
        await say(
          page,
          'อาจารย์นิเทศ',
          `บันทึกการนิเทศครั้งที่ ${visit} (สหกิจ 13) — ประเมินสถานประกอบการและนักศึกษารวม 37 ข้อจากกระดาษจริง`,
          5200
        );
        // กดปุ่มคะแนนที่ผู้ใช้เห็นจริง (ไม่ใช้ select ที่ซ่อนไว้ให้เทสต์) — ส่วนที่ 2 พับอยู่ ต้องกางก่อนถึงข้อของนักศึกษา
        const items = page.getByTestId('sv-item');
        const itemCount = await items.count();
        let part2Opened = false;
        for (let i = 0; i < itemCount; i++) {
          if (!part2Opened && !(await items.nth(i).isVisible())) {
            await page.getByRole('button', { name: /ส่วนที่ 2 — ประเมินนักศึกษา/ }).click();
            part2Opened = true;
            await say(page, 'อาจารย์นิเทศ', 'ส่วนที่ 2 — ประเมินนักศึกษา', 2200);
          }
          await items.nth(i).getByRole('button', { name: i % 7 === 6 ? '4' : '5', exact: true }).click();
        }
        await page.getByTestId('sv-doc-doc_accommodation').check();
        await typeIn(page.getByTestId('sv-notes'), visit === 1 ? 'นักศึกษาปรับตัวได้ดี งานตรงกับสาขา' : 'ผลงานคืบหน้าตามแผน พร้อมเขียนรายงาน');
        await say(page, 'อาจารย์นิเทศ', 'ให้คะแนนทุกข้อ เลือกเอกสารที่ให้นักศึกษาส่ง และเขียนข้อสังเกตเพิ่มเติม', 4500);
        await page.getByTestId('sv-submit').click();
        await expect(page.getByText(new RegExp(`บันทึกการนิเทศครั้งที่ ${visit} เรียบร้อยแล้ว`))).toBeVisible();
        await say(page, 'อาจารย์นิเทศ', `บันทึกการนิเทศครั้งที่ ${visit} แล้ว`);
        await logout(page);
      };

      await runVisit(1, 30);
      await runVisit(2, 75);

      // ═════════ คู่มือ 6 (หน้า 3) · วันสิ้นสุดการปฏิบัติงาน — รายงานฉบับสมบูรณ์และประเมินผล ═════════
      await loginAs(page, 'student2');
      await goToMenu(page, 'final_report');
      await expect(page.getByRole('heading', { name: 'รายงานฉบับสมบูรณ์', exact: true })).toBeVisible();
      await say(page, 'นักศึกษา', '[คู่มือ หน้า 3 · ขั้นที่ 6] วันสิ้นสุดการปฏิบัติงาน — นักศึกษาส่งรายงานฉบับสมบูรณ์', 5000);
      await page.getByTestId('finalreport-step1-upload').setInputFiles({
        name: 'final_report_draft.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock Final Report Draft Content'),
      });
      await page.getByTestId('finalreport-upload-confirm').click();
      await expect(page.getByTestId('finalreport-step1-status')).toContainText('รอพี่เลี้ยงตรวจ');
      await say(page, 'นักศึกษา', 'ขั้นที่ 1 — ส่งร่างให้พี่เลี้ยงตรวจ (ทางลัด: ไฟล์ PDF จำลอง)');
      await page.getByTestId('finalreport-upload').setInputFiles({
        name: 'final_report_complete.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 Mock Final Complete Report Content'),
      });
      await page.getByTestId('finalreport-upload-confirm').click();
      await expect(page.getByTestId('finalreport-version-1')).toBeVisible();
      await say(page, 'นักศึกษา', 'ขั้นที่ 2 — ส่งเล่มฉบับสมบูรณ์ให้อาจารย์ตรวจ');
      await logout(page);

      await loginAs(page, 'mentor1');
      await goToMenu(page, 'final_evaluation');
      await expect(page.getByRole('heading', { name: 'รายชื่อประเมินผลนักศึกษาสหกิจศึกษา' })).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'พี่เลี้ยงประเมินนักศึกษา — สหกิจ 15 (ประเมินการปฏิบัติงาน 18 ข้อ เต็ม 100) และสหกิจ 16 (ประเมินรายงาน 14 ข้อ เต็ม 70)', 6000);
      await page.click('text="สมชาย สายดี"');
      await expect(page.locator('text="ผู้รับประเมิน: สมชาย สายดี"')).toBeVisible();
      await fillEveryScoreWithMax(page);
      await expect(page.locator('text="ให้คะแนนครบทุกข้อแล้ว"')).toBeVisible();
      await typeIn(page.getByLabel('จุดเด่นของนักศึกษา / Strength'), 'มีความรับผิดชอบสูง ตรงต่อเวลา');
      await typeIn(page.getByLabel('ข้อควรปรับปรุงของนักศึกษา / Improvement'), 'เพิ่มการสื่อสารในทีมให้มากขึ้น');
      await page.getByLabel('ข้อคิดเห็นเพิ่มเติม / Other comments').fill('ปฏิบัติงานได้ดีเยี่ยม');
      await page.getByRole('radio', { name: 'รับ / Yes' }).check();
      await say(page, 'พี่เลี้ยง', 'สหกิจ 15 — ให้คะแนนครบทุกข้อ จุดเด่น ข้อควรปรับปรุง และตอบว่าจะรับเข้าทำงานหรือไม่', 5500);
      await page.click('button:has-text("ส่งผลประเมิน")');
      await say(page, 'พี่เลี้ยง', 'กล่องยืนยันส่งคะแนน — ส่งแล้วแก้ไม่ได้ (ใช้ตัดเกรด)', 3800);
      await page.click('button:has-text("ยืนยันส่งคะแนน")');
      await expect(page.locator('text="บันทึกแบบประเมิน สหกิจ 15 เรียบร้อยแล้ว"')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'บันทึกสหกิจ 15 แล้ว');
      await page.click('text="สมชาย สายดี"');
      await page.click('button:has-text("สหกิจ 16")');
      await typeIn(page.getByLabel('หัวข้อรายงาน (ภาษาไทย)'), 'ระบบตรวจสอบย้อนกลับสินค้าในคลัง');
      await typeIn(page.getByLabel('Report title (English)'), 'Inventory Traceability System');
      await fillEveryScoreWithMax(page);
      await expect(page.locator('text="ให้คะแนนครบทุกข้อแล้ว"')).toBeVisible();
      await page.getByLabel('ข้อคิดเห็นเพิ่มเติม / Other comments').fill('รูปเล่มเรียบร้อยและเนื้อหาสมบูรณ์');
      await say(page, 'พี่เลี้ยง', 'สหกิจ 16 — ประเมินรายงานของนักศึกษา', 4000);
      await page.click('button:has-text("ส่งผลประเมิน")');
      await page.click('button:has-text("ยืนยันส่งคะแนน")');
      await expect(page.locator('text="บันทึกแบบประเมิน สหกิจ 16 เรียบร้อยแล้ว"')).toBeVisible();
      await say(page, 'พี่เลี้ยง', 'บันทึกสหกิจ 16 แล้ว — พี่เลี้ยงประเมินครบสองใบ');
      await logout(page);

      await loginAs(page, 'advisor1');
      await goToMenu(page, 'final_evaluation');
      await expect(page.getByRole('heading', { name: 'ตรวจเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14)' })).toBeVisible();
      await page.click('text="สมชาย สายดี"');
      await expect(page.getByTestId('final-report-panel')).toContainText('รายละเอียดการส่งเล่มของนักศึกษา');
      await say(page, 'อาจารย์ที่ปรึกษา', 'อาจารย์ที่ปรึกษาตรวจรับเล่มรายงานฉบับสมบูรณ์ (สหกิจ 14)', 4500);
      await page.getByTestId('final-report-approve').click();
      await expect(page.locator('text="อนุมัติเล่มรายงานเรียบร้อยแล้ว"')).toBeVisible();
      await say(page, 'อาจารย์ที่ปรึกษา', 'อนุมัติเล่มรายงานแล้ว');
      await page.click('text="สมชาย สายดี"');
      await expect(page.locator('text="สหกิจ 15: 100/100"')).toBeVisible();
      await expect(page.locator('text="สหกิจ 16: 70/70"')).toBeVisible();
      await say(page, 'อาจารย์ที่ปรึกษา', 'เห็นคะแนนที่พี่เลี้ยงประเมิน — สหกิจ 15: 100/100 · สหกิจ 16: 70/70 (ระบบไม่ตัดเกรดให้ อาจารย์นิเทศตัดเองนอกระบบ)', 6500);
      await logout(page);

      await loginAs(page, 'student2');
      await goToMenu(page, 'evaluation_result');
      await beat(page, 800);
      await say(page, 'นักศึกษา', 'นักศึกษาเปิดดูผลประเมินของตัวเอง', 4500);
      await logout(page);

      await loginAs(page, 'staff1');
      await goToMenu(page, 'final_progress');
      await expect(page.locator('h1:has-text("กระดานติดตามสถานะและผลการประเมิน")')).toBeVisible();
      await expect(page.locator('text=640101001')).toBeVisible();
      await say(page, 'เจ้าหน้าที่สหกิจ', 'เจ้าหน้าที่ดูกระดานติดตามสถานะและผลการประเมิน — นักศึกษาเดินครบทุกขั้นแล้ว', 5000);
      await say(
        page,
        'จบ',
        'ครบตามคู่มือคณะ — นักศึกษา · เจ้าหน้าที่ · คณบดี · สถานประกอบการ · อาจารย์ที่ปรึกษา · หัวหน้าสาขา · อาจารย์นิเทศ · พี่เลี้ยง',
        6000
      );
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
