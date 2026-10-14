import { test, expect, type Locator } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRow, dbValue } from '../helpers/db';

/**
 * ทำเนียบสถานประกอบการ — เจ้าหน้าที่เพิ่มและแก้ไขเองจากหน้าจอ
 *
 * บั๊กที่ไฟล์นี้คุม (พบ 2026-10-14 ตอนตรวจก่อนปล่อย): `CompanyModel.findByNameTh` เขียน SQL ติดกันเป็น
 * `contact_faxFROM companies` → ตัวกันชื่อซ้ำพังทุกครั้ง **ทั้งปุ่มเพิ่มและปุ่มแก้ไขตอบ 500**
 * ตั้งแต่ 2026-10-06 โดยไม่มีเทสต์ไหนแดง เพราะไม่มีเทสต์ที่ยิง `POST /companies` หรือ `PUT /companies/:id` เลย
 *
 * ⛔ สิ่งที่คุม:
 *   D1 เจ้าหน้าที่เพิ่มบริษัทจากฟอร์มจริงได้ · แถวเป็นของเจ้าหน้าที่ รับรองแล้ว · ลง audit_log
 *   D2 เจ้าหน้าที่แก้ผู้รับหนังสือของบริษัทที่มีอยู่ได้ (ค่านี้ถูกพิมพ์ลงหนังสือขอความอนุเคราะห์) · กล่องปิดเองหลังบันทึก
 *   D2b กล่องแก้ไขปิดในครั้งเดียว (เดิมเด้งเปิดกลับ ต้องกดปิดสองครั้ง) · ป้าย "ที่มาของแถว" ดูจากผู้สร้าง
 *   D3 ชื่อซ้ำถูกปฏิเสธด้วยข้อความที่อ่านเข้าใจ ไม่ใช่ 500 · แก้แถวตัวเองโดยไม่เปลี่ยนชื่อไม่นับว่าซ้ำ
 *   D4 เพิ่ม/แก้เป็นของเจ้าหน้าที่เท่านั้น — คณบดีรับรองได้แต่เพิ่มหรือแก้ไม่ได้
 */

const SEED_COMPANY = 'บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด';
const NEW_COMPANY = 'บริษัท ทดสอบทำเนียบ จำกัด';
const STUDENT_COMPANY = 'บริษัท นักศึกษากรอกเอง จำกัด';

const NEW_FIELDS = {
  name_th: NEW_COMPANY,
  address: '1 ถนนทดสอบ ตำบลในเมือง',
  district: 'เมืองนครราชสีมา',
  province: 'นครราชสีมา',
  postal_code: '30000',
  phone: '044000000',
  contact_person: 'คุณทดสอบ ผู้ประสานงาน',
  contact_position: 'ฝ่ายบุคคล',
  email: 'directory-e2e@example.com',
};

const companyByName = (name: string) =>
  dbRow<{
    company_id: number;
    is_verified: boolean;
    created_by: number;
    contact_person: string | null;
    contact_position: string | null;
    email: string | null;
    province: string;
  }>(
    `SELECT company_id, is_verified, created_by, contact_person, contact_position, email, province
       FROM companies WHERE name_th = $1`,
    [name]
  );
const countCompanies = () => dbValue<number>('SELECT COUNT(*)::int FROM companies');
const staffId = () => dbValue<number>(`SELECT user_id FROM users WHERE email = 'staff1@test.com'`);

// label ในฟอร์มนี้ยังไม่ผูกกับช่องด้วย htmlFor จึงหาช่องจาก label ที่อยู่ติดกัน
const fieldOf = (dialog: Locator, label: string) =>
  dialog.locator('label', { hasText: label }).locator('xpath=following-sibling::input[1]');

