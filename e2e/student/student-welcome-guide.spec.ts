import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { loginAs } from '../helpers/auth';
import { dbValue } from '../helpers/db';

/**
 * คำแนะนำขั้นตอนเริ่มต้นของนักศึกษา (StudentWelcomeGuide)
 *
 * สิ่งที่ต้องคุมคือ **ใครเห็น** ไม่ใช่หน้าตา:
 *
 *   1. เห็นเฉพาะ "ผู้ใช้ครั้งแรก" = คนที่ยังไม่มีแถวใน `students` (dashboard ตอบ 404)
 *      ตัวเดิมใช้ `showGuide && !activeIntent` ในหน้าหลักด้วย ทำให้คนที่กรอกประวัติแล้ว
 *      แต่ยังไม่ยื่นใบความจำนงเห็นทุกครั้งที่เข้าระบบ ซึ่งไม่ใช่ผู้ใช้ครั้งแรกแล้ว
 *   2. **ไม่เก็บสถานะไว้ที่ไหนเลย** — เดิมเก็บ `localStorage` ด้วย key ที่ไม่ผูก user
 *      บนเครื่องที่แชร์กัน (ห้องแล็บ) นักศึกษาคนที่สองจึงไม่เห็น guide เลย
 *      เทสต์ W4 จับข้อนี้ด้วยการรีเฟรชแล้วต้องเห็นอีก
 *   3. กดซ่อนแล้วต้องยังเหลือทางไปกรอกประวัติ ไม่ใช่หน้าว่าง
 *
 * ใช้ `student1@test.com` เพราะ `db:setup` จงใจไม่สร้างแถว `students` ให้ (ต่างจาก
 * `student2` ที่มีประวัติครบ) — ถ้าวันหนึ่ง seed เปลี่ยน เทสต์ W0 จะแดงก่อนเพื่อนและ
 * บอกสาเหตุตรงๆ แทนที่จะปล่อยให้ W1-W4 แดงพร้อมกันโดยไม่รู้ว่าทำไม
 */

/** ป้ายที่มีเฉพาะใน guide — การ์ด "ยังไม่มีข้อมูลประวัติ" อันเดิมไม่มีคำนี้ */
const GUIDE_BADGE = 'แนะนำขั้นตอนเริ่มต้น';
/** ข้อความของการ์ดสำรองที่โผล่มาแทนเมื่อกดซ่อน */
const FALLBACK_CARD = 'ยังไม่มีข้อมูลประวัติของคุณในระบบ';

