import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { withDb, dbRow, dbRows, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { walkToSigned, placementCard, confirmMentor } from '../helpers/intent';

/**
 * ลิงก์ตอบรับของสถานประกอบการ (เอกสารหมายเลข 2) — เจ้าของตัดสิน 2026-09-29:
 * บริษัทไม่มีบัญชี ตอบผ่านลิงก์ในอีเมลที่นักศึกษากดส่งอย่างเดียว
 * · 2026-10-05 เจ้าของสั่งตัดสหกิจ 07 ฝั่งบริษัททั้งก้อน — ลิงก์เหลือแค่ ดูเอกสาร + แนบเอกสาร 2 + รับ/ไม่รับ
 * · 2026-10-09 พี่เลี้ยงออกจากทางตอบรับทั้งหมด — เจ้าหน้าที่กดรับได้โดยไม่มีพี่เลี้ยง นักศึกษาระบุบนใบ `accepted`
 *   (`POST /intents/:id/mentor`) แล้วเจ้าหน้าที่ยืนยันที่ `POST /mentor-followup/:mentorId/confirm` (คุมหลักที่ `company/mentor-after-acceptance`)
 *
 * `/api/public/acceptance/*` **ไม่มีการล็อกอิน** สิทธิ์ทั้งหมดมาจาก token จึงคุม **ด่านก่อนหน้าตา**:
 *   token รู้จัก (404) → ใช้ครั้งเดียว/ไม่ยกเลิก/ไม่หมดอายุ (410) → ใบยังอยู่ขั้นรอตอบรับ (410)
 *   → ด่านทั้งหมดนี้ต้องอยู่ **ก่อน multer** (คำขอที่ไม่ผ่านต้องไม่เขียนไฟล์ลงดิสก์)
 *   → payload ที่บริษัทเห็นเป็น allow-list · "รับ" ไม่เขียนทะเบียนบริษัทและไม่สร้างบัญชีใดๆ
 *
 * L1 ออก/ยกเลิกลิงก์ · L2 token มั่ว/หมดอายุ/ใช้แล้ว · L3 payload allow-list · L4 ไม่รับ
 * L5 ด่านก่อน multer · L6 รับ · L7 เจ้าหน้าที่รับ/ตีกลับ (ไม่ต้องมีพี่เลี้ยง) · L8 SEC-03 ที่ `/mentor`
 * L9 สถานะใบ · L10 หน้าลิงก์ · L11 การ์ดสถานะของนักศึกษา · L15 นักศึกษาระบุพี่เลี้ยงบนหน้าจอ
 *
 * การส่งเมลไม่ออกเน็ต (`MAIL_DRY_RUN=true` ใน playwright.config.ts) · ข้อมูลทั้งหมดเป็นของปลอม
 */

const PUB = `${API_URL}/public/acceptance`;
const EVIDENCE_DIR = path.join(BACKEND_ROOT, 'uploads/acceptance_evidence');
const RESUME_DIR = path.join(BACKEND_ROOT, 'uploads/resumes');
const PDF_FIXTURE = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');

const evidenceCount = (): number =>
  fs.existsSync(EVIDENCE_DIR) ? fs.readdirSync(EVIDENCE_DIR).length : 0;

const pdfPart = () => ({
  name: 'acceptance-signed.pdf',
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(PDF_FIXTURE),
});

const todayTh = async () =>
  (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;

const MENTOR_EMAIL = 'mentor-link-l6@example.com';

const acceptFields = async (over: Record<string, string> = {}): Promise<Record<string, string>> => ({
  signer_name: 'คุณสมชาย ผู้จัดการฝ่ายบุคคล',
  signer_position: 'ผู้จัดการฝ่ายบุคคล',
  signed_date: await todayTh(),
  start_date: '2026-11-02',
  ...over,
});

/** พี่เลี้ยงที่นักศึกษาระบุ (ลิงก์ไม่ถามพี่เลี้ยงแล้ว) */
const mentorBody = (over: Record<string, string> = {}): Record<string, string> => ({
  name: 'สุรเดช ใจดี',
  email: MENTOR_EMAIL,
  phone: '0812223333',
  position: 'Supervisor',
  department: 'QA',
  ...over,
});

/** เจ้าหน้าที่กดรับแบบตอบรับ → ใบเป็น `accepted` (จุดเดียวที่นักศึกษาระบุพี่เลี้ยงได้) */
async function accept(request: APIRequestContext, formId: number) {
  await apiLoginAs(request, 'staff1');
  const res = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, { data: { action: 'accepted' } });
  expect(res.status(), await res.text()).toBe(200);
}

/** นักศึกษา (student2) ระบุพี่เลี้ยงของใบ — คืน response ให้เทสต์ตัดสินเอง */
async function postMentor(request: APIRequestContext, formId: number, body: Record<string, string> = mentorBody()) {
  await apiLoginAs(request, 'student2');
  return request.post(`${API_URL}/intents/${formId}/mentor`, { data: body });
}

async function seedIntent(): Promise<number> {
  return withDb(async (db) => {
    const studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0]
      .user_id;
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'))
      .rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'pending_advisor', '2026-11-02') RETURNING form_id`,
      [studentId, companyId, semesterId]
    );
    return res.rows[0].form_id as number;
  });
}

/** นักศึกษากดส่งหนังสือให้บริษัท → คืน token ใหม่ล่าสุดของใบ */
async function sendLink(
  request: APIRequestContext,
  formId: number,
  to = 'hr-link@example.com'
): Promise<{ token: string; tokenId: number }> {
  await apiLoginAs(request, 'student2');
  const res = await request.post(`${API_URL}/intents/${formId}/send-to-company`, {
    data: { company_email: to },
  });
  expect(res.status(), await res.text()).toBe(200);
  const row = await dbRow<{ token: string; token_id: number }>(
    'SELECT token, token_id FROM acceptance_link_tokens WHERE form_id = $1 ORDER BY token_id DESC LIMIT 1',
    [formId]
  );
  return { token: row!.token, tokenId: row!.token_id };
}

/** ใบ + คณบดีลงนามแล้ว + ลิงก์ที่ส่งถึงบริษัทแล้ว — จุดเริ่มของเกือบทุกเคส */
async function readyLink(request: APIRequestContext) {
  const formId = await seedIntent();
  await walkToSigned(request, formId);
  const link = await sendLink(request, formId);
  return { formId, ...link };
}

const formStatus = (formId: number) =>
  dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId]);

const tokenRow = (token: string) =>
  dbRow<{ used_at: string | null; revoked_at: string | null }>(
    'SELECT used_at, revoked_at FROM acceptance_link_tokens WHERE token = $1',
    [token]
  );

const companySnapshot = (formId: number) =>
  dbValue<Record<string, unknown>>(
    `SELECT to_jsonb(c) FROM companies c
      WHERE c.company_id = (SELECT company_id FROM intent_forms WHERE form_id = $1)`,
    [formId]
  );

test.describe('ลิงก์ตอบรับของสถานประกอบการ — ด่าน สิทธิ์ และผลข้างเคียง', () => {
  let anon: APIRequestContext;

  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    // ไม่มี cookie ใดๆ — บริษัทไม่ล็อกอิน
    anon = await playwrightRequest.newContext();
  });

  test.afterEach(async () => {
    await anon.dispose();
  });

  const postAccept = (token: string, fields: Record<string, string>, withFile = true) =>
    anon.post(`${PUB}/accept?token=${encodeURIComponent(token)}`, {
      multipart: { ...(withFile ? { evidence: pdfPart() } : {}), ...fields },
    });

  const getEvery = async (token: string) => {
    const paths = ['', '/cover-letter', '/acceptance-form', '/resume'];
    const results: Array<[string, number, any]> = [];
    for (const p of paths) {
      const res = await anon.get(`${PUB}${p}?token=${encodeURIComponent(token)}`);
      results.push([`GET ${p || '/'}`, res.status(), await res.json().catch(() => ({}))]);
    }
    const decline = await anon.post(`${PUB}/decline?token=${encodeURIComponent(token)}`, {
      data: { reason: 'ไม่มีตำแหน่ง' },
    });
    results.push(['POST /decline', decline.status(), await decline.json().catch(() => ({}))]);
    const accept = await postAccept(token, await acceptFields());
    results.push(['POST /accept', accept.status(), await accept.json().catch(() => ({}))]);
    return results;
  };

  test('L1: ส่งเมลแล้วเกิด token 1 ใบ · ส่งใหม่ = ใบเก่าถูกยกเลิกและใช้ไม่ได้ (410)', async ({ request }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);

    // ยังไม่ส่ง = ยังไม่มีลิงก์
    expect(await dbValue<string>('SELECT COUNT(*) FROM acceptance_link_tokens WHERE form_id = $1', [formId])).toBe('0');

    const first = await sendLink(request, formId, 'HR-One@Example.com');
    const rows = await dbRows<{ sent_to: string; revoked_at: string | null; used_at: string | null; ok_window: boolean }>(
      `SELECT sent_to, revoked_at, used_at,
              (expires_at > NOW() + interval '14 days' AND expires_at < NOW() + interval '30 days') AS ok_window
         FROM acceptance_link_tokens WHERE form_id = $1`,
      [formId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sent_to).toBe('HR-One@Example.com');
    expect(rows[0].revoked_at).toBeNull();
    expect(rows[0].used_at).toBeNull();
    // 15 วันทำการนับจากวันที่ส่ง ≥ 15 วันปฏิทิน และไม่เกินหนึ่งเดือน
    expect(rows[0].ok_window).toBe(true);
    expect(first.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect((await anon.get(`${PUB}?token=${first.token}`)).status()).toBe(200);

    // ส่งใหม่ → token ใหม่หนึ่งใบ · ใบเก่าถูกยกเลิก
    const second = await sendLink(request, formId, 'hr-two@example.com');
    expect(second.token).not.toBe(first.token);
    expect(await dbValue<string>('SELECT COUNT(*) FROM acceptance_link_tokens WHERE form_id = $1', [formId])).toBe('2');
    expect((await tokenRow(first.token))!.revoked_at).not.toBeNull();
    expect((await tokenRow(second.token))!.revoked_at).toBeNull();

    const old = await anon.get(`${PUB}?token=${first.token}`);
    expect(old.status()).toBe(410);
    expect((await old.json()).code).toBe('revoked');
    // ใบเก่าตอบไม่ได้ทุกทาง
    const decline = await anon.post(`${PUB}/decline?token=${first.token}`, { data: { reason: 'ทดสอบ' } });
    expect(decline.status()).toBe(410);
    expect(await formStatus(formId)).toBe('approved_by_dept_head');

    // ใบใหม่ยังใช้ได้
    expect((await anon.get(`${PUB}?token=${second.token}`)).status()).toBe(200);
  });

  test('L2: token มั่ว = 404 · หมดอายุ = 410 · ใช้แล้ว = 410 — ทุก endpoint', async ({ request }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);

    // ไม่รู้จัก: ไม่ส่ง · ไม่ใช่ UUID · UUID ที่ไม่มีในฐาน · สตริงโจมตี SQL
    for (const bad of ['', 'not-a-uuid', crypto.randomUUID(), "' OR 1=1 --"]) {
      for (const [label, status] of await getEvery(bad)) {
        expect(status, `token "${bad}" ${label}`).toBe(404);
      }
    }
    expect((await anon.get(PUB)).status()).toBe(404);

    // ใช้แล้ว
    await dbExec('UPDATE acceptance_link_tokens SET used_at = NOW() WHERE token = $1', [token]);
    for (const [label, status, body] of await getEvery(token)) {
      expect(status, `used ${label}`).toBe(410);
      expect(body.code, `used ${label}`).toBe('used');
    }
    await dbExec('UPDATE acceptance_link_tokens SET used_at = NULL WHERE token = $1', [token]);

    // หมดอายุ
    await dbExec("UPDATE acceptance_link_tokens SET expires_at = NOW() - interval '1 minute' WHERE token = $1", [token]);
    for (const [label, status, body] of await getEvery(token)) {
      expect(status, `expired ${label}`).toBe(410);
      expect(body.code, `expired ${label}`).toBe('expired');
    }

    // ทั้งหมดข้างบนต้องไม่แตะใบ · ไม่เผา token
    expect(await formStatus(formId)).toBe('approved_by_dept_head');
    expect((await tokenRow(token))!.used_at).toBeNull();

    // ยืนยันว่า 410 มาจาก token จริง — คืนอายุแล้วใช้ได้ทันที
    await dbExec("UPDATE acceptance_link_tokens SET expires_at = NOW() + interval '5 days' WHERE token = $1", [token]);
    expect((await anon.get(`${PUB}?token=${token}`)).status()).toBe(200);
  });

  test('L2b: เส้นสาธารณะห้ามแคช — 404 · 410 · 200 ตอบ Cache-Control: no-store (410 เคยถูกเบราว์เซอร์แคชแล้วผู้ใช้เปิดลิงก์ใหม่ยังเห็น "ใช้ไม่ได้แล้ว")', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { token } = await readyLink(request);

    const unknown = await anon.get(`${PUB}?token=${crypto.randomUUID()}`);
    expect(unknown.status()).toBe(404);
    expect(unknown.headers()['cache-control']).toBe('no-store');

    const ok = await anon.get(`${PUB}?token=${token}`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()['cache-control']).toBe('no-store');

    await dbExec('UPDATE acceptance_link_tokens SET used_at = NOW() WHERE token = $1', [token]);
    const used = await anon.get(`${PUB}?token=${token}`);
    expect(used.status()).toBe(410);
    expect(used.headers()['cache-control']).toBe('no-store');
  });

  test('L3: GET payload มีเฉพาะคีย์ใน allow-list · ไม่มีเกรด/เลขบัตร/ที่อยู่/เบอร์ · ไฟล์เปิดได้', async ({ request }) => {
    test.setTimeout(180_000);
    const { token } = await readyLink(request);

    // ยัดค่าที่ห้ามหลุดไว้ในแถวนักศึกษา — ถ้า payload ส่งทั้งแถวออกไปจะเห็นในเนื้อตอบ
    await dbExec(
      `UPDATE students
          SET cumulative_gpa = 3.91, claimed_gpa = 3.88, current_address = 'บ้านเลขที่ 999/99 ซอยลับ',
              phone = '0899990001', parent_name = 'ผู้ปกครอง ลับมาก', parent_phone = '0899990002',
              alt_email = 'alt-secret-l3@example.com'
        WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')`
    );

    const res = await anon.get(`${PUB}?token=${token}`);
    expect(res.status(), await res.text()).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);

    expect(Object.keys(body).sort()).toEqual(['company', 'has_resume', 'student', 'token_expires_at']);
    expect(Object.keys(body.student).sort()).toEqual(
      ['email', 'faculty_name_th', 'full_name', 'major_name_th', 'semester_label', 'student_code'].sort()
    );
    // บริษัทเห็นแค่ชื่อของตัวเอง — ไม่มีที่อยู่/ผู้จัดการ/ผู้ประสานงาน (ตัดสหกิจ 07 ฝั่งบริษัท 2026-10-05)
    expect(Object.keys(body.company).sort()).toEqual(['name_th']);
    expect(body.student.email).toBe('student2@test.com');
    expect(body.student.full_name.length).toBeGreaterThan(0);
    expect(body.student.semester_label).toMatch(/^ภาคเรียนที่ \d\/\d{4}$/);
    expect(new Date(body.token_expires_at).getTime()).toBeGreaterThan(Date.now());

    for (const secret of ['3.91', '3.88', '999/99', '0899990001', 'ผู้ปกครอง', '0899990002', 'alt-secret-l3']) {
      expect(text, `payload หลุด "${secret}"`).not.toContain(secret);
    }

    // หนังสือ + แบบตอบรับ = PDF จริง
    for (const p of ['/cover-letter', '/acceptance-form']) {
      const file = await anon.get(`${PUB}${p}?token=${token}`);
      expect(file.status(), p).toBe(200);
      expect(file.headers()['content-type']).toContain('application/pdf');
      expect((await file.body()).subarray(0, 4).toString()).toBe('%PDF');
    }

    // Resume: ไม่มี → has_resume false + 404 · มี → true + เปิดได้ (ไฟล์ทดสอบลบทิ้งเมื่อเสร็จ)
    expect(body.has_resume).toBe(false);
    expect((await anon.get(`${PUB}/resume?token=${token}`)).status()).toBe(404);

    const resumeName = `resume-l3-${Date.now()}.pdf`;
    fs.mkdirSync(RESUME_DIR, { recursive: true });
    fs.copyFileSync(PDF_FIXTURE, path.join(RESUME_DIR, resumeName));
    try {
      await dbExec(
        `UPDATE students SET resume_file = $1
          WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')`,
        [`resumes/${resumeName}`]
      );
      const again = await (await anon.get(`${PUB}?token=${token}`)).json();
      expect(again.has_resume).toBe(true);
      const resume = await anon.get(`${PUB}/resume?token=${token}`);
      expect(resume.status()).toBe(200);
      expect((await resume.body()).subarray(0, 4).toString()).toBe('%PDF');
    } finally {
      fs.rmSync(path.join(RESUME_DIR, resumeName), { force: true });
    }
  });

  test('L4: ไม่รับ — เหตุผลว่าง = 400 · สำเร็จ = company_rejected + เหตุผล · token burn · audit', async ({ request }) => {
    test.setTimeout(180_000);
    const { formId, token, tokenId } = await readyLink(request);

    for (const [label, data] of [
      ['ว่าง', { reason: '' }],
      ['ช่องว่างล้วน', { reason: '   ' }],
      ['ไม่ส่งฟิลด์', {}],
      ['ไม่ใช่สตริง', { reason: ['x'] }],
      ['ยาวเกิน 1000', { reason: 'ก'.repeat(1001) }],
    ] as Array<[string, object]>) {
      const res = await anon.post(`${PUB}/decline?token=${token}`, { data });
      expect(res.status(), `${label}: ${await res.text()}`).toBe(400);
    }
    // 400 ไม่แตะอะไร · token ยังใช้ได้
    expect(await formStatus(formId)).toBe('approved_by_dept_head');
    expect((await tokenRow(token))!.used_at).toBeNull();

    const reason = '  ไม่มีตำแหน่งงานที่ตรงกับสาขาในภาคเรียนนี้  ';
    const ok = await anon.post(`${PUB}/decline?token=${token}`, { data: { reason } });
    expect(ok.status(), await ok.text()).toBe(200);

    const row = await dbRow<{ status: string; reject_reason: string }>(
      'SELECT status, reject_reason FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row?.status).toBe('company_rejected');
    expect(row?.reject_reason).toBe('ไม่มีตำแหน่งงานที่ตรงกับสาขาในภาคเรียนนี้');
    expect((await tokenRow(token))!.used_at).not.toBeNull();

    // ใช้ซ้ำไม่ได้ ทั้งไม่รับและรับ
    const again = await anon.post(`${PUB}/decline?token=${token}`, { data: { reason: 'อีกครั้ง' } });
    expect(again.status()).toBe(410);
    expect((await postAccept(token, await acceptFields())).status()).toBe(410);
    expect(await formStatus(formId)).toBe('company_rejected');

    // audit เป็น fire-and-forget → รอให้แถวโผล่ · เก็บ token_id ไม่เก็บ token
    await expect
      .poll(
        async () =>
          dbRow<{ token_id: string; has_token: boolean }>(
            `SELECT detail->>'token_id' AS token_id, (detail::text LIKE '%' || $2 || '%') AS has_token
               FROM audit_log WHERE action = 'intent.declined_via_link' AND entity_id = $1`,
            [String(formId), token]
          ),
        { timeout: 10_000 }
      )
      .toEqual({ token_id: String(tokenId), has_token: false });
  });

  test('L5: accept ไม่มีไฟล์ = 400 · token ผิด/ใช้แล้ว/หมดอายุ/ยกเลิก ไม่มีไฟล์ถูกเขียนลงดิสก์ (ด่านก่อน multer)', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token, tokenId } = await readyLink(request);
    const before = evidenceCount();
    const settled = () => evidenceCount();

    // ไม่มีไฟล์
    const noFile = await postAccept(token, await acceptFields(), false);
    expect(noFile.status(), await noFile.text()).toBe(400);
    expect((await noFile.json()).message as string).toContain('แนบไฟล์');
    await expect.poll(settled).toBe(before);

    // มีไฟล์แต่ช่องบังคับขาด (ผู้ลงนาม) — ไฟล์ที่เพิ่งเขียนต้องถูกลบ
    const noSigner = await postAccept(token, await acceptFields({ signer_name: '' }));
    expect(noSigner.status(), await noSigner.text()).toBe(400);
    await expect.poll(settled, { timeout: 5_000 }).toBe(before);

    // เนื้อไฟล์ไม่ใช่ PDF/รูป (นามสกุล .pdf ปลอม) — ด่าน magic bytes ต้องลบทิ้ง
    const spoof = await anon.post(`${PUB}/accept?token=${token}`, {
      multipart: {
        evidence: { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('plain text not a pdf') },
        ...(await acceptFields()),
      },
    });
    expect(spoof.status(), await spoof.text()).toBe(400);
    await expect.poll(settled, { timeout: 5_000 }).toBe(before);

    // token ที่ไม่ผ่านด่านต้องถูกปัดก่อน multer — มีไฟล์ในคำขอแต่ดิสก์ต้องไม่ขยับ
    const fields = await acceptFields();
    const badTokens: Array<[string, string, number]> = [
      ['ไม่ใช่ UUID', 'not-a-uuid', 404],
      ['UUID ที่ไม่มีในฐาน', crypto.randomUUID(), 404],
    ];
    for (const [label, bad, expected] of badTokens) {
      const res = await postAccept(bad, fields);
      expect(res.status(), `${label}: ${await res.text()}`).toBe(expected);
      await expect.poll(settled, { message: label }).toBe(before);
    }

    await dbExec('UPDATE acceptance_link_tokens SET used_at = NOW() WHERE token_id = $1', [tokenId]);
    expect((await postAccept(token, fields)).status()).toBe(410);
    await expect.poll(settled, { message: 'ใช้แล้ว' }).toBe(before);
    await dbExec('UPDATE acceptance_link_tokens SET used_at = NULL, revoked_at = NOW() WHERE token_id = $1', [tokenId]);
    expect((await postAccept(token, fields)).status()).toBe(410);
    await expect.poll(settled, { message: 'ยกเลิกแล้ว' }).toBe(before);
    await dbExec(
      "UPDATE acceptance_link_tokens SET revoked_at = NULL, expires_at = NOW() - interval '1 minute' WHERE token_id = $1",
      [tokenId]
    );
    expect((await postAccept(token, fields)).status()).toBe(410);
    await expect.poll(settled, { message: 'หมดอายุ' }).toBe(before);

    // ทั้งหมดข้างบนต้องไม่แตะใบ · ไม่เผา token
    expect(await formStatus(formId)).toBe('approved_by_dept_head');
    expect((await tokenRow(token))!.used_at).toBeNull();

    // ตัวควบคุม: คืนอายุแล้วส่งครบ → ผ่านและ "มีไฟล์ถูกเขียน 1 ไฟล์" (พิสูจน์ว่าที่นับได้ 0 ไม่ใช่เพราะนับผิดที่)
    await dbExec("UPDATE acceptance_link_tokens SET expires_at = NOW() + interval '5 days' WHERE token_id = $1", [tokenId]);
    const ok = await postAccept(token, fields);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(evidenceCount()).toBe(before + 1);
  });

  test('L6: accept สำเร็จ = pending_officer_approval · source=link · ไม่มีพี่เลี้ยง ไม่สร้างบัญชี · companies ไม่เปลี่ยน · ฟิลด์ 07 เก่าถูกเมิน', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token, tokenId } = await readyLink(request);
    const companyBefore = await companySnapshot(formId);
    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');
    const mentorsBefore = await dbValue<string>('SELECT COUNT(*) FROM mentors');

    // ไคลเอนต์เก่าที่ยังส่งฟิลด์ 07 มาด้วย (พี่เลี้ยง · ตำแหน่งงาน · ข้อมูลบริษัท) ต้องถูกเมินทั้งหมด
    const res = await postAccept(
      token,
      await acceptFields({
        mentor_name: 'ต้องไม่ถูกสร้าง',
        mentor_email: 'ignored-l6@example.com',
        mentor_phone: '0800000000',
        job_position: 'ต้องไม่ถูกเก็บ',
        company_form07: JSON.stringify({ phone: '000', manager_name: 'ต้องไม่ถูกเขียน' }),
      })
    );
    expect(res.status(), await res.text()).toBe(200);

    const intent = await dbRow<{
      status: string;
      acceptance_source: string;
      mentor_id: number | null;
      evidence: string;
      signer: string;
      late: boolean;
    }>(
      `SELECT status, acceptance_source, mentor_id, acceptance_evidence_path AS evidence,
              acceptance_signer_name AS signer, acceptance_submitted_late AS late
         FROM intent_forms WHERE form_id = $1`,
      [formId]
    );
    expect(intent?.status).toBe('pending_officer_approval');
    expect(intent?.acceptance_source).toBe('link');
    expect(intent?.signer).toBe('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
    expect(intent?.late).toBe(false);
    expect(fs.existsSync(path.join(BACKEND_ROOT, 'uploads', intent!.evidence))).toBe(true);

    // ⛔ ลิงก์ไม่แตะทะเบียนบริษัทและไม่สร้างบัญชีใดๆ — พี่เลี้ยงมาจากนักศึกษาทีหลัง ไม่ได้มาจากคนถือลิงก์
    expect(await companySnapshot(formId)).toEqual(companyBefore);
    expect(intent?.mentor_id).toBeNull();
    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);
    expect(await dbValue<string>('SELECT COUNT(*) FROM mentors')).toBe(mentorsBefore);
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', ['ignored-l6@example.com'])).toBe('0');

    // burn + ใช้ซ้ำไม่ได้ + audit (เก็บ token_id)
    expect((await tokenRow(token))!.used_at).not.toBeNull();
    const again = await postAccept(token, await acceptFields());
    expect(again.status()).toBe(410);

    await expect
      .poll(
        async () =>
          dbValue<string>(
            `SELECT detail->>'token_id' FROM audit_log
              WHERE action = 'intent.accepted_via_link' AND entity_id = $1`,
            [String(formId)]
          ),
        { timeout: 10_000 }
      )
      .toBe(String(tokenId));
  });

  test('L7a: เจ้าหน้าที่กดรับใบที่ยังไม่มีพี่เลี้ยงได้ = accepted · ไม่มีบัญชีเกิด · ระบุทีหลังบัญชียังปิดจนเจ้าหน้าที่ยืนยัน · companies ไม่เปลี่ยน', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);
    expect((await postAccept(token, await acceptFields())).status()).toBe(200);
    const companyBefore = await companySnapshot(formId);
    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');

    // ยังไม่มีพี่เลี้ยง → กดรับได้ (คณะรู้ตัวพี่เลี้ยงหลังเริ่มฝึก) · การกดรับไม่สร้าง/เปิดบัญชีใด ไม่ออกลิงก์
    await accept(request, formId);
    expect(await formStatus(formId)).toBe('accepted');
    expect(await dbValue<number | null>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId])).toBeNull();
    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);
    expect(await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens')).toBe('0');

    // นักศึกษาระบุพี่เลี้ยงบนใบที่ตอบรับแล้ว → บัญชีถูกสร้างแบบยังไม่เปิดใช้ ไม่มีรหัสผ่าน ไม่มีลิงก์
    const set = await postMentor(request, formId);
    expect(set.status(), await set.text()).toBe(200);
    const mentorRow = () =>
      dbRow<{ user_id: number; is_active: boolean; no_password: boolean; roles: string[]; same_company: boolean; linked: boolean }>(
        `SELECT u.user_id, u.is_active, (u.password_hash IS NULL) AS no_password,
                (SELECT array_agg(r.role_name) FROM user_roles r WHERE r.user_id = u.user_id) AS roles,
                (m.company_id = i.company_id) AS same_company, (i.mentor_id = u.user_id) AS linked
           FROM users u JOIN mentors m ON m.mentor_id = u.user_id
           JOIN intent_forms i ON i.form_id = $2
          WHERE u.email = $1`,
        [MENTOR_EMAIL, formId]
      );
    const before = await mentorRow();
    expect(before).toMatchObject({ is_active: false, no_password: true, roles: ['mentor'], same_company: true, linked: true });
    expect(await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens')).toBe('0');

    // เจ้าหน้าที่ยืนยัน = จุดเดียวที่บัญชีเปิดและลิงก์ออก
    await apiLoginAs(request, 'staff1');
    const confirmed = await confirmMentor(request, before!.user_id);
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    expect(await mentorRow()).toMatchObject({ is_active: true, no_password: true, roles: ['mentor'] });
    expect(await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens WHERE user_id = $1', [before!.user_id])).toBe('1');

    // ⛔ ลิงก์ของบริษัทไม่เคยแตะทะเบียนบริษัท ทั้งตอนตอบรับ ตอนเจ้าหน้าที่กดรับ และตอนยืนยันพี่เลี้ยง
    expect(await companySnapshot(formId)).toEqual(companyBefore);
  });

  test('L7b: เจ้าหน้าที่ตีกลับ = ที่มาถูกล้าง · ทะเบียนบริษัทไม่ถูกแตะ · ไม่มีบัญชีเกิด', async ({ request }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);
    expect((await postAccept(token, await acceptFields())).status()).toBe(200);
    const companyBefore = await companySnapshot(formId);
    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');

    await apiLoginAs(request, 'staff1');
    const rejected = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
      data: { action: 'rejected', reason: 'ตราประทับบนแบบตอบรับไม่ชัดเจน' },
    });
    expect(rejected.status(), await rejected.text()).toBe(200);

    const row = await dbRow<{ status: string; source: string | null; reason: string }>(
      `SELECT status, acceptance_source AS source, reject_reason AS reason FROM intent_forms WHERE form_id = $1`,
      [formId]
    );
    expect(row).toEqual({ status: 'approved_by_dept_head', source: null, reason: 'ตราประทับบนแบบตอบรับไม่ชัดเจน' });
    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);
    expect(await companySnapshot(formId)).toEqual(companyBefore);
  });

  test('L8: SEC-03 ที่ POST /intents/:id/mentor — อีเมลซ้ำกับนักศึกษา หรือเป็นบัญชี role อื่น → ปฏิเสธ · ไม่มีบัญชี/role เพิ่ม', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);
    expect((await postAccept(token, await acceptFields())).status()).toBe(200);
    await accept(request, formId);
    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');
    const rolesBefore = await dbValue<string>('SELECT COUNT(*) FROM user_roles');
    const mentorsBefore = await dbValue<string>('SELECT COUNT(*) FROM mentors');

    for (const [label, email] of [
      ['อีเมลของนักศึกษาเอง', 'student2@test.com'],
      ['อีเมลของนักศึกษาเอง (ตัวพิมพ์ใหญ่)', 'STUDENT2@Test.com'],
      ['บัญชีเจ้าหน้าที่', 'staff1@test.com'],
      ['บัญชีอาจารย์ที่ปรึกษา', 'advisor1@test.com'],
      ['บัญชีคณบดี', 'dean1@test.com'],
    ]) {
      const res = await postMentor(request, formId, mentorBody({ email }));
      expect(res.status(), `${label}: ${await res.text()}`).toBe(400);
      expect(((await res.json()).message as string).length, label).toBeGreaterThan(0);

      // rollback หมด: ใบยังไม่มีพี่เลี้ยง · ไม่มีบัญชี/role/พี่เลี้ยงเพิ่ม (โดยเฉพาะไม่มี role mentor แปะทับบัญชีเดิม)
      expect(await formStatus(formId), label).toBe('accepted');
      expect(await dbValue<number | null>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId]), label).toBeNull();
      expect(await dbValue<string>('SELECT COUNT(*) FROM users'), label).toBe(usersBefore);
      expect(await dbValue<string>('SELECT COUNT(*) FROM user_roles'), label).toBe(rolesBefore);
      expect(await dbValue<string>('SELECT COUNT(*) FROM mentors'), label).toBe(mentorsBefore);
      expect(
        await dbValue<string>(
          "SELECT COUNT(*) FROM user_roles WHERE role_name = 'mentor' AND user_id = (SELECT user_id FROM users WHERE email = $1)",
          [email.toLowerCase()]
        ),
        label
      ).toBe('0');
    }

    // ตัวควบคุม: อีเมลพี่เลี้ยงตัวจริงผ่าน — 400 ข้างบนมาจาก SEC-03 ไม่ใช่ด่านอื่น
    const ok = await postMentor(request, formId, mentorBody({ email: 'real-mentor-l8@example.com' }));
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await dbValue<number | null>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId])).not.toBeNull();
  });

  test('L8b: POST /intents/:id/mentor — ช่องบังคับ · สถานะ · เจ้าของใบ · role · ระบุซ้ำได้จนกว่าเจ้าหน้าที่ยืนยันพี่เลี้ยง', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);

    // ยังไม่ตอบรับ (approved_by_dept_head) = ระบุไม่ได้
    const early = await postMentor(request, formId);
    expect(early.status(), await early.text()).toBe(400);

    expect((await postAccept(token, await acceptFields())).status()).toBe(200);

    // ได้แบบตอบรับแล้วแต่เจ้าหน้าที่ยังไม่กดรับ (pending_officer_approval) = ยังระบุไม่ได้ — พี่เลี้ยงไม่อยู่ในทางตอบรับแล้ว
    const beforeAccept = await postMentor(request, formId);
    expect(beforeAccept.status(), await beforeAccept.text()).toBe(400);
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [MENTOR_EMAIL])).toBe('0');

    await accept(request, formId);

    // ช่องบังคับ · รูปแบบอีเมล · ความยาว
    for (const [label, body] of [
      ['ไม่มีชื่อ', mentorBody({ name: '' })],
      ['ไม่มีอีเมล', mentorBody({ email: '' })],
      ['ไม่มีโทรศัพท์', mentorBody({ phone: '  ' })],
      ['อีเมลผิดรูปแบบ', mentorBody({ email: 'not-an-email' })],
      ['ชื่อยาวเกิน', mentorBody({ name: 'ก'.repeat(256) })],
    ] as Array<[string, Record<string, string>]>) {
      const res = await postMentor(request, formId, body);
      expect(res.status(), `${label}: ${await res.text()}`).toBe(400);
    }
    expect(await dbValue<number | null>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId])).toBeNull();

    // นักศึกษาคนอื่น / บทบาทอื่น / ไม่ล็อกอิน = ระบุให้ใบนี้ไม่ได้
    await apiLoginAs(request, 'student1');
    const other = await request.post(`${API_URL}/intents/${formId}/mentor`, { data: mentorBody() });
    expect(other.status(), await other.text()).toBe(400);
    await apiLoginAs(request, 'staff1');
    const staff = await request.post(`${API_URL}/intents/${formId}/mentor`, { data: mentorBody() });
    expect(staff.status()).toBe(403);
    const nobody = await playwrightRequest.newContext();
    try {
      expect((await nobody.post(`${API_URL}/intents/${formId}/mentor`, { data: mentorBody() })).status()).toBe(401);
    } finally {
      await nobody.dispose();
    }
    expect(await dbValue<number | null>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId])).toBeNull();

    // ระบุแล้วพิมพ์ผิดแก้ซ้ำได้ — ใบชี้ไปพี่เลี้ยงคนใหม่
    expect((await postMentor(request, formId, mentorBody({ email: 'typo-l8b@example.com' }))).status()).toBe(200);
    const first = await dbValue<number>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId]);
    expect((await postMentor(request, formId, mentorBody())).status()).toBe(200);
    const second = await dbValue<number>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId]);
    expect(second).not.toBe(first);
    expect(await dbValue<string>('SELECT email FROM users WHERE user_id = $1', [second])).toBe(MENTOR_EMAIL);

    // audit ลงทุกครั้งที่ระบุ
    await expect
      .poll(
        async () =>
          dbValue<string>(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'intent.mentor_set' AND entity_id = $1",
            [String(formId)]
          ),
        { timeout: 10_000 }
      )
      .toBe('2');

    // เจ้าหน้าที่ยืนยันพี่เลี้ยงแล้ว = นักศึกษาเปลี่ยนเองไม่ได้ (บัญชีถูกเปิดไปแล้ว) · ใบยังชี้คนเดิม
    await apiLoginAs(request, 'staff1');
    const confirmed = await confirmMentor(request, second as number);
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    const late = await postMentor(request, formId, mentorBody({ email: 'late-l8b@example.com' }));
    expect(late.status(), await late.text()).toBe(409);
    expect((await late.json()).code).toBe('mentor_confirmed');
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', ['late-l8b@example.com'])).toBe('0');
    expect(await dbValue<number>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId])).toBe(second);
  });

  test('L9: ใบไม่อยู่ในสถานะ approved_by_dept_head หรือหนังสือไม่ signed → 410 (closed) ทุก endpoint · ไม่มีไฟล์ถูกเขียน', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);
    const before = evidenceCount();

    for (const status of ['pending_officer_approval', 'accepted', 'company_rejected', 'rejected']) {
      await dbExec('UPDATE intent_forms SET status = $2 WHERE form_id = $1', [formId, status]);
      for (const [label, code, body] of await getEvery(token)) {
        expect(code, `${status} ${label}`).toBe(410);
        expect(body.code, `${status} ${label}`).toBe('closed');
      }
      await expect.poll(evidenceCount, { message: status }).toBe(before);
      expect(await formStatus(formId)).toBe(status);
      expect((await tokenRow(token))!.used_at, status).toBeNull();
    }

    // หนังสือขอความอนุเคราะห์ที่ยังไม่ signed (ถูกดึงกลับ) → ตอบรับไม่ได้เช่นกัน
    await dbExec("UPDATE intent_forms SET status = 'approved_by_dept_head' WHERE form_id = $1", [formId]);
    await dbExec("UPDATE official_documents SET status = 'pending_sign' WHERE type = 'cover_letter'");
    for (const [label, code, body] of await getEvery(token)) {
      expect(code, `unsigned ${label}`).toBe(410);
      expect(body.code, `unsigned ${label}`).toBe('closed');
    }
    await expect.poll(evidenceCount).toBe(before);

    // ตัวควบคุม: กลับเป็นสถานะที่ถูกต้อง → ใช้ได้
    await dbExec("UPDATE official_documents SET status = 'signed' WHERE type = 'cover_letter'");
    expect((await anon.get(`${PUB}?token=${token}`)).status()).toBe(200);
  });

  test('L10: หน้าลิงก์ — เห็นชื่อนักศึกษา ไม่เห็น สหกิจ 03/07 · ฟอร์มเดียว · กล่องยืนยัน · หน้าส่งแล้ว · เปิดซ้ำ = ใช้แล้ว', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);
    const studentName = (await (await anon.get(`${PUB}?token=${token}`)).json()).student.full_name as string;

    // เปิดลิงก์โดยไม่ล็อกอิน (page ใหม่ ไม่มี session)
    await page.goto(`/accept?token=${token}`);
    await expect(page.getByTestId('al-student-name')).toHaveText(studentName);
    await expect(page.locator('body')).not.toContainText('สหกิจ 03');
    await expect(page.getByTestId('al-error')).toBeHidden();

    // ไม่มีปุ่มส่งจนกว่าจะเลือกรับ/ไม่รับ · ฟอร์มเดียวจบ — ไม่มีขั้นสหกิจ 07 และไม่ถามพี่เลี้ยง/ตำแหน่งงาน/ข้อมูลบริษัท
    await expect(page.getByTestId('al-submit')).toHaveCount(0);
    await page.getByTestId('al-decision-accept').check();
    for (const gone of ['al-next', 'al-back', 'al-manager-name', 'al-company-phone', 'al-mentor-name', 'al-mentor-email', 'al-job-position']) {
      await expect(page.getByTestId(gone), gone).toHaveCount(0);
    }
    await expect(page.locator('body')).not.toContainText('สหกิจ 07');

    // กดส่งทั้งที่ว่าง = ข้อความบอกว่าขาดอะไร (ไม่ใช่กดแล้วเงียบ) · ไม่เปิดกล่องยืนยัน
    await page.getByTestId('al-submit').click();
    await expect(page.getByTestId('al-error')).toBeVisible();
    await expect(page.getByTestId('al-error')).toContainText('กรุณากรอกชื่อผู้ลงนาม');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByTestId('al-signer-name').fill('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
    await page.getByTestId('al-signer-position').fill('ผู้จัดการฝ่ายบุคคล');
    await page.getByTestId('al-signed-date').fill(await todayTh());
    await page.getByTestId('al-start-date').fill('2026-11-02');
    await page.getByTestId('al-submit').click();
    await expect(page.getByTestId('al-error')).toContainText('กรุณาแนบเอกสาร 2');
    await page.getByTestId('al-evidence').setInputFiles(PDF_FIXTURE);

    // กดส่ง → ต้องเจอกล่องยืนยันก่อน · ระหว่างนั้นยังไม่มีอะไรถูกส่ง
    await page.getByTestId('al-submit').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(studentName);
    await expect(dialog).toContainText('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
    await expect(dialog).toContainText('mock_official_letter.pdf');
    await expect(page.locator('body')).not.toContainText('สหกิจ 03');
    expect(await formStatus(formId)).toBe('approved_by_dept_head');
    expect((await tokenRow(token))!.used_at).toBeNull();

    // กลับไปแก้ = ไม่ส่ง
    await page.getByTestId('al-confirm-cancel').click();
    await expect(dialog).toHaveCount(0);
    expect(await formStatus(formId)).toBe('approved_by_dept_head');

    // ยืนยัน → หน้าส่งแล้ว
    await page.getByTestId('al-submit').click();
    await page.getByTestId('al-confirm').click();
    await expect(page.getByTestId('al-done')).toBeVisible();
    await expect(page.getByTestId('al-done')).toContainText(studentName);
    await expect(page.getByTestId('al-done')).toContainText('ได้รับการตอบรับแล้ว');

    const row = await dbRow<{ status: string; source: string; mentor_id: number | null }>(
      'SELECT status, acceptance_source AS source, mentor_id FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row).toEqual({ status: 'pending_officer_approval', source: 'link', mentor_id: null });
    expect((await tokenRow(token))!.used_at).not.toBeNull();

    // เปิดลิงก์เดิมอีกครั้ง = หน้าใช้แล้ว (ไม่ใช่ฟอร์มว่าง)
    await page.reload();
    await expect(page.getByTestId('al-gone')).toBeVisible();
    await expect(page.getByTestId('al-gone')).toContainText('ลิงก์นี้ถูกใช้ตอบไปแล้ว');
    await expect(page.getByTestId('al-student-name')).toHaveCount(0);
  });

  test('L10b: หน้าลิงก์ — ไม่รับต้องมีเหตุผล · กล่องยืนยัน · ส่งแล้ว = company_rejected', async ({ page, request }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);

    await page.goto(`/accept?token=${token}`);
    await page.getByTestId('al-decision-decline').check();
    await expect(page.getByTestId('al-signer-name')).toHaveCount(0);

    // ไม่กรอกเหตุผล → error ในหน้า ไม่เปิดกล่องยืนยัน ไม่ยิงเซิร์ฟเวอร์
    await page.getByTestId('al-submit').click();
    await expect(page.getByTestId('al-error')).toContainText('กรุณาระบุเหตุผลที่ไม่รับนักศึกษา');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await formStatus(formId)).toBe('approved_by_dept_head');

    await page.getByTestId('al-decline-reason').fill('ไม่มีตำแหน่งงานที่ตรงกับสาขา');
    await page.getByTestId('al-submit').click();
    await expect(page.getByRole('dialog')).toContainText('ไม่รับ');
    await page.getByTestId('al-confirm-cancel').click();
    expect(await formStatus(formId)).toBe('approved_by_dept_head');

    await page.getByTestId('al-submit').click();
    await page.getByTestId('al-confirm').click();
    await expect(page.getByTestId('al-done')).toContainText('ได้รับคำตอบแล้ว');

    const row = await dbRow<{ status: string; reason: string }>(
      'SELECT status, reject_reason AS reason FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row).toEqual({ status: 'company_rejected', reason: 'ไม่มีตำแหน่งงานที่ตรงกับสาขา' });
  });

  test('L10c: หน้าลิงก์ที่ใช้ไม่ได้ — ไม่รู้จัก = ไม่พบลิงก์ · ยกเลิก/หมดอายุ = ใช้งานไม่ได้แล้ว (ไม่มีปุ่มขอลิงก์ใหม่)', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const { token, tokenId } = await readyLink(request);

    await page.goto('/accept');
    await expect(page.getByTestId('al-notfound')).toBeVisible();
    await page.goto(`/accept?token=${crypto.randomUUID()}`);
    await expect(page.getByTestId('al-notfound')).toBeVisible();

    await dbExec('UPDATE acceptance_link_tokens SET revoked_at = NOW() WHERE token_id = $1', [tokenId]);
    await page.goto(`/accept?token=${token}`);
    await expect(page.getByTestId('al-gone')).toBeVisible();
    await expect(page.getByTestId('al-gone')).toContainText('นักศึกษาส่งหนังสือฉบับใหม่ให้ท่าน');
    await expect(page.getByRole('button', { name: /ขอลิงก์/ })).toHaveCount(0);

    await dbExec(
      "UPDATE acceptance_link_tokens SET revoked_at = NULL, expires_at = NOW() - interval '1 minute' WHERE token_id = $1",
      [tokenId]
    );
    await page.reload();
    await expect(page.getByTestId('al-gone')).toContainText('ลิงก์นี้หมดอายุแล้ว');
  });
});

