import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { dbExec, dbRows, dbValue, mentor1Id } from '../helpers/db';

/**
 * ขั้น 8 หลังฝึก — อาจารย์นิเทศเห็นคะแนนสหกิจ 15 · 16 ของนักศึกษาที่ตัวเองนิเทศ และตามพี่เลี้ยงได้
 *
 * อาจารย์นิเทศตัดเกรดเองนอกระบบ (เจ้าของตัดสิน 2026-10-09) จึงต้องเห็นคะแนนรวมสองใบ — แต่ `GET /coop-progress/dashboard`
 * เดิมกรองอาจารย์ด้วย `advisor_id` อย่างเดียว อาจารย์นิเทศที่ไม่ใช่ที่ปรึกษาของนักศึกษาคนนั้นไม่เห็นอะไรเลย
 *
 * คุม "ใครเห็นของใคร" ก่อนหน้าตา:
 *   S1 เห็นคะแนนของนักศึกษาที่ตัวเองนิเทศ ซึ่งมีที่ปรึกษาเป็นคนอื่น · ได้แค่คะแนนรวม + วันที่ส่ง (ไม่มีรายข้อ ไม่มีไฟล์เล่ม)
 *   S2 ไม่เห็นนักศึกษาที่ไม่ได้นิเทศ · ไม่ได้นิเทศใครเลย = รายการว่าง ไม่ใช่ทั้งสาขา/ทั้งคณะ · view แปลก = 400
 *   S3 ไม่ส่ง view = ขอบเขตเดิม (ที่ปรึกษาเห็นของตัวเอง · เจ้าหน้าที่เห็นทั้งหมด) และฟิลด์เดิมครบ
 *   S4 นักศึกษายังถูกปฏิเสธผลประเมินก่อนพ้น coop_end
 *   S5 อาจารย์นิเทศเตือนพี่เลี้ยงของนักศึกษาที่ตัวเองนิเทศได้ · ของคนอื่น 403
 *   S6 หน้าจอ: ฝ่ายนิเทศเห็นเมนู "ติดตามพี่เลี้ยง" · S7 คอลัมน์คะแนนในหน้า "นักศึกษาที่ฉันนิเทศ"
 *
 * การส่งเมลไม่ออกเน็ต (`MAIL_DRY_RUN=true` ใน playwright.config.ts) · ข้อมูลทั้งหมดเป็นของปลอม
 */

type Row = {
  studentId: number;
  sahatkit15Score: number | null;
  sahatkit16Score: number | null;
  sahatkit15SubmittedAt: string | null;
  sahatkit16SubmittedAt: string | null;
  finalReportStatus: string;
  finalReportPath: string | null;
  finalReportId: number | null;
  reportConfirmation: null | { confirmationId: number; status: string };
};

interface Fx {
  advisor1: number;
  advisor2: number;
  /** student2 — ที่ปรึกษา advisor2 · นิเทศ advisor1 · พี่เลี้ยง mentor1 · มีคะแนนครบสองใบ + เล่ม + สหกิจ 14 */
  s2: number;
  /** ที่ปรึกษา advisor2 · นิเทศ advisor1 · ยังไม่มีคะแนน */
  sNone: number;
  /** ที่ปรึกษา advisor1 · นิเทศ advisor2 — advisor1 เห็นทางฝ่ายที่ปรึกษาเท่านั้น */
  sAdv: number;
  /** ที่ปรึกษาและนิเทศ advisor2 · พี่เลี้ยง mentor2 — advisor1 ไม่เกี่ยวเลย */
  sOther: number;
  mentor1: number;
  mentor2: number;
}

/** ข้อความที่ฝังในรายข้อของสหกิจ 15 — ต้องไม่หลุดออกมากับ endpoint นี้ */
const ITEM_MARKER = 'E2E-ITEM-DETAIL-MUST-NOT-LEAK';

const uid = async (email: string): Promise<number> =>
  (await dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]))!;