test.describe('คำแนะนำขั้นตอนเริ่มต้นของนักศึกษา', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API loaded successfully.");',
      })
    );
  });

  test('W0: ข้อสมมติของชุดนี้ — student1 ไม่มีประวัติ · student2 มี', async () => {
    await seedTestData();

    const noProfile = await dbValue<string>(
      `SELECT COUNT(*)::text FROM students s
         JOIN users u ON u.user_id = s.student_id
        WHERE u.email = 'student1@test.com'`
    );
    const hasProfile = await dbValue<string>(
      `SELECT COUNT(*)::text FROM students s
         JOIN users u ON u.user_id = s.student_id
        WHERE u.email = 'student2@test.com'`
    );

    expect(noProfile, 'student1 ต้องยังไม่มีแถวใน students — ไม่งั้น W1/W3/W4 หมดความหมาย').toBe('0');
    expect(hasProfile, 'student2 ต้องมีประวัติแล้ว — ไม่งั้น W2 หมดความหมาย').toBe('1');
  });

  /**
   * ⛔ เดิมมี 3 ขั้น — ขั้นกลาง "สมัครเข้าโครงการ (สหกิจ 01)" ถูกตัดทั้งชุด 2026-09-14
   *    (ไม่อยู่ในขอบเขต) · guide เหลือ 2 ขั้น: กรอกประวัติ → เลือกตำแหน่งงานและยื่นความจำนง
   */
  test('W1: นักศึกษาที่ยังไม่กรอกประวัติเห็น guide พร้อมขั้นตอนครบ 2 ขั้น', async ({ page }) => {
    await seedTestData();
    await loginAs(page, 'student1');

    await expect(page.getByText(GUIDE_BADGE)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'กรอกประวัตินักศึกษาให้ครบถ้วน' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'เลือกสถานประกอบการและยื่นแบบแจ้งความจำนง' })
    ).toBeVisible();
    // ขั้น สหกิจ 01 ต้องไม่กลับมา
    await expect(page.getByText('สหกิจ 01')).toHaveCount(0);

    // ปุ่มพาไปหน้าที่ถูกต้องครบทั้งสอง
    await expect(page.getByRole('button', { name: 'ไปหน้าข้อมูลส่วนตัว' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ดูตำแหน่งงานและยื่นคำร้อง' })).toBeVisible();
  });

  test('W2: นักศึกษาที่กรอกประวัติแล้วไม่เห็น guide เลย', async ({ page }) => {
    await seedTestData();
    await loginAs(page, 'student2');

    // รอให้แดชบอร์ดตัวจริงขึ้นก่อน ไม่งั้น "ไม่เห็น guide" อาจแปลว่าหน้ายังโหลดไม่เสร็จ
    // (แบนเนอร์ที่มีเกรดถูกเอาออกจากแดชบอร์ดตอนรีเมค — ใช้การ์ด "ที่ฝึกงานของคุณ" ซึ่งมีเฉพาะแดชบอร์ดตัวจริง)
    await expect(page.getByRole('heading', { name: 'ที่ฝึกงานของคุณ' })).toBeVisible();
    await expect(page.getByText(GUIDE_BADGE)).toHaveCount(0);
  });

  test('W3: กดปุ่มในขั้นตอนแล้วไปหน้านั้นจริง', async ({ page }) => {
    await seedTestData();
    await loginAs(page, 'student1');

    await page.getByRole('button', { name: 'ไปหน้าข้อมูลส่วนตัว' }).click();
    await page
      .getByTestId('screen-loading')
      .waitFor({ state: 'detached', timeout: 10_000 })
      .catch(() => {});

    // ไปถึงหน้าโปรไฟล์จริง — guide เป็นของแดชบอร์ดจึงต้องหายไปด้วย
    // (หน้าโปรไฟล์ไม่มีแท็บแล้วหลังรีเมค — ใช้หัวหน้า h1 ของหน้าแทน)
    await expect(page.getByRole('heading', { name: 'ข้อมูลส่วนตัวและเรซูเม่', level: 1 })).toBeVisible();
    await expect(page.getByText(GUIDE_BADGE)).toHaveCount(0);
  });

  test('W4: กดซ่อนแล้วเหลือทางไปกรอกประวัติ · รีเฟรชแล้วกลับมาเพราะไม่ได้จำสถานะ', async ({
    page,
  }) => {
    await seedTestData();
    await loginAs(page, 'student1');

    await expect(page.getByText(GUIDE_BADGE)).toBeVisible();
    await page.getByRole('button', { name: 'ซ่อนคำแนะนำนี้' }).click();

    // ซ่อนแล้วต้องไม่ใช่หน้าว่าง — การ์ดเดิมพร้อมปุ่มไปกรอกประวัติต้องมาแทน
    await expect(page.getByText(GUIDE_BADGE)).toHaveCount(0);
    await expect(page.getByText(FALLBACK_CARD)).toBeVisible();
    await expect(page.getByRole('button', { name: 'กรอกประวัตินักศึกษา' })).toBeVisible();

    // ปุ่มบอกว่า "ซ่อน" ไม่ใช่ "ไม่ต้องแสดงอีก" — รีเฟรชแล้วจึงต้องเห็นอีกครั้ง
    // (ถ้าวันหนึ่งมีคนเอา localStorage กลับมา เทสต์บรรทัดนี้จะแดง)
    await page.reload();
    await expect(page.getByText(GUIDE_BADGE)).toBeVisible();
  });
});
