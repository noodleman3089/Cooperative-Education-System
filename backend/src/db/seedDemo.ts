import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import pool from '../config/database';
import { hashPassword } from '../utils/password';
import { seedDevDemoData } from './setup';
import { COMPANY_WRITABLE_FIELDS } from '../models/jobOffer';
import { createJobOfferToken, jobOfferAnswerUrl } from '../utils/jobOfferToken';
import { createAcceptanceLinkToken } from '../utils/acceptanceLinkToken';
import { issueMentorLoginLink, MENTOR_LINK_TTL_SYSTEM_MS } from '../utils/mentorLoginLink';
import { buildCoverLetterPdf, fetchCoverLetterData, toCoverLetterData } from '../utils/coverLetterPdf';

/**
 * ข้อมูลเดโมสำหรับเปิดหน้าเว็บเทสด้วยมือ — "หนึ่งภาคเรียนที่เดินมาถึงกลางทาง"
 *
 * ทำไมต้องมี: หน้าจอของพี่เลี้ยง/เจ้าหน้าที่เกือบทั้งหมดเป็นการ **ตอบกลับ** สิ่งที่ฝ่ายอื่นสร้างค้างไว้
 * ถ้าฐานว่างทุกหน้าเป็นจอเปล่าเหมือนกันหมดและดูไม่ออกว่าอันไหนถูกอันไหนพัง
 * (แทน `scratch/seed_company.js` ที่เขียนก่อนถอดบทบาท company และตั้งรหัสผ่านพี่เลี้ยงซึ่งขัด SEC-15)
 *
 *   S1  แบบเสนองาน สหกิจ 02  ใบร่างของภาคถัดไป (ก๊อปจากภาคที่แล้ว 2 รายการ) + ลิงก์ `/offer` ที่ใช้ได้ 1 ใบ หมดอายุ 1 ใบ
 *   S2  ลิงก์ตอบรับ `/accept`  นักศึกษา 2 คนที่คณบดีลงนามหนังสือแล้วและส่งถึงบริษัท (รอบริษัทตอบ)
 *   S3  พี่เลี้ยง mentor1 ดูแลนักศึกษา 2 คน (student1 สัปดาห์ที่ 10 · student2 สัปดาห์ที่ 6 จาก 16)
 *   S4  หน้าแรกพี่เลี้ยง "รอคุณรับรอง" ครบ 6 ชนิดตาม `models/mentorQueue.ts`
 *   S5  บันทึกรายวัน/สัปดาห์/เดือน ครบสถานะ: รับรองแล้ว · รอรับรอง · ถูกส่งกลับ
 *   S6  แผนปฏิบัติงานรอพี่เลี้ยงลงนาม (student2 · ค้างเลยกำหนดสัปดาห์ที่ 2 — ตั้งใจให้เห็นป้ายเลยกำหนด)
 *   S7  โครงร่างรายงาน + ร่างรายงาน (student1) ที่ส่งให้พี่เลี้ยงตรวจ
 *   (ไม่มี "หน้าแรกบริษัท" — สถานประกอบการไม่มีบัญชี ตอบผ่านลิงก์สาธารณะอย่างเดียว)
 *
 * ⛔ กติกาที่ไฟล์นี้ต้องไม่ฝ่าฝืน
 *   · พี่เลี้ยงไม่มีรหัสผ่านที่ไหนเลย (SEC-15) — ไม่แตะ `users` ของ mentor1 · ลิงก์เข้าระบบออกผ่าน `issueMentorLoginLink` ตัวจริง
 *   · ไม่เขียนข้อมูลอ่อนไหว SEC-12 (เลขบัตร/เชื้อชาติ/ศาสนา) · ไม่ส่งอีเมล · ไม่ต่อเน็ต
 *   · สถานะใบความจำนงใช้เฉพาะ 'approved_by_dept_head' (S2) กับ 'accepted' (S3) ซึ่งระบบมีจริง
 *
 * รันซ้ำได้: ล้างข้อมูลการฝึกของนักศึกษาเดโม 4 คน (student1 · student2 + สองคนที่เพิ่ม) แล้วลงใหม่ทั้งชุด
 * วันที่นับจาก "วันนี้ตามเวลาไทยของ Postgres" ทุกครั้ง สถานะ "สัปดาห์ที่ 6 จาก 16" จึงจริงเสมอ
 * ⛔ ห้าม `pool.end()` เมื่อถูก import (E2E รันทุกไฟล์ในโปรเซสเดียว) — ปิดเฉพาะตอนรันจากบรรทัดคำสั่ง
 *
 *   npm.cmd run db:seed-demo     (ต้องเคย npm.cmd run db:setup มาก่อน)
 */

const TODAY = `(NOW() AT TIME ZONE 'Asia/Bangkok')::date`;
/** เวลาในอดีต `$n` วันก่อน แต่ไม่เกินหนึ่งชั่วโมงก่อนตอนนี้ (กันเวลาที่ล้ำไปอนาคตของ "วันนี้") */
const agoSql = (param: string): string => `LEAST(NOW() - INTERVAL '1 hour', NOW() - ${param}::int * INTERVAL '1 day')`;

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_DIR = path.resolve(__dirname, '../..');

export interface SeedDemoResult {
  offerLiveUrl: string;
  offerExpiredUrl: string;
  acceptUrls: string[];
  mentorLoginUrl: string | null;
}

const EXTRA_STUDENTS = [
  { email: 'student3@test.com', code: '640101903', first: 'ปาริชาต', last: 'ทองแท้', gpa: 3.42 },
  { email: 'student4@test.com', code: '640101904', first: 'ธนากร', last: 'ศรีสุข', gpa: 3.18 },
];

