import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbRows, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import type { AccountKey } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { newStudent, putForm, shift, today, userId } from '../helpers/semesters';

/**
 * รอบพิเศษของปฏิทินสหกิจ (2026-10-18 · `design_special_rounds.md`)
 *
 * เจ้าหน้าที่เปิดให้ "นักศึกษาที่เลือกรายคน" ส่งกิจกรรมที่ติ๊กไว้ได้นอกช่วงปกติ
 *   พ้นช่วง  (closed)   → ผ่านด่าน แต่ **นับเป็นส่งช้า** (บังคับเหตุผล + ปั๊ม `submitted_late`)
 *   ยังไม่ถึง (upcoming) → ผ่านด่าน แต่ **ไม่นับส่งช้า** (ออกปฏิบัติงานก่อนกำหนด)
 *
 * คุม "ใครเห็น / ใครทำได้" ก่อนหน้าตา (สิ่งที่พังเงียบคือสิทธิ์ ไม่ใช่สี):
 *   R1  หน้าจอเจ้าหน้าที่: เปิดรอบผ่าน ConfirmDialog ที่บอกจำนวนคน · ลบผ่านกล่องยืนยัน
 *   R2  พ้นช่วง + อยู่ในรายชื่อ → ผ่านด่านแต่ต้องมีเหตุผล · นอกรายชื่อ 403
 *   R3  ยังไม่ถึงช่วง + อยู่ในรายชื่อ → ผ่านโดยไม่ปั๊มส่งช้า · นอกรายชื่อ 403
 *   R4  วันของรอบคุมจริง — พ้นรอบ / ยังไม่ถึงรอบ 403 · แก้วันแล้วผลเปลี่ยนตามทันที
 *   R5  กิจกรรมที่ไม่ติ๊กยัง 403 (ทั้งสองทิศ)
 *   R6  `weekly_log` ติ๊กไม่ได้ (400) · และต่อให้แถวหลุดเข้าฐาน ด่านก็ไม่ยอมปล่อย
 *   R7  นักศึกษา/บทบาทอื่นสร้าง-แก้-ลบรอบไม่ได้ · ไม่ล็อกอิน 401
 *   R8  `GET /api/calendar` — นักศึกษาไม่เห็นรายชื่อ/หมายเหตุของรอบ ไม่เห็นรอบของคนอื่น
 *   R9  งานปิดใบอัตโนมัติ (`acceptanceAutoClose`) ไม่ปิดใบกลางรอบ
 *   R10 ลง `audit_log` (SEC-07) โดยไม่ใส่ชื่อ/รหัสนักศึกษา
 *
 * เทสต์ตั้งช่วงปฏิทินและรอบลงฐาน/เรียก API ตรง ๆ เพราะคุมวันได้แน่นอนกว่าคลิกผ่าน UI (UI ถูกคุมที่ R1)
 * ข้อมูลทั้งหมดเป็นของปลอม · ⛔ สเปคนี้ยังไม่เคยรัน (เขียนเตรียมไว้ 2026-10-18 — เจ้าของสั่งรันเอง)
 */

const OTHER_CODE = 'SR-OUT-01';
const LATE_REASON = 'ติดภารกิจของคณะจึงยื่นเอกสารหลังช่วงปกติ มติที่ประชุมให้ยื่นในรอบพิเศษได้';