test.describe('ทำเนียบสถานประกอบการ — เจ้าหน้าที่เพิ่มและแก้ไข', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('D1: เจ้าหน้าที่เพิ่มสถานประกอบการจากฟอร์มได้', async ({ page }) => {
    await loginAs(page, 'staff1');
    await goToMenu(page, 'companies');

    await page.getByRole('button', { name: 'เพิ่มสถานประกอบการ' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'เพิ่มสถานประกอบการเข้าทำเนียบ' });
    await expect(dialog).toBeVisible();

    await fieldOf(dialog, 'ชื่อสถานประกอบการ').fill(NEW_FIELDS.name_th);
    await fieldOf(dialog, 'ที่อยู่').fill(NEW_FIELDS.address);
    await fieldOf(dialog, 'อำเภอ/เขต').fill(NEW_FIELDS.district);
    await fieldOf(dialog, 'จังหวัด').fill(NEW_FIELDS.province);
    await fieldOf(dialog, 'รหัสไปรษณีย์').fill(NEW_FIELDS.postal_code);
    await fieldOf(dialog, 'หมายเลขโทรศัพท์').fill(NEW_FIELDS.phone);
    await fieldOf(dialog, 'ชื่อผู้ติดต่อ').fill(NEW_FIELDS.contact_person);
    await fieldOf(dialog, 'ตำแหน่ง').fill(NEW_FIELDS.contact_position);
    await fieldOf(dialog, 'อีเมลผู้ประสานงาน').fill(NEW_FIELDS.email);
    await dialog.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

    await expect(page.getByText('บันทึกทำเนียบสถานประกอบการสำเร็จ')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(NEW_COMPANY).first()).toBeVisible();

    const row = await companyByName(NEW_COMPANY);
    expect(row, 'แถวต้องถูกสร้างในฐาน').toBeTruthy();
    expect(row!.is_verified).toBe(true);
    expect(row!.created_by).toBe(await staffId());
    expect(row!.contact_person).toBe(NEW_FIELDS.contact_person);
    expect(row!.email).toBe(NEW_FIELDS.email);

    // writeAudit ลงหลัง response จึงต้อง poll
    await expect
      .poll(() =>
        dbValue<number>(
          `SELECT COUNT(*)::int FROM audit_log WHERE action = 'company.created' AND entity_id = $1::text`,
          [row!.company_id]
        )
      )
      .toBe(1);
  });

  test('D2: เจ้าหน้าที่แก้ผู้รับหนังสือของสถานประกอบการที่มีอยู่ได้', async ({ page }) => {
    await loginAs(page, 'staff1');
    await goToMenu(page, 'companies');

    await page.getByRole('button', { name: `แก้ไขข้อมูล ${SEED_COMPANY}` }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: `แก้ไขข้อมูล ${SEED_COMPANY}` });
    await expect(dialog).toBeVisible();
    await expect(fieldOf(dialog, 'ชื่อสถานประกอบการ')).toHaveValue(SEED_COMPANY);

    await fieldOf(dialog, 'ชื่อผู้ติดต่อ').fill('คุณแก้ไข จากทำเนียบ');
    await fieldOf(dialog, 'ตำแหน่ง').fill('ผู้จัดการฝ่ายบุคคล');
    await dialog.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

    await expect(page.getByText('บันทึกทำเนียบสถานประกอบการสำเร็จ')).toBeVisible();
    // กล่องต้องปิดและไม่เด้งเปิดกลับ — เดิม ?company= ยังค้างใน URL ตอน showForm เป็น false กล่องจึงเปิดซ้ำทันที
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/company=/);

    const row = await companyByName(SEED_COMPANY);
    expect(row!.contact_person).toBe('คุณแก้ไข จากทำเนียบ');
    expect(row!.contact_position).toBe('ผู้จัดการฝ่ายบุคคล');
    // ช่องที่ไม่ได้แตะต้องอยู่เหมือนเดิม
    expect(row!.email).toBe('company1@test.com');
    expect(row!.province).toBe('นครราชสีมา');
  });

  test('D2b: กล่องแก้ไขปิดในครั้งเดียว ทั้งปุ่มยกเลิกและ Esc · ที่มาของแถวดูจากผู้สร้าง ไม่ใช่จากการมีคนใช้', async ({
    page,
  }) => {
    await dbExec(
      `INSERT INTO companies (name_th, address, province, district, postal_code, phone, is_verified, created_by)
       SELECT $1, '9 ถนนทดสอบ', 'นครราชสีมา', 'เมืองนครราชสีมา', '30000', '044999999', FALSE, user_id
         FROM users WHERE email = 'student2@test.com'`, // student2 = นักศึกษาที่มีแถว students (student1 ของ seed ยังไม่มีโปรไฟล์)
      [STUDENT_COMPANY]
    );

    await loginAs(page, 'staff1');
    await goToMenu(page, 'companies');
    const dialog = page.getByRole('dialog').filter({ hasText: `แก้ไขข้อมูล ${SEED_COMPANY}` });
    const editButton = page.getByRole('button', { name: `แก้ไขข้อมูล ${SEED_COMPANY}` }).first();

    await editButton.click();
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/company=/);
    await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/company=/);
    // ต้องไม่เด้งกลับหลัง URL นิ่งแล้ว (อาการเดิม: เปิดซ้ำภายในไม่กี่สิบมิลลิวินาที)
    await page.waitForTimeout(500);
    await expect(dialog).toBeHidden();

    await editButton.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(500);
    await expect(dialog).toBeHidden();

    // ที่มาของแถว: แถวที่นักศึกษาสร้าง (กรอกมือ ไม่มี Google place · ยังไม่มีใบผูก) ต้องขึ้นว่านักศึกษาสร้าง
    // — เดิมเดาจาก "มี place id หรือมีคนใช้" แถวแบบนี้จึงขึ้นว่าเจ้าหน้าที่เพิ่มเอง และแถวของเจ้าหน้าที่เปลี่ยนป้ายเมื่อมีคนใช้
    const seed = (await companyByName(SEED_COMPANY))!;
    await expect(page.getByTestId(`company-row-${seed.company_id}`)).toContainText('เจ้าหน้าที่เพิ่มเอง');
    const studentMade = (await companyByName(STUDENT_COMPANY))!;
    await expect(page.getByTestId(`company-row-${studentMade.company_id}`)).toContainText('นักศึกษาสร้างตอนยื่นคำร้อง');
  });

  test('D3: ชื่อซ้ำถูกปฏิเสธด้วย 409 ไม่ใช่ 500 และแก้แถวตัวเองไม่นับว่าซ้ำ', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const seed = (await companyByName(SEED_COMPANY))!;
    const before = await countCompanies();

    // ตัวกันชื่อซ้ำไม่สนตัวพิมพ์และช่องว่างหัวท้าย
    const dup = await request.post(`${API_URL}/companies`, {
      data: { ...NEW_FIELDS, name_th: `  ${SEED_COMPANY}  ` },
    });
    expect(dup.status()).toBe(409);
    expect(await dup.json()).toMatchObject({
      message: 'ชื่อสถานประกอบการนี้มีอยู่ในระบบแล้ว',
      company_id: seed.company_id,
    });
    expect(await countCompanies()).toBe(before);

    const created = await request.post(`${API_URL}/companies`, { data: NEW_FIELDS });
    expect(created.status(), await created.text()).toBe(201);
    const newId = (await created.json()).company.company_id as number;

    // แก้แถวตัวเองโดยคงชื่อเดิม = ไม่ซ้ำกับใคร
    const sameName = await request.put(`${API_URL}/companies/${newId}`, {
      data: { ...NEW_FIELDS, phone: '044111111' },
    });
    expect(sameName.status(), await sameName.text()).toBe(200);
    expect(await dbValue<string>('SELECT phone FROM companies WHERE company_id = $1', [newId])).toBe('044111111');

    // เปลี่ยนชื่อไปชนแถวอื่น = ปฏิเสธ และชื่อเดิมยังอยู่
    const rename = await request.put(`${API_URL}/companies/${newId}`, {
      data: { ...NEW_FIELDS, name_th: SEED_COMPANY },
    });
    expect(rename.status()).toBe(409);
    expect(await dbValue<string>('SELECT name_th FROM companies WHERE company_id = $1', [newId])).toBe(NEW_COMPANY);
  });

  test('D4: เพิ่มและแก้ไขทำเนียบเป็นของเจ้าหน้าที่เท่านั้น', async ({ request, playwright }) => {
    const seed = (await companyByName(SEED_COMPANY))!;
    const before = await countCompanies();

    const anon = await playwright.request.newContext();
    expect((await anon.post(`${API_URL}/companies`, { data: NEW_FIELDS })).status()).toBe(401);
    expect((await anon.put(`${API_URL}/companies/${seed.company_id}`, { data: NEW_FIELDS })).status()).toBe(401);
    await anon.dispose();

    // คณบดีรับรอง/ถอนรับรองได้ แต่เพิ่มหรือแก้ข้อมูลไม่ได้
    for (const account of ['student1', 'advisor1', 'dean1', 'mentor1'] as const) {
      await apiLoginAs(request, account);
      const create = await request.post(`${API_URL}/companies`, { data: NEW_FIELDS });
      expect(create.status(), `${account} เพิ่มสถานประกอบการ`).toBe(403);
      const update = await request.put(`${API_URL}/companies/${seed.company_id}`, {
        data: { ...NEW_FIELDS, name_th: 'ชื่อที่ไม่ควรถูกบันทึก' },
      });
      expect(update.status(), `${account} แก้ไขสถานประกอบการ`).toBe(403);
    }

    expect(await countCompanies()).toBe(before);
    expect(await companyByName(SEED_COMPANY), 'ชื่อบริษัทของ seed ต้องไม่ถูกแก้').toBeTruthy();
  });
});
