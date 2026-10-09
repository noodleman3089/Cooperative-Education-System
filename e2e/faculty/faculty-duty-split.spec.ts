import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * SB-F8 · SB-F9 · ฝ่ายที่ปรึกษากับฝ่ายนิเทศ — เจ้าของตัดสิน 2026-09-15
 *
 * ขอบเขตแยก "อาจารย์ที่ปรึกษา" กับ "อาจารย์นิเทศ" เป็นผู้ใช้คนละกลุ่ม ในระบบทั้งสองคือ role `advisor`
 * และหน้าที่ผูกกับนักศึกษาทีละคน (`students.advisor_id` / `supervisor_id`) ที่หัวหน้าสาขาจัดสรร
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **ฝ่ายบนตัวสลับ (`views`) มาจากการจัดสรรจริง** — นิเทศอย่างเดียวไม่มีฝ่ายที่ปรึกษาที่ว่างตลอด
 *   2. **งานเขียนแยกตามแบบฟอร์ม** — สหกิจ 11 · 12 · 13 = นิเทศ · ตรวจรับเล่ม · สหกิจ 14 = ที่ปรึกษา
 *      (สหกิจ 11 ย้ายจากที่ปรึกษาไปนิเทศ 2026-10-09 ตามคู่มือคณะ — ขั้น 7 ข้อ ข1)
 *      ที่ปรึกษายังอ่านสหกิจ 13 ได้ (เป็นข้อมูลของนักศึกษาที่ตัวเองดูแล)
 *   3. **`views` ไม่ใช่ด่าน** — ด่านจริงคือการตรวจต่อหัวนักศึกษาที่เซิร์ฟเวอร์
 *
 * ทุกเคสใช้ advisor1 กับ advisor2 ในสาขาเดียวกับ student2 (seeder วาง advisor2 ไว้คนละสาขา)
 */

let studentId: number;
let advisor1: number;
let advisor2: number;
let companyId: number;

const uid = (email: string) => dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;

async function assign(advisorId: number | null, supervisorId: number | null): Promise<void> {
  await dbExec('UPDATE students SET advisor_id = $1, supervisor_id = $2 WHERE student_id = $3', [advisorId, supervisorId, studentId]);
}

async function viewsOf(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${API_URL}/auth/me`);
  expect(res.status()).toBe(200);
  return (await res.json()).user.views;
}

const draft = (request: APIRequestContext) =>
  request.post(`${API_URL}/appointments/draft`, {
    data: { student_id: studentId, appointment_date: '2026-12-12', student_time: '09:30', mentor_time: '10:30' },
  });

// วันนิเทศห้ามเป็นวันในอนาคต — ใช้ "วันนี้" จาก Postgres เหมือนที่เซิร์ฟเวอร์ตรวจ
const record13 = async (request: APIRequestContext) =>
  request.put(`${API_URL}/supervision-records/student/${studentId}`, {
    data: {
      visit_number: 1,
      visit_date: await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`),
      scores: { c1_1: 4 },
    },
  });

