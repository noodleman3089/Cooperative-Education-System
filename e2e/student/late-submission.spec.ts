import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue, dbRow } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { approveIntentThroughOfficer } from '../helpers/intent';
import { goToMenu } from '../helpers/nav';

/**
 * ช่วงผ่อนผัน (ส่งช้า) ของการยื่นแบบแจ้งความจำนง
 *
 * เจ้าของเคาะ 2026-09-01: **"ส่งได้แต่เข้าข่ายส่งช้า"** ปฏิทินจึงมีวันปิดสองวัน
 *
 *   start ────── end ────── late_end ──────>
 *    403     │  รับปกติ  │ รับ+ติดธง │  403
 *
 * สิ่งที่ต้องคุมไม่ให้พังเงียบ เรียงตามความเสียหาย:
 *   1. **ไม่ตั้งวันผ่อนผัน = พฤติกรรมเดิมเป๊ะ** ถ้าข้อนี้พัง ฐานเดิมทุกแถวเปลี่ยน
 *      พฤติกรรมพร้อมกันโดยไม่มีใครสั่ง
 *   2. **ธงส่งช้าต้องไม่หายเมื่อเจ้าหน้าที่แก้ปฏิทินทีหลัง** — นี่คือเหตุผลที่มันถูก
 *      ปั๊มตอน INSERT แทนการคำนวณสด
 *   3. **สถานประกอบการต้องไม่เห็นเหตุผลการส่งช้า** (SEC-10 · เป็นเรื่องภายในคณะ)
 */

