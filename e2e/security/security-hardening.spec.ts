import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import { withDb, dbValue } from '../helpers/db';
import { API_URL } from '../helpers/env';
import { loginAs, apiLoginAs } from '../helpers/auth';


/**
 * Regression guards for the seven hardening fixes. Each test encodes an attack
 * that used to succeed, so a future refactor that reopens the hole fails here.
 */
test.describe('Security hardening regressions', () => {
  test.beforeEach(async () => {
    await seedTestData();
  });

  // SEC-01 — POST /api/auth/claim-personnel used to accept any employee_code from
  // any authenticated user, so a student could claim an unclaimed 'dean' row.
  test('SEC-01: an employee_code cannot be claimed by an unrelated account', async ({ request }) => {
    const client = await pool.connect();
    let majorId: number;
    try {
      majorId = (await client.query('SELECT major_id FROM master_major LIMIT 1')).rows[0].major_id;
      await client.query(`DELETE FROM personnel_preseed_list WHERE employee_code = 'SEC01-DEAN'`);
      await client.query(
        `INSERT INTO personnel_preseed_list (employee_code, role_name, major_id, first_name, last_name, email)
         VALUES ('SEC01-DEAN', 'dean', $1, 'ทดสอบ', 'คณบดี', 'therealdean@rmutto.ac.th')`,
        [majorId]
      );
    } finally {
      client.release();
    }

    // A student with an existing role is refused outright — no role stacking.
    await apiLoginAs(request, 'student2');
    const asStudent = await request.post(`${API_URL}/auth/claim-personnel`, {
      data: { employee_code: 'SEC01-DEAN' },
    });
    expect(asStudent.status()).toBe(403);

    await withDb(async (db) => {
      const roles = await db.query(
        `SELECT role_name FROM user_roles WHERE user_id = 2 AND role_name = 'dean'`
      );
      expect(roles.rowCount).toBe(0);
      const row = await db.query(
        `SELECT is_claimed FROM personnel_preseed_list WHERE employee_code = 'SEC01-DEAN'`
      );
      expect(row.rows[0].is_claimed).toBe(false);
    });
  });

  /**
   * SEC-02 — **กติกาเปลี่ยนแล้ว: ระบบไม่ตรวจสิทธิ์สหกิจของนักศึกษาอีกต่อไป**
   *
   * เดิมเทสต์นี้คุมว่า “โปรไฟล์ใหม่ต้องยังไม่มีสิทธิ์ และด่านต้องตอบ 403” ·
   * เจ้าของตัดสิน 2026-09-04 และยืนยันซ้ำ 2026-09-14 ว่า **ขั้นคัดกรองไม่มีอยู่ในกระบวนการ
   * ของคณะ** — ใครเหมาะจะออกสหกิจเป็นเรื่องที่อาจารย์จัดการนอกระบบ (อาจมีเกณฑ์เกรดในอนาคต
   * แต่ตอนนี้ไม่มี) · ด่านจริงที่เหลืออยู่คือ **เจ้าหน้าที่รับคำร้อง (SEC-04)** ซึ่งต้องมี
   * เอกสารหมายเลข 1 ที่อาจารย์และหัวหน้าสาขาลงนามบนกระดาษแล้ว
   *
   * ⛔ เทสต์นี้จึงคุม **ทิศตรงข้าม**: ถ้าวันหนึ่งด่านคุณสมบัติกลับมาปิดนักศึกษาโดยไม่มีใคร
   *    ตัดสินใหม่ มันจะแดง · จะเอาด่านกลับมาต้องแก้ `security_invariants.md` ข้อ SEC-02 ก่อน
   * · 2026-09-14 ขอบเขตยืนยันว่า **ไม่มีทั้งการตรวจสิทธิ์และขั้นปฐมนิเทศ** → migration 031 ลบ
   *   คอลัมน์ทิ้ง · เทสต์นี้คุมด้วยว่าคอลัมน์ต้องไม่งอกกลับมาในฐาน
   */
  test('SEC-02: ระบบไม่ตรวจสิทธิ์สหกิจ — ไม่มีคอลัมน์สิทธิ์ในฐาน และการยื่นไม่ถูกปฏิเสธด้วยเหตุผลคุณสมบัติ', async ({ request }) => {
    const leftovers = await dbValue<string>(
      `SELECT COUNT(*) FROM information_schema.columns
        WHERE (table_name = 'students' AND column_name IN ('is_eligible', 'is_orientation_passed'))
           OR (table_name = 'eligible_students_list' AND column_name = 'is_eligible')`
    );
    expect(Number(leftovers), 'ธงสิทธิ์/ปฐมนิเทศงอกกลับมาในฐาน — แก้ SEC-02 ก่อนเพิ่ม').toBe(0);

    const client = await pool.connect();
    let majorId: number;
    try {
      majorId = (await client.query('SELECT major_id FROM master_major LIMIT 1')).rows[0].major_id;
      await client.query('DELETE FROM intent_forms WHERE student_id = 1');
      await client.query('DELETE FROM students WHERE student_id = 1');
      await client.query(`DELETE FROM eligible_students_list WHERE student_code = '111111111111-1'`);
    } finally {
      client.release();
    }

    await apiLoginAs(request, 'student1');
    const setup = await request.post(`${API_URL}/profile/setup`, {
      data: { type: 'student', student_code: '111111111111-1', major_id: majorId, enrollment_year: 2568 },
    });
    expect(setup.status(), await setup.text()).toBe(201);

    // ...และด่านต้องไม่ปฏิเสธด้วยเหตุผลเรื่องคุณสมบัติ
    const semester = await pool.connect();
    let semesterId: number;
    try {
      semesterId = (await semester.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0].semester_id;
    } finally {
      semester.release();
    }

    const intent = await request.post(`${API_URL}/intents`, {
      data: { semester_id: semesterId, company_id: 1 },
    });
    // คำขอนี้อาจตกด่านอื่นได้ (ข้อมูลไม่ครบ · ปฏิทิน) — ที่คุมคือห้ามตกเพราะ “คุณสมบัติ”
    expect(intent.status()).not.toBe(403);
    expect(JSON.stringify(await intent.json())).not.toContain('คุณสมบัติ');
  });

  // SEC-03 — a student could nominate any email as their mentor, including their
  // own (self-evaluation) or an existing staff account (password reset on approval).
  test('SEC-03: a student cannot nominate themselves or an existing account as mentor', async ({ request }) => {
    const client = await pool.connect();
    let intentId: number;
    try {
      const semesterId = (await client.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0].semester_id;
      await client.query('DELETE FROM intent_forms WHERE student_id = 2');
      intentId = (await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         VALUES (2, 1, $1, 'approved_by_dept_head') RETURNING form_id`,
        [semesterId]
      )).rows[0].form_id;
    } finally {
      client.release();
    }

    // ⛔ `acceptance_due_date` = ด่านที่บอกว่าคณบดีลงนามหนังสือแล้ว (รอบ 53)
    //    ไม่ตั้งไว้ อัปโหลดแบบตอบรับจะได้ 409 ก่อนถึงด่านที่เทสต์นี้ตั้งใจตรวจ
    await withDb(async (db) => {
      await db.query(
        `UPDATE intent_forms
            SET acceptance_due_date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 15
          WHERE form_id = $1`,
        [intentId]
      );
    });

    await apiLoginAs(request, 'student2');
    const pdf = Buffer.from('%PDF-1.4 mock acceptance evidence');

    const asSelf = await request.post(`${API_URL}/acceptances/student/${intentId}/upload-proof`, {
      multipart: {
        evidence: { name: 'proof.pdf', mimeType: 'application/pdf', buffer: pdf },
        name: 'ตัวเอง',
        email: 'student2@test.com',
        phone: '0812345678',
        start_date: '2026-11-02',
        // ผู้ลงนามครบ — ให้คำขอไปตกที่ด่าน SEC-03 จริง ไม่ใช่ตกเพราะขาดช่องผู้ลงนาม
        signer_name: 'คุณสมชาย ผู้จัดการฝ่ายบุคคล',
        signer_position: 'ผู้จัดการฝ่ายบุคคล',
        signed_date: '2026-09-02',
      },
    });
    expect(asSelf.status()).toBe(400);
    expect(await asSelf.text()).not.toContain('ผู้ลงนาม');

    const asDean = await request.post(`${API_URL}/acceptances/student/${intentId}/upload-proof`, {
      multipart: {
        evidence: { name: 'proof.pdf', mimeType: 'application/pdf', buffer: pdf },
        name: 'คณบดี',
        email: 'dean1@test.com',
        phone: '0812345678',
        start_date: '2026-11-02',
        // ผู้ลงนามครบ — ให้คำขอไปตกที่ด่าน SEC-03 จริง ไม่ใช่ตกเพราะขาดช่องผู้ลงนาม
        signer_name: 'คุณสมชาย ผู้จัดการฝ่ายบุคคล',
        signer_position: 'ผู้จัดการฝ่ายบุคคล',
        signed_date: '2026-09-02',
      },
    });
    expect(asDean.status()).toBe(400);
    expect(await asDean.text()).not.toContain('ผู้ลงนาม');

    await withDb(async (db) => {
      const deanRoles = await db.query(
        `SELECT role_name FROM user_roles WHERE user_id = (SELECT user_id FROM users WHERE email = 'dean1@test.com')`
      );
      expect(deanRoles.rows.map((r) => r.role_name)).not.toContain('mentor');
    });
  });

  // SEC-04 (ด่านรับตอบรับของบริษัทด้วยบัญชี) ถอดแล้ว 2026-10-02 — route `PATCH /acceptances/company/:id/status` ถูกลบพร้อมบทบาท company
  // ด่านสถานะของทางที่เหลือ (ลิงก์สาธารณะ) คุมที่ acceptance-link.spec.ts L9 (ใบไม่อยู่ใน approved_by_dept_head = 410)

  // ⛔ เคส "การออกหนังสือราชการต้องผ่านการรับรองสถานประกอบการก่อน" ถูกลบเมื่อ
  // 2026-08-26 พร้อมกับ POST /documents/generate — ไม่มีการออกเอกสารในระบบแล้ว
  // ด่านที่หายไปพร้อมกันคือ SEC-04 ครึ่งหลัง: เอกสารออกได้ต่อเมื่อใบความจำนงผ่าน
  // หัวหน้าสาขา **และ** companies.is_verified = TRUE
  // 🔴 เมื่อสร้างวิธีออกเอกสารแบบใหม่ ต้องเอาทั้งสองด่านกลับมาพร้อมเทสต์นี้
  //    (การรับรองสถานประกอบการยังทำงานอยู่ เคสถัดไปคุมอยู่ — ที่หายคือการผูกมัน
  //     เข้ากับการออกเอกสาร)

  // การยกเลิกการรับรองต้องถอยได้จริง ไม่งั้นกดผิดครั้งเดียวต้องไปแก้ที่ฐานข้อมูลเอง
  test('เจ้าหน้าที่ยกเลิกการรับรองได้ และผลย้อนกลับไปถึงสิ่งที่นักศึกษาเห็น', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    await request.put(`${API_URL}/companies/1/verify`, { data: {} });

    const off = await request.put(`${API_URL}/companies/1/unverify`, { data: {} });
    expect(off.status()).toBe(200);
    expect(await dbValue<boolean>('SELECT is_verified FROM companies WHERE company_id = 1')).toBe(false);

    // นักศึกษาไม่เห็นบริษัทที่ยังไม่รับรองในทำเนียบ
    await apiLoginAs(request, 'student1');
    const asStudent = await request.get(`${API_URL}/companies`);
    expect(asStudent.status()).toBe(200);
    expect((await asStudent.json()).some((c: { company_id: number }) => c.company_id === 1)).toBe(false);
  });

  // SEC-10 (ถอดแล้ว 2026-10-02) — สามเคส "บริษัทเห็นเฉพาะฟิลด์สหกิจ 04 / ไม่เห็นใบก่อนปล่อย / รายละเอียดใบถูกตัด"
  // เป็นของบทบาท company ซึ่งถูกลบแล้ว · GET /intents และ /intents/:id เปิดเฉพาะคณะ/เจ้าหน้าที่/คณบดี
  // ข้อมูลที่บริษัทเห็นตอนนี้มาจากลิงก์สาธารณะ /public/acceptance เท่านั้น → คุมที่ acceptance-link.spec.ts L3 (allow-list)

  // SEC-10 — the file endpoint checked permissions *after* falling back to a
  // blank template for a missing file, so a request that should have been
  // refused came back 200 with a PDF. Nothing leaked (the template is empty),
  // but it made every file-permission test unreliable.
  test('SEC-10: a missing file is refused before the fallback template is offered', async ({ request }) => {
    await apiLoginAs(request, 'mentor1');

    // A resume that does not exist and does not belong to this mentor's student.
    const res = await request.get(`${API_URL}/files/resumes/resume-user-99999-nonexistent.pdf`);
    expect(res.status()).toBe(403);
    expect(res.headers()['content-type'] || '').not.toContain('pdf');
  });

  // SEC-05 — students could write their own GPA, major, student_code and
  // enrollment year through PUT /api/profile/student.
  test('SEC-05: registry fields sent by a student are ignored', async ({ request }) => {
    const client = await pool.connect();
    let otherMajor: number;
    try {
      // 2568 ไม่ใช่ 2565 โดยตั้งใจ — 2565 + 4 = 2569 = academic_year ที่ seed ไว้
      // แปลว่า "จบแล้ว" และ scheduler ของ dev server อาจปิดบัญชี student2
      // กลางเทสต์ ทำให้คำขอถัดไปตอบ 403 (ดูหมายเหตุใน staff/registry-fields.spec.ts)
      await client.query('UPDATE students SET cumulative_gpa = 2.10, enrollment_year = 2568 WHERE student_id = 2');
      otherMajor = (await client.query(
        'SELECT major_id FROM master_major WHERE major_id <> (SELECT major_id FROM students WHERE student_id = 2) LIMIT 1'
      )).rows[0].major_id;
    } finally {
      client.release();
    }

    await apiLoginAs(request, 'student2');
    const res = await request.put(`${API_URL}/profile/student`, {
      multipart: {
        student_code: '999999999999-9',
        major_id: String(otherMajor),
        cumulative_gpa: '4.00',
        enrollment_year: '2572',
        nickname: 'ชื่อเล่นใหม่',
      },
    });
    expect(res.status()).toBe(200);

    await withDb(async (db) => {
      const row = (await db.query(
        'SELECT student_code, major_id, cumulative_gpa, enrollment_year, nickname FROM students WHERE student_id = 2'
      )).rows[0];
      expect(row.student_code).toBe('640101001');
      expect(row.major_id).not.toBe(otherMajor);
      expect(Number(row.cumulative_gpa)).toBe(2.1);
      expect(row.enrollment_year).toBe(2568);
      // the legitimately editable field still went through
      expect(row.nickname).toBe('ชื่อเล่นใหม่');
    });
  });

  // SEC-06 — major scoping silently skipped when a personnel row was missing,
  // handing the caller an unfiltered, institution-wide view.
  test('SEC-06: personnel without a profile are denied rather than given everything', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');

    await withDb(async (db) => {
      await db.query('DELETE FROM personnel WHERE personnel_id = 3');
    });

    const res = await request.get(`${API_URL}/students`);
    expect(res.status()).toBe(403);

    await withDb(async (db) => {
      await db.query(
        `INSERT INTO personnel (personnel_id, major_id, status)
         VALUES (3, (SELECT major_id FROM master_major LIMIT 1), 'approved')
         ON CONFLICT (personnel_id) DO NOTHING`
      );
    });
  });

  // SEC-06 — two more endpoints kept the forbidden `if (personnelRow) { filter }`
  // shape long after /students was fixed: the personnel directory and the co-op
  // progress board. A department head with no personnel row fell past every
  // branch and the query ran unfiltered — the whole university, not their major.
  test('SEC-06: a dept_head without a profile is denied on the personnel and progress endpoints', async ({ request }) => {
    const headId = await dbValue<number>("SELECT user_id FROM users WHERE email = 'head1@test.com'");

    await apiLoginAs(request, 'head1');

    // Baseline: with a profile, both endpoints answer normally.
    expect((await request.get(`${API_URL}/personnel`)).status()).toBe(200);
    expect((await request.get(`${API_URL}/coop-progress/dashboard`)).status()).toBe(200);

    await withDb(async (db) => {
      await db.query('DELETE FROM personnel WHERE personnel_id = $1', [headId]);
    });

    // With the profile gone the scope is unknown, so both must refuse rather
    // than fall back to "no filter".
    expect((await request.get(`${API_URL}/personnel`)).status()).toBe(403);
    expect((await request.get(`${API_URL}/coop-progress/dashboard`)).status()).toBe(403);

    await withDb(async (db) => {
      await db.query(
        `INSERT INTO personnel (personnel_id, major_id, status)
         VALUES ($1, (SELECT major_id FROM master_major LIMIT 1), 'approved')
         ON CONFLICT (personnel_id) DO NOTHING`,
        [headId]
      );
    });
  });

  // SEC-06 — GET /api/outlines/student/:id had no authorization at all.
  test('SEC-06: a student cannot read another student\'s report outline', async ({ request }) => {
    await withDb(async (db) => {
      await db.query(
        `INSERT INTO report_outlines (student_id, company_id, status)
         VALUES (2, 1, 'pending_mentor') ON CONFLICT DO NOTHING`
      );
      await db.query(
        `INSERT INTO students (student_id, student_code, major_id)
         VALUES (1, '640101777', (SELECT major_id FROM master_major LIMIT 1))
         ON CONFLICT (student_id) DO NOTHING`
      );
    });

    await apiLoginAs(request, 'student1');
    const res = await request.get(`${API_URL}/outlines/student/2`);
    expect(res.status()).toBe(403);
  });

  // BUG-01 — the graduation check compared a Buddhist enrollment_year against a
  // Gregorian academic_year, so it never fired. Uses a throwaway account so a
  // real seeded user is never left deactivated for the following tests.
  test('BUG-01: graduation deactivation works across Buddhist/Gregorian years', async () => {
    const { runAutoDeactivation } = await import('../../backend/src/utils/deactivationScheduler');

    const client = await pool.connect();
    let graduatedId: number;
    let currentId: number;
    try {
      // academic_year is seeded as 2026 CE, i.e. 2569 BE.
      const year = (await client.query('SELECT academic_year FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0].academic_year;
      expect(year).toBe(2026);

      const majorId = (await client.query('SELECT major_id FROM master_major LIMIT 1')).rows[0].major_id;

      // enrolled 2565 BE -> graduates 2569 BE -> should be deactivated
      graduatedId = (await client.query(
        `INSERT INTO users (email, password_hash, is_active) VALUES ('bug01-grad@test.com', 'x', TRUE)
         ON CONFLICT (email) DO UPDATE SET is_active = TRUE RETURNING user_id`
      )).rows[0].user_id;
      await client.query(
        `INSERT INTO students (student_id, student_code, major_id, enrollment_year)
         VALUES ($1, '999999999901-1', $2, 2565)
         ON CONFLICT (student_id) DO UPDATE SET enrollment_year = 2565`,
        [graduatedId, majorId]
      );

      // enrolled 2568 BE -> graduates 2572 BE -> must stay active
      currentId = (await client.query(
        `INSERT INTO users (email, password_hash, is_active) VALUES ('bug01-current@test.com', 'x', TRUE)
         ON CONFLICT (email) DO UPDATE SET is_active = TRUE RETURNING user_id`
      )).rows[0].user_id;
      await client.query(
        `INSERT INTO students (student_id, student_code, major_id, enrollment_year)
         VALUES ($1, '999999999902-2', $2, 2568)
         ON CONFLICT (student_id) DO UPDATE SET enrollment_year = 2568`,
        [currentId, majorId]
      );
    } finally {
      client.release();
    }

    await runAutoDeactivation();

    await withDb(async (db) => {
      const grad = await db.query('SELECT is_active FROM users WHERE user_id = $1', [graduatedId]);
      const current = await db.query('SELECT is_active FROM users WHERE user_id = $1', [currentId]);
      expect(grad.rows[0].is_active).toBe(false);
      expect(current.rows[0].is_active).toBe(true);

      // the seeded accounts the rest of the suite depends on are untouched
      const student2 = await db.query("SELECT is_active FROM users WHERE email = 'student2@test.com'");
      expect(student2.rows[0].is_active).toBe(true);
    });

    await withDb(async (db) => {
      await db.query('DELETE FROM users WHERE email IN ($1, $2)', ['bug01-grad@test.com', 'bug01-current@test.com']);
    });
  });

  // BUG-02 — POST /api/auth/set-password changed an existing password without
  // asking for the current one, so a stolen token was a permanent takeover.
  test('BUG-02: changing an existing password requires the current one', async ({ request }) => {
    await apiLoginAs(request, 'student2');

    const noCurrent = await request.post(`${API_URL}/auth/set-password`, {
      data: { password: 'Hijacked123', confirmPassword: 'Hijacked123' },
    });
    expect(noCurrent.status()).toBe(400);

    const wrongCurrent = await request.post(`${API_URL}/auth/set-password`, {
      data: { password: 'Hijacked123', confirmPassword: 'Hijacked123', currentPassword: 'wrongpass' },
    });
    expect(wrongCurrent.status()).toBe(400);

    // the original password still works
    await apiLoginAs(request, 'student2');

    // with the correct current password the change goes through, then is undone
    const ok = await request.post(`${API_URL}/auth/set-password`, {
      data: { password: 'Changed12345', confirmPassword: 'Changed12345', currentPassword: 'password123' },
    });
    expect(ok.status()).toBe(200);

    const revert = await request.post(`${API_URL}/auth/set-password`, {
      data: { password: 'password123', confirmPassword: 'password123', currentPassword: 'Changed12345' },
    });
    expect(revert.status()).toBe(200);
    await apiLoginAs(request, 'student2');
  });

  // SEC-07 — privileged actions left no trace at all.
  test('SEC-07: privileged actions are written to the audit log', async ({ request }) => {
    await apiLoginAs(request, 'staff1');

    // เดิมใช้ PUT /students/:id/verify-eligibility เป็นตัวอย่าง — เส้นนั้นถูกลบ 2026-09-14
    // (SEC-02) จึงเปลี่ยนมาใช้การแก้เกรดในทะเบียน ซึ่งเป็นการกระทำที่มีสิทธิ์และลง audit เหมือนกัน
    const res = await request.put(`${API_URL}/students/2/registry`, {
      data: { cumulative_gpa: '3.10' },
    });
    expect(res.status(), await res.text()).toBe(200);

    // writeAudit is deliberately fire-and-forget in the controllers, so the row
    // lands shortly after the response — poll rather than read once.
    await expect
      .poll(
        () =>
          dbValue<string>(
            `SELECT actor_email FROM audit_log
             WHERE action = 'student.registry_changed' AND entity_id = '2'
             ORDER BY audit_id DESC LIMIT 1`
          ),
        { timeout: 5000 }
      )
      .toBe('staff1@test.com');

    // There is no read API by design — the table is inspected directly.
    await withDb(async (db) => {
      const rows = await db.query(
        'SELECT action, actor_email, entity_type FROM audit_log ORDER BY audit_id DESC LIMIT 5'
      );
      expect(rows.rowCount).toBeGreaterThan(0);
    });
  });

  // SEC-08 — the session JWT used to sit in localStorage and be pasted into
  // `?token=` on every file link, leaking it into access logs, browser history
  // and the Referer header.
  test('SEC-08: the session is an httpOnly cookie, unreachable from JS', async ({ page }) => {
    await loginAs(page, 'student2');

    const session = (await page.context().cookies()).find((c) => c.name === 'coop_session');
    expect(session, 'coop_session cookie was not issued').toBeTruthy();
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe('Lax');

    // Nothing readable from the page holds the token.
    expect(await page.evaluate(() => localStorage.getItem('auth_token'))).toBeNull();
    expect(await page.evaluate(() => document.cookie)).not.toContain('coop_session');

    // The cookie alone authenticates, and a bare `?token=` is no longer honoured.
    expect((await page.request.get(`${API_URL}/intents/me`)).status()).toBe(200);

    // Logging out drops the cookie server-side.
    const loggedOut = await page.request.post(`${API_URL}/auth/logout`);
    expect(loggedOut.status()).toBe(200);
    expect((await page.request.get(`${API_URL}/intents/me`)).status()).toBe(401);
  });

  // SEC-09 (ถอดแล้ว 2026-10-02) — เคส "เปิดบัญชีบริษัทด้วยลิงก์เชิญ" และ "ส่งลิงก์เชิญซ้ำ" ถูกลบพร้อมบทบาท company
  // และ resend-invite · บริษัทไม่มีบัญชี พี่เลี้ยงเข้าด้วยลิงก์อีเมลครั้งเดียว (SEC-15) ·
  // ที่ยังต้องจริงคือ "ไม่มีรหัสผ่านถูกส่งทางเมล" → mentor-no-password.spec.ts · "ไม่มีบทบาท company" → company-role-removed.spec.ts
});
