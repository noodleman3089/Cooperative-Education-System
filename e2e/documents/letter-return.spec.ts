import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbRows, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { approveIntentThroughOfficer, coverLetterDocId, deanSign, officerApprove } from '../helpers/intent';

/**
 * ขั้น 3 ของเส้นทางสหกิจ — คณบดีลงนามหนังสือขอความอนุเคราะห์
 *
 * สิ่งที่พังเงียบได้ และเป็นเหตุผลที่ไฟล์นี้มีอยู่:
 *   L1–L3  ถอนหนังสือที่ยังไม่ลงนาม (คณบดีตีกลับ · เจ้าหน้าที่ดึงกลับ) — ใบต้องกลับไปรอรับใหม่ได้ด้วยเลขเดิม
 *          ไม่แดง "เลยกำหนด" ทันที และนักศึกษาต้องไม่เห็นเหตุผล
 *   L4–L5  สิทธิ์ · ลงนามแล้วถอนไม่ได้ · ต้องมีเหตุผล · หนังสือส่งตัวยังตีกลับไม่ได้
 *   L6     ด่านลงนามกันเฉพาะ `pending_sign` (เดิมกันแค่ `signed`) — ถอนไปแล้วต้องลงนามไม่ได้ และไม่ปั๊มกำหนดตอบรับ
 *   L7–L8  ชื่อ-ตำแหน่งใต้ลายเซ็นเป็นของ **คนที่กดลงนาม** (เดิมหยิบบัญชี dean ใบแรกที่ฐานเจอ) · ตำแหน่งตั้งได้เฉพาะ role dean
 */

const PDF = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const FONT = path.resolve(__dirname, '../../backend/secure_private/fonts/THSarabunNew.ttf');
const FONT_HIDDEN = `${FONT}.e2e-hidden`;
const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const REASON = 'บริษัทแจ้งว่าชื่อผู้รับหนังสือเปลี่ยน กรุณาตรวจข้อมูลอีกครั้ง';
const DOC_NO = 'อว 0656.10/ถอน-1';

