import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbValue, withDb } from '../helpers/db';

/**
 * G6 บนหน้าจอ — หน้าแรกของเจ้าหน้าที่ (E0 · SB8) และแท็บคณะ/สาขาวิชา (E7 · SB7)
 *
 * `staff-home.spec.ts` กับ `staff-master-data.spec.ts` คุมฝั่ง API ไว้แล้ว
 * ไฟล์นี้คุมสิ่งที่ API คุมแทนไม่ได้:
 *
 * ⛔ **หน้าจอต้องไม่ตัดสินฤดูกาลเอง** — เทียบ `data-season` กับ `season` ที่เส้นเดียวกัน
 *    ส่งมาในคำขอเดียวกัน ถ้าวันหนึ่งมีใครเพิ่มตรรกะฝั่ง React ขึ้นมาซ้อน สองค่านี้จะแยกกัน
 * ⛔ **กองที่นับได้ 0 ต้องยังอยู่** — ของที่หายจากจอคือของที่ไม่มีใครทำ
 * ⛔ **fail-open ต้องไม่เงียบ และต้องไม่อ่านว่าระบบพัง**
 */

test.beforeEach(async ({ page }) => {
  await page.route('**/maps.googleapis.com/**', (route) => route.abort());
});

/** ล้างปฏิทินของภาคที่เปิดอยู่ เพื่อให้แถบเตือน fail-open ขึ้นแน่ ๆ */
async function clearCalendar(): Promise<void> {
  const semesterId = await dbValue<number>(
    'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1'
  );
  await dbExec('DELETE FROM coop_calendar_events WHERE semester_id = $1', [semesterId]);
}

/**
 * หน้าแรกแบบแถวเดียว 5 ช่อง (เจ้าของเลือก 2026-10-10 — ของเดิม: การ์ดงาน 4 ใบ + ท่อย่อ 13 ช่อง + ตารางหนังสือ)
 * คีย์ = `cohort_steps` ของ `GET /api/staff/home` · ป้าย = คำที่เจ้าของกำหนด
 */
const STEP_LABELS = [
  ['filed', 'ยื่นคำร้องมาแล้ว'],
  ['awaiting_dean', 'รอคณบดีลงนาม'],
  ['letter_signed', 'ส่งหนังสือให้นักศึกษาแล้ว'],
  ['company_accepted', 'บริษัทตอบรับแล้ว'],
  ['dispatch_issued', 'ออกหนังสือส่งตัวแล้ว'],
] as const;

