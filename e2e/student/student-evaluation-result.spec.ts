import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbExec, dbValue } from '../helpers/db';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * นักศึกษาดูผลประเมิน สหกิจ 15/16 ของตัวเอง
 *
 * แทนที่การ export PDF ที่ถูกโละไปพร้อมแม่แบบ HTML ทั้งชุด (2026-08-26)
 *
 * สองเรื่องที่ต้องคุมไม่ให้พังเงียบ และมันตรงข้ามกับ `coop-calendar.spec.ts`:
 *   1. **fail-closed** — ยังไม่ตั้งปฏิทิน หรือยังอยู่ในช่วงปฏิบัติงาน = ยังไม่เปิดเผย
 *      เพราะเดาผิดคือนักศึกษาเห็นคะแนนลับขณะยังนั่งทำงานอยู่กับพี่เลี้ยง
 *   2. **ของตัวเองเท่านั้น** — endpoint ไม่รับ :studentId เลย ต้องไม่มีทางขอของคนอื่น
 */

/** วันนี้ตามเวลาไทย คิดที่ฐาน ให้ใช้เกณฑ์เดียวกับเซิร์ฟเวอร์เป๊ะ */
const today = () =>
  dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`) as Promise<string>;

const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * ตั้ง "วันสิ้นสุดการปฏิบัติงาน" ลงฐานตรงๆ — คุมวันได้แน่นอนกว่าคลิกผ่านหน้าจอเจ้าหน้าที่
 *
 * ด่านที่กันไม่ให้นักศึกษาเห็นผลประเมินก่อนเวลาอ่านจากกิจกรรม `coop_end`
 * (แถว 9 บนปฏิทินคณะ) ตั้งแต่ 2026-09-04 — ก่อนหน้านั้นยืมช่วง `weekly_log` มาใช้แทน
 * เพราะยังไม่มีคีย์ของวันสิ้นสุดจริงๆ
 *
 * `coop_end` เป็นชนิด `single` จึงเก็บ start = end วันเดียวกัน
 */
const setCoopEnd = (endDate: string) =>
  dbExec(
    `INSERT INTO coop_calendar_events
       (semester_id, activity_key, date_kind, start_date, end_date, created_by)
     SELECT s.semester_id, 'coop_end', 'single', $1, $1, u.user_id
       FROM coop_semesters s CROSS JOIN users u
      WHERE s.is_active = TRUE AND u.email = 'staff1@test.com'
      LIMIT 1
     ON CONFLICT (semester_id, activity_key) WHERE activity_key IS NOT NULL DO UPDATE
        SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
    [endDate]
  );

/** คะแนนเต็มทุกข้อของ สหกิจ 15 พร้อมฟิลด์ข้อความที่ฟอร์มบังคับ */
const scores15 = (): Record<string, number | string> => {
  const s: Record<string, number | string> = {
    work_quantity: 10,
    work_quality: 10,
    strength: 'เรียนรู้เร็ว ทำงานเป็นทีมได้ดี',
    improvement: 'ควรกล้าถามมากขึ้น',
    other_comments: 'ฝากถึงนักศึกษาว่าทำได้ดีมาก',
    would_hire: 'accept',
  };
  for (const key of [
    'academic_ability', 'learn_and_apply', 'practical_ability', 'judgment_decision',
    'organization_planning', 'communication_skills', 'foreign_language_culture', 'job_suitability',
    'responsibility_dependability', 'interest_in_work', 'initiative_self_starter',
    'response_to_supervision', 'personality', 'interpersonal_skills',
    'discipline_adaptability', 'ethics_morality',
  ]) {
    s[key] = 5;
  }
  return s;
};

