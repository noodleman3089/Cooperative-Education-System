import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbRows, dbValue, dbExec, grantRoleBypassingMentorTrigger } from '../helpers/db';
import { apiLoginAs, type AccountKey } from '../helpers/auth';
import { walkToSigned, confirmMentor, SAMPLE_MENTOR } from '../helpers/intent';

/**
 * พี่เลี้ยงถูกระบุ "หลังเริ่มฝึก" — แยกออกจากทางตอบรับทั้งหมด (ขั้น 5 · 2026-10-09)
 *
 * เจ้าหน้าที่สหกิจยืนยันว่าคณะรู้ตัวพี่เลี้ยงตอนนักศึกษาเริ่มฝึกแล้วเท่านั้น จึงเปลี่ยนเป็น:
 *   เจ้าหน้าที่กดรับแบบตอบรับ (ไม่ต้องมีพี่เลี้ยง) → ใบ `accepted`
 *   → นักศึกษาระบุพี่เลี้ยง `POST /intents/:id/mentor` (บัญชียังปิด ไม่มีลิงก์)
 *   → เจ้าหน้าที่ยืนยัน `POST /mentor-followup/:mentorId/confirm` (จุดเดียวที่บัญชีเปิดและลิงก์ออก)
 *
 * คุม **สิทธิ์และเงื่อนไขก่อนหน้าตา** — ด่านมนุษย์ของ SEC-03 ย้ายที่ ไม่ได้หายไป:
 *   ถ้านักศึกษาระบุแล้วลิงก์ออกเอง นักศึกษาใส่อีเมลเพื่อนแล้วได้คนประเมินสหกิจ 15 ของตัวเอง
 *
 * A1 กดรับได้โดยไม่มีพี่เลี้ยง · ช่องพี่เลี้ยงตอนอัปโหลดถูกเมิน
 * A2 ระบุได้เฉพาะใบ accepted ของตัวเอง · ก่อนยืนยันบัญชีปิดและไม่มีลิงก์
 * A3 ยืนยัน = เจ้าหน้าที่เท่านั้น
 * A4 ยืนยันแล้ว: บัญชีเปิด มีลิงก์ นักศึกษาแก้ไม่ได้ · ข้อจำกัดระดับบัญชี
 * A5 SEC-03 ทั้งตอนระบุและตอนยืนยัน
 * A6 ปลายน้ำ: ไม่ส่งอีเมลถึงพี่เลี้ยงที่ยังไม่ยืนยัน · หน้าติดตาม/ท่อ/หน้าแรกนักศึกษาเห็นสามสภาพ
 *
 * การส่งเมลไม่ออกเน็ต (`MAIL_DRY_RUN=true` ใน playwright.config.ts) · ข้อมูลทั้งหมดเป็นของปลอม
 */

const MENTOR_EMAIL = SAMPLE_MENTOR.email;
const PDF_FIXTURE = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');

const mentorBody = (over: Record<string, string> = {}): Record<string, string> => ({ ...SAMPLE_MENTOR, ...over });

const userId = async (email: string): Promise<number> =>
  (await dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email])) as number;

/**
 * ใบคำร้องของนักศึกษาที่สถานะตามสั่ง (ยัดฐานตรง — เทสต์ชุดนี้ตรวจสิ่งที่เกิด *หลัง* ใบถึงสถานะนั้น)
 * student1 ของ seed ไม่มีแถว `students` เสมอไป จึงเติมให้ก่อน (ปีเข้าใหม่พอที่ตัวปิดบัญชีอัตโนมัติไม่แตะ)
 */
