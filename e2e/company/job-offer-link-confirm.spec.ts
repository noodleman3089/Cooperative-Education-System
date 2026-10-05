import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRow, dbValue } from '../helpers/db';

/**
 * ลิงก์แบบเสนองาน (สหกิจ 02) ใช้ตอบได้ครั้งเดียว — ส่งแล้วบริษัทแก้เองไม่ได้
 * (web-preflight 2026-10-05 · P-005)
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **กดปุ่มส่งอย่างเดียวต้องยังไม่ส่ง** — เดิมกดครั้งเดียวคำตอบออกทันทีและลิงก์ถูกใช้ไป
 *      ต้องผ่านกล่องยืนยันที่แสดงยอดจริง (จำนวนตำแหน่ง · อัตรา · ผู้ให้ข้อมูล) ก่อน
 *   2. **ลบตำแหน่งที่มีข้อมูลต้องยืนยัน** — ปุ่มลบอยู่ติดกับปุ่มคัดลอก แตะพลาดได้บนมือถือ
 *   3. **ลิงก์ที่ใช้ไปแล้วต้องบอกว่า "ถูกใช้แล้ว"** ไม่ใช่ "หมดอายุ" — เป็นคนละเรื่องและทางแก้ต่างกัน
 *
 * ⛔ สร้างใบกับ token ตรงในฐาน ไม่เรียกเส้นส่งแบบสำรวจจริง (เส้นนั้นส่งอีเมล)
 */

const TOKEN = 'e2e-offer-confirm-0001';

async function makeOfferWithToken(): Promise<number> {
  const semesterId = await dbValue<number>(
    'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1'
  );
  // UNIQUE (company, semester) — กันชนกับใบที่ seed อาจมีอยู่แล้ว
  await dbExec('DELETE FROM coop_job_offers WHERE semester_id = $1', [semesterId]);
  const companyId = await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1');
  const offerId = (await dbValue<number>(
    `INSERT INTO coop_job_offers (company_id, semester_id, due_date, status)
     VALUES ($1, $2, CURRENT_DATE + 30, 'draft') RETURNING offer_id`,
    [companyId, semesterId]
  ))!;
  await dbExec(
    `INSERT INTO job_offer_tokens (token, offer_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
    [TOKEN, offerId]
  );
  return offerId;
}

const offerState = (offerId: number) =>
  dbRow<{ status: string; used: boolean }>(
    `SELECT o.status, (t.used_at IS NOT NULL) AS used
       FROM coop_job_offers o JOIN job_offer_tokens t ON t.offer_id = o.offer_id
      WHERE o.offer_id = $1 AND t.token = $2`,
    [offerId, TOKEN]
  );

test.describe('ลิงก์แบบเสนองาน — ส่งแล้วแก้เองไม่ได้ ต้องยืนยันก่อน', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('J1: กดส่งเจอกล่องยืนยันที่แสดงยอดจริง — ยังไม่ยืนยัน = ยังไม่ส่ง และลิงก์ยังไม่ถูกใช้', async ({
    page,
  }) => {
    const offerId = await makeOfferWithToken();
    await page.goto(`/offer?token=${TOKEN}`);
    await expect(page.getByTestId('token-offer-form')).toBeVisible();

    await page.getByTestId('offer-add-item').click();
    await page.getByTestId('offer-title').last().fill('ผู้ช่วยนักพัฒนาระบบ');
    await page.getByTestId('offer-quota').last().fill('2');
    await page.getByTestId('offer-informant-name').fill('วิภาดา เจริญพงศ์');

    await page.getByTestId('token-submit').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toContainText('ยืนยันส่งคำตอบแบบเสนองาน');
    await expect(dialog).toContainText('1 ตำแหน่ง');
    await expect(dialog).toContainText('2 อัตรา');
    await expect(dialog).toContainText('วิภาดา เจริญพงศ์');
    await expect(dialog).toContainText('ส่งแล้วลิงก์นี้จะใช้ต่อไม่ได้');

    // ⛔ หัวใจของเคส: กล่องเปิดอยู่ = ยังไม่มีอะไรถูกส่ง
    expect(await offerState(offerId)).toEqual({ status: 'draft', used: false });

    await dialog.getByRole('button', { name: 'กลับไปแก้' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await offerState(offerId)).toEqual({ status: 'draft', used: false });
    // ค่าที่กรอกต้องยังอยู่หลังกดกลับไปแก้
    await expect(page.getByTestId('offer-title').last()).toHaveValue('ผู้ช่วยนักพัฒนาระบบ');

    await page.getByTestId('token-submit').click();
    await page.getByTestId('token-submit-confirm').click();

    await expect(page.getByText('ส่งแบบเสนองาน สหกิจ 02 เรียบร้อยแล้ว')).toBeVisible();
    expect(await offerState(offerId)).toEqual({ status: 'submitted', used: true });
  });

  test('J2: ลบตำแหน่งที่มีข้อมูลต้องยืนยัน — ไม่ยืนยันตำแหน่งยังอยู่', async ({ page }) => {
    await makeOfferWithToken();
    await page.goto(`/offer?token=${TOKEN}`);
    await expect(page.getByTestId('token-offer-form')).toBeVisible();

    await page.getByTestId('offer-add-item').click();
    await page.getByTestId('offer-title').last().fill('ตำแหน่งที่หนึ่ง');
    await page.getByTestId('offer-add-item').click();
    await page.getByTestId('offer-title').last().fill('ตำแหน่งที่จะลบ');
    const before = await page.getByTestId('offer-title').count();

    await page.getByRole('button', { name: 'ลบ', exact: true }).last().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toContainText('ตำแหน่งที่จะลบ');

    await dialog.getByRole('button', { name: 'ไม่ลบ' }).click();
    await expect(page.getByTestId('offer-title')).toHaveCount(before);

    await page.getByRole('button', { name: 'ลบ', exact: true }).last().click();
    await page.getByTestId('offer-item-delete-confirm').click();
    await expect(page.getByTestId('offer-title')).toHaveCount(before - 1);
    await expect(page.getByTestId('offer-title').last()).toHaveValue('ตำแหน่งที่หนึ่ง');
  });

  test('J3: ลิงก์ที่ใช้ตอบไปแล้ว — หน้าบอกว่าถูกใช้แล้ว ไม่ใช่หมดอายุ', async ({ page }) => {
    await makeOfferWithToken();
    await dbExec('UPDATE job_offer_tokens SET used_at = NOW() WHERE token = $1', [TOKEN]);

    await page.goto(`/offer?token=${TOKEN}`);

    const gone = page.getByTestId('token-expired');
    await expect(gone).toContainText('ลิงก์นี้ใช้ต่อไม่ได้แล้ว');
    await expect(page.getByTestId('token-gone-reason')).toContainText('ลิงก์นี้ถูกใช้ตอบแบบสำรวจไปแล้ว');
    await expect(gone.getByRole('heading', { name: 'ลิงก์นี้หมดอายุแล้ว' })).toHaveCount(0);
  });
});
