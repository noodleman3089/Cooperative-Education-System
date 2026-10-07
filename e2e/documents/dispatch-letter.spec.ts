import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { approveIntentThroughOfficer } from '../helpers/intent';

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
    expect(fs.existsSync(path.resolve(__dirname, '../../backend', doc!.path))).toBe(true);

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

    await apiLoginAs(request, 'staff1');
    expect((await issue(request, formId)).status()).toBe(200);

    const before = await dbRow<{ doc_id: number; path: string }>(
      `SELECT doc_id, generated_file_path AS path
         FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1`
    );

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
    expect(fs.existsSync(path.resolve(__dirname, '../../backend', before!.path))).toBe(true);
    // ชื่อไฟล์บอกชนิดหนังสือ — ถ้าตัววาดถูกเรียกผิดตัว จะได้ cover_letter_signed_*
    expect(path.basename(after!.path)).toContain('dispatch_letter_signed');

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

    await loginAs(page, 'staff1');
    // หน้าแรกแบบ B: กองเดียวที่มีงานคือหนังสือส่งตัว → รายการเริ่มที่กองนั้นเอง
    await expect(page.getByTestId('staff-queue-dispatch')).toContainText('หนังสือส่งตัวรอออก · 1 คน');

    await page.getByTestId(`issue-dispatch-${formId}`).click();
    const dialog = page.getByRole('dialog');
    // ผู้รับหนังสือต้องเป็นคนที่ลงนามในแบบตอบรับ ไม่ใช่ผู้ประสานงานตั้งต้นของบริษัท
    await expect(dialog.getByTestId('dispatch-recipient')).toContainText('คุณสมชาย ทรงชัย');

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

    const docId = await dbValue<number>(
      "SELECT doc_id FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1"
    );
    await apiLoginAs(request, 'dean1');
    expect(
      (await request.post(`${API_URL}/documents/batch-sign`, { data: { doc_ids: [docId] } })).status()
    ).toBe(200);

    await page.reload();
    await expect(page.getByTestId('student-doc-send_letter')).toContainText('คณบดีเซ็นอนุมัติแล้ว');
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

  test('D10: ใบที่ตอบรับผ่านทางบริษัทโดยตรงก็ออกหนังสือส่งตัวได้ (ไม่มีคนคีย์ชื่อผู้ลงนาม)', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToAccepted(request, formId);

    // จำลองใบเก่าที่ไม่มีชื่อผู้ลงนามบนแบบตอบรับ — หนังสือต้องยังออกได้
    // โดยถอยไปใช้ผู้ประสานงานของบริษัทเป็นผู้รับหนังสือแทน
    await dbExec(
      `UPDATE intent_forms
          SET acceptance_signer_name = NULL, acceptance_signer_position = NULL,
              acceptance_signed_date = NULL
        WHERE form_id = $1`,
      [formId]
    );

    await apiLoginAs(request, 'staff1');
    const ok = await issue(request, formId);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(
      await dbValue<string>("SELECT COUNT(*) FROM official_documents WHERE type = 'send_letter'")
    ).toBe('1');
  });
});
