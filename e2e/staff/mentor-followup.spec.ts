import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import crypto from 'crypto';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs, DEFAULT_PASSWORD } from '../helpers/auth';
import type { AccountKey } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { placementCard } from '../helpers/intent';
import { dbExec, dbRow, dbRows, dbValue, grantRoleBypassingMentorTrigger } from '../helpers/db';

/**
 * ติดตามพี่เลี้ยง (คณะตามพี่เลี้ยง Phase 2) — เจ้าหน้าที่ · หัวหน้าสาขา · อาจารย์ เห็นว่าพี่เลี้ยงคนไหนมีงานค้าง
 * เตือนทางอีเมลได้ · เจ้าหน้าที่คนเดียวที่แก้อีเมล/ส่งลิงก์เปล่าให้พี่เลี้ยงได้
 *
 * คุม **ด่านสิทธิ์ก่อนหน้าตา** เพราะเรื่องที่พังเงียบคือ "ใครเห็นพี่เลี้ยงของใคร" และ "ใครเปลี่ยนอีเมลที่เป็นปลายทางของ
 * ลิงก์เข้าระบบได้" (ลิงก์เข้าระบบ = session จริง — แก้อีเมลของบัญชีที่ไม่ใช่พี่เลี้ยงล้วนเท่ากับยึดบัญชีนั้น · SEC-03):
 *
 *   F1 บทบาทที่เข้าไม่ได้ · F2 ขอบเขต (staff > dept_head > advisor · fail closed · นับเฉพาะนักศึกษาในขอบเขต)
 *   F3 ตัวเลขงานค้างตรงเป๊ะ · F4 เตือนสำเร็จ (แถวเตือน + ลิงก์ 7 วัน + audit ไม่มี token) · F4b อาจารย์/หัวหน้าสาขาเตือนได้ในขอบเขต
 *   F5 เตือนไม่ได้ (ไม่มีงาน · นอกขอบเขต · ถูกระงับ · ไม่ใช่พี่เลี้ยงล้วน) · F6 ส่งลิงก์เปล่า · F7 แก้อีเมล
 *   F8 การเตือนทุกชนิดนับรวมกัน
 *   F9 นักศึกษาเห็นแค่จำนวนครั้ง (API + การ์ดบนหน้าแรก) · F10 หน้าจอเจ้าหน้าที่ · F11 หน้าจอแก้อีเมล/ส่งลิงก์
 *   F12 หน้าจออาจารย์/หัวหน้าสาขา เห็นแถวแต่ไม่มีปุ่มที่กดแล้ว 403
 *   F13 พี่เลี้ยงที่บัญชียังไม่เปิดใช้ — ปุ่มเตือน/ส่งลิงก์ปิดพร้อมคำอธิบาย
 *
 * การส่งเมลไม่ออกเน็ต (`MAIL_DRY_RUN=true` ใน playwright.config.ts) · ข้อมูลทั้งหมดเป็นของปลอม
 */

const BASE = `${API_URL}/mentor-followup`;
const ORIGINAL_MENTOR1_EMAIL = 'mentor1@test.com';

interface FollowupRow {
  mentor_id: number;
  name: string;
  email: string;
  company_name: string | null;
  is_active: boolean;
  student_count: number;
  students: { student_id: number; student_name: string }[];
  pending_total: number;
  pending_overdue: number;
  oldest_days_waiting: number | null;
  pending_by_kind: Record<string, number>;
  eval_missing_students: number;
  last_reminded_at: string | null;
  reminder_count: number;
  last_login_at: string | null;
}
interface FollowupBody {
  can_edit: boolean;
  mentors: FollowupRow[];
}

interface Fx {
  advisor1: number;
  advisor2: number;
  head1: number;
  staff1: number;
  /** student2 — สาขา CS01 · ที่ปรึกษา+อาจารย์นิเทศ = advisor1 · พี่เลี้ยง mentor1 · เริ่มงาน 30 วันก่อน */
  s2: number;
  /** นักศึกษา IT01 · ที่ปรึกษา = advisor2 · พี่เลี้ยง mentor1 (คนเดียวกับ s2) */
  sC: number;
  /** นักศึกษา IT01 · ที่ปรึกษา+นิเทศ = advisor2 · พี่เลี้ยง mentor2 */
  sB: number;
  mentor1: number;
  mentor2: number;
  companyId: number;
}

const MENTOR1_NAME = 'สมศักดิ์ รักเรียน';
const MENTOR2_NAME = 'ประสิทธิ์ ทดสอบสอง';
const SC_NAME = 'มานี มีใจ';
const SB_EMAIL = 'student-b-fu@test.com';

const uid = async (email: string): Promise<number> =>
  (await dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]))!;

const majorId = (code: string) => `(SELECT major_id FROM master_major WHERE major_code = '${code}')`;

/** นักศึกษาทดสอบ — ยืมแฮชรหัสผ่านของ student2 (password123) เพื่อให้ล็อกอินได้ · enrollment_year ใหม่พอที่ DeactivationScheduler ไม่ปิดบัญชี */
async function createStudent(
  email: string,
  code: string,
  first: string,
  last: string,
  major: string,
  advisorId: number | null,
  supervisorId: number | null
): Promise<number> {
  const id = (await dbValue<number>(
    `INSERT INTO users (email, password_hash)
     SELECT $1, password_hash FROM users WHERE email = 'student2@test.com' RETURNING user_id`,
    [email]
  ))!;
  await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [id]);
  await dbExec(
    `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year,
                           first_name, last_name, advisor_id, supervisor_id)
     VALUES ($1, $2, ${majorId(major)}, 3.00, 2569, $3, $4, $5, $6)`,
    [id, code, first, last, advisorId, supervisorId]
  );
  return id;
}

/** บัญชีพี่เลี้ยงล้วนคนที่สอง (role mentor + แถว mentors) — ยืมแฮชของ mentor1 */
async function createMentor(email: string, name: string, companyId: number): Promise<number> {
  const id = (await dbValue<number>(
    `INSERT INTO users (email, password_hash)
     SELECT $1, password_hash FROM users WHERE email = 'mentor1@test.com' RETURNING user_id`,
    [email]
  ))!;
  await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'mentor')`, [id]);
  await dbExec(
    `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
     VALUES ($1, $2, $3, 'Engineer', 'QA', '0812223333')`,
    [id, companyId, name]
  );
  return id;
}

async function placeStudent(studentId: number, mentorId: number, companyId: number, startOffsetDays: number) {
  await dbExec(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
     VALUES ($1, $2, (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1),
             'accepted', $3, CURRENT_DATE + $4::int)`,
    [studentId, companyId, mentorId, startOffsetDays]
  );
}

/**
 * ฐานตั้งต้นของทุกเคส — พี่เลี้ยง 2 คน นักศึกษา 3 คน คนละสาขา/คนละที่ปรึกษา
 *
 *   mentor1 ← s2 (CS01 · advisor1) + sC (IT01 · advisor2)    ← หัวหน้าสาขา head1 = CS01
 *   mentor2 ← sB (IT01 · advisor2)
 *
 * ยังไม่มีงานค้างเลย — เคสที่ต้องการให้เรียก `addMentor1Work`
 */
async function buildFixture(): Promise<Fx> {
  const advisor1 = await uid('advisor1@test.com');
  const advisor2 = await uid('advisor2@test.com');
  const head1 = await uid('head1@test.com');
  const staff1 = await uid('staff1@test.com');
  const s2 = await uid('student2@test.com');
  const mentor1 = await uid('mentor1@test.com');
  const companyId = (await dbValue<number>('SELECT company_id FROM companies LIMIT 1'))!;

  // กำหนดสาขาให้ตรงๆ ไม่พึ่ง `LIMIT 1` ของ seed
  await dbExec(`UPDATE students SET major_id = ${majorId('CS01')} WHERE student_id = $1`, [s2]);
  await dbExec(`UPDATE personnel SET major_id = ${majorId('CS01')} WHERE personnel_id = $1`, [head1]);

  const mentor2 = await createMentor('mentor2-fu@test.com', MENTOR2_NAME, companyId);
  const sC = await createStudent('student-c-fu@test.com', '65990003', 'มานี', 'มีใจ', 'IT01', advisor2, null);
  const sB = await createStudent(SB_EMAIL, '65990002', 'ปิติ', 'ใจเย็น', 'IT01', advisor2, advisor2);

  await placeStudent(s2, mentor1, companyId, -30);
  await placeStudent(sC, mentor1, companyId, 0);
  await placeStudent(sB, mentor2, companyId, 0);

  return { advisor1, advisor2, head1, staff1, s2, sC, sB, mentor1, mentor2, companyId };
}

