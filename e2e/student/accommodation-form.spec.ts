import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * สหกิจ 06 — แบบแจ้งรายละเอียดที่พัก
 *
 * ที่อยู่เคยเป็น TEXT ก้อนเดียว ซึ่งพิมพ์ลงแบบฟอร์มที่มีช่องแยกไม่ได้ และอาจารย์
 * นิเทศเอาไปหาทางต่อไม่ได้ · 2026-09-03 แตกเป็นช่องย่อยตามฟอร์มจริง + เก็บพิกัด
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **ไม่มีทางกลับไปเป็นก้อนเดียว** — ส่ง `address` แบบเดิมมาต้องไม่ผ่าน
 *   2. **ช่องบังคับและรหัสไปรษณีย์** ถูกตรวจที่เซิร์ฟเวอร์ ไม่ใช่แค่ที่หน้าจอ
 *   3. **พิกัดขยะเข้าฐานไม่ได้** — ค่าผิดพาอาจารย์นิเทศไปผิดที่
 *   4. **ข้อมูลเก่าต้องไม่หายไปจากสายตา** (`address_legacy`)
 *   5. **แผนที่เป็นตัวช่วย ไม่ใช่เงื่อนไข** — โหลดแผนที่ไม่ได้ต้องยังส่งฟอร์มได้
 *   6. **ฉบับร่างในเครื่องเกิดจากการแก้จริงเท่านั้น** — แค่เปิดหน้าแล้วปิดต้องไม่มีอะไรให้กู้คืน
 */

const ADDRESS = {
  house_no: '199/8',
  building: 'หอพักบ้านสวน',
  room_no: '502',
  soi: 'ร่วมใจ',
  road: 'สุขุมวิท',
  subdistrict: 'บางพระ',
  district: 'ศรีราชา',
  province: 'ชลบุรี',
  postal_code: '20110',
  phone: '038-123456',
  mobile_phone: '0891234567',
  fax: '038-123457',
  email: 'stay@example.com',
  emergency_contact: 'นางสมศรี ใจดี',
  emergency_relationship: 'มารดา',
  emergency_phone: '0898765432',
};

const WEEKS = Array.from({ length: 16 }, (_, i) => ({
  week_number: i + 1,
  start_date: '2026-11-02',
  end_date: '2026-11-06',
  tasks: `สัปดาห์ที่ ${i + 1} ทดสอบระบบ`,
}));

