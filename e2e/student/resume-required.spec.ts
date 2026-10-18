import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { API_URL } from '../helpers/env';
import { dbExec, dbValue } from '../helpers/db';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { goToMenu } from '../helpers/nav';

/**
 * เรซูเม่ต้องมีก่อนยื่นคำร้องขอหนังสือ (เจ้าของสั่ง 2026-10-18)
 *
 * เหตุผล: สถานประกอบการเปิดเรซูเม่ในลิงก์ตอบรับ · อาจารย์ที่ปรึกษา/อาจารย์นิเทศ/เจ้าหน้าที่เปิดในกล่อง สหกิจ 03
 * ถ้านักศึกษายื่นได้โดยไม่มีไฟล์ ทั้งสามฝ่ายจะเปิดแล้วเจอที่ว่าง
 *
 * สิ่งที่ชุดนี้คุม:
 *   1. **เซิร์ฟเวอร์เป็นด่านจริง** — ไม่มีเรซูเม่ = `POST /intents` ได้ 409 `resume_required` และไม่สร้างอะไรเลย
 *   2. **หน้ายื่นคำร้องบอกสาเหตุและพาไปอัปโหลด** ไม่ใช่ฟอร์มที่กดแล้วเงียบ
 *   3. **ผู้ตรวจเห็นไฟล์** ในกล่อง สหกิจ 03 · เปิดไฟล์ได้เฉพาะเจ้าหน้าที่/อาจารย์ — พี่เลี้ยงไม่ได้
 *
 * ช่องอัปโหลดบนหน้าโปรไฟล์คุมที่ `student-resume` R7–R8 · seed ให้ student1/2 มีเรซูเม่ติดมาเพื่อให้เทสต์ยื่นคำร้องทั่วไปเดินต่อได้
 */

const realPdf = () => ({
  name: 'my-resume.pdf',
  mimeType: 'application/pdf',
  buffer: fs.readFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf')),
});

const STUDENT2 = "(SELECT user_id FROM users WHERE email = 'student2@test.com')";

const intentCount = () =>
  dbValue<number>(`SELECT COUNT(*)::int FROM intent_forms WHERE student_id = ${STUDENT2}`);

const submitIntentBody = async () => ({
  company_id: await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1'),
  semester_id: await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'),
});

