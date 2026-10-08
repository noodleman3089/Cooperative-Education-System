import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { submitRequestToDirectoryCompany } from '../helpers/intent';
import { newStudent, putForm, twoSemesters } from '../helpers/semesters';

/**
 * ยื่นคำร้องถึงสถานประกอบการที่ตอบ "ไม่รับ" ไปแล้วซ้ำไม่ได้ (เจ้าของสั่ง 2026-10-08)
 * `assertNotDeclinedByCompany` ใน `backend/src/models/intent.ts` — นักศึกษาคนเดิม + แถวบริษัทเดิม + ภาคเดิม + `company_rejected`
 *
 * คุมว่า "ใครถูกกัน / ใครต้องไม่ถูกกัน" (กันผิดคน = นักศึกษาสุจริตยื่นไม่ได้โดยไม่มีปุ่มปลด):
 *   A1 บริษัทในทำเนียบ: ยื่นซ้ำ 400 ไม่มีใบใหม่ · ยื่นที่อื่นได้
 *   A2 สถานที่ Google Maps เดียวกัน (พิมพ์ชื่อใหม่ก็ไม่รอด): 400 ไม่มีแถวบริษัทใหม่
 *   A3 ทางอ้อม: ยื่นที่อื่นแล้วแก้กลับไปที่เดิม (เลือกจากทำเนียบ / สถานที่เดิม) 400 ใบไม่ขยับ ไม่มีแถวร่างค้าง
 *   A4 ต้องไม่ถูกกัน: ใบ `rejected` (นักศึกษาแจ้งเอง/ระบบปิด) · บริษัทที่ไม่รับ "คนอื่น" · ไม่รับในภาคอื่น
 *      · พิมพ์ชื่อเดียวกันเองโดยไม่มีสถานที่ (จงใจไม่เทียบชื่อ — เป็นหน้าที่ของด่านเจ้าหน้าที่)
 *   A5 หน้าจอยื่นคำร้องขึ้นข้อความของเซิร์ฟเวอร์ ไม่ใช่กดแล้วเงียบ
 */

const DECLINED_MESSAGE = 'ตอบไม่รับคุณในภาคเรียนนี้แล้ว';

