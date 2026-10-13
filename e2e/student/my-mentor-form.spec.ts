import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { seedTestData } from '../helpers/test-seeder';
import { withDb } from '../helpers/db';

/**
 * หน้า "พี่เลี้ยงของฉัน" โหลดข้อมูลซ้ำเองทุก 10 วินาที (และทุกครั้งที่มี `intent-updated`)
 * การโหลดซ้ำเบื้องหลังต้องไม่โยนหน้ากลับเป็น skeleton และไม่เขียนทับช่องที่กำลังพิมพ์
 * — เคยเป็น: พิมพ์ข้อมูลพี่เลี้ยง 5 ช่องไม่ทันใน 10 วินาที ค่าที่พิมพ์หายเอง
 */

/** ใบ accepted ที่ถึงวันเริ่มฝึกแล้วและยังไม่มีพี่เลี้ยง = สภาพที่หน้าจอเปิดฟอร์มให้กรอก */
async function acceptedIntentWithoutMentor(studentEmail: string): Promise<void> {
  await withDb(async (db) => {
    const student = await db.query('SELECT user_id FROM users WHERE email = $1', [studentEmail]);
    const company = await db.query('SELECT company_id FROM companies LIMIT 1');
    const semester = await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1');
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, start_date, end_date)
       VALUES ($1, $2, $3, 'accepted', CURRENT_DATE - 3, CURRENT_DATE + 100)`,
      [student.rows[0].user_id, company.rows[0].company_id, semester.rows[0].semester_id]
    );
  });
}

/** สั่งให้หน้าจอโหลดซ้ำแบบเบื้องหลังทันที แทนการรอ 10 วินาที แล้วรอจนคำตอบกลับมา */
async function backgroundReload(page: Page): Promise<void> {
  const reloaded = page.waitForResponse(
    (res) => res.url().includes('/api/students/dashboard') && res.ok()
  );
  await page.evaluate(() => window.dispatchEvent(new Event('intent-updated')));
  await reloaded;
}

test.describe('พี่เลี้ยงของฉัน — ฟอร์มต้องรอดจากการโหลดซ้ำเบื้องหลัง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('กำลังพิมพ์อยู่แล้วหน้าจอโหลดซ้ำ — ค่าที่พิมพ์และ focus ต้องอยู่ที่เดิม ทั้งตอนระบุครั้งแรกและตอนแก้', async ({
    page,
  }) => {
    await acceptedIntentWithoutMentor('student2@test.com');

    await loginAs(page, 'student2');
    await goToMenu(page, 'my_mentor');

    // ── ยังไม่เคยระบุพี่เลี้ยง: ฟอร์มเปิดอยู่แล้ว ──
    await expect(page.getByTestId('mentor-form')).toBeVisible();
    await page.getByTestId('mentor-name').fill('วิชัย กำลังพิมพ์');
    await backgroundReload(page);
    // ⛔ หน้ากลับเป็น skeleton = ช่องถูกสร้างใหม่ focus หลุด
    await expect(page.getByTestId('mentor-name')).toBeFocused();
    await expect(page.getByTestId('mentor-name')).toHaveValue('วิชัย กำลังพิมพ์');

    // ── บันทึกจริง แล้วกลับมาแก้: ค่าจากเซิร์ฟเวอร์ต้องไม่ทับสิ่งที่กำลังพิมพ์ ──
    await page.getByTestId('mentor-email').fill('mentor-typing@example.com');
    await page.getByTestId('mentor-phone').fill('0812345678');
    await page.getByTestId('mentor-submit').click();
    await expect(page.getByTestId('mentor-edit')).toBeVisible();

    await page.getByTestId('mentor-edit').click();
    await expect(page.getByTestId('mentor-name')).toHaveValue('วิชัย กำลังพิมพ์');
    await page.getByTestId('mentor-name').fill('วิชัย แก้ชื่อใหม่');
    await backgroundReload(page);
    await expect(page.getByTestId('mentor-name')).toBeFocused();
    await expect(page.getByTestId('mentor-name')).toHaveValue('วิชัย แก้ชื่อใหม่');
  });
});
