import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue, withDb } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * SB-F3 · ร่างนัดนิเทศ (สหกิจ 12) — spec-F ข้อ 15.2
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **SEC-06** — ร่างนัดได้เฉพาะนักศึกษาที่ตัวเองเป็นที่ปรึกษาหรือผู้นิเทศ
 *      (เดิมไม่ตรวจเลย ร่างนั้นกลายเป็นอีเมลถึงพี่เลี้ยงเมื่อเจ้าหน้าที่กดส่ง)
 *   2. **นิเทศได้ 2 ครั้ง** ตามคู่มือ และครั้งถัดไปต้องรอครั้งก่อนตกลงกันแล้ว
 *   3. **`visit_number` นับจากนัดทั้งหมดของนักศึกษา** ไม่ใช่เฉพาะของผู้เรียก
 */

let studentId: number;
let companyId: number;
let advisor2Id: number;

async function seedPlaced(): Promise<void> {
  await withDb(async (db) => {
    studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
    const advisorId = (await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")).rows[0].user_id;
    advisor2Id = (await db.query("SELECT user_id FROM users WHERE email = 'advisor2@test.com'")).rows[0].user_id;
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0].semester_id;
    companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;

    await db.query('UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2', [advisorId, studentId]);
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'accepted', '2026-11-02')`,
      [studentId, companyId, semesterId]
    );
  });
}

const draft = (request: APIRequestContext, sid: number, date = '2026-12-12') =>
  request.post(`${API_URL}/appointments/draft`, {
    data: { student_id: sid, appointment_date: date, student_time: '09:30', mentor_time: '10:30', tour_requested: true },
  });

const myAppointments = async (request: APIRequestContext) => {
  const res = await request.get(`${API_URL}/appointments`);
  expect(res.status()).toBe(200);
  return (await res.json()).data as Array<{ appointment_id: number; student_id: number; visit_number: number; status: string }>;
};

test.describe('SB-F3 · ร่างนัดนิเทศ', () => {
  test.beforeEach(async () => {
    await seedTestData();
    await dbExec('DELETE FROM supervision_appointments');
    await seedPlaced();
  });

  test('A1: อาจารย์ที่ไม่ได้ดูแลนักศึกษาคนนั้นร่างนัดไม่ได้ (403) และไม่มีแถวเกิดขึ้น', async ({ request }) => {
    await apiLoginAs(request, 'advisor2');
    const res = await draft(request, studentId);
    expect(res.status(), await res.text()).toBe(403);
    expect(Number(await dbValue('SELECT COUNT(*) FROM supervision_appointments'))).toBe(0);
  });

  test('A2: อาจารย์ที่ดูแลร่างได้ · ได้ visit_number 1 · ลง audit_log', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const res = await draft(request, studentId);
    expect(res.status(), await res.text()).toBe(201);
    const body = await res.json();
    expect(body.data.visit_number).toBe(1);

    const rows = await myAppointments(request);
    expect(rows).toHaveLength(1);
    expect(rows[0].visit_number).toBe(1);

    await expect
      .poll(() => dbValue("SELECT COUNT(*)::int FROM audit_log WHERE action = 'appointment.draft_created' AND entity_id = $1", [body.data.appointment_id]))
      .toBe(1);
  });

  test('A3: ครั้งที่ 2 ร่างไม่ได้จนกว่าครั้งที่ 1 ตกลงกันแล้ว (409)', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    expect((await draft(request, studentId)).status()).toBe(201);

    const second = await draft(request, studentId, '2027-01-20');
    expect(second.status()).toBe(409);
    expect((await second.json()).message).toContain('ยังไม่ได้รับการยืนยัน');
  });

  test('A4: ตกลงแล้วร่างครั้งที่ 2 ได้ · ครั้งที่ 3 ถูกปฏิเสธ (409)', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    expect((await draft(request, studentId)).status()).toBe(201);
    await dbExec("UPDATE supervision_appointments SET status = 'offline_agreed'");

    const second = await draft(request, studentId, '2027-01-20');
    expect(second.status(), await second.text()).toBe(201);
    expect((await second.json()).data.visit_number).toBe(2);

    await dbExec("UPDATE supervision_appointments SET status = 'accepted'");
    const third = await draft(request, studentId, '2027-02-10');
    expect(third.status()).toBe(409);
    expect((await third.json()).message).toContain('ครบ 2 ครั้ง');
  });

  test('A5: visit_number นับรวมนัดที่อาจารย์คนอื่นร่างไว้ก่อน', async ({ request }) => {
    // ครั้งที่ 1 เป็นของอาจารย์อีกคน (เช่นเปลี่ยนผู้นิเทศกลางภาค) — ผู้เรียกมองไม่เห็นแถวนั้น
    await dbExec(
      `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status, created_at)
       VALUES ($1, $2, $3, '2026-12-01', '09:00', '10:00', 'accepted', NOW() - INTERVAL '1 day')`,
      [advisor2Id, studentId, companyId]
    );
    await apiLoginAs(request, 'advisor1');
    expect((await draft(request, studentId, '2027-01-20')).status()).toBe(201);

    const rows = await myAppointments(request);
    expect(rows).toHaveLength(1);
    expect(rows[0].visit_number).toBe(2);
  });
});

/**
 * SB-F7 · บันทึกข้อความขออนุมัติเดินทางไปราชการ (คู่มือหน้า 33–34 · 50) — ปุ่มพิมพ์สำรอง
 * เฉพาะนัดของผู้เรียก · ตกลงกันแล้ว · ครั้งที่ตรงกับที่เลือก · ไม่เกิน 10 คน
 */
test.describe('SB-F7 · พิมพ์บันทึกขออนุมัติเดินทาง', () => {
  const print = (request: APIRequestContext, visit: number | string, ids: Array<number | string>) =>
    request.get(`${API_URL}/appointments/travel-request/print?visit=${visit}&ids=${ids.join(',')}`);

  let appointmentId: number;

  test.beforeEach(async () => {
    await seedTestData();
    await dbExec('DELETE FROM supervision_appointments');
    await seedPlaced();
    appointmentId = (await dbValue<number>(
      `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status)
       VALUES ((SELECT user_id FROM users WHERE email = 'advisor1@test.com'), $1, $2, '2026-12-12', '09:30', '10:30', 'accepted')
       RETURNING appointment_id`,
      [studentId, companyId]
    ))!;
  });

  test('T1: นัดที่ยืนยันแล้วของตัวเอง → PDF · ไม่มีแถวหรือสถานะใหม่เกิดขึ้น', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const res = await print(request, 1, [appointmentId]);
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');
    // ปุ่มพิมพ์สำรอง: ไม่มีสถานะ "รออนุมัติ" ในระบบ
    expect(await dbValue('SELECT status FROM supervision_appointments WHERE appointment_id = $1', [appointmentId])).toBe('accepted');
  });

  test('T2: นัดของอาจารย์คนอื่น 403 · บทบาทอื่น 403', async ({ request }) => {
    await apiLoginAs(request, 'advisor2');
    expect((await print(request, 1, [appointmentId])).status()).toBe(403);
    await apiLoginAs(request, 'staff1');
    expect((await print(request, 1, [appointmentId])).status()).toBe(403);
  });

  test('T3: นัดยังไม่ยืนยัน · ครั้งไม่ตรง · เกิน 10 · id ไม่ถูกต้อง → 400', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    expect((await print(request, 2, [appointmentId])).status(), 'ครั้งไม่ตรง').toBe(400);
    expect((await print(request, 3, [appointmentId])).status(), 'ครั้งที่ 3').toBe(400);
    expect((await print(request, 1, ['abc'])).status(), 'id ไม่ใช่ตัวเลข').toBe(400);
    expect((await print(request, 1, Array.from({ length: 11 }, (_, i) => i + 1))).status(), 'เกิน 10').toBe(400);

    await dbExec("UPDATE supervision_appointments SET status = 'pending_company' WHERE appointment_id = $1", [appointmentId]);
    const pending = await print(request, 1, [appointmentId]);
    expect(pending.status()).toBe(400);
    expect((await pending.json()).message).toContain('ยังไม่ได้ยืนยัน');
  });
});

/**
 * SB-F4 · `GET /personnel/supervised-students` — รายชื่อที่หน้านัดหมายนิเทศใช้
 * เฉพาะนักศึกษาที่ได้ที่ฝึกแล้ว และหนึ่งแถวต่อคน
 */
test.describe('SB-F4 · รายชื่อนักศึกษาที่ต้องนิเทศ', () => {
  test.beforeEach(async () => {
    await seedTestData();
    await dbExec('DELETE FROM supervision_appointments');
    await seedPlaced();
  });

  const listIds = async (request: APIRequestContext) => {
    const res = await request.get(`${API_URL}/personnel/supervised-students`);
    expect(res.status(), await res.text()).toBe(200);
    return ((await res.json()) as Array<{ student_id: number }>).map((r) => r.student_id);
  };

  test('S1: ใบความจำนงที่ยังไม่ถูกตอบรับ ไม่ทำให้นักศึกษาขึ้นในรายชื่อ', async ({ request }) => {
    await dbExec("UPDATE intent_forms SET status = 'pending_officer_request' WHERE student_id = $1", [studentId]);
    await apiLoginAs(request, 'advisor1');
    expect(await listIds(request)).not.toContain(studentId);
  });

  test('S2: นักศึกษาที่ได้ที่ฝึกสองภาคเรียน ขึ้นแถวเดียว (ใบล่าสุด)', async ({ request }) => {
    // ฐานกันใบที่ยังมีชีวิตซ้ำในภาคเดียวกัน (uq_student_semester_active) — ซ้ำได้จริงแค่ข้ามภาค
    await dbExec(
      `WITH sem AS (
         INSERT INTO coop_semesters (academic_year, semester, is_active) VALUES (2568, '2', FALSE)
         RETURNING semester_id
       )
       INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       SELECT $1, $2, semester_id, 'accepted', '2026-01-05' FROM sem`,
      [studentId, companyId]
    );
    await apiLoginAs(request, 'advisor1');
    const ids = await listIds(request);
    expect(ids.filter((id) => id === studentId)).toHaveLength(1);
  });
});

/**
 * เปลี่ยนอาจารย์นิเทศกลางเทอม (2026-09-22)
 *
 * `supervision_appointments.advisor_id` คือผู้ร่างนัด และทุกด่านตรวจกับคอลัมน์นี้ — เดิมเปลี่ยนตัวแล้ว
 * นัดค้างกับคนเก่า คนใหม่ตอบวันเลื่อน/พิมพ์ขอเดินทางไม่ได้ · ตอนนี้นัดที่ยังไม่ได้ไปย้ายตามคนใหม่
 * ส่วนนัดที่ไปแล้ว (มีบันทึกย่อที่ส่งแล้ว) คงชื่อคนเดิมไว้เป็นหลักฐาน
 */
test.describe('เปลี่ยนอาจารย์นิเทศ → นัดที่ยังไม่ได้ไปย้ายตาม', () => {
  let visitedId: number;
  let openId: number;
  let advisor1Id: number;
  let head1Id: number;

  test.beforeEach(async () => {
    await seedTestData();
    await dbExec('DELETE FROM supervision_appointments');
    await seedPlaced();
    advisor1Id = (await dbValue<number>("SELECT user_id FROM users WHERE email = 'advisor1@test.com'"))!;
    // head1 อยู่สาขาเดียวกับ advisor1/student2 ตาม seeder — เลือกเป็นอาจารย์นิเทศคนใหม่ได้
    head1Id = (await dbValue<number>("SELECT user_id FROM users WHERE email = 'head1@test.com'"))!;
    // หน้าจอนัดนิเทศเปิดให้ role advisor เท่านั้น — หัวหน้าสาขาที่นิเทศเองถือ advisor ด้วยตามจริง
    await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'advisor') ON CONFLICT DO NOTHING`, [head1Id]);
    visitedId = (await dbValue<number>(
      `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status, created_at)
       VALUES ($1, $2, $3, '2026-12-01', '09:30', '10:30', 'accepted', NOW() - INTERVAL '1 day') RETURNING appointment_id`,
      [advisor1Id, studentId, companyId]
    ))!;
    await dbExec(
      `INSERT INTO supervision_logs (appointment_id, preliminary_score, behavior_notes, status) VALUES ($1, 80, 'ไปแล้ว', 'submitted')`,
      [visitedId]
    );
    openId = (await dbValue<number>(
      `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, status)
       VALUES ($1, $2, $3, '2027-01-15', '09:30', '10:30', 'pending_company') RETURNING appointment_id`,
      [advisor1Id, studentId, companyId]
    ))!;
  });

  const owners = async () => ({
    visited: await dbValue<number>('SELECT advisor_id FROM supervision_appointments WHERE appointment_id = $1', [visitedId]),
    open: await dbValue<number>('SELECT advisor_id FROM supervision_appointments WHERE appointment_id = $1', [openId]),
  });

  test('R1: หัวหน้าสาขามอบหมายแบบกลุ่ม → นัดที่ยังไม่ไปเป็นของคนใหม่ · นัดที่ไปแล้วยังเป็นของคนเดิม', async ({ request }) => {
    await apiLoginAs(request, 'head1');
    const res = await request.put(`${API_URL}/students/batch-assign-personnel`, {
      data: { studentIds: [studentId], advisor_id: advisor1Id, supervisor_id: head1Id },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(await owners()).toEqual({ visited: advisor1Id, open: head1Id });

    // คนใหม่เห็นนัดที่ย้ายมาในรายการของตัวเอง
    await apiLoginAs(request, 'head1');
    const list = await request.get(`${API_URL}/appointments`);
    expect(list.status()).toBe(200);
    const ids = ((await list.json()).data as Array<{ appointment_id: number }>).map((a) => a.appointment_id);
    expect(ids).toContain(openId);
  });

  test('R2: เส้นมอบหมายรายคน (assign-advisor) ย้ายนัดแบบเดียวกัน', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const res = await request.put(`${API_URL}/students/${studentId}/assign-advisor`, {
      data: { advisor_id: advisor1Id, supervisor_id: head1Id },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(await owners()).toEqual({ visited: advisor1Id, open: head1Id });
  });
});
