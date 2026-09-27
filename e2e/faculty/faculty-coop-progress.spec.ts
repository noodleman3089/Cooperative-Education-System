import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue, withDb } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * SB-F5 · `GET /coop-progress/dashboard` — ใช้ร่วมอาจารย์ · หัวหน้าสาขา · เจ้าหน้าที่
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. แบบบันทึก สหกิจ 13 นับว่า "ไปนิเทศแล้ว" (เดิมนับแค่บันทึกย่อ)
 *   2. ร่างที่ส่งพี่เลี้ยงกับเล่มฉบับสมบูรณ์เลขฉบับชนกันได้ — ต้องได้แถวเดียว และ `finalReportId` เป็นของเล่มจริง
 *   3. สถานะ สหกิจ 14 (`reportConfirmation`) ขึ้นให้หน้าตรวจรับเล่ม · ไม่มี = `null`
 */

type Row = {
  studentId: number;
  finalReportId: number | null;
  finalReportStatus: string;
  supervisionRecordCount: number;
  progressDetails: { supervisionCompleted: boolean };
  reportConfirmation: null | { confirmationId: number; status: string; requestedAt: string; certifiedAt: string | null };
};

let studentId: number;

async function seedPlacedStudent(): Promise<void> {
  await withDb(async (db) => {
    studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
    const advisorId = (await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")).rows[0].user_id;
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
    await db.query('UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2', [advisorId, studentId]);
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'accepted', '2026-11-02')`,
      [studentId, companyId, semesterId]
    );
  });
}

async function rowsFor(request: APIRequestContext): Promise<Row[]> {
  const res = await request.get(`${API_URL}/coop-progress/dashboard`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()).data as Row[]).filter((r) => r.studentId === studentId);
}

test.describe('SB-F5 · ความคืบหน้าเอกสาร', () => {
  test.beforeEach(async () => {
    await seedTestData();
    await dbExec('DELETE FROM supervision_records');
    await seedPlacedStudent();
  });

  test('P1: มีแค่แบบบันทึก สหกิจ 13 (ไม่มีบันทึกย่อ) → นับว่าไปนิเทศแล้ว', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    let [row] = await rowsFor(request);
    expect(row.supervisionRecordCount).toBe(0);
    expect(row.progressDetails.supervisionCompleted).toBe(false);

    const put = await request.put(`${API_URL}/supervision-records/student/${studentId}`, {
      data: {
        visit_number: 1,
        visit_date: await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`),
        scores: { c1_1: 4 },
      },
    });
    expect(put.status(), await put.text()).toBe(200);

    [row] = await rowsFor(request);
    expect(row.supervisionRecordCount).toBe(1);
    expect(row.progressDetails.supervisionCompleted).toBe(true);
  });

  test('P2: ร่างของพี่เลี้ยงเลขฉบับชนกับเล่มจริง → แถวเดียว และ finalReportId เป็นของเล่มจริง', async ({ request }) => {
    const draftId = await dbValue<number>(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/draft.pdf', 'approved', 1, 'mentor') RETURNING report_id`,
      [studentId]
    );
    const reportId = await dbValue<number>(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/final.pdf', 'submitted', 1, 'advisor') RETURNING report_id`,
      [studentId]
    );
    expect(draftId).not.toBe(reportId);

    await apiLoginAs(request, 'advisor1');
    const rows = await rowsFor(request);
    expect(rows).toHaveLength(1);
    expect(rows[0].finalReportId).toBe(reportId);
    expect(rows[0].finalReportStatus).toBe('submitted');
  });

  test('P3: reportConfirmation เป็น null จนนักศึกษายื่นขอ แล้วขึ้นสถานะจริง · เจ้าหน้าที่ได้คีย์เดียวกัน', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    expect((await rowsFor(request))[0].reportConfirmation).toBeNull();

    const reportId = await dbValue<number>(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/final.pdf', 'approved', 1, 'advisor') RETURNING report_id`,
      [studentId]
    );
    const confirmationId = await dbValue<number>(
      `INSERT INTO report_confirmations (student_id, report_id, status) VALUES ($1, $2, 'pending') RETURNING confirmation_id`,
      [studentId, reportId]
    );

    const [row] = await rowsFor(request);
    expect(row.reportConfirmation?.confirmationId).toBe(confirmationId);
    expect(row.reportConfirmation?.status).toBe('pending');
    expect(row.reportConfirmation?.certifiedAt).toBeNull();

    await apiLoginAs(request, 'staff1');
    const [staffRow] = await rowsFor(request);
    expect(staffRow.reportConfirmation?.status).toBe('pending');
  });
});
