import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { approveIntentThroughOfficer, completeDispatchPrep, coverLetterDocId, deanSign, submitRequestToDirectoryCompany } from '../helpers/intent';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRow, dbRows, dbValue } from '../helpers/db';
import { newStudent, putEvent, putForm, today, twoSemesters } from '../helpers/semesters';

/**
 * วงจรภาคเรียน เฟส 1–2 (`.system_memory/design_semester_lifecycle.md`)
 *
 * ⛔ สิ่งที่คุม:
 *   · นำเข้ารายชื่อเข้า "ภาคที่เลือก" ได้ · ถอดได้เฉพาะคนที่ยังไม่มีใบ · ยกยอดเฉพาะคนที่ภาคเดิมไม่ได้ที่ฝึก
 *     และ **ไม่แตะใบ/รายชื่อของภาคเดิม** (R1-1 R1-2)
 *   · หน้าแรกเจ้าหน้าที่ไม่ทิ้งภาคเก่าที่ยังมีเรื่องค้าง — ภาคที่ไม่มีอะไรค้างไม่โผล่ (R1-3)
 *   · `intent_stage_events` ถูกเขียนที่จุดเปลี่ยนสถานะจริงทุกจุด และอายุที่ค้างบนแดชบอร์ด "นักศึกษาตอนนี้"
 *     อ่านจากมัน — **ไม่มีแถว = "ไม่ทราบ" ไม่ใช่ 0 วัน** (R2-1)
 *   · สรุปภาคเรียน: ตัวเลขเทียบภาคก่อนถูก · เวลาต่อขั้นนับเฉพาะใบที่รู้เวลาทั้งสองปลาย · เฉพาะเจ้าหน้าที่ (R2-2)
 *
 * C1 นำเข้าเข้าภาคที่เลือก · C2 รายชื่อรุ่น API · C3 ยกยอด · C4 เส้นทางจริง→เหตุการณ์ครบ · C5 พี่เลี้ยง/ยกเลิก→เหตุการณ์
 * C6 อายุที่ค้างอ่านจากเหตุการณ์ · C7 หน้าแรกภาคก่อน · C8 สรุปภาคเรียน API · C9 หน้าจอ (รุ่น · สรุป · นำเข้า)
 */

const evidence = () => ({
  name: 'acceptance.pdf',
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
});

const MENTOR = { name: 'สุรเดช ใจดี', email: 'suradech-c4@example.com', phone: '0812223333', start_date: '2026-11-02' };

const stagesOf = async (formId: number): Promise<string[]> =>
  (await dbRows<{ stage: string }>('SELECT stage FROM intent_stage_events WHERE form_id = $1 ORDER BY event_id', [formId])).map((r) => r.stage);

const importCsv = (request: APIRequestContext, codes: string[], semesterId?: number | string) =>
  request.post(`${API_URL}/students/import`, {
    data: {
      csv: `student_code,cumulative_gpa,email\n${codes.map((c) => `${c},3.00,${c.toLowerCase()}@example.com`).join('\n')}\n`,
      ...(semesterId === undefined ? {} : { semester_id: String(semesterId) }),
    },
  });

const cohortOf = (semesterId: number) =>
  dbRows<{ student_code: string; source: string }>(
    'SELECT student_code, source FROM semester_cohort WHERE semester_id = $1 ORDER BY student_code',
    [semesterId]
  );

