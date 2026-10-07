import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbValue, withDb } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';
import { deanSign, officerApprove } from '../helpers/intent';

/**
 * ขั้น 2 ของเส้นทางสหกิจ — เจ้าหน้าที่รับ / ตีกลับคำร้อง (เอกสารหมายเลข 1) · ฝั่ง API
 *
 * สิ่งที่พังเงียบได้ และเป็นเหตุผลที่ไฟล์นี้มีอยู่:
 *   R1–R2  เจ้าหน้าที่รับ "ไฟล์ที่ไม่ได้เห็น" — นักศึกษาเปลี่ยนไฟล์ระหว่างที่แผงเปิดอยู่ (ด่านมนุษย์ของ SEC-04)
 *   R3–R5  รับคำร้องแล้วแต่หนังสือไม่ออก = ใบค้างถาวร ไม่อยู่ในคิวไหนเลย
 *   R6–R7  เลขที่หนังสือ: แก้ที่เดียวแล้วหนังสือหลุดจากใบ (ทั้งระบบจับคู่ด้วยเลขนี้) · เลขซ้ำต้องเตือนไม่บล็อก
 *   R8     ประวัติการตีกลับมีชื่อเจ้าหน้าที่ — เส้นที่หลายบทบาทใช้ร่วมต้องตัดฟิลด์ตามบทบาท
 * หน้าจอของขั้นนี้อยู่ที่ `officer-review-panel.spec.ts`
 */

const PDF = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const FONT = path.resolve(__dirname, '../../backend/secure_private/fonts/THSarabunNew.ttf');
const FONT_HIDDEN = `${FONT}.e2e-hidden`;
const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";

