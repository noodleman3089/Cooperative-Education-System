import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import pool from '../../backend/src/config/database';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { placementCard } from '../helpers/intent';
import { dbExec, dbRow, dbRows, dbValue, grantRoleBypassingMentorTrigger } from '../helpers/db';

/**
 * เตือนพี่เลี้ยงอัตโนมัติ (เฟส 3 · `utils/mentorAutoRemind.ts`) — ระบบเตือนพี่เลี้ยงเองเมื่องานค้างเกิน 5 วัน
 * ซ้ำทุก 7 วัน สูงสุด 4 ครั้งต่อรอบ แล้วส่งสรุปพี่เลี้ยงที่เงียบให้เจ้าหน้าที่สัปดาห์ละครั้ง
 *
 * ⛔⛔ เทสต์ชุดนี้เรียกฟังก์ชันของ backend **ในโปรเซสของเทสต์เอง** (ไม่ใช่ dev server) ฟังก์ชันพวกนั้นส่งอีเมล
 * และ `backend/.env` ของเครื่องนี้ชี้ไป Gmail จริง → `utils/email.ts` เลือก dry-run/SMTP จริงครั้งเดียวตอน import
 * จากค่า `MAIL_DRY_RUN` · `playwright.config.ts` ตั้ง `MAIL_DRY_RUN=true` ไว้ที่ระดับบนสุดให้ worker สืบทอด
 * ทุกเคสจึง assert ค่านั้น **ก่อน** import โมดูล และ import ด้วย `await import()` ในเทสต์เท่านั้น (static import ถูก hoist)
 *
 * คุมเงื่อนไข "ใครถูกเตือน/ไม่ถูกเตือน" ก่อนหน้าตา (ส่งเมลผิดคน = หนักกว่าสีผิด):
 *   A1 ปิดอยู่ = ไม่ทำอะไร (tick + scheduler ไม่สร้าง timer) · A2 หน้าต่างเวลา จันทร์-ศุกร์ 09:00-17:59 + วันหยุด
 *   A3 เกณฑ์ 5 วัน + ห่าง 7 วัน + ลิงก์ 7 วัน + audit ไม่มี token · A4 ห่างกันนับทุกชนิดการเตือน
 *   A5 เล่มรายงานส่งแล้วขาด สหกิจ 15/16 · A6 ไม่ใช่พี่เลี้ยงล้วน/ถูกระงับ/ไม่มีที่ฝึกที่รับแล้ว = ไม่ส่ง
 *   A7 ครบ 4 ครั้ง = เงียบ + สรุปถึงเจ้าหน้าที่สัปดาห์ละฉบับ + เริ่มรอบใหม่เมื่อพี่เลี้ยงเปิดลิงก์ · A8 advisory lock
 *   A9 เพดาน 100 ฉบับต่อรอบ · A10 หน้าจอเจ้าหน้าที่/นักศึกษา
 *
 * ไม่ได้ครอบคลุม: เส้นทาง "ส่งเมลล้มเหลว" (dry-run ทำให้ส่งล้มไม่ได้ และห้าม mock email.ts) · timer จริงของ scheduler ตอนเปิดแฟล็ก
 * (ตรวจแค่ว่าเปิดแล้วเรียก setTimeout/setInterval อย่างละครั้งด้วย spy ที่ไม่ได้ตั้ง timer จริง)
 */

const BASE = `${API_URL}/mentor-followup`;
const LOCK_KEY = 730300301;

interface Fx {
  staff1: number;
  /** student2 — พี่เลี้ยง mentor1 · เริ่มงาน 30 วันก่อน */
  s2: number;
  /** นักศึกษา IT01 — พี่เลี้ยง mentor2 (ไม่มีงานค้าง) */
  sB: number;
  mentor1: number;
  mentor2: number;
  companyId: number;
}

interface RunResult {
  eligible: number;
  reminded: number;
  skipped: number;
  failed: number;
  silent: number;
  digest: { sent: number; skippedReason?: string };
}

const MENTOR1_NAME = 'สมศักดิ์ รักเรียน';
const SB_EMAIL = 'student-b-ar@test.com';

const uid = async (email: string): Promise<number> =>
  (await dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]))!;

const majorId = (code: string) => `(SELECT major_id FROM master_major WHERE major_code = '${code}')`;

/** นักศึกษาทดสอบ — ยืมแฮชรหัสผ่านของ student2 · enrollment_year ใหม่พอที่ DeactivationScheduler ไม่ปิดบัญชี */
async function createStudent(email: string, code: string, first: string, last: string): Promise<number> {
  const id = (await dbValue<number>(
    `INSERT INTO users (email, password_hash)
     SELECT $1, password_hash FROM users WHERE email = 'student2@test.com' RETURNING user_id`,
    [email]
  ))!;
  await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [id]);
  await dbExec(
    `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name)
     VALUES ($1, $2, ${majorId('IT01')}, 3.00, 2569, $3, $4)`,
    [id, code, first, last]
  );
  return id;
}

/** บัญชีพี่เลี้ยงล้วน (role mentor + แถว mentors) — ยืมแฮชของ mentor1 */
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

