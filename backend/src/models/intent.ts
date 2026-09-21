import type { PoolClient } from 'pg';
import pool, { query } from '../config/database';
import { IntentForm } from '../types';
import { createInviteLink } from '../utils/invite';
import { sendMentorInviteEmail } from '../utils/email';

/**
 * SEC-04: explicit allow-lists for every state transition an external party can
 * trigger. Previously these paths only refused to act on an already-'accepted'
 * form, which meant a company could accept an intent still sitting at
 * 'pending_advisor' — skipping the advisor, department head and dean entirely.
 *
 * The document pipeline moves a form through:
 *   pending_advisor -> pending_officer_request -> approved_by_dept_head
 *   -> pending_sign -> signed / pending_acceptance -> accepted
 * so only the last three are valid starting points for an acceptance.
 */
export const COMPANY_DECISION_FROM = ['approved_by_dept_head', 'pending_sign', 'signed', 'pending_acceptance'];

/**
 * Which placements a company is allowed to see at all.
 *
 * On paper the faculty compiles สหกิจ 04 (แบบแจ้งรายชื่อนักศึกษา) only *after* it
 * has run its own selection — which is the department head's approval here — and
 * only then posts it to the company together with each student's สหกิจ 03.
 * Anything earlier has not been sent to them, so it must not appear on their
 * screen either. The three states after the decision are included so a company
 * can still see the placement it accepted and the reason it gave when it
 * turned somebody down.
 */
export const COMPANY_VISIBLE_STATUSES = [
  ...COMPANY_DECISION_FROM,
  'pending_officer_approval',
  'accepted',
  'company_rejected',
];
export const STUDENT_ACCEPT_FROM = ['approved_by_dept_head', 'pending_sign', 'signed', 'pending_acceptance'];
/** A student may report a failed interview any time before the placement is final. */
export const STUDENT_FAIL_FROM = [
  'pending_advisor',
  'pending_officer_request',
  'approved_by_dept_head',
  'pending_sign',
  'signed',
  'pending_acceptance',
];

/**
 * เอกสารหมายเลข 1 — เส้นทางที่ลายเซ็นอยู่บนกระดาษ (เจ้าของเคาะ 2026-08-26)
 *
 *   pending_advisor            นักศึกษายื่นคำร้องแล้ว กำลังเดินเรื่องกระดาษอยู่
 *        ↓ อัปโหลดกระดาษที่ที่ปรึกษาและหัวหน้าสาขาลงนามแล้ว
 *   pending_officer_request    รอเจ้าหน้าที่ตรวจกระดาษ
 *        ↓ เจ้าหน้าที่กดผ่าน (คนเดียวที่กดในระบบ)
 *   approved_by_dept_head      ← คงชื่อเดิมไว้ เพราะทุกอย่างท้ายน้ำอ่านค่านี้
 *
 * ⛔ `approved_by_advisor` และ `rejected_by_dept_head` **ถูกลบทิ้งทั้งเส้นแล้ว**
 * เมื่อ 2026-08-27 (เจ้าของสั่ง) พร้อมกับ route `PATCH /:id/status`,
 * `/dept-head-status` และเมธอด `approveByDeptHead` / `rejectByDeptHead*` /
 * `rejectByAdvisor*` / `updateStatus` ที่ไม่มีใครเรียกแล้ว
 * · ระบบยังไม่เคยขึ้น production จึงไม่มีใบเก่าค้างอยู่ที่สองสถานะนั้น
 * · **ห้ามเอากลับมา** — ลายเซ็นที่ปรึกษาและหัวหน้าสาขาอยู่บนกระดาษ
 *
 * ⛔ ห้ามใช้ `pending_officer_approval` ซ้ำ มันเป็นคนละขั้น (นักศึกษาส่งหลักฐาน
 * การตอบรับจากสถานประกอบการ ซึ่งเกิดหลังจากนี้มาก) ชื่อคล้ายกันแต่คนละเรื่อง
 */
export const OFFICER_RECEIVE_FROM = ['pending_advisor', 'pending_officer_request'];
export const OFFICER_DECISION_FROM = ['pending_officer_request'];

export function assertAllowedTransition(action: string, currentStatus: string, allowedFrom: string[]): void {
  if (!allowedFrom.includes(currentStatus)) {
    throw new Error(
      `ไม่สามารถดำเนินการ '${action}' ได้ในสถานะปัจจุบัน '${currentStatus}' (อนุญาตเฉพาะ: ${allowedFrom.join(', ')})`
    );
  }
}

/**
 * Give a job seat back when a placement falls through. Shared by every rejection
 * path so a seat is never leaked (or double-returned) depending on who rejected.
 * The post only reopens when it is genuinely under quota again.
 */
