import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbValue, dbExec } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * เรซูเม่นักศึกษา (หน้า "ข้อมูลส่วนตัวและเรซูเม่") — TC-B-04 · TC-B-05
 *
 * เรซูเม่คือไฟล์ที่บริษัทเปิดดูตอนพิจารณาผู้สมัคร (SEC-10 ให้เห็น) แต่ก่อนหน้านี้
 * ไม่มีเทสต์ไหนอัปโหลดมันจริงเลย — มีแค่เทสต์ที่ตรวจว่าบริษัทเห็นลิงก์
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **อัปโหลดแล้วลงฐานและอยู่บนดิสก์จริง** เปิดกลับได้
 *   2. **ด่านไฟล์** — นามสกุล · เนื้อไฟล์ (magic bytes) · ขนาด 5MB · ต้องได้ 4xx ไม่ใช่ 500
 *      และไฟล์ที่ถูกปฏิเสธต้องไม่ทับเรซูเม่เดิม
 *   3. **เปลี่ยนไฟล์แล้วไฟล์เก่าต้องไม่ค้างบนดิสก์**
 *   4. **สิทธิ์** — เพื่อนและบริษัทที่ไม่ได้ถูกสมัครเปิดไม่ได้ · อาจารย์เปิดได้
 *
 * ⛔ หน้าจอรับแค่ PDF แต่เซิร์ฟเวอร์รับ .doc/.docx ด้วย — ชุดนี้ตรวจเซิร์ฟเวอร์ด้วย PDF
 *    อย่างเดียว ไม่ได้ตั้งใจล็อกว่า Word ต้องใช้ได้
 */

const realPdf = () => ({
  name: 'my-resume.pdf',
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
});

const uploadResume = (
  request: APIRequestContext,
  file: { name: string; mimeType: string; buffer: Buffer }
) => request.put(`${API_URL}/profile/student`, { multipart: { resume: file } });

const storedResume = () =>
  dbValue<string | null>(
    "SELECT resume_file FROM students WHERE student_id = (SELECT user_id FROM users WHERE email = 'student2@test.com')"
  );

const onDisk = (relativePath: string) =>
  fs.existsSync(path.resolve(__dirname, '../../backend/uploads', relativePath));

