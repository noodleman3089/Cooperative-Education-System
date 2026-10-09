import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import crypto from 'crypto';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbValue, mentor1Id, withDb } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * ขั้น 7 ข้อ ก — นัดนิเทศ (สหกิจ 12) แก้และลบได้ · ลิงก์ตอบนัดของพี่เลี้ยงตรวจสถานะ
 *
 *   1. `PUT /appointments/:id` — อาจารย์เจ้าของนัดแก้ได้ทุกสถานะ · แก้แล้วนัดกลับเป็นร่างเสมอ
 *      (เดิมกรอกวันผิดแล้วแก้ไม่ได้ และวันที่ผิดถูกพิมพ์ลงบันทึกขออนุมัติเดินทาง)
 *   2. `DELETE /appointments/:id` — ลบได้เฉพาะร่าง · นัดล่าสุดของนักศึกษา · ไม่มีบันทึกย่อ
 *   3. `PUT /appointments/:id/respond` — ลิงก์อายุ 14 วันใช้ซ้ำได้ เดิมนัดที่ยืนยันแล้วถูกพลิกเป็น
 *      "ขอเลื่อน" ด้วยลิงก์เดิมได้ · ตอนนี้ตอบได้เฉพาะนัดที่ยังรอคำตอบ
 */

let studentId: number;
let companyId: number;
let advisor1Id: number;

