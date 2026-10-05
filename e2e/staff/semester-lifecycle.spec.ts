import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRow, dbRows, dbValue, withDb } from '../helpers/db';

/**
 * วงจรภาคเรียน (เฟส 0 ของ `.system_memory/design_semester_lifecycle.md`)
 *
 * ⛔ สิ่งที่คุม — ทั้งหมดคือสิ่งที่ "พังเงียบ" ถ้าเพี้ยน:
 *   · ภาค active ได้ **ภาคเดียว** และปีเป็น **พ.ศ.** เสมอ — ฐานปฏิเสธเอง ไม่พึ่งโค้ด (R0-1)
 *   · สร้าง/เปิด/ปิดภาคทำได้เฉพาะเจ้าหน้าที่ · เปิดภาคใหม่แล้วภาคเดิมหยุดรับภาคเดียว (R0-2)
 *   · **ปิดภาค/เปิดภาคใหม่ไม่แตะสถานะใบและไม่ย้ายภาค** — ใบที่ค้างอยู่ตามเดิม (หลักการวงจรภาค)
 *   · **ด่านปฏิทินอ่านภาคของ "ใบ" ไม่ใช่ภาค active** — ใบภาค 1 ตอบรับได้ตามหน้าต่างของภาค 1 ตอนภาค 2 เปิดอยู่
 *     และกลับกัน หน้าต่างภาค 1 ปิดแล้วต้องปฏิเสธแม้ภาค 2 จะเปิดอยู่ (R0-3)
 *
 * S1 สิทธิ์ · S2 สร้างภาค · S3 ฐานกันเอง · S4 เปิดภาค · S5 ปิดภาค · S6 คัดลอกปฏิทิน
 * S7 ด่านข้ามภาค (แบบตอบรับ) · S8 ปฏิทินของนักศึกษา · S9 ผลประเมินข้ามภาค · S10 หน้าจอ
 */

const today = () =>
  dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`) as Promise<string>;

const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** seed มี 2569/1 (active) และ 2569/2 (ไม่ active) */
async function twoSemesters(): Promise<{ a: number; b: number }> {
  const a = (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active'))!;
  const b = (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE NOT is_active ORDER BY semester_id LIMIT 1'))!;
  return { a, b };
}

const userId = (email: string) => dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;

let seq = 0;

/** นักศึกษาใหม่ที่มีแถว students (บัญชี student1 ใน seed ไม่มีแถวนี้) · คืนอีเมล */
async function newStudent(): Promise<string> {
  seq += 1;
  const email = `sem-student-${seq}@test.com`;
  await withDb(async (db) => {
    const id = (await db.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id`, [email])).rows[0].user_id;
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [id]);
    // enrollment_year ใหม่พอที่ DeactivationScheduler จะไม่ปิดบัญชีกลางเทสต์
    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name)
       VALUES ($1, $2, (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 3.00, 2569, 'ทดสอบ', 'ภาคเรียน')`,
      [id, `6592${String(seq).padStart(4, '0')}`]
    );
  });
  return email;
}

/** ใบของนักศึกษาในภาคที่ระบุ · คืน form_id */
async function putForm(email: string, semesterId: number, status: string, dueOffset: number | null = null): Promise<number> {
  return withDb(async (db) => {
    const sid = await userId(email);
    const company = (await db.query('SELECT company_id FROM companies ORDER BY company_id LIMIT 1')).rows[0].company_id as number;
    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, acceptance_due_date)
       VALUES ($1, $2, $3, $4,
               CASE WHEN $5::int IS NULL THEN NULL ELSE (NOW() AT TIME ZONE 'Asia/Bangkok')::date + $5::int END)
       RETURNING form_id`,
      [sid, company, semesterId, status, dueOffset]
    );
    return res.rows[0].form_id as number;
  });
}

