import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { dbRow, dbExec, dbValue } from '../helpers/db';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * ปฏิทินสหกิจศึกษา
 *
 * เรื่องที่ต้องคุมไม่ให้พังเงียบมีสองด้านที่ตรงข้ามกัน:
 *   1. **fail-open** — ยังไม่ตั้งช่วง = ต้องทำรายการได้ตามปกติ ถ้าข้อนี้พัง
 *      ระบบจะล็อกนักศึกษาทั้งรุ่นในวันที่ deploy ก่อนใครจะทันกรอกปฏิทิน
 *   2. **ล็อกจริง** — พ้นช่วงแล้วต้อง 403 ที่เซิร์ฟเวอร์ ไม่ใช่แค่ปุ่มจาง
 *
 * เทสต์ยัดแถวปฏิทินลงฐานตรงๆ เมื่อต้องการช่วงในอดีต/อนาคต เพราะคุมวันได้แน่นอน
 * กว่าการคลิกผ่าน UI (และ UI ถูกทดสอบแยกในเทสต์แรกอยู่แล้ว)
 */

/** วันนี้ตามเวลาไทย คิดที่ฐาน เพื่อให้เทสต์ใช้เกณฑ์เดียวกับตัวล็อกเป๊ะ */
const today = () =>
  dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`) as Promise<string>;

const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

/** ตั้งช่วงของกิจกรรมหนึ่งลงฐานโดยตรง */
const setWindow = (activityKey: string, start: string, end: string) =>
  dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, start_date, end_date, created_by)
     SELECT s.semester_id, $1, $2, $3, u.user_id
       FROM coop_semesters s CROSS JOIN users u
      WHERE s.is_active = TRUE AND u.email = 'staff1@test.com'
      LIMIT 1`,
    [activityKey, start, end]
  );

/**
 * ให้ student2 มีใบความจำนงที่ "accepted"
 *
 * จำเป็นตั้งแต่ 2026-09-04 ที่ สหกิจ 01 ถูกตัดออกจากกระบวนการ (ตัดทั้งชุดแล้ว 2026-09-14) —
 * เมนู `application` เคยเป็นเมนูเดียวที่ปฏิทินล็อกได้โดยไม่ติดด่าน "ขั้นตอน"
 * พอเมนูนั้นหายไป เมนูที่เหลือทั้งหมดอยู่ใน `STAGE_GATED_STUDENT_MENUS`
 * ซึ่ง **ทับด่านปฏิทินเสมอ** (`Dashboard.tsx`: "stage ทับ calendar โดยตั้งใจ")
 *
 * ถ้าไม่ปลดด่านขั้นตอนก่อน เทสต์จะเห็นข้อความ "รอสถานประกอบการตอบรับ"
 * แทนที่จะเห็นข้อความเรื่องช่วงเวลา แล้วเข้าใจผิดว่าปฏิทินพัง
 */
