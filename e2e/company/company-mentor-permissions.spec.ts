import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRow, dbValue, mentor1Id, withDb } from '../helpers/db';

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

    const job = await db.query('SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1', [companyId]);
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');

    // พี่เลี้ยง = mentor1 (seed ไว้แล้ว role mentor ล้วน)
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, mentor_id, start_date)
       VALUES ($1, $2, $3, $4, 'accepted', $5, CURRENT_DATE)`,
      [studentId, companyId, semester.rows[0].semester_id, job.rows[0].job_id, mentorId]
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

async function activeSemesterId(): Promise<number> {
  return (await dbValue<number>(
    'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1'
  ))!;
}

/** วันในอนาคตแบบ ISO — กำหนดส่งแบบสำรวจกลับต้องไม่เป็นอดีต */
async function futureDate(days = 30): Promise<string> {
  return (await dbValue<string>(
    `SELECT ((NOW() AT TIME ZONE 'Asia/Bangkok')::date + $1::int)::text`,
    [days]
  ))!;
}

test.describe('สิทธิ์ฝ่ายสถานประกอบการและพี่เลี้ยง (spec-D)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('ส่งแบบสำรวจ สหกิจ 02 เป็นของเจ้าหน้าที่เท่านั้น', async ({ request }) => {
    const semesterId = await activeSemesterId();
    const dueDate = await futureDate();
    const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
    const body = { company_ids: [companyId], semester_id: semesterId, due_date: dueDate };

    // ฝั่งสถานประกอบการ (พี่เลี้ยง) สั่งให้ระบบส่งแบบสำรวจไม่ได้ — คณะเป็นฝ่ายเริ่มเสมอ
    await apiLoginAs(request, 'mentor1');
    expect((await request.post(`${API_URL}/job-offers/send`, { data: body })).status()).toBe(403);

    await apiLoginAs(request, 'student1');
    expect((await request.post(`${API_URL}/job-offers/send`, { data: body })).status()).toBe(403);

    await apiLoginAs(request, 'staff1');
    const ok = await request.post(`${API_URL}/job-offers/send`, { data: body });
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('ส่งแบบสำรวจซ้ำภาคเดิมไม่สร้างใบซ้ำ และวันที่เป็นอดีตถูกปฏิเสธ', async ({ request }) => {
    const semesterId = await activeSemesterId();
    const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
    await apiLoginAs(request, 'staff1');

    const past = await request.post(`${API_URL}/job-offers/send`, {
      data: { company_ids: [companyId], semester_id: semesterId, due_date: '2020-01-01' },
    });
    expect(past.status()).toBe(400);
    expect(await past.text()).toContain('ต้องไม่เป็นวันที่ผ่านมาแล้ว');

    const dueDate = await futureDate();
    const body = { company_ids: [companyId], semester_id: semesterId, due_date: dueDate };
    const countOffers = () =>
      dbValue<string>('SELECT COUNT(*) FROM coop_job_offers WHERE company_id = $1 AND semester_id = $2', [
        companyId,
        semesterId,
      ]);

    await request.post(`${API_URL}/job-offers/send`, { data: body });
    const afterFirst = await countOffers();

    // กดซ้ำต้องไม่เพิ่มใบ ไม่ว่ารอบแรกจะสำเร็จหรือไม่ (UNIQUE company+semester กันอยู่)
    const again = await request.post(`${API_URL}/job-offers/send`, { data: body });
    expect((await again.json()).created).toBe(0);
    expect(await countOffers()).toBe(afterFirst);
    expect(Number(afterFirst)).toBeLessThanOrEqual(1);
  });

  test('บัญชีพี่เลี้ยงลงประกาศรับสมัครงานเองไม่ได้', async ({ request }) => {
    // ⛔ ในระบบนี้ไม่มี "บริษัทลงประกาศ" — บริษัท *ตอบ* แบบเสนองาน สหกิจ 02
    //    แล้วเจ้าหน้าที่เป็นคนกด publish · ประตูนี้เคยเปิดค้างไว้จนถึง 2026-09-09
    const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
    const body = {
      company_id: companyId,
      title: 'ตำแหน่งที่ไม่ได้มาจากแบบสำรวจ',
      description: 'ลงเองโดยไม่ผ่าน สหกิจ 02',
      quota: 1,
      expire_date: await futureDate(60),
    };

    await apiLoginAs(request, 'mentor1');
    expect((await request.post(`${API_URL}/jobs`, { data: body })).status()).toBe(403);

    await apiLoginAs(request, 'staff1');
    const staffPost = await request.post(`${API_URL}/jobs`, { data: body });
    expect(staffPost.status(), await staffPost.text()).toBe(201);
    // เจ้าหน้าที่คีย์แทนได้ แต่แถวต้องสังกัดภาคเรียน ไม่งั้นค้างบนกระดานตลอดไป
    expect(
      await dbValue<number>('SELECT semester_id FROM job_posts WHERE title = $1', [body.title])
    ).toBe(await activeSemesterId());
  });

  test('กระดานหางานแสดงเฉพาะตำแหน่งของภาคเรียนที่เปิดอยู่', async ({ request }) => {
    const jobId = await dbValue<number>(
      `SELECT job_id FROM job_posts WHERE status = 'published' LIMIT 1`
    );
    await apiLoginAs(request, 'student1');

    const before = await (await request.get(`${API_URL}/jobs`)).json();
    expect(before.some((j: { job_id: number }) => j.job_id === jobId)).toBe(true);

    // ย้ายไปภาคเรียนอื่น = ต้องหายจากกระดาน ไม่ใช่ค้างอยู่ปนกับของภาคปัจจุบัน
    const otherSemester = await dbValue<number>(
      'SELECT semester_id FROM coop_semesters WHERE is_active = FALSE ORDER BY semester_id DESC LIMIT 1'
    );
    await dbExec('UPDATE job_posts SET semester_id = $2 WHERE job_id = $1', [jobId, otherSemester]);

    const after = await (await request.get(`${API_URL}/jobs`)).json();
    expect(after.some((j: { job_id: number }) => j.job_id === jobId)).toBe(false);
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
    await page.getByRole('button', { name: 'อนุมัติและส่งต่ออาจารย์ที่ปรึกษา' }).click();
    await page.getByTestId('outline-mentor-approve-confirm').click();

    await expect(page.getByText('อนุมัติโครงร่างรายงาน (สหกิจ 11) และส่งต่อให้อาจารย์ที่ปรึกษาพิจารณาเรียบร้อยแล้ว')).toBeVisible();
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

  test('ลิงก์ตอบแบบสำรวจใช้ตอบได้ครั้งเดียว และลิงก์มั่วไม่เปิดอะไรเลย', async ({ request }) => {
    // ⛔ สร้างใบกับ token ตรงในฐาน **ไม่เรียกเส้นส่งจริง** — เส้นนั้นต้องส่งอีเมลออกจริง
    //    ซึ่งขึ้นกับ SMTP ของเครื่องที่รันเทสต์ · เคสนี้ตรวจ "อายุของลิงก์" ไม่ใช่ "การส่ง"
    //    การผูกมันไว้กับเน็ตเวิร์กมีแต่จะทำให้แดงสลับเขียวโดยไม่ได้บอกอะไรใหม่
    const semesterId = await activeSemesterId();
    const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
    const offerId = await dbValue<number>(
      `INSERT INTO coop_job_offers (company_id, semester_id, due_date, status)
       VALUES ($1, $2, CURRENT_DATE + 30, 'draft') RETURNING offer_id`,
      [companyId, semesterId]
    );
    const token = 'e2e-token-0001';
    await dbExec(
      `INSERT INTO job_offer_tokens (token, offer_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [token, offerId]
    );

    // ⛔ ลิงก์นี้ต้องเปิดได้โดย **ไม่ต้องล็อกอิน** — นั่นคือทั้งหมดของฟีเจอร์นี้
    const open = await request.get(`${API_URL}/public/job-offer?token=${token}`, {
      headers: { Cookie: '' },
    });
    expect(open.status(), await open.text()).toBe(200);

    // เผาแล้วต้องแยกให้ออกระหว่าง "เคยมีจริงแต่ใช้ไปแล้ว" (410 มีปุ่มขอใหม่)
    // กับ "ไม่เคยมี" (404 ต้องติดต่อเจ้าหน้าที่) — หน้าจอแสดงคนละอย่างกัน
    await dbExec('UPDATE job_offer_tokens SET used_at = NOW() WHERE token = $1', [token]);
    expect((await request.get(`${API_URL}/public/job-offer?token=${token}`)).status()).toBe(410);
    expect((await request.get(`${API_URL}/public/job-offer?token=ไม่มีจริง`)).status()).toBe(404);
  });

  test('ใบสำรวจที่เปิดแล้วต้องมีลิงก์เสมอ — เปิดใบทิ้งไว้โดยไม่มีทางเข้าไม่ได้', async ({
    request,
  }) => {
    // ⛔ เคสนี้เขียนแบบไม่ผูกกับผลของ SMTP โดยตั้งใจ — เครื่องที่รันเทสต์ส่งเมลออกได้บ้าง
    //    ไม่ได้บ้าง แต่ **ข้อตกลงที่ต้องจริงเสมอ** คือ ใบที่ถูกนับว่า created ต้องมี token
    //    และถ้าส่งเมลไม่ออก ต้องไม่มีใบค้างอยู่เลย (ไม่งั้นกดส่งรอบหน้าจะถูกข้ามตลอดไป)
    const semesterId = await activeSemesterId();
    const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');

    await apiLoginAs(request, 'staff1');
    const res = await request.post(`${API_URL}/job-offers/send`, {
      data: { company_ids: [companyId], semester_id: semesterId, due_date: await futureDate() },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();

    const offerId = await dbValue<number>(
      'SELECT offer_id FROM coop_job_offers WHERE company_id = $1 AND semester_id = $2',
      [companyId, semesterId]
    );

    if (body.created === 1) {
      expect(offerId).toBeTruthy();
      expect(
        await dbValue<string>('SELECT COUNT(*) FROM job_offer_tokens WHERE offer_id = $1', [offerId])
      ).toBe('1');
    } else {
      expect(body.skipped[0].reason).toContain('ส่งอีเมลไม่สำเร็จ');
      expect(offerId, 'ส่งไม่ออกแล้วยังเหลือใบค้าง = กดส่งรอบหน้าจะถูกข้ามตลอดไป').toBeUndefined();
    }
  });

  test('ลิงก์ตอบแบบสำรวจเปิดได้เฉพาะใบสำรวจ ไม่ใช่ประตูเข้าข้อมูลนักศึกษา', async ({ request }) => {
    // ⛔ ข้อนี้คือเหตุผลทั้งหมดที่ token นี้ปลอดภัยพอจะไม่ต้องล็อกอิน — หน้าที่มันเปิด
    //    ไม่มีข้อมูลนักศึกษาอยู่เลย · ถ้ามีวันไหนที่ /public/* โผล่เส้นที่แตะข้อมูล
    //    นักศึกษา เคสนี้ต้องแดงก่อนที่ของจะขึ้น production
    for (const path of ['/public/students', '/public/daily-logs', '/public/evaluations']) {
      const res = await request.get(`${API_URL}${path}`);
      expect(res.status(), `${path} ต้องไม่มีอยู่จริง`).toBe(404);
    }
  });

});