test.describe('วงจรภาคเรียน เฟส 1–2', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('C1: นำเข้ารายชื่อเข้าภาคที่เลือก · ไม่ระบุ = ภาคที่เปิดอยู่ · ภาคที่ไม่มี 400 · บันทึกที่มา', async ({ request }) => {
    const { a, b } = await twoSemesters();
    await apiLoginAs(request, 'staff1');

    const toB = await importCsv(request, ['IMP-B1', 'IMP-B2'], b);
    expect(toB.status(), await toB.text()).toBe(200);
    expect((await toB.json()).summary.semesterId).toBe(b);
    expect(await cohortOf(b)).toEqual([
      { student_code: 'IMP-B1', source: 'import' },
      { student_code: 'IMP-B2', source: 'import' },
    ]);
    expect(await cohortOf(a)).toEqual([]);

    const toActive = await importCsv(request, ['IMP-A1']);
    expect(toActive.status(), await toActive.text()).toBe(200);
    expect(await cohortOf(a)).toEqual([{ student_code: 'IMP-A1', source: 'import' }]);

    const bad = await importCsv(request, ['IMP-X'], 987654);
    expect(bad.status()).toBe(400);
    expect((await bad.json()).message).toContain('ภาคเรียน');
    const notNumber = await importCsv(request, ['IMP-X'], 'abc');
    expect(notNumber.status()).toBe(400);
    // ปฏิเสธก่อนเขียนอะไร — ไม่มีแถวค้างในรายชื่อกลาง
    expect(await dbValue<number>(`SELECT COUNT(*)::int FROM eligible_students_list WHERE student_code = 'IMP-X'`)).toBe(0);
  });

  test('C2: รายชื่อรุ่น — เจ้าหน้าที่เท่านั้น · ถอดได้เฉพาะคนที่ยังไม่มีใบ · ลง audit', async ({ request }) => {
    const { a } = await twoSemesters();
    const free = await newStudent();
    const withForm = await newStudent();
    await dbExec(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, $2), ($1, $3), ($1, 'GHOST-1')`, [a, free.code, withForm.code]);
    await putForm(withForm.email, a, 'pending_advisor');

    for (const account of ['student2', 'advisor1', 'head1'] as const) {
      await apiLoginAs(request, account);
      expect((await request.get(`${API_URL}/semesters/${a}/cohort`)).status(), `${account} list`).toBe(403);
      expect((await request.delete(`${API_URL}/semesters/${a}/cohort/${free.code}`)).status(), `${account} delete`).toBe(403);
      expect((await request.post(`${API_URL}/semesters/${a}/cohort/carry-over`, { data: { from_semester_id: 2 } })).status(), `${account} carry`).toBe(403);
    }
    expect(await cohortOf(a)).toHaveLength(3);

    await apiLoginAs(request, 'staff1');
    const list = (await (await request.get(`${API_URL}/semesters/${a}/cohort`)).json()).members as {
      student_code: string;
      has_form: boolean;
      first_name: string | null;
    }[];
    expect(list.map((m) => [m.student_code, m.has_form])).toEqual(
      [[free.code, false], [withForm.code, true], ['GHOST-1', false]].sort((x, y) => String(x[0]).localeCompare(String(y[0])))
    );
    // คนที่ยังไม่เข้าระบบไม่มีชื่อ — ไม่แต่งชื่อให้
    expect(list.find((m) => m.student_code === 'GHOST-1')?.first_name).toBeNull();

    // มีใบแล้วถอดไม่ได้ (409) · ไม่มีในรุ่น 404 · ถอดคนที่ไม่มีใบได้
    const blocked = await request.delete(`${API_URL}/semesters/${a}/cohort/${withForm.code}`);
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).message).toContain('ใบคำร้อง');
    expect((await request.delete(`${API_URL}/semesters/${a}/cohort/NOT-THERE`)).status()).toBe(404);
    expect((await request.delete(`${API_URL}/semesters/${a}/cohort/GHOST-1`)).status()).toBe(200);
    expect((await cohortOf(a)).map((m) => m.student_code)).toEqual([free.code, withForm.code].sort());

    await expect
      .poll(async () => dbValue<number>(`SELECT COUNT(*)::int FROM audit_log WHERE action = 'semester.cohort_removed'`), { timeout: 10_000 })
      .toBe(1);
  });

  test('C3: ยกยอด — เอาเฉพาะคนที่ภาคเดิมไม่ได้ที่ฝึก · ไม่แตะภาคเดิม · ซ้ำไม่เพิ่ม · ลง audit', async ({ request }) => {
    const { a, b } = await twoSemesters();
    // ภาค b = ต้นทาง · ภาค a (ที่เปิดอยู่) = ปลายทาง
    const noForm = await newStudent(); // ในรุ่นแต่ไม่ได้ยื่น → ยกยอด
    const rejected = await newStudent(); // บริษัทไม่รับ → ยกยอด (ไม่อยู่ในรุ่นก็นับจากใบ)
    const inFlight = await newStudent(); // ใบยังเดินอยู่ → ไม่ยก
    const accepted = await newStudent(); // ได้ที่ฝึกแล้ว → ไม่ยก
    const placedElsewhere = await newStudent(); // ได้ที่ฝึกในอีกภาค → ไม่ยก
    const already = await newStudent(); // อยู่ในรุ่นปลายทางแล้ว → ไม่ซ้ำ
    await dbExec(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, $2), ($1, $3), ($1, $4), ($1, $5)`, [
      b, noForm.code, inFlight.code, placedElsewhere.code, already.code,
    ]);
    await dbExec(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, $2)`, [a, already.code]);
    const formRejected = await putForm(rejected.email, b, 'company_rejected');
    const formInFlight = await putForm(inFlight.email, b, 'pending_officer_request');
    const formAccepted = await putForm(accepted.email, b, 'accepted');
    await putForm(placedElsewhere.email, a, 'accepted');

    await apiLoginAs(request, 'staff1');
    expect((await request.post(`${API_URL}/semesters/${a}/cohort/carry-over`, { data: {} })).status()).toBe(400);
    expect((await request.post(`${API_URL}/semesters/${a}/cohort/carry-over`, { data: { from_semester_id: a } })).status()).toBe(400);
    expect((await request.post(`${API_URL}/semesters/${a}/cohort/carry-over`, { data: { from_semester_id: 987654 } })).status()).toBe(404);
    expect((await cohortOf(a)).map((m) => m.student_code)).toEqual([already.code]);

    const preview = await request.get(`${API_URL}/semesters/${a}/cohort/carry-over?from=${b}`);
    expect((await preview.json()).candidates).toBe(2);
    expect((await cohortOf(a)).map((m) => m.student_code)).toEqual([already.code]); // ดูตัวเลขเฉย ๆ ไม่เขียน

    const res = await request.post(`${API_URL}/semesters/${a}/cohort/carry-over`, { data: { from_semester_id: b } });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).added).toBe(2);
    expect(await cohortOf(a)).toEqual(
      [
        { student_code: noForm.code, source: 'carry_over' },
        { student_code: rejected.code, source: 'carry_over' },
        { student_code: already.code, source: 'import' }, // ที่มาเดิมไม่ถูกทับ
      ].sort((x, y) => x.student_code.localeCompare(y.student_code))
    );

    // ภาคต้นทางไม่ถูกแตะ: รุ่นเดิม · ใบเดิมสถานะเดิม
    expect(await cohortOf(b)).toHaveLength(4);
    for (const [id, status] of [[formRejected, 'company_rejected'], [formInFlight, 'pending_officer_request'], [formAccepted, 'accepted']] as const) {
      expect(await dbRow('SELECT semester_id, status FROM intent_forms WHERE form_id = $1', [id])).toEqual({ semester_id: b, status });
    }

    // กดซ้ำ = ไม่เพิ่ม
    expect((await (await request.post(`${API_URL}/semesters/${a}/cohort/carry-over`, { data: { from_semester_id: b } })).json()).added).toBe(0);
    await expect
      .poll(async () => dbValue<number>(`SELECT COUNT(*)::int FROM audit_log WHERE action = 'semester.cohort_carried_over'`), { timeout: 10_000 })
      .toBe(2);
  });

  test('C4: เส้นทางจริงของใบ → เหตุการณ์ครบทุกจุด เรียงตามเวลา (ยื่น · รับ · คณบดี · ส่งเมล · ตอบรับ · ตีกลับ · ยืนยัน · หนังสือส่งตัว)', async ({ page, request }) => {
    test.setTimeout(240_000);
    const { a } = await twoSemesters();

    // ยื่นคำร้องผ่านหน้าจอจริง → form_created
    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');
    await submitRequestToDirectoryCompany(page);
    await expect.poll(async () => dbValue<number>(`SELECT COUNT(*)::int FROM intent_forms WHERE semester_id = $1`, [a]), { timeout: 15_000 }).toBe(1);
    const formId = (await dbValue<number>('SELECT form_id FROM intent_forms ORDER BY form_id DESC LIMIT 1'))!;
    expect(await stagesOf(formId)).toEqual(['form_created']);

    await approveIntentThroughOfficer(request, formId); // request_uploaded → officer_approved
    await deanSign(request, await coverLetterDocId()); // dean_signed
    await dbExec(`UPDATE companies SET email = 'hr-c4@example.com' WHERE company_id = (SELECT company_id FROM intent_forms WHERE form_id = $1)`, [formId]);

    await apiLoginAs(request, 'student2');
    const mail = await request.post(`${API_URL}/intents/${formId}/send-to-company`, { data: { company_email: 'hr-c4@example.com' } });
    expect(mail.status(), await mail.text()).toBe(200); // mail_sent

    const todayStr = await today();
    const uploadSigned = async () =>
      request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
        multipart: { evidence: evidence(), ...MENTOR, signer_name: 'คุณสมชาย', signer_position: 'ผู้จัดการ', signed_date: todayStr },
      });
    expect((await uploadSigned()).status()).toBe(200); // acceptance_submitted

    await apiLoginAs(request, 'staff1');
    const returned = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, { data: { action: 'rejected', reason: 'ลายเซ็นไม่ชัด' } });
    expect(returned.status(), await returned.text()).toBe(200); // acceptance_returned

    await apiLoginAs(request, 'student2');
    expect((await uploadSigned()).status()).toBe(200); // acceptance_submitted (รอบสอง)

    await apiLoginAs(request, 'staff1');
    expect((await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, { data: { action: 'accepted' } })).status()).toBe(200); // accepted
    await completeDispatchPrep();
    const dispatch = await request.post(`${API_URL}/intents/${formId}/dispatch-letter`, {
      // ปฏิทินสหกิจของ seed ไม่ได้ตั้งวันเริ่ม → เจ้าหน้าที่กรอกวันเริ่มในกล่องออกหนังสือส่งตัว
      data: { document_no: 'อว 0656.10/ส่งตัว-c4', end_date: '2027-02-19', start_date: '2026-11-02' },
    });
    expect(dispatch.status(), await dispatch.text()).toBe(200); // dispatch_issued

    expect(await stagesOf(formId)).toEqual([
      'form_created', 'request_uploaded', 'officer_approved', 'dean_signed', 'mail_sent',
      'acceptance_submitted', 'acceptance_returned', 'acceptance_submitted', 'accepted', 'dispatch_issued',
    ]);
    // เวลาไม่ย้อนหลัง
    const times = (await dbRows<{ t: string }>('SELECT entered_at::text AS t FROM intent_stage_events WHERE form_id = $1 ORDER BY event_id', [formId])).map((r) => r.t);
    expect([...times].sort()).toEqual(times);
  });

  test('C5: ระบุพี่เลี้ยง → mentor_set · นักศึกษายกเลิก → exited · เจ้าหน้าที่ตีกลับคำร้อง → request_returned', async ({ request }) => {
    const { a } = await twoSemesters();

    // ระบุพี่เลี้ยง (ใบที่ตอบรับแล้วและยังไม่มีพี่เลี้ยง — ระบุได้ที่ขั้นนี้ขั้นเดียว)
    const formId = await putForm('student2@test.com', a, 'accepted');
    await apiLoginAs(request, 'student2');
    const mentor = await request.post(`${API_URL}/intents/${formId}/mentor`, {
      data: { name: 'สมศักดิ์ พี่เลี้ยง', email: 'mentor-c5@example.com', phone: '0811112222' },
    });
    expect(mentor.status(), await mentor.text()).toBe(200);
    expect(await stagesOf(formId)).toEqual(['mentor_set']);

    // นักศึกษายกเลิก (ไม่ผ่านสัมภาษณ์ ฯลฯ) — คนละภาคกับใบข้างบน (หนึ่งคนมีใบที่เดินอยู่ได้ใบเดียวต่อภาค)
    const { b } = await twoSemesters();
    const f2 = await putForm('student2@test.com', b, 'approved_by_dept_head');
    const fail = await request.post(`${API_URL}/acceptances/student/${f2}/fail`);
    expect(fail.status(), await fail.text()).toBe(200);
    expect(await stagesOf(f2)).toEqual(['exited']);
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [f2])).toBe('rejected');

    // ตีกลับคำร้อง
    const toReturn = await putForm((await newStudent()).email, a, 'pending_officer_request');
    await dbExec(`UPDATE intent_forms SET request_form_path = 'x.pdf' WHERE form_id = $1`, [toReturn]);
    await apiLoginAs(request, 'staff1');
    const ret = await request.patch(`${API_URL}/intents/${toReturn}/officer-reject`, { data: { reason: 'เอกสารไม่ครบ' } });
    expect(ret.status(), await ret.text()).toBe(200);
    expect(await stagesOf(toReturn)).toEqual(['request_returned']);
  });

  test('C6: อายุที่ค้างบนแดชบอร์ดอ่านจากเหตุการณ์ — ไม่มีเหตุการณ์ถอยไปวันสร้างใบ/วันที่ในใบ · ไม่มีเลย = ไม่ทราบ', async ({ request }) => {
    const { a } = await twoSemesters();
    const mk = async (status: string, extra = '') => {
      const s = await newStudent();
      const id = await putForm(s.email, a, status);
      await dbExec(`UPDATE intent_forms SET created_at = NOW() - INTERVAL '20 days' ${extra} WHERE form_id = $1`, [id]);
      return id;
    };

    // รอเจ้าหน้าที่รับคำร้อง: เหตุการณ์ 3 วันก่อน (ใบสร้างเมื่อ 20 วันก่อน) → ค้าง 3 ไม่ใช่ 20
    const waiting = await mk('pending_officer_request');
    await putEvent(waiting, 'form_created', 20);
    await putEvent(waiting, 'request_uploaded', 3);
    // ใบเก่าไม่มีเหตุการณ์อัปโหลด → ถอยไปวันสร้างใบ = 20
    await mk('pending_officer_request');
    // รอเจ้าหน้าที่ยืนยันแบบตอบรับ: นับจากวันที่ได้แบบตอบรับเท่านั้น — พี่เลี้ยงไม่เกี่ยวกับขั้นนี้แล้ว
    // (ใบที่สองมีพี่เลี้ยงและเหตุการณ์ mentor_set ค้างจากทางเก่า ต้องไม่ถูกนับเป็นอายุ)
    const noMentor = await mk('pending_officer_approval');
    await putEvent(noMentor, 'acceptance_submitted', 6);
    const withMentor = await mk('pending_officer_approval');
    await dbExec(`UPDATE intent_forms SET mentor_id = (SELECT user_id FROM users WHERE email = 'mentor1@test.com') WHERE form_id = $1`, [withMentor]);
    await putEvent(withMentor, 'acceptance_submitted', 8);
    await putEvent(withMentor, 'mentor_set', 2);
    // ไม่มีเหตุการณ์เลย (ใบเก่า) → ไม่ทราบ
    await mk('pending_officer_approval');

    await apiLoginAs(request, 'staff1');
    const body = await (await request.get(`${API_URL}/staff/pipeline`)).json();
    const stage = (key: string) => body.stages.find((s: { key: string }) => s.key === key);

    // รอเจ้าหน้าที่รับคำร้อง: สองใบ อายุ 3 และ 20 → มัธยฐาน (3+20)/2 ปัดเป็น 12
    expect(stage('await_officer_request').count).toBe(2);
    expect(stage('await_officer_request').known_age).toBe(2);
    expect(stage('await_officer_request').median_age_days).toBe(12);
    // ทั้งสามใบอยู่ขั้นเดียวกัน (ไม่มีขั้น "รอระบุพี่เลี้ยง" แล้ว) · รู้อายุ 2 ใบ = 6 กับ 8 → มัธยฐาน 7
    expect(stage('await_mentor')).toBeUndefined();
    expect(stage('await_officer_accept').count).toBe(3);
    expect(stage('await_officer_accept').known_age).toBe(2);
    expect(stage('await_officer_accept').median_age_days).toBe(7);

    // ใบที่ไม่มีเหตุการณ์และไม่มีวันในใบ = ไม่ทราบ ไม่ใช่ 0 วัน
    expect(body.unknown_age).toBeGreaterThanOrEqual(1);
  });

  test('C7: หน้าแรกเจ้าหน้าที่ — ภาคก่อนที่ยังมีเรื่องค้างต้องไม่หาย · ภาคที่ไม่มีอะไรค้างไม่ขึ้น', async ({ page, request }) => {
    const { a, b } = await twoSemesters();
    await apiLoginAs(request, 'staff1');

    // ยังไม่มีภาคอื่นที่ค้าง → ไม่มีแถว (ไม่แต่งแถวว่าง)
    expect((await (await request.get(`${API_URL}/staff/home`)).json()).other_semesters).toEqual([]);

    // ภาค b: ใบรอผล 1 · กำลังฝึก 1 (ผลประเมินยังไม่ครบ) · ใบที่จบเส้นทางแล้วไม่นับ
    await putForm((await newStudent()).email, b, 'pending_officer_request');
    const onPlacement = await putForm((await newStudent()).email, b, 'accepted');
    await dbExec(`UPDATE intent_forms SET start_date = CURRENT_DATE - 30, end_date = CURRENT_DATE + 30 WHERE form_id = $1`, [onPlacement]);
    await putForm((await newStudent()).email, b, 'company_rejected');
    // ภาค a (ที่เปิดอยู่) มีใบค้าง — ไม่ขึ้นในแถวภาคอื่น
    await putForm((await newStudent()).email, a, 'pending_officer_request');

    const home = (await (await request.get(`${API_URL}/staff/home`)).json()) as {
      other_semesters: { semester_id: number; label: string; closed: boolean; open_forms: number; on_placement: number; evaluations_missing: number }[];
    };
    expect(home.other_semesters).toEqual([
      { semester_id: b, label: 'ภาคเรียนที่ 2/2569', closed: false, open_forms: 1, on_placement: 1, evaluations_missing: 1 },
    ]);

    // ปิดภาค b แล้วเรื่องค้างยังต้องขึ้น (ปิดภาคไม่ใช่การเคลียร์ของ)
    expect((await request.post(`${API_URL}/semesters/${b}/close`)).status()).toBe(200);
    const closed = (await (await request.get(`${API_URL}/staff/home`)).json()).other_semesters;
    expect(closed).toHaveLength(1);
    expect(closed[0].closed).toBe(true);

    // หน้าจอ: แถวขึ้น · กดแล้วไปแดชบอร์ดนักศึกษาตอนนี้ของภาคนั้น
    await loginAs(page, 'staff1');
    const row = page.getByTestId(`staff-home-other-semester-${b}`);
    await expect(row).toContainText('ภาคเรียนที่ 2/2569');
    await expect(row).toContainText('ปิดภาคแล้ว');
    await expect(row).toContainText('ใบรอผล 1 · กำลังฝึก 1 · ผลประเมินยังไม่ครบ 1');
    await page.getByTestId(`staff-home-other-semester-go-${b}`).click();
    await expect(page.getByTestId('student-pipeline')).toBeVisible();
    await expect(page.getByTestId('pipeline-semester')).toHaveValue(String(b));
    await expect(page.getByTestId('pipeline-kpi-total')).toContainText('3');
  });

  test('C8: สรุปภาคเรียน API — ตัวเลขเทียบภาคก่อนถูก · เวลาต่อขั้นนับเฉพาะใบที่รู้ทั้งสองปลาย · สิทธิ์ · พารามิเตอร์ผิด', async ({ request }) => {
    const { a, b } = await twoSemesters();

    // ภาคก่อน (b = 2569/2 อยู่ถัดจาก a = 2569/1? ลำดับใหม่→เก่า: 2569/2 มาก่อน 2569/1) — ใช้ลำดับจริงจากเซิร์ฟเวอร์
    await apiLoginAs(request, 'staff1');
    const order = ((await (await request.get(`${API_URL}/staff/semester-summary`)).json()).semesters as { semester_id: number }[]).map((s) => s.semester_id);
    expect(order).toEqual([b, a]); // 2569/2 ใหม่กว่า 2569/1
    const newer = b;
    const older = a;

    // ภาคเก่า (older): รุ่น 2 · ยื่น 2 · ได้ที่ 1
    const o1 = await newStudent();
    const o2 = await newStudent();
    await dbExec(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, $2), ($1, $3)`, [older, o1.code, o2.code]);
    const fo1 = await putForm(o1.email, older, 'accepted');
    await putForm(o2.email, older, 'company_rejected');
    // ภาคใหม่ (newer): รุ่น 4 (3 + 1 ไม่ยื่น) · ยื่น 3 · ได้ที่ 2 · ใบรอผล 1 · ยื่นช่วงผ่อนผัน 1
    const n = [await newStudent(), await newStudent(), await newStudent(), await newStudent()];
    await dbExec(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, $2)`, [newer, n[3].code]);
    const fn1 = await putForm(n[0].email, newer, 'accepted');
    const fn2 = await putForm(n[1].email, newer, 'accepted');
    const fn3 = await putForm(n[2].email, newer, 'pending_officer_request');
    await dbExec(`UPDATE intent_forms SET submitted_late = TRUE, late_reason = 'ทดสอบ' WHERE form_id = $1`, [fn3]);

    // เวลาต่อขั้น: fn1 ยื่น→อัปโหลด 2 วัน · fn2 ยื่น→อัปโหลด 4 วัน · fn3 มีแค่ยื่น (ไม่มีปลายทาง → ไม่นับ)
    await putEvent(fn1, 'form_created', 10);
    await putEvent(fn1, 'request_uploaded', 8);
    await putEvent(fn2, 'form_created', 10);
    await putEvent(fn2, 'request_uploaded', 6);
    await putEvent(fn3, 'form_created', 10);
    // ภาคเก่า: 1 ใบ 6 วัน
    await putEvent(fo1, 'form_created', 20);
    await putEvent(fo1, 'request_uploaded', 14);

    const res = await request.get(`${API_URL}/staff/semester-summary?semester_id=${newer}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.semester.semester_id).toBe(newer);
    expect(body.previous.semester_id).toBe(older);
    const m = (key: string) => body.metrics.find((x: { key: string }) => x.key === key);
    expect([m('cohort_total').current, m('cohort_total').previous]).toEqual([4, 2]);
    expect([m('submitted').current, m('submitted').previous]).toEqual([3, 2]);
    expect([m('placed').current, m('placed').previous]).toEqual([2, 1]);
    expect([m('placement_rate').current, m('placement_rate').previous]).toEqual([50, 50]);
    expect([m('exited').current, m('exited').previous]).toEqual([0, 1]);
    expect([m('in_flight').current, m('in_flight').previous]).toEqual([1, 0]);
    expect([m('late_forms').current, m('late_forms').previous]).toEqual([1, 0]);
    expect([m('evaluations_complete').current, m('reports_approved').current]).toEqual([0, 0]);

    const d = (key: string) => body.durations.find((x: { key: string }) => x.key === key);
    expect(d('upload')).toMatchObject({ current_median_days: 3, current_n: 2, previous_median_days: 6, previous_n: 1 });
    // ขั้นที่ไม่มีใบไหนรู้เวลาทั้งสองปลาย = null ไม่ใช่ 0
    expect(d('dean')).toMatchObject({ current_median_days: null, current_n: 0 });

    // ภาคที่เก่าที่สุดไม่มีภาคก่อน
    const oldest = await (await request.get(`${API_URL}/staff/semester-summary?semester_id=${older}`)).json();
    expect(oldest.previous).toBeNull();
    expect(oldest.metrics.find((x: { key: string }) => x.key === 'cohort_total').previous).toBeNull();

    // ไม่ระบุภาค = ภาคที่เปิดอยู่
    expect((await (await request.get(`${API_URL}/staff/semester-summary`)).json()).semester.semester_id).toBe(a);
    expect((await request.get(`${API_URL}/staff/semester-summary?semester_id=abc`)).status()).toBe(400);
    expect((await request.get(`${API_URL}/staff/semester-summary?semester_id=987654`)).status()).toBe(404);

    // เฉพาะเจ้าหน้าที่
    for (const account of ['student2', 'advisor1', 'head1', 'dean1'] as const) {
      await apiLoginAs(request, account);
      expect((await request.get(`${API_URL}/staff/semester-summary`)).status(), account).toBe(403);
    }
  });

  test('C9: หน้าจอ — จัดการรุ่น (ถอด · ยกยอด) · สรุปภาคเรียน · เลือกภาคตอนนำเข้า', async ({ page }) => {
    test.setTimeout(180_000);
    const { a, b } = await twoSemesters();
    const free = await newStudent();
    const locked = await newStudent();
    const carry = await newStudent();
    await dbExec(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, $2), ($1, $3), ($4, $5)`, [a, free.code, locked.code, b, carry.code]);
    await putForm(locked.email, a, 'pending_advisor');

    await loginAs(page, 'staff1');
    await goToMenu(page, 'semesters');

    // รุ่นของภาค a: ถอดคนที่ไม่มีใบได้ · คนที่มีใบถูกบอกเหตุผลแทนปุ่ม
    await page.getByTestId(`semester-cohort-${a}`).click();
    const dialog = page.getByRole('dialog');
    await expect(page.getByTestId('cohort-count')).toHaveText('ในรุ่น 2 คน');
    await expect(page.getByTestId(`cohort-locked-${locked.code}`)).toContainText('มีใบคำร้องแล้ว');
    await expect(page.getByTestId(`cohort-remove-${locked.code}`)).toHaveCount(0);
    await page.getByTestId(`cohort-remove-${free.code}`).click();
    await expect(page.getByTestId('cohort-count')).toHaveText('ในรุ่น 1 คน');
    await expect(dialog).toContainText(`ถอด ${free.code} ออกจากรายชื่อรุ่นแล้ว`);

    // ยกยอดจากภาค b (ต้นทางเริ่มต้น = ภาคถัดไปในลำดับ) → 1 คน
    await page.getByTestId('cohort-carry-from').selectOption(String(b));
    await expect(page.getByTestId('cohort-carry-submit')).toContainText('ยกยอด 1 คน');
    await page.getByTestId('cohort-carry-submit').click();
    await expect(dialog).toContainText('ยกยอดเข้ารุ่นแล้ว 1 คน');
    await expect(page.getByTestId('cohort-count')).toHaveText('ในรุ่น 2 คน');
    await expect(page.getByTestId(`cohort-row-${carry.code}`)).toContainText('ยกยอด');
    await expect(page.getByTestId('cohort-carry-none')).toBeVisible();
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(page.getByTestId(`semester-row-${a}`)).toContainText('2 คน');

    // สรุปภาคเรียน
    await goToMenu(page, 'semester_summary');
    await expect(page.getByTestId('semester-summary')).toBeVisible();
    await expect(page.getByTestId('summary-current-cohort_total')).toHaveText('2');
    await expect(page.getByTestId('summary-current-submitted')).toHaveText('1');
    await page.getByTestId('summary-semester').selectOption(String(b));
    await expect(page.getByTestId('summary-current-cohort_total')).toHaveText('1');
    // ภาคก่อนของ b (2569/2) คือ a (2569/1)
    await expect(page.getByTestId('summary-previous-cohort_total')).toHaveText('2');
    await expect(page.getByTestId('summary-duration-current-upload')).toContainText('(n=0)');
    await expect(page.getByTestId('summary-duration-current-upload')).not.toContainText('0 วัน');

    // ส่งออก CSV: ครอบ " ครบ · มี BOM
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('summary-export').click()]);
    const csv = fs.readFileSync((await download.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"นักศึกษาในรุ่น","1","2"');

    // นำเข้ารายชื่อ: เลือกภาคปลายทางได้
    await goToMenu(page, 'import');
    await page.getByTestId('import-target-semester').selectOption(String(b));
    await page.getByText('เพิ่มทีละคน').click();
    await page.getByPlaceholder('เช่น 256410100101-2').fill('IMP-UI-1');
    await page.locator('form button[type="submit"]').click();
    await expect.poll(async () => dbValue<number>(`SELECT COUNT(*)::int FROM semester_cohort WHERE semester_id = $1 AND student_code = 'IMP-UI-1'`, [b]), { timeout: 15_000 }).toBe(1);
    expect(await dbValue<number>(`SELECT COUNT(*)::int FROM semester_cohort WHERE semester_id = $1 AND student_code = 'IMP-UI-1'`, [a])).toBe(0);
  });
});
