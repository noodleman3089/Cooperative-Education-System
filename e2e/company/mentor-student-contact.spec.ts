import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * พี่เลี้ยงเห็นข้อมูลติดต่อของนักศึกษาที่ตัวเองดูแล (เจ้าของสั่ง 2026-10-18)
 * แทนการให้เปิดเรซูเม่ — ชื่อ ชื่อเล่น เบอร์ อีเมล และผู้ปกครอง
 *
 * สิ่งที่ชุดนี้คุม (ใครเห็นอะไรก่อนหน้าตา):
 *   C1 ได้ครบชุดข้อมูลติดต่อ และ **ไม่มีฟิลด์อื่นหลุดไป** (เกรด เลขบัตร ที่อยู่ เรซูเม่) — SEC-10
 *   C2 ใบที่ยังไม่ `accepted` ไม่นับว่าดูแล → ไม่เห็นข้อมูลของนักศึกษาคนนั้น (SEC-06)
 *   C3 หน้าจอรับรองงานของพี่เลี้ยงแสดงการ์ดข้อมูลติดต่อ
 */

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";

const placeStudentWithMentor1 = (status: string) =>
  dbExec(
    `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
     VALUES (${STUDENT2}, (SELECT company_id FROM companies LIMIT 1),
             (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1), $1,
             (SELECT user_id FROM users WHERE email = 'mentor1@test.com'), CURRENT_DATE)`,
    [status]
  );

test.describe('ข้อมูลติดต่อนักศึกษาสำหรับพี่เลี้ยง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec(`DELETE FROM intent_forms WHERE student_id = ${STUDENT2}`);
    await dbExec(
      `UPDATE students
          SET name_prefix = 'นาย', nickname = 'ชายน้อย', mobile_phone = '0811112222', alt_email = 'somchai.contact@example.com',
              parent_name = 'นางสมพร สายดี', parent_phone = '0899998888', cumulative_gpa = 3.75,
              current_address = '123/45 ที่อยู่ลับ ไม่ควรให้พี่เลี้ยงเห็น'
        WHERE student_id = ${STUDENT2}`
    );
  });

  test('C1: พี่เลี้ยงได้ชุดข้อมูลติดต่อครบ และไม่มีเกรด/เลขบัตร/ที่อยู่/เรซูเม่หลุดไป', async ({ request }) => {
    await placeStudentWithMentor1('accepted');
    await apiLoginAs(request, 'mentor1');
    const res = await request.get(`${API_URL}/mentor/pending`);
    expect(res.status(), await res.text()).toBe(200);
    const [student] = (await res.json()).students as Array<Record<string, unknown>>;

    expect(student).toMatchObject({
      name_prefix: 'นาย',
      full_name: 'สมชาย สายดี',
      nickname: 'ชายน้อย',
      phone: '0811112222',
      email: 'somchai.contact@example.com',
      parent_name: 'นางสมพร สายดี',
      parent_phone: '0899998888',
    });

    // ⛔ ฟิลด์อ่อนไหวต้องไม่ถูกส่งให้พี่เลี้ยง — ตรวจทั้งชื่อคีย์และค่า
    const raw = JSON.stringify(student);
    for (const key of ['cumulative_gpa', 'national_id', 'current_address', 'resume_file', 'ethnicity', 'religion', 'birth_date']) {
      expect(Object.keys(student), key).not.toContain(key);
    }
    expect(raw).not.toContain('ที่อยู่ลับ');
    expect(raw).not.toContain('3.75');
  });

  test('C2: ใบที่ยังไม่ accepted ไม่นับว่าพี่เลี้ยงดูแล → ไม่เห็นข้อมูลนักศึกษา', async ({ request }) => {
    await placeStudentWithMentor1('pending_officer_approval');
    await apiLoginAs(request, 'mentor1');
    const res = await request.get(`${API_URL}/mentor/pending`);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).students).toEqual([]);
  });

  test('C3: หน้ารับรองงานของพี่เลี้ยงแสดงการ์ดข้อมูลติดต่อของนักศึกษา', async ({ page }) => {
    await placeStudentWithMentor1('accepted');
    await loginAs(page, 'mentor1');
    await goToMenu(page, 'certify');

    const card = page.getByTestId('mentor-student-contact');
    await expect(card).toBeVisible();
    await expect(card).toContainText('นายสมชาย สายดี');
    await expect(card).toContainText('ชายน้อย');
    await expect(card).toContainText('0811112222');
    await expect(card).toContainText('somchai.contact@example.com');
    await expect(card).toContainText('นางสมพร สายดี');
    await expect(card).toContainText('0899998888');
    // ไม่มีเกรดหรือที่อยู่บนการ์ด
    await expect(card).not.toContainText('3.75');
    await expect(page.getByText('ที่อยู่ลับ')).toHaveCount(0);
  });
});
