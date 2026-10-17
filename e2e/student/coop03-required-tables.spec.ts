import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * สหกิจ 03 — 4 หมวดตารางประวัติบังคับ (เจ้าของสั่ง 2026-10-18) + ร่างที่กรอกค้าง
 *
 * สิ่งที่ชุดนี้คุม (ใครทำได้อะไร ก่อนหน้าตา):
 *   R1 หมวดว่างทั้งสี่ = ยังขาด · R2 ติ๊ก "ไม่มี" = ครบ · R3 มีแถวชนะ "ไม่มี" และค่าแปลกถูกทิ้ง · R4 แถวภาษาอย่างเดียวก็ครบหมวดนั้น
 *   D1 สลับเมนูแล้วค่ายังอยู่ · เลขบัตรไม่ลงที่เก็บของเบราว์เซอร์ (SEC-12) และหายเมื่อรีเฟรช
 * ข้อมูลทั้งหมดเป็นของปลอม
 */

const TABLE_KEYS = ['education', 'training', 'activity', 'language'];

const readBack = (request: APIRequestContext) =>
  request.get(`${API_URL}/students/coop-application`).then((r) => r.json());

const save = (request: APIRequestContext, body: Record<string, unknown>) =>
  request.put(`${API_URL}/students/coop-application`, { data: body });

test.describe('สหกิจ 03 — ตารางประวัติบังคับ + ร่าง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('R1: ยังไม่กรอกตารางและไม่ติ๊ก "ไม่มี" → ทั้งสี่หมวดอยู่ในรายการที่ยังขาด', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const back = await readBack(request);
    for (const key of TABLE_KEYS) expect(back.missing_required, key).toContain(key);
    expect(back.none_sections).toEqual([]);
  });

  test('R2: ติ๊ก "ไม่มีข้อมูล" ทั้งสี่หมวด → ไม่ขาดหมวดเหล่านี้ และอ่านกลับได้', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await save(request, { none_sections: TABLE_KEYS });
    expect(res.status(), await res.text()).toBe(200);

    const back = await readBack(request);
    for (const key of TABLE_KEYS) expect(back.missing_required, key).not.toContain(key);
    expect([...back.none_sections].sort()).toEqual([...TABLE_KEYS].sort());
  });

  test('R3: หมวดที่ส่งแถวมาด้วยถูกตัดออกจาก "ไม่มี" · ค่าที่ไม่รู้จักถูกทิ้ง · ไม่ส่งฟิลด์ = ไม่แก้', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    const res = await save(request, {
      none_sections: ['education', 'training', 'bogus'],
      education_history: [{ level: 'ปริญญาตรี', institution: 'มหาวิทยาลัยทดสอบ' }],
    });
    expect(res.status(), await res.text()).toBe(200);

    const back = await readBack(request);
    // education มีแถว → ไม่ต้องเก็บเป็น "ไม่มี" · training เก็บ · bogus ทิ้ง
    expect(back.none_sections).toEqual(['training']);
    expect(back.missing_required).not.toContain('education');
    expect(back.missing_required).not.toContain('training');
    expect(back.missing_required).toContain('activity');

    // บันทึกอีกครั้งโดยไม่ส่ง none_sections → ค่าเดิมต้องไม่หาย
    expect((await save(request, { career_objective: 'ทดสอบ' })).status()).toBe(200);
    expect((await readBack(request)).none_sections).toEqual(['training']);
  });

  test('R4: มีแถวภาษาอย่างเดียว (ไม่ติ๊ก) → หมวดภาษาครบ แต่อีกสามหมวดยังขาด', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await save(request, {
      language_proficiency: [{ language: 'อังกฤษ', reading: 'ดี', speaking: 'พอใช้', writing: 'ดี' }],
    });
    expect(res.status(), await res.text()).toBe(200);

    const back = await readBack(request);
    expect(back.missing_required).not.toContain('language');
    for (const key of ['education', 'training', 'activity']) expect(back.missing_required, key).toContain(key);
  });

  test('D1: กรอกค้าง → สลับเมนู → กลับมาค่ายังอยู่ · เลขบัตรไม่ลง sessionStorage/localStorage และหายหลังรีเฟรช', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'student2');
    await goToMenu(page, 'job_application');

    await page.getByTestId('ca-first-en').fill('Somsri');
    await page.getByTestId('ca-national-id').fill('1103700000017');

    await goToMenu(page, 'dashboard');
    await goToMenu(page, 'job_application');
    await expect(page.getByTestId('ca-first-en')).toHaveValue('Somsri');
    // ในแท็บเดียวกันเลขบัตรยังอยู่ (หน่วยความจำเท่านั้น)
    await expect(page.getByTestId('ca-national-id')).toHaveValue('1103700000017');
    await expect(page.getByTestId('ca-discard-draft')).toBeVisible();

    // ⛔ SEC-12: ค่าจริงของเลขบัตรต้องไม่อยู่ในที่เก็บใด ๆ ของเบราว์เซอร์
    const stored = await page.evaluate(() =>
      JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } })
    );
    expect(stored).not.toContain('1103700000017');
    expect(stored).toContain('Somsri');

    // รีเฟรช: ช่องทั่วไปกู้คืนจากร่าง แต่เลขบัตรต้องหาย
    await page.reload();
    await expect(page.getByTestId('ca-first-en')).toHaveValue('Somsri', { timeout: 20_000 });
    await expect(page.getByTestId('ca-national-id')).toHaveValue('');

    // ทิ้งร่าง → กลับเป็นค่าในเซิร์ฟเวอร์ (ยังไม่เคยบันทึก = ว่าง)
    await page.getByTestId('ca-discard-draft').click();
    await expect(page.getByTestId('ca-first-en')).toHaveValue('');
  });
});
