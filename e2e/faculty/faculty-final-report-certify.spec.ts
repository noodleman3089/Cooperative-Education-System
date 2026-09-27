import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * SB-F6 · allow-list ของการตรวจรับเล่มรายงาน และการลงนามรับรอง สหกิจ 14 — spec-F ข้อ 15.2
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. ตรวจรับได้เฉพาะ **เล่มฉบับสมบูรณ์ (`reviewer_kind='advisor'`) ที่สถานะ `submitted`**
 *      — แถวร่างของพี่เลี้ยงและเล่มที่ตรวจไปแล้วต้องตอบ 409 และแถวต้องไม่ขยับ
 *   2. ส่งกลับต้องมีข้อเสนอแนะ (นักศึกษาต้องรู้ว่าแก้อะไร)
 *   3. สหกิจ 14 ลงนามได้ครั้งเดียว โดยอาจารย์ที่ปรึกษาของนักศึกษาคนนั้นเท่านั้น
 *   (สิทธิ์อ่าน/อนุมัติเชิงลบของเส้นเล่มรายงานมีอยู่แล้วใน final-report-and-evaluation FR1–FR5)
 */

async function student2(): Promise<number> {
  return (await dbValue<number>("SELECT user_id FROM users WHERE email = 'student2@test.com'"))!;
}

async function assignAdvisor1(studentId: number): Promise<void> {
  await dbValue(
    `UPDATE students SET advisor_id = (SELECT user_id FROM users WHERE email = 'advisor1@test.com')
      WHERE student_id = $1`,
    [studentId]
  );
}

async function seedReport(studentId: number, status: string, kind: 'advisor' | 'mentor'): Promise<number> {
  return (await dbValue<number>(
    `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
     VALUES ($1, 'final_reports/seeded.pdf', $2, 1, $3) RETURNING report_id`,
    [studentId, status, kind]
  ))!;
}

test.describe('SB-F6 · ตรวจรับเล่ม + สหกิจ 14', () => {
  let studentId: number;

  test.beforeEach(async () => {
    await seedTestData();
    studentId = await student2();
    await assignAdvisor1(studentId);
  });

  test('FC1: แถวร่างที่ส่งพี่เลี้ยง (reviewer_kind=mentor) อาจารย์ตรวจรับไม่ได้ (409)', async ({ request }) => {
    const reportId = await seedReport(studentId, 'submitted', 'mentor');
    await apiLoginAs(request, 'advisor1');
    const res = await request.patch(`${API_URL}/final-reports/${reportId}/status`, { data: { status: 'approved' } });
    expect(res.status(), await res.text()).toBe(409);
    expect(await dbValue('SELECT status FROM final_reports WHERE report_id = $1', [reportId])).toBe('submitted');
  });

  test('FC2: เล่มที่ตรวจรับไปแล้ว กดทับไม่ได้ (409) · สถานะไม่ขยับ', async ({ request }) => {
    const reportId = await seedReport(studentId, 'approved', 'advisor');
    await apiLoginAs(request, 'advisor1');
    const res = await request.patch(`${API_URL}/final-reports/${reportId}/status`, {
      data: { status: 'rejected', comment: 'ขอแก้อีกรอบ' },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toContain('ตรวจไปแล้ว');
    expect(await dbValue('SELECT status FROM final_reports WHERE report_id = $1', [reportId])).toBe('approved');
  });

  test('FC3: ส่งกลับโดยไม่มีข้อเสนอแนะ → 400 · ช่องว่างล้วนก็ไม่นับ', async ({ request }) => {
    const reportId = await seedReport(studentId, 'submitted', 'advisor');
    await apiLoginAs(request, 'advisor1');
    const url = `${API_URL}/final-reports/${reportId}/status`;
    expect((await request.patch(url, { data: { status: 'rejected' } })).status()).toBe(400);
    expect((await request.patch(url, { data: { status: 'rejected', comment: '   ' } })).status()).toBe(400);
    expect(await dbValue('SELECT status FROM final_reports WHERE report_id = $1', [reportId])).toBe('submitted');
    // ตรวจรับตามปกติยังทำได้
    expect((await request.patch(url, { data: { status: 'approved' } })).status()).toBe(200);
  });

  test('FC4: สหกิจ 14 — อาจารย์อื่น 403 · ที่ปรึกษาลงนามได้ครั้งเดียว · ครั้งที่สอง 409', async ({ request }) => {
    const reportId = await seedReport(studentId, 'approved', 'advisor');

    // นักศึกษายื่นขอผ่านเส้นทางจริง (ด่าน: ต้องมีเล่มที่ตรวจรับแล้ว)
    await apiLoginAs(request, 'student2');
    const asked = await request.post(`${API_URL}/report-confirmations`);
    expect(asked.status(), await asked.text()).toBe(201);
    const confirmationId = (await asked.json()).data.confirmation_id as number;
    expect(await dbValue('SELECT report_id FROM report_confirmations WHERE confirmation_id = $1', [confirmationId])).toBe(reportId);

    const url = `${API_URL}/report-confirmations/${confirmationId}/certify`;

    await apiLoginAs(request, 'advisor2');
    expect((await request.patch(url)).status()).toBe(403);

    await apiLoginAs(request, 'advisor1');
    const first = await request.patch(url);
    expect(first.status(), await first.text()).toBe(200);
    const row = await dbRow<{ status: string; certified_at: string | null }>(
      'SELECT status, certified_at FROM report_confirmations WHERE confirmation_id = $1',
      [confirmationId]
    );
    expect(row?.status).toBe('certified');
    const certifiedAt = row?.certified_at;

    const again = await request.patch(url);
    expect(again.status()).toBe(409);
    // ⛔ เวลาลงนามต้องไม่ถูกเขียนทับ — มันถูกพิมพ์ลงแบบฟอร์ม
    expect(
      String(await dbValue('SELECT certified_at FROM report_confirmations WHERE confirmation_id = $1', [confirmationId]))
    ).toBe(String(certifiedAt));
  });
});
