import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbRow, dbValue, mentor1Id, withDb } from '../helpers/db';

/**
 * ชั้นสิทธิ์ของฝ่ายสถานประกอบการและพี่เลี้ยง — **ยิง API ตรง ไม่แตะหน้าจอ**
 *
 * เขียนแยกจากเทสต์ที่เดินผ่านจอโดยตั้งใจ เพราะรอบรื้อ UI ฝ่ายนี้ยังไม่จบ
 * (Antigravity ทำ F1–F4 อยู่) ลำดับหน้าจอ ปุ่ม และข้อความจะเปลี่ยนอีกหลายรอบ
 * แต่ **"ใครทำได้/ใครทำไม่ได้" ไม่เปลี่ยนตามการรื้อหน้าจอ** และเป็นสิ่งที่พังเงียบ
 * — ไม่มีข้อความ error ให้ใครเห็น มีแต่คนที่ไม่ควรกดได้ กดได้
 *
 * ทุกเคสในไฟล์นี้คือกฎที่เพิ่งเปลี่ยนในรอบสถานประกอบการ/พี่เลี้ยง (spec-D)
 * ถ้าเคสไหนแดง แปลว่ามีคนเปิดประตูที่ปิดไปแล้วกลับมา ไม่ใช่เทสต์ล้าสมัย
 */