/** นักศึกษาทดสอบ — enrollment_year ใหม่พอที่ DeactivationScheduler ไม่ปิดบัญชี */
async function createStudent(
  email: string,
  code: string,
  first: string,
  advisorId: number,
  supervisorId: number
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
     VALUES ($1, $2, (SELECT major_id FROM master_major WHERE major_code = 'IT01'), 3.00, 2569,
             $3, 'ทดสอบนิเทศ', $4, $5)`,
    [id, code, first, advisorId, supervisorId]
  );
  return id;
}

async function placeStudent(studentId: number, mentorId: number): Promise<void> {
  await dbExec(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
     VALUES ($1, (SELECT company_id FROM companies LIMIT 1),
             (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1),
             'accepted', $2, CURRENT_DATE - 30)`,
    [studentId, mentorId]
  );
}

const addScore = (studentId: number, formCode: 'sahatkit_15' | 'sahatkit_16', total: number) =>
  dbExec(
    `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
     VALUES ($1, 'mentor', $2, $3, $4)`,
    [studentId, formCode, JSON.stringify({ other_comments: ITEM_MARKER }), total]
  );

/** งานค้างหนึ่งรายการของพี่เลี้ยง — ให้การเตือนไม่ตกที่ 400 "ไม่มีงานค้าง" */
const addPendingWeeklyLog = (studentId: number) =>
  dbExec(
    `INSERT INTO weekly_logs (student_id, week_number, status, start_date, end_date, submitted_at)
     VALUES ($1, 1, 'submitted', CURRENT_DATE - 6, CURRENT_DATE, NOW() - INTERVAL '2 days')`,
    [studentId]
  );

async function buildFixture(): Promise<Fx> {
  const advisor1 = await uid('advisor1@test.com');
  const advisor2 = await uid('advisor2@test.com');
  const s2 = await uid('student2@test.com');
  const mentor1 = await mentor1Id();

  // seed ตั้ง advisor1 เป็นทั้งสองหน้าที่ของ student2 — แยกออก ให้ advisor1 เหลือแค่นิเทศ
  await dbExec('UPDATE students SET advisor_id = $1, supervisor_id = $2 WHERE student_id = $3', [advisor2, advisor1, s2]);

  const sNone = await createStudent('student-sup-none@test.com', '65990021', 'ยังไม่ประเมิน', advisor2, advisor1);
  const sAdv = await createStudent('student-sup-adv@test.com', '65990022', 'ที่ปรึกษา', advisor1, advisor2);
  const sOther = await createStudent('student-sup-other@test.com', '65990023', 'คนอื่น', advisor2, advisor2);

  const mentor2 = (await dbValue<number>(
    `INSERT INTO users (email, password_hash)
     SELECT 'mentor2-sup@test.com', password_hash FROM users WHERE email = 'mentor1@test.com' RETURNING user_id`
  ))!;
  await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'mentor')`, [mentor2]);
  await dbExec(
    `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
     VALUES ($1, (SELECT company_id FROM companies LIMIT 1), 'ประสิทธิ์ ทดสอบนิเทศ', 'Engineer', 'QA', '0812223333')`,
    [mentor2]
  );

  await placeStudent(s2, mentor1);
  await placeStudent(sOther, mentor2);

  await addScore(s2, 'sahatkit_15', 87.5);
  await addScore(s2, 'sahatkit_16', 61);
  await addScore(sAdv, 'sahatkit_15', 70);
  await addScore(sOther, 'sahatkit_15', 55);
  await addScore(sOther, 'sahatkit_16', 40);

  // เล่มที่ตรวจรับแล้ว + สหกิจ 14 ของ s2 และเล่มของ sAdv — ไว้ดูว่าฝ่ายไหนได้ฟิลด์ของงานตรวจรับเล่ม
  for (const sid of [s2, sAdv]) {
    await dbExec(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/sup-seeded.pdf', 'approved', 1, 'advisor')`,
      [sid]
    );
  }
  await dbExec(
    `INSERT INTO report_confirmations (student_id, report_id, status)
     SELECT student_id, report_id, 'pending' FROM final_reports WHERE student_id = $1`,
    [s2]
  );

  return { advisor1, advisor2, s2, sNone, sAdv, sOther, mentor1, mentor2 };
}