async function seedPlacedWithMentor(): Promise<void> {
  const mentorId = await mentor1Id();
  await withDb(async (db) => {
    studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
    advisor1Id = (await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")).rows[0].user_id;
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0]
      .semester_id;
    companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
    await db.query('UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2', [
      advisor1Id,
      studentId,
    ]);
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
       VALUES ($1, $2, $3, 'accepted', $4, '2026-11-02')`,
      [studentId, companyId, semesterId, mentorId]
    );
  });
}

/** นัดของ advisor1 ที่สถานะตามที่ระบุ — `daysAgo` กำหนดลำดับครั้งที่ (เลขครั้งคิดจาก created_at) */
async function insertAppointment(status: string, daysAgo = 0): Promise<number> {
  return (await dbValue<number>(
    `INSERT INTO supervision_appointments
       (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, tour_requested, status, created_at)
     VALUES ($1, $2, $3, '2026-12-12', '09:30', '10:30', TRUE, $4, NOW() - ($5::int * INTERVAL '1 day'))
     RETURNING appointment_id`,
    [advisor1Id, studentId, companyId, status, daysAgo]
  ))!;
}

/** โทเคนแบบเดียวกับที่ `auditSend` ใส่ในลิงก์อีเมล (วิธีเดียวกับ `workflows/supervision-appointment-flow`) */
function mentorToken(appointmentId: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    appointment_id: appointmentId,
    role: 'mentor_response',
    iat: now,
    exp: now + 3600,
  })}`;
  return `${body}.${crypto.createHmac('sha256', process.env.JWT_SECRET as string).update(body).digest('base64url')}`;
}

const NEW_VALUES = { appointment_date: '2026-12-19', student_time: '13:00', mentor_time: '14:00', tour_requested: false };

const edit = (request: APIRequestContext, id: number, data: object = NEW_VALUES) =>
  request.put(`${API_URL}/appointments/${id}`, { data });

const remove = (request: APIRequestContext, id: number) => request.delete(`${API_URL}/appointments/${id}`);

const respond = (request: APIRequestContext, id: number, data: object) =>
  request.put(`${API_URL}/appointments/${id}/respond`, { data: { token: mentorToken(id), ...data } });

type Row = {
  status: string;
  appointment_date: string;
  student_time: string;
  mentor_time: string;
  tour_requested: boolean;
  proposed: string | null;
  proposed_mentor_time: string | null;
};

const rowOf = (id: number) =>
  dbRow<Row>(
    `SELECT status, appointment_date::text AS appointment_date, student_time, mentor_time, tour_requested,
            proposed_reschedule_date::text AS proposed, proposed_mentor_time
       FROM supervision_appointments WHERE appointment_id = $1`,
    [id]
  );

const ORIGINAL: Omit<Row, 'status'> = {
  appointment_date: '2026-12-12',
  student_time: '09:30',
  mentor_time: '10:30',
  tour_requested: true,
  proposed: null,
  proposed_mentor_time: null,
};

test.describe('ขั้น 7 ก · แก้นัดนิเทศ', () => {
  test.beforeEach(async () => {
    await seedTestData();
    await dbExec('DELETE FROM supervision_appointments');
    await seedPlacedWithMentor();
  });

  test('E1: แก้ร่าง → ค่าเปลี่ยน · สถานะยังเป็นร่าง · ลง audit พร้อมวันเดิมและวันใหม่', async ({ request }) => {
    const id = await insertAppointment('draft');
    await apiLoginAs(request, 'advisor1');

    const res = await edit(request, id);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).data).toEqual({ status: 'draft', was_sent: false });
    expect(await rowOf(id)).toEqual({
      status: 'draft',
      appointment_date: '2026-12-19',
      student_time: '13:00',
      mentor_time: '14:00',
      tour_requested: false,
      proposed: null,
      proposed_mentor_time: null,
    });

    await expect
      .poll(() =>
        dbValue(
          `SELECT detail::text FROM audit_log WHERE action = 'appointment.updated' AND entity_id = $1`,
          [String(id)]
        )
      )
      .toContain('2026-12-12');
    const detail = JSON.parse(
      (await dbValue<string>(`SELECT detail::text FROM audit_log WHERE action = 'appointment.updated' AND entity_id = $1`, [
        String(id),
      ]))!
    );
    expect(detail).toEqual({ previous_status: 'draft', previous_date: '2026-12-12', appointment_date: '2026-12-19' });
  });

  test('E2: แก้นัดที่ยืนยันแล้ว → กลับเป็นร่าง · ตอบว่าเคยส่งแล้ว', async ({ request }) => {
    const id = await insertAppointment('accepted');
    await apiLoginAs(request, 'advisor1');

    const res = await edit(request, id);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).data).toEqual({ status: 'draft', was_sent: true });
    const row = await rowOf(id);
    expect(row!.status).toBe('draft');
    expect(row!.appointment_date).toBe('2026-12-19');
  });

  test('E3: แก้นัดที่พี่เลี้ยงขอเลื่อนค้างอยู่ → กลับเป็นร่าง · ข้อเสนอเลื่อนถูกล้าง', async ({ request }) => {
    const id = await insertAppointment('rescheduled');
    await dbExec(
      `UPDATE supervision_appointments SET proposed_reschedule_date = '2026-12-20', proposed_mentor_time = '13:00'
        WHERE appointment_id = $1`,
      [id]
    );
    await apiLoginAs(request, 'advisor1');

    expect((await edit(request, id)).status()).toBe(200);
    const row = await rowOf(id);
    expect(row!.status).toBe('draft');
    expect(row!.proposed).toBeNull();
    expect(row!.proposed_mentor_time).toBeNull();
  });

  test('E4: อาจารย์คนอื่น 404 · เจ้าหน้าที่และนักศึกษา 403 · นัดไม่ถูกแตะ', async ({ request }) => {
    const id = await insertAppointment('accepted');

    await apiLoginAs(request, 'advisor2');
    expect((await edit(request, id)).status()).toBe(404);
    await apiLoginAs(request, 'staff1');
    expect((await edit(request, id)).status()).toBe(403);
    await apiLoginAs(request, 'student2');
    expect((await edit(request, id)).status()).toBe(403);

    expect(await rowOf(id)).toEqual({ status: 'accepted', ...ORIGINAL });
  });

  test('E5: วันที่ผิดรูปแบบหรือไม่มีในปฏิทิน → 400 ทั้งตอนแก้และตอนร่างใหม่ · กรอกไม่ครบ 400', async ({ request }) => {
    const id = await insertAppointment('accepted');
    await apiLoginAs(request, 'advisor1');

    // ⛔ เดิมค่าพวกนี้หลุดไปถึง Postgres แล้วตอบ 500
    for (const bad of ['12/12/2026', '2026-12-1', '2026-02-30', '2026-13-01', 20261212]) {
      const res = await edit(request, id, { ...NEW_VALUES, appointment_date: bad });
      expect(res.status(), `แก้: ${bad} → ${await res.text()}`).toBe(400);
    }
    expect((await edit(request, id, { appointment_date: '2026-12-19' })).status(), 'ไม่มีเวลา').toBe(400);
    expect(await rowOf(id)).toEqual({ status: 'accepted', ...ORIGINAL });

    // ร่างใหม่ (ครั้งที่ 2 — ครั้งที่ 1 ยืนยันแล้ว)
    for (const bad of ['12/12/2026', '2026-02-30']) {
      const res = await request.post(`${API_URL}/appointments/draft`, {
        data: { student_id: studentId, appointment_date: bad, student_time: '09:30', mentor_time: '10:30' },
      });
      expect(res.status(), `ร่าง: ${bad} → ${await res.text()}`).toBe(400);
    }
    expect(Number(await dbValue('SELECT COUNT(*) FROM supervision_appointments'))).toBe(1);
  });
});