async function releaseJobSeat(client: PoolClient, jobId: number | null): Promise<void> {
  if (jobId === null || jobId === undefined) return;

  const jobRes = await client.query(
    `SELECT job_id, quota, applied_count, status FROM job_posts WHERE job_id = $1 FOR UPDATE`,
    [jobId]
  );
  if ((jobRes.rowCount ?? 0) === 0) return;

  const job = jobRes.rows[0];
  const newAppliedCount = Math.max(0, job.applied_count - 1);
  const newStatus =
    job.status === 'closed' && newAppliedCount < job.quota ? 'published' : job.status;

  await client.query(`UPDATE job_posts SET applied_count = $1, status = $2 WHERE job_id = $3`, [
    newAppliedCount,
    newStatus,
    jobId,
  ]);
}

/**
 * ตราประทับว่าใบนี้ยื่นในช่วงผ่อนผัน (ส่งช้า) หรือไม่
 *
 * ค่ามาจาก `isLateWindow(res)` ซึ่งอ่านผลของด่านปฏิทินเท่านั้น — **ไม่ใช่ค่าที่
 * นักศึกษาส่งมาเอง** และไม่คำนวณย้อนหลัง เพราะเจ้าหน้าที่แก้ปฏิทินได้ทีหลัง
 */
export interface LateStamp {
  submitted_late: boolean;
  late_reason: string | null;
}

