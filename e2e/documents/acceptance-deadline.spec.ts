import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, BACKEND_ROOT } from '../helpers/env';
import { dbExec, dbRow, dbValue, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { walkToSigned } from '../helpers/intent';
import { newStudent, putForm, shift, twoSemesters } from '../helpers/semesters';
import { ACCEPTANCE_WORKING_DAYS, addWorkingDays } from '../../backend/src/utils/workingDays';
import { formatThaiDateLong } from '../../backend/src/utils/thaiDate';

/**
 * ขั้น 4 — ส่งหนังสือให้สถานประกอบการ / สถานประกอบการตอบ (2026-10-07)
 *
 * คุม "ใครทำได้ / เมื่อไหร่" ก่อนหน้าตา:
 *   D1 นาฬิกา ๑๕ วันทำการเริ่มเมื่ออีเมลส่งสำเร็จครั้งแรก · ลิงก์หมดอายุสิ้นวันของกำหนด · ส่งซ้ำไม่ยืด
 *   D2 กำหนดพ้นแล้วส่งซ้ำ = 409 ก่อนจองโควตา (ไม่ส่งลิงก์ที่ตายตั้งแต่เกิด)
 *   D3 เจ้าหน้าที่ตีกลับแบบตอบรับ → ส่งครั้งถัดไปตั้งกำหนดใหม่ (ครั้งเดียว)
 *   D4 ทางกระดาษ: ไม่เคยส่งอีเมล กำหนดยังนับจากวันลงนาม · ส่งหลังกำหนด = รับ + ธงส่งช้า
 *   D5 ปฏิทิน `acceptance_form` ปิด → ลิงก์ตอบ 410 `calendar_closed` ทุกเส้น ก่อน multer · นักศึกษาส่งอีเมล 409
 *      · ยังไม่ตั้ง / ช่วงผ่อนผัน = ผ่าน (fail-open ตามกฎปฏิทิน)
 *   D6 งานปิดใบอัตโนมัติ — ปิดเฉพาะใบที่เข้าเงื่อนไข · รันซ้ำไม่ปิดซ้ำ · นักศึกษายื่นใหม่ได้
 *   D7 `POST /acceptance-form` พิมพ์ค่าที่กรอกลง PDF โดยไม่เขียนฐาน ไม่เผา token
 *   D8 หน้าลิงก์: กรอก → สร้างเอกสาร → แนบ → ส่ง · ลิงก์ถัดไปเติมช่องให้ · D8b การ์ดนักศึกษา
 *
 * การส่งเมลไม่ออกเน็ต (`MAIL_DRY_RUN=true` ใน playwright.config.ts) · ข้อมูลทั้งหมดเป็นของปลอม
 * ไม่มีเทสต์: เนื้อความอีเมล (ถึงบริษัท · ถึงนักศึกษา 3 คีย์ใหม่) — dry-run ไม่มีตัวดักเนื้ออีเมลใน E2E
 */

const PUB = `${API_URL}/public/acceptance`;
const EVIDENCE_DIR = path.join(BACKEND_ROOT, 'uploads/acceptance_evidence');
const PDF_FIXTURE = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');

const evidenceCount = (): number => (fs.existsSync(EVIDENCE_DIR) ? fs.readdirSync(EVIDENCE_DIR).length : 0);

const pdfPart = () => ({
  name: 'acceptance-signed.pdf',
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(PDF_FIXTURE),
});

const todayTh = async () =>
  (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;

const flat = (s: string) => s.replace(/\s+/g, '');

async function pdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return flat((await parser.getText()).text);
  } finally {
    await parser.destroy();
  }
}

