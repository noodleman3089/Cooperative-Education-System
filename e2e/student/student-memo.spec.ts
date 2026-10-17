import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { memoDetailsFor } from '../helpers/memo';

/**
 * บันทึกข้อความของนักศึกษา (คู่มือ PDF หน้า 45 · ตัวอย่างหน้า 48)
 *
 * สิ่งที่ต้องคุมไม่ให้พังเงียบ:
 *   1. **สิทธิ์** — บันทึกมีเหตุผลส่วนตัวของนักศึกษาอยู่ในนั้น และถูกเสนอถึงคณบดี
 *      คนที่ไม่เกี่ยวข้องต้องเปิดไม่ได้ ทั้งตัวข้อมูลและตัวไฟล์ PDF
 *   2. **ห้ามออกเอกสารราชการที่มีช่องว่างเปล่า** — บทเรียนจากรอบ 49 ที่หนังสือออกไป
 *      พร้อมวงเล็บเปล่าเพราะโปรไฟล์ไม่มีชื่อ
 *   3. **หัวข้อเป็นของนักศึกษา** ระบบเลือกไว้ให้ล่วงหน้าได้เฉพาะกรณีที่รู้จริง
 *   4. **ช่องเฉพาะหัวข้อ (`details` · ดีไซน์ B 2026-10-18)** — ด่านอยู่ที่ `parseMemoDetails` ฝั่ง API (M7)
 *      หน้าจอแค่บอกก่อนล่วงหน้า (M9) · เอกสารที่ขอผ่อนผันเลือกได้เฉพาะที่เปิดรอบพิเศษได้ ไม่งั้นคณบดีอนุมัติแล้วไม่มีทางเปิดรอบ
 *   5. **นักศึกษาต้องเห็นผล** — หัวแถว + แถวกาง (M11) + กระดิ่ง (M12)
 *
 * ⛔ M7–M12 เขียนหลังเปลี่ยนหน้าเป็นดีไซน์ B และ **ยังไม่เคยรัน** (เจ้าของสั่งรันเอง)
 */

const REASON = 'สถานประกอบการกำหนดเงื่อนไขการเข้าร่วมสหกิจศึกษาไม่น้อยกว่าหกเดือน';

const createMemo = (
  request: Parameters<typeof apiLoginAs>[0],
  body: Record<string, unknown> = {}
) =>
  request.post(`${API_URL}/memos`, {
    // details ตามหัวข้อที่ส่งไป (ดีไซน์ B) — ไม่แนบ = 400 สำหรับ early_departure/late_submission
    data: {
      memo_type: 'early_departure',
      reason: REASON,
      details: memoDetailsFor((body.memo_type as string | undefined) ?? 'early_departure'),
      ...body,
    },
  });

