import { test, expect } from '@playwright/test';
import { API_URL } from '../helpers/env';
import { apiLoginAs } from '../helpers/auth';
import { seedTestData } from '../helpers/test-seeder';
import { dbExec, dbRow, dbRows, dbValue, withDb } from '../helpers/db';

/**
 * เจ้าหน้าที่ตรวจแบบเสนองาน สหกิจ 02 แล้วเปิดตำแหน่งให้นักศึกษาเห็น (spec-E · SB1–SB5)
 *
 * ⛔ **นี่คือจุดที่วงจรของทั้งระบบปิด** — ก่อนหน้านี้บริษัทตอบแบบสำรวจกลับมา แล้วตำแหน่ง
 *    ค้างอยู่ที่ `pending_approval` ตลอดกาลเพราะไม่มีที่ไหนให้ใครกด กระดานหางาน
 *    จึงว่างเปล่าทั้งที่ข้อมูลครบ · ถ้าไฟล์นี้แดง แปลว่าประตูบานนั้นปิดกลับไปแล้ว
 *
 * ยิง API ตรง ไม่แตะหน้าจอ — หน้าจอฝ่ายเจ้าหน้าที่ยังรื้ออยู่ (Antigravity G0–G6)
 * ปุ่มและข้อความจะเปลี่ยนอีกหลายรอบ แต่ **"ใครกดได้ และการกดทำอะไรกับฐาน"
 * ไม่เปลี่ยนตามการรื้อหน้าจอ** และเป็นสิ่งที่พังเงียบ
 */

async function activeSemesterId(): Promise<number> {
  return (await dbValue<number>(
    'SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1'
  ))!;
}

