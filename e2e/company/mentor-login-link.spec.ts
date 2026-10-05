import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbRows, dbValue, dbExec, grantRoleBypassingMentorTrigger } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';
import { walkToSigned } from '../helpers/intent';

/**
 * พี่เลี้ยงเข้าสู่ระบบด้วยลิงก์ในอีเมลครั้งเดียว (ขั้นทดลอง 2026-10-02) — ไม่มีรหัสผ่าน
 *
 * ลิงก์ = session จริง จึงคุม **ด่านสิทธิ์ก่อนหน้าตา**:
 *   ออกได้เฉพาะบัญชีพี่เลี้ยงล้วน (SEC-03) ทั้งตอนขอและตอนใช้ · ใช้ครั้งเดียว · cooldown 60 วิ
 *   · ไม่มี JWT ใน body (SEC-08) · `target` เป็น path ภายในเท่านั้น (กัน open redirect)
 *   · ขอลิงก์ตอบ 200 เหมือนกันทุกกรณี (ไม่เปิดช่อง enumerate อีเมล)
 *
 * M1 ขอลิงก์ · M2 SEC-03 · M3 ใช้ลิงก์สำเร็จ · M4 token ใช้ไม่ได้ · M5 target · M6 cooldown/ขอใหม่
 * M7 เจ้าหน้าที่กดรับ → ออกลิงก์ 7 วัน (ไม่มีรหัสผ่าน/reset token) · M8 หน้า /m · M9 หน้า /login/mentor
 *
 * การส่งเมลไม่ออกเน็ต (`MAIL_DRY_RUN=true` ใน playwright.config.ts) · ข้อมูลทั้งหมดเป็นของปลอม
 */

const MENTOR_LINK = `${API_URL}/auth/mentor-link`;
const MENTOR1 = 'mentor1@test.com';
const OK_MESSAGE = 'ถ้าอีเมลนี้เป็นพี่เลี้ยงในระบบ จะได้รับลิงก์เข้าสู่ระบบภายในไม่กี่นาที';

const PDF_FIXTURE = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const JWT_LIKE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

const userId = async (email: string): Promise<number> =>
  (await dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email])) as number;

interface TokenOpts {
  target?: string | null;
  /** วินาทีที่เหลือก่อนหมดอายุ (ติดลบ = หมดอายุแล้ว) */
  expiresInSec?: number;
  /** ออกเมื่อกี่วินาทีที่แล้ว — ค่าเริ่มต้น 0 = เพิ่งออก (ติด cooldown) */
  createdAgoSec?: number;
  used?: boolean;
}

/** ยัดแถว token ตรงๆ ในฐาน — ไว้เตรียมสถานะที่ต้องการ */
async function insertToken(email: string, opts: TokenOpts = {}): Promise<string> {
  const token = crypto.randomUUID();
  await dbExec(
    `INSERT INTO mentor_login_tokens (token, user_id, target, expires_at, used_at, created_at)
     VALUES ($1::uuid, (SELECT user_id FROM users WHERE email = $2), $3,
             NOW() + ($4::int * INTERVAL '1 second'),
             CASE WHEN $5::boolean THEN NOW() END,
             NOW() - ($6::int * INTERVAL '1 second'))`,
    [token, email, opts.target ?? null, opts.expiresInSec ?? 1800, opts.used === true, opts.createdAgoSec ?? 0]
  );
  return token;
}

const tokenRow = (token: string) =>
  dbRow<{ token_id: number; used_at: string | null; target: string | null }>(
    'SELECT token_id, used_at, target FROM mentor_login_tokens WHERE token = $1',
    [token]
  );

const tokenCountFor = async (email: string): Promise<number> =>
  Number(
    await dbValue<string>(
      'SELECT COUNT(*) FROM mentor_login_tokens WHERE user_id = (SELECT user_id FROM users WHERE email = $1)',
      [email]
    )
  );

