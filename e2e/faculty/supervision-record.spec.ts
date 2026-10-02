import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue, dbExec, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * สหกิจ 13 — แบบบันทึกการนิเทศงาน (37 ข้อ) · **ระบบล้วน ไม่มีเส้นทางออกเป็นเอกสาร**
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **`-` เก็บเป็น null ไม่ใช่ 0** และ **ไม่บังคับตอบครบ** — ต่างจาก สหกิจ 15/16
 *   2. **ไม่มี total_score** เพราะใบนี้ไม่ได้เอาไปตัดเกรด
 *   3. **บริษัทและนักศึกษาเข้าไม่ได้เลย** — ส่วนที่ 1 คือความเห็นต่อบริษัท
 *   4. **สถานประกอบการมาจากใบตอบรับ ไม่ใช่จากผู้เรียก** (บันทึกต้องเชื่อถือได้)
 *   5. **ส่งทับได้ = แก้ไข** ไม่เกิดบันทึกซ้ำของครั้งเดียวกัน
 */

let studentId: number;

/** นักศึกษาที่มีใบตอบรับแล้ว + อยู่ในความดูแลของ advisor1 */
async function seedSupervised(): Promise<number> {
  return withDb(async (db) => {
    const sid = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id;
    const advisorId = (
      await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")
    ).rows[0].user_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      .company_id;

    await db.query(
      'UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2',
      [advisorId, sid]
    );
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'accepted', '2026-11-02')`,
      [sid, companyId, semesterId]
    );
    return sid as number;
  });
}

const submit = (request: APIRequestContext, sid: number, body: Record<string, unknown>) =>
  request.put(`${API_URL}/supervision-records/student/${sid}`, { data: body });

const today = () =>
  dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`) as Promise<string>;

test.describe('สหกิจ 13 — แบบบันทึกการนิเทศงาน', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('DELETE FROM supervision_records');
    studentId = await seedSupervised();
  });

  test('V1: โครงฟอร์มมาจากเซิร์ฟเวอร์ครบ 37 ข้อ และสเกลมี "-"', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const res = await request.get(`${API_URL}/supervision-records/form`);
    expect(res.status()).toBe(200);
    const form = await res.json();

    const count = (groups: { items: unknown[] }[]) =>
      groups.reduce((sum, g) => sum + g.items.length, 0);
    // ⛔ ตัวเลขนี้มาจากการนับบนกระดาษจริง — เปลี่ยนเมื่อไหร่แปลว่ามีคนแก้หัวข้อ
    expect(count(form.company_section)).toBe(21);
    expect(count(form.student_section)).toBe(16);
    expect(form.document_items).toHaveLength(4);
    expect(Object.keys(form.scale)).toContain('-');
    expect(form.visits).toEqual([1, 2]);
  });

  test('V2: บันทึกได้โดยไม่ต้องตอบครบ · "-" ลงฐานเป็น null ไม่ใช่ 0', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const res = await submit(request, studentId, {
      visit_number: 1,
      visit_date: await today(),
      // ตอบแค่ 3 ข้อจาก 37 — ต้องผ่าน (ต่างจาก สหกิจ 15/16 ที่บังคับครบ)
      scores: { c1_1: 5, c2_1: null, s1_1: 3 },
      remarks: { c1_1: 'ผู้บริหารเข้าใจดีมาก' },
    });
    expect(res.status(), await res.text()).toBe(200);

    const row = await dbRow<{ scores: Record<string, number | null>; remarks: Record<string, string> }>(
      'SELECT scores, remarks FROM supervision_records WHERE student_id = $1 AND visit_number = 1',
      [studentId]
    );
    expect(row?.scores.c1_1).toBe(5);
    // ⛔ null ต้องเป็น null จริง ไม่ใช่ถูกแปลงเป็น 0
    expect(row?.scores.c2_1).toBeNull();
    expect(row?.scores).not.toHaveProperty('c1_2');
    expect(row?.remarks.c1_1).toBe('ผู้บริหารเข้าใจดีมาก');
  });

  test('V3: ใบนี้ไม่มีคอลัมน์ total_score — จงใจไม่รวมคะแนน', async () => {
    // ⛔ ตัวกันไม่ให้ใครเผลอเติม total_score เข้ามาแล้วรวมคะแนนที่มี null ปนอยู่
    //    ซึ่งจะได้ตัวเลขที่ตีความไม่ได้ (0 กับ "ไม่ประเมิน" ต่างกัน)
    const col = await dbValue<string>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'supervision_records' AND column_name = 'total_score'`
    );
    expect(col).toBeUndefined();
  });

  test('V4: คะแนนนอกช่วง 1-5 และคีย์แปลกปลอม → 400', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const date = await today();

    const tooHigh = await submit(request, studentId, {
      visit_number: 1,
      visit_date: date,
      scores: { c1_1: 9 },
    });
    expect(tooHigh.status()).toBe(400);

    // ⛔ ชุดคีย์ของใบนี้ตายตัวจากกระดาษ — คีย์ที่ไม่รู้จักแปลว่ามีคนส่งของผิดใบมา
    //    ต้องปฏิเสธ ไม่ใช่ตัดทิ้งเงียบๆ (ต่างจาก JSONB ประวัติของ สหกิจ 03)
    const alien = await submit(request, studentId, {
      visit_number: 1,
      visit_date: date,
      scores: { not_a_real_item: 3 },
    });
    expect(alien.status()).toBe(400);
    expect((await alien.json()).message as string).toContain('ไม่รู้จัก');

    expect(await dbValue<string>('SELECT COUNT(*) FROM supervision_records')).toBe('0');
  });

  test('V5: ครั้งที่นิเทศต้องเป็น 1 หรือ 2 · วันที่อนาคตไม่ได้', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');

    const badVisit = await submit(request, studentId, {
      visit_number: 3,
      visit_date: await today(),
      scores: {},
    });
    expect(badVisit.status()).toBe(400);

    const future = await submit(request, studentId, {
      visit_number: 1,
      visit_date: '2099-01-01',
      scores: {},
    });
    expect(future.status()).toBe(400);
    expect((await future.json()).message as string).toContain('อนาคต');
  });

  test('V6: ส่งทับ = แก้ไข ไม่เกิดบันทึกซ้ำของครั้งเดียวกัน', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const date = await today();

    expect(
      (await submit(request, studentId, { visit_number: 1, visit_date: date, scores: { c1_1: 1 } }))
        .status()
    ).toBe(200);
    expect(
      (await submit(request, studentId, { visit_number: 1, visit_date: date, scores: { c1_1: 5 } }))
        .status()
    ).toBe(200);

    expect(
      await dbValue<string>('SELECT COUNT(*) FROM supervision_records WHERE student_id = $1', [
        studentId,
      ])
    ).toBe('1');
    const row = await dbRow<{ scores: Record<string, number> }>(
      'SELECT scores FROM supervision_records WHERE student_id = $1 AND visit_number = 1',
      [studentId]
    );
    expect(row?.scores.c1_1).toBe(5);

    // ครั้งที่ 2 เป็นคนละบันทึก
    expect(
      (await submit(request, studentId, { visit_number: 2, visit_date: date, scores: { c1_1: 4 } }))
        .status()
    ).toBe(200);
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM supervision_records WHERE student_id = $1', [
        studentId,
      ])
    ).toBe('2');
  });

  test('V7: สถานประกอบการมาจากใบตอบรับ ไม่ใช่จากผู้เรียก · ไม่มีใบตอบรับ → 409', async ({
    request,
  }) => {
    await apiLoginAs(request, 'advisor1');
    const date = await today();

    // ⛔ ส่ง company_id ปลอมมาต้องไม่มีผล — บันทึกต้องชี้บริษัทจากใบตอบรับเสมอ
    expect(
      (
        await submit(request, studentId, {
          visit_number: 1,
          visit_date: date,
          scores: {},
          company_id: 999999,
        })
      ).status()
    ).toBe(200);
    const realCompany = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
    expect(
      await dbValue<number>(
        'SELECT company_id FROM supervision_records WHERE student_id = $1 AND visit_number = 1',
        [studentId]
      )
    ).toBe(realCompany);

    // นักศึกษาที่ยังไม่มีใบตอบรับ → บันทึกไม่ได้
    await dbExec("UPDATE intent_forms SET status = 'pending_advisor' WHERE student_id = $1", [
      studentId,
    ]);
    await dbExec('DELETE FROM supervision_records');
    const res = await submit(request, studentId, {
      visit_number: 1,
      visit_date: date,
      scores: {},
    });
    expect(res.status()).toBe(409);
  });

  test('V8: สิทธิ์ — นักศึกษาและพี่เลี้ยงเข้าไม่ได้เลย · อาจารย์นอกความดูแลก็ไม่ได้', async ({
    request,
  }) => {
    await apiLoginAs(request, 'advisor1');
    expect(
      (
        await submit(request, studentId, {
          visit_number: 1,
          visit_date: await today(),
          scores: { c1_1: 4 },
        })
      ).status()
    ).toBe(200);

    // ⛔ ส่วนที่ 1 คือความเห็นของอาจารย์ต่อบริษัท — ฝั่งสถานประกอบการ (พี่เลี้ยง) ต้องไม่มีทางเห็น
    await apiLoginAs(request, 'mentor1');
    expect(
      (await request.get(`${API_URL}/supervision-records/student/${studentId}`)).status()
    ).toBe(403);

    // นักศึกษาก็ไม่เห็นความเห็นที่อาจารย์เขียนถึงตัวเอง
    await apiLoginAs(request, 'student2');
    expect(
      (await request.get(`${API_URL}/supervision-records/student/${studentId}`)).status()
    ).toBe(403);

    await apiLoginAs(request, 'advisor2');
    expect(
      (await request.get(`${API_URL}/supervision-records/student/${studentId}`)).status()
    ).toBe(403);

    await apiLoginAs(request, 'advisor1');
    expect(
      (await request.get(`${API_URL}/supervision-records/student/${studentId}`)).status()
    ).toBe(200);
  });

  test('V9: ลงบันทึกแล้วต้องลง audit_log (แทนลายเซ็น 3 คนบนกระดาษ)', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    expect(
      (
        await submit(request, studentId, {
          visit_number: 1,
          visit_date: await today(),
          scores: { c1_1: 4 },
        })
      ).status()
    ).toBe(200);

    // ⚠️ `writeAudit` เป็น fire-and-forget — ลงหลัง response จึงต้อง poll
    await expect
      .poll(() =>
        dbValue<string>(
          `SELECT actor_email FROM audit_log
            WHERE action = 'supervision_record.submitted' AND subject_id = $1
            ORDER BY audit_id DESC LIMIT 1`,
          [studentId]
        )
      )
      .toBe('advisor1@test.com');
  });

  test('V10: หน้าจออาจารย์ — เลือกนักศึกษา กรอก บันทึก แล้วค่ายังอยู่', async ({ page }) => {
    test.setTimeout(120_000);
    const date = await today();

    await loginAs(page, 'advisor1');
    // spec-F ข้อ 1: เมนูนี้ย้ายไปอยู่ฝ่ายนิเทศ (advisor1 ใน seed เป็นทั้งสองฝ่าย) — สลับฝ่ายก่อน
    await page.getByTestId('role-btn-supervisor').click();
    await goToMenu(page, 'supervision_record');

    // ยังไม่เลือกนักศึกษา = ยังไม่แสดงตารางประเมิน
    await expect(page.getByTestId('sv-item')).toHaveCount(0);

    await page.getByTestId('sv-student').selectOption(String(studentId));
    // 37 ข้อจากกระดาษจริง — ทั้งสองส่วนรวมกัน
    await expect(page.getByTestId('sv-item')).toHaveCount(37);

    await page.getByTestId('sv-date').fill(date);
    await page.getByTestId('sv-score-c1_1').selectOption('5');
    await page.getByTestId('sv-score-c2_1').selectOption('-');
    await page.getByTestId('sv-remark-c1_1').fill('ผู้บริหารเข้าใจดี');
    await page.getByTestId('sv-doc-doc_accommodation').check();
    await page.getByTestId('sv-notes').fill('นักศึกษาปรับตัวได้ดี');
    await page.getByTestId('sv-submit').click();

    await expect(page.getByText(/บันทึกการนิเทศครั้งที่ 1 เรียบร้อยแล้ว/)).toBeVisible();
    await expect(page.getByTestId('sv-saved-summary')).toContainText('ครั้งที่ 1');

    const row = await dbRow<{
      scores: Record<string, number | null>;
      documents_required: Record<string, boolean>;
      additional_notes: string;
    }>(
      `SELECT scores, documents_required, additional_notes
         FROM supervision_records WHERE student_id = $1 AND visit_number = 1`,
      [studentId]
    );
    expect(row?.scores.c1_1).toBe(5);
    expect(row?.scores.c2_1).toBeNull();
    expect(row?.documents_required.doc_accommodation).toBe(true);
    expect(row?.additional_notes).toBe('นักศึกษาปรับตัวได้ดี');

    // เมนูอยู่ใน React state ไม่ใช่ URL — รีโหลดแล้วต้องเข้าเมนูใหม่
    await page.reload();
    await goToMenu(page, 'supervision_record');
    await page.getByTestId('sv-student').selectOption(String(studentId));
    await expect(page.getByTestId('sv-score-c1_1')).toHaveValue('5');
    await expect(page.getByTestId('sv-score-c2_1')).toHaveValue('-');
  });
});
