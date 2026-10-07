import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs } from '../helpers/auth';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbValue, withDb } from '../helpers/db';

/**
 * หน้าแรกของเจ้าหน้าที่ — “คิวงานวันนี้” (spec-E ข้อ 4 · SB8)
 *
 * ⛔ สิ่งที่ไฟล์นี้คุมคือ **ตรรกะฤดูกาล** ซึ่งเป็นของที่พังเงียบที่สุดในหน้านี้:
 *    การ์ดใบใหญ่เลือกตามลำดับ “หยุดที่เงื่อนไขแรกที่เป็นจริง” ถ้าลำดับเพี้ยน
 *    หน้าจอจะยังดูปกติทุกประการ แต่ชูงานผิดใบให้คนที่เปิดมาดูตอนเช้า
 *
 * ⛔ และคุมว่า **fail-open ต้องไม่เงียบ** — ปฏิทินที่ยังไม่ได้ตั้งช่วงแปลว่าระบบ
 *    ยังไม่ล็อกใครในขั้นนั้น ซึ่งถูกต้องตามที่ตั้งใจ แต่ต้องมีคนเห็น
 */

async function activeSemesterId(): Promise<number> {
  return (await dbValue<number>(
    'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1'
  ))!;
}

/** ตั้งช่วงเวลาของกิจกรรมหนึ่งในปฏิทินของภาคที่เปิดอยู่ */
async function setWindow(
  activityKey: string,
  dateKind: string,
  start: string | null,
  end: string | null,
  lateEnd: string | null = null
): Promise<void> {
  const semesterId = await activeSemesterId();
  await dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date, late_end_date)
     VALUES ($1, $2, $3, $4::date, $5::date, $6::date)`,
    [semesterId, activityKey, dateKind, start, end, lateEnd]
  );
}

/** วันที่แบบ ISO เทียบกับ "วันนี้" ของ Postgres — ⛔ ห้ามใช้ new Date() ของ Node */
async function dayOffset(days: number): Promise<string> {
  return (await dbValue<string>(
    `SELECT ((NOW() AT TIME ZONE 'Asia/Bangkok')::date + $1::int)::text`,
    [days]
  ))!;
}

/** ล้างปฏิทินของภาคนี้ให้ว่าง เพื่อให้แต่ละเคสตั้งเองได้โดยไม่ชนของ seed */
async function clearCalendar(): Promise<void> {
  await dbExec('DELETE FROM coop_calendar_events WHERE semester_id = $1', [
    await activeSemesterId(),
  ]);
}

let studentSeq = 0;

/**
 * คำร้องหนึ่งใบในสถานะที่ระบุ — ใช้เติมกองงานให้มีของจริงนับ
 *
 * ⛔ ต้องสร้างนักศึกษาใหม่ทุกใบ · `uq_student_semester_active` ยอมให้นักศึกษาหนึ่งคน
 *    มีใบที่ยังใช้งานอยู่ได้ใบเดียวต่อภาคเรียน การใช้ student2 ซ้ำจะชนตั้งแต่ใบที่สอง
 * ⛔ `enrollment_year` ต้องใหม่พอที่ `DeactivationScheduler` จะไม่ปิดบัญชีกลางเทสต์
 */
async function makeIntent(
  status: string,
  extra: Record<string, unknown> = {}
): Promise<number> {
  studentSeq += 1;
  const email = `home-student-${studentSeq}@test.com`;
  return withDb(async (db) => {
    const user = await db.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'x')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING user_id`,
      [email]
    );
    const userId = user.rows[0].user_id as number;
    await db.query(
      `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student') ON CONFLICT DO NOTHING`,
      [userId]
    );
    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year)
       VALUES ($1, $2, (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 3.00, 2569)
       ON CONFLICT (student_id) DO NOTHING`,
      [userId, `6590${String(studentSeq).padStart(4, '0')}`]
    );
    const student = { rows: [{ user_id: userId }] };
    const company = await db.query('SELECT company_id FROM companies ORDER BY company_id LIMIT 1');
    const semester = await db.query(
      'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'
    );
    const cols = ['student_id', 'company_id', 'semester_id', 'status'];
    const vals: unknown[] = [
      student.rows[0].user_id,
      company.rows[0].company_id,
      semester.rows[0].semester_id,
      status,
    ];
    for (const [k, v] of Object.entries(extra)) {
      cols.push(k);
      vals.push(v);
    }
    const res = await db.query(
      `INSERT INTO intent_forms (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING form_id`,
      vals
    );
    return res.rows[0].form_id as number;
  });
}

async function home(request: APIRequestContext) {
  const res = await request.get(`${API_URL}/staff/home`);
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

test.describe('หน้าแรกเจ้าหน้าที่ — คิวงานวันนี้ (spec-E SB8)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('เป็นของเจ้าหน้าที่เท่านั้น', async ({ request }) => {
    expect((await request.get(`${API_URL}/staff/home`)).status()).toBe(401);
    for (const account of ['student1', 'advisor1', 'mentor1', 'dean1', 'head1'] as const) {
      await apiLoginAs(request, account);
      expect(
        (await request.get(`${API_URL}/staff/home`)).status(),
        `${account} ต้องเปิดหน้าแรกของเจ้าหน้าที่ไม่ได้`
      ).toBe(403);
    }
  });

  test('“วันนี้” มาจาก Postgres และโครงของ payload ครบตามสเปก', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const body = await home(request);

    // ⛔ ต้องเป็นวันของฐาน ไม่ใช่ของ Node หรือของเบราว์เซอร์
    expect(body.today).toBe(await dayOffset(0));

    for (const key of [
      'today',
      'semester',
      'season',
      'season_detail',
      'tiles',
      'work_total',
      'missing_cover_letters',
      'timeline',
      'calendar_warnings',
    ]) {
      expect(body, `คีย์ ${key} หายไป`).toHaveProperty(key);
    }
    // seed ไม่มีงานค้าง — ผลรวมของ 4 กองที่เป็นงานของเจ้าหน้าที่ต้องเป็น 0 และไม่มีใบที่รับแล้วไม่มีหนังสือ
    expect(body.work_total).toBe(0);
    expect(body.missing_cover_letters).toEqual([]);
    // กองงานต้องมีครบ 5 กองเสมอ — ⛔ ห้ามซ่อนกองที่ว่าง (สเปกข้อ 4.3)
    for (const kind of ['request', 'acceptance', 'dispatch', 'appointment', 'dean']) {
      expect(body.tiles, `กอง ${kind} หายไป`).toHaveProperty(kind);
      expect(typeof body.tiles[kind].count).toBe('number');
      expect(typeof body.tiles[kind].overdue).toBe('number');
    }
    // แถบเวลา 4 ช่วง เรียงตามกระบวนการ
    expect(body.timeline.map((t: any) => t.key)).toEqual([
      'intent_submission',
      'acceptance_form',
      'coop_start',
      'final_report',
    ]);
  });

  test('ปฏิทินที่ยังไม่ได้ตั้งช่วงต้องขึ้นคำเตือน — fail-open ต้องไม่เงียบ', async ({ request }) => {
    await clearCalendar();
    await apiLoginAs(request, 'staff1');
    const empty = await home(request);

    /**
     * ⛔ ด่านปฏิทัน fail-open โดยตั้งใจ (ตรงข้ามกับ SEC-06) — ไม่มีวันปิด = ไม่ล็อกใคร
     *    หน้าจอเจ้าหน้าที่คือที่เดียวที่บอกได้ว่าตอนนี้ขั้นไหนยังไม่มีกฎอยู่
     */
    expect(empty.calendar_warnings.length).toBeGreaterThan(0);
    expect(empty.calendar_warnings.map((w: any) => w.activity_key)).toContain('intent_submission');

    // ตั้งช่วงให้ครบแล้วคำเตือนของกิจกรรมนั้นต้องหายไป
    await setWindow('intent_submission', 'range', await dayOffset(-3), await dayOffset(7));
    const after = await home(request);
    expect(after.calendar_warnings.map((w: any) => w.activity_key)).not.toContain(
      'intent_submission'
    );
  });

  test('ฤดูกาลเลือกตามลำดับ หยุดที่เงื่อนไขแรกที่เป็นจริง', async ({ request }) => {
    await clearCalendar();
    await apiLoginAs(request, 'staff1');

    // ── ลำดับ 3: อยู่ในช่วงรับคำร้อง ──────────────────────────────
    await setWindow('intent_submission', 'range', await dayOffset(-3), await dayOffset(7));
    await makeIntent('pending_officer_request');
    let body = await home(request);
    expect(body.season).toBe('request');
    expect(body.season_detail.headline_count).toBe(1);
    expect(body.season_detail.days_left).toBe(7);

    // ── ลำดับ 4: ช่วงคำร้องปิดแล้ว แต่ยังอยู่ในช่วงรับแบบตอบรับ ────
    await clearCalendar();
    await setWindow('intent_submission', 'range', await dayOffset(-30), await dayOffset(-10));
    await setWindow('acceptance_form', 'deadline', null, await dayOffset(5));
    body = await home(request);
    expect(body.season).toBe('acceptance');

    /**
     * ── ลำดับ 1: ของเลยกำหนดมาก่อนทุกฤดูกาล ────────────────────
     * ⛔ นี่คือเคสที่จับการเรียงลำดับผิด — ถ้าเอา `request`/`acceptance` ขึ้นก่อน
     *    ของที่เลยกำหนดจะถูกงานตามปฏิทินกลบไปเรื่อย ๆ ทุกวันจนไม่มีใครเห็นอีกเลย
     */
    await makeIntent('pending_officer_approval', {
      acceptance_due_date: await dayOffset(-1),
    });
    body = await home(request);
    expect(body.season).toBe('overdue');
    expect(body.season_detail.headline_count).toBeGreaterThan(0);
    expect(body.tiles.acceptance.overdue).toBe(1);
  });

  test('ยังไม่ถึงช่วงคำร้อง = ช่วงว่าง — ไม่มีฤดูกาลสำรวจแล้ว (สายสหกิจ 02 ถูกตัด 2026-10-05)', async ({ request }) => {
    await clearCalendar();
    await setWindow('intent_submission', 'range', await dayOffset(20), await dayOffset(40));

    await apiLoginAs(request, 'staff1');
    const body = await home(request);
    expect(body.season).toBe('idle');
    expect(body.timeline.map((t: any) => t.key)).not.toContain('survey');
    expect(body.tiles).not.toHaveProperty('offer');
  });

  test('กองงานนับจากของจริง และอายุคิวที่ไม่รู้ต้องไม่ถูกนับเป็นเลยกำหนด', async ({ request }) => {
    await clearCalendar();
    await apiLoginAs(request, 'staff1');

    const fresh = await makeIntent('pending_officer_request');
    const old = await makeIntent('pending_officer_request');
    await dbExec("UPDATE intent_forms SET created_at = NOW() - INTERVAL '20 days' WHERE form_id = $1", [
      old,
    ]);
    /**
     * ⛔ แถวที่ไม่มี `created_at` คือแถวที่มีอยู่ก่อน migration 030 — ไม่มีใครรู้ว่า
     *    เข้าคิวมาตั้งแต่เมื่อไหร่ · **ห้ามนับเป็นเลยกำหนด** เพราะนั่นคือการรายงาน
     *    ตัวเลขที่เดาเอาเองว่าเป็นข้อเท็จจริง
     */
    const unknown = await makeIntent('pending_officer_request');
    await dbExec('UPDATE intent_forms SET created_at = NULL WHERE form_id = $1', [unknown]);

    const body = await home(request);
    expect(body.tiles.request.count).toBe(3);
    expect(body.tiles.request.overdue, 'ใบที่ไม่รู้อายุต้องไม่ถูกนับ').toBe(1);
    expect([fresh, old, unknown].length).toBe(3);

    // กองที่ว่างต้องยังอยู่ ไม่ใช่หายไปจากผลลัพธ์
    expect(body.tiles.appointment.count).toBe(0);
    expect(body.tiles.dean.count).toBe(0);
    expect(body.tiles.dean.note).toBeNull();
  });

  test('“เลยกำหนด” ของคิวคำร้องนับจากวันที่อัปโหลดกระดาษ ไม่ใช่วันที่กดยื่น', async ({ request }) => {
    await clearCalendar();
    await apiLoginAs(request, 'staff1');

    /**
     * นักศึกษากดยื่นแล้วเดินเรื่องกระดาษอีกหลายวันก่อนอัปโหลด — ช่วงนั้นไม่ใช่งานค้างของเจ้าหน้าที่
     * ⛔ ใบที่ยื่นมา 10 วันแต่เพิ่งอัปโหลดวันนี้ ต้องไม่ขึ้นเป็น "เลยกำหนด" ตั้งแต่วันแรกที่เข้าคิว
     */
    const justUploaded = await makeIntent('pending_officer_request');
    const waitingLong = await makeIntent('pending_officer_request');
    const unknown = await makeIntent('pending_officer_request');
    await dbExec("UPDATE intent_forms SET created_at = NOW() - INTERVAL '10 days' WHERE form_id = ANY($1)", [
      [justUploaded, waitingLong],
    ]);
    await dbExec('UPDATE intent_forms SET created_at = NULL WHERE form_id = $1', [unknown]);
    await dbExec(
      `INSERT INTO intent_stage_events (form_id, stage, entered_at) VALUES
         ($1, 'request_uploaded', NOW()),
         ($2, 'request_uploaded', NOW() - INTERVAL '9 days')`,
      [justUploaded, waitingLong]
    );

    const body = await home(request);
    expect(body.tiles.request.count).toBe(3);
    expect(body.tiles.request.overdue, 'นับเฉพาะใบที่รอเจ้าหน้าที่เกิน 7 วันจริง').toBe(1);
    // "รอนานสุด" บนการ์ดงาน = ใบที่อัปโหลดมานานสุด (ใบที่ไม่รู้อายุไม่ถูกนับ) · ผลรวมงานที่รอคือ 3 ใบนี้
    expect(body.tiles.request.oldest_days).toBe(9);
    expect(body.work_total).toBe(3);

    // รายการคิวต้องตอบตรงกับกองงาน — ที่มาเดียวกัน และหน้าจอไม่นับเอง
    const rows = (await (
      await request.get(`${API_URL}/intents?status=pending_officer_request`)
    ).json()) as { form_id: number; request_wait_days: number | null; request_overdue: boolean }[];
    const of = (id: number) => rows.find((r) => r.form_id === id)!;
    expect(of(justUploaded).request_wait_days).toBe(0);
    expect(of(justUploaded).request_overdue).toBe(false);
    expect(of(waitingLong).request_wait_days).toBe(9);
    expect(of(waitingLong).request_overdue).toBe(true);
    // ไม่รู้ทั้งวันอัปโหลดและวันสร้าง = ไม่ทราบ ไม่ใช่ 0 วัน และไม่ใช่เลยกำหนด
    expect(of(unknown).request_wait_days).toBeNull();
    expect(of(unknown).request_overdue).toBe(false);
  });

  test('ไม่มีภาคเรียนที่เปิดใช้งาน = ช่วงว่าง พร้อมบอกว่าต้องไปตั้งที่ไหน', async ({ request }) => {
    await dbExec('UPDATE coop_semesters SET is_active = FALSE');
    await apiLoginAs(request, 'staff1');
    const body = await home(request);

    expect(body.semester).toBeNull();
    expect(body.season).toBe('idle');
    // ⛔ จอว่างต้องบอกเหตุผลและทางออก ห้ามขึ้นแค่ "ไม่มีข้อมูล"
    expect(body.calendar_warnings).toHaveLength(1);
    expect(body.calendar_warnings[0].label).toContain('ยังไม่ได้เปิดภาคเรียน');
  });
});