const today = () =>
  dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`) as Promise<string>;

const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** ตั้งช่วงของกิจกรรมลงฐานตรงๆ — คุมวันได้แน่นอนกว่าคลิกผ่าน UI */
const setWindow = (activityKey: string, start: string, end: string, lateEnd: string | null = null) =>
  dbExec(
    `INSERT INTO coop_calendar_events
       (semester_id, activity_key, start_date, end_date, late_end_date, created_by)
     SELECT s.semester_id, $1, $2, $3, $4, u.user_id
       FROM coop_semesters s CROSS JOIN users u
      WHERE s.is_active = TRUE AND u.email = 'staff1@test.com'
      LIMIT 1`,
    [activityKey, start, end, lateEnd]
  );

/**
 * ยื่นใบความจำนงไปบริษัทในทำเนียบ — คืน response ดิบให้เทสต์ตรวจเอง
 *
 * ⛔ ห้าม hardcode `company_id: 1` — seeder ลบแล้วสร้างบริษัทใหม่ทุกครั้ง และ
 *    คอลัมน์เป็น SERIAL เลขจึงเดินไปเรื่อยๆ ตามจำนวนรอบที่รันเทสต์
 */
const submitIntent = async (request: APIRequestContext, body: Record<string, unknown> = {}) => {
  const semester = await (await request.get(`${API_URL}/semesters/active`)).json();
  const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
  return request.post(`${API_URL}/intents`, {
    data: { company_id: companyId, semester_id: semester.semester_id, ...body },
  });
};

test.describe('การยื่นล่าช้า (ช่วงผ่อนผัน)', () => {
  test('L1: ไม่ตั้งวันผ่อนผัน + หมดช่วงแล้ว → 403 เหมือนเดิม ไม่มีอะไรเปลี่ยน', async ({
    request,
  }) => {
    await seedTestData();
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -30));

    await apiLoginAs(request, 'student2');
    const res = await submitIntent(request);
    expect(res.status()).toBe(403);
    const message = (await res.json()).message as string;
    expect(message).toContain('หมดช่วง');
    // ไม่ได้เปิดผ่อนผัน จึงต้องไม่ไปพูดถึงวันผ่อนผันให้ผู้ใช้สับสน
    expect(message).not.toContain('ผ่อนผันถึงวันที่');
  });

  test('L2: อยู่ในช่วงผ่อนผันแต่ไม่ชี้แจงเหตุผล → 400 และต้องไม่มีใบเกิดขึ้น', async ({
    request,
  }) => {
    await seedTestData();
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -10), shift(now, 10));

    await apiLoginAs(request, 'student2');
    const res = await submitIntent(request);
    expect(res.status(), await res.text()).toBe(400);
    expect((await res.json()).message as string).toContain('ส่งช้า');

    // ด่านนี้ต้องกันก่อนเขียนฐาน ไม่ใช่เขียนแล้วค่อยบ่น
    expect(await dbValue<string>(`SELECT COUNT(*) FROM intent_forms`)).toBe('0');
  });

  test('L3: อยู่ในช่วงผ่อนผัน + ชี้แจงเหตุผล → รับใบและปั๊มธงส่งช้าลงฐาน', async ({ request }) => {
    await seedTestData();
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -10), shift(now, 10));

    await apiLoginAs(request, 'student2');
    const reason = 'ติดต่อสถานประกอบการหลายแห่งแล้วยังไม่ได้รับคำตอบภายในกำหนด';
    const res = await submitIntent(request, { late_reason: reason });
    expect(res.status(), await res.text()).toBe(201);

    const row = await dbRow<{ submitted_late: boolean; late_reason: string }>(
      `SELECT submitted_late, late_reason FROM intent_forms ORDER BY form_id DESC LIMIT 1`
    );
    expect(row?.submitted_late).toBe(true);
    expect(row?.late_reason).toBe(reason);
  });

  test('L4: เลยวันผ่อนผันแล้ว → 403 และข้อความต้องบอกวันสุดท้ายที่ผ่อนผัน', async ({
    request,
  }) => {
    await seedTestData();
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -30), shift(now, -5));

    await apiLoginAs(request, 'student2');
    const res = await submitIntent(request, {
      late_reason: 'เหตุผลที่ยาวพอสำหรับด่านตรวจความยาวขั้นต่ำ',
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).message as string).toContain('ผ่อนผันถึงวันที่');
  });

  test('L5: เจ้าหน้าที่ขยายวันทีหลัง ธงส่งช้าต้องไม่หาย', async ({ request }) => {
    await seedTestData();
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -10), shift(now, 10));

    await apiLoginAs(request, 'student2');
    const res = await submitIntent(request, {
      late_reason: 'ส่งช้าเพราะรอหนังสือตอบรับจากสถานประกอบการเดิม',
    });
    expect(res.status(), await res.text()).toBe(201);

    // เจ้าหน้าที่ขยายวันปิดปกติจนคลุมวันนี้ แล้วเลิกผ่อนผันเพราะไม่จำเป็นอีก
    // — ถ้าธงถูกคำนวณสด ใบนี้จะกลายเป็น "ส่งตรงเวลา" ทันทีและหลักฐานหายเงียบ
    //
    // ⚠️ ต้องล้าง late_end_date ไปพร้อมกัน ไม่งั้น CHECK `late_end_date >= end_date`
    //    ปฏิเสธคำสั่งนี้ (เจอตอนรันจริง — ตัว constraint ทำงานถูก ข้อมูลเทสต์ผิดเอง)
    await dbExec(
      `UPDATE coop_calendar_events
          SET end_date = $1, late_end_date = NULL
        WHERE activity_key = 'intent_submission'`,
      [shift(now, 30)]
    );

    expect(
      await dbValue<boolean>(`SELECT submitted_late FROM intent_forms ORDER BY form_id DESC LIMIT 1`)
    ).toBe(true);
  });

  test('L6: SEC-10 — ฝั่งสถานประกอบการ (พี่เลี้ยง) เปิดรายการใบความจำนงไม่ได้จึงไม่เห็นเหตุผลการส่งช้า แต่เจ้าหน้าที่ต้องเห็น', async ({
    request,
  }) => {
    await seedTestData();
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -10), shift(now, 10));

    await apiLoginAs(request, 'student2');
    const reason = 'ส่งช้าเนื่องจากรอผลการพิจารณาจากสถานประกอบการแห่งเดิม';
    const created = await submitIntent(request, { late_reason: reason });
    expect(created.status(), await created.text()).toBe(201);
    const formId = (await created.json()).intentForm.form_id as number;

    // ต้องเดินให้ถึงสถานะที่ใบมีตัวตนครบก่อน ไม่งั้นเทสต์นี้ผ่านเพราะรายการว่าง
    await approveIntentThroughOfficer(request, formId);
    await dbExec(`UPDATE intent_forms SET status = 'accepted' WHERE form_id = $1`, [formId]);

    // บริษัทไม่มีบัญชีแล้ว — ฝั่งสถานประกอบการที่ล็อกอินได้คือพี่เลี้ยง ซึ่งไม่อยู่ใน allow-list ของรายการนี้
    await apiLoginAs(request, 'mentor1');
    const asMentor = await request.get(`${API_URL}/intents`);
    expect(asMentor.status(), await asMentor.text()).toBe(403);
    expect(await asMentor.text()).not.toContain('late_reason');

    await apiLoginAs(request, 'staff1');
    const asStaff = await request.get(`${API_URL}/intents`);
    const staffRows = (await asStaff.json()) as Record<string, unknown>[];
    expect(staffRows.find((r) => r.form_id === formId)?.late_reason).toBe(reason);
  });

  test('L7: วันผ่อนผันมาก่อนวันสิ้นสุด → เจ้าหน้าที่ตั้งไม่ได้ (400 ก่อนถึงฐาน)', async ({
    request,
  }) => {
    await seedTestData();
    const now = await today();

    const semesterId = await dbValue<number>(
      'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'
    );

    await apiLoginAs(request, 'staff1');
    const res = await request.post(`${API_URL}/calendar`, {
      data: {
        semester_id: semesterId,
        activity_key: 'intent_submission',
        start_date: shift(now, -10),
        end_date: shift(now, 10),
        late_end_date: shift(now, 5),
      },
    });
    expect(res.status(), await res.text()).toBe(400);
    expect((await res.json()).message as string).toContain('ผ่อนผัน');
    expect(await dbValue<string>(`SELECT COUNT(*) FROM coop_calendar_events`)).toBe('0');
  });

  test('L8: หน้าจอเจ้าหน้าที่ตั้งวันผ่อนผันได้ และป้ายสถานะบอกว่าเป็นช่วงผ่อนผัน', async ({
    page,
  }) => {
    await seedTestData();
    const now = await today();

    await loginAs(page, 'staff1');
    await goToMenu(page, 'calendar');

    await page.locator('#start-intent_submission').fill(shift(now, -30));
    await page.locator('#end-intent_submission').fill(shift(now, -5));
    await page.locator('#late-intent_submission').fill(shift(now, 15));
    // หน้ารีเมค (E5) ผูกแถวด้วย testid แล้ว — ป้ายชื่อกิจกรรมมาจาก `coopCalendar.ts`
    // และถูกเปลี่ยนถ้อยคำไปแล้ว การหาแถวด้วยข้อความจึงเปราะโดยไม่ได้ทดสอบอะไรเพิ่ม
    const row = page.getByTestId('calendar-row-intent_submission');
    await row.getByTestId('calendar-save').click();

    await expect(page.getByText(/บันทึกช่วงเวลาของ .* เรียบร้อยแล้ว/)).toBeVisible();
    // ป้ายต้องบอกผลด้วยว่าใบที่เข้ามาช่วงนี้นับเป็นส่งช้า ไม่ใช่แค่ “ผ่อนผัน”
    await expect(row.getByText('ผ่อนผัน (รับแต่นับเป็นส่งช้า)')).toBeVisible();
  });
});
