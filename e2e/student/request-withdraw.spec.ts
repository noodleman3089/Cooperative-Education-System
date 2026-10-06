import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';

/**
 * นักศึกษายกเลิกคำร้องของตัวเองก่อนเจ้าหน้าที่รับ — `POST /api/intents/:id/withdraw` (เจ้าของสั่ง 2026-10-06)
 *
 * เดิมยื่นแล้วเปลี่ยนสถานประกอบการไม่ได้เลยจนกว่าคณบดีลงนาม ทั้งที่หน้าจอเขียนว่าเปลี่ยนได้
 *
 * สิ่งที่พังเงียบได้:
 *   1. **ใครยกเลิกได้ · ถึงขั้นไหน** — เจ้าของใบเท่านั้น และเฉพาะก่อนเจ้าหน้าที่รับ
 *      (หลังรับ = บริษัทถูกรับรอง + เลขที่หนังสือออกแล้ว ปุ่มของนักศึกษาย้อนไม่ได้ · SEC-04)
 *   2. **ยกเลิกแล้วต้องยื่นใหม่ได้จริง** — ถ้าหน้าแรกยังนับใบที่ยกเลิกเป็นใบที่เดินอยู่ นักศึกษาจะค้างถาวร
 *   3. ยกเลิกเพราะข้อมูลบริษัทผิด แล้วยื่นสถานที่เดิมจาก Google Maps — ต้องไม่ถูกจับคู่กลับไปแถวเก่าที่ผิด
 */

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";

