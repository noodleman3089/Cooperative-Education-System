import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbValue, mentor1Id, withDb } from '../helpers/db';

/**
 * แดชบอร์ด "นักศึกษาตอนนี้" ของเจ้าหน้าที่ — ท่อสถานะ · ใครถือเรื่อง · ค้างนาน
 *
 * ⛔ สิ่งที่คุม: **ขั้นและคนถือเรื่องต้องตรงกับข้อมูลจริงของใบ** (ตัดสินที่เซิร์ฟเวอร์ที่เดียว)
 *    ถ้าเงื่อนไขเพี้ยน หน้าจอยังดูปกติแต่ชี้ให้ตามผิดคน · และ **อายุที่ไม่รู้ต้องเป็น "ไม่ทราบ" ไม่ใช่ 0 วัน**
 * ⛔ ตัวหารคือรุ่นของภาคเรียน (`semester_cohort`) ∪ คนที่มีใบคำร้องในภาคนั้น — ไม่ใช่ทุกคนใน `students`
 *
 * P1 สิทธิ์ · P2 รุ่นว่าง · P3 ขั้นครบทุกชนิด · P4 อายุที่ค้าง · P5 ตัวกรอง/พารามิเตอร์ผิด
 * P6 นำเข้ารายชื่อ = เข้ารุ่นของภาคที่เปิดอยู่ · P7 หน้าจอ
 */

let seq = 0;

interface Spec {
  /** ไม่ระบุ = นักศึกษาที่ไม่มีใบคำร้อง */
  status?: string;
  /** วันเริ่ม/สิ้นสุดเป็นจำนวนวันจาก "วันนี้" (เวลาไทย) */
  start?: number | null;
  end?: number | null;
  mentor?: boolean;
  dispatch?: boolean;
  accommodation?: boolean;
  /** หนังสือขอความอนุเคราะห์ของใบนี้: ไม่ใส่ = ไม่มี · สถานะ + อายุ (วันที่ออกหนังสือ) */
  cover?: { status: 'pending_sign' | 'signed'; ageDays: number };
  mailAgeDays?: number | null;
  rejectReason?: string;
  createdAgeDays?: number;
  finalReport?: boolean;
  evaluations?: number;
  /** อยู่ในรายชื่อรุ่นของภาคที่เปิดอยู่ */
  inCohort?: boolean;
}

