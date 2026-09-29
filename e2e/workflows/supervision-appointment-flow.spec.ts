import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import crypto from 'crypto';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * นัดหมายนิเทศ (สหกิจ 12) ตลอดเส้น — TC-G-21 · TC-G-22 · TC-I-11 · TC-D-05 · TC-D-06
 *
 *   อาจารย์ร่าง → เจ้าหน้าที่ตรวจแล้วส่ง → พี่เลี้ยงตอบผ่านลิงก์ในอีเมล (ยืนยัน / ขอเลื่อน)
 *   → อาจารย์รับวันใหม่ หรือบันทึกว่าตกลงนอกระบบ
 *
 * ⛔ ก่อนชุดนี้ `during-internship.spec.ts` มีเทสต์ชื่อ "Staff sends → Mentor Reschedules →
 *    Advisor accepts" แต่เนื้อเทสต์ตรวจแค่ว่าคิวเจ้าหน้าที่ว่าง — ทั้งเส้นไม่มีอะไรคุมเลย
 *
 * ลิงก์ของพี่เลี้ยงไปทางอีเมลเท่านั้น เทสต์จึงสร้างโทเคนเองด้วย JWT_SECRET ตัวเดียวกับ
 * backend (HS256 · payload เดียวกับ `auditSend`) — ไม่ได้ข้ามด่านอะไร ด่านตรวจโทเคนยังทำงานเต็ม
 */

let studentId: number;
let advisorId: number;

