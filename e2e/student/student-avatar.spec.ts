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
 * รูปโปรไฟล์นักศึกษา
 *
 * ⛔ ก่อน 2026-09-03 หน้าโปรไฟล์มี **ปุ่มตาย** — กดอัปโหลด เห็นรูปเปลี่ยน แล้วรีเฟรช
 * ทีเดียวหาย เพราะไฟล์ไม่เคยถูกส่งไปไหนและไม่มีคอลัมน์ให้เก็บ
 *
 * ⛔ **ระบบไม่ตรวจว่าเป็น "รูปตามระเบียบ"** (สัดส่วน 1 นิ้ว · พื้นหลังฟ้า · หน้าตรง)
 * เจ้าของเคาะ 2026-09-03 ว่าฐานรูปของมหาวิทยาลัยบังคับอยู่แล้ว ไม่ต้องเคร่งซ้ำ
 * — ชุดนี้จึงไม่มีเทสต์เรื่องสัดส่วนหรือสีพื้นหลัง **โดยตั้งใจ ไม่ใช่ลืม**
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **บันทึกลงฐานจริง** ไม่ใช่แค่โชว์ตัวอย่างในเครื่อง (บั๊กเดิม)
 *   2. **ด่านไฟล์เดียวกับทุกการอัปโหลดในระบบ** — นามสกุล + magic bytes
 *   3. **สิทธิ์** — รูปเป็นของนักศึกษาแต่ละคน เพื่อนเปิดไม่ได้ · บริษัทยังไม่ได้
 *   4. **เปลี่ยนรูปแล้วไฟล์เก่าต้องไม่ค้างบนดิสก์**
 */

const realPng = () => ({
  name: 'photo.png',
  mimeType: 'image/png',
  buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_evidence.png')),
});

const uploadAvatar = (
  request: APIRequestContext,
  file: { name: string; mimeType: string; buffer: Buffer }
) => request.post(`${API_URL}/profile/student/avatar`, { multipart: { avatar: file } });

const storedAvatar = (email = 'student2@test.com') =>
  dbValue<string | null>(
    'SELECT profile_image FROM students WHERE student_id = (SELECT user_id FROM users WHERE email = $1)',
    [email]
  );

const onDisk = (relativePath: string) =>
  fs.existsSync(path.resolve(__dirname, '../../backend/uploads', relativePath));

