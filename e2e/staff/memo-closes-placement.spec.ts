import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbValue, mentor1Id } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { submitRequestToDirectoryCompany } from '../helpers/intent';
import { shift, today, userId } from '../helpers/semesters';
import { memoDetailsFor } from '../helpers/memo';

/**
 * คณบดีอนุมัติ "เปลี่ยนสถานประกอบการ / ส่งตัวกลับ" → เจ้าหน้าที่เห็นป้ายแล้วปิดใบที่ฝึก (2026-10-18)
 *
 * ต่อจาก `faculty/memo-dean-decision` (คณบดีตัดสิน) และ `workflows/placement-replacement` (ปิดใบ) — เทสต์นี้คุมรอยต่อระหว่างสองอย่างนั้น
 * คำอนุมัติ **ไม่ปิดใบเอง** · ระบบแค่บอกเจ้าหน้าที่ว่าใบไหนควรปิด (ปิดแล้วแก้ไม่ได้ในทางปฏิบัติ จึงต้องมีคนกด)
 *
 * คุม "ใครเห็น/ทำได้อะไร" ก่อนหน้าตา:
 *   MC1 change_company อนุมัติ → ป้าย + แบนเนอร์ + dialog เติมค่าให้ → ปิดใบ → ป้ายหาย · ใบ superseded · นักศึกษายื่นใหม่ได้
 *   MC2 terminated แมปเป็นเหตุ `sent_back` (ไม่ใช่ change_company)
 *   MC3 ป้ายขึ้นเฉพาะ **อนุมัติ + หัวข้อเปลี่ยนที่/ส่งตัวกลับ + อ้างใบที่ accepted อยู่** — pending · rejected · หัวข้อรอบพิเศษ · ไม่อ้างใบ = ไม่ขึ้น
 *   MC4 บันทึกที่อ้างใบเก่า (ปิดไปแล้ว) ไม่ไปโผล่ที่ใบใหม่ของนักศึกษาคนเดิม
 *   MC5 SEC-10: อาจารย์/หัวหน้าสาขาไม่ได้ฟิลด์ `placement` เลย (เหตุผลส่วนตัวของนักศึกษาอยู่ในนั้น) · `/staff/home` ไม่เปิดให้บทบาทอื่น
 *   MC6 กระดิ่งเจ้าหน้าที่ "คณบดีอนุมัติให้ปิดใบที่ฝึก" + จำนวนที่ `/staff/home`
 *
 * ข้อมูลทั้งหมดเป็นของปลอม · ⛔ สเปคนี้ยังไม่เคยรัน (เขียนเตรียมไว้ 2026-10-18 — เจ้าของสั่งรันเอง)
 */

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const ACTIVE_SEMESTER = '(SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1)';
const FIRST_COMPANY = '(SELECT company_id FROM companies ORDER BY company_id LIMIT 1)';
const MEMO_REASON = 'สถานประกอบการแจ้งปิดสายการผลิตกะทันหัน ขอเปลี่ยนสถานที่ปฏิบัติงานสหกิจศึกษา';
const TERMINATED_REASON = 'สถานประกอบการแจ้งยุติโครงการและส่งตัวนักศึกษากลับก่อนครบกำหนด';
const CLOSED_TOAST = 'ปิดใบที่ฝึกงานแล้ว นักศึกษายื่นคำร้องขอหนังสือสำหรับที่ใหม่ได้ทันที';
const BANNER = /คณบดีอนุมัติเปลี่ยนสถานประกอบการ\/ส่งตัวกลับแล้ว \d+ คน/;

interface ProgressRow {
  studentId: number;
  studentCode: string;
  placement?: {
    form_id: number;
    status: string;
    closed_kind: string | null;
    can_reopen: boolean;
    approved_memo: { memo_id: number; memo_type: string; reason: string; decided_at: string } | null;
  } | null;
}