const student2Id = async () =>
  (await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'")) as number;

/** บริษัทของ seed (รับรองแล้ว อยู่ในทำเนียบ) — ตัวเดียวกับที่ `putForm` และ `submitRequestToDirectoryCompany` ใช้ */
const seedCompanyId = async () =>
  (await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1')) as number;

async function addCompany(name: string, opts: { verified: boolean; placeId?: string }): Promise<number> {
  return (await dbValue<number>(
    `INSERT INTO companies (name_th, address, province, district, postal_code, phone, created_by, is_verified, google_place_id)
     VALUES ($1, '1 ถนนทดสอบ', 'ชลบุรี', 'ศรีราชา', '20110', '020000000',
             (SELECT user_id FROM users WHERE email = 'staff1@test.com'), $2, $3)
     RETURNING company_id`,
    [name, opts.verified, opts.placeId ?? null]
  )) as number;
}

const formCount = async () =>
  (await dbValue<number>('SELECT COUNT(*)::int FROM intent_forms WHERE student_id = $1', [await student2Id()])) as number;
const companyCount = () => dbValue<number>('SELECT COUNT(*)::int FROM companies') as Promise<number>;

const typedBody = (semesterId: number, name: string, placeId?: string) => ({
  is_self_found: true,
  semester_id: semesterId,
  ...(placeId ? { google_place_id: placeId } : {}),
  company_name_th: name,
  company_address: '1 ถนนทดสอบ',
  company_province: 'ชลบุรี',
  company_district: 'ศรีราชา',
  company_postal_code: '20110',
  company_phone: '020000000',
  contact_person: 'ผู้รับหนังสือ ทดสอบ',
  contact_position: 'ผู้จัดการฝ่ายบุคคล',
});

const submit = (request: APIRequestContext, data: Record<string, unknown>) =>
  request.post(`${API_URL}/intents`, { data });

test.describe('ยื่นคำร้องถึงสถานประกอบการที่ตอบไม่รับไปแล้วซ้ำไม่ได้', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('A1: บริษัทในทำเนียบตอบไม่รับ → ยื่นที่เดิมซ้ำ 400 ไม่มีใบใหม่ · ยื่นที่อื่นได้', async ({ request }) => {
    const { a } = await twoSemesters();
    const declined = await seedCompanyId();
    const other = await addCompany('บริษัท ที่อื่น จำกัด', { verified: true });
    await putForm('student2@test.com', a, 'company_rejected');

    await apiLoginAs(request, 'student2');
    const again = await submit(request, { company_id: declined, semester_id: a });
    expect(again.status(), await again.text()).toBe(400);
    expect((await again.json()).message as string).toContain(DECLINED_MESSAGE);
    expect(await formCount()).toBe(1);

    const elsewhere = await submit(request, { company_id: other, semester_id: a });
    expect(elsewhere.status(), await elsewhere.text()).toBe(201);
    expect(await formCount()).toBe(2);
  });

  test('A2: สถานที่ Google Maps เดียวกัน → พิมพ์ชื่อใหม่ก็ยื่นซ้ำไม่ได้ (400) · ไม่มีแถวบริษัทใหม่', async ({ request }) => {
    const { a } = await twoSemesters();
    const placeId = 'place-declined-a2';
    const declined = await addCompany('บริษัท จากแผนที่ จำกัด', { verified: false, placeId });
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, reject_reason)
       VALUES ($1, $2, $3, 'company_rejected', 'ไม่มีตำแหน่งที่ตรงกับสาขา')`,
      [await student2Id(), declined, a]
    );
    const companiesBefore = await companyCount();

    await apiLoginAs(request, 'student2');
    const again = await submit(request, typedBody(a, 'ชื่อที่พิมพ์ใหม่ให้ต่างออกไป', placeId));
    expect(again.status(), await again.text()).toBe(400);
    expect((await again.json()).message as string).toContain(DECLINED_MESSAGE);
    expect(await formCount()).toBe(1);
    expect(await companyCount()).toBe(companiesBefore);
  });

  test('A3: ยื่นที่อื่นแล้วแก้กลับไปที่ที่ตอบไม่รับ (ทำเนียบ / สถานที่เดิม) → 400 · ใบไม่ขยับ · ไม่มีแถวร่างค้าง', async ({
    request,
  }) => {
    const { a } = await twoSemesters();
    const sid = await student2Id();
    const declinedDirectory = await seedCompanyId();
    const placeId = 'place-declined-a3';
    const declinedPlace = await addCompany('บริษัท จากแผนที่ จำกัด', { verified: false, placeId });
    const other = await addCompany('บริษัท ที่อื่น จำกัด', { verified: true });
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
       VALUES ($1, $2, $4, 'company_rejected'), ($1, $3, $4, 'company_rejected')`,
      [sid, declinedDirectory, declinedPlace, a]
    );

    await apiLoginAs(request, 'student2');
    const fresh = await submit(request, { company_id: other, semester_id: a });
    expect(fresh.status(), await fresh.text()).toBe(201);
    const formId = (await fresh.json()).intentForm.form_id as number;
    const companiesBefore = await companyCount();

    const toDirectory = await request.put(`${API_URL}/intents/${formId}/company`, {
      data: { company_id: declinedDirectory },
    });
    expect(toDirectory.status(), await toDirectory.text()).toBe(400);
    expect((await toDirectory.json()).message as string).toContain(DECLINED_MESSAGE);

    const { is_self_found: _s, semester_id: _m, ...typed } = typedBody(a, 'ชื่อใหม่ของที่เดิม', placeId);
    const toPlace = await request.put(`${API_URL}/intents/${formId}/company`, { data: typed });
    expect(toPlace.status(), await toPlace.text()).toBe(400);
    expect((await toPlace.json()).message as string).toContain(DECLINED_MESSAGE);

    expect(
      (await dbRow<{ company_id: number; status: string }>(
        'SELECT company_id, status FROM intent_forms WHERE form_id = $1',
        [formId]
      ))!
    ).toEqual({ company_id: other, status: 'pending_advisor' });
    expect(await companyCount()).toBe(companiesBefore);
  });

  test('A4: ต้องไม่ถูกกัน — ใบ rejected · บริษัทที่ไม่รับคนอื่น · ไม่รับในภาคอื่น · พิมพ์ชื่อเดิมเองโดยไม่มีสถานที่', async ({
    request,
  }) => {
    const { a, b } = await twoSemesters();
    const company = await seedCompanyId();
    const seedName = (await dbValue<string>('SELECT name_th FROM companies WHERE company_id = $1', [company])) as string;
    await apiLoginAs(request, 'student2');

    const reset = () => dbExec('DELETE FROM intent_forms');
    const expectAllowed = async (label: string, data: Record<string, unknown>) => {
      const res = await submit(request, data);
      expect(res.status(), `${label}: ${await res.text()}`).toBe(201);
    };

    // ใบ `rejected` = นักศึกษาแจ้งเอง หรือระบบปิดเมื่อพ้นปฏิทิน — บริษัทไม่ได้ปฏิเสธ
    await putForm('student2@test.com', a, 'rejected');
    await expectAllowed('ใบ rejected (นักศึกษาแจ้งเอง)', { company_id: company, semester_id: a });

    await reset();
    await putForm('student2@test.com', a, 'rejected');
    await dbExec("UPDATE intent_forms SET reject_reason = 'ระบบปิดคำร้องนี้ เพราะพ้นกำหนดส่งแบบตอบรับ'");
    await expectAllowed('ใบ rejected (ระบบปิดเอง)', { company_id: company, semester_id: a });

    // บริษัทเดียวกันไม่รับ "คนอื่น" ไม่เกี่ยวกับนักศึกษาคนนี้
    await reset();
    await putForm((await newStudent()).email, a, 'company_rejected');
    await expectAllowed('บริษัทไม่รับคนอื่น', { company_id: company, semester_id: a });

    // ไม่รับในภาคอื่น — ภาคนี้ยื่นได้
    await reset();
    await putForm('student2@test.com', b, 'company_rejected');
    await expectAllowed('ไม่รับในภาคอื่น', { company_id: company, semester_id: a });

    // พิมพ์ชื่อเดียวกันเองโดยไม่มีสถานที่ = แถวบริษัทใหม่ — จงใจไม่เทียบชื่อ (ชื่อคล้ายของคนละนิติบุคคลจะโดนไปด้วย)
    await reset();
    await putForm('student2@test.com', a, 'company_rejected');
    await expectAllowed('พิมพ์ชื่อเดิมเอง', typedBody(a, seedName));
  });

  test('A5: หน้าจอยื่นคำร้อง — เลือกบริษัทในทำเนียบที่ตอบไม่รับไปแล้ว → ขึ้นข้อความของเซิร์ฟเวอร์ · ไม่มีใบใหม่', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { a } = await twoSemesters();
    await putForm('student2@test.com', a, 'company_rejected');

    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');
    await submitRequestToDirectoryCompany(page);

    await expect(page.getByText(DECLINED_MESSAGE)).toBeVisible();
    await expect(page.getByText('กรุณาเลือกสถานประกอบการแห่งอื่น')).toBeVisible();
    expect(await formCount()).toBe(1);
  });
});