const MISSING_BASE_ERROR = 'ไม่พบบัญชีพื้นฐาน — รัน npm.cmd run db:setup ก่อน แล้วค่อยรันสคริปต์นี้';

async function userIdOf(c: PoolClient, email: string): Promise<number> {
  const r = await c.query('SELECT user_id FROM users WHERE email = $1', [email]);
  if ((r.rowCount ?? 0) === 0) throw new Error(`${MISSING_BASE_ERROR} (ขาด ${email})`);
  return r.rows[0].user_id as number;
}

/** PDF ว่างหน้าเดียวพร้อมข้อความอังกฤษสั้น ๆ — ให้ลิงก์ดาวน์โหลดเล่มรายงานเปิดได้จริงโดยไม่ต้องพึ่งฟอนต์ไทย */
async function writePlaceholderPdf(file: string, title: string): Promise<void> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 60, y: 760, size: 18, font });
  page.drawText('Sample file created by db:seed-demo (not a real report).', { x: 60, y: 730, size: 11, font });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await doc.save());
}

/** รายการตำแหน่งในแบบเสนองาน — หนึ่งรายการต่อหนึ่งแผ่นของ สหกิจ 02 หน้า 2 */
const OFFER_ITEMS = [
  {
    title: 'Full-Stack Developer',
    quota: 3,
    term: 'full_year',
    desc: 'พัฒนาเว็บแอปพลิเคชันภายในด้วย React และ Node.js ร่วมกับทีมพัฒนา ดูแลการเชื่อมต่อฐานข้อมูลการผลิต และเขียนเอกสารประกอบระบบ',
    skills: 'เขียนโปรแกรมด้วยภาษาใดภาษาหนึ่งได้ · เข้าใจฐานข้อมูลเชิงสัมพันธ์เบื้องต้น · สื่อสารภาษาอังกฤษเชิงเอกสารได้',
    other: 'ปฏิบัติงานที่โรงงานสูงเนิน · แต่งกายตามระเบียบโรงงาน · ไม่ต้องนำคอมพิวเตอร์มาเอง',
    pay: 350,
    unit: 'day',
    accommodation: 'none',
    welfare: 'รถรับส่งพนักงาน · อาหารกลางวันในโรงอาหาร',
    majors: ['CS01', 'IT01', 'CPE01'],
    appliedPublished: 2, // student2 + นักศึกษา S2 คนแรก
  },
  {
    title: 'ผู้ช่วยวิเคราะห์ข้อมูลการผลิต',
    quota: 2,
    term: 'term1',
    desc: 'รวบรวมและวิเคราะห์ข้อมูลรอบการผลิต จัดทำรายงานประจำสัปดาห์เสนอหัวหน้าแผนก',
    skills: 'ใช้ Excel ระดับ Pivot ได้ · มีพื้นฐานสถิติเบื้องต้น',
    other: 'ปฏิบัติงานที่โรงงานสูงเนิน',
    pay: 9000,
    unit: 'month',
    accommodation: 'free',
    welfare: null,
    majors: ['CS01', 'IS01'],
    appliedPublished: 2, // student1 + นักศึกษา S2 คนที่สอง → เต็ม
  },
];

