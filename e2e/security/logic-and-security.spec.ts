import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import { API_URL } from '../helpers/env';
import { withDb } from '../helpers/db';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { logout } from '../helpers/nav';
import { placementCard } from '../helpers/intent';

test.describe('Cooperative Education System Logic & Security Audits', () => {

  test.beforeEach(async () => {
    await seedTestData();
  });

  /**
   * ⛔ กติกาเปลี่ยน 2026-09-04 (ยืนยันซ้ำ 2026-09-14): **ระบบไม่ตรวจสิทธิ์สหกิจของนักศึกษา**
   *    เดิมเคสนี้คาดว่าธง FALSE จะได้ 403 “คุณสมบัติไม่ผ่านเกณฑ์” · ตอนนี้คาดตรงข้าม
   *    เหตุผลเต็มอยู่ที่เคส SEC-02 ใน `security-hardening.spec.ts`
   */
  test('Test L1: ไม่มีด่านคุณสมบัติขวางการยื่นความจำนง', async ({ request }) => {
    // ธงสิทธิ์ถูกลบออกจากฐานแล้ว (migration 031) จึงไม่มีอะไรให้ตั้งเป็น FALSE ก่อนทดสอบ
    await apiLoginAs(request, 'student2');

    // body ไม่ครบโดยตั้งใจ — คำขอจะตกด่านข้อมูล แต่ต้องไม่ใช่ด่านคุณสมบัติ
    const submitRes = await request.post(`${API_URL}/intents`, {
      data: { company_id: 1 }
    });
    expect(submitRes.status()).not.toBe(403);
    expect(JSON.stringify(await submitRes.json())).not.toContain('คุณสมบัติ');
  });

  test('Test L2: Path B Acceptance & Mentor Onboarding Security Controls', async ({ request, playwright }) => {
    const client = await pool.connect();
    let semesterId;
    try {
      const semRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");
      semesterId = semRes.rows[0].semester_id;
    } finally {
      client.release();
    }

    // Login student2
    await apiLoginAs(request, 'student2');

    // Create an intent form approved_by_dept_head
    const client2 = await pool.connect();
    let intentId: number;
    try {
      const insRes = await client2.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         VALUES (2, 1, $1, 'approved_by_dept_head') RETURNING form_id`,
        [semesterId]
      );
      intentId = insRes.rows[0].form_id;
    } finally {
      client2.release();
    }

    // Set status to pending_officer_approval directly in DB to simulate manual upload completion
    await withDb(async (db) => {
      // Create new mentor as inactive
      await db.query(
        `INSERT INTO users (email, password_hash, is_active)
         VALUES ('newmentor@test.com', 'somehash', FALSE) ON CONFLICT (email) DO NOTHING`
      );
      const mRes = await db.query("SELECT user_id FROM users WHERE email = 'newmentor@test.com'");
      const mentorUserId = mRes.rows[0].user_id;

      await db.query(
        `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
         VALUES ($1, 1, 'Mentor Test', 'Engineer', 'IT', '0812345678') ON CONFLICT (mentor_id) DO NOTHING`,
        [mentorUserId]
      );

      await db.query(
        `UPDATE intent_forms SET status = 'pending_officer_approval', mentor_id = $1 WHERE form_id = $2`,
        [mentorUserId, intentId]
      );
    });

    // Try to approve without credentials (should yield 401). `request` already
    // holds student2's session cookie, so anonymity needs a fresh cookie jar.
    const anonymous = await playwright.request.newContext();
    const approveNoAuth = await anonymous.put(`${API_URL}/acceptances/${intentId}/officer-approve`, {
      data: { action: 'accepted' }
    });
    expect(approveNoAuth.status()).toBe(401);
    await anonymous.dispose();

    // Login as staff — this replaces student2's cookie in the shared jar
    await apiLoginAs(request, 'staff1');

    // Approve the evidence
    // ผู้ลงนามบนแบบตอบรับนักศึกษากรอกตอนอัปโหลดแล้ว — เจ้าหน้าที่กดรับอย่างเดียว (2026-09-21)
    const approveRes = await request.put(`${API_URL}/acceptances/${intentId}/officer-approve`, {
      data: { action: 'accepted' }
    });
    expect(approveRes.status()).toBe(200);

    // Verify the mentor is now ACTIVE in database
    await withDb(async (db) => {
      const mentorUser = await db.query("SELECT is_active FROM users WHERE email = 'newmentor@test.com'");
      expect(mentorUser.rows[0].is_active).toBe(true);

      const intent = await db.query("SELECT status FROM intent_forms WHERE form_id = $1", [intentId]);
      expect(intent.rows[0].status).toBe('accepted');
    });
  });

  test('Test L3: IDOR Guard on Accommodation & Plan Submission', async ({ request }) => {
    // Login as student1
    await apiLoginAs(request, 'student1');

    // Try to submit accommodation & plan for student2 (student_id = 2) using student1 token (should return 403 Forbidden)
    const submitRes = await request.post(`${API_URL}/students/2/accommodation-plan`, {
      data: {
        accommodation: 'Some address',
        weekly_plans: Array(16).fill({
          week_number: 1,
          start_date: '2026-11-02',
          end_date: '2026-11-06',
          tasks: 'Some task'
        })
      }
    });
    expect(submitRes.status()).toBe(403);
    const submitData = await submitRes.json();
    expect(submitData.message).toContain('Forbidden');
  });

  test('Test L4: Grade Integrity & Log Modification Locks', async ({ request }) => {
    const client = await pool.connect();
    let appointmentId: number;
    try {
      // Find or insert an appointment
      const appRes = await client.query(
        `INSERT INTO supervision_appointments (student_id, advisor_id, company_id, appointment_date, mentor_time, student_time, status)
         VALUES (2, 3, 1, '2026-07-16', '10:00', '10:00', 'accepted') RETURNING appointment_id`
      );
      appointmentId = appRes.rows[0].appointment_id;

      // Insert submitted log
      await client.query(
        `INSERT INTO supervision_logs (appointment_id, preliminary_score, behavior_notes, status)
         VALUES ($1, 95, 'Excellent performance', 'submitted')`,
        [appointmentId]
      );
    } finally {
      client.release();
    }

    // Login as advisor1
    await apiLoginAs(request, 'advisor1');

    // Try to overwrite the submitted supervision log (should return 400 Bad Request)
    const overwriteRes = await request.post(`${API_URL}/supervision-logs`, {
      data: {
        appointment_id: appointmentId,
        preliminary_score: 50,
        behavior_notes: 'Poor performance',
        status: 'submitted'
      }
    });
    expect(overwriteRes.status()).toBe(400);
    const overwriteData = await overwriteRes.json();
    expect(overwriteData.message).toContain('ไม่สามารถแก้ไขบันทึกผลการนิเทศงานที่ได้รับการส่งเรียบร้อยแล้ว');
  });

  test('Test L5: Unauthenticated API Access Guards', async ({ request }) => {
    // 1. Call protected student endpoint
    const intentsMeRes = await request.get(`${API_URL}/intents/me`);
    expect(intentsMeRes.status()).toBe(401);

    // 2. Call protected student dashboard endpoint
    const studentDashboardRes = await request.get(`${API_URL}/students/dashboard`);
    expect(studentDashboardRes.status()).toBe(401);

    // 3. Call protected staff doc generation endpoint
    const docGenRes = await request.post(`${API_URL}/documents/generate`, {
      data: { student_id: 1, company_id: 1, template_id: 1 }
    });
    expect(docGenRes.status()).toBe(401);

    // 4. Call protected dean batch sign endpoint
    const batchSignRes = await request.post(`${API_URL}/documents/batch-sign`, {
      data: { doc_ids: [1] }
    });
    expect(batchSignRes.status()).toBe(401);

    // 5. Call protected companies directory list endpoint
    const companiesRes = await request.get(`${API_URL}/companies`);
    expect(companiesRes.status()).toBe(401);
  });

  test('Test L6: Student Dashboard Status Verification', async ({ page }) => {
    // Block Google Maps API to prevent loading external resources
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");'
      });
    });

    const client = await pool.connect();
    let studentId: number;
    let companyId: number;
    let semesterId: number;
    let intentFormId: number;
    try {
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");

      studentId = studentRes.rows[0].user_id;
      companyId = companyRes.rows[0].company_id;
      semesterId = semesterRes.rows[0].semester_id;

      // Ensure clean state
      await client.query("DELETE FROM intent_forms");

      // Insert pending_advisor intent form
      const insertRes = await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         VALUES ($1, $2, $3, 'pending_advisor') RETURNING form_id`,
        [studentId, companyId, semesterId]
      );
      intentFormId = insertRes.rows[0].form_id;
    } finally {
      client.release();
    }

    // 2. Student logs in
    await loginAs(page, 'student2');

    // 3. Verify 'pending_advisor' status text
    //
    // ⚠️ ป้ายของ `pending_advisor` ต่างกันตามโดเมน — ของ **ใบความจำนง** แปลว่า
    // "เอาแบบคำร้องไปให้ลงนามแล้วอัปโหลดกลับ" ตั้งแต่ 2026-08-26 ส่วนโครงร่างรายงาน
    // ยังเป็น "รออาจารย์ที่ปรึกษาพิจารณา" (ดู DOMAIN_OVERRIDES)
    await expect(placementCard(page).getByText('นำแบบคำร้องไปให้ลงนามแล้วอัปโหลดกลับ', { exact: false })).toBeVisible();

    // 4. อัปโหลดคำร้องที่ลงนามแล้ว → รอเจ้าหน้าที่ตรวจรับ
    //
    // ⛔ ขั้นนี้เคยเป็น `approved_by_advisor` ซึ่ง **ถูกลบทั้งสถานะ** เมื่อ 2026-08-27
    //    ขั้นจริงที่มาแทนคือ `pending_officer_request` (นักศึกษาอัปโหลดกระดาษกลับ)
    await withDb(async (db) => {
      await db.query(
        "UPDATE intent_forms SET status = 'pending_officer_request' WHERE form_id = $1",
        [intentFormId]
      );
    });

    // Reload student dashboard and verify status
    await page.reload();
    await expect(placementCard(page).getByText('ส่งคำร้องที่ลงนามแล้ว · รอเจ้าหน้าที่ตรวจสอบ')).toBeVisible();

    // 5. Update status to 'approved_by_dept_head' in DB
    await withDb(async (db) => {
      await db.query(
        "UPDATE intent_forms SET status = 'approved_by_dept_head' WHERE form_id = $1",
        [intentFormId]
      );
    });

    // Reload student dashboard and verify status
    await page.reload();
    await expect(placementCard(page).getByText('เจ้าหน้าที่รับคำร้องแล้ว · รอออกหนังสือ')).toBeVisible();

    // 6. Update status to 'accepted' in DB
    await withDb(async (db) => {
      await db.query(
        "UPDATE intent_forms SET status = 'accepted' WHERE form_id = $1",
        [intentFormId]
      );
    });

    // Reload student dashboard and verify status
    await page.reload();
    await expect(placementCard(page).getByText('สถานประกอบการตอบรับแล้ว', { exact: false })).toBeVisible();

    // Logout student
    await logout(page);
  });

});