test.describe('SB-F8 · SB-F9 · ฝ่ายที่ปรึกษา / ฝ่ายนิเทศ', () => {
  test.beforeEach(async () => {
    await seedTestData();
    studentId = await uid('student2@test.com');
    advisor1 = await uid('advisor1@test.com');
    advisor2 = await uid('advisor2@test.com');
    companyId = (await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1'))!;
    const semesterId = await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');

    // advisor2 ย้ายมาสาขาเดียวกับ student2 · ไม่มีใครดูแลนักศึกษาคนอื่นอยู่ก่อน
    await dbExec(
      `UPDATE personnel SET major_id = (SELECT major_id FROM students WHERE student_id = $1),
              first_name = 'สมปอง', last_name = 'นิเทศดี' WHERE personnel_id = $2`,
      [studentId, advisor2]
    );
    await dbExec('UPDATE students SET advisor_id = NULL, supervisor_id = NULL WHERE student_id <> $1', [studentId]);
    await dbExec('DELETE FROM supervision_appointments');
    await dbExec('DELETE FROM supervision_records');
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'accepted', '2026-11-02')`,
      [studentId, companyId, semesterId]
    );
  });

  test('D1: views มาจากการจัดสรร — ทั้งสองหน้าที่ · ที่ปรึกษาอย่างเดียว · นิเทศอย่างเดียว · ยังไม่มีหน้าที่', async ({ request }) => {
    await assign(advisor1, advisor1);
    await apiLoginAs(request, 'advisor1');
    expect(await viewsOf(request)).toEqual(['advisor', 'supervisor']);

    await assign(advisor1, advisor2);
    expect(await viewsOf(request)).toEqual(['advisor']);

    // นิเทศอย่างเดียว → ไม่มีฝ่ายที่ปรึกษาที่ว่างตลอด
    await assign(advisor2, advisor1);
    expect(await viewsOf(request)).toEqual(['supervisor']);

    // ยังไม่ได้รับการจัดสรรเลย → ยังต้องมีฝ่ายให้ลง
    await assign(null, null);
    expect(await viewsOf(request)).toEqual(['advisor']);

    // คำตอบของ login ก็ส่ง views มาด้วย (หน้าจอไม่ต้องยิง /auth/me ซ้ำหลังล็อกอิน)
    await assign(advisor2, advisor1);
    const login = await request.post(`${API_URL}/auth/login`, { data: { email: 'advisor1@test.com', password: 'password123' } });
    expect((await login.json()).user.views).toEqual(['supervisor']);

    // บทบาทอื่นได้ views เท่ากับ roles
    await apiLoginAs(request, 'head1');
    expect(await viewsOf(request)).toEqual(['dept_head']);
  });

  test('D2: งานนิเทศ — ที่ปรึกษาที่ไม่ได้นิเทศร่างนัด/บันทึก สหกิจ 13 ไม่ได้ (403) แต่อ่าน 13 ได้ · นิเทศทำได้', async ({ request }) => {
    await assign(advisor1, advisor2);

    await apiLoginAs(request, 'advisor1');
    const deniedDraft = await draft(request);
    expect(deniedDraft.status(), await deniedDraft.text()).toBe(403);
    expect((await deniedDraft.json()).message).toContain('อาจารย์นิเทศ');
    expect((await record13(request)).status()).toBe(403);
    expect(Number(await dbValue('SELECT COUNT(*) FROM supervision_appointments'))).toBe(0);
    expect(Number(await dbValue('SELECT COUNT(*) FROM supervision_records'))).toBe(0);
    // หน้านัดนิเทศของที่ปรึกษาอย่างเดียวว่าง
    const mine = await request.get(`${API_URL}/personnel/supervised-students`);
    expect(mine.status()).toBe(200);
    expect(await mine.json()).toEqual([]);

    await apiLoginAs(request, 'advisor2');
    const okDraft = await draft(request);
    expect(okDraft.status(), await okDraft.text()).toBe(201);
    const okRecord = await record13(request);
    expect(okRecord.status(), await okRecord.text()).toBe(200);
    const supervised = (await (await request.get(`${API_URL}/personnel/supervised-students`)).json()) as Array<{ student_id: number }>;
    expect(supervised.map((s) => s.student_id)).toEqual([studentId]);

    // ที่ปรึกษายังเห็นบันทึกของนักศึกษาที่ตัวเองดูแล
    await apiLoginAs(request, 'advisor1');
    expect((await request.get(`${API_URL}/supervision-records/student/${studentId}`)).status()).toBe(200);
  });

  test('D3: โครงร่าง (สหกิจ 11) เป็นงานนิเทศ — ที่ปรึกษาที่ไม่ได้นิเทศเห็นชอบไม่ได้ (403) · ตรวจรับเล่ม/สหกิจ 14 ยังเป็นงานที่ปรึกษา นิเทศทำไม่ได้ (403)', async ({ request }) => {
    await assign(advisor1, advisor2);

    const outlineId = await dbValue<number>(
      `INSERT INTO report_outlines (student_id, company_id, status) VALUES ($1, $2, 'pending_advisor') RETURNING outline_id`,
      [studentId, companyId]
    );
    const reportId = await dbValue<number>(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/seeded.pdf', 'submitted', 1, 'advisor') RETURNING report_id`,
      [studentId]
    );

    const approveOutline = () => request.put(`${API_URL}/outlines/${outlineId}/status`, { data: { status: 'approved' } });
    const outlineQueue = async () =>
      ((await (await request.get(`${API_URL}/outlines/advisor`)).json()).data as Array<{ outline_id: number }>).map((o) => o.outline_id);

    // ที่ปรึกษา (advisor1) ไม่ได้นิเทศ — โครงร่างไม่ใช่งานของตัวเอง ไม่อยู่ในคิว และเห็นชอบไม่ได้
    await apiLoginAs(request, 'advisor1');
    expect(await outlineQueue()).not.toContain(outlineId);
    const deniedOutline = await approveOutline();
    expect(deniedOutline.status(), await deniedOutline.text()).toBe(403);
    expect((await deniedOutline.json()).message).toContain('อาจารย์นิเทศ');
    expect(await dbValue('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId])).toBe('pending_advisor');

    // นิเทศ (advisor2) — ตรวจรับเล่มไม่ได้ (ยังเป็นงานที่ปรึกษา) แต่เห็นชอบโครงร่างได้
    await apiLoginAs(request, 'advisor2');
    const deniedReport = await request.patch(`${API_URL}/final-reports/${reportId}/status`, { data: { status: 'approved' } });
    expect(deniedReport.status(), await deniedReport.text()).toBe(403);
    expect((await deniedReport.json()).message).toContain('อาจารย์ที่ปรึกษา');
    expect(await dbValue('SELECT status FROM final_reports WHERE report_id = $1', [reportId])).toBe('submitted');
    expect(await outlineQueue()).toContain(outlineId);
    const okOutline = await approveOutline();
    expect(okOutline.status(), await okOutline.text()).toBe(200);
    expect(await dbValue('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId])).toBe('approved');

    await apiLoginAs(request, 'advisor1');
    const approved = await request.patch(`${API_URL}/final-reports/${reportId}/status`, { data: { status: 'approved' } });
    expect(approved.status(), await approved.text()).toBe(200);

    // สหกิจ 14 — นักศึกษายื่นขอผ่านเส้นทางจริงหลังเล่มตรวจรับแล้ว
    await apiLoginAs(request, 'student2');
    const asked = await request.post(`${API_URL}/report-confirmations`);
    expect(asked.status(), await asked.text()).toBe(201);
    const certifyUrl = `${API_URL}/report-confirmations/${(await asked.json()).data.confirmation_id}/certify`;

    await apiLoginAs(request, 'advisor2');
    expect((await request.patch(certifyUrl)).status()).toBe(403);
    await apiLoginAs(request, 'advisor1');
    expect((await request.patch(certifyUrl)).status()).toBe(200);
  });

  test('D4: หน้าแรกฝ่ายนิเทศเห็นเฉพาะนักศึกษาที่ตัวเองนิเทศ · views ไม่ใช่ด่าน', async ({ request }) => {
    await assign(advisor1, advisor2);

    await apiLoginAs(request, 'advisor2');
    expect((await (await request.get(`${API_URL}/faculty/home/advisor?view=supervisor`)).json()).tiles.no_appointment.count).toBe(1);

    // advisor1 ขอหน้าแรกฝ่ายนิเทศเองได้ (เป็นแค่การเลือกหน้าจอ) แต่ไม่มีนักศึกษาในกอง และยังร่างนัดไม่ได้
    await apiLoginAs(request, 'advisor1');
    const home = await request.get(`${API_URL}/faculty/home/advisor?view=supervisor`);
    expect(home.status()).toBe(200);
    expect((await home.json()).tiles.no_appointment.count).toBe(0);
    expect((await draft(request)).status()).toBe(403);
  });
});
