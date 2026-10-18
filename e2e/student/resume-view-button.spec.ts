import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { statusBoardRow } from '../helpers/intent';

/**
 * ปุ่ม "ดูเรซูเม่" แยกสำหรับฝ่ายที่ตรวจคำร้อง (เจ้าของสั่ง 2026-10-18) — เปิดดูเฉพาะไฟล์ที่นักศึกษาอัปโหลด
 *
 * จุดที่มีปุ่ม: แผงตรวจคำร้องของเจ้าหน้าที่ (`request-resume`) · กล่องตรวจทานคำร้อง (`intent-resume`)
 * ที่หัวหน้าสาขาเปิดจากปุ่ม "ดูคำร้อง" บนบอร์ดสถานะ
 * ลิงก์เดิมในกล่องตรวจทานชี้ชื่อไฟล์ผิด (`resume-user-<id>.pdf` ทั้งที่ไฟล์จริงมีเลขสุ่มต่อท้าย) จึงเปิดไม่เคยได้
 * — เทสต์นี้เปิดไฟล์จริงจนเห็นตัวอ่าน PDF ไม่ใช่แค่เห็นปุ่ม
 */

const PDF = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";

/** นักศึกษายื่นคำร้องแล้วอัปโหลดแบบคำร้องที่ลงนามแล้ว → คำร้องเข้าคิวเจ้าหน้าที่ (`pending_officer_request`) */
async function submitRequestWithPaper(request: APIRequestContext): Promise<number> {
  const companyId = await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1');
  const semesterId = await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
  const created = await request.post(`${API_URL}/intents`, { data: { company_id: companyId, semester_id: semesterId } });
  expect(created.status(), await created.text()).toBe(201);
  const formId = (await dbValue<number>(
    `SELECT form_id FROM intent_forms WHERE student_id = ${STUDENT2} ORDER BY form_id DESC LIMIT 1`
  ))!;
  const upload = await request.post(`${API_URL}/intents/${formId}/request-form`, {
    multipart: { request_form: { name: 'signed.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF) } },
  });
  expect(upload.status(), await upload.text()).toBe(200);
  return formId;
}

test.describe('ปุ่มดูเรซูเม่ของฝ่ายตรวจคำร้อง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec(`DELETE FROM intent_forms WHERE student_id = ${STUDENT2}`);
  });

  test('V1: เจ้าหน้าที่กดดูเรซูเม่ในแผงตรวจคำร้อง → เปิดไฟล์จริงของนักศึกษา', async ({ page, request }) => {
    await apiLoginAs(request, 'student2');
    const up = await request.put(`${API_URL}/profile/student`, {
      multipart: { resume: { name: 'my-resume.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF) } },
    });
    expect(up.status(), await up.text()).toBe(200);
    const formId = await submitRequestWithPaper(request);

    await loginAs(page, 'staff1');
    await page.getByTestId(`review-request-${formId}`).click();
    const button = page.getByTestId('request-resume');
    await expect(button).toBeVisible();
    await button.click();

    // ตัวอ่านเปิดไฟล์จริง (ดึงด้วย cookie แล้วแสดงจาก blob) — ไม่ใช่ข้อความ "เปิดไฟล์ไม่สำเร็จ"
    const viewer = page.getByRole('dialog').filter({ has: page.locator('iframe[title="เรซูเม่ของนักศึกษา"]') });
    await expect(viewer).toBeVisible();
    await expect(page.getByText('เปิดไฟล์ไม่สำเร็จ')).toHaveCount(0);
  });

  test('V2: หัวหน้าสาขากดดูเรซูเม่ในกล่องตรวจทานคำร้อง (จากปุ่ม "ดูคำร้อง") → เปิดไฟล์จริง', async ({ page, request }) => {
    await apiLoginAs(request, 'student2');
    const up = await request.put(`${API_URL}/profile/student`, {
      multipart: { resume: { name: 'my-resume.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF) } },
    });
    expect(up.status(), await up.text()).toBe(200);
    await submitRequestWithPaper(request);
    const studentId = (await dbValue<number>(`SELECT ${STUDENT2} AS id`))!;

    await loginAs(page, 'head1');
    const row = await statusBoardRow(page, studentId);
    await row.getByRole('button', { name: 'ดูคำร้อง' }).click();

    const button = page.getByTestId('intent-resume');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator('iframe[title="เรซูเม่ของนักศึกษา"]')).toBeVisible();
    await expect(page.getByText('เปิดไฟล์ไม่สำเร็จ')).toHaveCount(0);
  });

  test('V3: นักศึกษายังไม่มีเรซูเม่ในฐาน (ข้อมูลเก่า) → ไม่มีปุ่ม ขึ้นข้อความบอก ไม่ใช่ลิงก์เสีย', async ({ page, request }) => {
    await apiLoginAs(request, 'student2');
    const formId = await submitRequestWithPaper(request);
    // ใบที่ยื่นไปก่อนมีกฎบังคับเรซูเม่ — จำลองด้วยการล้างค่าหลังยื่น
    await dbExec(`UPDATE students SET resume_file = NULL WHERE student_id = ${STUDENT2}`);

    await loginAs(page, 'staff1');
    await page.getByTestId(`review-request-${formId}`).click();
    await expect(page.getByTestId('request-resume-missing')).toHaveText('นักศึกษายังไม่ได้อัปโหลดเรซูเม่');
    await expect(page.getByTestId('request-resume')).toHaveCount(0);
  });
});
