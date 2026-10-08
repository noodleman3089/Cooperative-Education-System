import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { dbExec, dbRow, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';

/**
 * ขั้น 2 บนหน้าจอ — แผงรับคำร้องของเจ้าหน้าที่ (แบบ A) · ด่านฝั่ง API อยู่ที่ `officer-review.spec.ts`
 *
 * สิ่งที่ API คุมแทนไม่ได้ และพังเงียบได้:
 *   P1  เอกสารต้องแสดงในแผงเลย และของที่ถอดออก (รหัสภายใน · ข้อความกลไก) ต้องไม่งอกกลับ
 *   P2  การถามทุก 2 วินาทีต้อง **ไม่ล้างสิ่งที่พิมพ์ค้าง** และต้องปิดปุ่มรับเมื่อนักศึกษาเปลี่ยนไฟล์
 *   P3  นักศึกษายกเลิกระหว่างแผงเปิด — เจ้าหน้าที่ต้องรู้ ไม่ใช่กดแล้วเจอข้อความผิดพลาด
 *   P4  รับแล้วหนังสือไม่ออก — ต้องมีปุ่มสร้างใหม่ตรงนั้น ไม่ใช่แถบแดงที่ไม่มีทางไปต่อ
 *   P5  เลขซ้ำ = ถามยืนยัน ไม่บล็อก
 */

const PDF = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const FONT = path.join(BACKEND_ROOT, 'secure_private/fonts/THSarabunNew.ttf');
const FONT_HIDDEN = `${FONT}.e2e-hidden`;
const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const LATE_REASON = 'หัวหน้าสาขาวิชาไปราชการต่างจังหวัด จึงได้ลายมือชื่อช้ากว่ากำหนด';

async function seedIntent(late = false): Promise<number> {
  return (await dbValue<number>(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, submitted_late, late_reason)
     VALUES (${STUDENT2}, (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
             (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'pending_advisor', $1, $2)
     RETURNING form_id`,
    [late, late ? LATE_REASON : null]
  ))!;
}

/** นักศึกษาอัปโหลด/เปลี่ยนกระดาษผ่าน API (cookie jar คนละชุดกับเบราว์เซอร์ของเจ้าหน้าที่) */
async function upload(request: APIRequestContext, formId: number): Promise<string> {
  await apiLoginAs(request, 'student2');
  const res = await request.post(`${API_URL}/intents/${formId}/request-form`, {
    multipart: {
      request_form: { name: 'signed.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF) },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).request_form_path as string;
}

async function openPanel(page: Page, formId: number) {
  await loginAs(page, 'staff1');
  await page.getByTestId(`review-request-${formId}`).click();
  const panel = page.getByRole('dialog').filter({ hasText: `คำร้องที่ ${formId}` });
  await expect(panel.getByTestId('uploaded-request-form-view')).toBeVisible();
  return panel;
}

test.describe('ขั้น 2 — แผงรับคำร้องของเจ้าหน้าที่ (หน้าจอ)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    if (fs.existsSync(FONT_HIDDEN)) fs.renameSync(FONT_HIDDEN, FONT);
    await seedTestData();
  });

  test('P1: เอกสารแสดงในแผงทันที · มีเหตุผลส่งช้าและประวัติตีกลับ · ไม่มีรหัสภายในหรือข้อความที่ถอดออกแล้ว', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent(true);
    await upload(request, formId);
    await apiLoginAs(request, 'staff1');
    expect(
      (
        await request.patch(`${API_URL}/intents/${formId}/officer-reject`, {
          data: { reason: 'ลายเซ็นหัวหน้าสาขาวิชายังไม่ครบ' },
        })
      ).status()
    ).toBe(200);
    const current = await upload(request, formId);

    const panel = await openPanel(page, formId);

    // ไฟล์ที่นักศึกษาส่งฝังอยู่ในแผง ไม่ต้องกดเปิดแท็บใหม่ก่อน — และยังเปิดเต็มจอได้
    await expect(panel.getByTestId('uploaded-request-form-view')).toHaveAttribute(
      'src',
      new RegExp(current.replace(/[.]/g, '\\.'))
    );
    await expect(panel.getByTestId('open-uploaded-request-form')).toHaveAttribute('href', new RegExp(current));
    await expect(panel).toContainText('กระดาษที่นักศึกษาส่งมา');
    await expect(panel).toContainText('อัปโหลดเมื่อ');
    // ⛔ ชื่อไฟล์ดิบของเครื่องแม่ข่ายไม่ใช่ของที่เจ้าหน้าที่ต้องอ่าน
    await expect(panel).not.toContainText('requestform-user-');

    await expect(panel).toContainText('ส่งช่วงผ่อนผัน');
    await expect(panel.getByTestId('request-late-reason')).toHaveText(LATE_REASON);
    await expect(panel.getByTestId('request-late-memo')).toContainText('ยังไม่ได้ยื่น');
    await expect(panel.getByTestId('request-submission-no')).toHaveText('ส่งครั้งที่ 2');
    await expect(panel.getByTestId('request-last-return')).toContainText('ลายเซ็นหัวหน้าสาขาวิชายังไม่ครบ');

    await expect(panel.getByTestId('preview-cover-letter')).toBeVisible();
    await expect(panel).toContainText('แก้เลขได้จนกว่าคณบดีจะลงนาม');

    // ⛔ ของที่เจ้าของสั่งถอด ("รายละเอียดไม่จำเป็นเยอะไป") ต้องไม่งอกกลับ
    for (const gone of ['SEC-', 'ทรานแซกชัน', 'เกรดเฉลี่ยสะสม', 'เริ่มปฏิบัติงาน', 'ย้อนกลับไม่ได้', 'ล้มข้อใดข้อหนึ่ง']) {
      await expect(panel, `"${gone}" ต้องไม่อยู่บนแผง`).not.toContainText(gone);
    }

    // ผลของการกดรับบอกในกล่องยืนยันที่เดียว และไม่อ้างว่าทั้งสามข้ออยู่ในทรานแซกชันเดียว
    await panel.getByTestId('officer-document-no').fill('อว 0656.10/11');
    await panel.getByTestId('officer-approve-open').click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'ยืนยันการรับคำร้องและออกเลขหนังสือ' });
    await expect(confirm).toContainText('รับรองสถานประกอบการ');
    await expect(confirm).toContainText('ส่งเข้าคิวคณบดี');
    await expect(confirm).not.toContainText('ทรานแซกชัน');
    await expect(confirm).not.toContainText('SEC-');
  });

  test('P2: นักศึกษาเปลี่ยนไฟล์ระหว่างแผงเปิด → แถบเตือน ปุ่มรับปิดจนกดดูไฟล์ใหม่ · ของที่พิมพ์ค้างไม่หาย', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    const first = await upload(request, formId);
    const panel = await openPanel(page, formId);

    await panel.getByTestId('officer-document-no').fill('อว 0656.10/22');
    const approve = panel.getByTestId('officer-approve-open');
    await expect(approve).toBeEnabled();

    // ⛔ ถามทุก 2 วินาที — ผ่านไปหลายรอบแล้วเลขที่พิมพ์ต้องยังอยู่ (เคยพลาดกับการโหลดคิวซ้ำ)
    await page.waitForTimeout(5000);
    await expect(panel.getByTestId('officer-document-no')).toHaveValue('อว 0656.10/22');
    await expect(panel.getByTestId('request-file-changed-banner')).toHaveCount(0);

    const second = await upload(request, formId);
    expect(second).not.toBe(first);

    const banner = panel.getByTestId('request-file-changed-banner');
    await expect(banner).toBeVisible({ timeout: 6000 });
    await expect(banner).toContainText('นักศึกษาส่งไฟล์ใหม่');
    await expect(approve).toBeDisabled();
    // ยังแสดงไฟล์เก่าอยู่ จนกว่าเจ้าหน้าที่จะสั่งเปลี่ยนเอง
    await expect(panel.getByTestId('uploaded-request-form-view')).toHaveAttribute('src', new RegExp(first));
    await expect(panel.getByTestId('officer-document-no')).toHaveValue('อว 0656.10/22');

    await panel.getByTestId('show-new-request-file').click();
    await expect(banner).toHaveCount(0);
    await expect(panel.getByTestId('uploaded-request-form-view')).toHaveAttribute('src', new RegExp(second));
    await expect(approve).toBeEnabled();

    await approve.click();
    await page.getByRole('button', { name: 'ออกเลขและรับคำร้อง' }).click();
    await expect(page.getByText(/รับคำร้องของ .* แล้ว เลขที่หนังสือ อว 0656\.10\/22/)).toBeVisible();
    expect(
      await dbRow('SELECT status, officer_document_no FROM intent_forms WHERE form_id = $1', [formId])
    ).toEqual({ status: 'approved_by_dept_head', officer_document_no: 'อว 0656.10/22' });
  });

  test('P3: นักศึกษายกเลิกคำร้องระหว่างแผงเปิด → แถบบอก และปุ่มรับ/ตีกลับปิด', async ({ page, request }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    await upload(request, formId);
    const panel = await openPanel(page, formId);
    await panel.getByTestId('officer-document-no').fill('อว 0656.10/33');

    await apiLoginAs(request, 'student2');
    expect((await request.post(`${API_URL}/intents/${formId}/withdraw`)).status()).toBe(200);

    const banner = panel.getByTestId('request-withdrawn-banner');
    await expect(banner).toBeVisible({ timeout: 6000 });
    await expect(banner).toContainText('ยกเลิกคำร้องนี้แล้ว');
    await expect(panel.getByTestId('officer-approve-open')).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'ตีกลับให้แก้ไข' })).toBeDisabled();

    await banner.getByRole('button', { name: 'ปิดแผง' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('P4: รับแล้วแต่สร้างหนังสือไม่สำเร็จ → แถบแดงพร้อมปุ่มสร้างอีกครั้ง · กดแล้วหนังสือเข้าคิวคณบดี', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    await upload(request, formId);
    const panel = await openPanel(page, formId);
    await panel.getByTestId('officer-document-no').fill('อว 0656.10/44');

    fs.renameSync(FONT, FONT_HIDDEN);
    try {
      await panel.getByTestId('officer-approve-open').click();
      await page.getByRole('button', { name: 'ออกเลขและรับคำร้อง' }).click();

      const failed = panel.getByTestId('cover-letter-failed-banner');
      await expect(failed).toBeVisible();
      await expect(failed).toContainText('รับคำร้องแล้ว แต่ยังไม่มีหนังสือเข้าคิวคณบดี');
      await expect(failed).toContainText('อว 0656.10/44');
      // รับไปแล้ว — ไม่มีช่องเลขหรือปุ่มรับให้กดซ้ำ
      await expect(panel.getByTestId('officer-document-no')).toHaveCount(0);
      await expect(panel.getByTestId('officer-approve-open')).toHaveCount(0);
      expect(await dbValue('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
        'approved_by_dept_head'
      );
      expect(await dbValue("SELECT COUNT(*)::int FROM official_documents WHERE type = 'cover_letter'")).toBe(0);
    } finally {
      fs.renameSync(FONT_HIDDEN, FONT);
    }

    await panel.getByTestId('cover-letter-reissue').click();
    await expect(page.getByText(/สร้างหนังสือขอความอนุเคราะห์ของ .* แล้ว/)).toBeVisible();
    await expect(panel).toHaveCount(0);
    expect(
      await dbRow("SELECT status, document_number FROM official_documents WHERE type = 'cover_letter'")
    ).toEqual({ status: 'pending_sign', document_number: 'อว 0656.10/44' });
  });

  test('P6: หน้าแรกขึ้นแถวแดงของใบที่รับแล้วไม่มีหนังสือ → กดสร้างอีกครั้ง → แถวหาย หนังสือเข้าตาราง', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    const shown = await upload(request, formId);
    await apiLoginAs(request, 'staff1');
    expect(
      (
        await request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
          data: { document_no: 'อว 0656.10/66', request_form_path: shown },
        })
      ).status()
    ).toBe(200);
    // สภาพ "รับแล้วแต่หนังสือไม่ออก" — เหมือนการสร้างหนังสือล้มหลังรับ
    await dbExec(`DELETE FROM official_documents WHERE type = 'cover_letter'`);

    await loginAs(page, 'staff1');
    const row = page.getByTestId(`staff-home-missing-letter-${formId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('รับคำร้องแล้ว แต่ยังไม่มีหนังสือเข้าคิวคณบดี');
    await expect(row).toContainText('อว 0656.10/66');

    await page.getByTestId(`staff-home-reissue-${formId}`).click();
    await expect(page.getByText(/สร้างหนังสือขอความอนุเคราะห์ของ .* แล้ว/)).toBeVisible();
    await expect(page.getByTestId('staff-home-missing-letters')).toHaveCount(0);
    expect(
      await dbRow("SELECT status, document_number FROM official_documents WHERE type = 'cover_letter'")
    ).toEqual({ status: 'pending_sign', document_number: 'อว 0656.10/66' });
  });

  test('P7: แก้เลขที่หนังสือจากตารางหนังสือบนหน้าแรก — ได้จนกว่าคณบดีลงนาม แล้วปุ่มหายไป', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    const shown = await upload(request, formId);
    await apiLoginAs(request, 'staff1');
    expect(
      (
        await request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
          data: { document_no: 'อว 0656.10/ผิด', request_form_path: shown },
        })
      ).status()
    ).toBe(200);
    const docId = (await dbValue<number>("SELECT doc_id FROM official_documents WHERE type = 'cover_letter'"))!;

    await loginAs(page, 'staff1');
    await page.getByTestId(`edit-document-no-${docId}`).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'แก้เลขที่หนังสือออก' });
    await expect(dialog.getByTestId('edit-document-no-input')).toHaveValue('อว 0656.10/ผิด');
    // เลขเดิม = ไม่มีอะไรให้บันทึก
    await expect(dialog.getByTestId('edit-document-no-save')).toBeDisabled();

    await dialog.getByTestId('edit-document-no-input').fill('อว 0656.10/ถูก');
    await dialog.getByTestId('edit-document-no-save').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('แก้เลขที่หนังสือแล้ว')).toBeVisible();
    await expect(page.getByRole('cell', { name: /อว 0656\.10\/ถูก/ })).toBeVisible();
    expect(await dbValue('SELECT officer_document_no FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'อว 0656.10/ถูก'
    );
    expect(await dbValue('SELECT document_number FROM official_documents WHERE doc_id = $1', [docId])).toBe(
      'อว 0656.10/ถูก'
    );

    // คณบดีลงนามแล้ว = ไม่มีปุ่มแก้เลขอีก
    await apiLoginAs(request, 'dean1');
    expect(
      (await request.post(`${API_URL}/documents/batch-sign`, { data: { doc_ids: [docId] } })).status()
    ).toBe(200);
    await page.reload();
    await expect(page.getByRole('cell', { name: /อว 0656\.10\/ถูก/ })).toBeVisible();
    await expect(page.getByTestId(`edit-document-no-${docId}`)).toHaveCount(0);
  });

  test('P5: เลขที่หนังสือซ้ำกับคำร้องใบอื่น → ถามยืนยันพร้อมชื่อ · กลับไปแก้ได้ · ยืนยันแล้วรับได้', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    // คำร้องของนักศึกษาอีกคนที่รับไปแล้วด้วยเลขเดียวกัน
    await dbExec(`INSERT INTO users (email, password_hash) VALUES ('panel-other@test.com', 'x')`);
    await dbExec(
      `INSERT INTO students (student_id, student_code, first_name, last_name, major_id, cumulative_gpa, enrollment_year)
       SELECT user_id, '65909902', 'อีกคน', 'ทดสอบ', (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 3.00, 2569
         FROM users WHERE email = 'panel-other@test.com'`
    );
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, officer_document_no)
       SELECT user_id, (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
              (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'approved_by_dept_head', 'อว 0656.10/55'
         FROM users WHERE email = 'panel-other@test.com'`
    );

    const formId = await seedIntent();
    await upload(request, formId);
    const panel = await openPanel(page, formId);
    await panel.getByTestId('officer-document-no').fill('อว 0656.10/55');
    await panel.getByTestId('officer-approve-open').click();
    await page.getByRole('button', { name: 'ออกเลขและรับคำร้อง' }).click();

    const warn = page.getByRole('dialog').filter({ hasText: 'เลขที่หนังสือนี้ถูกใช้แล้ว' });
    await expect(warn).toContainText('อีกคน ทดสอบ');
    expect(await dbValue('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'pending_officer_request'
    );

    // กลับไปแก้เลข = ยังไม่มีอะไรเกิดขึ้น และเลขที่พิมพ์ยังอยู่ให้แก้
    await warn.getByRole('button', { name: 'กลับไปแก้เลข' }).click();
    await expect(panel.getByTestId('officer-document-no')).toHaveValue('อว 0656.10/55');

    await panel.getByTestId('officer-approve-open').click();
    await page.getByRole('button', { name: 'ออกเลขและรับคำร้อง' }).click();
    await warn.getByTestId('duplicate-no-confirm').click();
    await expect(page.getByText(/รับคำร้องของ .* แล้ว เลขที่หนังสือ อว 0656\.10\/55/)).toBeVisible();
    expect(await dbValue('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'approved_by_dept_head'
    );
  });
});