export async function seedDemo(opts: { quiet?: boolean } = {}): Promise<SeedDemoResult> {
  const log = opts.quiet ? () => undefined : (m: string) => console.log(`  ${m}`);

  // ของพื้นฐาน: บริษัทเดโม · mentor1 ผูกบริษัท · โปรไฟล์ staff1 · โปรไฟล์ student1
  await seedDevDemoData();

  const client = await pool.connect();
  let ctx: {
    staffId: number;
    mentorId: number;
    companyId: number;
    companyEmail: string;
    draftOfferId: number;
    s2Forms: { formId: number; studentId: number; studentCode: string; docNo: string }[];
  };

  try {
    await client.query('BEGIN');

    const staffId = await userIdOf(client, 'staff1@test.com');
    const advisorId = await userIdOf(client, 'advisor1@test.com');
    const mentorId = await userIdOf(client, 'mentor1@test.com');
    const student1Id = await userIdOf(client, 'student1@test.com');
    const student2Id = await userIdOf(client, 'student2@test.com');

    const mentorRow = await client.query('SELECT company_id FROM mentors WHERE mentor_id = $1', [mentorId]);
    if ((mentorRow.rowCount ?? 0) === 0) throw new Error('mentor1@test.com ยังไม่มีแถว mentors — รัน db:setup ก่อน');
    const companyId = mentorRow.rows[0].company_id as number;

    const profiles = await client.query(
      'SELECT student_id, major_id FROM students WHERE student_id = ANY($1::int[])',
      [[student1Id, student2Id]]
    );
    if ((profiles.rowCount ?? 0) < 2) throw new Error('student1/student2 ยังไม่มีโปรไฟล์ — รัน db:setup ก่อน');
    const majorId = profiles.rows.find((r) => r.student_id === student2Id)!.major_id as number;

    // ── 1. นักศึกษาเพิ่ม 2 คน (มีรหัสผ่านแบบนักศึกษาปกติ · ไม่มีข้อมูลอ่อนไหว) ──────────────
    const provinceRes = await client.query('SELECT province_id FROM master_province ORDER BY province_id LIMIT 1');
    const provinceId = provinceRes.rows[0]?.province_id ?? null;
    const extraIds: number[] = [];
    for (const s of EXTRA_STUDENTS) {
      const existing = await client.query('SELECT user_id FROM users WHERE email = $1', [s.email]);
      let uid: number;
      if ((existing.rowCount ?? 0) > 0) {
        uid = existing.rows[0].user_id as number;
      } else {
        const ins = await client.query(
          'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id',
          [s.email, await hashPassword('password123')]
        );
        uid = ins.rows[0].user_id as number;
      }
      await client.query(
        `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'student') ON CONFLICT (user_id, role_name) DO NOTHING`,
        [uid]
      );
      await client.query(
        `INSERT INTO students (student_id, student_code, major_id, province_id, cumulative_gpa,
                               first_name, last_name, year_level, phone, advisor_id, supervisor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 3, '0812340000', $8, $8)
         ON CONFLICT (student_id) DO NOTHING`,
        [uid, s.code, majorId, provinceId, s.gpa, s.first, s.last, advisorId]
      );
      await client.query(
        `INSERT INTO eligible_students_list (student_code, cumulative_gpa, email) VALUES ($1, $2, $3)
         ON CONFLICT (student_code) DO UPDATE SET cumulative_gpa = EXCLUDED.cumulative_gpa, email = EXCLUDED.email`,
        [s.code, s.gpa, s.email]
      );
      extraIds.push(uid);
    }
    const [student3Id, student4Id] = extraIds;
    const demoIds = [student1Id, student2Id, student3Id, student4Id];

    // student1/2 ผูกอาจารย์ที่ปรึกษา + อาจารย์นิเทศ (baseline ของ db:setup ไม่ตั้ง)
    await client.query(
      `UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = ANY($2::int[])`,
      [advisorId, [student1Id, student2Id]]
    );

    // ── 2. บริษัท: เติมช่องของ สหกิจ 02 หน้า 1 เฉพาะช่องที่ยังว่าง (ไม่ทับที่เจ้าหน้าที่กรอกเอง) ──
    await client.query(
      `UPDATE companies SET
         email = COALESCE(NULLIF(btrim(email), ''), 'hr@example.com'),
         fax = COALESCE(fax, '044-000-111'),
         business_type = COALESCE(business_type, 'ผลิตชิ้นส่วนอิเล็กทรอนิกส์และระบบจัดเก็บข้อมูล'),
         employee_count = COALESCE(employee_count, 1850),
         manager_name = COALESCE(manager_name, 'วิชัย มั่นคง'),
         manager_position = COALESCE(manager_position, 'ผู้จัดการโรงงาน'),
         manager_department = COALESCE(manager_department, 'ฝ่ายผลิต'),
         manager_phone = COALESCE(manager_phone, '044-000-100'),
         manager_fax = COALESCE(manager_fax, '044-000-101'),
         manager_email = COALESCE(manager_email, 'manager@example.com'),
         contact_department = COALESCE(contact_department, 'ฝ่ายทรัพยากรบุคคล'),
         contact_phone = COALESCE(contact_phone, '044-000-110'),
         contact_fax = COALESCE(contact_fax, '044-000-111'),
         house_no = COALESCE(house_no, '90 หมู่ 15'),
         road = COALESCE(road, 'มิตรภาพ'),
         subdistrict = COALESCE(subdistrict, 'สูงเนิน')
       WHERE company_id = $1`,
      [companyId]
    );
    const companyEmail = (await client.query('SELECT email FROM companies WHERE company_id = $1', [companyId]))
      .rows[0].email as string;

    // ── 3. ภาคเรียน: ภาคที่กำลังฝึก (is_active) และภาคถัดไปที่กำลังสำรวจ ──────────────────
    const cur = (await client.query(
      `SELECT semester_id, academic_year, semester FROM coop_semesters
        WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1`
    )).rows[0];
    if (!cur) throw new Error('ไม่มีภาคเรียนที่ is_active — รัน db:setup ก่อน');
    const nextYear = cur.semester === '1' ? cur.academic_year : cur.academic_year + 1;
    const nextTerm = cur.semester === '1' ? '2' : '1';
    let nextSem = (await client.query(
      'SELECT semester_id FROM coop_semesters WHERE academic_year = $1 AND semester = $2',
      [nextYear, nextTerm]
    )).rows[0];
    if (!nextSem) {
      nextSem = (await client.query(
        `INSERT INTO coop_semesters (academic_year, semester, is_active) VALUES ($1, $2, FALSE) RETURNING semester_id`,
        [nextYear, nextTerm]
      )).rows[0];
    }
    const curSemId = cur.semester_id as number;
    const nextSemId = nextSem.semester_id as number;

    // ── 4. ล้างของเดิมของนักศึกษาเดโมก่อนลงใหม่ ────────────────────────────────────────────
    for (const sql of [
      'DELETE FROM report_confirmations WHERE student_id = ANY($1::int[])',
      'DELETE FROM final_reports WHERE student_id = ANY($1::int[])',
      'DELETE FROM report_outlines WHERE student_id = ANY($1::int[])',
      'DELETE FROM work_plan_approvals WHERE student_id = ANY($1::int[])',
      'DELETE FROM work_plan_topics WHERE student_id = ANY($1::int[])',
      'DELETE FROM daily_logs WHERE student_id = ANY($1::int[])',
      'DELETE FROM weekly_logs WHERE student_id = ANY($1::int[])',
      'DELETE FROM monthly_logs WHERE student_id = ANY($1::int[])',
      'DELETE FROM official_documents WHERE student_id = ANY($1::int[])',
      'DELETE FROM intent_forms WHERE student_id = ANY($1::int[])',
    ]) {
      await client.query(sql, [demoIds]);
    }

    // ── S1. แบบเสนองาน สหกิจ 02 ────────────────────────────────────────────────────────────
    const snapshotSql = `(SELECT jsonb_build_object(${COMPANY_WRITABLE_FIELDS.map((f) => `'${f}', c.${f}`).join(', ')})
                            FROM companies c WHERE c.company_id = $1)`;
    const prevOffer = (await client.query(
      `INSERT INTO coop_job_offers (company_id, semester_id, status, due_date, submitted_at, submitted_by,
                                    reviewed_at, reviewed_by, informant_name, informant_position, company_snapshot)
       VALUES ($1, $2, 'reviewed', ${TODAY} - 150, NOW() - INTERVAL '150 days', $3,
               NOW() - INTERVAL '145 days', $3, 'คุณใจดี ตัวอย่าง', 'ผู้จัดการฝ่ายบุคคล', ${snapshotSql})
       ON CONFLICT ON CONSTRAINT coop_job_offers_company_semester_key DO UPDATE SET
         status = 'reviewed', due_date = EXCLUDED.due_date, submitted_at = EXCLUDED.submitted_at,
         submitted_by = EXCLUDED.submitted_by, reviewed_at = EXCLUDED.reviewed_at,
         reviewed_by = EXCLUDED.reviewed_by, informant_name = EXCLUDED.informant_name,
         informant_position = EXCLUDED.informant_position, copied_from_offer_id = NULL,
         decline_reason = NULL, reject_reason = NULL, updated_at = NOW()
       RETURNING offer_id`,
      [companyId, curSemId, staffId]
    )).rows[0];
    const draftOffer = (await client.query(
      `INSERT INTO coop_job_offers (company_id, semester_id, status, due_date, copied_from_offer_id, company_snapshot)
       VALUES ($1, $2, 'draft', ${TODAY} + 12, $3, ${snapshotSql})
       ON CONFLICT ON CONSTRAINT coop_job_offers_company_semester_key DO UPDATE SET
         status = 'draft', due_date = EXCLUDED.due_date, copied_from_offer_id = EXCLUDED.copied_from_offer_id,
         submitted_at = NULL, submitted_by = NULL, reviewed_at = NULL, reviewed_by = NULL,
         informant_name = NULL, informant_position = NULL, decline_reason = NULL, reject_reason = NULL,
         company_snapshot = EXCLUDED.company_snapshot, updated_at = NOW()
       RETURNING offer_id`,
      [companyId, nextSemId, prevOffer.offer_id]
    )).rows[0];

    const majorIdOf = new Map<string, number>(
      (await client.query('SELECT major_code, major_id FROM master_major')).rows.map(
        (r) => [r.major_code as string, r.major_id as number] as [string, number]
      )
    );

    /** เพิ่มหรืออัปเดตตำแหน่งในใบ (คีย์ = ใบ + ชื่อตำแหน่ง) — ไม่ลบแถวอื่นของบริษัท */
    const upsertItem = async (
      offerId: number,
      semesterId: number,
      it: (typeof OFFER_ITEMS)[number],
      status: string,
      applied: number
    ): Promise<number> => {
      const found = await client.query('SELECT job_id FROM job_posts WHERE offer_id = $1 AND title = $2', [
        offerId,
        it.title,
      ]);
      const values = [
        it.desc, it.quota, applied, status, it.term, it.skills, it.other, it.pay, it.unit,
        it.accommodation, it.welfare,
      ];
      let jobId: number;
      if ((found.rowCount ?? 0) > 0) {
        jobId = found.rows[0].job_id as number;
        await client.query(
          `UPDATE job_posts SET description = $2, quota = $3, applied_count = $4, status = $5, duration_term = $6,
                  skills_required = $7, other_requirements = $8, pay_amount = $9, pay_unit = $10,
                  accommodation = $11, welfare_other = $12, semester_id = $13,
                  expire_date = (SELECT due_date FROM coop_job_offers WHERE offer_id = $14)::timestamp
            WHERE job_id = $1`,
          [jobId, ...values, semesterId, offerId]
        );
      } else {
        jobId = (await client.query(
          `INSERT INTO job_posts (company_id, offer_id, semester_id, title, description, created_by, quota,
                                  applied_count, expire_date, status, duration_term, skills_required,
                                  other_requirements, pay_amount, pay_unit, accommodation, welfare_other)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                   (SELECT due_date FROM coop_job_offers WHERE offer_id = $2)::timestamp,
                   $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING job_id`,
          [companyId, offerId, semesterId, it.title, it.desc, staffId, it.quota, applied, status, it.term,
           it.skills, it.other, it.pay, it.unit, it.accommodation, it.welfare]
        )).rows[0].job_id as number;
      }
      await client.query('DELETE FROM job_post_majors WHERE job_id = $1', [jobId]);
      for (const code of it.majors) {
        const mid = majorIdOf.get(code);
        if (mid !== undefined) {
          await client.query('INSERT INTO job_post_majors (job_id, major_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [jobId, mid]);
        }
      }
      return jobId;
    };

    const jobIds: number[] = [];
    for (const it of OFFER_ITEMS) {
      // เต็มโควตาแล้ว = closed ตามที่ models/intent.ts ทำจริง
      const full = it.appliedPublished >= it.quota;
      jobIds.push(await upsertItem(prevOffer.offer_id, curSemId, it, full ? 'closed' : 'published', it.appliedPublished));
      await upsertItem(draftOffer.offer_id, nextSemId, it, 'pending_approval', 0);
    }

    // ── S3. นักศึกษาที่ตอบรับแล้ว (accepted) กำลังฝึกอยู่ ─────────────────────────────────
    // ⛔ ทุกอย่างเลื่อนตาม offset: start_date = วันนี้ − offset · จบ = start + 111 วัน (16 สัปดาห์พอดี)
    const placements = [
      { id: student2Id, job: jobIds[0], offset: 39, daily: true, no: 'DEMO-S2',
        pos: 'Junior Full-Stack Developer',
        desc: 'พัฒนาหน้าจอรายงานยอดผลิตรายวันให้ฝ่ายวางแผน ร่วมทดสอบระบบ และจัดทำเอกสารประกอบ' },
      { id: student1Id, job: jobIds[1], offset: 67, daily: false, no: 'DEMO-S1',
        pos: 'ผู้ช่วยวิเคราะห์ข้อมูลการผลิต',
        desc: 'รวบรวมและวิเคราะห์ข้อมูลรอบการผลิต จัดทำรายงานประจำสัปดาห์เสนอหัวหน้าแผนก' },
    ];
    for (const p of placements) {
      await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status, mentor_id,
                start_date, end_date, daily_log_required, job_position, job_description,
                advisor_signer_name, advisor_signed_date, dept_head_signer_name, dept_head_signed_date,
                officer_document_no, officer_approved_at, officer_approved_by,
                acceptance_due_date, acceptance_signer_name, acceptance_signer_position, acceptance_signed_date,
                acceptance_source, company_mail_to, company_mail_sent_at, company_mail_count,
                dispatch_document_no, created_at)
         VALUES ($1, $2, $3, $4, 'accepted', $5,
                ${TODAY} - $6::int, ${TODAY} - $6::int + 111, $7, $8, $9,
                'วิชัย ที่ปรึกษาดี', ${TODAY} - $6::int - 45, 'สมหญิง หัวหน้าสาขา', ${TODAY} - $6::int - 43,
                'ศธ 0590/' || $10::text, NOW() - ($6::int + 20) * INTERVAL '1 day', $11,
                ${TODAY} - $6::int - 12, 'คุณใจดี ตัวอย่าง', 'ผู้จัดการฝ่ายบุคคล', ${TODAY} - $6::int - 25,
                'link', $12, NOW() - ($6::int + 35) * INTERVAL '1 day', 1,
                'ศธ 0590/SEND-' || $10::text, NOW() - ($6::int + 50) * INTERVAL '1 day')`,
        [p.id, companyId, curSemId, p.job, mentorId, p.offset, p.daily, p.pos, p.desc, p.no, staffId, companyEmail]
      );
    }

    // ── S2. คณบดีลงนามหนังสือแล้ว + นักศึกษาส่งถึงบริษัท รอบริษัทตอบทางลิงก์ ────────────────
    const s2Forms: typeof ctx.s2Forms = [];
    for (const [i, sid] of [student3Id, student4Id].entries()) {
      const code = EXTRA_STUDENTS[i].code;
      const docNo = `ศธ 0590/DEMO-L${i + 1}`;
      const form = (await client.query(
        `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status,
                advisor_signer_name, advisor_signed_date, dept_head_signer_name, dept_head_signed_date,
                officer_document_no, officer_approved_at, officer_approved_by, acceptance_due_date,
                company_mail_to, company_mail_sent_at, company_mail_count, created_at)
         VALUES ($1, $2, $3, $4, 'approved_by_dept_head',
                'วิชัย ที่ปรึกษาดี', ${TODAY} - 14, 'สมหญิง หัวหน้าสาขา', ${TODAY} - 13,
                $5, NOW() - INTERVAL '8 days', $6, ${TODAY} + 20,
                $7, NOW() - INTERVAL '1 day', 1, NOW() - INTERVAL '16 days')
         RETURNING form_id`,
        [sid, companyId, curSemId, jobIds[i], docNo, staffId, companyEmail]
      )).rows[0];
      await client.query(
        `INSERT INTO official_documents (document_number, type, student_id, company_id, generated_file_path,
                                         status, dean_signature_date, created_at)
         VALUES ($1, 'cover_letter', $2, $3, $4, 'signed', NOW() - INTERVAL '2 days', NOW() - INTERVAL '8 days')`,
        [docNo, sid, companyId, `secure_private/documents/cover_letter_demo_${code}.pdf`]
      );
      s2Forms.push({ formId: form.form_id as number, studentId: sid, studentCode: code, docNo });
    }

    // ── S5. บันทึกการปฏิบัติงาน ───────────────────────────────────────────────────────────
    const weeklyText = (who: 'st2' | 'st1', n: number) => ({
      work: who === 'st2'
        ? 'พัฒนาหน้าจอรายงานยอดผลิตรายวันให้ฝ่ายวางแผน และแก้ไขบั๊กการคำนวณยอดสะสมข้ามกะ'
        : `วิเคราะห์ข้อมูลรอบการผลิตของสัปดาห์ที่ ${n} และจัดทำรายงานสรุปเสนอหัวหน้าแผนก`,
      methods: who === 'st2'
        ? 'เก็บความต้องการจากฝ่ายวางแผน 1 รอบ แล้วเขียนคิวรีดึงยอดจากตารางการผลิต ทดสอบกับข้อมูลย้อนหลัง 3 เดือน'
        : 'ดึงข้อมูลจากระบบการผลิตด้วย Excel Power Query แล้วทำ Pivot เทียบกับแผนรายสัปดาห์',
      tools: who === 'st2' ? 'React, PostgreSQL, Git' : 'Excel, Power Query',
      achieved: who === 'st2'
        ? 'หน้าจอใช้งานได้จริงกับข้อมูลของสัปดาห์นี้ ฝ่ายวางแผนเลิกทำสรุปด้วยมือ ลดเวลาลงประมาณวันละ 30 นาที'
        : 'รายงานสรุปส่งทันกำหนด หัวหน้าแผนกนำไปใช้ในที่ประชุมประจำสัปดาห์',
      problems: 'ข้อมูลบางกะหาย ต้องรอฝ่ายไอทีเปิดสิทธิ์ให้ ทำให้ช้าไป 1 วัน',
    });

    const insertWeekly = async (
      studentId: number,
      who: 'st2' | 'st1',
      offset: number,
      n: number,
      status: 'submitted' | 'returned',
      certified: boolean,
      comment?: string
    ) => {
      const t = weeklyText(who, n);
      const endAgo = offset - (n - 1) * 7 - 4; // วันสุดท้ายของสัปดาห์นั้นผ่านมากี่วัน
      await client.query(
        `INSERT INTO weekly_logs (student_id, week_number, assigned_work, methods, tools_used, achievements, problems,
                status, start_date, end_date, mentor_certified_by, mentor_certified_at, returned_comment,
                submitted_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                ${TODAY} - $9::int + ($2::int - 1) * 7, ${TODAY} - $9::int + ($2::int - 1) * 7 + 4,
                $10::int, CASE WHEN $10::int IS NULL THEN NULL ELSE ${agoSql('$11')} END, $12,
                ${agoSql('$13')}, ${agoSql('$13')}, ${agoSql('$13')})`,
        [studentId, n, t.work, t.methods, t.tools, t.achieved, t.problems, status, offset,
         certified ? mentorId : null, Math.max(endAgo - 1, 0), comment ?? null, Math.max(endAgo, 0)]
      );
    };
    // student2 (สัปดาห์ 6): 1-2 รับรองแล้ว · 3 ถูกส่งกลับ · 4-6 รอรับรอง
    await insertWeekly(student2Id, 'st2', 39, 1, 'submitted', true);
    await insertWeekly(student2Id, 'st2', 39, 2, 'submitted', true);
    await insertWeekly(student2Id, 'st2', 39, 3, 'returned', false,
      'ข้อ 4 ผลการปฏิบัติงานยังไม่ได้ระบุตัวเลขที่วัดได้ ขอให้เพิ่มก่อนส่งใหม่');
    for (const n of [4, 5, 6]) await insertWeekly(student2Id, 'st2', 39, n, 'submitted', false);
    // student1 (สัปดาห์ 10): 1-7 รับรองแล้ว · 8-9 รอรับรอง
    for (let n = 1; n <= 7; n++) await insertWeekly(student1Id, 'st1', 67, n, 'submitted', true);
    for (const n of [8, 9]) await insertWeekly(student1Id, 'st1', 67, n, 'submitted', false);

    // รายเดือน: student1 เดือนแรกรับรองแล้ว เดือนสอง + student2 เดือนแรก รอรับรอง
    const insertMonthly = async (
      studentId: number, startAgo: number, endAgo: number, certified: boolean, summary: string, effect: string
    ) => {
      await client.query(
        `INSERT INTO monthly_logs (student_id, year, month, work_summary, effectiveness, status, start_date, end_date,
                mentor_certified_by, mentor_certified_at, submitted_at, created_at, updated_at)
         VALUES ($1, EXTRACT(YEAR FROM ${TODAY} - $3::int)::int, EXTRACT(MONTH FROM ${TODAY} - $3::int)::int,
                $5, $6, 'submitted', ${TODAY} - $2::int, ${TODAY} - $3::int,
                $4::int, CASE WHEN $4::int IS NULL THEN NULL ELSE ${agoSql('$7')} END,
                ${agoSql('$8')}, ${agoSql('$8')}, ${agoSql('$8')})`,
        [studentId, startAgo, endAgo, certified ? mentorId : null, summary, effect,
         Math.max(endAgo - 2, 0), Math.max(endAgo - 1, 0)]
      );
    };
    const sum1 = 'รวบรวมข้อมูลรอบการผลิตของทั้งเดือนและจัดทำรายงานสรุปเสนอหัวหน้าแผนก';
    const eff1 = 'รายงานที่เคยใช้เวลาทำ 2 วันต่อเดือน เหลือครึ่งวัน เพราะดึงข้อมูลอัตโนมัติแทนการคีย์มือ';
    await insertMonthly(student1Id, 67, 38, true, sum1, eff1);
    await insertMonthly(student1Id, 37, 8, false, sum1, eff1);
    await insertMonthly(student2Id, 39, 10, false,
      'พัฒนาหน้าจอรายงานยอดผลิตรายวันและทดสอบกับข้อมูลจริงตลอดเดือนแรก',
      'ฝ่ายวางแผนเลิกทำสรุปด้วยมือ ลดเวลาลงประมาณวันละ 30 นาที');

    // รายวัน (student2 ต้องบันทึกรายวัน): สัปดาห์ 5 รับรองแล้ว · สัปดาห์ 6 รอรับรองทั้งสัปดาห์
    const dailyDetails = [
      'ประชุมรับงานกับฝ่ายวางแผน และสำรวจโครงสร้างข้อมูลเดิม',
      'เขียนคิวรีดึงยอดผลิตรายวัน ทดสอบกับข้อมูลย้อนหลัง',
      'ต่อคิวรีเข้าหน้าจอ และจัดรูปแบบตารางตามที่ผู้ใช้ขอ',
      'แก้บั๊กการคำนวณยอดสะสมข้ามกะ และทดสอบซ้ำ',
      'สรุปงานประจำสัปดาห์กับพี่เลี้ยง และเตรียมงานสัปดาห์ถัดไป',
    ];
    for (const [week, certified] of [[5, true], [6, false]] as [number, boolean][]) {
      const endAgo = 39 - (week - 1) * 7 - 4;
      for (let d = 0; d < dailyDetails.length; d++) {
        await client.query(
          `INSERT INTO daily_logs (student_id, week_number, log_date, work_detail, remark, status,
                  mentor_certified_by, mentor_certified_at, submitted_at, created_at, updated_at)
           VALUES ($1, $2, ${TODAY} - 39 + ($2::int - 1) * 7 + $3::int, $4, $5, 'submitted',
                  $6::int, CASE WHEN $6::int IS NULL THEN NULL ELSE ${agoSql('$7')} END,
                  ${agoSql('$8')}, ${agoSql('$8')}, ${agoSql('$8')})`,
          [student2Id, week, d, dailyDetails[d], d === 3 ? 'รอสิทธิ์เข้าถึงข้อมูลกะดึกจากฝ่ายไอที' : null,
           certified ? mentorId : null, Math.max(endAgo - 1, 0), Math.max(endAgo, 0)]
        );
      }
    }

    // ── S6. แผนปฏิบัติงาน (สหกิจ 07 หน้า 3) ────────────────────────────────────────────────
    const plans: { id: number; topics: [string, number[]][]; approval: 'pending' | 'approved' }[] = [
      {
        id: student2Id, approval: 'pending',
        topics: [
          ['ศึกษาระบบงานเดิมของฝ่ายวางแผนและเก็บความต้องการ', [1]],
          ['ออกแบบและพัฒนาหน้าจอรายงานยอดผลิตรายวัน', [1, 2]],
          ['ทดสอบระบบร่วมกับผู้ใช้จริงและแก้ไขตามผลทดสอบ', [2, 3]],
          ['จัดทำคู่มือการใช้งานและส่งมอบงานให้ฝ่ายวางแผน', [3, 4]],
          ['จัดทำรายงานฉบับสมบูรณ์และนำเสนอผลงาน', [4]],
        ],
      },
      {
        id: student1Id, approval: 'approved',
        topics: [
          ['ศึกษากระบวนการผลิตและแหล่งข้อมูลของแผนก', [1]],
          ['จัดทำรายงานวิเคราะห์ข้อมูลรอบการผลิตประจำสัปดาห์', [1, 2, 3]],
          ['พัฒนาเครื่องมือดึงข้อมูลอัตโนมัติ', [2, 3]],
          ['จัดทำรายงานฉบับสมบูรณ์และนำเสนอผลงาน', [4]],
        ],
      },
    ];
    for (const p of plans) {
      for (const [i, [topic, months]] of p.topics.entries()) {
        await client.query(
          'INSERT INTO work_plan_topics (student_id, seq, topic, months) VALUES ($1, $2, $3, $4)',
          [p.id, i + 1, topic, months]
        );
      }
      await client.query(
        `INSERT INTO work_plan_approvals (student_id, approver_role, approver_id, status, approved_at, created_at)
         VALUES ($1, 'mentor', $2, $3::text, CASE WHEN $3::text = 'approved' THEN NOW() - INTERVAL '50 days' END,
                 CASE WHEN $3::text = 'approved' THEN NOW() - INTERVAL '55 days' ELSE NOW() - INTERVAL '5 days' END)
         ON CONFLICT (student_id, approver_role) DO UPDATE SET
           approver_id = EXCLUDED.approver_id, status = EXCLUDED.status,
           approved_at = EXCLUDED.approved_at, created_at = EXCLUDED.created_at, comment = NULL`,
        [p.id, mentorId, p.approval]
      );
    }

    // ── S7. โครงร่างรายงาน (สหกิจ 11) + ร่างรายงานฉบับสมบูรณ์ของ student1 ──────────────────────
    const outline = (await client.query(
      `INSERT INTO report_outlines (student_id, company_id, status, created_at, updated_at)
       VALUES ($1, $2, 'pending_mentor', NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day') RETURNING outline_id`,
      [student1Id, companyId]
    )).rows[0];
    await client.query(
      `INSERT INTO report_outline_versions (outline_id, report_title, outline_text, submitted_at, status)
       VALUES ($1, 'การลดเวลาจัดทำรายงานรอบการผลิตด้วยระบบดึงข้อมูลอัตโนมัติ',
               E'บทที่ 1 บทนำ\nบทที่ 2 ทฤษฎีและงานที่เกี่ยวข้อง\nบทที่ 3 วิธีดำเนินงาน\nบทที่ 4 ผลการดำเนินงาน\nบทที่ 5 สรุปและข้อเสนอแนะ',
               NOW() - INTERVAL '1 day', 'submitted')`,
      [outline.outline_id]
    );
    // ชื่อไฟล์ต้องขึ้นต้น `finalreport-user-<id>-` ไม่งั้นพี่เลี้ยงเปิดไม่ได้ (index.ts ตรวจจากชื่อ)
    const draftFiles = [1, 2].map((v) => `finalreport-user-${student1Id}-demo-v${v}.pdf`);
    await client.query(
      `INSERT INTO final_reports (student_id, file_path, status, version, reviewer_kind, reviewer_comment,
                                  reviewed_by, reviewed_at, submitted_at)
       VALUES ($1, $2, 'rejected', 1, 'mentor', 'บทที่ 4 ยังไม่มีตัวเลขเปรียบเทียบก่อน-หลัง ขอให้เพิ่มก่อนส่งใหม่',
               $4, NOW() - INTERVAL '8 days', NOW() - INTERVAL '14 days'),
              ($1, $3, 'submitted', 2, 'mentor', NULL, NULL, NULL, NOW() - INTERVAL '2 days')`,
      [student1Id, `final_reports/${draftFiles[0]}`, `final_reports/${draftFiles[1]}`, mentorId]
    );
    for (const [i, f] of draftFiles.entries()) {
      await writePlaceholderPdf(path.join(BACKEND_DIR, 'uploads', 'final_reports', f), `Demo draft report v${i + 1}`);
    }

    await client.query('COMMIT');
    ctx = { staffId, mentorId, companyId, companyEmail, draftOfferId: draftOffer.offer_id as number, s2Forms };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ── หลัง COMMIT: ของที่ต้องออกผ่านตัวช่วยจริงของโปรเจค (ใช้ pool คนละ connection) ──────────────
  // S1 ลิงก์ `/offer` — ใช้ได้ 1 ใบ (ออกด้วย createJobOfferToken) + หมดอายุแล้ว 1 ใบ
  await pool.query('DELETE FROM job_offer_tokens WHERE offer_id = $1', [ctx.draftOfferId]);
  const live = await createJobOfferToken(ctx.draftOfferId, ctx.staffId);
  const expiredToken = crypto.randomUUID();
  await pool.query(
    `INSERT INTO job_offer_tokens (token, offer_id, expires_at, created_by)
     VALUES ($1, $2, NOW() - INTERVAL '3 hours', $3)`,
    [expiredToken, ctx.draftOfferId, ctx.staffId]
  );

  // S2 ลิงก์ `/accept` + ไฟล์หนังสือขอความอนุเคราะห์ที่ลงนามแล้ว (ใบ cover letter ต้องมีไฟล์ให้ลิงก์เปิดได้)
  const acceptUrls: string[] = [];
  for (const f of ctx.s2Forms) {
    try {
      const row = await fetchCoverLetterData(f.formId);
      if (!row) throw new Error('ไม่พบข้อมูลใบความจำนง');
      const pdf = await buildCoverLetterPdf(toCoverLetterData(row), { signedDate: new Date() });
      const file = path.join(BACKEND_DIR, 'secure_private', 'documents', `cover_letter_demo_${f.studentCode}.pdf`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, pdf);
    } catch (err) {
      // ฟอนต์ไทยหาจาก cwd — รันนอกโฟลเดอร์ backend (เช่น E2E) จะวาดไม่ได้ · ลิงก์ยังเปิดหน้าตอบรับได้ แค่ปุ่มดูหนังสือ 404
      log(`ข้ามไฟล์หนังสือของ ${f.studentCode}: ${(err as Error).message}`);
    }
    acceptUrls.push((await createAcceptanceLinkToken(f.formId, ctx.companyEmail)).url);
  }

  // พี่เลี้ยง: ลิงก์เข้าระบบใช้ครั้งเดียว ออกผ่านฟังก์ชันจริง (ไม่ส่งอีเมล · พี่เลี้ยงไม่มีรหัสผ่าน)
  await pool.query('DELETE FROM mentor_login_tokens WHERE user_id = $1 AND used_at IS NULL', [ctx.mentorId]);
  const issued = await issueMentorLoginLink({ userId: ctx.mentorId, ttlMs: MENTOR_LINK_TTL_SYSTEM_MS, skipCooldown: true });
  const mentorLoginUrl = issued && 'url' in issued ? issued.url : null;

  const result: SeedDemoResult = {
    offerLiveUrl: live.url,
    offerExpiredUrl: jobOfferAnswerUrl(expiredToken),
    acceptUrls,
    mentorLoginUrl,
  };

  if (!opts.quiet) {
    console.log('\n✅ ใส่ข้อมูลเดโม "หนึ่งภาคเรียนที่เดินมาถึงกลางทาง" เรียบร้อย');
    log('S1 แบบเสนองาน สหกิจ 02: ใบร่างภาคถัดไป (ก๊อป 2 รายการจากภาคที่แล้ว) — เจ้าหน้าที่เห็นในหน้า "แบบเสนองาน"');
    log(`   ลิงก์ที่ใช้ได้ (24 ชม.): ${result.offerLiveUrl}`);
    log(`   ลิงก์ที่หมดอายุแล้ว     : ${result.offerExpiredUrl}`);
    log('S2 ลิงก์ตอบรับของบริษัท (student3 · student4 คณบดีลงนามแล้ว รอบริษัทตอบ):');
    acceptUrls.forEach((u) => log(`   ${u}`));
    log('S3 พี่เลี้ยง mentor1 ดูแล student1 (สัปดาห์ 10/16) และ student2 (สัปดาห์ 6/16 · บันทึกรายวัน)');
    log('S4-S7 หน้าแรกพี่เลี้ยงมีคิว "รอคุณรับรอง" ครบ 6 ชนิด + บันทึกรับรองแล้ว/รอ/ส่งกลับ');
    if (mentorLoginUrl) {
      log(`เข้าเป็นพี่เลี้ยง (ลิงก์ใช้ครั้งเดียว 7 วัน): ${mentorLoginUrl}`);
    } else {
      log('ออกลิงก์ mentor1 ไม่ได้ — บัญชีไม่ใช่พี่เลี้ยงล้วน (ตรวจ role/โปรไฟล์ mentors)');
    }
    log(`ต้องการลิงก์ใหม่: เปิด ${FRONTEND_URL}/login/mentor ใส่ mentor1@test.com (ในเครื่อง dev ไม่มีเมลจริง — รันสคริปต์นี้ซ้ำเพื่อออกลิงก์ใหม่)`);
    log('นักศึกษาเดโม: student1 · student2 (ฝึกอยู่) · student3 · student4 (รอบริษัทตอบ) @test.com — รหัสผ่านตามชุด db:setup');
  }

  return result;
}

if (require.main === module) {
  seedDemo()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ ใส่ข้อมูลเดโมไม่สำเร็จ:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
