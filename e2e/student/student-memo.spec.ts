import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * บันทึกข้อความของนักศึกษา (คู่มือ PDF หน้า 45 · ตัวอย่างหน้า 48)
 *
 * สิ่งที่ต้องคุมไม่ให้พังเงียบ:
 *   1. **สิทธิ์** — บันทึกมีเหตุผลส่วนตัวของนักศึกษาอยู่ในนั้น และถูกเสนอถึงคณบดี
 *      คนที่ไม่เกี่ยวข้องต้องเปิดไม่ได้ ทั้งตัวข้อมูลและตัวไฟล์ PDF
 *   2. **ห้ามออกเอกสารราชการที่มีช่องว่างเปล่า** — บทเรียนจากรอบ 49 ที่หนังสือออกไป
 *      พร้อมวงเล็บเปล่าเพราะโปรไฟล์ไม่มีชื่อ
 *   3. **หัวข้อเป็นของนักศึกษา** ระบบเลือกไว้ให้ล่วงหน้าได้เฉพาะกรณีที่รู้จริง
 */

const REASON = 'สถานประกอบการกำหนดเงื่อนไขการเข้าร่วมสหกิจศึกษาไม่น้อยกว่าหกเดือน';

const createMemo = (
  request: Parameters<typeof apiLoginAs>[0],
  body: Record<string, unknown> = {}
) =>
  request.post(`${API_URL}/memos`, {
    data: { memo_type: 'early_departure', reason: REASON, ...body },
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

  test('M7: หน้าจอ — เลือกหัวข้อเอง ยื่นได้ และคนที่ยื่นล่าช้าถูกเลือกหัวข้อไว้ให้ก่อน', async ({
    page,
  }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'memos');

    await expect(page.getByRole('heading', { name: 'บันทึกข้อความถึงคณบดี' })).toBeVisible();
    await page.locator('#memo-type').selectOption('change_company');
    // คำอธิบายใต้ dropdown ต้องเปลี่ยนตามหัวข้อ ไม่ใช่ข้อความค้าง
    await expect(page.getByText(/ได้รับการตอบรับจากที่หนึ่งแล้ว/)).toBeVisible();

    await page.locator('#memo-reason').fill('บริษัทเดิมยกเลิกการรับนักศึกษาเข้าปฏิบัติงานกะทันหัน');
    await page.getByRole('button', { name: 'บันทึกและเตรียมพิมพ์' }).click();
    // เอกสารทางการ แก้/ถอนไม่ได้ — กล่องยืนยันแสดงเหตุผลเต็ม · กลับไปแก้ = ยังไม่มีบันทึก (2026-09-22)
    await expect(page.getByTestId('confirm-summary')).toContainText('บริษัทเดิมยกเลิกการรับนักศึกษา');
    await page.getByTestId('memo-confirm-cancel').click();
    await expect(page.getByTestId('memo-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'บันทึกและเตรียมพิมพ์' }).click();
    await page.getByTestId('memo-confirm').click();

    await expect(page.getByText(/บันทึกข้อความเรียบร้อยแล้ว/)).toBeVisible();
    await expect(page.getByTestId('memo-row')).toHaveCount(1);
    await expect(page.getByTestId('memo-print')).toBeVisible();

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
    await expect(page.locator('#memo-type')).toHaveValue('late_submission');
    await expect(page.getByText(/ถูกบันทึกว่า "ยื่นล่าช้า"/)).toBeVisible();
  });
});