/**
 * งานค้างของ mentor1 — 5 รายการ 5 ชนิด · ค้างเกินกำหนด 1 · มีนักศึกษาคนที่ยังไม่มีผลประเมิน 1
 *   s2: บันทึกสัปดาห์ (5 วัน) · บันทึกรายวัน 2 วันในสัปดาห์เดียว = 1 รายการ (3 วัน) · แผนปฏิบัติงาน (9 วัน · เกินกำหนด
 *       เพราะเริ่มงาน 30 วันก่อน กำหนด = วันเริ่ม+13) · โครงร่าง (1 วัน) · ส่งเล่มรายงานแล้วแต่พี่เลี้ยงยังไม่ประเมิน
 *   sC: บันทึกเดือน (2 วัน)
 */
async function addMentor1Work(fx: Fx) {
  await dbExec(
    `INSERT INTO weekly_logs (student_id, week_number, status, start_date, end_date, submitted_at)
     VALUES ($1, 1, 'submitted', CURRENT_DATE - 6, CURRENT_DATE, NOW() - INTERVAL '5 days')`,
    [fx.s2]
  );
  for (const [offset, day] of [[1, 1], [2, 2]]) {
    await dbExec(
      `INSERT INTO daily_logs (student_id, week_number, log_date, work_detail, status, submitted_at)
       VALUES ($1, 2, CURRENT_DATE - $2::int, $3, 'submitted', NOW() - INTERVAL '3 days')`,
      [fx.s2, offset, `งานวันที่ ${day}`]
    );
  }
  await dbExec(
    `INSERT INTO work_plan_approvals (student_id, approver_role, status, created_at)
     VALUES ($1, 'mentor', 'pending', NOW() - INTERVAL '9 days')`,
    [fx.s2]
  );
  await dbExec(
    `INSERT INTO report_outlines (student_id, company_id, status, updated_at)
     VALUES ($1, $2, 'pending_mentor', NOW() - INTERVAL '1 day')`,
    [fx.s2, fx.companyId]
  );
  await dbExec(
    `INSERT INTO final_reports (student_id, file_path, status, reviewer_kind)
     VALUES ($1, 'final_reports/fu-seeded.pdf', 'submitted', 'advisor')`,
    [fx.s2]
  );
  await dbExec(
    `INSERT INTO monthly_logs (student_id, year, month, status, submitted_at)
     VALUES ($1, 2026, 10, 'submitted', NOW() - INTERVAL '2 days')`,
    [fx.sC]
  );
}

/** งานค้างหนึ่งรายการของ mentor2 (sB) — ไว้เคสที่ต้องการให้ "ไม่ใช่ 400 เพราะไม่มีงาน" */
const addMentor2Work = (fx: Fx) =>
  dbExec(
    `INSERT INTO weekly_logs (student_id, week_number, status, start_date, end_date, submitted_at)
     VALUES ($1, 1, 'submitted', CURRENT_DATE - 6, CURRENT_DATE, NOW() - INTERVAL '1 day')`,
    [fx.sB]
  );

const reminderRows = (mentorId: number) =>
  dbRows<{ kind: string; sent_by: number | null; student_id: number | null }>(
    'SELECT kind, sent_by, student_id FROM mentor_reminders WHERE mentor_id = $1 ORDER BY reminder_id',
    [mentorId]
  );
const reminderCount = async (mentorId?: number): Promise<number> =>
  Number(
    await dbValue<string>(
      mentorId === undefined
        ? 'SELECT COUNT(*) FROM mentor_reminders'
        : `SELECT COUNT(*) FROM mentor_reminders WHERE mentor_id = ${Number(mentorId)}`
    )
  );
const tokenCount = async (userId?: number): Promise<number> =>
  Number(
    await dbValue<string>(
      userId === undefined
        ? 'SELECT COUNT(*) FROM mentor_login_tokens'
        : `SELECT COUNT(*) FROM mentor_login_tokens WHERE user_id = ${Number(userId)}`
    )
  );
const emailOf = (userId: number) => dbValue<string>('SELECT email FROM users WHERE user_id = $1', [userId]);

/** token ที่ยัดตรงในฐาน — `used` = เคยถูกใช้เข้าระบบแล้ว */
async function insertToken(userId: number, used: boolean): Promise<string> {
  const token = crypto.randomUUID();
  await dbExec(
    `INSERT INTO mentor_login_tokens (token, user_id, target, expires_at, used_at, created_at)
     VALUES ($1::uuid, $2, '/dashboard', NOW() + INTERVAL '1 hour', CASE WHEN $3::boolean THEN NOW() END,
             NOW() - INTERVAL '10 minutes')`,
    [token, userId, used]
  );
  return token;
}

/** อายุของ token อยู่ในช่วง [minSec, maxSec] จากตอนนี้หรือไม่ (คำนวณที่ Postgres) */
const expiresWithin = (token: string, minSec: number, maxSec: number) =>
  dbValue<boolean>(
    `SELECT expires_at > NOW() + ($2::int * INTERVAL '1 second')
        AND expires_at < NOW() + ($3::int * INTERVAL '1 second')
       FROM mentor_login_tokens WHERE token = $1::uuid`,
    [token, minSec, maxSec]
  );
const SEVEN_DAYS = { min: Math.round(6.9 * 86400), max: Math.round(7.1 * 86400) };

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

async function listAs(request: APIRequestContext, who: AccountKey): Promise<FollowupBody> {
  await apiLoginAs(request, who);
  const res = await request.get(BASE);
  expect(res.status(), `${who}: ${await res.text()}`).toBe(200);
  return (await res.json()) as FollowupBody;
}

const rowOf = (body: FollowupBody, mentorId: number): FollowupRow => {
  const row = body.mentors.find((m) => m.mentor_id === mentorId);
  expect(row, `ไม่พบพี่เลี้ยง ${mentorId} ในรายการ`).toBeTruthy();
  return row!;
};
const idsOf = (body: FollowupBody) => body.mentors.map((m) => m.mentor_id).sort((a, b) => a - b);

const remind = (request: APIRequestContext, mentorId: number | string) =>
  request.post(`${BASE}/${mentorId}/remind`);
const sendLink = (request: APIRequestContext, mentorId: number | string) =>
  request.post(`${BASE}/${mentorId}/send-link`);
const putEmail = (request: APIRequestContext, mentorId: number | string, email: unknown) =>
  request.put(`${BASE}/${mentorId}/email`, { data: { email } });

