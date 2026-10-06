import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import pool from '../../backend/src/config/database';
import path from 'path';
import { API_URL } from '../helpers/env';
import { withDb } from '../helpers/db';
import { loginAs } from '../helpers/auth';
import { logout } from '../helpers/nav';

test.describe('Business Rules & Guards E2E Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Block Google Maps API to prevent external resource loading
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");'
      });
    });
  });

  test('Test B2: Advisor Major Mismatch Guard Blocks Cross-Major Approval', async ({ page }) => {
    // ==========================================
    // Business Rule: Advisor can only approve/reject students in the SAME major.
    // Controller: intent.ts L165 checks advisorProfile.major_id !== studentProfile.major_id → 403
    // advisor2@test.com (IT01 major) should NOT be able to approve student2@test.com (CS01 major).
    // ==========================================

    // 1. Seed DB and create student application
    await seedTestData();

    const client = await pool.connect();
    let intentFormId: number;
    try {
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");

      const studentId = studentRes.rows[0].user_id;
      const companyId = companyRes.rows[0].company_id;
      const semesterId = semesterRes.rows[0].semester_id;

      // Insert a pending_advisor intent for student2
      const insertRes = await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         VALUES ($1, $2, $3, 'pending_advisor') RETURNING form_id`,
        [studentId, companyId, semesterId]
      );
      intentFormId = insertRes.rows[0].form_id;
    } finally {
      client.release();
    }

    // 2. Advisor2 (IT01 major, different from student's CS01) logs in
    await loginAs(page, 'advisor2');

    // 3. ⛔ `PATCH /intents/:id/status` ถูกลบทิ้งเมื่อ 2026-08-27 พร้อมการอนุมัติ
    //    ของอาจารย์ที่ปรึกษา — เคสนี้จึงเปลี่ยนไปคุมด่านเดียวกันบน **พื้นผิวที่ยังมีอยู่จริง**
    //    คือการเปิดดูงานของนักศึกษาข้ามสาขา ซึ่งใช้ `assertCanReviewStudentWork` ตัวเดียวกัน
    const goneRes = await page.request.patch(`${API_URL}/intents/${intentFormId}/status`, {
      data: { status: 'approved_by_advisor' },
    });
    expect(goneRes.status(), 'endpoint อนุมัติของที่ปรึกษาต้องไม่มีอยู่แล้ว').toBe(404);

    // 4. อาจารย์นอกสาขาเปิดแบบคำร้องของนักศึกษาคนนี้ไม่ได้
    const formRes = await page.request.get(`${API_URL}/intents/${intentFormId}/request-form`);
    expect(formRes.status(), 'advisor2 (IT01) ต้องเปิดคำร้องของนักศึกษา CS01 ไม่ได้').toBe(403);

    // 5. และมองไม่เห็นใบนี้ในรายการของตัวเองด้วย
    const listRes = await page.request.get(`${API_URL}/intents`);
    expect(listRes.status()).toBe(200);
    const visible = (await listRes.json()) as { form_id: number }[];
    expect(
      visible.some((i) => i.form_id === intentFormId),
      'ใบของนักศึกษาต่างสาขาต้องไม่โผล่ในรายการของ advisor2'
    ).toBe(false);

    // 6. Verify the intent form status was NOT changed in the database
    await withDb(async (db) => {
      const statusRes = await db.query(
        'SELECT status FROM intent_forms WHERE form_id = $1',
        [intentFormId]
      );
      expect(statusRes.rows[0].status).toBe('pending_advisor');
    });
  });

  // เคส B3 (อัปโหลดใบยินยอมผู้ปกครอง) ถูกลบเมื่อ 2026-08-26 — เจ้าของยืนยันว่า
  // ขั้นตอนนี้ไม่เคยมีในกระบวนการจริงของคณะ ระบบคิดขึ้นมาเอง
  // ด่านที่เคสนี้เคยคุมไม่ได้หายไปด้วย: การตรวจเจ้าของไฟล์และ magic bytes ยังถูกคุม
  // ที่ `edge-cases.spec.ts` ผ่านการอัปโหลดหลักฐานการตอบรับ (acceptance_evidence)

  test('Test S3: State Guard - เจ้าหน้าที่รับคำร้องผิดสถานะ → 400', async ({ page }) => {
    // ==========================================
    // กติกา: เจ้าหน้าที่กดรับคำร้องได้เฉพาะใบที่นักศึกษา **อัปโหลดกระดาษที่ลงนามแล้ว**
    // (`pending_officer_request`) เท่านั้น — SEC-04 allow-list `OFFICER_DECISION_FROM`
    //
    // ⛔ เดิมเคสนี้ยิง `PATCH /intents/:id/status` ของอาจารย์ที่ปรึกษา ซึ่งถูกลบทิ้ง
    //    เมื่อ 2026-08-27 · ด่าน "กดผิดสถานะไม่ได้" ไม่ได้หายไป มันย้ายมาอยู่ที่
    //    ปุ่มของเจ้าหน้าที่แทน ซึ่งเป็นปุ่มเดียวที่กดผ่านได้ในระบบตอนนี้
    // ==========================================

    // 1. Seed database state
    await seedTestData();

    const client = await pool.connect();
    let intentFormId: number;
    try {
      const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
      const companyRes = await client.query("SELECT company_id FROM companies LIMIT 1");
      const semesterRes = await client.query("SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1");

      const studentId = studentRes.rows[0].user_id;
      const companyId = companyRes.rows[0].company_id;
      const semesterId = semesterRes.rows[0].semester_id;

      // ใบที่นักศึกษายังไม่ได้อัปโหลดกระดาษกลับ — ยังไม่ถึงคิวของเจ้าหน้าที่
      const insertRes = await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         VALUES ($1, $2, $3, 'pending_advisor') RETURNING form_id`,
        [studentId, companyId, semesterId]
      );
      intentFormId = insertRes.rows[0].form_id;
    } finally {
      client.release();
    }

    // 2. เจ้าหน้าที่ล็อกอิน
    await loginAs(page, 'staff1');

    // 3. กดรับคำร้องทั้งที่ยังไม่มีไฟล์ที่ลงนามอัปโหลดเข้ามา
    const approveRes = await page.request.patch(
      `${API_URL}/intents/${intentFormId}/officer-approve`,
      {
        data: {
          document_no: 'อว 0656.10/999',
        },
      }
    );

    // 4. ต้องถูกปฏิเสธ และสถานะในฐานต้องไม่ขยับ
    expect(approveRes.status(), await approveRes.text()).toBe(400);
    // ข้อความถึงมือผู้ใช้เป็นคำไทยตั้งแต่ `bb59066` — บอกว่าใบอยู่ขั้นไหน และขั้นไหนถึงกดได้
    const refusal = (await approveRes.json()).message as string;
    expect(refusal).toContain('คำร้องอยู่ในขั้น "รอนักศึกษาอัปโหลดแบบคำร้องที่ลงนาม"');
    expect(refusal).toContain('ทำได้เฉพาะขั้น "รอเจ้าหน้าที่ตรวจแบบคำร้อง"');

    await withDb(async (db) => {
      const statusRes = await db.query(
        'SELECT status, officer_document_no FROM intent_forms WHERE form_id = $1',
        [intentFormId]
      );
      expect(statusRes.rows[0].status).toBe('pending_advisor');
      expect(statusRes.rows[0].officer_document_no, 'ห้ามออกเลขที่หนังสือให้ใบที่ยังไม่ถึงคิว').toBeNull();
    });
  });

});