/** ใบคำร้องของ student2 ถึงบริษัทที่ตัวเองกรอก (ยังไม่รับรอง · มาจาก Google Maps) */
async function seedSelfFoundIntent(status = 'pending_advisor'): Promise<{ formId: number; companyId: number }> {
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
         VALUES (${STUDENT2}, $1, (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), $2)
         RETURNING form_id`,
        [companyId, status]
      )
    ).rows[0].form_id as number;
    return { formId, companyId };
  });
}

const statusOf = (formId: number) =>
  dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId]);

test.describe('ยกเลิกคำร้องก่อนเจ้าหน้าที่รับ', () => {
  test('W1: ยกเลิกใบที่ยังไม่อัปโหลด → superseded · หน้าแรกปลดล็อก · ยื่นสถานที่เดิมใหม่ได้ด้วยข้อมูลที่แก้แล้ว', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const { formId, companyId } = await seedSelfFoundIntent();

    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/intents/${formId}/withdraw`);
    expect(res.status(), await res.text()).toBe(200);
    expect(await statusOf(formId)).toBe('superseded');

    // ออกจากท่อ ต้องมีเวลาเข้าขั้น (แดชบอร์ดเจ้าหน้าที่อ่านจากตารางนี้) และลง audit
    expect(
      await dbValue<number>(
        "SELECT COUNT(*)::int FROM intent_stage_events WHERE form_id = $1 AND stage = 'exited'",
        [formId]
      )
    ).toBe(1);
    await expect
      .poll(
        () =>
          dbValue<number>(
            "SELECT COUNT(*)::int FROM audit_log WHERE action = 'intent.withdrawn' AND entity_id = $1",
            [String(formId)]
          ),
        { timeout: 5000 }
      )
      .toBe(1);

    // แถวบริษัทลบไม่ได้ (ใบที่ยกเลิกยังอ้างถึง) — แต่ต้องปลด google_place_id ไม่ให้ถูกจับคู่กลับมา
    const company = await dbRow<{ google_place_id: string | null; is_verified: boolean }>(
      'SELECT google_place_id, is_verified FROM companies WHERE company_id = $1',
      [companyId]
    );
    expect(company!.google_place_id).toBeNull();
    expect(company!.is_verified).toBe(false);

    // ⛔ หน้าแรกต้องไม่นับใบที่ยกเลิกเป็นใบที่เดินอยู่ — ไม่งั้นนักศึกษายื่นใหม่ไม่ได้ตลอดไป
    const dash = await (await request.get(`${API_URL}/students/dashboard`)).json();
    expect(dash.activeIntent).toBeNull();
    expect(dash.closedIntent).toMatchObject({ form_id: formId, status: 'superseded' });

    // ยื่นสถานที่เดิม (place เดิม) ด้วยข้อมูลที่แก้แล้ว → ต้องได้แถวบริษัทใหม่ที่ใช้ข้อมูลใหม่
    const semesterId = await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
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
    const fresh = await dbRow<{ company_id: number; contact_person: string; status: string }>(
      `SELECT i.company_id, c.contact_person, i.status
         FROM intent_forms i JOIN companies c ON c.company_id = i.company_id
        WHERE i.student_id = ${STUDENT2} AND i.status <> 'superseded'`
    );
    expect(fresh!.company_id).not.toBe(companyId);
    expect(fresh!.contact_person).toBe('ชื่อผู้รับที่ถูก');
    expect(fresh!.status).toBe('pending_advisor');
  });

  test('W2: ยกเลิกระหว่างรอเจ้าหน้าที่ตรวจ → ไฟล์ที่อัปไว้ถูกลบ · บริษัทในทำเนียบไม่ถูกแตะ', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    // ใบถึงบริษัทของ seed (รับรองแล้ว) — การยกเลิกต้องไม่ไปยุ่งกับแถวของทำเนียบ
    const directory = await dbRow<{ company_id: number }>(
      'SELECT company_id FROM companies WHERE is_verified = TRUE ORDER BY company_id LIMIT 1'
    );
    await withDb((db) =>
      db.query("UPDATE companies SET google_place_id = 'place-directory' WHERE company_id = $1", [directory!.company_id])
    );
    const formId = await withDb(async (db) =>
      (
        await db.query(
          `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
           VALUES (${STUDENT2}, $1, (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'pending_advisor')
           RETURNING form_id`,
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
    expect(await statusOf(formId)).toBe('pending_officer_request');
    const stored = path.resolve(__dirname, '../../backend/uploads', (await upload.json()).request_form_path);
    expect(fs.existsSync(stored)).toBe(true);

    const res = await request.post(`${API_URL}/intents/${formId}/withdraw`);
    expect(res.status(), await res.text()).toBe(200);
    expect(await statusOf(formId)).toBe('superseded');
    expect(await dbValue<string | null>('SELECT request_form_path FROM intent_forms WHERE form_id = $1', [formId])).toBeNull();
    // ลบไฟล์เป็น fire-and-forget หลัง COMMIT
    await expect.poll(() => fs.existsSync(stored), { timeout: 5000 }).toBe(false);

    expect(
      await dbRow('SELECT google_place_id, is_verified FROM companies WHERE company_id = $1', [directory!.company_id])
    ).toEqual({ google_place_id: 'place-directory', is_verified: true });

    // เจ้าหน้าที่ต้องกดรับใบที่ยกเลิกแล้วไม่ได้ (SEC-04: allow-list ของ officer-approve)
    await apiLoginAs(request, 'staff1');
    const approve = await request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
      data: { document_no: 'อว 0000/1' },
    });
    expect(approve.status()).toBe(400);
    expect(await statusOf(formId)).toBe('superseded');
  });

  test('W3: คนอื่นยกเลิกแทนไม่ได้ · หลังเจ้าหน้าที่รับแล้วยกเลิกไม่ได้ · ยกเลิกซ้ำไม่ได้', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const { formId } = await seedSelfFoundIntent();
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
    expect(await statusOf(formId)).toBe('pending_advisor');

    // ทุกสถานะตั้งแต่เจ้าหน้าที่รับเป็นต้นไป ต้องยกเลิกด้วยปุ่มนี้ไม่ได้
    await apiLoginAs(request, 'student2');
    for (const status of ['approved_by_dept_head', 'pending_officer_approval', 'accepted', 'company_rejected']) {
      await withDb((db) => db.query('UPDATE intent_forms SET status = $1 WHERE form_id = $2', [status, formId]));
      expect((await request.post(url)).status(), status).toBe(400);
      expect(await statusOf(formId)).toBe(status);
    }

    await withDb((db) => db.query("UPDATE intent_forms SET status = 'pending_advisor' WHERE form_id = $1", [formId]));
    expect((await request.post(url)).status()).toBe(200);
    expect((await request.post(url)).status()).toBe(400);
    expect(
      await dbValue<number>("SELECT COUNT(*)::int FROM intent_stage_events WHERE form_id = $1 AND stage = 'exited'", [formId])
    ).toBe(1);
  });

  test('W4: หน้าจอ — กดยกเลิกต้องยืนยันก่อน · การ์ดบอกว่ายกเลิกเอง · กลับไปยื่นใหม่ได้', async ({ page }) => {
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
    expect(await statusOf(formId)).toBe('pending_advisor');

    await page.getByTestId('withdraw-open').click();
    await page.getByTestId('withdraw-confirm').click();
    await expect(card).toHaveAttribute('data-state', 'withdrawn');
    await expect(card).toContainText('คุณยกเลิกคำร้องนี้เอง ยื่นที่ใหม่ได้เลย');
    expect(await statusOf(formId)).toBe('superseded');

    // ปุ่มหลักพาไปหน้ายื่นคำร้อง และฟอร์มต้องเปิดให้ยื่น (ไม่ติดแบนเนอร์ "มีคำร้องที่ดำเนินการอยู่แล้ว")
    await card.getByTestId('status-primary').click();
    await expect(page.getByTestId('request-company-search')).toBeVisible();
    await expect(page.getByTestId('request-blocking-intent')).toHaveCount(0);
  });
});