test.describe('ขั้น 7 ก · ลบร่างนัดนิเทศ', () => {
  test.beforeEach(async () => {
    await seedTestData();
    await dbExec('DELETE FROM supervision_appointments');
    await seedPlacedWithMentor();
  });

  const count = async () => Number(await dbValue('SELECT COUNT(*) FROM supervision_appointments'));

  test('D1: ลบร่างของตัวเอง → แถวหาย · ลง audit · คนอื่นลบแทนไม่ได้', async ({ request }) => {
    const id = await insertAppointment('draft');

    await apiLoginAs(request, 'advisor2');
    expect((await remove(request, id)).status()).toBe(404);
    await apiLoginAs(request, 'staff1');
    expect((await remove(request, id)).status()).toBe(403);
    expect(await count()).toBe(1);

    await apiLoginAs(request, 'advisor1');
    const res = await remove(request, id);
    expect(res.status(), await res.text()).toBe(200);
    expect(await count()).toBe(0);

    await expect
      .poll(() =>
        dbValue(`SELECT COUNT(*)::int FROM audit_log WHERE action = 'appointment.draft_deleted' AND entity_id = $1`, [
          String(id),
        ])
      )
      .toBe(1);
  });

  test('D2: นัดที่ส่งถึงพี่เลี้ยงแล้วลบไม่ได้ (409) ทุกสถานะ', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    for (const status of ['pending_company', 'rescheduled', 'accepted', 'offline_agreed']) {
      await dbExec('DELETE FROM supervision_appointments');
      const id = await insertAppointment(status);
      const res = await remove(request, id);
      expect(res.status(), status).toBe(409);
      expect((await res.json()).message).toContain('ลบได้เฉพาะนัดที่ยังเป็นร่าง');
      expect(await count(), status).toBe(1);
    }
  });

  test('D3: ลบครั้งที่ 1 ขณะมีครั้งที่ 2 ไม่ได้ (409) — เลขครั้งที่ของนัดถัดไปจะเลื่อน', async ({ request }) => {
    // ครั้งที่ 1 ยืนยันแล้ว → ร่างครั้งที่ 2 → อาจารย์แก้ครั้งที่ 1 จนกลับเป็นร่าง
    const first = await insertAppointment('draft', 2);
    const second = await insertAppointment('accepted', 1);
    await apiLoginAs(request, 'advisor1');

    const res = await remove(request, first);
    expect(res.status(), await res.text()).toBe(409);
    expect((await res.json()).message).toContain('ครั้งถัดไป');
    expect(await count()).toBe(2);

    // ครั้งที่ 2 (นัดล่าสุด) กลับเป็นร่างแล้วลบได้
    await dbExec("UPDATE supervision_appointments SET status = 'draft' WHERE appointment_id = $1", [second]);
    expect((await remove(request, second)).status()).toBe(200);
    expect(await count()).toBe(1);
  });

  test('D4: ร่างที่มีบันทึกการนิเทศแล้วลบไม่ได้ (409) — บันทึกต้องไม่หายตามนัด', async ({ request }) => {
    const id = await insertAppointment('draft');
    await dbExec(
      `INSERT INTO supervision_logs (appointment_id, preliminary_score, behavior_notes, status)
       VALUES ($1, 80, 'ไปแล้ว', 'submitted')`,
      [id]
    );
    await apiLoginAs(request, 'advisor1');

    const res = await remove(request, id);
    expect(res.status(), await res.text()).toBe(409);
    expect((await res.json()).message).toContain('มีบันทึกการนิเทศ');
    expect(await count()).toBe(1);
    expect(Number(await dbValue('SELECT COUNT(*) FROM supervision_logs'))).toBe(1);
  });
});

