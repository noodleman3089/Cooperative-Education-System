import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbValue, withDb } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * SB-F2 · คีย์ใหม่ใน `GET /outlines/advisor` — spec-F ข้อ 5 · 15.2
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. หัวข้อรายงานและจำนวนฉบับมาจากฉบับล่าสุดจริง
 *   2. `days_waiting` นับเฉพาะใบที่รออาจารย์ (`pending_advisor`) · สถานะอื่นเป็น null
 *      (หน้าจอห้ามคำนวณวันเอง จึงต้องได้ค่าที่ถูกจากเซิร์ฟเวอร์)
 *   3. อาจารย์ที่ไม่ใช่ที่ปรึกษาไม่เห็นใบนั้น (ของเดิม · กันถอยกลับ)
 */

let outlineId: number;

test.describe('SB-F2 · คิวโครงร่างของอาจารย์', () => {
  test.beforeEach(async () => {
    await seedTestData();
    outlineId = await withDb(async (db) => {
      const sid = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
      const aid = (await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")).rows[0].user_id;
      const cid = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
      await db.query('DELETE FROM report_outlines WHERE student_id = $1', [sid]);
      await db.query('UPDATE students SET advisor_id = $1 WHERE student_id = $2', [aid, sid]);
      const oid = (
        await db.query(
          `INSERT INTO report_outlines (student_id, company_id, status, updated_at)
           VALUES ($1, $2, 'pending_advisor', CURRENT_TIMESTAMP - INTERVAL '3 days') RETURNING outline_id`,
          [sid, cid]
        )
      ).rows[0].outline_id;
      await db.query(
        `INSERT INTO report_outline_versions (outline_id, file_path, report_title, submitted_at, status)
         VALUES ($1, 'outlines/v1.pdf', 'หัวข้อฉบับแรก', CURRENT_TIMESTAMP - INTERVAL '10 days', 'rejected'),
                ($1, 'outlines/v2.pdf', 'ระบบติดตามสต็อกชิ้นส่วนด้วยบาร์โค้ด', CURRENT_TIMESTAMP - INTERVAL '4 days', 'submitted')`,
        [oid]
      );
      return oid as number;
    });
  });

  const findRow = async (request: import('@playwright/test').APIRequestContext) => {
    const res = await request.get(`${API_URL}/outlines/advisor`);
    expect(res.status(), await res.text()).toBe(200);
    return ((await res.json()).data as Array<Record<string, unknown>>).find((r) => r.outline_id === outlineId);
  };

  test('O1: หัวข้อ · จำนวนฉบับ · รอกี่วัน มาจากเซิร์ฟเวอร์', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const row = await findRow(request);
    expect(row?.latest_report_title).toBe('ระบบติดตามสต็อกชิ้นส่วนด้วยบาร์โค้ด');
    expect(row?.version_count).toBe(2);
    expect(row?.days_waiting).toBe(3);
    expect(row?.waiting_since).toBeTruthy();
  });

  test('O2: ใบที่ไม่ได้รออาจารย์ → days_waiting เป็น null', async ({ request }) => {
    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);
    await apiLoginAs(request, 'advisor1');
    const row = await findRow(request);
    expect(row).toBeTruthy();
    expect(row?.days_waiting).toBeNull();
  });

  test('O3: อาจารย์ที่ไม่ใช่ที่ปรึกษาไม่เห็นใบนี้', async ({ request }) => {
    await apiLoginAs(request, 'advisor2');
    expect(await findRow(request)).toBeUndefined();
  });

  /**
   * ⛔ ตีกลับก็ต้องมี allow-list เหมือนการอนุมัติ — สายนี้เคยไม่ตรวจสถานะปัจจุบันเลย
   * แปลว่าอาจารย์ตีกลับใบที่เห็นชอบไปแล้ว (นักศึกษาเริ่มเขียนเล่มแล้ว) หรือใบที่ยังรอพี่เลี้ยง
   * (ข้ามขั้นพี่เลี้ยงตามลำดับของ สหกิจ 11) ได้เงียบ ๆ
   */
  test('O4: ตีกลับใบที่เห็นชอบแล้ว หรือใบที่ยังรอพี่เลี้ยง → 400 และสถานะไม่ขยับ', async ({
    request,
  }) => {
    const reject = () =>
      request.put(`${API_URL}/outlines/${outlineId}/status`, {
        data: { status: 'rejected', comment: 'ขอให้แก้ขอบเขตใหม่' },
      });

    await dbValue("UPDATE report_outlines SET status = 'approved' WHERE outline_id = $1", [outlineId]);
    await apiLoginAs(request, 'advisor1');
    const onApproved = await reject();
    expect(onApproved.status(), await onApproved.text()).toBe(400);
    expect(
      await dbValue<string>('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId])
    ).toBe('approved');

    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);
    const onPendingMentor = await reject();
    expect(onPendingMentor.status(), await onPendingMentor.text()).toBe(400);
    expect(
      await dbValue<string>('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId])
    ).toBe('pending_mentor');
  });

  test('O5: ตีกลับใบที่รออาจารย์อยู่จริง → ผ่าน และเหตุผลถูกเก็บบนฉบับล่าสุด', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const res = await request.put(`${API_URL}/outlines/${outlineId}/status`, {
      data: { status: 'rejected', comment: 'ขอบเขตกว้างเกินไป ให้ตัดบทที่ 4 ออก' },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(
      await dbValue<string>('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId])
    ).toBe('rejected');
    expect(
      await dbValue<string>(
        `SELECT rejection_comment FROM report_outline_versions
         WHERE outline_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
        [outlineId]
      )
    ).toContain('ตัดบทที่ 4');
  });

  /**
   * ⛔ ตีกลับต้องมีเหตุผลที่เซิร์ฟเวอร์ด้วย ไม่ใช่แค่ที่หน้าจอ (2026-09-23)
   * เดิม `comment || null` ยอมให้ยิง API ตรงแล้วตีกลับโดยไม่บอกนักศึกษาว่าแก้อะไร
   * · คนไม่มีสิทธิ์ต้องยังได้ 403 — ด่านเหตุผลอยู่หลังด่านสิทธิ์โดยตั้งใจ
   */
  test('O6: ตีกลับโดยไม่มีความเห็น (หรือช่องว่างล้วน) → 400 · สถานะไม่ขยับ · คนไม่มีสิทธิ์ยังได้ 403', async ({
    request,
  }) => {
    await apiLoginAs(request, 'advisor1');
    for (const data of [{ status: 'rejected' }, { status: 'rejected', comment: '   ' }]) {
      const res = await request.put(`${API_URL}/outlines/${outlineId}/status`, { data });
      expect(res.status(), await res.text()).toBe(400);
      expect(await res.text()).toContain('กรุณาระบุข้อเสนอแนะ');
    }
    expect(
      await dbValue<string>('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId])
    ).toBe('pending_advisor');
    expect(
      await dbValue<string | null>(
        `SELECT rejection_comment FROM report_outline_versions
         WHERE outline_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
        [outlineId]
      )
    ).toBeNull();

    await apiLoginAs(request, 'advisor2');
    const outsider = await request.put(`${API_URL}/outlines/${outlineId}/status`, {
      data: { status: 'rejected' },
    });
    expect(outsider.status(), await outsider.text()).toBe(403);
  });
});