const totalTokens = async (): Promise<number> =>
  Number(await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens'));

/** เวลาหมดอายุของ token อยู่ในช่วง [minSec, maxSec] จากตอนนี้หรือไม่ (คำนวณที่ Postgres) */
const expiresWithin = (token: string, minSec: number, maxSec: number) =>
  dbValue<boolean>(
    `SELECT expires_at > NOW() + ($2::int * INTERVAL '1 second')
        AND expires_at < NOW() + ($3::int * INTERVAL '1 second')
       FROM mentor_login_tokens WHERE token = $1`,
    [token, minSec, maxSec]
  );

const keysDeep = (value: unknown, out: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
};

test.describe('พี่เลี้ยงเข้าสู่ระบบด้วยลิงก์ — ด่านสิทธิ์ ใช้ครั้งเดียว และผลข้างเคียง', () => {
  let anon: APIRequestContext;

  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('DELETE FROM mentor_login_tokens');
    // ไม่มี cookie ใดๆ — พี่เลี้ยงยังไม่ได้เข้าระบบ
    anon = await playwrightRequest.newContext();
  });

  test.afterEach(async () => {
    await anon.dispose();
  });

  const requestLink = (email: string) => anon.post(`${MENTOR_LINK}/request`, { data: { email } });
  const consume = (token: string, ctx: APIRequestContext = anon) =>
    ctx.post(`${MENTOR_LINK}/consume`, { data: { token } });
  const resend = (token: string) => anon.post(`${MENTOR_LINK}/resend`, { data: { token } });

  test('M1: ขอลิงก์ — พี่เลี้ยง = token 1 ใบอายุ ~30 นาที · อีเมลที่ไม่มีในระบบ = ตอบเหมือนกันเป๊ะ ไม่มี token', async () => {
    const real = await requestLink(MENTOR1);
    expect(real.status(), await real.text()).toBe(200);
    const realBody = await real.json();
    expect(realBody).toEqual({ message: OK_MESSAGE });

    const rows = await dbRows<{ token: string }>(
      'SELECT token FROM mentor_login_tokens WHERE user_id = $1',
      [await userId(MENTOR1)]
    );
    expect(rows).toHaveLength(1);
    expect(await expiresWithin(rows[0].token, 25 * 60, 31 * 60)).toBe(true);
    expect(await tokenRow(rows[0].token)).toMatchObject({ used_at: null });
    expect(await totalTokens()).toBe(1);

    // อีเมลที่ไม่มีบัญชี — ผู้ถามแยกไม่ออก (status + body เหมือนกัน) และไม่มีอะไรถูกสร้าง
    const ghost = await requestLink('nobody-m1@example.com');
    expect(ghost.status()).toBe(200);
    expect(await ghost.json()).toEqual(realBody);
    expect(await totalTokens()).toBe(1);
    expect(await dbValue<string>("SELECT COUNT(*) FROM users WHERE email = 'nobody-m1@example.com'")).toBe('0');

    // ตัวพิมพ์ใหญ่/เว้นวรรคของอีเมลจริงถูกรวมเป็นบัญชีเดิม → ติด cooldown ไม่ออกใบที่สอง
    const upper = await requestLink(`  ${MENTOR1.toUpperCase()}  `);
    expect(upper.status()).toBe(200);
    expect(await upper.json()).toEqual(realBody);
    expect(await totalTokens()).toBe(1);

    // อีเมลว่าง = 400 (ไม่ใช่ 200 ที่ทำให้ดูเหมือนส่งแล้ว)
    expect((await anon.post(`${MENTOR_LINK}/request`, { data: { email: '   ' } })).status()).toBe(400);
    expect((await anon.post(`${MENTOR_LINK}/request`, { data: {} })).status()).toBe(400);
  });

  test('M2: SEC-03 — บัญชีที่ไม่ใช่พี่เลี้ยงล้วน ขอลิงก์ไม่ได้ token และ ใช้ลิงก์ที่ยัดมาก็ไม่ได้ (403) ไม่มี session', async () => {
    const others = ['staff1', 'advisor1', 'student1', 'dean1'].map((k) => `${k}@test.com`);

    const baseline = await (await requestLink('nobody-m2@example.com')).json();
    for (const email of others) {
      const res = await requestLink(email);
      expect(res.status(), email).toBe(200);
      expect(await res.json(), email).toEqual(baseline);
      expect(await tokenCountFor(email), `ขอลิงก์ของ ${email} ต้องไม่สร้าง token`).toBe(0);
    }
    expect(await totalTokens()).toBe(0);

    // ยัด token ให้แต่ละบัญชีตรงๆ — ลิงก์ที่ valid ทุกอย่าง ยกเว้นเจ้าของไม่ใช่พี่เลี้ยงล้วน
    for (const email of others) {
      const token = await insertToken(email);
      const ctx = await playwrightRequest.newContext();
      try {
        const res = await consume(token, ctx);
        expect(res.status(), `${email}: ${await res.text()}`).toBe(403);
        expect(res.headers()['set-cookie'], email).toBeUndefined();
        expect((await tokenRow(token))!.used_at, `${email} token ต้องไม่ถูกเผา`).toBeNull();
        expect((await ctx.get(`${API_URL}/auth/me`)).status(), `${email} ต้องไม่มี session`).toBe(401);
      } finally {
        await ctx.dispose();
      }
    }

    // resend จาก token ของบัญชีเหล่านี้ก็ต้องไม่ออกใบใหม่
    const staffToken = await insertToken('staff1@test.com', { createdAgoSec: 600 });
    const before = await totalTokens();
    expect((await resend(staffToken)).status()).toBe(403);
    expect(await totalTokens()).toBe(before);

    // บัญชีพี่เลี้ยงที่ถูกเพิ่มบทบาทอื่นทีหลัง = ไม่ใช่พี่เลี้ยงล้วนแล้ว → ใช้ลิงก์ที่ออกไปก่อนหน้าไม่ได้
    const mentorToken = await insertToken(MENTOR1);
    // ฐานไม่ยอมให้บัญชีแบบนี้เกิดอีกแล้ว (migration 043) — จำลองข้อมูลเก่าด้วยการข้าม trigger ชั่วคราว
    // เพื่อพิสูจน์ว่าด่านในแอปยังกันได้เองเป็นชั้นสอง
    await grantRoleBypassingMentorTrigger(
      (await dbValue<number>('SELECT user_id FROM users WHERE email = $1', [MENTOR1]))!,
      'advisor'
    );
    expect((await consume(mentorToken)).status()).toBe(403);
    expect((await tokenRow(mentorToken))!.used_at).toBeNull();
    expect((await anon.get(`${API_URL}/auth/me`)).status()).toBe(401);
  });

  test('M3: ใช้ลิงก์สำเร็จ — session เป็นพี่เลี้ยง · ไม่มี JWT ใน body · token ถูกเผา · audit ไม่เก็บตัว token', async () => {
    const token = await insertToken(MENTOR1);
    const row = await tokenRow(token);

    const res = await consume(token);
    expect(res.status(), await res.text()).toBe(200);

    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.target).toBe('/dashboard');
    expect(body.user.email).toBe(MENTOR1);
    expect(body.user.roles).toEqual(['mentor']);

    // SEC-08: session อยู่ใน httpOnly cookie เท่านั้น
    const keys = keysDeep(body).map((k) => k.toLowerCase());
    for (const banned of ['token', 'jwt', 'accesstoken', 'access_token']) {
      expect(keys, `body มีคีย์ ${banned}`).not.toContain(banned);
    }
    expect(text).not.toMatch(JWT_LIKE);
    expect(text).not.toContain(token);
    const setCookie = res.headers()['set-cookie'] ?? '';
    expect(setCookie).toMatch(/httponly/i);

    // cookie ล้วนๆ ยืนยันตัวตนได้
    const me = await anon.get(`${API_URL}/auth/me`);
    expect(me.status()).toBe(200);
    expect((await me.json()).user.roles).toEqual(['mentor']);

    expect((await tokenRow(token))!.used_at).not.toBeNull();

    await expect
      .poll(
        async () =>
          dbRow<{ token_id: string; has_token: boolean; subject: string }>(
            `SELECT detail->>'token_id' AS token_id,
                    (detail::text LIKE '%' || $2 || '%') AS has_token,
                    subject_id::text AS subject
               FROM audit_log WHERE action = 'auth.mentor_link_login' AND entity_id = $1`,
            [String(row!.token_id), token]
          ),
        { timeout: 10_000 }
      )
      .toEqual({ token_id: String(row!.token_id), has_token: false, subject: String(await userId(MENTOR1)) });
  });

  test('M4: token ใช้ไม่ได้ — ไม่รู้จัก/ไม่ใช่ UUID = 404 · หมดอายุ/ใช้แล้ว = 410 · บัญชีถูกระงับ = 403 ไม่เผา token', async () => {
    // ไม่รู้จัก
    for (const bad of [crypto.randomUUID(), 'not-a-uuid', "' OR 1=1 --", '../../etc/passwd']) {
      const res = await consume(bad);
      expect(res.status(), `token "${bad}"`).toBe(404);
      expect(res.headers()['set-cookie'], bad).toBeUndefined();
    }
    // ไม่ส่ง token เลย = 400 (ไม่ใช่ session)
    expect((await anon.post(`${MENTOR_LINK}/consume`, { data: {} })).status()).toBe(400);
    expect((await anon.get(`${API_URL}/auth/me`)).status()).toBe(401);

    // หมดอายุ
    const expired = await insertToken(MENTOR1, { expiresInSec: -60, createdAgoSec: 120 });
    const gone = await consume(expired);
    expect(gone.status(), await gone.text()).toBe(410);
    expect(gone.headers()['set-cookie']).toBeUndefined();
    expect((await tokenRow(expired))!.used_at).toBeNull();

    // ใช้ซ้ำหลังสำเร็จ
    const once = await insertToken(MENTOR1, { createdAgoSec: 120 });
    expect((await consume(once)).status()).toBe(200);
    const ctx2 = await playwrightRequest.newContext();
    try {
      const again = await consume(once, ctx2);
      expect(again.status()).toBe(410);
      expect(again.headers()['set-cookie']).toBeUndefined();
      expect((await ctx2.get(`${API_URL}/auth/me`)).status()).toBe(401);
    } finally {
      await ctx2.dispose();
    }

    // บัญชีถูกระงับ — ปฏิเสธและ **ไม่เผา** token (คืนสิทธิ์แล้วใช้ได้)
    const valid = await insertToken(MENTOR1, { createdAgoSec: 120 });
    await dbExec('UPDATE users SET is_active = FALSE WHERE email = $1', [MENTOR1]);
    const ctx3 = await playwrightRequest.newContext();
    try {
      const blocked = await consume(valid, ctx3);
      expect(blocked.status(), await blocked.text()).toBe(403);
      expect(blocked.headers()['set-cookie']).toBeUndefined();
      expect((await tokenRow(valid))!.used_at).toBeNull();
      expect((await ctx3.get(`${API_URL}/auth/me`)).status()).toBe(401);
    } finally {
      await ctx3.dispose();
    }

    // ตัวควบคุม: เปิดบัญชีคืน → token เดียวกันใช้ได้ (403 ข้างบนมาจากสิทธิ์ ไม่ใช่ token)
    await dbExec('UPDATE users SET is_active = TRUE WHERE email = $1', [MENTOR1]);
    expect((await consume(valid)).status()).toBe(200);
  });

  test('M5: target — URL นอกเว็บ/`//host` ถูกแทนด้วย /dashboard · path ภายในผ่านครบ', async () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      const token = await insertToken(MENTOR1, { target: bad });
      const ctx = await playwrightRequest.newContext();
      try {
        const res = await consume(token, ctx);
        expect(res.status(), `${bad}: ${await res.text()}`).toBe(200);
        expect((await res.json()).target, bad).toBe('/dashboard');
      } finally {
        await ctx.dispose();
      }
    }

    const internal = '/dashboard?menu=final_evaluation';
    const good = await insertToken(MENTOR1, { target: internal });
    const res = await consume(good);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).target).toBe(internal);
  });

  test('M6: cooldown 60 วิ — ขอซ้ำไม่เพิ่ม · ขอใหม่จากลิงก์หมดอายุได้ (เมลไปอีเมลในทะเบียน) · ซ้ำในช่วง cooldown = 429', async () => {
    // ขอสองครั้งติด — ใบเดียว
    expect((await requestLink(MENTOR1)).status()).toBe(200);
    expect((await requestLink(MENTOR1)).status()).toBe(200);
    expect(await tokenCountFor(MENTOR1)).toBe(1);

    await dbExec('DELETE FROM mentor_login_tokens');

    // token ไม่รู้จัก → 404 · ไม่ออกใบ
    expect((await resend(crypto.randomUUID())).status()).toBe(404);
    expect((await resend('not-a-uuid')).status()).toBe(404);
    expect(await totalTokens()).toBe(0);

    // ลิงก์หมดอายุ ออกเมื่อ 2 นาทีก่อน (พ้น cooldown) พร้อม target — ขอใหม่ได้ · target ถูกคัดลอก
    const target = '/dashboard?menu=final_evaluation';
    const old = await insertToken(MENTOR1, { expiresInSec: -60, createdAgoSec: 120, target });
    const oldRow = await tokenRow(old);
    const res = await resend(old);
    expect(res.status(), await res.text()).toBe(200);

    const fresh = await dbRows<{ token: string; target: string | null; user_id: number; used_at: string | null }>(
      'SELECT token, target, user_id, used_at FROM mentor_login_tokens WHERE token_id > $1',
      [oldRow!.token_id]
    );
    expect(fresh).toHaveLength(1);
    expect(fresh[0].user_id).toBe(await userId(MENTOR1));
    expect(fresh[0].target).toBe(target);
    expect(fresh[0].used_at).toBeNull();
    expect(fresh[0].token).not.toBe(old);
    expect(await expiresWithin(fresh[0].token, 25 * 60, 31 * 60)).toBe(true);
    // ใบเก่าไม่ถูกแตะ
    expect((await tokenRow(old))!.used_at).toBeNull();

    // ขอซ้ำทันที (ใบใหม่เพิ่งออก) → 429 · ไม่ออกใบเพิ่ม
    const again = await resend(old);
    expect(again.status(), await again.text()).toBe(429);
    expect(await tokenCountFor(MENTOR1)).toBe(2);

    // ขอจากหน้า request ในช่วง cooldown ก็ไม่ออกใบเพิ่ม (และตอบ 200 เหมือนเดิม)
    expect((await requestLink(MENTOR1)).status()).toBe(200);
    expect(await tokenCountFor(MENTOR1)).toBe(2);
  });

  test('M7: เจ้าหน้าที่กดรับแบบตอบรับ — บัญชีพี่เลี้ยงใหม่เปิดใช้ ไม่มีรหัสผ่าน ไม่มี reset token · มีลิงก์เข้าระบบ 7 วัน 1 ใบ', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const mentorEmail = 'mentor-login-m7@example.com';

    const formId = await withDb(async (db) => {
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
    await walkToSigned(request, formId);

    await apiLoginAs(request, 'student2');
    const sent = await request.post(`${API_URL}/intents/${formId}/send-to-company`, {
      data: { company_email: 'hr-m7@example.com' },
    });
    expect(sent.status(), await sent.text()).toBe(200);
    const linkToken = (await dbValue<string>(
      'SELECT token FROM acceptance_link_tokens WHERE form_id = $1 ORDER BY token_id DESC LIMIT 1',
      [formId]
    )) as string;

    const today = (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;
    const company = await playwrightRequest.newContext();
    try {
      const accepted = await company.post(
        `${API_URL}/public/acceptance/accept?token=${encodeURIComponent(linkToken)}`,
        {
          multipart: {
            evidence: {
              name: 'acceptance-signed.pdf',
              mimeType: 'application/pdf',
              buffer: fs.readFileSync(PDF_FIXTURE),
            },
            signer_name: 'คุณสมชาย ผู้จัดการฝ่ายบุคคล',
            signer_position: 'ผู้จัดการฝ่ายบุคคล',
            signed_date: today,
            start_date: '2026-11-02',
          },
        }
      );
      expect(accepted.status(), await accepted.text()).toBe(200);
    } finally {
      await company.dispose();
    }

    // บริษัทตอบทางลิงก์ไม่ได้ระบุพี่เลี้ยง (ตัดสหกิจ 07 ฝั่งบริษัท 2026-10-05) — นักศึกษาระบุเอง
    await apiLoginAs(request, 'student2');
    const mentorSet = await request.post(`${API_URL}/intents/${formId}/mentor`, {
      data: { name: 'สุรเดช ใจดี', email: mentorEmail, phone: '0812223333', position: 'Supervisor', department: 'QA' },
    });
    expect(mentorSet.status(), await mentorSet.text()).toBe(200);

    // ก่อนเจ้าหน้าที่กดรับ: บัญชียังปิด และยังไม่มีลิงก์เข้าระบบใดๆ
    const mentorBefore = await dbRow<{ is_active: boolean }>('SELECT is_active FROM users WHERE email = $1', [
      mentorEmail,
    ]);
    expect(mentorBefore?.is_active).toBe(false);
    expect(await tokenCountFor(mentorEmail)).toBe(0);

    await apiLoginAs(request, 'staff1');
    const approved = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
      data: { action: 'accepted' },
    });
    expect(approved.status(), await approved.text()).toBe(200);
    const approvedBody = await approved.json();
    expect(approvedBody.success).toBe(true);
    expect(approvedBody.mentor_email_sent, JSON.stringify(approvedBody)).not.toBe(false);

    const mentor = await dbRow<{
      is_active: boolean;
      no_password: boolean;
      no_reset: boolean;
      roles: string[];
    }>(
      `SELECT is_active, (password_hash IS NULL) AS no_password,
              (reset_token IS NULL AND reset_token_expires IS NULL) AS no_reset,
              (SELECT array_agg(r.role_name) FROM user_roles r WHERE r.user_id = users.user_id) AS roles
         FROM users WHERE email = $1`,
      [mentorEmail]
    );
    expect(mentor).toEqual({ is_active: true, no_password: true, no_reset: true, roles: ['mentor'] });

    const links = await dbRows<{ token: string; used_at: string | null }>(
      'SELECT token, used_at FROM mentor_login_tokens WHERE user_id = (SELECT user_id FROM users WHERE email = $1)',
      [mentorEmail]
    );
    expect(links).toHaveLength(1);
    expect(links[0].used_at).toBeNull();
    // 7 วัน (ยอมคลาดเคลื่อน ±0.1 วัน)
    expect(await expiresWithin(links[0].token, Math.round(6.9 * 86400), Math.round(7.1 * 86400))).toBe(true);

    // ลิงก์ใบนั้นใช้ได้จริงและเข้าเป็นพี่เลี้ยงคนนี้
    const ctx = await playwrightRequest.newContext();
    try {
      const login = await consume(links[0].token, ctx);
      expect(login.status(), await login.text()).toBe(200);
      expect((await login.json()).user.email).toBe(mentorEmail);
    } finally {
      await ctx.dispose();
    }
  });

  test('M8: หน้า /m — แลกลิงก์แล้วเข้าหน้าพี่เลี้ยง URL ไม่มี token · เปิดซ้ำ = ลิงก์ใช้ไม่ได้แล้ว + ปุ่มขอใหม่', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const token = await insertToken(MENTOR1, { createdAgoSec: 120 });

    await page.goto(`/m?token=${token}`);
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    expect(page.url()).not.toContain('token=');
    // หน้าแรกของพี่เลี้ยง — หัวข้อเฉพาะบทบาทนี้
    await expect(page.getByRole('heading', { name: 'รอคุณรับรอง' })).toBeVisible({ timeout: 30_000 });
    expect((await tokenRow(token))!.used_at).not.toBeNull();

    // ประวัติเบราว์เซอร์ต้องไม่พา URL ที่มี token กลับมา (navigate แบบ replace)
    await page.goBack().catch(() => null);
    expect(page.url()).not.toContain('token=');

    // เปิดลิงก์เดิมอีกครั้ง (ล้าง session ก่อน — ไม่งั้นดูเหมือนยังล็อกอินอยู่)
    await page.request.post(`${API_URL}/auth/logout`);
    await page.goto(`/m?token=${token}`);
    await expect(page.getByTestId('ml-gone')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ml-resend')).toBeVisible();
    expect(page.url()).toContain('/m');

    // ลิงก์ที่ไม่รู้จัก = หน้าไม่พบลิงก์ (ไม่มีปุ่มขอใหม่)
    await page.goto(`/m?token=${crypto.randomUUID()}`);
    await expect(page.getByTestId('ml-notfound')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ml-resend')).toHaveCount(0);
  });

  test('M9: หน้า /login/mentor — อีเมลพี่เลี้ยงกับอีเมลที่ไม่มีในระบบ เห็นข้อความเดียวกัน', async ({ page }) => {
    test.setTimeout(120_000);

    const submitEmail = async (email: string): Promise<string> => {
      await page.goto('/login/mentor');
      await page.getByTestId('login-mentor-email').fill(email);
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/auth/mentor-link/request')),
        page.getByTestId('login-mentor-submit').click(),
      ]);
      expect(resp.status()).toBe(200);
      const message = (await resp.json()).message as string;
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      return message;
    };

    const real = await submitEmail(MENTOR1);
    expect(await tokenCountFor(MENTOR1)).toBe(1);

    const ghost = await submitEmail('nobody-m9@example.com');
    expect(ghost).toBe(real);
    expect(real).toBe(OK_MESSAGE);
    expect(await totalTokens()).toBe(1);
  });
});
