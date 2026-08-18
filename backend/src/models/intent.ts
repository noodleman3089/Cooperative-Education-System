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
 *   pending_advisor -> approved_by_advisor -> approved_by_dept_head
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
  'approved_by_advisor',
  'approved_by_dept_head',
  'pending_sign',
  'signed',
  'pending_acceptance',
];

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

export class IntentFormModel {
  /**
   * Submit student intent and update job application count transactionally.
   */
  static async createWithTransaction(intentData: {
    student_id: number;
    company_id: number;
    semester_id: number;
    job_id: number | null;
  }): Promise<IntentForm> {
    const client = await pool.connect();
    
    try {
      // Begin PostgreSQL Transaction
      await client.query('BEGIN');

      // 0. Check if student already has an active intent form for this semester (MED-02)
      const duplicateCheck = await client.query(
        `SELECT 1 FROM intent_forms 
         WHERE student_id = $1 AND semester_id = $2 
         AND status NOT IN ('rejected', 'company_rejected', 'rejected_by_dept_head')`,
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
          `SELECT job_id, company_id, status, quota, applied_count, expire_date 
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

        // Validate expiration
        if (new Date(job.expire_date).getTime() <= Date.now()) {
          throw new Error('Job post has expired.');
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
        `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status)
         VALUES ($1, $2, $3, $4, 'pending_advisor')
         RETURNING form_id, student_id, company_id, semester_id, job_id, status`,
        [
          intentData.student_id,
          intentData.company_id,
          intentData.semester_id,
          intentData.job_id,
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
    }
  ): Promise<IntentForm> {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // 0. Check if student already has an active intent form for this semester
      const duplicateCheck = await client.query(
        `SELECT 1 FROM intent_forms 
         WHERE student_id = $1 AND semester_id = $2 
         AND status NOT IN ('rejected', 'company_rejected', 'rejected_by_dept_head')`,
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
        `INSERT INTO intent_forms (student_id, company_id, semester_id, job_id, status)
         VALUES ($1, $2, $3, NULL, 'pending_advisor')
         RETURNING form_id, student_id, company_id, semester_id, job_id, status`,
        [studentId, companyId, semesterId]
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
  static async findById(formId: number): Promise<IntentForm | null> {
    const res = await query(
      `SELECT form_id, student_id, company_id, semester_id, job_id, status, mentor_id, start_date, acceptance_evidence_path, parental_consent_path 
       FROM intent_forms 
       WHERE form_id = $1`,
      [formId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as IntentForm;
  }

  /**
   * Update the status of an intent form.
   */
  static async updateStatus(formId: number, status: string): Promise<boolean> {
    const res = await query(
      'UPDATE intent_forms SET status = $1 WHERE form_id = $2',
      [status, formId]
    );
    return (res.rowCount ?? 0) > 0;
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
         RETURNING form_id, student_id, company_id, semester_id, job_id, status, mentor_id, start_date, acceptance_evidence_path, parental_consent_path`,
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
    evidencePath: string
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
         SET status = 'pending_officer_approval', mentor_id = $1, start_date = $2, acceptance_evidence_path = $3 
         WHERE form_id = $4
         RETURNING form_id, student_id, company_id, semester_id, job_id, status, mentor_id, start_date, acceptance_evidence_path, parental_consent_path`,
        [mentorUserId, new Date(startDate), evidencePath, intentId]
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
  static async updateParentalConsent(intentId: number, path: string): Promise<boolean> {
    const res = await query(
      'UPDATE intent_forms SET parental_consent_path = $1 WHERE form_id = $2',
      [path, intentId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Dept Head approval logic — transitions from 'approved_by_advisor' to 'approved_by_dept_head'.
   */
  static async approveByDeptHead(formId: number, deptHeadUserId: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock intent form FOR UPDATE
      const intentRes = await client.query(
        `SELECT form_id, student_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        throw new Error('Intent form not found.');
      }

      const intent = intentRes.rows[0];

      if (intent.status !== 'approved_by_advisor') {
        throw new Error(`Can only approve intent forms in 'approved_by_advisor' status. Current: '${intent.status}'.`);
      }

      // 2. Validate dept head major matches student major
      const deptHeadCheck = await client.query(
        `SELECT major_id FROM personnel WHERE personnel_id = $1`,
        [deptHeadUserId]
      );
      const studentCheck = await client.query(
        `SELECT major_id FROM students WHERE student_id = $1`,
        [intent.student_id]
      );

      if ((deptHeadCheck.rowCount ?? 0) === 0 || (studentCheck.rowCount ?? 0) === 0) {
        throw new Error('Dept Head or student profile not found.');
      }

      if (deptHeadCheck.rows[0].major_id !== studentCheck.rows[0].major_id) {
        throw new Error('Unauthorized. Dept Head major does not match student major.');
      }

      // 3. Update status
      await client.query(
        `UPDATE intent_forms SET status = 'approved_by_dept_head' WHERE form_id = $1`,
        [formId]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Dept Head rejection transaction logic (reverts applied count).
   */
  static async rejectByDeptHeadWithTransaction(formId: number, deptHeadUserId: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock intent form FOR UPDATE
      const intentRes = await client.query(
        `SELECT form_id, student_id, job_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        throw new Error('Intent form not found.');
      }

      const intent = intentRes.rows[0];

      if (intent.status !== 'approved_by_advisor') {
        throw new Error(`Can only reject intent forms in 'approved_by_advisor' status. Current: '${intent.status}'.`);
      }

      // 2. Validate dept head major matches student major
      const deptHeadCheck = await client.query(
        `SELECT major_id FROM personnel WHERE personnel_id = $1`,
        [deptHeadUserId]
      );
      const studentCheck = await client.query(
        `SELECT major_id FROM students WHERE student_id = $1`,
        [intent.student_id]
      );

      if ((deptHeadCheck.rowCount ?? 0) === 0 || (studentCheck.rowCount ?? 0) === 0) {
        throw new Error('Dept Head or student profile not found.');
      }

      if (deptHeadCheck.rows[0].major_id !== studentCheck.rows[0].major_id) {
        throw new Error('Unauthorized. Dept Head major does not match student major.');
      }

      // 3. Decrement job applied count if job_id is associated
      await releaseJobSeat(client, intent.job_id);

      // 4. Update status to 'rejected_by_dept_head'
      await client.query(
        `UPDATE intent_forms SET status = 'rejected_by_dept_head' WHERE form_id = $1`,
        [formId]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Advisor rejection transaction logic (reverts applied count).
   */
  static async rejectByAdvisorWithTransaction(formId: number, advisorUserId: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock intent form FOR UPDATE
      const intentRes = await client.query(
        `SELECT form_id, student_id, job_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        throw new Error('Intent form not found.');
      }

      const intent = intentRes.rows[0];

      if (intent.status !== 'pending_advisor') {
        throw new Error('Can only reject intent forms in pending_advisor status.');
      }

      // 2. Validate advisor major matches student major
      const advisorCheck = await client.query(
        `SELECT major_id FROM personnel WHERE personnel_id = $1`,
        [advisorUserId]
      );
      const studentCheck = await client.query(
        `SELECT major_id FROM students WHERE student_id = $1`,
        [intent.student_id]
      );

      if ((advisorCheck.rowCount ?? 0) === 0 || (studentCheck.rowCount ?? 0) === 0) {
        throw new Error('Advisor or student profile not found.');
      }

      if (advisorCheck.rows[0].major_id !== studentCheck.rows[0].major_id) {
        throw new Error('Unauthorized. Advisor major does not match student major.');
      }

      // 3. Decrement job applied count if job_id is associated
      await releaseJobSeat(client, intent.job_id);

      // 4. Update status to 'rejected'
      await client.query(
        `UPDATE intent_forms SET status = 'rejected' WHERE form_id = $1`,
        [formId]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