test.describe('เรซูเม่นักศึกษา', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('UPDATE students SET resume_file = NULL');
  });

  test('R1: อัปโหลด PDF จริง → ลงฐาน · มีไฟล์บนดิสก์ · เจ้าของเปิดอ่านได้', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await uploadResume(request, realPdf());
    expect(res.status(), await res.text()).toBe(200);

    const saved = await storedResume();
    expect(saved).toMatch(/^resumes\/resume-user-\d+-.+\.pdf$/);
    expect(onDisk(saved!)).toBe(true);

    const file = await request.get(`${API_URL}/files/${saved}`);
    expect(file.status()).toBe(200);
    expect((await file.body()).subarray(0, 4).toString()).toBe('%PDF');
  });

  test('R2: นามสกุลที่ไม่รับ → 400 (ไม่ใช่ 500) และเรซูเม่เดิมต้องไม่หาย', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    await uploadResume(request, realPdf());
    const before = await storedResume();

    const res = await uploadResume(request, {
      name: 'resume.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('ประวัติย่อ'),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message as string).toContain('Invalid file type');
    expect(await storedResume()).toBe(before);
    expect(onDisk(before!)).toBe(true);
  });

  test('R3: นามสกุล .pdf แต่ข้างในไม่ใช่ PDF → 400 และเรซูเม่เดิมต้องไม่หาย', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    await uploadResume(request, realPdf());
    const before = await storedResume();

    const res = await uploadResume(request, {
      name: 'fake.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('<?php echo "not a pdf"; ?>'),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message as string).toContain('magic bytes');
    expect(await storedResume()).toBe(before);
    expect(onDisk(before!)).toBe(true);
  });

  test('R4: ไฟล์เกิน 5MB → 413 พร้อมข้อความไทย และเรซูเม่เดิมต้องไม่หาย', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    await uploadResume(request, realPdf());
    const before = await storedResume();

    // หัวไฟล์เป็น PDF จริง — ให้ตกที่ด่านขนาด ไม่ใช่ด่านเนื้อไฟล์
    const big = Buffer.alloc(6 * 1024 * 1024, 0x20);
    big.write('%PDF-1.4\n');
    const res = await uploadResume(request, { name: 'big.pdf', mimeType: 'application/pdf', buffer: big });
    expect(res.status()).toBe(413);
    expect((await res.json()).message).toBe('ไฟล์มีขนาดใหญ่เกินกำหนด');
    expect(await storedResume()).toBe(before);
  });

  test('R5: อัปโหลดใหม่ทับ → ไฟล์เก่าต้องไม่ค้างบนดิสก์', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    await uploadResume(request, realPdf());
    const first = (await storedResume())!;
    expect(onDisk(first)).toBe(true);

    await uploadResume(request, realPdf());
    const second = (await storedResume())!;
    expect(second).not.toBe(first);
    expect(onDisk(second)).toBe(true);
    expect(onDisk(first)).toBe(false);
  });

  test('R6: สิทธิ์ — เพื่อนเปิดไม่ได้ · บริษัทที่ไม่ได้ถูกสมัครเปิดไม่ได้ · อาจารย์เปิดได้', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    await uploadResume(request, realPdf());
    const saved = (await storedResume())!;

    await apiLoginAs(request, 'student1');
    expect((await request.get(`${API_URL}/files/${saved}`)).status()).toBe(403);

    // company1 ยังไม่มีใบความจำนงของ student2 ในฐานที่ seed ใหม่
    await apiLoginAs(request, 'company1');
    expect((await request.get(`${API_URL}/files/${saved}`)).status()).toBe(403);

    await apiLoginAs(request, 'advisor1');
    expect((await request.get(`${API_URL}/files/${saved}`)).status()).toBe(200);
  });

  test('R7: หน้าจอ — เลือก PDF บันทึก แล้วไฟล์ยังอยู่หลังโหลดใหม่ และปุ่มดาวน์โหลดได้ไฟล์จริง', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'student2');
    await goToMenu(page, 'profile');
    await expect(page.getByText('ยังไม่ได้อัปโหลดเรซูเม่')).toBeVisible();

    await page
      .getByTestId('profile-resume-input')
      .setInputFiles(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf'));
    await page.getByTestId('profile-save').click();
    await expect(page.getByText('บันทึกข้อมูลส่วนตัวและเรซูเม่เรียบร้อยแล้ว')).toBeVisible();

    await page.reload();
    await goToMenu(page, 'profile');
    await expect(page.getByText('ไฟล์เรซูเม่ออนไลน์ปัจจุบัน (PDF)')).toBeVisible();

    const saved = (await storedResume())!;
    const download = page.getByRole('link', { name: 'ดาวน์โหลด' });
    const href = (await download.getAttribute('href'))!;
    expect(href.endsWith(path.basename(saved))).toBe(true);
    // ลิงก์เป็น /api/... แบบสัมพัทธ์ — เปิดผ่าน proxy ของหน้าเว็บเหมือนที่ผู้ใช้กด
    const file = await page.request.get(href);
    expect(file.status()).toBe(200);
    expect((await file.body()).subarray(0, 4).toString()).toBe('%PDF');
  });

  test('R8: หน้าจอ — เลือกไฟล์ที่ไม่ใช่ PDF ถูกปฏิเสธตั้งแต่บนจอ และไม่มีอะไรถูกบันทึก', async ({ page }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'profile');

    await page.getByTestId('profile-resume-input').setInputFiles({
      name: 'resume.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK\u0003\u0004 not really'),
    });
    await expect(page.getByText('ไฟล์ที่เลือกต้องเป็นนามสกุล PDF เท่านั้น')).toBeVisible();
    await expect(page.getByText('ยังไม่ได้อัปโหลดเรซูเม่')).toBeVisible();
    expect(await storedResume()).toBeNull();
  });
});