async function seedIntent(): Promise<number> {
  return (await dbValue<number>(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
     VALUES (${STUDENT2}, (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
             (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'pending_advisor')
     RETURNING form_id`
  ))!;
}

/** เจ้าหน้าที่รับคำร้องแล้ว หนังสือรอคณบดีลงนาม — เหลือ cookie jar ของ request เป็นเจ้าหน้าที่ */
async function approvedForm(request: APIRequestContext): Promise<{ formId: number; docId: number }> {
  const formId = await seedIntent();
  await approveIntentThroughOfficer(request, formId, { documentNo: DOC_NO });
  return { formId, docId: await coverLetterDocId() };
}

const formRow = (formId: number) =>
  dbRow<{
    status: string;
    officer_document_no: string | null;
    reject_reason: string | null;
    acceptance_due_date: string | null;
  }>(
    `SELECT status, officer_document_no, reject_reason, acceptance_due_date::text AS acceptance_due_date
       FROM intent_forms WHERE form_id = $1`,
    [formId]
  );

const letterCount = (formId: number) =>
  dbValue<number>(
    `SELECT COUNT(*)::int FROM official_documents d JOIN intent_forms i
       ON i.student_id = d.student_id AND i.company_id = d.company_id
      WHERE i.form_id = $1 AND d.type = 'cover_letter'`,
    [formId]
  );

const stageEvents = (formId: number) =>
  dbRows<{ stage: string; note: string | null; actor_id: number | null }>(
    `SELECT stage, note, actor_id FROM intent_stage_events
      WHERE form_id = $1 AND stage IN ('dean_returned', 'staff_recalled') ORDER BY event_id`,
    [formId]
  );

async function letterText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text.replace(/\s+/g, '');
  } finally {
    await parser.destroy();
  }
}
const flat = (s: string) => s.replace(/\s+/g, '');

test.describe('ขั้น 3 — คณบดีลงนามหนังสือ: ถอนกลับ · ด่านลงนาม · ชื่อผู้ลงนาม', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    if (fs.existsSync(FONT_HIDDEN)) fs.renameSync(FONT_HIDDEN, FONT);
    await seedTestData();
  });

  test('L1: คณบดีตีกลับ → หนังสือหายจากคิว · ใบกลับไปรอรับ ไม่แดง "เลยกำหนด" · เหตุผลถึงเจ้าหน้าที่ ไม่ถึงนักศึกษา', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    const { formId, docId } = await approvedForm(request);

    // ใบนี้อัปโหลดมานานแล้ว — ถ้านับ "เลยกำหนด" จากวันอัปโหลดเดิม ใบที่เพิ่งกลับเข้าคิวจะแดงทันที
    await dbExec(
      `UPDATE intent_stage_events SET entered_at = NOW() - INTERVAL '30 days'
        WHERE form_id = $1 AND stage = 'request_uploaded'`,
      [formId]
    );

    // ── คณบดีตีกลับผ่านหน้าจอ ──
    await loginAs(page, 'dean1');
    const row = page.getByTestId(`dean-doc-row-${docId}`);
    await expect(row).toBeVisible();
    await row.getByTestId('dean-doc-preview').click();
    await page.getByTestId('dean-return-open').click();
    const dialog = page.getByRole('dialog');
    // กล่องบอกว่ากำลังตีกลับของใคร
    await expect(dialog).toContainText(DOC_NO);
    await expect(dialog.getByTestId('dean-return-submit')).toBeDisabled();
    await dialog.getByTestId('dean-return-reason').fill(REASON);
    await dialog.getByTestId('dean-return-submit').click();

    await expect(page.getByRole('status').filter({ hasText: 'ตีกลับหนังสือของ' })).toBeVisible();
    await expect(page.getByTestId(`dean-doc-row-${docId}`)).toHaveCount(0);

    // ── ฐาน: หนังสือถูกลบ (ไม่ใช่ rejected) · ใบถอยกลับ · เลขเดิมคงอยู่ · ไม่เขียน reject_reason ──
    expect(await letterCount(formId)).toBe(0);
    const form = await formRow(formId);
    expect(form!.status).toBe('pending_officer_request');
    expect(form!.officer_document_no).toBe(DOC_NO);
    expect(form!.reject_reason).toBeNull();
    const events = await stageEvents(formId);
    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe('dean_returned');
    expect(events[0].note).toBe(REASON);
    expect(events[0].actor_id).toBe(
      await dbValue<number>("SELECT user_id FROM users WHERE email = 'dean1@test.com'")
    );
    await expect
      .poll(() =>
        dbValue<string>(
          `SELECT detail->>'by' FROM audit_log WHERE action = 'document.cover_letter_returned' AND entity_id = $1`,
          [String(formId)]
        )
      )
      .toBe('dean');

    // ── ฝั่งเจ้าหน้าที่: ป้ายในคิว · ไม่เลยกำหนด · แผงเห็นเหตุผลและเลขเดิม ──
    await apiLoginAs(request, 'staff1');
    const list = (await (await request.get(`${API_URL}/intents`)).json()) as Array<{
      form_id: number;
      request_overdue: boolean;
      request_wait_days: number;
      letter_recall: string | null;
    }>;
    const queued = list.find((r) => r.form_id === formId)!;
    expect(queued.letter_recall).toBe('dean_returned');
    expect(queued.request_overdue, 'ใบที่กลับเข้าคิวต้องนับวันรอใหม่').toBe(false);
    expect(queued.request_wait_days).toBe(0);

    await loginAs(page, 'staff1');
    await expect(page.getByTestId(`letter-recall-badge-${formId}`)).toHaveText('คณบดีตีกลับ');
    await page.getByTestId(`review-request-${formId}`).click();
    const panel = page.getByRole('dialog').filter({ hasText: `คำร้องที่ ${formId}` });
    await expect(panel.getByTestId('request-letter-recall')).toContainText('คณบดีตีกลับหนังสือ');
    await expect(panel.getByTestId('request-letter-recall')).toContainText(REASON);
    await expect(panel.getByTestId('officer-document-no')).toHaveValue(DOC_NO);

    // ── นักศึกษาไม่เห็นเหตุผล และใบไม่ใช่ "เจ้าหน้าที่ตีกลับ" ──
    await apiLoginAs(request, 'student2');
    const detail = await request.get(`${API_URL}/intents/${formId}`);
    expect(detail.status()).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.officer_review).toBeUndefined();
    expect(JSON.stringify(detailBody)).not.toContain(REASON);
    await loginAs(page, 'student2');
    await expect(page.locator('body')).not.toContainText(REASON);
    await expect(page.locator('body')).not.toContainText('เจ้าหน้าที่ตีกลับ');
  });

  test('L2: เจ้าหน้าที่รับใหม่ด้วยเลขเดิม → ได้หนังสือฉบับใหม่ในคิวคณบดี แล้วคณบดีลงนามได้', async ({ request }) => {
    test.setTimeout(150_000);
    const { formId, docId } = await approvedForm(request);

    await apiLoginAs(request, 'dean1');
    const returned = await request.post(`${API_URL}/documents/${docId}/return`, { data: { reason: REASON } });
    expect(returned.status(), await returned.text()).toBe(200);

    // รับใหม่ด้วยเลขเดิม — ถ้าหนังสือเดิมถูกตั้งเป็น rejected แทนที่จะลบ ตรงนี้จะ 409
    await apiLoginAs(request, 'staff1');
    const again = await officerApprove(request, formId, { document_no: DOC_NO });
    expect(again.status(), await again.text()).toBe(200);
    expect((await again.json()).cover_letter_issued).toBe(true);

    const newDocId = await coverLetterDocId();
    expect(newDocId).not.toBe(docId);
    expect(await letterCount(formId)).toBe(1);
    expect(await dbValue<string>('SELECT status FROM official_documents WHERE doc_id = $1', [newDocId])).toBe(
      'pending_sign'
    );

    await deanSign(request, newDocId);
    const form = await formRow(formId);
    expect(form!.status).toBe('approved_by_dept_head');
    expect(form!.acceptance_due_date, 'ลงนามแล้วต้องปั๊มกำหนดตอบรับ').not.toBeNull();
  });

  test('L3: เจ้าหน้าที่ดึงหนังสือกลับเอง (หน้าจอ) แล้วตีกลับนักศึกษาต่อได้', async ({ page, request }) => {
    test.setTimeout(150_000);
    const { formId, docId } = await approvedForm(request);

    await loginAs(page, 'staff1');
    await page.getByTestId(`recall-letter-${docId}`).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(DOC_NO);
    await dialog.getByTestId('recall-letter-reason').fill('นักศึกษาแจ้งว่าเปลี่ยนชื่อผู้ประสานงานของบริษัท');
    await dialog.getByTestId('recall-letter-submit').click();
    await expect(page.getByTestId(`recall-letter-${docId}`)).toHaveCount(0);

    expect(await letterCount(formId)).toBe(0);
    expect((await formRow(formId))!.status).toBe('pending_officer_request');
    const events = await stageEvents(formId);
    expect(events.map((e) => e.stage)).toEqual(['staff_recalled']);
    expect(events[0].note).toBe('นักศึกษาแจ้งว่าเปลี่ยนชื่อผู้ประสานงานของบริษัท');

    // กลับมาอยู่คิวรับคำร้อง พร้อมป้าย "ดึงกลับ" — แล้วตีกลับนักศึกษาด้วยปุ่มเดิมได้
    await apiLoginAs(request, 'staff1');
    const list = (await (await request.get(`${API_URL}/intents`)).json()) as Array<{ form_id: number; letter_recall: string | null }>;
    expect(list.find((r) => r.form_id === formId)!.letter_recall).toBe('staff_recalled');

    const rejected = await request.patch(`${API_URL}/intents/${formId}/officer-reject`, {
      data: { reason: 'ข้อมูลสถานประกอบการไม่ตรงกับกระดาษ' },
    });
    expect(rejected.status(), await rejected.text()).toBe(200);
    expect((await formRow(formId))!.status).toBe('pending_advisor');

    // ตีกลับถึงนักศึกษาแล้ว = เรื่องหนังสือจบไป ป้ายต้องหาย (ใหม่กว่าเหตุการณ์ถอนหนังสือ)
    const reviewRes = await request.get(`${API_URL}/intents/${formId}`);
    expect((await reviewRes.json()).officer_review.last_letter_recall).toBeNull();
  });

  test('L4: สิทธิ์ — route ของคณบดีมีแต่คณบดี · route ของเจ้าหน้าที่มีแต่เจ้าหน้าที่', async ({ request }) => {
    test.setTimeout(120_000);
    const { formId, docId } = await approvedForm(request);

    for (const account of ['student2', 'advisor1', 'staff1', 'head1'] as const) {
      await apiLoginAs(request, account);
      const res = await request.post(`${API_URL}/documents/${docId}/return`, { data: { reason: REASON } });
      expect(res.status(), `${account} เรียก route ของคณบดี`).toBe(403);
    }
    for (const account of ['student2', 'dean1', 'advisor1'] as const) {
      await apiLoginAs(request, account);
      const res = await request.post(`${API_URL}/intents/${formId}/cover-letter/recall`, { data: { reason: REASON } });
      expect(res.status(), `${account} เรียก route ของเจ้าหน้าที่`).toBe(403);
    }

    // ไม่มีอะไรขยับ
    expect(await letterCount(formId)).toBe(1);
    expect((await formRow(formId))!.status).toBe('approved_by_dept_head');
  });

  test('L5: ลงนามแล้วถอนไม่ได้ (409) · ไม่ส่งเหตุผล (400) · หนังสือส่งตัวตีกลับไม่ได้ (409)', async ({ request }) => {
    test.setTimeout(120_000);
    const { formId, docId } = await approvedForm(request);

    // ไม่ส่งเหตุผล / เหตุผลว่าง = 400 และไม่มีอะไรเปลี่ยน
    await apiLoginAs(request, 'dean1');
    for (const body of [{}, { reason: '   ' }]) {
      const res = await request.post(`${API_URL}/documents/${docId}/return`, { data: body });
      expect(res.status(), JSON.stringify(body)).toBe(400);
    }
    await apiLoginAs(request, 'staff1');
    expect((await request.post(`${API_URL}/intents/${formId}/cover-letter/recall`, { data: {} })).status()).toBe(400);
    expect(await letterCount(formId)).toBe(1);

    // หนังสือส่งตัวในคิวเดียวกัน — ชนิดจริงคือ send_letter · ยังตีกลับในระบบไม่ได้
    const sendDocId = (await dbValue<number>(
      `INSERT INTO official_documents (document_number, type, student_id, company_id, generated_file_path, status)
       SELECT 'อว ส่งตัว-1', 'send_letter', student_id, company_id, 'secure_private/documents/none.pdf', 'pending_sign'
         FROM intent_forms WHERE form_id = $1 RETURNING doc_id`,
      [formId]
    ))!;
    await apiLoginAs(request, 'dean1');
    const dispatch = await request.post(`${API_URL}/documents/${sendDocId}/return`, { data: { reason: REASON } });
    expect(dispatch.status(), await dispatch.text()).toBe(409);
    expect((await dispatch.json()).message as string).toContain('หนังสือส่งตัว');
    expect(await dbValue<string>('SELECT status FROM official_documents WHERE doc_id = $1', [sendDocId])).toBe(
      'pending_sign'
    );
    await dbExec('DELETE FROM official_documents WHERE doc_id = $1', [sendDocId]);

    // ลงนามแล้ว → คณบดีตีกลับไม่ได้ และเจ้าหน้าที่ดึงกลับไม่ได้ · หนังสือยังอยู่
    await deanSign(request, docId);
    const lateReturn = await request.post(`${API_URL}/documents/${docId}/return`, { data: { reason: REASON } });
    expect(lateReturn.status(), await lateReturn.text()).toBe(409);
    await apiLoginAs(request, 'staff1');
    const lateRecall = await request.post(`${API_URL}/intents/${formId}/cover-letter/recall`, {
      data: { reason: REASON },
    });
    expect(lateRecall.status(), await lateRecall.text()).toBe(409);
    expect((await lateRecall.json()).code).toBe('letter_signed');
    expect(await dbValue<string>('SELECT status FROM official_documents WHERE doc_id = $1', [docId])).toBe('signed');
    expect(await stageEvents(formId)).toHaveLength(0);
  });

  test('L6: ด่านลงนามกัน pending_sign เท่านั้น — ถอนไปแล้วหรือสถานะอื่นลงนามไม่ได้ และไม่ปั๊มกำหนดตอบรับ', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const { formId, docId } = await approvedForm(request);

    // (ก) สถานะที่ไม่ใช่ pending_sign / signed (เดิมผ่านด่านเพราะกันแค่ signed)
    await dbExec(`UPDATE official_documents SET status = 'rejected' WHERE doc_id = $1`, [docId]);
    await apiLoginAs(request, 'dean1');
    const rejectedDoc = await request.post(`${API_URL}/documents/batch-sign`, { data: { doc_ids: [docId] } });
    expect(rejectedDoc.status()).toBe(200);
    const body1 = await rejectedDoc.json();
    expect(body1.signed_count).toBe(0);
    expect(body1.signed_doc_ids).toEqual([]);
    expect(body1.failed_documents[0].doc_id).toBe(docId);
    expect(body1.failed_documents[0].error).toContain('ไม่ได้อยู่ในสถานะรอลงนาม');
    expect(await dbValue<string>('SELECT status FROM official_documents WHERE doc_id = $1', [docId])).toBe('rejected');
    expect((await formRow(formId))!.acceptance_due_date).toBeNull();
    await dbExec(`UPDATE official_documents SET status = 'pending_sign' WHERE doc_id = $1`, [docId]);

    // (ข) ถอนหนังสือไปแล้ว แต่หน้าจอคณบดียังถือ doc_id เก่า (เปิดค้างไว้) → ลงนามไม่ได้
    await apiLoginAs(request, 'staff1');
    const recalled = await request.post(`${API_URL}/intents/${formId}/cover-letter/recall`, {
      data: { reason: REASON },
    });
    expect(recalled.status(), await recalled.text()).toBe(200);

    await apiLoginAs(request, 'dean1');
    const stale = await request.post(`${API_URL}/documents/batch-sign`, { data: { doc_ids: [docId] } });
    const body2 = await stale.json();
    expect(body2.signed_count).toBe(0);
    expect(body2.failed_documents).toHaveLength(1);
    expect((await formRow(formId))!.acceptance_due_date, 'ถอนไปแล้วต้องไม่ปั๊มกำหนดตอบรับ').toBeNull();
    expect(await dbValue<number>(`SELECT COUNT(*)::int FROM audit_log WHERE action = 'document.signed'`)).toBe(0);
  });

  test.describe('ชื่อและตำแหน่งใต้ลายเซ็น', () => {
    const DEAN2_EMAIL = 'dean2-acting@test.com';
    const DEAN2 = { first: 'ปฏิบัติ', last: 'ราชการแทน', line1: 'ปฏิบัติราชการแทนอธิการบดี', line2: 'ผู้แทนคณะผู้บริหาร' };

    /** บัญชีคณบดีใบที่สอง (id สูงกว่า dean1 จึงไม่ใช่ใบที่ฐานหยิบก่อน) ใช้รหัสผ่านและลายเซ็นไฟล์เดียวกับ dean1 */
    async function createSecondDean(request: APIRequestContext): Promise<void> {
      const userId = (await dbValue<number>(
        `INSERT INTO users (email, password_hash)
         SELECT $1, password_hash FROM users WHERE email = 'dean1@test.com' RETURNING user_id`,
        [DEAN2_EMAIL]
      ))!;
      await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'dean')`, [userId]);
      await dbExec(
        `INSERT INTO personnel (personnel_id, major_id, e_signature_file, status, first_name, last_name)
         SELECT $1, major_id, e_signature_file, 'approved', $2, $3
           FROM personnel WHERE personnel_id = (SELECT user_id FROM users WHERE email = 'dean1@test.com')`,
        [userId, DEAN2.first, DEAN2.last]
      );
    }

    async function loginDean2(request: APIRequestContext): Promise<void> {
      const login = await request.post(`${API_URL}/auth/login`, {
        data: { email: DEAN2_EMAIL, password: 'password123' },
      });
      expect(login.status(), await login.text()).toBe(200);
    }

    const signedPdfText = async (docId: number): Promise<string> =>
      letterText(
        fs.readFileSync(
          path.resolve(
            process.cwd(),
            'backend',
            (await dbValue<string>('SELECT generated_file_path FROM official_documents WHERE doc_id = $1', [docId]))!
          )
        )
      );

    test('L7: คณบดีสองบัญชี — ฉบับลงนามพิมพ์ชื่อและตำแหน่งของคนที่กด ไม่ใช่บัญชีแรกที่ฐานเจอ · ไม่ตั้งตำแหน่ง = "คณบดี…"', async ({
      request,
    }) => {
      test.setTimeout(180_000);
      const dean1 = (await dbRow<{ first_name: string | null; last_name: string | null }>(
        `SELECT first_name, last_name FROM personnel WHERE personnel_id = (SELECT user_id FROM users WHERE email = 'dean1@test.com')`
      ))!;
      const dean1Name = flat(`${dean1.first_name ?? ''}${dean1.last_name ?? ''}`);
      expect(dean1Name, 'seed ต้องมีชื่อคณบดีใบแรก ไม่งั้นเทียบไม่ได้').not.toBe('');

      // มีคณบดีสองบัญชีก่อนออกหนังสือ — คณบดีใบที่สองตั้งตำแหน่งสองบรรทัดเอง แล้วเป็นคนลงนามหนังสือฉบับที่ 1
      await createSecondDean(request);
      await loginDean2(request);
      const put = await request.put(`${API_URL}/profile/personnel`, {
        multipart: { signing_position: `${DEAN2.line1}\n${DEAN2.line2}` },
      });
      expect(put.status(), await put.text()).toBe(200);
      expect((await put.json()).profile.signing_position).toBe(`${DEAN2.line1}\n${DEAN2.line2}`);
      const first = await approvedForm(request);

      // ฉบับร่างดึงจากบัญชี dean ที่ id ต่ำสุด (ผลคงที่ ไม่ขึ้นกับลำดับที่ฐานคืน) = dean1
      const draft = await signedPdfText(first.docId);
      expect(draft).toContain(dean1Name);
      expect(draft).not.toContain(flat(DEAN2.line1));

      // ลงนามแล้วต้องเป็นชื่อและตำแหน่งของ dean2 (คนที่กด)
      await loginDean2(request);
      const sign = await request.post(`${API_URL}/documents/batch-sign`, { data: { doc_ids: [first.docId] } });
      expect((await sign.json()).signed_count).toBe(1);
      const signed = await signedPdfText(first.docId);
      expect(signed, 'ต้องมีชื่อคนที่กดลงนาม').toContain(flat(`${DEAN2.first}${DEAN2.last}`));
      expect(signed, 'ต้องมีตำแหน่งบรรทัดที่ 1').toContain(flat(DEAN2.line1));
      expect(signed, 'ต้องมีตำแหน่งบรรทัดที่ 2').toContain(flat(DEAN2.line2));
      expect(signed, 'ห้ามมีชื่อของบัญชีอื่น').not.toContain(dean1Name);
      expect(signed, 'ตั้งตำแหน่งเองแล้วต้องไม่พิมพ์ "คณบดี…" ซ้ำ').not.toContain(flat('คณบดีคณะบริหารธุรกิจ'));

      // หนังสือฉบับที่ 2 — dean1 ไม่ได้ตั้งตำแหน่ง ต้องได้ "คณบดี…" ตามเดิม พร้อมชื่อตัวเอง
      await seedTestData();
      const second = await approvedForm(request);
      await apiLoginAs(request, 'dean1');
      await deanSign(request, second.docId);
      const defaultText = await signedPdfText(second.docId);
      expect(defaultText).toContain(flat('คณบดีคณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ'));
      expect(defaultText).toContain(dean1Name);
      expect(defaultText).not.toContain(flat(DEAN2.line1));
    });

    test('L8: ตำแหน่งใต้ลายมือชื่อตั้งได้เฉพาะ role dean · ส่งว่างคือล้าง · ไม่ส่งคือไม่แตะ', async ({
      request,
      page,
    }) => {
      test.setTimeout(120_000);
      const positionOf = (email: string) =>
        dbValue<string | null>(
          `SELECT signing_position FROM personnel WHERE personnel_id = (SELECT user_id FROM users WHERE email = $1)`,
          [email]
        );

      // เจ้าหน้าที่ส่ง signing_position เข้า endpoint เดียวกัน — ต้องไม่ถูกบันทึก (ค่านี้ถูกพิมพ์ลงหนังสือราชการ)
      await dbExec(
        `INSERT INTO personnel (personnel_id, major_id, status)
         SELECT u.user_id, (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 'approved'
           FROM users u WHERE u.email = 'staff1@test.com'
         ON CONFLICT (personnel_id) DO NOTHING`
      );
      await apiLoginAs(request, 'staff1');
      const byStaff = await request.put(`${API_URL}/profile/personnel`, {
        multipart: { signing_position: 'คณบดีตัวปลอม' },
      });
      expect(byStaff.status(), await byStaff.text()).toBe(200);
      expect(await positionOf('staff1@test.com')).toBeNull();

      // คณบดีตั้งเอง → บันทึก · ฟอร์มที่ไม่รู้จักช่องนี้ (บันทึกลายมือชื่อ ฯลฯ) ต้องไม่ล้างมัน
      await apiLoginAs(request, 'dean1');
      const set = await request.put(`${API_URL}/profile/personnel`, { multipart: { signing_position: '  รักษาราชการแทนคณบดี  ' } });
      expect(set.status(), await set.text()).toBe(200);
      expect(await positionOf('dean1@test.com')).toBe('รักษาราชการแทนคณบดี');
      expect((await request.put(`${API_URL}/profile/personnel`, { multipart: { first_name: 'สมศักดิ์' } })).status()).toBe(200);
      expect(await positionOf('dean1@test.com')).toBe('รักษาราชการแทนคณบดี');

      // หน้าจอ: ค่าที่ตั้งไว้ขึ้นในช่อง · ล้างจากหน้าจอแล้วกลับเป็นค่าว่าง
      await loginAs(page, 'dean1');
      await page.goto('/dashboard?menu=signature');
      const input = page.getByTestId('dean-position-input');
      await expect(input).toHaveValue('รักษาราชการแทนคณบดี');
      await expect(page.getByTestId('dean-signature-position')).toHaveText('รักษาราชการแทนคณบดี');
      await input.fill('');
      await page.getByTestId('dean-position-save').click();
      await expect(page.getByRole('status').filter({ hasText: 'ล้างตำแหน่งแล้ว' })).toBeVisible();
      expect(await positionOf('dean1@test.com')).toBeNull();
    });
  });
});
