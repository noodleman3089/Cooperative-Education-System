import { test, expect } from '@playwright/test';
import { loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/*
 * ⛔ ไฟล์นี้สลับบัญชีด้วย `loginAs` อย่างเดียว ไม่เรียก `logout(page)` ผ่านหน้าจอ
 *    `loginAs` ปิด session ทาง API ให้เองอยู่แล้ว · การกดออกจากระบบบนจอก่อนมันทำให้
 *    เกิดการเด้งไป /login ซ้อนสองรอบ แล้ว `page.goto` ของ `loginAs` ถูกขัดกลางทาง
 *    (เจอ 2026-09-14 — ผ่านเมื่อรันเดี่ยว ตกเมื่อรันต่อกับไฟล์อื่น)
 */
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbValue, withDb } from '../helpers/db';

/**
 * G4 + G5 บนหน้าจอ — ส่งแบบสำรวจ สหกิจ 02 และตรวจใบที่ตอบกลับ จนตำแหน่งขึ้นกระดานนักศึกษา
 *
 * `staff-job-offer-review.spec.ts` พิสูจน์วงนี้ที่ระดับ API ไว้แล้ว ไฟล์นี้พิสูจน์ว่า
 * **คนที่กดบนหน้าจอจริง ๆ ปิดวงได้** — สเปกเขียนไว้ตรง ๆ ว่า G5 “ไม่เดินให้เห็น ห้ามบอกว่าเสร็จ”
 *
 * ⛔ ขั้นบริษัทกรอกแบบเสนองานผ่านลิงก์ไม่ได้เดินในไฟล์นี้ (สร้างใบ `submitted` ตรงในฐาน)
 *    — หน้านั้นเป็นของฝ่ายสถานประกอบการ และถูกคุมอยู่ในไฟล์ของฝ่ายนั้นแล้ว
 */

test.beforeEach(async ({ page }) => {
  await page.route('**/maps.googleapis.com/**', (route) => route.abort());
  await seedTestData();
});

async function activeSemesterId(): Promise<number> {
  return (await dbValue<number>(
    'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1'
  ))!;
}

