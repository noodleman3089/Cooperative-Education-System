import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { completeDispatchPrep } from '../helpers/intent';

/**
 * ขั้น 6 ข้อ ค — นักศึกษาส่งสหกิจ 03 · 06 ก่อน คณะจึงออกหนังสือส่งตัวได้ (คู่มือคณะ PDF 14)
 *
 * ด่านเดียว อยู่ที่ `POST /intents/:id/dispatch-letter` · สิ่งที่พังเงียบได้:
 *   G1  ด่านหาย — ออกหนังสือได้ทั้งที่ยังไม่มี 06 หรือ 03 ยังไม่ครบ
 *   G2  ข้อมูลรั่ว — เจ้าหน้าที่ได้แค่ "มี 06 ไหม" กับ **จำนวน** ช่องที่ขาด · บทบาทอื่นไม่ได้อะไรเลย (SEC-12)
 *   G3  ทางตัน — ปฏิทิน `accommodation_plan` ปิดแล้วนักศึกษาส่ง 06 ไม่ได้ ต้องมีทางออก (เจ้าหน้าที่ขยายช่วง)
 *   G4  บังคับเกิน — เชื้อชาติ ศาสนา และตารางประวัติ ต้องไม่ถูกนับเป็นช่องบังคับ (PDPA ม.26)
 */

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const DISPATCH = { document_no: 'อว 0656.10/ด่าน-1', end_date: '2027-02-19' };

const ADDRESS = {
  house_no: '199/8',
  subdistrict: 'บางพระ',
  district: 'ศรีราชา',
  province: 'ชลบุรี',
  postal_code: '20110',
};

/** ช่องบังคับของสหกิจ 03 ครบชุด — ไม่มีเชื้อชาติ ศาสนา และไม่มีตารางประวัติ */
const COOP03_REQUIRED = {
  first_name_en: 'Somsri',
  last_name_en: 'Tester',
  gender: 'หญิง',
  nationality: 'ไทย',
  mobile_phone: '0891234567',
  national_id: '1103700000017',
  national_id_issued_district: 'เมืองชลบุรี',
  national_id_expiry_date: '2031-01-01',
  emergency_contact_name: 'นางสมศรี ใจดี',
  emergency_relationship: 'มารดา',
  emergency_phone: '0898765432',
};

