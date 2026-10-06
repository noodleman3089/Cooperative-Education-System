import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * นักศึกษาแก้สถานประกอบการของคำร้องที่ยื่นแล้ว **ก่อนอัปโหลดกระดาษที่ลงนาม** — `PUT /api/intents/:id/company`
 * (เจ้าของสั่ง 2026-10-06: ช่วงพิมพ์ไปเซ็นต้องกลับมาแก้ได้ ไม่ใช่ต้องยกเลิกทั้งใบ)
 *
 * สิ่งที่พังเงียบได้:
 *   1. **แก้ข้อมูลของคนอื่น** — เส้นนี้ UPDATE ตาราง `companies` ซึ่งชื่อ/ที่อยู่ถูกพิมพ์ลงหนังสือที่คณบดีลงนาม
 *      แถวของทำเนียบ (รับรองแล้ว) และแถวที่นักศึกษาคนอื่นสร้าง ต้องไม่ถูกแก้จากเส้นนี้เด็ดขาด
 *   2. **แก้หลังอัปโหลด** — กระดาษถูกเซ็นด้วยข้อมูลชุดนั้นแล้ว แก้ต่อ = ระบบไม่ตรงกับกระดาษที่เจ้าหน้าที่ตรวจ
 *   3. ใบเดิมต้องยังเป็นใบเดิม (form_id · ตราส่งช้า) และไม่มีแถวบริษัทกำพร้าค้าง
 */

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const ACTIVE_SEMESTER = '(SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1)';

const TYPED = {
  company_name_th: 'บริษัท แก้แล้ว จำกัด',
  company_address: '9 ถนนใหม่ ตำบลใหม่',
  company_district: 'บางละมุง',
  company_province: 'ชลบุรี',
  company_postal_code: '20150',
  company_phone: '038222333',
  contact_person: 'คุณถูกต้อง แก้แล้ว',
  contact_position: 'ผู้จัดการ',
  contact_mobile: '0891234567',
  contact_email: 'fixed@example.com',
};

