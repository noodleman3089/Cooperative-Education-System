import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { withDb, dbRow, dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';

/**
 * เอกสารหมายเลข 2 · ก้อน B — รับแบบตอบรับกลับ และ ๑๕ วันทำการ
 *
 * เส้นทางจริง: คณบดีลงนามหนังสือ → นักศึกษาถือหนังสือ+แบบตอบรับไปให้บริษัท →
 * บริษัทกรอกและลงนามบนกระดาษ → นักศึกษาอัปโหลดกลับ → **เจ้าหน้าที่อ่านกระดาษ
 * แล้วคีย์ว่าใครเซ็น ตำแหน่งอะไร วันไหน** → `accepted`
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **ลำดับ** — คณบดียังไม่ลงนาม = ยังส่งแบบตอบรับไม่ได้ (409)
 *   2. **ธงส่งช้าปั๊มตอนอัปโหลด** ไม่ใช่คำนวณย้อนหลัง — แก้วันครบกำหนดทีหลังแล้วธงต้องอยู่
 *   3. **ระบบต้องรู้ว่าในกระดาษเขียนว่าอะไร** ไม่ใช่แค่เก็บไฟล์ — ขาดสามช่องนั้นกดผ่านไม่ได้
 *   4. **วันที่ที่เป็นไปไม่ได้ต้องถูกปฏิเสธ** (อนาคต · ก่อนวันที่คณบดีลงนาม)
 */

const MENTOR = {
  name: 'สุรเดช ใจดี',
  email: 'suradech-b@seagate.com',
  phone: '0812223333',
  start_date: '2026-11-02',
};

const evidence = () => ({
  name: 'acceptance.pdf',
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
});

/**
 * ใบความจำนงที่พร้อมรับแบบตอบรับ
 * @param dueOffset จำนวนวันจากวันนี้ถึงวันครบกำหนด — ติดลบ = เลยกำหนดแล้ว
 *                  `null` = ยังไม่ตั้ง (จำลองว่าคณบดียังไม่ลงนาม)
 */
async function seedIntent(dueOffset: number | null): Promise<number> {
  return withDb(async (db) => {
    const studentId = (
      await db.query("SELECT user_id FROM users WHERE email = 'student2@test.com'")
    ).rows[0].user_id;
    const semesterId = (
      await db.query('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1')
    ).rows[0].semester_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      .company_id;

    const res = await db.query(
      `INSERT INTO intent_forms (student_id, company_id, semester_id, status, acceptance_due_date)
       VALUES ($1, $2, $3, 'signed',
               CASE WHEN $4::int IS NULL THEN NULL
                    ELSE (NOW() AT TIME ZONE 'Asia/Bangkok')::date + $4::int END)
       RETURNING form_id`,
      [studentId, companyId, semesterId, dueOffset]
    );
    return res.rows[0].form_id as number;
  });
}

/** วันนี้ตามเวลาไทยจาก Postgres — วันที่บนแบบตอบรับต้องไม่เป็นอนาคต */
const todayTh = async () =>
  (await dbValue<string>(`SELECT (NOW() AT TIME ZONE 'Asia/Bangkok')::date::text`)) as string;

/**
 * นักศึกษาส่งแบบตอบรับ — ⛔ ตั้งแต่ 2026-09-21 ผู้ลงนามบนกระดาษ (ชื่อ · ตำแหน่ง · วันที่)
 * นักศึกษากรอกตอนอัปโหลด ไม่ใช่เจ้าหน้าที่คีย์ตอนตรวจ · ส่ง `signer: null` = ไม่กรอก
 */
const uploadAcceptance = async (
  request: APIRequestContext,
  formId: number,
  signer: Record<string, string> | null = {}
) =>
  request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
    multipart: {
      evidence: evidence(),
      ...MENTOR,
      ...(signer === null
        ? {}
        : {
            signer_name: 'คุณสมชาย ผู้จัดการฝ่ายบุคคล',
            signer_position: 'ผู้จัดการฝ่ายบุคคล',
            signed_date: await todayTh(),
            ...signer,
          }),
    },
  });