/**
 * L11 — การ์ด "สิ่งที่ต้องทำตอนนี้" บนแดชบอร์ดนักศึกษา
 * เลือกสถานะจากฟิลด์เดียวกับที่เซิร์ฟเวอร์ใช้ · ฟอร์มรายงานผลของนักศึกษา (`proof-*`) ซ่อนจนกดปุ่ม
 * และต้องไม่มีจนกว่าคณบดีลงนาม (`acceptance_due_date`) — คุมว่า "ใครเห็นอะไรตอนไหน" ก่อนหน้าตา
 */
type Seed = {
  status: string;
  /** วันครบกำหนดตอบกลับ (จำนวนวันจากวันนี้) — null = คณบดียังไม่ลงนาม */
  due?: number | null;
  mailSent?: boolean;
  rejectReason?: string | null;
};

async function putIntent({ status, due = null, mailSent = false, rejectReason = null }: Seed): Promise<number> {
  return withDb(async (db) => {
    await db.query('DELETE FROM intent_forms');
    const studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0]
      .user_id;
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'))
      .rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, acceptance_due_date,
                                 company_mail_to, company_mail_sent_at, company_mail_count, reject_reason)
       VALUES ($1, $2, $3, $4,
               CASE WHEN $5::int IS NULL THEN NULL ELSE (NOW() AT TIME ZONE 'Asia/Bangkok')::date + $5::int END,
               CASE WHEN $6::boolean THEN 'hr-card@example.com' END,
               CASE WHEN $6::boolean THEN NOW() END,
               CASE WHEN $6::boolean THEN 1 ELSE 0 END,
               $7)
       RETURNING form_id`,
      [studentId, companyId, semesterId, status, due, mailSent, rejectReason]
    );
    return res.rows[0].form_id as number;
  });
}

test.describe('การ์ดสถานะบนแดชบอร์ดนักศึกษา (ช่วงขอที่ฝึกงาน)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  const card = (page: import('@playwright/test').Page) => page.getByTestId('status-card');
  // การ์ด "ทำอะไรตอนนี้" มีใบเดียวเสมอ — ช่วงขอที่ฝึกงานเห็นการ์ดสถานะ และต้องไม่เห็นการ์ดเส้นทางสหกิจ (now-card) ซ้อน
  const onlyStatusCard = async (page: import('@playwright/test').Page) => {
    await expect(card(page)).toHaveCount(1);
    await expect(page.getByTestId('now-card')).toHaveCount(0);
  };

  test('L11: การ์ดเปลี่ยนตามสถานะ · ฟอร์มรายงานผลซ่อนจนกดปุ่ม และไม่โผล่ก่อนคณบดีลงนาม', async ({ page }) => {
    test.setTimeout(180_000);

    // รอคณบดีลงนาม: ยังไม่มีกำหนดตอบกลับ → ไม่มีกล่องส่งเมล ไม่มีทางสำรอง ไม่มีปุ่มบริษัทไม่รับ
    await putIntent({ status: 'approved_by_dept_head', due: null });
    await loginAs(page, 'student2');
    await expect(card(page)).toHaveAttribute('data-state', 'wait-dean');
    await onlyStatusCard(page);
    await expect(page.getByTestId('acceptance-due')).toHaveCount(0);
    await expect(card(page)).toContainText('รอคณบดีลงนาม');
    await expect(page.getByTestId('company-mail-box')).toHaveCount(0);
    await expect(page.getByTestId('proof-open')).toHaveCount(0);
    await expect(page.getByTestId('proof-form')).toHaveCount(0);
    await expect(page.getByTestId('fail-open')).toHaveCount(0);

    // ต้องส่ง: คณบดีลงนามแล้ว ยังไม่ได้ส่งเมล
    await putIntent({ status: 'approved_by_dept_head', due: 15 });
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'send');
    await onlyStatusCard(page);
    await expect(card(page).getByTestId('acceptance-due')).toContainText('ครบกำหนดตอบกลับโดยประมาณ');
    await expect(card(page).getByTestId('company-mail-box')).toBeVisible();
    // ทางสำรอง: ปุ่มมี แต่ฟอร์มยังพับ
    await expect(page.getByTestId('proof-open')).toBeVisible();
    await expect(page.getByTestId('proof-form')).toHaveCount(0);
    await expect(page.getByTestId('proof-start-date')).toHaveCount(0);
    await expect(page.getByTestId('fail-open')).toContainText('สัมภาษณ์ไม่ผ่าน / บริษัทไม่รับ');

    // กดเปิด → ฟอร์มโผล่ · ค่าที่กรอกไว้ไม่หายเมื่อปิดแล้วเปิดใหม่
    await page.getByTestId('proof-open').click();
    await expect(page.getByTestId('proof-form')).toBeVisible();
    await page.getByTestId('proof-start-date').fill('2026-11-02');
    await page.getByTestId('proof-close').click();
    await expect(page.getByTestId('proof-form')).toHaveCount(0);
    await page.getByTestId('proof-open').click();
    await expect(page.getByTestId('proof-start-date')).toHaveValue('2026-11-02');

    // รอบริษัท: ส่งเมลแล้ว
    await putIntent({ status: 'approved_by_dept_head', due: 15, mailSent: true });
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'wait-company');
    await onlyStatusCard(page);
    await expect(card(page).getByTestId('acceptance-due')).toContainText('ครบกำหนดตอบกลับโดยประมาณ');
    await expect(card(page)).toContainText('รอบริษัทตอบรับ');
    await expect(card(page)).toContainText('ไม่ต้องทำอะไรตอนนี้');
    await expect(page.getByTestId('proof-open')).toBeVisible();
    await expect(page.getByTestId('proof-form')).toHaveCount(0);

    // เจ้าหน้าที่ตีกลับ: เหตุผลบนการ์ด
    await putIntent({ status: 'approved_by_dept_head', due: 15, mailSent: true, rejectReason: 'ตราประทับไม่ชัดเจน' });
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'returned');
    await onlyStatusCard(page);
    await expect(card(page).getByTestId('acceptance-due')).toContainText('ครบกำหนดตอบกลับโดยประมาณ');
    await expect(card(page)).toContainText('ตราประทับไม่ชัดเจน');

    // เลยกำหนดที่บริษัทต้องตอบ: ป้ายเปลี่ยนเป็นแบบเลยกำหนด
    await putIntent({ status: 'approved_by_dept_head', due: -2, mailSent: true });
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'wait-company');
    await expect(card(page).getByTestId('acceptance-due')).toContainText('เลยกำหนดตอบกลับมาแล้ว');

    // บริษัทตอบรับทางลิงก์แล้วแต่ยังไม่มีพี่เลี้ยง: นักศึกษาต้องระบุ (การ์ดสีฟ้า = ต้องทำ) · ยังไม่มีทางสำรอง/ปุ่มบริษัทไม่รับ
    await putIntent({ status: 'pending_officer_approval', due: 15, mailSent: true });
    await dbExec("UPDATE intent_forms SET acceptance_source = 'link'");
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'add-mentor');
    await onlyStatusCard(page);
    await expect(card(page)).toContainText('ระบุพี่เลี้ยง');
    await expect(page.getByTestId('mentor-form')).toBeVisible();
    await expect(page.getByTestId('proof-open')).toHaveCount(0);
    await expect(page.getByTestId('fail-open')).toHaveCount(0);

    // ระบุพี่เลี้ยงแล้ว: รอเจ้าหน้าที่ ไม่ต้องทำอะไร · ไม่มีทางสำรองและไม่มีปุ่มบริษัทไม่รับ (ตอบไปแล้ว)
    const mentorRes = await page.request.post(`${API_URL}/intents/${await dbValue<number>('SELECT form_id FROM intent_forms')}/mentor`, {
      data: mentorBody(),
    });
    expect(mentorRes.status(), await mentorRes.text()).toBe(200);
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'wait-confirm');
    await onlyStatusCard(page);
    await expect(page.getByTestId('acceptance-due')).toHaveCount(0);
    // ยังไม่มีไฟล์เอกสาร 2 บนใบ = ไม่มีลิงก์ (ไม่ใส่ปุ่มที่เปิดแล้วเจอหน้าเสีย)
    await expect(page.getByTestId('open-acceptance-evidence')).toHaveCount(0);
    await expect(page.getByTestId('proof-open')).toHaveCount(0);
    await expect(page.getByTestId('proof-form')).toHaveCount(0);
    await expect(page.getByTestId('fail-open')).toHaveCount(0);

    // บริษัทไม่รับ: ใบปิดแล้ว แต่การ์ดยังบอกเหตุผลและทางไปต่อ
    await putIntent({
      status: 'company_rejected',
      due: 15,
      mailSent: true,
      rejectReason: 'ไม่มีตำแหน่งงานที่ตรงกับสาขา',
    });
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'company-rejected');
    await onlyStatusCard(page);
    await expect(card(page)).toContainText('เหตุผลจากบริษัท: ไม่มีตำแหน่งงานที่ตรงกับสาขา');
    await expect(page.getByTestId('status-primary')).toContainText('หาที่ฝึกงานใหม่');
    await expect(page.getByTestId('proof-open')).toHaveCount(0);
    await expect(page.getByTestId('fail-open')).toHaveCount(0);
  });

  test('L11b: การ์ดก่อนคณบดีลงนาม — ต้องยื่นคำร้อง · รอเจ้าหน้าที่ · คำร้องไม่ผ่าน', async ({ page }) => {
    test.setTimeout(180_000);

    await putIntent({ status: 'pending_advisor' });
    await loginAs(page, 'student2');
    await expect(card(page)).toHaveAttribute('data-state', 'submit-paper');
    await onlyStatusCard(page);
    await expect(page.getByTestId('proof-open')).toHaveCount(0);
    await expect(page.getByTestId('company-mail-box')).toHaveCount(0);

    await putIntent({ status: 'pending_officer_request' });
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'wait-staff');
    await onlyStatusCard(page);
    await expect(page.getByTestId('proof-open')).toHaveCount(0);

    await putIntent({ status: 'rejected', rejectReason: 'เอกสารไม่ครบ' });
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'rejected');
    await onlyStatusCard(page);
    await expect(card(page)).toContainText('เหตุผล: เอกสารไม่ครบ');
    await expect(page.getByTestId('proof-open')).toHaveCount(0);
  });

  test('L11c: ได้ที่ฝึกงานแล้ว — การ์ดสถานะและความคืบหน้าขอที่ฝึกงานหายไป เหลือการ์ดเส้นทางสหกิจใบเดียว · เอกสารของฉันยังอยู่', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const formId = await putIntent({ status: 'accepted', due: 15, mailSent: true });
    await dbExec("UPDATE intent_forms SET start_date = '2026-11-02' WHERE form_id = $1", [formId]);
    await loginAs(page, 'student2');
    await expect(page.getByTestId('now-card')).toBeVisible();
    // ใบนี้ยังมี acceptance_due_date (due: 15) แต่ได้ที่แล้ว — กำหนดส่งหลักฐานตอบรับต้องไม่ค้างบนการ์ดเส้นทาง
    await expect(page.getByTestId('now-card')).not.toContainText('กำหนดส่งหลักฐานตอบรับ');
    await expect(page.getByTestId('status-card')).toHaveCount(0);
    await expect(page.getByTestId('request-progress')).toHaveCount(0);
    await expect(page.locator('[data-state="accepted"]')).toHaveCount(0);
    // วันเริ่มงานย้ายมาอยู่การ์ด "ที่ฝึกงานของคุณ" · ยังไม่มีพี่เลี้ยงบนใบ = ไม่มีบรรทัดพี่เลี้ยง
    await expect(page.getByTestId('intent-start-date')).toContainText('2569');
    await expect(page.getByTestId('intent-mentor')).toHaveCount(0);
    await expect(page.locator('#my-documents')).toBeVisible();
  });

  test('L11d: wait-confirm — ลิงก์ "ดูเอกสาร 2 ที่บริษัทแนบ" ขึ้นเมื่อใบมีไฟล์เท่านั้น', async ({ page }) => {
    test.setTimeout(120_000);

    const formId = await putIntent({ status: 'pending_officer_approval', due: 15, mailSent: true });
    await loginAs(page, 'student2');
    const mentorRes = await page.request.post(`${API_URL}/intents/${formId}/mentor`, { data: mentorBody() });
    expect(mentorRes.status(), await mentorRes.text()).toBe(200);
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'wait-confirm');
    await expect(page.getByTestId('open-acceptance-evidence')).toHaveCount(0);

    await dbExec(
      "UPDATE intent_forms SET acceptance_evidence_path = 'acceptance_evidence/evidence-user-1-test.pdf' WHERE form_id = $1",
      [formId]
    );
    await page.reload();
    const link = card(page).getByTestId('open-acceptance-evidence');
    await expect(link).toContainText('ดูเอกสาร 2 ที่บริษัทแนบ');
    await expect(link).toHaveAttribute('href', /\/files\/acceptance_evidence\/evidence-user-1-test\.pdf$/);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('L15: นักศึกษาระบุพี่เลี้ยงบนการ์ด — กรอกครบถึงส่งได้ · ส่งแล้วการ์ดเป็นรอเจ้าหน้าที่ · แก้ได้จนกว่าเจ้าหน้าที่จะรับ · ใบที่นักศึกษาส่งเองไม่มีปุ่มแก้', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const formId = await putIntent({ status: 'pending_officer_approval', due: 15, mailSent: true });
    await dbExec("UPDATE intent_forms SET acceptance_source = 'link'");
    await loginAs(page, 'student2');
    await expect(card(page)).toHaveAttribute('data-state', 'add-mentor');
    await expect(card(page)).toContainText('จาก 7');

    // ช่องบังคับว่าง = ส่งไม่ได้ (เบราว์เซอร์กันไว้) · ไม่มีอะไรลงฐาน
    await page.getByTestId('mentor-submit').click();
    expect(await dbValue<number | null>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId])).toBeNull();

    await page.getByTestId('mentor-name').fill('สุรเดช ใจดี');
    await page.getByTestId('mentor-email').fill('student2@test.com');
    await page.getByTestId('mentor-phone').fill('0812223333');
    // SEC-03: อีเมลของตัวเอง = เซิร์ฟเวอร์ปฏิเสธ · ข้อความขึ้นในการ์ด ไม่ใช่แถบหัวหน้า
    await page.getByTestId('mentor-submit').click();
    await expect(page.getByTestId('mentor-form')).toContainText('ไม่สามารถใช้อีเมลของตนเองเป็นอีเมลพี่เลี้ยงได้');
    await expect(card(page)).toHaveAttribute('data-state', 'add-mentor');

    await page.getByTestId('mentor-email').fill(MENTOR_EMAIL);
    await page.getByTestId('mentor-submit').click();
    await expect(card(page)).toHaveAttribute('data-state', 'wait-confirm');
    await expect(card(page)).toContainText('สุรเดช ใจดี');
    await expect(page.getByTestId('mentor-form')).toHaveCount(0);

    // ยังแก้ได้จนกว่าเจ้าหน้าที่จะรับ — เปิดมาพร้อมค่าเดิม
    await page.getByTestId('mentor-edit').click();
    await expect(page.getByTestId('mentor-email')).toHaveValue(MENTOR_EMAIL);
    await page.getByTestId('mentor-name').fill('สุรเดช แก้ชื่อแล้ว');
    await page.getByTestId('mentor-submit').click();
    await expect(page.getByTestId('mentor-form')).toHaveCount(0);
    await expect(card(page)).toContainText('สุรเดช แก้ชื่อแล้ว');
    expect(await dbValue<string>('SELECT name FROM mentors WHERE mentor_id = (SELECT mentor_id FROM intent_forms WHERE form_id = $1)', [formId])).toBe('สุรเดช แก้ชื่อแล้ว');

    // ใบที่นักศึกษาอัปโหลดแบบตอบรับเอง: พี่เลี้ยงมากับแบบตอบรับแล้ว ไม่มีปุ่มแก้ (acceptance_source = student)
    await dbExec("UPDATE intent_forms SET acceptance_source = 'student'");
    await page.reload();
    await expect(card(page)).toHaveAttribute('data-state', 'wait-confirm');
    await expect(page.getByTestId('mentor-edit')).toHaveCount(0);
  });
});

// รายการ (ค) ใน known_issues — ไฟล์ที่บริษัทแนบผ่านลิงก์ตั้งชื่อด้วย id นักศึกษาเจ้าของใบ
// (multer ไม่มี req.user บนเส้นทางสาธารณะ) → นักศึกษาคนนั้นเปิดได้ผ่าน /api/files ที่มีอยู่ · คนอื่นไม่ได้
test.describe('นักศึกษาเปิดไฟล์ที่บริษัทแนบมาทางลิงก์', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('L12: บริษัทแนบไฟล์ทางลิงก์ → นักศึกษาเจ้าของใบเปิดได้ (200) · นักศึกษาคนอื่น 403 · ไม่ล็อกอิน 401', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);

    const anon = await playwrightRequest.newContext();
    try {
      const res = await anon.post(`${PUB}/accept?token=${encodeURIComponent(token)}`, {
        multipart: { evidence: pdfPart(), ...(await acceptFields()) },
      });
      expect(res.status(), await res.text()).toBe(200);
    } finally {
      await anon.dispose();
    }

    const row = await dbRow<{ evidence: string; student_id: number }>(
      'SELECT acceptance_evidence_path AS evidence, student_id FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row?.evidence).toMatch(new RegExp(`^acceptance_evidence/evidence-user-${row?.student_id}-`));
    const url = `${API_URL}/files/${row?.evidence}`;

    await apiLoginAs(request, 'student2');
    const owner = await request.get(url);
    expect(owner.status(), await owner.text()).toBe(200);

    await apiLoginAs(request, 'student1');
    expect((await request.get(url)).status()).toBe(403);

    const nobody = await playwrightRequest.newContext();
    try {
      expect((await nobody.get(url)).status()).toBe(401);
    } finally {
      await nobody.dispose();
    }
  });
});

// รอบแก้จากการทดสอบบนจอจริง — ป้ายภาคเรียนเป็น พ.ศ. · หน้า 410 ย่อหน้าเดียว · radio อ่านออกเสียงเป็นไทย
// · เจ้าหน้าที่ต้องยืนยันก่อนรับแบบตอบรับ (รับแล้วตีกลับไม่ได้อีก และระบบส่งอีเมลแจ้งนักศึกษา)
test.describe('หน้าลิงก์ตอบรับ — ภาษาและกล่องยืนยันของเจ้าหน้าที่', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('L13: ป้ายภาคเรียนเป็น พ.ศ. · radio รับ/ไม่รับ อ่านเป็นไทย · หน้า 410 มีย่อหน้าอธิบายเดียว', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const { token, tokenId } = await readyLink(request);

    const anon = await playwrightRequest.newContext();
    try {
      const info = await (await anon.get(`${PUB}?token=${token}`)).json();
      expect(info.student.semester_label).toMatch(/^ภาคเรียนที่ \d\/25\d\d$/);
    } finally {
      await anon.dispose();
    }

    await page.goto(`/accept?token=${token}`);
    // exact: "ไม่รับ" มีคำว่า "รับ" อยู่ข้างใน — ไม่ exact จะชนกันสองปุ่ม
    await expect(page.getByRole('radio', { name: 'รับ', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'ไม่รับ', exact: true })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'accept' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'decline' })).toHaveCount(0);

    await dbExec('UPDATE acceptance_link_tokens SET revoked_at = NOW() WHERE token_id = $1', [tokenId]);
    await page.reload();
    const gone = page.getByTestId('al-gone');
    await expect(gone).toBeVisible();
    await expect(gone).toContainText('นักศึกษาส่งหนังสือฉบับใหม่ให้ท่าน');
    await expect(gone.locator('p')).toHaveCount(1);
    await expect(gone).not.toContainText('ลิงก์อาจใช้ตอบไปแล้ว');
  });

  test('L14: เจ้าหน้าที่กดรับแบบตอบรับได้โดยไม่ต้องมีพี่เลี้ยง — ต้องผ่านกล่องยืนยันที่บอกนักศึกษา บริษัท วันเริ่ม · ยกเลิก = ไม่เกิดอะไร', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const { formId, token } = await readyLink(request);
    const anon = await playwrightRequest.newContext();
    try {
      const res = await anon.post(`${PUB}/accept?token=${encodeURIComponent(token)}`, {
        multipart: { evidence: pdfPart(), ...(await acceptFields()) },
      });
      expect(res.status(), await res.text()).toBe(200);
    } finally {
      await anon.dispose();
    }
    const who = await dbRow<{ company: string; code: string }>(
      `SELECT c.name_th AS company, s.student_code AS code
         FROM intent_forms i JOIN companies c ON c.company_id = i.company_id
         JOIN students s ON s.student_id = i.student_id WHERE i.form_id = $1`,
      [formId]
    );

    // ใบยังไม่มีพี่เลี้ยง (คณะรู้ตัวพี่เลี้ยงหลังเริ่มฝึก) → ปุ่มรับกดได้ทันที ไม่มีกล่อง/ข้อความพี่เลี้ยงมาขวาง
    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');
    await loginAs(page, 'staff1');
    await page.getByTestId(`review-acceptance-${formId}`).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('acceptance-signer')).toBeVisible();
    await expect(page.getByTestId('acceptance-mentor-missing')).toHaveCount(0);
    await expect(page.getByTestId('acceptance-job-mentor')).toHaveCount(0);
    await expect(dialog).not.toContainText('พี่เลี้ยง');
    await expect(page.locator('body')).not.toContainText('สหกิจ 07');
    await expect(page.getByTestId('acceptance-approve-submit')).toBeEnabled();
    await page.getByTestId('acceptance-approve-submit').click();

    // กล่องยืนยัน — ระบุชัดว่าทำกับใคร เริ่มงานวันไหน · ไม่อ้างว่าจะเปิดบัญชีพี่เลี้ยง/ส่งลิงก์เชิญ · ระหว่างนี้ยังไม่มีอะไรเกิดขึ้น
    const confirm = page.getByTestId('confirm-summary');
    await expect(confirm).toContainText(who!.code);
    await expect(confirm).toContainText(who!.company);
    await expect(confirm).toContainText('วันเริ่มปฏิบัติงาน');
    await expect(confirm).toContainText('2569');
    await expect(confirm).not.toContainText('เปิดบัญชีพี่เลี้ยง');
    await expect(confirm).not.toContainText('ลิงก์เชิญ');
    await expect(confirm).not.toContainText('สหกิจ 07');
    expect(await formStatus(formId)).toBe('pending_officer_approval');

    await page.getByTestId('acceptance-approve-cancel').click();
    await expect(page.getByTestId('acceptance-approve-confirm')).toHaveCount(0);
    expect(await formStatus(formId)).toBe('pending_officer_approval');

    await page.getByTestId('acceptance-approve-submit').click();
    await page.getByTestId('acceptance-approve-confirm').click();
    await expect(page.getByText(/รับแบบตอบรับเรียบร้อยแล้ว/)).toBeVisible();
    expect(await formStatus(formId)).toBe('accepted');
    // การรับจากหน้าจอไม่สร้างบัญชีพี่เลี้ยงและไม่ออกลิงก์เข้าระบบ
    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);
    expect(await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens')).toBe('0');
  });
});
