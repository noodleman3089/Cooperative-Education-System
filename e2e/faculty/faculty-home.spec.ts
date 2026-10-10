import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * SB-F1 · SB-G1 · หน้าแรกของอาจารย์และหัวหน้าสาขา — spec-F ข้อ 3/15.2 · spec-G ข้อ 3/15.2
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **ตัวนับแต่ละกองตรงกับข้อมูลที่วางไว้** — นิยามกองอยู่ที่เซิร์ฟเวอร์ที่เดียว หน้าจอห้ามนับเอง
 *      ถ้าเทสต์นี้แดงหลังแก้ query แปลว่าความหมายของกองเปลี่ยน ไม่ใช่เทสต์ผิด
 *   2. **สิทธิ์ fail closed** — ไม่มีสาขาในโปรไฟล์ = 403 · บทบาทอื่นเรียกไม่ได้
 *   3. **ขอบเขตสาขา** — ตัวนับของหัวหน้าสาขาไม่รวมนักศึกษาสาขาอื่น
 */

const uid = (email: string) => dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;

async function companyAndSemester(): Promise<{ companyId: number; semesterId: number }> {
  return {
    companyId: (await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1'))!,
    semesterId: (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'))!,
  };
}

/**
 * SB-F8 — หน้าแรกแยกฝ่าย: ที่ปรึกษาได้ report/confirmation · นิเทศได้ outline/reschedule/unrecorded_visit/no_appointment
 * (กอง outline ย้ายไปฝ่ายนิเทศ 2026-10-09 — สหกิจ 11 เป็นงานของอาจารย์นิเทศ · ⛔ ห้ามส่งให้ทั้งสองฝ่าย)
 */
async function advisorHome(request: APIRequestContext, view: 'advisor' | 'supervisor') {
  const res = await request.get(`${API_URL}/faculty/home/advisor?view=${view}`);
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

async function deptHome(request: APIRequestContext) {
  const res = await request.get(`${API_URL}/faculty/home/dept-head`);
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

test.describe('SB-F1 · หน้าแรกอาจารย์', () => {
  let advisor: number;
  let s1: number;
  let s2: number;

  test.beforeEach(async () => {
    await seedTestData();
    advisor = await uid('advisor1@test.com');
    s1 = await uid('student1@test.com');
    s2 = await uid('student2@test.com');
    const { companyId, semesterId } = await companyAndSemester();

    // เริ่มจากศูนย์ทุกกอง: ไม่มีนักศึกษาคนไหนอยู่ในความดูแลของ advisor1 ยกเว้นที่วางไว้ข้างล่าง
    await dbExec('UPDATE students SET advisor_id = NULL WHERE advisor_id = $1', [advisor]);
    await dbExec('UPDATE students SET supervisor_id = NULL WHERE supervisor_id = $1', [advisor]);
    await dbExec('DELETE FROM supervision_appointments');
    await dbExec('DELETE FROM supervision_records');
    await dbExec('DELETE FROM report_confirmations WHERE student_id IN ($1, $2)', [s1, s2]);
    await dbExec('DELETE FROM final_reports WHERE student_id IN ($1, $2)', [s1, s2]);
    await dbExec('DELETE FROM report_outlines WHERE student_id IN ($1, $2)', [s1, s2]);
    await dbExec('DELETE FROM intent_forms WHERE student_id IN ($1, $2)', [s1, s2]);

    // student2 — ที่ปรึกษา & นิเทศ · ได้ที่ฝึกแล้ว
    await dbExec('UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2', [advisor, s2]);
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'accepted', '2026-11-02')`,
      [s2, companyId, semesterId]
    );
  });

  test('H1: ทุกกองเป็นศูนย์พร้อม note · แต่ละฝ่ายได้กองของตัวเองครบ ไม่ปนกัน · ไม่ระบุฝ่าย 400', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    await dbExec('INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status) SELECT $1, $2, company_id, CURRENT_DATE + 30, \'09:00\', \'10:00\', \'draft\' FROM intent_forms WHERE student_id = $2', [advisor, s2]);
    const tilesOf = {
      advisor: ['report', 'confirmation'],
      supervisor: ['mentor_confirm', 'outline', 'reschedule', 'unrecorded_visit', 'no_appointment'],
    } as const;
    for (const view of ['advisor', 'supervisor'] as const) {
      const home = await advisorHome(request, view);
      expect(home.view).toBe(view);
      expect(Object.keys(home.tiles).sort(), view).toEqual([...tilesOf[view]].sort());
      for (const kind of tilesOf[view]) {
        expect(home.tiles[kind].count, kind).toBe(0);
        expect(home.tiles[kind].note, kind).toBeTruthy();
        expect(home.tiles[kind].items, kind).toEqual([]);
      }
      expect(home.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // แถบเอกสารหมายเลข 1 เป็นเรื่องของที่ปรึกษา (ลงนามบนกระดาษ) — ฝ่ายนิเทศไม่ได้
    expect(typeof (await advisorHome(request, 'advisor')).paper_pending_major).toBe('number');
    expect((await advisorHome(request, 'supervisor')).paper_pending_major).toBeUndefined();

    for (const bad of ['', '?view=dept_head']) {
      expect((await request.get(`${API_URL}/faculty/home/advisor${bad}`)).status(), bad).toBe(400);
    }
  });

  test('H2: ตัวนับห้ากองงานตรงกับข้อมูลที่วางไว้ · บันทึก สหกิจ 13 แล้วกองค้างบันทึกหายไป', async ({ request }) => {
    const { companyId } = await companyAndSemester();

    // สหกิจ 11 รออาจารย์มา 2 วัน
    const outlineId = await dbValue<number>(
      `INSERT INTO report_outlines (student_id, company_id, status, updated_at)
       VALUES ($1, $2, 'pending_advisor', CURRENT_TIMESTAMP - INTERVAL '2 days') RETURNING outline_id`,
      [s2, companyId]
    );
    await dbExec(
      `INSERT INTO report_outline_versions (outline_id, file_path, report_title, status) VALUES ($1, 'o.pdf', 'หัวข้อทดสอบ', 'submitted')`,
      [outlineId]
    );
    // สหกิจ 12 ครั้งที่ 1 ตกลงแล้ว วันนัดผ่านไปแล้ว ยังไม่บันทึก · ครั้งที่ 2 พี่เลี้ยงขอเลื่อน
    await dbExec(
      `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status, created_at)
       VALUES ($1, $2, $3, (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 1, '09:00', '10:00', 'offline_agreed', NOW() - INTERVAL '20 days'),
              ($1, $2, $3, (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 20, '09:00', '10:00', 'rescheduled', NOW() - INTERVAL '1 day')`,
      [advisor, s2, companyId]
    );
    // เล่มฉบับสมบูรณ์รอตรวจรับ + ร่างของพี่เลี้ยง (ต้องไม่ถูกนับ)
    const reportId = await dbValue<number>(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'f.pdf', 'submitted', 1, 'advisor') RETURNING report_id`,
      [s2]
    );
    await dbExec(`INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind) VALUES ($1, 'd.pdf', 'submitted', 2, 'mentor')`, [s2]);
    await dbExec(`INSERT INTO report_confirmations (student_id, report_id, status) VALUES ($1, $2, 'pending')`, [s2, reportId]);

    await apiLoginAs(request, 'advisor1');
    const adv = await advisorHome(request, 'advisor');
    const sup = await advisorHome(request, 'supervisor');

    expect(sup.tiles.outline.count).toBe(1);
    expect(sup.tiles.outline.items[0]).toMatchObject({ ref_id: outlineId, student_id: s2, detail: 'หัวข้อทดสอบ', days: 2 });
    expect(adv.tiles.outline).toBeUndefined();
    expect(sup.tiles.reschedule.count).toBe(1);
    expect(sup.tiles.reschedule.items[0].visit_number).toBe(2);
    expect(sup.tiles.unrecorded_visit.count).toBe(1);
    expect(sup.tiles.unrecorded_visit.items[0]).toMatchObject({ visit_number: 1, days: 1 });
    expect(adv.tiles.report.count).toBe(1);
    expect(adv.tiles.report.items[0].ref_id).toBe(reportId);
    expect(adv.tiles.confirmation.count).toBe(1);
    expect(sup.tiles.no_appointment.count).toBe(0);

    const put = await request.put(`${API_URL}/supervision-records/student/${s2}`, {
      data: { visit_number: 1, visit_date: await dbValue<string>(`SELECT ((NOW() AT TIME ZONE 'Asia/Bangkok')::date - 1)::text`), scores: { c1_1: 4 } },
    });
    expect(put.status(), await put.text()).toBe(200);
    expect((await advisorHome(request, 'supervisor')).tiles.unrecorded_visit.count).toBe(0);
  });

  test('H3: กอง no_appointment นับเฉพาะคนที่ฉันนิเทศและได้ที่ฝึกแล้ว · ที่ปรึกษาอย่างเดียวไม่นับ · แถบกระดาษนับ pending_advisor ในสาขา', async ({ request }) => {
    // advisor1 เป็นผู้นิเทศอย่างเดียว ไม่ใช่ที่ปรึกษา — ต้องถูกนับว่าต้องนัดนิเทศ
    await dbExec('UPDATE students SET advisor_id = NULL WHERE student_id = $1', [s2]);
    await apiLoginAs(request, 'advisor1');
    const before = await advisorHome(request, 'supervisor');
    const paperBefore = (await advisorHome(request, 'advisor')).paper_pending_major;
    expect(before.tiles.no_appointment.count).toBe(1);

    await dbExec("UPDATE intent_forms SET status = 'pending_advisor' WHERE student_id = $1", [s2]);
    expect((await advisorHome(request, 'supervisor')).tiles.no_appointment.count).toBe(0);
    expect((await advisorHome(request, 'advisor')).paper_pending_major).toBe(paperBefore + 1);

    await dbExec("UPDATE intent_forms SET status = 'accepted' WHERE student_id = $1", [s2]);
    await dbExec(
      `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status)
       SELECT $1, $2, company_id, CURRENT_DATE + 30, '09:00', '10:00', 'draft' FROM intent_forms WHERE student_id = $2`,
      [advisor, s2]
    );
    expect((await advisorHome(request, 'supervisor')).tiles.no_appointment.count).toBe(0);
    expect((await advisorHome(request, 'advisor')).paper_pending_major).toBe(paperBefore);

    // สลับหน้าที่: ที่ปรึกษาอย่างเดียว → นักศึกษาที่ยังไม่มีนัดไม่ใช่งานของฉัน
    await dbExec('DELETE FROM supervision_appointments WHERE student_id = $1', [s2]);
    await dbExec('UPDATE students SET advisor_id = $1, supervisor_id = NULL WHERE student_id = $2', [advisor, s2]);
    expect((await advisorHome(request, 'supervisor')).tiles.no_appointment.count).toBe(0);
  });

  test('H4: fail closed — ไม่มีสาขาในโปรไฟล์ 403 · บทบาทอื่น 403 · ไม่ล็อกอิน 401', async ({ request }) => {
    expect((await request.get(`${API_URL}/faculty/home/advisor?view=advisor`)).status()).toBe(401);

    for (const who of ['student2', 'staff1', 'mentor1'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(`${API_URL}/faculty/home/advisor?view=advisor`)).status(), who).toBe(403);
    }

    await dbExec('DELETE FROM personnel WHERE personnel_id = $1', [advisor]);
    await apiLoginAs(request, 'advisor1');
    const res = await request.get(`${API_URL}/faculty/home/advisor?view=supervisor`);
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toBeTruthy();
  });
});

test.describe('SB-G1 · หน้าแรกหัวหน้าสาขา', () => {
  let major: number;
  let s2: number;

  test.beforeEach(async () => {
    await seedTestData();
    const head = await uid('head1@test.com');
    major = (await dbValue<number>('SELECT major_id FROM personnel WHERE personnel_id = $1', [head]))!;
    s2 = await uid('student2@test.com');
    const advisor = await uid('advisor1@test.com');

    // student2 อยู่สาขาของหัวหน้าสาขา · ทุกคนในสาขามีอาจารย์ครบ ยกเว้น student2 ไม่มีที่ปรึกษา
    await dbExec('UPDATE students SET major_id = $1 WHERE student_id = $2', [major, s2]);
    await dbExec('UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE major_id = $2', [advisor, major]);
    await dbExec('UPDATE students SET advisor_id = NULL WHERE student_id = $1', [s2]);
    await dbExec('DELETE FROM final_evaluations WHERE student_id IN (SELECT student_id FROM students WHERE major_id = $1)', [major]);
    await dbExec('DELETE FROM intent_forms WHERE student_id IN (SELECT student_id FROM students WHERE major_id = $1)', [major]);
  });

  test('G1: จัดสรร · เส้นทางคำร้อง · ใบประเมิน นับตรงกับข้อมูล', async ({ request }) => {
    const { companyId, semesterId } = await companyAndSemester();
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'pending_officer_request', '2026-11-02')`,
      [s2, companyId, semesterId]
    );

    await apiLoginAs(request, 'head1');
    const total = (await dbValue<number>('SELECT COUNT(*)::int FROM students WHERE major_id = $1', [major]))!;
    let home = await deptHome(request);

    expect(home.major.major_id).toBe(major);
    expect(home.students_total).toBe(total);
    expect(home.unassigned).toMatchObject({ students_affected: 1, missing_advisor: 1, missing_supervisor: 0 });
    expect(home.unassigned.items[0]).toMatchObject({ student_id: s2, missing: ['advisor'] });
    expect(home.pipeline).toMatchObject({ paper: 0, staff: 1, dean: 0, company: 0, accepted: 0, not_submitted: total - 1 });
    expect(home.evaluation).toEqual({ placed: 0, missing_15: 0, missing_16: 0, both_done: 0 });

    await dbExec("UPDATE intent_forms SET status = 'accepted' WHERE student_id = $1", [s2]);
    await dbExec(
      `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
       VALUES ($1, 'mentor', 'sahatkit_15', '{}', 80)`,
      [s2]
    );
    home = await deptHome(request);
    expect(home.pipeline).toMatchObject({ staff: 0, accepted: 1 });
    expect(home.evaluation).toEqual({ placed: 1, missing_15: 0, missing_16: 1, both_done: 0 });
  });

  test('G2: หนังสือขอความอนุเคราะห์ยังไม่ลงนาม = ค้างที่คณบดี · ลงนามแล้ว = รอบริษัทตอบ', async ({ request }) => {
    const { companyId, semesterId } = await companyAndSemester();
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date, officer_document_no)
       VALUES ($1, $2, $3, 'approved_by_dept_head', '2026-11-02', 'TEST/1')`,
      [s2, companyId, semesterId]
    );
    await dbExec(
      `INSERT INTO official_documents (document_number, type, student_id, company_id, status)
       VALUES ('TEST/1', 'cover_letter', $1, $2, 'pending_sign')`,
      [s2, companyId]
    );
    await apiLoginAs(request, 'head1');
    expect((await deptHome(request)).pipeline).toMatchObject({ dean: 1, company: 0 });

    await dbExec("UPDATE official_documents SET status = 'signed' WHERE document_number = 'TEST/1'");
    expect((await deptHome(request)).pipeline).toMatchObject({ dean: 0, company: 1 });
  });

  test('G3: นักศึกษาสาขาอื่นไม่ถูกนับ · บทบาทอื่น 403 · ไม่มีสาขา 403', async ({ request }) => {
    const { companyId, semesterId } = await companyAndSemester();
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date) VALUES ($1, $2, $3, 'accepted', '2026-11-02')`,
      [s2, companyId, semesterId]
    );
    await apiLoginAs(request, 'head1');
    const before = await deptHome(request);
    expect(before.pipeline.accepted).toBe(1);

    const otherMajor = await dbValue<number>('SELECT major_id FROM master_major WHERE major_id <> $1 LIMIT 1', [major]);
    await dbExec('UPDATE students SET major_id = $1 WHERE student_id = $2', [otherMajor, s2]);
    const after = await deptHome(request);
    expect(after.students_total).toBe(before.students_total - 1);
    expect(after.pipeline.accepted).toBe(0);
    expect(after.unassigned.items.map((i: { student_id: number }) => i.student_id)).not.toContain(s2);

    for (const who of ['advisor1', 'staff1', 'student2'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(`${API_URL}/faculty/home/dept-head`)).status(), who).toBe(403);
    }

    await dbExec("DELETE FROM personnel WHERE personnel_id = (SELECT user_id FROM users WHERE email = 'head1@test.com')");
    await apiLoginAs(request, 'head1');
    expect((await request.get(`${API_URL}/faculty/home/dept-head`)).status()).toBe(403);
  });
});
