import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { dbExec, dbValue } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';
import { approveIntentThroughOfficer, officerApprove } from '../helpers/intent';

/**
 * ขั้น 3 ข้อ ง — อีเมลบอกคณบดีว่ามีหนังสือเข้าคิวลงนาม
 *
 * เป้าหมายของเจ้าของ: คณบดีเปิดคิวอยู่ไม่ต้องรบกวน · ไม่อยู่ให้ส่งอีเมล · รับคำร้อง 30 ใบรวดต้องได้ฉบับเดียว
 * ตรวจจาก `personnel.sign_queue_notified_at` ในฐาน ไม่ต้องดักอีเมล (E2E ตั้ง MAIL_DRY_RUN=true — SEC-17)
 *   N1  ไม่เคยเปิดคิว + รับสองคำร้องติดกัน → ค่าถูกปั๊มครั้งเดียว
 *   N2  เพิ่งเปิดคิว → รับคำร้องแล้วไม่ส่ง
 *   N3  ไม่ได้เปิดเกิน 15 นาที → ส่ง · เตือนไปแล้วและยังไม่กลับมาเปิด → ไม่ส่งซ้ำ · กลับมาเปิดแล้วออกไปอีก → ส่งอีก
 *   N4  เปิดคิวนับเฉพาะคณบดี · เขียนไม่ถี่เกิน 1 นาที
 */

const FONT = path.join(BACKEND_ROOT, 'secure_private/fonts/THSarabunNew.ttf');
const FONT_HIDDEN = `${FONT}.e2e-hidden`;

const DEAN = "(SELECT user_id FROM users WHERE email = 'dean1@test.com')";
const notifiedAt = () =>
  dbValue<string | null>(`SELECT sign_queue_notified_at::text FROM personnel WHERE personnel_id = ${DEAN}`);
const seenAt = () =>
  dbValue<string | null>(`SELECT sign_queue_seen_at::text FROM personnel WHERE personnel_id = ${DEAN}`);

const PDF = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const EXTRA_EMAIL = 'notice-extra@test.com';