test.describe('เรซูเม่บังคับก่อนยื่นคำร้อง', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/maps.googleapis.com/**', (route) => route.abort());
    await seedTestData();
    await dbExec(`UPDATE students SET resume_file = NULL WHERE student_id = ${STUDENT2}`);
    await dbExec(`DELETE FROM intent_forms WHERE student_id = ${STUDENT2}`);
  });

  test('Q1: ไม่มีเรซูเม่ → ยื่นคำร้องไม่ได้ (409 resume_required) และไม่มีใบ/บริษัทค้าง · อัปโหลดแล้วยื่นได้', async ({
    request,
  }) => {
    await apiLoginAs(request, 'student2');
    const body = await submitIntentBody();
    const companiesBefore = await dbValue<number>('SELECT COUNT(*)::int FROM companies');

    const blocked = await request.post(`${API_URL}/intents`, { data: body });
    expect(blocked.status(), await blocked.text()).toBe(409);
    expect((await blocked.json()).code).toBe('resume_required');
    expect(await intentCount()).toBe(0);

    // ⛔ ทางพิมพ์บริษัทเอง (is_self_found) ต้องถูกปิดเหมือนกัน และต้องไม่สร้างแถวบริษัทค้างไว้
    const selfFound = await request.post(`${API_URL}/intents`, {
      data: {
        is_self_found: true,
        semester_id: body.semester_id,
        company_name_th: 'บริษัท ไม่มีเรซูเม่ จำกัด (E2E)',
        company_address: '1 ถนนทดสอบ',
        company_province: 'ชลบุรี',
        company_district: 'ศรีราชา',
        company_postal_code: '20110',
        company_phone: '020000000',
        contact_person: 'นางสาวทดสอบ ระบบ',
        contact_position: 'HR Manager',
      },
    });
    expect(selfFound.status(), await selfFound.text()).toBe(409);
    expect((await selfFound.json()).code).toBe('resume_required');
    expect(await dbValue<number>('SELECT COUNT(*)::int FROM companies')).toBe(companiesBefore);

    // อัปโหลดเรซูเม่แล้วยื่นได้
    const up = await request.put(`${API_URL}/profile/student`, { multipart: { resume: realPdf() } });
    expect(up.status(), await up.text()).toBe(200);
    const ok = await request.post(`${API_URL}/intents`, { data: body });
    expect(ok.status(), await ok.text()).toBe(201);
    expect(await intentCount()).toBe(1);
  });

  test('Q2: หน้ายื่นคำร้อง — ไม่มีเรซูเม่ขึ้นข้อความบังคับและพาไปหน้าข้อมูลส่วนตัว ไม่มีปุ่มยื่น · อัปโหลดแล้วฟอร์มกลับมา', async ({
    page,
  }) => {
    await loginAs(page, 'student2');
    await goToMenu(page, 'jobs');

    const banner = page.getByTestId('request-resume-required');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('ต้องอัปโหลดเรซูเม่ก่อน');
    await expect(page.getByTestId('request-submit')).toHaveCount(0);

    await page.getByTestId('request-go-resume').click();
    await expect(page.getByTestId('profile-resume-box')).toBeVisible();
    await expect(page.getByTestId('profile-resume-required')).toBeVisible();

    await page.getByTestId('profile-resume-input').setInputFiles(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf'));
    await page.waitForLoadState('networkidle');
    await page.getByTestId('profile-save').click();
    await expect(page.getByText('บันทึกข้อมูลส่วนตัวและเรซูเม่เรียบร้อยแล้ว')).toBeVisible();
    await expect(page.getByTestId('profile-resume-required')).toHaveCount(0);

    await goToMenu(page, 'jobs');
    await expect(page.getByTestId('request-resume-required')).toHaveCount(0);
    await expect(page.getByTestId('request-submit')).toBeVisible();
  });

  test('Q3: ผู้ตรวจเห็นเรซูเม่ในกล่อง สหกิจ 03 และเปิดไฟล์ได้ · ไม่มีไฟล์ขึ้นว่ายังไม่ได้อัปโหลด · พี่เลี้ยงเปิดไฟล์ไม่ได้', async ({
    page,
    request,
  }) => {
    const sid = (await dbValue<number>(`SELECT user_id FROM users WHERE email = 'student2@test.com'`))!;

    // ยังไม่มีไฟล์ → กล่องบอกตรง ๆ
    await loginAs(page, 'advisor1');
    await goToMenu(page, 'students');
    await page.getByTestId(`advisor-student-row-${sid}`).click();
    await page.getByTestId('advisor-student-view-forms').click();
    await expect(page.getByTestId('coop-view-resume-missing')).toBeVisible();
    await page.getByTestId('coop-view-close').click();

    // นักศึกษาอัปโหลด → ผู้ตรวจเห็นชื่อไฟล์และเปิดได้จริง
    await apiLoginAs(request, 'student2');
    expect((await request.put(`${API_URL}/profile/student`, { multipart: { resume: realPdf() } })).status()).toBe(200);
    const stored = (await dbValue<string>(`SELECT resume_file FROM students WHERE student_id = ${sid}`))!;

    await page.reload();
    await goToMenu(page, 'students');
    await page.getByTestId(`advisor-student-row-${sid}`).click();
    await page.getByTestId('advisor-student-view-forms').click();
    await expect(page.getByTestId('coop-view-resume-name')).toHaveText(path.basename(stored));
    await page.getByTestId('coop-view-resume').click();
    await expect(page.locator('[role="dialog"] iframe[title="เรซูเม่ของนักศึกษา"]')).toBeVisible();

    // ด้าน API: ผู้ตรวจที่มีสิทธิ์เปิดไฟล์ได้ · พี่เลี้ยงที่ไม่ได้ดูแลนักศึกษาคนนี้ไม่ได้
    for (const who of ['staff1', 'advisor1', 'head1'] as const) {
      await apiLoginAs(request, who);
      const view = await request.get(`${API_URL}/students/${sid}/coop-application`);
      expect((await view.json()).resume_file, who).toBe(stored);
      expect((await request.get(`${API_URL}/files/${stored}`)).status(), who).toBe(200);
    }
    await apiLoginAs(request, 'mentor1');
    expect((await request.get(`${API_URL}/files/${stored}`)).status()).toBe(403);
  });
});
