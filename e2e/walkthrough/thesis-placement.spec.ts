import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, APP_URL } from '../helpers/env';
import { loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { coverLetterDocId } from '../helpers/intent';
import { dbExec, dbValue } from '../helpers/db';
import { createWalk } from '../helpers/walkthrough';

/**
 * Walkthrough: ภาพบทที่ 4 ที่ต้องมีเอกสาร PDF จริงในหน้าจอ (ช่องตัวอย่างเอกสาร · กระดาษที่ส่งมา · หนังสือในหน้าบริษัท)
 *
 * ทำไมแยกไฟล์: ต้องใช้ Chrome จริง (`channel: 'chrome'`) — Chromium แบบ headless shell ไม่มีตัวอ่าน PDF
 * ช่อง iframe จึงว่างเปล่า · ภาพทุกภาพมาจากแอปที่รันอยู่จริง ไม่มี `setContent` และไม่แปะภาพทับ
 *
 * เดินเส้นเดียวกับ `placement-journey` ด้วยนักศึกษาคนเดียวกัน (student2 สมชาย สายดี + บริษัท ซีเกท) เพื่อให้ข้อมูลในเอกสารตรงกับหน้าเว็บ
 * ภาพลง `เอกสาร/walkthrough/thesis-screens/` (index = `index-placement.html`)
 *
 * ทางลัด (บอกใน caption): กระดาษที่นักศึกษา "ลงนามแล้ว" = แบบคำร้องที่ระบบสร้างให้ (GET /intents/:id/request-form) อัปโหลดกลับเอง
 * · เอกสาร 2 ที่บริษัทแนบ = ไฟล์ที่ระบบสร้างจากปุ่ม "สร้างเอกสาร 2 ที่กรอกแล้ว" · token ลิงก์บริษัทอ่านจากฐาน
 * ⛔ ข้อมูลทั้งหมดเป็นของปลอม · รีเซ็ตฐานเหมือน E2E ทุกครั้งที่รัน
 */

test.use({ channel: 'chrome' });

/** รอให้กรอบเอกสารโผล่ แล้วให้เวลาตัวอ่าน PDF วาดหน้า */
async function settlePdf(page: Page, frame: Locator): Promise<void> {
  await frame.first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(3500);
}

test.describe('walkthrough: ภาพบทที่ 4 ที่มี PDF', () => {
  test('thesis-placement', async ({ page, browser }) => {
    test.setTimeout(600_000);
    const walk = createWalk('thesis-screens', 'ภาพบทที่ 4 — ภาพที่มีเอกสาร PDF จริง', {
      keep: true,
      indexName: 'index-placement.html',
      notes: [
        'ถ่ายด้วย Google Chrome จริง (channel: chrome) เพื่อให้ช่องเอกสาร PDF แสดงเนื้อหา · ทุกภาพมาจากแอปที่รันอยู่จริง',
        'ทางลัด: กระดาษที่ "ลงนามแล้ว" ของนักศึกษา = แบบคำร้องเอกสารหมายเลข 1 ที่ระบบสร้างให้ (GET /intents/:id/request-form) อัปโหลดกลับเอง ไม่มีลายเซ็นปากกาจริง',
        'ทางลัด: เอกสาร 2 ที่บริษัทแนบ = ไฟล์ที่ระบบสร้างจากปุ่ม "สร้างเอกสาร 2 ที่กรอกแล้ว" ไม่มีลายเซ็นและตราจริง',
        'ทางลัด: token ลิงก์ของบริษัทอ่านจากฐาน (ของจริงอยู่ในอีเมลที่ระบบส่ง · MAIL_DRY_RUN=true จึงไม่มีเมลออกจริง)',
        '4.68 ถ่ายเฉพาะส่วนที่เห็นบนจอ (ไม่ใช่ทั้งหน้า) เพราะมีกล่องยืนยันเปิดอยู่',
      ],
    });
    walk.watch(page);

    const failures: string[] = [];
    const shoot = async (
      id: string,
      who: string,
      caption: string,
      prep: () => Promise<void>,
      p: Page = page,
      fullPage = true
    ) => {
      try {
        await prep();
        await walk.step(p, who, caption, { file: `${id}.png`, fullPage });
      } catch (err) {
        failures.push(`${id}: ${(err as Error).message.split('\n')[0]}`);
      }
    };

    // บริษัทไม่มีบัญชี — เปิดลิงก์ในบริบทแยกที่ไม่มี cookie ใดๆ
    const companyCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const companyPage = await companyCtx.newPage();
    walk.watch(companyPage);

    try {
      await page.route('**/maps.googleapis.com/**', (route) => route.abort());
      await companyPage.route('**/maps.googleapis.com/**', (route) => route.abort());
      await seedTestData();
      // SQL เดียวกับ placement-journey — เจ้าหน้าที่ต้องมีโปรไฟล์ แถบบนจึงโชว์ชื่อ
      await dbExec(
        `INSERT INTO personnel (personnel_id, major_id, status, first_name, last_name)
         SELECT user_id, (SELECT major_id FROM master_major LIMIT 1), 'approved', 'สมใจ', 'เจ้าหน้าที่ดี'
           FROM users WHERE email = 'staff1@test.com'
         ON CONFLICT (personnel_id) DO NOTHING`
      );
      await page.request.post(`${API_URL}/auth/logout`);

      // ───────── หน้าเข้าสู่ระบบ: ถ่ายเมื่อปุ่ม Google ของจริงโหลดขึ้น (ต้องต่ออินเทอร์เน็ต) · ไม่ขึ้น = ข้าม ไม่แปะ ─────────
      for (const [id, who, url, caption] of [
        ['4.2', 'นักศึกษา', '/login/student', 'หน้าเข้าสู่ระบบของนักศึกษา — ปุ่ม Google ของจริง'],
        ['4.5', 'บุคลากร', '/login/personnel', 'หน้าเข้าสู่ระบบของบุคลากร — ปุ่ม Google ของจริง'],
      ] as const) {
        await shoot(id, who, caption, async () => {
          await page.goto(url);
          await page.waitForTimeout(6_000); // รอสคริปต์ Google ของจริงวาดปุ่ม (ต้องต่ออินเทอร์เน็ต)
          await page.locator('#googleBtnContainer iframe').first().waitFor({ state: 'attached', timeout: 5_000 });
          await page.waitForTimeout(1500);
        });
      }

      // ───────── นักศึกษา: ฟอร์มว่าง → เลือกบริษัท → ยื่น → อัปโหลดกระดาษ ─────────
      await loginAs(page, 'student2');
      await shoot('4.12', 'นักศึกษา', 'ยื่นคำร้องขอหนังสือ — ฟอร์มว่าง ช่อง "ตัวอย่างเอกสารจริง"', async () => {
        await goToMenu(page, 'jobs');
        await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();
        await settlePdf(page, page.getByTestId('request-preview-frame'));
      });

      await shoot('4.13', 'นักศึกษา', 'เลือกสถานประกอบการจากทำเนียบแล้ว — ตัวอย่างเป็นแบบคำร้องที่มีข้อมูลของนักศึกษา', async () => {
        await page.getByTestId('request-company-search').fill('ซีเกท');
        await page.getByTestId('request-directory-matches').getByRole('button').first().click();
        await expect(page.getByTestId('request-company-locked')).toBeVisible();
        const refresh = page.getByTestId('request-preview-refresh');
        if (await refresh.isVisible().catch(() => false)) await refresh.click();
        await settlePdf(page, page.getByTestId('request-preview-frame'));
      });

      await page.getByTestId('request-submit').click();
      await page.getByTestId('request-confirm').click();
      await expect(page.getByText('ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')).toBeVisible();
      await goToMenu(page, 'dashboard');
      await expect(page.getByTestId('print-request-form')).toBeVisible();

      const formId = (await dbValue<number>(
        `SELECT form_id FROM intent_forms
          WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')
          ORDER BY form_id DESC LIMIT 1`
      )) as number;

      // กระดาษที่ "ลงนามแล้ว" = แบบคำร้องที่ระบบสร้างให้ (ใบเดียวกับที่หน้าเว็บให้พิมพ์)
      const generated = await page.request.get(`${API_URL}/intents/${formId}/request-form`);
      expect(generated.status()).toBe(200);
      const requestPdf = path.join(os.tmpdir(), `thesis-request-form-${process.pid}.pdf`);
      fs.writeFileSync(requestPdf, await generated.body());
      await page.getByTestId('upload-request-form').setInputFiles(requestPdf);
      await page.getByTestId('request-form-confirm').click();
      await expect(page.getByTestId('request-form-uploaded')).toBeVisible();
      await logout(page);

      // ───────── เจ้าหน้าที่: แผงตรวจคำร้อง ─────────
      await loginAs(page, 'staff1');
      await expect(page.getByTestId(`review-request-${formId}`)).toBeVisible();
      await shoot('4.51', 'เจ้าหน้าที่', 'แผงตรวจคำร้อง — ช่อง "กระดาษที่นักศึกษาส่งมา"', async () => {
        await page.getByTestId(`review-request-${formId}`).click();
        await expect(page.getByTestId('officer-document-no')).toBeVisible();
        await settlePdf(page, page.getByTestId('uploaded-request-form-view'));
      });
      await shoot('4.52', 'เจ้าหน้าที่', 'แผงตรวจคำร้องหลังกรอกเลขที่หนังสือ — ช่องเดียวกัน', async () => {
        await page.getByTestId('officer-document-no').fill('อว 0656.10/ตัวอย่าง-001');
        await settlePdf(page, page.getByTestId('uploaded-request-form-view'));
      });

      await page.getByTestId('officer-approve-open').click();
      const approveDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการรับคำร้องและออกเลขหนังสือ' });
      await expect(approveDialog).toBeVisible();
      await approveDialog.getByRole('button', { name: 'รับคำร้องและออกเลข', exact: true }).click();
      await expect(page.getByText(/รับคำร้องของ .* แล้ว เลขที่หนังสือ/)).toBeVisible();
      await logout(page);

      // ───────── คณบดี: ลงนามหนังสือ ─────────
      const docId = await coverLetterDocId();
      await loginAs(page, 'dean1');
      await expect(page.getByTestId(`dean-doc-row-${docId}`)).toBeVisible();
      await page.getByTestId(`dean-doc-row-${docId}`).locator('input[type="checkbox"]').check();
      await page.getByTestId('dean-sign-selected').click();
      const signDialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการลงนามเอกสารราชการ' });
      await expect(signDialog).toBeVisible();
      await signDialog.getByRole('button', { name: /^ลงนาม \d+ ฉบับ/ }).click();
      await expect(page.getByText('ลงนามแบบกลุ่มสำเร็จเรียบร้อยแล้ว')).toBeVisible();
      await logout(page);

      // ───────── นักศึกษา: ส่งหนังสือถึงบริษัททางอีเมล ─────────
      await loginAs(page, 'student2');
      await expect(page.getByTestId('company-mail-box')).toBeVisible();
      await page.getByTestId('company-mail-input').fill('hr-demo@example.com');
      await page.getByTestId('company-mail-send').click();
      await page.getByTestId('company-mail-confirm').click();
      await expect(page.getByTestId('company-mail-status')).toContainText('ส่งถึง hr-demo@example.com');
      await logout(page);

      // ───────── บริษัท: เปิดลิงก์ /accept ─────────
      const token = (await dbValue<string>(
        'SELECT token FROM acceptance_link_tokens WHERE form_id = $1 ORDER BY token_id DESC LIMIT 1',
        [formId]
      )) as string;
      expect(token).toBeTruthy();
      const today = (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;
      const coverFrame = companyPage.locator('iframe[title="หนังสือขอความอนุเคราะห์"]');

      await shoot('4.65', 'บริษัท(ลิงก์)', 'หน้าตอบรับของบริษัท — ยังไม่เลือก เห็นหนังสือขอความอนุเคราะห์', async () => {
        await companyPage.goto(`${APP_URL}/accept?token=${token}`);
        await expect(companyPage.getByTestId('al-student-name')).toBeVisible();
        await settlePdf(companyPage, coverFrame);
      }, companyPage);

      await shoot('4.66', 'บริษัท(ลิงก์)', 'เลือก "รับ" แล้วกดส่งทั้งที่ยังว่าง — ระบบบอกว่าขาดอะไร', async () => {
        await companyPage.getByTestId('al-decision-accept').check();
        await companyPage.getByTestId('al-submit').click();
        await expect(companyPage.getByTestId('al-error')).toBeVisible();
        await settlePdf(companyPage, coverFrame);
      }, companyPage);

      let acceptancePdf = '';
      await shoot('4.67', 'บริษัท(ลิงก์)', 'กรอกข้อมูล สร้างเอกสาร 2 ที่กรอกแล้ว และแนบไฟล์ (ทางลัด: แนบไฟล์ที่ระบบสร้าง ไม่มีลายเซ็นและตราจริง)', async () => {
        await companyPage.getByTestId('al-coordinator_name').fill('คุณสมใจ ฝ่ายบุคคล');
        await companyPage.getByTestId('al-coordinator_position').fill('เจ้าหน้าที่ฝ่ายทรัพยากรบุคคล');
        await companyPage.getByTestId('al-office_phone').fill('044123456');
        await companyPage.getByTestId('al-mobile_phone').fill('0891234567');
        await companyPage.getByTestId('al-email').fill('hr-demo@example.com');
        await companyPage.getByTestId('al-signer-name').fill('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
        await companyPage.getByTestId('al-signer-position').fill('ผู้จัดการฝ่ายบุคคล');
        await companyPage.getByTestId('al-signed-date').fill(today);
        const generated2 = companyPage.waitForResponse(
          (r) => r.url().includes('/public/acceptance/acceptance-form') && r.request().method() === 'POST'
        );
        await companyPage.getByTestId('al-generate').click();
        const res = await generated2;
        expect(res.status()).toBe(200);
        acceptancePdf = path.join(os.tmpdir(), `thesis-acceptance-form-${process.pid}.pdf`);
        fs.writeFileSync(acceptancePdf, await res.body());
        await companyPage.getByTestId('al-evidence').setInputFiles(acceptancePdf);
        await settlePdf(companyPage, companyPage.locator('iframe[title="แบบตอบรับ (เอกสาร 2)"]'));
        // หน้าเลื่อนลงมาตอนกด "สร้างเอกสาร" — กลับขึ้นบนสุดก่อนถ่าย ไม่งั้นแถบหัวสีน้ำเงินไปโผล่กลางภาพ
        await companyPage.evaluate(() => window.scrollTo(0, 0));
      }, companyPage);

      await shoot('4.68', 'บริษัท(ลิงก์)', 'กดส่ง — กล่องยืนยันการตอบรับ (ถ่ายเฉพาะส่วนที่เห็นบนจอ)', async () => {
        await companyPage.getByTestId('al-submit').click();
        await expect(companyPage.getByRole('dialog')).toBeVisible();
      }, companyPage, false);

      await companyPage.getByTestId('al-confirm').click();
      await expect(companyPage.getByTestId('al-done')).toBeVisible();

      // ───────── เจ้าหน้าที่: ตรวจแบบตอบรับ (เอกสารหมายเลข 2) ─────────
      await loginAs(page, 'staff1');
      await expect(page.getByTestId(`review-acceptance-${formId}`)).toBeVisible();
      await shoot('4.56', 'เจ้าหน้าที่', 'ตรวจแบบตอบรับ — ช่องเอกสารหมายเลข 2 ที่บริษัทแนบมา', async () => {
        await page.getByTestId(`review-acceptance-${formId}`).click();
        await expect(page.getByTestId('acceptance-source-link')).toBeVisible();
        await settlePdf(page, page.locator('iframe').last());
        // ตรวจว่าไฟล์ในกรอบคือไฟล์ที่บริษัทแนบจริง (ขนาดเท่าไฟล์ที่ส่ง) — ไม่ใช่ฟอร์มเปล่า
        const src = await page.locator('iframe[title="แบบตอบรับ"]').getAttribute('src');
        const body = await (await page.request.get(String(src).split('#')[0])).body();
        expect(body.length, "ไฟล์ในกรอบต้องเป็นไฟล์ที่บริษัทแนบ").toBe(fs.statSync(acceptancePdf).size);
      });
    } finally {
      await walk.finish();
      await companyCtx.close();
    }
    expect(failures, `ภาพที่ถ่ายไม่สำเร็จ:\n${failures.join('\n')}`).toEqual([]);
  });
});