export class IntentFormModel {
  /**
   * Submit student intent and update job application count transactionally.
   */
  static async createWithTransaction(intentData: {
    student_id: number;
    company_id: number;
    semester_id: number;
    job_id: number | null;
    late: LateStamp;
  }): Promise<IntentForm> {
    const client = await pool.connect();
    
    try {
      // Begin PostgreSQL Transaction
      await client.query('BEGIN');

      // 0. Check if student already has an active intent form for this semester (MED-02)
      const duplicateCheck = await client.query(
        `SELECT 1 FROM intent_forms 
         WHERE student_id = $1 AND semester_id = $2 
         AND status NOT IN ('rejected', 'company_rejected', 'superseded')`,
        [intentData.student_id, intentData.semester_id]
      );
      if ((duplicateCheck.rowCount ?? 0) > 0) {
        throw new Error('คุณมีใบแจ้งความจำนงที่ยังดำเนินการอยู่ในภาคการศึกษานี้ ยื่นได้ครั้งละ 1 แห่ง');
      }

      // 1. Verify that student exists
      const studentCheck = await client.query(
        'SELECT 1 FROM students WHERE student_id = $1',
        [intentData.student_id]
      );
      if ((studentCheck.rowCount ?? 0) === 0) {
        throw new Error('Student profile not found. Please setup profile first.');
      }

      // 2. Verify that company exists
      const companyCheck = await client.query(
        'SELECT 1 FROM companies WHERE company_id = $1',
        [intentData.company_id]
      );
      if ((companyCheck.rowCount ?? 0) === 0) {
        throw new Error('Company not found in directory.');
      }

      // 3. Verify that semester exists and is active
      const semesterCheck = await client.query(
        'SELECT is_active FROM coop_semesters WHERE semester_id = $1',
        [intentData.semester_id]
      );
      if ((semesterCheck.rowCount ?? 0) === 0) {
        throw new Error('Cooperative semester not found.');
      }
      // is_active was selected but never checked, so an intent could be filed
      // against a closed term — which also side-stepped the one-active-intent
      // -per-semester unique index by simply picking another semester_id.
      if (!semesterCheck.rows[0].is_active) {
        throw new Error('ภาคการศึกษาที่เลือกไม่ได้เปิดรับการยื่นแบบแจ้งความจำนง');
      }

      // 4. If applying to a specific job post, run critical logic and update it
      if (intentData.job_id !== null) {
        // Query job post with row-locking FOR UPDATE to handle concurrent requests safely
        const jobRes = await client.query(
          `SELECT job_id, company_id, status, quota, applied_count, semester_id
           FROM job_posts
           WHERE job_id = $1
           FOR UPDATE`,
          [intentData.job_id]
        );

        if ((jobRes.rowCount ?? 0) === 0) {
          throw new Error('Job post not found.');
        }

        const job = jobRes.rows[0];

        // Validate that the job post belongs to the specified company
        if (job.company_id !== intentData.company_id) {
          throw new Error('Company ID does not match the company of the selected Job Post.');
        }

        // Validate status
        if (job.status !== 'published') {
          throw new Error(`Job post is not currently accepting applications. Current status: ${job.status}`);
        }

        /**
         * ⛔ **เลิกกรองด้วย `expire_date` แล้ว** — คอลัมน์นี้เปลี่ยนความหมายไปตั้งแต่
         *    รอบรื้อฝ่ายสถานประกอบการ จาก "วันที่ประกาศหมดอายุ" เป็น
         *    **"กำหนดส่งแบบสำรวจกลับ"** (บรรทัดท้ายกระดาษ สหกิจ 02)
         *    ตำแหน่งจะถูกเปิดให้นักศึกษาเห็นก็ต่อเมื่อเจ้าหน้าที่ตรวจใบผ่าน ซึ่งเกิด
         *    **หลัง** วันนั้นเสมอ — เงื่อนไขเดิมจึงปฏิเสธการยื่นทุกใบที่เดินมาถูกทาง
         *    (`models/job.ts` ถอดเงื่อนไขนี้ออกจากกระดานหางานไปแล้ว เหลือค้างที่นี่
         *    ที่เดียว: นักศึกษาเห็นตำแหน่งบนกระดาน กดยื่น แล้วได้ "Job post has expired.")
         *    ตัวที่คุมว่ายังรับอยู่ไหมคือ `status` กับโควตา ส่วนภาคเรียนคุมด้วยบรรทัดล่าง
         *
         * ⛔ ตำแหน่งต้องเป็นของภาคเรียนเดียวกับที่นักศึกษายื่น — ตรงกับเงื่อนไขของ
         *    กระดานหางาน (`getAvailableJobs`) และ `semester_id` ของคำร้องถูกตรวจ
         *    ว่า `is_active` ไปแล้วข้างบน ตำแหน่งของภาคที่ผ่านไปแล้วจึงยื่นไม่ได้
         */
        if (job.semester_id !== null && job.semester_id !== intentData.semester_id) {
          throw new Error('ตำแหน่งนี้เป็นของภาคการศึกษาอื่น ไม่สามารถยื่นความจำนงในภาคนี้ได้');
        }

        // Validate quota
        if (job.applied_count >= job.quota) {
          throw new Error('Job post quota has already been filled.');
        }

        // Increment applied count
        const newAppliedCount = job.applied_count + 1;
        await client.query(
          'UPDATE job_posts SET applied_count = $1 WHERE job_id = $2',
          [newAppliedCount, intentData.job_id]
        );

        // If new count reaches quota, automatically close the job post
        if (newAppliedCount >= job.quota) {
          await client.query(
            "UPDATE job_posts SET status = 'closed' WHERE job_id = $1",
            [intentData.job_id]
          );
        }
      }

      // 5. Insert Intent Form
      const insertRes = await client.query(
        `INSERT INTO intent_forms
           (student_id, company_id, semester_id, job_id, status, submitted_late, late_reason)
         VALUES ($1, $2, $3, $4, 'pending_advisor', $5, $6)
         RETURNING form_id, student_id, company_id, semester_id, job_id, status,
                   submitted_late, late_reason`,
        [
          intentData.student_id,
          intentData.company_id,
          intentData.semester_id,
          intentData.job_id,
          intentData.late.submitted_late,
          intentData.late.late_reason,
        ]
      );

      // Commit the transaction
      await client.query('COMMIT');

      return insertRes.rows[0] as IntentForm;
    } catch (error) {
      // Rollback on any failure
      await client.query('ROLLBACK');
      throw error;
    } finally {
      // Release client back to the pool
      client.release();
    }
  }

  /**
   * Create a self-found company and link it to a new intent form transactionally.
   */
  static async createSelfFoundWithTransaction(
    studentId: number,
    semesterId: number,
    companyDetails: {
      name_th: string;
      name_en?: string;
      address: string;
      province: string;
      district: string;
      postal_code: string;
      phone: string;
      contact_person?: string;
      contact_position?: string;
      email?: string;
    },
    late: LateStamp
  ): Promise<IntentForm> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // 0. Check if student already has an active intent form for this semester
      const duplicateCheck = await client.query(
        `SELECT 1 FROM intent_forms 
         WHERE student_id = $1 AND semester_id = $2 
         AND status NOT IN ('rejected', 'company_rejected', 'superseded')`,
        [studentId, semesterId]
      );
      if ((duplicateCheck.rowCount ?? 0) > 0) {
        throw new Error('คุณมีใบแจ้งความจำนงที่ยังดำเนินการอยู่ในภาคการศึกษานี้ ยื่นได้ครั้งละ 1 แห่ง');
      }

      // 1. Verify that student exists
      const studentCheck = await client.query(
        'SELECT 1 FROM students WHERE student_id = $1',
        [studentId]
      );
      if ((studentCheck.rowCount ?? 0) === 0) {
        throw new Error('Student profile not found. Please setup profile first.');
      }