/** ใบที่เจ้าหน้าที่รับแบบตอบรับแล้ว — จุดที่หนังสือส่งตัวออกได้ถ้าเอกสารก่อนออกฝึกครบ */
async function seedAcceptedIntent(): Promise<{ formId: number; studentId: number }> {
  const row = await dbRow<{ form_id: number; student_id: number }>(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
     VALUES (${STUDENT2}, (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
             (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'accepted', '2026-11-02')
     RETURNING form_id, student_id`
  );
  return { formId: row!.form_id, studentId: row!.student_id };
}

const issue = (request: APIRequestContext, formId: number) =>
  request.post(`${API_URL}/intents/${formId}/dispatch-letter`, { data: DISPATCH });

const submitAccommodation = (request: APIRequestContext, studentId: number) =>
  request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
    data: { accommodation: ADDRESS, weekly_plans: [] },
  });

const saveCoop03 = (request: APIRequestContext, data: Record<string, unknown>) =>
  request.put(`${API_URL}/students/coop-application`, { data });

const missingRequired = async (request: APIRequestContext): Promise<string[]> =>
  (await (await request.get(`${API_URL}/students/coop-application`)).json()).missing_required as string[];

const sendLetterCount = () =>
  dbValue<number>("SELECT COUNT(*)::int FROM official_documents WHERE type = 'send_letter'");

type QueueRow = { form_id: number; accommodation_submitted?: boolean; coop03_missing_count?: number };
const queueRow = async (request: APIRequestContext, formId: number): Promise<QueueRow> =>
  ((await (await request.get(`${API_URL}/intents?status=accepted`)).json()) as QueueRow[]).find(
    (r) => r.form_id === formId
  )!;

test.describe('ขั้น 6 — ส่งสหกิจ 03 · 06 ก่อน จึงออกหนังสือส่งตัวได้', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('G1: ไม่มี 06 = 409 · มี 06 แต่ 03 ขาด = 409 · ครบ = 200 — ถูกปฏิเสธแล้วไม่มีเลขและไม่มีหนังสือเกิดขึ้น', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const { formId, studentId } = await seedAcceptedIntent();

    // ── ยังไม่ทำอะไรเลย ──
    await apiLoginAs(request, 'staff1');
    const none = await issue(request, formId);
    expect(none.status(), await none.text()).toBe(409);
    const noneBody = await none.json();
    expect(noneBody.code).toBe('prep_incomplete');
    expect(noneBody.message).toContain('สหกิจ 06');
    expect(noneBody.message).toContain('สหกิจ 03');

    // ── ส่ง 06 แล้ว แต่ 03 ยังไม่ครบ ──
    await apiLoginAs(request, 'student2');
    const acc = await submitAccommodation(request, studentId);
    expect(acc.status(), await acc.text()).toBe(200);

    await apiLoginAs(request, 'staff1');
    const half = await issue(request, formId);
    expect(half.status(), await half.text()).toBe(409);
    const halfBody = await half.json();
    expect(halfBody.code).toBe('prep_incomplete');
    expect(halfBody.message).toContain('สหกิจ 03');
    expect(halfBody.message, 'ส่ง 06 แล้วต้องไม่ถูกบอกว่ายังขาด').not.toContain('สหกิจ 06');

    // ถูกปฏิเสธ = ใบไม่ถูกแตะ (เลขค้างจะทำให้ใบหายจากคิวรอออก)
    expect(await sendLetterCount()).toBe(0);
    expect(
      await dbValue<string | null>('SELECT dispatch_document_no FROM intent_forms WHERE form_id = $1', [formId])
    ).toBeNull();

    // ── 03 ครบช่องบังคับ ──
    await apiLoginAs(request, 'student2');
    const saved = await saveCoop03(request, COOP03_REQUIRED);
    expect(saved.status(), await saved.text()).toBe(200);

    await apiLoginAs(request, 'staff1');
    const ok = await issue(request, formId);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await sendLetterCount()).toBe(1);
  });

  test('G2: เจ้าหน้าที่เห็นแค่ "ส่ง 06 หรือยัง" กับจำนวนช่องที่ขาด · อาจารย์ หัวหน้าสาขา คณบดี ไม่ได้ค่านี้', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const { formId, studentId } = await seedAcceptedIntent();

    // จำนวนที่เจ้าหน้าที่เห็น ต้องเท่ากับจำนวนที่นักศึกษาเห็นว่าตัวเองขาด — กติกาชุดเดียวกัน
    await apiLoginAs(request, 'student2');
    const missing = await missingRequired(request);
    expect(missing.length).toBeGreaterThan(0);

    await apiLoginAs(request, 'staff1');
    const before = await queueRow(request, formId);
    expect(before.accommodation_submitted).toBe(false);
    expect(before.coop03_missing_count).toBe(missing.length);
    // ⛔ ส่งแค่จำนวน — ไม่มีชื่อช่อง ไม่มีค่า
    const raw = JSON.stringify(before);
    expect(raw).not.toContain('missing_required');
    expect(raw).not.toContain('national_id');
    expect(raw).not.toContain('emergency_contact_name');

    await apiLoginAs(request, 'student2');
    expect((await submitAccommodation(request, studentId)).status()).toBe(200);
    expect((await saveCoop03(request, COOP03_REQUIRED)).status()).toBe(200);

    await apiLoginAs(request, 'staff1');
    const after = await queueRow(request, formId);
    expect(after.accommodation_submitted).toBe(true);
    expect(after.coop03_missing_count).toBe(0);
    expect(JSON.stringify(after), 'ค่าที่นักศึกษากรอกต้องไม่มาถึงเจ้าหน้าที่').not.toContain(
      COOP03_REQUIRED.emergency_contact_name
    );

    for (const account of ['advisor1', 'head1', 'dean1'] as const) {
      await apiLoginAs(request, account);
      const res = await request.get(`${API_URL}/intents?status=accepted`);
      expect(res.status(), account).toBe(200);
      const body = await res.text();
      expect(body, `${account} ต้องไม่ได้ coop03_missing_count`).not.toContain('coop03_missing_count');
      expect(body, `${account} ต้องไม่ได้ accommodation_submitted`).not.toContain('accommodation_submitted');
    }
  });

  test('G3: ปฏิทินส่งสหกิจ 06 ปิดแล้ว → นักศึกษาส่งไม่ได้ → เจ้าหน้าที่ขยายช่วง → ส่งได้ → ออกหนังสือได้', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const { formId, studentId } = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    expect((await saveCoop03(request, COOP03_REQUIRED)).status()).toBe(200);

    // ช่วงส่งสหกิจ 06 จบไปแล้วเมื่อเดือนก่อน
    await dbExec(
      `INSERT INTO coop_calendar_events (semester_id, activity_key, start_date, end_date, created_by)
       SELECT s.semester_id, 'accommodation_plan',
              (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 60, (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 30, u.user_id
         FROM coop_semesters s CROSS JOIN users u
        WHERE s.is_active = TRUE AND u.email = 'staff1@test.com' LIMIT 1`
    );
    const event = (await dbRow<{ event_id: number; semester_id: number; start_date: string }>(
      `SELECT event_id, semester_id, start_date::text AS start_date
         FROM coop_calendar_events WHERE activity_key = 'accommodation_plan'`
    ))!;

    const closed = await submitAccommodation(request, studentId);
    expect(closed.status(), await closed.text()).toBe(403);

    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status(), 'ยังไม่มี 06 ต้องออกไม่ได้').toBe(409);

    // ทางออก: เจ้าหน้าที่ขยายช่วงในหน้าปฏิทินสหกิจ (ทางเดียวกับที่ใช้จริง — ไม่ใช่แก้ฐาน)
    const today = (await dbValue<string>(`SELECT ((NOW() AT TIME ZONE 'Asia/Bangkok')::date + 14)::text`))!;
    const extended = await request.put(`${API_URL}/calendar/${event.event_id}`, {
      data: {
        semester_id: event.semester_id,
        activity_key: 'accommodation_plan',
        start_date: event.start_date,
        end_date: today,
      },
    });
    expect(extended.status(), await extended.text()).toBe(200);

    await apiLoginAs(request, 'student2');
    const reopened = await submitAccommodation(request, studentId);
    expect(reopened.status(), await reopened.text()).toBe(200);

    await apiLoginAs(request, 'staff1');
    const ok = await issue(request, formId);
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('G4: หน้าสหกิจ 03 ของนักศึกษา — บอกช่องที่ขาดเป็นรายช่อง · เว้นเชื้อชาติ ศาสนา และตารางประวัติก็ครบได้', async ({
    request,
  }) => {
    await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');

    const before = await missingRequired(request);
    // เบอร์โทรมาจากโปรไฟล์อยู่แล้ว — มีเบอร์ใดเบอร์หนึ่งถือว่ากรอกแล้ว
    const hasProfilePhone = Boolean(
      await dbValue<string | null>(`SELECT NULLIF(TRIM(phone), '') FROM students WHERE student_id = ${STUDENT2}`)
    );
    expect(before.includes('phone')).toBe(!hasProfilePhone);
    for (const key of ['first_name_en', 'gender', 'national_id', 'national_id_expiry_date', 'emergency_phone']) {
      expect(before, key).toContain(key);
    }
    // ⛔ ข้อมูลอ่อนไหวพิเศษและตารางประวัติไม่อยู่ในรายการบังคับ
    for (const key of ['ethnicity', 'religion', 'family_info', 'education_history', 'language_proficiency']) {
      expect(before, key).not.toContain(key);
    }

    // กรอกบางส่วน → รายการลดลงเฉพาะช่องที่กรอก
    expect(
      (await saveCoop03(request, { first_name_en: 'Somsri', last_name_en: 'Tester', gender: 'หญิง' })).status()
    ).toBe(200);
    const partial = await missingRequired(request);
    expect(partial).not.toContain('first_name_en');
    expect(partial).toContain('national_id');

    // กรอกครบโดยไม่แตะเชื้อชาติ ศาสนา → ครบ และไม่มีการยินยอมข้อมูลอ่อนไหวเกิดขึ้น
    expect((await saveCoop03(request, COOP03_REQUIRED)).status()).toBe(200);
    expect(await missingRequired(request)).toEqual([]);
    const sensitive = await dbRow<{ ethnicity: string | null; religion: string | null; consent: string | null }>(
      `SELECT ethnicity_ciphertext AS ethnicity, religion_ciphertext AS religion,
              sensitive_data_consented_at::text AS consent
         FROM students WHERE student_id = ${STUDENT2}`
    );
    expect(sensitive).toEqual({ ethnicity: null, religion: null, consent: null });

    // หน้าแรกนักศึกษาอ่านค่าเดียวกัน
    const dashboard = await (await request.get(`${API_URL}/students/dashboard`)).json();
    expect(dashboard.progress.coop03_missing_count).toBe(0);
  });

  test('G5: หน้าแรกนักศึกษา — ทำ 06 แล้วแต่ 03 ยังไม่ครบ ความคืบหน้าต้องยังบอกว่า 03 ขาด', async ({ request }) => {
    const { studentId } = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    expect((await submitAccommodation(request, studentId)).status()).toBe(200);

    const progress = (await (await request.get(`${API_URL}/students/dashboard`)).json()).progress as {
      accommodation_submitted: boolean;
      coop03_missing_count: number;
    };
    expect(progress.accommodation_submitted).toBe(true);
    expect(progress.coop03_missing_count).toBeGreaterThan(0);
  });

  test('G6: หน้าจอเจ้าหน้าที่ — ใบที่ยังไม่พร้อมขึ้นป้ายรอนักศึกษา กล่องเตือนและกดออกไม่ได้ · ข้อมูลเปลี่ยนระหว่างเปิดกล่อง = 409 แสดงในกล่อง', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { formId, studentId } = await seedAcceptedIntent();

    await loginAs(page, 'staff1');
    const badge = page.getByTestId(`dispatch-prep-${formId}`);
    await expect(badge).toContainText('รอนักศึกษา');
    await expect(badge).toContainText('ยังไม่ส่งสหกิจ 06');
    await expect(badge).toContainText(/สหกิจ 03 ขาด \d+ ช่อง/);

    // เปิดกล่องได้ (ดูข้อมูลได้) แต่กดออกไม่ได้ ถึงจะกรอกครบ
    await page.getByTestId(`issue-dispatch-${formId}`).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('dispatch-document-no') });
    await expect(dialog.getByTestId('dispatch-prep-warning')).toContainText('ยังออกหนังสือส่งตัวไม่ได้');
    await dialog.getByTestId('dispatch-document-no').fill(DISPATCH.document_no);
    await expect(dialog.getByTestId('dispatch-end-date')).not.toHaveValue('');
    await expect(dialog.getByTestId('dispatch-submit')).toBeDisabled();
    // ⛔ เจ้าหน้าที่เห็นแค่จำนวน — ชื่อช่องของสหกิจ 03 ต้องไม่ขึ้นบนหน้าจอนี้
    await expect(page.locator('body')).not.toContainText('เลขประจำตัวประชาชน');

    // นักศึกษาส่งครบ → ป้ายหาย กล่องไม่เตือน
    // (ปิดกล่องก่อนรีโหลด — กล่องมี URL ของตัวเอง รีโหลดทั้งที่เปิดอยู่จะเปิดกลับมาเองและบังปุ่มในคิว)
    await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(dialog).toHaveCount(0);
    await completeDispatchPrep();
    await page.reload();
    await expect(page.getByTestId(`issue-dispatch-${formId}`)).toBeVisible();
    await expect(page.getByTestId(`dispatch-prep-${formId}`)).toHaveCount(0);
    await page.getByTestId(`issue-dispatch-${formId}`).click();
    await expect(dialog.getByTestId('dispatch-prep-warning')).toHaveCount(0);
    // ⚠️ เปิดกล่องแล้วคิวโหลดซ้ำหนึ่งรอบ (URL ได้ `?form=`) พอโหลดจบช่องเลขที่หนังสือถูกล้าง — พิมพ์เร็วกว่านั้นค่าหาย
    //    (ของเดิมก่อนขั้น 6 · เคยทำเคสนี้ flaky ในชุดเต็ม) จึงกรอกซ้ำจนค่าอยู่ ไม่ใช่กรอกครั้งเดียวแล้วหวังว่าทัน
    await expect(async () => {
      await dialog.getByTestId('dispatch-document-no').fill(DISPATCH.document_no);
      await expect(dialog.getByTestId('dispatch-submit')).toBeEnabled({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });

    // หน้าจอค้างข้อมูลเก่า (06 หายไประหว่างเปิดกล่อง) — ด่านจริงอยู่ที่เซิร์ฟเวอร์ และคำตอบต้องขึ้น **ใน** กล่อง
    await dbExec('DELETE FROM accommodations WHERE student_id = $1', [studentId]);
    await dialog.getByTestId('dispatch-submit').click();
    await page.getByRole('button', { name: 'ออกเลขและส่งเข้าคิวคณบดี' }).click();
    await expect(dialog.getByRole('alert')).toContainText('สหกิจ 06');
    expect(await sendLetterCount()).toBe(0);
    expect(
      await dbValue<string | null>('SELECT dispatch_document_no FROM intent_forms WHERE form_id = $1', [formId])
    ).toBeNull();
  });

  test('G7: หน้าสหกิจ 03 — กล่องสรุปบอกช่องที่ขาดเป็นชื่อไทย กรอกครบแล้วเป็น "ครบแล้ว" โดยไม่ต้องกรอกเชื้อชาติ ศาสนา · ข้อความบอกว่าส่งคณะ', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await seedAcceptedIntent();
    await loginAs(page, 'student2');
    await goToMenu(page, 'job_application');

    const summary = page.getByTestId('ca-required-summary');
    await expect(summary).toContainText(/ยังขาด \d+ ช่อง/);
    await expect(summary).toContainText('เลขประจำตัวประชาชน');
    await expect(summary).toContainText('ชื่อผู้ติดต่อฉุกเฉิน');
    await expect(summary).not.toContainText('เชื้อชาติ');
    await expect(summary).not.toContainText('ศาสนา');
    // ชื่อช่องต้องเป็นภาษาไทยทุกตัว ไม่มีคีย์ดิบหลุดออกมา
    await expect(summary).not.toContainText(/[a-z]+_[a-z]+/);

    // ใบนี้ส่งคณะ ไม่ใช่สถานประกอบการ — และสถานประกอบการไม่มีบัญชีในระบบ
    const body = page.locator('body');
    await expect(body).toContainText('ส่งคณะ');
    await expect(body).not.toContainText('สถานประกอบการที่มีบัญชีในระบบ');
    await expect(body).not.toContainText('ไม่มีก็ส่งใบสมัครได้');

    await page.getByTestId('ca-first-en').fill(COOP03_REQUIRED.first_name_en);
    await page.getByTestId('ca-last-en').fill(COOP03_REQUIRED.last_name_en);
    await page.getByTestId('ca-gender').selectOption(COOP03_REQUIRED.gender);
    await page.getByTestId('ca-nationality').fill(COOP03_REQUIRED.nationality);
    await page.getByTestId('ca-mobile').fill(COOP03_REQUIRED.mobile_phone);
    await page.getByTestId('ca-emg-name').fill(COOP03_REQUIRED.emergency_contact_name);
    await page.getByTestId('ca-emg-relation').fill(COOP03_REQUIRED.emergency_relationship);
    await page.getByTestId('ca-emg-phone').fill(COOP03_REQUIRED.emergency_phone);
    await page.getByTestId('ca-national-id').fill(COOP03_REQUIRED.national_id);
    await page.getByTestId('ca-id-district').fill(COOP03_REQUIRED.national_id_issued_district);
    await page.getByTestId('ca-id-expiry').fill(COOP03_REQUIRED.national_id_expiry_date);
    await page.getByTestId('ca-submit').click();

    await expect(summary).toHaveText('ช่องบังคับครบแล้ว');
    // ไม่ได้แตะเชื้อชาติ ศาสนา = ไม่มีการยินยอมข้อมูลอ่อนไหวเกิดขึ้น
    expect(
      await dbValue<string | null>(
        `SELECT sensitive_data_consented_at::text FROM students WHERE student_id = ${STUDENT2}`
      )
    ).toBeNull();
  });
});
