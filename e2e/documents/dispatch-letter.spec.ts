import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { withDb, dbRow, dbRows, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { approveIntentThroughOfficer, completeDispatchPrep, deanSign } from '../helpers/intent';

/**
 * หนังสือส่งตัวนักศึกษาเข้าปฏิบัติงานสหกิจศึกษา — ข้อ ๙ ของ ๑๓ ขั้นตอนในคู่มือ
 *
 * ปิดหนี้ขอบเขตภาคนิพนธ์ 3 ข้อที่หลุดตั้งแต่รอบ 47 (ของเดิมถูกลบพร้อมแม่แบบ HTML):
 *   1. เจ้าหน้าที่บันทึกผลตอบรับ **เพื่อให้ระบบนำไปจัดทำหนังสือส่งตัว**
 *   2. เจ้าหน้าที่สั่งสร้างหนังสือส่งตัวเพื่อส่งให้คณบดีลงนาม
 *   3. คณบดีลงนามหนังสือส่งตัวแบบ batch
 *
 * สิ่งที่ชุดนี้คุม:
 *   - **ลำดับ** — ยังไม่ `accepted` ออกไม่ได้ (409) · ออกซ้ำไม่ได้ (409)
 *   - **สิทธิ์** — นักศึกษา/บริษัทยิง endpoint ตรงๆ ไม่ได้ (403) ตาม SEC-06
 *   - **ช่วงเวลาที่พิมพ์ลงหนังสือต้องเป็นไปได้** — วันจบก่อนวันเริ่ม = 400
 *   - **คณบดีเซ็นแล้วต้องได้หนังสือส่งตัว ไม่ใช่หนังสือขอความอนุเคราะห์** — ตัววาด
 *     เคยถูกเรียกตายตัวเป็นตัวขอความอนุเคราะห์ ถ้าพลาดจะได้ไฟล์ที่เนื้อหาผิดทั้งใบ
 *     โดยสถานะขึ้นว่า signed
 *   - **เลขที่หนังสือส่งตัวไปโผล่บนเอกสารหมายเลข ๒** (ช่องส่วนของเจ้าหน้าที่)
 */

const MENTOR = {
  name: 'สุรเดช ใจดี',
  email: 'suradech-dispatch@seagate.com',
  phone: '0812223333',
  start_date: '2026-11-02',
};

const evidence = () => ({
  name: 'acceptance.pdf',
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
});

async function seedIntent(): Promise<number> {
  return withDb(async (db) => {
    const studentId = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      .company_id;

    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'pending_advisor', $4) RETURNING form_id`,
      [studentId, companyId, semesterId, MENTOR.start_date]
    );
    return res.rows[0].form_id as number;
  });
}

/** เดินเส้นทางจริงจนใบอยู่สถานะ `accepted` — คือจุดที่หนังสือส่งตัวออกได้ */
async function walkToAccepted(request: APIRequestContext, formId: number): Promise<void> {
  await approveIntentThroughOfficer(request, formId);

  const coverDocId = await dbValue<number>(
    "SELECT doc_id FROM official_documents WHERE type = 'cover_letter' ORDER BY doc_id DESC LIMIT 1"
  );
  await apiLoginAs(request, 'dean1');
  const signed = await request.post(`${API_URL}/documents/batch-sign`, {
    data: { doc_ids: [coverDocId] },
  });
  expect(signed.status(), await signed.text()).toBe(200);

  const today = (await dbValue<string>(
    `SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`
  )) as string;

  // ผู้ลงนามบนแบบตอบรับ นักศึกษากรอกตอนอัปโหลด (2026-09-21) — ชื่อนี้คือที่ถูกพิมพ์ลงหนังสือส่งตัว
  await apiLoginAs(request, 'student2');
  const upload = await request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
    multipart: {
      evidence: evidence(),
      ...MENTOR,
      signer_name: 'คุณสมชาย ทรงชัย',
      signer_position: 'ผู้จัดการฝ่ายบุคคล',
      signed_date: today,
    },
  });
  expect(upload.status(), await upload.text()).toBe(200);

  await apiLoginAs(request, 'staff1');
  const approved = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
    data: { action: 'accepted' },
  });
  expect(approved.status(), await approved.text()).toBe(200);

  // นักศึกษาส่งสหกิจ 03 · 06 ครบแล้ว — ด่านก่อนออกหนังสือส่งตัว (คุมแยกที่ `documents/dispatch-prep-gate`)
  await completeDispatchPrep();
}

const issue = (
  request: APIRequestContext,
  formId: number,
  data: Record<string, unknown> = { document_no: 'อว 0656.10/ส่งตัว-1', end_date: '2027-02-19' }
) => request.post(`${API_URL}/intents/${formId}/dispatch-letter`, { data });

test.describe('หนังสือส่งตัว — ออก · ลงนาม · เขียนเลขกลับ', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('D1: ยังไม่รับแบบตอบรับ → ออกหนังสือส่งตัวไม่ได้ (409) และไม่มีเอกสารเกิดขึ้น', async ({
    request,
  }) => {
    const formId = await seedIntent();

    await apiLoginAs(request, 'staff1');
    const tooEarly = await issue(request, formId);
    expect(tooEarly.status(), await tooEarly.text()).toBe(409);
    expect((await tooEarly.json()).message as string).toContain('แบบตอบรับ');

    expect(
      await dbValue<string>("SELECT COUNT(*) FROM official_documents WHERE type = 'send_letter'")
    ).toBe('0');
    expect(
      await dbValue<string | null>(
        'SELECT dispatch_document_no FROM intent_forms WHERE form_id = $1',
        [formId]
      )
    ).toBeNull();
  });

  test('D2: กรอกไม่ครบ · วันจบก่อนวันเริ่ม → 400', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    await apiLoginAs(request, 'staff1');

    const bare = await issue(request, formId, {});
    expect(bare.status()).toBe(400);
    expect((await bare.json()).message as string).toContain('เลขที่หนังสือส่งตัว');

    const badFormat = await issue(request, formId, {
      document_no: 'อว 0656.10/1',
      end_date: '19/02/2027',
    });
    expect(badFormat.status()).toBe(400);

    // วันเริ่มคือ 2026-11-02 — วันจบก่อนหน้านั้นเป็นไปไม่ได้
    const backwards = await issue(request, formId, {
      document_no: 'อว 0656.10/1',
      end_date: '2026-10-01',
    });
    expect(backwards.status()).toBe(400);
    expect((await backwards.json()).message as string).toContain('ก่อนวันเริ่มปฏิบัติงาน');

    expect(
      await dbValue<string>("SELECT COUNT(*) FROM official_documents WHERE type = 'send_letter'")
    ).toBe('0');
  });

  test('D3: ออกได้ → เอกสารเข้าคิวคณบดี และเลข+ช่วงเวลาถูกบันทึกบนใบความจำนง', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    await apiLoginAs(request, 'staff1');
    const ok = await issue(request, formId);
    expect(ok.status(), await ok.text()).toBe(200);

    const intent = await dbRow<{ dispatch_document_no: string; end_date: string }>(
      `SELECT dispatch_document_no, end_date::text AS end_date
         FROM intent_forms WHERE form_id = $1`,
      [formId]
    );
    expect(intent?.dispatch_document_no).toBe('อว 0656.10/ส่งตัว-1');
    expect(intent?.end_date).toBe('2027-02-19');

    const doc = await dbRow<{ status: string; document_number: string; path: string }>(
      `SELECT status, document_number, generated_file_path AS path
         FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1`
    );
    expect(doc?.status).toBe('pending_sign');
    expect(doc?.document_number).toBe('อว 0656.10/ส่งตัว-1');
    // ไฟล์ต้องมีอยู่จริงบนดิสก์ ไม่ใช่แค่แถวในฐาน — คณบดีจะเปิดไฟล์นี้ตอนลงนาม
    expect(fs.existsSync(path.join(BACKEND_ROOT, doc!.path))).toBe(true);

    // กดซ้ำต้องไม่ได้เอกสารใบที่สอง — เลขที่หนังสือราชการซ้ำคือปัญหาจริงของงานสารบรรณ
    const again = await issue(request, formId, {
      document_no: 'อว 0656.10/ส่งตัว-2',
      end_date: '2027-02-19',
    });
    expect(again.status(), await again.text()).toBe(409);
    expect(
      await dbValue<string>("SELECT COUNT(*) FROM official_documents WHERE type = 'send_letter'")
    ).toBe('1');
  });

  test('D4: สิทธิ์ — นักศึกษาและพี่เลี้ยงสั่งออกเองไม่ได้ (403)', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    await apiLoginAs(request, 'student2');
    expect((await issue(request, formId)).status()).toBe(403);

    await apiLoginAs(request, 'mentor1');
    expect((await issue(request, formId)).status()).toBe(403);

    expect(
      await dbValue<string>("SELECT COUNT(*) FROM official_documents WHERE type = 'send_letter'")
    ).toBe('0');
  });

  test('D5: คณบดีลงนาม → ได้ไฟล์ใหม่ที่เป็น "หนังสือส่งตัว" ไม่ใช่หนังสือขอความอนุเคราะห์', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);
    // ผู้รับหนังสือ = ผู้ประสานงานของสถานประกอบการ (คนเดียวกับหนังสือขอความอนุเคราะห์) · ชื่อนักศึกษามีคำนำหน้า
    await dbExec(
      `UPDATE companies SET contact_person = 'คุณวิภา ประสานงาน'
        WHERE company_id = (SELECT company_id FROM intent_forms WHERE form_id = $1)`,
      [formId]
    );
    await dbExec(
      `UPDATE students SET name_prefix = 'นางสาว'
        WHERE student_id = (SELECT student_id FROM intent_forms WHERE form_id = $1)`,
      [formId]
    );

    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);

    const before = await dbRow<{ doc_id: number; path: string }>(
      `SELECT doc_id, generated_file_path AS path
         FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1`
    );

    // ── ฉบับร่าง: เนื้อหาตามตัวอย่างในคู่มือคณะ ──
    const who = (await dbRow<{ first_name: string; last_name: string; company: string }>(
      `SELECT s.first_name, s.last_name, c.name_th AS company
         FROM intent_forms i JOIN students s ON s.student_id = i.student_id
         JOIN companies c ON c.company_id = i.company_id WHERE i.form_id = $1`,
      [formId]
    ))!;
    const flat = (s: string) => s.replace(/\s+/g, '');
    const draft = await pdfText(fs.readFileSync(path.join(BACKEND_ROOT, before!.path)));
    expect(draft).toContain('เรื่องขอส่งนักศึกษาเข้าฝึกสหกิจศึกษา');
    expect(draft).toContain(flat(`เรียนคุณวิภา ประสานงาน ${who.company}`));
    expect(draft).toContain(flat(`นางสาว${who.first_name} ${who.last_name}`));
    expect(draft).toContain('โดยเริ่มปฏิบัติงานตั้งแต่วันที่๒พฤศจิกายน๒๕๖๙ถึงวันที่๑๙กุมภาพันธ์๒๕๗๐');
    expect(draft).toContain('จึงใคร่ขอส่งแบบประเมินผลนักศึกษาสหกิจศึกษา');
    // ⛔ ฉบับจริงไม่มีสิ่งเหล่านี้ — ของเดิมที่ระบบร่างเองพิมพ์ครบทุกอย่าง
    for (const gone of ['อ้างถึง', 'สิ่งที่ส่งมาด้วย', 'สัปดาห์', flat(MENTOR.name), flat('คุณสมชาย ทรงชัย'), 'ขอความอนุเคราะห์รับนักศึกษา']) {
      expect(draft, gone).not.toContain(gone);
    }

    await apiLoginAs(request, 'dean1');
    const signed = await request.post(`${API_URL}/documents/batch-sign`, {
      data: { doc_ids: [before!.doc_id] },
    });
    expect(signed.status(), await signed.text()).toBe(200);
    expect((await signed.json()).signed_count).toBe(1);

    const after = await dbRow<{ status: string; path: string; signed_at: string | null }>(
      `SELECT status, generated_file_path AS path, dean_signature_date::text AS signed_at
         FROM official_documents WHERE doc_id = $1`,
      [before!.doc_id]
    );
    expect(after?.status).toBe('signed');
    expect(after?.signed_at).not.toBeNull();
    // ⛔ ฉบับลงนามต้องเป็น **ไฟล์ใหม่** ต้นฉบับยังอยู่ (กดซ้ำแล้วลายเซ็นไม่ซ้อน)
    expect(after?.path).not.toBe(before?.path);
    expect(fs.existsSync(path.join(BACKEND_ROOT, before!.path))).toBe(true);
    // ชื่อไฟล์บอกชนิดหนังสือ — ถ้าตัววาดถูกเรียกผิดตัว จะได้ cover_letter_signed_*
    expect(path.basename(after!.path)).toContain('dispatch_letter_signed');

    // ฉบับลงนาม: ยังเป็นหนังสือส่งตัว และชื่อใต้ลายมือชื่อเป็นของคนที่กดลงนาม
    const signer = (await dbRow<{ first_name: string; last_name: string }>(
      `SELECT first_name, last_name FROM personnel
        WHERE personnel_id = (SELECT user_id FROM users WHERE email = 'dean1@test.com')`
    ))!;
    const signedText = await pdfText(fs.readFileSync(path.join(BACKEND_ROOT, after!.path)));
    expect(signedText).toContain('เรื่องขอส่งนักศึกษาเข้าฝึกสหกิจศึกษา');
    expect(signedText).toContain(flat(`${signer.first_name}${signer.last_name})`));
    expect(signedText).not.toContain('อ้างถึง');

    // นักศึกษาโหลดได้เมื่อลงนามแล้วเท่านั้น (กติกาเดียวกับหนังสือขอความอนุเคราะห์)
    await apiLoginAs(request, 'student2');
    const download = await request.get(`${API_URL}/files/documents/${before!.doc_id}`);
    expect(download.status()).toBe(200);
    expect((await download.body()).subarray(0, 4).toString()).toBe('%PDF');
  });

  test('D6: เลขที่หนังสือส่งตัวถูกเขียนกลับลงเอกสารหมายเลข ๒', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    const acceptanceForm = () =>
      request
        .get(`${API_URL}/intents/${formId}/acceptance-form`)
        .then(async (r) => ({ status: r.status(), size: (await r.body()).length }));

    // ก่อนออกเลข ช่อง "ส่วนของเจ้าหน้าที่" ยังว่าง
    await apiLoginAs(request, 'student2');
    const blank = await acceptanceForm();
    expect(blank.status).toBe(200);

    // ⛔ **PDF ไม่ byte-stable** — `pdf-lib` ฝัง CreationDate ไว้ในสตรีมที่ถูกบีบอัด
    //    เรียกสองครั้งห่างกันหนึ่งวินาทีจึงต่างกันได้ 1-2 ไบต์
    //    เทสต์เดิมเขียนว่า "ต้องเท่ากันเป๊ะ" ซึ่งผิดตั้งแต่ต้น (ผ่านมาได้เพราะบังเอิญ
    //    ที่ timestamp บีบอัดแล้วยาวเท่ากัน) · ตกจริงตอนรันชุดเต็มรอบ 61
    //    → วัด "พื้นคลื่นรบกวน" จากของจริงแทนการเดา
    const noise = Math.abs((await acceptanceForm()).size - blank.size);
    expect(noise).toBeLessThan(50);

    // ⚠️ เลขที่หนังสือยาวได้ไม่เกิน 50 ตัวอักษร (`official_documents.document_number` เป็น VARCHAR(50))
    //    เคยเขียนเทสต์นี้ด้วยเลขยาว 51 ตัวแล้วได้ 400 — ซึ่งทำให้เจอด่านที่หายไปจริง
    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);

    await apiLoginAs(request, 'student2');
    const filled = await acceptanceForm();
    expect(filled.status).toBe(200);
    // ⚠️ **ผลต่างเล็กโดยธรรมชาติ (~14 ไบต์)** — ช่องนี้เติมด้วยเส้นประจนสุดความกว้าง
    // ใส่เลขยาวขึ้น = จำนวนจุดลดลง ขนาดรวมจึงไม่โตขึ้นมาก
    // สิ่งที่เทสต์นี้พิสูจน์คือ **มีการเปลี่ยนแปลงจริง ไม่ใช่ขนาดที่ต่างเท่าไหร่**
    // ถ้าใครถอดการส่ง `dispatch_document_no` ออก เดลต้าจะเป็น 0 แล้วเทสต์แดง
    expect(Math.abs(filled.size - blank.size)).toBeGreaterThan(noise + 5);
  });

  test('D7: หน้าจอเจ้าหน้าที่ — คิวรอออกหนังสือส่งตัวมีจริง และออกได้จากหน้าจอ', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);
    await dbExec(
      `UPDATE companies SET contact_person = 'คุณวิภา ประสานงาน'
        WHERE company_id = (SELECT company_id FROM intent_forms WHERE form_id = $1)`,
      [formId]
    );

    await loginAs(page, 'staff1');
    // หน้าแรกแบบ B: กองเดียวที่มีงานคือหนังสือส่งตัว → รายการเริ่มที่กองนั้นเอง
    await expect(page.getByTestId('staff-queue-dispatch')).toContainText('หนังสือส่งตัวรอออก · 1 คน');
    // เอกสารก่อนออกฝึกครบแล้ว = ไม่มีป้ายรอนักศึกษา
    await expect(page.getByTestId(`dispatch-prep-${formId}`)).toHaveCount(0);

    await page.getByTestId(`issue-dispatch-${formId}`).click();
    const dialog = page.getByRole('dialog');
    // ผู้รับที่กล่องแสดง = ผู้รับที่หนังสือพิมพ์จริง: ผู้ประสานงานของสถานประกอบการ (คนเดียวกับหนังสือขอความอนุเคราะห์)
    // ⛔ ไม่ใช่ผู้ลงนามแบบตอบรับ — ฉบับจริงไม่ได้เรียนถึงคนนั้น (D5 ตรวจฝั่ง PDF)
    await expect(dialog.getByTestId('dispatch-recipient')).toContainText('คุณวิภา ประสานงาน');
    await expect(dialog.getByTestId('dispatch-recipient')).not.toContainText('คุณสมชาย ทรงชัย');
    await expect(dialog).not.toContainText('ผู้ลงนามในแบบตอบรับ');
    await expect(dialog.getByTestId('dispatch-prep-warning')).toHaveCount(0);

    // ระบบเติมวันจบไว้ให้ = วันเริ่ม + ๑๖ สัปดาห์ นับรวมวันแรก (2026-11-02 → 2027-02-21)
    await expect(dialog.getByTestId('dispatch-end-date')).toHaveValue('2027-02-21');

    // ยังไม่กรอกเลขที่หนังสือ = กดไม่ได้ (ด่านหน้าจอคู่กับด่าน API ใน D2)
    await expect(dialog.getByTestId('dispatch-submit')).toBeDisabled();

    await dialog.getByTestId('dispatch-document-no').fill('อว 0656.10/หน้าจอ');
    await dialog.getByTestId('dispatch-submit').click();
    await page.getByRole('button', { name: 'ออกเลขและส่งเข้าคิวคณบดี' }).click();

    // ⚠️ **ห้ามยืนยันด้วย `/ออกหนังสือส่งตัวของ/` เฉยๆ** — ข้อความนั้นอยู่ใน
    //    ConfirmDialog เองด้วย ซึ่งขึ้นตั้งแต่ *ก่อน* ยิง API · เทสต์เดิมจึงผ่านบ้าง
    //    ไม่ผ่านบ้าง (2 ใน 3) เพราะไปอ่านฐานแข่งกับคำขอที่ยังไม่ทันเสร็จ
    //    "แล้ว เลขที่" มีเฉพาะในแถบสำเร็จ ไม่มีในกล่องยืนยัน
    await expect(page.getByText(/ออกหนังสือส่งตัวของ.*แล้ว เลขที่/)).toBeVisible();

    // คิวกลับเป็น 0 ได้ก็ต่อเมื่อ `loadData()` รันจบ ซึ่งเกิดหลัง API ตอบแล้วเท่านั้น
    // — ยืนยันตรงนี้ก่อนค่อยอ่านฐาน จะได้ไม่แข่งกับคำขอ
    await expect(page.getByTestId('staff-queue-dispatch')).toContainText('หนังสือส่งตัวรอออก · 0 คน');

    expect(
      await dbValue<string>('SELECT dispatch_document_no FROM intent_forms WHERE form_id = $1', [
        formId,
      ])
    ).toBe('อว 0656.10/หน้าจอ');
  });

  test('D8: หน้าจอนักศึกษา — หนังสือส่งตัวโผล่หลังคณบดีลงนามเท่านั้น', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);

    // ยังไม่ลงนาม — เห็นรายการแต่สถานะบอกว่ารออยู่ และโหลดไฟล์ไม่ได้
    await loginAs(page, 'student2');
    await expect(page.getByTestId('student-doc-send_letter')).toContainText('หนังสือส่งตัวนักศึกษา');
    await expect(page.getByTestId('student-doc-send_letter')).toContainText('รอการลงนาม');
    // บรรทัดบอกให้นำส่งสถานประกอบการขึ้นเฉพาะฉบับที่ลงนามแล้ว (ยังไม่ลงนาม = ยังโหลดไม่ได้)
    await expect(page.getByTestId('dispatch-letter-hint')).toHaveCount(0);

    const docId = await dbValue<number>(
      "SELECT doc_id FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1"
    );
    await apiLoginAs(request, 'dean1');
    expect(
      (await request.post(`${API_URL}/documents/batch-sign`, { data: { doc_ids: [docId] } })).status()
    ).toBe(200);

    await page.reload();
    await expect(page.getByTestId('student-doc-send_letter')).toContainText('คณบดีเซ็นอนุมัติแล้ว');
    await expect(page.getByTestId('dispatch-letter-hint')).toHaveText('ดาวน์โหลดแล้วนำส่งสถานประกอบการ');
  });

  test('D9: ตัวนับ "รอออกหนังสือส่งตัว" นับเฉพาะใบที่ยังไม่ออกจริง', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    await apiLoginAs(request, 'staff1');
    const before = await request.get(`${API_URL}/intents/pipeline-summary`);
    expect((await before.json()).dispatch_eligible).toBe(1);

    expect((await issue(request, formId)).status()).toBe(200);

    const after = await request.get(`${API_URL}/intents/pipeline-summary`);
    const counts = await after.json();
    // ⛔ ของเดิมนับเอกสารชนิด 'dispatch_letter' ที่ไม่มีอยู่จริง ตัวเลขจึงเท่ากับ
    //    จำนวนใบที่ accepted ตลอดกาล — ออกหนังสือไปแล้วก็ยังนับอยู่
    expect(counts.dispatch_eligible).toBe(0);
    expect(counts.accepted).toBe(1);
  });

  test('D10: สถานประกอบการไม่มีชื่อผู้ประสานงาน → ยังออกได้ และเรียนถึง "ผู้จัดการฝ่ายบุคคล" (ไม่หยิบผู้ลงนามแบบตอบรับมาแทน)', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    // ผู้รับของหนังสือขอความอนุเคราะห์ก็ถอยไปใช้คำนี้เมื่อทำเนียบไม่มีชื่อ — สองฉบับต้องเรียนถึงคนเดียวกัน
    await dbExec(
      `UPDATE companies SET contact_person = NULL
        WHERE company_id = (SELECT company_id FROM intent_forms WHERE form_id = $1)`,
      [formId]
    );

    await apiLoginAs(request, 'staff1');
    const ok = await issue(request, formId);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(
      await dbValue<string>("SELECT COUNT(*) FROM official_documents WHERE type = 'send_letter'")
    ).toBe('1');

    const letterPath = (await dbValue<string>(
      "SELECT generated_file_path FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1"
    ))!;
    const text = await pdfText(fs.readFileSync(path.join(BACKEND_ROOT, letterPath)));
    expect(text).toContain('เรียนผู้จัดการฝ่ายบุคคล');
    expect(text).not.toContain('คุณสมชายทรงชัย');
  });
});

/**
 * ขั้น 6 ข้อ ก — ทางแก้ของหนังสือส่งตัวที่ยังไม่ลงนาม
 *
 * สิ่งที่พังเงียบได้:
 *   R1–R2  ถอนแล้วใบต้อง **คง `accepted`** และกลับเข้าคิวรอออก (เลขถูกล้าง) — ถ้าใบถอยสถานะ บัญชีพี่เลี้ยงที่เปิดไปแล้วจะค้าง
 *          ออกใหม่ด้วยเลขเดิมได้ (หนังสือถูกลบ ไม่ใช่ตั้ง rejected) · เหตุผลถึงเจ้าหน้าที่เท่านั้น
 *   R3–R4  สิทธิ์ · ลงนามแล้วถอนไม่ได้ · ต้องมีเหตุผล · ลงนามฉบับที่ถูกถอนไปแล้วไม่ได้
 *   R5     วันเริ่มงานแก้ได้ตอนออกหนังสือ และหนังสือพิมพ์วันใหม่
 *   R6     วาดไฟล์ล้มหลังบันทึกเลข ใบต้องไม่หายจากคิว (เดิมเลขค้าง = ทางตัน)
 */
const RECALL_REASON = 'วันสิ้นสุดการปฏิบัติงานไม่ตรงกับแบบตอบรับ กรุณาตรวจอีกครั้ง';
const DISPATCH_NO = 'อว 0656.10/ส่งตัว-1';
const FONT = path.join(BACKEND_ROOT, 'secure_private/fonts/THSarabunNew.ttf');
const FONT_HIDDEN = `${FONT}.e2e-hidden-dispatch`;

const sendLetter = (formId: number) =>
  dbRow<{ doc_id: number; status: string; path: string }>(
    `SELECT d.doc_id, d.status, d.generated_file_path AS path
       FROM official_documents d JOIN intent_forms i
         ON i.student_id = d.student_id AND i.company_id = d.company_id
      WHERE i.form_id = $1 AND d.type = 'send_letter' ORDER BY d.doc_id DESC LIMIT 1`,
    [formId]
  );

const dispatchForm = (formId: number) =>
  dbRow<{ status: string; dispatch_document_no: string | null; start_date: string | null; end_date: string | null; reject_reason: string | null }>(
    `SELECT status, dispatch_document_no, start_date::text AS start_date, end_date::text AS end_date, reject_reason
       FROM intent_forms WHERE form_id = $1`,
    [formId]
  );

const recallEvents = (formId: number) =>
  dbRows<{ stage: string; note: string | null; actor_id: number | null }>(
    `SELECT stage, note, actor_id FROM intent_stage_events
      WHERE form_id = $1 AND stage LIKE 'dispatch_%' AND stage <> 'dispatch_issued' ORDER BY event_id`,
    [formId]
  );

type AcceptedRow = {
  form_id: number;
  dispatch_recall?: { by: 'dean' | 'staff'; reason: string; at: string; actor_name: string | null } | null;
};
const acceptedList = async (request: APIRequestContext): Promise<AcceptedRow[]> =>
  (await (await request.get(`${API_URL}/intents?status=accepted`)).json()) as AcceptedRow[];

async function pdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text.replace(/\s+/g, '');
  } finally {
    await parser.destroy();
  }
}

test.describe('หนังสือส่งตัว — ถอนกลับ · แก้วันเริ่มงาน · วาดไฟล์ล้ม', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    if (fs.existsSync(FONT_HIDDEN)) fs.renameSync(FONT_HIDDEN, FONT);
    await seedTestData();
  });

  test('R1: เจ้าหน้าที่ดึงกลับ → หนังสือหายจากคิวคณบดี · ใบคง accepted กลับเข้าคิวรอออกพร้อมเหตุผล · ออกใหม่เลขเดิมแล้วคณบดีลงนามได้', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);
    const first = (await sendLetter(formId))!;

    // รายการหนังสือของเจ้าหน้าที่ต้องบอกว่าหนังสือส่งตัวฉบับนี้เป็นของใบไหน — ปุ่มดึงกลับบนหน้าจอใช้ค่านี้
    const docs = (await (await request.get(`${API_URL}/documents`)).json()) as Array<{ doc_id: number; form_id: number | null }>;
    expect(docs.find((d) => d.doc_id === first.doc_id)!.form_id).toBe(formId);

    const recalled = await request.post(`${API_URL}/intents/${formId}/dispatch-letter/recall`, {
      data: { reason: RECALL_REASON },
    });
    expect(recalled.status(), await recalled.text()).toBe(200);

    // ── ฐาน: หนังสือถูกลบ · เลขถูกล้าง · ใบไม่ถอยสถานะ · วันสิ้นสุดคงอยู่ · ไม่เขียน reject_reason ──
    expect(await sendLetter(formId)).toBeUndefined();
    const form = (await dispatchForm(formId))!;
    expect(form.status).toBe('accepted');
    expect(form.dispatch_document_no).toBeNull();
    expect(form.end_date).toBe('2027-02-19');
    expect(form.reject_reason).toBeNull();
    const events = await recallEvents(formId);
    expect(events.map((e) => e.stage)).toEqual(['dispatch_staff_recalled']);
    expect(events[0].note).toBe(RECALL_REASON);
    expect(events[0].actor_id).toBe(
      await dbValue<number>("SELECT user_id FROM users WHERE email = 'staff1@test.com'")
    );
    // ไฟล์ฉบับร่างไม่มีแถวไหนชี้ถึงแล้ว ต้องถูกลบ
    await expect.poll(() => fs.existsSync(path.join(BACKEND_ROOT, first.path))).toBe(false);
    await expect
      .poll(() =>
        dbValue<string>(
          `SELECT detail->>'by' FROM audit_log WHERE action = 'document.dispatch_letter_returned' AND entity_id = $1`,
          [String(formId)]
        )
      )
      .toBe('staff');

    // ── หายจากคิวคณบดี · กลับเข้าคิวรอออกของเจ้าหน้าที่พร้อมเหตุผล ──
    const after = (await (await request.get(`${API_URL}/documents`)).json()) as Array<{ doc_id: number }>;
    expect(after.some((d) => d.doc_id === first.doc_id)).toBe(false);
    expect((await (await request.get(`${API_URL}/intents/pipeline-summary`)).json()).dispatch_eligible).toBe(1);
    const queued = (await acceptedList(request)).find((r) => r.form_id === formId)!;
    expect(queued.dispatch_recall).toMatchObject({ by: 'staff', reason: RECALL_REASON });

    // ── ออกใหม่ด้วยเลขเดิม (ถ้าหนังสือเดิมไม่ถูกลบ ตรงนี้จะ 409) แล้วคณบดีลงนามได้ ──
    const again = await issue(request, formId);
    expect(again.status(), await again.text()).toBe(200);
    const second = (await sendLetter(formId))!;
    expect(second.doc_id).not.toBe(first.doc_id);
    // ออกใหม่แล้ว = ไม่อยู่ในคิวรอออก ป้ายถอนต้องไม่ตามไป
    expect((await acceptedList(request)).find((r) => r.form_id === formId)!.dispatch_recall).toBeNull();

    await deanSign(request, second.doc_id);
    expect((await sendLetter(formId))!.status).toBe('signed');
  });

  test('R2: คณบดีตีกลับ → ผลเดียวกัน · เหตุผลถึงเจ้าหน้าที่เท่านั้น นักศึกษาและบทบาทอื่นไม่เห็น', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);
    const letter = (await sendLetter(formId))!;

    await apiLoginAs(request, 'dean1');
    const returned = await request.post(`${API_URL}/documents/${letter.doc_id}/return`, {
      data: { reason: RECALL_REASON },
    });
    expect(returned.status(), await returned.text()).toBe(200);

    expect(await sendLetter(formId)).toBeUndefined();
    const form = (await dispatchForm(formId))!;
    expect(form.status).toBe('accepted');
    expect(form.dispatch_document_no).toBeNull();
    const events = await recallEvents(formId);
    expect(events.map((e) => e.stage)).toEqual(['dispatch_dean_returned']);
    expect(events[0].actor_id).toBe(
      await dbValue<number>("SELECT user_id FROM users WHERE email = 'dean1@test.com'")
    );
    // ⛔ ต้องไม่ไปโผล่เป็นเหตุการณ์ของคิวคำร้อง (dean_returned / staff_recalled อ่านเป็น "เข้าคิวคำร้องรอรับ")
    expect(
      await dbValue<number>(
        `SELECT COUNT(*)::int FROM intent_stage_events WHERE form_id = $1 AND stage IN ('dean_returned', 'staff_recalled')`,
        [formId]
      )
    ).toBe(0);

    // เจ้าหน้าที่เห็นว่าใครตีกลับ เพราะอะไร
    await apiLoginAs(request, 'staff1');
    expect((await acceptedList(request)).find((r) => r.form_id === formId)!.dispatch_recall).toMatchObject({
      by: 'dean',
      reason: RECALL_REASON,
    });

    // บทบาทอื่นที่ใช้เส้นเดียวกันไม่ได้ค่านี้เลย (ไม่ใช่ได้ null)
    for (const account of ['dean1', 'head1', 'advisor1'] as const) {
      await apiLoginAs(request, account);
      const res = await request.get(`${API_URL}/intents?status=accepted`);
      expect(res.status(), account).toBe(200);
      const body = await res.text();
      expect(body, `${account} ต้องไม่เห็นเหตุผล`).not.toContain(RECALL_REASON);
      expect(body, `${account} ต้องไม่ได้คีย์ dispatch_recall`).not.toContain('dispatch_recall');
    }

    // นักศึกษาไม่เห็นเหตุผล ทั้งทาง API และบนหน้าจอ
    await apiLoginAs(request, 'student2');
    for (const url of [`${API_URL}/intents/${formId}`, `${API_URL}/intents/me`, `${API_URL}/students/dashboard`]) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(200);
      expect(await res.text(), url).not.toContain(RECALL_REASON);
    }
    await loginAs(page, 'student2');
    await expect(page.getByRole('heading', { name: 'ที่ฝึกงานของคุณ' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(RECALL_REASON);
  });

  test('R3: สิทธิ์ — ดึงกลับได้เฉพาะเจ้าหน้าที่ · ตีกลับได้เฉพาะคณบดี', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);
    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);
    const letter = (await sendLetter(formId))!;

    for (const account of ['student2', 'advisor1', 'head1', 'dean1', 'mentor1'] as const) {
      await apiLoginAs(request, account);
      const res = await request.post(`${API_URL}/intents/${formId}/dispatch-letter/recall`, {
        data: { reason: RECALL_REASON },
      });
      expect(res.status(), `${account} เรียก route ของเจ้าหน้าที่`).toBe(403);
    }
    for (const account of ['student2', 'advisor1', 'head1', 'staff1', 'mentor1'] as const) {
      await apiLoginAs(request, account);
      const res = await request.post(`${API_URL}/documents/${letter.doc_id}/return`, {
        data: { reason: RECALL_REASON },
      });
      expect(res.status(), `${account} เรียก route ของคณบดี`).toBe(403);
    }

    // ไม่มีอะไรขยับ
    expect((await sendLetter(formId))!.status).toBe('pending_sign');
    expect((await dispatchForm(formId))!.dispatch_document_no).toBe(DISPATCH_NO);
    expect(await recallEvents(formId)).toHaveLength(0);
  });

  test('R4: ไม่ส่งเหตุผล (400) · ยังไม่ออกหนังสือ (409) · ลงนามแล้วถอนไม่ได้ (409) · ลงนามฉบับที่ถูกถอนไปแล้วไม่ได้', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    // ยังไม่มีหนังสือให้ถอน — ต้องไม่เกิดเหตุการณ์ถอน (ป้ายในคิวจะขึ้นทั้งที่ไม่เคยออก)
    await apiLoginAs(request, 'staff1');
    const nothing = await request.post(`${API_URL}/intents/${formId}/dispatch-letter/recall`, {
      data: { reason: RECALL_REASON },
    });
    expect(nothing.status(), await nothing.text()).toBe(409);
    expect(await recallEvents(formId)).toHaveLength(0);

    expect((await issue(request, formId)).status()).toBe(200);
    const first = (await sendLetter(formId))!;

    // ไม่ส่งเหตุผล / เหตุผลว่าง = 400 และไม่มีอะไรเปลี่ยน
    for (const body of [{}, { reason: '   ' }]) {
      const res = await request.post(`${API_URL}/intents/${formId}/dispatch-letter/recall`, { data: body });
      expect(res.status(), JSON.stringify(body)).toBe(400);
    }
    await apiLoginAs(request, 'dean1');
    expect((await request.post(`${API_URL}/documents/${first.doc_id}/return`, { data: {} })).status()).toBe(400);
    expect((await sendLetter(formId))!.doc_id).toBe(first.doc_id);

    // คณบดีตีกลับ แล้วพยายามลงนามฉบับที่ถูกถอนไปแล้ว (หน้าคิวที่เปิดค้างไว้) → ไม่นับว่าลงนาม
    expect(
      (await request.post(`${API_URL}/documents/${first.doc_id}/return`, { data: { reason: RECALL_REASON } })).status()
    ).toBe(200);
    const stale = await request.post(`${API_URL}/documents/batch-sign`, { data: { doc_ids: [first.doc_id] } });
    expect(stale.status()).toBe(200);
    const staleBody = await stale.json();
    expect(staleBody.signed_count).toBe(0);
    expect(staleBody.failed_documents.map((f: { doc_id: number }) => f.doc_id)).toEqual([first.doc_id]);

    // ออกใหม่ → ลงนาม → ถอนไม่ได้ทั้งสองทาง · หนังสือและเลขยังอยู่
    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);
    const second = (await sendLetter(formId))!;
    await deanSign(request, second.doc_id);

    const lateReturn = await request.post(`${API_URL}/documents/${second.doc_id}/return`, {
      data: { reason: RECALL_REASON },
    });
    expect(lateReturn.status(), await lateReturn.text()).toBe(409);
    expect((await lateReturn.json()).code).toBe('letter_signed');
    await apiLoginAs(request, 'staff1');
    const lateRecall = await request.post(`${API_URL}/intents/${formId}/dispatch-letter/recall`, {
      data: { reason: RECALL_REASON },
    });
    expect(lateRecall.status(), await lateRecall.text()).toBe(409);
    expect((await lateRecall.json()).code).toBe('letter_signed');
    expect((await sendLetter(formId))!.status).toBe('signed');
    expect((await dispatchForm(formId))!.dispatch_document_no).toBe(DISPATCH_NO);
    expect(await recallEvents(formId)).toHaveLength(1);
  });

  test('R5: แก้วันเริ่มงานตอนออกหนังสือ → ใบและข้อความในหนังสือเป็นวันใหม่ · วันเริ่มหลังวันสิ้นสุด = 400', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);
    await apiLoginAs(request, 'staff1');

    const badFormat = await issue(request, formId, { document_no: DISPATCH_NO, end_date: '2027-02-19', start_date: '26/10/2026' });
    expect(badFormat.status()).toBe(400);
    const backwards = await issue(request, formId, { document_no: DISPATCH_NO, end_date: '2027-02-19', start_date: '2027-03-01' });
    expect(backwards.status()).toBe(400);
    expect((await backwards.json()).message as string).toContain('ก่อนวันเริ่มปฏิบัติงาน');
    // ถูกปฏิเสธ = ใบไม่ถูกแตะ
    expect((await dispatchForm(formId))!.start_date).toBe(MENTOR.start_date);
    expect(await sendLetter(formId)).toBeUndefined();

    // นักศึกษากรอกวันเริ่ม 2 พ.ย. — เจ้าหน้าที่แก้เป็น 26 ต.ค. ตอนออกหนังสือ
    const ok = await issue(request, formId, { document_no: DISPATCH_NO, end_date: '2027-02-19', start_date: '2026-10-26' });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await dispatchForm(formId))!.start_date).toBe('2026-10-26');

    const letter = (await sendLetter(formId))!;
    const text = await pdfText(fs.readFileSync(path.join(BACKEND_ROOT, letter.path)));
    expect(text).toContain('โดยเริ่มปฏิบัติงานตั้งแต่วันที่๒๖ตุลาคม๒๕๖๙ถึงวันที่๑๙กุมภาพันธ์๒๕๗๐');
    expect(text, 'วันเริ่มเดิม (2 พ.ย.) ต้องไม่ถูกพิมพ์').not.toContain('๒พฤศจิกายน๒๕๖๙');

    await expect
      .poll(() =>
        dbRow<{ from: string | null; to: string | null }>(
          `SELECT detail->>'start_date_from' AS "from", detail->>'start_date_to' AS "to"
             FROM audit_log WHERE action = 'document.generated' AND entity_id = $1`,
          [String(letter.doc_id)]
        )
      )
      .toEqual({ from: MENTOR.start_date, to: '2026-10-26' });
  });

  test('R6: วาดไฟล์หนังสือล้มหลังบันทึกเลข → ตอบ 500 · เลขถูกล้าง ใบยังอยู่ในคิวรอออก · กดออกใหม่ได้', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);
    await apiLoginAs(request, 'staff1');

    // ฟอนต์หาย = ตัววาดล้ม (หลัง COMMIT ของเลขที่หนังสือ) · โฟลเดอร์นี้เป็นของ worker นี้เท่านั้น
    fs.renameSync(FONT, FONT_HIDDEN);
    try {
      const failed = await issue(request, formId);
      expect(failed.status(), await failed.text()).toBe(500);
      expect((await failed.json()).message as string).toContain('กดออกหนังสืออีกครั้ง');
    } finally {
      fs.renameSync(FONT_HIDDEN, FONT);
    }

    expect(await sendLetter(formId)).toBeUndefined();
    expect((await dispatchForm(formId))!.dispatch_document_no).toBeNull();
    expect((await (await request.get(`${API_URL}/intents/pipeline-summary`)).json()).dispatch_eligible).toBe(1);
    // กองงานบนหน้าแรกเจ้าหน้าที่ก็ต้องยังนับใบนี้ — ที่นั่นกรองด้วยเลขที่หนังสือ ไม่ใช่การมีอยู่ของเอกสาร
    const home = await request.get(`${API_URL}/staff/home`);
    expect((await home.json()).tiles.dispatch.count).toBe(1);

    const retry = await issue(request, formId);
    expect(retry.status(), await retry.text()).toBe(200);
    expect((await sendLetter(formId))!.status).toBe('pending_sign');
  });

  test('R7: หน้าจอ — คณบดีตีกลับหนังสือส่งตัว → เจ้าหน้าที่เห็นป้ายและเหตุผลในคิวรอออก แก้วันเริ่มงานแล้วออกใหม่ได้', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);
    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);
    const first = (await sendLetter(formId))!;

    // ── คณบดี: ปุ่มตีกลับขึ้นกับหนังสือส่งตัวด้วย และกล่องบอกชนิดหนังสือที่ถูกต้อง ──
    await loginAs(page, 'dean1');
    const row = page.getByTestId(`dean-doc-row-${first.doc_id}`);
    await expect(row).toBeVisible();
    await row.getByTestId('dean-doc-preview').click();
    await page.getByTestId('dean-return-open').click();
    const returnDialog = page.getByRole('dialog').filter({ has: page.getByTestId('dean-return-reason') });
    await expect(returnDialog).toContainText('หนังสือส่งตัว');
    await expect(returnDialog).toContainText(DISPATCH_NO);
    await expect(returnDialog, 'กล่องต้องไม่เรียกหนังสือส่งตัวว่าหนังสือขอความอนุเคราะห์').not.toContainText(
      'หนังสือขอความอนุเคราะห์'
    );
    await returnDialog.getByTestId('dean-return-reason').fill(RECALL_REASON);
    await returnDialog.getByTestId('dean-return-submit').click();
    await expect(page.getByTestId(`dean-doc-row-${first.doc_id}`)).toHaveCount(0);
    expect(await sendLetter(formId)).toBeUndefined();

    // ── เจ้าหน้าที่: ใบกลับเข้าคิวรอออก พร้อมป้าย · กล่องออกหนังสือบอกว่าใครตีกลับเพราะอะไร ──
    await loginAs(page, 'staff1');
    await expect(page.getByTestId('staff-queue-dispatch')).toContainText('หนังสือส่งตัวรอออก · 1 คน');
    await expect(page.getByTestId(`dispatch-recall-badge-${formId}`)).toHaveText('คณบดีตีกลับ');
    await page.getByTestId(`issue-dispatch-${formId}`).click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('dispatch-document-no') });
    await expect(dialog.getByTestId('dispatch-recall-note')).toContainText('คณบดีตีกลับหนังสือ');
    await expect(dialog.getByTestId('dispatch-recall-note')).toContainText(RECALL_REASON);

    // วันสิ้นสุดที่กรอกรอบก่อนยังอยู่ · วันเริ่มงานแก้ได้ในกล่องนี้
    await expect(dialog.getByTestId('dispatch-end-date')).toHaveValue('2027-02-19');
    await expect(dialog.getByTestId('dispatch-start-date')).toHaveValue(MENTOR.start_date);
    await dialog.getByTestId('dispatch-start-date').fill('2026-10-26');
    await dialog.getByTestId('dispatch-document-no').fill(DISPATCH_NO);
    await dialog.getByTestId('dispatch-submit').click();

    // กล่องยืนยันแสดงวันที่แก้แล้ว และไม่บอกว่าย้อนกลับไม่ได้อีก
    const confirm = page.getByRole('dialog').filter({ hasText: 'ดึงกลับได้จนกว่าคณบดีจะลงนาม' });
    await expect(confirm).toContainText('26');
    await expect(page.locator('body')).not.toContainText('ย้อนกลับไม่ได้');
    await page.getByRole('button', { name: 'ออกเลขและส่งเข้าคิวคณบดี' }).click();
    await expect(page.getByText(/ออกหนังสือส่งตัวของ.*แล้ว เลขที่/)).toBeVisible();
    await expect(page.getByTestId('staff-queue-dispatch')).toContainText('หนังสือส่งตัวรอออก · 0 คน');

    const form = (await dispatchForm(formId))!;
    expect(form.dispatch_document_no).toBe(DISPATCH_NO);
    expect(form.start_date).toBe('2026-10-26');
    expect((await sendLetter(formId))!.status).toBe('pending_sign');
  });

  test('R8: หน้าจอ — เจ้าหน้าที่ดึงหนังสือส่งตัวกลับจากตารางหนังสือ · ไม่มีปุ่มแก้เลขที่หนังสือของหนังสือส่งตัว', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);
    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);
    const letter = (await sendLetter(formId))!;

    await loginAs(page, 'staff1');
    const recall = page.getByTestId(`recall-letter-${letter.doc_id}`);
    await expect(recall).toBeVisible();
    // แก้เลขของหนังสือส่งตัว = ดึงกลับแล้วออกใหม่ — ปุ่มแก้เลขเป็นของหนังสือขอความอนุเคราะห์เท่านั้น
    await expect(page.getByTestId(`edit-document-no-${letter.doc_id}`)).toHaveCount(0);

    await recall.click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('recall-letter-reason') });
    await expect(dialog).toContainText('หนังสือส่งตัว');
    await expect(dialog).toContainText(DISPATCH_NO);
    await dialog.getByTestId('recall-letter-reason').fill(RECALL_REASON);
    await dialog.getByTestId('recall-letter-submit').click();
    await expect(page.getByTestId(`recall-letter-${letter.doc_id}`)).toHaveCount(0);

    expect(await sendLetter(formId)).toBeUndefined();
    const form = (await dispatchForm(formId))!;
    expect(form.status).toBe('accepted');
    expect(form.dispatch_document_no).toBeNull();
    expect((await recallEvents(formId)).map((e) => e.stage)).toEqual(['dispatch_staff_recalled']);

    // กลับเข้าคิวรอออกพร้อมป้าย "ดึงกลับ"
    await page.reload();
    await expect(page.getByTestId(`dispatch-recall-badge-${formId}`)).toHaveText('ดึงกลับ');
  });
});