/** คำร้องของ student2 ถึงบริษัทในทำเนียบ (seed) — สถานะหลังกดยื่น */
async function seedIntent(): Promise<number> {
  return (await dbValue<number>(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
     VALUES (${STUDENT2}, (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
             (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'pending_advisor')
     RETURNING form_id`
  ))!;
}

/** นักศึกษาอัปโหลด (หรือเปลี่ยน) กระดาษที่ลงนาม — คืน path ที่เซิร์ฟเวอร์เก็บ */
async function upload(request: APIRequestContext, formId: number): Promise<string> {
  await apiLoginAs(request, 'student2');
  const res = await request.post(`${API_URL}/intents/${formId}/request-form`, {
    multipart: {
      request_form: { name: 'signed.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF) },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).request_form_path as string;
}

/** คำร้องของนักศึกษาอีกคน (สร้างทิ้ง) ที่รับไปแล้วด้วยเลขที่หนังสือที่ระบุ — ใช้ทดสอบเลขซ้ำ */
async function approvedFormOfAnotherStudent(documentNo: string): Promise<{ studentCode: string }> {
  const studentCode = '65909901';
  await withDb(async (db) => {
    const userId = (
      await db.query(`INSERT INTO users (email, password_hash) VALUES ('review-other@test.com', 'x') RETURNING user_id`)
    ).rows[0].user_id as number;
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [userId]);
    await db.query(
      `INSERT INTO students (student_id, student_code, first_name, last_name, major_id, cumulative_gpa, enrollment_year)
       VALUES ($1, $2, 'อีกคน', 'ทดสอบ', (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 3.00, 2569)`,
      [userId, studentCode]
    );
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, officer_document_no)
       VALUES ($1, (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
               (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1),
               'approved_by_dept_head', $2)`,
      [userId, documentNo]
    );
  });
  return { studentCode };
}

const formRow = (formId: number) =>
  dbRow<{ status: string; officer_document_no: string | null; request_form_path: string | null }>(
    'SELECT status, officer_document_no, request_form_path FROM intent_forms WHERE form_id = $1',
    [formId]
  );

const coverLetters = (formId: number) =>
  withDb(async (db) =>
    (
      await db.query(
        `SELECT d.doc_id, d.status, d.document_number, d.generated_file_path
           FROM official_documents d JOIN intent_forms i
             ON i.student_id = d.student_id AND i.company_id = d.company_id
          WHERE i.form_id = $1 AND d.type = 'cover_letter' ORDER BY d.doc_id`,
        [formId]
      )
    ).rows as { doc_id: number; status: string; document_number: string; generated_file_path: string }[]
  );

async function missingOnHome(request: APIRequestContext): Promise<number[]> {
  const res = await request.get(`${API_URL}/staff/home`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()).missing_cover_letters as { form_id: number }[]).map((m) => m.form_id);
}

test.describe('ขั้น 2 — เจ้าหน้าที่รับ/ตีกลับคำร้อง (API)', () => {
  test.beforeEach(async () => {
    // เทสต์ R4 ซ่อนไฟล์ฟอนต์ชั่วคราว — ถ้ารอบก่อนถูกฆ่ากลางทาง คืนให้ก่อนเสมอ ไม่งั้นทุกเอกสารในชุดจะวาดไม่ได้
    if (fs.existsSync(FONT_HIDDEN)) fs.renameSync(FONT_HIDDEN, FONT);
    await seedTestData();
  });

  test('R1: นักศึกษาเปลี่ยนไฟล์ระหว่างที่เจ้าหน้าที่ดูอยู่ → รับด้วยไฟล์เก่าไม่ได้ (409) · ไม่บอกว่าดูไฟล์ไหน = 400', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    const seenByOfficer = await upload(request, formId);
    const replaced = await upload(request, formId);
    expect(replaced).not.toBe(seenByOfficer);

    await apiLoginAs(request, 'staff1');

    const blind = await request.patch(`${API_URL}/intents/${formId}/officer-approve`, {
      data: { document_no: 'อว 0656.10/1' },
    });
    expect(blind.status()).toBe(400);
    expect((await blind.json()).message).toContain('กำลังดูไฟล์คำร้องฉบับไหน');

    const stale = await officerApprove(request, formId, {
      document_no: 'อว 0656.10/1',
      request_form_path: seenByOfficer,
    });
    expect(stale.status(), await stale.text()).toBe(409);
    const staleBody = await stale.json();
    expect(staleBody.code).toBe('stale_request_file');
    expect(staleBody.message).toBe('นักศึกษาส่งไฟล์ใหม่แล้ว กรุณาตรวจไฟล์ล่าสุดก่อนรับ');

    // ถูกปฏิเสธ = ไม่มีอะไรเกิดขึ้นเลย: สถานะเดิม ไม่มีเลข ไม่มีหนังสือ
    const untouched = (await formRow(formId))!;
    expect(untouched.status).toBe('pending_officer_request');
    expect(untouched.officer_document_no).toBeNull();
    expect(await coverLetters(formId)).toHaveLength(0);

    const fresh = await officerApprove(request, formId, {
      document_no: 'อว 0656.10/1',
      request_form_path: replaced,
    });
    expect(fresh.status(), await fresh.text()).toBe(200);
    expect((await fresh.json()).cover_letter_issued).toBe(true);
    expect((await formRow(formId))!.status).toBe('approved_by_dept_head');
  });

  test('R2: GET /intents/:id บอกไฟล์ปัจจุบันและเวลาอัปโหลดล่าสุด · นักศึกษายกเลิกแล้ว = 404', async ({ request }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    const first = await upload(request, formId);

    await apiLoginAs(request, 'staff1');
    const before = await (await request.get(`${API_URL}/intents/${formId}`)).json();
    expect(before.request_form_path).toBe(first);
    expect(before.request_uploaded_at).toBeTruthy();

    const second = await upload(request, formId);
    await apiLoginAs(request, 'staff1');
    const after = await (await request.get(`${API_URL}/intents/${formId}`)).json();
    expect(after.request_form_path).toBe(second);
    expect(new Date(after.request_uploaded_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.request_uploaded_at).getTime()
    );

    await apiLoginAs(request, 'student2');
    expect((await request.post(`${API_URL}/intents/${formId}/withdraw`)).status()).toBe(200);
    await apiLoginAs(request, 'staff1');
    expect((await request.get(`${API_URL}/intents/${formId}`)).status()).toBe(404);
  });

  test('R3: รับแล้วไม่มีหนังสือ → หน้าแรกเห็น → ออกใหม่ → เข้าคิวคณบดี · ออกซ้ำ 409 · เจ้าหน้าที่เท่านั้น', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    await upload(request, formId);
    await apiLoginAs(request, 'staff1');

    // ใบที่ยังไม่ถูกรับ ออกหนังสือไม่ได้ — ทางนี้ไม่ใช่ทางลัดข้ามการรับคำร้อง
    const tooEarly = await request.post(`${API_URL}/intents/${formId}/cover-letter/reissue`);
    expect(tooEarly.status()).toBe(409);
    expect(await coverLetters(formId)).toHaveLength(0);

    expect((await officerApprove(request, formId, { document_no: 'อว 0656.10/3' })).status()).toBe(200);
    expect(await missingOnHome(request)).not.toContain(formId);

    // สภาพ "รับแล้วแต่หนังสือไม่ออก": ใบผ่านแล้ว เลขออกแล้ว บริษัทรับรองแล้ว แต่ไม่มีแถวหนังสือ
    await dbExec(`DELETE FROM official_documents WHERE type = 'cover_letter'`);
    expect(await missingOnHome(request)).toContain(formId);

    for (const account of ['student2', 'advisor1', 'head1', 'dean1'] as const) {
      await apiLoginAs(request, account);
      expect(
        (await request.post(`${API_URL}/intents/${formId}/cover-letter/reissue`)).status(),
        `${account} ต้องสั่งออกหนังสือไม่ได้`
      ).toBe(403);
    }
    expect(await coverLetters(formId)).toHaveLength(0);

    await apiLoginAs(request, 'staff1');
    const reissued = await request.post(`${API_URL}/intents/${formId}/cover-letter/reissue`);
    expect(reissued.status(), await reissued.text()).toBe(200);

    const docs = await coverLetters(formId);
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe('pending_sign');
    expect(docs[0].document_number).toBe('อว 0656.10/3');
    expect(fs.existsSync(path.resolve(__dirname, '../../backend', docs[0].generated_file_path))).toBe(true);
    expect(await missingOnHome(request)).not.toContain(formId);

    // เข้าคิวคณบดีจริง — คณบดีเห็นและลงนามได้
    await deanSign(request, docs[0].doc_id);

    await apiLoginAs(request, 'staff1');
    const again = await request.post(`${API_URL}/intents/${formId}/cover-letter/reissue`);
    expect(again.status()).toBe(409);
    expect((await again.json()).message).toContain('มีหนังสือขอความอนุเคราะห์อยู่แล้ว');
    expect(await coverLetters(formId)).toHaveLength(1);
  });

  test('R4: ฟอนต์หายตอนรับคำร้อง → ตอบว่ารับแล้วพร้อมธงว่าหนังสือยังไม่ออก ไม่ใช่ 400 · ใส่ฟอนต์คืนแล้วออกใหม่ได้', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    await upload(request, formId);
    await apiLoginAs(request, 'staff1');

    fs.renameSync(FONT, FONT_HIDDEN);
    try {
      const approved = await officerApprove(request, formId, { document_no: 'อว 0656.10/4' });
      expect(approved.status(), await approved.text()).toBe(200);
      const body = await approved.json();
      expect(body.cover_letter_issued).toBe(false);
      expect(body.cover_letter_error).toContain('ฟอนต์');
      // ⛔ สาเหตุที่ส่งออกไปต้องไม่มี path ของเครื่องแม่ข่าย
      expect(body.cover_letter_error).not.toContain('secure_private');

      // การรับเกิดขึ้นจริงครบ — ห้ามย้อนเพราะหนังสือล้ม
      const row = (await formRow(formId))!;
      expect(row.status).toBe('approved_by_dept_head');
      expect(row.officer_document_no).toBe('อว 0656.10/4');
      expect(await coverLetters(formId)).toHaveLength(0);
      expect(await missingOnHome(request)).toContain(formId);

      const stillBroken = await request.post(`${API_URL}/intents/${formId}/cover-letter/reissue`);
      expect(stillBroken.status()).toBe(500);
      expect((await stillBroken.json()).message).toContain('ฟอนต์');
      expect(await coverLetters(formId)).toHaveLength(0);
    } finally {
      fs.renameSync(FONT_HIDDEN, FONT);
    }

    const reissued = await request.post(`${API_URL}/intents/${formId}/cover-letter/reissue`);
    expect(reissued.status(), await reissued.text()).toBe(200);
    expect(await coverLetters(formId)).toHaveLength(1);
    expect(await missingOnHome(request)).not.toContain(formId);
  });

  test('R5: เลขที่หนังสือยาว 100 ตัวอักษรออกหนังสือได้ · 101 ตัว = 400 บอกว่าช่องไหน', async ({ request }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    await upload(request, formId);
    await apiLoginAs(request, 'staff1');

    const tooLong = await officerApprove(request, formId, { document_no: '9'.repeat(101) });
    expect(tooLong.status()).toBe(400);
    expect((await tooLong.json()).message).toBe('เลขที่หนังสือออกยาวเกิน 100 ตัวอักษร');
    expect((await formRow(formId))!.status).toBe('pending_officer_request');

    // เดิม official_documents.document_number กว้าง 50 — เลขยาว 51–100 ผ่านการรับแล้วล้มตอนบันทึกหนังสือ
    const longest = '9'.repeat(100);
    const ok = await officerApprove(request, formId, { document_no: longest });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).cover_letter_issued).toBe(true);
    const docs = await coverLetters(formId);
    expect(docs).toHaveLength(1);
    expect(docs[0].document_number).toBe(longest);
  });

  test('R6: เลขที่หนังสือซ้ำกับคำร้องใบอื่น → เตือนพร้อมชื่อนักศึกษาของใบนั้น · ยืนยันแล้วใช้ซ้ำได้', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const { studentCode } = await approvedFormOfAnotherStudent('อว 0656.10/ซ้ำ');
    const formId = await seedIntent();
    await upload(request, formId);
    await apiLoginAs(request, 'staff1');

    const warned = await officerApprove(request, formId, { document_no: 'อว 0656.10/ซ้ำ' });
    expect(warned.status(), await warned.text()).toBe(409);
    const body = await warned.json();
    expect(body.code).toBe('duplicate_document_no');
    expect(body.duplicate_student).toContain('อีกคน ทดสอบ');
    expect(body.duplicate_student).toContain(studentCode);
    expect((await formRow(formId))!.status).toBe('pending_officer_request');

    // เตือน ไม่บล็อก — ยังไม่รู้ว่าของจริงหนังสือฉบับเดียวครอบหลายคนได้หรือไม่
    const confirmed = await officerApprove(request, formId, {
      document_no: 'อว 0656.10/ซ้ำ',
      allow_duplicate_no: true,
    });
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    expect((await formRow(formId))!.officer_document_no).toBe('อว 0656.10/ซ้ำ');
  });

  test('R7: แก้เลขที่หนังสือได้จนกว่าคณบดีลงนาม — แก้สองที่พร้อมกัน หนังสือไม่หลุดจากใบ · ลงนามแล้ว 409', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    await approvedFormOfAnotherStudent('อว 0656.10/ซ้ำ');
    const formId = await seedIntent();
    await upload(request, formId);
    await apiLoginAs(request, 'staff1');
    expect((await officerApprove(request, formId, { document_no: 'อว 0656.10/ผิด' })).status()).toBe(200);
    const [draft] = await coverLetters(formId);

    const change = (data: Record<string, unknown>) =>
      request.patch(`${API_URL}/intents/${formId}/document-no`, { data });

    for (const account of ['student2', 'advisor1', 'head1', 'dean1'] as const) {
      await apiLoginAs(request, account);
      expect((await change({ document_no: 'อว 0656.10/แอบแก้' })).status(), `${account} ต้องแก้เลขไม่ได้`).toBe(403);
    }
    await apiLoginAs(request, 'staff1');

    expect((await change({ document_no: '   ' })).status()).toBe(400);
    expect((await change({ document_no: '9'.repeat(101) })).status()).toBe(400);

    const dup = await change({ document_no: 'อว 0656.10/ซ้ำ' });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).code).toBe('duplicate_document_no');
    expect((await formRow(formId))!.officer_document_no).toBe('อว 0656.10/ผิด');

    const fixed = await change({ document_no: 'อว 0656.10/ถูก' });
    expect(fixed.status(), await fixed.text()).toBe(200);
    expect((await fixed.json()).cover_letter_redrawn).toBe(true);

    // ⛔ สองที่ต้องเปลี่ยนพร้อมกัน และยังเป็นแถวหนังสือเดิม (ไม่งอกแถวใหม่ในคิวคณบดี)
    expect((await formRow(formId))!.officer_document_no).toBe('อว 0656.10/ถูก');
    const docs = await coverLetters(formId);
    expect(docs).toHaveLength(1);
    expect(docs[0].doc_id).toBe(draft.doc_id);
    expect(docs[0].document_number).toBe('อว 0656.10/ถูก');
    expect(docs[0].status).toBe('pending_sign');
    // ไฟล์ฉบับยังไม่ลงนามถูกวาดใหม่ (เลขเก่าพิมพ์อยู่ในไฟล์เดิม)
    expect(docs[0].generated_file_path).not.toBe(draft.generated_file_path);
    expect(fs.existsSync(path.resolve(__dirname, '../../backend', docs[0].generated_file_path))).toBe(true);

    // หนังสือยังจับคู่กับใบ — เส้นที่ทั้งระบบใช้อ่านสถานะหนังสือยังเห็น และหน้าแรกไม่นับเป็นใบไม่มีหนังสือ
    const listed = (await (await request.get(`${API_URL}/intents?status=approved_by_dept_head`)).json()) as {
      form_id: number;
      cover_letter_status: string | null;
    }[];
    expect(listed.find((r) => r.form_id === formId)?.cover_letter_status).toBe('pending_sign');
    expect(await missingOnHome(request)).not.toContain(formId);

    await expect
      .poll(
        () =>
          dbRow<{ from: string; to: string }>(
            `SELECT detail->>'from' AS "from", detail->>'to' AS "to" FROM audit_log
              WHERE action = 'intent.document_no_changed' AND entity_id = $1`,
            [String(formId)]
          ),
        { timeout: 5000 }
      )
      .toEqual({ from: 'อว 0656.10/ผิด', to: 'อว 0656.10/ถูก' });

    await deanSign(request, draft.doc_id);
    await apiLoginAs(request, 'staff1');
    const tooLate = await change({ document_no: 'อว 0656.10/สายไป' });
    expect(tooLate.status()).toBe(409);
    expect((await tooLate.json()).code).toBe('letter_signed');
    expect((await formRow(formId))!.officer_document_no).toBe('อว 0656.10/ถูก');
    expect((await coverLetters(formId))[0].document_number).toBe('อว 0656.10/ถูก');
  });

  test('R8: ประวัติการตีกลับและ "ส่งครั้งที่ N" — เจ้าหน้าที่เห็น · บทบาทอื่นที่ใช้เส้นเดียวกันไม่เห็น', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent();
    await upload(request, formId);

    await apiLoginAs(request, 'staff1');
    const first = await (await request.get(`${API_URL}/intents/${formId}`)).json();
    expect(first.officer_review).toEqual({
      submission_no: 1,
      last_return: null,
      last_letter_recall: null,
      late_memo: null,
    });

    const reason = 'ลายเซ็นหัวหน้าสาขาวิชายังไม่ครบ';
    expect(
      (await request.patch(`${API_URL}/intents/${formId}/officer-reject`, { data: { reason } })).status()
    ).toBe(200);

    // ส่งใหม่ = เหตุผลบนแถวใบถูกล้าง (ของเดิม) — ประวัติต้องยังอยู่กับเหตุการณ์
    await upload(request, formId);
    expect(await dbValue('SELECT reject_reason FROM intent_forms WHERE form_id = $1', [formId])).toBeNull();
    // เปลี่ยนไฟล์ระหว่างรอ ไม่ใช่การส่งครั้งใหม่
    await upload(request, formId);

    const staffName = await dbValue<string | null>(
      `SELECT NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '') FROM users u
         LEFT JOIN personnel p ON p.personnel_id = u.user_id WHERE u.email = 'staff1@test.com'`
    );

    await apiLoginAs(request, 'staff1');
    const second = await (await request.get(`${API_URL}/intents/${formId}`)).json();
    expect(second.officer_review.submission_no).toBe(2);
    expect(second.officer_review.last_return.reason).toBe(reason);
    expect(second.officer_review.last_return.by_name).toBe(staffName ?? null);
    expect(second.officer_review.last_return.returned_at).toBeTruthy();

    // บันทึกข้อความชี้แจงการส่งช้าของใบนี้
    await dbExec(
      `INSERT INTO student_memos (student_id, semester_id, memo_type, intent_form_id, reason)
       SELECT student_id, semester_id, 'late_submission', form_id, 'หัวหน้าสาขาวิชาไปราชการ จึงลงนามช้า'
         FROM intent_forms WHERE form_id = $1`,
      [formId]
    );
    const withMemo = await (await request.get(`${API_URL}/intents/${formId}`)).json();
    expect(withMemo.officer_review.late_memo.memo_id).toBeTruthy();

    // ⛔ ชื่อเจ้าหน้าที่และเหตุผลภายในต้องไม่ไปถึงบทบาทอื่น
    for (const account of ['student2', 'advisor1'] as const) {
      await apiLoginAs(request, account);
      const res = await request.get(`${API_URL}/intents/${formId}`);
      expect(res.status(), account).toBe(200);
      expect(await res.json(), `${account} ต้องไม่ได้ officer_review`).not.toHaveProperty('officer_review');
    }

    // การตีกลับก่อนมีคอลัมน์เหตุผล (แถวเก่า) = ไม่มีอะไรให้แสดง ห้ามแต่ง
    await dbExec(
      `INSERT INTO intent_stage_events (form_id, stage, entered_at)
       VALUES ($1, 'request_returned', NOW() + INTERVAL '1 minute')`,
      [formId]
    );
    await apiLoginAs(request, 'staff1');
    const legacy = await (await request.get(`${API_URL}/intents/${formId}`)).json();
    expect(legacy.officer_review.submission_no).toBe(3);
    expect(legacy.officer_review.last_return).toBeNull();
  });
});
