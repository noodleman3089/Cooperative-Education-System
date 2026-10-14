import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL, APP_URL } from '../helpers/env';
import { dbValue, dbExec, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';

/**
 * แผนการปฏิบัติงาน (สหกิจ 07 หน้า 3) ถูกตัดออกจากระบบตามข้อกำหนด R4
 *
 * สิ่งที่ชุดนี้ยืนยันเชิงลบ (Negative Assertions):
 *   1. หน้าจอนักศึกษาไม่มีแท็บหรือฟอร์มแผนการปฏิบัติงาน (เหลือเฉพาะแบบแจ้งที่พัก สหกิจ 06)
 *   2. หน้าจอพี่เลี้ยงไม่มีแท็บ `certify-tab-plan` และการเปิด `?tab=plan` ตกไปที่แท็บบันทึก
 *   3. หน้าจออาจารย์ไม่มีส่วนตรวจหรือแท็บแผนปฏิบัติงาน (สหกิจ 07 หน้า 3)
 *   4. หน้าจอเจ้าหน้าที่ไม่มีคิวติดตามแผนปฏิบัติงานใน `MentorFollowup`
 *   5. API endpoints ของแผนปฏิบัติงาน (`/students/:id/work-plan*`) ตอบ 404 ทั้งหมด
 */

async function seedAcceptedIntent(): Promise<number> {
  return withDb(async (db) => {
    const studentId = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id as number;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id as number;
    const companyId = (
      await db.query('SELECT company_id FROM companies LIMIT 1')
    ).rows[0].company_id as number;
    const mentorId = (
      await db.query("SELECT user_id FROM users WHERE email = 'mentor1@test.com'")
    ).rows[0].user_id as number;

    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
       VALUES ($1, $2, $3, 'accepted', $4, (NOW() AT TIME ZONE 'Asia/Bangkok')::date)`,
      [studentId, companyId, semesterId, mentorId]
    );

    await db.query(
      `UPDATE students SET emergency_contact_name = 'นางสมศรี ใจดี', emergency_relationship = 'มารดา',
              emergency_phone = '0898765432' WHERE student_id = $1`,
      [studentId]
    );

    return studentId;
  });
}

test.describe('การตัดแผนปฏิบัติงาน (สหกิจ 07 หน้า 3) ออกจากระบบ (R4 Negative Assertions)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('WP1: หน้าจอนักศึกษา — เมนูและหน้าแบบแจ้งที่พักไม่มีแท็บหรือช่องแผนการปฏิบัติงาน', async ({
    page,
  }) => {
    await seedAcceptedIntent();
    await loginAs(page, 'student2');

    // ตรวจสอบเมนูด้านข้าง (Sidebar) ต้องไม่มีเมนูแผนการปฏิบัติงาน
    await expect(page.getByTestId('nav-work_plan')).toHaveCount(0);
    await expect(page.getByTestId('nav-work-plan')).toHaveCount(0);

    // เปิดหน้าแบบแจ้งที่พัก (สหกิจ 06)
    await goToMenu(page, 'accommodation_plan');
    await expect(page.getByRole('heading', { name: /แจ้งรายละเอียดที่พัก/ })).toBeVisible();

    // ต้องไม่มีแท็บหรือส่วนกรอกแผนการปฏิบัติงาน
    await expect(page.getByTestId('workplan-tab')).toHaveCount(0);
    await expect(page.getByTestId('work-plan-section')).toHaveCount(0);
    await expect(page.getByText('แผนการปฏิบัติงาน (สหกิจ 07 หน้า 3)')).toHaveCount(0);
    await expect(page.getByText('หัวข้องานที่ได้รับมอบหมาย')).toHaveCount(0);

    // ปุ่มบันทึกเป็นปุ่มบันทึกข้อมูลที่พักเท่านั้น ไม่ใช่ปุ่ม "ถัดไป" หรือ "บันทึกแผน"
    await expect(page.getByTestId('acc-save')).toBeVisible();
    await expect(page.getByRole('button', { name: 'บันทึกแผนการปฏิบัติงาน' })).toHaveCount(0);

    await logout(page);
  });

  test('WP2: หน้าจอพี่เลี้ยง — หน้ารับรองไม่มีแท็บ certify-tab-plan และเปิด ?tab=plan ตกไปแท็บบันทึก', async ({
    page,
  }) => {
    await seedAcceptedIntent();
    await loginAs(page, 'mentor1');

    // เปิดหน้ารับรองการปฏิบัติงาน
    await goToMenu(page, 'certify');
    await expect(page.getByTestId('certify-tab-plan')).toHaveCount(0);
    await expect(page.getByText('แผนปฏิบัติงาน')).toHaveCount(0);

    // ทดสอบเปิด URL ตรงที่มี ?tab=plan (เช่น คนค้าง bookmark เดิม)
    await page.goto(`${APP_URL}/dashboard?role=mentor&menu=certify&tab=plan`);
    // ต้องไม่ crash หรือเป็นหน้าว่าง และต้องแสดงแท็บบันทึกการปฏิบัติงาน (default tab)
    await expect(page.getByTestId('certify-tab-plan')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /รับรองงานของ/ })).toBeVisible();
    await expect(page.getByTestId('certify-tab-logs')).toBeVisible();

    await logout(page);
  });

  test('WP3: หน้าจออาจารย์ — แผงข้อมูลนักศึกษาไม่มีส่วนตรวจแผนปฏิบัติงาน สหกิจ 07 หน้า 3', async ({
    page,
  }) => {
    const studentId = await seedAcceptedIntent();
    await loginAs(page, 'advisor1');

    await goToMenu(page, 'students');
    await expect(page.getByRole('heading', { name: 'นักศึกษาในสาขา', level: 1 })).toBeVisible();

    const studentRow = page.getByTestId(`advisor-student-row-${studentId}`);
    if ((await studentRow.count()) > 0) {
      await studentRow.click();
      const panel = page.getByTestId('advisor-student-panel');
      await expect(panel).toBeVisible();

      // ต้องไม่มีหัวข้อหรือแท็บแผนปฏิบัติงาน สหกิจ 07 หน้า 3
      await expect(panel.getByText('แผนปฏิบัติงานสหกิจศึกษา (สหกิจ 07 หน้า 3)')).toHaveCount(0);
      await expect(panel.getByTestId('advisor-student-tab-workplan')).toHaveCount(0);
    }

    await logout(page);
  });

  test('WP4: หน้าจอเจ้าหน้าที่ — หน้าติดตามพี่เลี้ยงไม่มีประเภทงานแผนปฏิบัติงาน', async ({
    page,
  }) => {
    await seedAcceptedIntent();
    await loginAs(page, 'staff1');

    await goToMenu(page, 'mentor_followup');
    await expect(page.getByRole('heading', { name: /ติดตาม.*พี่เลี้ยง/ })).toBeVisible();

    // ไม่มีชิปหรือป้ายกำกับสำหรับ work_plan
    await expect(page.getByText('แผนปฏิบัติงาน 0')).toHaveCount(0);
    await expect(page.getByText('แผนปฏิบัติงาน 1')).toHaveCount(0);

    await logout(page);
  });

  test('WP5: API Endpoints — /students/:id/work-plan ตอบ 404 ทุกเมธอด', async ({
    request,
  }) => {
    const studentId = await seedAcceptedIntent();
    await apiLoginAs(request, 'staff1');

    // GET /students/:id/work-plan ต้องตอบ 404
    const getRes = await request.get(`${API_URL}/students/${studentId}/work-plan`);
    expect(getRes.status(), 'GET /students/:id/work-plan ต้องคืน 404').toBe(404);

    // PATCH /students/:id/work-plan/approve ต้องตอบ 404
    const approveRes = await request.patch(`${API_URL}/students/${studentId}/work-plan/approve`, {
      data: { approver_role: 'advisor' },
    });
    expect(approveRes.status(), 'PATCH /students/:id/work-plan/approve ต้องคืน 404').toBe(404);

    // PATCH /students/:id/work-plan/reject ต้องตอบ 404
    const rejectRes = await request.patch(`${API_URL}/students/${studentId}/work-plan/reject`, {
      data: { comment: 'ทดสอบ' },
    });
    expect(rejectRes.status(), 'PATCH /students/:id/work-plan/reject ต้องคืน 404').toBe(404);
  });
});
