import { test, expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import zlib from 'zlib';
import path from 'path';
import { seedTestData } from '../helpers/test-seeder';
import { seedDemo } from '../../backend/src/db/seedDemo';
import { API_URL } from '../helpers/env';
import { loginAs, apiLoginAs } from '../helpers/auth';
import { logout } from '../helpers/nav';
import { dbExec, dbValue } from '../helpers/db';
import { createWalk } from '../helpers/walkthrough';

/**
 * Walkthrough: ภาพหน้าจอสำหรับบทที่ 4 ของเล่มภาคนิพนธ์ — 26 ภาพที่ `placement-journey` / `login-cases` ยังไม่มี
 *
 * ชื่อไฟล์ = เลขภาพในเล่ม (`4.11.png` …) วางแทนกรอบ "[รอภาพหน้าจอ]" ได้ตรงตัว
 * ผลลัพธ์: `เอกสาร/walkthrough/thesis-screens/` (+ index.html)
 *
 * ข้อมูล = ชุดเดโม `seedDemo` (นักศึกษากลางทางฝึก) + เติมช่องว่างทางฐาน — ทางลัดทั้งหมดบอกไว้ใน caption
 * ⛔ ข้อมูลทั้งหมดเป็นของปลอม · รีเซ็ตฐานเหมือน E2E ทุกครั้งที่รัน · ห้ามรันซ้อนกับ E2E ชุดเต็ม
 *
 * ทำเป็นเคสเดียวแต่แต่ละภาพห่อด้วย `shoot()` — ภาพไหนพังจดไว้แล้วถ่ายภาพถัดไปต่อ (รอบเดียวเห็นครบว่าตกที่ไหน)
 * `THESIS_ONLY=4.11,4.22` = ถ่ายเฉพาะบางภาพ (ไม่ล้างภาพเดิม · แต่ขั้นเตรียมข้อมูลยังรันครบ)
 */

const FIXTURES = path.resolve(__dirname, '../fixtures');
const ONLY = (process.env.THESIS_ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** ไปที่เมนูของฝ่ายนั้นตรงๆ ผ่าน URL (ทุกหน้าจอมี URL ของตัวเอง) แล้วรอจนไม่มี skeleton */
async function open(page: Page, menu: string, role?: string): Promise<void> {
  await page.goto(`/dashboard?${role ? `role=${role}&` : ''}menu=${menu}`);
  await page.getByTestId('screen-loading').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
}

/** PNG จริง 240x240 (หัวกับไหล่บนพื้นไล่สี) — fixture `mock_evidence.png` เป็นแค่ magic bytes เบราว์เซอร์วาดไม่ออก */
function makeAvatarPng(): string {
  const W = 240;
  const H = 240;
  const stride = W * 4 + 1;
  const raw = Buffer.alloc(stride * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * stride + 1 + x * 4;
      let rgb = [190 + Math.round((y / H) * 40), 210 + Math.round((y / H) * 25), 240];
      if ((x - 120) ** 2 + (y - 95) ** 2 < 45 ** 2) rgb = [232, 190, 160];
      else if ((x - 120) ** 2 / 95 ** 2 + (y - 250) ** 2 / 95 ** 2 < 1) rgb = [51, 78, 140];
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
      raw[o + 3] = 255;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const file = path.join(os.tmpdir(), `thesis-avatar-${process.pid}.png`);
  fs.writeFileSync(file, png);
  return file;
}

const KEYS_15 = [
  'academic_ability', 'learn_and_apply', 'practical_ability', 'judgment_decision',
  'organization_planning', 'communication_skills', 'foreign_language_culture', 'job_suitability',
  'responsibility_dependability', 'interest_in_work', 'initiative_self_starter',
  'response_to_supervision', 'personality', 'interpersonal_skills',
  'discipline_adaptability', 'ethics_morality',
];
const KEYS_16 = [
  'topic_selection', 'chapter1', 'chapter2', 'chapter3', 'chapter4', 'content_overall',
  'language_use', 'table_of_contents', 'bibliography_citation', 'completeness',
  'format_correctness', 'time_appropriateness', 'illustrations', 'overall_report',
];

/** คะแนนของพี่เลี้ยง — เลขคละกัน (ไม่เต็มทุกข้อ) ให้ตารางดูเป็นของจริง */
function evalScores15(): Record<string, number | string> {
  const s: Record<string, number | string> = {
    work_quantity: 8,
    work_quality: 9,
    strength: 'เรียนรู้เร็ว รับผิดชอบงานที่ได้รับมอบหมาย ทำงานเป็นทีมได้ดี',
    improvement: 'ควรกล้าสอบถามและเสนอความคิดเห็นมากขึ้น',
    other_comments: 'ผลงานเป็นที่น่าพอใจ',
    would_hire: 'accept',
  };
  const v = [5, 4, 4, 5, 3, 4, 3, 4, 5, 5, 4, 4, 5, 4, 5, 5];
  KEYS_15.forEach((k, i) => (s[k] = v[i]));
  return s;
}

function evalScores16(): Record<string, number | string> {
  const s: Record<string, number | string> = {
    report_title_th: 'การลดเวลาจัดทำรายงานรอบการผลิตด้วยระบบดึงข้อมูลอัตโนมัติ',
    report_title_en: 'Reducing Production Report Preparation Time with Automated Data Extraction',
    other_comments: 'รูปเล่มเรียบร้อย เนื้อหาตรงกับงานที่ปฏิบัติจริง',
  };
  const v = [4, 4, 3, 4, 5, 4, 4, 5, 3, 4, 4, 5, 4, 4];
  KEYS_16.forEach((k, i) => (s[k] = v[i]));
  return s;
}

async function postEvaluations(request: APIRequestContext, studentId: number, withReport16: boolean): Promise<void> {
  const forms: [string, Record<string, number | string>][] = [['sahatkit_15', evalScores15()]];
  if (withReport16) forms.push(['sahatkit_16', evalScores16()]);
  for (const [formCode, scoresDetail] of forms) {
    const res = await request.post(`${API_URL}/final-evaluations`, { data: { studentId, formCode, scoresDetail } });
    expect(res.status(), await res.text()).toBe(200);
  }
}

const uid = (email: string) => dbValue<number>('SELECT user_id FROM users WHERE email = $1', [email]) as Promise<number>;
const TODAY = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`;

test.describe('walkthrough: ภาพหน้าจอบทที่ 4', () => {
  test('thesis-screens', async ({ page, request }) => {
    test.setTimeout(900_000);
    const walk = createWalk('thesis-screens', 'ภาพหน้าจอบทที่ 4 — 26 ภาพที่ยังไม่มีในชุดเดิม', {
      keep: ONLY.length > 0,
      notes: [
        'ชื่อไฟล์ = เลขภาพในเล่ม (4.11.png …) · 4.61a/4.61b และ 4.64a/4.64b เป็นสองภาพ',
        'ข้อมูลทั้งหมดเป็นของปลอม (@test.com / @example.com) · ฐานถูกรีเซ็ตแล้วลงชุดเดโม (seedDemo) ก่อนถ่าย',
        'ทางลัดทางฐาน (ไม่ผ่านหน้าจอ): สถานะโครงร่างรายงาน · นัดนิเทศ · เล่มรายงานฉบับสมบูรณ์ของ student1 · วันสิ้นสุดการปฏิบัติงานเมื่อวาน · นักศึกษารุ่นเพิ่ม 9 คน · พี่เลี้ยงเพิ่ม 2 คน · ทำเนียบ 6 แห่ง · ข่าว 3 เรื่อง · ปฏิทินครบ 9 กิจกรรม',
        'คะแนนสหกิจ 15/16 ส่งผ่านเซิร์ฟเวอร์จริงในฐานะพี่เลี้ยง (POST /final-evaluations)',
        '4.23 แจ้งที่พัก: แผนที่ Google ถูกดักไว้ ไม่โหลดตอนทดสอบ ภาพเป็นฟอร์มอย่างเดียว (ช่องแผนที่ขึ้น "กำลังโหลดแผนที่…")',
        '4.49 ลายมือชื่อคณบดี: ลายเส้นวาดด้วยเมาส์จำลองแล้วบันทึกหนึ่งครั้ง (ช่องตัวอย่างจึงมีภาพ) จากนั้นวาดซ้ำให้เห็นลายเส้นในกรอบ',
        '4.74 แบบประเมิน สหกิจ 15: กรอกบางข้อและยังไม่กดส่ง',
        'หน้าตาตรงตามระบบปัจจุบัน — ชื่อเมนูใน caption ใช้ตามของจริง ไม่พบเมนูที่ชื่อต่างจากคำอธิบายในใบสั่ง',
      ],
    });
    walk.watch(page);

    const failures: string[] = [];
    const shoot = async (id: string, who: string, caption: string, prep: () => Promise<void>) => {
      if (ONLY.length > 0 && !ONLY.includes(id.replace(/[ab]$/, '')) && !ONLY.includes(id)) return;
      try {
        await prep();
        await walk.step(page, who, caption, { file: `${id}.png` });
      } catch (err) {
        failures.push(`${id}: ${(err as Error).message.split('\n')[0]}`);
      }
    };

    try {
      // แผนที่ถูกดักไว้ — ภาพ 4.23 เห็นฟอร์มที่พักอย่างเดียว (ข้อความแทนแผนที่)
      await page.route('**/maps.googleapis.com/**', (route) => route.abort());
      await seedTestData();
      // ชุด E2E baseline ไม่ให้ staff1 มีโปรไฟล์ — ภาพต้องเหมือนเจ้าหน้าที่จริง (SQL เดียวกับ placement-journey)
      await dbExec(
        `INSERT INTO personnel (personnel_id, major_id, status, first_name, last_name)
         SELECT user_id, (SELECT major_id FROM master_major LIMIT 1), 'approved', 'สมใจ', 'เจ้าหน้าที่ดี'
           FROM users WHERE email = 'staff1@test.com'
         ON CONFLICT (personnel_id) DO NOTHING`
      );
      await seedDemo({ quiet: true });
      await page.request.post(`${API_URL}/auth/logout`);

      const mentorId = await uid('mentor1@test.com');
      const student1 = await uid('student1@test.com');
      const student2 = await uid('student2@test.com');

      // ───────────────────────── นักศึกษา (student2 · ฝึกสัปดาห์ที่ 6) ─────────────────────────
      await loginAs(page, 'student2');

      await shoot('4.11', 'นักศึกษา', 'ข้อมูลส่วนตัว — ฟอร์มที่กรอกแล้ว มีรูปโปรไฟล์และไฟล์ประวัติย่อ (ทางลัด: ไฟล์จำลอง)', async () => {
        await open(page, 'profile');
        await page.getByTestId('profile-avatar-input').setInputFiles(makeAvatarPng());
        await page.getByTestId('profile-resume-input').setInputFiles(path.join(FIXTURES, 'mock_official_letter.pdf'));
        await page.locator('textarea').first().fill('พัฒนาเว็บด้วย React และ Node.js · เขียน SQL ระดับใช้งานจริง · เคยเป็นกรรมการชมรมคอมพิวเตอร์');
        await page.getByTestId('profile-save').click();
        await expect(page.getByText(/บันทึก.*(สำเร็จ|เรียบร้อย)/).first()).toBeVisible({ timeout: 15_000 });
      });

      await shoot('4.22', 'นักศึกษา', 'ใบสมัครงานสหกิจ (สหกิจ 03) — กรอกแล้วบางส่วน', async () => {
        await open(page, 'job_application');
        await page.getByTestId('ca-first-en').fill('Somchai');
        await page.getByTestId('ca-mobile').fill('0891234567');
        await page.getByTestId('ca-father-name').fill('นายสมบัติ ใจดี');
        await page.getByTestId('ca-education-add').click();
        await page.getByTestId('ca-education-0-institution').fill('โรงเรียนนครราชสีมาวิทยา');
        await page.getByTestId('ca-education-0-degree').fill('มัธยมศึกษาตอนปลาย');
        await page.getByTestId('ca-emg-name').fill('นางสมศรี ใจดี');
        await page.getByTestId('ca-career').fill('อยากเป็นนักพัฒนาระบบสารสนเทศ');
        await page.getByTestId('ca-submit').click();
        await page.waitForTimeout(1200);
      });

      await shoot('4.23', 'นักศึกษา', 'แจ้งที่พัก (สหกิจ 06) — ฟอร์มที่พัก (ทางลัด: แผนที่ถูกดักไว้ ไม่โหลดตอนทดสอบ ภาพเป็นฟอร์มอย่างเดียว)', async () => {
        await dbExec(
          `UPDATE students SET emergency_contact_name = 'นางสมศรี ใจดี', emergency_relationship = 'มารดา',
                  emergency_phone = '0898765432' WHERE student_id = $1`,
          [student2]
        );
        await open(page, 'accommodation_plan');
        await page.getByTestId('acc-province').selectOption('นครราชสีมา');
        await page.getByTestId('acc-district').selectOption({ index: 1 });
        await page.getByTestId('acc-subdistrict').selectOption({ index: 1 });
        await page.getByTestId('acc-house-no').fill('199/8');
        await page.getByTestId('acc-building').fill('หอพักบ้านสวน');
        await page.getByTestId('acc-room-no').fill('502');
        await page.getByTestId('acc-mobile').fill('0891234567');
        await page.getByTestId('acc-save').click();
        await page.waitForTimeout(1200);
      });

      await shoot('4.27', 'นักศึกษา', 'บันทึกการปฏิบัติงาน — แท็บรายสัปดาห์ มีสัปดาห์ที่ส่งแล้ว และสัปดาห์ที่พี่เลี้ยงรับรองแล้ว', async () => {
        await open(page, 'weekly_log');
        const tab = page.getByRole('tab', { name: /รายสัปดาห์/ });
        if (await tab.isVisible().catch(() => false)) await tab.click();
      });

      await shoot('4.31', 'นักศึกษา', 'บันทึกถึงคณบดี — ฟอร์มยื่นบันทึก มีรายการที่ยื่นแล้ว 1 ใบ', async () => {
        await open(page, 'memos');
        await page.locator('#memo-type').selectOption('change_company');
        await page.locator('#memo-reason').fill('บริษัทเดิมยกเลิกการรับนักศึกษาเข้าปฏิบัติงานกะทันหัน จึงขอเปลี่ยนสถานประกอบการ');
        await page.getByRole('button', { name: 'บันทึกและเตรียมพิมพ์' }).click();
        await page.getByTestId('memo-confirm').click();
        await expect(page.getByTestId('memo-row')).toHaveCount(1);
      });
      await logout(page);

      // ───────────────────────── student1 · โครงร่าง (รอพี่เลี้ยง) ─────────────────────────
      await loginAs(page, 'student1');
      await shoot('4.28', 'นักศึกษา', 'โครงร่างรายงาน — ส่งแล้ว สถานะรอพี่เลี้ยงตรวจ', async () => {
        await open(page, 'report_outline');
      });
      await logout(page);

      // ───────────────────────── พี่เลี้ยง mentor1 ─────────────────────────
      await loginAs(page, 'mentor1');
      await shoot('4.72', 'พี่เลี้ยง', 'รับรองงานนักศึกษา — มีบันทึกรอรับรอง', async () => {
        await open(page, 'certify');
      });
      await shoot('4.73', 'พี่เลี้ยง', 'ตรวจโครงร่างรายงาน — มีโครงร่างรอตรวจ', async () => {
        await open(page, 'report_outlines');
      });
      await shoot('4.74', 'พี่เลี้ยง', 'แบบประเมินนักศึกษา — ฟอร์มสหกิจ 15 กรอกไปบางข้อ (ยังไม่กดส่ง)', async () => {
        await open(page, 'final_evaluation');
        await page.getByRole('button', { name: /สมชาย สายดี/ }).click();
        const some: Record<string, string> = {
          work_quantity: '8', work_quality: '9', academic_ability: '5', learn_and_apply: '4',
          practical_ability: '4', judgment_decision: '5', organization_planning: '3',
          communication_skills: '4', responsibility_dependability: '5', interest_in_work: '5',
        };
        for (const [key, v] of Object.entries(some)) await page.locator(`#select-${key}`).selectOption(v);
        await page.locator('#strength').fill('เรียนรู้เร็ว รับผิดชอบงานที่ได้รับมอบหมาย ทำงานเป็นทีมได้ดี');
      });
      await logout(page);

      // ───────────────────────── ทางลัดทางฐาน: เดินสถานะโครงร่าง / นัดนิเทศ ─────────────────────────
      // โครงร่างของ student1: พี่เลี้ยงเห็นชอบแล้ว รออาจารย์นิเทศ (แทนการกดอนุมัติของพี่เลี้ยง)
      await dbExec(`UPDATE report_outlines SET status = 'pending_advisor', updated_at = NOW() - INTERVAL '2 days' WHERE student_id = $1`, [student1]);
      await dbExec(
        `UPDATE report_outline_versions SET reviewed_by = $2
          WHERE outline_id = (SELECT outline_id FROM report_outlines WHERE student_id = $1)`,
        [student1, mentorId]
      );
      const advisorId = await uid('advisor1@test.com');
      const companyId = (await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1'))!;
      // นัดนิเทศ: student1 ตอบรับแล้ว · student2 รอพี่เลี้ยงตอบ
      await dbExec(
        `INSERT INTO supervision_appointments (advisor_id, student_id, company_id, appointment_date, student_time, mentor_time, tour_requested, status)
         VALUES ($1, $2, $4, ${TODAY} + 9, '09:30', '10:00', TRUE, 'accepted'),
                ($1, $3, $4, ${TODAY} + 14, '13:30', '14:00', FALSE, 'pending_company')`,
        [advisorId, student1, student2, companyId]
      );

      // ───────────────────────── อาจารย์นิเทศ / ที่ปรึกษา (advisor1) ─────────────────────────
      await loginAs(page, 'advisor1');
      await shoot('4.38', 'อาจารย์นิเทศ', 'เห็นชอบโครงร่าง (สหกิจ 11) — โครงร่างที่พี่เลี้ยงเห็นชอบแล้ว รออาจารย์', async () => {
        await open(page, 'report_outlines', 'supervisor');
      });
      await shoot('4.39', 'อาจารย์นิเทศ', 'นัดหมายนิเทศ (สหกิจ 12) — มีนัดหมาย 2 รายการ', async () => {
        await open(page, 'supervision', 'supervisor');
      });
      await shoot('4.40', 'อาจารย์นิเทศ', 'บันทึกการนิเทศ (สหกิจ 13) — เลือกนักศึกษาแล้ว เห็นข้อประเมิน', async () => {
        await open(page, 'supervision_record', 'supervisor');
        await page.locator('select').filter({ hasText: 'เลือกนักศึกษา' }).first().selectOption({ index: 1 });
      });

      // โครงร่างอนุมัติครบ + เล่มรายงานฉบับสมบูรณ์ของ student1 รออาจารย์ที่ปรึกษาตรวจรับ (สหกิจ 14)
      await dbExec(`UPDATE report_outlines SET status = 'approved' WHERE student_id = $1`, [student1]);
      await dbExec(
        `UPDATE report_outline_versions SET status = 'approved'
          WHERE outline_id = (SELECT outline_id FROM report_outlines WHERE student_id = $1)`,
        [student1]
      );
      await dbExec(
        `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind, submitted_at)
         VALUES ($1, $2, 'submitted', 3, 'advisor', NOW() - INTERVAL '1 day')`,
        [student1, `final_reports/finalreport-user-${student1}-demo-final.pdf`]
      );
      // คะแนนสหกิจ 15 · 16 ของพี่เลี้ยง (ผ่านเซิร์ฟเวอร์จริง) + สิ้นสุดช่วงปฏิบัติงานเมื่อวาน (ผลประเมินเปิดดูได้)
      await apiLoginAs(request, 'mentor1');
      await postEvaluations(request, student1, true);
      await postEvaluations(request, student2, false);
      await dbExec(
        `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date, created_by)
         SELECT s.semester_id, 'coop_end', 'single', ${TODAY} - 1, ${TODAY} - 1, u.user_id
           FROM coop_semesters s CROSS JOIN users u
          WHERE s.is_active = TRUE AND u.email = 'staff1@test.com' LIMIT 1
         ON CONFLICT (semester_id, activity_key) WHERE activity_key IS NOT NULL DO UPDATE
            SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`
      );
      await shoot('4.34', 'อาจารย์ที่ปรึกษา', 'ตรวจรับเล่มรายงาน (สหกิจ 14) — เล่มของนักศึกษารอตรวจ (ทางลัด: ไฟล์เล่มเป็นแถวจำลอง)', async () => {
        await open(page, 'final_evaluation', 'advisor');
        await page.getByText('สมหญิง ใจดี').first().click();
      });
      await shoot('4.41', 'อาจารย์นิเทศ', 'นักศึกษาที่ฉันนิเทศ — ตารางที่เห็นคอลัมน์คะแนนสหกิจ 15 และ 16', async () => {
        await open(page, 'students', 'supervisor');
      });
      await logout(page);

      // ───────────────────────── นักศึกษา: เล่มรายงาน + ผลประเมิน ─────────────────────────
      await loginAs(page, 'student1');
      await shoot('4.29', 'นักศึกษา', 'รายงานฉบับสมบูรณ์ — หน้าอัปโหลด หลังโครงร่างอนุมัติแล้ว', async () => {
        await open(page, 'final_report');
      });
      await shoot('4.30', 'นักศึกษา', 'ผลประเมิน — เปิดให้ดูแล้ว (หลังสิ้นสุดช่วงฝึก) มีคะแนนสหกิจ 15 และ 16', async () => {
        await open(page, 'evaluation_result');
      });
      await logout(page);

      // ───────────────────────── นักศึกษาในรุ่นเพิ่ม (ทางลัดทางฐาน) — ให้ท่อสถานะ/ตารางติดตามมีหลายขั้นตอน ─────────────────────────
      const semEarly = (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'))!;
      const majorEarly = (await dbValue<number>('SELECT major_id FROM students WHERE student_id = $1', [student2]))!;
      const cohort: {
        first: string; last: string; status?: string; mentor?: boolean; start?: number; end?: number;
        cover?: ['pending_sign' | 'signed', number]; mailAge?: number; created?: number; evals?: number; report?: boolean;
      }[] = [
        { first: 'พิมพ์ชนก', last: 'วงศ์สว่าง' },
        { first: 'กฤษดา', last: 'มีสุข', status: 'pending_officer_request', created: 9 },
        { first: 'ณัฐธิดา', last: 'บุญมา', status: 'approved_by_dept_head', cover: ['pending_sign', 3] },
        { first: 'ธีรภัทร', last: 'พรหมวงศ์', status: 'approved_by_dept_head', cover: ['signed', 14], mailAge: 12 },
        { first: 'อรุณี', last: 'แสงทอง', status: 'pending_officer_approval', mentor: true },
        { first: 'ภานุพงศ์', last: 'ใจเย็น', status: 'accepted', mentor: true, start: 30, end: 140 },
        { first: 'ศิริพร', last: 'ทองคำ', status: 'accepted', mentor: true, start: -120, end: -5, evals: 1 },
        { first: 'วรพล', last: 'สุขสวัสดิ์', status: 'company_rejected' },
        { first: 'ปวีณา', last: 'รักษาพล', status: 'accepted', mentor: true, start: -120, end: -5, evals: 2, report: true },
      ];
      const earlyCompany = (await dbValue<number>('SELECT company_id FROM companies ORDER BY company_id LIMIT 1'))!;
      for (const [i, c] of cohort.entries()) {
        const code = `6401019${String(10 + i).padStart(2, '0')}`;
        const nid = (await dbValue<number>(
          `INSERT INTO users (email, password_hash) VALUES ($1, NULL) RETURNING user_id`,
          [`cohort${i + 1}@example.com`]
        ))!;
        await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student')`, [nid]);
        await dbExec(
          `INSERT INTO students (student_id, student_code, major_id, cumulative_gpa, enrollment_year, first_name, last_name, year_level)
           VALUES ($1, $2, $3, 3.1, 2569, $4, $5, 3)`,
          [nid, code, majorEarly, c.first, c.last]
        );
        await dbExec(`INSERT INTO semester_cohort (semester_id, student_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [semEarly, code]);
        if (!c.status) continue;
        const docNo = c.cover ? `ศธ 0590/COH-${i + 1}` : null;
        await dbExec(
          `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, officer_document_no, start_date, end_date,
                                     company_mail_sent_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6,
                   CASE WHEN $7::int IS NULL THEN NULL ELSE ${TODAY} + $7::int END,
                   CASE WHEN $8::int IS NULL THEN NULL ELSE ${TODAY} + $8::int END,
                   CASE WHEN $9::int IS NULL THEN NULL ELSE NOW() - $9::int * INTERVAL '1 day' END,
                   NOW() - $10::int * INTERVAL '1 day')`,
          [nid, earlyCompany, semEarly, c.status, c.mentor ? mentorId : null, docNo,
           c.start ?? null, c.end ?? null, c.mailAge ?? null, c.created ?? 20]
        );
        if (c.cover) {
          await dbExec(
            `INSERT INTO official_documents (document_number, type, student_id, company_id, status, dean_signature_date, created_at)
             VALUES ($1, 'cover_letter', $2, $3, $4::text,
                     CASE WHEN $4::text = 'signed' THEN NOW() - $5::int * INTERVAL '1 day' END, NOW() - $5::int * INTERVAL '1 day')`,
            [docNo, nid, earlyCompany, c.cover[0], c.cover[1]]
          );
        }
        for (const form of ['sahatkit_15', 'sahatkit_16'].slice(0, c.evals ?? 0)) {
          await dbExec(
            `INSERT INTO final_evaluations (student_id, evaluator_role, form_code, scores_detail, total_score)
             VALUES ($1, 'mentor', $2, '{}', 78)`,
            [nid, form]
          );
        }
        if (c.report) {
          await dbExec(
            `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind)
             VALUES ($1, 'final_reports/demo-cohort.pdf', 'approved', 1, 'advisor')`,
            [nid]
          );
        }
      }

      // ───────────────────────── หัวหน้าสาขา ─────────────────────────
      await loginAs(page, 'head1');
      await shoot('4.43', 'หัวหน้าสาขา', 'จัดสรรอาจารย์ที่ปรึกษา & นิเทศ — ตารางนักศึกษาพร้อมช่องเลือกอาจารย์', async () => {
        await open(page, 'assignment');
      });
      await shoot('4.44', 'หัวหน้าสาขา', 'ติดตามเอกสาร & ผลประเมิน — ตารางที่มีนักศึกษาหลายสถานะ', async () => {
        await open(page, 'final_progress');
      });
      await logout(page);

      // ───────────────────────── คณบดี ─────────────────────────
      await loginAs(page, 'dean1');
      await shoot('4.49', 'คณบดี', 'ลายมือชื่อสำหรับหนังสือราชการ — กรอบวาดที่มีลายเส้นแล้ว (ทางลัด: ลายเส้นวาดด้วยเมาส์จำลอง)', async () => {
        await open(page, 'signature');
        const pad = page.getByTestId('dean-signature-pad');
        const strokes: [number, number][][] = [
          [[0.12, 0.65], [0.2, 0.3], [0.28, 0.7], [0.36, 0.28], [0.44, 0.62]],
          [[0.44, 0.62], [0.55, 0.35], [0.62, 0.7], [0.7, 0.32], [0.82, 0.58], [0.9, 0.45]],
          [[0.15, 0.8], [0.45, 0.76], [0.85, 0.82]],
        ];
        const draw = async () => {
          await pad.scrollIntoViewIfNeeded();
          const box = (await pad.boundingBox())!;
          const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
          for (const stroke of strokes) {
            const first = at(stroke[0][0], stroke[0][1]);
            await page.mouse.move(first.x, first.y);
            await page.mouse.down();
            for (const [fx, fy] of stroke.slice(1)) {
              const p = at(fx, fy);
              await page.mouse.move(p.x, p.y, { steps: 12 });
            }
            await page.mouse.up();
          }
        };
        // บันทึกครั้งหนึ่งก่อน — ช่อง "ที่จะถูกพิมพ์ลงหนังสือ" จะมีภาพจริง (ไฟล์จำลองของ seed ไม่มีบนดิสก์) แล้ววาดใหม่ให้เห็นลายเส้นในกรอบ
        await draw();
        await page.getByRole('button', { name: 'บันทึกลายมือชื่อ' }).click();
        const confirm = page.getByRole('dialog').getByRole('button', { name: /ยืนยัน|แทนที่|ตกลง/ }).last();
        if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) await confirm.click();
        await page.waitForTimeout(1500);
        await page.getByRole('button', { name: 'ล้าง', exact: true }).click().catch(() => {});
        await draw();
      });
      await logout(page);

      // ───────────────────────── ข้อมูลเสริมของฝั่งเจ้าหน้าที่ (ทางลัดทางฐาน) ─────────────────────────
      const staffId = await uid('staff1@test.com');
      // ทำเนียบ: บริษัทหลายแห่ง ทั้งรับรองแล้วและรอรับรอง
      const companies: [string, string, string, boolean][] = [
        ['บริษัท เอ็นเตอร์ไพรส์ ซอฟต์ จำกัด', 'นครราชสีมา', 'เมืองนครราชสีมา', true],
        ['บริษัท โคราช อินดัสทรีส์ จำกัด', 'นครราชสีมา', 'ปากช่อง', true],
        ['บริษัท อีสเทิร์น เทค โซลูชั่นส์ จำกัด', 'ชลบุรี', 'ศรีราชา', true],
        ['บริษัท สยาม ดิจิทัล เซอร์วิส จำกัด', 'กรุงเทพมหานคร', 'บางรัก', true],
        ['ห้างหุ้นส่วนจำกัด ใจดี คอมพิวเตอร์', 'นครราชสีมา', 'สูงเนิน', false],
        ['บริษัท เวสต์ เอ็กซ์พอร์ต จำกัด', 'สระบุรี', 'แก่งคอย', false],
      ];
      for (const [i, [name, prov, dist, verified]] of companies.entries()) {
        await dbExec(
          `INSERT INTO companies (name_th, address, province, district, postal_code, phone, is_verified, created_by,
                                  contact_person, contact_position, email)
           VALUES ($1, '88/8 ถนนตัวอย่าง', $2, $3, '30000', '044123456', $4, $5, 'คุณสมใจ ฝ่ายบุคคล', 'HR', $6)`,
          [name, prov, dist, verified, staffId, `hr-demo-${i + 1}@example.com`]
        );
      }
      // ข่าวประชาสัมพันธ์
      await dbExec(
        `INSERT INTO announcements (title, content, is_pinned, created_by, created_at) VALUES
           ('กำหนดส่งโครงร่างรายงานสหกิจศึกษา', 'นักศึกษาที่ฝึกอยู่ต้องส่งโครงร่างรายงาน (สหกิจ 11) ภายในสัปดาห์ที่ 4 ของการปฏิบัติงาน กรุณาตรวจสอบกำหนดการที่ปฏิทินสหกิจศึกษา', TRUE, $1, NOW() - INTERVAL '3 days'),
           ('ตารางนิเทศนักศึกษาสหกิจศึกษาประจำภาคเรียน', 'อาจารย์นิเทศจะนัดหมายผ่านระบบ นักศึกษาและพี่เลี้ยงโปรดตอบรับนัดหมายภายใน 3 วันทำการ', FALSE, $1, NOW() - INTERVAL '6 days'),
           ('ปิดรับแบบประเมินจากสถานประกอบการ', 'พี่เลี้ยงโปรดส่งแบบประเมิน สหกิจ 15 และ 16 ภายในสองสัปดาห์หลังสิ้นสุดการปฏิบัติงาน', FALSE, $1, NOW() - INTERVAL '10 days')`,
        [staffId]
      );
      // พี่เลี้ยงหลายสถานะ: mentor2 = ยังไม่เคยเข้าระบบ มีงานค้างและถูกเตือนอัตโนมัติครบ · mentor3 = รออาจารย์นิเทศยืนยัน (บัญชียังปิด)
      const student3 = await uid('student3@test.com');
      const student4 = await uid('student4@test.com');
      const semId = (await dbValue<number>('SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1'))!;
      await dbExec('DELETE FROM official_documents WHERE student_id = ANY($1::int[])', [[student3, student4]]);
      await dbExec('DELETE FROM intent_forms WHERE student_id = ANY($1::int[])', [[student3, student4]]);
      const extraMentors: [string, string, boolean, number][] = [
        ['mentor2@example.com', 'วิไล ตัวอย่างดี', true, student3],
        ['mentor3@example.com', 'ประเสริฐ ใจงาม', false, student4],
      ];
      for (const [email, name, active, studentId] of extraMentors) {
        const mid = (await dbValue<number>(
          `INSERT INTO users (email, password_hash, is_active) VALUES ($1, NULL, $2) RETURNING user_id`,
          [email, active]
        ))!;
        await dbExec(`INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'mentor')`, [mid]);
        await dbExec(
          `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
           VALUES ($1, $2, $3, 'Senior Engineer', 'ฝ่ายพัฒนา', '0811112222')`,
          [mid, companyId, name]
        );
        await dbExec(
          `INSERT INTO intent_forms (student_id, company_id, semester_id, status, mentor_id, start_date, end_date)
           VALUES ($1, $2, $3, 'accepted', $4, ${TODAY} - 30, ${TODAY} + 81)`,
          [studentId, companyId, semId, mid]
        );
        await dbExec('UPDATE students SET advisor_id = $2, supervisor_id = $2 WHERE student_id = $1', [studentId, advisorId]);
        if (active) {
          await dbExec(
            `INSERT INTO weekly_logs (student_id, week_number, status, start_date, end_date, submitted_at, assigned_work)
             VALUES ($1, 1, 'submitted', ${TODAY} - 25, ${TODAY} - 21, NOW() - INTERVAL '20 days', 'งานตัวอย่าง')`,
            [studentId]
          );
          await dbExec(
            `INSERT INTO mentor_reminders (mentor_id, student_id, kind, sent_by, created_at)
             SELECT $1, $2, 'auto', NULL, NOW() - (n * INTERVAL '8 days') FROM generate_series(1, 4) n`,
            [mid, studentId]
          );
        }
      }
      // ปฏิทิน: ตั้งวันครบทุกกิจกรรม (ทำท้ายสุด — ปฏิทินล็อกการทำรายการของนักศึกษาตามช่วงวัน)
      await dbExec(
        `INSERT INTO coop_calendar_events (semester_id, activity_key, date_kind, start_date, end_date, created_by, sort_order)
         SELECT s.semester_id, v.k, v.kind,
                CASE WHEN v.a IS NULL THEN NULL ELSE ${TODAY} + v.a END, ${TODAY} + v.b, $1, v.ord
           FROM coop_semesters s
           CROSS JOIN (VALUES
             ('intent_submission', 'range',    -130, -100, 1),
             ('acceptance_form',   'deadline', NULL,  -60, 2),
             ('accommodation_plan','range',      -75,  -60, 3),
             ('coop_start',        'single',     -50,  -50, 4),
             ('weekly_log',        'range',      -50,   60, 5),
             ('report_outline',    'range',      -50,  -29, 6),
             ('coop_end',          'single',      -1,   -1, 7),
             ('final_report',      'range',        0,   14, 8),
             ('coop_exam',         'single',      30,   30, 9)
           ) AS v(k, kind, a, b, ord)
          WHERE s.is_active = TRUE
         ON CONFLICT (semester_id, activity_key) WHERE activity_key IS NOT NULL DO UPDATE
            SET date_kind = EXCLUDED.date_kind, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
        [staffId]
      );

      // ───────────────────────── เจ้าหน้าที่ ─────────────────────────
      await loginAs(page, 'staff1');
      await shoot('4.58', 'เจ้าหน้าที่', 'ทำเนียบสถานประกอบการ — รายการสถานประกอบการหลายแห่ง', async () => {
        await open(page, 'companies');
      });
      await shoot('4.59', 'เจ้าหน้าที่', 'ติดตามเอกสารนักศึกษา — ตารางสถานะเอกสาร', async () => {
        await open(page, 'final_progress');
      });
      await shoot('4.60', 'เจ้าหน้าที่', 'ปฏิทินสหกิจศึกษา — ปฏิทินที่ตั้งวันแล้ว', async () => {
        await open(page, 'calendar');
      });
      await shoot('4.61a', 'เจ้าหน้าที่', 'รายชื่อนักศึกษา & เกรด', async () => {
        await open(page, 'import');
      });
      await shoot('4.61b', 'เจ้าหน้าที่', 'บัญชี สิทธิ์ และข้อมูลหลัก', async () => {
        await open(page, 'users');
      });
      await shoot('4.62', 'เจ้าหน้าที่', 'ติดตามพี่เลี้ยง — พี่เลี้ยงหลายสถานะ', async () => {
        await open(page, 'mentor_followup');
      });
      await shoot('4.63', 'เจ้าหน้าที่', 'ข่าวประชาสัมพันธ์ — มีข่าวที่ปักหมุด', async () => {
        await open(page, 'announcements');
      });
      await shoot('4.64a', 'เจ้าหน้าที่', 'นักศึกษาตอนนี้', async () => {
        await open(page, 'pipeline');
      });
      await shoot('4.64b', 'เจ้าหน้าที่', 'สรุปภาคเรียน', async () => {
        await open(page, 'semester_summary');
      });
      await logout(page);
    } finally {
      await walk.finish();
    }
    expect(failures, `ภาพที่ถ่ายไม่สำเร็จ:\n${failures.join('\n')}`).toEqual([]);
  });
});