/** ผูกพี่เลี้ยงกับนักศึกษาให้เหมือนใบความจำนงที่ถูกตอบรับแล้ว */
async function attachMentorTo(studentEmail: string): Promise<{ mentorId: number; companyId: number }> {
  return withDb(async (db) => {
    const student = await db.query('SELECT user_id FROM users WHERE email = $1', [studentEmail]);
    const studentId = student.rows[0].user_id as number;

    const company = await db.query('SELECT company_id FROM companies LIMIT 1');
    const companyId = company.rows[0].company_id as number;
    const mentorId = await mentor1Id();

    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');

    // พี่เลี้ยง = mentor1 (seed ไว้แล้ว role mentor ล้วน)
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
       VALUES ($1, $2, $3, 'accepted', $4, CURRENT_DATE)`,
      [studentId, companyId, semester.rows[0].semester_id, mentorId]
    );

    return { mentorId, companyId };
  });
}

/**
 * นักศึกษาอีกคนที่อยู่บริษัทเดียวกันแต่ไม่ได้อยู่ในความดูแลของพี่เลี้ยงคนนี้
 * seed มีโปรไฟล์นักศึกษาแค่ student2 คนเดียว จึงต้องสร้างขึ้นมาเอง
 */
async function makeOtherStudent(): Promise<string> {
  const email = 'student-other@test.com';
  await withDb(async (db) => {
    const user = await db.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'x')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING user_id`,
      [email]
    );
    const userId = user.rows[0].user_id as number;
    await db.query(
      `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student') ON CONFLICT DO NOTHING`,
      [userId]
    );
    // ⛔ enrollment_year ต้องใหม่พอที่ DeactivationScheduler จะไม่ปิดบัญชีกลางเทสต์
    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year)
       VALUES ($1, '65999999', (SELECT major_id FROM master_major LIMIT 1), 3.00, 2569)
       ON CONFLICT (student_id) DO NOTHING`,
      [userId]
    );
  });
  return email;
}

/**
 * โครงร่างที่รอ **พี่เลี้ยง** ตรวจ (สหกิจ 11 ขั้นแรก)
 * ⛔ ขั้นของพี่เลี้ยงคือ `pending_mentor` → กดแล้วไปเป็น `pending_advisor`
 *    ส่วน `approved` เป็นการกดของอาจารย์ที่ปรึกษา คนละขั้นกัน
 */
async function makeOutline(studentEmail: string, companyId: number): Promise<number> {
  const studentId = await dbValue<number>('SELECT user_id FROM users WHERE email = $1', [studentEmail]);
  const row = await dbRow<{ outline_id: number }>(
    `INSERT INTO report_outlines (student_id, company_id, status)
     VALUES ($1, $2, 'pending_mentor') RETURNING outline_id`,
    [studentId, companyId]
  );
  return row!.outline_id;
}


test.describe('สิทธิ์ฝ่ายสถานประกอบการและพี่เลี้ยง (spec-D)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('เจ้าหน้าที่เห็นชอบหัวข้อรายงานแทนพี่เลี้ยงไม่ได้ · พี่เลี้ยงยังเห็นรายการของบริษัท', async ({
    request,
  }) => {
    const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
    const outlineId = await makeOutline('student2@test.com', companyId!);

    // ⛔ คนที่เห็นชอบหัวข้อคือพี่เลี้ยง/อาจารย์ที่ปรึกษา (spec-D 14.1) — เจ้าหน้าที่ธุรการกดแทนไม่ได้
    await apiLoginAs(request, 'staff1');
    const denied = await request.put(`${API_URL}/outlines/${outlineId}/status`, {
      data: { status: 'pending_advisor' },
    });
    expect(denied.status()).toBe(403);

    // ⛔ ห้ามซ่อนรายการทิ้ง — พี่เลี้ยงต้องเห็นว่ามีอะไรค้างของบริษัทตัวเอง
    await apiLoginAs(request, 'mentor1');
    const list = await request.get(`${API_URL}/outlines/company`);
    expect(list.status(), await list.text()).toBe(200);
    expect((await list.json()).data.length).toBeGreaterThan(0);

    expect(
      await dbValue<string>('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId])
    ).toBe('pending_mentor');
  });

  test('พี่เลี้ยงเห็นชอบหัวข้อได้เฉพาะนักศึกษาที่ตัวเองดูแล', async ({ request }) => {
    const { companyId } = await attachMentorTo('student2@test.com');
    const mine = await makeOutline('student2@test.com', companyId);
    // นักศึกษาที่ไม่มีใบความจำนงผูกกับพี่เลี้ยงคนนี้ แต่เป็นบริษัทเดียวกัน
    const notMine = await makeOutline(await makeOtherStudent(), companyId);

    await apiLoginAs(request, 'mentor1');

    const ok = await request.put(`${API_URL}/outlines/${mine}/status`, {
      data: { status: 'pending_advisor' },
    });
    expect(ok.status(), await ok.text()).toBe(200);

    // ⛔ อยู่บริษัทเดียวกันไม่พอ — ด่านผูกที่ระดับ *นักศึกษา* ไม่ใช่ระดับบริษัท
    const refused = await request.put(`${API_URL}/outlines/${notMine}/status`, {
      data: { status: 'pending_advisor' },
    });
    expect(refused.status()).toBe(403);
    expect(
      await dbValue<string>('SELECT status FROM report_outlines WHERE outline_id = $1', [notMine])
    ).toBe('pending_mentor');
  });

  test('พี่เลี้ยงเห็นปุ่มตรวจอนุมัติจริงบนหน้าจอใหม่ (ReportOutlineQueue) และกดผ่านได้', async ({
    page,
  }) => {
    const { companyId } = await attachMentorTo('student2@test.com');
    await makeOutline('student2@test.com', companyId);

    await loginAs(page, 'mentor1');
    await goToMenu(page, 'report_outlines');

    await page.getByRole('button', { name: 'ตรวจอนุมัติ' }).click();
    await page.getByRole('button', { name: 'อนุมัติและส่งต่ออาจารย์นิเทศ' }).click();
    await page.getByTestId('outline-mentor-approve-confirm').click();

    await expect(page.getByText('อนุมัติโครงร่างรายงาน (สหกิจ 11) และส่งต่อให้อาจารย์นิเทศพิจารณาเรียบร้อยแล้ว')).toBeVisible();
  });

  test('คิวรอรับรองเป็นของพี่เลี้ยง เจ้าหน้าที่เปิดไม่ได้', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    expect((await request.get(`${API_URL}/mentor/pending`)).status()).toBe(403);

    await attachMentorTo('student2@test.com');
    await apiLoginAs(request, 'mentor1');
    const ok = await request.get(`${API_URL}/mentor/pending`);
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('สวิตช์บันทึกรายวันเป็นของพี่เลี้ยง นักศึกษาเปิดให้ตัวเองไม่ได้', async ({ request }) => {
    await attachMentorTo('student2@test.com');
    const formId = await dbValue<number>(
      `SELECT form_id FROM intent_forms WHERE status = 'accepted' ORDER BY form_id DESC LIMIT 1`
    );

    await apiLoginAs(request, 'student2');
    expect(
      (await request.patch(`${API_URL}/intents/${formId}/daily-log-required`, { data: { value: true } })).status()
    ).toBe(403);

    await apiLoginAs(request, 'mentor1');
    const ok = await request.patch(`${API_URL}/intents/${formId}/daily-log-required`, {
      data: { value: true },
    });
    expect(ok.status(), await ok.text()).toBe(200);
    expect(
      await dbValue<boolean>('SELECT daily_log_required FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe(true);
  });

});
