import { test, expect } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRow, dbValue, withDb } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';
import { PDFParse } from 'pdf-parse';

/**
 * ตัวอย่างเอกสารหมายเลข 1 ก่อนกดยื่น — `POST /api/intents/request-form/preview`
 *
 * สิ่งที่พังเงียบได้ และเป็นเหตุผลที่ชุดนี้มีอยู่:
 *   1. **ดูตัวอย่างแล้วต้องไม่มีอะไรถูกบันทึก** — ไม่มีใบคำร้อง ไม่มีแถวสถานประกอบการงอกขึ้น
 *      (เส้นนี้รับช่องบริษัทชุดเดียวกับ `POST /intents` จึงพลาดไปเรียกตัวสร้างได้ง่าย)
 *   2. **ใครเรียกได้** — นักศึกษาที่มีโปรไฟล์เท่านั้น และได้เอกสารของตัวเองเสมอ (ไม่รับรหัสนักศึกษาจากผู้เรียก)
 *   3. `company_id` ของแถวที่ยังไม่รับรอง (นักศึกษาคนอื่นกรอก ยังไม่มีใครตรวจ) ต้องเปิดอ่านไม่ได้
 */

const PREVIEW = `${API_URL}/intents/request-form/preview`;

const TYPED = {
  company_name_th: 'บริษัท ตัวอย่างพรีวิว จำกัด',
  company_address: '99 ถนนทดสอบ ตำบลทดสอบ',
  company_district: 'ศรีราชา',
  company_province: 'ชลบุรี',
  company_postal_code: '20110',
  company_phone: '038111222',
  contact_person: 'คุณสมหญิง ทดสอบ',
  contact_position: 'ผู้จัดการฝ่ายบุคคล',
};

async function pdfText(res: APIResponse): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(await res.body()) });
  try {
    const parsed = await parser.getText();
    return { text: parsed.text, pages: parsed.pages.length };
  } finally {
    await parser.destroy();
  }
}

const counts = () =>
  dbRow<{ intents: number; companies: number }>(
    `SELECT (SELECT COUNT(*)::int FROM intent_forms) AS intents,
            (SELECT COUNT(*)::int FROM companies) AS companies`
  );

test.describe('ตัวอย่างเอกสารหมายเลข 1 ก่อนยื่น', () => {
  test('V1: ช่องที่พิมพ์เอง → ได้ PDF ตัวจริง 2 หน้า มีข้อมูลนักศึกษา+บริษัท · ไม่มีแถวใหม่ในฐาน', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const before = await counts();

    await apiLoginAs(request, 'student2');
    const res = await request.post(PREVIEW, { data: TYPED });
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
    expect(res.headers()['cache-control']).toContain('no-store');

    const { text, pages } = await pdfText(res);
    expect(pages).toBe(2);
    const studentCode = await dbValue<string>(
      "SELECT student_code FROM students WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')"
    );
    expect(text).toContain(studentCode as string);
    expect(text).toContain(TYPED.company_name_th);
    expect(text).toContain(TYPED.contact_person);
    expect(text).toContain(TYPED.company_phone);
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');

    // ⛔ ดูตัวอย่างไม่ใช่การยื่น — จำนวนแถวต้องเท่าเดิมเป๊ะ
    expect(await counts()).toEqual(before);
  });

  test('V2: ยังกรอกไม่ครบก็ดูตัวอย่างได้ · เลือกจากทำเนียบใช้ข้อมูลของทำเนียบ · ไม่มีแถวใหม่', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const before = await counts();
    await apiLoginAs(request, 'student2');

    // ยังไม่ได้พิมพ์อะไรเลย — ต้องได้กระดาษที่มีแต่ส่วนของนักศึกษา ไม่ใช่ 400
    const empty = await request.post(PREVIEW, { data: {} });
    expect(empty.status(), await empty.text()).toBe(200);
    expect(empty.headers()['content-type']).toContain('application/pdf');

    const company = await dbRow<{ company_id: number; name_th: string }>(
      'SELECT company_id, name_th FROM companies WHERE is_verified = TRUE ORDER BY company_id LIMIT 1'
    );
    // ส่งชื่อที่พิมพ์เองพ่วงมาด้วย — ต้องถูกเมิน เพราะเลือกจากทำเนียบแล้วข้อมูลเป็นของทำเนียบ
    const fromDirectory = await request.post(PREVIEW, {
      data: { company_id: company!.company_id, company_name_th: 'ชื่อที่ต้องถูกเมิน' },
    });
    expect(fromDirectory.status(), await fromDirectory.text()).toBe(200);
    const { text } = await pdfText(fromDirectory);
    expect(text).toContain(company!.name_th);
    expect(text).not.toContain('ชื่อที่ต้องถูกเมิน');

    expect(await counts()).toEqual(before);
  });

  test('V3: บทบาทอื่น 403 · ไม่ล็อกอิน 401 · นักศึกษาที่ยังไม่มีโปรไฟล์ 404', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();

    expect((await request.post(PREVIEW, { data: TYPED })).status()).toBe(401);

    for (const role of ['staff1', 'advisor1'] as const) {
      await apiLoginAs(request, role);
      expect((await request.post(PREVIEW, { data: TYPED })).status(), role).toBe(403);
    }

    // student1 ใน baseline ยังไม่ได้ตั้งโปรไฟล์
    await apiLoginAs(request, 'student1');
    expect(
      await dbValue<number>(
        "SELECT COUNT(*)::int FROM students WHERE student_id = (SELECT user_id FROM users WHERE email = 'student1@test.com')"
      )
    ).toBe(0);
    const res = await request.post(PREVIEW, { data: TYPED });
    expect(res.status()).toBe(404);
    expect((await res.json()).message).toContain('โปรไฟล์');
  });

  test('V4: company_id ของแถวที่ยังไม่รับรอง หรือไม่มีอยู่ → 404 (ไม่เปิดข้อมูลที่ยังไม่มีใครตรวจ)', async ({ request }) => {
    test.setTimeout(120_000);
    await seedTestData();
    const unverified = await withDb(async (db) =>
      (
        await db.query(
          `INSERT INTO companies (name_th, address, province, district, postal_code, phone,
                                  created_by, is_verified, contact_person)
           VALUES ('บริษัท ยังไม่รับรอง จำกัด', '5 ซอยลับ', 'ระยอง', 'เมือง', '21000', '038000000',
                   (SELECT user_id FROM users WHERE email = 'staff1@test.com'), FALSE, 'ผู้ติดต่อลับ')
           RETURNING company_id`
        )
      ).rows[0].company_id as number
    );

    await apiLoginAs(request, 'student2');
    for (const id of [unverified, 999999, 'abc']) {
      const res = await request.post(PREVIEW, { data: { company_id: id } });
      expect(res.status(), String(id)).toBe(404);
      expect(res.headers()['content-type']).toContain('application/json');
    }
  });
});
