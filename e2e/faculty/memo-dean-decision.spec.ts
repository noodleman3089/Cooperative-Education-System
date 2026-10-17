import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import type { AccountKey } from '../helpers/auth';
import { shift, today, twoSemesters, userId } from '../helpers/semesters';
import { memoDetailsFor } from '../helpers/memo';
import { goToMenu } from '../helpers/nav';

/**
 * คำตัดสินของคณบดีบนบันทึกข้อความถึงคณบดี (migration 058 · `design_special_rounds.md` ข้อ 8.3 · 2026-10-18)
 *
 * ลายเซ็นบนกระดาษยังเป็นหลักฐานทางการ — คำตัดสินในระบบคือสิ่งที่ "ปลดล็อกการนำเข้ารายชื่อไปเปิดรอบพิเศษ"
 * จึงต้องคุมไม่ให้พังเงียบ เรียงตามความเสียหาย:
 *   MD1 **ใครตัดสินได้** — คณบดีคนเดียว (เจ้าหน้าที่/อาจารย์/หัวหน้าสาขา/นักศึกษา/พี่เลี้ยง 403 · ไม่ล็อกอิน 401)
 *       ถ้าข้อนี้พัง นักศึกษาอนุมัติบันทึกตัวเองแล้วเข้ารอบพิเศษได้
 *   MD2 ไม่อนุมัติต้องมีเหตุผล ≥ 10 ตัวอักษร (นักศึกษาอ่านที่หน้าของตัวเอง) · ค่าที่ผิดไม่เปลี่ยนสถานะ
 *   MD3 **ตัดสินครั้งเดียว แก้ไม่ได้** (409) ทั้งอนุมัติซ้ำและกลับผล
 *   MD4 รายการนำเข้าของเจ้าหน้าที่ = เฉพาะ `approved` หัวข้อ early_departure / late_submission ของภาคนั้น
 *   MD5 นักศึกษาเห็นผล (รอ/อนุมัติ/ไม่อนุมัติ + เหตุผล) ที่ GET /api/memos/me
 *
 *   MD6 **หน้าจอคณบดี (ดีไซน์ B · master-detail)** — เลือกแถวซ้ายแล้วเห็นรายละเอียด `details` + ชื่อสถานประกอบการ
 *       ของแต่ละเรื่อง · ตัดสินในหน้าเดียว: ไม่อนุมัติต้องมีเหตุผล ≥ 10 ตัวอักษรก่อนถึงกล่องยืนยัน · ยกเลิกกล่องยืนยัน = ไม่เปลี่ยนสถานะ
 *   MD7 ผู้ที่ไม่ใช่คณบดี (อาจารย์ที่ปรึกษา · หัวหน้าสาขา) เห็นหน้าเดียวกันแบบอ่านอย่างเดียว — ไม่มีปุ่มตัดสิน/ช่องหมายเหตุ
 *   MD8 กระดิ่งคณบดี — `memos_pending_{n}` ขึ้นเมื่อมีเรื่องรอ · หายเมื่อตัดสินครบ
 *
 * ข้อมูลทั้งหมดเป็นของปลอม · ⛔ สเปคนี้ยังไม่เคยรัน (เขียนเตรียมไว้ 2026-10-18 — เจ้าของสั่งรันเอง)
 * ฝั่งนักศึกษาเห็นผล: หัวแถว/แถวกาง/กระดิ่ง อยู่ที่ `student/student-memo` M11–M12
 */

const REASON = 'สถานประกอบการกำหนดเงื่อนไขการเข้าร่วมสหกิจศึกษาไม่น้อยกว่าหกเดือน';
const NOTE_9 = 'x'.repeat(9);
const NOTE_10 = 'x'.repeat(10);

