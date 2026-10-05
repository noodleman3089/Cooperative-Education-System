import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { apiLoginAs, loginAs } from '../helpers/auth';
import pool from '../../backend/src/config/database';
import { goToMenu } from '../helpers/nav';
import { API_URL } from '../helpers/env';
import { dbValue } from '../helpers/db';

test.describe('ข่าวประชาสัมพันธ์ (PR Announcement)', () => {

  test.beforeEach(async ({ page }) => {
    // Intercept Google Maps API calls
    await page.route('**/maps.googleapis.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'console.log("Mocked Google Maps API.");'
      });
    });
  });

  test('Staff creates pinned PR announcement and Student views announcement banner & modal', async ({ page }) => {
    // 1. Seed fresh test data
    await seedTestData();

    // 2. Staff logs in
    await loginAs(page, 'staff1');

    // 3. Navigate to PR Announcements manager
    // หน้าจอรีเมค (E10) เปลี่ยนหัวข้อเป็นไทย และสวิตช์ปักหมุดเป็น role="switch" แทน checkbox
    await goToMenu(page, 'announcements');
    await expect(page.getByRole('heading', { level: 1, name: 'ข่าวประชาสัมพันธ์' })).toBeVisible();

    // 4. Create a new pinned announcement
    const testTitle = `📢 ประกาศเปิดรับสมัครทุนสหกิจศึกษาประจำปี ${Date.now()}`;
    const testContent = 'ขอให้นักศึกษาทุกคนตรวจสอบคุณสมบัติและส่งเอกสารผ่านระบบออนไลน์ภายในกำหนดเวลา';

    await page.fill('#ann-title', testTitle);
    await page.fill('#ann-content', testContent);
    const pin = page.getByTestId('ann-pin-toggle');
    await pin.click();
    await expect(pin).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'เผยแพร่', exact: true }).click();

    // Verify success banner and announcement item listed
    await expect(page.getByText('เผยแพร่ข่าวประชาสัมพันธ์เรียบร้อยแล้ว')).toBeVisible();
    await expect(page.getByText(testTitle)).toBeVisible();
    // ปักหมุดต้องเข้าฐานจริง ไม่ใช่แค่สวิตช์บนจอเปลี่ยนสี
    await expect
      .poll(async () =>
        (await pool.query('SELECT is_pinned FROM announcements WHERE title = $1', [testTitle]))
          .rows[0]?.is_pinned
      )
      .toBe(true);

    // 5. Student logs in to check pinned announcement banner
    await loginAs(page, 'student1');

    // Verify pinned PR banner is visible on student dashboard
    const bannerTitleLocator = page.locator(`h3:has-text("${testTitle}")`);
    await expect(bannerTitleLocator).toBeVisible();

    // Click read details modal. The title now appears twice — once in the banner
    // behind and once in the modal — so scope the assertion to the dialog.
    await page.click('button:has-text("อ่านรายละเอียด")');
    const modal = page.locator('div.fixed.inset-0').filter({ hasText: testTitle });
    await expect(modal.locator('h3').filter({ hasText: testTitle })).toBeVisible();
    await expect(modal.locator(`text=${testContent}`).first()).toBeVisible();

    // Close modal
    await page.click('button:has-text("ปิดหน้าต่าง")');
  });
});

/**
 * สิทธิ์ของข่าวประชาสัมพันธ์ — **เพิ่มเมื่อ 2026-09-04**
 *
 * ⚠️ **สองเทสต์ด้านบนเป็น happy path ล้วน** ก่อนหน้านี้ทั้งระบบประกาศไม่มีเทสต์
 * เชิงลบเลยสักตัว ทั้งที่ route เปิด `POST` / `DELETE` / `PATCH` ให้บุคลากร 4 บทบาท
 * — ไม่มีอะไรกันไม่ให้ใครเผลอถอด `authorizeRoles` ออกแล้วนักศึกษาสร้างประกาศได้
 *
 * ชุดนี้คุมสองชั้นที่ต่างกัน **อย่ายุบรวม**:
 *   1. **ชั้นบทบาท** (`authorizeRoles` ที่ router) — นักศึกษา/บริษัทเข้าไม่ถึงเลย
 *   2. **ชั้นความเป็นเจ้าของ** (`canManageAnnouncement` ใน controller) — บุคลากร
 *      ที่ผ่านชั้นแรกแล้ว ยังลบ/ปักหมุดของคนอื่นไม่ได้ ยกเว้นงานสหกิจ (staff/dean)
 *      ซึ่งเป็นผู้ดูแลประกาศทั้งหมดตามที่ comment ใน controller ระบุไว้
 */

