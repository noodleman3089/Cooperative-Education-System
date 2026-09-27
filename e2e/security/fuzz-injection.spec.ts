import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbValue } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * Fuzz / injection — ช่องที่ CLAUDE.md บันทึกไว้ว่า "ไม่เคยทดสอบเลย"
 *
 * การไล่อ่านโค้ดก่อนเขียนเทสต์ชุดนี้พบว่าทุก query ในระบบใช้ `$n` placeholder
 * ไม่มีที่ไหนเอา input ของผู้ใช้ต่อเข้าสตริง SQL เลยสักจุด (ที่ต่อสตริงคือชิ้นส่วน
 * ที่โค้ดเขียนเองทั้งหมด เช่น ` AND s.major_id = $3`) — ชุดนี้จึงมีไว้ **ยืนยันด้วย
 * การยิงจริง** ไม่ใช่ค้นหาช่องโหว่ที่คาดว่ามี และเพื่อให้ถ้าวันหนึ่งมีใครเผลอเขียน
 * query แบบต่อสตริง เทสต์จะจับได้
 *
 * เกณฑ์ที่ใช้ตัดสิน:
 *   1. **ห้ามได้ 500** — 500 แปลว่ามี input ที่วิ่งไปถึงจุดที่ไม่มีใครกันไว้
 *      (ข้อความ error ของ DB รั่วออกไปได้ และบอกโครงสร้างตารางให้คนนอก)
 *   2. **ห้ามผ่านการยืนยันตัวตน** — payload ยอดนิยมอย่าง `' OR '1'='1` ต้องไม่ล็อกอินได้
 *   3. **ข้อมูลต้องไม่หาย** — ตาราง users ต้องยังอยู่และจำนวนแถวเท่าเดิม
 */

/** payload ที่ใช้จริงในการโจมตีเว็บ ไม่ใช่สตริงมั่วๆ */
const PAYLOADS: { label: string; value: string }[] = [
  { label: 'sql-tautology', value: "' OR '1'='1" },
  { label: 'sql-comment-bypass', value: "admin'--" },
  { label: 'sql-drop', value: "'; DROP TABLE users; --" },
  { label: 'sql-union', value: "1' UNION SELECT email, password_hash FROM users --" },
  { label: 'sql-like-wildcard', value: "%' OR 1=1 --" },
  { label: 'sql-stacked-update', value: "1; UPDATE students SET is_eligible = TRUE; --" },
  { label: 'xss-script', value: '<script>alert(1)</script>' },
  { label: 'template-injection', value: '{{7*7}}' },
  { label: 'path-traversal', value: '../../../../etc/passwd' },
  { label: 'crlf', value: 'a\r\nSet-Cookie: coop_session=evil' },
  { label: 'very-long', value: 'A'.repeat(10_000) },
  { label: 'unicode-heavy', value: '🙂'.repeat(500) },
  { label: 'negative-number', value: '-99999999' },
  { label: 'float-as-id', value: '1.9999' },
];

/** สถานะที่ยอมรับได้: ปฏิเสธอย่างตั้งใจ หรือรับแล้วไม่มีผลอะไร — ที่ห้ามคือ 5xx */
function expectNoServerError(status: number, context: string) {
  expect(status, `${context} ตอบ ${status} — 5xx แปลว่ามี input ที่ไม่มีใครกันไว้`).toBeLessThan(
    500
  );
}

async function countUsers(): Promise<number> {
  return Number(await dbValue<string>('SELECT COUNT(*) FROM users'));
}