test.describe('เอกสารหมายเลข 2 — รับกลับและกำหนด ๑๕ วันทำการ', () => {
  test.beforeEach(async () => {
    await seedTestData();
  });

  test('B1: คณบดียังไม่ลงนาม → ส่งแบบตอบรับไม่ได้ (409) และต้องไม่มีไฟล์ค้าง', async ({
    request,
  }) => {
    const formId = await seedIntent(null);

    await apiLoginAs(request, 'student2');
    const res = await uploadAcceptance(request, formId);
    expect(res.status(), await res.text()).toBe(409);
    expect((await res.json()).message as string).toContain('คณบดี');

    // สถานะต้องไม่ขยับ
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'signed'
    );
  });

  test('B2: ส่งกลับก่อนครบกำหนด → ไม่ติดธงส่งช้า', async ({ request }) => {
    const formId = await seedIntent(5);

    await apiLoginAs(request, 'student2');
    const res = await uploadAcceptance(request, formId);
    expect(res.status(), await res.text()).toBe(200);

    const row = await dbRow<{ status: string; acceptance_submitted_late: boolean }>(
      'SELECT status, acceptance_submitted_late FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row?.status).toBe('pending_officer_approval');
    expect(row?.acceptance_submitted_late).toBe(false);
  });

  test('B3: ส่งกลับหลังครบกำหนด → รับ แต่ติดธง และบอกผู้ใช้ว่าให้ยื่นบันทึกข้อความ', async ({
    request,
  }) => {
    const formId = await seedIntent(-3);

    await apiLoginAs(request, 'student2');
    const res = await uploadAcceptance(request, formId);
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).message as string).toContain('บันทึกข้อความ');

    expect(
      await dbValue<boolean>(
        'SELECT acceptance_submitted_late FROM intent_forms WHERE form_id = $1',
        [formId]
      )
    ).toBe(true);
  });

  test('B4: แก้วันครบกำหนดทีหลัง ธงส่งช้าต้องไม่หาย', async ({ request }) => {
    const formId = await seedIntent(-3);

    await apiLoginAs(request, 'student2');
    expect((await uploadAcceptance(request, formId)).status()).toBe(200);

    // เจ้าหน้าที่ขยายกำหนดออกไป — ถ้าธงถูกคำนวณสด ใบนี้จะกลายเป็นส่งตรงเวลา
    await dbExec(
      `UPDATE intent_forms
          SET acceptance_due_date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date + 30
        WHERE form_id = $1`,
      [formId]
    );

    expect(
      await dbValue<boolean>(
        'SELECT acceptance_submitted_late FROM intent_forms WHERE form_id = $1',
        [formId]
      )
    ).toBe(true);
  });

  test('B5: นักศึกษาส่งแบบตอบรับโดยไม่กรอกผู้ลงนาม → 400 และสถานะไม่ขยับ', async ({ request }) => {
    const formId = await seedIntent(5);
    await apiLoginAs(request, 'student2');
    const bare = await uploadAcceptance(request, formId, null);
    expect(bare.status()).toBe(400);
    expect((await bare.json()).message as string).toContain('ผู้ลงนาม');

    // กรอกไม่ครบก็ยังไม่ผ่าน
    const partial = await request.post(`${API_URL}/acceptances/student/${formId}/upload-proof`, {
      multipart: { evidence: evidence(), ...MENTOR, signer_name: 'คุณสมชาย' },
    });
    expect(partial.status()).toBe(400);

    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'signed'
    );
  });

  test('B6: วันที่บนกระดาษที่เป็นไปไม่ได้ → 400 (อนาคต)', async ({ request }) => {
    const formId = await seedIntent(5);
    await apiLoginAs(request, 'student2');
    const future = await uploadAcceptance(request, formId, { signed_date: '2099-01-01' });
    expect(future.status()).toBe(400);
    expect((await future.json()).message as string).toContain('อนาคต');
  });

  test('B7: ผู้ลงนามที่นักศึกษากรอกถูกเก็บ · เจ้าหน้าที่กดรับได้เลย และชื่อที่เจ้าหน้าที่ส่งมาถูกเมิน', async ({
    request,
  }) => {
    const formId = await seedIntent(5);
    await apiLoginAs(request, 'student2');
    expect((await uploadAcceptance(request, formId)).status()).toBe(200);
    const today = await todayTh();

    await apiLoginAs(request, 'staff1');
    const ok = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
      data: { action: 'accepted', signer_name: 'ชื่อจากเจ้าหน้าที่' },
    });
    expect(ok.status(), await ok.text()).toBe(200);

    const row = await dbRow<{
      status: string;
      acceptance_signer_name: string;
      acceptance_signer_position: string;
      acceptance_signed_date: string;
    }>(
      `SELECT status, acceptance_signer_name, acceptance_signer_position,
              acceptance_signed_date::text AS acceptance_signed_date
         FROM intent_forms WHERE form_id = $1`,
      [formId]
    );
    expect(row?.status).toBe('accepted');
    expect(row?.acceptance_signer_name).toBe('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
    expect(row?.acceptance_signer_position).toBe('ผู้จัดการฝ่ายบุคคล');
    expect(row?.acceptance_signed_date).toBe(today);
  });

  test('B8: หน้าจอเจ้าหน้าที่ — เห็นผู้ลงนามที่นักศึกษากรอก และกดรับได้โดยไม่ต้องคีย์', async ({
    page,
    request,
  }) => {
    const formId = await seedIntent(5);
    await apiLoginAs(request, 'student2');
    expect((await uploadAcceptance(request, formId)).status()).toBe(200);

    await loginAs(page, 'staff1');
    await expect(page.getByText(/แบบตอบรับจากสถานประกอบการรอตรวจ \(1 รายการ\)/)).toBeVisible();

    await page.getByTestId(`review-acceptance-${formId}`).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('open-acceptance-evidence')).toBeVisible();
    await expect(dialog.getByTestId('acceptance-signer')).toContainText('คุณสมชาย ผู้จัดการฝ่ายบุคคล');
    await expect(dialog.getByTestId('acceptance-signer-name')).toHaveCount(0);
    await dialog.getByTestId('acceptance-approve-submit').click();

    await expect(page.getByText(/รับแบบตอบรับเรียบร้อยแล้ว/)).toBeVisible();
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'accepted'
    );
  });

  test('B9: หน้าจอนักศึกษา — เห็นวันครบกำหนดตอบกลับ และเห็นคำเตือนเมื่อเลยกำหนด', async ({
    page,
  }) => {
    await seedIntent(5);
    await loginAs(page, 'student2');
    await expect(page.getByTestId('acceptance-due')).toContainText('ครบกำหนดตอบกลับโดยประมาณ');

    await dbExec(
      `UPDATE intent_forms
          SET acceptance_due_date = (NOW() AT TIME ZONE 'Asia/Bangkok')::date - 2`
    );
    await page.reload();
    await expect(page.getByTestId('acceptance-due')).toContainText('เลยกำหนดตอบกลับมาแล้ว');
    await expect(page.getByTestId('acceptance-due')).toContainText('บันทึกข้อความ');
  });

  // TC-G-07 · ⛔ เดิมเซิร์ฟเวอร์ไม่บังคับเหตุผล และตีกลับ = ปิดใบเป็น 'rejected' + คืนโควตา
  //    นักศึกษาส่งใหม่ไม่ได้ ทั้งที่อีเมลบอกให้อัปโหลดใหม่ (เจ้าของเลือกแบบ "ส่งใหม่ในใบเดิม" 2026-09-24)
  test('B10: ตีกลับต้องมีเหตุผล · ใบกลับไปรอแบบตอบรับ ไฟล์เดิมถูกล้าง · ส่งใหม่ได้และเหตุผลเก่าหายไป', async ({
    request,
  }) => {
    const formId = await seedIntent(5);
    await apiLoginAs(request, 'student2');
    expect((await uploadAcceptance(request, formId)).status()).toBe(200);
    const firstFile = (await dbValue<string>(
      'SELECT acceptance_evidence_path FROM intent_forms WHERE form_id = $1',
      [formId]
    ))!;

    await apiLoginAs(request, 'staff1');
    for (const reason of [undefined, '   ']) {
      const res = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
        data: { action: 'rejected', reason },
      });
      expect(res.status()).toBe(400);
    }
    expect(await dbValue<string>('SELECT status FROM intent_forms WHERE form_id = $1', [formId])).toBe(
      'pending_officer_approval'
    );

    const rejected = await request.put(`${API_URL}/acceptances/${formId}/officer-approve`, {
      data: { action: 'rejected', reason: 'ไม่มีลายเซ็นผู้มีอำนาจ' },
    });
    expect(rejected.status(), await rejected.text()).toBe(200);
    const row = await dbRow<{ status: string; reject_reason: string; acceptance_evidence_path: string | null }>(
      'SELECT status, reject_reason, acceptance_evidence_path FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(row?.status).toBe('approved_by_dept_head');
    expect(row?.reject_reason).toBe('ไม่มีลายเซ็นผู้มีอำนาจ');
    expect(row?.acceptance_evidence_path).toBeNull();
    const onDisk = () => fs.existsSync(path.resolve(__dirname, '../../backend/uploads', firstFile));
    await expect.poll(onDisk, { timeout: 5000 }).toBe(false);

    // ส่งใหม่ในใบเดิม — อีเมลพี่เลี้ยงเดิม (บัญชีที่สร้างไว้รอบแรก) ต้องใช้ซ้ำได้
    await apiLoginAs(request, 'student2');
    const again = await uploadAcceptance(request, formId);
    expect(again.status(), await again.text()).toBe(200);
    const after = await dbRow<{ status: string; reject_reason: string | null }>(
      'SELECT status, reject_reason FROM intent_forms WHERE form_id = $1',
      [formId]
    );
    expect(after?.status).toBe('pending_officer_approval');
    expect(after?.reject_reason).toBeNull();
  });

  test('B11: หน้าจอ — เจ้าหน้าที่ตีกลับพร้อมเหตุผล แล้วนักศึกษาเห็นเหตุผลบนการ์ดที่ฝึกงาน', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const formId = await seedIntent(5);
    await apiLoginAs(request, 'student2');
    expect((await uploadAcceptance(request, formId)).status()).toBe(200);

    await loginAs(page, 'staff1');
    await page.getByTestId(`review-acceptance-${formId}`).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'ตีกลับให้แก้ไข' }).click();
    await expect(dialog.getByTestId('acceptance-reject-submit')).toBeDisabled();
    await dialog.getByTestId('acceptance-reject-reason').fill('วันที่บนแบบตอบรับไม่ชัด');
    await dialog.getByTestId('acceptance-reject-submit').click();
    await expect(page.getByText('ตีกลับแบบตอบรับเรียบร้อยแล้ว')).toBeVisible();

    await loginAs(page, 'student2');
    await expect(page.getByText('เจ้าหน้าที่ตีกลับแบบตอบรับ')).toBeVisible();
    await expect(page.getByText(/วันที่บนแบบตอบรับไม่ชัด/)).toBeVisible();
  });
});
