import { test, expect, request as pwRequest } from '@playwright/test';
import type { Page } from '@playwright/test';
import crypto from 'crypto';
import { seedTestData } from '../helpers/test-seeder';
import { seedDemo } from '../../backend/src/db/seedDemo';
import pool from '../../backend/src/config/database';
import { hashPassword } from '../../backend/src/utils/password';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { API_URL, APP_URL } from '../helpers/env';
import { apiLoginAs, loginAs } from '../helpers/auth';
import { logout } from '../helpers/nav';
import { completeDispatchPrep, coverLetterDocId, deanSign, officerApprove } from '../helpers/intent';
import { dbExec, dbValue } from '../helpers/db';
import { createWalk } from '../helpers/walkthrough';

/**
 * Walkthrough: ภาพบทที่ 4 ชุดเพิ่ม (12 หน้าที่ขอบเขตในเล่มเขียนถึงแต่ยังไม่มีภาพ)
 *
 * ผลลัพธ์: `เอกสาร/walkthrough/thesis-screens/extra/` · ชื่อไฟล์ x01…x24 (ไม่ผูกกับเลขภาพในเล่ม) · index.html ในโฟลเดอร์นั้น
 * ภาพมาจากแอปที่รันอยู่จริง ไม่มี `setContent` ไม่แปะภาพ · ถ่ายด้วย Chrome จริงเหมือน `thesis-placement`
 *
 * ข้อมูล = ชุดเดโม `seedDemo` + ทางลัดทางฐาน (บอกใน caption และ notes) · ใช้ สมชาย สายดี (student2) + บริษัท ซีเกท เป็นหลัก
 * ⛔ ข้อมูลทั้งหมดเป็นของปลอม · รีเซ็ตฐานเหมือน E2E ทุกครั้งที่รัน · ห้ามรันซ้อนกับ E2E ชุดเต็ม
 */

// actionTimeout: ไม่ให้คลิกที่หาไม่เจอแขวนทั้งเคส (รอบก่อนค้าง 15 นาที)
test.use({ channel: 'chrome', actionTimeout: 30_000 });

const TODAY = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`;

/** ไปที่เมนูของฝ่ายนั้นตรงๆ ผ่าน URL แล้วรอจนไม่มี skeleton */
async function open(page: Page, menu: string, role?: string, extra = ''): Promise<void> {
  await page.goto(`/dashboard?${role ? `role=${role}&` : ''}menu=${menu}${extra}`);
  await page.getByTestId('screen-loading').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
}

/** โทเคนแบบเดียวกับที่ลิงก์ในอีเมลนัดนิเทศใช้ (วิธีเดียวกับ `faculty/supervision-appointment-edit`) */
function mentorToken(appointmentId: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    appointment_id: appointmentId,
    role: 'mentor_response',
    iat: now,
    exp: now + 7 * 24 * 3600,
  })}`;
  return `${body}.${crypto.createHmac('sha256', process.env.JWT_SECRET as string).update(body).digest('base64url')}`;
}

/** บัญชีที่มีอยู่จริงแต่ยังไม่มี role/โปรไฟล์ = คนที่เพิ่งเข้าระบบครั้งแรก (วิธีเดียวกับ `student/student-onboarding`) */
async function arriveAsFirstTime(page: Page, email: string, type: 'student' | 'personnel'): Promise<void> {
  const client = await pool.connect();
  let userId: number;
  try {
    const hash = await hashPassword('password123');
    userId = (await client.query(
      `INSERT INTO users (email, password_hash, is_active) VALUES ($1, $2, TRUE)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE
       RETURNING user_id`,
      [email, hash]
    )).rows[0].user_id;
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  } finally {
    client.release();
  }
  await page.goto('/');
  const res = await page.request.post(`${API_URL}/auth/login`, { data: { email, password: 'password123' } });
  expect(res.status()).toBe(200);
  await page.evaluate(
    ({ id, mail, kind }) => {
      localStorage.setItem('onboarding_type', kind);
      localStorage.setItem('auth_user', JSON.stringify({ userId: id, email: mail, roles: [], isFirstTime: true }));
    },
    { id: userId, mail: email, kind: type }
  );
}