/** กำหนดหน้าต่าง "แบบตอบรับ" (ชนิด deadline — มีแค่วันปิด) ของภาคหนึ่ง */
const setAcceptanceDeadline = (semesterId: number, endDate: string) =>
  dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, end_date)
     VALUES ($1, 'acceptance_form', 'deadline', $2)
     ON CONFLICT (semester_id, activity_key) WHERE activity_key IS NOT NULL DO UPDATE SET end_date = EXCLUDED.end_date`,
    [semesterId, endDate]
  );

const setCoopEnd = (semesterId: number, endDate: string) =>
  dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date)
     VALUES ($1, 'coop_end', 'single', $2, $2)
     ON CONFLICT (semester_id, activity_key) WHERE activity_key IS NOT NULL DO UPDATE
        SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
    [semesterId, endDate]
  );

const activateViaApi = (request: APIRequestContext, semesterId: number) =>
  request.post(`${API_URL}/semesters/${semesterId}/activate`);

const evidence = () => ({
  name: 'acceptance.pdf',
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
});

const uploadAcceptance = async (request: APIRequestContext, formId: number) =>
  request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
    multipart: {
      evidence: evidence(),
      name: 'สุรเดช ใจดี',
      email: 'suradech-sem@seagate.com',
      phone: '0812223333',
      start_date: '2026-11-02',
      signer_name: 'คุณสมชาย ผู้จัดการฝ่ายบุคคล',
      signer_position: 'ผู้จัดการฝ่ายบุคคล',
      signed_date: await today(),
    },
  });

test.describe('วงจรภาคเรียน', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('S1: สร้าง/เปิด/ปิดภาคและดูรายการ — เจ้าหน้าที่เท่านั้น', async ({ request }) => {
    const { b } = await twoSemesters();

    // ไม่ล็อกอิน
    expect((await request.get(`${API_URL}/semesters`)).status()).toBe(401);

    for (const account of ['student2', 'advisor1', 'head1', 'dean1'] as const) {
      await apiLoginAs(request, account);
      expect((await request.get(`${API_URL}/semesters`)).status(), `${account} GET`).toBe(403);
      expect(
        (await request.post(`${API_URL}/semesters`, { data: { academic_year: 2570, semester: '1' } })).status(),
        `${account} POST`
      ).toBe(403);
      expect((await activateViaApi(request, b)).status(), `${account} activate`).toBe(403);
      expect((await request.post(`${API_URL}/semesters/${b}/close`)).status(), `${account} close`).toBe(403);
    }

    // ไม่มีอะไรเปลี่ยนในฐาน
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM coop_semesters')).toBe(2);
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM coop_semesters WHERE is_active')).toBe(1);
  });

  test('S2: สร้างภาค — ปี พ.ศ. · ภาค 1/2/3 · ซ้ำไม่ได้ · ยังไม่เปิดใช้งาน · ลง audit', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    const ce = await request.post(`${API_URL}/semesters`, { data: { academic_year: 2027, semester: '1' } });
    expect(ce.status()).toBe(400);
    expect((await ce.json()).message).toContain('พ.ศ.');

    const badTerm = await request.post(`${API_URL}/semesters`, { data: { academic_year: 2570, semester: '4' } });
    expect(badTerm.status()).toBe(400);

    const dup = await request.post(`${API_URL}/semesters`, { data: { academic_year: 2569, semester: '1' } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).message).toContain('มี');

    const ok = await request.post(`${API_URL}/semesters`, { data: { academic_year: 2570, semester: '3' } });
    expect(ok.status(), await ok.text()).toBe(201);
    const created = (await ok.json()).semester;
    expect(created.label).toBe('ภาคฤดูร้อน/2570');
    expect(created.is_active).toBe(false);
    expect(created.closed_at).toBeNull();

    // ยังมีภาค active ภาคเดียวคือภาคเดิม
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM coop_semesters WHERE is_active')).toBe(1);
    const audit = await dbRow<{ detail: { academic_year: number; semester: string } }>(
      `SELECT detail FROM audit_log WHERE action = 'semester.created' AND entity_id = $1`,
      [String(created.semester_id)]
    );
    expect(audit?.detail.academic_year).toBe(2570);

    // รายการภาคที่ API ตอบ: ใหม่สุดก่อน
    const list = (await (await request.get(`${API_URL}/semesters`)).json()).semesters as { label: string }[];
    expect(list.map((s) => s.label)).toEqual(['ภาคฤดูร้อน/2570', 'ภาคเรียนที่ 2/2569', 'ภาคเรียนที่ 1/2569']);
  });

  test('S3: ฐานกันเอง — ปีไม่ใช่ พ.ศ. · (ปี,ภาค) ซ้ำ · ภาค active สองแถว ถูกปฏิเสธโดยไม่พึ่งโค้ด', async () => {
    const { b } = await twoSemesters();

    await expect(
      dbExec(`INSERT INTO coop_semesters (academic_year, semester, is_active) VALUES (2027, '1', FALSE)`)
    ).rejects.toThrow(/coop_semesters_year_be/);

    await expect(
      dbExec(`INSERT INTO coop_semesters (academic_year, semester, is_active) VALUES (2569, '1', FALSE)`)
    ).rejects.toThrow(/coop_semesters_year_semester_key/);

    // เปิดภาคที่สองตรง ๆ โดยไม่ปิดภาคเดิม — ฐานต้องไม่ยอม (หน้าจอทุกจอ LIMIT 1 ไม่มี ORDER BY หยิบแถวไหนก็ไม่แน่นอน)
    await expect(dbExec('UPDATE coop_semesters SET is_active = TRUE WHERE semester_id = $1', [b])).rejects.toThrow(
      /uq_coop_semesters_one_active/
    );
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM coop_semesters WHERE is_active')).toBe(1);

    // seed เป็น พ.ศ.
    expect(await dbValue<number>('SELECT academic_year FROM coop_semesters WHERE is_active')).toBe(2569);
  });

  test('S4: เปิดภาคใหม่ — ภาคเดิมหยุดรับ ภาคเดียวที่ active · ใบที่ค้างไม่ถูกแตะ · เปิดซ้ำ 409 · ลง audit', async ({ request }) => {
    const { a, b } = await twoSemesters();
    const pendingForm = await putForm(await newStudent(), a, 'pending_officer_request');
    const acceptedForm = await putForm('student2@test.com', a, 'accepted');

    await apiLoginAs(request, 'staff1');
    expect((await activateViaApi(request, 999999)).status()).toBe(404);
    expect((await request.post(`${API_URL}/semesters/abc/activate`)).status()).toBe(400);

    const res = await activateViaApi(request, b);
    expect(res.status(), await res.text()).toBe(200);

    const rows = await dbRows<{ semester_id: number; is_active: boolean; closed_at: string | null }>(
      'SELECT semester_id, is_active, closed_at FROM coop_semesters ORDER BY semester_id'
    );
    expect(rows.filter((r) => r.is_active).map((r) => r.semester_id)).toEqual([b]);
    // ภาคเดิมแค่หยุดรับ ไม่ได้ "ปิดภาค"
    expect(rows.find((r) => r.semester_id === a)?.closed_at).toBeNull();

    // ใบภาคเดิมอยู่ที่เดิม สถานะเดิม
    for (const [formId, status] of [
      [pendingForm, 'pending_officer_request'],
      [acceptedForm, 'accepted'],
    ] as const) {
      const f = await dbRow<{ semester_id: number; status: string }>(
        'SELECT semester_id, status FROM intent_forms WHERE form_id = $1',
        [formId]
      );
      expect(f).toEqual({ semester_id: a, status });
    }

    expect((await activateViaApi(request, b)).status()).toBe(409);

    const audit = await dbRow<{ detail: { previous_semester_id: number; open_forms_in_previous: number } }>(
      `SELECT detail FROM audit_log WHERE action = 'semester.activated' AND entity_id = $1`,
      [String(b)]
    );
    expect(audit?.detail.previous_semester_id).toBe(a);
    expect(audit?.detail.open_forms_in_previous).toBe(1);
  });

  test('S5: ปิดภาค — ตั้ง closed_at · ไม่ลบ/ไม่ย้าย/ไม่เปลี่ยนสถานะใบ · ปิดซ้ำ 409 · เปิดอีกครั้งล้าง closed_at', async ({
    request,
  }) => {
    const { a } = await twoSemesters();
    const formId = await putForm(await newStudent(), a, 'approved_by_dept_head');

    await apiLoginAs(request, 'staff1');
    const res = await request.post(`${API_URL}/semesters/${a}/close`);
    expect(res.status(), await res.text()).toBe(200);

    const sem = await dbRow<{ is_active: boolean; closed_at: string | null }>(
      'SELECT is_active, closed_at FROM coop_semesters WHERE semester_id = $1',
      [a]
    );
    expect(sem?.is_active).toBe(false);
    expect(sem?.closed_at).not.toBeNull();
    // ปิดภาคที่เปิดอยู่ = ไม่มีภาค active จนกว่าจะเปิดภาคใหม่
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM coop_semesters WHERE is_active')).toBe(0);

    // ใบที่ค้างอยู่ตามเดิม
    expect(
      await dbRow('SELECT semester_id, status FROM intent_forms WHERE form_id = $1', [formId])
    ).toEqual({ semester_id: a, status: 'approved_by_dept_head' });

    expect((await request.post(`${API_URL}/semesters/${a}/close`)).status()).toBe(409);

    const audit = await dbRow<{ detail: { was_active: boolean; open_forms: number } }>(
      `SELECT detail FROM audit_log WHERE action = 'semester.closed' AND entity_id = $1`,
      [String(a)]
    );
    expect(audit?.detail.was_active).toBe(true);
    expect(audit?.detail.open_forms).toBe(1);

    // กดปิดผิด — เปิดอีกครั้งได้โดยไม่ต้องเขียน SQL
    expect((await activateViaApi(request, a)).status()).toBe(200);
    const reopened = await dbRow<{ is_active: boolean; closed_at: string | null }>(
      'SELECT is_active, closed_at FROM coop_semesters WHERE semester_id = $1',
      [a]
    );
    expect(reopened).toEqual({ is_active: true, closed_at: null });
  });

  test('S6: คัดลอกปฏิทิน — ค่าเริ่มต้นไม่เอาวัน (เหลือข้อความล้วน) · ติ๊กเลื่อน +1 ปีได้วันครบ', async ({ request }) => {
    const { a } = await twoSemesters();
    await dbExec(
      `INSERT INTO coop_calendar_events (semester_id, activity_key, title, date_kind, start_date, end_date, late_end_date, detail_text, sort_order, note)
       VALUES ($1, 'report_outline', NULL, 'range', '2026-09-01', '2026-09-30', '2026-10-05', NULL, 1, 'หมายเหตุ'),
              ($1, NULL, 'ปฐมนิเทศ', 'single', '2026-08-15', '2026-08-15', NULL, NULL, 2, NULL),
              ($1, NULL, 'นิเทศตามสาขา', 'relative', NULL, NULL, NULL, 'ให้เป็นไปตามสาขาวิชากำหนด', 3, NULL)`,
      [a]
    );

    await apiLoginAs(request, 'staff1');

    const blank = await request.post(`${API_URL}/semesters`, {
      data: { academic_year: 2570, semester: '1', copy_from: a, shift_year: false },
    });
    expect(blank.status(), await blank.text()).toBe(201);
    const blankId = (await blank.json()).semester.semester_id as number;
    expect((await blank.json()).copied_events).toBe(1);
    expect(
      await dbRows('SELECT title, date_kind, detail_text, start_date FROM coop_calendar_events WHERE semester_id = $1', [blankId])
    ).toEqual([{ title: 'นิเทศตามสาขา', date_kind: 'relative', detail_text: 'ให้เป็นไปตามสาขาวิชากำหนด', start_date: null }]);

    const shifted = await request.post(`${API_URL}/semesters`, {
      data: { academic_year: 2571, semester: '1', copy_from: a, shift_year: true },
    });
    expect(shifted.status(), await shifted.text()).toBe(201);
    const shiftedId = (await shifted.json()).semester.semester_id as number;
    expect((await shifted.json()).copied_events).toBe(3);
    const range = await dbRow<{ start_date: string; end_date: string; late_end_date: string; note: string }>(
      `SELECT start_date, end_date, late_end_date, note FROM coop_calendar_events WHERE semester_id = $1 AND activity_key = 'report_outline'`,
      [shiftedId]
    );
    expect(range).toEqual({ start_date: '2027-09-01', end_date: '2027-09-30', late_end_date: '2027-10-05', note: 'หมายเหตุ' });

    // ต้นทางไม่ถูกแตะ
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM coop_calendar_events WHERE semester_id = $1', [a])).toBe(3);

    const missing = await request.post(`${API_URL}/semesters`, {
      data: { academic_year: 2572, semester: '1', copy_from: 987654 },
    });
    expect(missing.status()).toBe(404);
    // 404 ต้อง rollback — ไม่มีภาค 2572 ค้าง
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM coop_semesters WHERE academic_year = 2572')).toBe(0);
  });

  test('S7: ด่านปฏิทินอ่านภาคของ "ใบ" — ใบภาค 1 ตอบรับตามหน้าต่างภาค 1 ตอนภาค 2 เปิดอยู่ (และกลับกัน)', async ({ request }) => {
    const { a, b } = await twoSemesters();
    const now = await today();

    // กรณี 1: หน้าต่างภาค 1 (ของใบ) เปิดอยู่ · หน้าต่างภาค 2 (ภาค active ใหม่) ปิดแล้ว
    //   — พฤติกรรมเดิมอ่านภาค active → 403 ทั้งที่ใบยังอยู่ในหน้าต่างของตัวเอง
    const openForm = await putForm('student2@test.com', a, 'approved_by_dept_head', 5);
    await setAcceptanceDeadline(a, shift(now, 10));
    await setAcceptanceDeadline(b, shift(now, -3));

    await apiLoginAs(request, 'staff1');
    expect((await activateViaApi(request, b)).status()).toBe(200);

    await apiLoginAs(request, 'student2');
    const ok = await uploadAcceptance(request, openForm);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [openForm])).toBe(
      'pending_officer_approval'
    );

    // กรณี 2: หน้าต่างภาค 1 ปิดแล้ว · หน้าต่างภาค 2 เปิดอยู่ — ต้องปฏิเสธ (ไม่ใช่ปล่อยเพราะภาคใหม่เปิด)
    await dbExec('DELETE FROM intent_forms WHERE form_id = $1', [openForm]);
    const closedForm = await putForm('student2@test.com', a, 'approved_by_dept_head', 5);
    await setAcceptanceDeadline(a, shift(now, -3));
    await setAcceptanceDeadline(b, shift(now, 10));

    const denied = await uploadAcceptance(request, closedForm);
    expect(denied.status(), await denied.text()).toBe(403);
    expect((await denied.json()).message).toContain('หมดช่วง');
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [closedForm])).toBe(
      'approved_by_dept_head'
    );

    // กรณี 3: ใบของคนอื่น/ไม่มีใบ → ถอยไปภาค active (หน้าต่างภาค 2 เปิดอยู่) แล้ว controller ตอบเรื่องความเป็นเจ้าของเอง
    await apiLoginAs(request, 'student1');
    const notMine = await uploadAcceptance(request, closedForm);
    expect(notMine.status()).not.toBe(200);
    // ถูกปฏิเสธเพราะไม่ใช่ใบของตัวเอง ไม่ใช่เพราะหน้าต่างปฏิทิน — และไม่บอกว่าใบนั้นอยู่ภาคไหน/หน้าต่างปิดหรือไม่
    expect(((await notMine.json()).message as string) ?? '').not.toContain('หมดช่วง');
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [closedForm])).toBe(
      'approved_by_dept_head'
    );
  });

  test('S8: /calendar ของนักศึกษา = ปฏิทินของภาคที่ใบตัวเองอยู่ · ไม่มีใบ = ภาค active', async ({ request }) => {
    const { a, b } = await twoSemesters();
    await putForm('student2@test.com', a, 'accepted');

    await apiLoginAs(request, 'staff1');
    expect((await activateViaApi(request, b)).status()).toBe(200);

    await apiLoginAs(request, 'student2');
    expect((await (await request.get(`${API_URL}/calendar`)).json()).semester.semester_id).toBe(a);

    // นักศึกษาที่ไม่มีใบ เห็นภาคที่เปิดอยู่
    await apiLoginAs(request, 'student1');
    expect((await (await request.get(`${API_URL}/calendar`)).json()).semester.semester_id).toBe(b);

    // ใบที่จบเส้นทางแล้ว (ถูกปฏิเสธ) ไม่นับเป็นภาคของนักศึกษา
    await dbExec(`UPDATE intent_forms SET status = 'company_rejected' WHERE student_id = $1`, [await userId('student2@test.com')]);
    await apiLoginAs(request, 'student2');
    expect((await (await request.get(`${API_URL}/calendar`)).json()).semester.semester_id).toBe(b);
  });

  test('S9: ผลประเมินอ่านวันสิ้นสุดของภาคที่นักศึกษาฝึก — ภาคเก่าฝึกจบแล้วไม่ถูกปิดด้วยวันของภาคใหม่', async ({ request }) => {
    const { a, b } = await twoSemesters();
    const now = await today();
    await putForm('student2@test.com', a, 'accepted');
    await setCoopEnd(a, shift(now, -1)); // ภาค 1 ฝึกจบแล้ว
    await setCoopEnd(b, shift(now, 60)); // ภาค 2 ยังไม่ถึง

    await apiLoginAs(request, 'staff1');
    expect((await activateViaApi(request, b)).status()).toBe(200);

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/final-evaluations/my-result`);
    // เดิมอ่านภาค active (ภาค 2 ยังไม่ถึง) → 403 "ยังไม่เปิดเผย" ทั้งที่ภาคของตัวเองจบแล้ว
    expect(res.status(), await res.text()).toBe(200);

    // ตรงข้าม: วันสิ้นสุดของภาคตัวเองยังไม่ถึง → ยังปิด (fail-closed เหมือนเดิม) แม้ภาคใหม่จะเลยวันไปแล้ว
    await setCoopEnd(a, shift(now, 30));
    await setCoopEnd(b, shift(now, -30));
    const closed = await request.get(`${API_URL}/final-evaluations/my-result`);
    expect(closed.status(), await closed.text()).toBe(403);
  });

  test('S10: หน้าจอ — สร้างภาคฤดูร้อน แล้วเปิด · ตัวเลขในกล่องยืนยันตรงกับข้อมูลจริง · ภาคเดิมกลายเป็นหยุดรับ', async ({ page }) => {
    test.setTimeout(120_000);
    const { a } = await twoSemesters();
    await putForm(await newStudent(), a, 'pending_officer_request');

    await loginAs(page, 'staff1');
    await goToMenu(page, 'semesters');
    expect(new URL(page.url()).searchParams.get('menu')).toBe('semesters');

    await expect(page.getByTestId(`semester-state-${a}`)).toHaveText('เปิดรับอยู่');
    await expect(page.getByTestId(`semester-row-${a}`)).toContainText('ภาคเรียนที่ 1/2569');
    // ภาคที่เปิดอยู่เปิดซ้ำไม่ได้ (ไม่มีปุ่ม) · ปิดได้
    await expect(page.getByTestId(`semester-activate-${a}`)).toHaveCount(0);
    await expect(page.getByTestId(`semester-close-${a}`)).toBeVisible();

    // สร้างภาค (ไม่คัดลอกปฏิทิน)
    await page.getByTestId('semester-create-open').click();
    await page.getByTestId('semester-create-year').fill('2570');
    await page.getByTestId('semester-create-term').selectOption('3');
    await page.getByTestId('semester-create-copy').selectOption('');
    await page.getByTestId('semester-create-submit').click();
    await expect(page.getByText('สร้างภาคฤดูร้อน/2570แล้ว (ยังไม่เปิด)')).toBeVisible();

    const newId = (await dbValue<number>(`SELECT semester_id FROM coop_semesters WHERE academic_year = 2570`))!;
    await expect(page.getByTestId(`semester-state-${newId}`)).toContainText('ยังไม่ได้เปิด');

    // ข้อความผิดจากเซิร์ฟเวอร์ขึ้นในกล่อง ไม่ใช่เงียบ — ปีซ้ำ
    await page.getByTestId('semester-create-open').click();
    await page.getByTestId('semester-create-year').fill('2570');
    await page.getByTestId('semester-create-term').selectOption('3');
    await page.getByTestId('semester-create-submit').click();
    await expect(page.getByRole('dialog').getByText('มีภาคฤดูร้อน/2570อยู่แล้ว')).toBeVisible();
    await page.keyboard.press('Escape');

    // เปิดภาคใหม่: กล่องยืนยันบอกผลกระทบของภาคเดิม
    await page.getByTestId(`semester-activate-${newId}`).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('ภาคเรียนที่ 1/2569 จะหยุดรับ');
    await expect(dialog).toContainText('1 ใบ');
    await page.getByTestId('semester-confirm').click();

    await expect(page.getByTestId(`semester-state-${newId}`)).toHaveText('เปิดรับอยู่');
    await expect(page.getByTestId(`semester-state-${a}`)).toContainText('ยังไม่ได้เปิด');
    expect(await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active')).toBe(newId);

    // ปิดภาคใหม่ — ใบเก่ายังอยู่ขั้นเดิม
    await page.getByTestId(`semester-close-${newId}`).click();
    await expect(page.getByRole('dialog')).toContainText('จะไม่มีภาคที่เปิดรับ');
    await page.getByTestId('semester-confirm').click();
    await expect(page.getByTestId(`semester-state-${newId}`)).toContainText('ปิดแล้ว');
    expect(
      await dbValue<string>(`SELECT status FROM intent_forms WHERE semester_id = $1`, [a])
    ).toBe('pending_officer_request');
  });
});