/** ตั้งช่วงของกิจกรรมหนึ่งของภาคที่เปิดอยู่ลงฐานโดยตรง (ชนิดช่วง) */
const setWindow = (activityKey: string, start: string, end: string) =>
  dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, start_date, end_date, created_by)
     SELECT s.semester_id, $1, $2, $3, u.user_id
       FROM coop_semesters s CROSS JOIN users u
      WHERE s.is_active = TRUE AND u.email = 'staff1@test.com'
      LIMIT 1`,
    [activityKey, start, end]
  );

const activeSemesterId = async () =>
  (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')) as number;

/**
 * student1 ไม่มีแถว `students` ใน seed — ต้องสร้างเองถึงจะผ่านด่านโปรไฟล์ไปชนด่านปฏิทินได้
 * `enrollment_year` 2569 กัน DeactivationScheduler ปิดบัญชีกลางเทสต์ (e2e-tests.md ข้อ 12)
 */
async function ensureStudent1Profile(): Promise<number> {
  await dbExec(
    `INSERT INTO students (student_id, student_code, major_id, enrollment_year, first_name, last_name)
     SELECT u.user_id, $1, (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 2569, 'นอกรอบ', 'ทดสอบ'
       FROM users u WHERE u.email = 'student1@test.com'
     ON CONFLICT (student_id) DO NOTHING`,
    [OTHER_CODE]
  );
  return userId('student1@test.com');
}

interface RoundOverrides {
  [key: string]: unknown;
}

/** payload ของรอบที่ผ่านการตรวจทุกข้อ — ทับทีละฟิลด์เพื่อทดสอบข้อที่ไม่ผ่าน */
async function roundBody(over: RoundOverrides = {}): Promise<Record<string, unknown>> {
  const now = await today();
  return {
    semester_id: await activeSemesterId(),
    title: 'รอบพิเศษทดสอบ',
    start_date: shift(now, -1),
    end_date: shift(now, 5),
    note: null,
    activity_keys: ['intent_submission'],
    student_ids: [await userId('student2@test.com')],
    ...over,
  };
}

const createRound = async (request: APIRequestContext, over: RoundOverrides = {}) =>
  request.post(`${API_URL}/calendar/special-rounds`, { data: await roundBody(over) });

const updateRound = async (request: APIRequestContext, roundId: number, over: RoundOverrides = {}) =>
  request.put(`${API_URL}/calendar/special-rounds/${roundId}`, { data: await roundBody(over) });

/** เจ้าหน้าที่เปิดรอบ (ล็อกอินให้เอง) → คืน round_id */
async function openRound(request: APIRequestContext, over: RoundOverrides = {}): Promise<number> {
  await apiLoginAs(request, 'staff1');
  const res = await createRound(request, over);
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).round.round_id as number;
}

/**
 * ยื่นใบความจำนงไปบริษัทในทำเนียบ — คืน response ดิบให้เทสต์ตรวจเอง
 * ⛔ ห้าม hardcode company_id (seeder ลบแล้วสร้างใหม่ทุกครั้ง · SERIAL เดินไปเรื่อย ๆ)
 */
const submitIntent = async (request: APIRequestContext, body: Record<string, unknown> = {}) => {
  const semester = await (await request.get(`${API_URL}/semesters/active`)).json();
  const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
  return request.post(`${API_URL}/intents`, {
    data: { company_id: companyId, semester_id: semester.semester_id, ...body },
  });
};

const formCount = async () => Number(await dbValue<string>('SELECT COUNT(*) FROM intent_forms'));

test.describe('รอบพิเศษของปฏิทินสหกิจ', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");',
      })
    );
    await seedTestData();
  });

  test('R1: เจ้าหน้าที่เปิดรอบผ่านการ์ด — ConfirmDialog บอกจำนวนคน · ยกเลิกแล้วไม่เขียนฐาน · ลบผ่านกล่องยืนยัน', async ({
    page,
  }) => {
    const now = await today();
    const code = (await dbValue<string>(
      `SELECT student_code FROM students WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')`
    )) as string;
    const title = 'รอบพิเศษส่งคำร้อง ทดสอบหน้าจอ';
    const roundCount = async () => Number(await dbValue<string>('SELECT COUNT(*) FROM coop_special_rounds'));

    await loginAs(page, 'staff1');
    await goToMenu(page, 'calendar');

    const card = page.getByTestId('special-rounds');
    await expect(card).toBeVisible();
    await expect(card.getByText('ยังไม่มีรอบพิเศษในภาคการศึกษานี้')).toBeVisible();
    // ช่องติ๊กมีเฉพาะกิจกรรมที่ล็อกจริงและไม่ได้คำนวณจากกิจกรรมอื่น — weekly_log ต้องไม่มีให้ติ๊ก
    await expect(card.getByTestId('special-round-activity-intent_submission')).toBeVisible();
    await expect(card.getByTestId('special-round-activity-weekly_log')).toHaveCount(0);

    await card.getByTestId('special-round-title').fill(title);
    await card.locator('#special-start').fill(shift(now, -1));
    await card.locator('#special-end').fill(shift(now, 7));
    await card.getByTestId('special-round-activity-intent_submission').check();
    await card.getByTestId('special-round-search').fill(code);
    await card.getByTestId('special-round-search').press('Enter');
    await card.getByTestId(`special-round-add-${code}`).click();

    // 1) กดเปิดแล้วเปลี่ยนใจ — ต้องยังไม่มีอะไรลงฐาน
    await card.getByTestId('special-round-save').click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'ยืนยันการเปิดรอบพิเศษ' });
    await expect(confirm).toContainText(title);
    await expect(confirm).toContainText('นักศึกษา 1 คน');
    await expect(confirm).toContainText('ส่งก่อนช่วงเปิดไม่นับส่งช้า');
    await expect(confirm).toContainText('ส่งหลังช่วงปิดนับเป็นส่งช้า');
    await confirm.getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(confirm).toBeHidden();
    expect(await roundCount()).toBe(0);

    // 2) ยืนยันจริง
    await card.getByTestId('special-round-save').click();
    await confirm.getByRole('button', { name: 'เปิดรอบพิเศษ' }).click();
    await expect(page.getByText(`เปิดรอบพิเศษ "${title}" ให้นักศึกษา 1 คนเรียบร้อยแล้ว`)).toBeVisible();
    await expect(card.getByTestId('special-round-row')).toHaveCount(1);
    await expect(card.getByTestId('special-round-row')).toContainText(title);
    await expect(card.getByTestId('special-round-row')).toContainText('กำลังเปิด');

    expect(await roundCount()).toBe(1);
    const saved = await dbRow<{ activities: string[]; students: number }>(
      `SELECT (SELECT array_agg(activity_key) FROM coop_special_round_activities) AS activities,
              (SELECT COUNT(*)::int FROM coop_special_round_students) AS students`
    );
    expect(saved?.activities).toEqual(['intent_submission']);
    expect(saved?.students).toBe(1);

    // 3) ลบ — กล่องยืนยันต้องบอกชื่อรอบและจำนวนคนที่จะกลับไปโดนด่านปกติ
    await card.getByRole('button', { name: `ลบรอบ ${title}` }).click();
    const del = page.getByRole('dialog').filter({ hasText: 'ยืนยันการลบรอบพิเศษ' });
    await expect(del).toContainText(title);
    await expect(del).toContainText('นักศึกษา 1 คน');
    await del.getByRole('button', { name: 'ลบรอบพิเศษ' }).click();
    await expect(page.getByText(`ลบรอบพิเศษ "${title}" เรียบร้อยแล้ว`)).toBeVisible();
    await expect(card.getByTestId('special-round-row')).toHaveCount(0);
    expect(await roundCount()).toBe(0);
  });

  test('R2: พ้นช่วงปกติ — นอกรายชื่อ 403 · ในรายชื่อผ่านด่านแต่ต้องชี้แจงเหตุผล (นับส่งช้า)', async ({ request }) => {
    await ensureStudent1Profile();
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -30));
    const s2 = await userId('student2@test.com');
    await openRound(request, { student_ids: [s2], activity_keys: ['intent_submission'] });

    // นอกรายชื่อ: ด่านปฏิทินปกติ + ข้อความพาไปทางรอบพิเศษ
    await apiLoginAs(request, 'student1');
    const outsider = await submitIntent(request);
    expect(outsider.status()).toBe(403);
    const outsiderMessage = (await outsider.json()).message as string;
    expect(outsiderMessage).toContain('หมดช่วง');
    expect(outsiderMessage).toContain('รอบพิเศษ');
    expect(await formCount()).toBe(0);

    await apiLoginAs(request, 'student2');
    // ผ่านด่านปฏิทินแล้ว (ไม่ใช่ 403) แต่ไม่ชี้แจง = 400 และต้องไม่มีใบเกิดขึ้น
    const noReason = await submitIntent(request);
    expect(noReason.status(), await noReason.text()).toBe(400);
    expect((await noReason.json()).message as string).toContain('ส่งช้า');
    const tooShort = await submitIntent(request, { late_reason: 'สั้นไป' });
    expect(tooShort.status()).toBe(400);
    expect(await formCount()).toBe(0);

    // ชี้แจงแล้ว → รับ + ปั๊มธงส่งช้าลงฐาน
    const ok = await submitIntent(request, { late_reason: LATE_REASON });
    expect(ok.status(), await ok.text()).toBe(201);
    const row = await dbRow<{ submitted_late: boolean; late_reason: string }>(
      'SELECT submitted_late, late_reason FROM intent_forms WHERE student_id = $1',
      [s2]
    );
    expect(row?.submitted_late).toBe(true);
    expect(row?.late_reason).toBe(LATE_REASON);
  });

  test('R3: ยังไม่ถึงช่วง (ออกก่อนกำหนด) — ในรายชื่อผ่านโดยไม่ถูกนับส่งช้า · นอกรายชื่อ 403', async ({ request }) => {
    await ensureStudent1Profile();
    const now = await today();
    await setWindow('intent_submission', shift(now, 30), shift(now, 60));
    const s2 = await userId('student2@test.com');
    await openRound(request, { student_ids: [s2], activity_keys: ['intent_submission'] });

    await apiLoginAs(request, 'student1');
    const outsider = await submitIntent(request);
    expect(outsider.status()).toBe(403);
    const outsiderMessage = (await outsider.json()).message as string;
    expect(outsiderMessage).toContain('ยังไม่ถึงช่วง');
    expect(outsiderMessage).not.toContain('หมดช่วง');

    // ⛔ ส่งก่อนช่วงเปิดไม่ใช่ส่งช้า — ไม่ต้องกรอกเหตุผล และห้ามปั๊มธง
    await apiLoginAs(request, 'student2');
    const ok = await submitIntent(request);
    expect(ok.status(), await ok.text()).toBe(201);
    const row = await dbRow<{ submitted_late: boolean; late_reason: string | null }>(
      'SELECT submitted_late, late_reason FROM intent_forms WHERE student_id = $1',
      [s2]
    );
    expect(row?.submitted_late).toBe(false);
    expect(row?.late_reason).toBeNull();
  });

  test('R4: วันของรอบคุมจริง — พ้นรอบ/ยังไม่ถึงรอบ 403 · แก้วันแล้วผลเปลี่ยนทันที · ลบรอบแล้วกลับไปโดนด่านปกติ', async ({
    request,
  }) => {
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -30));

    // รอบจบไปแล้ว
    const roundId = await openRound(request, { start_date: shift(now, -10), end_date: shift(now, -5) });
    await apiLoginAs(request, 'student2');
    let res = await submitIntent(request);
    expect(res.status()).toBe(403);
    expect((await res.json()).message as string).toContain('หมดช่วง');

    // รอบยังไม่เริ่ม
    await apiLoginAs(request, 'staff1');
    expect((await updateRound(request, roundId, { start_date: shift(now, 5), end_date: shift(now, 10) })).status()).toBe(200);
    await apiLoginAs(request, 'student2');
    expect((await submitIntent(request)).status()).toBe(403);

    // รอบครอบวันนี้ (วันสุดท้ายนับรวม) → ผ่านด่าน (ติดเรื่องเหตุผลส่งช้า = 400 ไม่ใช่ 403)
    await apiLoginAs(request, 'staff1');
    expect((await updateRound(request, roundId, { start_date: shift(now, -3), end_date: now })).status()).toBe(200);
    await apiLoginAs(request, 'student2');
    res = await submitIntent(request);
    expect(res.status(), await res.text()).toBe(400);
    expect((await res.json()).message as string).toContain('ส่งช้า');

    // เจ้าหน้าที่ลบรอบ → นักศึกษากลับไปโดนด่านปกติทันที
    await apiLoginAs(request, 'staff1');
    expect((await request.delete(`${API_URL}/calendar/special-rounds/${roundId}`)).status()).toBe(200);
    await apiLoginAs(request, 'student2');
    res = await submitIntent(request, { late_reason: LATE_REASON });
    expect(res.status()).toBe(403);
    expect(await formCount()).toBe(0);
  });

  test('R5: กิจกรรมที่ไม่ติ๊กยัง 403 ระหว่างรอบ — ติ๊กอันไหนผ่านเฉพาะอันนั้น', async ({ request }) => {
    const now = await today();
    await setWindow('intent_submission', shift(now, -60), shift(now, -30));
    await setWindow('accommodation_plan', shift(now, -60), shift(now, -30));
    const s2 = await userId('student2@test.com');
    const accommodation = () =>
      request.post(`${API_URL}/students/${s2}/accommodation-plan`, { data: {} });

    // ติ๊กที่พักอย่างเดียว: ยื่นคำร้อง 403 · ที่พักผ่านด่านปฏิทิน (อาจตกด่านข้อมูล แต่ต้องไม่พูดเรื่องช่วงเวลา)
    const roundId = await openRound(request, { activity_keys: ['accommodation_plan'] });
    await apiLoginAs(request, 'student2');
    const blocked = await submitIntent(request);
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).message as string).toContain('หมดช่วง');
    const passed = await accommodation();
    const passedBody = await passed.text();
    expect(passedBody).not.toContain('หมดช่วง');
    expect(passedBody).not.toContain('ยังไม่ถึงช่วง');

    // สลับไปติ๊กยื่นคำร้องอย่างเดียว: กลับด้าน
    await apiLoginAs(request, 'staff1');
    expect((await updateRound(request, roundId, { activity_keys: ['intent_submission'] })).status()).toBe(200);
    await apiLoginAs(request, 'student2');
    const nowOpen = await submitIntent(request);
    expect(nowOpen.status(), await nowOpen.text()).toBe(400); // ผ่านด่านปฏิทิน ติดแค่เหตุผลส่งช้า
    expect((await nowOpen.json()).message as string).toContain('ส่งช้า');
    const nowBlocked = await accommodation();
    expect(nowBlocked.status()).toBe(403);
    expect((await nowBlocked.json()).message as string).toContain('หมดช่วง');
  });

  test('R6: weekly_log ติ๊กไม่ได้ (400) · ค่าที่ผิดทุกแบบถูกปฏิเสธก่อนเขียนฐาน · แถวที่หลุดเข้าฐานก็ไม่เปิดด่าน', async ({
    request,
  }) => {
    const now = await today();
    const s2 = await userId('student2@test.com');
    await apiLoginAs(request, 'staff1');

    const cases: Array<[string, RoundOverrides, string]> = [
      ['weekly_log (ช่วงคำนวณจากวันเริ่ม-สิ้นสุดการปฏิบัติงาน)', { activity_keys: ['weekly_log'] }, 'เปิดรอบพิเศษไม่ได้'],
      ['coop_start (หมุดบอกเวลา ไม่ล็อกอะไร)', { activity_keys: ['coop_start'] }, 'เปิดรอบพิเศษไม่ได้'],
      ['กิจกรรมที่ไม่มีอยู่จริง', { activity_keys: ['made_up_activity'] }, 'ไม่รู้จัก'],
      ['ไม่ติ๊กกิจกรรมเลย', { activity_keys: [] }, 'กิจกรรม'],
      ['ไม่เลือกนักศึกษาเลย', { student_ids: [] }, 'นักศึกษา'],
      ['นักศึกษาที่ไม่มีอยู่ในระบบ', { student_ids: [s2, 999999] }, 'ไม่มีอยู่ในระบบ'],
      ['วันสิ้นสุดมาก่อนวันเริ่ม', { start_date: shift(now, 5), end_date: shift(now, 1) }, 'ไม่มาก่อนวันเริ่ม'],
      ['ปี พ.ศ.', { start_date: '2569-10-20', end_date: '2569-10-25' }, 'ค.ศ.'],
      ['ชื่อรอบว่าง', { title: '   ' }, 'ชื่อ'],
    ];
    for (const [label, over, expected] of cases) {
      const res = await createRound(request, over);
      expect(res.status(), `${label}: ${await res.text()}`).toBe(400);
      expect((await res.json()).message as string, label).toContain(expected);
    }
    expect(Number(await dbValue<string>('SELECT COUNT(*) FROM coop_special_rounds'))).toBe(0);

    // ภาคที่ไม่ส่ง = 400 · ภาคที่ไม่มีอยู่ = 404 · แก้/ลบรอบที่ไม่มี = 404
    expect((await createRound(request, { semester_id: undefined })).status()).toBe(400);
    expect((await createRound(request, { semester_id: 999999 })).status()).toBe(404);
    expect((await updateRound(request, 999999)).status()).toBe(404);
    expect((await request.delete(`${API_URL}/calendar/special-rounds/999999`)).status()).toBe(404);

    // PUT ที่ข้อมูลผิดต้องไม่แตะรอบเดิม
    const roundId = await openRound(request, { title: 'รอบเดิม' });
    expect((await updateRound(request, roundId, { title: 'ชื่อใหม่', activity_keys: ['weekly_log'] })).status()).toBe(400);
    expect(await dbValue<string>('SELECT title FROM coop_special_rounds WHERE round_id = $1', [roundId])).toBe('รอบเดิม');

    // ด่านลึกสุด: แถว weekly_log หลุดเข้าฐานเอง (ข้าม validation) ด่านปฏิทินก็ต้องไม่ยอมเปิด
    await dbExec(
      `INSERT INTO coop_special_round_activities (round_id, activity_key) VALUES ($1, 'weekly_log')`,
      [roundId]
    );
    const semesterId = await activeSemesterId();
    const setSingle = (key: string, date: string) =>
      request.post(`${API_URL}/calendar`, { data: { semester_id: semesterId, activity_key: key, start_date: date } });
    await apiLoginAs(request, 'staff1');
    expect((await setSingle('coop_start', shift(now, -30))).status()).toBe(201);
    expect((await setSingle('coop_end', shift(now, -1))).status()).toBe(201);
    await apiLoginAs(request, 'student2');
    const blocked = await request.post(`${API_URL}/weekly-logs`, {
      data: { week_number: 1, work_description: 'x', problems: '', solutions: '' },
    });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).message as string).toContain('บันทึกการปฏิบัติงานรายสัปดาห์');
  });

  test('R7: สิทธิ์ — นักศึกษา/อาจารย์/หัวหน้าสาขา/คณบดี/พี่เลี้ยงสร้าง-แก้-ลบ-ค้นรายชื่อไม่ได้ · ไม่ล็อกอิน 401', async ({
    request,
  }) => {
    const roundId = await openRound(request, { title: 'รอบของเจ้าหน้าที่' });
    const before = await dbRow(
      'SELECT title, start_date::text, end_date::text FROM coop_special_rounds WHERE round_id = $1',
      [roundId]
    );

    const intruders: AccountKey[] = ['student2', 'advisor1', 'head1', 'dean1', 'mentor1'];
    for (const who of intruders) {
      await apiLoginAs(request, who);
      const attempts: Record<string, number> = {
        สร้าง: (await createRound(request, { title: `รอบของ ${who}` })).status(),
        แก้: (await updateRound(request, roundId, { title: `แก้โดย ${who}` })).status(),
        ลบ: (await request.delete(`${API_URL}/calendar/special-rounds/${roundId}`)).status(),
        ค้นรายชื่อ: (await request.get(`${API_URL}/calendar/special-rounds/students?q=${OTHER_CODE}`)).status(),
        รายการบันทึก: (await request.get(`${API_URL}/calendar/special-rounds/memos`)).status(),
      };
      for (const [action, status] of Object.entries(attempts)) {
        expect(status, `${who} ${action}`).toBe(403);
      }
    }

    // ไม่มีอะไรเปลี่ยน
    expect(
      await dbRow('SELECT title, start_date::text, end_date::text FROM coop_special_rounds WHERE round_id = $1', [roundId])
    ).toEqual(before);
    expect(Number(await dbValue<string>('SELECT COUNT(*) FROM coop_special_rounds'))).toBe(1);

    // ไม่ล็อกอิน (ส่ง Cookie ว่างทับ jar เหมือน coop-calendar C7)
    const anon = { headers: { Cookie: '' } };
    expect((await request.post(`${API_URL}/calendar/special-rounds`, { ...anon, data: await roundBody() })).status()).toBe(401);
    expect((await request.delete(`${API_URL}/calendar/special-rounds/${roundId}`, anon)).status()).toBe(401);

    // เจ้าหน้าที่ทำได้ — ตัวควบคุมว่าข้างบน 403 เพราะบทบาทจริง ไม่ใช่เพราะ payload ผิด
    await apiLoginAs(request, 'staff1');
    expect((await updateRound(request, roundId, { title: 'แก้โดยเจ้าหน้าที่' })).status()).toBe(200);
    const found = await request.get(`${API_URL}/calendar/special-rounds/students?q=student`);
    expect(found.status()).toBe(200);
  });

  test('R8: GET /api/calendar — นักศึกษาเห็นเฉพาะรอบของตัวเอง ไม่เห็นรายชื่อคนอื่น/หมายเหตุภายใน · บทบาทอื่นไม่เห็นเลย', async ({
    request,
  }) => {
    const s1 = await ensureStudent1Profile();
    const s2 = await userId('student2@test.com');
    const other = await newStudent();
    const otherId = await userId(other.email);
    const now = await today();

    // A = เปิดอยู่ · s2 + คนอื่น · มีหมายเหตุภายใน   C = ยังไม่เริ่ม · s2   B = ของ student1 อย่างเดียว
    await openRound(request, {
      title: 'รอบ A เปิดอยู่',
      note: 'หมายเหตุภายในของคณะ',
      activity_keys: ['intent_submission', 'accommodation_plan'],
      student_ids: [s2, otherId],
    });
    await createRound(request, {
      title: 'รอบ C ยังไม่เริ่ม',
      start_date: shift(now, 3),
      end_date: shift(now, 6),
      activity_keys: ['final_report'],
      student_ids: [s2],
    });
    const b = await createRound(request, {
      title: 'รอบของคนอื่น',
      activity_keys: ['report_outline'],
      student_ids: [s1],
    });
    expect(b.status(), await b.text()).toBe(201);

    // --- นักศึกษา (อยู่ในรอบ A และ C) ---
    await apiLoginAs(request, 'student2');
    const mineRes = await request.get(`${API_URL}/calendar`);
    const mineText = await mineRes.text();
    const mine = JSON.parse(mineText);
    expect(mine.special_rounds.map((r: { title: string }) => r.title)).toEqual(['รอบ A เปิดอยู่', 'รอบ C ยังไม่เริ่ม']);
    // ฟิลด์ที่นักศึกษาเห็นมีแค่นี้ — ไม่มี students / note / created_by
    for (const r of mine.special_rounds) {
      expect(Object.keys(r).sort()).toEqual(['activity_keys', 'end_date', 'round_id', 'start_date', 'status', 'title']);
    }
    expect(mine.special_rounds.map((r: { status: string }) => r.status)).toEqual(['open', 'upcoming']);
    // ⛔ ไม่รั่ว: รหัส/ชื่อของคนอื่น · ชื่อรอบของคนอื่น · หมายเหตุภายใน
    for (const leaked of [other.code, OTHER_CODE, 'รอบของคนอื่น', 'หมายเหตุภายในของคณะ']) {
      expect(mineText, `ต้องไม่มี "${leaked}" ในคำตอบของนักศึกษา`).not.toContain(leaked);
    }
    // special_round_open: ติ๊กและรอบเปิดอยู่เท่านั้น (final_report อยู่ในรอบ C ที่ยังไม่เริ่ม = false)
    const openOf = (cal: { activities: Array<{ activity_key: string; special_round_open: boolean }> }, key: string) =>
      cal.activities.find((a) => a.activity_key === key)?.special_round_open;
    expect(openOf(mine, 'intent_submission')).toBe(true);
    expect(openOf(mine, 'accommodation_plan')).toBe(true);
    expect(openOf(mine, 'final_report')).toBe(false);
    expect(openOf(mine, 'report_outline')).toBe(false);
    for (const a of mine.activities) expect(typeof a.special_round_open).toBe('boolean');

    // --- student1 เห็นแค่รอบ B ---
    await apiLoginAs(request, 'student1');
    const theirs = await (await request.get(`${API_URL}/calendar`)).json();
    expect(theirs.special_rounds.map((r: { title: string }) => r.title)).toEqual(['รอบของคนอื่น']);
    expect(openOf(theirs, 'report_outline')).toBe(true);
    expect(openOf(theirs, 'intent_submission')).toBe(false);

    // --- เจ้าหน้าที่เห็นครบทุกรอบพร้อมรายชื่อและหมายเหตุ ---
    await apiLoginAs(request, 'staff1');
    const staffView = await (await request.get(`${API_URL}/calendar`)).json();
    expect(staffView.special_rounds).toHaveLength(3);
    const roundA = staffView.special_rounds.find((r: { title: string }) => r.title === 'รอบ A เปิดอยู่');
    expect(roundA.note).toBe('หมายเหตุภายในของคณะ');
    expect(roundA.students.map((s: { student_code: string }) => s.student_code)).toContain(other.code);
    expect(roundA.students).toHaveLength(2);
    expect(staffView.activities.every((a: { special_round_open: boolean }) => a.special_round_open === false)).toBe(true);

    // --- บทบาทอื่นอ่านปฏิทินได้ แต่ไม่เห็นรอบพิเศษเลย ---
    for (const who of ['advisor1', 'dean1'] as const) {
      await apiLoginAs(request, who);
      const cal = await (await request.get(`${API_URL}/calendar`)).json();
      expect(cal.special_rounds, who).toEqual([]);
    }
  });

  test('R9: งานปิดใบอัตโนมัติไม่ปิดใบของคนที่อยู่ในรอบพิเศษ acceptance_form กลางรอบ — พ้นรอบหรือลบรอบแล้วปิดตามปกติ', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    // ⛔ ฟังก์ชันนี้รันในโปรเซสของเทสต์และส่งอีเมลแจ้งนักศึกษา — ต้องเป็น dry-run ก่อน import
    expect(process.env.MAIL_DRY_RUN).toBe('true');
    const { runAcceptanceAutoClose } = await import('../../backend/src/utils/acceptanceAutoClose');

    const now = await today();
    const semesterId = await activeSemesterId();
    const outsider = await newStudent();
    // ปฏิทิน acceptance_form ปิดแล้ว (พ้นช่วงผ่อนผันด้วย)
    await dbExec(
      `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, end_date, late_end_date)
       VALUES ($1, 'acceptance_form', 'deadline', $2::date, $3::date)`,
      [semesterId, shift(now, -10), shift(now, -3)]
    );
    // ใบลงนามแล้วรอแบบตอบรับ 2 ใบ: student2 (ในรอบ) กับนักศึกษาอีกคน (นอกรอบ)
    const inRound = await putForm('student2@test.com', semesterId, 'approved_by_dept_head', 5);
    const notInRound = await putForm(outsider.email, semesterId, 'approved_by_dept_head', 5);
    const statuses = async () => [
      await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [inRound]),
      await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [notInRound]),
    ];

    const roundId = await openRound(request, {
      activity_keys: ['acceptance_form'],
      student_ids: [await userId('student2@test.com')],
    });

    // กลางรอบ: ปิดเฉพาะใบนอกรอบ
    expect(await runAcceptanceAutoClose()).toBe(1);
    expect(await statuses()).toEqual(['approved_by_dept_head', 'rejected']);
    // รันซ้ำก็ยังไม่แตะใบในรอบ
    expect(await runAcceptanceAutoClose()).toBe(0);
    expect(await statuses()).toEqual(['approved_by_dept_head', 'rejected']);

    // รอบถูกลบ → ใบที่เหลือเข้าเงื่อนไขปิดตามปกติ
    await apiLoginAs(request, 'staff1');
    expect((await request.delete(`${API_URL}/calendar/special-rounds/${roundId}`)).status()).toBe(200);
    expect(await runAcceptanceAutoClose()).toBe(1);
    expect(await statuses()).toEqual(['rejected', 'rejected']);
  });

  test('R10: เปิด/แก้/ลบรอบลง audit_log (SEC-07) โดยไม่ใส่ชื่อหรือรหัสนักศึกษา', async ({ request }) => {
    const s2 = await userId('student2@test.com');
    const student = await dbRow<{ student_code: string; first_name: string }>(
      'SELECT student_code, first_name FROM students WHERE student_id = $1',
      [s2]
    );
    const roundId = await openRound(request, { title: 'รอบตรวจ audit' });
    expect((await updateRound(request, roundId, { title: 'รอบตรวจ audit (แก้)' })).status()).toBe(200);
    expect((await request.delete(`${API_URL}/calendar/special-rounds/${roundId}`)).status()).toBe(200);

    // writeAudit เป็น fire-and-forget — ลงหลัง response จึงต้อง poll
    for (const action of ['created', 'updated', 'deleted']) {
      await expect
        .poll(
          async () =>
            await dbValue<string>(
              `SELECT COUNT(*) FROM audit_log WHERE action = $1 AND entity_id = $2`,
              [`coop_special_round.${action}`, String(roundId)]
            ),
          { timeout: 5_000, message: `audit coop_special_round.${action}` }
        )
        .toBe('1');
    }
    const details = await dbRows<{ detail: unknown }>(
      `SELECT detail FROM audit_log WHERE action LIKE 'coop_special_round.%' AND entity_id = $1`,
      [String(roundId)]
    );
    const detailText = JSON.stringify(details.map((d) => d.detail));
    expect(detailText).toContain('"student_count":1');
    expect(student?.student_code).toBeTruthy();
    expect(detailText).not.toContain(student!.student_code);
    if (student?.first_name) expect(detailText).not.toContain(student.first_name);
  });
});
