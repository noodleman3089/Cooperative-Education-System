import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { dbRow, dbValue, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { officerApprove } from '../helpers/intent';

/**
 * นักศึกษายกเลิกคำร้องของตัวเองก่อนเจ้าหน้าที่รับ — `POST /api/intents/:id/withdraw` (เจ้าของสั่ง 2026-10-06)
 *
 * เดิมยื่นแล้วเปลี่ยนสถานประกอบการไม่ได้เลยจนกว่าคณบดีลงนาม ทั้งที่หน้าจอเขียนว่าเปลี่ยนได้
 * ยกเลิก = **ลบใบทิ้งทั้งใบ** (เจ้าของตัดสิน) · ร่องรอยที่เหลือคือ audit_log
 *
 * สิ่งที่พังเงียบได้:
 *   1. **ใครยกเลิกได้ · ถึงขั้นไหน** — เจ้าของใบเท่านั้น และเฉพาะก่อนเจ้าหน้าที่รับ
 *      (หลังรับ = บริษัทถูกรับรอง + เลขที่หนังสือออกแล้ว · ปุ่มนี้ลบใบทิ้ง จึงห้ามไปถึงใบที่เดินไปแล้วเด็ดขาด)
 *   2. **ลบเกิน** — แถวสถานประกอบการของทำเนียบ หรือแถวที่ใบอื่นยังอ้าง ต้องไม่หายตาม
 *   3. ยกเลิกเพราะข้อมูลบริษัทผิด แล้วยื่นสถานที่เดิมจาก Google Maps — ต้องได้ข้อมูลที่เพิ่งกรอก ไม่ใช่แถวเก่าที่ผิด
 */

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const ACTIVE_SEMESTER = '(SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1)';

/** ใบคำร้องของ student2 ถึงบริษัทที่ตัวเองกรอก (ยังไม่รับรอง · มาจาก Google Maps) */
async function seedSelfFoundIntent(): Promise<{ formId: number; companyId: number }> {
  return withDb(async (db) => {
    const companyId = (
      await db.query(
        `INSERT INTO companies (name_th, address, province, district, postal_code, phone,
                                created_by, is_verified, contact_person, contact_position, google_place_id)
         VALUES ('บริษัท พิมพ์ผิด จำกัด', '1 ถนนทดสอบ', 'ชลบุรี', 'ศรีราชา', '20110', '020000000',
                 ${STUDENT2}, FALSE, 'ชื่อผู้รับที่ผิด', 'ตำแหน่งที่ผิด', 'place-withdraw-test')
         RETURNING company_id`
      )
    ).rows[0].company_id as number;
    const formId = (
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         VALUES (${STUDENT2}, $1, ${ACTIVE_SEMESTER}, 'pending_advisor') RETURNING form_id`,
        [companyId]
      )
    ).rows[0].form_id as number;
    return { formId, companyId };
  });
}

const formCount = (formId: number) =>
  dbValue<number>('SELECT COUNT(*)::int FROM intent_forms WHERE form_id = $1', [formId]);
const companyCount = (companyId: number) =>
  dbValue<number>('SELECT COUNT(*)::int FROM companies WHERE company_id = $1', [companyId]);

test.describe('ยกเลิกคำร้องก่อนเจ้าหน้าที่รับ', () => {
  test('W1: ยกเลิกใบที่ยังไม่อัปโหลด → ใบและแถวบริษัทที่กรอกเองถูกลบ · ลง audit · ยื่นสถานที่เดิมใหม่ได้ด้วยข้อมูลที่แก้แล้ว', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const { formId, companyId } = await seedSelfFoundIntent();

    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/intents/${formId}/withdraw`);
    expect(res.status(), await res.text()).toBe(200);

    expect(await formCount(formId)).toBe(0);
    expect(await companyCount(companyId)).toBe(0);

    // ใบหายไปแล้ว — audit คือที่เดียวที่ตามย้อนได้ว่าเคยยื่นถึงที่ไหน
    await expect
      .poll(
        () =>
          dbRow<{ company_name: string; company_deleted: string }>(
            `SELECT detail->>'company_name' AS company_name, detail->>'company_deleted' AS company_deleted
               FROM audit_log WHERE action = 'intent.withdrawn' AND entity_id = $1`,
            [String(formId)]
          ),
        { timeout: 5000 }
      )
      .toEqual({ company_name: 'บริษัท พิมพ์ผิด จำกัด', company_deleted: 'true' });

    const dash = await (await request.get(`${API_URL}/students/dashboard`)).json();
    expect(dash.activeIntent).toBeNull();
    expect(dash.closedIntent ?? null).toBeNull();

    // ยื่นสถานที่เดิม (place เดิม) ด้วยข้อมูลที่แก้แล้ว → ต้องได้แถวบริษัทที่ใช้ข้อมูลใหม่
    const semesterId = await dbValue<number>(`SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1`);
    const again = await request.post(`${API_URL}/intents`, {
      data: {
        is_self_found: true,
        semester_id: semesterId,
        google_place_id: 'place-withdraw-test',
        company_name_th: 'บริษัท พิมพ์ถูก จำกัด',
        company_address: '1 ถนนทดสอบ',
        company_province: 'ชลบุรี',
        company_district: 'ศรีราชา',
        company_postal_code: '20110',
        company_phone: '020000000',
        contact_person: 'ชื่อผู้รับที่ถูก',
        contact_position: 'ผู้จัดการฝ่ายบุคคล',
      },
    });
    expect(again.status(), await again.text()).toBe(201);
    const fresh = await dbRow<{ name_th: string; contact_person: string; status: string }>(
      `SELECT c.name_th, c.contact_person, i.status
         FROM intent_forms i JOIN companies c ON c.company_id = i.company_id
        WHERE i.student_id = ${STUDENT2}`
    );
    expect(fresh).toEqual({ name_th: 'บริษัท พิมพ์ถูก จำกัด', contact_person: 'ชื่อผู้รับที่ถูก', status: 'pending_advisor' });
  });

  test('W2: ยกเลิกระหว่างรอเจ้าหน้าที่ตรวจ → ไฟล์ที่อัปไว้ถูกลบ · บริษัทในทำเนียบและบริษัทที่ใบอื่นยังอ้างไม่หายตาม', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();

    // (ก) ใบถึงบริษัทของ seed (รับรองแล้ว)
    const directory = await dbRow<{ company_id: number }>(
      'SELECT company_id FROM companies WHERE is_verified = TRUE ORDER BY company_id LIMIT 1'
    );
    const formId = await withDb(async (db) =>
      (
        await db.query(
          `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
           VALUES (${STUDENT2}, $1, ${ACTIVE_SEMESTER}, 'pending_advisor') RETURNING form_id`,
          [directory!.company_id]
        )
      ).rows[0].form_id as number
    );

    await apiLoginAs(request, 'student2');
    const upload = await request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: {
        request_form: {
          name: 'signed.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
        },
      },
    });
    expect(upload.status(), await upload.text()).toBe(200);
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe('pending_officer_request');
    const stored = path.join(BACKEND_ROOT, 'uploads', (await upload.json()).request_form_path);
    expect(fs.existsSync(stored)).toBe(true);

    const res = await request.post(`${API_URL}/intents/${formId}/withdraw`);
    expect(res.status(), await res.text()).toBe(200);
    expect(await formCount(formId)).toBe(0);
    // ลบไฟล์เป็น fire-and-forget หลัง COMMIT
    await expect.poll(() => fs.existsSync(stored), { timeout: 5000 }).toBe(false);
    expect(await companyCount(directory!.company_id)).toBe(1);

    // เจ้าหน้าที่กดรับใบที่ถูกยกเลิกไปแล้วไม่ได้
    await apiLoginAs(request, 'staff1');
    const approve = await officerApprove(request, formId, { document_no: 'อว 0000/1' });
    expect(approve.status()).toBe(400);
    expect((await approve.json()).message).toContain('ไม่พบคำร้อง');

    // (ข) บริษัทที่ student2 กรอกเองและยังไม่รับรอง แต่มี**ใบของภาคอื่น**อ้างอยู่ → แถวบริษัทต้องอยู่
    const { formId: form2, companyId: shared } = await seedSelfFoundIntent();
    await withDb(async (db) => {
      const otherSemester = (
        await db.query(
          `INSERT INTO coop_semesters (academic_year, semester, is_active) VALUES (2599, '1', FALSE) RETURNING semester_id`
        )
      ).rows[0].semester_id;
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status) VALUES (${STUDENT2}, $1, $2, 'rejected')`,
        [shared, otherSemester]
      );
    });
    await apiLoginAs(request, 'student2');
    expect((await request.post(`${API_URL}/intents/${form2}/withdraw`)).status()).toBe(200);
    expect(await formCount(form2)).toBe(0);
    expect(await companyCount(shared)).toBe(1);
  });

  test('W3: คนอื่นยกเลิกแทนไม่ได้ · หลังเจ้าหน้าที่รับแล้วยกเลิกไม่ได้ · ยกเลิกซ้ำไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const { formId, companyId } = await seedSelfFoundIntent();
    const url = `${API_URL}/intents/${formId}/withdraw`;

    expect((await request.post(url)).status()).toBe(401);

    for (const role of ['staff1', 'advisor1'] as const) {
      await apiLoginAs(request, role);
      expect((await request.post(url)).status(), role).toBe(403);
    }

    // นักศึกษาคนอื่น — ผ่านด่าน role แต่ไม่ใช่เจ้าของใบ
    await apiLoginAs(request, 'student1');
    const other = await request.post(url);
    expect(other.status()).toBe(400);
    expect((await other.json()).message).toContain('ของตัวเอง');
    expect(await formCount(formId)).toBe(1);

    // ⛔ ทุกสถานะตั้งแต่เจ้าหน้าที่รับเป็นต้นไป (และใบที่ปิดแล้ว) ต้องลบด้วยปุ่มนี้ไม่ได้
    await apiLoginAs(request, 'student2');
    for (const status of ['approved_by_dept_head', 'pending_officer_approval', 'accepted', 'company_rejected', 'rejected']) {
      await withDb((db) => db.query('UPDATE intent_forms SET status = $1 WHERE form_id = $2', [status, formId]));
      expect((await request.post(url)).status(), status).toBe(400);
      expect(await formCount(formId), status).toBe(1);
      expect(await companyCount(companyId), status).toBe(1);
    }

    await withDb((db) => db.query("UPDATE intent_forms SET status = 'pending_advisor' WHERE form_id = $1", [formId]));
    expect((await request.post(url)).status()).toBe(200);
    expect((await request.post(url)).status()).toBe(400);
  });

  test('W4: หน้าจอ — กดยกเลิกต้องยืนยันก่อน · ยกเลิกแล้วมีข้อความบอก · กลับไปยื่นใหม่ได้', async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    const { formId } = await seedSelfFoundIntent();

    await loginAs(page, 'student2');
    const card = page.getByTestId('status-card');
    await expect(card).toHaveAttribute('data-state', 'submit-paper');

    // กดแล้วยังไม่ยกเลิก — กล่องยืนยันต้องบอกว่ากำลังยกเลิกคำร้องถึงใคร
    await page.getByTestId('withdraw-open').click();
    const summary = page.getByTestId('confirm-summary');
    await expect(summary).toContainText('บริษัท พิมพ์ผิด จำกัด');
    await expect(summary).toContainText('เรียกคืนไม่ได้');
    await page.getByTestId('withdraw-confirm-cancel').click();
    await expect(summary).toHaveCount(0);
    expect(await formCount(formId)).toBe(1);

    await page.getByTestId('withdraw-open').click();
    await page.getByTestId('withdraw-confirm').click();
    // ใบถูกลบ การ์ดสถานะหายไป — ต้องมีข้อความบอกว่ายกเลิกสำเร็จ ไม่ใช่หน้าจอรีเซ็ตเงียบๆ
    await expect(page.getByTestId('withdraw-notice')).toContainText('ยกเลิกคำร้องถึง บริษัท พิมพ์ผิด จำกัด แล้ว');
    await expect(card).toHaveCount(0);
    expect(await formCount(formId)).toBe(0);

    // หน้ายื่นคำร้องต้องเปิดให้ยื่น (ไม่ติดแบนเนอร์ "มีคำร้องที่ดำเนินการอยู่แล้ว")
    await goToMenu(page, 'jobs');
    await expect(page.getByTestId('request-company-search')).toBeVisible();
    await expect(page.getByTestId('request-blocking-intent')).toHaveCount(0);
  });
});