async function seedPlacedWithMentor(): Promise<void> {
  await withDb(async (db) => {
    studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
    advisorId = (await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")).rows[0].user_id;
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0]
      .semester_id;
    const company = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0];
    // พี่เลี้ยง = mentor1 (seed ไว้แล้ว role mentor ล้วน แยกจาก company1)
    const mentorId = (await db.query("SELECT user_id FROM users WHERE email = 'mentor1@test.com'")).rows[0].user_id;
    await db.query('UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2', [
      advisorId,
      studentId,
    ]);
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
       VALUES ($1, $2, $3, 'accepted', $4, '2026-11-02')`,
      [studentId, company.company_id, semesterId, mentorId]
    );
  });
}

/** โทเคนแบบเดียวกับที่ `auditSend` ใส่ในลิงก์อีเมล */
function mentorToken(appointmentId: number, secret = process.env.JWT_SECRET as string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    appointment_id: appointmentId,
    role: 'mentor_response',
    iat: now,
    exp: now + 3600,
  })}`;
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

async function draftAppointment(request: APIRequestContext): Promise<number> {
  await apiLoginAs(request, 'advisor1');
  const res = await request.post(`${API_URL}/appointments/draft`, {
    data: {
      student_id: studentId,
      appointment_date: '2026-12-12',
      student_time: '09:30',
      mentor_time: '10:30',
      tour_requested: true,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.appointment_id as number;
}

const statusOf = async (id: number) =>
  (await dbRow<{ status: string }>('SELECT status FROM supervision_appointments WHERE appointment_id = $1', [id]))!
    .status;

async function sendAsStaff(request: APIRequestContext, id: number): Promise<void> {
  await apiLoginAs(request, 'staff1');
  const res = await request.put(`${API_URL}/appointments/${id}/audit-send`);
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('นัดหมายนิเทศ — ร่าง · ส่ง · ตอบ · เลื่อน', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('DELETE FROM supervision_appointments');
    await seedPlacedWithMentor();
  });

  test('N1: เจ้าหน้าที่ส่ง → รอบริษัทตอบ · ส่งซ้ำได้ขณะรอ · ตอบแล้วส่งซ้ำไม่ได้ · อาจารย์ส่งเองไม่ได้', async ({
    request,
  }) => {
    const id = await draftAppointment(request);

    // อาจารย์ข้ามด่านเจ้าหน้าที่ไม่ได้
    expect((await request.put(`${API_URL}/appointments/${id}/audit-send`)).status()).toBe(403);
    expect(await statusOf(id)).toBe('draft');

    await sendAsStaff(request, id);
    expect(await statusOf(id)).toBe('pending_company');

    // ปุ่ม "ส่งซ้ำ" บนหน้าจอเจ้าหน้าที่ — พี่เลี้ยงหาอีเมลไม่เจอ
    expect((await request.put(`${API_URL}/appointments/${id}/audit-send`)).status()).toBe(200);
    expect(await statusOf(id)).toBe('pending_company');

    await dbExec("UPDATE supervision_appointments SET status = 'accepted' WHERE appointment_id = $1", [id]);
    expect((await request.put(`${API_URL}/appointments/${id}/audit-send`)).status()).toBe(400);
  });

  test('N2: ลิงก์ของพี่เลี้ยง — ไม่มีโทเคน 400 · โทเคนของนัดอื่นหรือเซ็นผิด 403 · โทเคนถูกเห็นรายละเอียด', async ({
    request,
  }) => {
    const id = await draftAppointment(request);
    await sendAsStaff(request, id);

    // ลิงก์เปิดได้โดยไม่ต้องล็อกอิน — ออกจากระบบก่อนเพื่อให้ตรงกับพี่เลี้ยงจริง
    await request.post(`${API_URL}/auth/logout`);

    const info = (token?: string) => request.post(`${API_URL}/appointments/${id}/respond-info`, { data: { token } });
    expect((await info()).status()).toBe(400);
    expect((await info(mentorToken(id + 1))).status()).toBe(403);
    expect((await info(mentorToken(id, 'x'.repeat(64)))).status()).toBe(403);

    const ok = await info(mentorToken(id));
    expect(ok.status()).toBe(200);
    const data = (await ok.json()).data;
    expect(data.company_name).toBeTruthy();
    expect(data.status).toBe('pending_company');
  });

  test('N3: พี่เลี้ยงกดยืนยัน → นัดเป็นตกลงแล้ว', async ({ request }) => {
    const id = await draftAppointment(request);
    await sendAsStaff(request, id);
    await request.post(`${API_URL}/auth/logout`);

    const res = await request.put(`${API_URL}/appointments/${id}/respond`, {
      data: { token: mentorToken(id), action: 'accept' },
    });
    expect(res.status()).toBe(200);
    expect(await statusOf(id)).toBe('accepted');
  });

  test('N4: พี่เลี้ยงขอเลื่อน — ไม่ใส่วัน/วันย้อนหลัง 400 · วันถูกต้องเก็บเป็นข้อเสนอ ไม่ทับวันเดิม', async ({
    request,
  }) => {
    const id = await draftAppointment(request);
    await sendAsStaff(request, id);
    await request.post(`${API_URL}/auth/logout`);

    const respond = (data: object) =>
      request.put(`${API_URL}/appointments/${id}/respond`, { data: { token: mentorToken(id), ...data } });

    expect((await respond({ action: 'reschedule' })).status()).toBe(400);
    expect((await respond({ action: 'reschedule', new_date: '2020-01-01', new_time: '13:00' })).status()).toBe(400);
    expect(await statusOf(id)).toBe('pending_company');

    expect((await respond({ action: 'reschedule', new_date: '2026-12-20', new_time: '13:00' })).status()).toBe(200);
    const row = await dbRow<{ status: string; appointment_date: string; proposed: string; proposed_mentor_time: string }>(
      `SELECT status, appointment_date::text AS appointment_date,
              proposed_reschedule_date::text AS proposed, proposed_mentor_time
         FROM supervision_appointments WHERE appointment_id = $1`,
      [id]
    );
    expect(row!.status).toBe('rescheduled');
    expect(row!.proposed).toBe('2026-12-20');
    expect(row!.proposed_mentor_time).toMatch(/^13:00/);
    // วันเดิมยังอยู่จนกว่าอาจารย์จะรับ
    expect(row!.appointment_date).toBe('2026-12-12');
  });

  test('N5: อาจารย์รับวันใหม่ → วันนัดเปลี่ยนตามข้อเสนอ · ข้อเสนอถูกล้าง · อาจารย์อื่นทำแทนไม่ได้', async ({
    request,
  }) => {
    const id = await draftAppointment(request);
    await sendAsStaff(request, id);
    await request.put(`${API_URL}/appointments/${id}/respond`, {
      data: { token: mentorToken(id), action: 'reschedule', new_date: '2026-12-20', new_time: '13:00' },
    });

    await apiLoginAs(request, 'advisor2');
    expect((await request.put(`${API_URL}/appointments/${id}/accept-reschedule`)).status()).toBe(404);
    expect(await statusOf(id)).toBe('rescheduled');

    await apiLoginAs(request, 'advisor1');
    expect((await request.put(`${API_URL}/appointments/${id}/accept-reschedule`)).status()).toBe(200);
    const row = await dbRow<{ status: string; appointment_date: string; mentor_time: string; proposed: string | null }>(
      `SELECT status, appointment_date::text AS appointment_date, mentor_time,
              proposed_reschedule_date::text AS proposed
         FROM supervision_appointments WHERE appointment_id = $1`,
      [id]
    );
    expect(row!.status).toBe('accepted');
    expect(row!.appointment_date).toBe('2026-12-20');
    expect(row!.mentor_time).toMatch(/^13:00/);
    expect(row!.proposed).toBeNull();

    // ไม่มีข้อเสนอค้างแล้ว กดซ้ำต้องไม่ผ่าน
    expect((await request.put(`${API_URL}/appointments/${id}/accept-reschedule`)).status()).toBe(400);
  });

  test('N6: อาจารย์บันทึกว่าตกลงนอกระบบ → นัดเป็นตกลงนอกระบบ', async ({ request }) => {
    const id = await draftAppointment(request);
    await sendAsStaff(request, id);

    // ⛔ เดิมตอบ 200 แม้ไม่มีแถวถูกแก้ — อาจารย์อื่นกดแล้วเห็นว่าสำเร็จ
    await apiLoginAs(request, 'advisor2');
    expect((await request.put(`${API_URL}/appointments/${id}/bypass`)).status()).toBe(404);
    expect(await statusOf(id)).toBe('pending_company');

    await apiLoginAs(request, 'advisor1');
    expect((await request.put(`${API_URL}/appointments/${id}/bypass`)).status()).toBe(200);
    expect(await statusOf(id)).toBe('offline_agreed');

    // ตกลงไปแล้ว บันทึกซ้ำไม่ได้
    expect((await request.put(`${API_URL}/appointments/${id}/bypass`)).status()).toBe(404);
  });

  test('N7: หน้าจอ — พี่เลี้ยงเปิดลิงก์ ขอเลื่อน แล้วอาจารย์กด "ใช้วันที่พี่เลี้ยงเสนอ"', async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await draftAppointment(request);
    await sendAsStaff(request, id);

    // พี่เลี้ยง — เบราว์เซอร์ที่ไม่ได้ล็อกอิน
    await page.goto(`/appointment-response?token=${mentorToken(id)}`);
    await expect(page.getByText('ตอบรับการนัดหมายนิเทศนักศึกษา')).toBeVisible();
    await expect(page.getByText('640101001', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'ขอเลื่อนวัน/เวลานัดหมาย' }).click();
    await page.locator('input[type="date"]').fill('2026-12-20');
    await page.locator('input[type="time"]').fill('13:00');
    await page.getByRole('button', { name: 'ส่งคำขอเลื่อน' }).click();
    await expect(page.getByText('ดำเนินการสำเร็จ')).toBeVisible();
    expect(await statusOf(id)).toBe('rescheduled');

    // อาจารย์นิเทศ
    await loginAs(page, 'advisor1');
    await page.getByTestId('role-btn-supervisor').click();
    await goToMenu(page, 'supervision');
    await page.getByTestId(`supervision-accept-reschedule-${id}`).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ยืนยัน ใช้วันใหม่' }).click();
    await expect(page.getByText(/ยอมรับการเลื่อนนัดหมายสำเร็จ/)).toBeVisible();
    expect(await statusOf(id)).toBe('accepted');
  });

  test('N8: หน้าจอ — เจ้าหน้าที่เห็นร่างพร้อมปุ่ม "ตรวจแล้ว ส่งเลย" และส่งได้จริง', async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await draftAppointment(request);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'appointments');
    const row = page.getByTestId(`appointment-row-${id}`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'ตรวจแล้ว ส่งเลย' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ตรวจแล้ว ส่งเลย' }).click();
    await expect(page.getByText(/ส่งอีเมลนัดหมายนิเทศของ .*เรียบร้อยแล้ว/)).toBeVisible();
    expect(await statusOf(id)).toBe('pending_company');
    // ⛔ เดิมหน้าจอรอสถานะชื่อ 'sent' ที่ backend ไม่มี แถวที่ส่งแล้วจึงไม่ขึ้นป้าย
    await expect(row.getByText('ส่งแล้ว')).toBeVisible();
    await expect(row.getByRole('button', { name: 'ส่งซ้ำ' })).toBeVisible();
  });

  test('N9: หน้าจอ — ไม่มีอีเมลพี่เลี้ยง เจ้าหน้าที่กด "บันทึกว่านัดทางโทรศัพท์แล้ว" ได้จริง', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const id = await draftAppointment(request);
    // ใบที่ยังไม่มีพี่เลี้ยง = ไม่มีปลายทางอีเมล
    await dbExec("UPDATE intent_forms SET mentor_id = NULL WHERE status = 'accepted'");

    await loginAs(page, 'staff1');
    await goToMenu(page, 'appointments');
    const row = page.getByTestId(`appointment-row-${id}`);
    await expect(row.getByText('ส่งไม่ได้')).toBeVisible();
    await row.getByRole('button', { name: 'บันทึกว่านัดทางโทรศัพท์แล้ว' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'บันทึกว่านัดแล้ว (ยืนยันนอกระบบ)' }).click();
    await expect(page.getByText(/บันทึกการยืนยันนัดหมายทางโทรศัพท์ .* เรียบร้อยแล้ว/)).toBeVisible();
    expect(await statusOf(id)).toBe('offline_agreed');
    await expect(row.getByText('ยืนยันนอกระบบ (โทรศัพท์)')).toBeVisible();
  });

  test('N10: หน้าจอ — เจ้าหน้าที่เห็นวันที่บริษัทขอเลื่อน และกด "รับวันใหม่" ได้จริง', async ({ page, request }) => {
    test.setTimeout(120_000);
    const id = await draftAppointment(request);
    await sendAsStaff(request, id);
    await request.put(`${API_URL}/appointments/${id}/respond`, {
      data: { token: mentorToken(id), action: 'reschedule', new_date: '2026-12-20', new_time: '13:00' },
    });

    await loginAs(page, 'staff1');
    await goToMenu(page, 'appointments');
    const row = page.getByTestId(`appointment-row-${id}`);
    await expect(row.getByText(/บริษัทขอเลื่อนเป็น .* 13:00/)).toBeVisible();
    await row.getByRole('button', { name: 'รับวันใหม่' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ยอมรับวันใหม่' }).click();
    await expect(page.getByText(/ตอบรับวันนัดหมายใหม่สำหรับ .* เรียบร้อยแล้ว/)).toBeVisible();

    const saved = await dbRow<{ status: string; appointment_date: string }>(
      'SELECT status, appointment_date::text AS appointment_date FROM supervision_appointments WHERE appointment_id = $1',
      [id]
    );
    expect(saved).toEqual({ status: 'accepted', appointment_date: '2026-12-20' });
  });
});
