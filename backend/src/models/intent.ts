import type { PoolClient } from 'pg';
import pool, { query } from '../config/database';
import { IntentForm } from '../types';

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

/** ข้อมูลพี่เลี้ยงที่นักศึกษาพิมพ์ — ผ่านด่าน SEC-03 ใน `resolvePendingMentor` ก่อนเสมอ */
export interface MentorInput {
  name: string;
  email: string;
  phone: string;
  position?: string;
  department?: string;
  fax?: string;
}

/** นักศึกษาสั่งระบบส่งหนังสือ+แบบตอบรับถึงสถานประกอบการได้กี่ครั้งต่อใบ (`company_mail_count`) */
export const COMPANY_MAIL_LIMIT = 3;
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
   * Submit student intent transactionally.
   */
  static async createWithTransaction(intentData: {
    student_id: number;
    company_id: number;
    semester_id: number;
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

      // 5. Insert Intent Form
      const insertRes = await client.query(
        `INSERT INTO intent_forms
           (student_id, company_id, semester_id, status, submitted_late, late_reason)
         VALUES ($1, $2, $3, 'pending_advisor', $4, $5)
         RETURNING form_id, student_id, company_id, semester_id, status,
                   submitted_late, late_reason`,
        [
          intentData.student_id,
          intentData.company_id,
          intentData.semester_id,
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
      /** มาจากการเลือกสถานที่ใน Google Maps — ใช้กันสร้างบริษัทเดียวกันซ้ำ */
      google_place_id?: string | null;
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
          contact_person, contact_position, email, is_verified, created_by, google_place_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, $11, $12)
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
          studentId,
          companyDetails.google_place_id || null
        ]
      );
      const companyId = companyRes.rows[0].company_id;

      // 4. Create the intent form pointing to the new company
      const insertRes = await client.query(
        `INSERT INTO intent_forms
           (student_id, company_id, semester_id, status, submitted_late, late_reason)
         VALUES ($1, $2, $3, 'pending_advisor', $4, $5)
         RETURNING form_id, student_id, company_id, semester_id, status,
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
      `SELECT form_id, student_id, company_id, semester_id, status, mentor_id, start_date, acceptance_evidence_path 
       FROM intent_forms 
       WHERE form_id = $1`,
      [formId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as IntentForm;
  }

  /**
   * แกนของ "สถานประกอบการไม่รับ" — **ไม่ตรวจว่าใครเป็นคนเรียก** (ผู้เรียกต้องตรวจสิทธิ์เอง) และไม่ BEGIN/COMMIT
   * ใช้โดยลิงก์ตอบรับ (`PublicAcceptanceController.decline`) — บัญชีบริษัทถูกลบแล้ว
   * ผู้เรียกต้องอยู่ในทรานแซกชันของตัวเอง · ล็อกแถวที่นี่ซ้ำได้ (ทรานแซกชันเดียวกัน)
   */
  static async rejectByCompanyWithClient(
    client: PoolClient,
    intentId: number,
    reason: string,
    allowedFrom: string[] = COMPANY_DECISION_FROM
  ): Promise<boolean> {
    const intentRes = await client.query(
      `SELECT form_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
      [intentId]
    );
    if ((intentRes.rowCount ?? 0) === 0) {
      throw new Error('Intent form not found.');
    }
    const intent = intentRes.rows[0];

    assertAllowedTransition('company_reject', intent.status, allowedFrom);

    const updateRes = await client.query(
      `UPDATE intent_forms SET status = 'company_rejected', reject_reason = $2 WHERE form_id = $1`,
      [intentId, reason]
    );
    return (updateRes.rowCount ?? 0) > 0;
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
    submittedLate = false,
    /** ผู้ลงนามบนแบบตอบรับ (เอกสารหมายเลข 2) ที่นักศึกษาพิมพ์ตามกระดาษ — ผู้เรียกตรวจแล้ว */
    signer: { name: string; position: string; signedDate: string } | null = null
  ): Promise<IntentForm> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updated = await IntentFormModel.acceptWithClient(client, {
        intentId,
        source: 'student',
        studentUserId,
        mentorData,
        startDate,
        evidencePath,
        submittedLate,
        signer,
      });

      await client.query('COMMIT');

      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * แกนของ "ตอบรับ" ที่ใช้ร่วมกันสองทาง — นักศึกษาอัปโหลดเอง (`source: 'student'`) และบริษัทตอบ
   * ผ่านลิงก์ (`source: 'link'`) · **ไม่ BEGIN/COMMIT** ผู้เรียกถือทรานแซกชันเอง (ลิงก์ต้อง burn token
   * ในทรานแซกชันเดียวกัน) · ทุกด่าน SEC-03 อยู่ที่นี่ที่เดียว ห้ามแยกสำเนาให้ทางใดทางหนึ่ง
   *
   * - `student`: ผู้เรียกต้องเป็นเจ้าของใบ (`studentUserId`) · เริ่มจาก STUDENT_ACCEPT_FROM
   * - `link`: ไม่มีผู้ใช้ — ตัวตนนักศึกษามาจากใบเอง · เริ่มจาก `approved_by_dept_head` เท่านั้น
   *   (ลิงก์ออกตอนใบอยู่ขั้นนั้นขั้นเดียว ใบที่เลยไปแล้วต้องตอบไม่ได้)
   */
  static async acceptWithClient(
    client: PoolClient,
    p: {
      intentId: number;
      source: 'student' | 'link';
      /** จำเป็นเมื่อ source = 'student' */
      studentUserId?: number;
      /** ไม่ส่ง (ทางลิงก์เท่านั้น) = ยังไม่มีพี่เลี้ยง — นักศึกษาระบุทีหลังด้วย `setMentorWithTransaction` */
      mentorData?: MentorInput;
      startDate: string;
      evidencePath: string;
      /** ส่งกลับหลังพ้น ๑๕ วันทำการ — ผู้เรียกเป็นคนตัดสินโดยเทียบวันที่ฐาน */
      submittedLate: boolean;
      /** ผู้ลงนามบนแบบตอบรับ (เอกสารหมายเลข 2) — ผู้เรียกตรวจแล้ว */
      signer: { name: string; position: string; signedDate: string } | null;
    }
  ): Promise<IntentForm> {
    const { intentId, source, studentUserId, mentorData, startDate, evidencePath, submittedLate, signer } = p;
    // 1. Lock intent form FOR UPDATE
    const intentRes = await client.query(
      `SELECT form_id, student_id, company_id, semester_id, status
       FROM intent_forms
       WHERE form_id = $1
       FOR UPDATE`,
      [intentId]
    );

    if ((intentRes.rowCount ?? 0) === 0) {
      throw new Error('Intent form not found.');
    }

    const intent = intentRes.rows[0];

    // 2. Validate that it belongs to the logged-in student (ทางลิงก์ไม่มีผู้ใช้ — ใบคือตัวตนเดียว)
    if (source === 'student' && intent.student_id !== studentUserId) {
      throw new Error('Unauthorized. You can only upload acceptance proof for your own intent form.');
    }

    assertAllowedTransition(
      source === 'link' ? 'company_accept_via_link' : 'student_accept',
      intent.status,
      source === 'link' ? ['approved_by_dept_head'] : STUDENT_ACCEPT_FROM
    );

    // 3. พี่เลี้ยง — ทางลิงก์ไม่มี (นักศึกษาระบุทีหลังด้วย setMentorWithTransaction)
    const mentorUserId = mentorData ? await IntentFormModel.resolvePendingMentor(client, intent, mentorData) : null;

    // 4. Update Intent Form status to pending_officer_approval
    const updateRes = await client.query(
      `UPDATE intent_forms
       SET status = 'pending_officer_approval', mentor_id = $1, start_date = $2,
           acceptance_evidence_path = $3, acceptance_submitted_late = $5,
           acceptance_signer_name = $6, acceptance_signer_position = $7, acceptance_signed_date = $8,
           reject_reason = NULL, -- ส่งใหม่หลังเจ้าหน้าที่ตีกลับ: เหตุผลเก่าหมดความหมายแล้ว
           acceptance_source = $9
       WHERE form_id = $4
       RETURNING form_id, student_id, company_id, semester_id, status, mentor_id, start_date,
                 acceptance_evidence_path, acceptance_submitted_late, acceptance_source`,
      [
        mentorUserId, new Date(startDate), evidencePath, intentId, submittedLate,
        signer?.name ?? null, signer?.position ?? null, signer?.signedDate ?? null,
        source,
      ]
    );
    return updateRes.rows[0] as IntentForm;
  }

  /**
   * พี่เลี้ยงของใบนี้ — หาบัญชีเดิมหรือสร้างบัญชีใหม่ (ยังไม่เปิดใช้ ไม่มีรหัสผ่าน) แล้วคืน user_id
   * ใช้ร่วมกันทั้งตอนตอบรับ (`acceptWithClient`) และตอนนักศึกษาระบุพี่เลี้ยงทีหลัง (`setMentorWithTransaction`)
   * ⛔ ด่าน SEC-03 ทั้งหมดอยู่ที่นี่ที่เดียว ห้ามแยกสำเนา · ไม่ BEGIN/COMMIT ผู้เรียกถือทรานแซกชันเอง
   */
  static async resolvePendingMentor(
    client: PoolClient,
    intent: { student_id: number; company_id: number },
    mentorData: MentorInput
  ): Promise<number> {
    const cleanEmail = mentorData.email.trim().toLowerCase();

    // SEC-03: a student must never be able to nominate themselves as their own
    // mentor — that would make them the evaluator on their own placement.
    // ใช้นักศึกษาเจ้าของใบเสมอ (ทางลิงก์ก็เช่นกัน — บริษัทกรอกอีเมลนักศึกษาเป็นพี่เลี้ยงไม่ได้)
    const selfCheck = await client.query('SELECT email, alt_email FROM users u LEFT JOIN students s ON s.student_id = u.user_id WHERE u.user_id = $1', [intent.student_id]);
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
        `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone, fax)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          mentorUserId,
          intent.company_id,
          mentorData.name.trim(),
          mentorData.position?.trim() || null,
          mentorData.department?.trim() || null,
          mentorData.phone.trim(),
          mentorData.fax?.trim() || null,
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
        throw new Error(
          'อีเมลนี้เป็นพี่เลี้ยงของสถานประกอบการอื่นอยู่แล้ว กรุณาใช้อีเมลของพี่เลี้ยงที่สถานประกอบการนี้โดยตรง'
        );
      }
    }
    return mentorUserId;
  }

  /**
   * นักศึกษาระบุพี่เลี้ยงหลังบริษัทตอบรับทางลิงก์ — ลิงก์ไม่ถามพี่เลี้ยงแล้ว (ตัด สหกิจ 07 ฝั่งบริษัท 2026-10-05)
   *
   * ⛔ ได้เฉพาะตอนใบรอเจ้าหน้าที่ยืนยัน (`pending_officer_approval`) — การกดรับของเจ้าหน้าที่คือจุดที่
   *    บัญชีพี่เลี้ยงถูกเปิดและลิงก์เข้าระบบถูกส่ง (SEC-03 · SEC-15) เจ้าหน้าที่จึงต้องเห็นชื่อ/อีเมลนี้ก่อน
   *    และระบุซ้ำได้จนกว่าจะถูกกดรับ (พิมพ์อีเมลผิดแล้วแก้เองได้ ไม่ต้องรบกวนเจ้าหน้าที่)
   */
  static async setMentorWithTransaction(
    intentId: number,
    studentUserId: number,
    mentorData: MentorInput
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT student_id, company_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [intentId]
      );
      if ((current.rowCount ?? 0) === 0) throw new Error('ไม่พบคำร้องที่ต้องการ');

      const row = current.rows[0];
      if (row.student_id !== studentUserId) {
        throw new Error('คุณระบุพี่เลี้ยงได้เฉพาะคำร้องของตัวเองเท่านั้น');
      }
      assertAllowedTransition('set_mentor', row.status, ['pending_officer_approval']);

      const mentorUserId = await IntentFormModel.resolvePendingMentor(client, row, mentorData);
      await client.query(`UPDATE intent_forms SET mentor_id = $1 WHERE form_id = $2`, [mentorUserId, intentId]);

      // แก้ชื่อ/เบอร์/ตำแหน่งของพี่เลี้ยงที่เพิ่งระบุ (อีเมลเดิม แก้ข้อมูลอื่น) — เฉพาะบัญชีที่ยังไม่เปิดใช้และไม่มีใบอื่นอ้างถึง
      // ⛔ ห้ามเขียนทับพี่เลี้ยงที่เปิดใช้แล้วหรือผูกกับนักศึกษาคนอื่น — ชื่อ/เบอร์ของเขาไม่ใช่ของนักศึกษาคนนี้จะแก้
      await client.query(
        `UPDATE mentors
            SET name = $2, position = $3, department = $4, phone = $5
          WHERE mentor_id = $1
            AND EXISTS (SELECT 1 FROM users WHERE user_id = $1 AND is_active = FALSE)
            AND NOT EXISTS (SELECT 1 FROM intent_forms WHERE mentor_id = $1 AND form_id <> $6)`,
        [
          mentorUserId,
          mentorData.name.trim(),
          mentorData.position?.trim() || null,
          mentorData.department?.trim() || null,
          mentorData.phone.trim(),
          intentId,
        ]
      );

      await client.query('COMMIT');
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
        `SELECT form_id, student_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
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
