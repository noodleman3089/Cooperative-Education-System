import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * ประสิทธิภาพภายใต้ข้อมูลขนาดจริง — อีกช่องใน "ไม่เคยทดสอบเลย"
 *
 * ระบบนี้ถูกพัฒนาและทดสอบมาตลอดด้วยนักศึกษา 2 คน ซึ่งเร็วเสมอไม่ว่าจะเขียน query
 * แย่แค่ไหน · คณะหนึ่งมีนักศึกษาสหกิจหลักร้อยต่อรุ่น และข้อมูลสะสมข้ามรุ่น
 * ชุดนี้จึงยัดข้อมูลระดับนั้นเข้าไปก่อนแล้ววัดเวลาตอบของหน้าจอที่ join หนักที่สุด
 *
 * **ไม่ใช่ load test แบบยิงพร้อมกันพันคน** — ผู้ใช้ระบบนี้คือเจ้าหน้าที่ อาจารย์
 * และนักศึกษาของคณะเดียว การยิง concurrent สูงๆ จึงไม่ตรงกับความจริง
 * สิ่งที่ตรงกับความจริงคือ "หน้าเดียวที่ดึงข้อมูลทุกคนในสาขา ตอบทันไหม"
 *
 * งบเวลาที่ตั้งไว้หลวมกว่าที่วัดได้จริงหลายเท่า เพราะเทสต์นี้มีไว้จับ *การถดถอย*
 * (เช่นเผลอเพิ่ม query ใน loop) ไม่ใช่ไว้ไล่จูนมิลลิวินาที
 */

const STUDENT_COUNT = 400;

/** เวลาที่ยอมรับได้ต่อคำขอหนึ่ง (ms) — จับ N+1 และ table scan ที่โตตามข้อมูล */
const BUDGET_MS = 2_000;

/**
 * ผลที่วัดได้จริงตอนเขียนเทสต์นี้ (2026-08-17, PostgreSQL บนเครื่อง dev):
 *
 *   นักศึกษา   /intents  /students  /applications  /coop-progress  /pipeline
 *      401       16 ms      14 ms         7 ms          17 ms         6 ms
 *    3,001       38 ms      36 ms         7 ms          74 ms         9 ms
 *
 * เวลาโตเป็นเชิงเส้นตามข้อมูลและยังห่างจากงบหลายสิบเท่า **จึงจงใจไม่เพิ่ม index**
 * ทั้งที่ตาราง students/intent_forms ไม่มี index บนคอลัมน์ที่ใช้กรองเลย
 * (PostgreSQL ไม่สร้าง index ให้ FK อัตโนมัติ) — index ไม่ฟรี มันช้าตอนเขียนและ
 * กินที่ การใส่ไว้ก่อนโดยไม่มีปัญหาให้แก้คือการเดา · **ถ้าวันหนึ่งเทสต์นี้แดง
 * ให้เริ่มจาก EXPLAIN ANALYZE ของ query ที่ช้า ไม่ใช่หว่าน index**
 *
 * ตั้งไว้ที่ 400 สำหรับรันประจำ (ระดับนักศึกษาสหกิจหนึ่งรุ่นของคณะ) — เปลี่ยนเลขนี้
 * ชั่วคราวได้ถ้าอยากรู้พฤติกรรมที่ข้อมูลสะสมหลายปี
 */