test.describe('รูปโปรไฟล์นักศึกษา', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec('UPDATE students SET profile_image = NULL');
  });

  test('P1: ยังไม่เคยอัปโหลด → ฐานเป็น NULL และหน้าโปรไฟล์แสดงตัวอักษรย่อ', async ({
    page,
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    const me = await request.get(`${API_URL}/profile/me`);
    expect(me.status()).toBe(200);
    expect((await me.json()).profile.profile_image ?? null).toBeNull();

    await loginAs(page, 'student2');
    await goToMenu(page, 'profile');
    await expect(page.getByTestId('profile-avatar-image')).toHaveCount(0);
  });

  test('P2: อัปโหลดรูปจริง → ลงฐาน · มีไฟล์บนดิสก์ · เปิดอ่านได้', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await uploadAvatar(request, realPng());
    expect(res.status(), await res.text()).toBe(200);

    const saved = (await res.json()).profile_image as string;
    expect(saved).toMatch(/^avatars\/avatar-user-\d+-/);
    expect(await storedAvatar()).toBe(saved);
    expect(onDisk(saved)).toBe(true);

    // ต้องเปิดอ่านกลับได้จริง ไม่ใช่แค่มีแถวในฐาน
    const file = await request.get(`${API_URL}/files/${saved}`);
    expect(file.status()).toBe(200);
    expect((await file.body()).subarray(1, 4).toString()).toBe('PNG');
  });

  test('P3: ไฟล์ที่นามสกุลรูปแต่ข้างในไม่ใช่รูป → 400 และฐานต้องไม่ขยับ', async ({ request }) => {
    await apiLoginAs(request, 'student2');

    // ด่านนี้ไม่ใช่เรื่อง "รูปตามระเบียบ" แต่คือด่านเดียวกับทุกการอัปโหลดในระบบ
    const res = await uploadAvatar(request, {
      name: 'fake.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<?php echo "not an image"; ?>'),
    });
    expect(res.status()).toBe(400);
    expect(await storedAvatar()).toBeNull();
  });

  test('P4: นามสกุลที่ไม่ใช่รูป → 400 ไม่ใช่ 500', async ({ request }) => {
    await apiLoginAs(request, 'student2');
    const res = await uploadAvatar(request, {
      name: 'letter.pdf',
      mimeType: 'application/pdf',
      buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
    });
    // ⛔ ไฟล์ที่ multer ปฏิเสธเคยตกไปที่ตัวจัดการ error กลางแล้วได้ 500 +
    //    "เกิดข้อผิดพลาดของระบบ" ทั้งที่เป็นคำขอที่ผิด ไม่ใช่เซิร์ฟเวอร์พัง
    //    ครอบทุกตัวอัปโหลดในระบบ ไม่ใช่แค่รูปโปรไฟล์
    expect(res.status()).toBe(400);
    expect(await storedAvatar()).toBeNull();
  });

  test('P5: อัปโหลดใหม่ทับ → ไฟล์เก่าต้องไม่ค้างบนดิสก์', async ({ request }) => {
    await apiLoginAs(request, 'student2');

    const first = (await (await uploadAvatar(request, realPng())).json()).profile_image as string;
    expect(onDisk(first)).toBe(true);

    const second = (await (await uploadAvatar(request, realPng())).json()).profile_image as string;
    expect(second).not.toBe(first);
    expect(await storedAvatar()).toBe(second);
    expect(onDisk(second)).toBe(true);

    // การลบเป็น fire-and-forget — รอให้มันเกิดขึ้นแทนการเช็คทันที
    await expect.poll(() => onDisk(first), { timeout: 5000 }).toBe(false);
  });

  test('P6: สิทธิ์ — เพื่อนเปิดรูปไม่ได้ · อาจารย์เปิดได้ · พี่เลี้ยงที่ไม่ได้ดูแลยังไม่ได้', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    const saved = (await (await uploadAvatar(request, realPng())).json()).profile_image as string;

    await apiLoginAs(request, 'student1');
    expect((await request.get(`${API_URL}/files/${saved}`)).status()).toBe(403);

    await apiLoginAs(request, 'mentor1');
    expect((await request.get(`${API_URL}/files/${saved}`)).status()).toBe(403);

    await apiLoginAs(request, 'advisor1');
    expect((await request.get(`${API_URL}/files/${saved}`)).status()).toBe(200);
  });

  test('P7: บทบาทอื่นอัปโหลดรูปนักศึกษาไม่ได้ · คนที่ยังไม่มีประวัติได้ 404', async ({
    request,
  }) => {
    await apiLoginAs(request, 'staff1');
    expect((await uploadAvatar(request, realPng())).status()).toBe(403);

    // student1 มีบัญชีแต่ยังไม่มีแถวใน `students` — ต้องบอกให้ไปตั้งโปรไฟล์ก่อน
    // และไฟล์ที่เพิ่งรับมาต้องไม่ค้างเป็นขยะบนดิสก์
    await apiLoginAs(request, 'student1');
    const res = await uploadAvatar(request, realPng());
    expect(res.status()).toBe(404);
    expect((await res.json()).message as string).toContain('โปรไฟล์');
  });

  test('P8: หน้าจอ — อัปโหลดแล้วเห็นรูปทั้งหน้าโปรไฟล์และหน้าแรก', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'student2');
    await goToMenu(page, 'profile');

    await page
      .getByTestId('profile-avatar-input')
      .setInputFiles(path.resolve(__dirname, '../fixtures/mock_evidence.png'));

    await expect(page.getByText(/อัปโหลดรูปโปรไฟล์เรียบร้อยแล้ว/)).toBeVisible();
    await expect(page.getByTestId('profile-avatar-image')).toBeVisible();

    // ⛔ ตัวจริงของบั๊กเดิมคือ "รีเฟรชทีเดียวหาย" — ต้องยังอยู่หลังโหลดหน้าใหม่
    await page.reload();
    await expect(page.getByTestId('dashboard-avatar-image')).toBeVisible();
    await goToMenu(page, 'profile');
    await expect(page.getByTestId('profile-avatar-image')).toBeVisible();
  });
});