/** คำร้องของนักศึกษาหนึ่งคน (ยื่นแล้ว) · คืน form_id */
async function seedIntent(studentEmail: string): Promise<number> {
  return (await dbValue<number>(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
     VALUES ((SELECT user_id FROM users WHERE email = $1),
             (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
             (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'pending_advisor')
     RETURNING form_id`,
    [studentEmail]
  ))!;
}

/** นักศึกษาคนที่สอง (seed มี student2 คนเดียวที่ครบโปรไฟล์) — ใช้รหัสผ่านเดียวกับ student2 · สร้างซ้ำได้ */
async function ensureExtraStudent(): Promise<void> {
  if (await dbValue('SELECT 1 FROM users WHERE email = $1', [EXTRA_EMAIL])) return;
  const userId = (await dbValue<number>(
    `INSERT INTO users (email, password_hash)
     SELECT $1, password_hash FROM users WHERE email = 'student2@test.com' RETURNING user_id`,
    [EXTRA_EMAIL]
  ))!;
  await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [userId]);
  await dbExec(
    // advisor_id ตามนักศึกษาต้นแบบ — ไม่มีที่ปรึกษา ระบบไม่รู้ชื่อผู้ลงนามแบบคำร้องแล้วอัปโหลดไม่ผ่าน
    `INSERT INTO students (student_id, student_code, first_name, last_name, major_id, advisor_id, cumulative_gpa, enrollment_year)
     SELECT $1, '65909902', 'อีกคน', 'แจ้งเตือน', major_id, advisor_id, 3.00, enrollment_year
       FROM students WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')`,
    [userId]
  );
}

/** เจ้าหน้าที่รับคำร้องของนักศึกษาหนึ่งคน (หนังสือใหม่เข้าคิวคณบดี) แล้วรอให้ตัวแจ้งที่ไม่รอทำงานจบ */
async function approveOne(request: APIRequestContext, who: 'student2' | 'extra'): Promise<void> {
  if (who === 'student2') {
    const formId = await seedIntent('student2@test.com');
    await approveIntentThroughOfficer(request, formId, { documentNo: `อว 0656.10/แจ้ง-${formId}` });
  } else {
    await ensureExtraStudent();
    const formId = await seedIntent(EXTRA_EMAIL);
    const login = await request.post(`${API_URL}/auth/login`, { data: { email: EXTRA_EMAIL, password: 'password123' } });
    expect(login.status(), await login.text()).toBe(200);
    const upload = await request.post(`${API_URL}/intents/${formId}/request-form`, {
      multipart: { request_form: { name: 'signed.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF) } },
    });
    expect(upload.status(), await upload.text()).toBe(200);
    await apiLoginAs(request, 'staff1');
    const approved = await officerApprove(request, formId, { document_no: `อว 0656.10/แจ้ง-${formId}` });
    expect(approved.status(), await approved.text()).toBe(200);
  }
  // การแจ้งเป็น fire-and-forget หลัง COMMIT — ให้เวลามันจบก่อนอ่านค่า
  await new Promise((r) => setTimeout(r, 1500));
}

test.describe('ขั้น 3 — แจ้งคณบดีว่ามีหนังสือเข้าคิว', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    if (fs.existsSync(FONT_HIDDEN)) fs.renameSync(FONT_HIDDEN, FONT);
    await seedTestData();
  });

  test('N1: คณบดีไม่เคยเปิดคิว — รับสองคำร้องติดกันได้เตือนครั้งเดียว', async ({ request }) => {
    test.setTimeout(150_000);
    expect(await seenAt()).toBeNull();
    expect(await notifiedAt()).toBeNull();

    await approveOne(request, 'student2');
    const first = await notifiedAt();
    expect(first, 'หนังสือใบแรกเข้าคิวแล้วคณบดีไม่อยู่ ต้องแจ้ง').not.toBeNull();

    await approveOne(request, 'extra');
    expect(await dbValue<number>(`SELECT COUNT(*)::int FROM official_documents WHERE status = 'pending_sign'`)).toBe(2);
    expect(await notifiedAt(), 'ใบที่สองต้องไม่เตือนซ้ำ').toBe(first);
  });

  test('N2: คณบดีเพิ่งเปิดคิว — รับคำร้องแล้วไม่ส่งอีเมล', async ({ request }) => {
    test.setTimeout(120_000);
    await apiLoginAs(request, 'dean1');
    expect((await request.get(`${API_URL}/documents`)).status()).toBe(200);
    expect(await seenAt(), 'เปิดคิวต้องปั๊ม sign_queue_seen_at').not.toBeNull();

    await approveOne(request, 'student2');
    expect(await notifiedAt()).toBeNull();
  });

  test('N3: ไม่ได้เปิดเกิน 15 นาที → ส่ง · เตือนแล้วยังไม่กลับมา → ไม่ส่งซ้ำ · กลับมาแล้วออกไปอีก → ส่งอีก', async ({
    request,
  }) => {
    test.setTimeout(180_000);

    // (ก) ไม่ได้เปิดคิว 20 นาที ยังไม่เคยเตือน → ส่ง
    await dbExec(
      `UPDATE personnel SET sign_queue_seen_at = NOW() - INTERVAL '20 minutes', sign_queue_notified_at = NULL
        WHERE personnel_id = ${DEAN}`
    );
    await approveOne(request, 'student2');
    const sentFirst = await notifiedAt();
    expect(sentFirst).not.toBeNull();

    // (ข) เตือนไปแล้ว (ใหม่กว่าครั้งสุดท้ายที่เปิดคิว) คณบดียังไม่กลับมา → ไม่ส่งซ้ำ
    await approveOne(request, 'extra');
    expect(await notifiedAt()).toBe(sentFirst);

    // (ค) คณบดีกลับมาเปิดคิว (seen ใหม่กว่า notified) แล้วออกไปอีก 20 นาที → ส่งอีกรอบ
    //     (ล้างฐานก่อน — นักศึกษาหนึ่งคนยื่นได้ใบเดียวต่อภาค)
    await seedTestData();
    await dbExec(
      `UPDATE personnel
          SET sign_queue_notified_at = NOW() - INTERVAL '60 minutes',
              sign_queue_seen_at = NOW() - INTERVAL '20 minutes'
        WHERE personnel_id = ${DEAN}`
    );
    const beforeResend = await notifiedAt();
    await approveOne(request, 'student2');
    expect(await notifiedAt(), 'กลับมาเปิดแล้วออกไปอีก ต้องได้รับแจ้งอีกครั้ง').not.toBe(beforeResend);
    expect(
      await dbValue<boolean>(
        `SELECT sign_queue_notified_at > NOW() - INTERVAL '2 minutes' FROM personnel WHERE personnel_id = ${DEAN}`
      )
    ).toBe(true);
  });

  test('N4: เปิดคิวนับเฉพาะคณบดี · เขียนไม่ถี่กว่าหนึ่งนาที', async ({ request }) => {
    test.setTimeout(90_000);

    // เจ้าหน้าที่เปิดรายการเอกสารเดียวกัน — ไม่นับเป็นคณบดีเห็นคิว
    await apiLoginAs(request, 'staff1');
    expect((await request.get(`${API_URL}/documents`)).status()).toBe(200);
    expect(await seenAt()).toBeNull();

    await apiLoginAs(request, 'dean1');
    await request.get(`${API_URL}/documents`);
    const first = await seenAt();
    expect(first).not.toBeNull();

    // หน้าคิวรีเฟรชเองถี่ ๆ — ค่าเดิมสดกว่า 1 นาทีต้องไม่ถูกเขียนซ้ำ
    await request.get(`${API_URL}/documents`);
    expect(await seenAt()).toBe(first);

    // เก่ากว่า 1 นาที → เขียนใหม่
    await dbExec(`UPDATE personnel SET sign_queue_seen_at = NOW() - INTERVAL '5 minutes' WHERE personnel_id = ${DEAN}`);
    await request.get(`${API_URL}/documents`);
    expect(
      await dbValue<boolean>(
        `SELECT sign_queue_seen_at > NOW() - INTERVAL '1 minute' FROM personnel WHERE personnel_id = ${DEAN}`
      )
    ).toBe(true);
  });
});
