import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbRow, dbValue, mentor1Id, withDb } from '../helpers/db';
import { apiLoginAs, loginAs, DEFAULT_PASSWORD } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';
import { submitRequestToDirectoryCompany } from '../helpers/intent';
import { shift } from '../helpers/semesters';

/**
 * โฟลว์หลุดเส้นทาง: นักศึกษายื่นบันทึกข้อความขอเปลี่ยนสถานประกอบการ →
 * เจ้าหน้าที่ปิดใบเดิมด้วยเหตุเปลี่ยนสถานประกอบการ → นักศึกษาได้สิทธิ์ replacement_pass
 * และยื่นคำร้องขอที่ฝึกงานใหม่นอกช่วงปฏิทินได้จนสำเร็จ (R3 Off-track Handling)
 */

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";
const ACTIVE_SEMESTER = '(SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1)';
const FIRST_COMPANY = '(SELECT company_id FROM companies ORDER BY company_id LIMIT 1)';
const MEMO_REASON = 'สถานประกอบการแจ้งปิดสายการผลิตกะทันหัน ขอยื่นคำร้องขอเปลี่ยนสถานที่ปฏิบัติงานสหกิจศึกษา';
const CLOSE_REASON = 'สาขาแจ้งตามบันทึกข้อความ: สถานประกอบการปิดสายการผลิต';

