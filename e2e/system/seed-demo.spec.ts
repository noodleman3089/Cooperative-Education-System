import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { dbRow, dbRows, dbValue } from '../helpers/db';
import { API_URL } from '../helpers/env';
import { seedDemo } from '../../backend/src/db/seedDemo';
import { MENTOR_QUEUE_KINDS } from '../../backend/src/models/mentorQueue';

/**
 * สคริปต์ข้อมูลเดโม `npm run db:seed-demo` (`backend/src/db/seedDemo.ts`) ต้องไม่เน่าเงียบ
 *
 * สคริปต์เก่า (`scratch/seed_company.js`) ตายเงียบเมื่อ schema เปลี่ยน — ไม่มีใครรันมันในเทสต์
 * จึงรู้ตัวตอนเจ้าของอยากใช้เท่านั้น · เทสต์นี้รันมันจริงบนฐานของ E2E แล้วพิสูจน์สามเรื่อง:
 *   1. ลงข้อมูลครบทุกสถานการณ์ และลิงก์ที่พิมพ์ออกมาใช้ได้จริงกับเซิร์ฟเวอร์
 *   2. ไม่ฝ่าฝืน SEC-15 (พี่เลี้ยงไม่มีรหัสผ่าน · บทบาทเดียว) และไม่มีบทบาท company
 *   3. รันซ้ำแล้วจำนวนแถวไม่เพิ่ม
 *
 * ⛔ ห้าม `pool.end()` — Playwright รันทุกไฟล์ในโปรเซสเดียว (seedDemo ก็ไม่ปิด pool เมื่อถูก import)
 */

/** จำนวนแถวหลักที่สคริปต์ลง — ใช้เทียบหลังรันรอบสอง */
async function demoCounts() {
  const row = await dbRow(`
    SELECT
      (SELECT COUNT(*) FROM users)::int                                              AS users,
      (SELECT COUNT(*) FROM students)::int                                           AS students,
      (SELECT COUNT(*) FROM intent_forms WHERE status = 'accepted')::int             AS accepted,
      (SELECT COUNT(*) FROM intent_forms WHERE status = 'approved_by_dept_head')::int AS awaiting_company,
      (SELECT COUNT(*) FROM official_documents WHERE status = 'signed')::int         AS signed_letters,
      (SELECT COUNT(*) FROM coop_job_offers)::int                                    AS offers,
      (SELECT COUNT(*) FROM job_posts WHERE offer_id IS NOT NULL)::int               AS offer_items,
      (SELECT COUNT(*) FROM job_post_majors)::int                                    AS item_majors,
      (SELECT COUNT(*) FROM job_offer_tokens)::int                                   AS offer_tokens,
      (SELECT COUNT(*) FROM acceptance_link_tokens)::int                             AS accept_tokens,
      (SELECT COUNT(*) FROM weekly_logs)::int                                        AS weekly,
      (SELECT COUNT(*) FROM weekly_logs WHERE mentor_certified_at IS NOT NULL)::int  AS weekly_certified,
      (SELECT COUNT(*) FROM weekly_logs WHERE status = 'returned')::int              AS weekly_returned,
      (SELECT COUNT(*) FROM monthly_logs)::int                                       AS monthly,
      (SELECT COUNT(*) FROM daily_logs)::int                                         AS daily,
      (SELECT COUNT(*) FROM work_plan_topics)::int                                   AS plan_topics,
      (SELECT COUNT(*) FROM work_plan_approvals)::int                                AS plan_approvals,
      (SELECT COUNT(*) FROM report_outlines)::int                                    AS outlines,
      (SELECT COUNT(*) FROM final_reports)::int                                      AS drafts,
      (SELECT COUNT(*) FROM companies)::int                                          AS companies,
      (SELECT COUNT(*) FROM mentors)::int                                            AS mentors
  `);
  return row as Record<string, number>;
}

const tokenOf = (url: string) => new URL(url).searchParams.get('token') ?? '';