async function placeStudent(studentId: number, mentorId: number, companyId: number, status = 'accepted') {
  await dbExec(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
     VALUES ($1, $2, (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), $4, $3, CURRENT_DATE - 30)`,
    [studentId, companyId, mentorId, status]
  );
}

/**
 * ฐานตั้งต้น — mentor1 ← student2 · mentor2 ← sB · **ยังไม่มีงานค้างเลยและยังไม่เคยเตือน**
 * (seed ไม่มีพี่เลี้ยงคนอื่นที่มีที่ฝึกที่รับแล้ว — ผลของ `run` จึงมาจากสองคนนี้เท่านั้น)
 */
async function buildFixture(): Promise<Fx> {
  const staff1 = await uid('staff1@test.com');
  const s2 = await uid('student2@test.com');
  const mentor1 = await uid('mentor1@test.com');
  const companyId = (await dbValue<number>('SELECT company_id FROM companies LIMIT 1'))!;

  const mentor2 = await createMentor('mentor2-ar@test.com', 'ประสิทธิ์ ทดสอบสอง', companyId);
  const sB = await createStudent(SB_EMAIL, '65990002', 'ปิติ', 'ใจเย็น');
  await placeStudent(s2, mentor1, companyId);
  await placeStudent(sB, mentor2, companyId);
  return { staff1, s2, sB, mentor1, mentor2, companyId };
}

/** บันทึกสัปดาห์ที่ส่งแล้วแต่พี่เลี้ยงยังไม่รับรอง — ค้างมา `daysAgo` วัน (นับตามวันที่ไทยที่ Postgres) */
const addWeeklyLog = (studentId: number, daysAgo: number, week = 1) =>
  dbExec(
    `INSERT INTO weekly_logs (student_id, week_number, status, start_date, end_date, submitted_at)
     VALUES ($1, $2, 'submitted', CURRENT_DATE - 7, CURRENT_DATE, NOW() - ($3::int * INTERVAL '1 day'))`,
    [studentId, week, daysAgo]
  );
const setWeeklyLogAge = (studentId: number, daysAgo: number) =>
  dbExec(`UPDATE weekly_logs SET submitted_at = NOW() - ($2::int * INTERVAL '1 day') WHERE student_id = $1`, [
    studentId,
    daysAgo,
  ]);

/** เล่มรายงานฉบับอาจารย์ที่ส่งแล้ว (ไม่ใช่รายการในคิวพี่เลี้ยง — มีแต่ทำให้ "ค้างประเมิน สหกิจ 15/16") */
const addAdvisorFinalReport = (studentId: number, daysAgo: number) =>
  dbExec(
    `INSERT INTO final_reports (student_id, file_path, status, reviewer_kind, submitted_at)
     VALUES ($1, 'final_reports/ar-seeded.pdf', 'submitted', 'advisor', NOW() - ($2::int * INTERVAL '1 day'))`,
    [studentId, daysAgo]
  );
const addMentorEval = (studentId: number, form: 'sahatkit_15' | 'sahatkit_16') =>
  dbExec(
    `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
     VALUES ($1, 'mentor', $2, '{}'::jsonb, 0)`,
    [studentId, form]
  );

const insertReminder = (mentorId: number, kind: 'summary' | 'auto' | 'final_report', daysAgo: number, sentBy: number | null = null) =>
  dbExec(
    `INSERT INTO mentor_reminders (mentor_id, kind, sent_by, created_at)
     VALUES ($1, $2, $3, NOW() - ($4::int * INTERVAL '1 day'))`,
    [mentorId, kind, sentBy, daysAgo]
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
const digestLogCount = async (): Promise<number> =>
  Number(await dbValue<string>(`SELECT COUNT(*) FROM auto_job_log WHERE job_name = 'mentor_silent_digest'`));

/** อายุของ token อยู่ในช่วง [minSec, maxSec] จากตอนนี้หรือไม่ (คำนวณที่ Postgres) */
const expiresWithin = (token: string, minSec: number, maxSec: number) =>
  dbValue<boolean>(
    `SELECT expires_at > NOW() + ($2::int * INTERVAL '1 second')
        AND expires_at < NOW() + ($3::int * INTERVAL '1 second')
       FROM mentor_login_tokens WHERE token = $1::uuid`,
    [token, minSec, maxSec]
  );
const SEVEN_DAYS = { min: Math.round(6.9 * 86400), max: Math.round(7.1 * 86400) };

/** ⛔ ด่าน dry-run — ต้องผ่านก่อน import backend/src/utils/mentorAutoRemind (ซึ่งลาก email.ts เข้ามา) */
const assertDryRun = () => expect(process.env.MAIL_DRY_RUN, 'MAIL_DRY_RUN ต้องเป็น true ก่อนเรียกฟังก์ชันที่ส่งเมล').toBe('true');

const loadAuto = async () => {
  assertDryRun();
  return await import('../../backend/src/utils/mentorAutoRemind');
};

const runAuto = async (): Promise<RunResult> => (await loadAuto()).runMentorAutoReminders();

interface FollowupRow {
  mentor_id: number;
  auto_reminder_count: number;
  silent_after_max: boolean;
}
interface FollowupBody {
  auto_remind: { enabled: boolean; after_days: number; every_days: number; max: number };
  mentors: FollowupRow[];
}
async function listAsStaff(request: Parameters<typeof apiLoginAs>[0]): Promise<FollowupBody> {
  await apiLoginAs(request, 'staff1');
  const res = await request.get(BASE);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as FollowupBody;
}
const rowOf = (body: FollowupBody, mentorId: number): FollowupRow => {
  const row = body.mentors.find((m) => m.mentor_id === mentorId);
  expect(row, `ไม่พบพี่เลี้ยง ${mentorId} ในรายการ`).toBeTruthy();
  return row!;
};

test.describe('เตือนพี่เลี้ยงอัตโนมัติ — เงื่อนไขใครถูกเตือน · ห่าง 7 วัน · ครบ 4 ครั้งเงียบ · lock · เพดาน', () => {
  let fx: Fx;

  test.beforeEach(async ({ page }) => {
    // ⛔ ด่านแรกของทุกเคส — ก่อนแตะอะไรที่อาจลาก email.ts เข้ามา
    assertDryRun();
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('DELETE FROM mentor_reminders');
    await dbExec('DELETE FROM mentor_login_tokens');
    await dbExec('DELETE FROM auto_job_log');
    fx = await buildFixture();
  });

  test('A1: แฟล็กปิด — tick ไม่ทำอะไรทั้งที่มีพี่เลี้ยงเข้าเกณฑ์ · scheduler ไม่สร้าง timer · เปิดแฟล็กแล้วสร้าง setTimeout/setInterval อย่างละตัว', async () => {
    const auto = await loadAuto();
    await addWeeklyLog(fx.s2, 6);

    const savedFlag = process.env.MENTOR_AUTO_REMIND;
    try {
      for (const off of [undefined, 'false', '', 'TRUE', '1']) {
        if (off === undefined) delete process.env.MENTOR_AUTO_REMIND;
        else process.env.MENTOR_AUTO_REMIND = off;
        await auto.tickMentorAutoReminders();
        expect(await reminderCount(), `MENTOR_AUTO_REMIND=${JSON.stringify(off)} ต้องไม่ส่ง`).toBe(0);
        expect(await tokenCount()).toBe(0);
      }

      // scheduler: ปิด = ไม่เรียก setTimeout/setInterval เลย (spy แทนของจริง ไม่ตั้ง timer จริงทั้งสองกรณี)
      const realTimeout = globalThis.setTimeout;
      const realInterval = globalThis.setInterval;
      let timeouts = 0;
      let intervals = 0;
      const fakeHandle = { unref() { return this; } };
      const spyOn = () => {
        timeouts = 0;
        intervals = 0;
        (globalThis as any).setTimeout = () => { timeouts += 1; return fakeHandle; };
        (globalThis as any).setInterval = () => { intervals += 1; return fakeHandle; };
      };
      const spyOff = () => {
        globalThis.setTimeout = realTimeout;
        globalThis.setInterval = realInterval;
      };

      delete process.env.MENTOR_AUTO_REMIND;
      spyOn();
      try {
        auto.initMentorAutoRemindScheduler(); // ซิงก์ — ไม่มี await ระหว่าง spy
      } finally {
        spyOff();
      }
      expect({ timeouts, intervals }, 'ปิดอยู่ต้องไม่มี timer').toEqual({ timeouts: 0, intervals: 0 });

      // ตัวควบคุม: เปิดแฟล็ก = สร้าง timer อย่างละตัว (พิสูจน์ว่า spy จับได้จริง)
      process.env.MENTOR_AUTO_REMIND = 'true';
      spyOn();
      try {
        auto.initMentorAutoRemindScheduler();
      } finally {
        spyOff();
      }
      expect({ timeouts, intervals }, 'เปิดอยู่ต้องมี timer อย่างละตัว').toEqual({ timeouts: 1, intervals: 1 });
    } finally {
      if (savedFlag === undefined) delete process.env.MENTOR_AUTO_REMIND;
      else process.env.MENTOR_AUTO_REMIND = savedFlag;
    }
    expect(await reminderCount()).toBe(0);

    // ตัวควบคุมของฟิกซ์เจอร์: `run` ตรง ๆ (ไม่ตรวจแฟล็ก) ส่งให้พี่เลี้ยงคนนี้ได้จริง → เหตุที่ tick ไม่ส่งคือแฟล็ก ไม่ใช่ข้อมูลไม่เข้าเกณฑ์
    const r = await auto.runMentorAutoReminders();
    expect(r.reminded).toBe(1);
  });

  test('A2: isAutoRemindWindow — เสาร์/อาทิตย์ปิด · จันทร์ชั่วโมง 8 ปิด · 9 เปิด · ศุกร์ 17 เปิด 18 ปิด · วันหยุดปิด', async () => {
    const { isAutoRemindWindow } = await loadAuto();
    // 2026-10-05 = จันทร์ · 2026-10-09 = ศุกร์ · 2026-10-03 = เสาร์ · 2026-10-04 = อาทิตย์
    const at = (date: string, hour: number, isoWeekday: number) => ({ date, hour, isoWeekday });

    expect(await isAutoRemindWindow(at('2026-10-03', 10, 6)), 'เสาร์').toBe(false);
    expect(await isAutoRemindWindow(at('2026-10-04', 10, 7)), 'อาทิตย์').toBe(false);
    expect(await isAutoRemindWindow(at('2026-10-05', 8, 1)), 'จันทร์ 08:59').toBe(false);
    expect(await isAutoRemindWindow(at('2026-10-05', 9, 1)), 'จันทร์ 09:00').toBe(true);
    expect(await isAutoRemindWindow(at('2026-10-07', 13, 3)), 'พุธบ่าย').toBe(true);
    expect(await isAutoRemindWindow(at('2026-10-09', 17, 5)), 'ศุกร์ 17:59').toBe(true);
    expect(await isAutoRemindWindow(at('2026-10-09', 18, 5)), 'ศุกร์ 18:00').toBe(false);
    expect(await isAutoRemindWindow(at('2026-10-05', 0, 1)), 'จันทร์เที่ยงคืน').toBe(false);

    // วันหยุด: วันจันทร์ 10:00 ปกติเปิด · ระบุเป็นวันหยุด = ปิด · วันหยุดวันอื่นไม่กระทบ
    expect(await isAutoRemindWindow(at('2026-10-05', 10, 1), [])).toBe(true);
    expect(await isAutoRemindWindow(at('2026-10-05', 10, 1), ['2026-10-05'])).toBe(false);
    expect(await isAutoRemindWindow(at('2026-10-05', 10, 1), ['2026-10-06', '2026-10-04'])).toBe(true);

    // ไม่ส่งเวลา = อ่านจาก Postgres → ผลต้องเป็น boolean ไม่โยน
    expect(typeof (await isAutoRemindWindow())).toBe('boolean');
  });

  test('A3: ค้าง 6 วัน = เตือน 1 ฉบับ (แถว auto · sent_by NULL · ลิงก์ 7 วันไป /dashboard · audit ไม่มี token) · ค้าง 3 วัน = ไม่เตือน · รันซ้ำทันที = ไม่เตือน', async () => {
    await addWeeklyLog(fx.s2, 3);

    // ค้าง 3 วัน (< 5) → ไม่เตือน ไม่มีแถว ไม่มีลิงก์
    const early = await runAuto();
    expect(early).toMatchObject({ eligible: 0, reminded: 0, failed: 0, silent: 0 });
    expect(await reminderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);

    // ค้าง 6 วัน → เตือนพี่เลี้ยงคนนี้ 1 ฉบับ (mentor2 ไม่มีงาน → ไม่ถูกเตือน)
    await setWeeklyLogAge(fx.s2, 6);
    const first = await runAuto();
    expect(first).toMatchObject({ eligible: 1, reminded: 1, failed: 0, silent: 0 });
    expect(await reminderRows(fx.mentor1)).toEqual([{ kind: 'auto', sent_by: null, student_id: null }]);
    expect(await reminderCount()).toBe(1);

    // ลิงก์เข้าระบบ 1 ใบของพี่เลี้ยงคนนี้ · 7 วัน · ไป /dashboard · ยังไม่ถูกใช้ · ไม่มีของคนอื่น
    const tokens = await dbRows<{ token: string; target: string | null; used_at: string | null }>(
      'SELECT token, target, used_at FROM mentor_login_tokens WHERE user_id = $1',
      [fx.mentor1]
    );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ target: '/dashboard', used_at: null });
    expect(await expiresWithin(tokens[0].token, SEVEN_DAYS.min, SEVEN_DAYS.max)).toBe(true);
    expect(await tokenCount()).toBe(1);

    // audit (เขียนหลังส่ง) — ไม่มีผู้กด และไม่เก็บตัว token
    await expect
      .poll(
        async () =>
          dbRow(
            `SELECT actor_id, subject_id, detail->>'mentor_id' AS mentor_id, detail->>'auto_count' AS auto_count,
                    detail->>'items' AS items, (detail::text LIKE '%' || $2 || '%') AS leaks_token
               FROM audit_log WHERE action = 'mentor.reminder_auto_sent' AND subject_id = $1`,
            [fx.mentor1, tokens[0].token]
          ),
        { timeout: 10_000 }
      )
      .toMatchObject({
        actor_id: null,
        subject_id: fx.mentor1,
        mentor_id: String(fx.mentor1),
        auto_count: '1',
        items: '1',
        leaks_token: false,
      });

    // รันซ้ำทันที → ห่างไม่ถึง 7 วัน ไม่เตือนซ้ำ ไม่เพิ่มแถว/ลิงก์
    const again = await runAuto();
    expect(again).toMatchObject({ eligible: 0, reminded: 0, failed: 0 });
    expect(await reminderCount()).toBe(1);
    expect(await tokenCount()).toBe(1);
  });

  test('A4: ด่านห่าง 7 วันนับทุกชนิด — เตือนสรุปที่เจ้าหน้าที่กดเมื่อ 3 วันก่อน = ระบบไม่เตือนทับ · เมื่อ 8 วันก่อน = เตือนได้', async () => {
    await addWeeklyLog(fx.s2, 6);
    await insertReminder(fx.mentor1, 'summary', 3, fx.staff1);

    const blocked = await runAuto();
    expect(blocked).toMatchObject({ reminded: 0, failed: 0 });
    expect(await reminderCount()).toBe(1);
    expect(await tokenCount()).toBe(0);

    await dbExec(`UPDATE mentor_reminders SET created_at = NOW() - INTERVAL '8 days'`);
    const sent = await runAuto();
    expect(sent).toMatchObject({ eligible: 1, reminded: 1, failed: 0 });
    expect((await reminderRows(fx.mentor1)).map((r) => r.kind)).toEqual(['summary', 'auto']);
    expect(await tokenCount(fx.mentor1)).toBe(1);

    // ชนิด final_report ก็กันเช่นกัน
    await dbExec('DELETE FROM mentor_reminders');
    await dbExec('DELETE FROM mentor_login_tokens');
    await insertReminder(fx.mentor1, 'final_report', 2, fx.staff1);
    expect((await runAuto()).reminded).toBe(0);
    expect(await reminderCount()).toBe(1);
  });

  test('A5: ไม่มีงานในคิวแต่ส่งเล่มรายงานแล้ว 6 วัน — ขาด สหกิจ 15/16 = เตือน · ครบทั้งสองใบ = ไม่เตือน · ขาดใบเดียว = เตือน', async () => {
    await addAdvisorFinalReport(fx.s2, 6);

    // ขาดทั้งสองใบ → เตือน
    expect(await runAuto()).toMatchObject({ eligible: 1, reminded: 1 });
    expect(await reminderCount(fx.mentor1)).toBe(1);

    const resetReminders = async () => {
      await dbExec('DELETE FROM mentor_reminders');
      await dbExec('DELETE FROM mentor_login_tokens');
    };

    // ครบสองใบ (15 + 16 ของพี่เลี้ยง) → ไม่ค้างแล้ว
    await resetReminders();
    await addMentorEval(fx.s2, 'sahatkit_15');
    await addMentorEval(fx.s2, 'sahatkit_16');
    expect(await runAuto()).toMatchObject({ eligible: 0, reminded: 0 });
    expect(await reminderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);

    // ขาดใบเดียว (16) → เตือน
    await dbExec(`DELETE FROM final_evaluations WHERE student_id = $1 AND form_code = 'sahatkit_16'`, [fx.s2]);
    expect(await runAuto()).toMatchObject({ eligible: 1, reminded: 1 });
    expect(await reminderCount(fx.mentor1)).toBe(1);

    // ขาดใบเดียว (15) → เตือน
    await resetReminders();
    await dbExec(`DELETE FROM final_evaluations WHERE student_id = $1`, [fx.s2]);
    await addMentorEval(fx.s2, 'sahatkit_16');
    expect(await runAuto()).toMatchObject({ eligible: 1, reminded: 1 });

    // เล่มส่งเพียง 3 วัน (< 5) ยังขาดผลประเมินทั้งสองใบ แต่ไม่เข้าเกณฑ์
    await resetReminders();
    await dbExec(`DELETE FROM final_evaluations WHERE student_id = $1`, [fx.s2]);
    await dbExec(`UPDATE final_reports SET submitted_at = NOW() - INTERVAL '3 days' WHERE student_id = $1`, [fx.s2]);
    expect(await runAuto()).toMatchObject({ eligible: 0, reminded: 0 });
    expect(await reminderCount()).toBe(0);
  });

  test('A6: ไม่เข้าเกณฑ์ = ไม่ส่งและไม่ออกลิงก์ — พี่เลี้ยงถูกระงับ · มีบทบาทอื่นด้วย · ไม่มีที่ฝึกที่รับแล้ว (ตัวควบคุม: คืนบัญชีแล้วส่งได้)', async () => {
    // ทุกคนมีงานค้าง 6 วัน — ต่างกันที่คุณสมบัติของบัญชีเท่านั้น
    const mentor3 = await createMentor('mentor3-ar@test.com', 'ไม่มีที่ฝึก ทดสอบสาม', fx.companyId);
    const sD = await createStudent('student-d-ar@test.com', '65990004', 'ดวงดี', 'มีสุข');
    await placeStudent(sD, mentor3, fx.companyId, 'superseded'); // ไม่ใช่ที่ฝึกที่รับแล้ว

    await addWeeklyLog(fx.s2, 6);
    await addWeeklyLog(fx.sB, 6);
    await addWeeklyLog(sD, 6);

    await dbExec('UPDATE users SET is_active = FALSE WHERE user_id = $1', [fx.mentor1]); // ถูกระงับ
    // ไม่ใช่พี่เลี้ยงล้วน (SEC-03) — ปัจจุบันฐานไม่ยอมให้บัญชี mentor+advisor เกิดขึ้น (migration 043) ต้องเห็นมันปฏิเสธก่อน
    await expect(
      dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'advisor')`, [fx.mentor2])
    ).rejects.toThrow(/mentor_role_exclusive/);
    // แล้วจำลองข้อมูลเก่าด้วยการข้าม trigger ชั่วคราว — พิสูจน์ว่าด่านในแอปของตัวเตือนอัตโนมัติยังกันได้เองเป็นชั้นสอง
    await grantRoleBypassingMentorTrigger(fx.mentor2, 'advisor');

    const none = await runAuto();
    expect(none).toMatchObject({ eligible: 0, reminded: 0, failed: 0, silent: 0 });
    expect(await reminderCount()).toBe(0);
    expect(await tokenCount()).toBe(0);

    // ตัวควบคุม: คืนบัญชี mentor1 → ส่งให้ mentor1 คนเดียว (mentor2/mentor3 ยังไม่เข้าเกณฑ์)
    await dbExec('UPDATE users SET is_active = TRUE WHERE user_id = $1', [fx.mentor1]);
    const one = await runAuto();
    expect(one).toMatchObject({ eligible: 1, reminded: 1, failed: 0 });
    expect(await reminderCount(fx.mentor1)).toBe(1);
    expect(await reminderCount(fx.mentor2)).toBe(0);
    expect(await reminderCount(mentor3)).toBe(0);
    expect(await tokenCount()).toBe(1);
    expect(await tokenCount(fx.mentor1)).toBe(1);

    // ตัวควบคุมที่สอง: คืนบทบาท mentor2 → ได้รับเตือนด้วย (ต้นเหตุที่ไม่ส่งคือบทบาทจริง ๆ)
    await dbExec(`DELETE FROM user_roles WHERE user_id = $1 AND role_name = 'advisor'`, [fx.mentor2]);
    expect(await runAuto()).toMatchObject({ eligible: 1, reminded: 1 });
    expect(await reminderCount(fx.mentor2)).toBe(1);
  });

  test('A7: ครบ 4 ครั้งแล้วยังค้าง = เงียบ ไม่ส่งเพิ่ม · สรุปถึงเจ้าหน้าที่สัปดาห์ละฉบับ · API ขึ้นธง · พี่เลี้ยงเปิดลิงก์ = เริ่มรอบใหม่', async ({
    request,
  }) => {
    await addWeeklyLog(fx.s2, 6);
    for (const daysAgo of [8, 15, 22, 29]) await insertReminder(fx.mentor1, 'auto', daysAgo);

    const first = await runAuto();
    expect(first).toMatchObject({ eligible: 0, reminded: 0, failed: 0, silent: 1 });
    expect(first.digest.sent).toBeGreaterThanOrEqual(1);
    expect(first.digest.skippedReason).toBeUndefined();
    expect(await reminderCount(fx.mentor1)).toBe(4); // ไม่เพิ่ม
    expect(await tokenCount()).toBe(0);
    expect(await digestLogCount()).toBe(1);

    // รันซ้ำในสัปดาห์เดียวกัน → ยังเงียบ แต่ไม่ส่งสรุปซ้ำ · log ยังหนึ่งแถว
    const second = await runAuto();
    expect(second).toMatchObject({ reminded: 0, silent: 1 });
    expect(second.digest).toEqual({ sent: 0, skippedReason: 'already_sent_this_week' });
    expect(await digestLogCount()).toBe(1);

    // API (เจ้าหน้าที่): ธงเงียบ + จำนวนอัตโนมัติ 4 · แฟล็กเตือนเองในเซิร์ฟเวอร์ E2E ปิดอยู่
    let body = await listAsStaff(request);
    expect(body.auto_remind).toEqual({ enabled: false, after_days: 5, every_days: 7, max: 4 });
    expect(rowOf(body, fx.mentor1)).toMatchObject({ auto_reminder_count: 4, silent_after_max: true });
    expect(rowOf(body, fx.mentor2)).toMatchObject({ auto_reminder_count: 0, silent_after_max: false });

    // พี่เลี้ยงกดลิงก์เข้าระบบ (used_at = ตอนนี้) → รอบใหม่: นับ 0 · ไม่เงียบแล้ว · เตือนได้อีก
    await dbExec(
      `INSERT INTO mentor_login_tokens (token, user_id, target, expires_at, used_at, created_at)
       VALUES ($1::uuid, $2, '/dashboard', NOW() + INTERVAL '1 hour', NOW(), NOW() - INTERVAL '10 minutes')`,
      [crypto.randomUUID(), fx.mentor1]
    );
    body = await listAsStaff(request);
    expect(rowOf(body, fx.mentor1)).toMatchObject({ auto_reminder_count: 0, silent_after_max: false });

    const third = await runAuto();
    expect(third).toMatchObject({ eligible: 1, reminded: 1, silent: 0 });
    expect(await reminderCount(fx.mentor1)).toBe(5);
    body = await listAsStaff(request);
    expect(rowOf(body, fx.mentor1)).toMatchObject({ auto_reminder_count: 1, silent_after_max: false });
  });

  test('A7b: สรุปเงียบถึงเจ้าหน้าที่ — ไม่มีเจ้าหน้าที่ที่ใช้งานได้ = ไม่ส่งและไม่จดบันทึก · มีแล้วส่งและจดหนึ่งแถว · ไม่มีพี่เลี้ยงเงียบ = ไม่ส่ง', async () => {
    await addWeeklyLog(fx.s2, 6);
    for (const daysAgo of [8, 15, 22, 29]) await insertReminder(fx.mentor1, 'auto', daysAgo);

    const staffIds = (
      await dbRows<{ user_id: number }>(
        `SELECT DISTINCT u.user_id FROM users u JOIN user_roles r ON r.user_id = u.user_id WHERE r.role_name = 'staff'`
      )
    ).map((r) => r.user_id);
    expect(staffIds.length).toBeGreaterThanOrEqual(1);
    await dbExec('UPDATE users SET is_active = FALSE WHERE user_id = ANY($1::int[])', [staffIds]);

    const noStaff = await runAuto();
    expect(noStaff).toMatchObject({ silent: 1, reminded: 0 });
    expect(noStaff.digest).toEqual({ sent: 0, skippedReason: 'no_staff_recipients' });
    expect(await digestLogCount()).toBe(0);

    // ตัวควบคุม: เปิดบัญชีเจ้าหน้าที่คืน → ส่งได้ + จดหนึ่งแถว (ไม่ถูกบล็อกจากรอบก่อนที่ไม่ได้จด)
    await dbExec('UPDATE users SET is_active = TRUE WHERE user_id = ANY($1::int[])', [staffIds]);
    const withStaff = await runAuto();
    expect(withStaff.digest.sent).toBeGreaterThanOrEqual(1);
    expect(await digestLogCount()).toBe(1);

    // ไม่มีพี่เลี้ยงเงียบ (งานค้างหาย) → ไม่ส่งสรุป
    await dbExec('DELETE FROM auto_job_log');
    await dbExec(`DELETE FROM weekly_logs WHERE student_id = $1`, [fx.s2]);
    const nothing = await runAuto();
    expect(nothing).toMatchObject({ silent: 0, reminded: 0 });
    expect(nothing.digest).toEqual({ sent: 0, skippedReason: 'no_silent_mentors' });
    expect(await digestLogCount()).toBe(0);
  });

  test('A8: advisory lock — มีอีก connection ถือล็อกอยู่ = รันไม่ได้ (ศูนย์ทุกค่า + another_run_in_progress · ไม่มีแถว) · ปล่อยแล้วรันได้', async () => {
    await addWeeklyLog(fx.s2, 6);

    const holder = await pool.connect();
    let held = false;
    try {
      await holder.query('SELECT pg_advisory_lock($1::bigint)', [LOCK_KEY]);
      held = true;

      const blocked = await runAuto();
      expect(blocked).toEqual({
        eligible: 0,
        reminded: 0,
        skipped: 0,
        failed: 0,
        silent: 0,
        digest: { sent: 0, skippedReason: 'another_run_in_progress' },
      });
      expect(await reminderCount()).toBe(0);
      expect(await tokenCount()).toBe(0);
      expect(await digestLogCount()).toBe(0);
    } finally {
      // ปล่อยล็อกจริงก่อนคืน connection — advisory lock ระดับ session ไม่หายเองเมื่อคืนเข้า pool
      if (held) await holder.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY]);
      holder.release();
    }

    const free = await runAuto();
    expect(free).toMatchObject({ eligible: 1, reminded: 1, failed: 0 });
    expect(free.digest.skippedReason).not.toBe('another_run_in_progress');
    expect(await reminderCount(fx.mentor1)).toBe(1);

    // รันเสร็จแล้วต้องปล่อยล็อกเอง — เอา connection อื่นมาลองยึดได้ทันที
    const probe = await pool.connect();
    try {
      const got = await probe.query('SELECT pg_try_advisory_lock($1::bigint) AS ok', [LOCK_KEY]);
      expect(got.rows[0].ok).toBe(true);
      await probe.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY]);
    } finally {
      probe.release();
    }
  });

  test('A9: เพดานต่อรอบ 100 ฉบับ — พี่เลี้ยงเข้าเกณฑ์ 102 คน ส่งได้ไม่เกิน 100 · ที่เหลือรอรอบหน้า', async () => {
    test.setTimeout(240_000);
    const auto = await loadAuto();
    expect(auto.AUTO_REMIND_MAX_PER_RUN).toBe(100);

    try {
      // พี่เลี้ยง 102 + นักศึกษา 102 (ของปลอมทั้งหมด) · SQL ชุดเดียว — คู่กันด้วยเลขลำดับในอีเมล
      await dbExec(
        `INSERT INTO users (email, password_hash)
         SELECT p || '-' || g || '@test.com', (SELECT password_hash FROM users WHERE email = 'mentor1@test.com')
           FROM generate_series(1, 102) g, unnest(ARRAY['cap-m', 'cap-s']) p`
      );
      await dbExec(
        `INSERT INTO user_roles (user_id, role_name)
         SELECT user_id, CASE WHEN email LIKE 'cap-m-%' THEN 'mentor' ELSE 'student' END
           FROM users WHERE email LIKE 'cap-m-%@test.com' OR email LIKE 'cap-s-%@test.com'`
      );
      await dbExec(
        `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
         SELECT user_id, $1::int, 'พี่เลี้ยงทดสอบ ' || split_part(split_part(email, '@', 1), '-', 3), 'Engineer', 'QA', '0812223333'
           FROM users WHERE email LIKE 'cap-m-%@test.com'`,
        [fx.companyId]
      );
      await dbExec(
        `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name)
         SELECT user_id, '65991' || lpad(split_part(split_part(email, '@', 1), '-', 3), 3, '0'), ${majorId('IT01')},
                3.00, 2569, 'ทดสอบ', 'เพดาน' || split_part(split_part(email, '@', 1), '-', 3)
           FROM users WHERE email LIKE 'cap-s-%@test.com'`
      );
      await dbExec(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
         SELECT s.user_id, $1::int, (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), 'accepted', m.user_id,
                CURRENT_DATE - 30
           FROM users s JOIN users m
             ON split_part(split_part(m.email, '@', 1), '-', 3) = split_part(split_part(s.email, '@', 1), '-', 3)
          WHERE s.email LIKE 'cap-s-%@test.com' AND m.email LIKE 'cap-m-%@test.com'`,
        [fx.companyId]
      );
      await dbExec(
        `INSERT INTO weekly_logs (student_id, week_number, status, start_date, end_date, submitted_at)
         SELECT user_id, 1, 'submitted', CURRENT_DATE - 7, CURRENT_DATE, NOW() - INTERVAL '6 days'
           FROM users WHERE email LIKE 'cap-s-%@test.com'`
      );
      expect(Number(await dbValue<string>(`SELECT COUNT(*) FROM intent_forms WHERE status = 'accepted' AND mentor_id IN (SELECT user_id FROM users WHERE email LIKE 'cap-m-%@test.com')`))).toBe(102);

      const r = await runAuto();
      expect(r.eligible).toBe(102);
      expect(r.reminded + r.failed).toBeLessThanOrEqual(100);
      expect(r.reminded).toBe(100);
      expect(r.skipped).toBeGreaterThanOrEqual(2);
      expect(await reminderCount()).toBe(100);
      expect(Number(await dbValue<string>(`SELECT COUNT(*) FROM mentor_reminders WHERE kind = 'auto' AND sent_by IS NULL`))).toBe(100);

      // รอบถัดไป: คนที่ยังไม่ได้ส่งได้ส่ง (2 คน) — คนที่ส่งแล้วห่างไม่ถึง 7 วันไม่ถูกส่งซ้ำ
      const next = await runAuto();
      expect(next.reminded).toBe(2);
      expect(await reminderCount()).toBe(102);
    } finally {
      // นักศึกษา/พี่เลี้ยงทดสอบถูกลบด้วย cascade (ฐานถูกรีเซ็ตด้วย seedTestData ต้นเทสต์ถัดไปอยู่แล้ว — ลบตรงนี้กันเศษค้างไว้ก่อน)
      await dbExec(`DELETE FROM users WHERE email LIKE 'cap-m-%@test.com' OR email LIKE 'cap-s-%@test.com'`);
    }
  });

  test('A10: หน้าจอ — แถบสถานะบอกว่ายังปิดอยู่ · พี่เลี้ยงที่เงียบมีป้าย+จำนวนอัตโนมัติ · ตัวกรอง "เงียบหลังเตือนครบ" · มือถือไม่เลื่อนแนวนอน · นักศึกษาเห็นจำนวนรวมทุกชนิด', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await addWeeklyLog(fx.s2, 6);
    for (const daysAgo of [8, 15, 22, 29]) await insertReminder(fx.mentor1, 'auto', daysAgo);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'mentor_followup');

    const banner = page.getByTestId('mf-auto-banner');
    await expect(banner).toHaveAttribute('data-enabled', 'false');
    await expect(banner).toContainText('ยังปิดอยู่');

    const row1 = page.getByTestId(`mf-row-${fx.mentor1}`);
    await expect(row1).toContainText(MENTOR1_NAME);
    await expect(page.getByTestId(`mf-silent-${fx.mentor1}`)).toBeVisible();
    await expect(page.getByTestId(`mf-auto-count-${fx.mentor1}`)).toContainText('4');
    await expect(page.getByTestId('mf-summary-silent')).toHaveText('1');
    // พี่เลี้ยงที่ไม่เงียบไม่มีป้าย
    await expect(page.getByTestId(`mf-row-${fx.mentor2}`)).toBeVisible();
    await expect(page.getByTestId(`mf-silent-${fx.mentor2}`)).toHaveCount(0);
    await expect(page.getByTestId(`mf-auto-count-${fx.mentor2}`)).toHaveCount(0);

    // ตัวกรอง "เงียบหลังเตือนครบ" ซ่อนคนที่ไม่เงียบ
    await page.getByRole('button', { name: 'เงียบหลังเตือนครบ' }).click();
    await expect(page.getByTestId(`mf-row-${fx.mentor1}`)).toBeVisible();
    await expect(page.getByTestId(`mf-row-${fx.mentor2}`)).toHaveCount(0);
    await page.getByRole('button', { name: 'ทั้งหมด', exact: true }).click();
    await expect(page.getByTestId(`mf-row-${fx.mentor2}`)).toBeVisible();

    // มือถือ 375px — หน้าไม่เลื่อนแนวนอน และป้ายยังมองเห็น
    await page.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { timeout: 10_000 })
      .toBe(true);
    await expect(page.getByTestId(`mf-silent-${fx.mentor1}`)).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });

    // นักศึกษาของพี่เลี้ยงเห็นจำนวนครั้งรวมทุกชนิด (รวมที่ระบบเตือนเอง) — ไม่บอกว่าใครกด
    await loginAs(page, 'student2');
    await expect(placementCard(page)).toContainText('ซีเกท', { timeout: 30_000 });
    const note = page.getByTestId('student-mentor-reminders');
    await expect(note).toBeVisible();
    await expect(note).toContainText('คณะแจ้งเตือนพี่เลี้ยงแล้ว 4 ครั้ง');
  });

  // A11 (เส้นทางส่งเมลล้มเหลวไม่ทำให้รอบหยุดและไม่ทิ้งแถว/ลิงก์) — ข้ามโดยตั้งใจ: dry-run ส่งล้มไม่ได้ และห้าม mock email.ts
});