/** ใบที่บริษัทตอบกลับมาแล้ว — รูปเดียวกับ fixture ใน `staff-job-offer-review.spec.ts` */
async function makeSubmittedOffer(title: string): Promise<{ offerId: number; jobId: number }> {
  const companyId = (await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1'))!;
  const semesterId = await activeSemesterId();

  return withDb(async (db) => {
    const staffId = (
      await db.query("SELECT user_id FROM users WHERE email = 'staff1@test.com'")
    ).rows[0].user_id as number;

    const offerId = (
      await db.query(
        `INSERT INTO coop_job_offers (company_id, semester_id, status, due_date, submitted_at,
                                      informant_name, informant_position, company_snapshot)
         SELECT $1, $2, 'submitted', (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 5, NOW(),
                'วิภาดา เจริญพงศ์', 'เจ้าหน้าที่ฝ่ายบุคคล', to_jsonb(c)
           FROM companies c WHERE c.company_id = $1
         ON CONFLICT ON CONSTRAINT coop_job_offers_company_semester_key DO NOTHING
         RETURNING offer_id`,
        [companyId, semesterId]
      )
    ).rows[0].offer_id as number;

    // ⛔ expire_date อยู่ในอดีตโดยตั้งใจ — ความหมายของคอลัมน์นี้คือ “กำหนดส่งแบบสำรวจกลับ”
    //    ซึ่งเจ้าหน้าที่มักตรวจหลังวันนั้น ถ้ากระดานนักศึกษายังกรองด้วยมัน ตำแหน่งจะไม่ขึ้น
    const jobId = (
      await db.query(
        `INSERT INTO job_posts (company_id, offer_id, semester_id, created_by, applied_count,
                                expire_date, status, title, description, quota)
         VALUES ($1, $2, $3, $4, 0, (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 5,
                 'pending_approval', $5, 'ลักษณะงานตามที่สถานประกอบการกรอกกลับมา', 2)
         RETURNING job_id`,
        [companyId, offerId, semesterId, staffId, title]
      )
    ).rows[0].job_id as number;

    await db.query(
      `INSERT INTO job_offer_tokens (token, offer_id, expires_at, created_by)
       VALUES ($1, $2, NOW() + INTERVAL '1 day', $3)`,
      [`loop-ui-token-${offerId}`, offerId, staffId]
    );

    return { offerId, jobId };
  });
}

test('G5: เจ้าหน้าที่กดผ่านทั้งใบบนหน้าจอ แล้วนักศึกษาเห็นตำแหน่งนั้นบนกระดานหางานจริง', async ({ page }) => {
  // ล้างใบของภาคนี้ก่อน — UNIQUE (company, semester) ทำให้ fixture ชนใบจาก seed ได้
  await dbExec('DELETE FROM coop_job_offers WHERE semester_id = $1', [await activeSemesterId()]);

  const title = `ตำแหน่งปิดวง G5 ${Date.now()}`;
  const { offerId, jobId } = await makeSubmittedOffer(title);

  // ── ก่อนตรวจ: นักศึกษาต้องยังไม่เห็น ─────────────────────────────
  await loginAs(page, 'student1');
  await goToMenu(page, 'jobs');
  await expect(page.getByText(title)).toHaveCount(0);

  // ── เจ้าหน้าที่ตรวจทั้งใบ ────────────────────────────────────────
  await loginAs(page, 'staff1');
  await goToMenu(page, 'jobs');
  await page.getByTestId('jobs-tab-review').click();

  await page.getByTestId(`offer-review-row-${offerId}`).click();
  await expect(page.getByTestId(`offer-item-${jobId}`)).toContainText(title);

  await page.getByTestId('offer-approve-all').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toContainText('ให้นักศึกษาเห็นบนกระดานหางาน');
  await dialog.getByRole('button', { name: /ยืนยันผ่านทั้งใบ/ }).click();

  await expect
    .poll(() => dbValue<string>('SELECT status FROM job_posts WHERE job_id = $1', [jobId]))
    .toBe('published');
  expect(await dbValue<string>('SELECT status FROM coop_job_offers WHERE offer_id = $1', [offerId])).toBe(
    'reviewed'
  );

  // ── หลักฐานว่าวงปิด: นักศึกษาเห็นตำแหน่งนั้นจริง ────────────────────
  await loginAs(page, 'student1');
  await goToMenu(page, 'jobs');
  await expect(page.getByText(title).first()).toBeVisible();
});

test('G4: ส่งแบบสำรวจจากหน้าจอ — บริษัทไม่มีอีเมลติ๊กไม่ได้ และผลการส่งนับครบทุกรายที่เลือก', async ({ page }) => {
  const semesterId = await activeSemesterId();
  await dbExec('DELETE FROM coop_job_offers WHERE semester_id = $1', [semesterId]);

  // บริษัทหนึ่งรายไม่มีอีเมล — ต้องติ๊กไม่ได้ตั้งแต่บนจอ (ห้ามให้กดแล้วค่อยไปตกใน skipped)
  // seed มีบริษัทรายเดียว — สร้างรายที่สองขึ้นมาเป็นแถว “ไม่มีอีเมล” ของเทสต์เอง
  const [readyId, noEmailId] = await withDb(async (db) => {
    const readyId = (
      await db.query('SELECT company_id FROM companies ORDER BY company_id LIMIT 1')
    ).rows[0].company_id as number;
    await db.query(`UPDATE companies SET email = 'loop-ui@test.com' WHERE company_id = $1`, [readyId]);
    const staffId = (
      await db.query("SELECT user_id FROM users WHERE email = 'staff1@test.com'")
    ).rows[0].user_id as number;
    const noEmailId = (
      await db.query(
        `INSERT INTO companies (name_th, address, province, district, postal_code, phone, created_by, email)
         VALUES ('บริษัทไม่มีอีเมล ทดสอบ G4', '1 ถนนทดสอบ', 'ชลบุรี', 'เมืองชลบุรี', '20000', '038000000', $1, NULL)
         RETURNING company_id`,
        [staffId]
      )
    ).rows[0].company_id as number;
    return [readyId, noEmailId];
  });
  const futureDue = (await dbValue<string>(
    `SELECT ((NOW() AT TIME ZONE 'Asia/Bangkok')::date + 14)::text`
  ))!;

  await loginAs(page, 'staff1');
  await goToMenu(page, 'jobs');
  await page.getByTestId('jobs-tab-send').click();

  await page.getByTestId('survey-semester').selectOption(String(semesterId));
  await page.getByTestId('survey-due-date').fill(futureDue);

  // ⛔ สถานะมาจากเซิร์ฟเวอร์ ไม่ใช่หน้าจอเดาจาก email === null
  //    ชิปตั้งต้นคือ “ยังไม่ได้ส่ง” ซึ่งไม่แสดงแถวไม่มีอีเมล ต้องสลับไปดูก่อน
  await page.getByTestId('survey-filter-noemail').click();
  await expect(page.getByTestId(`survey-check-${noEmailId}`)).toBeDisabled();

  await page.getByTestId('survey-filter-unsent').click();
  await page.getByTestId(`survey-check-${readyId}`).check();
  await expect(page.getByTestId('survey-selected-count')).toContainText('1');

  await page.getByTestId('survey-open-confirm').click();
  await page.getByTestId('survey-confirm-send').click();

  /**
   * ผลการส่งขึ้นกับว่าเครื่องนี้ส่งเมลออกได้ไหม (เหมือน SB6 ใน staff-job-offer-review)
   * สิ่งที่ต้องจริงทุกกรณี: สำเร็จ + ถูกข้าม = จำนวนที่เลือก และตัวเลข “สำเร็จ”
   * ต้องตรงกับใบที่เกิดในฐานจริง — ⛔ ห้ามขึ้นว่าสำเร็จตอนที่ส่งไม่ออก
   */
  const sent = page.getByTestId('survey-result-sent');
  await expect(sent).toBeVisible({ timeout: 30_000 });
  const sentN = Number(await sent.innerText());
  const skippedN = Number(await page.getByTestId('survey-result-skipped-count').innerText());
  expect(sentN + skippedN).toBe(1);

  const offersInDb = Number(
    await dbValue<string>(
      'SELECT COUNT(*) FROM coop_job_offers WHERE company_id = $1 AND semester_id = $2',
      [readyId, semesterId]
    )
  );
  expect(offersInDb).toBe(sentN);

  if (skippedN === 1) {
    // ถูกข้าม = ต้องขึ้นชื่อรายนั้นบนจอ ไม่ใช่แค่ตัวเลข
    await expect(page.getByTestId(`survey-skipped-row-${readyId}`)).toBeVisible();
  }
});