const scores16 = (): Record<string, number | string> => {
  const s: Record<string, number | string> = {
    report_title_th: 'ระบบบริหารคลังสินค้า',
    report_title_en: 'Warehouse Management System',
    other_comments: 'รูปเล่มเรียบร้อย',
  };
  for (const key of [
    'topic_selection', 'chapter1', 'chapter2', 'chapter3', 'chapter4', 'content_overall',
    'language_use', 'table_of_contents', 'bibliography_citation', 'completeness',
    'format_correctness', 'time_appropriateness', 'illustrations', 'overall_report',
  ]) {
    s[key] = 5;
  }
  return s;
};

/**
 * ผูกพี่เลี้ยงกับ student2 แล้วให้พี่เลี้ยงส่งประเมินครบทั้งสองใบ
 * คืน student_id ที่ถูกประเมิน
 */
async function seedSubmittedEvaluations(
  request: Parameters<typeof apiLoginAs>[0]
): Promise<number> {
  const studentId = await withDb(async (db) => {
    const sid = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'"))
      .rows[0].user_id;
    const company = (await db.query('SELECT company_id, created_by FROM companies LIMIT 1')).rows[0];
    const jobId = (
      await db.query('SELECT job_id FROM job_posts WHERE company_id = $1 LIMIT 1', [
        company.company_id,
      ])
    ).rows[0].job_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const mentorId = (
      await db.query(
        `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
         VALUES ($1, $2, 'สมศักดิ์ รักเรียน', 'Lead Engineer', 'ฝ่ายพัฒนาซอฟต์แวร์', '0819998888')
         ON CONFLICT (mentor_id) DO UPDATE SET name = EXCLUDED.name RETURNING mentor_id`,
        [company.created_by, company.company_id]
      )
    ).rows[0].mentor_id;
    await db.query(
      `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'mentor') ON CONFLICT DO NOTHING`,
      [mentorId]
    );
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, mentor_id, start_date)
       VALUES ($1, $2, $3, $4, 'accepted', $5, NOW())`,
      [sid, company.company_id, semesterId, jobId, mentorId]
    );
    return sid as number;
  });

  await apiLoginAs(request, 'company1');
  for (const [formCode, scoresDetail] of [
    ['sahatkit_15', scores15()],
    ['sahatkit_16', scores16()],
  ] as const) {
    const saved = await request.post(`${API_URL}/final-evaluations`, {
      data: { studentId, formCode, scoresDetail },
    });
    expect(saved.status(), await saved.text()).toBe(200);
  }

  return studentId;
}

test.describe('ผลประเมินฝั่งนักศึกษา (สหกิจ 15/16)', () => {
  test('E1: พ้นช่วงปฏิบัติงานแล้ว — นักศึกษาเห็นคะแนนทั้งสองใบของตัวเอง', async ({ request }) => {
    test.setTimeout(180_000);
    await seedTestData();
    await seedSubmittedEvaluations(request);

    const now = await today();
    await setCoopEnd(shift(now, -1));

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/final-evaluations/my-result`);
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json();
    expect(body.data.sahatkit_15.total_score).toBe(100);
    expect(body.data.sahatkit_15.max_total).toBe(100);
    expect(body.data.sahatkit_16.total_score).toBe(70);
    expect(body.data.sahatkit_16.max_total).toBe(70);
    // ข้อความที่พี่เลี้ยงเขียนถึงนักศึกษาต้องส่งมาด้วย ไม่ใช่แค่ตัวเลข
    expect(body.data.sahatkit_15.scores_detail.strength).toContain('เรียนรู้เร็ว');
  });

  test('E2: ยังอยู่ในช่วงปฏิบัติงาน — 403 พร้อมบอกวันที่จะเปิดให้ดู', async ({ request }) => {
    test.setTimeout(180_000);
    await seedTestData();
    await seedSubmittedEvaluations(request);

    const now = await today();
    const endDate = shift(now, 20);
    await setCoopEnd(endDate);

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/final-evaluations/my-result`);
    expect(res.status()).toBe(403);

    const message = (await res.json()).message as string;
    expect(message).toContain('หลังสิ้นสุดช่วงปฏิบัติงาน');
    // ต้องบอกวันจริง ไม่ใช่ปฏิเสธลอยๆ — วันที่และปี พ.ศ. ของ end_date ต้องอยู่ในข้อความ
    // (รูปแบบเดือนเป็นแบบย่อตาม `utils/thaiDate.ts` จึงเทียบเฉพาะวันกับปี)
    const [year, , day] = endDate.split('-').map(Number);
    expect(message).toContain(`หลังวันที่ ${day} `);
    expect(message).toContain(String(year + 543));
  });

  test('E3: เจ้าหน้าที่ยังไม่ได้ตั้งปฏิทิน — ยังไม่เปิดเผย (fail-closed)', async ({ request }) => {
    test.setTimeout(180_000);
    await seedTestData();
    await seedSubmittedEvaluations(request);
    // จงใจไม่ตั้ง window ใดๆ

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/final-evaluations/my-result`);
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toContain('ยังไม่ได้ตั้ง "วันสิ้นสุดการปฏิบัติงาน"');
  });

  test('E4: บัญชีที่ยังไม่มีประวัตินักศึกษา — 403 ไม่ใช่ผลว่างเปล่า', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();

    const now = await today();
    await setCoopEnd(shift(now, -1));

    // student1 ไม่มีแถวใน `students` (db:setup สร้างประวัติให้ student2 เท่านั้น)
    await apiLoginAs(request, 'student1');
    const res = await request.get(`${API_URL}/final-evaluations/my-result`);
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toContain('ประวัตินักศึกษา');
  });

  test('E5: บทบาทอื่นเรียก my-result ไม่ได้ และ route PDF เดิมต้องไม่มีอยู่แล้ว', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const studentId = await seedSubmittedEvaluations(request);

    // พี่เลี้ยงยังล็อกอินอยู่จาก seedSubmittedEvaluations — my-result เป็นของนักศึกษาเท่านั้น
    const asMentor = await request.get(`${API_URL}/final-evaluations/my-result`);
    expect(asMentor.status()).toBe(403);

    // ทางออก PDF ถูกถอดทั้งเส้น ไม่ใช่แค่ซ่อนปุ่ม
    for (const formCode of ['sahatkit_15', 'sahatkit_16']) {
      const pdf = await request.get(`${API_URL}/final-evaluations/pdf/${formCode}/${studentId}`);
      expect(pdf.status(), `route PDF ${formCode} ยังตอบอยู่`).toBe(404);
    }
  });

  test('E6: หน้าจอนักศึกษา — ล็อกอยู่บอกเหตุผล พ้นช่วงแล้วเห็นคะแนน', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await seedTestData();
    await seedSubmittedEvaluations(request);

    const now = await today();
    await setCoopEnd(shift(now, 20));

    await loginAs(page, 'student2');
    await goToMenu(page, 'evaluation_result');
    await expect(page.getByRole('heading', { name: 'ยังไม่เปิดให้ดูผลประเมิน' })).toBeVisible();
    await expect(page.getByTestId('eval-locked-reason')).toContainText('หลังสิ้นสุดช่วงปฏิบัติงาน');

    // เลื่อนปฏิทินให้ช่วงจบไปแล้ว → หน้าเดิมต้องแสดงคะแนนจริง
    await setCoopEnd(shift(now, -1));
    await page.reload();
    await goToMenu(page, 'evaluation_result');

    // หน้ารีเมคแยกเป็นการ์ดสรุป (คะแนนรวม) กับบล็อกข้อความของพี่เลี้ยง — testid เปลี่ยนตาม
    await expect(page.getByTestId('eval-total-15')).toContainText('100');
    await expect(page.getByTestId('eval-total-16')).toContainText('70');
    await expect(page.getByTestId('eval-strength')).toContainText('เรียนรู้เร็ว');
  });
});
