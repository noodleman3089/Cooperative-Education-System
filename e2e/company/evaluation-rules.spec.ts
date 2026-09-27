import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbValue } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * กติกาของแบบประเมิน สหกิจ 15 / 16
 *
 * ทั้งสองใบเป็นของ **พนักงานที่ปรึกษา (พี่เลี้ยง)** ตามที่แบบฟอร์มจริงระบุ
 * — เดิมระบบมี rubric 10 ข้อที่คิดขึ้นเองใบเดียวและเอาการประเมินรายงานไปให้อาจารย์ทำ
 *
 * ชุดนี้คุมสองเรื่องที่พังเงียบได้:
 *   1. **เพดานคะแนนรายข้อ** — เดิม `MAX_ITEM_SCORE = 100` ทำให้ทุกข้อยิงได้ถึง 100
 *      ทั้งที่ฟอร์มจริงเพดานข้อละ 5 หรือ 10 และคีย์แปลกปลอมก็ถูกบวกเข้า total ด้วย
 *   2. **สองใบต้องอยู่ร่วมกันได้** — เดิม `UNIQUE (student_id, evaluator_role)`
 *      ทำให้ใบที่สองไป ON CONFLICT ทับใบแรกทิ้ง
 */

/** payload สหกิจ 15 ที่ถูกต้องครบ 18 ข้อ เต็ม 100 */
const validSahatkit15 = () => ({
  work_quantity: 10,
  work_quality: 10,
  academic_ability: 5,
  learn_and_apply: 5,
  practical_ability: 5,
  judgment_decision: 5,
  organization_planning: 5,
  communication_skills: 5,
  foreign_language_culture: 5,
  job_suitability: 5,
  responsibility_dependability: 5,
  interest_in_work: 5,
  initiative_self_starter: 5,
  response_to_supervision: 5,
  personality: 5,
  interpersonal_skills: 5,
  discipline_adaptability: 5,
  ethics_morality: 5,
  strength: 'เรียนรู้เร็ว',
  improvement: 'ควรกล้าถามมากขึ้น',
  other_comments: 'โดยรวมดีมาก',
  would_hire: 'accept',
});

/** payload สหกิจ 16 ที่ถูกต้องครบ 14 ข้อ เต็ม 70 */
const validSahatkit16 = () => ({
  topic_selection: 5,
  chapter1: 5,
  chapter2: 5,
  chapter3: 5,
  chapter4: 5,
  content_overall: 5,
  language_use: 5,
  table_of_contents: 5,
  bibliography_citation: 5,
  completeness: 5,
  format_correctness: 5,
  time_appropriateness: 5,
  illustrations: 5,
  overall_report: 5,
  report_title_th: 'ระบบบริหารคลังสินค้า',
  report_title_en: 'Warehouse Management System',
  other_comments: 'รูปเล่มเรียบร้อย',
});

