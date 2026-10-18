import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbValue, mentor1Id, withDb } from '../helpers/db';
import { apiLoginAs, loginAs, DEFAULT_PASSWORD, type AccountKey } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import {
  SAMPLE_MENTOR,
  submitRequestToDirectoryCompany,
  approveIntentThroughOfficer,
  completeDispatchPrep,
  coverLetterDocId,
  deanSign,
  officerApprove,
  setCoopStart,
} from '../helpers/intent';
import { putForm, shift } from '../helpers/semesters';

/**
 * ขั้น 9 — เจ้าหน้าที่ปิดใบที่ตอบรับแล้ว (นักศึกษาถูกส่งตัวกลับ / เปลี่ยนที่ฝึก) · 2026-10-11
 *
 * คุม "ใครทำได้ / ใครหลุดด่าน" ก่อนหน้าตา:
 *   R1  ปิดใบ — เจ้าหน้าที่เท่านั้น · ต้องมีเหตุและเหตุผล · เฉพาะใบ `accepted` (SEC-04)
 *   R2  หลังปิด — พี่เลี้ยงเก่าหลุด · ข้อมูลระหว่างฝึกไม่หายสักแถว · สหกิจ 06 กลับเป็น "ยังไม่ส่ง"
 *   R3  ปฏิทินปิดแล้ว — นักศึกษาที่ถูกปิดใบเดินเรื่องที่ใหม่ได้จนจบ · **นักศึกษาคนอื่นโดนด่านทุกจุด**
 *       · ใบใหม่ `accepted` แล้วออกหนังสือส่งตัวไม่ได้จนกว่าส่ง 06 ใหม่ · ระบุพี่เลี้ยงคนใหม่ได้
 *   R3b ช่วงผ่อนผัน + สิทธิ์ผ่าน = ไม่นับเป็นส่งช้า · คนอื่นยังต้องชี้แจงเหตุผล
 *   R4  ตัวปิดใบอัตโนมัติ — ไม่ปิดใบใหม่ของนักศึกษาที่มีสิทธิ์ · ยังปิดใบค้างของคนอื่น
 *   R6  ยกเลิกการปิด — ใบและ 06 กลับมา สิทธิ์ผ่านหาย · 06 ฉบับใหม่ชนะฉบับเก่า · ยื่นใบใหม่แล้ว = 409
 *   R7  ไม่มีที่ใหม่ — ปิดแล้วจบ หน้าแรกนักศึกษายังเปิดได้และบอกเหตุผล
 *   R8  หน้าจอ — เจ้าหน้าที่ปิดใบจากหน้าติดตามเอกสารนักศึกษา · นักศึกษาเห็นการ์ดแล้วยื่นที่ใหม่ · R8b ยกเลิกการปิด
 * (R5 ของใบสั่งรวมอยู่ในท้าย R3)
 *
 * อีเมลไม่ออกเน็ต (`MAIL_DRY_RUN=true` ใน playwright.config.ts) · ข้อมูลทั้งหมดเป็นของปลอม
 */

const PUB = `${API_URL}/public/acceptance`;
const PDF_FIXTURE = path.resolve(__dirname, '../fixtures/mock_official_letter.pdf');
const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const ACTIVE_SEMESTER = '(SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1)';
const FIRST_COMPANY = '(SELECT company_id FROM companies ORDER BY company_id LIMIT 1)';
const CLOSE_REASON = 'สาขาแจ้งตามบันทึกข้อความ: สถานประกอบการปรับลดพนักงาน';

const pdfPart = (name = 'paper.pdf') => ({
  name,
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(PDF_FIXTURE),
});

const todayTh = async () =>
  (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;

const student2Id = async () => (await dbValue<number>(`SELECT ${STUDENT2} AS id`)) as number;

const formRow = (formId: number) =>
  dbRow<{
    status: string;
    reject_reason: string | null;
    closed_kind: string | null;
    closed_accommodation: Record<string, unknown> | null;
    mentor_id: number | null;
    submitted_late: boolean;
  }>(
    `SELECT status, reject_reason, closed_kind, closed_accommodation, mentor_id, submitted_late
       FROM intent_forms WHERE form_id = $1`,
    [formId]
  );

/** ใบ `accepted` ของ student2 ที่ mentor1 ดูแล เริ่มฝึกไปแล้ว 30 วัน */
async function seedAccepted(): Promise<number> {
  const mentorId = await mentor1Id();
  return (await dbValue<number>(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date, end_date)
     VALUES (${STUDENT2}, ${FIRST_COMPANY}, ${ACTIVE_SEMESTER}, 'accepted', $1,
             (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 30, (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 90)
     RETURNING form_id`,
    [mentorId]
  )) as number;
}

/**
 * นักศึกษาอีกคนที่ล็อกอินได้จริงและไม่เคยถูกปิดใบ — ตัวเทียบของทุกด่าน
 * (รหัสผ่านลอก hash ของ student2 · สาขา/ที่ปรึกษาเดียวกัน เพื่อให้ระบบรู้ชื่อผู้ลงนามแบบคำร้อง)
 */
async function makePeer(tag: string): Promise<{ email: string; id: number }> {
  const email = `replacement-peer-${tag}@test.com`;
  const id = await withDb(async (db) => {
    const userId = (
      await db.query(
        `INSERT INTO users (email, password_hash)
         SELECT $1, password_hash FROM users WHERE email = 'student2@test.com' RETURNING user_id`,
        [email]
      )
    ).rows[0].user_id as number;
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [userId]);
    // enrollment_year ใหม่พอที่ DeactivationScheduler จะไม่ปิดบัญชีกลางเทสต์
    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name, advisor_id)
       SELECT $1, $2, s.major_id, 3.00, 2569, 'เพื่อน', $3, s.advisor_id FROM students s WHERE s.student_id = ${STUDENT2}`,
      [userId, `6599${String(userId).padStart(4, '0')}`, `ทดสอบ${tag}`]
    );
    return userId;
  });
  return { email, id };
}

async function loginEmail(request: APIRequestContext, email: string): Promise<void> {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password: DEFAULT_PASSWORD } });
  expect(res.status(), `login failed for ${email}: ${await res.text()}`).toBe(200);
}

