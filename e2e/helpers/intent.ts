import fs from 'fs';
import path from 'path';
import { expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { API_URL } from './env';
import { apiLoginAs, type AccountKey } from './auth';
import { dbExec, dbValue } from './db';

/**
 * นักศึกษายื่นคำร้องขอหนังสือ (เอกสารหมายเลข 1) ถึงบริษัท **ที่อยู่ในทำเนียบของคณะ**
 * ผ่านหน้า "ยื่นคำร้องขอหนังสือ": พิมพ์ชื่อ → เลือกจากรายการทำเนียบ → ยื่น → ยืนยัน
 *
 * ต้องอยู่ที่เมนู `jobs` ก่อนเรียก · ค่าเริ่มต้นคือบริษัทของ seed (รับรองแล้ว)
 * · ข้อความสำเร็จยังต้อง assert ในเทสต์เอง
 * ⚠️ ใช้ไม่ได้กับช่วงผ่อนผัน (ส่งช้า) — ช่วงนั้นฟอร์มบังคับกรอกเหตุผลก่อนยื่น
 * (มาแทน `applyToFirstOpenJob` — บอร์ดประกาศงานถูกตัด 2026-10-05)
 */
export async function submitRequestToDirectoryCompany(page: Page, search = 'ซีเกท'): Promise<void> {
  await page.getByTestId('request-company-search').fill(search);
  await page.getByTestId('request-directory-matches').getByRole('button').first().click();
  await expect(page.getByTestId('request-company-locked')).toBeVisible();
  await page.getByTestId('request-submit').click();
  await page.getByTestId('request-confirm').click();
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
 * เจ้าหน้าที่กดรับคำร้องผ่าน API (ต้องล็อกอินเป็นเจ้าหน้าที่ก่อนเรียก)
 *
 * `officer-approve` บังคับให้ส่ง `request_form_path` ของไฟล์ที่ "หน้าจอกำลังแสดง" แล้วเทียบกับค่าในแถว
 * (ไม่ตรง = 409) — helper นี้ส่งค่าปัจจุบันในฐานให้ = จำลองเจ้าหน้าที่ที่เปิดดูไฟล์ล่าสุดแล้ว
 * · ใบที่ยังไม่มีไฟล์ส่งค่าหลอกไป เพื่อให้ถึงด่านของโมเดล (สถานะ/ไม่มีไฟล์) ไม่ตกที่ด่านรูปแบบคำขอ
 * · เทสต์ที่ตั้งใจส่ง path เก่า ใส่ `request_form_path` ใน `data` เอง (ค่าใน `data` ชนะ)
 */
export async function officerApprove(
  request: APIRequestContext,
  formId: number,
  data: Record<string, unknown>
) {
  const shown = await dbValue<string | null>(
    'SELECT request_form_path FROM intent_forms WHERE form_id = $1',
    [formId]
  );
  return request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
    data: { request_form_path: shown ?? 'request_forms/not-uploaded.pdf', ...data },
  });
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
  const approved = await officerApprove(request, formId, { document_no: documentNo });
  expect(approved.status(), await approved.text()).toBe(200);

  expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
    'approved_by_dept_head'
  );
}

/** doc_id ของหนังสือขอความอนุเคราะห์ล่าสุดในฐาน */
export async function coverLetterDocId(): Promise<number> {
  return (await dbValue<number>(
    "SELECT doc_id FROM official_documents WHERE type = 'cover_letter' ORDER BY doc_id DESC LIMIT 1"
  )) as number;
}

/** คณบดีลงนามเอกสารหนึ่งฉบับผ่าน `batch-sign` (ลายเซ็นจริงจาก seed) */
export async function deanSign(request: APIRequestContext, docId: number): Promise<void> {
  await apiLoginAs(request, 'dean1');
  const signed = await request.post(`${API_URL}/documents/batch-sign`, {
    data: { doc_ids: [docId] },
  });
  expect(signed.status(), await signed.text()).toBe(200);
  expect((await signed.json()).signed_count).toBe(1);
}

/**
 * เดินให้ถึงจุดที่คณบดีลงนามหนังสือขอความอนุเคราะห์แล้ว (สถานะใบ = approved_by_dept_head
 * และ `acceptance_due_date` ถูกปั๊ม) — จุดที่นักศึกษาส่งหนังสือให้บริษัทได้
 */
export async function walkToSigned(request: APIRequestContext, formId: number): Promise<void> {
  await approveIntentThroughOfficer(request, formId);
  await deanSign(request, await coverLetterDocId());
}

