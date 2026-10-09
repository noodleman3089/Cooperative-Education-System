import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * SB-F2 · คีย์ใหม่ใน `GET /outlines/advisor` — spec-F ข้อ 5 · 15.2
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. หัวข้อรายงานและจำนวนฉบับมาจากฉบับล่าสุดจริง
 *   2. `days_waiting` นับเฉพาะใบที่รออาจารย์ (`pending_advisor`) · สถานะอื่นเป็น null
 *      (หน้าจอห้ามคำนวณวันเอง จึงต้องได้ค่าที่ถูกจากเซิร์ฟเวอร์)
 *   3. อาจารย์ที่ไม่ใช่ผู้นิเทศไม่เห็นใบนั้น
 *
 * ขั้น 7 ข้อ ข (2026-10-09): **สหกิจ 11 เป็นงานของอาจารย์นิเทศ (`supervisor_id`)** — เดิมผูกกับอาจารย์ที่ปรึกษา
 * ตัวตั้งข้อมูลจึงให้ advisor1 เป็นผู้นิเทศ และ advisor2 เป็นที่ปรึกษา: ทุกเคสที่ advisor1 ทำได้
 * และ advisor2 ทำไม่ได้ พิสูจน์ว่าด่านอ่าน `supervisor_id` จริง ไม่ใช่ `advisor_id`
 *   4. อาจารย์นิเทศส่งใบที่อนุมัติแล้วกลับได้ (ทางแก้เมื่ออนุมัติผิด) — เฉพาะตอนยังไม่มีเล่มสมบูรณ์
 */

let outlineId: number;
let studentId: number;