test.describe('walkthrough: ภาพบทที่ 4 ชุดเพิ่ม', () => {
  test('thesis-extra', async ({ page, request }) => {
    test.setTimeout(900_000);
    const walk = createWalk('thesis-screens/extra', 'ภาพบทที่ 4 ชุดเพิ่ม — หน้าที่ขอบเขตในเล่มเขียนถึงแต่ยังไม่มีภาพ (กลุ่ม 1 และ 2)', {
      notes: [
        'ชื่อไฟล์ x01–x24 ไม่ผูกกับเลขภาพในเล่ม (เลขในเล่มจะจัดใหม่ทั้งบท) · ภาพทุกภาพมาจากแอปที่รันอยู่จริง ถ่ายด้วย Google Chrome จริง',
        'ข้อมูลทั้งหมดเป็นของปลอม (@test.com / @example.com) · ฐานถูกรีเซ็ตแล้วลงชุดเดโม (seedDemo) · MAIL_DRY_RUN=true',
        'ทางลัดทางฐาน (ไม่ผ่านหน้าจอ): นัดนิเทศ 5 รายการ · บันทึกข้อความนักศึกษา 2 ใบ · ภาคเรียนที่ปิดแล้ว 1 ภาค · พี่เลี้ยงรอยืนยัน 1 คน · โครงร่างที่พี่เลี้ยงเห็นชอบแล้ว · ไม่จัดสรรอาจารย์ให้นักศึกษา 1 คน · ข้อมูลเตรียมเอกสารก่อนออกฝึกของ student2 (สหกิจ 03/06)',
        'x03 โทเคนลิงก์นัดนิเทศเซ็นด้วยกุญแจเดียวกับของระบบ (ของจริงอยู่ในอีเมลที่ระบบส่งให้พี่เลี้ยง)',
        'x01/x02 เป็นภาพขณะกรอกยังไม่กดส่ง · x04 ถ่ายก่อนกดออกหนังสือ · x05 ยังไม่กดยืนยันปิดใบ — ไม่มีการเปลี่ยนสถานะจริง',
      ],
    });
    walk.watch(page);

    const failures: string[] = [];
    const shoot = async (file: string, who: string, caption: string, prep: () => Promise<void>, fullPage = true) => {
      try {
        await prep();
        await walk.step(page, who, caption, { file: `${file}.png`, fullPage });
      } catch (err) {
        failures.push(`${file}: ${(err as Error).message.split('\n')[0]}`);
      }
    };

    try {
      await page.route('**/maps.googleapis.com/**', (route) => route.abort());
      await seedTestData();

      // ───────── x01 นักศึกษาเข้าระบบครั้งแรก (ฐานเปล่า — ยังไม่มีโปรไฟล์) ─────────
      await shoot('x01-onboarding-student', 'นักศึกษาเข้าระบบครั้งแรก', '/onboarding/student — ฟอร์มตั้งค่าโปรไฟล์ครั้งแรก (ขั้นที่ 1) กรอกบางช่อง ยังไม่กดไปขั้นถัดไป', async () => {
        await arriveAsFirstTime(page, 'freshstudent@example.com', 'student');
        await page.goto('/onboarding/student');
        await page.getByTestId('onboarding-name-prefix').selectOption('นาย');
        await page.getByTestId('onboarding-first-name').fill('ธนกฤต');
        await page.getByTestId('onboarding-last-name').fill('ศรีสุวรรณ');
        await page.getByTestId('onboarding-faculty').selectOption({ index: 1 });
        await page.getByTestId('onboarding-major').selectOption({ index: 1 });
        await page.getByTestId('onboarding-gpa').fill('3.25');
      });
      await page.request.post(`${API_URL}/auth/logout`);

      // ───────── x02 บุคลากรเข้าระบบครั้งแรก ─────────
      await shoot('x02-onboarding-personnel', 'บุคลากรเข้าระบบครั้งแรก', '/onboarding/personnel — ฟอร์มยืนยันตัวตนด้วยรหัสพนักงาน (อีเมลอยู่ในรายชื่อบุคลากรตั้งต้นที่นำเข้าไว้ · ทางลัด: เพิ่มรายชื่อตั้งต้นทางฐาน) กรอกรหัสแล้วยังไม่กดยืนยัน', async () => {
        await dbExec(
          `INSERT INTO personnel_preseed_list (employee_code, role_name, major_id, first_name, last_name, email)
           VALUES ('EMP1001', 'advisor', (SELECT major_id FROM master_major ORDER BY major_id LIMIT 1),
                   'อาจารย์สมรัก', 'รักสอน', 'somruk@example.com')
           ON CONFLICT (employee_code) DO NOTHING`
        );
        await arriveAsFirstTime(page, 'somruk@example.com', 'personnel');
        await page.goto('/onboarding/personnel');
        await page.locator('input[placeholder="กรอกรหัสประจำตัวบุคลากรของคุณ"]').fill('EMP1001');
      });
      await page.request.post(`${API_URL}/auth/logout`);

      // ───────── เตรียมข้อมูลกลางทางฝึก ─────────
      await dbExec(
        `INSERT INTO personnel (personnel_id, major_id, status, first_name, last_name)
         SELECT user_id, (SELECT major_id FROM master_major LIMIT 1), 'approved', 'สมใจ', 'เจ้าหน้าที่ดี'
           FROM users WHERE email = 'staff1@test.com'
         ON CONFLICT (personnel_id) DO NOTHING`
      );
      const demo = await seedDemo({ quiet: true });

      const uid = (email: string) => dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;
      const advisorId = await uid('advisor1@test.com');
      const student1 = await uid('student1@test.com');
      const student2 = await uid('student2@test.com');
      const student3 = await uid('student3@test.com');
      const student4 = await uid('student4@test.com');
      const mentorId = await uid('mentor1@test.com');
      const companyId = (await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1'))!;
      const semId = (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'))!;

      // นัดนิเทศหลายสถานะ (ตารางที่เจ้าหน้าที่ตรวจ · ใช้ x12) + นัดที่รอพี่เลี้ยงตอบ (ใช้ x03)
      const appt = async (studentId: number, status: string, daysAhead: number, createdAgo: number, proposed: number | null = null) =>
        (await dbValue<number>(
          `INSERT INTO supervision_appointments
             (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, tour_requested, status,
              proposed_reschedule_date, proposed_mentor_time, created_at, updated_at)
           VALUES ($1, $2, $3, ${TODAY} + $4::int, '09:30', '10:00', $6, $5,
                   CASE WHEN $7::int IS NULL THEN NULL ELSE ${TODAY} + $7::int END,
                   CASE WHEN $7::int IS NULL THEN NULL ELSE '13:30' END,
                   NOW() - $8::int * INTERVAL '1 day', NOW() - $8::int * INTERVAL '1 day')
           RETURNING appointment_id`,
          [advisorId, studentId, companyId, daysAhead, status, status !== 'draft', proposed, createdAgo]
        ))!;
      const waitingId = await appt(student2, 'pending_company', 12, 2);
      await appt(student1, 'accepted', 9, 6);
      await appt(student3, 'draft', 20, 1);
      await appt(student4, 'rescheduled', 15, 4, 22);
      await appt(student1, 'offline_agreed', 30, 0);

      // ───────── x03 พี่เลี้ยง (ไม่ต้องเข้าสู่ระบบ) เปิดลิงก์นัดนิเทศ ─────────
      await shoot('x03-appointment-response', 'พี่เลี้ยง (ไม่ต้องเข้าสู่ระบบ)', '/appointment-response?token=… — หน้าตอบรับ/ขอเลื่อนนัดนิเทศ เห็นวันเวลาที่อาจารย์เสนอ (ทางลัด: โทเคนเซ็นเอง แทนการเปิดจากอีเมล)', async () => {
        await page.goto(`/appointment-response?token=${mentorToken(waitingId)}`);
        await expect(page.getByText(/สมชาย/).first()).toBeVisible({ timeout: 15_000 });
      });

      // บันทึกข้อความนักศึกษา 2 ใบ (ทางลัดทางฐาน · ใช้ x09 x10 และ PDF x24c)
      const memoId = (await dbValue<number>(
        `INSERT INTO student_memos (student_id, semester_id, memo_type, reason, created_at)
         VALUES ($1, $3, 'change_company', 'บริษัทเดิมยกเลิกการรับนักศึกษาเข้าปฏิบัติงานกะทันหัน จึงขอเปลี่ยนสถานประกอบการ', NOW() - INTERVAL '3 days'),
                ($2, $3, 'terminated', 'สถานประกอบการส่งตัวกลับเนื่องจากโครงการที่ฝึกปฏิบัติสิ้นสุดลงก่อนกำหนด', NOW() - INTERVAL '1 day')
         RETURNING memo_id`,
        [student2, student1, semId]
      ))!;

      // ───────── x18 / x18b บริษัทเลือก "ไม่รับ" (token ของ student4 แยกจากเส้นทางอื่น) ─────────
      await shoot('x18-company-decline', 'บริษัท (ลิงก์)', '/accept?token=… — เลือก "ไม่รับ" และพิมพ์เหตุผลแล้ว ยังไม่กดส่ง', async () => {
        await page.goto(demo.acceptUrls[1]);
        await expect(page.getByTestId('al-student-name')).toBeVisible({ timeout: 20_000 });
        await page.getByTestId('al-decision-decline').check();
        await page.getByTestId('al-decline-reason').fill('ไม่มีตำแหน่งงานที่ตรงกับสาขาของนักศึกษาในภาคเรียนนี้');
      });
      await shoot('x18b-company-declined', 'บริษัท (ลิงก์)', 'หลังกดส่งคำตอบ "ไม่รับ" — หน้า "ส่งแล้ว" ของบริษัท', async () => {
        await page.getByTestId('al-submit').click();
        await page.getByTestId('al-confirm').click();
        await expect(page.getByTestId('al-done')).toBeVisible({ timeout: 20_000 });
      });

      // ───────── นักศึกษา student2: x15 x16 x21 x13 + PDF x24a x24b x24c ─────────
      await loginAs(page, 'student2');
      await shoot('x15-log-daily', 'นักศึกษา', 'บันทึกการปฏิบัติงาน แท็บรายวัน (สหกิจ 08) — พี่เลี้ยงเปิดให้บันทึกรายวันแล้ว มีวันที่กรอกและส่งแล้ว', async () => {
        await open(page, 'weekly_log', undefined, '&tab=daily');
      });
      await shoot('x16-log-monthly', 'นักศึกษา', 'บันทึกการปฏิบัติงาน แท็บรายเดือน (สหกิจ 10) — มีเดือนที่ส่งแล้ว', async () => {
        await open(page, 'weekly_log', undefined, '&tab=monthly');
        const tab = page.getByRole('tab', { name: /รายเดือน/ });
        if (await tab.isVisible().catch(() => false)) await tab.click();
      });
      await shoot('x21-notifications', 'นักศึกษา', 'กระดิ่งแจ้งเตือนที่มุมขวาบนเปิดอยู่ — มีรายการความคืบหน้า', async () => {
        await open(page, 'dashboard');
        await page.getByRole('button', { name: 'ความคืบหน้าคำร้อง' }).click();
        await page.waitForTimeout(800);
      });
      await shoot('x13-set-password', 'นักศึกษา/บุคลากร', '/set-password — ฟอร์มตั้งรหัสผ่านเฉพาะระบบ', async () => {
        await page.goto('/set-password');
        await expect(page.getByPlaceholder('กรอกรหัสผ่านอีกครั้ง')).toBeVisible({ timeout: 15_000 });
      });

      // PDF ที่ระบบพิมพ์ออก — เปิดจากปลายทางเดียวกับปุ่มพิมพ์ในแอป ด้วย Chrome จริง (ไม่เห็นหน้าจอแอป)
      // ⛔ สหกิจ 03 มีเลขบัตรประชาชน/เชื้อชาติ/ศาสนาจริง — ใช้ค่าทดสอบที่ดูออกว่าปลอม (เลขบัตร 1-2345-67890-12-3)
      let coop03Saved = false;
      await shoot('x24a-pdf-coop03', 'เอกสาร PDF ที่ระบบพิมพ์', 'สหกิจ 03 (ใบสมัครงาน) ของ สมชาย สายดี — หน้าแรกของไฟล์ที่ระบบพิมพ์ (ข้อมูลอ่อนไหวเป็นค่าทดสอบ)', async () => {
        await open(page, 'job_application');
        await page.getByTestId('ca-first-en').fill('Somchai');
        await page.getByTestId('ca-last-en').fill('Saidee');
        await page.getByTestId('ca-gender').selectOption('ชาย');
        await page.getByTestId('ca-nationality').fill('ไทย');
        await page.getByTestId('ca-mobile').fill('0812345678');
        await page.getByTestId('ca-emg-name').fill('นางสมศรี สายดี');
        await page.getByTestId('ca-emg-relation').selectOption('มารดา');
        await page.getByTestId('ca-emg-phone').fill('0898765432');
        await page.getByTestId('ca-national-id').fill('1234567890123');
        await page.getByTestId('ca-id-district').fill('เมืองนครราชสีมา');
        await page.getByTestId('ca-id-expiry').fill('2032-05-15');
        await page.getByTestId('ca-ethnicity').fill('ไทย');
        await page.getByTestId('ca-religion').fill('พุทธ');
        await page.getByTestId('ca-consent').check();
        await page.getByTestId('ca-submit').click();
        await expect(page.getByText(/บันทึก.*(สำเร็จ|เรียบร้อย)/).first()).toBeVisible({ timeout: 15_000 });
        coop03Saved = true;
        await page.goto(`${APP_URL}/api/students/coop-application/print`);
        await page.waitForTimeout(4_000);
      }, false);
      void coop03Saved;
      await shoot('x24b-pdf-coop06', 'เอกสาร PDF ที่ระบบพิมพ์', 'สหกิจ 06 (แจ้งที่พัก) ของ สมชาย สายดี — หน้าแรกของไฟล์ที่ระบบพิมพ์ (ข้อมูลที่พักเป็นค่าทดสอบ)', async () => {
        await page.goto(`${APP_URL}/api/students/${student2}/accommodation-plan/print`);
        await page.waitForTimeout(4_000);
      }, false);
      await shoot('x24c-pdf-memo', 'เอกสาร PDF ที่ระบบพิมพ์', 'บันทึกข้อความถึงคณบดี ของ สมชาย สายดี — หน้าแรกของไฟล์ที่ระบบพิมพ์', async () => {
        await page.goto(`${APP_URL}/api/memos/${memoId}/pdf`);
        await page.waitForTimeout(4_000);
      }, false);
      // หน้าตอนนี้เป็นตัวอ่าน PDF ไม่มีปุ่มออกจากระบบ — ออกผ่าน API แทน
      await page.request.post(`${API_URL}/auth/logout`);

      // ───────── x14 ลิงก์รีเซ็ตรหัสผ่าน (ไม่ต้องเข้าสู่ระบบ) ─────────
      await shoot('x14-reset-password', 'ผู้ใช้จากลิงก์ลืมรหัสผ่าน', '/reset-password?token=… — ฟอร์มตั้งรหัสผ่านใหม่ (ทางลัด: โทเคนจำลองในลิงก์ — หน้านี้แสดงฟอร์มเมื่อมี token ส่วนความถูกต้องตรวจตอนกดส่ง)', async () => {
        await page.goto(`/reset-password?token=${crypto.randomUUID()}`);
        await expect(page.getByPlaceholder('กรอกรหัสผ่านอีกครั้ง')).toBeVisible({ timeout: 15_000 });
      });

      // ───────── x17 / x23 พี่เลี้ยง ─────────
      await loginAs(page, 'mentor1');
      await shoot('x17-eval-16', 'พี่เลี้ยง', 'แบบประเมินนักศึกษา แท็บสหกิจ 16 (ประเมินรายงาน) — กรอกไปบางข้อ ยังไม่ส่ง', async () => {
        await open(page, 'final_evaluation');
        await page.getByRole('button', { name: /สมชาย สายดี/ }).click();
        await page.getByRole('button', { name: /สหกิจ 16/ }).first().click();
        const some: Record<string, string> = {
          topic_selection: '4', chapter1: '4', chapter2: '3', chapter3: '4', chapter4: '5', content_overall: '4',
        };
        for (const [key, v] of Object.entries(some)) await page.locator(`#select-${key}`).selectOption(v);
      });
      await shoot('x23-mentor-profile', 'พี่เลี้ยง', 'เมนู "ข้อมูลส่วนตัว" ของพี่เลี้ยง — กรอกข้อมูลแล้ว', async () => {
        await open(page, 'profile');
      });
      await logout(page);

      // ───────── x04 / x04b หนังสือส่งตัว ─────────
      // ทางลัด: ให้ student2 ส่งเอกสารก่อนออกฝึกครบ (สหกิจ 03/06) และยังไม่ออกหนังสือส่งตัว
      await completeDispatchPrep('student2@test.com');
      await dbExec(`UPDATE intent_forms SET dispatch_document_no = NULL WHERE student_id = $1`, [student2]);
      const form2 = (await dbValue<number>(
        `SELECT form_id FROM intent_forms WHERE student_id = $1 ORDER BY form_id DESC LIMIT 1`,
        [student2]
      ))!;
      await loginAs(page, 'staff1');
      let dispatchReady = false;
      await shoot('x04-dispatch-letter', 'เจ้าหน้าที่', 'คิว "ออกหนังสือส่งตัว" → แผงออกหนังสือส่งตัวของ สมชาย สายดี กรอกเลขที่หนังสือและวันเริ่ม-สิ้นสุดแล้ว (ทางลัด: ข้อมูลสหกิจ 03/06 ครบทางฐาน) ยังไม่กดออกหนังสือ', async () => {
        await page.goto('/dashboard?queue=dispatch');
        await page.getByTestId(`issue-dispatch-${form2}`).click({ timeout: 20_000 });
        // วันเริ่ม-สิ้นสุดใช้ค่าตั้งต้นของระบบ (วันเริ่มของใบ + 16 สัปดาห์) ไม่กรอกทับ
        // เลขที่หนังสือกรอกท้ายสุด + ตรวจว่าค้างอยู่จริง (ช่องถูกล้างเมื่อวันที่เปลี่ยนในรอบก่อน)
        // ลองกรอกซ้ำจนค้างจริง (คิวโหลดซ้ำเบื้องหลังอาจล้างช่องทันทีหลังเปิดแผง)
        await expect(async () => {
          await page.getByTestId('dispatch-document-no').fill('ศธ 0590/ส่งตัว-001');
          await expect(page.getByTestId('dispatch-document-no')).toHaveValue('ศธ 0590/ส่งตัว-001', { timeout: 2_000 });
        }).toPass({ timeout: 25_000, intervals: [500, 1_000, 2_000] });
        dispatchReady = true;
      });
      if (dispatchReady) {
        await shoot('x04b-dispatch-letter-confirm', 'เจ้าหน้าที่', 'กดออกหนังสือส่งตัว — กล่องยืนยัน (ถ่ายเฉพาะส่วนที่เห็นบนจอ) ยังไม่กดยืนยัน', async () => {
          await page.getByTestId('dispatch-submit').click();
          await expect(page.getByTestId('dispatch-confirm')).toBeVisible();
        }, false);
        // ออกหนังสือจริง → คณบดีลงนามผ่านเซิร์ฟเวอร์ → เปิด PDF หนังสือส่งตัวที่ลงนามแล้ว (x24d)
        await page.getByTestId('dispatch-confirm').click();
        await expect(page.getByText(/ออกหนังสือส่งตัวของ .* แล้ว/)).toBeVisible({ timeout: 20_000 });
        const sendDocId = (await dbValue<number>(
          "SELECT doc_id FROM official_documents WHERE type = 'send_letter' ORDER BY doc_id DESC LIMIT 1"
        ))!;
        await deanSign(request, sendDocId);
        await shoot('x24d-pdf-dispatch-letter', 'เอกสาร PDF ที่ระบบพิมพ์', 'หนังสือส่งตัวนักศึกษา ของ สมชาย สายดี ที่คณบดีลงนามแล้ว — หน้าแรกของไฟล์ (ทางลัด: คณบดีลงนามผ่านเซิร์ฟเวอร์)', async () => {
          await page.goto(`${APP_URL}/api/files/documents/${sendDocId}`);
          await page.waitForTimeout(4_000);
        }, false);
      }

      // ───────── x05 ปิดใบที่ตอบรับแล้ว ─────────
      await shoot('x05-close-accepted', 'เจ้าหน้าที่', 'ติดตามเอกสารนักศึกษา → "ปิดใบที่ฝึก" ของ สมชาย สายดี เลือกเหตุ (เปลี่ยนสถานประกอบการ) และพิมพ์เหตุผลแล้ว ยังไม่กดยืนยัน', async () => {
        await open(page, 'final_progress');
        await page.getByTestId('close-accepted-640101001').click({ timeout: 15_000 });
        await page.getByTestId('close-accepted-kind').selectOption('change_company');
        await page.getByTestId('close-accepted-reason').fill('นักศึกษาขอย้ายไปปฏิบัติงานที่สถานประกอบการแห่งใหม่ที่อยู่ใกล้ที่พักมากกว่า');
      });

      // ───────── x11 ภาคเรียน (มีภาคที่ปิดแล้ว) ─────────
      await dbExec(
        `INSERT INTO coop_semesters (academic_year, semester, is_active, closed_at)
         VALUES (2568, '2', FALSE, NOW() - INTERVAL '120 days')
         ON CONFLICT DO NOTHING`
      );
      await shoot('x11-semesters', 'เจ้าหน้าที่', 'เมนู "ภาคเรียน" — ภาคที่เปิดใช้อยู่ 1 ภาค และภาคที่ปิดแล้ว 1 ภาค (ทางลัด: เพิ่มภาคที่ปิดแล้วทางฐาน)', async () => {
        await open(page, 'semesters');
      });

      // ───────── x12 นัดหมายนิเทศ (เจ้าหน้าที่) ─────────
      await shoot('x12-staff-appointments', 'เจ้าหน้าที่', 'เมนู "นัดหมายนิเทศ (สหกิจ 12)" — นัดหมายหลายสถานะ (ร่าง · รอพี่เลี้ยงตอบ · ตอบรับแล้ว · ขอเลื่อน · ตกลงนอกระบบ)', async () => {
        await open(page, 'appointments');
      });

      // ───────── x19 เจ้าหน้าที่ตีกลับคำร้อง · x20 คณบดีส่งหนังสือกลับ ─────────
      // นักศึกษาอีกคน (พิมพ์ชนก วงศ์สว่าง) ยื่นคำร้องใหม่ — ทางลัดทางฐานสร้างใบรอลงนาม แล้วอัปโหลดแบบคำร้องที่ระบบสร้างให้ผ่านเซิร์ฟเวอร์
      const student5 = (await dbValue<number>(
        `INSERT INTO users (email, password_hash)
         SELECT 'student5@test.com', password_hash FROM users WHERE email = 'student2@test.com' RETURNING user_id`
      ))!;
      await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [student5]);
      await dbExec(
        `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name,
                               year_level, phone, advisor_id, supervisor_id)
         SELECT $1, '640101905', major_id, 3.30, 2569, 'พิมพ์ชนก', 'วงศ์สว่าง', 3, '0812340005', $2, $2
           FROM students WHERE student_id = $3`,
        [student5, advisorId, student2]
      );
      const form5 = (await dbValue<number>(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status)
         VALUES ($1, $2, $3, 'pending_advisor') RETURNING form_id`,
        [student5, companyId, semId]
      ))!;
      const student5Req = await pwRequest.newContext();
      try {
        const login5 = await student5Req.post(`${API_URL}/auth/login`, {
          data: { email: 'student5@test.com', password: 'password123' },
        });
        expect(login5.status(), await login5.text()).toBe(200);
        const gen5 = await student5Req.get(`${API_URL}/intents/${form5}/request-form`);
        expect(gen5.status()).toBe(200);
        const up5 = await student5Req.post(`${API_URL}/intents/${form5}/request-form`, {
          multipart: { request_form: { name: 'signed.pdf', mimeType: 'application/pdf', buffer: await gen5.body() } },
        });
        expect(up5.status(), await up5.text()).toBe(200);
      } finally {
        await student5Req.dispose();
      }
      await shoot('x19-staff-return-request', 'เจ้าหน้าที่', 'แผงตรวจคำร้อง — กดตีกลับให้แก้ไข ต้องพิมพ์เหตุผล พิมพ์แล้ว ยังไม่กดยืนยัน (คำร้องของ พิมพ์ชนก วงศ์สว่าง)', async () => {
        await page.goto('/dashboard');
        await page.getByTestId(`review-request-${form5}`).click({ timeout: 20_000 });
        await page.getByRole('button', { name: 'ตีกลับให้แก้ไข', exact: true }).click();
        await page.getByTestId('officer-reject-reason').fill('ลายมือชื่ออาจารย์ที่ปรึกษายังไม่ครบ กรุณาให้อาจารย์ลงนามแล้วอัปโหลดใหม่');
      });
      // แผงตรวจคำร้องยังเปิดอยู่ (บังปุ่มออกจากระบบ) — ออกผ่าน API
      await page.request.post(`${API_URL}/auth/logout`);

      // เจ้าหน้าที่รับคำร้องผ่านเซิร์ฟเวอร์ (ทางลัด) เพื่อให้หนังสือเข้าคิวคณบดี
      await apiLoginAs(request, 'staff1');
      const approved5 = await officerApprove(request, form5, { document_no: 'อว 0656.10/ตัวอย่าง-005' });
      expect(approved5.status(), await approved5.text()).toBe(200);
      const letter5 = await coverLetterDocId();
      await loginAs(page, 'dean1');
      await shoot('x20-dean-return-letter', 'คณบดี', 'หนังสือรอลงนาม — กดส่งกลับเจ้าหน้าที่ ต้องพิมพ์เหตุผล พิมพ์แล้ว ยังไม่กดยืนยัน (ถ่ายเฉพาะส่วนที่เห็นบนจอ)', async () => {
        await page.goto('/dashboard');
        await page.getByTestId(`dean-doc-row-${letter5}`).getByTestId('dean-doc-preview').click({ timeout: 20_000 });
        await page.getByTestId('dean-return-open').click();
        await page.getByTestId('dean-return-reason').fill('เลขที่หนังสือไม่ตรงกับทะเบียนคุม กรุณาตรวจและออกหนังสือใหม่');
      }, false);
      // กล่องส่งกลับยังเปิดอยู่ (บังปุ่มออกจากระบบ) — ออกผ่าน API
      await page.request.post(`${API_URL}/auth/logout`);

      // ───────── x09 / x10 บันทึกข้อความนักศึกษา (บันทึกถูกเพิ่มไว้แล้วข้างบน) ─────────
      await loginAs(page, 'advisor1');
      await shoot('x09-faculty-memos', 'อาจารย์ที่ปรึกษา', 'เมนู "บันทึกข้อความนักศึกษา" — มีบันทึกที่นักศึกษายื่นแล้ว 2 ใบ (ทางลัด: เพิ่มบันทึกทางฐาน)', async () => {
        await open(page, 'memos', 'advisor');
      });
      await shoot('x22-personnel-profile', 'อาจารย์', 'เมนู "การตั้งค่าโปรไฟล์" ของบุคลากร (อาจารย์) — ข้อมูลที่กรอกแล้ว', async () => {
        await open(page, 'profile', 'advisor');
      });

      // ───────── x06 หน้าแรกฝ่ายนิเทศ ─────────
      // พี่เลี้ยงที่นักศึกษาระบุแล้วรออาจารย์นิเทศยืนยัน + โครงร่างที่พี่เลี้ยงเห็นชอบแล้ว (ทางลัดทางฐาน)
      await dbExec('DELETE FROM official_documents WHERE student_id = $1', [student4]);
      await dbExec('DELETE FROM supervision_appointments WHERE student_id = $1', [student4]);
      await dbExec('DELETE FROM intent_forms WHERE student_id = $1', [student4]);
      const waitingMentor = (await dbValue<number>(
        `INSERT INTO users (email, password_hash, is_active) VALUES ('mentor3@example.com', NULL, FALSE) RETURNING user_id`
      ))!;
      await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'mentor')`, [waitingMentor]);
      await dbExec(
        `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
         VALUES ($1, $2, 'ประเสริฐ ใจงาม', 'Senior Engineer', 'ฝ่ายพัฒนา', '0811112222')`,
        [waitingMentor, companyId]
      );
      await dbExec(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date, end_date)
         VALUES ($1, $2, $3, 'accepted', $4, ${TODAY} - 5, ${TODAY} + 106)`,
        [student4, companyId, semId, waitingMentor]
      );
      await dbExec('UPDATE students SET advisor_id = $2, supervisor_id = $2 WHERE student_id = $1', [student4, advisorId]);
      await dbExec(`UPDATE report_outlines SET status = 'pending_advisor' WHERE student_id = $1`, [student1]);
      await shoot('x06-supervisor-home', 'อาจารย์นิเทศ', 'หน้าแรกฝ่ายนิเทศ — กองงาน "พี่เลี้ยงรอยืนยัน" และ "โครงร่างรอเห็นชอบ" (ทางลัด: พี่เลี้ยงรอยืนยัน/สถานะโครงร่างทางฐาน)', async () => {
        await open(page, 'dashboard', 'supervisor');
      });

      // ───────── x08 นักศึกษาในสาขา (อาจารย์ที่ปรึกษา) ─────────
      await shoot('x08-advisor-students', 'อาจารย์ที่ปรึกษา', 'เมนู "นักศึกษาในสาขา" — ตารางนักศึกษาหลายสถานะ (ปฏิบัติงานอยู่ · รอพี่เลี้ยงยืนยัน)', async () => {
        await open(page, 'students', 'advisor');
      });
      await logout(page);

      // ───────── x07 หน้าแรกหัวหน้าสาขา (มีนักศึกษารอจัดสรร) ─────────
      await dbExec('UPDATE students SET advisor_id = NULL, supervisor_id = NULL WHERE student_id = ANY($1::int[])', [[student3, student4]]);
      await loginAs(page, 'head1');
      await shoot('x07-depthead-home', 'หัวหน้าสาขา', 'หน้าแรกหัวหน้าสาขา — มีนักศึกษารอจัดสรรอาจารย์ (ทางลัด: ถอนการจัดสรรของนักศึกษา 2 คนทางฐาน)', async () => {
        await open(page, 'dashboard');
      });
      await logout(page);

      // ───────── x10 บันทึกข้อความนักศึกษา (คณบดี) ─────────
      await loginAs(page, 'dean1');
      await shoot('x10-dean-memos', 'คณบดี', 'เมนู "บันทึกข้อความนักศึกษา" — มีบันทึกที่นักศึกษายื่นแล้ว 2 ใบ', async () => {
        await open(page, 'memos');
      });
      await logout(page);
    } finally {
      if (failures.length > 0) console.log(['[thesis-extra] ภาพที่ไม่สำเร็จ:', ...failures].join('\n'));
      await walk.finish();
    }
    expect(failures, `ภาพที่ถ่ายไม่สำเร็จ:\n${failures.join('\n')}`).toEqual([]);
  });
});