/** ผูกพี่เลี้ยง (บัญชี company1) เข้ากับนักศึกษาผ่านใบความจำนงที่ตอบรับแล้ว */
const linkMentorToStudent = async (): Promise<number> =>
  withDb(async (db) => {
    const studentId = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id;
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
         ON CONFLICT (mentor_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING mentor_id`,
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
      [studentId, company.company_id, semesterId, jobId, mentorId]
    );

    return studentId as number;
  });

const submit = (
  request: APIRequestContext,
  studentId: number,
  formCode: string,
  scoresDetail: Record<string, unknown>
) => request.post(`${API_URL}/final-evaluations`, { data: { studentId, formCode, scoresDetail } });

test.describe('กติกาแบบประเมิน สหกิจ 15 / 16', () => {
  test('E1: พี่เลี้ยงส่งได้ทั้งสองใบ และสองแถวอยู่ร่วมกัน (upsert ไม่งอกและไม่ทับกัน)', async ({
    request,
  }) => {
    await seedTestData();
    const studentId = await linkMentorToStudent();
    await apiLoginAs(request, 'company1');

    const res15 = await submit(request, studentId, 'sahatkit_15', validSahatkit15());
    expect(res15.status(), await res15.text()).toBe(200);
    expect((await res15.json()).data.total_score).toBe(100);

    const res16 = await submit(request, studentId, 'sahatkit_16', validSahatkit16());
    expect(res16.status(), await res16.text()).toBe(200);
    expect((await res16.json()).data.total_score).toBe(70);

    // ใบที่สองต้องไม่ทับใบแรก — นี่คือบั๊กที่ UNIQUE (student_id, evaluator_role) สร้างไว้
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM final_evaluations WHERE student_id = $1', [
        studentId,
      ])
    ).toBe('2');

    // ส่งใบเดิมซ้ำต้องเป็นการทับ ไม่ใช่การเพิ่มแถว
    const again = await submit(request, studentId, 'sahatkit_15', {
      ...validSahatkit15(),
      work_quantity: 8,
    });
    expect(again.status()).toBe(200);
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM final_evaluations WHERE student_id = $1', [
        studentId,
      ])
    ).toBe('2');
    expect(
      await dbValue<string>(
        `SELECT total_score FROM final_evaluations WHERE student_id = $1 AND form_code = 'sahatkit_15'`,
        [studentId]
      )
    ).toBe('98.00');
  });

  test('E2: คะแนนเกินเพดานรายข้อถูกปฏิเสธ (เดิมทุกข้อยิงได้ถึง 100)', async ({ request }) => {
    await seedTestData();
    const studentId = await linkMentorToStudent();
    await apiLoginAs(request, 'company1');

    // ข้อ 2.1 เพดาน 5 ตามแบบฟอร์มจริง
    const over = await submit(request, studentId, 'sahatkit_15', {
      ...validSahatkit15(),
      academic_ability: 6,
    });
    expect(over.status()).toBe(400);
    expect((await over.json()).message).toContain('academic_ability');

    // ข้อ 1.1 เพดาน 10 — 10 ต้องผ่าน แต่ 11 ต้องไม่ผ่าน
    const tooHigh = await submit(request, studentId, 'sahatkit_15', {
      ...validSahatkit15(),
      work_quantity: 11,
    });
    expect(tooHigh.status()).toBe(400);
  });

  test('E3: คีย์แปลกปลอม ข้อไม่ครบ และคำถามที่บังคับตอบ ถูกปฏิเสธทั้งหมด', async ({ request }) => {
    await seedTestData();
    const studentId = await linkMentorToStudent();
    await apiLoginAs(request, 'company1');

    const alien = await submit(request, studentId, 'sahatkit_15', {
      ...validSahatkit15(),
      hacked: 999,
    });
    expect(alien.status()).toBe(400);
    expect((await alien.json()).message).toContain('hacked');

    const incomplete = validSahatkit15() as Record<string, unknown>;
    delete incomplete.ethics_morality;
    const missing = await submit(request, studentId, 'sahatkit_15', incomplete);
    expect(missing.status()).toBe(400);
    expect((await missing.json()).message).toContain('ethics_morality');

    const noHire = validSahatkit15() as Record<string, unknown>;
    delete noHire.would_hire;
    expect((await submit(request, studentId, 'sahatkit_15', noHire)).status()).toBe(400);

    expect((await submit(request, studentId, 'sahatkit_99', validSahatkit15())).status()).toBe(400);
  });

  test('E4: อาจารย์ประเมินไม่ได้อีกแล้ว และพี่เลี้ยงข้ามนักศึกษาไม่ได้', async ({ request }) => {
    await seedTestData();
    const studentId = await linkMentorToStudent();

    // ไม่มีแบบฟอร์มไหนในชุด 01-16 ที่อาจารย์เป็นผู้ประเมินผลหรือประเมินรายงาน
    await apiLoginAs(request, 'advisor1');
    expect((await submit(request, studentId, 'sahatkit_15', validSahatkit15())).status()).toBe(403);

    // นักศึกษาที่พี่เลี้ยงไม่ได้ดูแล (student1 ไม่มีใบความจำนงที่ผูกกับพี่เลี้ยงคนนี้)
    await apiLoginAs(request, 'company1');
    const otherStudentId = await dbValue<number>(
      "SELECT user_id FROM users WHERE email = 'student1@test.com'"
    );
    expect(
      (await submit(request, otherStudentId as number, 'sahatkit_15', validSahatkit15())).status()
    ).toBe(403);
  });

  // เคส "นักศึกษาเปิด PDF ของตัวเองไม่ได้" ถูกยกไปเขียนใหม่ที่
  // `student-evaluation-result.spec.ts` ตอนโละแม่แบบ HTML (2026-08-26)
  // — ทางออก PDF ไม่มีแล้ว และกติกาความลับเปลี่ยนจาก "ห้ามนักศึกษาเห็นตลอดไป"
  // เป็น "เห็นได้หลังสิ้นสุดช่วงปฏิบัติงาน" ซึ่งสเปกนั้นคุมครบทั้ง 6 เคส
});
