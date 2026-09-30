import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { spawn, execSync, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs, ACCOUNTS } from '../helpers/auth';
import type { AccountKey } from '../helpers/auth';
import { approveIntentThroughOfficer, coverLetterDocId, deanSign, walkToSigned } from '../helpers/intent';

/**
 * นักศึกษาส่งหนังสือขอความอนุเคราะห์ + แบบตอบรับถึงสถานประกอบการเอง
 * (แทนระบบที่เคยส่งอีเมลและสร้างบัญชีบริษัทตอนคณบดีลงนาม — เจ้าของสั่ง 2026-09-29)
 *
 * `POST /api/intents/:id/send-to-company` คือช่องที่ให้ผู้ใช้สั่งระบบส่งเอกสารที่คณบดีลงนาม
 * จากโดเมนมหาวิทยาลัยไปที่อยู่ใดก็ได้ จึงคุม **ด่านก่อนหน้าตา**:
 *   เจ้าของใบ → หนังสือ signed → สถานะใบ → ที่อยู่เดียวรูปแบบถูก → เพดาน 3 ครั้ง
 *
 * ทางสำเร็จของ backend หลักไม่ออกเน็ต: `playwright.config.ts` ตั้ง `MAIL_DRY_RUN=true`
 * (nodemailer jsonTransport) · ทางส่งล้ม (M7) สตาร์ท backend อีกตัวที่ชี้ SMTP ไปพอร์ตที่ไม่มีใครฟัง
 *
 * M10 (เมลที่ออกแนบครบสองไฟล์ + replyTo) ไม่ทำ — jsonTransport คืนค่าให้เฉพาะโค้ดที่เรียก
 * `sendMail` ตรงๆ แต่ E2E คุยกับ backend ผ่าน HTTP อย่างเดียว ไม่มีทางอ่านเมลที่ออก
 * (ต้องเพิ่ม hook/ที่ดักเมลในโค้ดจริง ซึ่งขัดกับกฎ "ห้ามใส่ทางลัดในโค้ดจริง")
 */

const MENTOR = {
  name: 'สุรเดช ใจดี',
  email: 'suradech-mail@example.com',
  phone: '0812223333',
  start_date: '2026-11-02',
};

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

/** ตั้งอีเมลบริษัทของใบนี้ (คืนค่าเดิมไม่จำเป็น — ทุกเทสต์ seed ใหม่) */
async function setCompanyEmail(formId: number, email: string): Promise<void> {
  await dbExec(
    `UPDATE companies SET email = $1
      WHERE company_id = (SELECT company_id FROM intent_forms WHERE form_id = $2)`,
    [email, formId]
  );
}

/** เดินถึง `accepted` แล้วออกหนังสือส่งตัว (pending_sign) — คืน doc_id ของหนังสือส่งตัว */
async function walkToIssuedDispatch(request: APIRequestContext, formId: number): Promise<number> {
  await walkToSigned(request, formId);

  const today = (await dbValue<string>(
    `SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`
  )) as string;

  await apiLoginAs(request, 'student2');
  const upload = await request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
    multipart: {
      evidence: {
        name: 'acceptance.pdf',
        mimeType: 'application/pdf',
        buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
      },
      ...MENTOR,
      signer_name: 'คุณสมชาย ทรงชัย',
      signer_position: 'ผู้จัดการฝ่ายบุคคล',
      signed_date: today,
    },
  });
  expect(upload.status(), await upload.text()).toBe(200);

  await apiLoginAs(request, 'staff1');
  const accepted = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
    data: { action: 'accepted' },
  });
  expect(accepted.status(), await accepted.text()).toBe(200);

  const issued = await request.post(`${API_URL}/intents/${formId}/dispatch-letter`, {
    data: { document_no: 'อว 0656.10/ส่งตัว-m8', end_date: '2027-02-19' },
  });
  expect(issued.status(), await issued.text()).toBe(200);

  return (await dbValue<number>(
    "SELECT doc_id FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1"
  )) as number;
}

const sendMail = (request: APIRequestContext, formId: number, body: unknown) =>
  request.post(`${API_URL}/intents/${formId}/send-to-company`, { data: body as object });