      // 2. Verify that semester exists and is active
      const semesterCheck = await client.query(
        'SELECT is_active FROM coop_semesters WHERE semester_id = $1',
        [semesterId]
      );
      if ((semesterCheck.rowCount ?? 0) === 0) {
        throw new Error('Cooperative semester not found.');
      }
      // is_active was selected but never checked, so an intent could be filed
      // against a closed term — which also side-stepped the one-active-intent
      // -per-semester unique index by simply picking another semester_id.
      if (!semesterCheck.rows[0].is_active) {
        throw new Error('ภาคการศึกษาที่เลือกไม่ได้เปิดรับการยื่นแบบแจ้งความจำนง');
      }

      // 3. Create the unverified company
      const companyRes = await client.query(
        `INSERT INTO companies (
          name_th, name_en, address, province, district, postal_code, phone, 
          contact_person, contact_position, email, is_verified, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11)
         RETURNING company_id`,
        [
          companyDetails.name_th,
          companyDetails.name_en || null,
          companyDetails.address,
          companyDetails.province,
          companyDetails.district,
          companyDetails.postal_code,
          companyDetails.phone,
          companyDetails.contact_person || null,
          companyDetails.contact_position || null,
          companyDetails.email || null,
          studentId
        ]
      );
      const companyId = companyRes.rows[0].company_id;

      // 4. Create the intent form pointing to the new company
      const insertRes = await client.query(
        `INSERT INTO intent_forms
           (student_id, company_id, semester_id, job_id, status, submitted_late, late_reason)
         VALUES ($1, $2, $3, NULL, 'pending_advisor', $4, $5)
         RETURNING form_id, student_id, company_id, semester_id, job_id, status,
                   submitted_late, late_reason`,
        [studentId, companyId, semesterId, late.submitted_late, late.late_reason]
      );

      await client.query('COMMIT');
      return insertRes.rows[0] as IntentForm;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Find an intent form by ID.
   */
  /**
   * บันทึกไฟล์แบบคำร้องที่ลงนามบนกระดาษแล้ว แล้วเลื่อนสถานะไปรอเจ้าหน้าที่
   *
   * อัปโหลดทับได้ตราบใดที่ยังไม่ผ่านมือเจ้าหน้าที่ (สแกนเบลอ ลืมหน้าหลัง ฯลฯ)
   * — `OFFICER_RECEIVE_FROM` จึงรวม `pending_officer_request` ไว้ด้วย
   * คืน path เดิมออกมาให้ผู้เรียกลบไฟล์ทิ้ง ไม่งั้นโฟลเดอร์จะบวมตามจำนวนครั้งที่อัปซ้ำ
   */
  /**
   * ชื่อผู้ลงนามบนแบบคำร้อง (เอกสารหมายเลข 1) ที่ระบบรู้เอง — เจ้าของตัดสิน 2026-09-21
   * ให้ระบบดึงเอง ไม่ใช่ให้เจ้าหน้าที่นั่งคีย์จากกระดาษ
   *   - ที่ปรึกษา = `students.advisor_id` (หัวหน้าสาขาเป็นคนตั้ง)
   *   - หัวหน้าสาขา = บุคลากร role `dept_head` ของสาขาเดียวกับนักศึกษา (มีคนเดียวต่อสาขา · SB-G2)
   * ค่าใดเป็น null = ระบบยังไม่รู้ → นักศึกษากรอกเองตอนอัปโหลดกระดาษที่ลงนามแล้ว
   */
  static async resolveRequestSigners(
    studentId: number,
    db: Pick<PoolClient, 'query'> = pool
  ): Promise<{ advisor_name: string | null; dept_head_name: string | null }> {
    const res = await db.query(
      `SELECT
         (SELECT NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')
            FROM personnel p WHERE p.personnel_id = s.advisor_id) AS advisor_name,
         (SELECT NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')
            FROM user_roles r JOIN personnel p ON p.personnel_id = r.user_id
           WHERE r.role_name = 'dept_head' AND p.major_id = s.major_id
           ORDER BY r.user_id LIMIT 1) AS dept_head_name
         FROM students s WHERE s.student_id = $1`,
      [studentId]
    );
    return res.rows[0] ?? { advisor_name: null, dept_head_name: null };
  }