/** ใบ `accepted` ของ student2 ที่ mentor1 ดูแล · คืน form_id */
async function seedAccepted(): Promise<number> {
  const mentorId = await mentor1Id();
  return (await dbValue<number>(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date, end_date)
     VALUES (${STUDENT2}, ${FIRST_COMPANY}, ${ACTIVE_SEMESTER}, 'accepted', $1,
             (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 14, (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 90)
     RETURNING form_id`,
    [mentorId]
  )) as number;
}

/** นักศึกษา (student2) ยื่นบันทึก → คืน memo_id · session ของ `request` ค้างเป็นนักศึกษา */
async function studentMemo(
  request: APIRequestContext,
  memoType: string,
  formId: number | null,
  reason = MEMO_REASON
): Promise<number> {
  await apiLoginAs(request, 'student2');
  const res = await request.post(`${API_URL}/memos`, {
    data: { memo_type: memoType, reason, details: memoDetailsFor(memoType), intent_form_id: formId },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).memo.memo_id as number;
}

/** คณบดีตัดสิน (ต้องสำเร็จ) */
async function deanDecides(request: APIRequestContext, memoId: number, decision: 'approved' | 'rejected'): Promise<void> {
  await apiLoginAs(request, 'dean1');
  const res = await request.patch(`${API_URL}/memos/${memoId}/decision`, {
    data: decision === 'rejected' ? { decision, note: 'ไม่อยู่ในเงื่อนไขของคณะ' } : { decision },
  });
  expect(res.status(), await res.text()).toBe(200);
}

/** แถวของ student2 บน GET /coop-progress/dashboard ในมุมมองของบัญชีที่ล็อกอินอยู่ */
async function progressRow(request: APIRequestContext): Promise<ProgressRow | undefined> {
  const res = await request.get(`${API_URL}/coop-progress/dashboard`);
  expect(res.status(), await res.text()).toBe(200);
  const studentId = await userId('student2@test.com');
  return ((await res.json()).data as ProgressRow[]).find((r) => r.studentId === studentId);
}

const memoClosuresPending = async (request: APIRequestContext): Promise<number> => {
  const res = await request.get(`${API_URL}/staff/home`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).memo_closures_pending as number;
};

const formRow = (formId: number) =>
  dbRow<{ status: string; closed_kind: string | null; reject_reason: string | null }>(
    'SELECT status, closed_kind, reject_reason FROM intent_forms WHERE form_id = $1',
    [formId]
  );

const studentCodeOf = async () =>
  (await dbValue<string>(`SELECT student_code FROM students WHERE student_id = ${STUDENT2}`))!;

/** ปฏิทินยื่นคำร้องปิดไปแล้ว 10 วัน — นักศึกษาที่ถูกปิดใบต้องยื่นที่ใหม่ได้ด้วยสิทธิ์ผ่านเท่านั้น */
async function closeIntentWindow(): Promise<void> {
  const closedOn = shift(await today(), -10);
  await dbExec(
    `DELETE FROM coop_calendar_events WHERE activity_key = 'intent_submission' AND semester_id = ${ACTIVE_SEMESTER}`
  );
  await dbExec(
    `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date)
     VALUES (${ACTIVE_SEMESTER}, 'intent_submission', 'range', $1::date - 60, $1::date)`,
    [closedOn]
  );
}

test.describe('คณบดีอนุมัติเปลี่ยนที่/ส่งตัวกลับ → เจ้าหน้าที่เห็นป้ายและปิดใบที่ฝึก', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('MC1: เปลี่ยนสถานประกอบการ — เจ้าหน้าที่เห็นป้ายและแบนเนอร์ · dialog เติมเหตุกับเหตุผลให้ · ปิดแล้วป้ายหาย ใบ superseded นักศึกษายื่นใหม่ได้', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const formId = await seedAccepted();
    const code = await studentCodeOf();
    const memoId = await studentMemo(request, 'change_company', formId);

    // ยังไม่อนุมัติ = ยังไม่มีป้าย
    await apiLoginAs(request, 'staff1');
    expect((await progressRow(request))?.placement?.approved_memo).toBeNull();

    await deanDecides(request, memoId, 'approved');
    // คำอนุมัติไม่ปิดใบเอง — ใบยัง accepted จนกว่าเจ้าหน้าที่กด
    expect((await formRow(formId))?.status).toBe('accepted');

    await apiLoginAs(request, 'staff1');
    const row = await progressRow(request);
    expect(row?.placement).toMatchObject({ form_id: formId, status: 'accepted' });
    expect(row?.placement?.approved_memo).toMatchObject({
      memo_id: memoId,
      memo_type: 'change_company',
      reason: MEMO_REASON,
    });
    expect(row?.placement?.approved_memo?.decided_at).toBeTruthy();

    await loginAs(page, 'staff1');
    await goToMenu(page, 'final_progress');

    const badge = page.getByTestId(`approved-memo-${code}`);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('คณบดีอนุมัติ: เปลี่ยนสถานประกอบการ');
    await expect(page.getByText('คณบดีอนุมัติเปลี่ยนสถานประกอบการ/ส่งตัวกลับแล้ว 1 คน')).toBeVisible();

    await page.getByTestId(`close-accepted-${code}`).click();
    const dialog = page.getByTestId('close-accepted-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('close-accepted-memo-note')).toContainText('เปลี่ยนสถานประกอบการ');
    // ระบบเติมให้ ไม่ต้องพิมพ์เอง → ปุ่มยืนยันกดได้ทันที
    await expect(page.getByTestId('close-accepted-kind')).toHaveValue('change_company');
    await expect(page.getByTestId('close-accepted-reason')).toHaveValue(MEMO_REASON);
    const submit = page.getByTestId('close-accepted-submit');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(CLOSED_TOAST)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    // ป้าย ปุ่มปิด และแบนเนอร์หายหมด (ผูกกับ form_id ของใบที่เพิ่งปิด)
    await expect(badge).toHaveCount(0);
    await expect(page.getByTestId(`close-accepted-${code}`)).toHaveCount(0);
    await expect(page.getByText(BANNER)).toHaveCount(0);
    expect(await formRow(formId)).toMatchObject({
      status: 'superseded',
      closed_kind: 'change_company',
      reject_reason: MEMO_REASON,
    });

    await apiLoginAs(request, 'staff1');
    expect((await progressRow(request))?.placement?.approved_memo).toBeNull();
    expect(await memoClosuresPending(request)).toBe(0);

    // นักศึกษายื่นที่ใหม่ได้แม้ปฏิทินยื่นคำร้องปิดแล้ว
    await closeIntentWindow();
    await loginAs(page, 'student2');
    await page.getByRole('link', { name: 'ยื่นคำร้องขอหนังสือ' }).click();
    await expect(
      page.getByText('คุณได้รับสิทธิ์ยื่นนอกช่วงปฏิทิน เพราะเจ้าหน้าที่ปิดใบที่ฝึกงานเดิม')
    ).toBeVisible();
    await submitRequestToDirectoryCompany(page);
    await expect(
      page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')
    ).toBeVisible();
    expect(
      await dbValue<number>(
        `SELECT COUNT(*)::int FROM intent_forms WHERE student_id = ${STUDENT2} AND status = 'pending_advisor'`
      )
    ).toBe(1);
  });

  test('MC2: ถูกส่งตัวกลับ — dialog เติมเหตุเป็น "สถานประกอบการส่งตัวกลับ" (sent_back) · ปิดแล้วบันทึก closed_kind ตามนั้น', async ({
    page,
    request,
  }) => {
    const formId = await seedAccepted();
    const code = await studentCodeOf();
    const memoId = await studentMemo(request, 'terminated', formId, TERMINATED_REASON);
    await deanDecides(request, memoId, 'approved');

    await apiLoginAs(request, 'staff1');
    expect((await progressRow(request))?.placement?.approved_memo).toMatchObject({
      memo_id: memoId,
      memo_type: 'terminated',
      reason: TERMINATED_REASON,
    });

    await loginAs(page, 'staff1');
    await goToMenu(page, 'final_progress');
    await expect(page.getByTestId(`approved-memo-${code}`)).toContainText('คณบดีอนุมัติ: ถูกส่งตัวกลับ / ยุติการปฏิบัติงาน');

    await page.getByTestId(`close-accepted-${code}`).click();
    await expect(page.getByTestId('close-accepted-memo-note')).toContainText('ถูกส่งตัวกลับ / ยุติการปฏิบัติงาน');
    // terminated ไม่ได้แมปเป็น change_company
    await expect(page.getByTestId('close-accepted-kind')).toHaveValue('sent_back');
    await expect(page.getByTestId('close-accepted-reason')).toHaveValue(TERMINATED_REASON);
    await page.getByTestId('close-accepted-submit').click();

    await expect(page.getByText(CLOSED_TOAST)).toBeVisible();
    await expect(page.getByTestId(`approved-memo-${code}`)).toHaveCount(0);
    expect(await formRow(formId)).toMatchObject({
      status: 'superseded',
      closed_kind: 'sent_back',
      reject_reason: TERMINATED_REASON,
    });
  });

  test('MC3: ป้ายขึ้นเฉพาะ อนุมัติ + หัวข้อเปลี่ยนที่/ส่งตัวกลับ + อ้างใบที่ accepted อยู่ — pending · rejected · หัวข้อรอบพิเศษ · ไม่อ้างใบ ไม่ขึ้น', async ({
    page,
    request,
  }) => {
    const formId = await seedAccepted();
    const code = await studentCodeOf();

    const pendingChange = await studentMemo(request, 'change_company', formId);
    const rejectedTerminated = await studentMemo(request, 'terminated', formId);
    const approvedEarly = await studentMemo(request, 'early_departure', formId);
    const approvedLate = await studentMemo(request, 'late_submission', formId);
    const approvedUnlinked = await studentMemo(request, 'change_company', null);
    await deanDecides(request, rejectedTerminated, 'rejected');
    await deanDecides(request, approvedEarly, 'approved');
    await deanDecides(request, approvedLate, 'approved');
    await deanDecides(request, approvedUnlinked, 'approved');

    // ห้าอย่างข้างบน ไม่มีอันไหนทำให้ขึ้นป้าย (อนุมัติแล้วสามอัน แต่ผิดหัวข้อหรือไม่ได้อ้างใบ)
    await apiLoginAs(request, 'staff1');
    const before = await progressRow(request);
    expect(before?.placement).toMatchObject({ form_id: formId, status: 'accepted' });
    expect(before?.placement?.approved_memo).toBeNull();
    expect(await memoClosuresPending(request)).toBe(0);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'final_progress');
    // ปุ่มปิดใบยังมีให้เจ้าหน้าที่ใช้เองได้ตามปกติ แต่ไม่มีป้าย ไม่มีแบนเนอร์ และ dialog ไม่เติมค่าให้
    await expect(page.getByTestId(`close-accepted-${code}`)).toBeVisible();
    await expect(page.getByTestId(`approved-memo-${code}`)).toHaveCount(0);
    await expect(page.getByText(BANNER)).toHaveCount(0);
    await page.getByTestId(`close-accepted-${code}`).click();
    await expect(page.getByTestId('close-accepted-dialog')).toBeVisible();
    await expect(page.getByTestId('close-accepted-memo-note')).toHaveCount(0);
    await expect(page.getByTestId('close-accepted-kind')).toHaveValue('');
    await expect(page.getByTestId('close-accepted-reason')).toHaveValue('');
    await expect(page.getByTestId('close-accepted-submit')).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'ยกเลิก' }).click();

    // ตัวควบคุม: อนุมัติอันที่ pending (change_company อ้างใบนี้) → ขึ้นป้าย — ข้างบนไม่ขึ้นเพราะเงื่อนไข ไม่ใช่เพราะระบบพัง
    await deanDecides(request, pendingChange, 'approved');
    await apiLoginAs(request, 'staff1');
    expect((await progressRow(request))?.placement?.approved_memo).toMatchObject({ memo_id: pendingChange });
    expect(await memoClosuresPending(request)).toBe(1);
    await page.reload();
    await goToMenu(page, 'final_progress');
    await expect(page.getByTestId(`approved-memo-${code}`)).toBeVisible();
  });

  test('MC4: บันทึกที่อ้างใบเก่า (ปิดไปแล้ว) ไม่โผล่ที่ใบ accepted ใบใหม่ของนักศึกษาคนเดิม', async ({ page, request }) => {
    const oldFormId = await seedAccepted();
    const code = await studentCodeOf();
    const memoId = await studentMemo(request, 'change_company', oldFormId);
    await deanDecides(request, memoId, 'approved');

    // เจ้าหน้าที่ปิดใบเก่า
    await apiLoginAs(request, 'staff1');
    const closed = await request.post(`${API_URL}/intents/${oldFormId}/close-accepted`, {
      data: { kind: 'change_company', reason: MEMO_REASON },
    });
    expect(closed.status(), await closed.text()).toBe(200);
    expect((await formRow(oldFormId))?.status).toBe('superseded');

    // นักศึกษาได้ที่ใหม่ → ใบ accepted ใบใหม่ (form_id ต่างจากใบที่บันทึกอ้างถึง)
    const newFormId = await seedAccepted();
    expect(newFormId).not.toBe(oldFormId);

    await apiLoginAs(request, 'staff1');
    const row = await progressRow(request);
    expect(row?.placement).toMatchObject({ form_id: newFormId, status: 'accepted' });
    expect(row?.placement?.approved_memo, 'บันทึกของใบเก่าห้ามมาติดใบใหม่').toBeNull();
    expect(await memoClosuresPending(request)).toBe(0);

    await loginAs(page, 'staff1');
    await goToMenu(page, 'final_progress');
    await expect(page.getByTestId(`close-accepted-${code}`)).toBeVisible();
    await expect(page.getByTestId(`approved-memo-${code}`)).toHaveCount(0);
    await expect(page.getByText(BANNER)).toHaveCount(0);
  });

  test('MC5: อาจารย์/หัวหน้าสาขาเรียก dashboard ไม่ได้ฟิลด์ placement (เหตุผลส่วนตัวไม่ไปด้วย) · /staff/home ไม่เปิดให้บทบาทอื่น', async ({
    request,
  }) => {
    const formId = await seedAccepted();
    // ให้ advisor1 เป็นทั้งอาจารย์ที่ปรึกษาและนิเทศของ student2 — เห็นแถวนี้แน่ ๆ (ไม่งั้นเทสต์ว่างเปล่า)
    await dbExec(
      `UPDATE students SET advisor_id = (SELECT user_id FROM users WHERE email = 'advisor1@test.com'),
                           supervisor_id = (SELECT user_id FROM users WHERE email = 'advisor1@test.com')
        WHERE student_id = ${STUDENT2}`
    );
    const memoId = await studentMemo(request, 'change_company', formId);
    await deanDecides(request, memoId, 'approved');

    // ตัวควบคุม: เจ้าหน้าที่เห็นครบ
    await apiLoginAs(request, 'staff1');
    expect((await progressRow(request))?.placement?.approved_memo).toMatchObject({ memo_id: memoId, reason: MEMO_REASON });

    const code = await studentCodeOf();
    for (const who of ['advisor1', 'head1'] as const) {
      await apiLoginAs(request, who);
      const res = await request.get(`${API_URL}/coop-progress/dashboard`);
      expect(res.status(), who).toBe(200);
      const text = await res.text();
      const rows = JSON.parse(text).data as ProgressRow[];
      expect(
        rows.some((r) => r.studentCode === code),
        `${who} ต้องเห็นแถวของ student2 ไม่งั้นเทสต์นี้ไม่ได้ตรวจอะไร`
      ).toBe(true);
      for (const r of rows) {
        expect(r, `${who} ต้องไม่ได้ placement`).not.toHaveProperty('placement');
      }
      // ทั้งก้อนต้องไม่มีเหตุผลที่นักศึกษาเขียนหลุดมาจากทางไหนเลย
      expect(text, who).not.toContain(MEMO_REASON);
      expect(text, who).not.toContain('approved_memo');
    }

    // จำนวนงานปิดใบเป็นของเจ้าหน้าที่ — บทบาทอื่นเรียกหน้าแรกเจ้าหน้าที่ไม่ได้
    for (const who of ['student2', 'advisor1', 'head1', 'dean1'] as const) {
      await apiLoginAs(request, who);
      const res = await request.get(`${API_URL}/staff/home`);
      expect([401, 403], `${who} ต้องเปิด /staff/home ไม่ได้ (ได้ ${res.status()})`).toContain(res.status());
      expect(await res.text(), who).not.toContain('memo_closures_pending');
    }
  });

  test('MC6: กระดิ่งเจ้าหน้าที่ "คณบดีอนุมัติให้ปิดใบที่ฝึก" ขึ้นพร้อมจำนวน · /staff/home นับตามนักศึกษา · กดแล้วพาไปหน้าติดตามเอกสาร', async ({
    page,
    request,
  }) => {
    const formId = await seedAccepted();
    const memoId = await studentMemo(request, 'change_company', formId);

    // ยังไม่อนุมัติ = ไม่มีรายการ
    await apiLoginAs(request, 'staff1');
    expect(await memoClosuresPending(request)).toBe(0);

    await deanDecides(request, memoId, 'approved');
    // อนุมัติสองฉบับของนักศึกษาคนเดียวกันที่อ้างใบเดียวกัน = นับเป็น 1 คน ไม่ใช่ 2
    const second = await studentMemo(request, 'terminated', formId, TERMINATED_REASON);
    await deanDecides(request, second, 'approved');
    await apiLoginAs(request, 'staff1');
    expect(await memoClosuresPending(request)).toBe(1);

    await loginAs(page, 'staff1');
    await page.getByTestId('navbar-bell-btn').click();
    await expect(page.getByText('คณบดีอนุมัติให้ปิดใบที่ฝึก')).toHaveCount(1);
    await expect(page.getByText(/1 คน — ไปที่ติดตามเอกสารนักศึกษา/)).toBeVisible();

    await page.getByText('คณบดีอนุมัติให้ปิดใบที่ฝึก').click();
    await expect(page).toHaveURL(/menu=final_progress/);
  });
});