async function mailState(formId: number) {
  const row = await dbRow<{ to: string | null; sent_at: string | null; count: number }>(
    `SELECT company_mail_to AS "to", company_mail_sent_at AS sent_at, company_mail_count AS count
       FROM intent_forms WHERE form_id = $1`,
    [formId]
  );
  return row!;
}

const NOTHING_SENT = { to: null, sent_at: null, count: 0 };

test.describe('นักศึกษาส่งหนังสือให้สถานประกอบการเอง — ด่านและผลข้างเคียง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('M1: หนังสือยังไม่ลงนาม → ส่งไม่ได้ (409) และไม่มีคอลัมน์ไหนเปลี่ยน', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();

    // ก่อนเจ้าหน้าที่รับคำร้อง — ยังไม่มีหนังสือเลย
    await apiLoginAs(request, 'student2');
    const noDoc = await sendMail(request, formId, { company_email: 'hr@example.com' });
    expect(noDoc.status(), await noDoc.text()).toBe(409);
    expect((await noDoc.json()).message as string).toContain('คณบดียังไม่ลงนาม');
    expect(await mailState(formId)).toEqual(NOTHING_SENT);

    // เจ้าหน้าที่รับแล้วแต่หนังสืออยู่คิวคณบดี (pending_sign) — ยังต้อง 409
    await approveIntentThroughOfficer(request, formId);
    expect(
      await dbValue<string>('SELECT status FROM official_documents WHERE doc_id = $1', [
        await coverLetterDocId(),
      ])
    ).toBe('pending_sign');

    await apiLoginAs(request, 'student2');
    const pending = await sendMail(request, formId, { company_email: 'hr@example.com' });
    expect(pending.status(), await pending.text()).toBe(409);
    expect((await pending.json()).message as string).toContain('คณบดียังไม่ลงนาม');
    expect(await mailState(formId)).toEqual(NOTHING_SENT);
    expect(
      await dbValue<string>(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'intent.cover_letter_emailed'"
      )
    ).toBe('0');
  });

  test('M2: ลงนามแล้ว → ส่งได้ (200) · to/sent_at/count ถูกต้อง · มี audit', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);

    await apiLoginAs(request, 'student2');
    // ตัดช่องว่างหัวท้ายให้ (trim) — ที่อยู่ที่ถูกเก็บต้องเป็นตัวที่ตัดแล้ว
    const res = await sendMail(request, formId, { company_email: '  HR-Team@Example.com ' });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json();
    expect(body.company_mail_to).toBe('HR-Team@Example.com');
    expect(body.company_mail_count).toBe(1);
    expect(body.company_mail_limit).toBe(3);
    expect(body.company_mail_sent_at).toBeTruthy();

    const state = await mailState(formId);
    expect(state.to).toBe('HR-Team@Example.com');
    expect(state.count).toBe(1);
    expect(state.sent_at).not.toBeNull();
    // สถานะใบไม่ขยับ — การส่งอีเมลไม่ใช่การเปลี่ยนขั้นของคำร้อง
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'approved_by_dept_head'
    );

    // writeAudit เป็น fire-and-forget → รอให้แถวโผล่
    await expect
      .poll(
        async () =>
          dbRow<{ to: string; actor: string; subject: number }>(
            `SELECT detail->>'to' AS "to", actor_email AS actor, subject_id AS subject
               FROM audit_log
              WHERE action = 'intent.cover_letter_emailed' AND entity_id = $1`,
            [String(formId)]
          ),
        { timeout: 10_000 }
      )
      .toMatchObject({ to: 'HR-Team@Example.com', actor: 'student2@test.com' });
  });

  test('M3: ที่อยู่ไม่ผ่าน (รูปแบบผิด · หลายที่อยู่ · ขึ้นบรรทัดใหม่ · ยาวเกิน 254) → 400 · ฐานไม่เปลี่ยน', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    await apiLoginAs(request, 'student2');

    const bad: Array<[string, unknown]> = [
      ['รูปแบบผิด', { company_email: 'not-an-email' }],
      ['ไม่มีโดเมน', { company_email: 'someone@' }],
      ['หลายที่อยู่ด้วย ,', { company_email: 'a@example.com,b@example.com' }],
      ['หลายที่อยู่ด้วย ;', { company_email: 'a@example.com;b@example.com' }],
      ['เว้นวรรคกลางที่อยู่', { company_email: 'a@example.com b@example.com' }],
      ['ขึ้นบรรทัดใหม่ (\\r\\n) — header injection', { company_email: 'a@example.com\r\nBcc: victim@example.com' }],
      ['ขึ้นบรรทัดใหม่ (\\n)', { company_email: 'a@example.com\nb@example.com' }],
      ['ยาวเกิน 254', { company_email: `${'a'.repeat(250)}@example.com` }],
      ['ค่าว่าง', { company_email: '   ' }],
      ['ไม่ส่งฟิลด์', {}],
      ['ไม่ใช่สตริง', { company_email: ['a@example.com'] }],
    ];

    for (const [label, body] of bad) {
      const res = await sendMail(request, formId, body);
      expect(res.status(), `${label}: ${await res.text()}`).toBe(400);
      expect((await mailState(formId)), label).toEqual(NOTHING_SENT);
    }

    // ยืนยันว่า 400 ไม่ได้มาจากด่านอื่น — ที่อยู่ปกติต้องผ่านในใบเดียวกันนี้
    const ok = await sendMail(request, formId, { company_email: 'hr@example.com' });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await mailState(formId)).count).toBe(1);
  });

  test('M4: ใบของคนอื่น → 403 · role อื่น → 403 · ไม่ล็อกอิน → 401 · ฐานไม่เปลี่ยน', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);

    const payload = { company_email: 'hr@example.com' };

    await apiLoginAs(request, 'student1');
    const other = await sendMail(request, formId, payload);
    expect(other.status(), await other.text()).toBe(403);

    // ใบที่ไม่มีอยู่ → 404 (ระบบตอบต่างจาก "ของคนอื่น" อยู่แล้ว — คุมตามจริง)
    const missing = await sendMail(request, 999999, payload);
    expect(missing.status()).toBe(404);

    const roles: AccountKey[] = ['staff1', 'advisor1', 'head1', 'dean1', 'company1'];
    for (const role of roles) {
      await apiLoginAs(request, role);
      const res = await sendMail(request, formId, payload);
      expect(res.status(), `${role}: ${await res.text()}`).toBe(403);
    }

    // ไม่ล็อกอิน — ต้องเป็น context ใหม่ที่ไม่มี cookie
    const anon = await playwrightRequest.newContext();
    try {
      const res = await anon.post(`${API_URL}/intents/${formId}/send-to-company`, { data: payload });
      expect(res.status()).toBe(401);
    } finally {
      await anon.dispose();
    }

    expect(await mailState(formId)).toEqual(NOTHING_SENT);
  });

  test('M5: ครั้งที่ 4 → 429 · count ค้างที่ 3 · to/sent_at ยังเป็นของครั้งที่ 3', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    await apiLoginAs(request, 'student2');

    for (let i = 1; i <= 3; i++) {
      const res = await sendMail(request, formId, { company_email: `hr${i}@example.com` });
      expect(res.status(), `ครั้งที่ ${i}: ${await res.text()}`).toBe(200);
      expect((await res.json()).company_mail_count).toBe(i);
    }
    const third = await mailState(formId);
    expect(third.count).toBe(3);
    expect(third.to).toBe('hr3@example.com');

    const fourth = await sendMail(request, formId, { company_email: 'hr4@example.com' });
    expect(fourth.status(), await fourth.text()).toBe(429);
    expect((await fourth.json()).message as string).toContain('ครบ 3 ครั้ง');

    expect(await mailState(formId)).toEqual(third);
  });

  // รายการ (ฉ) ใน known_issues — ตีกลับแล้วนักศึกษาต้องส่งให้บริษัทใหม่ได้ครบ 3 ครั้งอีกรอบ
  // (รีเซ็ตนับตอน "เจ้าหน้าที่ตีกลับ" เท่านั้น — มีคนกดทุกครั้ง จึงใช้เป็นช่องส่งเมลซ้ำไม่ได้)
  test('M5b: เจ้าหน้าที่ตีกลับแบบตอบรับ → company_mail_count กลับเป็น 0 และส่งใหม่ได้', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);

    const today = (await dbValue<string>(
      `SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`
    )) as string;
    await apiLoginAs(request, 'student2');
    const upload = await request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
      multipart: {
        evidence: {
          name: 'acceptance.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
        },
        ...MENTOR,
        signer_name: 'คุณสมชาย ทรงชัย',
        signer_position: 'ผู้จัดการฝ่ายบุคคล',
        signed_date: today,
      },
    });
    expect(upload.status(), await upload.text()).toBe(200);

    // จำลองว่านักศึกษาใช้โควตาหมดแล้ว
    await dbExec('UPDATE intent_forms SET company_mail_count = 3 WHERE form_id = $1', [formId]);
    expect((await mailState(formId)).count).toBe(3);

    await apiLoginAs(request, 'staff1');
    const returned = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
      data: { action: 'rejected', reason: 'ลายเซ็นบนแบบตอบรับไม่ชัด' },
    });
    expect(returned.status(), await returned.text()).toBe(200);
    expect((await mailState(formId)).count).toBe(0);

    await apiLoginAs(request, 'student2');
    const resend = await sendMail(request, formId, { company_email: 'hr-resend@example.com' });
    expect(resend.status(), await resend.text()).toBe(200);
    expect((await resend.json()).company_mail_count).toBe(1);
  });

  // เจ้าหน้าที่ตีกลับ (reject_reason ตั้ง) → นักศึกษาส่งใหม่สำเร็จ = ลงมือตามที่ถูกตีกลับแล้ว
  // เหตุผลต้องถูกล้างจากแถว ไม่งั้นการ์ด "สิ่งที่ต้องทำตอนนี้" ค้างที่ "ต้องทำ" ทั้งที่ส่งไปแล้ว
  test('M5c: ตีกลับแล้วส่งใหม่สำเร็จ → reject_reason เป็น NULL · การ์ดสถานะเปลี่ยนจาก returned เป็น wait-company', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);

    const today = (await dbValue<string>(
      `SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`
    )) as string;
    await apiLoginAs(request, 'student2');
    const upload = await request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
      multipart: {
        evidence: {
          name: 'acceptance.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
        },
        ...MENTOR,
        signer_name: 'คุณสมชาย ทรงชัย',
        signer_position: 'ผู้จัดการฝ่ายบุคคล',
        signed_date: today,
      },
    });
    expect(upload.status(), await upload.text()).toBe(200);

    await apiLoginAs(request, 'staff1');
    const returned = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
      data: { action: 'rejected', reason: 'ลายเซ็นบนแบบตอบรับไม่ชัด' },
    });
    expect(returned.status(), await returned.text()).toBe(200);
    expect(
      await dbValue<string>('SELECT reject_reason FROM intent_forms WHERE form_id = $1', [formId])
    ).toBe('ลายเซ็นบนแบบตอบรับไม่ชัด');

    // ก่อนส่งใหม่ — การ์ดอยู่ที่ "ต้องทำ"
    await loginAs(page, 'student2');
    await expect(page.getByTestId('status-card')).toHaveAttribute('data-state', 'returned');

    await apiLoginAs(request, 'student2');
    const resend = await sendMail(request, formId, { company_email: 'hr-resend@example.com' });
    expect(resend.status(), await resend.text()).toBe(200);
    expect(
      await dbValue<string | null>('SELECT reject_reason FROM intent_forms WHERE form_id = $1', [formId])
    ).toBeNull();

    await page.reload();
    await expect(page.getByTestId('status-card')).toHaveAttribute('data-state', 'wait-company');
  });

  test('M6: สถานะใบไม่ใช่ approved_by_dept_head (accepted / company_rejected / rejected) → 409', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);

    for (const status of ['accepted', 'company_rejected', 'rejected']) {
      await dbExec('UPDATE intent_forms SET status = $2 WHERE form_id = $1', [formId, status]);
      await apiLoginAs(request, 'student2');
      const res = await sendMail(request, formId, { company_email: 'hr@example.com' });
      expect(res.status(), `${status}: ${await res.text()}`).toBe(409);
      expect(await mailState(formId), status).toEqual(NOTHING_SENT);
    }

    // กลับเป็นสถานะที่ส่งได้ → ผ่าน (พิสูจน์ว่า 409 ข้างบนมาจากสถานะจริง ไม่ใช่ด่านอื่น)
    await dbExec("UPDATE intent_forms SET status = 'approved_by_dept_head' WHERE form_id = $1", [
      formId,
    ]);
    const ok = await sendMail(request, formId, { company_email: 'hr@example.com' });
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('M8a: คณบดีลงนามหนังสือขอความอนุเคราะห์ → ไม่สร้างบัญชี ไม่นับการส่ง', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    // ⚠️ ต้องเป็นอีเมลที่ยังไม่มีบัญชี — company1@test.com ของ seed มีบัญชีอยู่แล้ว
    //    ระบบเดิมจึงไม่สร้างอะไรอยู่ดี เทสต์จะผ่านทั้งที่ไม่พิสูจน์อะไร
    const fresh = 'm8-fresh-company@example.com';
    await setCompanyEmail(formId, fresh);
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [fresh])).toBe('0');

    await approveIntentThroughOfficer(request, formId);
    const docId = await coverLetterDocId();

    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');
    const companyRolesBefore = await dbValue<string>(
      "SELECT COUNT(*) FROM user_roles WHERE role_name = 'company'"
    );

    await deanSign(request, docId);
    // ระบบเดิมสร้างบัญชี+ส่งเมลแบบ fire-and-forget หลังตอบ 200 — รอให้มันมีเวลาทำงานก่อนนับ
    await new Promise((r) => setTimeout(r, 3_000));

    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);
    expect(await dbValue<string>("SELECT COUNT(*) FROM user_roles WHERE role_name = 'company'")).toBe(
      companyRolesBefore
    );
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [fresh])).toBe('0');
    expect(await mailState(formId)).toEqual(NOTHING_SENT);
    expect(await dbValue<string>('SELECT status FROM official_documents WHERE doc_id = $1', [docId])).toBe(
      'signed'
    );
  });

  test('M8b: คณบดีลงนามหนังสือส่งตัว → ไม่สร้างบัญชี ไม่นับการส่ง', async ({ request }) => {
    test.setTimeout(240_000);
    const formId = await seedIntent();
    const fresh = 'm8-fresh-dispatch@example.com';
    await setCompanyEmail(formId, fresh);
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [fresh])).toBe('0');

    const dispatchDocId = await walkToIssuedDispatch(request, formId);

    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');
    const companyRolesBefore = await dbValue<string>(
      "SELECT COUNT(*) FROM user_roles WHERE role_name = 'company'"
    );

    await deanSign(request, dispatchDocId);
    expect(
      await dbValue<string>('SELECT status FROM official_documents WHERE doc_id = $1', [
        dispatchDocId,
      ])
    ).toBe('signed');
    await new Promise((r) => setTimeout(r, 3_000));

    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);
    expect(await dbValue<string>("SELECT COUNT(*) FROM user_roles WHERE role_name = 'company'")).toBe(
      companyRolesBefore
    );
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [fresh])).toBe('0');
    expect((await mailState(formId)).count).toBe(0);
    expect((await mailState(formId)).sent_at).toBeNull();
  });

  test('M9: หน้าจอ — กล่องส่งโผล่หลังลงนามเท่านั้น · เติมอีเมลบริษัทให้ · ต้องยืนยันก่อนส่ง · ปุ่มเปิด PDF ยังอยู่', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    const companyMail = 'ui-hr-m9@example.com';
    await setCompanyEmail(formId, companyMail);

    await loginAs(page, 'student2');
    await expect(page.getByTestId('company-mail-box')).toHaveCount(0);

    await walkToSigned(request, formId);
    await page.reload();

    const box = page.getByTestId('company-mail-box');
    await expect(box).toBeVisible();
    await expect(box).toContainText('ส่งหนังสือให้สถานประกอบการ');
    await expect(page.getByTestId('company-mail-input')).toHaveValue(companyMail);
    await expect(page.getByTestId('company-mail-status')).toHaveCount(0);

    // ปุ่มเปิด PDF หนังสือ + แบบตอบรับที่มีอยู่แล้วต้องคงไว้ (ทางสำรองกรณีบริษัทรับกระดาษ)
    await expect(page.getByTestId('student-doc-cover_letter')).toContainText('เปิดอ่าน PDF');
    await expect(page.getByTestId('open-acceptance-form')).toBeVisible();

    // กดส่ง → ต้องเจอกล่องยืนยันก่อน — ระหว่างกล่องเปิดอยู่ต้องยังไม่มีอะไรถูกส่ง
    await page.getByTestId('company-mail-send').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(companyMail);
    await expect(dialog).toContainText('หนังสือขอความอนุเคราะห์');
    expect((await mailState(formId)).count).toBe(0);

    // ยกเลิก → ไม่ส่ง
    await page.getByTestId('company-mail-confirm-cancel').click();
    await expect(dialog).toHaveCount(0);
    expect(await mailState(formId)).toEqual(NOTHING_SENT);

    // กดใหม่แล้วยืนยัน → ส่ง
    await page.getByTestId('company-mail-send').click();
    await expect(page.getByRole('dialog')).toContainText(companyMail);
    expect((await mailState(formId)).count).toBe(0);
    await page.getByTestId('company-mail-confirm').click();

    await expect(page.getByTestId('company-mail-status')).toContainText(`ส่งถึง ${companyMail}`);
    // วันที่ส่งต้องเป็นวันที่ไทย พ.ศ. (เช่น "1 ต.ค. 2569") — เคยขึ้น "NaN" เพราะส่ง timestamp เข้า formatThaiDate
    const statusText = (await page.getByTestId('company-mail-status').textContent()) ?? '';
    expect(statusText).not.toContain('NaN');
    expect(statusText).toMatch(/เมื่อ \d{1,2} (ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.) 25\d{2}/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const state = await mailState(formId);
    expect(state.count).toBe(1);
    expect(state.to).toBe(companyMail);
    expect(state.sent_at).not.toBeNull();

    // ส่งแล้วปุ่มเปิด PDF ทั้งสองยังอยู่
    await expect(page.getByTestId('student-doc-cover_letter')).toContainText('เปิดอ่าน PDF');
    await expect(page.getByTestId('open-acceptance-form')).toBeVisible();
  });

  test('M9b: หน้าจอ — ส่งครบ 3 ครั้งแล้วปุ่มปิดพร้อมบอกเหตุผล · error ของเซิร์ฟเวอร์ขึ้นในกล่อง', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);

    await loginAs(page, 'student2');
    await expect(page.getByTestId('company-mail-box')).toBeVisible();

    // ที่อยู่ที่ไม่ผ่านด่านของเซิร์ฟเวอร์ (browser type=email ไม่ขวางตอนกดปุ่มเอง) → error ในกล่อง
    await page.getByTestId('company-mail-input').fill('a@example.com,b@example.com');
    await page.getByTestId('company-mail-send').click();
    await page.getByTestId('company-mail-confirm').click();
    await expect(page.getByTestId('company-mail-error')).toContainText('อีเมลสถานประกอบการไม่ถูกต้อง');
    expect(await mailState(formId)).toEqual(NOTHING_SENT);

    // ครบเพดาน → ปุ่มปิด + ข้อความบอกเหตุผล
    await dbExec('UPDATE intent_forms SET company_mail_count = 3 WHERE form_id = $1', [formId]);
    await page.reload();
    await expect(page.getByTestId('company-mail-limit')).toContainText('ส่งครบ 3 ครั้งแล้ว');
    await expect(page.getByTestId('company-mail-send')).toBeDisabled();
  });
});