async function seedIntent(): Promise<number> {
  return withDb(async (db) => {
    const studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0]
      .semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'pending_advisor', '2026-11-02') RETURNING form_id`,
      [studentId, companyId, semesterId]
    );
    return res.rows[0].form_id as number;
  });
}

/** นักศึกษา (student2) กดส่งหนังสือให้บริษัท — คืน response ให้เทสต์ตัดสินเอง */
async function send(request: APIRequestContext, formId: number, to = 'hr-deadline@example.com') {
  await apiLoginAs(request, 'student2');
  return request.post(`${API_URL}/intents/${formId}/send-to-company`, { data: { company_email: to } });
}

interface FormState {
  status: string;
  due: string | null;
  count: number;
  sent_at: string | null;
  reject_reason: string | null;
  late: boolean | null;
}
const formState = (formId: number) =>
  dbRow<FormState>(
    `SELECT status, acceptance_due_date::text AS due, company_mail_count AS count,
            company_mail_sent_at::text AS sent_at, reject_reason, acceptance_submitted_late AS late
       FROM intent_forms WHERE form_id = $1`,
    [formId]
  ) as Promise<FormState>;

/** ลิงก์ของใบ เรียงจากเก่าไปใหม่ — `last_day` = วันสุดท้ายที่ใช้ได้ตามเวลาไทย */
const tokens = (formId: number) =>
  withDb(async (db) =>
    (
      await db.query(
        `SELECT token, (expires_at AT TIME ZONE 'Asia/Bangkok')::date::text AS last_day,
                to_char(expires_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI:SS') AS last_time,
                used_at, revoked_at
           FROM acceptance_link_tokens WHERE form_id = $1 ORDER BY token_id`,
        [formId]
      )
    ).rows as { token: string; last_day: string; last_time: string; used_at: string | null; revoked_at: string | null }[]
  );

const setDue = (formId: number, iso: string) =>
  dbExec('UPDATE intent_forms SET acceptance_due_date = $2::date WHERE form_id = $1', [formId, iso]);

/** ตั้งแถว `acceptance_form` ของภาค (ลบของเดิมก่อน) — `end = null` = ลบอย่างเดียว (ยังไม่ตั้ง) */
async function setAcceptanceCalendar(semesterId: number, end: string | null, lateEnd: string | null = null) {
  await dbExec(`DELETE FROM coop_calendar_events WHERE semester_id = $1 AND activity_key = 'acceptance_form'`, [
    semesterId,
  ]);
  if (end) {
    await dbExec(
      `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, end_date, late_end_date)
       VALUES ($1, 'acceptance_form', 'deadline', $2::date, $3::date)`,
      [semesterId, end, lateEnd]
    );
  }
}

const activeSemesterId = async () =>
  (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')) as number;

/** นักศึกษาอัปโหลดแบบตอบรับเอง (ทางกระดาษ) */
async function uploadPaper(request: APIRequestContext, formId: number) {
  await apiLoginAs(request, 'student2');
  return request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
    multipart: {
      evidence: pdfPart(),
      name: 'สุรเดช ใจดี',
      email: 'mentor-deadline@example.com',
      phone: '0812223333',
      start_date: '2026-11-02',
      signer_name: 'คุณสมชาย ทรงชัย',
      signer_position: 'ผู้จัดการฝ่ายบุคคล',
      signed_date: await todayTh(),
    },
  });
}

async function officerReturnsAcceptance(request: APIRequestContext, formId: number, reason: string) {
  await apiLoginAs(request, 'staff1');
  const res = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
    data: { action: 'rejected', reason },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.describe('ขั้น 4 — กำหนด ๑๕ วันทำการ · ปฏิทินรับแบบตอบรับ · เอกสาร 2 ที่บริษัทกรอกบนหน้าลิงก์', () => {
  let anon: APIRequestContext;

  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    anon = await playwrightRequest.newContext();
  });

  test.afterEach(async () => {
    await anon.dispose();
  });

  test('D1: ส่งครั้งแรก → กำหนด = วันนี้ + ๑๕ วันทำการ · ลิงก์หมดอายุสิ้นวันนั้น · ส่งซ้ำไม่เลื่อนทั้งกำหนดและอายุลิงก์', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    const today = await todayTh();
    const fresh = addWorkingDays(today, ACCEPTANCE_WORKING_DAYS);

    // จำลองว่าคณบดีลงนามมาหลายวันแล้ว — กำหนดของทางกระดาษเหลืออีก 3 วัน
    await setDue(formId, shift(today, 3));

    const first = await send(request, formId);
    expect(first.status(), await first.text()).toBe(200);
    expect((await first.json()).acceptance_due_date).toBe(fresh);
    expect((await formState(formId)).due, 'ส่งครั้งแรก = บริษัทได้รับหนังสือวันนี้ เริ่มนับใหม่').toBe(fresh);
    let links = await tokens(formId);
    expect(links).toHaveLength(1);
    expect(links[0].last_day).toBe(fresh);
    expect(links[0].last_time).toBe('23:59:59');

    // เวลาผ่านไป — กำหนดเหลือ 5 วัน · ส่งซ้ำต้องไม่ได้ ๑๕ วันทำการใหม่
    const remaining = shift(today, 5);
    await setDue(formId, remaining);
    const second = await send(request, formId, 'hr-second@example.com');
    expect(second.status(), await second.text()).toBe(200);
    expect((await second.json()).acceptance_due_date).toBe(remaining);
    expect((await formState(formId)).due, 'ส่งซ้ำไม่ยืดกำหนด').toBe(remaining);
    links = await tokens(formId);
    expect(links).toHaveLength(2);
    expect(links[0].revoked_at).not.toBeNull();
    expect(links[1].revoked_at).toBeNull();
    expect(links[1].last_day, 'ลิงก์ใหม่หมดอายุวันเดียวกับกำหนดของใบ ไม่ใช่ +15 จากวันที่ส่งซ้ำ').toBe(remaining);
  });

  test('D2: กำหนดพ้นแล้วส่งซ้ำ → 409 · company_mail_count ไม่เพิ่ม · ไม่มี token ใหม่ · ลิงก์เดิมไม่ถูกยกเลิก', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    expect((await send(request, formId)).status()).toBe(200);

    await setDue(formId, shift(await todayTh(), -1));
    const before = await formState(formId);

    const again = await send(request, formId, 'hr-late@example.com');
    expect(again.status(), await again.text()).toBe(409);
    const message = (await again.json()).message as string;
    expect(message).toContain('เลยกำหนดตอบกลับ');
    // บอกทางไป ไม่ใช่แค่ปฏิเสธ · ⛔ ไม่ส่งไปหาเจ้าหน้าที่ (เจ้าหน้าที่ไม่มีปุ่มส่งแทน)
    expect(message).toContain('บริษัทคืนเอกสารตอบรับมาที่ฉัน');
    expect(message).not.toContain('ติดต่อเจ้าหน้าที่');

    expect(await formState(formId)).toEqual(before);
    const links = await tokens(formId);
    expect(links).toHaveLength(1);
    expect(links[0].revoked_at).toBeNull();
  });

  test('D3: เจ้าหน้าที่ตีกลับแบบตอบรับ → ส่งครั้งถัดไปตั้งกำหนดใหม่ (ทั้งที่กำหนดเดิมพ้นแล้ว) · ครั้งต่อไปไม่ตั้งอีก', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    expect((await send(request, formId)).status()).toBe(200);

    const paper = await uploadPaper(request, formId);
    expect(paper.status(), await paper.text()).toBe(200);
    await officerReturnsAcceptance(request, formId, 'ตราประทับไม่ชัดเจน');

    const today = await todayTh();
    await setDue(formId, shift(today, -4));
    const returned = await formState(formId);
    expect(returned.status).toBe('approved_by_dept_head');
    expect(returned.reject_reason).toBe('ตราประทับไม่ชัดเจน');

    // ไม่ตั้งใหม่ = ลิงก์ที่ออกมาก็หมดอายุแล้ว นักศึกษาจะไม่มีทางให้บริษัทแก้เอกสารทางลิงก์ได้เลย
    const resend = await send(request, formId);
    expect(resend.status(), await resend.text()).toBe(200);
    const fresh = addWorkingDays(today, ACCEPTANCE_WORKING_DAYS);
    const after = await formState(formId);
    expect(after.due).toBe(fresh);
    expect(after.reject_reason).toBeNull();
    expect((await tokens(formId)).at(-1)!.last_day).toBe(fresh);

    // การตั้งใหม่ผูกกับการตีกลับ (มีคนกด) เท่านั้น — ส่งซ้ำเฉยๆ หลังจากนั้นยืดไม่ได้
    await setDue(formId, shift(today, -1));
    expect((await send(request, formId)).status()).toBe(409);
  });

  test('D4: ไม่เคยส่งอีเมล → กำหนดยังนับจากวันคณบดีลงนาม · อัปโหลดกระดาษหลังกำหนด = รับ + ธงส่งช้า', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    const today = await todayTh();

    const signed = await formState(formId);
    expect(signed.due, 'คณบดีลงนามวันนี้ = วันนี้ + ๑๕ วันทำการ').toBe(addWorkingDays(today, ACCEPTANCE_WORKING_DAYS));
    expect(signed.sent_at).toBeNull();

    await setDue(formId, shift(today, -2));
    const paper = await uploadPaper(request, formId);
    expect(paper.status(), await paper.text()).toBe(200);
    expect((await paper.json()).message as string).toContain('หลังพ้นกำหนด');

    const after = await formState(formId);
    expect(after.status).toBe('pending_officer_approval');
    expect(after.late).toBe(true);
    expect(after.due, 'ทางกระดาษไม่แตะกำหนด').toBe(shift(today, -2));
  });

  test('D5: ปฏิทินปิด → ทุกเส้นของลิงก์ตอบ 410 calendar_closed ก่อนเขียนไฟล์ · นักศึกษาส่งอีเมล 409 · ยังไม่ตั้ง/ผ่อนผัน = ผ่าน', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    expect((await send(request, formId)).status()).toBe(200);
    const token = (await tokens(formId))[0].token;
    const semesterId = await activeSemesterId();
    const today = await todayTh();
    const q = `?token=${token}`;

    const everyRoute = async (): Promise<Array<[string, number, { code?: string; message?: string }]>> => {
      const out: Array<[string, number, { code?: string; message?: string }]> = [];
      for (const p of ['', '/cover-letter', '/acceptance-form', '/resume']) {
        const res = await anon.get(`${PUB}${p}${q}`);
        out.push([`GET ${p || '/'}`, res.status(), await res.json().catch(() => ({}))]);
      }
      const fill = await anon.post(`${PUB}/acceptance-form${q}`, { data: { coordinator_name: 'ทดสอบ' } });
      out.push(['POST /acceptance-form', fill.status(), await fill.json().catch(() => ({}))]);
      const decline = await anon.post(`${PUB}/decline${q}`, { data: { reason: 'ไม่มีตำแหน่ง' } });
      out.push(['POST /decline', decline.status(), await decline.json().catch(() => ({}))]);
      const accept = await anon.post(`${PUB}/accept${q}`, {
        multipart: {
          evidence: pdfPart(),
          signer_name: 'คุณสมชาย ทรงชัย',
          signer_position: 'ผู้จัดการฝ่ายบุคคล',
          signed_date: today,
          start_date: '2026-11-02',
        },
      });
      out.push(['POST /accept', accept.status(), await accept.json().catch(() => ({}))]);
      return out;
    };

    // ── ปิดแล้ว (พ้นวันสุดท้าย ไม่มีช่วงผ่อนผัน) ──
    await setAcceptanceCalendar(semesterId, shift(today, -10));
    const filesBefore = evidenceCount();
    const stateBefore = await formState(formId);
    for (const [label, status, body] of await everyRoute()) {
      expect(status, label).toBe(410);
      expect(body.code, label).toBe('calendar_closed');
      // ข้อความเขียนถึงบริษัท — ของเดิมเป็น 403 ที่บอกให้ "ติดต่ออาจารย์ที่ปรึกษา… นักศึกษายื่นเรื่องเองไม่ได้"
      expect(body.message, label).toContain('พ้นกำหนดรับแบบตอบรับของคณะ');
      expect(body.message, label).not.toContain('อาจารย์ที่ปรึกษา');
      expect(body.message, label).not.toContain('นักศึกษายื่นเรื่องเองไม่ได้');
    }
    expect(evidenceCount(), 'คำขอที่ถูกปฏิเสธต้องไม่เขียนไฟล์ลงดิสก์').toBe(filesBefore);
    expect(await formState(formId)).toEqual(stateBefore);
    expect((await tokens(formId))[0].used_at).toBeNull();

    // นักศึกษาก็ส่งลิงก์ที่ตอบไม่ได้ไม่ได้
    const blocked = await send(request, formId, 'hr-closed@example.com');
    expect(blocked.status(), await blocked.text()).toBe(409);
    expect((await blocked.json()).message as string).toContain('ปฏิทินสหกิจศึกษา');
    expect(await formState(formId)).toEqual(stateBefore);
    expect(await tokens(formId)).toHaveLength(1);

    // ── ยังไม่ตั้ง = ยังไม่มีกฎ = ผ่าน (⛔ fail-open ตามกฎปฏิทิน ไม่ใช่ SEC-06) ──
    await setAcceptanceCalendar(semesterId, null);
    expect((await anon.get(`${PUB}${q}`)).status()).toBe(200);

    // ── ช่วงผ่อนผัน = ยังตอบได้ และนักศึกษายังส่งได้ ──
    await setAcceptanceCalendar(semesterId, shift(today, -2), shift(today, 2));
    expect((await anon.get(`${PUB}${q}`)).status()).toBe(200);
    expect((await send(request, formId, 'hr-late-window@example.com')).status()).toBe(200);
  });

  test('D6: งานปิดใบอัตโนมัติ — ปิดเฉพาะใบที่ลงนามแล้ว รอตอบรับ และพ้นปฏิทินของภาคตัวเอง · รันซ้ำไม่ปิดซ้ำ · ยื่นใหม่ได้', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    // ⛔ ฟังก์ชันนี้รันในโปรเซสของเทสต์และส่งอีเมลแจ้งนักศึกษา — ต้องเป็น dry-run ก่อน import (ดู mentor-auto-remind.spec.ts)
    expect(process.env.MAIL_DRY_RUN).toBe('true');
    const { runAcceptanceAutoClose } = await import('../../backend/src/utils/acceptanceAutoClose');

    const { a, b } = await twoSemesters();
    const today = await todayTh();
    const [waitDean, answered, otherSemester] = [await newStudent(), await newStudent(), await newStudent()];

    // ใบที่ควรถูกปิด: ลงนามแล้ว (มีกำหนด) รอบริษัท — กำหนด ๑๕ วันทำการยังไม่พ้นด้วยซ้ำ ตัวตัดสินคือปฏิทิน
    const target = await putForm('student2@test.com', a, 'approved_by_dept_head', 5);
    // ใบที่ต้องไม่ถูกปิด
    const stillWaitingDean = await putForm(waitDean.email, a, 'approved_by_dept_head', null);
    const alreadyAnswered = await putForm(answered.email, a, 'pending_officer_approval', -3);
    const inOtherSemester = await putForm(otherSemester.email, b, 'approved_by_dept_head', -30);
    const all = [target, stillWaitingDean, alreadyAnswered, inOtherSemester];
    const statuses = async () => {
      const out: string[] = [];
      for (const id of all) out.push((await formState(id)).status);
      return out;
    };
    const untouched = ['approved_by_dept_head', 'approved_by_dept_head', 'pending_officer_approval', 'approved_by_dept_head'];

    // ภาค b เปิดอยู่ตลอดเทสต์
    await setAcceptanceCalendar(b, shift(today, 5));

    // 1) ภาค a ยังไม่ตั้งปฏิทิน → ไม่ปิดอะไร
    await setAcceptanceCalendar(a, null);
    expect(await runAcceptanceAutoClose()).toBe(0);
    expect(await statuses()).toEqual(untouched);

    // 2) ภาค a อยู่ช่วงผ่อนผัน → ยังไม่ปิด
    await setAcceptanceCalendar(a, shift(today, -2), shift(today, 2));
    expect(await runAcceptanceAutoClose()).toBe(0);
    expect(await statuses()).toEqual(untouched);

    // 3) ภาค a ปิดแล้ว → ปิดเฉพาะ target
    await setAcceptanceCalendar(a, shift(today, -10), shift(today, -3));
    expect(await runAcceptanceAutoClose()).toBe(1);
    expect(await statuses()).toEqual(['rejected', 'approved_by_dept_head', 'pending_officer_approval', 'approved_by_dept_head']);
    expect((await formState(target)).reject_reason).toContain('พ้นกำหนดส่งแบบตอบรับตามปฏิทินสหกิจศึกษา');

    const exited = () =>
      dbValue<string>(`SELECT COUNT(*) FROM intent_stage_events WHERE form_id = $1 AND stage = 'exited'`, [target]);
    const audited = () =>
      dbRow<{ n: string; actor: string | null; subject: number | null }>(
        `SELECT COUNT(*) AS n, MAX(actor_email) AS actor, MAX(subject_id) AS subject
           FROM audit_log WHERE action = 'intent.auto_closed' AND entity_id = $1::text`,
        [target]
      );
    expect(await exited()).toBe('1');
    const audit = await audited();
    expect(audit!.n).toBe('1');
    expect(audit!.subject).toBe(await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'"));

    // 4) รันซ้ำ → ไม่ปิดซ้ำ ไม่มีแถวซ้ำ
    expect(await runAcceptanceAutoClose()).toBe(0);
    expect(await exited()).toBe('1');
    expect((await audited())!.n).toBe('1');

    // 5) นักศึกษาเห็นเหตุผล และยื่นคำร้องที่ใหม่ได้ทันที
    await apiLoginAs(request, 'student2');
    const dash = await (await request.get(`${API_URL}/students/dashboard`)).json();
    expect(dash.activeIntent).toBeNull();
    expect(dash.closedIntent.status).toBe('rejected');
    expect(dash.closedIntent.reject_reason).toContain('พ้นกำหนดส่งแบบตอบรับ');
    const again = await request.post(`${API_URL}/intents`, {
      data: {
        is_self_found: true,
        semester_id: a,
        google_place_id: 'place-deadline-d6',
        company_name_th: 'บริษัท ที่ใหม่ จำกัด',
        company_address: '1 ถนนทดสอบ',
        company_province: 'ชลบุรี',
        company_district: 'ศรีราชา',
        company_postal_code: '20110',
        company_phone: '020000000',
        contact_person: 'ผู้รับหนังสือ ทดสอบ',
        contact_position: 'ผู้จัดการฝ่ายบุคคล',
      },
    });
    expect(again.status(), await again.text()).toBe(201);
  });

  test('D6b: นักศึกษาแจ้งว่าไม่ได้ที่ฝึก → เหตุผลตีกลับของเจ้าหน้าที่ที่ค้างอยู่ถูกล้าง (ไม่โผล่เป็นเหตุผลที่ใบปิด)', async ({
    request,
  }) => {
    const formId = await putForm('student2@test.com', await activeSemesterId(), 'approved_by_dept_head', 5);
    await dbExec("UPDATE intent_forms SET reject_reason = 'ตราประทับไม่ชัดเจน' WHERE form_id = $1", [formId]);

    await apiLoginAs(request, 'student2');
    const res = await request.post(`${API_URL}/acceptances/student/${formId}/fail`);
    expect(res.status(), await res.text()).toBe(200);

    const after = await formState(formId);
    expect(after.status).toBe('rejected');
    expect(after.reject_reason, '`rejected` ที่ไม่มีเหตุผล = นักศึกษาแจ้งเอง').toBeNull();
  });

  test('D7: POST /acceptance-form → PDF มีค่าที่กรอก · ไม่เขียน companies/intent_forms · ไม่เผา token · token ผิด 404 · ยาวเกิน 400', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    expect((await send(request, formId)).status()).toBe(200);
    const token = (await tokens(formId))[0].token;
    const today = await todayTh();
    const url = `${PUB}/acceptance-form?token=${token}`;

    const snapshot = async () => ({
      company: await dbValue<Record<string, unknown>>(
        `SELECT to_jsonb(c) FROM companies c WHERE c.company_id = (SELECT company_id FROM intent_forms WHERE form_id = $1)`,
        [formId]
      ),
      form: await dbValue<Record<string, unknown>>(`SELECT to_jsonb(i) FROM intent_forms i WHERE i.form_id = $1`, [formId]),
      link: (await tokens(formId))[0],
    });
    const before = await snapshot();

    const fill = {
      coordinator_name: 'คุณวิภา ใจดี',
      coordinator_position: 'HR Officer',
      office_phone: '02-555-0101',
      mobile_phone: '081-555-0102',
      fax: '02-555-0103',
      email: 'hr-fill-d7@example.com',
      additional_info: 'Safety shoes required',
      approver_name: 'คุณสมชาย ทรงชัย',
      approver_position: 'HR Manager',
      approved_date: today,
      // คีย์ที่ระบบไม่รู้จัก (ของสหกิจ 07 เดิม) ต้องถูกเมิน ไม่ถูกพิมพ์ ไม่ถูกเก็บ
      name_th: 'บริษัท HACKED-D7 จำกัด',
      manager_name: 'HACKED-MANAGER-D7',
    };
    const res = await anon.post(url, { data: fill });
    expect(res.status(), await res.text().catch(() => '')).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    const text = await pdfText(await res.body());
    for (const value of [
      fill.coordinator_name,
      fill.coordinator_position,
      fill.office_phone,
      fill.mobile_phone,
      fill.fax,
      fill.email,
      fill.additional_info,
      fill.approver_name,
      fill.approver_position,
      formatThaiDateLong(today)!,
    ]) {
      expect(text, `PDF ต้องมี "${value}"`).toContain(flat(value));
    }
    expect(text).not.toContain('HACKED');
    // ส่วนที่ต้องลงมือเองบนกระดาษยังอยู่ครบ
    expect(text).toContain(flat('ที่ประทับตราสถานประกอบการ'));
    expect(text).toContain(flat('ส่วนของเจ้าหน้าที่ประจำมหาวิทยาลัยฯ'));

    // ⛔ SEC-14 ข้อ 5: ลิงก์ไม่รับข้อมูลบริษัทเข้าระบบ — ทุกอย่างต้องเหมือนเดิมทุกคอลัมน์
    expect(await snapshot()).toEqual(before);
    expect(before.link.used_at).toBeNull();

    // ฟอร์มเปล่ายังเปิดได้ และไม่มีค่าที่เพิ่งกรอก
    const blank = await anon.get(url);
    expect(blank.status()).toBe(200);
    expect(await pdfText(await blank.body())).not.toContain('hr-fill-d7@example.com');

    // ด่าน
    expect((await anon.post(`${PUB}/acceptance-form?token=${crypto.randomUUID()}`, { data: fill })).status()).toBe(404);
    for (const [label, body] of [
      ['ชื่อยาวเกิน 255', { coordinator_name: 'ก'.repeat(256) }],
      ['ข้อมูลเพิ่มเติมยาวเกิน 500', { additional_info: 'ก'.repeat(501) }],
      ['ไม่ใช่ข้อความ', { coordinator_name: { $ne: null } }],
      ['วันที่ผิดรูปแบบ', { approved_date: '07/10/2026' }],
    ] as const) {
      const bad = await anon.post(url, { data: body });
      expect(bad.status(), label).toBe(400);
    }
    // ยาวพอดีเพดานยังผ่าน (ตัดให้พอดีช่องบนกระดาษ) และยังจบหน้าเดียว
    const edge = await anon.post(url, { data: { coordinator_name: 'ก'.repeat(255), additional_info: 'คำ '.repeat(166) } });
    expect(edge.status()).toBe(200);
    const parser = new PDFParse({ data: new Uint8Array(await edge.body()) });
    try {
      expect((await parser.getText()).pages.length, 'เอกสาร 2 ต้องจบหน้าเดียว').toBe(1);
    } finally {
      await parser.destroy();
    }
    expect(await snapshot()).toEqual(before);
  });

  test('D8: หน้าลิงก์ — กรอก → สร้างเอกสาร 2 → แนบ → ส่งสำเร็จ · ลิงก์ถัดไปเติมช่องผู้ประสานงานให้ ไม่เติมวันที่', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    expect((await send(request, formId)).status()).toBe(200);
    const today = await todayTh();

    await page.goto(`/accept?token=${(await tokens(formId))[0].token}`);
    await page.getByTestId('al-decision-accept').check();
    // เปิดครั้งแรกบนเครื่องนี้ = ช่องว่าง
    await expect(page.getByTestId('al-coordinator_name')).toHaveValue('');

    // กดสร้างทั้งที่ยังไม่กรอก = บอกว่าขาดอะไร ไม่ยิงเซิร์ฟเวอร์
    await page.getByTestId('al-generate').click();
    await expect(page.getByTestId('al-error')).toContainText('กรุณากรอกชื่อผู้ประสานงาน');
    await expect(page.getByTestId('al-filled-open')).toHaveCount(0);

    await page.getByTestId('al-coordinator_name').fill('คุณวิภา ใจดี');
    await page.getByTestId('al-office_phone').fill('02-555-0101');
    await page.getByTestId('al-email').fill('hr-d8@example.com');
    await page.getByTestId('al-signer-name').fill('คุณสมชาย ทรงชัย');
    await page.getByTestId('al-signer-position').fill('ผู้จัดการฝ่ายบุคคล');
    await page.getByTestId('al-signed-date').fill(today);

    const generated = page.waitForResponse(
      (r) => r.url().includes('/public/acceptance/acceptance-form') && r.request().method() === 'POST'
    );
    await page.getByTestId('al-generate').click();
    expect((await generated).status()).toBe(200);
    await expect(page.getByTestId('al-filled-open')).toContainText('เปิดเอกสาร 2 ที่กรอกแล้ว');
    await expect(page.getByTestId('al-blank-form')).toContainText('ใช้ฟอร์มเปล่าเขียนมือ');
    // สร้างเอกสารไม่ใช่การตอบ — ใบยังรออยู่ ลิงก์ยังไม่ถูกใช้
    expect((await formState(formId)).status).toBe('approved_by_dept_head');
    expect((await tokens(formId))[0].used_at).toBeNull();

    // ขั้นส่ง — ผู้อนุมัติใช้ค่าที่กรอกไว้ ไม่มีช่องให้พิมพ์ซ้ำ
    await expect(page.getByTestId('al-signer-name')).toHaveCount(1);
    // เอกสารหมายเลข 2 ไม่มีช่องวันเริ่มปฏิบัติงาน — หน้าลิงก์ไม่ถามแล้ว (2026-10-10)
    await expect(page.getByTestId('al-start-date')).toHaveCount(0);
    await page.getByTestId('al-evidence').setInputFiles(PDF_FIXTURE);
    await page.getByTestId('al-submit').click();
    await expect(page.getByRole('dialog')).toContainText('คุณสมชาย ทรงชัย');
    await page.getByTestId('al-confirm').click();
    await expect(page.getByTestId('al-done')).toContainText('ได้รับการตอบรับแล้ว');

    const saved = await dbRow<{ status: string; signer: string; source: string }>(
      'SELECT status, acceptance_signer_name AS signer, acceptance_source AS source FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(saved).toEqual({ status: 'pending_officer_approval', signer: 'คุณสมชาย ทรงชัย', source: 'link' });
    // ช่องผู้ประสานงานที่พิมพ์บนหน้าลิงก์ไปกับคำตอบและถูกเก็บบนใบ (ช่องที่เว้นว่างไม่ถูกส่ง · ผู้อนุมัติไม่เก็บซ้ำ)
    expect(await dbValue('SELECT acceptance_form_fill FROM intent_forms WHERE form_id = $1', [formId])).toEqual({
      coordinator_name: 'คุณวิภา ใจดี',
      office_phone: '02-555-0101',
      email: 'hr-d8@example.com',
    });

    // ลิงก์ถัดไป (เจ้าหน้าที่ตีกลับ → นักศึกษาส่งลิงก์ใหม่) บนเบราว์เซอร์เดิม — ค่าที่จำไว้ไม่ผูกกับ token
    await officerReturnsAcceptance(request, formId, 'ตราประทับไม่ชัดเจน');
    expect((await send(request, formId)).status()).toBe(200);
    await page.goto(`/accept?token=${(await tokens(formId)).at(-1)!.token}`);
    await page.getByTestId('al-decision-accept').check();
    await expect(page.getByTestId('al-coordinator_name')).toHaveValue('คุณวิภา ใจดี');
    await expect(page.getByTestId('al-office_phone')).toHaveValue('02-555-0101');
    await expect(page.getByTestId('al-email')).toHaveValue('hr-d8@example.com');
    await expect(page.getByTestId('al-signer-name')).toHaveValue('คุณสมชาย ทรงชัย');
    await expect(page.getByTestId('al-signer-position')).toHaveValue('ผู้จัดการฝ่ายบุคคล');
    // ⛔ ไม่จำวันที่ ไฟล์ หรือข้อมูลของนักศึกษา
    await expect(page.getByTestId('al-signed-date')).toHaveValue('');
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(stored).not.toContain(today);
    expect(stored).not.toContain('student2');
  });

  test('D8b: การ์ดนักศึกษา — เลยกำหนด = บอกทางเลือก ไม่มีปุ่มส่งซ้ำ · โควตาครบไม่ส่งไปหาเจ้าหน้าที่ · ใบที่ระบบปิดใช้หัวข้อเป็นกลาง', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedIntent();
    await walkToSigned(request, formId);
    const today = await todayTh();
    const card = page.getByTestId('status-card');

    // ก่อนส่ง: บอกว่านาฬิกาของบริษัทเริ่มเมื่อส่งอีเมล
    await loginAs(page, 'student2');
    await expect(card).toHaveAttribute('data-state', 'send');
    await expect(page.getByTestId('due-clock-note')).toContainText('เริ่มนับเมื่อคุณส่งอีเมล');

    // ส่งแล้ว ยังไม่เลยกำหนด: รอ + ส่งซ้ำได้
    expect((await send(request, formId)).status()).toBe(200);
    await page.reload();
    await expect(card).toHaveAttribute('data-state', 'wait-company');
    await expect(card).toContainText('ไม่ต้องทำอะไรตอนนี้');
    await expect(page.getByTestId('company-mail-resend-open')).toBeVisible();

    // เลยกำหนด: ลิงก์ตายแล้ว — เลิกบอกว่าไม่ต้องทำอะไร · ไม่มีปุ่มส่งซ้ำ (เซิร์ฟเวอร์ 409) · สองทางเลือกยังอยู่
    await setDue(formId, shift(today, -2));
    await page.reload();
    await expect(card).toHaveAttribute('data-state', 'wait-company');
    await expect(card).not.toContainText('ไม่ต้องทำอะไรตอนนี้');
    await expect(page.getByTestId('link-expired-note')).toContainText('ลิงก์ในอีเมลจึงใช้ไม่ได้');
    await expect(card).toContainText('สิ่งที่ต้องทำตอนนี้');
    await expect(page.getByTestId('company-mail-resend-open')).toHaveCount(0);
    // โควตายังเหลือ 2 ครั้ง แต่ส่งไม่ได้แล้ว — ห้ามบอกว่า "ส่งได้อีก" ขัดกับหัวการ์ด (เจอตอนเปิดดูหน้าจอจริง 2026-10-08)
    await expect(page.getByTestId('company-mail-status')).toContainText('ส่งถึง');
    await expect(card).not.toContainText('ส่งได้อีก');
    await expect(page.getByTestId('proof-open')).toBeVisible();
    await expect(page.getByTestId('fail-open')).toBeVisible();

    // โควตาครบ: ทางออกคือกระดาษ ไม่ใช่เจ้าหน้าที่ (เจ้าหน้าที่ไม่มีปุ่มรีเซ็ต/ส่งแทน)
    await setDue(formId, shift(today, 5));
    await dbExec('UPDATE intent_forms SET company_mail_count = 3 WHERE form_id = $1', [formId]);
    await page.reload();
    const limit = page.getByTestId('company-mail-limit');
    await expect(limit).toContainText('ส่งครบ 3 ครั้งแล้ว');
    await expect(limit).toContainText('บริษัทคืนเอกสารตอบรับมาที่ฉัน');
    await expect(limit).not.toContainText('ติดต่อเจ้าหน้าที่');
    const full = await send(request, formId, 'hr-fourth@example.com');
    expect(full.status()).toBe(429);
    expect((await full.json()).message as string).not.toContain('ติดต่อเจ้าหน้าที่');

    // ใบถูกปิด (ระบบปิดเอง = มีเหตุผล): หัวข้อเป็นกลาง + กล่องเหตุผล + ทางไปต่อ
    await dbExec(
      `UPDATE intent_forms SET status = 'rejected', reject_reason = 'ระบบปิดคำร้องนี้ เพราะพ้นกำหนดส่งแบบตอบรับ' WHERE form_id = $1`,
      [formId]
    );
    await page.reload();
    await expect(card).toHaveAttribute('data-state', 'rejected');
    await expect(card).toContainText('ปิดแล้ว เลือกที่ฝึกงานใหม่ได้เลย');
    await expect(card).not.toContainText('คุณแจ้งว่า');
    await expect(card).toContainText('เหตุผล: ระบบปิดคำร้องนี้');
    await expect(page.getByTestId('status-primary')).toContainText('หาที่ฝึกงานใหม่');
  });
});
