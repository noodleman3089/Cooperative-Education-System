import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { dbExec, dbRow, dbValue, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { officerApprove } from '../helpers/intent';

/**
 * กติกาของการอัปโหลดแบบคำร้องที่ลงนาม (เอกสารหมายเลข 1) ที่เจ้าของเคาะ 2026-10-06
 *
 *   U1 ชื่อผู้ลงนามที่นักศึกษาระบุชนะชื่อที่ระบบรู้ (ผู้รักษาการแทน · ที่ปรึกษาเพิ่งเปลี่ยน) และเจ้าหน้าที่เห็นว่าไม่ตรง
 *   U2 เปลี่ยนไฟล์ได้ระหว่างรอเจ้าหน้าที่ตรวจ
 *   U3 **กำหนดส่งนับที่วันอัปโหลดครั้งแรก** — เดิมนับที่วันกดยื่น ยื่นทันแล้วอัปโหลดช้าเท่าไหร่ก็ได้
 *   U4 หน้าจอของ U1/U2
 *   U5 พิมพ์ชื่อสถานประกอบการซ้ำกับทำเนียบ → ถามก่อนว่าจะใช้ข้อมูลของทำเนียบไหม
 *
 * สิ่งที่พังเงียบได้: ด่านปฏิทินไปปิดใส่คนที่ **ถูกตีกลับ/เปลี่ยนไฟล์** หลังกำหนด (ไม่ใช่ความล่าช้าของนักศึกษา)
 * และคำขอนอกช่วงต้องไม่ทิ้งไฟล์ไว้บนดิสก์ (ด่านต้องอยู่ก่อน multer)
 */

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const PDF = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const UPLOAD_DIR = path.join(BACKEND_ROOT, 'uploads/request_forms');
const LATE_REASON = 'อาจารย์ที่ปรึกษาไปราชการต่างจังหวัด จึงได้ลายมือชื่อช้ากว่ากำหนด';

const today = () =>
  dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`) as Promise<string>;
const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
/** ตั้ง/แทนที่ช่วง "ยื่นคำร้อง" ของภาคที่เปิดอยู่ */
async function setSubmissionWindow(start: string, end: string, lateEnd: string | null = null) {
  await dbExec(`DELETE FROM coop_calendar_events WHERE activity_key = 'intent_submission'`);
  await dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, start_date, end_date, late_end_date, created_by)
     SELECT s.semester_id, 'intent_submission', $1, $2, $3, u.user_id
       FROM coop_semesters s CROSS JOIN users u
      WHERE s.is_active = TRUE AND u.email = 'staff1@test.com' LIMIT 1`,
    [start, end, lateEnd]
  );
}