const todayTh = async () =>
  (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;

/** สร้างใบ `accepted` ของ student2 ที่ mentor1 ดูแล */
async function seedAcceptedPlacement(): Promise<number> {
  const mentorId = await mentor1Id();
  return (await dbValue<number>(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date, end_date)
     VALUES (${STUDENT2}, ${FIRST_COMPANY}, ${ACTIVE_SEMESTER}, 'accepted', $1,
             (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 14, (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 90)
     RETURNING form_id`,
    [mentorId]
  )) as number;
}

/** ตั้งช่วงของกิจกรรมในภาคที่เปิดอยู่ */
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

/** ปิดช่วงปฏิทินการยื่นคำร้องทั้งหมด (เลยกำหนดไปแล้ว 10 วัน) */
async function closePlacementWindows(): Promise<void> {
  const closedOn = shift(await todayTh(), -10);
  await setWindow('intent_submission', 'range', closedOn);
  await setWindow('acceptance_form', 'deadline', closedOn);
  await setWindow('accommodation_plan', 'range', closedOn);
}

test.describe('การจัดการกรณีหลุดเส้นทาง: บันทึกข้อความ → ปิดใบ → ยื่นที่ใหม่นอกปฏิทิน (R3 Workflow)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('MR1: โฟลว์ต่อเนื่อง — นักศึกษายื่นบันทึกขอเปลี่ยนที่ฝึก → เจ้าหน้าที่ปิดใบ → นักศึกษาได้สิทธิ์ยื่นที่ใหม่นอกปฏิทิน', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const oldFormId = await seedAcceptedPlacement();
    const studentCode = (await dbValue<string>(
      `SELECT student_code FROM students WHERE student_id = ${STUDENT2}`
    ))!;

    // ── 1. นักศึกษาเข้าสู่ระบบ และยื่นบันทึกข้อความขอเปลี่ยนสถานประกอบการ ──
    await loginAs(page, 'student2');
    await goToMenu(page, 'memos');
    await expect(page.getByRole('heading', { name: 'บันทึกข้อความถึงคณบดี' })).toBeVisible();

    // เลือกประเภทบันทึกข้อความ: เปลี่ยนสถานประกอบการ
    await page.locator('#memo-type').selectOption('change_company');
    await expect(page.getByText(/ได้รับการตอบรับจากที่หนึ่งแล้ว/)).toBeVisible();

    // กรอกเหตุผลและยื่นบันทึกข้อความ
    await page.locator('#memo-reason').fill(MEMO_REASON);
    await page.getByRole('button', { name: 'บันทึกและเตรียมพิมพ์' }).click();

    // กล่องยืนยันการบันทึกข้อความ
    await expect(page.getByTestId('confirm-summary')).toContainText('สถานประกอบการแจ้งปิดสายการผลิต');
    await page.getByTestId('memo-confirm').click();

    // ยืนยันว่าบันทึกสำเร็จและมีปุ่มพิมพ์
    await expect(page.getByText(/บันทึกข้อความเรียบร้อยแล้ว/)).toBeVisible();
    await expect(page.getByTestId('memo-row')).toHaveCount(1);
    await expect(page.getByTestId('memo-print')).toBeVisible();

    // ตรวจสอบฐานข้อมูลว่า memo ถูกบันทึกจริง
    const memoRow = await dbRow<{ memo_type: string; reason: string }>(
      `SELECT memo_type, reason FROM student_memos WHERE student_id = ${STUDENT2} ORDER BY memo_id DESC LIMIT 1`
    );
    expect(memoRow?.memo_type).toBe('change_company');
    expect(memoRow?.reason).toBe(MEMO_REASON);

    await logout(page);

    // ── 2. เจ้าหน้าที่สหกิจตรวจสอบและทำการปิดใบที่ตอบรับแล้ว (Close Accepted) ──
    await loginAs(page, 'staff1');
    await goToMenu(page, 'final_progress');
    await expect(page.getByRole('heading', { name: 'กระดานติดตามสถานะและผลการประเมิน' })).toBeVisible();

    // คลิกปุ่มปิดใบที่ตอบรับแล้วของนักศึกษาคนนี้
    const closeBtn = page.getByTestId(`close-accepted-${studentCode}`);
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // ตรวจสอบกล่องสนทนายืนยันการปิดใบ
    const dialog = page.getByTestId('close-accepted-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(studentCode);

    // เลือกเหตุ: เปลี่ยนสถานประกอบการ (change_company)
    await page.getByTestId('close-accepted-kind').selectOption('change_company');
    await page.getByTestId('close-accepted-reason').fill(CLOSE_REASON);
    await page.getByTestId('close-accepted-submit').click();

    // ยืนยันข้อความแจ้งการปิดใบเรียบร้อย
    await expect(
      page.getByText('ปิดใบที่ฝึกงานแล้ว นักศึกษายื่นคำร้องขอหนังสือสำหรับที่ใหม่ได้ทันที')
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);

    // ตรวจสอบสถานะใบเดิมในฐานข้อมูลกลายเป็น superseded
    const closedRow = await dbRow<{ status: string; closed_kind: string; reject_reason: string }>(
      'SELECT status, closed_kind, reject_reason FROM intent_forms WHERE form_id = $1',
      [oldFormId]
    );
    expect(closedRow?.status).toBe('superseded');
    expect(closedRow?.closed_kind).toBe('change_company');
    expect(closedRow?.reject_reason).toBe(CLOSE_REASON);

    // ตรวจสอบว่านักศึกษาได้รับ replacement pass (มี intent_forms สถานะ superseded ในภาคที่เปิด)
    const hasReplacementPass = await dbValue<boolean>(
      `SELECT EXISTS (
         SELECT 1 FROM intent_forms i
           JOIN coop_semesters s ON s.semester_id = i.semester_id
          WHERE i.student_id = ${STUDENT2} AND i.status = 'superseded' AND s.is_active = TRUE
       )`
    );
    expect(hasReplacementPass).toBe(true);

    await logout(page);

    // ── 3. จำลองเหตุการณ์: ปฏิทินสหกิจปิดการยื่นคำร้องไปแล้ว 10 วัน ──
    await closePlacementWindows();

    // ── 4. นักศึกษาเข้าสู่ระบบ และใช้สิทธิ์ replacement_pass ยื่นคำร้องที่ใหม่นอกปฏิทิน ──
    await loginAs(page, 'student2');

    // หน้าแรกแจ้งเตือนว่าสถานประกอบการเดิมถูกปิด และมีสิทธิ์ยื่นที่ใหม่
    await expect(page.getByText(/เจ้าหน้าที่ปิดใบที่ฝึกงานเดิม/)).toBeVisible();
    await expect(page.getByText(`เหตุผล: ${CLOSE_REASON}`)).toBeVisible();

    // กดปุ่มยื่นคำร้องขอหนังสือสำหรับที่ใหม่
    await page.getByRole('link', { name: 'ยื่นคำร้องขอหนังสือ' }).click();

    // แถบแจ้งเตือนยืนยันสิทธิ์การยื่นนอกช่วงปฏิทิน
    await expect(
      page.getByText('คุณได้รับสิทธิ์ยื่นนอกช่วงปฏิทิน เพราะเจ้าหน้าที่ปิดใบที่ฝึกงานเดิม')
    ).toBeVisible();

    // นักศึกษายื่นคำร้องขอหนังสือถึงบริษัทในทำเนียบ (ซีเกท) สำเร็จ แม้ปฏิทินจะปิดแล้ว
    await submitRequestToDirectoryCompany(page);
    await expect(
      page.locator('text=ยื่นคำร้องถึง บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด เรียบร้อยแล้ว')
    ).toBeVisible();

    // ยืนยันว่าใบคำร้องใหม่เกิดขึ้นในฐานข้อมูล สถานะ pending_advisor
    const newFormCount = await dbValue<number>(
      `SELECT COUNT(*)::int FROM intent_forms WHERE student_id = ${STUDENT2} AND status = 'pending_advisor'`
    );
    expect(newFormCount).toBe(1);

    await logout(page);
  });
});