/** ใบตอบรับที่ `accepted` คือเงื่อนไขของการส่งแบบแจ้งที่พัก (ด่านเดิมของระบบ) */
async function seedAcceptedIntent(): Promise<number> {
  return withDb(async (db) => {
    const studentId = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      .company_id;

    // วันเริ่ม = วันนี้ เพื่อให้อยู่ในกรอบ "ภายใน 1 สัปดาห์หลังเริ่มปฏิบัติงาน"
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'accepted', (NOW() AT TIME ZONE 'Asia/Bangkok')::date)`,
      [studentId, companyId, semesterId]
    );
    return studentId as number;
  });
}

const submit = (
  request: APIRequestContext,
  studentId: number,
  accommodation: Record<string, unknown>
) =>
  request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
    data: { accommodation, weekly_plans: WEEKS },
  });

test.describe('สหกิจ 06 — แบบแจ้งรายละเอียดที่พัก', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('S1: ส่งที่อยู่ก้อนเดียวแบบเดิม → ไม่ผ่าน (400) และไม่มีแถวเกิดในฐาน', async ({
    request,
  }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    // ⛔ ตัวกันไม่ให้ใครเผลอใส่ fallback `address` กลับเข้ามาเพื่อ "ให้เทสต์เก่าผ่าน"
    const res = await submit(request, studentId, {
      address: '123/45 ถนนทดสอบ ต.ทดสอบ อ.ทดสอบ จ.ทดสอบ 12345',
      emergency_contact: 'นางสมศรี ใจดี',
      emergency_phone: '0898765432',
    });
    expect(res.status(), await res.text()).toBe(400);
    expect((await res.json()).message as string).toContain('บ้านเลขที่');

    expect(await dbValue<string>('SELECT COUNT(*) FROM accommodations')).toBe('0');
  });

  test('S2: ช่องบังคับขาด → 400 และบอกว่าขาดช่องไหน', async ({ request }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    const res = await submit(request, studentId, { ...ADDRESS, district: '', postal_code: '' });
    expect(res.status()).toBe(400);
    const message = (await res.json()).message as string;
    expect(message).toContain('อำเภอ/เขต');
    expect(message).toContain('รหัสไปรษณีย์');
  });

  test('S3: รหัสไปรษณีย์ไม่ใช่ตัวเลข 5 หลัก → 400', async ({ request }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    const res = await submit(request, studentId, { ...ADDRESS, postal_code: '201' });
    expect(res.status()).toBe(400);
    expect((await res.json()).message as string).toContain('5 หลัก');
  });

  test('S4: พิกัดนอกช่วงจริงบนโลก → 400 (กันค่าขยะที่พาอาจารย์ไปผิดที่)', async ({ request }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    const res = await submit(request, studentId, {
      ...ADDRESS,
      latitude: '999',
      longitude: '100.9',
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message as string).toContain('พิกัด');
    expect(await dbValue<string>('SELECT COUNT(*) FROM accommodations')).toBe('0');
  });

  test('S5: กรอกครบ → ลงฐานเป็นช่องแยกจริง และประกอบที่อยู่กลับมาถูก', async ({ request }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    const res = await submit(request, studentId, {
      ...ADDRESS,
      latitude: '13.1234567',
      longitude: '100.9234567',
    });
    expect(res.status(), await res.text()).toBe(200);

    const row = await dbRow<{
      house_no: string;
      room_no: string;
      subdistrict: string;
      district: string;
      province: string;
      postal_code: string;
      mobile_phone: string;
      fax: string;
      email: string;
      latitude: string;
      longitude: string;
      address_legacy: string | null;
    }>('SELECT * FROM accommodations WHERE student_id = $1', [studentId]);

    expect(row?.house_no).toBe('199/8');
    expect(row?.room_no).toBe('502');
    expect(row?.subdistrict).toBe('บางพระ');
    expect(row?.district).toBe('ศรีราชา');
    expect(row?.province).toBe('ชลบุรี');
    expect(row?.postal_code).toBe('20110');
    expect(row?.mobile_phone).toBe('0891234567');
    expect(row?.fax).toBe('038-123457');
    expect(row?.email).toBe('stay@example.com');
    expect(Number(row?.latitude)).toBeCloseTo(13.1234567, 6);
    // ⛔ การกรอกใหม่ต้องไม่เขียนทับค่าเก่า — คอลัมน์นั้นอ่านอย่างเดียว
    expect(row?.address_legacy).toBeNull();

    const read = await request.get(`${API_URL}/students/${studentId}/accommodation-plan`);
    expect((await read.json()).accommodation.formatted_address).toBe(
      'เลขที่ 199/8 หอพักบ้านสวน ห้อง 502 ซอยร่วมใจ ถนนสุขุมวิท ตำบลบางพระ อำเภอศรีราชา จังหวัดชลบุรี 20110'
    );
  });

  test('S6: กรุงเทพฯ ใช้ "แขวง/เขต" ไม่ใช่ "ตำบล/อำเภอ" และไม่มีคำว่า "จังหวัด" นำ', async ({
    request,
  }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    // ชุดข้อมูลสะกดเขตของ กทม. มาพร้อมคำว่า "เขต" อยู่แล้ว — เติมทับจะได้ "เขตเขตจตุจักร"
    const res = await submit(request, studentId, {
      ...ADDRESS,
      building: '',
      room_no: '',
      soi: '',
      subdistrict: 'จอมพล',
      district: 'เขตจตุจักร',
      province: 'กรุงเทพมหานคร',
      postal_code: '10900',
    });
    expect(res.status(), await res.text()).toBe(200);

    const read = await request.get(`${API_URL}/students/${studentId}/accommodation-plan`);
    expect((await read.json()).accommodation.formatted_address).toBe(
      'เลขที่ 199/8 ถนนสุขุมวิท แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900'
    );
  });

  test('S7: แถวเก่าที่มีแต่ที่อยู่ก้อนเดียว → ยังอ่านเห็น ไม่หายไปเงียบๆ', async ({ request }) => {
    const studentId = await seedAcceptedIntent();
    await dbExec(
      // ⛔ ผู้ติดต่อฉุกเฉินย้ายไปอยู่บน `students` แล้ว (migration 013) คอลัมน์ที่นี่
      //    เหลือเป็น `*_legacy` อ่านอย่างเดียว — เทสต์นี้สนใจแค่ที่อยู่ก้อนเดิม
      `INSERT INTO accommodations (student_id, address_legacy)
       VALUES ($1, '77/7 ถ.เก่า ต.เก่า อ.เก่า จ.เก่า 11111')`,
      [studentId]
    );

    await apiLoginAs(request, 'student2');
    const read = await request.get(`${API_URL}/students/${studentId}/accommodation-plan`);
    const acc = (await read.json()).accommodation;
    expect(acc.formatted_address).toBe('77/7 ถ.เก่า ต.เก่า อ.เก่า จ.เก่า 11111');
    expect(acc.address_legacy).toBe('77/7 ถ.เก่า ต.เก่า อ.เก่า จ.เก่า 11111');
  });

  test('S8: SEC-06 — อาจารย์นอกความดูแลอ่านที่พักไม่ได้ (ที่อยู่บ้านคือ PII)', async ({
    request,
  }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    expect((await submit(request, studentId, ADDRESS)).status()).toBe(200);

    await apiLoginAs(request, 'advisor1');
    expect(
      (await request.get(`${API_URL}/students/${studentId}/accommodation-plan`)).status()
    ).toBe(200);

    await apiLoginAs(request, 'advisor2');
    expect(
      (await request.get(`${API_URL}/students/${studentId}/accommodation-plan`)).status()
    ).toBe(403);
  });

  test('S9: หน้าจอนักศึกษา — dropdown ไล่ระดับ · รหัสไปรษณีย์เติมเอง · แผนที่ล่มก็ยังส่งได้', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const studentId = await seedAcceptedIntent();
    // ผู้ติดต่อฉุกเฉินมาจากใบสมัคร สหกิจ 03 — ตั้งไว้ก่อน (ไม่มี = บันทึกที่พักไม่ได้ ดู S14)
    await dbExec(
      `UPDATE students SET emergency_contact_name = 'นางสมศรี ใจดี', emergency_relationship = 'มารดา',
              emergency_phone = '0898765432' WHERE student_id = $1`,
      [studentId]
    );

    await loginAs(page, 'student2');
    await goToMenu(page, 'accommodation_plan');

    // maps.googleapis.com ถูกบล็อกใน beforeEach — ต้องขึ้นข้อความแทน ไม่ใช่ค้างหรือพัง
    await expect(page.getByText(/ไม่สามารถโหลดแผนที่ได้/)).toBeVisible();

    // อำเภอยังเลือกไม่ได้จนกว่าจะมีจังหวัด — ป้องกัน "ตำบลที่ไม่ได้อยู่ในอำเภอนั้น"
    await expect(page.getByTestId('acc-district')).toBeDisabled();
    await expect(page.getByTestId('acc-province')).toBeEnabled();
    await page.getByTestId('acc-province').selectOption('ชลบุรี');
    await page.getByTestId('acc-district').selectOption('ศรีราชา');
    await page.getByTestId('acc-subdistrict').selectOption('บางพระ');
    await expect(page.getByTestId('acc-postal-code')).toHaveValue('20110');

    // เปลี่ยนจังหวัดต้องล้างระดับล่างทิ้ง ไม่งั้นได้ที่อยู่ที่ไม่มีอยู่จริง
    await page.getByTestId('acc-province').selectOption('ระยอง');
    await expect(page.getByTestId('acc-subdistrict')).toHaveValue('');
    await expect(page.getByTestId('acc-postal-code')).toHaveValue('');

    await page.getByTestId('acc-province').selectOption('ชลบุรี');
    await page.getByTestId('acc-district').selectOption('ศรีราชา');
    await page.getByTestId('acc-subdistrict').selectOption('บางพระ');

    // ยังไม่กรอกบ้านเลขที่ → ส่งไม่ได้ และต้องบอกว่าขาดอะไร
    // (หน้าเป็นหน้าเดียว ไม่มีปุ่ม "ถัดไป" — ด่านอยู่ที่ปุ่มบันทึกข้อมูลที่พัก · ตัดแผนงาน สหกิจ 07 ออกแล้ว 2026-10-05)
    await page.getByTestId('acc-save').click();
    await expect(page.getByText(/กรุณากรอกข้อมูลที่พักให้ครบก่อนบันทึก.*บ้านเลขที่/)).toBeVisible();

    await page.getByTestId('acc-house-no').fill('199/8');
    await page.getByTestId('acc-building').fill('หอพักบ้านสวน');
    await page.getByTestId('acc-room-no').fill('502');
    await page.getByTestId('acc-mobile').fill('0891234567');
    // ผู้ติดต่อฉุกเฉินอ่านอย่างเดียวจากใบสมัคร สหกิจ 03 แล้ว ไม่ได้กรอกที่หน้านี้

    // แผนที่ล่มแล้วยังต้องบันทึกได้จริง — พิสูจน์ที่ฐาน ไม่ใช่แค่ข้อความบนจอ
    await page.getByTestId('acc-save').click();
    await expect(page.getByText('บันทึกข้อมูลที่พัก (สหกิจ 06) เรียบร้อยแล้ว')).toBeVisible();

    const row = await dbRow<{ house_no: string; room_no: string; latitude: string | null }>(
      'SELECT house_no, room_no, latitude FROM accommodations WHERE student_id = $1',
      [studentId]
    );
    expect(row?.house_no).toBe('199/8');
    expect(row?.room_no).toBe('502');
    // ไม่มีแผนที่ = ไม่มีพิกัด แต่ฟอร์มยังผ่าน
    expect(row?.latitude).toBeNull();
  });

  test('S10: หน้าจออาจารย์ — ลิงก์ Google Maps โผล่เมื่อมีพิกัดเท่านั้น', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const studentId = await seedAcceptedIntent();

    await apiLoginAs(request, 'student2');
    expect((await submit(request, studentId, ADDRESS)).status()).toBe(200);

    await loginAs(page, 'advisor1');
    // spec-F ข้อ 1: นัดหมายนิเทศย้ายไปอยู่ฝ่ายนิเทศ — สลับฝ่ายก่อน
    await page.getByTestId('role-btn-supervisor').click();
    await goToMenu(page, 'supervision');
    await expect(page.getByTestId('supervision-accommodation')).toContainText('ตำบลบางพระ');
    // ยังไม่ปักหมุด = ไม่มีลิงก์ให้กด (ไม่ใช่ลิงก์ที่พาไปพิกัด 0,0)
    await expect(page.getByTestId('supervision-maps-link')).toHaveCount(0);

    await dbExec(
      'UPDATE accommodations SET latitude = 13.1234567, longitude = 100.9234567 WHERE student_id = $1',
      [studentId]
    );
    // ⚠️ `page.reload()` อย่างเดียวไม่พอ — เมนูที่เปิดอยู่เก็บใน React state ของ
    //    `Dashboard.tsx` ไม่ได้อยู่ใน URL รีโหลดแล้วเด้งกลับหน้าแรกเสมอ
    await page.reload();
    await goToMenu(page, 'supervision');
    await expect(page.getByTestId('supervision-maps-link')).toHaveAttribute(
      'href',
      'https://maps.google.com/?q=13.1234567,100.9234567'
    );
  });

  test('S11: ฉบับร่างในเครื่อง — เปิดหน้าเปล่าๆ แล้วกลับมาต้องไม่ขึ้นแถบกู้คืน · แก้จริงแล้วต้องขึ้น', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const studentId = await seedAcceptedIntent();
    const draftKey = `accommodation_plan_draft_${studentId}`;
    // ข้อความเปลี่ยนจาก "ในเครื่องนี้" เป็น "ในเบราว์เซอร์นี้" ตอนรีเมคหน้าจอ — ความหมายเดิม
    // · ⚠️ ถ้าแก้ข้อความอีก ต้องแก้ตรงนี้ด้วย ไม่งั้น toHaveCount(0) สองจุดข้างล่างจะผ่านเปล่า ๆ
    const restoreBanner = page.getByText(/กู้คืนข้อมูลที่กรอกค้างไว้ในเบราว์เซอร์นี้แล้ว/);

    await loginAs(page, 'student2');

    // รอบที่ 1: เปิดหน้า ไม่แตะอะไรเลย
    await goToMenu(page, 'accommodation_plan');
    await expect(page.getByTestId('acc-house-no')).toBeVisible();
    await expect(restoreBanner).toHaveCount(0);

    // ⚠️ `page.reload()` อย่างเดียวไม่พอ — เมนูที่เปิดอยู่เก็บใน React state ของ
    //    `Dashboard.tsx` ไม่ได้อยู่ใน URL รีโหลดแล้วเด้งกลับหน้าแรกเสมอ
    await page.reload();
    await goToMenu(page, 'accommodation_plan');
    await expect(page.getByTestId('acc-house-no')).toBeVisible();

    // ⛔ ตัวกันของจริง: effect ที่เขียนฉบับร่างเคยยิงทันทีที่โหลดข้อมูลเสร็จ (และยิงสองรอบ
    //    ใน StrictMode) แค่เปิดหน้าก็ได้ร่างที่เหมือนของบนเซิร์ฟเวอร์ แล้วขึ้นแถบกู้คืน
    //    ทั้งที่ไม่มีใครแก้อะไร — คำสัญญาของแถบนี้คือ "มีของที่ยังไม่ได้ส่ง" จึงต้องเป็นจริง
    await expect(restoreBanner).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).toBeNull();

    // รอบที่ 2: แก้ของจริงหนึ่งช่อง แล้วออกจากหน้าไปโดยไม่กดส่ง
    await page.getByTestId('acc-house-no').fill('199/8');
    await expect
      .poll(async () => page.evaluate((key) => localStorage.getItem(key), draftKey))
      .not.toBeNull();

    await page.reload();
    await goToMenu(page, 'accommodation_plan');

    await expect(restoreBanner).toBeVisible();
    // แถบต้องมาพร้อมของที่กรอกไว้จริง ไม่ใช่ขึ้นแถบเปล่าๆ
    await expect(page.getByTestId('acc-house-no')).toHaveValue('199/8');

    // ทิ้งฉบับร่างแล้วต้องกลับไปเท่าที่เซิร์ฟเวอร์มี และไม่งอกร่างใหม่ขึ้นมาเอง
    await page.getByRole('button', { name: /ทิ้งฉบับร่าง/ }).click();
    await expect(restoreBanner).toHaveCount(0);
    await expect(page.getByTestId('acc-house-no')).toHaveValue('');
    expect(await page.evaluate((key) => localStorage.getItem(key), draftKey)).toBeNull();
  });

  /**
   * ⛔ วันของแผนรายสัปดาห์เป็นของเซิร์ฟเวอร์ — หน้าจอส่งวันว่างมา (และไม่ควรคำนวณเอง)
   * ของเดิม backend ลบแผนทั้งหมดก่อน แล้วข้ามทุกแถวที่ไม่มีวัน = แผนที่นักศึกษาพิมพ์หายเงียบ
   */
  test('S12: ส่งแผนรายสัปดาห์โดยไม่มีวันที่ → เซิร์ฟเวอร์คำนวณวันจากวันเริ่มปฏิบัติงานให้', async ({
    request,
  }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    const res = await request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
      data: {
        accommodation: ADDRESS,
        weekly_plans: [
          { week_number: 1, start_date: '', end_date: '', tasks: 'สัปดาห์ที่ 1 ศึกษาระบบเดิม' },
          { week_number: 2, start_date: '', end_date: '', tasks: 'สัปดาห์ที่ 2 ออกแบบฐานข้อมูล' },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    const week2 = await dbRow<{ tasks: string; start_date: string; end_date: string }>(
      'SELECT tasks, start_date, end_date FROM weekly_work_plans WHERE student_id = $1 AND week_number = 2',
      [studentId]
    );
    expect(week2?.tasks).toBe('สัปดาห์ที่ 2 ออกแบบฐานข้อมูล');
    // วันเริ่มของใบคือวันนี้ (seedAcceptedIntent) → สัปดาห์ที่ 2 เริ่ม +7 และจบ +13
    expect(
      await dbValue<string>(
        `SELECT (start_date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 7
                 AND end_date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 13)::text
         FROM weekly_work_plans WHERE student_id = $1 AND week_number = 2`,
        [studentId]
      )
    ).toBe('true');
  });

  test('S13: ใบยังไม่มีวันเริ่มปฏิบัติงาน → แผนเดิมต้องไม่ถูกลบทิ้ง', async ({ request }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    // มีแผนของเดิมอยู่แล้วหนึ่งสัปดาห์
    await dbExec(
      `INSERT INTO weekly_work_plans (student_id, week_number, start_date, end_date, tasks, status)
       VALUES ($1, 1, DATE '2026-11-02', DATE '2026-11-08', 'แผนเดิมที่บันทึกไว้', 'planned')`,
      [studentId]
    );
    await dbExec('UPDATE intent_forms SET start_date = NULL WHERE student_id = $1', [studentId]);

    const res = await request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
      data: {
        accommodation: ADDRESS,
        weekly_plans: [{ week_number: 1, start_date: '', end_date: '', tasks: 'พิมพ์ทับของเดิม' }],
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    expect(
      await dbValue<string>(
        'SELECT tasks FROM weekly_work_plans WHERE student_id = $1 AND week_number = 1',
        [studentId]
      )
    ).toBe('แผนเดิมที่บันทึกไว้');
  });

  test('S14: ยังไม่มีผู้ติดต่อฉุกเฉินใน สหกิจ 03 → บันทึกที่พักไม่ได้ และบอกว่าต้องไปกรอกที่ไหน', async ({
    page,
  }) => {
    const studentId = await seedAcceptedIntent();
    // หน้านี้แสดงผู้ติดต่อฉุกเฉินอย่างเดียว (แหล่งจริงคือใบสมัคร สหกิจ 03) — ล้างให้ว่างก่อน
    await dbExec(
      `UPDATE students SET emergency_contact_name = NULL, emergency_phone = NULL WHERE student_id = $1`,
      [studentId]
    );

    await loginAs(page, 'student2');
    await goToMenu(page, 'accommodation_plan');
    await page.getByTestId('acc-house-no').fill('199/8');
    await page.getByTestId('acc-province').selectOption('ชลบุรี');
    await page.getByTestId('acc-district').selectOption('ศรีราชา');
    await page.getByTestId('acc-subdistrict').selectOption('บางพระ');

    await page.getByTestId('acc-save').click();
    await expect(page.getByText(/ต้องมีผู้ติดต่อกรณีฉุกเฉิน/)).toBeVisible();
    // กันไม่ให้ "ขึ้นข้อความเตือนแต่ส่งไปแล้ว" — ต้องไม่มีแถวที่พักเกิดขึ้นเลย
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM accommodations WHERE student_id = $1', [studentId])
    ).toBe('0');
  });
});