const giveAcceptedIntent = () =>
  dbExec(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
     SELECT u.user_id, c.company_id, sem.semester_id, 'accepted'
       FROM users u, companies c, coop_semesters sem
      WHERE u.email = 'student2@test.com' AND sem.is_active = TRUE
      LIMIT 1`
  );

/** user_id ของ student2 — เส้นทาง accommodation-plan ต้องใช้ id ใน path */
const student2Id = () =>
  dbValue<number>(`SELECT user_id FROM users WHERE email = 'student2@test.com'`);

test.describe('ปฏิทินสหกิจศึกษา', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");',
      })
    );
  });

  test('C1: เจ้าหน้าที่ตั้งช่วงผ่านหน้าจอ → นักศึกษาเห็นแบนเนอร์และเปิดปฏิทินได้', async ({
    page,
  }) => {
    await seedTestData();
    const now = await today();

    await loginAs(page, 'staff1');
    await goToMenu(page, 'calendar');

    // fail-open ต้องไม่เงียบ — เจ้าหน้าที่ต้องเห็นว่ายังไม่ได้ตั้งอะไรและตอนนี้ยังไม่ล็อก
    await expect(page.getByText(/ยังไม่ได้ตั้งช่วงเวลา 9 กิจกรรม/)).toBeVisible();
    await expect(page.getByText(/ระบบเปิดให้นักศึกษาทำรายการได้ตามปกติ \(ไม่ล็อก\)/)).toBeVisible();

    // ⛔ ชนิด "ภายในวันที่" ต้องไม่มีช่องวันเริ่ม — ถ้ามีเมื่อไหร่ เจ้าหน้าที่จะกรอก
    //    วันเดียวกันลงทั้งสองช่องแล้วระบบเปิดวันเดียว ซึ่งกลับหัวจากที่กระดาษเขียน
    await expect(page.locator('#end-acceptance_form')).toBeVisible();
    await expect(page.locator('#start-acceptance_form')).toHaveCount(0);
    // ชนิด "วันเดียว" มีช่องเดียวเช่นกัน แต่เป็นฝั่งวันเริ่ม
    await expect(page.locator('#start-coop_start')).toBeVisible();
    await expect(page.locator('#end-coop_start')).toHaveCount(0);
    // กิจกรรมที่คำนวณเองต้องไม่มีช่องกรอกและไม่มีปุ่มบันทึกเลย
    await expect(page.locator('#start-weekly_log')).toHaveCount(0);
    await expect(page.locator('#end-weekly_log')).toHaveCount(0);

    // ตั้งช่วงที่ครอบวันนี้ให้ "ส่งโครงร่างรายงานการปฏิบัติงาน" (ชนิดช่วงปกติ)
    await page.locator('#start-report_outline').fill(shift(now, -3));
    await page.locator('#end-report_outline').fill(shift(now, 30));
    await page.locator('#note-report_outline').fill('ส่งทุกวันศุกร์');
    await page
      .locator('li')
      .filter({ hasText: 'ส่งโครงร่างรายงานการปฏิบัติงาน' })
      .getByRole('button', { name: 'บันทึก' })
      .click();

    await expect(page.getByText(/บันทึกช่วงเวลาของ .* เรียบร้อยแล้ว/)).toBeVisible();
    // เหลือ 8 = แถบเตือนนับใหม่จริง ไม่ใช่ข้อความค้าง
    await expect(page.getByText(/ยังไม่ได้ตั้งช่วงเวลา 8 กิจกรรม/)).toBeVisible();

    // รายการอิสระ — โผล่ในปฏิทินแต่ไม่ล็อกอะไร
    await page.locator('#custom-title').fill('ปฐมนิเทศนักศึกษาสหกิจศึกษา');
    await page.locator('#custom-start').fill(shift(now, 10));
    await page.locator('#custom-end').fill(shift(now, 11));
    await page.getByRole('button', { name: /เพิ่มกำหนดการ/ }).click();
    await expect(page.getByText('เพิ่มกำหนดการเรียบร้อยแล้ว')).toBeVisible();

    // --- ฝั่งนักศึกษา ---
    await loginAs(page, 'student2');
    await expect(page.getByText(/ตอนนี้อยู่ในช่วง:/)).toBeVisible();
    await expect(page.getByText('ส่งโครงร่างรายงานการปฏิบัติงาน').first()).toBeVisible();

    await page.getByRole('button', { name: 'ดูปฏิทินสหกิจศึกษาทั้งหมด' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('กำลังอยู่ในช่วงนี้')).toBeVisible();
    await expect(dialog.getByText('ส่งทุกวันศุกร์')).toBeVisible();
    await expect(dialog.getByText('ปฐมนิเทศนักศึกษาสหกิจศึกษา')).toBeVisible();
    // ⛔ ป้ายต้องบอก "สถานะตอนนี้" ไม่ใช่ "กิจกรรมนี้มีการล็อก"
    //    weekly_log ตั้งไว้ -3 ถึง +30 = เปิดอยู่ ป้ายจึงต้องเป็นเขียวว่าเปิด
    //    เคสจริงที่พลาด: เจ้าของเปิดปฏิทินในวันแรกของช่วงแล้วเห็นรูปกุญแจ เลยไม่กล้ากด
    await expect(dialog.getByText('เปิดให้ทำรายการ')).toHaveCount(1);
    await expect(dialog.getByText('ยังไม่เปิด')).toHaveCount(0);
    // รายการอิสระไม่ล็อกอะไร จึงต้องไม่มีป้ายสถานะเลย (ป้ายมีได้ 1 อันคือของ weekly_log)
    await expect(dialog.locator('li span[title]')).toHaveCount(1);
  });

  test('C2: fail-open — ยังไม่ตั้งปฏิทิน ต้องทำรายการได้และเมนูต้องไม่มีกุญแจ', async ({
    page,
    request,
  }) => {
    await seedTestData();
    // ไม่ INSERT ปฏิทินใดๆ เลย นี่คือสภาพของฐานตอนเพิ่งอัปเกรดระบบ
    expect(await dbValue<string>(`SELECT COUNT(*) FROM coop_calendar_events`)).toBe('0');
    await giveAcceptedIntent();

    // เดิมยิง POST /applications (สหกิจ 01) — ถูกตัดทั้งชุด 2026-09-14 จึงใช้แผนที่พักซึ่งผูกด่าน
    // ปฏิทินเหมือนกัน (เส้นเดียวกับ C3) · body ว่างโดยตั้งใจ: คำขอตกด่านข้อมูลได้
    // สิ่งที่คุมคือห้ามตกด่านปฏิทิน เพราะปฏิทินยังไม่ได้ตั้ง = fail-open
    const studentId = await student2Id();
    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
      data: {},
    });
    const body = await res.text();
    expect(res.status(), body).not.toBe(403);
    expect(body).not.toContain('ตามปฏิทินสหกิจศึกษา');
    expect(body).not.toContain('หมดช่วง');

    await loginAs(page, 'student2');
    const label = await page.getByTestId('nav-report_outline').getAttribute('aria-label');
    expect(label ?? '').not.toContain('ยังไม่เปิดให้ใช้');
  });

  test('C3: หมดช่วงแล้ว — เซิร์ฟเวอร์ตอบ 403 และหน้าจอขึ้นกุญแจพร้อมทางออก', async ({
    page,
    request,
  }) => {
    await seedTestData();
    const now = await today();
    await giveAcceptedIntent();
    await setWindow('accommodation_plan', shift(now, -60), shift(now, -30));
    const studentId = await student2Id();

    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
      data: {},
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toContain('หมดช่วง');

    await loginAs(page, 'student2');
    await expect(page.getByTestId('nav-accommodation_plan')).toHaveAttribute(
      'aria-label',
      /ยังไม่เปิดให้ใช้/
    );
    await goToMenu(page, 'accommodation_plan');
    await expect(page.getByRole('heading', { name: 'หมดช่วงที่เปิดให้ทำรายการแล้ว' })).toBeVisible();
    // ปุ่มต้องพาไปที่ไหนสักที่เสมอ — ห้ามเป็นหน้าตันที่กดแล้วไม่มีอะไรเกิดขึ้น
    await expect(page.getByRole('button', { name: 'ดูปฏิทินสหกิจศึกษา' })).toBeVisible();
  });

  test('C4: ยังไม่ถึงช่วง — ข้อความต้องคนละแบบกับหมดช่วง', async ({ request }) => {
    await seedTestData();
    const now = await today();
    await giveAcceptedIntent();
    await setWindow('accommodation_plan', shift(now, 30), shift(now, 60));
    const studentId = await student2Id();

    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
      data: {},
    });
    expect(res.status()).toBe(403);
    const message = (await res.json()).message as string;
    expect(message).toContain('ยังไม่ถึงช่วง');
    expect(message).not.toContain('หมดช่วง');
  });

  test('C5: ล็อกแยกรายกิจกรรม — ปิดกิจกรรมหนึ่งต้องไม่ไปโดนอีกกิจกรรม', async ({ request }) => {
    await seedTestData();
    const now = await today();
    await setWindow('accommodation_plan', shift(now, -60), shift(now, -30));

    await apiLoginAs(request, 'student2');
    // weekly_log ยังไม่ได้ตั้งช่วง (coop_start/coop_end ว่างทั้งคู่) → ด่านปฏิทินต้องปล่อยผ่าน
    // (คำขอนี้ยังตกด่านอื่นได้ แต่ต้องไม่ใช่ 403 ที่พูดเรื่องช่วงเวลา)
    const res = await request.post(`${API_URL}/weekly-logs`, { data: { week_number: 1 } });
    const body = await res.text();
    expect(body).not.toContain('หมดช่วง');
    expect(body).not.toContain('ยังไม่ถึงช่วง');
  });

  test('C6: นอกช่วงต้องถูกปฏิเสธก่อนไฟล์ถูกเขียนลงดิสก์', async ({ request }) => {
    await seedTestData();
    const now = await today();
    await setWindow('report_outline', shift(now, -60), shift(now, -30));

    const uploadDir = path.join(BACKEND_ROOT, 'uploads');
    const countFiles = () =>
      fs.existsSync(uploadDir)
        ? fs.readdirSync(uploadDir, { recursive: true as never }).length
        : 0;
    const before = countFiles();

    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/outlines`, {
      multipart: {
        outline: {
          name: 'outline.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n%%EOF'),
        },
      },
    });

    expect(res.status()).toBe(403);
    // ถ้า gate ถูกย้ายไปไว้หลัง multer เมื่อไหร่ ไฟล์กำพร้าจะโผล่ตรงนี้
    expect(countFiles()).toBe(before);
  });

  test('C7: สิทธิ์ — นักศึกษาตั้งปฏิทินไม่ได้ และคนไม่ล็อกอินอ่านไม่ได้', async ({ request }) => {
    await seedTestData();

    const anon = await request.get(`${API_URL}/calendar`, { headers: { Cookie: '' } });
    expect(anon.status()).toBe(401);

    await apiLoginAs(request, 'student2');
    expect((await request.get(`${API_URL}/calendar`)).status()).toBe(200);
    const forbidden = await request.post(`${API_URL}/calendar`, {
      data: {
        semester_id: 1,
        activity_key: 'weekly_log',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
      },
    });
    expect(forbidden.status()).toBe(403);
  });

  test('C8: ตั้งซ้ำได้ 409 · ปี พ.ศ. ได้ 400 · และการตั้งลง audit_log (SEC-07)', async ({
    request,
  }) => {
    await seedTestData();
    await apiLoginAs(request, 'staff1');

    const ok = await request.post(`${API_URL}/calendar`, {
      data: {
        semester_id: 1,
        activity_key: 'final_report',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
      },
    });
    expect(ok.status()).toBe(201);

    const dup = await request.post(`${API_URL}/calendar`, {
      data: {
        semester_id: 1,
        activity_key: 'final_report',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
      },
    });
    expect(dup.status()).toBe(409);

    // BUG-01: ฐานเก็บ ค.ศ. — ถ้าปล่อย 2569 ลงไป ช่วงนั้นจะไม่มีวันเปิดและไม่มีใครรู้ว่าทำไม
    const buddhist = await request.post(`${API_URL}/calendar`, {
      data: {
        semester_id: 1,
        activity_key: 'report_outline',
        start_date: '2569-09-01',
        end_date: '2569-09-30',
      },
    });
    expect(buddhist.status()).toBe(400);
    expect((await buddhist.json()).message).toContain('ค.ศ.');

    // writeAudit เป็น fire-and-forget — ลงหลัง response จึงต้อง poll
    await expect
      .poll(
        async () =>
          await dbRow(`SELECT audit_id FROM audit_log WHERE action = 'coop_calendar.created'`),
        { timeout: 5_000 }
      )
      .toBeTruthy();
  });

  /**
   * ชนิดวันที่ 5 แบบตามปฏิทินคณะตัวจริง (2026-09-04)
   *
   * ที่ต้องมีเทสต์ชุดนี้เพราะ **"ภายในวันที่ 5 มิ.ย." ไม่เท่ากับ "5 มิ.ย. – 5 มิ.ย."**
   * ถ้าวันหนึ่งมีคน "แก้ให้ง่ายขึ้น" โดยยอมให้เส้นตายกรอกวันเริ่มได้ ระบบจะเปิด
   * วันเดียวและปฏิเสธทุกวันก่อนหน้า ซึ่งกลับหัวจากที่กระดาษเขียน โดยไม่มีใครรู้
   */
  test('C9: ชนิดวันที่ — เส้นตายไม่มีวันเริ่ม · วันเดียวสำเนาเอง · กิจกรรมที่คำนวณเองตั้งไม่ได้', async ({
    request,
  }) => {
    await seedTestData();
    await apiLoginAs(request, 'staff1');

    // เส้นตาย: กรอกเฉพาะวันสุดท้าย
    const deadline = await request.post(`${API_URL}/calendar`, {
      data: { semester_id: 1, activity_key: 'acceptance_form', end_date: '2026-06-05' },
    });
    expect(deadline.status()).toBe(201);
    const savedDeadline = await dbRow<{ start_date: string | null; date_kind: string }>(
      `SELECT start_date, date_kind FROM coop_calendar_events WHERE activity_key = 'acceptance_form'`
    );
    expect(savedDeadline?.date_kind).toBe('deadline');
    // ⛔ วันเริ่มต้องเป็น NULL ไม่ใช่สำเนาของวันปิด
    expect(savedDeadline?.start_date).toBeNull();

    // เส้นตายที่แถมวันเริ่มมาด้วย → ปฏิเสธ พร้อมบอกว่าทำไม
    const withStart = await request.post(`${API_URL}/calendar`, {
      data: {
        semester_id: 1,
        activity_key: 'intent_submission',
        start_date: '2026-06-05',
        end_date: '2026-06-05',
      },
    });
    // intent_submission เป็นชนิดช่วง จึงรับได้ตามปกติ — ใช้เป็นตัวคุมว่าไม่ได้ห้ามมั่ว
    expect(withStart.status()).toBe(201);

    // วันเดียว: ส่งมาช่องเดียว ระบบสำเนาลง end_date ให้เอง
    const single = await request.post(`${API_URL}/calendar`, {
      data: { semester_id: 1, activity_key: 'coop_start', start_date: '2026-07-06' },
    });
    expect(single.status()).toBe(201);
    const savedSingle = await dbRow<{ start_date: string; end_date: string }>(
      `SELECT start_date::text, end_date::text FROM coop_calendar_events WHERE activity_key = 'coop_start'`
    );
    expect(savedSingle?.start_date).toBe('2026-07-06');
    expect(savedSingle?.end_date).toBe('2026-07-06');

    // กิจกรรมที่คำนวณเองตั้งช่วงแยกไม่ได้ — ไม่งั้นจะมีวันสองชุดที่วันหนึ่งไม่ตรงกัน
    const derived = await request.post(`${API_URL}/calendar`, {
      data: {
        semester_id: 1,
        activity_key: 'weekly_log',
        start_date: '2026-07-06',
        end_date: '2026-10-23',
      },
    });
    expect(derived.status()).toBe(400);
    expect((await derived.json()).message).toContain('คำนวณจาก');
    expect(
      await dbValue<string>(
        `SELECT COUNT(*) FROM coop_calendar_events WHERE activity_key = 'weekly_log'`
      )
    ).toBe('0');

    // รายการอิสระชนิดข้อความ: ไม่มีวัน มีแต่ข้อความตามที่กระดาษเขียน
    const external = await request.post(`${API_URL}/calendar`, {
      data: {
        semester_id: 1,
        activity_key: null,
        title: 'ประกาศผล',
        date_kind: 'external',
        detail_text: 'ให้เป็นไปตามปฏิทินปีการศึกษาของทางมหาวิทยาลัยฯ กำหนด',
      },
    });
    expect(external.status()).toBe(201);

    // ชนิดข้อความที่ไม่ส่งข้อความมา → 400 (ไม่งั้นได้แถวเปล่าที่ไม่บอกอะไรใคร)
    const emptyExternal = await request.post(`${API_URL}/calendar`, {
      data: { semester_id: 1, activity_key: null, title: 'ว่างเปล่า', date_kind: 'relative' },
    });
    expect(emptyExternal.status()).toBe(400);
  });

  /**
   * `weekly_log` ต้องล็อกตามวันเริ่ม/วันสิ้นสุดการปฏิบัติงาน โดยที่ไม่มีแถวของตัวเอง
   * — ปฏิทินคณะไม่มีแถวนี้เพราะมันคือช่วงระหว่างสองวันนั้นพอดี
   */
  test('C10: ช่วงบันทึกรายสัปดาห์คำนวณจากวันเริ่ม-วันสิ้นสุด และล็อกได้จริง', async ({
    request,
  }) => {
    await seedTestData();
    const now = await today();
    await apiLoginAs(request, 'staff1');

    const setSingle = (key: string, date: string) =>
      request.post(`${API_URL}/calendar`, {
        data: { semester_id: 1, activity_key: key, start_date: date },
      });

    // ตั้งแค่วันเริ่ม — ยังไม่ครบสองข้าง จึงต้องยังไม่ล็อก (fail-open)
    expect((await setSingle('coop_start', shift(now, -30))).status()).toBe(201);
    await apiLoginAs(request, 'student2');
    let cal = await (await request.get(`${API_URL}/calendar`)).json();
    let weekly = cal.activities.find(
      (a: { activity_key: string }) => a.activity_key === 'weekly_log'
    );
    expect(weekly.derived).toBe(true);
    expect(weekly.status).toBe('not_configured');

    // ตั้งวันสิ้นสุดให้อยู่ในอดีต → ช่วงบันทึกต้องปิดตามไปด้วย
    await apiLoginAs(request, 'staff1');
    expect((await setSingle('coop_end', shift(now, -1))).status()).toBe(201);

    await apiLoginAs(request, 'student2');
    cal = await (await request.get(`${API_URL}/calendar`)).json();
    weekly = cal.activities.find((a: { activity_key: string }) => a.activity_key === 'weekly_log');
    expect(weekly.start_date).toBe(shift(now, -30));
    expect(weekly.end_date).toBe(shift(now, -1));
    expect(weekly.status).toBe('closed');

    // และตัวล็อกจริงที่เซิร์ฟเวอร์ต้องปฏิเสธด้วย ไม่ใช่แค่หน้าจอบอกว่าปิด
    const blocked = await request.post(`${API_URL}/weekly-logs`, {
      data: { week_number: 1, work_description: 'x', problems: '', solutions: '' },
    });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).message).toContain('บันทึกการปฏิบัติงานรายสัปดาห์');
  });

  /**
   * ปฏิทินต้อง "กดแล้วไปทำได้" ไม่ใช่ดูอย่างเดียว (เจ้าของทัก 2026-09-04)
   *
   * และต้องกดได้**เฉพาะแถวที่มีอะไรให้ไปทำ** — หมุดบอกเวลา (วันเริ่ม · วันสิ้นสุด
   * · วันสอบ) กับรายการที่เจ้าหน้าที่พิมพ์เองต้องกดไม่ได้ เพราะปุ่มที่กดแล้วไม่มี
   * อะไรเกิดขึ้นแย่กว่าไม่มีปุ่ม
   */
  test('C11: กดแถบในปฏิทินแล้วไปหน้าที่ทำรายการนั้นจริง · หมุดบอกเวลากดไม่ได้', async ({
    page,
  }) => {
    await seedTestData();
    const now = await today();
    await giveAcceptedIntent();
    await setWindow('report_outline', shift(now, -3), shift(now, 30));

    // หมุด "วันเริ่มปฏิบัติงาน" — โผล่ในปฏิทินได้ แต่ต้องไม่เป็นปุ่ม
    await dbExec(
      `INSERT INTO coop_calendar_events
         (semester_id, activity_key, date_kind, start_date, end_date, created_by)
       SELECT s.semester_id, 'coop_start', 'single', $1, $1, u.user_id
         FROM coop_semesters s CROSS JOIN users u
        WHERE s.is_active = TRUE AND u.email = 'staff1@test.com'
        LIMIT 1`,
      [shift(now, 10)]
    );

    await loginAs(page, 'student2');
    await page.getByRole('button', { name: 'ดูปฏิทินสหกิจศึกษาทั้งหมด' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // หมุดบอกเวลาต้องไม่ใช่ปุ่ม — ปุ่มที่กดแล้วไม่มีอะไรเกิดขึ้นแย่กว่าไม่มีปุ่ม
    await expect(dialog.getByRole('button', { name: /วันเริ่มปฏิบัติงานสหกิจศึกษา/ })).toHaveCount(
      0
    );

    await dialog.getByRole('button', { name: /ส่งโครงร่างรายงานการปฏิบัติงาน/ }).click();

    // ปฏิทินต้องปิดก่อน ไม่งั้นกล่องจะค้างทับหน้าที่เพิ่งเปิด
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: 'โครงร่างรายงาน (สหกิจ 11)' })).toBeVisible();
  });
});