/** ตั้งช่วงของกิจกรรมในภาคที่เปิดอยู่ (ลบของเดิมก่อน) — `deadline` ไม่มีวันเริ่ม */
async function setWindow(
  key: string,
  kind: 'range' | 'deadline',
  end: string,
  lateEnd: string | null = null
): Promise<void> {
  await dbExec(
    `DELETE FROM coop_calendar_events WHERE activity_key = $1 AND semester_id = ${ACTIVE_SEMESTER}`,
    [key]
  );
  await dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date, late_end_date)
     VALUES (${ACTIVE_SEMESTER}, $1, $2::varchar, CASE WHEN $2::varchar = 'range' THEN $3::date - 60 END, $3::date, $4::date)`,
    [key, kind, end, lateEnd]
  );
}

/** สามกิจกรรมของการหาที่ฝึก พ้นช่วงไปแล้ว 10 วัน ไม่มีช่วงผ่อนผัน */
async function closePlacementWindows(): Promise<void> {
  const closedOn = shift(await todayTh(), -10);
  await setWindow('intent_submission', 'range', closedOn);
  await setWindow('acceptance_form', 'deadline', closedOn);
  await setWindow('accommodation_plan', 'range', closedOn);
}

const closeAccepted = (request: APIRequestContext, formId: number, data: Record<string, unknown>) =>
  request.post(`${API_URL}/intents/${formId}/close-accepted`, { data });

const reopenAccepted = (request: APIRequestContext, formId: number) =>
  request.post(`${API_URL}/intents/${formId}/reopen-accepted`);

/** เจ้าหน้าที่ปิดใบ (ต้องสำเร็จ) */
async function staffCloses(request: APIRequestContext, formId: number, kind = 'change_company'): Promise<void> {
  await apiLoginAs(request, 'staff1');
  const res = await closeAccepted(request, formId, { kind, reason: CLOSE_REASON });
  expect(res.status(), await res.text()).toBe(200);
}

const newIntentBody = async (placeId: string, extra: Record<string, unknown> = {}) => ({
  is_self_found: true,
  semester_id: await dbValue<number>(`SELECT ${ACTIVE_SEMESTER} AS id`),
  google_place_id: placeId,
  company_name_th: 'บริษัท ที่ฝึกใหม่ จำกัด',
  company_address: '1 ถนนทดสอบ',
  company_province: 'ชลบุรี',
  company_district: 'ศรีราชา',
  company_postal_code: '20110',
  company_phone: '020000000',
  contact_person: 'ผู้รับหนังสือ ทดสอบ',
  contact_position: 'ผู้จัดการฝ่ายบุคคล',
  ...extra,
});

const submitAccommodation = (request: APIRequestContext, studentId: number, houseNo: string) =>
  request.post(`${API_URL}/students/${studentId}/accommodation-plan`, {
    data: {
      accommodation: {
        house_no: houseNo,
        subdistrict: 'บางพระ',
        district: 'ศรีราชา',
        province: 'ชลบุรี',
        postal_code: '20110',
      },
      weekly_plans: [],
    },
  });

const uploadRequestForm = (request: APIRequestContext, formId: number) =>
  request.post(`${API_URL}/intents/${formId}/request-form`, { multipart: { request_form: pdfPart('signed.pdf') } });

const uploadProof = async (request: APIRequestContext, formId: number) =>
  request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
    multipart: {
      evidence: pdfPart('acceptance.pdf'),
      signer_name: 'คุณสมชาย ทรงชัย',
      signer_position: 'ผู้จัดการฝ่ายบุคคล',
      signed_date: await todayTh(),
    },
  });

const sendToCompany = (request: APIRequestContext, formId: number, to: string) =>
  request.post(`${API_URL}/intents/${formId}/send-to-company`, { data: { company_email: to } });

const latestToken = (formId: number) =>
  dbValue<string>(
    `SELECT token FROM acceptance_link_tokens WHERE form_id = $1 ORDER BY token_id DESC LIMIT 1`,
    [formId]
  ) as Promise<string>;

const dashboardOf = async (request: APIRequestContext) =>
  (await request.get(`${API_URL}/students/dashboard`)).json();

const OTHER_ROLES: AccountKey[] = ['student2', 'advisor1', 'head1', 'dean1', 'mentor1'];

test.describe('ขั้น 9 — เจ้าหน้าที่ปิดใบที่ตอบรับแล้ว · นักศึกษาหาที่ฝึกใหม่นอกช่วงปฏิทิน', () => {
  let anon: APIRequestContext;

  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    anon = await playwrightRequest.newContext();
  });

  test.afterEach(async () => {
    await anon.dispose();
  });

  test('R1: ปิดใบ — เจ้าหน้าที่เท่านั้น · ไม่มีเหตุผล/เหตุผิด = 400 · ใบที่ไม่ใช่ accepted = 409 · สำเร็จแล้วใบเป็น superseded พร้อมร่องรอย', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedAccepted();
    const studentId = await student2Id();
    const body = { kind: 'sent_back', reason: CLOSE_REASON };

    for (const role of OTHER_ROLES) {
      await apiLoginAs(request, role);
      expect((await closeAccepted(request, formId, body)).status(), `${role} ต้องปิดใบไม่ได้`).toBe(403);
    }
    expect((await formRow(formId))!.status).toBe('accepted');

    await apiLoginAs(request, 'staff1');
    for (const [label, bad] of [
      ['ไม่มีเหตุผล', { kind: 'sent_back' }],
      ['เหตุผลเป็นช่องว่าง', { kind: 'sent_back', reason: '   ' }],
      ['ไม่มีเหตุ', { reason: CLOSE_REASON }],
      ['เหตุนอกชุด', { kind: 'student_request', reason: CLOSE_REASON }],
    ] as const) {
      expect((await closeAccepted(request, formId, bad)).status(), label).toBe(400);
    }
    expect((await formRow(formId))!.status).toBe('accepted');

    // ใบของอีกคนที่ยังไม่ `accepted` — ทางนี้ปิดไม่ได้ (มีทางปิดของมันเอง)
    const peer = await makePeer('r1');
    const waiting = await putForm(peer.email, (await dbValue<number>(`SELECT ${ACTIVE_SEMESTER} AS id`))!, 'approved_by_dept_head', 5);
    const wrong = await closeAccepted(request, waiting, body);
    expect(wrong.status(), await wrong.text()).toBe(409);
    expect((await wrong.json()).code).toBe('wrong_status');
    expect((await formRow(waiting))!.status).toBe('approved_by_dept_head');

    // หน้า "ติดตามเอกสารนักศึกษา" ก่อนปิด: เจ้าหน้าที่ได้ใบที่ปิดได้
    const rowOf = async () =>
      ((await (await request.get(`${API_URL}/coop-progress/dashboard`)).json()).data as Array<Record<string, any>>).find(
        (r) => r.studentId === studentId
      );
    expect((await rowOf())!.placement).toEqual({
      form_id: formId,
      status: 'accepted',
      closed_kind: null,
      can_reopen: false,
      // ฟิลด์ใหม่จากงานบันทึกข้อความ (c10056b) — ไม่มีบันทึกที่คณบดีอนุมัติ = null
      approved_memo: null,
    });

    const ok = await closeAccepted(request, formId, body);
    expect(ok.status(), await ok.text()).toBe(200);
    const closed = (await formRow(formId))!;
    expect(closed.status).toBe('superseded');
    expect(closed.closed_kind).toBe('sent_back');
    expect(closed.reject_reason).toBe(CLOSE_REASON);

    const staffId = await dbValue<number>("SELECT user_id FROM users WHERE email = 'staff1@test.com'");
    expect(
      await dbRow(`SELECT note, actor_id FROM intent_stage_events WHERE form_id = $1 AND stage = 'closed_by_staff'`, [
        formId,
      ])
    ).toEqual({ note: 'sent_back', actor_id: staffId });
    // writeAudit เป็น fire-and-forget — ลงหลัง response
    await expect
      .poll(() =>
        dbRow(
          `SELECT actor_email, subject_id, detail->>'kind' AS kind, detail->>'reason' AS reason
             FROM audit_log WHERE action = 'intent.closed_by_staff' AND entity_id = $1::text`,
          [formId]
        )
      )
      .toEqual({ actor_email: 'staff1@test.com', subject_id: await student2Id(), kind: 'sent_back', reason: CLOSE_REASON });

    expect((await rowOf())!.placement).toEqual({
      form_id: formId,
      status: 'superseded',
      closed_kind: 'sent_back',
      can_reopen: true,
      approved_memo: null,
    });

    // ปิดซ้ำไม่ได้ — ใบไม่ใช่ accepted แล้ว
    const again = await closeAccepted(request, formId, body);
    expect(again.status(), await again.text()).toBe(409);
  });

  test('R2: หลังปิด — พี่เลี้ยงเก่าไม่เห็นนักศึกษาและรับรองบันทึกไม่ได้ · ข้อมูลระหว่างฝึกเท่าเดิมทุกตาราง · สหกิจ 06 กลับเป็นยังไม่ส่ง', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedAccepted();
    const studentId = await student2Id();
    await completeDispatchPrep();

    const advisorId = await dbValue<number>("SELECT user_id FROM users WHERE email = 'advisor1@test.com'");
    const weeklyLogId = (await dbValue<number>(
      `INSERT INTO weekly_logs (student_id, week_number, assigned_work, status, start_date, end_date)
       VALUES ($1, 1, 'งานสัปดาห์แรก', 'submitted', CURRENT_DATE - 30, CURRENT_DATE - 24) RETURNING weekly_log_id`,
      [studentId]
    )) as number;
    await dbExec(`INSERT INTO report_outlines (student_id, company_id) VALUES ($1, ${FIRST_COMPANY})`, [studentId]);
    await dbExec(
      `INSERT INTO supervision_records (student_id, supervisor_id, company_id, visit_number, visit_date, scores)
       VALUES ($1, $2, ${FIRST_COMPANY}, 1, CURRENT_DATE - 10, '{}'::jsonb)`,
      [studentId, advisorId]
    );
    await dbExec(
      `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
       VALUES ($1, 'mentor', 'sahatkit_15', '{}'::jsonb, 80)`,
      [studentId]
    );

    const counts = () =>
      dbRow(
        `SELECT (SELECT COUNT(*)::int FROM weekly_logs WHERE student_id = $1) AS weekly,
                (SELECT COUNT(*)::int FROM monthly_logs WHERE student_id = $1) AS monthly,
                (SELECT COUNT(*)::int FROM daily_logs WHERE student_id = $1) AS daily,
                (SELECT COUNT(*)::int FROM report_outlines WHERE student_id = $1) AS outlines,
                (SELECT COUNT(*)::int FROM supervision_records WHERE student_id = $1) AS supervision,
                (SELECT COUNT(*)::int FROM final_evaluations WHERE student_id = $1) AS evaluations,
                (SELECT COUNT(*)::int FROM official_documents WHERE student_id = $1) AS documents`,
        [studentId]
      );
    const before = await counts();
    expect(before).toMatchObject({ weekly: 1, outlines: 1, supervision: 1, evaluations: 1 });
    const assignment = () =>
      dbRow('SELECT advisor_id, supervisor_id FROM students WHERE student_id = $1', [studentId]);
    const assignedBefore = await assignment();

    await apiLoginAs(request, 'mentor1');
    const queueBefore = await (await request.get(`${API_URL}/mentor/pending`)).json();
    expect(queueBefore.students.map((s: { student_id: number }) => s.student_id)).toContain(studentId);
    expect(queueBefore.items.some((i: { kind: string; id: number }) => i.kind === 'weekly_log' && i.id === weeklyLogId)).toBe(true);

    await staffCloses(request, formId);

    // ── พี่เลี้ยงเก่าหลุดเอง (ทุกคิวรีพี่เลี้ยงกรอง status = 'accepted') ──
    await apiLoginAs(request, 'mentor1');
    const queueAfter = await (await request.get(`${API_URL}/mentor/pending`)).json();
    expect(queueAfter.students).toEqual([]);
    expect(queueAfter.items).toEqual([]);
    const certify = await request.patch(`${API_URL}/mentor/certify-batch`, {
      data: { items: [{ kind: 'weekly_log', id: weeklyLogId }] },
    });
    expect(certify.status(), await certify.text()).toBe(403);
    expect(
      await dbValue('SELECT mentor_certified_at FROM weekly_logs WHERE weekly_log_id = $1', [weeklyLogId])
    ).toBeNull();

    // ── ไม่มีอะไรถูกลบหรือย้าย ──
    expect(await counts()).toEqual(before);
    expect(await assignment()).toEqual(assignedBefore);
    const closed = (await formRow(formId))!;
    expect(closed.mentor_id, 'mentor_id ของใบเก่าไม่ถูกแตะ').toBe(await mentor1Id());
    expect(
      await dbValue<boolean>("SELECT is_active FROM users WHERE email = 'mentor1@test.com'"),
      'บัญชีพี่เลี้ยงไม่ถูกปิด'
    ).toBe(true);

    // ── สหกิจ 06: แถวจริงหาย เก็บสำเนาไว้บนใบ · ทุกจุดที่ถาม "ส่งแล้วหรือยัง" ตอบว่ายัง ──
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM accommodations WHERE student_id = $1', [studentId])).toBe(0);
    expect(closed.closed_accommodation).toMatchObject({ student_id: studentId, house_no: '99/1' });

    await apiLoginAs(request, 'student2');
    const dash = await dashboardOf(request);
    expect(dash.progress.accommodation_submitted).toBe(false);
    // สำเนาที่อยู่ต้องไม่ออกไปกับ payload ไหน
    expect(JSON.stringify(dash)).not.toContain('closed_accommodation');
  });

  test('R3: ปฏิทินปิดแล้ว — นักศึกษาที่ถูกปิดใบยื่นที่ใหม่ได้จนถึงระบุพี่เลี้ยง · นักศึกษาคนอื่นโดนด่านทุกจุด · หนังสือส่งตัวรอ 06 ฉบับใหม่', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const today = await todayTh();
    const studentId = await student2Id();
    const oldForm = await seedAccepted();
    await completeDispatchPrep();
    await setCoopStart(shift(today, -30));

    // ── เตรียมตัวเทียบสองคนตอนปฏิทินยังเปิด ──
    // waiting = ยื่นแล้วยังไม่เคยอัปโหลดกระดาษ · signed = คณบดีลงนามแล้ว ส่งลิงก์ให้บริษัทแล้ว
    const semesterId = (await dbValue<number>(`SELECT ${ACTIVE_SEMESTER} AS id`))!;
    const waiting = await makePeer('waiting');
    const waitingForm = await putForm(waiting.email, semesterId, 'pending_advisor');
    const signed = await makePeer('signed');
    const signedForm = await putForm(signed.email, semesterId, 'pending_advisor');

    await loginEmail(request, signed.email);
    expect((await uploadRequestForm(request, signedForm)).status()).toBe(200);
    await apiLoginAs(request, 'staff1');
    const approvedPeer = await officerApprove(request, signedForm, { document_no: 'อว 0656.10/เพื่อน-1' });
    expect(approvedPeer.status(), await approvedPeer.text()).toBe(200);
    await deanSign(request, await coverLetterDocId());
    await loginEmail(request, signed.email);
    expect((await sendToCompany(request, signedForm, 'hr-peer@example.com')).status()).toBe(200);
    const peerToken = await latestToken(signedForm);

    await closePlacementWindows();
    await staffCloses(request, oldForm, 'change_company');

    await test.step('นักศึกษาคนอื่น (ไม่ถูกปิดใบ) โดนด่านปฏิทินทุกจุด', async () => {
      await loginEmail(request, waiting.email);
      expect((await dashboardOf(request)).replacement_pass).toBe(false);
      const submit = await request.post(`${API_URL}/intents`, { data: await newIntentBody('place-peer-blocked') });
      expect(submit.status(), await submit.text()).toBe(403);
      expect((await submit.json()).message).toContain('หมดช่วง');
      expect((await uploadRequestForm(request, waitingForm)).status(), 'อัปโหลดกระดาษครั้งแรก').toBe(403);
      expect((await submitAccommodation(request, waiting.id, '5/5')).status(), 'สหกิจ 06').toBe(403);

      await loginEmail(request, signed.email);
      expect((await uploadProof(request, signedForm)).status(), 'อัปโหลดแบบตอบรับ').toBe(403);
      const resend = await sendToCompany(request, signedForm, 'hr-peer-again@example.com');
      expect(resend.status(), await resend.text()).toBe(409);
      expect((await resend.json()).message).toContain('ปฏิทินสหกิจศึกษา');

      const open = await anon.get(`${PUB}?token=${peerToken}`);
      expect(open.status(), await open.text()).toBe(410);
      expect((await open.json()).code).toBe('calendar_closed');
      const accept = await anon.post(`${PUB}/accept?token=${peerToken}`, {
        multipart: {
          evidence: pdfPart('acceptance.pdf'),
          signer_name: 'คุณสมชาย ทรงชัย',
          signer_position: 'ผู้จัดการฝ่ายบุคคล',
          signed_date: today,
        },
      });
      expect(accept.status()).toBe(410);
      expect((await formRow(signedForm))!.status).toBe('approved_by_dept_head');
      expect(await dbValue<number>('SELECT COUNT(*)::int FROM accommodations WHERE student_id = $1', [waiting.id])).toBe(0);
    });

    let newForm = 0;
    await test.step('นักศึกษาที่ถูกปิดใบ: ยื่นคำร้องใหม่ → อัปโหลดกระดาษ → เจ้าหน้าที่รับ → คณบดีลงนาม', async () => {
      await apiLoginAs(request, 'student2');
      const dash = await dashboardOf(request);
      expect(dash.replacement_pass).toBe(true);
      expect(dash.activeIntent).toBeNull();

      const submit = await request.post(`${API_URL}/intents`, { data: await newIntentBody('place-replacement-r3') });
      expect(submit.status(), await submit.text()).toBe(201);
      newForm = (await dbValue<number>(
        `SELECT form_id FROM intent_forms WHERE student_id = $1 AND status = 'pending_advisor'`,
        [studentId]
      ))!;
      expect(newForm).not.toBe(oldForm);

      await approveIntentThroughOfficer(request, newForm, { documentNo: 'อว 0656.10/ที่ใหม่-1' });
      await deanSign(request, await coverLetterDocId());
      // ผ่านด้วยสิทธิ์ = ถือว่าเปิด ไม่ถูกปั๊มว่าส่งช้า
      expect((await formRow(newForm))!.submitted_late).toBe(false);
    });

    await test.step('บริษัทตอบรับทางลิงก์ได้ · เจ้าหน้าที่ตีกลับ · นักศึกษาอัปโหลดแบบตอบรับเองได้', async () => {
      await apiLoginAs(request, 'student2');
      const sent = await sendToCompany(request, newForm, 'hr-new-place@example.com');
      expect(sent.status(), await sent.text()).toBe(200);
      const token = await latestToken(newForm);

      expect((await anon.get(`${PUB}?token=${token}`)).status()).toBe(200);
      const accept = await anon.post(`${PUB}/accept?token=${token}`, {
        multipart: {
          evidence: pdfPart('acceptance.pdf'),
          signer_name: 'คุณสมชาย ทรงชัย',
          signer_position: 'ผู้จัดการฝ่ายบุคคล',
          signed_date: today,
        },
      });
      expect(accept.status(), await accept.text()).toBe(200);
      expect((await formRow(newForm))!.status).toBe('pending_officer_approval');

      await apiLoginAs(request, 'staff1');
      const returned = await request.put(`${API_URL}/acceptances/${newForm}/officer-approve`, {
        data: { action: 'rejected', reason: 'ไฟล์ไม่ชัด ขอฉบับใหม่' },
      });
      expect(returned.status(), await returned.text()).toBe(200);
      expect((await formRow(newForm))!.status).toBe('approved_by_dept_head');

      await apiLoginAs(request, 'student2');
      const proof = await uploadProof(request, newForm);
      expect(proof.status(), await proof.text()).toBe(200);
      expect((await formRow(newForm))!.status).toBe('pending_officer_approval');

      await apiLoginAs(request, 'staff1');
      const accepted = await request.put(`${API_URL}/acceptances/${newForm}/officer-approve`, {
        data: { action: 'accepted' },
      });
      expect(accepted.status(), await accepted.text()).toBe(200);
      expect((await formRow(newForm))!.status).toBe('accepted');
    });

    await test.step('หนังสือส่งตัวออกไม่ได้จนกว่าส่งสหกิจ 06 ใหม่ · ส่งแล้วออกได้ · ระบุพี่เลี้ยงคนใหม่ได้', async () => {
      const dispatch = { document_no: 'อว 0656.10/ส่งตัวใหม่-1', end_date: shift(today, 90) };
      await apiLoginAs(request, 'staff1');
      const blocked = await request.post(`${API_URL}/intents/${newForm}/dispatch-letter`, { data: dispatch });
      expect(blocked.status(), await blocked.text()).toBe(409);
      const blockedBody = await blocked.json();
      expect(blockedBody.code).toBe('prep_incomplete');
      expect(blockedBody.message).toContain('สหกิจ 06');
      expect(blockedBody.message, 'สหกิจ 03 ของเดิมยังใช้ได้').not.toContain('สหกิจ 03');

      await apiLoginAs(request, 'student2');
      const acc = await submitAccommodation(request, studentId, '77/7');
      expect(acc.status(), await acc.text()).toBe(200);
      expect((await dashboardOf(request)).progress.accommodation_submitted).toBe(true);

      await apiLoginAs(request, 'staff1');
      const issued = await request.post(`${API_URL}/intents/${newForm}/dispatch-letter`, { data: dispatch });
      expect(issued.ok(), await issued.text()).toBe(true);

      await apiLoginAs(request, 'student2');
      const mentor = await request.post(`${API_URL}/intents/${newForm}/mentor`, { data: SAMPLE_MENTOR });
      expect(mentor.status(), await mentor.text()).toBe(200);
      const newMentor = (await formRow(newForm))!.mentor_id;
      expect(newMentor).not.toBeNull();
      expect(newMentor).not.toBe(await mentor1Id());
      // ใบเก่ายังปิดอยู่และยังชี้พี่เลี้ยงเดิม (ประวัติ)
      const old = (await formRow(oldForm))!;
      expect(old.status).toBe('superseded');
      expect(old.mentor_id).toBe(await mentor1Id());
    });

    await test.step('กิจกรรมอื่นไม่ถูกยกเว้น — โครงร่างรายงานนอกช่วงยังโดน 403', async () => {
      await setWindow('report_outline', 'range', shift(today, -10));
      await apiLoginAs(request, 'student2');
      const outline = await request.post(`${API_URL}/outlines`, { multipart: { outline: pdfPart('outline.pdf') } });
      expect(outline.status(), await outline.text()).toBe(403);
      expect((await outline.json()).message).toContain('หมดช่วง');
    });
  });

  test('R3b: ช่วงผ่อนผัน — นักศึกษาที่ถูกปิดใบยื่นได้โดยไม่ถูกนับเป็นส่งช้า · คนอื่นยังต้องชี้แจงเหตุผล', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const today = await todayTh();
    const oldForm = await seedAccepted();
    const peer = await makePeer('late');
    await setWindow('intent_submission', 'range', shift(today, -2), shift(today, 5));
    await staffCloses(request, oldForm);

    await loginEmail(request, peer.email);
    const peerSubmit = await request.post(`${API_URL}/intents`, { data: await newIntentBody('place-peer-late') });
    expect(peerSubmit.status(), await peerSubmit.text()).toBe(400);
    expect((await peerSubmit.json()).message).toContain('ช่วงผ่อนผัน');

    await apiLoginAs(request, 'student2');
    const submit = await request.post(`${API_URL}/intents`, { data: await newIntentBody('place-replacement-late') });
    expect(submit.status(), await submit.text()).toBe(201);
    expect(
      await dbRow(
        `SELECT submitted_late, late_reason FROM intent_forms WHERE student_id = ${STUDENT2} AND status = 'pending_advisor'`
      )
    ).toEqual({ submitted_late: false, late_reason: null });
  });

  test('R4: ตัวปิดใบอัตโนมัติ — ไม่ปิดใบใหม่ของนักศึกษาที่ถูกปิดใบ · ยังปิดใบค้างของนักศึกษาคนอื่น', async () => {
    test.setTimeout(120_000);
    // ⛔ ฟังก์ชันนี้รันในโปรเซสของเทสต์และส่งอีเมลแจ้งนักศึกษา — ต้องเป็น dry-run ก่อน import
    expect(process.env.MAIL_DRY_RUN).toBe('true');
    const { runAcceptanceAutoClose } = await import('../../backend/src/utils/acceptanceAutoClose');

    const semesterId = (await dbValue<number>(`SELECT ${ACTIVE_SEMESTER} AS id`))!;
    await putForm('student2@test.com', semesterId, 'superseded');
    const replacement = await putForm('student2@test.com', semesterId, 'approved_by_dept_head', 5);
    const peer = await makePeer('auto');
    const peerForm = await putForm(peer.email, semesterId, 'approved_by_dept_head', 5);

    await setWindow('acceptance_form', 'deadline', shift(await todayTh(), -10));

    expect(await runAcceptanceAutoClose()).toBe(1);
    expect((await formRow(replacement))!.status, 'ใบใหม่ของนักศึกษาที่มีสิทธิ์ต้องไม่ถูกปิด').toBe('approved_by_dept_head');
    expect((await formRow(peerForm))!.status).toBe('rejected');

    // รันซ้ำก็ยังไม่ปิด
    expect(await runAcceptanceAutoClose()).toBe(0);
    expect((await formRow(replacement))!.status).toBe('approved_by_dept_head');
  });

  test('R6: ยกเลิกการปิด — เจ้าหน้าที่เท่านั้น · ใบและ 06 กลับมา สิทธิ์ผ่านปฏิทินหาย · 06 ฉบับใหม่ชนะ · ยื่นใบใหม่แล้ว = 409', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedAccepted();
    const studentId = await student2Id();
    await completeDispatchPrep();
    await closePlacementWindows();
    await staffCloses(request, formId, 'sent_back');

    for (const role of OTHER_ROLES) {
      await apiLoginAs(request, role);
      expect((await reopenAccepted(request, formId)).status(), `${role} ต้องยกเลิกการปิดไม่ได้`).toBe(403);
    }
    expect((await formRow(formId))!.status).toBe('superseded');

    // ธงของหน้า "ติดตามเอกสารนักศึกษา" — เจ้าหน้าที่เท่านั้นที่ได้ฟิลด์นี้ (SEC-10)
    const placementSeenBy = async (role: AccountKey) => {
      await apiLoginAs(request, role);
      const res = await request.get(`${API_URL}/coop-progress/dashboard`);
      expect(res.status(), await res.text()).toBe(200);
      const row = ((await res.json()).data as Array<Record<string, any>>).find((r) => r.studentId === studentId);
      expect(row, `${role} ต้องเห็นแถวของ student2`).toBeTruthy();
      return row!;
    };
    for (const role of ['advisor1', 'head1'] as const) {
      expect(await placementSeenBy(role), `${role} ต้องไม่ได้ฟิลด์ placement`).not.toHaveProperty('placement');
    }
    expect((await placementSeenBy('staff1')).placement).toMatchObject({ form_id: formId, can_reopen: true });

    await apiLoginAs(request, 'student2');
    expect((await dashboardOf(request)).replacement_pass).toBe(true);

    // ── ยกเลิกการปิดครั้งที่ 1: ยังไม่มีอะไรใหม่ → ทุกอย่างกลับมา ──
    await apiLoginAs(request, 'staff1');
    const undone = await reopenAccepted(request, formId);
    expect(undone.status(), await undone.text()).toBe(200);
    expect(await formRow(formId)).toMatchObject({
      status: 'accepted',
      reject_reason: null,
      closed_kind: null,
      closed_accommodation: null,
    });
    expect(
      await dbValue<string>('SELECT house_no FROM accommodations WHERE student_id = $1', [studentId]),
      'สหกิจ 06 ฉบับเดิมกลับมา'
    ).toBe('99/1');
    expect(
      await dbValue<number>(`SELECT COUNT(*)::int FROM intent_stage_events WHERE form_id = $1 AND stage = 'close_undone'`, [formId])
    ).toBe(1);
    await expect
      .poll(() =>
        dbValue<number>(
          `SELECT COUNT(*)::int FROM audit_log WHERE action = 'intent.close_undone' AND entity_id = $1::text`,
          [formId]
        )
      )
      .toBe(1);

    // สิทธิ์ผ่านปฏิทินหายเอง
    await apiLoginAs(request, 'student2');
    const dash = await dashboardOf(request);
    expect(dash.replacement_pass).toBe(false);
    expect(dash.activeIntent.status).toBe('accepted');
    expect((await submitAccommodation(request, studentId, '1/1')).status(), 'กลับมาโดนด่านปฏิทินเหมือนคนอื่น').toBe(403);

    // ยกเลิกซ้ำไม่ได้ — ใบไม่ได้ปิดอยู่
    await apiLoginAs(request, 'staff1');
    const twice = await reopenAccepted(request, formId);
    expect(twice.status(), await twice.text()).toBe(409);
    expect((await twice.json()).code).toBe('wrong_status');

    // ── ปิดอีกรอบ นักศึกษาส่ง 06 ฉบับใหม่ แล้วยกเลิกการปิด → ฉบับใหม่ชนะ ──
    await staffCloses(request, formId, 'sent_back');
    await apiLoginAs(request, 'student2');
    expect((await submitAccommodation(request, studentId, '88/8')).status()).toBe(200);
    await apiLoginAs(request, 'staff1');
    expect((await reopenAccepted(request, formId)).status()).toBe(200);
    expect(await dbValue<string>('SELECT house_no FROM accommodations WHERE student_id = $1', [studentId])).toBe('88/8');
    expect((await formRow(formId))!.closed_accommodation).toBeNull();

    // ── ปิดอีกรอบ นักศึกษายื่นใบใหม่ → ยกเลิกการปิดไม่ได้แล้ว ──
    await staffCloses(request, formId, 'change_company');
    await apiLoginAs(request, 'student2');
    const submit = await request.post(`${API_URL}/intents`, { data: await newIntentBody('place-replacement-r6') });
    expect(submit.status(), await submit.text()).toBe(201);

    expect((await placementSeenBy('staff1')).placement).toMatchObject({
      form_id: formId,
      status: 'superseded',
      closed_kind: 'change_company',
      can_reopen: false,
    });
    const refused = await reopenAccepted(request, formId);
    expect(refused.status(), await refused.text()).toBe(409);
    expect((await refused.json()).code).toBe('replacement_exists');
    expect((await formRow(formId))!.status).toBe('superseded');
  });

  test('R7: ถูกส่งตัวกลับแล้วไม่มีที่ใหม่ — ปิดแล้วจบ · หน้าแรกนักศึกษายังเปิดได้และบอกเหตุกับเหตุผล', async ({
    request,
  }) => {
    const formId = await seedAccepted();
    await staffCloses(request, formId, 'sent_back');

    await apiLoginAs(request, 'student2');
    const res = await request.get(`${API_URL}/students/dashboard`);
    expect(res.status(), await res.text()).toBe(200);
    const dash = await res.json();
    expect(dash.activeIntent).toBeNull();
    expect(dash.closedIntent).toMatchObject({
      form_id: formId,
      status: 'superseded',
      closed_kind: 'sent_back',
      reject_reason: CLOSE_REASON,
    });
    expect(dash.replacement_pass).toBe(true);
  });

  test('R8: หน้าจอ — เจ้าหน้าที่ปิดใบจากหน้าติดตามเอกสารนักศึกษา · นักศึกษาเห็นการ์ดบอกเหตุผลแล้วยื่นที่ใหม่ได้ทั้งที่ปฏิทินปิด · หัวหน้าสาขาไม่มีปุ่ม', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedAccepted();
    await closePlacementWindows();
    const code = (await dbValue<string>(`SELECT student_code FROM students WHERE student_id = ${STUDENT2}`))!;

    // ── หัวหน้าสาขาเปิดหน้าเดียวกันได้ แต่ไม่มีปุ่มปิดใบ (ฟิลด์ไม่ถูกส่งให้) ──
    await loginAs(page, 'head1');
    await goToMenu(page, 'final_progress');
    await expect(page.getByText(code)).toBeVisible();
    await expect(page.getByTestId(`close-accepted-${code}`)).toHaveCount(0);

    // ── เจ้าหน้าที่ปิดใบ ──
    await loginAs(page, 'staff1');
    await goToMenu(page, 'final_progress');
    await page.getByTestId(`close-accepted-${code}`).click();

    const dialog = page.getByTestId('close-accepted-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(code);
    await expect(dialog).toContainText('นักศึกษาต้องส่งแบบแจ้งที่พัก (สหกิจ 06) ใหม่');
    await expect(dialog).toContainText('บันทึกการปฏิบัติงาน โครงร่าง และผลประเมินที่มีอยู่ยังอยู่ครบ');
    const submit = page.getByTestId('close-accepted-submit');
    await expect(submit, 'ยังไม่เลือกเหตุและไม่มีเหตุผล = กดไม่ได้').toBeDisabled();
    await page.getByTestId('close-accepted-kind').selectOption('sent_back');
    await expect(submit, 'มีเหตุแต่ยังไม่มีเหตุผล = กดไม่ได้').toBeDisabled();
    await page.getByTestId('close-accepted-reason').fill(CLOSE_REASON);
    await submit.click();

    await expect(page.getByText('ปิดใบที่ฝึกงานแล้ว นักศึกษายื่นคำร้องขอหนังสือสำหรับที่ใหม่ได้ทันที')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('เจ้าหน้าที่ปิดใบแล้ว (สถานประกอบการส่งตัวกลับ)')).toBeVisible();
    await expect(page.getByTestId(`reopen-accepted-${code}`)).toBeVisible();
    await expect(page.getByTestId(`close-accepted-${code}`)).toHaveCount(0);
    expect(await formRow(formId)).toMatchObject({ status: 'superseded', closed_kind: 'sent_back', reject_reason: CLOSE_REASON });

    // ── นักศึกษา: การ์ดบอกเหตุกับเหตุผล แล้วพาไปยื่นที่ใหม่ ──
    await loginAs(page, 'student2');
    await expect(page.getByText('สถานประกอบการส่งตัวกลับ เจ้าหน้าที่ปิดใบที่ฝึกงานเดิมแล้ว')).toBeVisible();
    await expect(page.getByText(`เหตุผล: ${CLOSE_REASON}`)).toBeVisible();
    await page.getByRole('link', { name: 'ยื่นคำร้องขอหนังสือ' }).click();
    await expect(
      page.getByText('คุณได้รับสิทธิ์ยื่นนอกช่วงปฏิทิน เพราะเจ้าหน้าที่ปิดใบที่ฝึกงานเดิม')
    ).toBeVisible();

    // ปฏิทินยื่นคำร้องปิดไปแล้ว 10 วัน — ยื่นผ่านหน้าจอได้จริง
    await submitRequestToDirectoryCompany(page);
    await expect(
      page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')
    ).toBeVisible();
    expect(
      await dbValue<number>(
        `SELECT COUNT(*)::int FROM intent_forms WHERE student_id = ${STUDENT2} AND status = 'pending_advisor'`
      )
    ).toBe(1);

    // ── นักศึกษายื่นใบใหม่แล้ว เจ้าหน้าที่ไม่มีปุ่มยกเลิกการปิด ──
    await loginAs(page, 'staff1');
    await goToMenu(page, 'final_progress');
    await expect(page.getByText('เจ้าหน้าที่ปิดใบแล้ว (สถานประกอบการส่งตัวกลับ)')).toBeVisible();
    await expect(page.getByTestId(`reopen-accepted-${code}`)).toHaveCount(0);
  });

  test('R8b: หน้าจอ — เจ้าหน้าที่ยกเลิกการปิดใบ ใบกลับเป็นได้ที่ฝึกแล้ว ปุ่มปิดใบกลับมา', async ({ page, request }) => {
    test.setTimeout(120_000);
    const formId = await seedAccepted();
    const code = (await dbValue<string>(`SELECT student_code FROM students WHERE student_id = ${STUDENT2}`))!;
    await staffCloses(request, formId, 'change_company');

    await loginAs(page, 'staff1');
    await goToMenu(page, 'final_progress');
    await expect(page.getByText('เจ้าหน้าที่ปิดใบแล้ว (เปลี่ยนสถานประกอบการ)')).toBeVisible();
    await page.getByTestId(`reopen-accepted-${code}`).click();
    // กล่องระดับ 1 (ถามสั้น) — ต้องบอกว่ากำลังคืนใบของใคร
    const reopenBody = page.getByRole('dialog').locator('[data-level="1"]');
    await expect(reopenBody).toContainText(`(${code}) เป็น ได้ที่ฝึกแล้ว`);
    await page.getByTestId('reopen-accepted-confirm').click();

    await expect(page.getByText('ยกเลิกการปิดแล้ว ใบกลับเป็น "ได้ที่ฝึกแล้ว" ตามเดิม')).toBeVisible();
    await expect(page.getByTestId(`close-accepted-${code}`)).toBeVisible();
    await expect(page.getByTestId(`reopen-accepted-${code}`)).toHaveCount(0);
    expect(await formRow(formId)).toMatchObject({ status: 'accepted', closed_kind: null, reject_reason: null });
  });
});