test.describe('ขั้น 7 ก · ลิงก์ตอบนัดของพี่เลี้ยงตรวจสถานะ', () => {
  test.beforeEach(async () => {
    await seedTestData();
    await dbExec('DELETE FROM supervision_appointments');
    await seedPlacedWithMentor();
  });

  test('L1: นัดที่ยืนยันแล้ว — ยืนยันซ้ำ 409 · ขอเลื่อน 409 · สถานะและวันนัดไม่ขยับ', async ({ request }) => {
    for (const status of ['accepted', 'offline_agreed']) {
      await dbExec('DELETE FROM supervision_appointments');
      const id = await insertAppointment(status);

      const again = await respond(request, id, { action: 'accept' });
      expect(again.status(), status).toBe(409);
      expect((await again.json()).code).toBe('not_awaiting_response');

      const flip = await respond(request, id, { action: 'reschedule', new_date: '2099-01-10', new_time: '13:00' });
      expect(flip.status(), status).toBe(409);
      expect((await flip.json()).message).toContain('ติดต่ออาจารย์นิเทศ');

      expect(await rowOf(id), status).toEqual({ status, ...ORIGINAL });
    }
  });

  test('L2: ขอเลื่อนค้างอยู่ — เปลี่ยนวันที่เสนอได้ · แต่ยืนยันวันเดิมไม่ได้ (409)', async ({ request }) => {
    const id = await insertAppointment('pending_company');

    expect((await respond(request, id, { action: 'reschedule', new_date: '2099-01-10', new_time: '13:00' })).status()).toBe(200);
    expect((await respond(request, id, { action: 'reschedule', new_date: '2099-01-17', new_time: '15:00' })).status()).toBe(200);
    const row = await rowOf(id);
    expect(row!.status).toBe('rescheduled');
    expect(row!.proposed).toBe('2099-01-17');

    expect((await respond(request, id, { action: 'accept' })).status()).toBe(409);
    expect((await rowOf(id))!.status).toBe('rescheduled');
  });

  test('L3: อาจารย์แก้นัดจนกลับเป็นร่าง → ลิงก์เดิมตอบไม่ได้ (409) · เจ้าหน้าที่ส่งใหม่แล้วลิงก์เดิมตอบได้', async ({
    request,
  }) => {
    const id = await insertAppointment('pending_company');
    await apiLoginAs(request, 'advisor1');
    expect((await edit(request, id)).status()).toBe(200);

    expect((await respond(request, id, { action: 'accept' })).status()).toBe(409);
    expect(
      (await respond(request, id, { action: 'reschedule', new_date: '2099-01-10', new_time: '13:00' })).status()
    ).toBe(409);
    expect((await rowOf(id))!.status).toBe('draft');

    // นัดที่กลับเป็นร่างเข้ากอง "ร่าง" ของเจ้าหน้าที่ และส่งใหม่ได้ตามเดิม
    await apiLoginAs(request, 'staff1');
    const sent = await request.put(`${API_URL}/appointments/${id}/audit-send`);
    expect(sent.status(), await sent.text()).toBe(200);
    expect((await rowOf(id))!.status).toBe('pending_company');

    await request.post(`${API_URL}/auth/logout`);
    expect((await respond(request, id, { action: 'accept' })).status()).toBe(200);
    const row = await rowOf(id);
    expect(row!.status).toBe('accepted');
    // พี่เลี้ยงยืนยันวันที่อาจารย์แก้ ไม่ใช่วันเดิม
    expect(row!.appointment_date).toBe('2026-12-19');
  });
});