/** ใบของ student2 (ส่งช้า) ถึงบริษัทที่ตัวเองกรอก ยังไม่รับรอง */
async function seedDraftIntent(): Promise<{ formId: number; companyId: number }> {
  return withDb(async (db) => {
    const companyId = (
      await db.query(
        `INSERT INTO companies (name_th, address, province, district, postal_code, phone,
                                created_by, is_verified, contact_person, contact_position)
         VALUES ('บริษัท พิมพ์ผิด จำกัด', '1 ถนนเก่า', 'ชลบุรี', 'ศรีราชา', '20110', '020000000',
                 ${STUDENT2}, FALSE, 'ชื่อเก่า', 'ตำแหน่งเก่า')
         RETURNING company_id`
      )
    ).rows[0].company_id as number;
    const formId = (
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, submitted_late, late_reason)
         VALUES (${STUDENT2}, $1, ${ACTIVE_SEMESTER}, 'pending_advisor', TRUE, 'เหตุผลเดิมที่ยื่นช้าของใบนี้')
         RETURNING form_id`,
        [companyId]
      )
    ).rows[0].form_id as number;
    return { formId, companyId };
  });
}

const intentRow = (formId: number) =>
  dbRow<{ company_id: number; status: string; submitted_late: boolean; late_reason: string }>(
    'SELECT company_id, status, submitted_late, late_reason FROM intent_forms WHERE form_id = $1',
    [formId]
  );
const companyRow = (companyId: number) =>
  dbRow<{ name_th: string; contact_person: string | null; contact_phone: string | null; contact_fax: string | null; email: string | null; is_verified: boolean }>(
    'SELECT name_th, contact_person, contact_phone, contact_fax, email, is_verified FROM companies WHERE company_id = $1',
    [companyId]
  );
const companyTotal = () => dbValue<number>('SELECT COUNT(*)::int FROM companies');

test.describe('แก้คำร้องก่อนอัปโหลดกระดาษที่ลงนาม', () => {
  test('X1: แก้ข้อมูลบริษัทที่กรอกเอง → แก้ในแถวเดิม · ใบเดิมคงอยู่พร้อมตราส่งช้า · กระดาษใหม่ใช้ข้อมูลใหม่ · ลง audit', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const { formId, companyId } = await seedDraftIntent();
    const before = await companyTotal();

    await apiLoginAs(request, 'student2');
    const res = await request.put(`${API_URL}/intents/${formId}/company`, { data: TYPED });
    expect(res.status(), await res.text()).toBe(200);

    // ใบเดิม บริษัทแถวเดิม — ไม่มีแถวใหม่งอก ไม่มีแถวหาย
    expect(await intentRow(formId)).toEqual({
      company_id: companyId,
      status: 'pending_advisor',
      submitted_late: true,
      late_reason: 'เหตุผลเดิมที่ยื่นช้าของใบนี้',
    });
    expect(await companyTotal()).toBe(before);
    expect(await companyRow(companyId)).toEqual({
      name_th: TYPED.company_name_th,
      contact_person: TYPED.contact_person,
      contact_phone: TYPED.contact_mobile,
      contact_fax: null, // ไม่ได้ส่งมา = ล้าง ไม่ใช่ค้างค่าเดิม
      email: TYPED.contact_email,
      is_verified: false, // ⛔ การแก้ของนักศึกษาต้องไม่ทำให้บริษัทถูกรับรอง
    });

    const paper = await request.get(`${API_URL}/intents/${formId}/request-form?format=html`);
    const html = await paper.text();
    expect(html).toContain(TYPED.company_name_th);
    expect(html).not.toContain('บริษัท พิมพ์ผิด จำกัด');

    await expect
      .poll(
        () =>
          dbValue<number>(
            "SELECT COUNT(*)::int FROM audit_log WHERE action = 'intent.company_changed' AND entity_id = $1",
            [String(formId)]
          ),
        { timeout: 5000 }
      )
      .toBe(1);
  });

  test('X2: เปลี่ยนไปบริษัทในทำเนียบ → ร่างเดิมถูกลบ · เปลี่ยนกลับมาพิมพ์เอง → แถวของทำเนียบต้องไม่ถูกแก้แม้แต่ช่องเดียว', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const { formId, companyId: draftId } = await seedDraftIntent();
    const directory = await dbRow<{ company_id: number }>(
      'SELECT company_id FROM companies WHERE is_verified = TRUE ORDER BY company_id LIMIT 1'
    );
    const directoryBefore = await dbRow('SELECT * FROM companies WHERE company_id = $1', [directory!.company_id]);

    await apiLoginAs(request, 'student2');
    const toDirectory = await request.put(`${API_URL}/intents/${formId}/company`, {
      data: { company_id: directory!.company_id },
    });
    expect(toDirectory.status(), await toDirectory.text()).toBe(200);
    expect((await intentRow(formId))!.company_id).toBe(directory!.company_id);
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM companies WHERE company_id = $1', [draftId])).toBe(0);

    // ตอนนี้ใบชี้ไปแถวของทำเนียบ — ส่งช่องพิมพ์เองมา ต้องได้ **แถวร่างใหม่** ไม่ใช่ UPDATE ทับแถวของทำเนียบ
    const toTyped = await request.put(`${API_URL}/intents/${formId}/company`, { data: TYPED });
    expect(toTyped.status(), await toTyped.text()).toBe(200);
    const nowId = (await intentRow(formId))!.company_id;
    expect(nowId).not.toBe(directory!.company_id);
    expect(await companyRow(nowId)).toMatchObject({ name_th: TYPED.company_name_th, is_verified: false });
    expect(await dbRow('SELECT * FROM companies WHERE company_id = $1', [directory!.company_id])).toEqual(directoryBefore);

    // company_id ของแถวที่ยังไม่รับรอง (ของคนอื่น) เลือกไม่ได้
    const foreign = await withDb(async (db) =>
      (
        await db.query(
          `INSERT INTO companies (name_th, address, province, district, postal_code, phone, created_by, is_verified)
           VALUES ('บริษัท ของคนอื่น จำกัด', '5 ซอย', 'ระยอง', 'เมือง', '21000', '038000000',
                   (SELECT user_id FROM users WHERE email = 'staff1@test.com'), FALSE)
           RETURNING company_id`
        )
      ).rows[0].company_id as number
    );
    const bad = await request.put(`${API_URL}/intents/${formId}/company`, { data: { company_id: foreign } });
    expect(bad.status()).toBe(400);
    expect((await intentRow(formId))!.company_id).toBe(nowId);
  });

  test('X3: คนอื่นแก้แทนไม่ได้ · อัปโหลดกระดาษแล้วแก้ไม่ได้ · ถูกตีกลับแล้วแก้ได้อีก · ข้อมูลไม่ครบ/E-mail ผิด 400', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const { formId, companyId } = await seedDraftIntent();
    const url = `${API_URL}/intents/${formId}/company`;
    const untouched = async () => expect((await companyRow(companyId))!.name_th).toBe('บริษัท พิมพ์ผิด จำกัด');

    expect((await request.put(url, { data: TYPED })).status()).toBe(401);
    for (const role of ['staff1', 'advisor1'] as const) {
      await apiLoginAs(request, role);
      expect((await request.put(url, { data: TYPED })).status(), role).toBe(403);
    }
    await apiLoginAs(request, 'student1');
    const other = await request.put(url, { data: TYPED });
    expect(other.status()).toBe(400);
    expect((await other.json()).message).toContain('ของตัวเอง');
    await untouched();

    await apiLoginAs(request, 'student2');
    for (const bad of [{ ...TYPED, company_address: '' }, { ...TYPED, contact_email: 'ไม่ใช่อีเมล' }]) {
      expect((await request.put(url, { data: bad })).status()).toBe(400);
    }
    await untouched();

    // อัปโหลดกระดาษที่ลงนามแล้ว → รอเจ้าหน้าที่ → แก้ไม่ได้
    const upload = await request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: {
        request_form: {
          name: 'signed.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
        },
      },
    });
    expect(upload.status(), await upload.text()).toBe(200);
    expect((await request.put(url, { data: TYPED })).status()).toBe(400);
    await untouched();

    // ทุกสถานะหลังจากนั้นก็แก้ไม่ได้
    for (const status of ['approved_by_dept_head', 'pending_officer_approval', 'accepted', 'rejected']) {
      await withDb((db) => db.query('UPDATE intent_forms SET status = $1 WHERE form_id = $2', [status, formId]));
      expect((await request.put(url, { data: TYPED })).status(), status).toBe(400);
    }
    await untouched();

    // เจ้าหน้าที่ตีกลับ → ใบกลับมารอพิมพ์ใหม่ → แก้ได้อีก (ทางออกของ "ตีกลับเพราะข้อมูลบริษัทผิด")
    await withDb((db) => db.query("UPDATE intent_forms SET status = 'pending_officer_request' WHERE form_id = $1", [formId]));
    await apiLoginAs(request, 'staff1');
    const reject = await request.patch(`${API_URL}/intents/${formId}/officer-reject`, {
      data: { reason: 'ชื่อสถานประกอบการสะกดผิด' },
    });
    expect(reject.status(), await reject.text()).toBe(200);
    await apiLoginAs(request, 'student2');
    expect((await request.put(url, { data: TYPED })).status()).toBe(200);
    expect((await companyRow(companyId))!.name_th).toBe(TYPED.company_name_th);
  });

  test('X4: หน้าจอ — จากหน้าแรกไปแก้ · ฟอร์มมีค่าเดิม · ยกเลิกการแก้ไม่บันทึก · บันทึกแล้วใบเดิมเปลี่ยนข้อมูล', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    const { formId, companyId } = await seedDraftIntent();

    await loginAs(page, 'student2');
    await page.getByTestId('request-edit-link').click();
    await expect(page.getByTestId('request-blocking-intent')).toBeVisible();
    await page.getByTestId('request-edit-open').click();

    // ฟอร์มเดิมของหน้ายื่น เติมค่าปัจจุบันของใบให้แล้ว
    await expect(page.getByTestId('request-editing')).toContainText('กำลังแก้ไขคำร้องที่ยื่นไว้');
    await expect(page.getByTestId('request-company-name')).toHaveValue('บริษัท พิมพ์ผิด จำกัด');
    await expect(page.getByTestId('request-contact-person')).toHaveValue('ชื่อเก่า');

    // ยกเลิกการแก้ = ไม่มีอะไรถูกบันทึก
    await page.getByTestId('request-company-name').fill('ชื่อที่ต้องไม่ถูกบันทึก');
    await page.getByTestId('request-edit-cancel').click();
    await expect(page.getByTestId('request-blocking-intent')).toBeVisible();
    expect((await companyRow(companyId))!.name_th).toBe('บริษัท พิมพ์ผิด จำกัด');

    await page.getByTestId('request-edit-open').click();
    await page.getByTestId('request-company-name').fill('บริษัท พิมพ์ถูก จำกัด');
    await page.getByTestId('request-contact-email').fill('hr@example.com');
    await page.getByTestId('request-submit').click();
    const summary = page.getByTestId('confirm-summary');
    await expect(summary).toContainText('บริษัท พิมพ์ถูก จำกัด');
    await expect(summary).toContainText('ต้องพิมพ์ฉบับใหม่');
    await page.getByTestId('request-confirm').click();

    await expect(page.getByText('แก้ไขคำร้องถึง บริษัท พิมพ์ถูก จำกัด แล้ว', { exact: false })).toBeVisible();
    expect((await intentRow(formId))!.company_id).toBe(companyId);
    expect(await companyRow(companyId)).toMatchObject({ name_th: 'บริษัท พิมพ์ถูก จำกัด', email: 'hr@example.com' });
    expect(await dbValue<number>(`SELECT COUNT(*)::int FROM intent_forms WHERE student_id = ${STUDENT2}`)).toBe(1);

    // กลับหน้าแรก การ์ดยังอยู่ขั้นพิมพ์/อัปโหลด และชื่อใหม่ขึ้น
    await goToMenu(page, 'dashboard');
    await expect(page.getByTestId('status-card')).toHaveAttribute('data-state', 'submit-paper');
    await expect(page.getByText('บริษัท พิมพ์ถูก จำกัด').first()).toBeVisible();
  });
});