async function putForm(status: string, studentEmail = 'student2@test.com'): Promise<number> {
  return withDb(async (db) => {
    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name)
       SELECT u.user_id, 'MA-' || u.user_id, (SELECT major_id FROM students WHERE student_id =
                (SELECT user_id FROM users WHERE email = 'student2@test.com')), 3.00, 2569, 'นักศึกษา', 'อีกคน'
         FROM users u WHERE u.email = $1
       ON CONFLICT (student_id) DO NOTHING`,
      [studentEmail]
    );
    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ((SELECT user_id FROM users WHERE email = $1),
               (SELECT company_id FROM companies ORDER BY company_id LIMIT 1),
               (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1),
               $2, '2026-11-02')
       RETURNING form_id`,
      [studentEmail, status]
    );
    return res.rows[0].form_id as number;
  });
}

async function postMentor(
  request: APIRequestContext,
  formId: number,
  body: Record<string, string> = mentorBody(),
  account: AccountKey = 'student2'
) {
  await apiLoginAs(request, account);
  return request.post(`${API_URL}/intents/${formId}/mentor`, { data: body });
}

const mentorIdOf = (formId: number) =>
  dbValue<number | null>('SELECT mentor_id FROM intent_forms WHERE form_id = $1', [formId]);

const account = (email: string) =>
  dbRow<{ user_id: number; is_active: boolean; no_password: boolean; roles: string[] | null }>(
    `SELECT u.user_id, u.is_active, (u.password_hash IS NULL) AS no_password,
            (SELECT array_agg(r.role_name ORDER BY r.role_name) FROM user_roles r WHERE r.user_id = u.user_id) AS roles
       FROM users u WHERE u.email = $1`,
    [email]
  );

const tokenCount = async (id?: number): Promise<number> =>
  Number(
    id === undefined
      ? await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens')
      : await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens WHERE user_id = $1', [id])
  );

const stagesOf = async (formId: number): Promise<string[]> =>
  (await dbRows<{ stage: string }>('SELECT stage FROM intent_stage_events WHERE form_id = $1 ORDER BY event_id', [formId])).map(
    (r) => r.stage
  );