test.describe('seedDemo — ข้อมูลเดโมสำหรับเปิดหน้าเว็บเทสด้วยมือ', () => {
  test('D1: ลงครบทุกสถานการณ์ · ลิงก์ที่พิมพ์ออกมาใช้ได้จริง · พี่เลี้ยงไม่มีรหัสผ่าน (SEC-15)', async ({ request }) => {
    await seedTestData();
    const result = await seedDemo({ quiet: true });

    // ── แถวหลักตามสถานการณ์ ──
    const c = await demoCounts();
    expect(c.accepted, 'S3 นักศึกษาที่ฝึกอยู่กับ mentor1').toBe(2);
    expect(c.awaiting_company, 'S2 รอบริษัทตอบทางลิงก์').toBe(2);
    expect(c.signed_letters, 'S2 หนังสือที่คณบดีลงนามแล้ว').toBe(2);
    expect(c.offers, 'S1 ใบเก่า (ตรวจแล้ว) + ใบร่างภาคถัดไป').toBe(2);
    expect(c.offer_items, 'S1 ตำแหน่ง 2 รายการ × 2 ใบ').toBe(4);
    expect(c.offer_tokens, 'S1 ลิงก์ใช้ได้ 1 + หมดอายุ 1').toBe(2);
    expect(c.accept_tokens, 'S2 ลิงก์ตอบรับ 1 ใบต่อคน').toBe(2);
    expect(c.weekly, 'S5 รายสัปดาห์ student2 6 ใบ + student1 9 ใบ').toBe(15);
    expect(c.weekly_certified, 'S5 รับรองแล้ว').toBe(9);
    expect(c.weekly_returned, 'S5 ถูกส่งกลับ').toBe(1);
    expect(c.monthly, 'S5 รายเดือน').toBe(3);
    expect(c.daily, 'S5 รายวัน 2 สัปดาห์ × 5 วัน').toBe(10);
    expect(c.plan_topics, 'S6 หัวข้อแผนงาน').toBe(9);
    expect(c.plan_approvals, 'S6 ใบลงนามแผน').toBe(2);
    expect(c.outlines, 'S7 โครงร่างรายงาน').toBe(1);
    expect(c.drafts, 'S7 ร่างรายงาน 2 เวอร์ชัน').toBe(2);

    // ── สถานะที่สร้างต้องเป็นสถานะที่ระบบมีจริง (ไม่ใช่ค่าที่ insert ตรงๆ แล้วหน้าจอไม่รู้จัก) ──
    const statuses = await dbRows<{ status: string }>('SELECT DISTINCT status FROM intent_forms ORDER BY status');
    expect(statuses.map((r) => r.status)).toEqual(['accepted', 'approved_by_dept_head']);

    // ── S4 คิว "รอคุณรับรอง" ครบทุกชนิดที่ระบบมี — อ่านจากโมเดลตัวจริงของหน้าแรกพี่เลี้ยง ──
    // (เข้าจริงผ่านลิงก์ด้านล่าง แล้วถามคิวผ่าน API ของเซิร์ฟเวอร์)
    expect(result.mentorLoginUrl, 'ออกลิงก์ mentor1 ไม่ได้').not.toBeNull();
    const consume = await request.post(`${API_URL}/auth/mentor-link/consume`, {
      data: { token: tokenOf(result.mentorLoginUrl!) },
    });
    expect(consume.status()).toBe(200);
    const pending = await request.get(`${API_URL}/mentor/pending`);
    expect(pending.status()).toBe(200);
    const body = await pending.json();
    const kinds = new Set<string>(body.items.map((i: { kind: string }) => i.kind));
    expect([...kinds].sort()).toEqual([...MENTOR_QUEUE_KINDS].sort());
    expect(body.students).toHaveLength(2);

    // ── ลิงก์สาธารณะที่สคริปต์พิมพ์ออกมา ──
    const live = await request.get(`${API_URL}/public/job-offer?token=${tokenOf(result.offerLiveUrl)}`);
    expect(live.status(), 'ลิงก์ /offer ที่ใช้ได้ต้องเปิดได้').toBe(200);
    const dead = await request.get(`${API_URL}/public/job-offer?token=${tokenOf(result.offerExpiredUrl)}`);
    expect(dead.status(), 'ลิงก์ /offer ที่หมดอายุต้องถูกปฏิเสธ').toBe(410);
    expect(result.acceptUrls).toHaveLength(2);
    for (const url of result.acceptUrls) {
      const res = await request.get(`${API_URL}/public/acceptance?token=${tokenOf(url)}`);
      expect(res.status(), 'ลิงก์ /accept ต้องเปิดได้').toBe(200);
    }

    // ── กติกา SEC-15 / ไม่มีบทบาท company ──
    expect(await dbValue<boolean>("SELECT password_hash IS NULL FROM users WHERE email = 'mentor1@test.com'")).toBe(true);
    const mentorRoles = await dbRows<{ role_name: string }>(
      "SELECT r.role_name FROM user_roles r JOIN users u ON u.user_id = r.user_id WHERE u.email = 'mentor1@test.com'"
    );
    expect(mentorRoles.map((r) => r.role_name)).toEqual(['mentor']);
    expect(
      await dbValue<number>(
        `SELECT COUNT(*)::int FROM users u JOIN user_roles r ON r.user_id = u.user_id
          WHERE r.role_name = 'mentor' AND u.password_hash IS NOT NULL`
      )
    ).toBe(0);
    expect(await dbValue<number>("SELECT COUNT(*)::int FROM user_roles WHERE role_name = 'company'")).toBe(0);
    // ข้อมูลอ่อนไหว SEC-12 ต้องว่าง
    expect(
      await dbValue<number>(
        `SELECT COUNT(*)::int FROM students
          WHERE national_id_ciphertext IS NOT NULL OR ethnicity_ciphertext IS NOT NULL OR religion_ciphertext IS NOT NULL`
      )
    ).toBe(0);
  });

  test('D2: รันซ้ำแล้วจำนวนแถวหลักไม่เพิ่ม (idempotent)', async () => {
    await seedTestData();
    await seedDemo({ quiet: true });
    const first = await demoCounts();

    await seedDemo({ quiet: true });
    const second = await demoCounts();

    expect(second).toEqual(first);
    // รอบสองยังต้องมีลิงก์เข้าระบบ mentor1 ที่ยังไม่ใช้อยู่ใบเดียว (ใบเก่าถูกลบก่อนออกใบใหม่)
    expect(
      await dbValue<number>(
        `SELECT COUNT(*)::int FROM mentor_login_tokens t JOIN users u ON u.user_id = t.user_id
          WHERE u.email = 'mentor1@test.com' AND t.used_at IS NULL AND t.expires_at > NOW()`
      )
    ).toBe(1);
  });
});
