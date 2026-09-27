import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbRows } from '../helpers/db';
import { apiLoginAs } from '../helpers/auth';

/**
 * แม่แบบเอกสาร HTML ถูกโละทั้งชุดเมื่อ 2026-08-26
 *
 * ไฟล์นี้แทน `phase2-templates.spec.ts` เดิม (เทสต์เครื่องพ่น PDF จากแม่แบบ) ซึ่ง
 * ทดสอบสิ่งที่ไม่มีอยู่แล้ว หน้าที่ของชุดนี้กลับด้าน: **กันไม่ให้ของที่โละไปกลับมา
 * แบบครึ่งๆ กลางๆ** เพราะรูปแบบความพังที่เป็นไปได้จริงคือ seed กลับเข้ามาโดยไม่มี
 * ไฟล์ หรือ route กลับมาโดยไม่มีตัว render — ทั้งสองแบบพังตอนผู้ใช้กด ไม่ใช่ตอน build
 *
 * ⛔ เมื่อสร้างวิธีออกเอกสารแบบใหม่ ให้ลบไฟล์นี้ทิ้งแล้วเขียนชุดของวิธีใหม่แทน
 * และอย่าลืมเอาสองด่านของ SEC-04 กลับมา: ใบความจำนงต้องผ่านหัวหน้าสาขา **และ**
 * `companies.is_verified = TRUE` ก่อนออกเอกสารได้
 */

test.describe('แม่แบบเอกสาร HTML ที่ถูกโละแล้ว', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await seedTestData();
  });

  test('1. db:setup ไม่ seed แม่แบบ และแถวที่มีต้องชี้ไปไฟล์ที่มีอยู่จริง', async () => {
    const rows = await dbRows<{ type: string; file_path: string }>(
      'SELECT type, file_path FROM document_templates ORDER BY template_id ASC'
    );

    // ปกติต้องว่าง — แต่ถ้ามีแถวค้างจากเอกสารเก่า ทุกแถวต้องชี้ไปไฟล์ที่เปิดได้จริง
    for (const row of rows) {
      expect(
        fs.existsSync(path.resolve(__dirname, '../../backend', row.file_path)),
        `แม่แบบ ${row.type} ชี้ไปที่ ${row.file_path} ซึ่งไม่มีไฟล์อยู่`
      ).toBe(true);
    }
  });

  test('2. โฟลเดอร์แม่แบบต้องไม่มีไฟล์ HTML เหลืออยู่', async () => {
    const dir = path.resolve(__dirname, '../../backend/secure_private/templates');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(files.filter((f) => f.endsWith('.html'))).toEqual([]);
  });

  test('3. endpoint ที่ถูกถอดต้องไม่กลับมา — เจ้าหน้าที่ยิงแล้วต้องได้ 404', async ({
    request,
  }) => {
    await apiLoginAs(request, 'staff1');

    // ล็อกอินแล้วจริงๆ จึงแยก "ไม่มี route" (404) ออกจาก "ไม่ได้ล็อกอิน" (401) ได้
    for (const [method, url] of [
      ['POST', `${API_URL}/documents/generate`],
      ['POST', `${API_URL}/documents/generate-dispatch`],
      ['GET', `${API_URL}/documents/dispatch-eligible`],
      ['GET', `${API_URL}/documents/templates`],
      ['GET', `${API_URL.replace('/api', '')}/api/files/download/travel-request-template`],
    ] as const) {
      const res =
        method === 'POST'
          ? await request.post(url, { data: {} })
          : await request.get(url);
      expect(res.status(), `${method} ${url} ยังตอบอยู่`).toBe(404);
    }
  });

  test('4. การอ่านและลงนามเอกสารที่ออกไปแล้วยังทำงาน', async ({ request }) => {
    await apiLoginAs(request, 'staff1');
    const list = await request.get(`${API_URL}/documents`);
    expect(list.status(), await list.text()).toBe(200);
    expect(Array.isArray(await list.json())).toBe(true);
  });
});