/** ใบของ student2 ถึงบริษัทในทำเนียบ — ผ่านทรานแซกชันจริงเพื่อให้มีเหตุการณ์ `form_created` */
async function seedIntent(submittedLate = false): Promise<number> {
  return withDb(async (db) => {
    const formId = (
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, submitted_late, late_reason)
         VALUES (${STUDENT2}, (SELECT company_id FROM companies WHERE is_verified = TRUE ORDER BY company_id LIMIT 1),
                 (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'pending_advisor', $1, $2)
         RETURNING form_id`,
        [submittedLate, submittedLate ? 'เหตุผลตอนยื่นซึ่งยาวพอตามเกณฑ์ขั้นต่ำ' : null]
      )
    ).rows[0].form_id as number;
    return formId;
  });
}

const upload = (request: APIRequestContext, formId: number, fields: Record<string, string> = {}) =>
  request.post(`${API_URL}/intents/${formId}/request-form`, {
    multipart: {
      request_form: { name: 'signed.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF) },
      ...fields,
    },
  });

const row = (formId: number) =>
  dbRow<{
    status: string; request_form_path: string | null; advisor_signer_name: string | null;
    dept_head_signer_name: string | null; submitted_late: boolean; late_reason: string | null;
  }>(
    `SELECT status, request_form_path, advisor_signer_name, dept_head_signer_name, submitted_late, late_reason
       FROM intent_forms WHERE form_id = $1`,
    [formId]
  );
const filesOnDisk = () => (fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).length : 0);

test.describe('กติกาอัปโหลดแบบคำร้องที่ลงนาม', () => {
  test('U1: นักศึกษาระบุชื่อผู้ลงนามเอง → บันทึกชื่อที่ระบุ · เจ้าหน้าที่ได้ชื่อที่ระบบรู้ไว้เทียบ', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();

    await apiLoginAs(request, 'student2');
    // รายชื่อช่วยค้นมีแต่ชื่อ ไม่มีอีเมล/เบอร์
    const dash = await (await request.get(`${API_URL}/students/dashboard`)).json();
    const signers = dash.activeIntent.request_signers;
    expect(signers.dept_head_name).toBeTruthy();
    expect(Array.isArray(signers.candidates)).toBe(true);
    expect(signers.candidates.length).toBeGreaterThan(0);
    for (const name of signers.candidates) expect(typeof name).toBe('string');
    expect(JSON.stringify(signers)).not.toContain('@');

    const res = await upload(request, formId, { dept_head_signer_name: 'ผศ.รักษาการ แทนหัวหน้า' });
    expect(res.status(), await res.text()).toBe(200);
    const saved = await row(formId);
    expect(saved!.dept_head_signer_name).toBe('ผศ.รักษาการ แทนหัวหน้า');
    // ช่องที่ไม่ได้ระบุยังเป็นชื่อที่ระบบรู้
    expect(saved!.advisor_signer_name).toBe(signers.advisor_name);

    // ⛔ การระบุชื่อผู้ลงนามต้องไม่ไปเปลี่ยนที่ปรึกษาของนักศึกษา (งานของหัวหน้าสาขา)
    expect(
      await dbValue<number | null>(`SELECT advisor_id FROM students WHERE student_id = ${STUDENT2}`)
    ).not.toBeNull();

    await apiLoginAs(request, 'staff1');
    const list = await (await request.get(`${API_URL}/intents`)).json();
    const mine = list.find((i: { form_id: number }) => i.form_id === formId);
    expect(mine.dept_head_signer_name).toBe('ผศ.รักษาการ แทนหัวหน้า');
    expect(mine.system_dept_head_name).toBe(signers.dept_head_name);
    expect(mine.system_advisor_name).toBe(signers.advisor_name);
  });

  test('U2: เปลี่ยนไฟล์ระหว่างรอเจ้าหน้าที่ → ไฟล์ใหม่แทนไฟล์เดิม · ชื่อผู้ลงนามที่ระบุไว้ไม่หาย · เจ้าหน้าที่รับแล้วเปลี่ยนไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const formId = await seedIntent();
    await apiLoginAs(request, 'student2');

    expect((await upload(request, formId, { advisor_signer_name: 'อ.ที่ปรึกษา คนใหม่' })).status()).toBe(200);
    const first = (await row(formId))!;
    const firstFile = path.join(BACKEND_ROOT, 'uploads', first.request_form_path!);
    expect(fs.existsSync(firstFile)).toBe(true);

    // เปลี่ยนไฟล์ — ไม่ส่งชื่อมา (หน้าจอไม่ถามซ้ำ)
    const again = await upload(request, formId);
    expect(again.status(), await again.text()).toBe(200);
    const second = (await row(formId))!;
    expect(second.status).toBe('pending_officer_request');
    expect(second.request_form_path).not.toBe(first.request_form_path);
    expect(second.advisor_signer_name).toBe('อ.ที่ปรึกษา คนใหม่');
    await expect.poll(() => fs.existsSync(firstFile), { timeout: 5000 }).toBe(false);

    await apiLoginAs(request, 'staff1');
    expect((await officerApprove(request, formId, { document_no: 'อว 0000/9' })).status()).toBe(200);
    await apiLoginAs(request, 'student2');
    const afterApprove = await upload(request, formId);
    expect(afterApprove.status()).toBe(400);
    // ข้อความต้องเป็นคำไทย ไม่ใช่ชื่อสถานะดิบ
    const message = (await afterApprove.json()).message as string;
    expect(message).toContain('เจ้าหน้าที่รับคำร้องแล้ว');
    expect((await row(formId))!.request_form_path).toBe(second.request_form_path);
  });

  test('U3: กำหนดส่งนับที่วันอัปโหลดครั้งแรก — หมดช่วง 403 ไม่มีไฟล์ค้าง · ช่วงผ่อนผันต้องมีเหตุผล · ตีกลับ/เปลี่ยนไฟล์ไม่ถูกปิด', async ({ request }) => {
    test.setTimeout(180_000);
    await seedTestData();
    const t = await today();
    await apiLoginAs(request, 'student2');

    // (ก) หมดช่วงแล้ว ไม่มีวันผ่อนผัน — ยื่นไว้ทันแต่ยังไม่อัปโหลด → 403 และไม่มีไฟล์ถูกเขียน
    const closedForm = await seedIntent();
    await setSubmissionWindow(shift(t, -30), shift(t, -1));
    const filesBefore = filesOnDisk();
    const closed = await upload(request, closedForm);
    expect(closed.status()).toBe(403);
    expect((await closed.json()).message).toContain('หมดช่วง');
    expect(filesOnDisk()).toBe(filesBefore);
    expect((await row(closedForm))!.status).toBe('pending_advisor');

    // (ข) ช่วงผ่อนผัน — ไม่มีเหตุผล 400 (ไฟล์ที่ multer เขียนต้องถูกลบ) · มีเหตุผล → รับ + ปั๊มธงส่งช้า
    await setSubmissionWindow(shift(t, -30), shift(t, -1), shift(t, 5));
    const noReason = await upload(request, closedForm);
    expect(noReason.status()).toBe(400);
    expect((await noReason.json()).message).toContain('นับเป็นการส่งช้า');
    await expect.poll(() => filesOnDisk(), { timeout: 5000 }).toBe(filesBefore);
    expect((await row(closedForm))!.request_form_path).toBeNull();

    const withReason = await upload(request, closedForm, { late_reason: LATE_REASON });
    expect(withReason.status(), await withReason.text()).toBe(200);
    expect(await row(closedForm)).toMatchObject({
      status: 'pending_officer_request',
      submitted_late: true,
      late_reason: LATE_REASON,
    });

    // (ค) เจ้าหน้าที่ตีกลับ แล้วช่วงปิดสนิท — ส่งใหม่ต้องยังได้ (ครั้งแรกส่งไปแล้ว การตีกลับไม่ใช่ความล่าช้าของนักศึกษา)
    await apiLoginAs(request, 'staff1');
    expect(
      (await request.patch(`${API_URL}/intents/${closedForm}/officer-reject`, { data: { reason: 'ไฟล์ที่แนบอ่านไม่ออก' } })).status()
    ).toBe(200);
    await setSubmissionWindow(shift(t, -30), shift(t, -10), shift(t, -5));
    await apiLoginAs(request, 'student2');
    const reupload = await upload(request, closedForm);
    expect(reupload.status(), await reupload.text()).toBe(200);
    // เปลี่ยนไฟล์ระหว่างรอ ตอนช่วงปิดแล้ว ก็ต้องได้
    expect((await upload(request, closedForm)).status()).toBe(200);
    // เหตุผลส่งช้าเดิมต้องไม่ถูกล้าง
    expect((await row(closedForm))!.late_reason).toBe(LATE_REASON);

    // (ง) ใบที่ติดธงส่งช้าตั้งแต่ตอนยื่น — อัปโหลดในช่วงผ่อนผันไม่ต้องให้เหตุผลซ้ำ และเหตุผลเดิมคงอยู่
    await dbExec(`DELETE FROM intent_forms WHERE form_id = $1`, [closedForm]);
    const lateForm = await seedIntent(true);
    await setSubmissionWindow(shift(t, -30), shift(t, -1), shift(t, 5));
    expect((await upload(request, lateForm)).status()).toBe(200);
    expect((await row(lateForm))!.late_reason).toBe('เหตุผลตอนยื่นซึ่งยาวพอตามเกณฑ์ขั้นต่ำ');

    // (จ) ยังอยู่ในช่วงปกติ — ไม่ติดธง
    await dbExec(`DELETE FROM intent_forms WHERE form_id = $1`, [lateForm]);
    const onTime = await seedIntent();
    await setSubmissionWindow(shift(t, -5), shift(t, 5));
    expect((await upload(request, onTime)).status()).toBe(200);
    expect((await row(onTime))!.submitted_late).toBe(false);
  });

  test('U4: หน้าจอ — กด "ผู้ลงนามไม่ใช่คนนี้" แล้วระบุชื่อ · ส่งแล้วเปลี่ยนไฟล์ได้ · เจ้าหน้าที่เห็นป้ายว่านักศึกษาระบุเอง', async ({ page }) => {
    test.setTimeout(150_000);
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    const formId = await seedIntent();

    await loginAs(page, 'student2');
    // ระบบรู้ชื่อทั้งสองคน — ยังไม่มีช่องกรอก จนกว่าจะกดว่าไม่ใช่คนนี้
    await expect(page.getByTestId('signer-dept-head')).toHaveCount(0);
    await page.getByTestId('signer-dept-head-change').click();
    await page.getByTestId('signer-dept-head').fill('ผศ.รักษาการ แทนหัวหน้า');

    // คำแนะนำต้องบอกว่าส่งหน้า 1 ที่มีลายมือชื่อครบสามช่อง
    await expect(page.getByTestId('status-card')).toContainText('หน้า 1');
    await expect(page.getByTestId('status-card')).toContainText('ครบสามช่อง');

    await page.getByTestId('upload-request-form').setInputFiles(PDF);
    const confirm = page.getByRole('dialog').filter({ hasText: 'ส่งแบบคำร้องที่ลงนามแล้ว' });
    await expect(confirm).toContainText('ผศ.รักษาการ แทนหัวหน้า');
    await page.getByTestId('request-form-confirm').click();
    await expect(page.getByTestId('request-form-uploaded')).toBeVisible();
    const first = (await row(formId))!;
    expect(first.dept_head_signer_name).toBe('ผศ.รักษาการ แทนหัวหน้า');

    // เปลี่ยนไฟล์ — ผ่านกล่องยืนยันเดิม ไม่ถามชื่อผู้ลงนามซ้ำ
    await page.getByTestId('replace-request-form').setInputFiles(PDF);
    await expect(confirm).toBeVisible();
    await expect(confirm).not.toContainText('หัวหน้าสาขาวิชาที่ลงนาม');
    await page.getByTestId('request-form-confirm').click();
    await expect(confirm).toBeHidden();
    await expect
      .poll(async () => (await row(formId))!.request_form_path, { timeout: 10_000 })
      .not.toBe(first.request_form_path);
    expect((await row(formId))!.dept_head_signer_name).toBe('ผศ.รักษาการ แทนหัวหน้า');

    // ฝั่งเจ้าหน้าที่: แผงรับคำร้องต้องบอกว่าชื่อหัวหน้าสาขาเป็นของที่นักศึกษาระบุ (ที่ปรึกษาไม่ติดป้าย)
    await loginAs(page, 'staff1');
    await page.getByTestId(`review-request-${formId}`).click();
    const signers = page.getByTestId('officer-signers');
    await expect(signers).toContainText('ผศ.รักษาการ แทนหัวหน้า');
    await expect(signers.getByTestId('signer-typed-by-student')).toHaveCount(1);
    await expect(signers.getByTestId('signer-typed-by-student')).toContainText('นักศึกษาระบุชื่อหัวหน้าสาขาวิชาเอง');
  });

  test('U5: พิมพ์ชื่อซ้ำกับสถานประกอบการในทำเนียบ → ถามก่อน · ใช้ของทำเนียบ = ล็อกช่อง · ยืนยันพิมพ์เอง = ไปต่อได้', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    const directory = await dbRow<{ name_th: string; company_id: number }>(
      'SELECT name_th, company_id FROM companies WHERE is_verified = TRUE ORDER BY company_id LIMIT 1'
    );
    const companiesBefore = await dbValue<number>('SELECT COUNT(*)::int FROM companies');

    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');
    const fillTyped = async () => {
      // พิมพ์ชื่อเดียวกับทำเนียบ (ต่างแค่ตัวพิมพ์/ช่องว่างหัวท้าย) โดยไม่กดเลือกจากรายการ
      await page.getByTestId('request-company-name').fill(`  ${directory!.name_th}  `);
      await page.getByTestId('request-address').fill('1 ถนนทดสอบ');
      await page.getByTestId('request-district').fill('ศรีราชา');
      await page.getByTestId('request-province').selectOption('ชลบุรี');
      await page.getByTestId('request-postal').fill('20110');
      await page.getByTestId('request-phone').fill('038000111');
      await page.getByTestId('request-contact-person').fill('คุณทดสอบ ซ้ำชื่อ');
      await page.getByTestId('request-contact-position').fill('ผู้จัดการ');
    };

    await fillTyped();
    await page.getByTestId('request-submit').click();
    const warning = page.getByTestId('request-duplicate');
    await expect(warning).toContainText('มีสถานประกอบการชื่อนี้ในทำเนียบของคณะแล้ว');
    await expect(page.getByTestId('confirm-summary')).toHaveCount(0);

    // ทาง 1: ใช้ข้อมูลของทำเนียบ → ช่องถูกล็อกเป็นข้อมูลทำเนียบ
    await page.getByTestId('request-duplicate-use').click();
    await expect(page.getByTestId('request-company-locked')).toBeVisible();
    await expect(warning).toHaveCount(0);

    // ทาง 2: ยืนยันว่าไม่ใช่ที่เดียวกัน → กล่องยืนยันเปิด และไม่ถามซ้ำสำหรับชื่อเดิม
    await page.getByRole('button', { name: 'เลือกที่อื่น' }).click();
    await fillTyped();
    await page.getByTestId('request-submit').click();
    await page.getByTestId('request-duplicate-keep').click();
    await expect(page.getByTestId('confirm-summary')).toContainText('คุณทดสอบ ซ้ำชื่อ');
    await page.getByTestId('request-confirm-cancel').click();
    await page.getByTestId('request-submit').click();
    await expect(page.getByTestId('confirm-summary')).toBeVisible();
    await page.getByTestId('request-confirm').click();
    await expect(page.getByText('เรียบร้อยแล้ว', { exact: false }).first()).toBeVisible();

    // นักศึกษายืนยันพิมพ์เอง = ได้แถวใหม่ที่ยังไม่รับรอง (เจ้าหน้าที่ตรวจตอนรับคำร้อง) · แถวของทำเนียบไม่ถูกแตะ
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM companies')).toBe(companiesBefore! + 1);
    expect(
      await dbValue<number>(`SELECT company_id FROM intent_forms WHERE student_id = ${STUDENT2}`)
    ).not.toBe(directory!.company_id);
  });
});