/**
 * M7 — ส่งล้ม: ต้องตอบ 502 · ไม่ตั้ง sent_at/to · ไม่นับครั้ง
 *
 * ทำกับ backend หลักไม่ได้ (MAIL_DRY_RUN=true ทำให้ส่งสำเร็จเสมอ) จึงสตาร์ท backend อีกตัว
 * ตามแบบ `security/rate-limit.spec.ts` บนพอร์ต 5099 โดยปิด dry-run แล้วชี้ SMTP ไปพอร์ต 9
 * (ไม่มีใครฟัง → ECONNREFUSED ทันที · ไม่ออกเน็ต · ไม่ใช้โหมด production จึงไม่ต้องมี env production)
 */
const PORT = 5099;
const BASE = `http://127.0.0.1:${PORT}`;
let failingServer: ChildProcess | undefined;

async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const probe = await playwrightRequest.newContext();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      try {
        const res = await probe.get(`${BASE}/health`, { timeout: 2_000 });
        if (res.ok()) return;
      } catch {
        // ยังไม่ขึ้น
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`เซิร์ฟเวอร์ทดสอบไม่ขึ้นภายใน ${timeoutMs}ms`);
  } finally {
    await probe.dispose();
  }
}

test.describe('ส่งอีเมลล้ม (backend แยก · SMTP ใช้ไม่ได้)', () => {
  test.beforeAll(async () => {
    test.setTimeout(150_000);
    failingServer = spawn('npx ts-node src/index.ts', {
      cwd: path.resolve(__dirname, '../../backend'),
      env: {
        ...process.env,
        PORT: String(PORT),
        MAIL_DRY_RUN: 'false',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '9',
      },
      shell: true,
      stdio: 'ignore',
    });
    await waitForServer(120_000);
  });

  test.afterAll(async () => {
    if (!failingServer?.pid) return;
    // npx สร้างลูกหลาน การ kill แค่ตัวแม่จะทิ้งพอร์ตค้างไว้
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /pid ${failingServer.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        // โปรเซสอาจตายไปแล้ว
      }
    } else {
      failingServer.kill('SIGKILL');
    }
  });

  test('M7: ส่งล้ม → 502 · sent_at ไม่ถูกตั้ง · count ไม่เพิ่ม · ไม่มี audit ว่าส่งแล้ว', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    await seedTestData();
    const formId = await seedIntent();
    // เดินด้วย backend หลัก (ทางลงนามไม่เกี่ยวกับ SMTP)
    await walkToSigned(request, formId);

    const client = await playwrightRequest.newContext({ baseURL: BASE });
    try {
      const login = await client.post('/api/auth/login', {
        data: { email: ACCOUNTS.student2.email, password: 'password123' },
      });
      expect(login.status(), await login.text()).toBe(200);

      // ส่งล้มสองครั้งติด — ถ้าไม่คืนที่ ครั้งที่สามจะชนเพดานเป็น 429 แทนที่จะเป็น 502
      for (let i = 1; i <= 4; i++) {
        const res = await client.post(`/api/intents/${formId}/send-to-company`, {
          data: { company_email: 'hr@example.com' },
        });
        expect(res.status(), `ครั้งที่ ${i}: ${await res.text()}`).toBe(502);
        expect((await res.json()).message as string).toContain('ส่งอีเมลไม่สำเร็จ');
        expect(await mailState(formId), `ครั้งที่ ${i}`).toEqual(NOTHING_SENT);
      }
    } finally {
      await client.dispose();
    }

    // ลิงก์ตอบรับที่ออกไว้ก่อนส่ง (ครั้งละหนึ่งใบ) ต้องถูกยกเลิกทุกใบ — ส่งล้ม = ลิงก์ไม่ถึงมือบริษัท
    // จึงห้ามมีลิงก์ที่ใช้ได้เหลืออยู่ในฐาน
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM acceptance_link_tokens WHERE form_id = $1', [formId])
    ).toBe('4');
    expect(
      await dbValue<string>(
        'SELECT COUNT(*) FROM acceptance_link_tokens WHERE form_id = $1 AND revoked_at IS NULL',
        [formId]
      )
    ).toBe('0');

    // รอเผื่อ audit ที่ (ไม่ควร) เขียนแบบ fire-and-forget
    await new Promise((r) => setTimeout(r, 1_000));
    expect(
      await dbValue<string>(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'intent.cover_letter_emailed'"
      )
    ).toBe('0');
  });
});
