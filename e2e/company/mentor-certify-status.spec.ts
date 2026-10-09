import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { apiLoginAs } from '../helpers/auth';
import { API_URL } from '../helpers/env';
import { seedTestData } from '../helpers/test-seeder';
import { dbRow, dbValue, mentor1Id, withDb } from '../helpers/db';

/**
 * ขั้น 7 ข้อ ค — รับรองและส่งกลับบันทึกสัปดาห์ (สหกิจ 09) · เดือน (สหกิจ 10) ได้เฉพาะใบที่ส่งแล้ว
 *
 * เดิม `PATCH …/certify` และ `…/return` ไม่ดูสถานะของใบ — หน้าจอไม่แสดงปุ่มบนใบร่างอยู่แล้ว
 * แต่ยิง API ตรงแล้วรับรองใบร่างได้ (บันทึกรายวันตรวจสถานะอยู่ก่อนแล้ว)
 *
 * ⛔ ส่งกลับใบที่รับรองแล้วต้องยังทำได้ — ใบที่รับรองแล้วสถานะยังเป็น `submitted`
 *    และเป็นทางแก้เดียวของพี่เลี้ยงที่กดรับรองผิด
 */

type Kind = 'weekly' | 'monthly';

const TABLE = { weekly: 'weekly_logs', monthly: 'monthly_logs' } as const;
const ID_COLUMN = { weekly: 'weekly_log_id', monthly: 'monthly_log_id' } as const;
const PATH = { weekly: 'weekly-logs', monthly: 'monthly-logs' } as const;
const LABEL = { weekly: 'บันทึกสัปดาห์ (สหกิจ 09)', monthly: 'บันทึกเดือน (สหกิจ 10)' } as const;

let studentId: number;

async function seedMentoredStudent(): Promise<void> {
  const mentorId = await mentor1Id();
  await withDb(async (db) => {
    studentId = (await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")).rows[0].user_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0].company_id;
    const semesterId = (await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')).rows[0]
      .semester_id;
    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
       VALUES ($1, $2, $3, 'accepted', $4, '2026-11-02')`,
      [studentId, companyId, semesterId, mentorId]
    );
  });
}

async function insertLog(kind: Kind, status: 'draft' | 'submitted' | 'returned'): Promise<number> {
  const sql =
    kind === 'weekly'
      ? `INSERT INTO weekly_logs (student_id, week_number, achievements, status)
         VALUES ($1, 1, 'ทดสอบระบบเบิกจ่าย', $2) RETURNING weekly_log_id`
      : `INSERT INTO monthly_logs (student_id, year, month, work_summary, effectiveness, status)
         VALUES ($1, 2026, 11, 'สรุปงานเดือนแรก', 'ทำได้ตามแผน', $2) RETURNING monthly_log_id`;
  return (await dbValue<number>(sql, [studentId, status]))!;
}

const logState = (kind: Kind, id: number) =>
  dbRow<{ status: string; certified: boolean; returned_comment: string | null }>(
    `SELECT status, mentor_certified_at IS NOT NULL AS certified, returned_comment
       FROM ${TABLE[kind]} WHERE ${ID_COLUMN[kind]} = $1`,
    [id]
  );

const certify = (request: APIRequestContext, kind: Kind, id: number) =>
  request.patch(`${API_URL}/${PATH[kind]}/${id}/certify`);

const sendBack = (request: APIRequestContext, kind: Kind, id: number) =>
  request.patch(`${API_URL}/${PATH[kind]}/${id}/return`, { data: { returned_comment: 'กรุณาเพิ่มรายละเอียดงาน' } });

test.describe('ขั้น 7 ค · รับรอง/ส่งกลับบันทึกงานเฉพาะใบที่ส่งแล้ว', () => {
  test.beforeEach(async () => {
    await seedTestData();
    await seedMentoredStudent();
  });

  for (const kind of ['weekly', 'monthly'] as const) {
    test(`${LABEL[kind]}: ใบร่าง — รับรอง 409 · ส่งกลับ 409 · ใบไม่ถูกแตะ`, async ({ request }) => {
      const id = await insertLog(kind, 'draft');
      await apiLoginAs(request, 'mentor1');

      const certified = await certify(request, kind, id);
      expect(certified.status(), await certified.text()).toBe(409);
      expect((await certified.json()).message).toContain('ยังไม่ได้ส่ง');

      expect((await sendBack(request, kind, id)).status()).toBe(409);
      expect(await logState(kind, id)).toEqual({ status: 'draft', certified: false, returned_comment: null });
    });

    test(`${LABEL[kind]}: ใบที่ส่งกลับแล้ว — รับรอง 409 · ส่งกลับซ้ำ 409`, async ({ request }) => {
      const id = await insertLog(kind, 'submitted');
      await apiLoginAs(request, 'mentor1');

      expect((await sendBack(request, kind, id)).status()).toBe(200);
      expect((await logState(kind, id))!.status).toBe('returned');

      expect((await certify(request, kind, id)).status()).toBe(409);
      expect((await sendBack(request, kind, id)).status()).toBe(409);
      expect(await logState(kind, id)).toEqual({
        status: 'returned',
        certified: false,
        returned_comment: 'กรุณาเพิ่มรายละเอียดงาน',
      });
    });

    test(`${LABEL[kind]}: ใบที่รับรองแล้ว — ส่งกลับได้ และการรับรองถูกล้าง`, async ({ request }) => {
      const id = await insertLog(kind, 'submitted');
      await apiLoginAs(request, 'mentor1');

      expect((await certify(request, kind, id)).status()).toBe(200);
      // รับรองแล้วสถานะยังเป็น submitted — ด่านใหม่ต้องไม่ปิดทางแก้เมื่อกดรับรองผิด
      expect(await logState(kind, id)).toEqual({ status: 'submitted', certified: true, returned_comment: null });

      const returned = await sendBack(request, kind, id);
      expect(returned.status(), await returned.text()).toBe(200);
      expect(await logState(kind, id)).toEqual({
        status: 'returned',
        certified: false,
        returned_comment: 'กรุณาเพิ่มรายละเอียดงาน',
      });
    });
  }
});
