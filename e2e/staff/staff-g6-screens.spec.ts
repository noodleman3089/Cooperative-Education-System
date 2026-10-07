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

/** การ์ดงาน 4 ใบของหน้าแรกแบบ B — กอง "ค้างที่คณบดี" ย้ายไปอยู่ช่อง "รอคณบดี" ของท่อย่อ (เจ้าของเคาะ 2026-10-07) */
const TILE_KINDS = ['request', 'acceptance', 'dispatch', 'appointment'] as const;

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
  test('ช่วงปฏิทิน · งานที่รอ · ท่อย่อ มาจากเซิร์ฟเวอร์ทุกตัว — หน้าจอไม่คิดเองสักตัว', async ({ page }) => {
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
    await loginAs(page, 'staff1');

    const season = page.getByTestId('staff-home-season');
    await expect(season).toBeVisible();

    // อ่าน payload ด้วย cookie jar เดียวกับเบราว์เซอร์ แล้วเทียบกับที่จอแสดง
    const home = await (await page.request.get('/api/staff/home')).json();
    const pipeline = await (await page.request.get('/api/staff/pipeline')).json();

    await expect(season).toHaveAttribute('data-season', home.season);
    await expect(
      page.getByRole('heading', { name: `งานที่รอคุณ ${home.work_total} เรื่อง`, exact: true })
    ).toBeVisible();
    expect(home.work_total).toBe(2);

    // ⛔ ครบ 4 ใบเสมอ รวมใบที่นับได้ 0 — ไม่มีการซ่อน
    for (const kind of TILE_KINDS) {
      await expect(page.getByTestId(`staff-home-tile-${kind}`)).toBeVisible();
      await expect(page.getByTestId(`staff-home-tile-${kind}-count`)).toHaveText(
        String(home.tiles[kind].count)
      );
    }
    // "รอนานสุด" และ "เลยกำหนด" บนการ์ดคือเลขของเซิร์ฟเวอร์ (นับจากวันอัปโหลดกระดาษ)
    expect(home.tiles.request.oldest_days).toBe(9);
    await expect(page.getByTestId('staff-home-tile-request')).toContainText('รอนานสุด 9 วัน · เลยกำหนด 1');
    await expect(page.getByTestId('staff-home-tile-appointment')).toContainText('ยังไม่มีร่างนัดนิเทศรอส่ง');

    // ของที่ถอดจากหน้าแรกแบบเดิมตามที่เจ้าของเคาะ — ต้องไม่ค้างอยู่ครึ่ง ๆ
    await expect(page.getByTestId('staff-home-tile-dean')).toHaveCount(0);
    await expect(page.locator('[data-testid^="staff-home-timeline-"]')).toHaveCount(0);
    await expect(page.getByTestId('staff-home-season-action')).toHaveCount(0);

    // ท่อย่อ 14 ช่อง — จำนวนและชื่อช่องมาจาก /api/staff/pipeline ตรง ๆ
    expect(pipeline.stages).toHaveLength(14);
    await expect(page.getByTestId('staff-home-pipeline')).toContainText(
      `นักศึกษาทั้งรุ่น ${pipeline.cohort_total} คน อยู่ขั้นไหน`
    );
    for (const stage of pipeline.stages as { key: string; short: string; count: number }[]) {
      const cell = page.getByTestId(`staff-home-pipeline-${stage.key}`);
      await expect(cell.locator('b')).toHaveText(String(stage.count));
      await expect(cell).toContainText(stage.short);
    }
    expect(
      (pipeline.stages as { key: string; count: number }[]).find((s) => s.key === 'await_officer_request')?.count
    ).toBe(1);

    // เมนู "นักศึกษาตอนนี้" ยังอยู่ ไม่ถูกยุบเข้าหน้าแรก
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

  test('แถบเตือนปฏิทิน — หลายกิจกรรมที่ยังไม่ตั้งรวมเป็นบรรทัดเดียว · กิจกรรมเดียวใช้ข้อความเดิม', async ({
    page,
  }) => {
    await seedTestData();
    await clearCalendar();
    await loginAs(page, 'staff1');

    const warning = page.getByTestId('staff-home-calendar-warning');
    await expect(warning).toBeVisible();

    // ปฏิทินว่าง = กิจกรรมที่ล็อกจริงและกรอกเองได้ 5 อัน → บรรทัดรวมเดียว ไม่ใช่ li ซ้ำ 5 บรรทัด
    await expect(warning.locator('li')).toHaveCount(1);
    const merged = (await warning.locator('li').innerText()).replace(/\s+/g, ' ');
    expect(merged).toContain('ยังไม่ได้ตั้งช่วงเวลา:');
    expect(merged).toContain('ระบบจึงยังไม่ล็อกใครในขั้นเหล่านี้');
    // ประโยคท้ายต้องขึ้นครั้งเดียว ไม่ใช่ซ้ำตามจำนวนกิจกรรม
    expect(merged.split('ระบบจึงยังไม่ล็อก').length - 1).toBe(1);
    for (const label of [
      'แบบคำร้องขอหนังสือขอความอนุเคราะห์',
      'แบบตอบรับ',
      'ข้อมูลที่พัก',
      'โครงร่างรายงาน',
      'รายงานการปฏิบัติงานฉบับสมบูรณ์',
    ]) {
      expect(merged, `บรรทัดรวมต้องระบุกิจกรรม ${label}`).toContain(label);
    }

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
    await expect(warning).toBeVisible();
    await expect(warning.locator('li')).toHaveCount(1);
    const single = (await warning.locator('li').innerText()).replace(/\s+/g, ' ');
    expect(single).toContain('รายงานการปฏิบัติงานฉบับสมบูรณ์ ยังไม่ได้ตั้งช่วงเวลา — ระบบจึงยังไม่ล็อกใครในขั้นนั้น');
    expect(single).not.toContain('ยังไม่ได้ตั้งช่วงเวลา:');
  });

  test('การ์ดงานเลือกรายการ — แสดงทีละกอง · ไม่ระบุกอง = กองแรกที่มีงาน · ร่างนัดนิเทศไปเมนูของมันเอง', async ({
    page,
  }) => {
    await seedTestData();
    const acceptanceForm = await seedQueued(1, 'pending_officer_approval');
    await loginAs(page, 'staff1');

    // ไม่มีคำร้องรอรับ มีแต่แบบตอบรับ → รายการเริ่มที่กองที่มีงาน ไม่ใช่กองแรกที่ว่างเปล่า
    await expect(page.getByTestId('staff-queue-acceptance')).toBeVisible();
    await expect(page.getByTestId('staff-home-tile-acceptance')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`review-acceptance-${acceptanceForm}`)).toBeVisible();
    // ⛔ รายการเดียว — กองอื่นต้องไม่แสดงซ้อนพร้อมกัน
    await expect(page.getByTestId('staff-queue-request')).toHaveCount(0);
    await expect(page.getByTestId('staff-queue-dispatch')).toHaveCount(0);

    await page.getByTestId('staff-home-tile-request').click();
    await expect(page).toHaveURL(/[?&]queue=request/);
    await expect(page.getByTestId('staff-queue-request')).toContainText('คำร้องรอรับ · 0 คน');
    await expect(page.getByTestId('staff-queue-request')).toContainText('ไม่มีคำร้องรอตรวจในขณะนี้');
    await expect(page.getByTestId('staff-queue-acceptance')).toHaveCount(0);
    await expect(page.getByTestId('staff-home-tile-request')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('staff-home-tile-appointment').click();
    await expect(page).toHaveURL(/[?&]menu=appointments/);
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
