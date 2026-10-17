import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';

/**
 * ดูใบ **สหกิจ 03** (ใบสมัครงาน) และ **สหกิจ 06** (แบบแจ้งที่พัก) ในระบบ
 *
 * ⚠️ 2026-10-18 เจ้าของสั่งถอด PDF + ปุ่มพิมพ์ทั้งสองใบ (`…/print` ถูกลบ) — ผู้ตรวจเปิดดูในหน้าจอแทน
 * (`CoopFormsViewModal`) ชื่อไฟล์ยังเป็น `coop-form-print` เพื่อไม่ให้เอกสารที่อ้างชื่อไฟล์เพี้ยน
 *
 * สิ่งที่ชุดนี้คุมเรียงตามความสำคัญ:
 *   1. ⛔⛔ **ใครเปิดใบ สหกิจ 03 ได้** — `GET /students/:id/coop-application` คือ *จุดเดียวในระบบ*
 *      ที่เลขบัตรประชาชน เชื้อชาติ และศาสนาถูกถอดรหัสออกมาเป็นค่าจริง (SEC-12)
 *      เปิดได้เฉพาะเจ้าหน้าที่ · หัวหน้าสาขา · อาจารย์ที่ปรึกษา/นิเทศของนักศึกษาคนนั้น (SEC-06 fail closed)
 *      นักศึกษาเอง · พี่เลี้ยง · คณบดี เปิดไม่ได้
 *   2. **ทุกครั้งที่เปิดต้องมีแถวใน `audit_log`** (`student.coop_application_viewed`) — SEC-07
 *   3. **เส้นทาง `…/print` ต้องไม่มีอยู่แล้ว** — ไม่มี PDF ที่ถอดรหัสค่าจริงออกไปนอกหน้าจอ
 *   4. **สหกิจ 06 ใช้ด่านเดียวกับหน้าอ่านที่พัก** (อาจารย์ที่ไม่ได้ดูแลเปิดไม่ได้)
 *   5. **"ห้อง" ลงคอลัมน์ของ `students` ไม่ใช่ของ `accommodations`** — ฟอร์มจริงถามไว้
 *      ข้าง "ชั้นปีที่" (รอบ 55 เคยเดาผิดว่าเป็นเลขห้องพัก ตอนที่ยังไม่มีไฟล์ `.docx`)
 */

const ADDRESS = {
  section: '4/1',
  house_no: '88/9',
  building: 'ลาดยาวเพลส',
  room_no: '512',
  soi: 'ลาดยาว 7',
  road: 'งามวงศ์วาน',
  subdistrict: 'ลาดยาว',
  district: 'เขตจตุจักร',
  province: 'กรุงเทพมหานคร',
  postal_code: '10900',
  phone: '02-123-4567',
  mobile_phone: '0891234567',
  fax: '02-123-4568',
  email: 'stay@example.com',
  latitude: 13.8459123,
  longitude: 100.5612345,
  emergency_contact: 'นางสมศรี ใจดี',
  emergency_relationship: 'มารดา',
  emergency_phone: '0898765432',
};

const WEEKS = Array.from({ length: 16 }, (_, i) => ({
  week_number: i + 1,
  start_date: '2026-11-02',
  end_date: '2026-11-06',
  tasks: `สัปดาห์ที่ ${i + 1} ทดสอบระบบ`,
}));

const studentId = () =>
  dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'");