async function seedBulkStudents(): Promise<void> {
  await withDb(async (db) => {
    const major = (await db.query('SELECT major_id FROM master_major LIMIT 1')).rows[0].major_id;
    const semester = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const company = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      ?.company_id;

    // สร้างผู้ใช้ + โปรไฟล์นักศึกษาเป็นชุดเดียว เร็วกว่าวนทีละแถวหลายสิบเท่า
    await db.query(
      `INSERT INTO users (email, password_hash, is_active)
       SELECT 'perf' || g || '@test.com', 'x', TRUE FROM generate_series(1, $1) g
       ON CONFLICT (email) DO NOTHING`,
      [STUDENT_COUNT]
    );

    await db.query(
      `INSERT INTO user_roles (user_id, role_name)
       SELECT user_id, 'student' FROM users WHERE email LIKE 'perf%@test.com'
       ON CONFLICT (user_id, role_name) DO NOTHING`
    );

    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa,
                             first_name, last_name, enrollment_year)
       SELECT u.user_id,
              'PERF' || u.user_id,
              $1,
              3.00,
              'ทดสอบ',
              'ประสิทธิภาพ' || u.user_id,
              2566
       FROM users u
       WHERE u.email LIKE 'perf%@test.com'
       ON CONFLICT (student_id) DO NOTHING`,
      [major]
    );

    if (company) {
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         SELECT s.student_id, $1, $2, 'approved_by_dept_head'
         FROM students s
         WHERE s.student_code LIKE 'PERF%'
           AND NOT EXISTS (
             SELECT 1 FROM intent_forms i WHERE i.student_id = s.student_id AND i.semester_id = $2
           )`,
        [company, semester]
      );
    }
  });
}

async function measure(
  request: APIRequestContext,
  label: string,
  url: string
): Promise<number> {
  const started = Date.now();
  const res = await request.get(url);
  const elapsed = Date.now() - started;
  expect(res.status(), `${label} ตอบ ${res.status()}`).toBe(200);
  console.log(`  ${label.padEnd(38)} ${String(elapsed).padStart(5)} ms`);
  return elapsed;
}

test.describe('ประสิทธิภาพเมื่อข้อมูลเยอะ', () => {
  test(`หน้าจอที่ดึงข้อมูลทั้งสาขาตอบทันเมื่อมีนักศึกษา ${STUDENT_COUNT} คน`, async ({
    request,
  }) => {
    test.setTimeout(180_000);

    await seedTestData();
    await seedBulkStudents();

    const rows = await withDb(async (db) =>
      Number((await db.query('SELECT COUNT(*)::int AS n FROM students')).rows[0].n)
    );
    expect(rows).toBeGreaterThanOrEqual(STUDENT_COUNT);
    console.log(`\n  นักศึกษาในฐาน: ${rows} คน`);

    await apiLoginAs(request, 'staff1');

    const timings = {
      intents: await measure(request, 'GET /intents (คิวใบความจำนง)', `${API_URL}/intents`),
      students: await measure(request, 'GET /students (ทะเบียนนักศึกษา)', `${API_URL}/students`),
      progress: await measure(
        request,
        'GET /coop-progress/dashboard (ความก้าวหน้า)',
        `${API_URL}/coop-progress/dashboard`
      ),
      pipeline: await measure(
        request,
        'GET /intents/pipeline-summary',
        `${API_URL}/intents/pipeline-summary`
      ),
    };

    for (const [name, ms] of Object.entries(timings)) {
      expect(ms, `${name} ใช้เวลา ${ms}ms เกินงบ ${BUDGET_MS}ms`).toBeLessThan(BUDGET_MS);
    }
  });

  test('การเรียกซ้ำไม่ได้ช้าลงเรื่อยๆ (ไม่มี connection รั่ว)', async ({ request }) => {
    test.setTimeout(120_000);

    await apiLoginAs(request, 'staff1');

    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const started = Date.now();
      const res = await request.get(`${API_URL}/intents`);
      expect(res.status()).toBe(200);
      samples.push(Date.now() - started);
    }

    const firstHalf = samples.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const secondHalf = samples.slice(5).reduce((a, b) => a + b, 0) / 5;
    console.log(`\n  5 ครั้งแรกเฉลี่ย ${firstHalf.toFixed(0)} ms · 5 ครั้งหลังเฉลี่ย ${secondHalf.toFixed(0)} ms`);

    // pool รั่วหรือ query สะสม state จะทำให้ครึ่งหลังช้ากว่าครึ่งแรกอย่างชัดเจน
    expect(secondHalf).toBeLessThan(Math.max(firstHalf * 3, 500));
  });
});
