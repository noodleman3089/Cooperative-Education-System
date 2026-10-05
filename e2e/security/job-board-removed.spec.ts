import { test, expect, request as playwrightRequest } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';
import { dbValue } from '../helpers/db';

/**
 * สายแบบเสนองาน/ประกาศงาน (สหกิจ 02) ถูกตัดทั้งสาย (2026-10-05 · migration 044)
 *
 * อาจารย์ที่ปรึกษาโปรเจคให้ตัด: คู่มือสหกิจของคณะไม่มีสหกิจ 02 — กระบวนการเริ่มที่
 * เอกสารหมายเลข 1 นักศึกษากรอกสถานประกอบการเองในหน้า "ยื่นคำร้องขอหนังสือ"
 *
 * ไฟล์นี้คุมว่า "ของที่ตัดไปแล้วต้องไม่กลับมาเงียบๆ":
 *   J1 เส้นทาง API เดิมตอบ 404 กับทุกบทบาท (ไม่ใช่ 403 ที่แปลว่ายังมีอยู่แต่ห้ามเข้า)
 *   J2 ฐานไม่มีตารางและคอลัมน์ของสายนี้
 *   J3 เส้นสาธารณะ (`/api/public/*`) ไม่ได้กลายเป็นประตูเข้าข้อมูลอื่น
 *   J4 หน้าจอ: นักศึกษาไม่เห็นบอร์ดงาน · เจ้าหน้าที่ไม่มีเมนูแบบเสนองาน · `/offer` ไม่มีหน้า
 *
 * ข้อมูลทั้งหมดเป็นของปลอม · ไม่มีการส่งเมลจริง (`MAIL_DRY_RUN=true`)
 */

test.describe('สายแบบเสนองาน/ประกาศงาน (สหกิจ 02) ถูกตัดแล้ว', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('J1: เส้นทาง API ของประกาศงานและแบบเสนองานตอบ 404 กับทุกบทบาท', async ({ request }) => {
    const gone: Array<[string, string]> = [
      ['GET', `${API_URL}/jobs`],
      ['POST', `${API_URL}/jobs`],
      ['PUT', `${API_URL}/jobs/1/publish`],
      ['PUT', `${API_URL}/jobs/1/reject`],
      ['POST', `${API_URL}/job-offers/send`],
      ['GET', `${API_URL}/job-offers`],
      ['GET', `${API_URL}/job-offers/1`],
    ];
    for (const account of ['staff1', 'student2', 'advisor1'] as const) {
      await apiLoginAs(request, account);
      for (const [method, url] of gone) {
        const res = await request.fetch(url, { method, data: method === 'GET' ? undefined : {} });
        expect(res.status(), `${account}: ${method} ${url} → ${await res.text()}`).toBe(404);
      }
    }
  });

  test('J2: ฐานข้อมูลไม่มีตารางและคอลัมน์ของสายนี้', async () => {
    for (const table of ['job_posts', 'coop_job_offers', 'job_offer_tokens', 'job_post_majors']) {
      expect(await dbValue<string | null>('SELECT to_regclass($1)::text', [table]), `ตาราง ${table} ต้องไม่มี`).toBeNull();
    }
    expect(
      await dbValue<number>(
        `SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_name = 'intent_forms' AND column_name = 'job_id'`
      )
    ).toBe(0);
  });

  test('J3: เส้นสาธารณะเปิดได้เฉพาะลิงก์ตอบรับ — ไม่มีลิงก์แบบเสนองาน และไม่ใช่ประตูเข้าข้อมูลนักศึกษา', async () => {
    const anon = await playwrightRequest.newContext();
    try {
      const token = '00000000-0000-4000-8000-000000000000';
      // ลิงก์ /offer เดิม: route หายทั้งเส้น
      expect((await anon.get(`${API_URL}/public/job-offer?token=${token}`)).status()).toBe(404);
      expect((await anon.post(`${API_URL}/public/job-offer/submit?token=${token}`, { data: {} })).status()).toBe(404);

      // ⛔ `/api/public/*` ไม่ต้องล็อกอิน — ถ้าวันหนึ่งมีคนเพิ่มเส้นใต้มันที่คืนข้อมูลนักศึกษา เคสนี้ต้องแดงก่อน
      for (const path of ['/public/students', '/public/daily-logs', '/public/evaluations', '/public/intents']) {
        const res = await anon.get(`${API_URL}${path}`);
        expect(res.status(), `${path} ต้องไม่มีอยู่จริง`).toBe(404);
      }
    } finally {
      await anon.dispose();
    }
  });

  test('J4: หน้าจอ — นักศึกษาเห็นฟอร์มยื่นคำร้องแทนบอร์ดงาน · เจ้าหน้าที่ไม่มีเมนูแบบเสนองาน · /offer ไม่มีหน้า', async ({
    page,
  }) => {
    // /offer ไม่มี route แล้ว — ต้องไม่ขึ้นฟอร์มแบบเสนองานให้ใครกรอก
    await page.goto('/offer?token=00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('แบบเสนองานสหกิจศึกษา')).toHaveCount(0);

    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');
    await expect(page.getByRole('heading', { name: 'ยื่นคำร้องขอหนังสือขอความอนุเคราะห์' })).toBeVisible();
    await expect(page.getByTestId('request-submit')).toBeVisible();
    await expect(page.getByTestId('apply-job')).toHaveCount(0);
    await expect(page.getByText('แผนที่สถานประกอบการ')).toHaveCount(0);

    await loginAs(page, 'staff1');
    await expect(page.getByTestId('nav-companies')).toBeVisible(); // ทำเนียบยังอยู่
    await expect(page.getByTestId('nav-jobs')).toHaveCount(0);
    await expect(page.getByTestId('staff-home-tile-offer')).toHaveCount(0);
    await expect(page.getByTestId('staff-home-timeline-survey')).toHaveCount(0);
  });
});