async function semesterId(): Promise<number> {
  return (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1'))!;
}

/** นักศึกษาหนึ่งคน (ใหม่ทุกครั้ง — ใบที่ใช้งานอยู่ได้ใบเดียวต่อภาค) + ใบคำร้องตามที่ระบุ · คืนรหัสนักศึกษา */
async function put(spec: Spec): Promise<string> {
  seq += 1;
  const email = `pipe-student-${seq}@test.com`;
  const code = `6591${String(seq).padStart(4, '0')}`;
  const mentorId = spec.mentor ? await mentor1Id() : null;
  return withDb(async (db) => {
    const user = (await db.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING user_id`, [email])).rows[0]
      .user_id as number;
    await db.query(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [user]);
    // enrollment_year ใหม่พอที่ DeactivationScheduler จะไม่ปิดบัญชีกลางเทสต์
    await db.query(
      `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name)
       VALUES ($1, $2, (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1), 3.00, 2569, $3, 'ทดสอบท่อ')`,
      [user, code, `นักศึกษา${seq}`]
    );
    const sem = await semesterId();
    if (spec.inCohort) {
      await db.query(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [sem, code]);
    }
    if (spec.status) {
      const company = (await db.query('SELECT company_id FROM companies ORDER BY company_id LIMIT 1')).rows[0].company_id as number;
      const docNo = spec.cover ? `ศธ/PIPE-${seq}` : null;
      const today = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`;
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, officer_document_no,
                dispatch_document_no, start_date, end_date, company_mail_sent_at, reject_reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 CASE WHEN $8::int IS NULL THEN NULL ELSE ${today} + $8::int END,
                 CASE WHEN $9::int IS NULL THEN NULL ELSE ${today} + $9::int END,
                 CASE WHEN $10::int IS NULL THEN NULL ELSE NOW() - $10::int * INTERVAL '1 day' END,
                 $11, NOW() - $12::int * INTERVAL '1 day')
        `,
        [
          user, company, sem, spec.status, mentorId, docNo,
          spec.dispatch ? `ส่งตัว/PIPE-${seq}` : null,
          spec.start ?? null, spec.end ?? null, spec.mailAgeDays ?? null,
          spec.rejectReason ?? null, spec.createdAgeDays ?? 1,
        ]
      );
      if (spec.cover) {
        await db.query(
          `INSERT INTO official_documents (document_number, type, student_id, company_id, status, dean_signature_date, created_at)
           VALUES ($1, 'cover_letter', $2, $3, $4::text,
                   CASE WHEN $4::text = 'signed' THEN NOW() - $5::int * INTERVAL '1 day' END,
                   NOW() - $5::int * INTERVAL '1 day')`,
          [docNo, user, company, spec.cover.status, spec.cover.ageDays]
        );
      }
    }
    if (spec.accommodation) await db.query(`INSERT INTO accommodations (student_id, house_no) VALUES ($1, '1')`, [user]);
    if (spec.finalReport) {
      await db.query(
        `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
         VALUES ($1, 'final_reports/pipe.pdf', 'approved', 1, 'advisor')`,
        [user]
      );
    }
    for (const form of ['sahatkit_15', 'sahatkit_16'].slice(0, spec.evaluations ?? 0)) {
      await db.query(
        `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
         VALUES ($1, 'mentor', $2, '{}', 80)`,
        [user, form]
      );
    }
    return code;
  });
}

async function pipeline(request: APIRequestContext, qs = '') {
  const res = await request.get(`${API_URL}/staff/pipeline${qs}`);
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

const stageCount = (body: any, key: string): number => body.stages.find((s: any) => s.key === key).count;
const holderCount = (body: any, holder: string): number => body.holders.find((h: any) => h.holder === holder).count;

test.describe('แดชบอร์ดเจ้าหน้าที่ — นักศึกษาตอนนี้', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('P1: เป็นของเจ้าหน้าที่เท่านั้น', async ({ request }) => {
    expect((await request.get(`${API_URL}/staff/pipeline`)).status()).toBe(401);
    for (const account of ['student1', 'advisor1', 'mentor1', 'dean1', 'head1'] as const) {
      await apiLoginAs(request, account);
      expect((await request.get(`${API_URL}/staff/pipeline`)).status(), `${account} ต้องเปิดไม่ได้`).toBe(403);
    }
  });

  test('P2: รุ่นว่าง = cohort_total 0 และหน้าจอบอกให้ไปนำเข้ารายชื่อ (ไม่แต่งตัวเลข)', async ({ page, request }) => {
    await apiLoginAs(request, 'staff1');
    const body = await pipeline(request);
    expect(body.semester?.is_active).toBe(true);
    expect(body.cohort_total).toBe(0);
    expect(body.kpis).toMatchObject({ total: 0, placed: 0, exited: 0 });
    expect(body.stages.every((s: any) => s.count === 0)).toBe(true);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'pipeline');
    await expect(page.getByTestId('pipeline-empty')).toContainText('ยังไม่มีรายชื่อรุ่นของภาคเรียนนี้');
    await expect(page.getByTestId('pipeline-empty')).toContainText('รายชื่อนักศึกษา & เกรด');
    await expect(page.getByTestId('pipeline-kpi-total')).toHaveCount(0);
  });

  test('P3: ขั้น + คนถือเรื่อง ตรงกับข้อมูลจริงของใบ ครบทุกชนิด · ตัวหาร = รุ่น ∪ คนที่มีใบ', async ({ request }) => {
    // ยังไม่เข้าระบบ: อยู่ในรายชื่อรุ่นแต่ไม่มีแถว students
    const sem = await semesterId();
    await dbExec(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, 'NOT-REGISTERED-1')`, [sem]);

    await put({ inCohort: true }); // ยังไม่ยื่น
    await put({ status: 'pending_advisor' });
    await put({ status: 'pending_officer_request' });
    await put({ status: 'approved_by_dept_head', cover: { status: 'pending_sign', ageDays: 3 } });
    await put({ status: 'approved_by_dept_head', cover: { status: 'signed', ageDays: 5 } });
    await put({ status: 'approved_by_dept_head', cover: { status: 'signed', ageDays: 14 }, mailAgeDays: 12 });
    // เจ้าหน้าที่ตีกลับแบบตอบรับ = นักศึกษาต้องส่งลิงก์ใหม่ (กลับไปขั้นส่งให้บริษัท)
    await put({ status: 'approved_by_dept_head', cover: { status: 'signed', ageDays: 20 }, mailAgeDays: 15, rejectReason: 'ตราประทับไม่ชัด' });
    // ได้แบบตอบรับแล้ว = รอเจ้าหน้าที่ทั้งคู่ — มีหรือไม่มีพี่เลี้ยงไม่เปลี่ยนขั้น (พี่เลี้ยงระบุหลังใบ accepted)
    await put({ status: 'pending_officer_approval' });
    await put({ status: 'pending_officer_approval', mentor: true });
    await put({ status: 'accepted', mentor: true, start: 30, end: 140 }); // ขาดหนังสือส่งตัว → เจ้าหน้าที่
    await put({ status: 'accepted', mentor: true, start: 30, end: 140, dispatch: true }); // ขาดที่พัก → นักศึกษา
    await put({ status: 'accepted', mentor: true, start: 30, end: 140, dispatch: true, accommodation: true }); // ครบ
    await put({ status: 'accepted', mentor: true, start: -10, end: 100, dispatch: true, accommodation: true }); // กำลังฝึก
    await put({ status: 'accepted', mentor: true, start: -120, end: -5, dispatch: true, accommodation: true, evaluations: 1 }); // หลังฝึก ขาดประเมิน
    await put({ status: 'accepted', mentor: true, start: -120, end: -5, dispatch: true, accommodation: true, evaluations: 2 }); // หลังฝึก รอเล่ม
    await put({ status: 'accepted', mentor: true, start: -120, end: -5, dispatch: true, accommodation: true, evaluations: 2, finalReport: true }); // ครบ
    await put({ status: 'company_rejected' });
    await put({ status: 'rejected' });

    await apiLoginAs(request, 'staff1');
    const body = await pipeline(request);
    const expected: Record<string, number> = {
      not_registered: 1,
      no_intent: 1,
      await_upload: 1,
      await_officer_request: 1,
      await_dean: 1,
      await_send: 2,
      await_company: 1,
      await_officer_accept: 2,
      accepted_prep: 3,
      on_placement: 1,
      post_placement: 2,
      done: 1,
      exit: 2,
    };
    for (const [key, n] of Object.entries(expected)) expect(stageCount(body, key), key).toBe(n);
    // ทุกขั้นในรายการต้องมีครบ (ขั้นที่ว่างก็ต้องส่งมา = 0 ไม่ใช่หายไป)
    expect(body.stages.map((s: any) => s.key)).toEqual(Object.keys(expected));
    expect(body.cohort_total).toBe(Object.values(expected).reduce((a, b) => a + b, 0));

    // ขั้นเดียวหลายคนถือ: ตอบรับแล้ว = เจ้าหน้าที่ 1 · นักศึกษา 1 · ไม่มีงานค้าง 1
    const prep = body.stages.find((s: any) => s.key === 'accepted_prep');
    expect(prep.holders).toMatchObject({ staff: 1, student: 1, clear: 1 });

    // ใครถือเรื่อง (ไม่นับคนที่ "ครบ")
    expect(holderCount(body, 'staff')).toBe(4); // รอรับคำร้อง · รอยืนยันตอบรับ 2 · ขาดหนังสือส่งตัว
    expect(holderCount(body, 'dean')).toBe(1);
    expect(holderCount(body, 'company')).toBe(2); // รอบริษัท · หลังฝึกขาดประเมิน
    expect(holderCount(body, 'clear')).toBe(2); // เตรียมเอกสารครบ · กำลังฝึก
    expect(holderCount(body, 'student')).toBe(9);

    // ช่องว่างเรื่องพี่เลี้ยงของใบที่ตอบรับแล้ว: ทั้ง 7 ใบมีพี่เลี้ยงที่บัญชีเปิดอยู่ (mentor1 ของ seed)
    const gap = (key: string) => body.gaps.find((g: any) => g.key === key).count;
    expect(gap('no_mentor')).toBe(0);
    expect(gap('mentor_unconfirmed')).toBe(0);

    expect(body.kpis).toMatchObject({ total: body.cohort_total, placed: 7, awaiting_company: 1, exited: 2, no_intent: 2 });
  });

  test('P4: อายุที่ค้างนับจากเวลาจริงของขั้นนั้น · ขั้นที่ไม่มีเวลา = null (ไม่ใช่ 0)', async ({ request }) => {
    await put({ status: 'pending_officer_request', createdAgeDays: 9 });
    await put({ status: 'approved_by_dept_head', cover: { status: 'pending_sign', ageDays: 3 } });
    await put({ status: 'approved_by_dept_head', cover: { status: 'signed', ageDays: 14 }, mailAgeDays: 12 });
    await put({ status: 'approved_by_dept_head', cover: { status: 'signed', ageDays: 14 }, mailAgeDays: 20 });
    await put({ status: 'pending_officer_approval' });
    await put({ status: 'accepted', mentor: true, start: 30, end: 140 });

    await apiLoginAs(request, 'staff1');
    const body = await pipeline(request);
    const stage = (key: string) => body.stages.find((s: any) => s.key === key);

    expect(stage('await_officer_request').median_age_days).toBe(9);
    expect(stage('await_dean').median_age_days).toBe(3);
    expect(stage('await_company').median_age_days).toBe(16); // มัธยฐานของ 12 กับ 20
    expect(stage('await_company').known_age).toBe(2);
    // ⛔ ระบบไม่เก็บเวลาที่นักศึกษาอัปโหลดแบบตอบรับ / ที่เตรียมเอกสาร — ต้องเป็น null ไม่ใช่ 0
    expect(stage('await_officer_accept').median_age_days).toBeNull();
    expect(stage('accepted_prep').median_age_days).toBeNull();

    expect(body.kpis.awaiting_company_overdue).toBe(2); // ค้างเกิน 10 วัน = 12 กับ 20

    // ค้างนานที่สุด: เรียงมากไปน้อย · มีเฉพาะที่รู้อายุและยังมีคนต้องขยับ
    const ages = body.longest.map((r: any) => r.age_days);
    expect(ages).toEqual([20, 12, 9, 3]);
    expect(body.longest[0]).toMatchObject({ stage: 'await_company', holder: 'company' });
    // คนที่ยังมีเรื่องค้างแต่ไม่รู้อายุ (ยืนยันแบบตอบรับ/เตรียมเอกสาร) บอกจำนวน ไม่ซ่อน
    expect(body.unknown_age).toBe(2); // await_officer_accept + accepted_prep (เจ้าหน้าที่ถือทั้งคู่)
  });

  test('P5: ตัวกรองและพารามิเตอร์ผิด', async ({ request }) => {
    await put({ status: 'pending_advisor' });
    await apiLoginAs(request, 'staff1');

    expect((await request.get(`${API_URL}/staff/pipeline?semester_id=abc`)).status()).toBe(400);
    expect((await request.get(`${API_URL}/staff/pipeline?major_id=1.5`)).status()).toBe(400);
    expect((await request.get(`${API_URL}/staff/pipeline?semester_id=999999`)).status()).toBe(404);

    // สาขาที่ไม่มีนักศึกษาในรุ่น → 0 (ไม่ error)
    const none = await pipeline(request, '?major_id=999999');
    expect(none.cohort_total).toBe(0);
    // ภาคอื่นที่ไม่มีรุ่น → 0 · และไม่ปนคนของภาคที่เปิดอยู่
    const other = Number(
      await dbValue<number>(`INSERT INTO coop_semesters (academic_year, semester, is_active) VALUES (2570, '1', FALSE) RETURNING semester_id`)
    );
    const otherBody = await pipeline(request, `?semester_id=${other}`);
    expect(otherBody.cohort_total).toBe(0);
    expect(otherBody.semester.is_active).toBe(false);
    // ภาคที่เปิดใช้งานยังเห็นคนเดิม
    expect((await pipeline(request)).cohort_total).toBe(1);
    // ป้ายภาคเป็น พ.ศ. ทุกภาค (ฐานเก็บปนทั้ง ค.ศ./พ.ศ.)
    expect(otherBody.semesters.map((s: any) => s.label).join(' ')).toMatch(/ภาคเรียนที่ 1\/2570/);
  });

  test('P6: นำเข้ารายชื่อ = เข้ารุ่นของภาคที่เปิดอยู่ (ภาคอื่นไม่ถูกแตะ) · นับเป็น "ยังไม่เข้าระบบ"', async ({ request }) => {
    const sem = await semesterId();
    const old = Number(
      await dbValue<number>(`INSERT INTO coop_semesters (academic_year, semester, is_active) VALUES (2568, '2', FALSE) RETURNING semester_id`)
    );

    await apiLoginAs(request, 'staff1');
    const res = await request.post(`${API_URL}/students/import`, {
      data: { csv: 'student_code,cumulative_gpa,email\nIMP-0001,3.10,imp1@example.com\nIMP-0002,2.90,imp2@example.com\n' },
    });
    expect(res.status(), await res.text()).toBe(200);

    expect(
      await dbValue<string>(`SELECT COUNT(*) FROM semester_cohort WHERE semester_id = $1 AND student_code LIKE 'IMP-%'`, [sem])
    ).toBe('2');
    expect(await dbValue<string>(`SELECT COUNT(*) FROM semester_cohort WHERE semester_id = $1`, [old])).toBe('0');

    // นำเข้าซ้ำไม่เพิ่มแถว (รายชื่อรุ่นไม่ซ้ำ)
    await request.post(`${API_URL}/students/import`, { data: { csv: 'student_code,cumulative_gpa,email\nIMP-0001,3.10,imp1@example.com\n' } });
    expect(await dbValue<string>(`SELECT COUNT(*) FROM semester_cohort WHERE semester_id = $1 AND student_code LIKE 'IMP-%'`, [sem])).toBe('2');

    const body = await pipeline(request);
    expect(stageCount(body, 'not_registered')).toBe(2);
    expect(body.cohort_total).toBe(2);
  });

  test('P7: หน้าจอ — ตัวเลขตรงกับ API · "ไม่ทราบ" ไม่ใช่ 0 วัน · คนที่ครบไม่โผล่ในรายการตามเรื่อง', async ({ page }) => {
    test.setTimeout(120_000);
    const waiting = await put({ status: 'approved_by_dept_head', cover: { status: 'signed', ageDays: 14 }, mailAgeDays: 12 });
    await put({ status: 'pending_officer_approval' });
    await put({ status: 'accepted', mentor: true, start: -120, end: -5, dispatch: true, accommodation: true, evaluations: 2, finalReport: true });
    await put({ status: 'company_rejected' });
    await put({ inCohort: true });

    await loginAs(page, 'staff1');
    await goToMenu(page, 'pipeline');

    await expect(page.getByTestId('pipeline-kpi-total')).toContainText('5');
    await expect(page.getByTestId('pipeline-kpi-placed')).toContainText('1');
    await expect(page.getByTestId('pipeline-kpi-exit')).toContainText('1');
    await expect(page.getByTestId('pipeline-kpi-none')).toContainText('1');
    await expect(page.getByTestId('pipeline-kpi-company')).toContainText('1');

    await expect(page.getByTestId('pipeline-stage-await_company-count')).toHaveText('1');
    await expect(page.getByTestId('pipeline-stage-await_company')).toContainText('ค้าง 12 วัน');
    // ขั้นที่ระบบไม่เก็บเวลา: ต้องบอกว่าไม่ทราบ ไม่ใช่เขียนตัวเลขให้
    await expect(page.getByTestId('pipeline-stage-await_officer_accept')).toContainText('ไม่ทราบว่าค้างนานเท่าไร');
    // ไม่มีขั้น "รอนักศึกษาระบุพี่เลี้ยง" แล้ว — พี่เลี้ยงระบุหลังใบ accepted ไม่ขวางขั้นไหน
    await expect(page.getByTestId('pipeline-stage-await_mentor')).toHaveCount(0);
    // ขั้นที่ว่างต้องยังแสดง (เหตุผลเดียวกับกองงาน 0 บนหน้าแรก)
    await expect(page.getByTestId('pipeline-stage-on_placement')).toContainText('ยังไม่มีใคร');
    // ใครถือเรื่อง: รอบริษัท 1 · นักศึกษา 2 (ออกจากท่อ · ยังไม่ยื่น) · เจ้าหน้าที่ 1 (รอยืนยันแบบตอบรับ) · ครบไม่นับ
    await expect(page.getByTestId('pipeline-holder-company-count')).toContainText('1 คน');
    await expect(page.getByTestId('pipeline-holder-student-count')).toContainText('2 คน');
    await expect(page.getByTestId('pipeline-holder-staff-count')).toContainText('1 คน');

    // ค้างนานที่สุด: มีคนที่รอบริษัท · ไม่มีคนที่ครบ/ออกจากท่อ
    await expect(page.getByTestId(`pipeline-longest-${waiting}`)).toContainText('12 วัน');
    await expect(page.getByTestId(`pipeline-longest-${waiting}`)).toContainText('บริษัท / พี่เลี้ยง');
    await expect(page.getByTestId('pipeline-longest').locator('tbody tr')).toHaveCount(1);

    // กรองสาขาที่ไม่มีใคร → จอว่างบอกเหตุผลเรื่องสาขา (ไม่ใช่หน้าว่างเปล่า)
    const otherMajor = await dbValue<number>('SELECT major_id FROM master_major ORDER BY major_id DESC LIMIT 1');
    const firstMajor = await dbValue<number>('SELECT major_id FROM master_major ORDER BY major_id LIMIT 1');
    if (otherMajor !== firstMajor) {
      await page.getByTestId('pipeline-major').selectOption(String(otherMajor));
      await expect(page.getByTestId('pipeline-empty')).toContainText('ไม่พบนักศึกษาของสาขานี้');
    }
  });
});