test.describe('บันทึกข้อความของนักศึกษา', () => {
  test.beforeEach(async () => {
    await seedTestData();
  });

  test('M1: ยื่นบันทึกได้ · ลงฐานจริง · และพิมพ์ออกมาเป็น PDF ได้', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await createMemo(request);
    expect(res.status(), await res.text()).toBe(201);
    const memoId = (await res.json()).memo.memo_id as number;

    expect(await dbValue<string>('SELECT memo_type FROM student_memos WHERE memo_id = $1', [memoId])).toBe(
      'early_departure'
    );
    // details ลงฐานเป็น JSONB ตามที่ส่ง (เฉพาะคีย์ที่หัวข้อนั้นรู้จัก)
    expect(await dbValue('SELECT details FROM student_memos WHERE memo_id = $1', [memoId])).toEqual(
      memoDetailsFor('early_departure')
    );

    const pdf = await request.get(`${API_URL}/memos/${memoId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    // ไฟล์ต้องเป็น PDF จริง ไม่ใช่หน้า error ที่ถูกส่งมาด้วย 200
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

    const mine = await (await request.get(`${API_URL}/memos/me`)).json();
    expect(mine).toHaveLength(1);
    expect(mine[0].reason).toBe(REASON);
  });

  test('M2: หัวข้อที่ไม่รู้จัก และเหตุผลสั้นเกินไป → 400 ทั้งคู่', async ({ request }) => {
    await apiLoginAs(request, 'student2');

    const badType = await createMemo(request, { memo_type: 'made_up_topic' });
    expect(badType.status()).toBe(400);
    expect((await badType.json()).message as string).toContain('หัวข้อ');

    const shortReason = await createMemo(request, { reason: 'ไม่สะดวก' });
    expect(shortReason.status()).toBe(400);

    expect(await dbValue<string>('SELECT COUNT(*) FROM student_memos')).toBe('0');
  });

  test('M3: นักศึกษาคนอื่นเปิดไม่ได้ (403) · ใบที่ไม่มีอยู่ → 404', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const memoId = (await (await createMemo(request)).json()).memo.memo_id as number;

    await apiLoginAs(request, 'student1');
    expect((await request.get(`${API_URL}/memos/${memoId}/pdf`)).status()).toBe(403);
    // และต้องไม่โผล่ในรายการของตัวเองด้วย
    expect(await (await request.get(`${API_URL}/memos/me`)).json()).toEqual([]);

    await apiLoginAs(request, 'student2');
    expect((await request.get(`${API_URL}/memos/999999/pdf`)).status()).toBe(404);
  });

  test('M4: อาจารย์ที่ดูแลเปิดได้ · อาจารย์นอกความดูแลเปิดไม่ได้', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const memoId = (await (await createMemo(request)).json()).memo.memo_id as number;

    await apiLoginAs(request, 'advisor1');
    expect((await request.get(`${API_URL}/memos/${memoId}/pdf`)).status()).toBe(200);
    expect((await (await request.get(`${API_URL}/memos`)).json()).length).toBe(1);

    // advisor2 อยู่คนละสาขา — ต้องไม่เห็นทั้งไฟล์และรายการ
    await apiLoginAs(request, 'advisor2');
    expect((await request.get(`${API_URL}/memos/${memoId}/pdf`)).status()).toBe(403);
    expect(await (await request.get(`${API_URL}/memos`)).json()).toEqual([]);
  });

  test('M5: โปรไฟล์ไม่ครบ → ปฏิเสธตั้งแต่ตอนยื่น ไม่ปล่อยให้พิมพ์เอกสารที่มีช่องว่าง', async ({
    request,
  }) => {
    // เบอร์โทรถูกพิมพ์ลงบันทึกสองที่ (หัวเรื่องและใต้ลายมือชื่อ) ขาดแล้วเอกสารไม่สมบูรณ์
    await dbExec(`UPDATE students SET phone = NULL WHERE student_id = 2`);

    await apiLoginAs(request, 'student2');
    const res = await createMemo(request);
    expect(res.status()).toBe(400);
    const message = (await res.json()).message as string;
    expect(message).toContain('เบอร์โทรศัพท์');
    expect(await dbValue<string>('SELECT COUNT(*) FROM student_memos')).toBe('0');
  });

  test('M6: อ้างใบแจ้งความจำนงที่ไม่ใช่ของตัวเอง → 404', async ({ request }) => {
    const semesterId = await dbValue<number>(
      'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'
    );
    const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
    // ⛔ seeder สร้างแถวใน `students` ให้ student2 คนเดียว (student1 มีแต่บัญชีผู้ใช้)
    //    เทสต์นี้จึงต้องสร้างนักศึกษาอีกคนเอง ไม่ใช่ hardcode student_id = 1 แล้วชน FK
    const otherStudentId = await dbValue<number>(
      `INSERT INTO students (student_id, student_code, major_id, first_name, last_name)
       SELECT u.user_id, 'MEMO-OTHER-01', s.major_id, 'นักศึกษา', 'คนอื่น'
         FROM users u CROSS JOIN students s
        WHERE u.email = 'student1@test.com' AND s.student_id = 2
       ON CONFLICT (student_id) DO UPDATE SET student_code = EXCLUDED.student_code
       RETURNING student_id`
    );
    expect(otherStudentId, 'ต้องมีนักศึกษาอีกคน ไม่งั้นเทสต์นี้ไม่ได้ตรวจอะไรเลย').toBeTruthy();

    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
       VALUES ($1, $2, $3, 'pending_advisor')`,
      [otherStudentId, companyId, semesterId]
    );
    const otherFormId = await dbValue<number>(
      'SELECT form_id FROM intent_forms WHERE student_id = $1 ORDER BY form_id DESC LIMIT 1',
      [otherStudentId]
    );

    await apiLoginAs(request, 'student2');
    const res = await createMemo(request, { intent_form_id: otherFormId });
    expect(res.status()).toBe(404);
    expect(await dbValue<string>('SELECT COUNT(*) FROM student_memos')).toBe('0');
  });

  test('M7: API — details ตามหัวข้อ: early_departure ไม่มีวันที่ขอเริ่ม · late_submission ไม่เลือกเอกสารหรือเลือกเอกสารที่เปิดรอบพิเศษไม่ได้ → 400 · คีย์แปลกถูกทิ้ง', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');

    const badEarly: Array<[string, unknown]> = [
      ['ไม่ส่ง details เลย', undefined],
      ['details ว่าง', {}],
      ['start_date ว่าง', { start_date: '' }],
      ['start_date ไม่ใช่รูป YYYY-MM-DD', { start_date: '15/01/2027' }],
      ['start_date เป็นวันที่ที่ไม่มีจริง', { start_date: '2027-02-30' }],
      ['start_date ไม่ใช่สตริง', { start_date: 20270115 }],
    ];
    for (const [label, details] of badEarly) {
      const res = await createMemo(request, { memo_type: 'early_departure', details });
      expect(res.status(), `early_departure · ${label}: ${await res.text()}`).toBe(400);
      expect((await res.json()).message as string, label).toContain('วันที่ขอเริ่ม');
    }

    const okLate = { activities: ['intent_submission'], expected_date: '2027-01-20' };
    const badLate: Array<[string, unknown, string]> = [
      ['ไม่ส่ง details เลย', undefined, 'เอกสารที่ขอผ่อนผัน'],
      ['activities ว่าง', { ...okLate, activities: [] }, 'เอกสารที่ขอผ่อนผัน'],
      ['activities เป็นสตริงไม่ใช่อาร์เรย์', { ...okLate, activities: 'intent_submission' }, 'เอกสารที่ขอผ่อนผัน'],
      // coop_start เป็นหมุดเวลาในปฏิทิน ไม่ล็อกการทำรายการ → เปิดรอบพิเศษให้ไม่ได้
      ['เลือก coop_start', { ...okLate, activities: ['coop_start'] }, 'เอกสารที่ขอผ่อนผัน'],
      // weekly_log เป็นกิจกรรมที่คำนวณจากช่วงอื่น (derivedFrom) → เปิดรอบพิเศษไม่ได้
      ['เลือก weekly_log', { ...okLate, activities: ['weekly_log'] }, 'เอกสารที่ขอผ่อนผัน'],
      ['เลือกกิจกรรมที่ไม่มีอยู่จริง', { ...okLate, activities: ['made_up_activity'] }, 'เอกสารที่ขอผ่อนผัน'],
      // ปนกัน — ตัวเดียวที่ใช้ไม่ได้ก็ปฏิเสธทั้งชุด ไม่ตัดทิ้งเงียบ ๆ
      ['ปน roundable กับ coop_start', { ...okLate, activities: ['intent_submission', 'coop_start'] }, 'เอกสารที่ขอผ่อนผัน'],
      ['ไม่มี expected_date', { activities: ['intent_submission'] }, 'วันที่คาดว่าจะส่ง'],
      ['expected_date ไม่ใช่วันที่', { ...okLate, expected_date: 'พรุ่งนี้' }, 'วันที่คาดว่าจะส่ง'],
    ];
    for (const [label, details, expectedMessage] of badLate) {
      const res = await createMemo(request, { memo_type: 'late_submission', details });
      expect(res.status(), `late_submission · ${label}: ${await res.text()}`).toBe(400);
      expect((await res.json()).message as string, label).toContain(expectedMessage);
    }

    // ปฏิเสธทุกแบบ = ไม่มีแถวหลุดลงฐาน
    expect(await dbValue<string>('SELECT COUNT(*) FROM student_memos')).toBe('0');

    // อีกสองหัวข้อไม่บังคับ details — ไม่ส่งก็ยื่นได้ · end_date ที่ส่งมาต้องเป็นวันที่จริง
    const noDetails = await createMemo(request, { memo_type: 'change_company', details: undefined });
    expect(noDetails.status(), await noDetails.text()).toBe(201);
    const badEnd = await createMemo(request, { memo_type: 'terminated', details: { end_date: 'เมื่อวาน' } });
    expect(badEnd.status()).toBe(400);
    expect((await badEnd.json()).message as string).toContain('วันที่สิ้นสุด');

    // คีย์ที่หัวข้อนั้นไม่รู้จักถูกทิ้ง ไม่ลงฐาน (กันยัดข้อมูลอะไรก็ได้) · ค่าที่รู้จักถูกตัดช่องว่างและจำกัดความยาว
    const noisy = await createMemo(request, {
      memo_type: 'early_departure',
      details: { start_date: '2027-01-15', note: 'ยัดมา', activities: ['intent_submission'], __proto__x: 1 },
    });
    expect(noisy.status(), await noisy.text()).toBe(201);
    const noisyId = (await noisy.json()).memo.memo_id as number;
    expect(await dbValue('SELECT details FROM student_memos WHERE memo_id = $1', [noisyId])).toEqual({
      start_date: '2027-01-15',
    });

    const company = await createMemo(request, {
      memo_type: 'change_company',
      details: { new_company: `  ${'ก'.repeat(300)}  ` },
    });
    expect(company.status(), await company.text()).toBe(201);
    const companyId = (await company.json()).memo.memo_id as number;
    const stored = await dbValue<{ new_company: string }>('SELECT details FROM student_memos WHERE memo_id = $1', [
      companyId,
    ]);
    expect(stored?.new_company).toBe('ก'.repeat(200));
  });

  test('M8: หน้าจอ — เลือกหัวข้อเอง (radio) ยื่นถึงคณบดีได้ ไม่มีขั้นพิมพ์บังคับ · คนที่ยื่นล่าช้าถูกเลือกหัวข้อไว้ให้ก่อน', async ({
    page,
  }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'memos');

    await expect(page.getByRole('heading', { name: 'บันทึกข้อความถึงคณบดี' })).toBeVisible();
    // ยังไม่เลือกหัวข้อ = ยื่นไม่ได้ (ระบบเลือกไว้ให้เฉพาะกรณีที่รู้จริงว่าส่งช้า)
    await expect(page.locator('#memo-type input[type="radio"]:checked')).toHaveCount(0);
    await expect(page.getByTestId('memo-submit')).toBeDisabled();

    await page.getByTestId('memo-type-option-change_company').click();
    // คำอธิบายใต้ตัวเลือกต้องเปลี่ยนตามหัวข้อ ไม่ใช่ข้อความค้าง
    await expect(page.getByText(/ได้รับการตอบรับจากที่หนึ่งแล้ว/)).toBeVisible();

    await page.locator('#memo-reason').fill('บริษัทเดิมยกเลิกการรับนักศึกษาเข้าปฏิบัติงานกะทันหัน');
    await page.getByTestId('memo-submit').click();
    // เอกสารถึงคณบดี แก้/ถอนไม่ได้ — กล่องยืนยันแสดงเหตุผลเต็ม · กลับไปแก้ = ยังไม่มีบันทึก (2026-09-22)
    await expect(page.getByTestId('confirm-summary')).toContainText('บริษัทเดิมยกเลิกการรับนักศึกษา');
    await page.getByTestId('memo-confirm-cancel').click();
    await expect(page.getByTestId('memo-row')).toHaveCount(0);
    await page.getByTestId('memo-submit').click();
    await page.getByTestId('memo-confirm').click();

    await expect(page.getByText(/ยื่นบันทึกข้อความถึงคณบดีเรียบร้อยแล้ว/)).toBeVisible();
    await expect(page.getByTestId('memo-row')).toHaveCount(1);
    // พิมพ์เป็นแค่ทางเลือก (ลิงก์ที่หัวแถว) · ไม่มีขั้น "บันทึกและเตรียมพิมพ์" ที่บังคับแล้ว
    await expect(page.getByTestId('memo-print')).toBeVisible();
    await expect(page.getByRole('button', { name: 'บันทึกและเตรียมพิมพ์' })).toHaveCount(0);
    // ใบใหม่รอคณบดีพิจารณาเสมอ — นักศึกษาตัดสินเองไม่ได้
    await expect(page.getByTestId('memo-decision')).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('memo-decision')).toHaveText('รอคณบดีพิจารณา');
    // ยื่นเสร็จฟอร์มเคลียร์ ไม่ค้างข้อความเดิมให้กดซ้ำ
    await expect(page.locator('#memo-reason')).toHaveValue('');
    await expect(page.getByTestId('memo-submit')).toBeDisabled();

    // --- ระบบเลือกหัวข้อไว้ให้เฉพาะกรณีที่รู้จริง คือใบที่ถูกประทับว่ายื่นล่าช้า ---
    const semesterId = await dbValue<number>(
      'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'
    );
    const companyId = await dbValue<number>('SELECT company_id FROM companies LIMIT 1');
    await dbExec(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, submitted_late, late_reason)
       VALUES (2, $1, $2, 'pending_advisor', TRUE, 'ติดต่อสถานประกอบการหลายแห่งแล้วไม่ได้รับคำตอบ')`,
      [companyId, semesterId]
    );

    await page.reload();
    await goToMenu(page, 'memos');
    await expect(page.locator('#memo-type input[type="radio"]:checked')).toHaveValue('late_submission');
    await expect(page.getByText(/ถูกบันทึกว่า "ยื่นล่าช้า"/)).toBeVisible();
    // และช่องของหัวข้อนั้นขึ้นมาให้กรอกเลย
    await expect(page.getByTestId('memo-activity-intent_submission')).toBeVisible();
    await expect(page.locator('#memo-expected-date')).toBeVisible();
  });

  test('M9: หน้าจอ — ช่องที่เห็น · ตัวอย่างเหตุผล · แผง "ถ้าอนุมัติ" เปลี่ยนตามหัวข้อ · ปุ่มยื่นเปิดเมื่อช่องบังคับของหัวข้อนั้นครบ', async ({
    page,
  }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'memos');

    const startDate = page.locator('#memo-start-date');
    const expectedDate = page.locator('#memo-expected-date');
    const newCompany = page.locator('#memo-new-company');
    const endDate = page.locator('#memo-end-date');
    const activities = page.locator('[data-testid^="memo-activity-"]');
    const reason = page.locator('#memo-reason');
    const submit = page.getByTestId('memo-submit');

    /** ช่องเฉพาะหัวข้อทั้งหมดที่ควรเห็นตอนนี้ — ที่เหลือต้องไม่อยู่ใน DOM เลย (ไม่ใช่แค่ซ่อน) */
    const expectFields = async (shown: { start?: boolean; activities?: boolean; expected?: boolean; company?: boolean; end?: boolean }) => {
      await expect(startDate).toHaveCount(shown.start ? 1 : 0);
      await expect(activities).toHaveCount(shown.activities ? 5 : 0);
      await expect(expectedDate).toHaveCount(shown.expected ? 1 : 0);
      await expect(newCompany).toHaveCount(shown.company ? 1 : 0);
      await expect(endDate).toHaveCount(shown.end ? 1 : 0);
    };

    // ยังไม่เลือก: ไม่มีช่องเฉพาะหัวข้อ · ตัวอย่างบอกให้เลือกก่อน
    await expectFields({});
    await expect(reason).toHaveAttribute('placeholder', /เลือกเรื่องที่จะยื่นก่อน/);
    await expect(page.getByTestId('memo-outcome')).toContainText('ขึ้นอยู่กับเรื่องที่คุณเลือก');

    // 1) ขอออกปฏิบัติงานก่อนกำหนด → วันที่ขอเริ่ม (บังคับ)
    await page.getByTestId('memo-type-option-early_departure').click();
    await expectFields({ start: true });
    await expect(reason).toHaveAttribute('placeholder', /ไม่น้อยกว่า 6 เดือน/);
    await expect(page.getByTestId('memo-outcome')).toContainText('ก่อนช่วงปกติได้');
    await reason.fill(REASON);
    await expect(submit, 'ยังไม่ได้กรอกวันที่ขอเริ่ม').toBeDisabled();
    await startDate.fill('2027-01-15');
    await expect(submit).toBeEnabled();

    // 2) ส่งเอกสารล่าช้า → เลือกเอกสาร (หลายอัน · เฉพาะที่เปิดรอบพิเศษได้ 5 อย่าง) + วันที่คาดว่าจะส่ง (บังคับทั้งคู่)
    await page.getByTestId('memo-type-option-late_submission').click();
    await expectFields({ activities: true, expected: true });
    for (const key of ['intent_submission', 'acceptance_form', 'accommodation_plan', 'report_outline', 'final_report']) {
      await expect(page.getByTestId(`memo-activity-${key}`)).toBeVisible();
    }
    // หมุดเวลาในปฏิทินที่ล็อกไม่ได้ต้องไม่โผล่เป็นตัวเลือก
    await expect(page.getByTestId('memo-activity-coop_start')).toHaveCount(0);
    await expect(page.getByTestId('memo-activity-weekly_log')).toHaveCount(0);
    await expect(reason).toHaveAttribute('placeholder', /ป่วยเข้ารักษาตัว/);
    await expect(page.getByTestId('memo-outcome')).toContainText('นับว่าช้า');
    // ค่าวันที่ของหัวข้อก่อนหน้าไม่ทำให้ปุ่มเปิดเอง
    await expect(submit).toBeDisabled();
    await page.getByTestId('memo-activity-final_report').click();
    await expect(submit, 'เลือกเอกสารแล้วแต่ยังไม่มีวันที่คาดว่าจะส่ง').toBeDisabled();
    await expectedDate.fill('2027-01-20');
    await expect(submit).toBeEnabled();
    // เอาเอกสารออกหมด = ปุ่มปิดอีก
    await page.getByTestId('memo-activity-final_report').click();
    await expect(submit).toBeDisabled();

    // 3) ขอเปลี่ยนสถานประกอบการ → สถานที่ใหม่ (ไม่บังคับ — บางคนยังไม่ได้ที่ใหม่)
    await page.getByTestId('memo-type-option-change_company').click();
    await expectFields({ company: true });
    await expect(reason).toHaveAttribute('placeholder', /ไม่มีงานตรงสาขา/);
    await expect(page.getByTestId('memo-outcome')).toContainText('ปิดใบที่ฝึกเดิม');
    await expect(submit).toBeEnabled();

    // 4) ถูกส่งตัวกลับ → วันที่สิ้นสุด (ไม่บังคับ)
    await page.getByTestId('memo-type-option-terminated').click();
    await expectFields({ end: true });
    await expect(reason).toHaveAttribute('placeholder', /โครงการที่ได้รับมอบหมายสิ้นสุด/);
    await expect(page.getByTestId('memo-outcome')).toContainText('ปิดใบที่ฝึกของนักศึกษา');
    await expect(submit).toBeEnabled();

    // เหตุผลสั้นเกินไป = ยื่นไม่ได้ ไม่ว่าช่องหัวข้อจะครบ
    await reason.fill('สั้นไป');
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/พิมพ์อีกอย่างน้อย \d+ ตัวอักษร/)).toBeVisible();
  });

  test('M10: หน้าจอ — ยื่นส่งเอกสารล่าช้า: details ลงฐานเฉพาะของหัวข้อที่เลือก (ไม่ติดค่าหัวข้ออื่น) · แถวพับกางดูรายละเอียดได้', async ({
    page,
  }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'memos');

    // กรอกวันที่ขอเริ่มของหัวข้อแรกไว้ก่อน แล้วเปลี่ยนใจ — ค่านี้ห้ามติดไปกับหัวข้อที่ยื่นจริง
    await page.getByTestId('memo-type-option-early_departure').click();
    await page.locator('#memo-start-date').fill('2027-01-15');

    await page.getByTestId('memo-type-option-late_submission').click();
    await page.getByTestId('memo-activity-intent_submission').click();
    await page.getByTestId('memo-activity-report_outline').click();
    await page.locator('#memo-expected-date').fill('2027-02-10');
    await page.locator('#memo-reason').fill(REASON);
    await page.getByTestId('memo-submit').click();

    // กล่องยืนยันสรุปเอกสารที่ขอผ่อนผัน — ตรวจก่อนยื่นได้ว่าเลือกถูก
    const summary = page.getByTestId('confirm-summary');
    await expect(summary).toContainText('ใบแจ้งความจำนง (เอกสาร 1)');
    await expect(summary).toContainText('โครงร่างรายงาน (สหกิจ 11)');
    await expect(summary).not.toContainText('ขอเริ่มวันที่');
    await page.getByTestId('memo-confirm').click();

    await expect(page.getByText(/ยื่นบันทึกข้อความถึงคณบดีเรียบร้อยแล้ว/)).toBeVisible();
    await expect(page.getByTestId('memo-row')).toHaveCount(1);

    expect(
      await dbRow<{ memo_type: string; details: unknown }>(
        `SELECT memo_type, details FROM student_memos WHERE student_id = 2 ORDER BY memo_id DESC LIMIT 1`
      )
    ).toEqual({
      memo_type: 'late_submission',
      details: { activities: ['intent_submission', 'report_outline'], expected_date: '2027-02-10' },
    });

    // ฟอร์มเคลียร์ทุกช่อง — ติ๊กเอกสารเดิมไม่ค้าง
    await expect(page.locator('[data-testid="memo-activity-intent_submission"] input')).not.toBeChecked();
    await expect(page.locator('#memo-expected-date')).toHaveValue('');

    // แถวที่ยื่นแล้วพับอยู่ — เหตุผลและรายละเอียดซ่อนจนกว่าจะกด
    const row = page.getByTestId('memo-row');
    await expect(row).not.toContainText('เหตุผลที่คุณเขียน');
    await row.getByTestId('memo-row-toggle').click();
    await expect(row).toContainText('เหตุผลที่คุณเขียน');
    await expect(row).toContainText(REASON);
    await expect(row).toContainText('เอกสารที่ขอผ่อนผัน');
    await expect(row).toContainText('ใบแจ้งความจำนง (เอกสาร 1)');
    await expect(row).toContainText('โครงร่างรายงาน (สหกิจ 11)');
    await expect(row).toContainText('คาดว่าจะส่งได้');
    await expect(row).not.toContainText('ขอเริ่มปฏิบัติงานวันที่');
    // กดอีกครั้งพับกลับ
    await row.getByTestId('memo-row-toggle').click();
    await expect(row).not.toContainText('เหตุผลที่คุณเขียน');
  });

  // 2026-10-18: คณบดีตัดสินในระบบ (migration 058) — นักศึกษาต้องเห็นผล ไม่ใช่ "ยื่นแล้วเงียบ"
  // ตัวตัดสินทาง API ครอบที่ `faculty/memo-dean-decision` · ที่นี่คุมเฉพาะสิ่งที่นักศึกษามองเห็น
  test('M11: หน้าจอ — ผลของคณบดี (รอ/อนุมัติ/ไม่อนุมัติ + เหตุผล) ขึ้นที่หัวแถว · ข้อความ "รอเจ้าหน้าที่เปิดรอบพิเศษ" เฉพาะหัวข้อที่ผูกกับรอบ', async ({
    page,
    request,
  }) => {
    const DECISION_NOTE = 'ไม่อยู่ในเงื่อนไขการเปลี่ยนสถานประกอบการตามประกาศของคณะ';
    await apiLoginAs(request, 'student2');
    const idOf = async (type: string): Promise<number> => {
      const res = await createMemo(request, { memo_type: type });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).memo.memo_id as number;
    };
    // เรียงสร้าง: อนุมัติ(ออกก่อน) → ไม่อนุมัติ → อนุมัติ(เปลี่ยนที่) → รอ · หน้าจอเรียงใหม่สุดก่อน จึงเห็นกลับกัน
    const approvedEarly = await idOf('early_departure');
    const rejectedChange = await idOf('change_company');
    const approvedChange = await idOf('change_company');
    await idOf('late_submission');

    await apiLoginAs(request, 'dean1');
    for (const id of [approvedEarly, approvedChange]) {
      const approve = await request.patch(`${API_URL}/memos/${id}/decision`, { data: { decision: 'approved' } });
      expect(approve.status(), await approve.text()).toBe(200);
    }
    const reject = await request.patch(`${API_URL}/memos/${rejectedChange}/decision`, {
      data: { decision: 'rejected', note: DECISION_NOTE },
    });
    expect(reject.status(), await reject.text()).toBe(200);

    await loginAs(page, 'student2');
    await goToMenu(page, 'memos');
    const decisions = page.getByTestId('memo-decision');
    await expect(decisions).toHaveCount(4);
    await expect(decisions.nth(0)).toHaveAttribute('data-status', 'pending');
    await expect(decisions.nth(0)).toHaveText('รอคณบดีพิจารณา');
    await expect(decisions.nth(1)).toHaveAttribute('data-status', 'approved');
    await expect(decisions.nth(1)).toHaveText('คณบดีอนุมัติแล้ว');
    await expect(decisions.nth(2)).toHaveAttribute('data-status', 'rejected');
    await expect(decisions.nth(2)).toHaveText('คณบดีไม่อนุมัติ');
    await expect(decisions.nth(3)).toHaveAttribute('data-status', 'approved');
    await expect(decisions.nth(3)).toHaveText('คณบดีอนุมัติแล้ว');

    // แถวพับอยู่ — ยังไม่เห็นเหตุผลของใคร จนกว่าจะกางแถว
    const rows = page.getByTestId('memo-row');
    await expect(page.getByText('เหตุผลที่คุณเขียน')).toHaveCount(0);
    await expect(page.getByText(DECISION_NOTE)).toHaveCount(0);

    // ไม่อนุมัติ: เห็นเหตุผลของคณบดี
    await rows.nth(2).getByTestId('memo-row-toggle').click();
    await expect(rows.nth(2)).toContainText(`เหตุผลของคณบดี: ${DECISION_NOTE}`);
    await expect(rows.nth(2)).not.toContainText('รอเจ้าหน้าที่เปิด');

    // อนุมัติ หัวข้อที่ผูกกับรอบพิเศษ (ออกก่อนกำหนด): บอกว่ารอเจ้าหน้าที่เปิดรอบ + รายละเอียดวันที่ขอเริ่ม
    await rows.nth(3).getByTestId('memo-row-toggle').click();
    await expect(rows.nth(3)).toContainText(/รอเจ้าหน้าที่เปิด .*รอบพิเศษ.* ให้/);
    await expect(rows.nth(3)).toContainText('ขอเริ่มปฏิบัติงานวันที่');

    // อนุมัติ หัวข้อที่ไม่ผูกกับรอบ (เปลี่ยนสถานประกอบการ): บอกขั้นต่อไปตามจริง ไม่สัญญารอบพิเศษ
    await rows.nth(1).getByTestId('memo-row-toggle').click();
    await expect(rows.nth(1)).toContainText('เจ้าหน้าที่ปิดใบที่ฝึกเดิม');
    await expect(rows.nth(1)).not.toContainText('รอเจ้าหน้าที่เปิด');

    // ยังรอ: ไม่มีทั้งเหตุผลของคณบดีและข้อความขั้นต่อไป
    await rows.nth(0).getByTestId('memo-row-toggle').click();
    await expect(rows.nth(0)).toContainText('เหตุผลที่คุณเขียน');
    await expect(rows.nth(0)).not.toContainText('เหตุผลของคณบดี');
    await expect(rows.nth(0)).not.toContainText('รอเจ้าหน้าที่เปิด');
  });

  test('M12: กระดิ่งนักศึกษา — ผลตัดสินของคณบดีขึ้นแจ้งเตือน (อนุมัติ · ไม่อนุมัติพร้อมเหตุผล) · เรื่องที่ยังรออยู่ไม่ขึ้น', async ({
    page,
    request,
  }) => {
    const DECISION_NOTE = 'ไม่อยู่ในเงื่อนไขของปฏิทินสหกิจศึกษา';
    await apiLoginAs(request, 'student2');
    const idOf = async (type: string): Promise<number> => {
      const res = await createMemo(request, { memo_type: type });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).memo.memo_id as number;
    };
    const approved = await idOf('early_departure');
    const rejected = await idOf('late_submission');
    await idOf('change_company'); // ไม่ตัดสิน

    await loginAs(page, 'student2');
    // ยังไม่มีผลตัดสิน = กระดิ่งยังไม่มีเรื่องบันทึกข้อความ (นักศึกษานี้ไม่มีใบความจำนง/หนังสือ จึงไม่มีรายการอื่นด้วย)
    await expect(page.getByTestId('navbar-unread-badge')).toHaveCount(0);

    await apiLoginAs(request, 'dean1');
    expect((await request.patch(`${API_URL}/memos/${approved}/decision`, { data: { decision: 'approved' } })).status()).toBe(200);
    expect(
      (await request.patch(`${API_URL}/memos/${rejected}/decision`, { data: { decision: 'rejected', note: DECISION_NOTE } })).status()
    ).toBe(200);

    // เปิดหน้าใหม่ให้ Navbar ดึงแจ้งเตือนรอบใหม่
    await page.reload();
    await expect(page.getByTestId('navbar-unread-badge')).toHaveText('2');
    await page.getByTestId('navbar-bell-btn').click();
    await expect(page.getByText('คณบดีอนุมัติบันทึกข้อความของคุณแล้ว')).toHaveCount(1);
    await expect(page.getByText('คณบดีไม่อนุมัติบันทึกข้อความของคุณ')).toHaveCount(1);
    await expect(page.getByText(`เหตุผล: ${DECISION_NOTE}`)).toBeVisible();

    // กดแจ้งเตือนแล้วพาไปเมนูบันทึกข้อความ · อ่านแล้วตัวเลขลด
    await page.getByText('คณบดีอนุมัติบันทึกข้อความของคุณแล้ว').click();
    await expect(page).toHaveURL(/menu=memos/);
    await expect(page.getByTestId('navbar-unread-badge')).toHaveText('1');
  });
});