  static async attachRequestForm(
    formId: number,
    studentId: number,
    filePath: string,
    typedSigners: { advisorName?: string; deptHeadName?: string } = {}
  ): Promise<{ previousPath: string | null }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT student_id, status, request_form_path FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );
      if ((current.rowCount ?? 0) === 0) throw new Error('ไม่พบคำร้องที่ต้องการ');

      const row = current.rows[0];
      if (row.student_id !== studentId) {
        throw new Error('คุณอัปโหลดได้เฉพาะคำร้องของตัวเองเท่านั้น');
      }
      assertAllowedTransition('upload_request_form', row.status, OFFICER_RECEIVE_FROM);

      // ชื่อที่ระบบรู้ชนะเสมอ — นักศึกษากรอกได้เฉพาะช่องที่ระบบยังไม่รู้
      const known = await IntentFormModel.resolveRequestSigners(studentId, client);
      const advisorName = known.advisor_name ?? (typedSigners.advisorName?.trim() || null);
      const deptHeadName = known.dept_head_name ?? (typedSigners.deptHeadName?.trim() || null);
      const missing = [
        !advisorName && 'ชื่ออาจารย์ที่ปรึกษาที่ลงนาม',
        !deptHeadName && 'ชื่อหัวหน้าสาขาวิชาที่ลงนาม',
      ].filter(Boolean);
      if (missing.length > 0) {
        throw new Error(`ระบบยังไม่รู้ชื่อผู้ลงนาม กรุณากรอก: ${missing.join(' · ')}`);
      }

      await client.query(
        `UPDATE intent_forms
            SET request_form_path = $1, status = 'pending_officer_request', reject_reason = NULL,
                advisor_signer_name = $3, dept_head_signer_name = $4
          WHERE form_id = $2`,
        [filePath, formId, advisorName, deptHeadName]
      );

      await client.query('COMMIT');
      return { previousPath: row.request_form_path as string | null };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * เจ้าหน้าที่รับคำร้อง — จุดเดียวในระบบที่ใบความจำนงผ่านไปต่อได้
   *
   * ทำสามอย่างในทรานแซกชันเดียว เพราะทั้งสามเป็นผลของการตรวจกระดาษใบเดียวกัน
   * และถ้าแยกกันแล้วพลาดกลางทาง จะได้ใบความจำนงที่ผ่านแล้วแต่บริษัทยังไม่รับรอง
   *   1. บันทึกเลขที่หนังสือออก — ชื่อผู้ลงนามสองคนมาจากระบบ/นักศึกษาตอนอัปโหลดแล้ว
   *      (⛔ เจ้าหน้าที่ไม่ต้องคีย์ชื่อ/วันที่จากกระดาษอีก · เจ้าของตัดสิน 2026-09-21)
   *   2. เลื่อนสถานะไป approved_by_dept_head
   *   3. รับรองสถานประกอบการ (SEC-04) — ชื่อกับที่อยู่บนกระดาษคือสิ่งที่จะถูก
   *      พิมพ์ลงหนังสือราชการ การตรวจของเจ้าหน้าที่ตรงนี้คือด่านเดียวที่มีมนุษย์อ่าน
   */
  static async officerApproveRequest(
    formId: number,
    officerUserId: number,
    input: { documentNo: string }
  ): Promise<{ studentId: number; companyId: number }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT student_id, company_id, status, request_form_path
           FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );
      if ((current.rowCount ?? 0) === 0) throw new Error('ไม่พบคำร้องที่ต้องการ');

      const row = current.rows[0];
      assertAllowedTransition('officer_approve', row.status, OFFICER_DECISION_FROM);
      if (!row.request_form_path) {
        throw new Error('ยังไม่มีไฟล์แบบคำร้องที่ลงนามแล้วในระบบ');
      }

      // ใบที่อัปโหลดก่อนเปลี่ยนวิธี (ยังไม่มีชื่อบนแถว) เติมจากระบบให้ ไม่มีก็ปล่อย null
      const known = await IntentFormModel.resolveRequestSigners(row.student_id, client);
      await client.query(
        `UPDATE intent_forms
            SET status = 'approved_by_dept_head',
                advisor_signer_name = COALESCE(advisor_signer_name, $1),
                dept_head_signer_name = COALESCE(dept_head_signer_name, $2),
                officer_document_no = $3,
                officer_approved_at = NOW(), officer_approved_by = $4,
                reject_reason = NULL
          WHERE form_id = $5`,
        [known.advisor_name, known.dept_head_name, input.documentNo, officerUserId, formId]
      );

      await client.query('UPDATE companies SET is_verified = TRUE WHERE company_id = $1', [
        row.company_id,
      ]);

      await client.query('COMMIT');
      return { studentId: row.student_id as number, companyId: row.company_id as number };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * เจ้าหน้าที่ตีกลับคำร้อง — เหตุผลบังคับ และเก็บบนแถวไม่ใช่แค่ audit_log
   * เพราะคนที่ต้องอ่านคือนักศึกษา ส่วน audit_log จงใจไม่มี read API (SEC-07)
   *
   * ล้าง `request_form_path` ทิ้งด้วย เพื่อให้หน้าจอนักศึกษากลับไปอยู่สภาพ
   * "ยังไม่ได้ส่ง" จริงๆ ไม่ใช่ค้างไฟล์เดิมไว้แล้วเข้าใจว่าส่งไปแล้ว
   */
  static async officerRejectRequest(
    formId: number,
    reason: string
  ): Promise<{ studentId: number; previousPath: string | null }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT student_id, status, request_form_path FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );
      if ((current.rowCount ?? 0) === 0) throw new Error('ไม่พบคำร้องที่ต้องการ');

      const row = current.rows[0];
      assertAllowedTransition('officer_reject', row.status, OFFICER_DECISION_FROM);

      await client.query(
        `UPDATE intent_forms
            SET status = 'pending_advisor', request_form_path = NULL, reject_reason = $1
          WHERE form_id = $2`,
        [reason, formId]
      );

      await client.query('COMMIT');
      return {
        studentId: row.student_id as number,
        previousPath: row.request_form_path as string | null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async findById(formId: number): Promise<IntentForm | null> {
    const res = await query(
      `SELECT form_id, student_id, company_id, semester_id, job_id, status, mentor_id, start_date, acceptance_evidence_path 
       FROM intent_forms 
       WHERE form_id = $1`,
      [formId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as IntentForm;
  }

  /**
   * Company Acceptance transaction logic.
   */
  static async acceptByCompanyWithTransaction(
    intentId: number,
    companyUserId: number,
    mentorData: {
      name: string;
      email: string;
      phone: string;
      position?: string;
      department?: string;
    },
    startDate: string
  ): Promise<IntentForm> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock intent form FOR UPDATE
      const intentRes = await client.query(
        `SELECT form_id, student_id, company_id, semester_id, job_id, status 
         FROM intent_forms 
         WHERE form_id = $1 
         FOR UPDATE`,
        [intentId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        throw new Error('Intent form not found.');
      }

      const intent = intentRes.rows[0];

      // 2. Authorize that the companyUserId created/owns the company listed on the intent form
      const companyRes = await client.query(
        `SELECT company_id, name_th, created_by 
         FROM companies 
         WHERE company_id = $1`,
        [intent.company_id]
      );
      if ((companyRes.rowCount ?? 0) === 0) {
        throw new Error('Company associated with this intent form not found.');
      }
      const company = companyRes.rows[0];
      if (company.created_by !== companyUserId) {
        throw new Error('Unauthorized. You are not the representative of the company assigned to this intent form.');
      }

      assertAllowedTransition('company_accept', intent.status, COMPANY_DECISION_FROM);

      // 3. Handle Mentor Account Onboarding Transactionally
      const cleanEmail = mentorData.email.trim().toLowerCase();

      // SEC-03: the nominated mentor must not be the placed student.
      const studentEmailRes = await client.query('SELECT email FROM users WHERE user_id = $1', [intent.student_id]);
      if ((studentEmailRes.rowCount ?? 0) > 0 &&
          (studentEmailRes.rows[0].email || '').trim().toLowerCase() === cleanEmail) {
        throw new Error('ไม่สามารถกำหนดให้นักศึกษาเป็นพี่เลี้ยงของตนเองได้');
      }
      
      const userCheck = await client.query(
        `SELECT u.user_id,
                COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') as roles
         FROM users u
         LEFT JOIN user_roles r ON u.user_id = r.user_id
         WHERE u.email = $1
         GROUP BY u.user_id`,
        [cleanEmail]
      );

      let mentorUserId: number;
      let mentorEmailToSend = '';

      if ((userCheck.rowCount ?? 0) === 0) {
        // No password: the mentor sets their own through the invitation link
        // issued after COMMIT, so none is ever mailed.
        const insertUser = await client.query(
          `INSERT INTO users (email, password_hash, is_active)
           VALUES ($1, NULL, TRUE)
           RETURNING user_id`,
          [cleanEmail]
        );
        mentorUserId = insertUser.rows[0].user_id;

        await client.query(
          `INSERT INTO user_roles (user_id, role_name)
           VALUES ($1, 'mentor')`,
          [mentorUserId]
        );

        await client.query(
          `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            mentorUserId,
            intent.company_id,
            mentorData.name.trim(),
            mentorData.position?.trim() || null,
            mentorData.department?.trim() || null,
            mentorData.phone.trim(),
          ]
        );
        
        mentorEmailToSend = cleanEmail;
        console.log(`Created new mentor account for ${cleanEmail}. Invitation will be sent after commit.`);
      } else {
        const existingUser = userCheck.rows[0];
        mentorUserId = existingUser.user_id;
        const roles: string[] = typeof existingUser.roles === 'string' ? JSON.parse(existingUser.roles) : existingUser.roles;

        const mentorProfileCheck = await client.query(
          `SELECT mentor_id, company_id FROM mentors WHERE mentor_id = $1`,
          [mentorUserId]
        );

        // SEC-03: only an account that is already a mentor may be reused here.
        // Attaching a mentor profile to an arbitrary existing user turned any
        // known email into a mentor of the caller's choosing.
        if ((mentorProfileCheck.rowCount ?? 0) === 0 || !roles.includes('mentor')) {
          throw new Error(
            'อีเมลนี้ถูกใช้งานในระบบแล้วและไม่ใช่บัญชีพี่เลี้ยง กรุณาใช้อีเมลของพี่เลี้ยงที่สถานประกอบการโดยตรง'
          );
        }

        const mentorProfile = mentorProfileCheck.rows[0];
        if (mentorProfile.company_id !== intent.company_id) {
          throw new Error('This mentor email is already registered under a different company.');
        }
      }

      // 4. Update Intent Form status and details
      const updateRes = await client.query(
        `UPDATE intent_forms 
         SET status = 'accepted', mentor_id = $1, start_date = $2 
         WHERE form_id = $3
         RETURNING form_id, student_id, company_id, semester_id, job_id, status, mentor_id, start_date, acceptance_evidence_path`,
        [mentorUserId, new Date(startDate), intentId]
      );

      await client.query('COMMIT');

      // Issued after COMMIT so a rolled-back acceptance never leaves a live invite.
      if (mentorEmailToSend) {
        (async () => {
          await sendMentorInviteEmail(mentorEmailToSend, await createInviteLink(mentorUserId));
        })().catch(console.error);
      }

      return updateRes.rows[0] as IntentForm;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Company Reject logic.
   */
  static async rejectByCompany(intentId: number, companyUserId: number, reason: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const intentRes = await client.query(
        `SELECT form_id, company_id, job_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [intentId]
      );
      if ((intentRes.rowCount ?? 0) === 0) {
        throw new Error('Intent form not found.');
      }
      const intent = intentRes.rows[0];

      // Auth check
      const companyRes = await client.query(
        `SELECT created_by FROM companies WHERE company_id = $1`,
        [intent.company_id]
      );
      if ((companyRes.rowCount ?? 0) === 0 || companyRes.rows[0].created_by !== companyUserId) {
        throw new Error('Unauthorized. You are not the representative of the company assigned to this intent form.');
      }

      assertAllowedTransition('company_reject', intent.status, COMPANY_DECISION_FROM);

      await releaseJobSeat(client, intent.job_id);

      const updateRes = await client.query(
        `UPDATE intent_forms SET status = 'company_rejected', reject_reason = $2 WHERE form_id = $1`,
        [intentId, reason]
      );

      await client.query('COMMIT');
      return (updateRes.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Student Acceptance transaction logic.
   */
  static async acceptByStudentWithTransaction(
    intentId: number,
    studentUserId: number,
    mentorData: {
      name: string;
      email: string;
      phone: string;
      position?: string;
      department?: string;
    },
    startDate: string,
    evidencePath: string,
    /** ส่งกลับหลังพ้น ๑๕ วันทำการ — ผู้เรียกเป็นคนตัดสินโดยเทียบวันที่ฐาน */
    submittedLate = false
  ): Promise<IntentForm> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock intent form FOR UPDATE
      const intentRes = await client.query(
        `SELECT form_id, student_id, company_id, semester_id, job_id, status 
         FROM intent_forms 
         WHERE form_id = $1 
         FOR UPDATE`,
        [intentId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        throw new Error('Intent form not found.');
      }

      const intent = intentRes.rows[0];

      // 2. Validate that it belongs to the logged-in student
      if (intent.student_id !== studentUserId) {
        throw new Error('Unauthorized. You can only upload acceptance proof for your own intent form.');
      }

      assertAllowedTransition('student_accept', intent.status, STUDENT_ACCEPT_FROM);

      // 3. Handle Mentor Account Onboarding Transactionally
      const cleanEmail = mentorData.email.trim().toLowerCase();

      // SEC-03: a student must never be able to nominate themselves as their own
      // mentor — that would make them the evaluator on their own placement.
      const selfCheck = await client.query('SELECT email, alt_email FROM users u LEFT JOIN students s ON s.student_id = u.user_id WHERE u.user_id = $1', [studentUserId]);
      if ((selfCheck.rowCount ?? 0) > 0) {
        const own = selfCheck.rows[0];
        const ownEmails = [own.email, own.alt_email]
          .filter(Boolean)
          .map((e: string) => e.trim().toLowerCase());
        if (ownEmails.includes(cleanEmail)) {
          throw new Error('ไม่สามารถใช้อีเมลของตนเองเป็นอีเมลพี่เลี้ยงได้');
        }
      }

      const userCheck = await client.query(
        `SELECT u.user_id,
                COALESCE(json_agg(r.role_name) FILTER (WHERE r.role_name IS NOT NULL), '[]') as roles
         FROM users u
         LEFT JOIN user_roles r ON u.user_id = r.user_id
         WHERE u.email = $1
         GROUP BY u.user_id`,
        [cleanEmail]
      );

      let mentorUserId: number;

      if ((userCheck.rowCount ?? 0) === 0) {
        // No password and inactive until officer approval, which is also when
        // the invitation goes out. Nothing is emailed from here.
        const insertUser = await client.query(
          `INSERT INTO users (email, password_hash, is_active)
           VALUES ($1, NULL, FALSE)
           RETURNING user_id`,
          [cleanEmail]
        );
        mentorUserId = insertUser.rows[0].user_id;

        await client.query(
          `INSERT INTO user_roles (user_id, role_name)
           VALUES ($1, 'mentor')`,
          [mentorUserId]
        );

        await client.query(
          `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            mentorUserId,
            intent.company_id,
            mentorData.name.trim(),
            mentorData.position?.trim() || null,
            mentorData.department?.trim() || null,
            mentorData.phone.trim(),
          ]
        );
        
        console.log(`Generated new pending mentor account for ${cleanEmail}.`);
      } else {
        const existingUser = userCheck.rows[0];
        mentorUserId = existingUser.user_id;
        const roles: string[] = typeof existingUser.roles === 'string' ? JSON.parse(existingUser.roles) : existingUser.roles;

        const mentorProfileCheck = await client.query(
          `SELECT mentor_id, company_id FROM mentors WHERE mentor_id = $1`,
          [mentorUserId]
        );

        if ((mentorProfileCheck.rowCount ?? 0) === 0) {
          // SEC-03: refuse to graft a 'mentor' role onto an account that already
          // exists for some other purpose. Doing so let a student nominate their
          // own address (self-evaluation) or a staff member's address (which the
          // officer-approval step would then password-reset and re-activate).
          throw new Error(
            'อีเมลนี้ถูกใช้งานในระบบแล้วและไม่ใช่บัญชีพี่เลี้ยง กรุณาใช้อีเมลของพี่เลี้ยงที่สถานประกอบการโดยตรง'
          );
        }

        if (!roles.includes('mentor')) {
          throw new Error(
            'อีเมลนี้ถูกใช้งานในระบบแล้วและไม่ใช่บัญชีพี่เลี้ยง กรุณาใช้อีเมลของพี่เลี้ยงที่สถานประกอบการโดยตรง'
          );
        }

        const mentorProfile = mentorProfileCheck.rows[0];
        if (mentorProfile.company_id !== intent.company_id) {
          throw new Error('This mentor email is already registered under a different company.');
        }
      }

      // 4. Update Intent Form status to pending_officer_approval
      const updateRes = await client.query(
        `UPDATE intent_forms 
         SET status = 'pending_officer_approval', mentor_id = $1, start_date = $2,
             acceptance_evidence_path = $3, acceptance_submitted_late = $5
         WHERE form_id = $4
         RETURNING form_id, student_id, company_id, semester_id, job_id, status, mentor_id, start_date,
                   acceptance_evidence_path, acceptance_submitted_late`,
        [mentorUserId, new Date(startDate), evidencePath, intentId, submittedLate]
      );

      await client.query('COMMIT');

      return updateRes.rows[0] as IntentForm;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Student interview failure logic.
   */
  static async failByStudent(intentId: number, studentUserId: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const intentRes = await client.query(
        `SELECT form_id, student_id, job_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [intentId]
      );
      if ((intentRes.rowCount ?? 0) === 0) {
        throw new Error('Intent form not found.');
      }
      const intent = intentRes.rows[0];

      // Auth check
      if (intent.student_id !== studentUserId) {
        throw new Error('Unauthorized. You can only reject your own intent form.');
      }

      assertAllowedTransition('student_fail', intent.status, STUDENT_FAIL_FROM);

      // Hand the seat back — previously this path leaked a seat on every failed
      // interview because only the advisor/dept-head rejections decremented.
      await releaseJobSeat(client, intent.job_id);

      const updateRes = await client.query(
        `UPDATE intent_forms SET status = 'rejected' WHERE form_id = $1`,
        [intentId]
      );

      await client.query('COMMIT');
      return (updateRes.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update parental consent file path for an intent form.
   */
}