test.describe('Fuzz & injection', () => {
  test('การล็อกอิน: ไม่มี payload ไหนผ่าน และไม่มีอันไหนทำให้เซิร์ฟเวอร์ 500', async ({
    request,
  }) => {
    await seedTestData();
    const usersBefore = await countUsers();

    for (const { label, value } of PAYLOADS) {
      // ยิงทั้งช่องอีเมลและช่องรหัสผ่าน เพราะทั้งคู่ไปถึง query คนละที่กัน
      const asEmail = await request.post(`${API_URL}/auth/login`, {
        data: { email: value, password: 'password123' },
      });
      expectNoServerError(asEmail.status(), `login[email=${label}]`);
      expect(asEmail.status(), `${label} ต้องล็อกอินไม่ได้`).not.toBe(200);

      const asPassword = await request.post(`${API_URL}/auth/login`, {
        data: { email: 'student2@test.com', password: value },
      });
      expectNoServerError(asPassword.status(), `login[password=${label}]`);
      expect(asPassword.status(), `${label} ต้องล็อกอินไม่ได้`).not.toBe(200);
    }

    // ตารางต้องยังอยู่ (ถ้า DROP ผ่าน query นี้จะโยน error) และไม่มีแถวหาย
    expect(await countUsers()).toBe(usersBefore);
  });

  test('ค่าที่ไม่ใช่สตริง (array/object/null) ต้องถูกปฏิเสธ ไม่ใช่ทำให้พัง', async ({
    request,
  }) => {
    await seedTestData();

    const weirdBodies = [
      { email: { toString: 'x' }, password: 'password123' },
      { email: ['student2@test.com'], password: 'password123' },
      { email: 'student2@test.com', password: [] },
      { email: null, password: null },
      { email: 12345, password: true },
      {},
    ];

    for (const [i, body] of weirdBodies.entries()) {
      const res = await request.post(`${API_URL}/auth/login`, { data: body });
      expectNoServerError(res.status(), `login[body#${i}]`);
      expect(res.status()).not.toBe(200);
    }
  });

  test('ตัวกรองบนหน้าค้นหาสถานประกอบการ: ILIKE ไม่ถูก payload แทรก', async ({ request }) => {
    await seedTestData();
    await apiLoginAs(request, 'staff1');

    const baseline = await request.get(`${API_URL}/companies`);
    expect(baseline.status()).toBe(200);
    const baselineCount = ((await baseline.json()) as any[]).length ?? 0;

    for (const { label, value } of PAYLOADS) {
      const res = await request.get(
        `${API_URL}/companies?search=${encodeURIComponent(value)}`
      );
      expectNoServerError(res.status(), `companies?search=${label}`);

      if (res.status() === 200) {
        const rows = (await res.json()) as any[];
        // payload ที่ตั้งใจให้เงื่อนไขเป็นจริงเสมอ ต้องไม่คืนข้อมูลมากกว่าการค้นหาปกติ
        expect(
          Array.isArray(rows) ? rows.length : 0,
          `${label} ทำให้ตัวกรองคืนข้อมูลเกินที่ควร`
        ).toBeLessThanOrEqual(baselineCount);
      }
    }
  });

  test('พารามิเตอร์ที่เป็น id: ค่าที่ไม่ใช่ตัวเลขต้องได้ 4xx ไม่ใช่ 500', async ({ request }) => {
    await seedTestData();
    await apiLoginAs(request, 'staff1');

    const idRoutes = (id: string) => [
      `${API_URL}/intents/${id}`,
      `${API_URL}/students/${id}`,
      `${API_URL}/jobs/${id}`,
      // ⛔ `?is_eligible=` ถูกลบพร้อมคอลัมน์ 2026-09-14 — ใช้ major_id ซึ่งยังเป็นตัวกรองจริง
      `${API_URL}/students?major_id=${id}`,
    ];

    for (const { label, value } of PAYLOADS) {
      for (const url of idRoutes(encodeURIComponent(value))) {
        const res = await request.get(url);
        expectNoServerError(res.status(), `${url.replace(API_URL, '')} [${label}]`);
      }
    }
  });

  test('ค่าที่ยาวเกินความกว้างคอลัมน์ต้องถูกปฏิเสธอย่างสุภาพ', async ({ request }) => {
    await seedTestData();
    await apiLoginAs(request, 'student2');

    // ยาวเกินคอลัมน์ แต่ตัว payload ยังเล็กกว่าเพดานของ body-parser
    const overlongField = await request.put(`${API_URL}/profile/student`, {
      data: {
        first_name: 'A'.repeat(5_000),
        last_name: 'B'.repeat(5_000),
        phone: '0'.repeat(500),
      },
    });
    expectNoServerError(overlongField.status(), 'profile/student[overlong field]');

    // payload ใหญ่เกินเพดาน 100KB ของ body-parser — ต้องได้ 413 ไม่ใช่ 500
    const oversizedBody = await request.put(`${API_URL}/profile/student`, {
      data: { current_address: 'ที่อยู่'.repeat(20_000) },
    });
    expect(oversizedBody.status()).toBe(413);
    expect((await oversizedBody.json()).message).toContain('ขนาดใหญ่เกินกำหนด');
  });

  test('ตัวนำเข้า CSV: บรรทัดพิกลต้องไม่ล้มทั้งไฟล์และไม่แตะเกรดในทะเบียนของใคร', async ({ request }) => {
    await seedTestData();
    // เดิมเฝ้า `students.is_eligible` — คอลัมน์ถูกลบ 2026-09-14 (SEC-02) จึงเฝ้าเกรดทะเบียนแทน
    // ซึ่งเป็นค่าที่ถูกพิมพ์ลงหนังสือราชการ (SEC-05) และไฟล์นี้ต้องไม่มีทางเขียนทับได้
    const gpaBefore = await dbValue<string>(
      'SELECT cumulative_gpa::text FROM students WHERE student_id = 2'
    );

    await apiLoginAs(request, 'staff1');

    const nastyCsv = [
      'student_code,cumulative_gpa,email',
      `640101001,3.00'; UPDATE students SET cumulative_gpa = 0; --,a@test.com`,
      `"640101002,3.00,b@test.com`, // เครื่องหมายคำพูดไม่ปิด
      `,,`, // แถวว่าง
      `${'X'.repeat(5000)},3.00,c@test.com`,
      `640101003,99.99,not-an-email`,
    ].join('\n');

    const res = await request.post(`${API_URL}/students/import`, { data: { csv: nastyCsv } });
    expectNoServerError(res.status(), 'students/import[nasty]');

    // เกรดในทะเบียนของคนที่อยู่ในไฟล์ต้องไม่ถูกแตะจากคำสั่งที่แทรกมา
    expect(
      await dbValue<string>('SELECT cumulative_gpa::text FROM students WHERE student_id = 2')
    ).toBe(gpaBefore);
  });

  test('ข้อความ error ต้องไม่หลุดโครงสร้างฐานข้อมูลออกไปให้คนนอก', async ({ request }) => {
    await seedTestData();

    const res = await request.post(`${API_URL}/auth/login`, {
      data: { email: "' OR 1=1 --", password: "'; SELECT * FROM users --" },
    });

    const body = await res.text();
    const leaks = ['syntax error', 'pg_', 'relation "', 'column "', 'password_hash', 'at Object.'];
    for (const leak of leaks) {
      expect(body.toLowerCase(), `error body รั่วคำว่า "${leak}"`).not.toContain(
        leak.toLowerCase()
      );
    }
  });
});
