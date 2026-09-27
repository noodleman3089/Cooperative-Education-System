import fs from 'fs';
import path from 'path';
import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { API_URL } from './env';
import { apiLoginAs, type AccountKey } from './auth';
import { dbValue } from './db';

/**
 * นักศึกษากดสมัครตำแหน่งแรกที่ยังเปิดอยู่บนกระดานงาน แล้วกดยืนยันในกล่อง
 * "ยืนยันเลือกสถานประกอบการ"
 *
 * ตั้งแต่รีเมคหน้าหาที่ฝึกงาน (`7a105bf`) ปุ่มสมัครไม่ยื่นทันที — เปิด `ConfirmDialog`
 * ที่บอกชื่อบริษัทและตำแหน่งก่อน · ข้อความสำเร็จยังต้อง assert ในเทสต์เอง
 * ⚠️ ใช้ไม่ได้กับช่วงผ่อนผัน (ส่งช้า) — ช่วงนั้นเปิดกล่องให้กรอกเหตุผลแทน
 */
export async function applyToFirstOpenJob(page: Page): Promise<void> {
  await page.locator('[data-testid="apply-job"]:enabled').first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันเลือกสถานประกอบการ' });
  await dialog.getByRole('button', { name: 'เลือกที่นี่' }).click();
}

/**
 * การ์ด "ที่ฝึกงานของคุณ" บนหน้าแรกนักศึกษา — ป้ายสถานะใบความจำนงตัวจริงอยู่ที่นี่
 *
 * ⚠️ อย่า assert ป้ายสถานะด้วย `text=` ทั้งหน้า: ข้อความเดียวกันซ้ำอยู่ใน tooltip ของเมนูที่ล็อก
 * (Sidebar) และในเส้นทางสหกิจ → strict mode violation หรือไปจับตัวที่ซ่อนอยู่
 */
export function placementCard(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'ที่ฝึกงานของคุณ' }) });
}

/**
 * พาใบความจำนงจาก `pending_advisor` ไปถึง `approved_by_dept_head` ตามเส้นทางจริง
 *
 * ตั้งแต่ 2026-08-26 ลายเซ็นของอาจารย์ที่ปรึกษาและหัวหน้าสาขาอยู่บน **กระดาษ**
 * (แบบคำร้องเอกสารหมายเลข 1) หน้าจอสองบทบาทนั้นจึงไม่มีปุ่มอนุมัติอีกแล้ว
 * เทสต์ที่เคยกดปุ่มเหล่านั้นเพื่อ *ไปให้ถึงขั้นถัดไป* ต้องเดินทางนี้แทน:
 *
 *   นักศึกษาอัปโหลดกระดาษที่ลงนามแล้ว → เจ้าหน้าที่กดผ่าน + ออกเลขที่หนังสือ
 *
 * ⚠️ ใช้กับเทสต์ที่ *อาศัย* สถานะปลายทางเท่านั้น — เทสต์ที่ตั้งใจตรวจตัวเส้นทางเอง
 * ให้เขียนขั้นตอนเองเพื่อให้เห็นว่ากำลังตรวจอะไร (`document-01-request.spec.ts`)
 *
 * ผลข้างเคียงที่ตั้งใจ: สถานประกอบการของใบนี้จะถูกรับรอง (`is_verified = TRUE`)
 * เพราะเจ้าหน้าที่ตรวจกระดาษกับข้อมูลบริษัทในการกดครั้งเดียวกัน (SEC-04)
 */
export async function approveIntentThroughOfficer(
  request: APIRequestContext,
  formId: number,
  options: { studentAccount?: AccountKey; documentNo?: string } = {}
): Promise<void> {
  const studentAccount = options.studentAccount ?? 'student2';
  const documentNo = options.documentNo ?? `อว 0656.10/${formId}`;

  await apiLoginAs(request, studentAccount);
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

  await apiLoginAs(request, 'staff1');
  const approved = await request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
    data: {
      document_no: documentNo,
    },
  });
  expect(approved.status(), await approved.text()).toBe(200);

  expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
    'approved_by_dept_head'
  );
}