/** นักศึกษา (student2) ยื่นบันทึก → คืน memo_id · ปล่อยให้ session ค้างเป็นนักศึกษา · details ตามหัวข้อ (ดีไซน์ B) */
async function createMemo(
  request: APIRequestContext,
  memoType = 'early_departure',
  extra: Record<string, unknown> = {}
): Promise<number> {
  await apiLoginAs(request, 'student2');
  const res = await request.post(`${API_URL}/memos`, {
    data: { memo_type: memoType, reason: REASON, details: memoDetailsFor(memoType), ...extra },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).memo.memo_id as number;
}

const decide = (request: APIRequestContext, memoId: number | string, data: Record<string, unknown>) =>
  request.patch(`${API_URL}/memos/${memoId}/decision`, { data });

const memoRow = (memoId: number) =>
  dbRow<{
    status: string;
    decided_by: number | null;
    decided_at: string | null;
    decision_note: string | null;
  }>('SELECT status, decided_by, decided_at::text, decision_note FROM student_memos WHERE memo_id = $1', [memoId]);

test.describe('คำตัดสินของคณบดีบนบันทึกข้อความ', () => {
  test.beforeEach(async () => {
    await seedTestData();
  });

  test('MD1: คณบดีคนเดียวที่ตัดสินได้ — บทบาทอื่น 403 · ไม่ล็อกอิน 401 · สถานะไม่เปลี่ยน', async ({ request }) => {
    const memoId = await createMemo(request);

    // ใบใหม่ต้องเริ่มที่ pending เสมอ (ไม่เดาว่าได้รับอนุมัติ)
    expect(await memoRow(memoId)).toMatchObject({ status: 'pending', decided_by: null, decided_at: null });

    const intruders: AccountKey[] = ['student2', 'staff1', 'advisor1', 'head1', 'mentor1'];
    for (const who of intruders) {
      await apiLoginAs(request, who);
      const res = await decide(request, memoId, { decision: 'approved' });
      expect(res.status(), `${who} ต้องตัดสินไม่ได้`).toBe(403);
    }
    const anon = await request.patch(`${API_URL}/memos/${memoId}/decision`, {
      headers: { Cookie: '' },
      data: { decision: 'approved' },
    });
    expect(anon.status()).toBe(401);
    expect(await memoRow(memoId)).toMatchObject({ status: 'pending', decided_by: null, decided_at: null });

    // ตัวควบคุม: คณบดีทำได้จริง — ข้างบน 403 เพราะบทบาท ไม่ใช่เพราะ payload ผิด
    await apiLoginAs(request, 'dean1');
    const ok = await decide(request, memoId, { decision: 'approved' });
    expect(ok.status(), await ok.text()).toBe(200);
  });

  test('MD2: ไม่อนุมัติต้องมีเหตุผล ≥ 10 ตัวอักษร · ค่าที่ผิดทุกแบบไม่เปลี่ยนสถานะ · ตัดสินแล้วลง audit', async ({
    request,
  }) => {
    const memoId = await createMemo(request);
    const deanId = await userId('dean1@test.com');
    await apiLoginAs(request, 'dean1');

    const bad: Array<[string, number | string, Record<string, unknown>, number]> = [
      ['ผลการตัดสินที่ไม่รู้จัก', memoId, { decision: 'maybe' }, 400],
      ['ไม่ส่งผลการตัดสิน', memoId, {}, 400],
      ['ไม่อนุมัติโดยไม่มีเหตุผล', memoId, { decision: 'rejected' }, 400],
      ['ไม่อนุมัติ เหตุผลว่างเปล่า', memoId, { decision: 'rejected', note: '          ' }, 400],
      ['ไม่อนุมัติ เหตุผล 9 ตัวอักษร', memoId, { decision: 'rejected', note: NOTE_9 }, 400],
      ['รหัสบันทึกไม่ใช่ตัวเลข', 'abc', { decision: 'approved' }, 400],
      ['บันทึกที่ไม่มีอยู่', 999999, { decision: 'approved' }, 404],
    ];
    for (const [label, id, data, expected] of bad) {
      const res = await decide(request, id, data);
      expect(res.status(), `${label}: ${await res.text()}`).toBe(expected);
    }
    expect(await memoRow(memoId)).toMatchObject({ status: 'pending', decided_by: null, decided_at: null });

    // ขอบเขตพอดี 10 ตัวอักษร ผ่าน — นักศึกษาอ่านเหตุผลนี้ที่หน้าบันทึกของตัวเอง
    const rejected = await decide(request, memoId, { decision: 'rejected', note: NOTE_10 });
    expect(rejected.status(), await rejected.text()).toBe(200);
    const row = await memoRow(memoId);
    expect(row?.status).toBe('rejected');
    expect(row?.decision_note).toBe(NOTE_10);
    expect(row?.decided_by).toBe(deanId);
    expect(row?.decided_at).toBeTruthy();

    // writeAudit เป็น fire-and-forget — ลงหลัง response จึงต้อง poll (SEC-07)
    await expect
      .poll(
        async () =>
          await dbValue<string>(`SELECT detail->>'decision' FROM audit_log WHERE action = 'student_memo.decided' AND entity_id = $1`, [
            String(memoId),
          ]),
        { timeout: 5_000 }
      )
      .toBe('rejected');
  });

  test('MD3: ตัดสินครั้งเดียว แก้ไม่ได้ — อนุมัติซ้ำ/กลับผลทั้งสองทิศ 409 · ผลเดิมไม่ขยับ', async ({ request }) => {
    const approvedId = await createMemo(request);
    const rejectedId = await createMemo(request, 'late_submission');
    await apiLoginAs(request, 'dean1');

    expect((await decide(request, approvedId, { decision: 'approved' })).status()).toBe(200);
    expect((await decide(request, rejectedId, { decision: 'rejected', note: NOTE_10 })).status()).toBe(200);
    const approvedAt = (await memoRow(approvedId))?.decided_at;
    const rejectedAt = (await memoRow(rejectedId))?.decided_at;

    // อนุมัติซ้ำ · กลับเป็นไม่อนุมัติ · ไม่อนุมัติแล้วกลับเป็นอนุมัติ
    const again = await decide(request, approvedId, { decision: 'approved' });
    expect(again.status()).toBe(409);
    expect((await again.json()).message as string).toContain('ตัดสินไปแล้ว');
    expect((await decide(request, approvedId, { decision: 'rejected', note: NOTE_10 })).status()).toBe(409);
    expect((await decide(request, rejectedId, { decision: 'approved' })).status()).toBe(409);

    expect(await memoRow(approvedId)).toMatchObject({ status: 'approved', decided_at: approvedAt });
    expect(await memoRow(rejectedId)).toMatchObject({
      status: 'rejected',
      decision_note: NOTE_10,
      decided_at: rejectedAt,
    });
  });

  test('MD4: รายการนำเข้าของเจ้าหน้าที่ = เฉพาะที่อนุมัติแล้ว หัวข้อ early_departure/late_submission ของภาคนั้น · ไม่เปิดให้บทบาทอื่น', async ({
    request,
  }) => {
    const approvedEarly = await createMemo(request, 'early_departure');
    const approvedLate = await createMemo(request, 'late_submission');
    const approvedChange = await createMemo(request, 'change_company'); // อนุมัติแต่หัวข้อไม่ผูกกับรอบพิเศษ
    const rejectedEarly = await createMemo(request, 'early_departure');
    const pendingEarly = await createMemo(request, 'early_departure');

    // บันทึกที่อนุมัติของ "ภาคอื่น" ต้องไม่โผล่ในภาคที่เปิดอยู่
    const { a, b } = await twoSemesters();
    const s2 = await userId('student2@test.com');
    const dean = await userId('dean1@test.com');
    const otherSemesterMemo = (await dbValue<number>(
      `INSERT INTO student_memos (student_id, semester_id, memo_type, reason, status, decided_by, decided_at)
       VALUES ($1, $2, 'early_departure', $3, 'approved', $4, NOW()) RETURNING memo_id`,
      [s2, b, REASON, dean]
    )) as number;

    await apiLoginAs(request, 'dean1');
    expect((await decide(request, approvedEarly, { decision: 'approved' })).status()).toBe(200);
    expect((await decide(request, approvedLate, { decision: 'approved' })).status()).toBe(200);
    expect((await decide(request, approvedChange, { decision: 'approved' })).status()).toBe(200);
    expect((await decide(request, rejectedEarly, { decision: 'rejected', note: NOTE_10 })).status()).toBe(200);
    // pendingEarly ไม่ตัดสิน

    await apiLoginAs(request, 'staff1');
    const listRes = await request.get(`${API_URL}/calendar/special-rounds/memos`);
    expect(listRes.status(), await listRes.text()).toBe(200);
    const text = await listRes.text();
    const list = JSON.parse(text) as Array<{ memo_id: number; memo_type: string; student_id: number; student_code: string }>;
    // เรียงใหม่สุดก่อน
    expect(list.map((m) => m.memo_id)).toEqual([approvedLate, approvedEarly]);
    expect(list.map((m) => m.memo_type)).toEqual(['late_submission', 'early_departure']);
    expect(list.every((m) => m.student_id === s2 && !!m.student_code)).toBe(true);
    // เจ้าหน้าที่เห็นแค่ตัวตน ไม่เห็นเหตุผลส่วนตัวในบันทึก
    expect(text).not.toContain(REASON);
    expect(list.map((m) => m.memo_id)).not.toContain(pendingEarly);
    expect(list.map((m) => m.memo_id)).not.toContain(otherSemesterMemo);

    // เลือกภาคอื่นได้ผลของภาคนั้น · รหัสภาคไม่ใช่ตัวเลข = 400
    const bView = await (await request.get(`${API_URL}/calendar/special-rounds/memos?semester_id=${b}`)).json();
    expect(bView.map((m: { memo_id: number }) => m.memo_id)).toEqual([otherSemesterMemo]);
    const aView = await (await request.get(`${API_URL}/calendar/special-rounds/memos?semester_id=${a}`)).json();
    expect(aView).toHaveLength(2);
    expect((await request.get(`${API_URL}/calendar/special-rounds/memos?semester_id=abc`)).status()).toBe(400);

    // บทบาทอื่นเปิดรายการนี้ไม่ได้ (แม้แต่คณบดีผู้ตัดสิน — การนำเข้าเป็นงานเจ้าหน้าที่)
    for (const who of ['dean1', 'advisor1', 'head1', 'student2'] as const) {
      await apiLoginAs(request, who);
      expect((await request.get(`${API_URL}/calendar/special-rounds/memos`)).status(), who).toBe(403);
    }

    // ปิดวงจร: นักศึกษาจากรายการนำเข้าเปิดรอบได้ — แต่ระบบไม่เปิดรอบเอง (คำตัดสินคืออนุญาต ไม่ใช่การเปิดรอบ)
    await apiLoginAs(request, 'staff1');
    expect(Number(await dbValue<string>('SELECT COUNT(*) FROM coop_special_rounds'))).toBe(0);
    const now = await today();
    const opened = await request.post(`${API_URL}/calendar/special-rounds`, {
      data: {
        semester_id: a,
        title: 'รอบจากบันทึกที่คณบดีอนุมัติ',
        start_date: shift(now, -1),
        end_date: shift(now, 5),
        activity_keys: ['intent_submission'],
        student_ids: [...new Set(list.map((m) => m.student_id))],
      },
    });
    expect(opened.status(), await opened.text()).toBe(201);
  });

  test('MD5: นักศึกษาเห็นสถานะและเหตุผลที่ไม่อนุมัติของบันทึกตัวเองที่ GET /api/memos/me', async ({ request }) => {
    const pendingId = await createMemo(request, 'change_company');
    const approvedId = await createMemo(request, 'early_departure');
    const rejectedId = await createMemo(request, 'late_submission');

    let mine = await (await request.get(`${API_URL}/memos/me`)).json();
    expect(mine).toHaveLength(3);
    expect(mine.every((m: { status: string; decided_at: string | null }) => m.status === 'pending' && m.decided_at === null)).toBe(true);

    await apiLoginAs(request, 'dean1');
    expect((await decide(request, approvedId, { decision: 'approved' })).status()).toBe(200);
    expect((await decide(request, rejectedId, { decision: 'rejected', note: 'ไม่อยู่ในเงื่อนไขของปฏิทินสหกิจศึกษา' })).status()).toBe(200);

    await apiLoginAs(request, 'student2');
    mine = await (await request.get(`${API_URL}/memos/me`)).json();
    const byId = new Map<number, { status: string; decision_note: string | null; decided_at: string | null }>(
      mine.map((m: { memo_id: number; status: string; decision_note: string | null; decided_at: string | null }) => [m.memo_id, m])
    );
    expect(byId.get(pendingId)).toMatchObject({ status: 'pending', decision_note: null, decided_at: null });
    expect(byId.get(approvedId)).toMatchObject({ status: 'approved', decision_note: null });
    expect(byId.get(approvedId)?.decided_at).toBeTruthy();
    expect(byId.get(rejectedId)).toMatchObject({
      status: 'rejected',
      decision_note: 'ไม่อยู่ในเงื่อนไขของปฏิทินสหกิจศึกษา',
    });

    // และนักศึกษาตัดสินบันทึกของตัวเองไม่ได้ (ปิดช่อง "อนุมัติตัวเองแล้วเข้ารอบพิเศษ")
    expect((await decide(request, pendingId, { decision: 'approved' })).status()).toBe(403);
    expect((await memoRow(pendingId))?.status).toBe('pending');
  });

  test('MD6: หน้าจอคณบดี — เลือกแถวซ้ายเห็นรายละเอียดของเรื่องนั้น (details + สถานประกอบการ) · ตัดสินในหน้าเดียวผ่านกล่องยืนยัน', async ({
    page,
    request,
  }) => {
    const s2 = await userId('student2@test.com');
    const studentCode = (await dbValue<string>('SELECT student_code FROM students WHERE student_id = $1', [s2]))!;
    const semesterId = (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'))!;
    const company = (await dbRow<{ company_id: number; name_th: string }>(
      'SELECT company_id, name_th FROM companies ORDER BY company_id LIMIT 1'
    ))!;
    const intentId = (await dbValue<number>(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
       VALUES ($1, $2, $3, 'pending_advisor') RETURNING form_id`,
      [s2, company.company_id, semesterId]
    ))!;

    // สร้างเรียง: early → late → change · หน้าจอเรียงใหม่สุดก่อน (change, late, early)
    const early = await createMemo(request, 'early_departure', {
      intent_form_id: intentId,
      details: { start_date: '2027-01-15' },
    });
    const late = await createMemo(request, 'late_submission', {
      details: { activities: ['intent_submission', 'final_report'], expected_date: '2027-02-10' },
    });
    const change = await createMemo(request, 'change_company', { intent_form_id: intentId });
    const newCompany = memoDetailsFor('change_company').new_company as string;

    await loginAs(page, 'dean1');
    await goToMenu(page, 'memos');

    // --- รายการซ้าย: รอพิจารณาขึ้นก่อน · ใหม่สุดก่อน ---
    await expect(page.getByText('รอพิจารณา · 3')).toBeVisible();
    await expect(page.getByText('ตัดสินแล้ว · 0')).toBeVisible();
    await expect(page.locator('[data-testid^="memo-row-"]')).toHaveCount(3);
    expect(
      await page.locator('[data-testid^="memo-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    ).toEqual([change, late, early].map((id) => `memo-row-${id}`));

    // --- เลือกทีละแถว: ทางขวาเปลี่ยนตามเรื่องที่เลือก ---
    const detail = page.getByTestId('memo-detail');

    await page.getByTestId(`memo-row-${early}`).click();
    await expect(detail).toContainText(studentCode);
    await expect(detail).toContainText(REASON);
    await expect(detail).toContainText('ขอเริ่มปฏิบัติงานวันที่');
    await expect(detail).toContainText(company.name_th); // สถานประกอบการจากใบความจำนงที่อ้างถึง
    await expect(detail).toContainText('ก่อนช่วงปกติได้'); // "ถ้าอนุมัติ" มาจาก outcome ของหัวข้อ
    await expect(detail).toContainText('2 เรื่อง'); // เรื่องอื่นของนักศึกษาคนเดียวกัน
    await expect(detail).not.toContainText('เอกสารที่ขอผ่อนผัน');

    await page.getByTestId(`memo-row-${late}`).click();
    await expect(detail).toContainText('เอกสารที่ขอผ่อนผัน');
    await expect(detail).toContainText('ใบแจ้งความจำนง (เอกสาร 1)');
    await expect(detail).toContainText('รายงานฉบับสมบูรณ์');
    await expect(detail).toContainText('คาดว่าจะส่งได้');
    await expect(detail).toContainText('ไม่ได้อ้างถึงใบแจ้งความจำนง'); // เรื่องนี้ไม่ได้อ้างใบ
    await expect(detail).not.toContainText('ขอเริ่มปฏิบัติงานวันที่');
    await expect(detail).not.toContainText(company.name_th);

    await page.getByTestId(`memo-row-${change}`).click();
    await expect(detail).toContainText('สถานที่ที่จะย้ายไป');
    await expect(detail).toContainText(newCompany);
    await expect(detail).toContainText(company.name_th); // ที่ฝึกเดิมจากใบที่อ้างถึง

    // --- ตัวกรองหัวข้อ + สาขา (คณบดีเห็นตัวกรองสาขา) ---
    await expect(page.getByTestId('memo-major-filter')).toBeVisible();
    await page.getByTestId('memo-type-filter-late_submission').click();
    await expect(page.locator('[data-testid^="memo-row-"]')).toHaveCount(1);
    await expect(page.getByTestId(`memo-row-${late}`)).toBeVisible();
    await page.getByTestId('memo-type-filter-all').click();
    await expect(page.locator('[data-testid^="memo-row-"]')).toHaveCount(3);

    // --- ไม่อนุมัติ: ต้องมีเหตุผล ≥ 10 ตัวอักษร ก่อนจะถึงกล่องยืนยัน ---
    await page.getByTestId(`memo-row-${early}`).click();
    const note = page.locator('#memo-decision-note');
    const needNote = page.getByText(/อย่างน้อย 10 ตัวอักษร นักศึกษาจะอ่านเหตุผลนี้/);
    await page.getByTestId(`memo-reject-${early}`).click();
    await expect(needNote).toBeVisible();
    await expect(page.getByTestId('memo-decision-confirm')).toHaveCount(0);
    await note.fill(NOTE_9);
    await page.getByTestId(`memo-reject-${early}`).click();
    await expect(needNote).toBeVisible();
    await expect(page.getByTestId('memo-decision-confirm')).toHaveCount(0);

    await note.fill(NOTE_10);
    await page.getByTestId(`memo-reject-${early}`).click();
    await expect(page.getByTestId('memo-decision-confirm')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(studentCode); // กล่องยืนยันบอกว่ากำลังทำกับใคร
    // ยกเลิกกล่องยืนยัน = ยังไม่ตัดสิน
    await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก' }).click();
    await expect(page.getByTestId('memo-decision-confirm')).toHaveCount(0);
    expect(await memoRow(early)).toMatchObject({ status: 'pending', decided_by: null });

    await page.getByTestId(`memo-reject-${early}`).click();
    await page.getByTestId('memo-decision-confirm').click();
    await expect(page.getByText(/บันทึกการไม่อนุมัติแล้ว/)).toBeVisible();
    const rejectedRow = await memoRow(early);
    expect(rejectedRow).toMatchObject({ status: 'rejected', decision_note: NOTE_10 });
    expect(rejectedRow?.decided_by).toBe(await userId('dean1@test.com'));

    // ตัดสินแล้ว: แถวเดิมยังเปิดอยู่ แต่เป็นสถานะแทนปุ่ม (แก้ไม่ได้)
    await expect(page.getByTestId(`memo-status-${early}`)).toHaveAttribute('data-status', 'rejected');
    await expect(page.getByTestId(`memo-status-${early}`)).toHaveText('ไม่อนุมัติ');
    await expect(detail).toContainText(`หมายเหตุ: ${NOTE_10}`);
    await expect(page.getByTestId(`memo-approve-${early}`)).toHaveCount(0);
    await expect(page.getByTestId(`memo-reject-${early}`)).toHaveCount(0);
    await expect(note).toHaveCount(0);

    // --- อนุมัติ: ไม่ต้องมีหมายเหตุ · หัวข้อที่ผูกกับรอบพิเศษบอกว่ารอเจ้าหน้าที่ ---
    await page.getByTestId(`memo-row-${late}`).click();
    await page.getByTestId(`memo-approve-${late}`).click();
    await page.getByTestId('memo-decision-confirm').click();
    await expect(page.getByText(/อนุมัติบันทึกข้อความแล้ว/)).toBeVisible();
    expect(await memoRow(late)).toMatchObject({ status: 'approved' });
    await expect(page.getByTestId(`memo-status-${late}`)).toHaveAttribute('data-status', 'approved');
    await expect(page.getByTestId(`memo-status-${late}`)).toHaveText('อนุมัติแล้ว');
    await expect(detail).toContainText('รอเจ้าหน้าที่เปิดรอบพิเศษ');

    // เรื่องที่ไม่ได้แตะยังรออยู่ และกดตัดสินได้
    await expect(page.getByText('รอพิจารณา · 1')).toBeVisible();
    await expect(page.getByText('ตัดสินแล้ว · 2')).toBeVisible();
    await page.getByTestId(`memo-row-${change}`).click();
    await expect(page.getByTestId(`memo-approve-${change}`)).toBeVisible();
    expect(await memoRow(change)).toMatchObject({ status: 'pending', decided_by: null });
  });

  test('MD7: อาจารย์ที่ปรึกษาเห็นหน้าเดียวกันแบบอ่านอย่างเดียว — ไม่มีปุ่มตัดสิน ไม่มีช่องหมายเหตุ ไม่มีตัวกรองสาขา', async ({
    page,
    request,
  }) => {
    const memoId = await createMemo(request);

    await loginAs(page, 'advisor1');
    await goToMenu(page, 'memos');
    await page.getByTestId(`memo-row-${memoId}`).click();

    await expect(page.getByTestId('memo-detail')).toContainText(REASON);
    await expect(page.getByTestId(`memo-pdf-${memoId}`)).toBeVisible();
    // ใบที่ยังรออยู่แสดงสถานะ ไม่ใช่ปุ่ม
    await expect(page.getByTestId(`memo-status-${memoId}`)).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId(`memo-approve-${memoId}`)).toHaveCount(0);
    await expect(page.getByTestId(`memo-reject-${memoId}`)).toHaveCount(0);
    await expect(page.locator('#memo-decision-note')).toHaveCount(0);
    await expect(page.getByTestId('memo-major-filter')).toHaveCount(0);

    // ฝั่ง API ยืนยันซ้ำ: อาจารย์ตัดสินไม่ได้แม้ยิงตรง (page.request ใช้ cookie เดียวกับเบราว์เซอร์)
    const res = await decide(page.request, memoId, { decision: 'approved' });
    expect(res.status()).toBe(403);
    expect((await memoRow(memoId))?.status).toBe('pending');
  });

  test('MD8: กระดิ่งคณบดี — "บันทึกข้อความรอพิจารณา" ขึ้นพร้อมจำนวน · เรื่องใหม่เข้ามาแจ้งซ้ำด้วยจำนวนใหม่ · กดแล้วพาไปเมนูบันทึกข้อความ', async ({
    page,
    request,
  }) => {
    await createMemo(request, 'early_departure');
    await createMemo(request, 'late_submission');

    await loginAs(page, 'dean1');
    await page.getByTestId('navbar-bell-btn').click();
    await expect(page.getByText('บันทึกข้อความรอพิจารณา')).toHaveCount(1);
    await expect(page.getByText('2 เรื่อง รอคณบดีอนุมัติหรือไม่อนุมัติ')).toBeVisible();

    // นักศึกษายื่นเพิ่ม → จำนวนเปลี่ยน → id ใหม่ → แจ้งซ้ำ (ผูกกับจำนวนโดยตั้งใจ)
    await createMemo(request, 'change_company');
    await page.reload();
    await page.getByTestId('navbar-bell-btn').click();
    await expect(page.getByText('3 เรื่อง รอคณบดีอนุมัติหรือไม่อนุมัติ')).toBeVisible();

    await page.getByText('3 เรื่อง รอคณบดีอนุมัติหรือไม่อนุมัติ').click();
    await expect(page).toHaveURL(/menu=memos/);
  });
});