/**
 * จำนวนประกาศในฐาน ณ ขณะนั้น
 *
 * ⛔ **ห้ามเทียบกับเลขคงที่** — ตัวซีดสร้างประกาศติดมาให้เองอยู่แล้ว การเขียนว่า
 * "ต้องเหลือ 1 ใบ" จึงตกทันทีโดยไม่เกี่ยวกับสิ่งที่เทสต์ตั้งใจตรวจ · วัดฐานก่อน
 * แล้วเทียบส่วนต่าง เป็นวิธีเดียวกับที่ `dispatch-letter` D6 ใช้
 */
const countAnnouncements = async (): Promise<number> =>
  Number(await dbValue<string>('SELECT COUNT(*) FROM announcements'));

/** สร้างประกาศด้วยบัญชีที่ระบุ แล้วคืน id — ใช้ตั้งฉากว่า "ประกาศของใคร" */
async function createAs(
  request: APIRequestContext,
  who: 'staff1' | 'advisor1',
  title: string
): Promise<number> {
  await apiLoginAs(request, who);
  const res = await request.post(`${API_URL}/announcements`, {
    data: { title, content: 'เนื้อหาทดสอบสิทธิ์ข่าวประชาสัมพันธ์' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).announcement.announcement_id as number;
}

test.describe('สิทธิ์ข่าวประชาสัมพันธ์', () => {
  test.beforeEach(async () => {
    await seedTestData();
  });

  test('PR1: นักศึกษาและพี่เลี้ยง สร้าง/ลบ/ปักหมุดประกาศไม่ได้เลย', async ({ request }) => {
    const id = await createAs(request, 'staff1', 'ประกาศของงานสหกิจ');
    const before = await countAnnouncements();

    // ⛔ อ่านได้ (ประกาศมีไว้ให้ทุกคนเห็น) แต่ **เขียนไม่ได้ทั้งสามทาง**
    for (const who of ['student2', 'mentor1'] as const) {
      await apiLoginAs(request, who);

      const read = await request.get(`${API_URL}/announcements`);
      expect(read.status(), `${who} ต้องอ่านประกาศได้`).toBe(200);

      const create = await request.post(`${API_URL}/announcements`, {
        data: { title: 'ประกาศปลอม', content: 'ไม่ควรถูกสร้าง' },
      });
      expect(create.status(), `${who} ต้องสร้างประกาศไม่ได้`).toBe(403);

      expect(
        (await request.delete(`${API_URL}/announcements/${id}`)).status(),
        `${who} ต้องลบประกาศไม่ได้`
      ).toBe(403);

      expect(
        (await request.patch(`${API_URL}/announcements/${id}/pin`)).status(),
        `${who} ต้องปักหมุดประกาศไม่ได้`
      ).toBe(403);
    }

    // ประกาศที่ถูกยิงใส่ต้องยังอยู่ครบ และไม่มีของปลอมเกิดขึ้น
    expect(await countAnnouncements()).toBe(before);
  });

  test('PR2: ไม่ได้ล็อกอิน → 401 ทุกเส้นทาง ไม่ใช่ 403', async ({ request }) => {
    // ⛔ 401 กับ 403 คนละความหมาย — 401 คือ "ยังไม่รู้ว่าเป็นใคร" ส่วน 403 คือ
    //    "รู้แล้วว่าเป็นใคร แต่ไม่มีสิทธิ์" · การตอบ 403 ให้คนที่ยังไม่ล็อกอิน
    //    แปลว่ามีเส้นทางที่ข้าม `authenticateToken` ไปได้
    for (const call of [
      request.get(`${API_URL}/announcements`),
      request.post(`${API_URL}/announcements`, { data: { title: 'x', content: 'y' } }),
      request.delete(`${API_URL}/announcements/1`),
      request.patch(`${API_URL}/announcements/1/pin`),
    ]) {
      expect((await call).status()).toBe(401);
    }
  });

  test('PR3: หัวข้อหรือเนื้อหาว่าง → 400 และไม่มีแถวเกิดในฐาน', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const before = await countAnnouncements();

    for (const body of [
      { content: 'มีแต่เนื้อหา' },
      { title: 'มีแต่หัวข้อ' },
      { title: '   ', content: '   ' },
      {},
    ]) {
      const res = await request.post(`${API_URL}/announcements`, { data: body });
      expect(res.status(), JSON.stringify(body)).toBe(400);
    }

    expect(await countAnnouncements()).toBe(before);
  });

  test('PR4: อาจารย์ลบประกาศของงานสหกิจไม่ได้ แต่ลบของตัวเองได้ · งานสหกิจลบได้ทุกใบ', async ({
    request,
  }) => {
    const staffPost = await createAs(request, 'staff1', 'ประกาศของงานสหกิจ');
    const advisorPost = await createAs(request, 'advisor1', 'ประกาศของอาจารย์');
    const before = await countAnnouncements();

    // ⛔ ชั้นที่สอง: ผ่าน `authorizeRoles` มาแล้วก็ยังลบของคนอื่นไม่ได้
    await apiLoginAs(request, 'advisor1');
    const denied = await request.delete(`${API_URL}/announcements/${staffPost}`);
    expect(denied.status(), await denied.text()).toBe(403);

    // ของตัวเองลบได้
    expect((await request.delete(`${API_URL}/announcements/${advisorPost}`)).status()).toBe(200);

    // งานสหกิจเป็นผู้ดูแลประกาศทั้งหมด — ลบของใครก็ได้
    const another = await createAs(request, 'advisor1', 'ประกาศของอาจารย์ใบที่สอง');
    await apiLoginAs(request, 'staff1');
    expect((await request.delete(`${API_URL}/announcements/${another}`)).status()).toBe(200);

    // ลบไป 2 ใบจากที่นับไว้ (ของอาจารย์ทั้งสองใบ) — ของงานสหกิจต้องยังอยู่
    expect(await countAnnouncements()).toBe(before - 1);
    expect(
      await dbValue<string>('SELECT COUNT(*) FROM announcements WHERE announcement_id = $1', [
        staffPost,
      ])
    ).toBe('1');
  });

  test('PR5: ปักหมุดใช้ด่านเดียวกับการลบ · ใบที่ไม่มีอยู่ → 404 ไม่ใช่ 500', async ({ request }) => {
    const staffPost = await createAs(request, 'staff1', 'ประกาศของงานสหกิจ');

    await apiLoginAs(request, 'advisor1');
    expect((await request.patch(`${API_URL}/announcements/${staffPost}/pin`)).status()).toBe(403);
    // ปักไม่สำเร็จต้องไม่เปลี่ยนสถานะจริงในฐาน
    expect(
      await dbValue<boolean>('SELECT is_pinned FROM announcements WHERE announcement_id = $1', [
        staffPost,
      ])
    ).toBe(false);

    await apiLoginAs(request, 'staff1');
    expect((await request.patch(`${API_URL}/announcements/${staffPost}/pin`)).status()).toBe(200);
    expect(
      await dbValue<boolean>('SELECT is_pinned FROM announcements WHERE announcement_id = $1', [
        staffPost,
      ])
    ).toBe(true);

    // id ที่ไม่มีอยู่ และ id ที่ไม่ใช่ตัวเลข ต้องได้ 404/400 ไม่ใช่ 500
    expect((await request.patch(`${API_URL}/announcements/999999/pin`)).status()).toBe(404);
    expect((await request.delete(`${API_URL}/announcements/999999`)).status()).toBe(404);
    expect((await request.patch(`${API_URL}/announcements/abc/pin`)).status()).toBe(400);
  });

  test('PR6: ประกาศที่ปักหมุดขึ้นก่อนเสมอ ไม่ว่าใครสร้างทีหลัง', async ({ request }) => {
    // ลำดับบนแบนเนอร์นักศึกษาเกิดจากการเรียงฝั่งเซิร์ฟเวอร์ ไม่ใช่ลำดับที่สร้าง
    await createAs(request, 'staff1', 'ประกาศธรรมดาใบแรก');
    const pinned = await createAs(request, 'staff1', 'ประกาศที่ต้องขึ้นก่อน');
    await createAs(request, 'staff1', 'ประกาศธรรมดาใบสุดท้าย');

    await apiLoginAs(request, 'staff1');
    expect((await request.patch(`${API_URL}/announcements/${pinned}/pin`)).status()).toBe(200);

    await apiLoginAs(request, 'student2');
    const list = (await (await request.get(`${API_URL}/announcements`)).json()).data as {
      announcement_id: number;
    }[];
    expect(list[0].announcement_id).toBe(pinned);
  });

});