test.describe('พี่เลี้ยงหลังเริ่มฝึก — นักศึกษาระบุ เจ้าหน้าที่ยืนยัน', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('DELETE FROM mentor_login_tokens');
  });

  test('A1: อัปโหลดแบบตอบรับไม่ต้องมีพี่เลี้ยง · ช่องพี่เลี้ยงที่ส่งมาถูกเมิน · เจ้าหน้าที่กดรับใบที่ไม่มีพี่เลี้ยงได้ ไม่มีบัญชี/ลิงก์เกิด', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await putForm('pending_advisor');
    await walkToSigned(request, formId);
    const today = (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;
    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');
    const upload = (extra: Record<string, string> = {}) =>
      request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
        multipart: {
          evidence: { name: 'acceptance.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF_FIXTURE) },
          signer_name: 'คุณสมชาย ทรงชัย',
          signer_position: 'ผู้จัดการฝ่ายบุคคล',
          signed_date: today,
          start_date: '2026-11-02',
          ...extra,
        },
      });

    // ไม่ส่งช่องพี่เลี้ยงเลย = ผ่าน (เดิม 400 "Required fields: name, email, phone")
    await apiLoginAs(request, 'student2');
    const bare = await upload();
    expect(bare.status(), await bare.text()).toBe(200);
    expect(await mentorIdOf(formId)).toBeNull();

    // เจ้าหน้าที่ตีกลับ แล้วนักศึกษาส่งใหม่พร้อมช่องพี่เลี้ยงแบบเก่า → ช่องถูกเมิน ไม่มีบัญชีเกิด
    await apiLoginAs(request, 'staff1');
    const returned = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
      data: { action: 'rejected', reason: 'ตราประทับไม่ชัดเจน' },
    });
    expect(returned.status(), await returned.text()).toBe(200);

    await apiLoginAs(request, 'student2');
    const withOldFields = await upload({
      name: 'พี่เลี้ยง ที่ไม่ควรถูกบันทึก',
      email: 'ignored-mentor@example.com',
      phone: '0899999999',
      position: 'Manager',
      department: 'IT',
    });
    expect(withOldFields.status(), await withOldFields.text()).toBe(200);
    expect(await mentorIdOf(formId)).toBeNull();
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', ['ignored-mentor@example.com'])).toBe('0');
    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);

    // เจ้าหน้าที่กดรับใบที่ไม่มีพี่เลี้ยงได้ — และการกดรับไม่เปิดบัญชี ไม่ออกลิงก์
    await apiLoginAs(request, 'staff1');
    const approved = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
      data: { action: 'accepted' },
    });
    expect(approved.status(), await approved.text()).toBe(200);
    expect((await approved.json()).mentor_email_sent).toBeUndefined();
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe('accepted');
    expect(await mentorIdOf(formId)).toBeNull();
    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);
    expect(await tokenCount()).toBe(0);
  });

  test('A2: ระบุพี่เลี้ยงได้เฉพาะใบ accepted ของตัวเอง · ก่อนเจ้าหน้าที่ยืนยัน บัญชีปิด ไม่มีลิงก์ และพี่เลี้ยงขอลิงก์เองไม่ได้', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await putForm('accepted');
    const otherForm = await putForm('accepted', 'student1@test.com');

    // ใบสถานะอื่นทุกสถานะ = ปฏิเสธ (รวมขั้นรอเจ้าหน้าที่ยืนยันแบบตอบรับ ซึ่งเดิมคือขั้นเดียวที่ระบุได้)
    for (const status of [
      'pending_advisor',
      'pending_officer_request',
      'approved_by_dept_head',
      'pending_officer_approval',
      'rejected',
      'company_rejected',
    ]) {
      await dbExec('UPDATE intent_forms SET status = $2 WHERE form_id = $1', [formId, status]);
      const res = await postMentor(request, formId);
      expect(res.status(), `${status}: ${await res.text()}`).toBe(400);
      expect(await mentorIdOf(formId), status).toBeNull();
    }
    await dbExec("UPDATE intent_forms SET status = 'accepted' WHERE form_id = $1", [formId]);
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', [MENTOR_EMAIL])).toBe('0');

    // ใบของคนอื่น = ปฏิเสธ · บทบาทอื่น = 403 · ไม่ล็อกอิน = 401
    const foreign = await postMentor(request, otherForm);
    expect(foreign.status(), await foreign.text()).toBe(400);
    for (const who of ['staff1', 'advisor1', 'head1', 'dean1', 'mentor1'] as const) {
      expect((await postMentor(request, formId, mentorBody(), who)).status(), who).toBe(403);
    }
    const nobody = await playwrightRequest.newContext();
    try {
      expect((await nobody.post(`${API_URL}/intents/${formId}/mentor`, { data: mentorBody() })).status()).toBe(401);
    } finally {
      await nobody.dispose();
    }
    expect(await mentorIdOf(formId)).toBeNull();
    expect(await mentorIdOf(otherForm)).toBeNull();

    // ใบ accepted ของตัวเอง = ระบุได้ → บัญชีใหม่ยังปิด ไม่มีรหัสผ่าน ไม่มีลิงก์
    const ok = await postMentor(request, formId);
    expect(ok.status(), await ok.text()).toBe(200);
    const mentor = await account(MENTOR_EMAIL);
    expect(mentor).toMatchObject({ is_active: false, no_password: true, roles: ['mentor'] });
    expect(await mentorIdOf(formId)).toBe(mentor!.user_id);
    expect(await tokenCount()).toBe(0);
    expect(await stagesOf(formId)).toEqual(['mentor_set']);

    // พี่เลี้ยงที่ยังไม่ยืนยันขอลิงก์เองที่หน้า /login/mentor ไม่ได้ (ตอบ 200 เหมือนอีเมลอื่น แต่ไม่มีลิงก์ออก)
    const anon = await playwrightRequest.newContext();
    try {
      const asked = await anon.post(`${API_URL}/auth/mentor-link/request`, { data: { email: MENTOR_EMAIL } });
      expect(asked.status(), await asked.text()).toBe(200);
    } finally {
      await anon.dispose();
    }
    expect(await tokenCount()).toBe(0);

    // พิมพ์อีเมลผิดแก้เองได้ตราบที่ยังไม่ถูกยืนยัน — ใบชี้ไปคนใหม่ คนใหม่ก็ยังปิด
    const fixed = await postMentor(request, formId, mentorBody({ email: 'mentor-fixed-a2@example.com' }));
    expect(fixed.status(), await fixed.text()).toBe(200);
    const second = await account('mentor-fixed-a2@example.com');
    expect(second).toMatchObject({ is_active: false, no_password: true, roles: ['mentor'] });
    expect(await mentorIdOf(formId)).toBe(second!.user_id);
    expect(await tokenCount()).toBe(0);
  });

  test('A3: ยืนยันพี่เลี้ยง = เจ้าหน้าที่เท่านั้น — นักศึกษา อาจารย์ หัวหน้าสาขา คณบดี พี่เลี้ยง = 403 · ไม่ล็อกอิน = 401 · บัญชียังปิด', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await putForm('accepted');
    expect((await postMentor(request, formId)).status()).toBe(200);
    const mentorId = (await mentorIdOf(formId)) as number;

    for (const who of ['student2', 'student1', 'advisor1', 'head1', 'dean1', 'mentor1'] as const) {
      await apiLoginAs(request, who);
      const res = await confirmMentor(request, mentorId);
      expect(res.status(), `${who}: ${await res.text()}`).toBe(403);
    }
    const nobody = await playwrightRequest.newContext();
    try {
      expect((await confirmMentor(nobody, mentorId)).status()).toBe(401);
    } finally {
      await nobody.dispose();
    }
    expect(await account(MENTOR_EMAIL)).toMatchObject({ is_active: false, no_password: true });
    expect(await tokenCount()).toBe(0);
    expect(await stagesOf(formId)).toEqual(['mentor_set']);

    // เจ้าหน้าที่: รหัสผิดรูปแบบ = 400 · บัญชีที่ไม่มีใบ accepted ชี้มา = 409 (ไม่ใช่ทางเปิดบัญชีพี่เลี้ยงลอย ๆ)
    await apiLoginAs(request, 'staff1');
    expect((await request.post(`${API_URL}/mentor-followup/12abc/confirm`)).status()).toBe(400);
    expect((await confirmMentor(request, 999999)).status()).toBe(409);
    await dbExec("UPDATE intent_forms SET status = 'pending_officer_approval' WHERE form_id = $1", [formId]);
    const notAccepted = await confirmMentor(request, mentorId);
    expect(notAccepted.status(), await notAccepted.text()).toBe(409);
    expect(await account(MENTOR_EMAIL)).toMatchObject({ is_active: false });
    expect(await tokenCount()).toBe(0);
  });

  test('A4: เจ้าหน้าที่ยืนยัน — บัญชีเปิด ไม่มีรหัสผ่าน มีลิงก์ 7 วันที่ใช้ได้จริง · นักศึกษาแก้พี่เลี้ยงไม่ได้ (409) · ยืนยันซ้ำ = 409', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await putForm('accepted');
    expect((await postMentor(request, formId)).status()).toBe(200);
    const mentorId = (await mentorIdOf(formId)) as number;

    await apiLoginAs(request, 'staff1');
    const confirmed = await confirmMentor(request, mentorId);
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    expect((await confirmed.json()).mentor_email_sent).toBe(true);

    expect(await account(MENTOR_EMAIL)).toMatchObject({ is_active: true, no_password: true, roles: ['mentor'] });
    const links = await dbRows<{ token: string; used_at: string | null; days: number }>(
      `SELECT token, used_at, ROUND(EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400)::int AS days
         FROM mentor_login_tokens WHERE user_id = $1`,
      [mentorId]
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ used_at: null, days: 7 });
    expect(await stagesOf(formId)).toEqual(['mentor_set', 'mentor_confirmed']);

    // audit: ใครยืนยัน ยืนยันบัญชีไหน ของใบไหน — เก็บ token_id ไม่เก็บตัว token (SEC-07)
    const staffId = await userId('staff1@test.com');
    await expect
      .poll(
        async () =>
          dbRow<{ actor_id: number; entity_id: string; form_ids: string; has_token: boolean }>(
            `SELECT actor_id, entity_id, detail->>'form_ids' AS form_ids, (detail::text LIKE '%' || $2 || '%') AS has_token
               FROM audit_log WHERE action = 'mentor.confirmed' AND entity_id = $1`,
            [String(mentorId), links[0].token]
          ),
        { timeout: 10_000 }
      )
      .toEqual({ actor_id: staffId, entity_id: String(mentorId), form_ids: `[${formId}]`, has_token: false });

    // ลิงก์ใบนั้นเข้าระบบเป็นพี่เลี้ยงคนนี้ได้จริง
    const ctx = await playwrightRequest.newContext();
    try {
      const login = await ctx.post(`${API_URL}/auth/mentor-link/consume`, { data: { token: links[0].token } });
      expect(login.status(), await login.text()).toBe(200);
      expect((await login.json()).user.email).toBe(MENTOR_EMAIL);
    } finally {
      await ctx.dispose();
    }

    // ยืนยันแล้วนักศึกษาเปลี่ยนคนประเมินของตัวเองไม่ได้ — ทั้งเปลี่ยนคน และแก้ชื่อของคนเดิม
    for (const body of [mentorBody({ email: 'swap-a4@example.com' }), mentorBody({ name: 'ชื่อที่นักศึกษาแก้เอง' })]) {
      const late = await postMentor(request, formId, body);
      expect(late.status(), await late.text()).toBe(409);
      expect((await late.json()).code).toBe('mentor_confirmed');
    }
    expect(await mentorIdOf(formId)).toBe(mentorId);
    expect(await dbValue<string>('SELECT name FROM mentors WHERE mentor_id = $1', [mentorId])).toBe(SAMPLE_MENTOR.name);
    expect(await dbValue<string>('SELECT COUNT(*) FROM users WHERE email = $1', ['swap-a4@example.com'])).toBe('0');

    // ยืนยันซ้ำ = 409 ไม่ออกลิงก์เพิ่ม (ต้องการส่งลิงก์อีกครั้งใช้ send-link)
    await apiLoginAs(request, 'staff1');
    const again = await confirmMentor(request, mentorId);
    expect(again.status(), await again.text()).toBe(409);
    expect(await tokenCount(mentorId)).toBe(1);

    // ข้อจำกัดที่ยอมรับ (ด่านอยู่ระดับบัญชี): นักศึกษาอีกคนของบริษัทเดียวกันระบุพี่เลี้ยงที่ยืนยันแล้ว = ผูกทันที
    // ไม่มีลิงก์ใหม่ออก และไม่มีอะไรให้เจ้าหน้าที่ยืนยันอีก
    const otherForm = await putForm('accepted', 'student1@test.com');
    const shared = await postMentor(request, otherForm, mentorBody(), 'student1');
    expect(shared.status(), await shared.text()).toBe(200);
    expect(await mentorIdOf(otherForm)).toBe(mentorId);
    expect(await tokenCount(mentorId)).toBe(1);
  });

  test('A5: SEC-03 — อีเมลของบัญชีนักศึกษา/เจ้าหน้าที่/อาจารย์ถูกระบุเป็นพี่เลี้ยง = ปฏิเสธ · บัญชีที่ไม่ใช่พี่เลี้ยงล้วนยืนยันไม่ได้', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await putForm('accepted');
    const rolesBefore = await dbValue<string>('SELECT COUNT(*) FROM user_roles');
    const usersBefore = await dbValue<string>('SELECT COUNT(*) FROM users');

    for (const [label, email] of [
      ['อีเมลของนักศึกษาเอง', 'student2@test.com'],
      ['อีเมลของนักศึกษาเอง (ตัวพิมพ์ใหญ่)', 'STUDENT2@Test.com'],
      ['นักศึกษาคนอื่น', 'student1@test.com'],
      ['เจ้าหน้าที่', 'staff1@test.com'],
      ['อาจารย์ที่ปรึกษา', 'advisor1@test.com'],
      ['หัวหน้าสาขา', 'head1@test.com'],
      ['คณบดี', 'dean1@test.com'],
    ]) {
      const res = await postMentor(request, formId, mentorBody({ email }));
      expect(res.status(), `${label}: ${await res.text()}`).toBe(400);
      expect(await mentorIdOf(formId), label).toBeNull();
    }
    // ไม่มี role mentor ถูกแปะทับบัญชีไหน ไม่มีบัญชีเกิด
    expect(await dbValue<string>('SELECT COUNT(*) FROM user_roles')).toBe(rolesBefore);
    expect(await dbValue<string>('SELECT COUNT(*) FROM users')).toBe(usersBefore);

    // ด่านชั้นสองตอนยืนยัน — ใบชี้ไปบัญชีอาจารย์ที่มีแถว mentors ค้างจากข้อมูลเก่า (ยัดฐานตรง · ทางปกติเกิดไม่ได้):
    // ยืนยันไม่ได้ รหัสผ่านของเขาไม่ถูกล้าง ไม่มีลิงก์
    const advisorId = await userId('advisor1@test.com');
    const hashBefore = await dbValue<string>('SELECT password_hash FROM users WHERE user_id = $1', [advisorId]);
    await dbExec(
      `INSERT INTO mentors (mentor_id, company_id, name, phone)
       SELECT $1, company_id, 'อาจารย์ ที่ถูกระบุเป็นพี่เลี้ยง', '0800000000' FROM intent_forms WHERE form_id = $2`,
      [advisorId, formId]
    );
    await dbExec('UPDATE intent_forms SET mentor_id = $2 WHERE form_id = $1', [formId, advisorId]);
    await apiLoginAs(request, 'staff1');
    const notMentor = await confirmMentor(request, advisorId);
    expect(notMentor.status(), await notMentor.text()).toBe(403);
    expect(await dbValue<string>('SELECT password_hash FROM users WHERE user_id = $1', [advisorId])).toBe(hashBefore);
    expect(await tokenCount(advisorId)).toBe(0);

    // พี่เลี้ยงที่ถูกเติมบทบาทอื่นทีหลัง (ฐานปัจจุบันไม่ยอมให้เกิด — จำลองข้อมูลเก่า): ยืนยันไม่ได้ บัญชียังปิด
    await dbExec('UPDATE intent_forms SET mentor_id = NULL WHERE form_id = $1', [formId]);
    expect((await postMentor(request, formId)).status()).toBe(200);
    const mentorId = (await mentorIdOf(formId)) as number;
    await grantRoleBypassingMentorTrigger(mentorId, 'staff');
    await apiLoginAs(request, 'staff1');
    const dual = await confirmMentor(request, mentorId);
    expect(dual.status(), await dual.text()).toBe(403);
    expect(await account(MENTOR_EMAIL)).toMatchObject({ is_active: false, no_password: true });
    expect(await tokenCount(mentorId)).toBe(0);
  });

  test('A6: ปลายน้ำ — ไม่มีอีเมลออกถึงพี่เลี้ยงที่ยังไม่ยืนยัน (นัดนิเทศ · แจ้งประเมิน = 409) · หน้าติดตาม ท่อ และหน้าแรกนักศึกษาเห็นครบสามสภาพ', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await putForm('accepted');
    const studentId = await userId('student2@test.com');
    const studentCode = await dbValue<string>('SELECT student_code FROM students WHERE student_id = $1', [studentId]);

    // อาจารย์นิเทศร่างนัดไว้ก่อนมีพี่เลี้ยง (ร่างได้ตามปกติ)
    await apiLoginAs(request, 'advisor1');
    const draft = await request.post(`${API_URL}/appointments/draft`, {
      data: { student_id: studentId, appointment_date: '2026-12-12', student_time: '09:30', mentor_time: '10:30' },
    });
    expect(draft.status(), await draft.text()).toBe(201);
    const appointmentId = (await draft.json()).data.appointment_id as number;
    const appointmentStatus = () =>
      dbValue<string>('SELECT status FROM supervision_appointments WHERE appointment_id = $1', [appointmentId]);

    const followup = async (who: AccountKey) => {
      await apiLoginAs(request, who);
      const res = await request.get(`${API_URL}/mentor-followup`);
      expect(res.status(), await res.text()).toBe(200);
      return res.json();
    };
    const gaps = async () => {
      await apiLoginAs(request, 'staff1');
      const body = await (await request.get(`${API_URL}/staff/pipeline`)).json();
      const count = (key: string) => body.gaps.find((g: { key: string }) => g.key === key).count as number;
      return { no_mentor: count('no_mentor'), unconfirmed: count('mentor_unconfirmed'), never: count('mentor_never_logged_in') };
    };
    const dashboardMentor = async () => {
      await apiLoginAs(request, 'student2');
      return (await (await request.get(`${API_URL}/students/dashboard`)).json()).activeIntent.mentor;
    };
    const sendAppointment = async () => {
      await apiLoginAs(request, 'staff1');
      return request.put(`${API_URL}/appointments/${appointmentId}/audit-send`);
    };
    const notify = async () => {
      await apiLoginAs(request, 'staff1');
      return request.post(`${API_URL}/final-reports/notify-mentor/${studentId}`);
    };
    const appointmentRow = async () => {
      await apiLoginAs(request, 'staff1');
      const rows = (await (await request.get(`${API_URL}/appointments`)).json()).data as Array<{
        appointment_id: number;
        mentor_email: string | null;
        mentor_status: string;
      }>;
      return rows.find((r) => r.appointment_id === appointmentId)!;
    };

    // ── สภาพ 1: ยังไม่ระบุพี่เลี้ยง ──
    let staffView = await followup('staff1');
    expect(staffView.unassigned).toEqual([
      expect.objectContaining({ form_id: formId, student_id: studentId, student_code: studentCode, start_date: '2026-11-02' }),
    ]);
    expect(staffView.mentors.some((m: { students: { student_id: number }[] }) => m.students.some((s) => s.student_id === studentId))).toBe(false);
    // ขอบเขต SEC-16 เท่าเดิม: อาจารย์ของนักศึกษาเห็น · อาจารย์คนอื่นไม่เห็น · บทบาทนอกสามบทบาท = 403
    expect((await followup('advisor1')).unassigned.map((u: { form_id: number }) => u.form_id)).toEqual([formId]);
    expect((await followup('advisor2')).unassigned).toEqual([]);
    for (const who of ['student2', 'mentor1', 'dean1'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(`${API_URL}/mentor-followup`)).status(), who).toBe(403);
    }
    expect(await gaps()).toEqual({ no_mentor: 1, unconfirmed: 0, never: 0 });
    expect(await dashboardMentor()).toBeNull();
    expect(await appointmentRow()).toMatchObject({ mentor_email: null, mentor_status: 'none' });

    let sent = await sendAppointment();
    expect(sent.status(), await sent.text()).toBe(409);
    expect((await sent.json()).code).toBe('mentor_missing');
    let notified = await notify();
    expect(notified.status(), await notified.text()).toBe(409);
    expect((await notified.json()).code).toBe('mentor_not_ready');

    // งานของนักศึกษาเองส่งได้ตามปกติ — งานแค่รอพี่เลี้ยง
    await apiLoginAs(request, 'student2');
    const log = await request.post(`${API_URL}/weekly-logs`, {
      data: {
        week_number: 1,
        status: 'submitted',
        assigned_work: 'ศึกษาระบบงานของแผนก',
        methods: 'อ่านเอกสารและสอบถามพนักงาน',
        tools_used: 'คอมพิวเตอร์',
        achievements: 'เข้าใจขั้นตอนงานเบื้องต้น',
        problems: '',
      },
    });
    expect([200, 201], await log.text()).toContain(log.status());

    // ── สภาพ 2: ระบุแล้ว รอเจ้าหน้าที่ยืนยัน ──
    expect((await postMentor(request, formId)).status()).toBe(200);
    const mentorId = (await mentorIdOf(formId)) as number;

    staffView = await followup('staff1');
    expect(staffView.unassigned).toEqual([]);
    expect(staffView.mentors.find((m: { mentor_id: number }) => m.mentor_id === mentorId)).toMatchObject({
      email: MENTOR_EMAIL,
      name: SAMPLE_MENTOR.name,
      is_active: false,
      student_count: 1,
      // บันทึกสัปดาห์ที่ส่งไว้ก่อนมีพี่เลี้ยงเข้าคิวของพี่เลี้ยงเองทันทีที่ถูกระบุ ไม่ตกหล่น
      pending_total: 1,
    });
    expect(await gaps()).toEqual({ no_mentor: 0, unconfirmed: 1, never: 0 });
    expect(await dashboardMentor()).toMatchObject({ email: MENTOR_EMAIL, confirmed: false });
    // ⛔ อีเมลของพี่เลี้ยงที่ยังไม่ยืนยันไม่ถูกส่งให้หน้านัดนิเทศใช้เป็นปลายทาง
    expect(await appointmentRow()).toMatchObject({ mentor_email: null, mentor_status: 'unconfirmed' });

    sent = await sendAppointment();
    expect(sent.status(), await sent.text()).toBe(409);
    expect((await sent.json()).code).toBe('mentor_unconfirmed');
    expect(await appointmentStatus()).toBe('draft');
    notified = await notify();
    expect(notified.status(), await notified.text()).toBe(409);
    // ปุ่มเตือน/ส่งลิงก์ของหน้าติดตามก็ไม่ส่งอะไรให้บัญชีที่ยังปิด
    await apiLoginAs(request, 'staff1');
    expect((await request.post(`${API_URL}/mentor-followup/${mentorId}/remind`)).status()).toBe(403);
    expect((await request.post(`${API_URL}/mentor-followup/${mentorId}/send-link`)).status()).toBe(403);
    expect(await tokenCount()).toBe(0);
    expect(await dbValue<string>('SELECT COUNT(*) FROM mentor_reminders')).toBe('0');
    expect(await dbValue<string>('SELECT COUNT(*) FROM mentor_notifications')).toBe('0');

    // ── สภาพ 3: เจ้าหน้าที่ยืนยันแล้ว ──
    const confirmed = await confirmMentor(request, mentorId);
    expect(confirmed.status(), await confirmed.text()).toBe(200);

    expect((await followup('staff1')).mentors.find((m: { mentor_id: number }) => m.mentor_id === mentorId)).toMatchObject({
      is_active: true,
    });
    expect(await gaps()).toEqual({ no_mentor: 0, unconfirmed: 0, never: 1 });
    expect(await dashboardMentor()).toMatchObject({ email: MENTOR_EMAIL, confirmed: true });
    expect(await appointmentRow()).toMatchObject({ mentor_email: MENTOR_EMAIL, mentor_status: 'confirmed' });

    sent = await sendAppointment();
    expect(sent.status(), await sent.text()).toBe(200);
    expect(await appointmentStatus()).toBe('pending_company');
    notified = await notify();
    expect(notified.status(), await notified.text()).toBe(200);
  });
});