test.describe('ติดตามพี่เลี้ยง — สิทธิ์ ขอบเขต ตัวเลข การเตือน และแก้อีเมล', () => {
  let fx: Fx;

  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('DELETE FROM mentor_login_tokens');
    await dbExec('DELETE FROM mentor_reminders');
    fx = await buildFixture();
  });

  test('F1: เข้าได้เฉพาะเจ้าหน้าที่/หัวหน้าสาขา/อาจารย์ — นักศึกษา พี่เลี้ยง คณบดี = 403 ทุกเส้นทาง · ไม่ล็อกอิน = 401', async ({
    request,
  }) => {
    await addMentor1Work(fx);

    // ⛔ มีงานค้างจริง + ฐานพร้อมเตือน → ถ้าด่านรั่ว เส้นทางเตือนจะตอบ 200 ไม่ใช่ 403 (ไม่ใช่ 400 ที่ดูเหมือนปลอดภัย)
    for (const who of ['student1', 'student2', 'mentor1', 'dean1'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(BASE)).status(), `${who} ดูรายการ`).toBe(403);
      expect((await remind(request, fx.mentor1)).status(), `${who} เตือน`).toBe(403);
      expect((await sendLink(request, fx.mentor1)).status(), `${who} ส่งลิงก์`).toBe(403);
      expect((await putEmail(request, fx.mentor1, 'hijack-f1@example.com')).status(), `${who} แก้อีเมล`).toBe(403);
    }
    expect(await reminderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);
    expect(await emailOf(fx.mentor1)).toBe(ORIGINAL_MENTOR1_EMAIL);

    // ไม่มี session เลย = 401 (มาก่อน 403 เสมอ)
    const anon = await playwrightRequest.newContext();
    try {
      expect((await anon.get(BASE)).status()).toBe(401);
      expect((await anon.post(`${BASE}/${fx.mentor1}/remind`)).status()).toBe(401);
      expect((await anon.post(`${BASE}/${fx.mentor1}/send-link`)).status()).toBe(401);
      expect((await anon.put(`${BASE}/${fx.mentor1}/email`, { data: { email: 'x@example.com' } })).status()).toBe(401);
    } finally {
      await anon.dispose();
    }

    // ตัวควบคุม: สามบทบาทที่เข้าได้ ได้ 200 — can_edit เป็นของเจ้าหน้าที่คนเดียว
    const staff = await listAs(request, 'staff1');
    expect(staff.can_edit).toBe(true);
    expect(staff.mentors.length).toBe(2);
    expect((await listAs(request, 'head1')).can_edit).toBe(false);
    expect((await listAs(request, 'advisor1')).can_edit).toBe(false);
  });

  test('F2: ขอบเขต — เจ้าหน้าที่เห็นทั้งหมด · หัวหน้าสาขาเห็นเฉพาะสาขา · อาจารย์เห็นเฉพาะนักศึกษาที่ดูแล · นับเฉพาะนักศึกษาในขอบเขต · ไม่มีโปรไฟล์ = 403', async ({
    request,
  }) => {
    await addMentor1Work(fx);

    // เจ้าหน้าที่: พี่เลี้ยงทั้งสอง นักศึกษาครบทั้งสามคน
    const staff = await listAs(request, 'staff1');
    expect(idsOf(staff)).toEqual([fx.mentor1, fx.mentor2].sort((a, b) => a - b));
    expect(rowOf(staff, fx.mentor1)).toMatchObject({ student_count: 2, pending_total: 5, eval_missing_students: 1 });
    expect(rowOf(staff, fx.mentor2)).toMatchObject({ student_count: 1, pending_total: 0 });

    // หัวหน้าสาขา CS01: เห็นแค่ mentor1 และนับแค่ s2 (ไม่เห็น sC ของ IT01 · ไม่เห็นบันทึกเดือนของ sC)
    const head = await listAs(request, 'head1');
    expect(idsOf(head)).toEqual([fx.mentor1]);
    const headRow = rowOf(head, fx.mentor1);
    expect(headRow.student_count).toBe(1);
    expect(headRow.students.map((s) => s.student_id)).toEqual([fx.s2]);
    expect(headRow.pending_total).toBe(4);
    expect(headRow.pending_by_kind.monthly_log).toBe(0);
    expect(headRow.pending_overdue).toBe(1);
    expect(JSON.stringify(head)).not.toContain(SC_NAME);
    expect(JSON.stringify(head)).not.toContain(MENTOR2_NAME);

    // อาจารย์ที่ปรึกษา advisor1: เห็น mentor1 ผ่าน s2 เท่านั้น
    const adv1 = await listAs(request, 'advisor1');
    expect(idsOf(adv1)).toEqual([fx.mentor1]);
    expect(rowOf(adv1, fx.mentor1)).toMatchObject({ student_count: 1, pending_total: 4 });

    // advisor2 ดูแล sC + sB: เห็นทั้งสองพี่เลี้ยง แต่ mentor1 นับแค่ sC (บันทึกเดือน 1 · ไม่เห็นงานของ s2)
    const adv2 = await listAs(request, 'advisor2');
    expect(idsOf(adv2)).toEqual([fx.mentor1, fx.mentor2].sort((a, b) => a - b));
    const adv2Row = rowOf(adv2, fx.mentor1);
    expect(adv2Row).toMatchObject({ student_count: 1, pending_total: 1, pending_overdue: 0, eval_missing_students: 0 });
    expect(adv2Row.pending_by_kind.monthly_log).toBe(1);
    expect(adv2Row.students.map((s) => s.student_id)).toEqual([fx.sC]);

    // ที่ปรึกษา "หรือ" อาจารย์นิเทศ ก็พอ — ตั้ง advisor1 เป็นอาจารย์นิเทศของ sC และของ sB (แต่ไม่ใช่ที่ปรึกษา)
    await dbExec('UPDATE students SET supervisor_id = $2 WHERE student_id = $1', [fx.sC, fx.advisor1]);
    await dbExec('UPDATE students SET supervisor_id = $2 WHERE student_id = $1', [fx.sB, fx.advisor1]);
    const adv1After = await listAs(request, 'advisor1');
    expect(idsOf(adv1After)).toEqual([fx.mentor1, fx.mentor2].sort((a, b) => a - b));
    expect(rowOf(adv1After, fx.mentor1)).toMatchObject({ student_count: 2, pending_total: 5 });
    expect(rowOf(adv1After, fx.mentor2).student_count).toBe(1);

    // หัวหน้าสาขาย้ายไป IT01: เห็นทั้งสองพี่เลี้ยง แต่ mentor1 เหลือแค่ sC
    await dbExec(`UPDATE personnel SET major_id = ${majorId('IT01')} WHERE personnel_id = $1`, [fx.head1]);
    const headIt = await listAs(request, 'head1');
    expect(idsOf(headIt)).toEqual([fx.mentor1, fx.mentor2].sort((a, b) => a - b));
    expect(rowOf(headIt, fx.mentor1)).toMatchObject({ student_count: 1, pending_total: 1 });

    // สาขาที่ไม่มีใครฝึกงาน = 200 รายการว่าง (ไม่ใช่ error · ไม่ใช่ข้อมูลทั้งระบบ)
    await dbExec(`UPDATE personnel SET major_id = ${majorId('MGT01')} WHERE personnel_id = $1`, [fx.head1]);
    expect((await listAs(request, 'head1')).mentors).toEqual([]);

    // ⛔ SEC-06 fail closed: หัวหน้าสาขาไม่มีโปรไฟล์บุคลากร = 403 ไม่ใช่รายการที่ไม่ถูกกรอง
    await dbExec('DELETE FROM personnel WHERE personnel_id = $1', [fx.head1]);
    await apiLoginAs(request, 'head1');
    expect((await request.get(BASE)).status()).toBe(403);
    expect((await remind(request, fx.mentor1)).status()).toBe(403);
    expect(await reminderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);
  });

  test('F3: ตัวเลขงานค้างตรงเป๊ะ — แยกชนิด · เกินกำหนด · ค้างนานสุด · ค้างประเมิน และลดลงเมื่อรับรอง', async ({ request }) => {
    await addMentor1Work(fx);
    const staff = await listAs(request, 'staff1');

    const first = rowOf(staff, fx.mentor1);
    expect(first.pending_total).toBe(5);
    expect(first.pending_overdue).toBe(1);
    expect(first.pending_by_kind).toEqual({
      weekly_log: 1,
      monthly_log: 1,
      daily_log: 1, // สองวันในสัปดาห์เดียว = รายการเดียว
      work_plan: 1,
      report_outline: 1,
      report_draft: 0,
    });
    expect(first.oldest_days_waiting).toBe(9);
    expect(first.eval_missing_students).toBe(1);
    expect(first.student_count).toBe(2);
    expect(first.reminder_count).toBe(0);
    expect(first.last_reminded_at).toBeNull();
    expect(first.last_login_at).toBeNull();
    expect(first.name).toBe(MENTOR1_NAME);
    expect(first.email).toBe(ORIGINAL_MENTOR1_EMAIL);
    expect(first.is_active).toBe(true);
    // ไม่ส่งข้อมูลส่วนตัวเกินที่ระบุ (ไม่มีเบอร์โทร)
    expect(keysDeep(staff.mentors)).not.toContain('phone');

    const refresh = async () => rowOf((await (await request.get(BASE)).json()) as FollowupBody, fx.mentor1);

    // รับรองบันทึกสัปดาห์ → ชนิดนั้นหาย รวมลดเหลือ 4
    await dbExec(
      `UPDATE weekly_logs SET mentor_certified_at = NOW(), mentor_certified_by = $1 WHERE student_id = $2`,
      [fx.mentor1, fx.s2]
    );
    let row = await refresh();
    expect(row.pending_total).toBe(4);
    expect(row.pending_by_kind.weekly_log).toBe(0);
    expect(row.pending_overdue).toBe(1);

    // พี่เลี้ยงอนุมัติแผนปฏิบัติงาน → หายจากคิว · เกินกำหนดเหลือ 0 · ค้างนานสุดไล่ลงมาเป็นรายการที่เก่าที่สุดที่เหลือ (บันทึกรายวัน 3 วัน)
    await dbExec(`UPDATE work_plan_approvals SET status = 'approved', approved_at = NOW() WHERE student_id = $1`, [fx.s2]);
    row = await refresh();
    expect(row.pending_total).toBe(3);
    expect(row.pending_overdue).toBe(0);
    expect(row.pending_by_kind.work_plan).toBe(0);
    expect(row.oldest_days_waiting).toBe(3);

    // ผลประเมิน: ใบเดียวยังไม่พอ (ต้องครบทั้ง สหกิจ 15 และ 16) · ครบสองใบ = ไม่ค้างประเมินแล้ว
    await dbExec(
      `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
       VALUES ($1, 'mentor', 'sahatkit_15', '{}'::jsonb, 0)`,
      [fx.s2]
    );
    expect((await refresh()).eval_missing_students).toBe(1);
    await dbExec(
      `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
       VALUES ($1, 'mentor', 'sahatkit_16', '{}'::jsonb, 0)`,
      [fx.s2]
    );
    expect((await refresh()).eval_missing_students).toBe(0);

    // ร่างรายงานที่รอพี่เลี้ยง: เกินกำหนด = ก่อนจบฝึก 14 วัน → ตั้งวันจบไว้ใกล้ ๆ ให้เกินกำหนดแล้ว
    await dbExec(`UPDATE intent_forms SET end_date = CURRENT_DATE + 3 WHERE student_id = $1`, [fx.s2]);
    await dbExec(
      `INSERT INTO final_reports (student_id, file_path, status, reviewer_kind, version, submitted_at)
       VALUES ($1, 'final_reports/fu-draft.pdf', 'submitted', 'mentor', 1, NOW() - INTERVAL '4 days')`,
      [fx.s2]
    );
    row = await refresh();
    expect(row.pending_total).toBe(4);
    expect(row.pending_by_kind.report_draft).toBe(1);
    expect(row.pending_overdue).toBe(1);

    // พี่เลี้ยงตรวจร่างแล้ว → หายจากคิว
    await dbExec(`UPDATE final_reports SET reviewed_at = NOW() WHERE student_id = $1 AND reviewer_kind = 'mentor'`, [fx.s2]);
    row = await refresh();
    expect(row.pending_by_kind.report_draft).toBe(0);
    expect(row.pending_overdue).toBe(0);
  });

  test('F4: เตือนสำเร็จ — แถวเตือน summary 1 แถว · ลิงก์เข้าระบบ 7 วันไป /dashboard · audit ไม่มี token · เตือนซ้ำทันที = 429 ไม่เพิ่มแถว', async ({
    request,
  }) => {
    await addMentor1Work(fx);
    await apiLoginAs(request, 'staff1');

    const res = await remind(request, fx.mentor1);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ message: 'ส่งอีเมลเตือนพี่เลี้ยงแล้ว', reminder_count: 1 });
    expect(body.last_reminded_at).toBeTruthy();

    // เตือนหนึ่งแถว ผู้กด = เจ้าหน้าที่ · ไม่ผูกนักศึกษา (สรุปรวม)
    expect(await reminderRows(fx.mentor1)).toEqual([{ kind: 'summary', sent_by: fx.staff1, student_id: null }]);
    expect(await reminderCount()).toBe(1);

    // ลิงก์เข้าระบบ: 1 ใบของพี่เลี้ยงคนนี้ ใช้ได้ 7 วัน ยังไม่ถูกใช้ พาไปหน้าแรก — ไม่มีของคนอื่น
    const tokens = await dbRows<{ token: string; target: string | null; used_at: string | null }>(
      'SELECT token, target, used_at FROM mentor_login_tokens WHERE user_id = $1',
      [fx.mentor1]
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ target: '/dashboard', used_at: null });
    expect(await expiresWithin(tokens[0].token, SEVEN_DAYS.min, SEVEN_DAYS.max)).toBe(true);
    expect(await tokenCount()).toBe(1);

    // audit (เขียนหลัง response) — ไม่เก็บตัว token
    await expect
      .poll(
        async () =>
          dbRow(
            `SELECT actor_id, subject_id, entity_id, detail->>'mentor_id' AS mentor_id, detail->>'items' AS items,
                    (detail::text LIKE '%' || $2 || '%') AS leaks_token
               FROM audit_log WHERE action = 'mentor.reminder_sent' AND subject_id = $1`,
            [fx.mentor1, tokens[0].token]
          ),
        { timeout: 10_000 }
      )
      .toMatchObject({
        actor_id: fx.staff1,
        subject_id: fx.mentor1,
        mentor_id: String(fx.mentor1),
        items: '5',
        leaks_token: false,
      });

    // รายการสะท้อนทันที
    const row = rowOf(await listAs(request, 'staff1'), fx.mentor1);
    expect(row.reminder_count).toBe(1);
    expect(row.last_reminded_at).toBeTruthy();

    // เตือนซ้ำทันที = 429 · ไม่มีแถวเตือน/ลิงก์/เมลเพิ่ม
    const again = await remind(request, fx.mentor1);
    expect(again.status(), await again.text()).toBe(429);
    expect(await reminderCount()).toBe(1);
    expect(await tokenCount()).toBe(1);
  });

  test('F4b: อาจารย์/หัวหน้าสาขาที่พี่เลี้ยงอยู่ในขอบเขต เตือนได้ — แถวเตือนบันทึกผู้กดเป็นผู้เรียกเอง', async ({ request }) => {
    await addMentor1Work(fx);

    await apiLoginAs(request, 'advisor1');
    const byAdvisor = await remind(request, fx.mentor1);
    expect(byAdvisor.status(), await byAdvisor.text()).toBe(200);
    expect(await reminderRows(fx.mentor1)).toEqual([{ kind: 'summary', sent_by: fx.advisor1, student_id: null }]);

    // เว้น 24 ชม. ย้อนหลังให้ผ่านด่านซ้ำ แล้วให้หัวหน้าสาขาเตือนต่อ
    await dbExec(`UPDATE mentor_reminders SET created_at = NOW() - INTERVAL '25 hours'`);
    await apiLoginAs(request, 'head1');
    const byHead = await remind(request, fx.mentor1);
    expect(byHead.status(), await byHead.text()).toBe(200);
    expect((await reminderRows(fx.mentor1)).map((r) => r.sent_by)).toEqual([fx.advisor1, fx.head1]);
    expect(await tokenCount(fx.mentor1)).toBe(2);
  });

  test('F5: เตือนไม่ได้ — ไม่มีงานค้าง 400 · นอกขอบเขต 403 · บัญชีถูกระงับ 403 · ไม่ใช่พี่เลี้ยงล้วน 403 — ไม่มีแถวเตือน ไม่มีลิงก์', async ({
    request,
  }) => {
    await addMentor1Work(fx);

    // ไม่มีงานค้าง (mentor2 ยังว่าง) = 400 · ไม่จอง cooldown ไม่ออกลิงก์
    await apiLoginAs(request, 'staff1');
    const empty = await remind(request, fx.mentor2);
    expect(empty.status(), await empty.text()).toBe(400);
    expect(await reminderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);

    // นอกขอบเขต: ใส่งานค้างให้ mentor2 (กันได้ 400 แทน 403) แล้วให้อาจารย์/หัวหน้าสาขาที่ไม่เกี่ยวข้องกดเตือน
    await addMentor2Work(fx);
    for (const who of ['advisor1', 'head1'] as const) {
      await apiLoginAs(request, who);
      expect((await remind(request, fx.mentor2)).status(), `${who} เตือนพี่เลี้ยงนอกขอบเขต`).toBe(403);
    }
    expect(await reminderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);

    // :mentorId ไม่ใช่ตัวเลข → 400 · ไม่รู้จัก → 403 (ไม่มีนักศึกษาในขอบเขต — ไม่บอกว่า id นั้นมีหรือไม่)
    await apiLoginAs(request, 'staff1');
    expect((await remind(request, 'abc')).status()).toBe(400);
    expect((await remind(request, '12abc')).status()).toBe(400);
    expect((await remind(request, 999999)).status()).toBe(403);

    // บัญชีไม่ใช่พี่เลี้ยงเลย (เจ้าหน้าที่ · อาจารย์) ส่ง id มาเป็น :mentorId → 403
    for (const id of [fx.staff1, fx.advisor1]) {
      expect((await remind(request, id)).status(), `id ${id}`).toBe(403);
    }

    // พี่เลี้ยงที่ถูกระงับ → 403 · รายการยังแสดงแต่บอก is_active = false
    await dbExec('UPDATE users SET is_active = FALSE WHERE user_id = $1', [fx.mentor1]);
    const inactive = await remind(request, fx.mentor1);
    expect(inactive.status(), await inactive.text()).toBe(403);
    expect(rowOf((await (await request.get(BASE)).json()) as FollowupBody, fx.mentor1).is_active).toBe(false);
    await dbExec('UPDATE users SET is_active = TRUE WHERE user_id = $1', [fx.mentor1]);

    // ⛔ SEC-03: บัญชีที่มีแถว mentors และมีนักศึกษาผูกอยู่ แต่ถูกเพิ่มบทบาทอื่น = ไม่ใช่พี่เลี้ยงล้วนแล้ว
    //    ผ่านด่านขอบเขตได้ (มีนักศึกษา) จึงต้องไปตกที่ด่านนี้ — ไม่งั้นลิงก์เข้าระบบจะออกให้บัญชีที่มีสิทธิ์อื่น
    //    (ฐานไม่ยอมให้บัญชีแบบนี้เกิดอีกแล้ว — migration 043 · จึงจำลองข้อมูลเก่าด้วยการข้าม trigger ชั่วคราว
    //     เพื่อพิสูจน์ว่าด่านในแอปยังกันได้เองเป็นชั้นสอง)
    await grantRoleBypassingMentorTrigger(fx.mentor1, 'advisor');
    const notPure = await remind(request, fx.mentor1);
    expect(notPure.status(), await notPure.text()).toBe(403);

    expect(await reminderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);

    // ตัวควบคุม: คืนบทบาท → เตือนได้ (403 ข้างบนมาจากสิทธิ์ ไม่ใช่ข้อมูลเสีย)
    await dbExec(`DELETE FROM user_roles WHERE user_id = $1 AND role_name = 'advisor'`, [fx.mentor1]);
    expect((await remind(request, fx.mentor1)).status()).toBe(200);
    expect(await reminderCount()).toBe(1);
  });

  test('F6: ส่งลิงก์เปล่า — เจ้าหน้าที่เท่านั้น · ลิงก์ 7 วัน 1 ใบ · ซ้ำใน 60 วินาที = 429 · อาจารย์/หัวหน้าสาขา/บัญชีที่ไม่ใช่พี่เลี้ยงล้วน = 403', async ({
    request,
  }) => {
    // อาจารย์/หัวหน้าสาขาในขอบเขตก็ส่งไม่ได้ (ทำก่อนเจ้าหน้าที่ — ไม่ให้ cooldown มาบังผลของด่านสิทธิ์)
    for (const who of ['advisor1', 'head1'] as const) {
      await apiLoginAs(request, who);
      expect((await sendLink(request, fx.mentor1)).status(), who).toBe(403);
    }
    expect(await tokenCount()).toBe(0);

    await apiLoginAs(request, 'staff1');

    // ไม่ใช่พี่เลี้ยงล้วน → 403 ไม่ออกลิงก์ (บัญชีเจ้าหน้าที่/อาจารย์ · พี่เลี้ยงที่มีบทบาทอื่นเพิ่ม · พี่เลี้ยงที่ถูกระงับ)
    expect((await sendLink(request, fx.staff1)).status()).toBe(403);
    expect((await sendLink(request, fx.advisor1)).status()).toBe(403);
    await grantRoleBypassingMentorTrigger(fx.mentor2, 'advisor'); // จำลองข้อมูลเก่า — ฐานปฏิเสธบัญชีแบบนี้แล้ว (043)
    expect((await sendLink(request, fx.mentor2)).status()).toBe(403);
    await dbExec(`DELETE FROM user_roles WHERE user_id = $1 AND role_name = 'advisor'`, [fx.mentor2]);
    await dbExec('UPDATE users SET is_active = FALSE WHERE user_id = $1', [fx.mentor2]);
    expect((await sendLink(request, fx.mentor2)).status()).toBe(403);
    expect((await sendLink(request, 'abc')).status()).toBe(400);
    expect(await tokenCount()).toBe(0);

    // เจ้าหน้าที่ส่งสำเร็จ: ลิงก์ 7 วันใบเดียว ไป /dashboard
    const ok = await sendLink(request, fx.mentor1);
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).message).toBe('ส่งลิงก์เข้าสู่ระบบไปที่อีเมลของพี่เลี้ยงแล้ว');
    const tokens = await dbRows<{ token: string; target: string | null; used_at: string | null }>(
      'SELECT token, target, used_at FROM mentor_login_tokens WHERE user_id = $1',
      [fx.mentor1]
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ target: '/dashboard', used_at: null });
    expect(await expiresWithin(tokens[0].token, SEVEN_DAYS.min, SEVEN_DAYS.max)).toBe(true);
    expect(await tokenCount()).toBe(1);
    // ส่งลิงก์เปล่าไม่นับเป็นการ "เตือน"
    expect(await reminderCount()).toBe(0);

    await expect
      .poll(
        async () =>
          dbRow(
            `SELECT actor_id, subject_id, (detail::text LIKE '%' || $2 || '%') AS leaks_token
               FROM audit_log WHERE action = 'mentor.link_sent_by_staff' AND subject_id = $1`,
            [fx.mentor1, tokens[0].token]
          ),
        { timeout: 10_000 }
      )
      .toMatchObject({ actor_id: fx.staff1, subject_id: fx.mentor1, leaks_token: false });

    // ซ้ำทันที = 429 (cooldown 60 วิ) ไม่ออกใบที่สอง
    const again = await sendLink(request, fx.mentor1);
    expect(again.status(), await again.text()).toBe(429);
    expect(await tokenCount(fx.mentor1)).toBe(1);
  });

  test('F7: แก้อีเมลพี่เลี้ยง — เจ้าหน้าที่เท่านั้น · ลิงก์ที่ยังไม่ใช้ของอีเมลเก่าตาย · ซ้ำกับบัญชีอื่น 409 · รูปแบบผิด 400 · บัญชีที่ไม่ใช่พี่เลี้ยงล้วนแก้ไม่ได้ (SEC-03)', async ({
    request,
  }) => {
    const OTHER_EMAILS = [
      ['advisor1', fx.advisor1],
      ['staff1', fx.staff1],
      ['head1', fx.head1],
      ['student2', fx.s2],
    ] as const;
    const before: Record<string, string> = {};
    for (const [name, id] of OTHER_EMAILS) before[name] = (await emailOf(id))!;

    const unusedToken = await insertToken(fx.mentor1, false);
    const usedToken = await insertToken(fx.mentor1, true);
    await dbExec(
      `UPDATE users SET reset_token = 'fu-reset-token', reset_token_expires = NOW() + INTERVAL '1 hour' WHERE user_id = $1`,
      [fx.mentor1]
    );

    // อาจารย์/หัวหน้าสาขา (แม้พี่เลี้ยงอยู่ในขอบเขต) แก้ไม่ได้
    for (const who of ['advisor1', 'head1'] as const) {
      await apiLoginAs(request, who);
      expect((await putEmail(request, fx.mentor1, 'hijack-f7@example.com')).status(), who).toBe(403);
    }
    expect(await emailOf(fx.mentor1)).toBe(ORIGINAL_MENTOR1_EMAIL);

    await apiLoginAs(request, 'staff1');

    // ⛔ SEC-03: เปลี่ยนอีเมลของบัญชีที่ไม่ใช่พี่เลี้ยงล้วน = ยึดบัญชีผ่านลิงก์/รีเซ็ตรหัสผ่าน → 403 อีเมลต้องไม่ขยับ
    for (const [name, id] of OTHER_EMAILS) {
      const res = await putEmail(request, id, `takeover-${name}@example.com`);
      expect(res.status(), `${name}: ${await res.text()}`).toBe(403);
      expect(await emailOf(id), `${name} อีเมลต้องไม่เปลี่ยน`).toBe(before[name]);
    }
    // พี่เลี้ยงที่ถูกเพิ่มบทบาทอื่น = ไม่ใช่พี่เลี้ยงล้วนแล้ว
    await grantRoleBypassingMentorTrigger(fx.mentor2, 'advisor'); // จำลองข้อมูลเก่า — ฐานปฏิเสธบัญชีแบบนี้แล้ว (043)
    expect((await putEmail(request, fx.mentor2, 'takeover-mentor2@example.com')).status()).toBe(403);
    expect(await emailOf(fx.mentor2)).toBe('mentor2-fu@test.com');
    await dbExec(`DELETE FROM user_roles WHERE user_id = $1 AND role_name = 'advisor'`, [fx.mentor2]);
    // ไม่รู้จัก → 404 · id ไม่ใช่ตัวเลข → 400
    expect((await putEmail(request, 999999, 'nobody-f7@example.com')).status()).toBe(404);
    expect((await putEmail(request, 'abc', 'nobody-f7@example.com')).status()).toBe(400);

    // รูปแบบผิด → 400 อีเมลเดิมอยู่
    for (const bad of ['not-an-email', '', '   ', 'a@b', 'a b@example.com', `${'x'.repeat(250)}@example.com`, 12345, null]) {
      const res = await putEmail(request, fx.mentor1, bad);
      expect(res.status(), `อีเมล ${JSON.stringify(bad)?.slice(0, 30)}`).toBe(400);
    }
    expect(await emailOf(fx.mentor1)).toBe(ORIGINAL_MENTOR1_EMAIL);

    // ซ้ำกับบัญชีอื่น (ไม่สนตัวพิมพ์) → 409 · ไม่แตะอะไรเลย (ลิงก์ที่ยังไม่ใช้ยังอยู่)
    for (const dup of ['STAFF1@TEST.COM', 'mentor2-fu@test.com', 'Advisor1@Test.com']) {
      const res = await putEmail(request, fx.mentor1, dup);
      expect(res.status(), `${dup}: ${await res.text()}`).toBe(409);
    }
    expect(await emailOf(fx.mentor1)).toBe(ORIGINAL_MENTOR1_EMAIL);
    expect(await tokenCount(fx.mentor1)).toBe(2);

    // สำเร็จ: ตัดช่องว่าง + แปลงตัวเล็ก
    const ok = await putEmail(request, fx.mentor1, '  New.Mentor-F7@Example.COM ');
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await ok.json()).toEqual({ email: 'new.mentor-f7@example.com' });
    expect(await emailOf(fx.mentor1)).toBe('new.mentor-f7@example.com');

    // ลิงก์ที่ยังไม่ใช้ของอีเมลเก่าตาย · ลิงก์ที่เคยใช้แล้วคงอยู่เป็นประวัติ (last_login_at) · reset token ถูกล้าง
    expect(await dbRow('SELECT 1 AS x FROM mentor_login_tokens WHERE token = $1::uuid', [unusedToken])).toBeUndefined();
    expect(await dbRow('SELECT 1 AS x FROM mentor_login_tokens WHERE token = $1::uuid', [usedToken])).toBeTruthy();
    expect(await tokenCount(fx.mentor1)).toBe(1);
    expect(
      await dbRow('SELECT reset_token, reset_token_expires FROM users WHERE user_id = $1', [fx.mentor1])
    ).toEqual({ reset_token: null, reset_token_expires: null });
    // ไม่ส่งลิงก์ให้อัตโนมัติ — เจ้าหน้าที่กดเอง
    expect(await tokenCount()).toBe(1);

    // บัญชียังเป็นพี่เลี้ยงล้วนเหมือนเดิม และอีเมลอื่นไม่ขยับ
    expect(await dbValue<string>('SELECT array_to_string(array_agg(role_name), \',\') FROM user_roles WHERE user_id = $1', [fx.mentor1])).toBe('mentor');
    for (const [name, id] of OTHER_EMAILS) expect(await emailOf(id), name).toBe(before[name]);

    await expect
      .poll(
        async () =>
          dbRow(
            `SELECT actor_id, subject_id, detail->>'email_before' AS email_before, detail->>'email_after' AS email_after
               FROM audit_log WHERE action = 'mentor.email_changed' AND subject_id = $1`,
            [fx.mentor1]
          ),
        { timeout: 10_000 }
      )
      .toEqual({
        actor_id: fx.staff1,
        subject_id: fx.mentor1,
        email_before: ORIGINAL_MENTOR1_EMAIL,
        email_after: 'new.mentor-f7@example.com',
      });
    // ล้มเหลว (403/409/400) ต้องไม่ทิ้ง audit ของการเปลี่ยนอีเมล
    expect(await dbValue<string>(`SELECT COUNT(*) FROM audit_log WHERE action = 'mentor.email_changed'`)).toBe('1');

    // รายการแสดงอีเมลใหม่
    expect(rowOf(await listAs(request, 'staff1'), fx.mentor1).email).toBe('new.mentor-f7@example.com');
  });

  test('F8: การเตือนแจ้งประเมินรายนักศึกษา (final_report) นับรวมเป็นการเตือนพี่เลี้ยง และกัน cooldown 24 ชม. ร่วมกับเตือนสรุป', async ({
    request,
  }) => {
    await addMentor1Work(fx);
    await apiLoginAs(request, 'staff1');

    const notify = await request.post(`${API_URL}/final-reports/notify-mentor/${fx.s2}`);
    expect(notify.status(), await notify.text()).toBe(200);

    // เส้นทางเดิมต้องทิ้งแถวเตือนชนิด final_report ผูกนักศึกษา + ผู้กด
    expect(await reminderRows(fx.mentor1)).toEqual([{ kind: 'final_report', sent_by: fx.staff1, student_id: fx.s2 }]);
    let row = rowOf(await listAs(request, 'staff1'), fx.mentor1);
    expect(row.reminder_count).toBe(1);
    expect(row.last_reminded_at).toBeTruthy();

    // cooldown ของเส้นทางนั้นเอง (วันละครั้งต่อนักศึกษา) ยังทำงาน — กดซ้ำ = 429 ไม่เพิ่มแถว
    expect((await request.post(`${API_URL}/final-reports/notify-mentor/${fx.s2}`)).status()).toBe(429);
    expect(await reminderCount(fx.mentor1)).toBe(1);

    // เตือนสรุปทันทีหลังนั้น = 429 เพราะนับ "ทุกชนิด" ภายใน 24 ชม.
    const blocked = await remind(request, fx.mentor1);
    expect(blocked.status(), await blocked.text()).toBe(429);
    expect(await reminderCount(fx.mentor1)).toBe(1);

    // เลย 24 ชม. → เตือนสรุปได้ · จำนวนครั้งรวมสองชนิด = 2
    await dbExec(`UPDATE mentor_reminders SET created_at = NOW() - INTERVAL '25 hours'`);
    const ok = await remind(request, fx.mentor1);
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).reminder_count).toBe(2);
    expect((await reminderRows(fx.mentor1)).map((r) => r.kind)).toEqual(['final_report', 'summary']);
    row = rowOf(await listAs(request, 'staff1'), fx.mentor1);
    expect(row.reminder_count).toBe(2);

    // นักศึกษานอกความดูแลของอาจารย์ → แจ้งพี่เลี้ยงไม่ได้ และไม่ทิ้งแถวเตือน (ด่านเดิมของเส้นทางนี้ไม่ถูกทำลาย)
    await apiLoginAs(request, 'advisor2');
    expect((await request.post(`${API_URL}/final-reports/notify-mentor/${fx.s2}`)).status()).toBe(403);
    expect(await reminderCount(fx.mentor1)).toBe(2);
  });

  test('F9: นักศึกษาเห็นแค่จำนวนครั้งที่คณะเตือนพี่เลี้ยงของตัวเอง — ไม่มีผู้กด ไม่มีอีเมล · พี่เลี้ยงที่ไม่เคยถูกเตือน = 0', async ({
    request,
  }) => {
    await dbExec(
      `INSERT INTO mentor_reminders (mentor_id, student_id, kind, sent_by, created_at) VALUES
         ($1, NULL, 'summary', $2, NOW() - INTERVAL '3 days'),
         ($1, $3, 'final_report', $2, NOW() - INTERVAL '1 day'),
         ($4, NULL, 'summary', $2, NOW() - INTERVAL '2 hours')`,
      [fx.mentor1, fx.staff1, fx.s2, fx.mentor2]
    );
    const lastForMentor1 = (await dbValue<Date>('SELECT MAX(created_at) FROM mentor_reminders WHERE mentor_id = $1', [
      fx.mentor1,
    ]))!;

    const dashboard = async (loginAsStudent: () => Promise<void>) => {
      await loginAsStudent();
      const res = await request.get(`${API_URL}/students/dashboard`);
      expect(res.status(), await res.text()).toBe(200);
      return { text: await res.text(), body: JSON.parse(await res.text()) };
    };

    // นักศึกษาของ mentor1 — ทุกชนิดรวมกัน = 2 (ไม่รวมของ mentor2)
    const mine = await dashboard(() => apiLoginAs(request, 'student2'));
    expect(Object.keys(mine.body.mentor_reminders).sort()).toEqual(['count', 'last_at']);
    expect(mine.body.mentor_reminders.count).toBe(2);
    expect(new Date(mine.body.mentor_reminders.last_at).getTime()).toBe(lastForMentor1.getTime());
    // ไม่บอกว่าใครกดเตือน — ไม่มีคีย์ผู้กด/รหัสแถว และอีเมลเจ้าหน้าที่ไม่โผล่ในคำตอบ
    const keys = keysDeep(mine.body).map((k) => k.toLowerCase());
    for (const banned of ['sent_by', 'reminder_id']) expect(keys, banned).not.toContain(banned);
    expect(mine.text).not.toContain('staff1@test.com');

    // นักศึกษาอีกคนของพี่เลี้ยงคนเดียวกัน (sC) เห็นจำนวนของพี่เลี้ยงคนนั้นเหมือนกัน
    const login = async (email: string) => {
      const res = await request.post(`${API_URL}/auth/login`, { data: { email, password: DEFAULT_PASSWORD } });
      expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
    };
    const sameMentor = await dashboard(() => login('student-c-fu@test.com'));
    expect(sameMentor.body.mentor_reminders.count).toBe(2);

    // นักศึกษาของ mentor2 เห็นแค่ 1 (ของพี่เลี้ยงตัวเอง) · ล้างแถวของ mentor2 → 0 / null
    const other = await dashboard(() => login(SB_EMAIL));
    expect(other.body.mentor_reminders.count).toBe(1);
    await dbExec('DELETE FROM mentor_reminders WHERE mentor_id = $1', [fx.mentor2]);
    const none = await dashboard(() => login(SB_EMAIL));
    expect(none.body.mentor_reminders).toEqual({ count: 0, last_at: null });

    // นักศึกษาที่ไม่มีที่ฝึกที่ตอบรับ → 0 / null (ไม่เห็นของพี่เลี้ยงใคร)
    await dbExec(`UPDATE intent_forms SET status = 'superseded' WHERE student_id = $1`, [fx.sB]);
    const noPlacement = await dashboard(() => login(SB_EMAIL));
    expect(noPlacement.body.mentor_reminders).toEqual({ count: 0, last_at: null });
  });

  test('F9b: หน้าแรกนักศึกษา — ข้อความ "คณะแจ้งเตือนพี่เลี้ยงแล้ว" ขึ้นเมื่อเคยเตือนเท่านั้น', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'student2');

    // ยังไม่เคยเตือน: การ์ดที่ฝึกงานโหลดแล้ว (มีชื่อบริษัท) แต่ไม่มีข้อความเตือน
    const card = placementCard(page);
    await expect(card).toContainText('ซีเกท', { timeout: 30_000 });
    await expect(page.getByTestId('student-mentor-reminders')).toHaveCount(0);

    await dbExec(
      `INSERT INTO mentor_reminders (mentor_id, student_id, kind, sent_by) VALUES
         ($1, NULL, 'summary', $2), ($1, $3, 'final_report', $2)`,
      [fx.mentor1, fx.staff1, fx.s2]
    );
    await page.reload();
    await expect(placementCard(page)).toContainText('ซีเกท', { timeout: 30_000 });
    const note = page.getByTestId('student-mentor-reminders');
    await expect(note).toBeVisible();
    await expect(note).toContainText('คณะแจ้งเตือนพี่เลี้ยงแล้ว 2 ครั้ง');
    await expect(note).toContainText('ไม่ต้องตามเอง');
    // ไม่เปิดอีเมลเจ้าหน้าที่/ผู้กด
    await expect(note).not.toContainText('staff1');
  });

  test('F10: หน้าจอเจ้าหน้าที่ — เห็นแถวพี่เลี้ยงพร้อมตัวเลข · กดเตือนต้องยืนยัน · สำเร็จแล้วนับ 1 ครั้ง · กดซ้ำเห็นข้อความ 24 ชั่วโมง', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await addMentor1Work(fx);
    await loginAs(page, 'staff1');
    await goToMenu(page, 'mentor_followup');

    await expect(page.getByRole('heading', { name: 'ติดตามพี่เลี้ยง' })).toBeVisible();
    await expect(page.getByTestId('mf-summary-total')).toHaveText('2');
    await expect(page.getByTestId('mf-summary-pending')).toHaveText('1');
    await expect(page.getByTestId('mf-summary-overdue')).toHaveText('1');

    const row1 = page.getByTestId(`mf-row-${fx.mentor1}`);
    await expect(row1).toContainText(MENTOR1_NAME);
    await expect(row1).toContainText('นักศึกษา 2 คน');
    for (const chip of [
      'บันทึกสัปดาห์ 1',
      'บันทึกเดือน 1',
      'บันทึกรายวัน 1',
      'แผนปฏิบัติงาน 1',
      'โครงร่าง 1',
      'ค้างประเมิน สหกิจ 15/16 1 คน',
      'เกินกำหนด 1 รายการ',
      'ค้างนานสุด 9 วัน',
    ]) {
      await expect(row1, chip).toContainText(chip);
    }
    await expect(page.getByTestId(`mf-email-${fx.mentor1}`)).toHaveText(ORIGINAL_MENTOR1_EMAIL);
    await expect(page.getByTestId(`mf-remind-count-${fx.mentor1}`)).toHaveText('ยังไม่เคยเตือน');

    // พี่เลี้ยงที่ไม่มีงานค้าง: ป้ายเขียว + ปุ่มเตือนกดไม่ได้ (ไม่ใช่ปุ่มที่กดแล้ว 400)
    const row2 = page.getByTestId(`mf-row-${fx.mentor2}`);
    await expect(row2).toContainText('ไม่มีงานค้าง');
    await expect(page.getByTestId(`mf-remind-${fx.mentor2}`)).toBeDisabled();

    // กดเตือน → กล่องยืนยันบอกชื่อและอีเมลปลายทาง · ยังไม่ส่งอะไรจนกว่าจะยืนยัน
    await page.getByTestId(`mf-remind-${fx.mentor1}`).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'ยืนยันการเตือนพี่เลี้ยง' });
    await expect(dialog).toContainText(MENTOR1_NAME);
    await expect(dialog).toContainText(ORIGINAL_MENTOR1_EMAIL);
    expect(await reminderCount()).toBe(0);

    await page.getByTestId('mf-remind-confirm').click();
    await expect(page.getByText(`ส่งอีเมลเตือนถึง ${MENTOR1_NAME} (${ORIGINAL_MENTOR1_EMAIL}) แล้ว`)).toBeVisible();
    await expect(page.getByTestId(`mf-remind-count-${fx.mentor1}`)).toContainText('เตือนแล้ว 1 ครั้ง');
    expect(await reminderRows(fx.mentor1)).toEqual([{ kind: 'summary', sent_by: fx.staff1, student_id: null }]);
    expect(await tokenCount(fx.mentor1)).toBe(1);

    // กดซ้ำ → เซิร์ฟเวอร์ 429 · ข้อความขึ้นที่แถบหน้าจอ ไม่เพิ่มแถว
    await page.getByTestId(`mf-remind-${fx.mentor1}`).click();
    await page.getByTestId('mf-remind-confirm').click();
    await expect(page.getByText('เตือนพี่เลี้ยงคนนี้ไปแล้วภายใน 24 ชั่วโมง', { exact: true })).toBeVisible();
    await expect(page.getByTestId(`mf-remind-count-${fx.mentor1}`)).toContainText('เตือนแล้ว 1 ครั้ง');
    expect(await reminderCount()).toBe(1);

    // เจ้าหน้าที่เห็นปุ่มแก้อีเมล/ส่งลิงก์ครบทุกแถว
    await expect(page.locator('[data-testid^="mf-edit-email-"]')).toHaveCount(2);
    await expect(page.locator('[data-testid^="mf-sendlink-"]')).toHaveCount(2);
  });

  test('F11: หน้าจอแก้อีเมล — error อยู่ในกล่อง · บันทึกสำเร็จกล่องปิดและอีเมลใหม่ขึ้นแถว · ส่งลิงก์ใหม่ต้องยืนยัน', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await addMentor1Work(fx);
    await loginAs(page, 'staff1');
    await goToMenu(page, 'mentor_followup');
    await expect(page.getByTestId(`mf-row-${fx.mentor1}`)).toBeVisible();

    await page.getByTestId(`mf-edit-email-${fx.mentor1}`).click();
    const dialog = page.getByRole('dialog').filter({ hasText: `แก้อีเมลของ ${MENTOR1_NAME}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('mf-email-input')).toHaveValue(ORIGINAL_MENTOR1_EMAIL);

    // รูปแบบผิด → ตรวจที่หน้าจอ ไม่ยิงเซิร์ฟเวอร์ · error อยู่ในกล่อง
    await dialog.getByTestId('mf-email-input').fill('ไม่ใช่อีเมล');
    await dialog.getByTestId('mf-email-save').click();
    await expect(dialog.getByText('กรุณากรอกอีเมลให้ถูกรูปแบบ')).toBeVisible();

    // ซ้ำกับบัญชีอื่น (staff1) → เซิร์ฟเวอร์ 409 · ข้อความอยู่ **ในกล่อง** กล่องยังเปิดอยู่ · ฐานไม่เปลี่ยน
    await dialog.getByTestId('mf-email-input').fill('Staff1@test.com');
    await dialog.getByTestId('mf-email-save').click();
    await expect(dialog.getByText('อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว')).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await emailOf(fx.mentor1)).toBe(ORIGINAL_MENTOR1_EMAIL);
    await expect(page.getByTestId(`mf-email-${fx.mentor1}`)).toHaveText(ORIGINAL_MENTOR1_EMAIL);

    // อีเมลที่ใช้ได้ → กล่องปิด · แถวแสดงอีเมลใหม่ · แถบสำเร็จเตือนว่ายังไม่ได้ส่งลิงก์
    await dialog.getByTestId('mf-email-input').fill('mentor1-new-f11@example.com');
    await dialog.getByTestId('mf-email-save').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId(`mf-email-${fx.mentor1}`)).toHaveText('mentor1-new-f11@example.com');
    await expect(
      page.getByText(`เปลี่ยนอีเมลของ ${MENTOR1_NAME} เป็น mentor1-new-f11@example.com แล้ว`)
    ).toBeVisible();
    expect(await emailOf(fx.mentor1)).toBe('mentor1-new-f11@example.com');
    expect(await tokenCount()).toBe(0);

    // ส่งลิงก์เข้าระบบใหม่ → ถามยืนยันก่อน แล้วออกลิงก์ 1 ใบ
    await page.getByTestId(`mf-sendlink-${fx.mentor1}`).click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'ยืนยันการส่งลิงก์เข้าระบบใหม่' });
    await expect(confirm).toContainText('mentor1-new-f11@example.com');
    expect(await tokenCount()).toBe(0);
    await page.getByTestId('mf-sendlink-confirm').click();
    await expect(
      page.getByText(`ส่งลิงก์เข้าระบบใหม่ถึง ${MENTOR1_NAME} (mentor1-new-f11@example.com) แล้ว`)
    ).toBeVisible();
    expect(await tokenCount(fx.mentor1)).toBe(1);
  });

  test('F12: หน้าจออาจารย์/หัวหน้าสาขา — เห็นเฉพาะพี่เลี้ยงในขอบเขตและมีปุ่มเตือน แต่ไม่มีปุ่มแก้อีเมล/ส่งลิงก์', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await addMentor1Work(fx);

    for (const who of ['advisor1', 'head1'] as const) {
      await loginAs(page, who);
      await goToMenu(page, 'mentor_followup');

      await expect(page.getByTestId(`mf-row-${fx.mentor1}`), who).toBeVisible();
      await expect(page.locator('[data-testid^="mf-row-"]'), `${who} เห็นแถวเดียว`).toHaveCount(1);
      await expect(page.getByTestId(`mf-row-${fx.mentor2}`)).toHaveCount(0);

      // นับเฉพาะนักศึกษาในขอบเขต — ไม่เห็นชื่อ sC / ไม่เห็นบันทึกเดือนของ sC
      const row = page.getByTestId(`mf-row-${fx.mentor1}`);
      await expect(row).toContainText('นักศึกษา 1 คน');
      await expect(row).not.toContainText(SC_NAME);
      await expect(row).not.toContainText('บันทึกเดือน');
      await expect(page.getByTestId('mf-summary-total')).toHaveText('1');

      // ปุ่มเตือนมี · ปุ่มที่เป็นของเจ้าหน้าที่ไม่มี (ห้ามแสดงปุ่มที่กดแล้ว 403)
      await expect(page.getByTestId(`mf-remind-${fx.mentor1}`)).toBeEnabled();
      await expect(page.locator('[data-testid^="mf-edit-email-"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="mf-sendlink-"]')).toHaveCount(0);
    }
  });

  test('F13: พี่เลี้ยงที่บัญชียังไม่เปิดใช้ — มีป้ายบอก ปุ่มเตือนและปุ่มส่งลิงก์ปิดพร้อมคำอธิบาย (ไม่ใช่กดแล้วเจอ 403 "ถูกระงับ") · คนที่เปิดใช้แล้วกดได้', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await addMentor1Work(fx);
    await dbExec('UPDATE users SET is_active = FALSE WHERE user_id = $1', [fx.mentor1]);
    const hint = 'ยังไม่ได้ยืนยันพี่เลี้ยง — อาจารย์นิเทศของนักศึกษาต้องกด "ยืนยันและส่งลิงก์" ก่อน';

    await loginAs(page, 'staff1');
    await goToMenu(page, 'mentor_followup');

    // mentor1 มีงานค้าง ปุ่มเตือนจึงเคยกดได้ — ตอนนี้ต้องปิดเพราะบัญชียังไม่เปิดใช้ (= รออาจารย์นิเทศยืนยัน)
    await expect(page.getByTestId(`mf-inactive-${fx.mentor1}`)).toHaveText('รอยืนยัน');
    await expect(page.getByTestId(`mf-remind-${fx.mentor1}`)).toBeDisabled();
    await expect(page.getByTestId(`mf-remind-${fx.mentor1}`)).toHaveAttribute('title', hint);
    await expect(page.getByTestId(`mf-sendlink-${fx.mentor1}`)).toBeDisabled();
    await expect(page.getByTestId(`mf-sendlink-${fx.mentor1}`)).toHaveAttribute('title', hint);

    // ตัวควบคุม: พี่เลี้ยงที่เปิดใช้แล้ว ไม่มีป้าย และปุ่มส่งลิงก์กดได้
    await expect(page.getByTestId(`mf-inactive-${fx.mentor2}`)).toHaveCount(0);
    await expect(page.getByTestId(`mf-sendlink-${fx.mentor2}`)).toBeEnabled();
    await expect(page.getByTestId(`mf-confirm-${fx.mentor2}`)).toHaveCount(0);
  });

  test('F14: หน้าจอ — อาจารย์นิเทศยืนยันพี่เลี้ยงที่รอยืนยัน (ผ่านกล่องยืนยัน · ยกเลิก = ไม่เกิดอะไร) · รายการ "ยังไม่ระบุพี่เลี้ยง" · เจ้าหน้าที่และหัวหน้าสาขาไม่มีปุ่มยืนยัน · กองบนหน้าแรกฝ่ายนิเทศ', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // mentor1 = นักศึกษาระบุแล้ว รอยืนยัน (บัญชีปิด) · ใบของ mentor2 = ยังไม่ระบุพี่เลี้ยง
    await dbExec('UPDATE users SET is_active = FALSE WHERE user_id = $1', [fx.mentor1]);
    await dbExec('DELETE FROM mentor_login_tokens');
    const unassignedForms = await dbRows<{ form_id: number }>(
      `UPDATE intent_forms SET mentor_id = NULL WHERE mentor_id = $1 AND status = 'accepted' RETURNING form_id`,
      [fx.mentor2]
    );
    expect(unassignedForms.length).toBeGreaterThan(0);
    const mentor1 = (await dbRow<{ name: string; email: string }>(
      'SELECT m.name, u.email FROM mentors m JOIN users u ON u.user_id = m.mentor_id WHERE m.mentor_id = $1',
      [fx.mentor1]
    ))!;
    const tokens = async () =>
      Number(await dbValue<string>('SELECT COUNT(*) FROM mentor_login_tokens WHERE user_id = $1', [fx.mentor1]));

    // เจ้าหน้าที่และหัวหน้าสาขาเห็นป้ายรอยืนยัน แต่ไม่มีปุ่มยืนยัน — เห็นข้อความว่ารอใคร (เซิร์ฟเวอร์ 403 อยู่แล้ว)
    for (const who of ['head1', 'staff1'] as const) {
      await loginAs(page, who);
      await goToMenu(page, 'mentor_followup');
      await expect(page.getByTestId(`mf-inactive-${fx.mentor1}`)).toHaveText('รอยืนยัน');
      await expect(page.locator('[data-testid^="mf-confirm-"]')).toHaveCount(0);
      await expect(page.getByTestId(`mf-await-confirm-${fx.mentor1}`)).toHaveText('รออาจารย์นิเทศยืนยัน');
    }

    // (ยังอยู่ที่หน้าของเจ้าหน้าที่) ใบที่ตอบรับแล้วแต่ยังไม่ระบุพี่เลี้ยง ขึ้นเป็นรายการแยก ครบทุกใบ
    await expect(page.getByTestId('mf-unassigned')).toContainText(`ยังไม่ระบุพี่เลี้ยง · ${unassignedForms.length} คน`);
    for (const f of unassignedForms) await expect(page.getByTestId(`mf-unassigned-${f.form_id}`)).toBeVisible();

    // อาจารย์นิเทศของนักศึกษา (advisor1): หน้าแรกฝ่ายนิเทศมีกอง "พี่เลี้ยงรอยืนยัน" → พาไปหน้าติดตามพี่เลี้ยง
    const waiting = Number(
      await dbValue<string>(
        `SELECT COUNT(*) FROM intent_forms i JOIN students s ON s.student_id = i.student_id JOIN users u ON u.user_id = i.mentor_id
          WHERE i.status = 'accepted' AND u.is_active = FALSE
            AND s.supervisor_id = (SELECT user_id FROM users WHERE email = 'advisor1@test.com')`
      )
    );
    expect(waiting).toBeGreaterThan(0);
    await loginAs(page, 'advisor1');
    await page.goto('/dashboard?role=supervisor');
    await expect(page.getByTestId('advisor-home-tile-mentor_confirm')).toHaveAttribute('data-count', String(waiting));
    await page.goto('/dashboard?role=supervisor&menu=mentor_followup');
    await expect(page.getByTestId(`mf-inactive-${fx.mentor1}`)).toHaveText('รอยืนยัน');
    await expect(page.getByTestId(`mf-await-confirm-${fx.mentor1}`)).toHaveCount(0);

    // กดยืนยัน → กล่องยืนยันบอกว่าทำกับใคร ส่งลิงก์ไปไหน · ยกเลิก = ยังไม่มีอะไรเกิด
    await page.getByTestId(`mf-confirm-${fx.mentor1}`).click();
    const summary = page.getByTestId('confirm-summary');
    await expect(summary).toContainText(mentor1.name);
    await expect(summary).toContainText(mentor1.email);
    await page.getByTestId('mf-confirm-cancel').click();
    await expect(page.getByTestId('mf-confirm-submit')).toHaveCount(0);
    expect(await dbValue<boolean>('SELECT is_active FROM users WHERE user_id = $1', [fx.mentor1])).toBe(false);
    expect(await tokens()).toBe(0);

    // ยืนยันจริง → บัญชีเปิด มีลิงก์หนึ่งใบ ป้ายหาย ปุ่มยืนยันหาย · อาจารย์ไม่มีปุ่มส่งลิงก์ใหม่/แก้อีเมล (ของเจ้าหน้าที่เท่านั้น)
    await page.getByTestId(`mf-confirm-${fx.mentor1}`).click();
    await page.getByTestId('mf-confirm-submit').click();
    await expect(page.getByText(`ยืนยัน ${mentor1.name} เป็นพี่เลี้ยงแล้ว`, { exact: false })).toBeVisible();
    await expect(page.getByTestId(`mf-inactive-${fx.mentor1}`)).toHaveCount(0);
    await expect(page.getByTestId(`mf-confirm-${fx.mentor1}`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="mf-sendlink-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="mf-edit-email-"]')).toHaveCount(0);
    expect(await dbValue<boolean>('SELECT is_active FROM users WHERE user_id = $1', [fx.mentor1])).toBe(true);
    expect(await tokens()).toBe(1);

    // เจ้าหน้าที่: หลังยืนยันแล้วปุ่มส่งลิงก์ใหม่กดได้ (ทางเดียวที่ส่งลิงก์ซ้ำ)
    await loginAs(page, 'staff1');
    await goToMenu(page, 'mentor_followup');
    await expect(page.getByTestId(`mf-sendlink-${fx.mentor1}`)).toBeEnabled();
  });
});