async function seededCompanyId(): Promise<number> {
  return (await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1'))!;
}

/**
 * ใบที่บริษัทตอบกลับมาแล้ว รอเจ้าหน้าที่ตรวจ — สร้างตรงในฐาน ไม่เดินผ่าน
 * `POST /job-offers/send` โดยตั้งใจ เพราะเส้นนั้นต้องส่งอีเมลจริงถึงจะนับว่าสำเร็จ
 * และเครื่องที่รันเทสต์ส่งเมลออกได้บ้างไม่ได้บ้าง (เคสนั้นคุมอยู่ใน
 * `company-mentor-permissions.spec.ts` แล้ว) สิ่งที่ไฟล์นี้ตรวจคือ "หลังใบถูกตอบกลับ"
 */
async function makeSubmittedOffer(itemCount = 2): Promise<{
  offerId: number;
  companyId: number;
  semesterId: number;
  jobIds: number[];
}> {
  const companyId = await seededCompanyId();
  const semesterId = await activeSemesterId();

  return withDb(async (db) => {
    const offer = await db.query(
      `INSERT INTO coop_job_offers (company_id, semester_id, status, due_date,
                                    submitted_at, informant_name, informant_position,
                                    company_snapshot)
       SELECT $1, $2, 'submitted', (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 5, NOW(),
              'วิภาดา เจริญพงศ์', 'เจ้าหน้าที่ฝ่ายบุคคล',
              -- สำเนาทั้งแถวก็พอ — diffCompanySnapshot วนเฉพาะฟิลด์ใน allow-list
              -- ⛔ ห้ามเขียนสำเนาแค่บางช่อง: ช่องที่หายไปจากสำเนาถูกอ่านเป็นค่าว่าง
              --    แล้วทุกช่องที่ไม่ได้ใส่จะถูกรายงานว่า "บริษัทแก้" ทั้งหมด
              to_jsonb(c)
         FROM companies c WHERE c.company_id = $1
       RETURNING offer_id`,
      [companyId, semesterId]
    );
    const offerId = offer.rows[0].offer_id as number;

    const staffId = (
      await db.query("SELECT user_id FROM users WHERE email = 'staff1@test.com'")
    ).rows[0].user_id as number;

    const jobIds: number[] = [];
    for (let i = 1; i <= itemCount; i += 1) {
      const job = await db.query(
        `INSERT INTO job_posts (company_id, offer_id, semester_id, created_by, applied_count,
                                expire_date, status, title, description, quota)
         VALUES ($1, $2, $3, $4, 0,
                 (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 5, 'pending_approval',
                 $5, 'ลักษณะงานตามที่สถานประกอบการกรอกกลับมา', 2)
         RETURNING job_id`,
        [companyId, offerId, semesterId, staffId, `ตำแหน่งทดสอบที่ ${i}`]
      );
      jobIds.push(job.rows[0].job_id as number);
    }

    // ใบนี้ถูกส่งไปถามโดยเจ้าหน้าที่ — token ใบแรกคือหลักฐานว่าใครกดส่ง (SB3)
    await db.query(
      `INSERT INTO job_offer_tokens (token, offer_id, expires_at, created_by)
       VALUES ($1, $2, NOW() + INTERVAL '1 day', $3)`,
      [`test-token-${offerId}`, offerId, staffId]
    );

    return { offerId, companyId, semesterId, jobIds };
  });
}

test.describe('เจ้าหน้าที่ตรวจแบบเสนองานและเปิดตำแหน่ง (spec-E SB1–SB5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('ทั้งห้าเส้นเป็นของเจ้าหน้าที่เท่านั้น', async ({ request }) => {
    const { offerId, semesterId } = await makeSubmittedOffer();

    for (const account of ['mentor1', 'student1'] as const) {
      await apiLoginAs(request, account);
      expect(
        (await request.get(`${API_URL}/job-offers/recipients?semester_id=${semesterId}`)).status(),
        `${account} ต้องเรียก recipients ไม่ได้`
      ).toBe(403);
      expect((await request.get(`${API_URL}/job-offers/staff`)).status()).toBe(403);
      expect((await request.get(`${API_URL}/job-offers/staff/${offerId}`)).status()).toBe(403);
      expect((await request.put(`${API_URL}/job-offers/${offerId}/review`)).status()).toBe(403);
      expect(
        (
          await request.post(`${API_URL}/job-offers/${offerId}/reject`, {
            data: { reason: 'ทดสอบ' },
          })
        ).status()
      ).toBe(403);
    }

    // ⛔ ที่สำคัญกว่า 403 คือ "แล้วสถานะยังไม่ถูกแตะจริง ๆ ใช่ไหม"
    expect(await dbValue<string>('SELECT status FROM coop_job_offers WHERE offer_id = $1', [offerId])).toBe(
      'submitted'
    );
  });

  test('SB1 ทำเนียบบอกเองว่าใครส่งได้ ใครถูกข้าม — ห้ามให้หน้าจอเดาจากอีเมลว่าง', async ({
    request,
  }) => {
    const semesterId = await activeSemesterId();
    const companyId = await seededCompanyId();
    await apiLoginAs(request, 'staff1');

    // ไม่ระบุภาคเรียน = ปฏิเสธ ไม่ใช่เดาให้ (จดหมายที่ส่งผิดภาคย้อนคืนไม่ได้)
    const noSemester = await request.get(`${API_URL}/job-offers/recipients`);
    expect(noSemester.status()).toBe(400);
    expect(await noSemester.text()).toContain('กรุณาระบุภาคเรียน');

    const ready = await (
      await request.get(`${API_URL}/job-offers/recipients?semester_id=${semesterId}`)
    ).json();
    expect(ready.companies.find((c: any) => c.company_id === companyId).status).toBe('ready');
    expect(ready.summary.ready).toBeGreaterThan(0);

    // ไม่มีอีเมลในทะเบียน — เหตุผลเดียวกับที่ `sendSurvey` จะข้ามจริง
    await dbExec('UPDATE companies SET email = NULL WHERE company_id = $1', [companyId]);
    const noEmail = await (
      await request.get(`${API_URL}/job-offers/recipients?semester_id=${semesterId}`)
    ).json();
    expect(noEmail.companies.find((c: any) => c.company_id === companyId).status).toBe('no_email');
    expect(noEmail.summary.no_email).toBe(1);

    // มีใบของภาคนี้แล้ว — ต้องมาก่อน "ไม่มีอีเมล" เหมือนลำดับใน `sendSurvey`
    await makeSubmittedOffer(1);
    const sent = await (
      await request.get(`${API_URL}/job-offers/recipients?semester_id=${semesterId}`)
    ).json();
    const row = sent.companies.find((c: any) => c.company_id === companyId);
    expect(row.status).toBe('already_sent');
    expect(row.offer_id).not.toBeNull();
    expect(row.sent_at).not.toBeNull();
  });

  test('SB2 คิวใบของภาคเรียน — ตัวนับแยกตามสถานะ และไม่ยอมรับสถานะมั่ว', async ({ request }) => {
    const { semesterId } = await makeSubmittedOffer();
    await apiLoginAs(request, 'staff1');

    const all = await request.get(`${API_URL}/job-offers/staff?semester_id=${semesterId}`);
    expect(all.status(), await all.text()).toBe(200);
    const body = await all.json();
    expect(body.counts.submitted).toBe(1);
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].item_count).toBe(2);
    expect(body.offers[0].quota_total).toBe(4);
    // กำหนดส่งกลับผ่านไปแล้ว 5 วัน — เซิร์ฟเวอร์เป็นคนบอก หน้าจอห้ามเทียบวันเอง
    expect(body.offers[0].is_overdue).toBe(true);
    expect(body.offers[0].days_left).toBeLessThan(0);

    expect(
      (await request.get(`${API_URL}/job-offers/staff?semester_id=${semesterId}&status=reviewed`))
        .status()
    ).toBe(200);
    expect(
      (await request.get(`${API_URL}/job-offers/staff?semester_id=${semesterId}&status=whatever`))
        .status()
    ).toBe(400);
  });

  test('SB3 ใบเต็มพร้อมชื่อคนส่ง และช่องที่บริษัทแก้', async ({ request }) => {
    const { offerId, companyId } = await makeSubmittedOffer();
    await apiLoginAs(request, 'staff1');

    const before = await (await request.get(`${API_URL}/job-offers/staff/${offerId}`)).json();
    for (const key of ['semester', 'offer', 'company', 'items', 'previous', 'majors']) {
      expect(before, `คีย์ ${key} ต้องมีเหมือนฝั่งบริษัททุกใบ`).toHaveProperty(key);
    }
    expect(before.items).toHaveLength(2);
    expect(before.sent_by_name).toBeTruthy();
    expect(before.changed_fields).toEqual([]);

    // บริษัทแก้ข้อมูลของตัวเองในใบ — คนตรวจต้องเห็นว่าแก้ช่องไหน
    await dbExec(
      `UPDATE companies SET business_type = 'ผลิตชิ้นส่วนอิเล็กทรอนิกส์', employee_count = 4200
        WHERE company_id = $1`,
      [companyId]
    );
    const after = await (await request.get(`${API_URL}/job-offers/staff/${offerId}`)).json();
    expect(after.changed_fields).toContain('business_type');
    expect(after.changed_fields).toContain('employee_count');

    expect((await request.get(`${API_URL}/job-offers/staff/999999`)).status()).toBe(404);
  });

  test('SB4 กดตรวจผ่าน = ตำแหน่งขึ้นกระดานหางาน และนักศึกษายื่นได้จริง', async ({ request }) => {
    const { offerId, jobIds } = await makeSubmittedOffer();
    await apiLoginAs(request, 'staff1');

    // ก่อนกด: ตำแหน่งมีอยู่จริงแต่ไม่มีทางที่นักศึกษาจะเห็น — คืออาการที่ทำให้ต้องมีเส้นนี้
    await apiLoginAs(request, 'student2');
    const boardBefore = await (await request.get(`${API_URL}/jobs`)).json();
    expect(boardBefore.some((j: any) => jobIds.includes(j.job_id))).toBe(false);

    await apiLoginAs(request, 'staff1');
    const res = await request.put(`${API_URL}/job-offers/${offerId}/review`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.published_count).toBe(2);
    expect(body.skipped_count).toBe(0);
    expect(body.message).toContain('2 รายการ');

    expect(
      await dbValue<string>('SELECT status FROM coop_job_offers WHERE offer_id = $1', [offerId])
    ).toBe('reviewed');
    expect(
      await dbValue<boolean>(
        'SELECT reviewed_by IS NOT NULL FROM coop_job_offers WHERE offer_id = $1',
        [offerId]
      )
    ).toBe(true);

    await apiLoginAs(request, 'student2');
    const board = await (await request.get(`${API_URL}/jobs`)).json();
    expect(board.some((j: any) => j.job_id === jobIds[0])).toBe(true);

    /**
     * ⛔ เคสนี้คือตัวที่จับบั๊กที่ทำให้วงจรยังไม่ปิดจริงแม้จะกดตรวจผ่านแล้ว:
     *    `models/intent.ts` เคยปฏิเสธการยื่นด้วย `expire_date <= now` ซึ่งเป็นความหมายเก่า
     *    ("ประกาศหมดอายุ") ทั้งที่ตอนนี้คอลัมน์นั้นคือ "กำหนดส่งแบบสำรวจกลับ" ที่ผ่านไปแล้ว
     *    เสมอ ณ วินาทีที่ตำแหน่งถูกเปิด — นักศึกษาจึงเห็นตำแหน่งบนกระดาน กดยื่น
     *    แล้วได้ "Job post has expired."
     */
    const intent = await request.post(`${API_URL}/intents`, {
      data: {
        company_id: await seededCompanyId(),
        semester_id: await activeSemesterId(),
        job_id: jobIds[0],
        is_self_found: false,
      },
    });
    expect(intent.status(), await intent.text()).toBe(201);

    // กดตรวจซ้ำใบเดิมไม่ได้ และต้องบอกสถานะปัจจุบัน ไม่ใช่ "ทำรายการไม่ได้" ลอย ๆ
    await apiLoginAs(request, 'staff1');
    const again = await request.put(`${API_URL}/job-offers/${offerId}/review`);
    expect(again.status()).toBe(409);
    expect(await again.text()).toContain('เปิดให้นักศึกษาเห็นไปแล้ว');
  });

  test('SB4 รายการที่ถูกปฏิเสธรายอันไปก่อนแล้ว ต้องไม่ถูกเปิดตอนผ่านทั้งใบ', async ({ request }) => {
    const { offerId, jobIds } = await makeSubmittedOffer(3);
    await apiLoginAs(request, 'staff1');

    const rejectOne = await request.put(`${API_URL}/jobs/${jobIds[0]}/reject`, {
      data: { reason: 'ลักษณะงานไม่ตรงกับสาขาที่เปิดสหกิจ' },
    });
    expect(rejectOne.status(), await rejectOne.text()).toBe(200);

    const body = await (await request.put(`${API_URL}/job-offers/${offerId}/review`)).json();
    expect(body.published_count).toBe(2);
    expect(body.skipped_count).toBe(1);

    expect(await dbValue<string>('SELECT status FROM job_posts WHERE job_id = $1', [jobIds[0]])).toBe(
      'rejected'
    );
  });

  test('SB5 ตีกลับทั้งใบต้องมีเหตุผล และตำแหน่งที่มีคนยื่นแล้วตีกลับไม่ได้', async ({ request }) => {
    const { offerId, jobIds } = await makeSubmittedOffer();
    await apiLoginAs(request, 'staff1');

    const noReason = await request.post(`${API_URL}/job-offers/${offerId}/reject`, { data: {} });
    expect(noReason.status()).toBe(400);
    expect(await noReason.text()).toContain('เหตุผล');
    // ปฏิเสธคำขอที่ไม่มีเหตุผลแล้วต้องไม่แตะฐานเลย
    expect(
      await dbValue<string>('SELECT status FROM coop_job_offers WHERE offer_id = $1', [offerId])
    ).toBe('submitted');

    // มีนักศึกษายื่นเข้ามาแล้วในตำแหน่งหนึ่ง — ตีกลับทั้งใบไม่ได้
    await dbExec('UPDATE job_posts SET applied_count = 1 WHERE job_id = $1', [jobIds[0]]);
    const blocked = await request.post(`${API_URL}/job-offers/${offerId}/reject`, {
      data: { reason: 'ข้อมูลไม่ครบ' },
    });
    expect(blocked.status()).toBe(409);
    expect(await blocked.text()).toContain('ตำแหน่งทดสอบที่ 1');

    await dbExec('UPDATE job_posts SET applied_count = 0 WHERE job_id = $1', [jobIds[0]]);
    const ok = await request.post(`${API_URL}/job-offers/${offerId}/reject`, {
      data: { reason: 'ยังไม่ได้ระบุค่าตอบแทนและที่พัก' },
    });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).rejected_count).toBe(2);

    const offer = await dbRow<{ status: string; reject_reason: string }>(
      'SELECT status, reject_reason FROM coop_job_offers WHERE offer_id = $1',
      [offerId]
    );
    expect(offer!.status).toBe('draft');
    expect(offer!.reject_reason).toContain('ค่าตอบแทน');

    const items = await dbRows<{ status: string; reject_reason: string }>(
      'SELECT status, reject_reason FROM job_posts WHERE offer_id = $1',
      [offerId]
    );
    expect(items.every((i) => i.status === 'rejected')).toBe(true);
    expect(items.every((i) => i.reject_reason.includes('ค่าตอบแทน'))).toBe(true);
  });

  test('SB6 ส่งลิงก์ให้บริษัทใหม่ — ปลายทางมาจากทะเบียนเท่านั้น และกดรัวไม่ได้', async ({
    request,
  }) => {
    const { offerId, companyId } = await makeSubmittedOffer(1);
    await apiLoginAs(request, 'staff1');

    /**
     * ⛔ token ตั้งต้นของใบนี้เพิ่งถูกสร้างโดย fixture — cooldown 10 นาทีจึงยังทำงานอยู่
     *    ต้องดันให้มันเก่าก่อน ไม่งั้นเคสนี้กำลังทดสอบ cooldown ไม่ใช่การส่ง
     */
    await dbExec(
      "UPDATE job_offer_tokens SET created_at = NOW() - INTERVAL '2 hours' WHERE offer_id = $1",
      [offerId]
    );

    const res = await request.post(`${API_URL}/job-offers/${offerId}/resend-link`);
    /**
     * ⛔ เขียนแบบไม่ผูกกับผลของ SMTP โดยตั้งใจ (เหตุผลเดียวกับเคสส่งแบบสำรวจใน
     *    `company-mentor-permissions.spec.ts`) — เครื่องที่รันเทสต์ส่งเมลออกได้บ้างไม่ได้บ้าง
     *    **ข้อตกลงที่ต้องจริงเสมอ** คือส่งไม่ออกต้องไม่ตอบ 200 หลอกว่าส่งแล้ว
     */
    expect([200, 502], await res.text()).toContain(res.status());
    if (res.status() === 200) {
      expect(await res.text()).toContain('company1@test.com');
    }
    // ไม่ว่าเมลจะออกหรือไม่ ก็ต้องมี token ใบใหม่ถูกออกไปแล้ว
    expect(
      Number(
        await dbValue<string>('SELECT COUNT(*) FROM job_offer_tokens WHERE offer_id = $1', [offerId])
      )
    ).toBe(2);

    // กดซ้ำทันที = โดน cooldown ไม่ใช่ยิงเมลรัวใส่บริษัท
    const again = await request.post(`${API_URL}/job-offers/${offerId}/resend-link`);
    expect(again.status()).toBe(429);
    expect(await again.text()).toContain('นาที');

    // ไม่มีอีเมลในทะเบียน = บอกให้ไปกรอกก่อน ไม่ใช่ตกไปใช้อีเมลของคนอื่น
    await dbExec('UPDATE companies SET email = NULL WHERE company_id = $1', [companyId]);
    await dbExec(
      "UPDATE job_offer_tokens SET created_at = NOW() - INTERVAL '2 hours' WHERE offer_id = $1",
      [offerId]
    );
    const noEmail = await request.post(`${API_URL}/job-offers/${offerId}/resend-link`);
    expect(noEmail.status()).toBe(400);
    expect(await noEmail.text()).toContain('ยังไม่มีอีเมลผู้ประสานงานในทะเบียน');
  });

  test('SB6 ใบที่ตรวจแล้วส่งลิงก์ให้แก้ไม่ได้ และคนนอกกดไม่ได้', async ({ request }) => {
    const { offerId } = await makeSubmittedOffer(1);

    for (const account of ['mentor1', 'student1'] as const) {
      await apiLoginAs(request, account);
      expect(
        (await request.post(`${API_URL}/job-offers/${offerId}/resend-link`)).status(),
        `${account} ต้องสั่งให้ระบบยิงเมลไม่ได้`
      ).toBe(403);
    }

    await dbExec("UPDATE coop_job_offers SET status = 'reviewed' WHERE offer_id = $1", [offerId]);
    await apiLoginAs(request, 'staff1');
    const res = await request.post(`${API_URL}/job-offers/${offerId}/resend-link`);
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain('เปิดให้นักศึกษาเห็นไปแล้ว');
  });

  test('SB5 ใบที่ยังไม่ถูกตอบกลับมาตีกลับไม่ได้ และบอกสถานะปัจจุบัน', async ({ request }) => {
    const { offerId } = await makeSubmittedOffer(1);
    await dbExec("UPDATE coop_job_offers SET status = 'draft' WHERE offer_id = $1", [offerId]);

    await apiLoginAs(request, 'staff1');
    const res = await request.post(`${API_URL}/job-offers/${offerId}/reject`, {
      data: { reason: 'ทดสอบ' },
    });
    expect(res.status()).toBe(409);
    expect(await res.text()).toContain('ยังไม่ได้ส่งคำตอบกลับมา');
  });
});