test.describe('SB-F2 · คิวโครงร่างของอาจารย์', () => {
  test.beforeEach(async () => {
    await seedTestData();
    outlineId = await withDb(async (db) => {
      const sid = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
      const aid = (await db.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'")).rows[0].user_id;
      const otherId = (await db.query("SELECT user_id FROM users WHERE email = 'advisor2@test.com'")).rows[0].user_id;
      const mentorId = (await db.query("SELECT user_id FROM users WHERE email = 'mentor1@test.com'")).rows[0].user_id;
      const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0]
        .semester_id;
      const cid = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
      studentId = sid;
      await db.query('DELETE FROM report_outlines WHERE student_id = $1', [sid]);
      await db.query('DELETE FROM final_reports WHERE student_id = $1', [sid]);
      await db.query('UPDATE students SET advisor_id = $1, supervisor_id = $2 WHERE student_id = $3', [otherId, aid, sid]);
      // ที่ฝึกที่ตอบรับแล้ว — นักศึกษาส่งโครงร่างฉบับใหม่ได้เฉพาะเมื่อมีใบนี้
      await db.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
         VALUES ($1, $2, $3, 'accepted', $4, '2026-11-02')`,
        [sid, cid, semesterId, mentorId]
      );
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

  const statusOf = () => dbValue<string>('SELECT status FROM report_outlines WHERE outline_id = $1', [outlineId]);

  const reject = (request: import('@playwright/test').APIRequestContext) =>
    request.put(`${API_URL}/outlines/${outlineId}/status`, {
      data: { status: 'rejected', comment: 'ขอให้แก้ขอบเขตใหม่' },
    });

  test('O1: หัวข้อ · จำนวนฉบับ · รอกี่วัน มาจากเซิร์ฟเวอร์', async ({ request }) => {
    await apiLoginAs(request, 'advisor1');
    const row = await findRow(request);
    expect(row?.latest_report_title).toBe('ระบบติดตามสต็อกชิ้นส่วนด้วยบาร์โค้ด');
    expect(row?.version_count).toBe(2);
    expect(row?.days_waiting).toBe(3);
    expect(row?.waiting_since).toBeTruthy();
  });

  test('O2: ใบที่ยังรอพี่เลี้ยง → days_waiting เป็น null · mentor_waiting_days นับจากวันที่นักศึกษาส่งฉบับล่าสุด', async ({
    request,
  }) => {
    await apiLoginAs(request, 'advisor1');
    // ใบที่รออาจารย์: ไม่มีตัวนับฝั่งพี่เลี้ยง
    expect((await findRow(request))?.mentor_waiting_days).toBeNull();

    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);
    const row = await findRow(request);
    expect(row).toBeTruthy();
    expect(row?.days_waiting).toBeNull();
    // ฉบับล่าสุดส่งเมื่อ 4 วันก่อน (ตัวตั้งข้อมูล) — อาจารย์นิเทศใช้ตัดสินว่าจะเห็นชอบแทนหรือไม่
    expect(row?.mentor_waiting_days).toBe(4);

    // ⛔ ใบที่ยังรอพี่เลี้ยงไม่ใช่ "งานที่รอคุณ" — กองบนหน้าแรกไม่นับ
    const home = await request.get(`${API_URL}/faculty/home/advisor?view=supervisor`);
    expect((await home.json()).tiles.outline.count).toBe(0);
  });

  test('O3: อาจารย์ที่ไม่ใช่ผู้นิเทศไม่เห็นใบนี้ — แม้จะเป็นอาจารย์ที่ปรึกษาของนักศึกษา · และเห็นชอบแทนไม่ได้ (403)', async ({
    request,
  }) => {
    await apiLoginAs(request, 'advisor2');
    expect(await findRow(request)).toBeUndefined();

    const res = await request.put(`${API_URL}/outlines/${outlineId}/status`, { data: { status: 'approved' } });
    expect(res.status(), await res.text()).toBe(403);
    expect((await res.json()).message).toContain('อาจารย์นิเทศ');
    expect(await statusOf()).toBe('pending_advisor');

    // ตัวคุม: ผู้นิเทศเห็นชอบได้
    await apiLoginAs(request, 'advisor1');
    expect((await request.put(`${API_URL}/outlines/${outlineId}/status`, { data: { status: 'approved' } })).status()).toBe(200);
    expect(await statusOf()).toBe('approved');
  });

  /**
   * ⛔ ตีกลับก็ต้องมี allow-list เหมือนการอนุมัติ — สายนี้เคยไม่ตรวจสถานะปัจจุบันเลย
   * อาจารย์ตีกลับใบที่ยังรอพี่เลี้ยง (ข้ามขั้นพี่เลี้ยงตามลำดับของ สหกิจ 11) ได้เงียบ ๆ
   *
   * ขั้น 7 ข้อ ข2: ใบที่อนุมัติแล้ว **ส่งกลับได้** โดยอาจารย์นิเทศ พร้อมเหตุผล เมื่อยังไม่มีเล่มสมบูรณ์
   * (เดิม 400 ทั้งสองทาง — อนุมัติผิดแล้วไม่มีทางแก้ และนักศึกษาส่งทับเองก็ไม่ได้)
   */
  test('O4: ส่งกลับใบที่อนุมัติแล้ว (ยังไม่มีเล่ม) → 200 · เหตุผลอยู่บนฉบับล่าสุด · ลง audit · ใบที่ยังรอพี่เลี้ยงยัง 400', async ({
    request,
  }) => {
    await dbValue("UPDATE report_outlines SET status = 'approved' WHERE outline_id = $1", [outlineId]);
    await apiLoginAs(request, 'advisor1');
    const onApproved = await reject(request);
    expect(onApproved.status(), await onApproved.text()).toBe(200);
    expect(await statusOf()).toBe('rejected');
    expect(
      await dbRow(
        `SELECT status, rejection_comment FROM report_outline_versions
          WHERE outline_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
        [outlineId]
      )
    ).toEqual({ status: 'rejected', rejection_comment: 'ขอให้แก้ขอบเขตใหม่' });
    await expect
      .poll(() =>
        dbValue<string>(`SELECT detail::text FROM audit_log WHERE action = 'outline.reopened' AND entity_id = $1`, [
          String(outlineId),
        ])
      )
      .toContain('ขอให้แก้ขอบเขตใหม่');

    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);
    const onPendingMentor = await reject(request);
    expect(onPendingMentor.status(), await onPendingMentor.text()).toBe(400);
    expect(await statusOf()).toBe('pending_mentor');
  });

  test('O7: ส่งกลับใบที่อนุมัติแล้ว — มีเล่มสมบูรณ์แล้ว 409 · ไม่มีเหตุผล 400 · ไม่ใช่ผู้นิเทศ 403 · พี่เลี้ยง 400 · สถานะไม่ขยับ', async ({
    request,
  }) => {
    await dbValue("UPDATE report_outlines SET status = 'approved' WHERE outline_id = $1", [outlineId]);

    // อาจารย์ที่ปรึกษา (ไม่ใช่ผู้นิเทศ) และพี่เลี้ยงของนักศึกษาเอง ถอนการอนุมัติไม่ได้
    await apiLoginAs(request, 'advisor2');
    expect((await reject(request)).status()).toBe(403);
    await apiLoginAs(request, 'mentor1');
    expect((await reject(request)).status()).toBe(400);

    await apiLoginAs(request, 'advisor1');
    for (const data of [{ status: 'rejected' }, { status: 'rejected', comment: '   ' }]) {
      expect((await request.put(`${API_URL}/outlines/${outlineId}/status`, { data })).status()).toBe(400);
    }
    expect(await statusOf()).toBe('approved');

    // ร่างที่ส่งให้พี่เลี้ยงตรวจไม่นับเป็นเล่มสมบูรณ์ — ยังส่งกลับได้ · เล่มที่ส่งถึงอาจารย์แล้วคือจุดที่ถอนไม่ได้
    await dbValue(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
       VALUES ($1, 'final_reports/seeded.pdf', 'submitted', 1, 'advisor') RETURNING report_id`,
      [studentId]
    );
    const blocked = await reject(request);
    expect(blocked.status(), await blocked.text()).toBe(409);
    expect((await blocked.json()).code).toBe('final_report_submitted');
    expect(await statusOf()).toBe('approved');
    expect(Number(await dbValue(`SELECT COUNT(*) FROM audit_log WHERE action = 'outline.reopened'`))).toBe(0);
  });

  test('O8: หลังส่งกลับ — ความคืบหน้ากลับเป็นยังไม่อนุมัติ · อัปโหลดเล่มสมบูรณ์ถูกปฏิเสธ · นักศึกษาส่งฉบับใหม่ได้และกลับไปรอพี่เลี้ยง', async ({
    request,
  }) => {
    await dbValue("UPDATE report_outlines SET status = 'approved' WHERE outline_id = $1", [outlineId]);
    const outlineApproved = async () => {
      const res = await request.get(`${API_URL}/students/dashboard`);
      expect(res.status(), await res.text()).toBe(200);
      return (await res.json()).progress.outline_approved;
    };
    const uploadFinalReport = () =>
      request.post(`${API_URL}/final-reports`, {
        multipart: {
          report: {
            name: 'report.pdf',
            mimeType: 'application/pdf',
            buffer: fs.readFileSync(path.join(__dirname, '../fixtures/mock_official_letter.pdf')),
          },
        },
      });

    await apiLoginAs(request, 'student2');
    expect(await outlineApproved()).toBe(true);
    // ใบที่อนุมัติแล้วนักศึกษาส่งทับเองไม่ได้ — ทางเดียวคืออาจารย์นิเทศส่งกลับ
    const overwrite = await request.post(`${API_URL}/outlines`, { multipart: { report_title: 'หัวข้อใหม่' } });
    expect(overwrite.status()).toBe(409);
    expect((await overwrite.json()).message).toContain('อาจารย์นิเทศ');

    await apiLoginAs(request, 'advisor1');
    expect((await reject(request)).status()).toBe(200);

    await apiLoginAs(request, 'student2');
    expect(await outlineApproved()).toBe(false);
    const report = await uploadFinalReport();
    expect(report.status(), await report.text()).toBe(400);
    expect((await report.json()).message).toContain('อาจารย์นิเทศ');
    expect(Number(await dbValue('SELECT COUNT(*) FROM final_reports WHERE student_id = $1', [studentId]))).toBe(0);

    const again = await request.post(`${API_URL}/outlines`, { multipart: { report_title: 'หัวข้อที่แก้ขอบเขตแล้ว' } });
    expect(again.status(), await again.text()).toBe(201);
    expect(await statusOf()).toBe('pending_mentor');
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

  /**
   * ขั้น 7 ข้อ ข3 (เจ้าของสั่ง 2026-10-09) — อาจารย์นิเทศเห็นชอบแทนเมื่อพี่เลี้ยงยังไม่ตรวจ
   *
   * ปิดทางตัน: พี่เลี้ยงเงียบหรือยังไม่มีพี่เลี้ยง → ใบค้าง `pending_mentor` → นักศึกษาอัปโหลดเล่มสมบูรณ์ไม่ได้
   * ⛔ ขั้นพี่เลี้ยงยังเป็นทางปกติ · ทางนี้ต้องมีเหตุผล และเฉพาะอาจารย์นิเทศของนักศึกษาคนนั้น
   * ⛔ ห้ามบันทึกว่าพี่เลี้ยงตรวจแล้ว — แถวฉบับได้สถานะ `approved_without_mentor`
   */
  const approve = (request: import('@playwright/test').APIRequestContext, comment?: string) =>
    request.put(`${API_URL}/outlines/${outlineId}/status`, { data: { status: 'approved', comment } });

  const BYPASS_REASON = 'พนักงานที่ปรึกษาลาพักร้อนสองสัปดาห์ ตรวจหัวข้อกับนักศึกษาทางโทรศัพท์แล้ว';

  test('O9: อาจารย์นิเทศเห็นชอบใบที่ยังรอพี่เลี้ยง — ไม่มีเหตุผล 400 · มีเหตุผล 200 · จดว่าเห็นชอบแทน ไม่ใช่พี่เลี้ยงตรวจ · ลง audit', async ({
    request,
  }) => {
    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);
    await apiLoginAs(request, 'advisor1');

    for (const comment of [undefined, '   ']) {
      const res = await approve(request, comment);
      expect(res.status(), await res.text()).toBe(400);
      expect((await res.json()).message).toContain('เหตุผล');
    }
    expect(await statusOf()).toBe('pending_mentor');

    const ok = await approve(request, BYPASS_REASON);
    expect(ok.status(), await ok.text()).toBe(200);
    expect(await statusOf()).toBe('approved');

    const advisor1 = await dbValue<number>("SELECT user_id FROM users WHERE email = 'advisor1@test.com'");
    expect(
      await dbRow(
        `SELECT status, rejection_comment, reviewed_by FROM report_outline_versions
          WHERE outline_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
        [outlineId]
      )
    ).toEqual({ status: 'approved_without_mentor', rejection_comment: BYPASS_REASON, reviewed_by: advisor1 });
    await expect
      .poll(() =>
        dbValue<string>(
          `SELECT detail::text FROM audit_log WHERE action = 'outline.approved_without_mentor' AND entity_id = $1`,
          [String(outlineId)]
        )
      )
      .toContain('ลาพักร้อน');
  });

  test('O10: เห็นชอบแทนได้เฉพาะอาจารย์นิเทศของนักศึกษา — ที่ปรึกษาที่ไม่ได้นิเทศ · เจ้าหน้าที่ · หัวหน้าสาขา · พี่เลี้ยง ถูกปฏิเสธ', async ({
    request,
  }) => {
    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);

    for (const who of ['advisor2', 'staff1', 'head1', 'mentor1'] as const) {
      await apiLoginAs(request, who);
      const res = await approve(request, BYPASS_REASON);
      expect(res.status(), `${who}: ${await res.text()}`).toBe(403);
    }
    expect(await statusOf()).toBe('pending_mentor');
    expect(
      Number(await dbValue(`SELECT COUNT(*) FROM audit_log WHERE action = 'outline.approved_without_mentor'`))
    ).toBe(0);
  });

  test('O11: หลังเห็นชอบแทน — นักศึกษาเห็นว่าเป็นการเห็นชอบแทน · อัปโหลดเล่มสมบูรณ์ได้ · พี่เลี้ยงส่งต่อใบเดิมไม่ได้และคิวพี่เลี้ยงไม่ค้าง', async ({
    request,
  }) => {
    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);

    const mentorQueue = async () => {
      const res = await request.get(`${API_URL}/mentor/pending`);
      expect(res.status(), await res.text()).toBe(200);
      return ((await res.json()).items as Array<{ kind: string; id: number }>).filter((i) => i.kind === 'report_outline');
    };
    // ก่อนกด: ใบอยู่ในคิวของพี่เลี้ยง
    await apiLoginAs(request, 'mentor1');
    expect((await mentorQueue()).map((i) => i.id)).toEqual([outlineId]);

    await apiLoginAs(request, 'advisor1');
    expect((await approve(request, BYPASS_REASON)).status()).toBe(200);

    await apiLoginAs(request, 'mentor1');
    expect(await mentorQueue()).toEqual([]);
    const late = await request.put(`${API_URL}/outlines/${outlineId}/status`, { data: { status: 'pending_advisor' } });
    expect(late.status(), await late.text()).toBe(400);
    expect(await statusOf()).toBe('approved');

    await apiLoginAs(request, 'student2');
    const mine = await request.get(`${API_URL}/outlines/student/${studentId}`);
    expect(mine.status(), await mine.text()).toBe(200);
    const data = (await mine.json()).data;
    expect(data.status).toBe('approved');
    expect(data.approved_without_mentor).toBe(true);
    expect(data.versions[0]).toMatchObject({ status: 'approved_without_mentor', rejection_comment: BYPASS_REASON });
    // ผู้ตรวจที่นักศึกษาเห็นคืออาจารย์ ไม่ใช่พี่เลี้ยง
    expect(data.versions[0].reviewer_first_name).toBeTruthy();
    expect(data.versions[0].reviewer_mentor_name).toBeNull();

    const report = await request.post(`${API_URL}/final-reports`, {
      multipart: {
        report: {
          name: 'report.pdf',
          mimeType: 'application/pdf',
          buffer: fs.readFileSync(path.join(__dirname, '../fixtures/mock_official_letter.pdf')),
        },
      },
    });
    expect(report.status(), await report.text()).toBe(201);
  });

  test('O12: ทางปกติยังอยู่ — พี่เลี้ยงเห็นชอบ → อาจารย์นิเทศเห็นชอบโดยไม่ต้องมีเหตุผล · ไม่ถูกจดว่าเห็นชอบแทน · ส่งกลับแล้วป้ายเห็นชอบแทนหาย', async ({
    request,
  }) => {
    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);
    const studentView = async () => {
      await apiLoginAs(request, 'student2');
      return (await (await request.get(`${API_URL}/outlines/student/${studentId}`)).json()).data;
    };

    await apiLoginAs(request, 'mentor1');
    const forwarded = await request.put(`${API_URL}/outlines/${outlineId}/status`, { data: { status: 'pending_advisor' } });
    expect(forwarded.status(), await forwarded.text()).toBe(200);

    await apiLoginAs(request, 'advisor1');
    expect((await approve(request)).status()).toBe(200);
    expect(await statusOf()).toBe('approved');
    const normal = await studentView();
    expect(normal.approved_without_mentor).toBe(false);
    expect(normal.versions[0].status).toBe('approved');

    // ใบที่เห็นชอบแทนแล้วถูกส่งกลับ: ป้ายผูกกับฉบับ จึงหายเองเมื่อฉบับนั้นถูกส่งกลับ
    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);
    await apiLoginAs(request, 'advisor1');
    expect((await approve(request, BYPASS_REASON)).status()).toBe(200);
    expect((await studentView()).approved_without_mentor).toBe(true);
    await apiLoginAs(request, 'advisor1');
    expect((await reject(request)).status()).toBe(200);
    const reopened = await studentView();
    expect(reopened.status).toBe('rejected');
    expect(reopened.approved_without_mentor).toBe(false);
  });

  test('O13: หน้าจอ — เมนูและกองโครงร่างอยู่ฝ่ายนิเทศ · อาจารย์ส่งใบที่อนุมัติแล้วกลับพร้อมเหตุผล · นักศึกษาเห็นเหตุผลในหน้าโครงร่าง', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    // advisor1 เป็นทั้งที่ปรึกษาและผู้นิเทศ เพื่อให้มีสองฝ่ายให้สลับ และพิสูจน์ว่าของโครงร่างไม่อยู่ฝ่ายที่ปรึกษา
    await dbValue(
      `UPDATE students SET advisor_id = supervisor_id WHERE student_id = $1 RETURNING student_id`,
      [studentId]
    );
    const REASON = 'หัวข้อซ้ำกับรายงานรุ่นก่อน ขอให้เปลี่ยนขอบเขตเป็นระบบคลังสินค้า';

    await loginAs(page, 'advisor1');
    // ฝ่ายที่ปรึกษา: ไม่มีเมนูเห็นชอบโครงร่าง ไม่มีกองโครงร่าง
    await expect(page.getByTestId('advisor-home-tile-report')).toBeVisible();
    await expect(page.getByTestId('nav-report_outlines')).toHaveCount(0);
    await expect(page.getByTestId('advisor-home-tile-outline')).toHaveCount(0);

    await page.getByTestId('role-btn-supervisor').click();
    await expect(page.getByTestId('advisor-home-tile-outline')).toHaveAttribute('data-count', '1');

    // อนุมัติก่อน แล้วส่งกลับ — ปุ่มส่งกลับมีเฉพาะใบที่อนุมัติแล้ว
    await goToMenu(page, 'report_outlines');
    await expect(page.getByTestId('outline-reopen')).toHaveCount(0);
    await page.getByTestId('outline-approve').click();
    await expect(page.getByText('เห็นชอบโครงร่างรายงานของ')).toBeVisible();

    // ใบที่อนุมัติแล้วย้ายไปแท็บ "อนุมัติแล้ว" — เปิดจากที่นั่น
    await page.getByTestId('outline-tab-approved').click();
    await page.getByTestId(`outline-row-${outlineId}`).click();
    await page.getByTestId('outline-reopen').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('นักศึกษาต้องส่งฉบับใหม่ และผ่านพนักงานที่ปรึกษาอีกครั้ง');
    // เหตุผลบังคับ — ยังไม่กรอกกดยืนยันไม่ได้
    await expect(dialog.getByTestId('outline-reopen-submit')).toBeDisabled();
    await dialog.getByTestId('outline-reopen-reason').fill(REASON);
    await dialog.getByTestId('outline-reopen-submit').click();
    await expect(page.getByText(/ส่งกลับโครงร่างรายงานของ .* ให้แก้ไขเรียบร้อยแล้ว/)).toBeVisible();
    expect(await statusOf()).toBe('rejected');
    // ใบย้ายไปแท็บตีกลับ และไม่มีปุ่มส่งกลับซ้ำ
    await expect(page.getByTestId('outline-reopen')).toHaveCount(0);

    await loginAs(page, 'student2');
    await goToMenu(page, 'report_outline');
    await expect(page.getByText('โครงร่างรายงานถูกส่งกลับมาแก้ไข:')).toBeVisible();
    // เหตุผลขึ้นทั้งในแถบส่งกลับและในประวัติฉบับ
    await expect(page.getByText(REASON).first()).toBeVisible();
  });

  test('O14: หน้าจอ — อาจารย์นิเทศกดเห็นชอบแทนในแท็บรอพี่เลี้ยง · นักศึกษาเห็นว่าเป็นการเห็นชอบแทนพร้อมเหตุผล ไม่ใช่พี่เลี้ยงเห็นชอบ', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await dbValue("UPDATE report_outlines SET status = 'pending_mentor' WHERE outline_id = $1", [outlineId]);
    await dbValue(`UPDATE students SET advisor_id = supervisor_id WHERE student_id = $1 RETURNING student_id`, [studentId]);

    await loginAs(page, 'advisor1');
    await page.getByTestId('role-btn-supervisor').click();
    // ใบที่ยังรอพี่เลี้ยงไม่ใช่งานที่รออาจารย์ — กองบนหน้าแรกเป็นศูนย์
    await expect(page.getByTestId('advisor-home-tile-outline')).toHaveAttribute('data-count', '0');

    await goToMenu(page, 'report_outlines');
    await page.getByTestId('outline-tab-pending_mentor').click();
    const row = page.getByTestId(`outline-row-${outlineId}`);
    // ฉบับล่าสุดส่งเมื่อ 4 วันก่อน (ตัวตั้งข้อมูล)
    await expect(row).toContainText('รอมาแล้ว 4 วัน');
    await row.click();
    // ใบที่ยังรอพี่เลี้ยงไม่มีปุ่มเห็นชอบปกติและไม่มีปุ่มตีกลับ — มีทางเดียวคือเห็นชอบแทนพร้อมเหตุผล
    await expect(page.getByTestId('outline-approve')).toHaveCount(0);
    await expect(page.getByTestId('outline-reject')).toHaveCount(0);

    await page.getByTestId('outline-approve-without-mentor').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('พนักงานที่ปรึกษายังไม่ได้ตรวจโครงร่างนี้');
    await expect(dialog.getByTestId('outline-approve-without-mentor-submit')).toBeDisabled();
    expect(await statusOf()).toBe('pending_mentor');
    await dialog.getByTestId('outline-approve-without-mentor-reason').fill(BYPASS_REASON);
    await dialog.getByTestId('outline-approve-without-mentor-submit').click();
    await expect(page.getByText(/เห็นชอบโครงร่างรายงานของ .* แทนพนักงานที่ปรึกษาเรียบร้อยแล้ว/)).toBeVisible();
    expect(await statusOf()).toBe('approved');
    // ประวัติฉบับบอกว่าเป็นการเห็นชอบแทน
    await expect(page.getByTestId('outline-review-panel')).toContainText('เห็นชอบแทนพนักงานที่ปรึกษา');

    await loginAs(page, 'student2');
    await goToMenu(page, 'report_outline');
    await expect(page.getByTestId('outline-approved-without-mentor-banner')).toContainText(
      'อาจารย์นิเทศเห็นชอบแทนพนักงานที่ปรึกษา'
    );
    await expect(page.getByTestId('outline-approved-without-mentor-banner')).toContainText(BYPASS_REASON);
    // ⛔ ขั้นพี่เลี้ยงต้องไม่ขึ้นว่าเห็นชอบแล้ว
    const mentorStep = page.getByTestId('outline-step-mentor');
    await expect(mentorStep).toContainText('อาจารย์นิเทศเห็นชอบแทน');
    await expect(mentorStep).not.toContainText('เห็นชอบแล้ว');
    // อนุมัติแล้ว ส่งฉบับใหม่ทับไม่ได้
    await expect(page.getByTestId('outline-submit')).toBeDisabled();
  });
});