/** พี่เลี้ยงตัวอย่างที่นักศึกษาระบุ — ข้อมูลปลอมทั้งหมด */
export const SAMPLE_MENTOR = {
  name: 'สุรเดช ใจดี',
  email: 'mentor-sample@example.com',
  phone: '0812223333',
  position: 'Supervisor',
  department: 'QA',
};

/**
 * ยืนยันพี่เลี้ยง (ต้องล็อกอินก่อนเรียก) — คืน response ให้เทสต์ตัดสินเอง
 * ⛔ ผ่านเฉพาะอาจารย์นิเทศ (`supervisor_id`) ของนักศึกษาที่ระบุพี่เลี้ยงคนนี้ — seed ตั้ง advisor1 เป็นของ student2
 *    เจ้าหน้าที่ยืนยันไม่ได้แล้ว (403)
 */
export function confirmMentor(request: APIRequestContext, mentorId: number) {
  return request.post(`${API_URL}/mentor-followup/${mentorId}/confirm`);
}

/**
 * ตั้งวันเริ่มปฏิบัติงานในปฏิทินสหกิจของภาคที่เปิดอยู่ (กิจกรรม `coop_start` · ชนิด single)
 *
 * การตอบรับไม่รับวันเริ่มจากผู้ตอบแล้ว — ใบได้ `start_date` จากแถวนี้ตอนแบบตอบรับถูกส่ง (ไม่มีแถว = NULL)
 * เทสต์ที่ต้องการวันเริ่มเฉพาะต้องเรียกตัวนี้ **ก่อน** ขั้นตอบรับ หรือให้เจ้าหน้าที่กรอกตอนออกหนังสือส่งตัว
 */
export async function setCoopStart(date: string): Promise<void> {
  await dbExec(
    `DELETE FROM coop_calendar_events
      WHERE activity_key = 'coop_start'
        AND semester_id = (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1)`
  );
  await dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date)
     SELECT semester_id, 'coop_start', 'single', $1, $1 FROM coop_semesters WHERE is_active = TRUE LIMIT 1`,
    [date]
  );
}

/**
 * ทำให้นักศึกษา "ส่งเอกสารก่อนออกฝึกครบ" — สหกิจ 03 ครบช่องบังคับ และมีแถวสหกิจ 06 (แจ้งที่พัก)
 * ซึ่งเป็นด่านของ `POST /intents/:id/dispatch-letter` ตั้งแต่ขั้น 6 (ไม่ครบ = 409 `prep_incomplete`)
 *
 * เขียนฐานตรง ๆ เพราะเทสต์ที่เรียกใช้ต้องการแค่ *ผ่านด่าน* เพื่อไปตรวจเรื่องอื่น — เส้นทางกรอกจริงของนักศึกษา
 * และตัวด่านเองคุมที่ `documents/dispatch-prep-gate`
 * ⚠️ เลขบัตรที่ใส่เป็นค่าหลอก (ไม่ใช่ ciphertext จริง) — พอสำหรับด่านที่ดูแค่ "มีค่า" แต่พิมพ์สหกิจ 03 แล้วช่องนั้นจะว่าง
 *    เทสต์ที่ตรวจการเข้ารหัส/การพิมพ์ต้องกรอกผ่าน `PUT /students/coop-application` เอง
 */
export async function completeDispatchPrep(studentEmail = 'student2@test.com'): Promise<void> {
  await dbExec(
    `UPDATE students
        SET first_name_en = 'Somsri', last_name_en = 'Tester', gender = 'หญิง', nationality = 'ไทย',
            mobile_phone = '0811111111',
            national_id_ciphertext = 'e2e-placeholder', national_id_iv = 'e2e', national_id_tag = 'e2e',
            national_id_issued_district = 'เมืองชลบุรี', national_id_expiry_date = '2031-01-01',
            emergency_contact_name = 'ผู้ปกครอง ทดสอบ', emergency_relationship = 'มารดา',
            emergency_phone = '0822222222'
      WHERE student_id = (SELECT user_id FROM users WHERE email = $1)`,
    [studentEmail]
  );
  await dbExec(
    `INSERT INTO accommodations (student_id, house_no, subdistrict, district, province, postal_code)
     SELECT user_id, '99/1', 'บางพระ', 'ศรีราชา', 'ชลบุรี', '20110' FROM users WHERE email = $1
     ON CONFLICT (student_id) DO NOTHING`,
    [studentEmail]
  );
}