/** ใบตอบรับที่ `accepted` — เงื่อนไขของการส่งแบบแจ้งที่พัก และเป็นที่มาของชื่อบริษัทบนใบ */
async function seedAcceptedIntent(): Promise<number> {
  return withDb(async (db) => {
    const sid = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'"))
      .rows[0].user_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      .company_id;

    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date)
       VALUES ($1, $2, $3, 'accepted', (NOW() AT TIME ZONE 'Asia/Bangkok')::date)`,
      [sid, companyId, semesterId]
    );
    return sid as number;
  });
}

const submitAccommodation = (request: APIRequestContext, sid: number) =>
  request.post(`${API_URL}/students/${sid}/accommodation-plan`, {
    data: { accommodation: ADDRESS, weekly_plans: WEEKS },
  });

/** กรอกช่องอ่อนไหวของ สหกิจ 03 ผ่าน API จริง เพื่อให้มีอะไรให้ถอดรหัสตอนพิมพ์ */
async function fillSensitive(request: APIRequestContext): Promise<void> {
  const res = await request.put(`${API_URL}/students/coop-application`, {
    data: {
      national_id: '1234567890123',
      national_id_issued_district: 'เขตจตุจักร',
      national_id_expiry_date: '2031-05-15',
      ethnicity: 'ไทย',
      religion: 'พุทธ',
      sensitive_data_consent: true,
      first_name_en: 'Somchai',
      last_name_en: 'Saidee',
      gender: 'ชาย',
      nationality: 'ไทย',
      language_proficiency: [
        { language: 'ภาษาอังกฤษ', reading: 'ดี', speaking: 'พอใช้', writing: 'ดี' },
      ],
      family_info: {
        father: { name: 'สมศักดิ์ สายดี', age: '52', occupation: 'รับราชการ' },
        siblings: [{ name: 'สมปอง สายดี', age: '25', occupation: 'พนักงานบริษัท' }],
      },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** สหกิจ 03 ฉบับผู้ตรวจ — เส้นทางเดียวที่ค่าจริงของข้อมูลอ่อนไหวออกจากฐาน */
const VIEW_03 = (sid: number) => `${API_URL}/students/${sid}/coop-application`;
const AUDIT_VIEWED = 'student.coop_application_viewed';

const countViewedAudit = async () =>
  Number(await dbValue<string>('SELECT COUNT(*) FROM audit_log WHERE action = $1', [AUDIT_VIEWED]));

test.describe('ดูใบ สหกิจ 03 / 06 ในระบบ', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  // ── ๑. สิทธิ์ของใบ สหกิจ 03 ────────────────────────────────────────────────

  test('F1: ใบ สหกิจ 03 ฉบับผู้ตรวจ — นักศึกษา/พี่เลี้ยง/คณบดี/อาจารย์ที่ไม่ได้ดูแลเปิดไม่ได้', async ({
    request,
  }) => {
    const sid = await studentId();
    await seedAcceptedIntent();

    // ⛔ ฉบับนี้มีชั้น C (เลขบัตร · เชื้อชาติ · ศาสนา) เป็นค่าจริง — ฝั่งสถานประกอบการและตัวนักศึกษาเองเปิดไม่ได้
    //    (นักศึกษาเห็นของตัวเองแบบมาสก์ที่ `GET /students/coop-application` เท่านั้น — ดู F11)
    for (const who of ['student2', 'mentor1', 'dean1', 'advisor2'] as const) {
      await apiLoginAs(request, who);
      const res = await request.get(VIEW_03(sid));
      expect(res.status(), `${who} ต้องเปิดใบ สหกิจ 03 ฉบับผู้ตรวจไม่ได้`).toBe(403);
    }

    // ผู้ตรวจที่มีสิทธิ์: เจ้าหน้าที่ · หัวหน้าสาขาของนักศึกษา · อาจารย์ที่ปรึกษาของนักศึกษาคนนี้
    for (const who of ['staff1', 'head1', 'advisor1'] as const) {
      await apiLoginAs(request, who);
      const res = await request.get(VIEW_03(sid));
      expect(res.status(), `${who}: ${await res.text()}`).toBe(200);
    }
  });

  test('F2: เส้นทาง …/print ของสหกิจ 03 และ 06 ถูกลบแล้ว — ไม่มี PDF ที่ถอดรหัสค่าจริงออกไป', async ({
    request,
  }) => {
    const sid = await studentId();
    await seedAcceptedIntent();

    // ⛔ ตั้งใจไม่ให้มีเส้นทางพิมพ์เหลือเลย ไม่ว่าใครเรียก (เจ้าของสั่ง 2026-10-18)
    for (const who of ['student2', 'staff1'] as const) {
      await apiLoginAs(request, who);
      for (const path of [
        `${API_URL}/students/coop-application/print`,
        `${API_URL}/students/${sid}/coop-application/print`,
        `${API_URL}/students/${sid}/accommodation-plan/print`,
      ]) {
        const res = await request.get(path);
        expect(res.status(), `${who} → ${path} ต้องไม่ใช่เส้นทางที่ใช้งานได้`).toBe(404);
      }
    }
  });

  test('F3: การเปิดใบ สหกิจ 03 ลง audit_log ทุกครั้ง พร้อมบอกว่าถอดรหัสอะไรออกมา — เปิดไม่สำเร็จไม่ลง', async ({
    request,
  }) => {
    const sid = await studentId();
    await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    const before = await countViewedAudit();

    // ถูกปฏิเสธ → ไม่ได้ถอดรหัสอะไรออกไป จึงไม่มีแถว
    await apiLoginAs(request, 'mentor1');
    expect((await request.get(VIEW_03(sid))).status()).toBe(403);

    await apiLoginAs(request, 'staff1');
    const res = await request.get(VIEW_03(sid));
    expect(res.status(), await res.text()).toBe(200);

    // `writeAudit` เป็น fire-and-forget — แถวลงหลัง response จึงต้อง poll
    await expect.poll(countViewedAudit, { timeout: 10_000 }).toBe(before + 1);

    const row = await dbRow<{
      subject_id: number;
      detail: { decrypted: Record<string, boolean> };
    }>(
      `SELECT subject_id, detail FROM audit_log
        WHERE action = $1
        ORDER BY audit_id DESC LIMIT 1`,
      [AUDIT_VIEWED]
    );
    expect(Number(row?.subject_id)).toBe(sid);
    expect(row?.detail.decrypted).toEqual({
      national_id: true,
      ethnicity: true,
      religion: true,
    });

    // เปิดอีกครั้งต้องมีอีกแถว ไม่ใช่นับครั้งเดียว
    await request.get(VIEW_03(sid));
    await expect.poll(countViewedAudit, { timeout: 10_000 }).toBe(before + 2);
  });

  // ── ๒. ตัวไฟล์ ────────────────────────────────────────────────────────────

  test('F4: ใบ สหกิจ 03 ฉบับผู้ตรวจได้ค่าจริงของข้อมูลอ่อนไหว (ไม่ใช่มาสก์) และเปิดได้เมื่อยังไม่ได้กรอกอะไรเลย', async ({
    request,
  }) => {
    const sid = await studentId();
    await apiLoginAs(request, 'staff1');

    // ⛔ ใบที่ยังกรอกไม่ครบต้องเปิดได้ — ผู้ตรวจต้องเห็นว่านักศึกษายังขาดอะไร ไม่ใช่เจอ error
    const blank = await request.get(VIEW_03(sid));
    expect(blank.status(), await blank.text()).toBe(200);
    const blankBody = await blank.json();
    expect(blankBody.national_id).toBeNull();
    expect(blankBody.missing_required.length).toBeGreaterThan(0);

    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    await apiLoginAs(request, 'staff1');
    const filled = await request.get(VIEW_03(sid));
    expect(filled.status()).toBe(200);
    const body = await filled.json();

    // ⛔⛔ **หัวใจของ endpoint นี้** — ค่าจริงต้องถึงผู้ตรวจ ไม่ใช่มาสก์
    //    ถ้าวันหนึ่งใครเผลอเอา `maskNationalId` มาใส่ตรงนี้ ผู้ตรวจจะอ่านบัตรไม่ได้จริง
    //    และไม่มีอะไรอื่นในระบบจับได้เลย เพราะทุก endpoint อื่นมาสก์หมด
    expect(body.national_id).toBe('1234567890123');
    expect(body.ethnicity).toBe('ไทย');
    expect(body.religion).toBe('พุทธ');
    expect(JSON.stringify(body)).not.toContain('x-xxxx-xxxxx');
    // ⛔ ciphertext/iv/tag ต้องไม่หลุดออกไปกับค่าที่ถอดแล้ว
    expect(JSON.stringify(body)).not.toMatch(/_ciphertext|_iv|_tag/);

    // ข้อมูลทั่วไปของใบมาครบ — ไม่ใช่ก้อนเปล่าที่ได้ 200
    expect(body.first_name_en).toBe('Somchai');
    expect(body.family_info?.father?.name).toBe('สมศักดิ์ สายดี');
    expect(body.language_proficiency?.[0]).toMatchObject({ language: 'ภาษาอังกฤษ' });
  });

  test('F5: สหกิจ 06 — อาจารย์ที่ปรึกษาและเจ้าหน้าที่อ่านที่พักพร้อมพิกัดได้ ยังไม่กรอกก็เปิดได้', async ({
    request,
  }) => {
    const sid = await seedAcceptedIntent();
    const readPath = `${API_URL}/students/${sid}/accommodation-plan`;

    // ยังไม่กรอกที่พัก → ผู้ตรวจเปิดได้ (ไม่ใช่ error)
    await apiLoginAs(request, 'staff1');
    const empty = await request.get(readPath);
    expect(empty.status(), await empty.text()).toBe(200);
    expect((await empty.json()).accommodation).toBeNull();

    await apiLoginAs(request, 'student2');
    expect((await submitAccommodation(request, sid)).status()).toBe(200);

    for (const who of ['staff1', 'advisor1'] as const) {
      await apiLoginAs(request, who);
      const res = await request.get(readPath);
      expect(res.status(), `${who}: ${await res.text()}`).toBe(200);
      const acc = (await res.json()).accommodation;
      // ที่อยู่ต้องแตกลงช่องของมันจริง และพิกัดต้องมา (ใช้ปักหมุดในหน้าจอ)
      expect(acc.house_no, who).toBe('88/9');
      expect(acc.subdistrict, who).toBe('ลาดยาว');
      expect(Number(acc.latitude), who).toBeCloseTo(13.8459123, 5);
      expect(Number(acc.longitude), who).toBeCloseTo(100.5612345, 5);
    }
  });

  // ── ๓. สิทธิ์ของสหกิจ 06 ──────────────────────────────────────────────────

  test('F6: สหกิจ 06 — อาจารย์ที่ไม่ได้ดูแลและพี่เลี้ยงอ่านที่พักไม่ได้', async ({ request }) => {
    const sid = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    expect((await submitAccommodation(request, sid)).status()).toBe(200);

    const readPath = `${API_URL}/students/${sid}/accommodation-plan`;

    // ⛔ เดิมเทียบกับปุ่มพิมพ์ว่า "ต้องไม่หลวมกว่า" — ปุ่มพิมพ์ถูกลบแล้ว จึงตรึงที่หน้าอ่านโดยตรง
    for (const who of ['advisor2', 'mentor1'] as const) {
      await apiLoginAs(request, who);
      const res = await request.get(readPath);
      expect(res.status(), `${who} ต้องอ่านที่พักของนักศึกษาที่ไม่ได้ดูแลไม่ได้`).not.toBe(200);
    }

    await apiLoginAs(request, 'advisor1');
    expect((await request.get(readPath)).status()).toBe(200);
  });

  // ── ๔. ช่องที่เพิ่มมาจากไฟล์ `.docx` ตัวจริง ────────────────────────────────

  test('F7: "ห้อง" ลงคอลัมน์ของ students ไม่ใช่ของ accommodations', async ({ request }) => {
    const sid = await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    expect((await submitAccommodation(request, sid)).status()).toBe(200);

    // ⛔ ฟอร์มจริงถาม "ห้อง" ไว้ข้าง "ชั้นปีที่" = ห้องเรียน · ส่วน `room_no` คือเลขห้อง
    //    ของหอพัก ซึ่งอยู่คนละบล็อกและ **ยังต้องเก็บต่อ** ไม่ใช่ของซ้ำ
    expect(await dbValue<string>('SELECT section FROM students WHERE student_id = $1', [sid])).toBe(
      '4/1'
    );
    expect(
      await dbValue<string>('SELECT room_no FROM accommodations WHERE student_id = $1', [sid])
    ).toBe('512');

    const read = await request.get(`${API_URL}/students/${sid}/accommodation-plan`);
    expect((await read.json()).section).toBe('4/1');
  });

  test('F8: ความสามารถทางภาษาสามช่องอยู่ร่วมคอลัมน์เดียวกับหน้าโปรไฟล์โดยไม่ลบกันเอง', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    // หน้าโปรไฟล์บันทึกทับด้วยรูปทรงของตัวเอง (`language` + `level`)
    // ⛔ ระบบต้องยอมให้แถวเดียวกันถือคีย์ของทั้งสองหน้า — ไม่งั้นการแก้ที่หน้าหนึ่ง
    //    จะลบของอีกหน้าหายเงียบๆ โดยไม่มีใครรู้จนกว่าจะพิมพ์ใบออกมา
    const res = await request.put(`${API_URL}/profile/student/optional`, {
      data: {
        skills_and_activities: 'ทดสอบ',
        language_proficiency: [
          { language: 'ภาษาอังกฤษ', level: 'ดี', reading: 'ดี', speaking: 'พอใช้', writing: 'ดี' },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    const saved = await dbValue<string>(
      'SELECT language_proficiency::text FROM students WHERE student_id = $1',
      [await studentId()]
    );
    const rows = JSON.parse(saved) as Record<string, string>[];
    expect(rows[0]).toMatchObject({ language: 'ภาษาอังกฤษ', reading: 'ดี', writing: 'ดี' });
  });

  test('F9: คีย์แปลกปลอมในตารางภาษาถูกตัดทิ้ง ไม่ใช่ปฏิเสธทั้งคำขอ', async ({ request }) => {
    await apiLoginAs(request, 'student2');

    const res = await request.put(`${API_URL}/students/coop-application`, {
      data: {
        language_proficiency: [
          { language: 'ภาษาญี่ปุ่น', reading: 'พอใช้', evil_key: 'x'.repeat(50) },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    const saved = await dbValue<string>(
      'SELECT language_proficiency::text FROM students WHERE student_id = $1',
      [await studentId()]
    );
    expect(saved).toContain('ภาษาญี่ปุ่น');
    expect(saved).not.toContain('evil_key');
  });

  // ── ๕. หน้าจอ ─────────────────────────────────────────────────────────────

  test('F10: หน้าจอนักศึกษาไม่มีปุ่มพิมพ์แล้ว · อาจารย์เปิดดูใบ 03 ในหน้าจอได้ค่าจริงและลง audit', async ({
    page,
    request,
  }) => {
    const sid = await studentId();
    await seedAcceptedIntent();
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    // ฝั่งนักศึกษา: ไม่มีปุ่มพิมพ์ และไม่มีข้อความเตือนว่าไฟล์พิมพ์มีค่าจริง
    await loginAs(page, 'student2');
    await goToMenu(page, 'job_application');
    await expect(page.getByTestId('ca-print')).toHaveCount(0);
    await expect(page.getByText('เลขบัตรประชาชน เชื้อชาติ และศาสนาเป็นค่าจริง')).toHaveCount(0);
    await goToMenu(page, 'accommodation_plan');
    await expect(page.getByTestId('acc-section')).toBeVisible();
    await expect(page.getByTestId('acc-print')).toHaveCount(0);
    await logout(page);

    // ฝั่งอาจารย์ที่ปรึกษา: เปิดดูใบ สหกิจ 03 · 06 ในหน้ารายชื่อนักศึกษา
    await loginAs(page, 'advisor1');
    const before = await countViewedAudit();
    await goToMenu(page, 'students');
    await page.getByTestId(`advisor-student-row-${sid}`).click();
    await page.getByTestId('advisor-student-view-forms').click();

    const modal = page.getByTestId('coop-forms-view');
    await expect(modal).toBeVisible();
    // ⛔⛔ ผู้ตรวจต้องเห็นค่าจริง (ไม่ใช่มาสก์) — รูปแบบเลขบัตรจัดโดย `spaceNationalId`
    await expect(modal.getByTestId('coop-view-03')).toContainText('1-2345-67890-12-3');
    await expect(modal.getByTestId('coop-view-03')).toContainText('พุทธ');
    await expect(modal).not.toContainText('x-xxxx-xxxxx');
    // "อย่างน้อยหนึ่งแถว" ไม่ใช่ "หนึ่งแถวพอดี" — dev server ครอบด้วย React StrictMode ซึ่งรัน effect โหลดข้อมูลของโมดัลสองรอบ
    // (ยิง `GET …/coop-application` สองครั้ง = สองแถว) · production รอบเดียว · การนับพอดีทำที่ระดับ API ใน F3 แล้ว
    await expect.poll(countViewedAudit, { timeout: 10_000 }).toBeGreaterThan(before);

    // แท็บ 06 — ยังไม่กรอกที่พัก ต้องบอกว่าว่าง ไม่ใช่ error
    await modal.getByTestId('coop-view-tab-06').click();
    await expect(modal.getByTestId('coop-view-06-empty')).toBeVisible();
  });

  test('F11: ค่าจริงของข้อมูลอ่อนไหวไม่เคยออกทาง endpoint ที่หน้าจอนักศึกษาใช้', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    // ⛔ ฉบับผู้ตรวจ (F4) ต้องไม่ทำให้ใครเผลอเปิดค่าจริงใน endpoint ที่หน้าจอนักศึกษาใช้
    const screen = await request.get(`${API_URL}/students/coop-application`);
    const body = await screen.text();
    expect(body).toContain('x-xxxx-xxxxx-xx-3');
    expect(body).not.toContain('1234567890123');
    expect(body).not.toContain('พุทธ');

    // ค่าจริงยังอยู่ในฐานแบบเข้ารหัส — ผู้ตรวจเปิดดูได้แปลว่าถอดกลับได้ ไม่ใช่เก็บเป็น plaintext
    const cipher = await dbValue<string>(
      'SELECT national_id_ciphertext FROM students WHERE student_id = $1',
      [await studentId()]
    );
    expect(cipher).not.toContain('1234567890123');
    expect((cipher ?? '').length).toBeGreaterThan(0);
  });

  test('F12: กุญแจถอดรหัสใช้ไม่ได้ → ยังเปิดใบได้ แค่ช่องนั้นว่าง', async ({ request }) => {
    const sid = await studentId();
    await apiLoginAs(request, 'student2');
    await fillSensitive(request);

    // ทำให้ ciphertext เสีย — จำลองกรณีกุญแจถูกหมุนโดยไม่ได้เข้ารหัสข้อมูลเดิมใหม่
    // ⛔ ใบสมัครทั้งใบต้องไม่เปิดไม่ได้เพราะช่องเดียวเสีย
    await dbExec(
      "UPDATE students SET national_id_ciphertext = 'deadbeef' WHERE student_id = $1",
      [sid]
    );

    await apiLoginAs(request, 'staff1');
    const res = await request.get(VIEW_03(sid));
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    // ช่องเลขบัตรว่าง แต่ช่องอื่นที่ถอดได้ยังต้องมีค่าจริงอยู่
    expect(body.national_id).toBeNull();
    expect(body.religion).toBe('พุทธ');

    // บันทึกต้องบอกความจริงว่าช่องไหนถอดได้ ช่องไหนไม่ได้ (`writeAudit` ลงหลัง response)
    await expect
      .poll(
        async () =>
          (
            await dbRow<{ detail: { decrypted: Record<string, boolean> } }>(
              `SELECT detail FROM audit_log
                WHERE action = $1
                ORDER BY audit_id DESC LIMIT 1`,
              [AUDIT_VIEWED]
            )
          )?.detail.decrypted,
        { timeout: 10_000 }
      )
      .toEqual({ national_id: false, ethnicity: true, religion: true });
  });
});