const dashboard = (request: APIRequestContext, query = '') =>
  request.get(`${API_URL}/coop-progress/dashboard${query}`);

async function rows(request: APIRequestContext, query = ''): Promise<Row[]> {
  const res = await dashboard(request, query);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).data as Row[];
}

const ids = (list: Row[]) => list.map((r) => r.studentId).sort((a, b) => a - b);
const sorted = (...list: number[]) => [...list].sort((a, b) => a - b);

test.describe('ขั้น 8 · อาจารย์นิเทศเห็นคะแนนสหกิจ 15 · 16', () => {
  let fx: Fx;

  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('DELETE FROM mentor_reminders');
    fx = await buildFixture();
  });

  test('S1: อาจารย์นิเทศเห็นคะแนนรวมสองใบของนักศึกษาที่ตัวเองนิเทศ (ที่ปรึกษาเป็นคนอื่น) — ไม่มีรายข้อ ไม่มีไฟล์เล่ม', async ({
    request,
  }) => {
    await apiLoginAs(request, 'advisor1');
    const res = await dashboard(request, '?view=supervisor');
    expect(res.status(), await res.text()).toBe(200);
    const text = await res.text();
    const list = JSON.parse(text).data as Row[];

    expect(ids(list)).toEqual(sorted(fx.s2, fx.sNone));

    const scored = list.find((r) => r.studentId === fx.s2)!;
    expect(scored.sahatkit15Score).toBe(87.5);
    expect(scored.sahatkit16Score).toBe(61);
    expect(scored.sahatkit15SubmittedAt).toBeTruthy();
    expect(scored.sahatkit16SubmittedAt).toBeTruthy();

    const none = list.find((r) => r.studentId === fx.sNone)!;
    expect(none.sahatkit15Score).toBeNull();
    expect(none.sahatkit16Score).toBeNull();
    expect(none.sahatkit15SubmittedAt).toBeNull();
    expect(none.sahatkit16SubmittedAt).toBeNull();

    // รายข้อของแบบประเมินไม่ออกจาก endpoint นี้
    expect(text).not.toContain(ITEM_MARKER);
    // ตรวจรับเล่ม · สหกิจ 14 เป็นงานของอาจารย์ที่ปรึกษา — ฝ่ายนิเทศไม่ได้ไฟล์เล่มและใบยืนยัน
    expect(scored.finalReportPath).toBeNull();
    expect(scored.finalReportId).toBeNull();
    expect(scored.reportConfirmation).toBeNull();
  });

  test('S2: ไม่เห็นนักศึกษาที่ไม่ได้นิเทศ · ไม่ได้นิเทศใครเลย = รายการว่าง ไม่ใช่ทั้งสาขา/ทั้งคณะ · view ที่ไม่รู้จัก = 400', async ({
    request,
  }) => {
    await apiLoginAs(request, 'advisor1');
    const mine = ids(await rows(request, '?view=supervisor'));
    expect(mine).not.toContain(fx.sOther);
    // เป็นที่ปรึกษาแต่ไม่ได้นิเทศ — ไม่อยู่ในฝ่ายนิเทศ
    expect(mine).not.toContain(fx.sAdv);

    // advisor2 นิเทศ sAdv · sOther — เห็นของตัวเอง ไม่เห็นของ advisor1
    await apiLoginAs(request, 'advisor2');
    expect(ids(await rows(request, '?view=supervisor'))).toEqual(sorted(fx.sAdv, fx.sOther));

    // บทบาทที่ปกติเห็นกว้าง ขอฝ่ายนิเทศทั้งที่ไม่ได้นิเทศใคร = ว่าง
    for (const who of ['head1', 'staff1'] as const) {
      await apiLoginAs(request, who);
      expect(await rows(request, '?view=supervisor'), who).toEqual([]);
    }

    // พิมพ์ view ผิดต้องไม่ตกไปขอบเขตเดิมที่กว้างกว่า
    for (const bad of ['?view=advisor', '?view=all', '?view=supervisor&view=supervisor']) {
      expect((await dashboard(request, bad)).status(), bad).toBe(400);
    }

    // คนนอกยังเข้าไม่ได้
    await apiLoginAs(request, 'student2');
    expect((await dashboard(request, '?view=supervisor')).status()).toBe(403);
  });

  test('S3: ไม่ส่ง view = ขอบเขตเดิม — ที่ปรึกษาเห็นเฉพาะนักศึกษาที่ตัวเองเป็นที่ปรึกษา พร้อมฟิลด์ตรวจรับเล่มครบ · เจ้าหน้าที่เห็นทั้งหมด', async ({
    request,
  }) => {
    await apiLoginAs(request, 'advisor1');
    const asAdvisor = await rows(request);
    expect(ids(asAdvisor)).toEqual([fx.sAdv]);
    expect(asAdvisor[0].sahatkit15Score).toBe(70);
    expect(asAdvisor[0].sahatkit16Score).toBeNull();
    expect(asAdvisor[0].finalReportStatus).toBe('approved');
    expect(asAdvisor[0].finalReportPath).toBe('final_reports/sup-seeded.pdf');
    expect(asAdvisor[0].finalReportId).not.toBeNull();

    // ที่ปรึกษาของ s2 ยังได้สหกิจ 14 ตามเดิม
    await apiLoginAs(request, 'advisor2');
    const s2Row = (await rows(request)).find((r) => r.studentId === fx.s2)!;
    expect(s2Row.reportConfirmation?.status).toBe('pending');
    expect(s2Row.finalReportId).not.toBeNull();

    await apiLoginAs(request, 'staff1');
    const all = ids(await rows(request));
    for (const sid of [fx.s2, fx.sNone, fx.sAdv, fx.sOther]) expect(all).toContain(sid);
  });

  test('S4: นักศึกษายังถูกปฏิเสธผลประเมินก่อนพ้น coop_end ทั้งที่อาจารย์นิเทศเห็นคะแนนแล้ว', async ({ request }) => {
    await dbExec(
      `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date)
       SELECT semester_id, 'coop_end', 'single', d, d
         FROM coop_semesters, (SELECT ((NOW() AT TIME ZONE 'Asia/Bangkok')::date + 10) AS d) x
        WHERE is_active = TRUE
        LIMIT 1
       ON CONFLICT (semester_id, activity_key) WHERE activity_key IS NOT NULL DO UPDATE
          SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`
    );

    await apiLoginAs(request, 'advisor1');
    const seen = (await rows(request, '?view=supervisor')).find((r) => r.studentId === fx.s2)!;
    expect(seen.sahatkit15Score).toBe(87.5);

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/final-evaluations/my-result`);
    expect(res.status(), await res.text()).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text).data.is_open).toBe(false);
    expect(text).not.toContain('87.5');
    expect(text).not.toContain(ITEM_MARKER);
  });

  test('S5: อาจารย์นิเทศเตือนพี่เลี้ยงของนักศึกษาที่ตัวเองนิเทศได้ · พี่เลี้ยงของนักศึกษาคนอื่น = 403 ไม่มีแถวเตือน', async ({
    request,
  }) => {
    await addPendingWeeklyLog(fx.s2);
    await addPendingWeeklyLog(fx.sOther);

    await apiLoginAs(request, 'advisor1');
    const own = await request.post(`${API_URL}/mentor-followup/${fx.mentor1}/remind`);
    expect(own.status(), await own.text()).toBe(200);
    expect(
      await dbRows<{ kind: string; sent_by: number }>('SELECT kind, sent_by FROM mentor_reminders WHERE mentor_id = $1', [
        fx.mentor1,
      ])
    ).toEqual([{ kind: 'summary', sent_by: fx.advisor1 }]);

    const others = await request.post(`${API_URL}/mentor-followup/${fx.mentor2}/remind`);
    expect(others.status(), await others.text()).toBe(403);
    expect(Number(await dbValue<string>('SELECT COUNT(*) FROM mentor_reminders WHERE mentor_id = $1', [fx.mentor2]))).toBe(0);

    // แก้อีเมล · ส่งลิงก์เปล่า ยังเป็นของเจ้าหน้าที่เท่านั้น (SEC-16)
    expect((await request.post(`${API_URL}/mentor-followup/${fx.mentor1}/send-link`)).status()).toBe(403);
    expect(
      (await request.put(`${API_URL}/mentor-followup/${fx.mentor1}/email`, { data: { email: 'moved@example.com' } })).status()
    ).toBe(403);
  });

  test('S6: หน้าจอฝ่ายนิเทศ — มีเมนู "ติดตามพี่เลี้ยง" และเห็นเฉพาะพี่เลี้ยงของนักศึกษาที่ตัวเองนิเทศ', async ({ page }) => {
    test.setTimeout(120_000);
    await addPendingWeeklyLog(fx.s2);
    await addPendingWeeklyLog(fx.sOther);

    await loginAs(page, 'advisor1');
    await page.goto('/dashboard?role=supervisor');
    await expect(page.getByTestId('nav-mentor_followup')).toContainText('ติดตามพี่เลี้ยง');
    await goToMenu(page, 'mentor_followup');

    await expect(page.getByTestId(`mf-row-${fx.mentor1}`)).toBeVisible();
    await expect(page.getByTestId(`mf-row-${fx.mentor2}`)).toHaveCount(0);
    await expect(page.getByTestId(`mf-remind-${fx.mentor1}`)).toBeEnabled();
  });

  // ⏳ รอหน้าจอข้อ ค (คอลัมน์คะแนนในหน้า "นักศึกษาที่ฉันนิเทศ") — หน้าจอเสร็จแล้วเปลี่ยน test.fixme เป็น test
  test.fixme('S7: หน้า "นักศึกษาที่ฉันนิเทศ" มีคอลัมน์สหกิจ 15 · 16 — มีคะแนนขึ้นตัวเลข ยังไม่มีขึ้น "ยังไม่ประเมิน"', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'advisor1');
    await page.goto('/dashboard?role=supervisor');
    await goToMenu(page, 'students');

    await expect(page.getByRole('columnheader', { name: 'สหกิจ 15 (เต็ม 100)' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'สหกิจ 16 (เต็ม 70)' })).toBeVisible();

    await expect(page.getByTestId(`sup-score15-${fx.s2}`)).toHaveText('87.5');
    await expect(page.getByTestId(`sup-score16-${fx.s2}`)).toHaveText('61');
    await expect(page.getByTestId(`sup-score15-${fx.sNone}`)).toHaveText('ยังไม่ประเมิน');
    await expect(page.getByTestId(`sup-score16-${fx.sNone}`)).toHaveText('ยังไม่ประเมิน');

    await expect(page.getByTestId('sup-score-note')).toHaveText('ระบบไม่ตัดเกรด คะแนนนี้ใช้ประกอบการตัดเกรดของท่าน');

    // ฝ่ายที่ปรึกษาไม่มีคอลัมน์นี้ — คะแนนของฝ่ายนั้นอยู่ที่หน้าตรวจรับเล่ม
    await page.goto('/dashboard?role=advisor');
    await goToMenu(page, 'students');
    await expect(page.locator('[data-testid^="sup-score15-"]')).toHaveCount(0);
  });
});
