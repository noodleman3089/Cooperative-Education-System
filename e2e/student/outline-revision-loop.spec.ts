import { test, expect } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbValue, withDb } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu, logout } from '../helpers/nav';

/**
 * วงจรแก้ไขโครงร่างรายงาน (สหกิจ 11) — Error Recovery (R2)
 *
 * ทดสอบการแก้ไขข้อผิดพลาดในขั้นตอนการส่งโครงร่างรายงาน:
 *   1. พี่เลี้ยงส่งกลับโครงร่างรายงานพร้อมระบุเหตุผล → นักศึกษาเห็นข้อคิดเห็นและแก้ไขส่งใหม่ได้
 *   2. อาจารย์นิเทศส่งกลับโครงร่างรายงาน → นักศึกษาเห็นเหตุผลและส่งฉบับแก้ไขใหม่ได้
 *   3. การตีกลับโดยไม่ระบุเหตุผลถูกปฏิเสธ (400 validation guardrail)
 */

async function seedAcceptedPlacement(): Promise<{ studentId: number; mentorId: number; companyId: number }> {
  return withDb(async (db) => {
    const studentId = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id as number;
    const companyId = (
      await db.query('SELECT company_id FROM companies LIMIT 1')
    ).rows[0].company_id as number;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id as number;
    const mentorId = (
      await db.query("SELECT user_id FROM users WHERE email = 'mentor1@test.com'")
    ).rows[0].user_id as number;

    await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date)
       VALUES ($1, $2, $3, 'accepted', $4, (NOW() AT TIME ZONE 'Asia/Bangkok')::date)`,
      [studentId, companyId, semesterId, mentorId]
    );

    return { studentId, mentorId, companyId };
  });
}

test.describe('การแก้ไขข้อผิดพลาดโครงร่างรายงาน สหกิจ 11 (Outline Revision Loop - R2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
  });

  test('OR1: พี่เลี้ยงตีกลับโครงร่าง → นักศึกษาเห็นเหตุผล แก้ไขเนื้อหา และส่งฉบับใหม่ได้', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { studentId } = await seedAcceptedPlacement();

    // ── 1. นักศึกษาส่งโครงร่างรายงานฉบับแรก ──
    await loginAs(page, 'student2');
    await goToMenu(page, 'report_outline');
    await expect(page.getByRole('heading', { name: 'โครงร่างรายงาน (สหกิจ 11)' })).toBeVisible();

    await page.getByTestId('outline-title').fill('การพัฒนาระบบคลังสินค้าอัจฉริยะ');
    await page.getByTestId('outline-text').fill('บทที่ 1 บทนำ\nบทที่ 2 ทฤษฎี\nบทที่ 3 การทำงาน');
    await page.getByTestId('outline-file-input').setInputFiles({
      name: 'outline-v1.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 Mock PDF Content Version 1'),
    });
    await page.getByTestId('outline-submit').click();
    await expect(page.getByTestId('confirm-summary')).toContainText('outline-v1.pdf');
    await page.getByTestId('outline-confirm').click();

    // ยืนยันว่าเวอร์ชันแรกถูกส่งและขึ้นสถานะรอตรวจ
    await expect(page.getByRole('heading', { name: 'ประวัติการส่งและผลตรวจ (1 เวอร์ชัน)' })).toBeVisible();
    await logout(page);

    const outlineId = (await dbValue<number>(
      'SELECT outline_id FROM report_outlines WHERE student_id = $1',
      [studentId]
    ))!;

    // ── 2. พี่เลี้ยงตีกลับพร้อมระบุข้อคิดเห็น/เหตุผล ──
    await apiLoginAs(request, 'mentor1');
    const rejectRes = await request.put(`${API_URL}/outlines/${outlineId}/status`, {
      data: {
        status: 'rejected',
        comment: 'ขอบเขตเนื้อหากว้างเกินไป กรุณาระบุโมดูลที่รับผิดชอบให้ชัดเจน',
      },
    });
    expect(rejectRes.status(), await rejectRes.text()).toBe(200);

    const statusAfterReject = await dbValue<string>(
      'SELECT status FROM report_outlines WHERE outline_id = $1',
      [outlineId]
    );
    expect(statusAfterReject).toBe('rejected');

    // ── 3. นักศึกษาเข้าดู พบข้อความตีกลับ และส่งเวอร์ชันแก้ไขใหม่ ──
    await loginAs(page, 'student2');
    await goToMenu(page, 'report_outline');

    // ต้องเห็นแถบแจ้งเตือนการส่งกลับพร้อมเหตุผลจากพี่เลี้ยง
    await expect(page.getByText('โครงร่างรายงานถูกส่งกลับมาแก้ไข:')).toBeVisible();
    await expect(
      page.getByText('ขอบเขตเนื้อหากว้างเกินไป กรุณาระบุโมดูลที่รับผิดชอบให้ชัดเจน').first()
    ).toBeVisible();

    // แก้ไขข้อมูลเป็นเวอร์ชันที่ชัดเจนขึ้น
    await page
      .getByTestId('outline-title')
      .fill('การพัฒนาระบบคลังสินค้าอัจฉริยะ: โมดูลสแกนบาร์โค้ดรับสินค้าเข้าคลัง');
    await page
      .getByTestId('outline-text')
      .fill(
        'บทที่ 1 บทนำและวัตถุประสงค์ของการลดเวลาสแกน\nบทที่ 2 สถาปัตยกรรมระบบ\nบทที่ 3 การพัฒนาโมดูลสแกนบาร์โค้ด\nบทที่ 4 ผลการทดสอบ'
      );
    await page.getByTestId('outline-file-input').setInputFiles({
      name: 'outline-v2.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 Mock PDF Content Version 2 Revised'),
    });
    await page.getByTestId('outline-submit').click();
    await expect(page.getByTestId('confirm-summary')).toContainText('outline-v2.pdf');
    await page.getByTestId('outline-confirm').click();

    // ยืนยันว่าประวัติแสดง 2 เวอร์ชัน และสถานะกลับมาเป็นรอตรวจ
    await expect(page.getByRole('heading', { name: 'ประวัติการส่งและผลตรวจ (2 เวอร์ชัน)' })).toBeVisible();

    const currentStatus = await dbValue<string>(
      'SELECT status FROM report_outlines WHERE outline_id = $1',
      [outlineId]
    );
    expect(currentStatus).toBe('pending_mentor');

    await logout(page);

    // ── 4. พี่เลี้ยงพิจารณาฉบับแก้ไขแล้วให้ความเห็นชอบ ──
    await apiLoginAs(request, 'mentor1');
    const approveRes = await request.put(`${API_URL}/outlines/${outlineId}/status`, {
      data: {
        status: 'pending_advisor',
        comment: 'แก้ไขขอบเขตได้ดีและชัดเจนแล้ว เห็นชอบให้ส่งต่ออาจารย์นิเทศ',
      },
    });
    expect(approveRes.status(), await approveRes.text()).toBe(200);

    const finalStatus = await dbValue<string>(
      'SELECT status FROM report_outlines WHERE outline_id = $1',
      [outlineId]
    );
    expect(finalStatus).toBe('pending_advisor');
  });

  test('OR2: อาจารย์นิเทศส่งกลับโครงร่างรายงาน → นักศึกษาเห็นความเห็นของอาจารย์และส่งใหม่ได้', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { studentId, companyId } = await seedAcceptedPlacement();

    // นำโครงร่างเข้าสู่สถานะ pending_advisor โดยตรง
    const outlineId = (await dbValue<number>(
      `INSERT INTO report_outlines (student_id, company_id, status)
       VALUES ($1, $2, 'pending_advisor')
       RETURNING outline_id`,
      [studentId, companyId]
    ))!;

    await withDb(async (db) => {
      await db.query(
        `INSERT INTO report_outline_versions (outline_id, report_title, outline_text, file_path, status)
         VALUES ($1, 'ระบบติดตามสถานะการขนส่ง', 'บทที่ 1 ที่มา\nบทที่ 2 รายละเอียด', 'report_outlines/test-outline.pdf', 'submitted')`,
        [outlineId]
      );
    });

    // อาจารย์นิเทศเข้าสู่ระบบและตีกลับโครงร่างพร้อมความเห็น
    await apiLoginAs(request, 'advisor1');
    const rejectRes = await request.put(`${API_URL}/outlines/${outlineId}/status`, {
      data: {
        status: 'rejected',
        comment: 'กรุณาปรับรูปแบบการเขียนวัตถุประสงค์ให้สอดคล้องกับระเบียบวิธีวิจัย',
      },
    });
    expect(rejectRes.status(), await rejectRes.text()).toBe(200);

    // นักศึกษาเข้าดูพบข้อคิดเห็นของอาจารย์นิเทศ
    await loginAs(page, 'student2');
    await goToMenu(page, 'report_outline');

    await expect(page.getByText('โครงร่างรายงานถูกส่งกลับมาแก้ไข:')).toBeVisible();
    await expect(
      page.getByText('กรุณาปรับรูปแบบการเขียนวัตถุประสงค์ให้สอดคล้องกับระเบียบวิธีวิจัย').first()
    ).toBeVisible();

    await logout(page);
  });

  test('OR3: การตีกลับโดยไม่ระบุเหตุผล → ระบบปฏิเสธ (400 validation error)', async ({
    request,
  }) => {
    const { studentId, companyId } = await seedAcceptedPlacement();

    const outlineId = (await dbValue<number>(
      `INSERT INTO report_outlines (student_id, company_id, status)
       VALUES ($1, $2, 'pending_mentor')
       RETURNING outline_id`,
      [studentId, companyId]
    ))!;

    await withDb(async (db) => {
      await db.query(
        `INSERT INTO report_outline_versions (outline_id, report_title, outline_text, file_path, status)
         VALUES ($1, 'ระบบทดสอบ', 'เนื้อหาทดสอบ', 'report_outlines/test.pdf', 'submitted')`,
        [outlineId]
      );
    });

    await apiLoginAs(request, 'mentor1');

    // ตีกลับโดยไม่มี comment หรือ comment เป็นสตริงว่าง
    const emptyCommentRes = await request.put(`${API_URL}/outlines/${outlineId}/status`, {
      data: {
        status: 'rejected',
        comment: '   ',
      },
    });
    expect(emptyCommentRes.status(), 'ตีกลับโดยไม่มีเหตุผลต้องได้ 400').toBe(400);

    // ตรวจสอบสถานะในฐานข้อมูลต้องยังคงเป็น pending_mentor ตามเดิม
    const statusInDb = await dbValue<string>(
      'SELECT status FROM report_outlines WHERE outline_id = $1',
      [outlineId]
    );
    expect(statusInDb).toBe('pending_mentor');
  });
});