/** นักศึกษาสร้างทิ้งหนึ่งคนในรุ่นของภาคที่เปิดอยู่ พร้อมใบในสถานะที่ระบุ — เติมการ์ดงานและท่อย่อให้มีของจริงนับ */
async function seedQueued(seq: number, status: string, extra: Record<string, unknown> = {}): Promise<number> {
  return withDb(async (db) => {
    const code = `6591${String(seq).padStart(4, '0')}`;
    const userId = (
      await db.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id`, [
        `g6-home-${seq}@test.com`,
      ])
    ).rows[0].user_id as number;
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [userId]);
    await db.query(
      `INSERT INTO students (student_id, student_code, first_name, last_name, major_id, cumulative_gpa, enrollment_year)
       VALUES ($1, $2, $3, 'ทดสอบ', (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 3.00, 2569)`,
      [userId, code, `คนที่${seq}`]
    );
    await db.query(
      `INSERT INTO semester_cohort (semester_id, student_code)
       SELECT semester_id, $1 FROM coop_semesters WHERE is_active = TRUE ON CONFLICT DO NOTHING`,
      [code]
    );
    const cols = ['student_id', 'company_id', 'semester_id', 'status', ...Object.keys(extra)];
    const vals = [userId, ...Object.values(extra)];
    const res = await db.query(
      `INSERT INTO intent_forms (${cols.join(', ')})
       VALUES ($1, (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
               (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), '${status}'
               ${Object.keys(extra)
                 .map((_, i) => `, $${i + 2}`)
                 .join('')})
       RETURNING form_id`,
      vals
    );
    return res.rows[0].form_id as number;
  });
}

test.describe('E0 · หน้าแรกของเจ้าหน้าที่', () => {
  test('แถวห้าช่อง · ป้ายงานรอ · บรรทัดเลยกำหนด มาจากเซิร์ฟเวอร์ทุกตัว — ของที่ย้ายออกไม่ค้างบนหน้าแรก', async ({ page }) => {
    await seedTestData();
    const waiting = await seedQueued(1, 'pending_officer_request', {
      request_form_path: 'request_forms/requestform-user-g6.pdf',
    });
    await dbExec(
      `INSERT INTO intent_stage_events (form_id, stage, entered_at)
       VALUES ($1, 'request_uploaded', NOW() - INTERVAL '9 days')`,
      [waiting]
    );
    await seedQueued(2, 'pending_officer_approval');

    // ร่างนัดนิเทศรอส่ง 1 ใบ — ไม่อยู่บนหน้าแรกแล้ว (เจ้าของสั่ง 2026-10-10) จึงต้องไม่ถูกนับในหัวหน้า
    await dbExec(
      `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status)
       SELECT (SELECT user_id FROM users WHERE email = 'advisor1@test.com'), student_id, company_id,
              CURRENT_DATE + 30, '09:00', '10:00', 'draft'
         FROM intent_forms WHERE form_id = $1`,
      [waiting]
    );
    await loginAs(page, 'staff1');

    const steps = page.getByTestId('staff-home-steps');
    await expect(steps).toBeVisible();

    // อ่าน payload ด้วย cookie jar เดียวกับเบราว์เซอร์ แล้วเทียบกับที่จอแสดง
    const home = await (await page.request.get('/api/staff/home')).json();

    // หัวหน้า = งานของสามคิวที่หน้านี้แสดง (คำร้อง 1 + แบบตอบรับ 1) · ร่างนัดนิเทศอยู่ในเมนูของมันเอง
    expect(home.work_total).toBe(3);
    expect(home.tiles.appointment.count).toBe(1);
    await expect(page.getByRole('heading', { name: 'งานที่รอคุณ 2 เรื่อง', exact: true })).toBeVisible();

    // แถวเดียว 5 ช่อง ครบเสมอ รวมช่องที่นับได้ 0 — ตัวเลขและขนาดรุ่นมาจากเซิร์ฟเวอร์
    await expect(page.getByRole('heading', { name: `นักศึกษารุ่นนี้ ${home.cohort_total} คน`, exact: true })).toBeVisible();
    expect(home.cohort_total).toBe(2);
    for (const [key, label] of STEP_LABELS) {
      const box = page.getByTestId(`staff-home-step-${key}`);
      await expect(box.locator('b')).toHaveText(String(home.cohort_steps[key]));
      await expect(box).toContainText(label);
    }
    expect(home.cohort_steps).toEqual({ filed: 2, awaiting_dean: 0, letter_signed: 0, company_accepted: 1, dispatch_issued: 0 });

    // ป้ายงานรอขึ้นเฉพาะช่องที่มีงานของเจ้าหน้าที่ — เลขคือตัวนับกองงานของเซิร์ฟเวอร์
    await expect(page.getByTestId('staff-home-step-badge-filed')).toHaveText(`รอคุณรับ ${home.tiles.request.count}`);
    await expect(page.getByTestId('staff-home-step-badge-company_accepted')).toHaveText(
      `รอคุณตรวจ ${home.tiles.acceptance.count}`
    );
    for (const key of ['awaiting_dean', 'letter_signed', 'dispatch_issued']) {
      await expect(page.getByTestId(`staff-home-step-badge-${key}`)).toHaveCount(0);
    }

    // งานเลยกำหนด (คำร้องรอ 9 วัน) = หนึ่งบรรทัดเตือน · หน้าจอไม่ตัดสินเอง: data-season ตรงกับที่เซิร์ฟเวอร์ส่ง
    expect(home.season).toBe('overdue');
    expect(home.tiles.request.overdue).toBe(1);
    const overdue = page.getByTestId('staff-home-season');
    await expect(overdue).toHaveAttribute('data-season', home.season);
    await expect(overdue).toHaveText('มีงานเลยกำหนด 1 เรื่อง · คำร้องรอรับ 1');

    // ของที่ย้ายออกจากหน้าแรกตามที่เจ้าของเคาะ — ต้องไม่ค้างอยู่ครึ่ง ๆ
    await expect(page.locator('[data-testid^="staff-home-tile-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="staff-home-timeline-"]')).toHaveCount(0);
    await expect(page.getByTestId('staff-home-pipeline')).toHaveCount(0);
    await expect(page.locator('[data-testid^="edit-document-no-"]')).toHaveCount(0);
    await expect(page.getByText('ประวัติหนังสือราชการ')).toHaveCount(0);

    // เมนู "นักศึกษาตอนนี้" ยังอยู่ — ลิงก์ "ดูรายคน" พาไป
    await page.getByTestId('staff-home-pipeline-open').click();
    await expect(page).toHaveURL(/[?&]menu=pipeline/);
  });

  test('ปฏิทินที่ยังไม่ได้ตั้งขึ้นแถบเตือน และข้อความต้องไม่อ่านว่าระบบพัง', async ({ page }) => {
    await seedTestData();
    await clearCalendar();
    await loginAs(page, 'staff1');

    const warning = page.getByTestId('staff-home-calendar-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('ยังไม่ได้ตั้งช่วงเวลา');

    /**
     * ⛔ ด่านปฏิทิน fail-open โดยตั้งใจ (ตรงข้ามกับ SEC-06) — ถ้อยคำจึงต้องบอกว่า
     *    “ยังไม่ล็อกใคร” ไม่ใช่ “ผิดพลาด” ซึ่งจะทำให้เจ้าหน้าที่ไปตามช่างแทนที่จะไปตั้งวัน
     */
    const text = (await warning.innerText()).replace(/\s+/g, ' ');
    expect(text).not.toContain('ผิดพลาด');
    expect(text).not.toContain('ระบบไม่พร้อม');
  });

  test('แถบเตือนปฏิทิน — บรรทัดเดียวบอกจำนวนที่ยังไม่ตั้ง (ไม่ไล่ชื่อกิจกรรม) · ปุ่มพาไปหน้าปฏิทิน · ตั้งครบแล้วแถบหาย', async ({
    page,
  }) => {
    await seedTestData();
    await clearCalendar();
    await loginAs(page, 'staff1');

    const warning = page.getByTestId('staff-home-calendar-warning');
    await expect(warning).toBeVisible();

    // ปฏิทินว่าง = กิจกรรมที่ล็อกจริงและกรอกเองได้ 5 อัน → บรรทัดเดียวบอกจำนวน (จำนวนมาจากเซิร์ฟเวอร์)
    const before = await (await page.request.get('/api/staff/home')).json();
    expect(before.calendar_warnings).toHaveLength(5);
    await expect(warning).toContainText('ยังไม่ได้ตั้งช่วงเวลาในปฏิทินสหกิจ 5 รายการ');
    // เจ้าของสั่งให้เหลือบรรทัดเดียว — รายชื่อกิจกรรมอยู่ที่หน้าปฏิทิน ไม่ไล่ซ้ำที่นี่
    await expect(warning.locator('li')).toHaveCount(0);
    await expect(warning).not.toContainText('โครงร่างรายงาน');

    // ตั้งวันปิดให้ 4 จาก 5 → เหลือ ส่งรายงานฉบับสมบูรณ์ อันเดียว → ข้อความเดิม
    const semesterId = await dbValue<number>(
      'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1'
    );
    for (const [key, kind] of [
      ['intent_submission', 'range'],
      ['acceptance_form', 'deadline'],
      ['accommodation_plan', 'range'],
      ['report_outline', 'range'],
    ] as const) {
      await dbExec(
        `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date)
         VALUES ($1, $2, $3::varchar, CASE WHEN $3::varchar = 'deadline' THEN NULL ELSE CURRENT_DATE END, CURRENT_DATE + 30)`,
        [semesterId, key, kind]
      );
    }
    await page.reload();
    await expect(warning).toContainText('ยังไม่ได้ตั้งช่วงเวลาในปฏิทินสหกิจ 1 รายการ');

    // ปุ่มพาไปตั้งที่หน้าปฏิทิน
    await warning.getByRole('button', { name: 'ไปตั้งช่วงเวลา' }).click();
    await expect(page).toHaveURL(/[?&]menu=calendar/);

    // ตั้งอันสุดท้ายครบ = ไม่มีอะไรต้องเตือน แถบหาย (ไม่ค้างเป็น "0 รายการ")
    await dbExec(
      `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date)
       VALUES ($1, 'final_report', 'range', CURRENT_DATE, CURRENT_DATE + 30)`,
      [semesterId]
    );
    await goToMenu(page, 'dashboard');
    expect((await (await page.request.get('/api/staff/home')).json()).calendar_warnings).toHaveLength(0);
    await expect(page.getByTestId('staff-home-steps')).toBeVisible();
    await expect(warning).toHaveCount(0);
  });

  test('ช่องที่มีป้ายงานรอเลือกรายการ — แสดงทีละกอง · ไม่ระบุกอง = กองแรกที่มีงาน · ช่องไม่มีป้ายกดไม่ได้ · ไม่มีภาคที่เปิดอยู่ งานที่ค้างยังขึ้น', async ({
    page,
  }) => {
    await seedTestData();
    const acceptanceForm = await seedQueued(1, 'pending_officer_approval');
    await loginAs(page, 'staff1');

    // ไม่มีคำร้องรอรับ มีแต่แบบตอบรับ → รายการเริ่มที่กองที่มีงาน ไม่ใช่กองแรกที่ว่างเปล่า
    await expect(page.getByTestId('staff-queue-acceptance')).toBeVisible();
    await expect(page.getByTestId('staff-home-step-company_accepted')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`review-acceptance-${acceptanceForm}`)).toBeVisible();
    // ⛔ รายการเดียว — กองอื่นต้องไม่แสดงซ้อนพร้อมกัน
    await expect(page.getByTestId('staff-queue-request')).toHaveCount(0);
    await expect(page.getByTestId('staff-queue-dispatch')).toHaveCount(0);

    // ช่องที่ไม่มีงานรอ = ไม่มีป้าย และไม่ใช่ปุ่ม (ไม่มีอะไรให้กดแล้วเจอรายการว่าง)
    for (const key of ['filed', 'awaiting_dean', 'letter_signed', 'dispatch_issued']) {
      await expect(page.getByTestId(`staff-home-step-badge-${key}`)).toHaveCount(0);
      expect(await page.getByTestId(`staff-home-step-${key}`).evaluate((el) => el.tagName)).toBe('DIV');
    }
    // การ์ดร่างนัดนิเทศไม่อยู่บนหน้าแรกแล้ว — ไปจากเมนูของมันเอง
    await expect(page.locator('[data-testid^="staff-home-tile-"]')).toHaveCount(0);
    await expect(page.getByTestId('nav-appointments')).toBeVisible();

    // มีคำร้องรอรับเข้ามา → ช่องแรกมีป้ายและกดได้ → สลับรายการ (URL ของตัวเอง)
    await seedQueued(2, 'pending_officer_request', { request_form_path: 'request_forms/requestform-user-g6.pdf' });
    await page.reload();
    await expect(page.getByTestId('staff-home-step-badge-filed')).toHaveText('รอคุณรับ 1');
    // ไม่ระบุกอง = กองแรกที่มีงาน ตามลำดับ คำร้อง → แบบตอบรับ → หนังสือส่งตัว
    await expect(page.getByTestId('staff-queue-request')).toBeVisible();
    await page.getByTestId('staff-home-step-company_accepted').click();
    await expect(page).toHaveURL(/[?&]queue=acceptance/);
    await expect(page.getByTestId('staff-queue-acceptance')).toBeVisible();
    await expect(page.getByTestId('staff-queue-request')).toHaveCount(0);
    await page.getByTestId('staff-home-step-filed').click();
    await expect(page).toHaveURL(/[?&]queue=request/);
    await expect(page.getByTestId('staff-queue-request')).toContainText('คำร้องรอรับ · 1 คน');
    await expect(page.getByTestId('staff-home-step-filed')).toHaveAttribute('aria-pressed', 'true');

    // ⛔ กองงานไม่ผูกภาคเรียน — ปิดภาคทั้งหมดแล้วไม่มีแถวห้าช่อง แต่งานที่ค้างยังต้องขึ้นให้ทำ
    await dbExec('UPDATE coop_semesters SET is_active = FALSE');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'งานที่รอคุณ 2 เรื่อง', exact: true })).toBeVisible();
    await expect(page.getByTestId('staff-home-steps')).toHaveCount(0);
    await expect(page.getByTestId('staff-home-calendar-warning')).toContainText('ยังไม่ได้เปิดภาคเรียน');
    await expect(page.getByTestId('staff-queue-request')).toBeVisible();
  });
});

test.describe('E7 · แท็บคณะและสาขาวิชา', () => {
  /** เปิดหน้า “บัญชี สิทธิ์ และข้อมูลหลัก” แล้วสลับไปแท็บคณะ/สาขา */
  async function openMasterTab(page: import('@playwright/test').Page): Promise<void> {
    await goToMenu(page, 'users');
    await page.getByTestId('users-tab-master').click();
    await expect(page.getByRole('button', { name: 'เพิ่มคณะ' })).toBeVisible();
  }

  test('เพิ่มสาขาได้ · รหัสซ้ำต้องบอกว่าชนกับสาขาไหน ไม่ใช่ “รหัสซ้ำ” ลอย ๆ', async ({ page }) => {
    await seedTestData();
    await loginAs(page, 'staff1');
    await openMasterTab(page);

    const facultyId = await dbValue<number>(
      "SELECT faculty_id FROM master_faculty WHERE faculty_name_th = 'คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ'"
    );
    await page.getByTestId(`master-faculty-row-${facultyId}`).getByText('คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ').click();

    await page.getByTestId('master-major-add').click();
    await page.fill('#master-major-code', 'G6TEST');
    await page.fill('#master-major-name', 'สาขาวิชาทดสอบ G6');
    await page.getByTestId('master-major-save').click();
    await expect(page.getByText('เพิ่มสาขา “สาขาวิชาทดสอบ G6” (G6TEST) เรียบร้อยแล้ว')).toBeVisible();

    // แถวใหม่ต้องโผล่ในตารางของคณะนั้นจริง ไม่ใช่แค่ขึ้นข้อความสำเร็จ
    const newId = await dbValue<number>(
      "SELECT major_id FROM master_major WHERE major_code = 'G6TEST'"
    );
    await expect(page.getByTestId(`master-major-row-${newId}`)).toContainText('สาขาวิชาทดสอบ G6');

    // รหัสซ้ำ — ข้อความของเซิร์ฟเวอร์บอกชื่อสาขาที่ชน ห้ามเขียนทับ
    await page.getByTestId('master-major-add').click();
    await page.fill('#master-major-code', 'IT01');
    await page.fill('#master-major-name', 'สาขาวิชาชื่ออื่น');
    await page.getByTestId('master-major-save').click();
    await expect(
      page.getByText('รหัส IT01 ซ้ำกับสาขา สาขาวิชาเทคโนโลยีสารสนเทศ')
    ).toBeVisible();
  });

  test('สาขาที่มีนักศึกษาสังกัดปิดปุ่มลบตั้งแต่บนจอ พร้อมบอกจำนวน', async ({ page }) => {
    await seedTestData();

    /**
     * ถามฐานว่าสาขาไหนมีนักศึกษาสังกัดจริง แทนที่จะฮาร์ดโค้ดรหัสสาขา —
     * `setup.ts` เลือกสาขาให้นักศึกษาด้วย `LIMIT 1` ที่ไม่มี `ORDER BY`
     * ฮาร์ดโค้ดไว้เมื่อไหร่ เคสนี้จะกลายเป็นเคสที่ผ่านโดยไม่ได้ทดสอบอะไร
     */
    const majorId = (await dbValue<number>(
      'SELECT major_id FROM students WHERE major_id IS NOT NULL GROUP BY major_id ORDER BY COUNT(*) DESC LIMIT 1'
    ))!;
    const students = await dbValue<number>(
      'SELECT COUNT(*)::int FROM students WHERE major_id = $1',
      [majorId]
    );
    expect(students).toBeGreaterThan(0);

    const facultyId = await dbValue<number>(
      'SELECT faculty_id FROM master_major WHERE major_id = $1',
      [majorId]
    );

    await loginAs(page, 'staff1');
    await openMasterTab(page);
    await page.getByTestId(`master-faculty-row-${facultyId}`).getByRole('button').first().click();

    const blocked = page.getByTestId(`master-major-delete-blocked-${majorId}`);
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText(`${students} คนสังกัด`);
    await expect(page.getByTestId(`master-major-delete-${majorId}`)).toHaveCount(0);
  });

  test('ลบคณะต้องเห็นชื่อสาขาที่จะหายไป แล้วพิมพ์ชื่อคณะยืนยันก่อนถึงกดได้', async ({ page }) => {
    await seedTestData();

    // คณะทิ้งของเทสต์เอง — ไม่แตะคณะจริงใน seed ที่เคสอื่นใช้อยู่
    const facultyId = await withDb(async (db) => {
      const f = await db.query(
        "INSERT INTO master_faculty (faculty_name_th) VALUES ('คณะทดสอบ G6') RETURNING faculty_id"
      );
      const id = f.rows[0].faculty_id as number;
      await db.query(
        `INSERT INTO master_major (faculty_id, major_code, major_name_th)
         VALUES ($1, 'G6A', 'สาขาวิชาทดสอบ ก'), ($1, 'G6B', 'สาขาวิชาทดสอบ ข')`,
        [id]
      );
      return id;
    });

    await loginAs(page, 'staff1');
    await openMasterTab(page);
    await page.getByTestId(`master-faculty-delete-${facultyId}`).click();

    const confirm = page.getByTestId('master-faculty-delete-confirm');
    // ⛔ ลิสต์ชื่อสาขาที่จะหายไป ไม่ใช่บอกแค่จำนวน
    await expect(page.locator('[role="dialog"]')).toContainText('สาขาวิชาทดสอบ ก');
    await expect(page.locator('[role="dialog"]')).toContainText('สาขาวิชาทดสอบ ข');
    await expect(confirm).toBeDisabled();

    await page.fill('#master-faculty-delete-typed', 'คณะทดสอบ');
    await expect(confirm).toBeDisabled();

    await page.fill('#master-faculty-delete-typed', 'คณะทดสอบ G6');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('ลบคณะ “คณะทดสอบ G6” พร้อมสาขาใต้คณะ 2 สาขาเรียบร้อยแล้ว')).toBeVisible();
    expect(
      await dbValue<number>('SELECT COUNT(*)::int FROM master_major WHERE faculty_id = $1', [
        facultyId,
      ])
    ).toBe(0);
  });
});
