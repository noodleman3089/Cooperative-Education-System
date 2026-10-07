import type { PoolClient } from 'pg';
import pool, { query } from '../config/database';
import { IntentForm } from '../types';
import { recordStageEvent } from '../utils/stageEvents';

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
/**
 * ถอนหนังสือขอความอนุเคราะห์ที่ยังไม่ลงนามได้ **เฉพาะใบที่เจ้าหน้าที่รับแล้วและยังรอคณบดีลงนาม** (SEC-04)
 * ใบถอยกลับไป `pending_officer_request` — ถอยได้ทางเดียวนี้ ไม่ใช่ทางลัดข้ามขั้นไปที่อื่น
 */
export const LETTER_RETURN_FROM = ['approved_by_dept_head'];
/**
 * นักศึกษายกเลิกคำร้องเองได้ **ก่อนเจ้าหน้าที่รับเท่านั้น** (เจ้าของสั่ง 2026-10-06)
 * หลังเจ้าหน้าที่รับ = บริษัทถูกรับรองและเลขที่หนังสือออกไปแล้ว ย้อนด้วยปุ่มของนักศึกษาไม่ได้
 */
export const STUDENT_WITHDRAW_FROM = ['pending_advisor', 'pending_officer_request'];
/**
 * นักศึกษาแก้ข้อมูลสถานประกอบการของใบที่ยื่นแล้วได้ **เฉพาะก่อนอัปโหลดกระดาษที่ลงนาม** (เจ้าของสั่ง 2026-10-06)
 * อัปโหลดแล้ว = กระดาษถูกเซ็นด้วยข้อมูลชุดนั้น แก้ต่อจะทำให้ระบบไม่ตรงกับกระดาษที่เจ้าหน้าที่ตรวจ
 * (ใบที่เจ้าหน้าที่ตีกลับจะกลับมาที่ `pending_advisor` จึงแก้ได้อีก)
 */
export const STUDENT_EDIT_COMPANY_FROM = ['pending_advisor'];

/** ช่องสถานประกอบการที่นักศึกษาพิมพ์เองในหน้ายื่นคำร้อง — ผู้เรียกตรวจรูปแบบแล้ว */
export interface TypedCompanyInput {
  name_th: string;
  address: string;
  province: string;
  district: string;
  postal_code: string;
  phone: string;
  contact_person?: string;
  contact_position?: string;
  email?: string;
  /** มือถือ/โทรสารของผู้รับหนังสือ — พิมพ์ลงเอกสารหมายเลข 1 */
  contact_phone?: string;
  contact_fax?: string;
  /** มาจากการเลือกสถานที่ใน Google Maps — ใช้กันสร้างบริษัทเดียวกันซ้ำ */
  google_place_id?: string | null;
}

/** ค่าของ `TypedCompanyInput` เรียงตามลำดับคอลัมน์ที่ INSERT/UPDATE ด้านล่างใช้ร่วมกัน ($3–$14) */
const draftCompanyValues = (c: TypedCompanyInput): unknown[] => [
  c.name_th,
  c.address,
  c.province,
  c.district,
  c.postal_code,
  c.phone,
  c.contact_person || null,
  c.contact_position || null,
  c.email || null,
  c.google_place_id || null,
  c.contact_phone || null,
  c.contact_fax || null,
];

/** ความยาวขั้นต่ำของเหตุผลการส่งช้า — ใช้ทั้งตอนยื่นคำร้องและตอนอัปโหลดกระดาษที่ลงนาม */
export const LATE_REASON_MIN_LENGTH = 20;

/** คำไทยของสถานะใบคำร้อง — ใช้ในข้อความ error เท่านั้น (คำแปลบนหน้าจออยู่ที่ `StatusBadge` ฝั่ง frontend) */
const STATUS_TH: Record<string, string> = {
  pending_advisor: 'รอนักศึกษาอัปโหลดแบบคำร้องที่ลงนาม',
  pending_officer_request: 'รอเจ้าหน้าที่ตรวจแบบคำร้อง',
  approved_by_dept_head: 'เจ้าหน้าที่รับคำร้องแล้ว',
  pending_sign: 'รอคณบดีลงนาม',
  signed: 'คณบดีลงนามแล้ว',
  pending_acceptance: 'รอสถานประกอบการตอบรับ',
  pending_officer_approval: 'รอเจ้าหน้าที่ยืนยันแบบตอบรับ',
  accepted: 'สถานประกอบการตอบรับแล้ว',
  rejected: 'คำร้องปิดแล้ว',
  company_rejected: 'สถานประกอบการไม่รับ',
  superseded: 'คำร้องถูกแทนที่แล้ว',
};

export function assertAllowedTransition(action: string, currentStatus: string, allowedFrom: string[]): void {
  if (!allowedFrom.includes(currentStatus)) {
    // ข้อความนี้ถึงมือผู้ใช้ — บอกเป็นคำไทยว่าใบอยู่ขั้นไหน ไม่ใช่ชื่อสถานะดิบ (ชื่อ action/สถานะดิบอยู่ในวงเล็บท้ายไว้ให้คนแก้ระบบ)
    const th = (s: string) => STATUS_TH[s] ?? s;
    throw new Error(
      `ทำรายการนี้ไม่ได้ เพราะคำร้องอยู่ในขั้น "${th(currentStatus)}" — ทำได้เฉพาะขั้น ${allowedFrom
        .map((s) => `"${th(s)}"`)
        .join(' หรือ ')} (${action})`
    );
  }
}

/**
 * คำขอถูกรูปแบบ แต่ชนกับสภาพปัจจุบันของใบ — controller ตอบ 409 พร้อม `code` ให้หน้าจอแยกกรณีได้
 * (ไฟล์ที่ดูอยู่เป็นไฟล์เก่า · เลขที่หนังสือซ้ำ · คณบดีลงนามไปแล้ว)
 */
export class IntentConflictError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'stale_request_file'
      | 'duplicate_document_no'
      | 'not_awaiting_dean'
      | 'letter_missing'
      | 'letter_signed',
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

/**
 * เลขที่หนังสือออกนี้อยู่บนคำร้องใบอื่นแล้วหรือไม่ — เจอ = 409 พร้อมชื่อนักศึกษาของใบนั้น
 *
 * ⛔ **เตือน ไม่บล็อก**: หน้าจอถามยืนยันแล้วส่งซ้ำพร้อมธงยอมรับ · ยังไม่รู้ว่าของจริงหนังสือฉบับเดียว
 *    ครอบนักศึกษาหลายคนได้หรือไม่ จึงไม่ทำ UNIQUE ที่ฐาน
 */
async function assertDocumentNoUnused(client: PoolClient, formId: number, documentNo: string): Promise<void> {
  const other = await client.query(
    `SELECT s.student_code, NULLIF(TRIM(CONCAT_WS(' ', s.first_name, s.last_name)), '') AS name
       FROM intent_forms o JOIN students s ON s.student_id = o.student_id
      WHERE o.officer_document_no = $1 AND o.form_id <> $2
      ORDER BY o.form_id DESC LIMIT 1`,
    [documentNo, formId]
  );
  if ((other.rowCount ?? 0) === 0) return;
  const who = [other.rows[0].name, other.rows[0].student_code].filter(Boolean).join(' · ');
  throw new IntentConflictError(
    `เลขที่หนังสือ ${documentNo} ถูกใช้กับคำร้องของ ${who} แล้ว`,
    'duplicate_document_no',
    { duplicate_student: who }
  );
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

      await recordStageEvent(client, insertRes.rows[0].form_id, 'form_created');

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
    companyDetails: TypedCompanyInput,
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
      const companyId = await IntentFormModel.insertDraftCompany(client, studentId, companyDetails);

      // 4. Create the intent form pointing to the new company
      const insertRes = await client.query(
        `INSERT INTO intent_forms
           (student_id, company_id, semester_id, status, submitted_late, late_reason)
         VALUES ($1, $2, $3, 'pending_advisor', $4, $5)
         RETURNING form_id, student_id, company_id, semester_id, status,
                   submitted_late, late_reason`,
        [studentId, companyId, semesterId, late.submitted_late, late.late_reason]
      );

      await recordStageEvent(client, insertRes.rows[0].form_id, 'form_created');

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

  /**
   * รายชื่อบุคลากรในสาขาของนักศึกษา — ตัวช่วยค้นหาในช่องชื่อผู้ลงนามตอนอัปโหลดแบบคำร้อง
   * ⛔ ชื่ออย่างเดียว ไม่มีอีเมล/เบอร์/รหัส (หน้านี้นักศึกษาเป็นคนเห็น) · พิมพ์ชื่อนอกรายการได้ (ผู้รักษาการแทนจากสาขาอื่น)
   * ⛔ การเลือกชื่อไม่ใช่การตั้ง `students.advisor_id` — นั่นเป็นงานของหัวหน้าสาขา
   */
  static async listSignerCandidates(studentId: number): Promise<string[]> {
    const res = await query(
      `SELECT DISTINCT TRIM(CONCAT_WS(' ', p.first_name, p.last_name)) AS name
         FROM personnel p
         JOIN students s ON s.major_id = p.major_id
        WHERE s.student_id = $1 AND TRIM(CONCAT_WS(' ', p.first_name, p.last_name)) <> ''
        ORDER BY name`,
      [studentId]
    );
    return res.rows.map((r: { name: string }) => r.name);
  }

  static async attachRequestForm(
    formId: number,
    studentId: number,
    filePath: string,
    typedSigners: { advisorName?: string; deptHeadName?: string } = {},
    /** ผลของด่านปฏิทิน ณ ตอนอัปโหลด — กำหนดส่งนับที่วันอัปโหลดกระดาษ (เจ้าของตัดสิน 2026-10-06) */
    late: { inLateWindow: boolean; reason: string } = { inLateWindow: false, reason: '' }
  ): Promise<{ previousPath: string | null }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT student_id, status, request_form_path, submitted_late,
                advisor_signer_name, dept_head_signer_name
           FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );
      if ((current.rowCount ?? 0) === 0) throw new Error('ไม่พบคำร้องที่ต้องการ');

      const row = current.rows[0];
      if (row.student_id !== studentId) {
        throw new Error('คุณอัปโหลดได้เฉพาะคำร้องของตัวเองเท่านั้น');
      }
      assertAllowedTransition('upload_request_form', row.status, OFFICER_RECEIVE_FROM);

      // อัปโหลดในช่วงผ่อนผัน = ส่งช้า ต้องมีเหตุผล (ใบที่ติดธงตั้งแต่ตอนยื่นมีเหตุผลอยู่แล้ว ไม่ถามซ้ำ)
      // ⛔ ธงตั้งได้อย่างเดียว ไม่มีทางถอด — ปั๊ม ณ ตอนเกิดเหตุ ไม่คำนวณย้อนหลังจากปฏิทิน
      const stampLate = late.inLateWindow && !row.submitted_late;
      if (stampLate && late.reason.length < LATE_REASON_MIN_LENGTH) {
        throw new Error(
          'การส่งแบบคำร้องที่ลงนามครั้งนี้เลยกำหนดปกติแล้ว แต่ยังอยู่ในช่วงผ่อนผัน ระบบจึงรับได้แต่นับเป็นการส่งช้า ' +
            `กรุณาระบุเหตุผลอย่างน้อย ${LATE_REASON_MIN_LENGTH} ตัวอักษร`
        );
      }

      // ลำดับของชื่อผู้ลงนาม (เจ้าของตัดสิน 2026-10-06 — เดิมชื่อที่ระบบรู้ชนะเสมอ ทำให้บันทึกผิดคนเมื่อมีผู้รักษาการแทน):
      //   ชื่อที่นักศึกษาระบุรอบนี้ → ชื่อที่อยู่บนใบจากรอบก่อน (เปลี่ยนไฟล์/ส่งใหม่) → ชื่อที่ระบบรู้
      // ชื่อนี้ไม่ถูกพิมพ์ลงหนังสือ ใช้แสดงให้เจ้าหน้าที่/หัวหน้าสาขาเท่านั้น และหน้าจอเจ้าหน้าที่ติดป้ายเมื่อไม่ตรงกับที่ระบบรู้
      const known = await IntentFormModel.resolveRequestSigners(studentId, client);
      const advisorName =
        typedSigners.advisorName?.trim() || row.advisor_signer_name || known.advisor_name || null;
      const deptHeadName =
        typedSigners.deptHeadName?.trim() || row.dept_head_signer_name || known.dept_head_name || null;
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
                advisor_signer_name = $3, dept_head_signer_name = $4,
                submitted_late = submitted_late OR $5,
                late_reason = CASE WHEN $5 THEN $6 ELSE late_reason END
          WHERE form_id = $2`,
        [filePath, formId, advisorName, deptHeadName, stampLate, stampLate ? late.reason : null]
      );
      await recordStageEvent(client, formId, 'request_uploaded');

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
    input: { documentNo: string; shownRequestFormPath: string; allowDuplicateNo: boolean }
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
      // ด่านมนุษย์ของ SEC-04 คือ "เจ้าหน้าที่อ่านกระดาษใบนี้แล้ว" — นักศึกษาเปลี่ยนไฟล์ได้ระหว่างรอ
      // จึงต้องรับได้เฉพาะไฟล์ที่หน้าจอแสดงอยู่จริง · เทียบภายใต้ FOR UPDATE การอัปโหลดซ้อนจึงแทรกไม่ได้
      if (row.request_form_path !== input.shownRequestFormPath) {
        throw new IntentConflictError(
          'นักศึกษาส่งไฟล์ใหม่แล้ว กรุณาตรวจไฟล์ล่าสุดก่อนรับ',
          'stale_request_file'
        );
      }
      if (!input.allowDuplicateNo) {
        await assertDocumentNoUnused(client, formId, input.documentNo);
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
      await recordStageEvent(client, formId, 'officer_approved');

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
    reason: string,
    officerUserId: number
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
      // เหตุผลบนแถวใบถูกล้างเมื่อนักศึกษาส่งใหม่ — เก็บสำเนากับเหตุการณ์ไว้ให้เจ้าหน้าที่คนถัดไปเห็นว่าเคยตีกลับเพราะอะไร
      await recordStageEvent(client, formId, 'request_returned', { note: reason, actorId: officerUserId });

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

  /**
   * ถอนหนังสือขอความอนุเคราะห์ที่ **ยังไม่ลงนาม** — คณบดีตีกลับ (`by = 'dean'`) หรือเจ้าหน้าที่ดึงกลับ (`'staff'`)
   *
   * หนังสือถูก **ลบทิ้ง** ใบถอยไป `pending_officer_request` แล้วเจ้าหน้าที่ใช้ปุ่มเดิม: รับใหม่ (ออกหนังสือฉบับใหม่) หรือตีกลับนักศึกษา
   *
   * ⛔ ลบแถว **ไม่ตั้งเป็น `rejected`** — `issueCoverLetter` เจอแถวที่ไม่ใช่ `pending_sign` แล้วตอบ 409 รับใหม่ด้วยเลขเดิมไม่ได้
   * ⛔ คง `officer_document_no` ไว้ (เจ้าหน้าที่มักใช้เลขเดิม) · ไม่เขียน `reject_reason` — หน้านักศึกษาอ่านช่องนั้นเป็น "เจ้าหน้าที่ตีกลับ"
   * ⛔ ล็อกแถวใบก่อนแถวหนังสือ (ลำดับเดียวกับ `issueCoverLetter` กัน deadlock) · ลงนามแล้ว = 409 `letter_signed`
   * ไม่มีแถวหนังสือ (รับแล้วแต่วาดพัง) = ถอนได้ — เจ้าหน้าที่อาจอยากดึงกลับแทนออกใหม่
   * ผู้เรียกลบไฟล์ PDF ฉบับร่างหลัง COMMIT (`draftPath`)
   */
  static async returnCoverLetter(
    formId: number,
    input: { reason: string; actorUserId: number; by: 'dean' | 'staff'; docId?: number }
  ): Promise<{ studentId: number; documentNo: string | null; draftPath: string | null; officerId: number | null }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT student_id, company_id, status, officer_document_no, officer_approved_by
           FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );
      if ((current.rowCount ?? 0) === 0) throw new Error('ไม่พบคำร้องที่ต้องการ');
      const row = current.rows[0];
      assertAllowedTransition('letter_return', row.status, LETTER_RETURN_FROM);

      const doc = await client.query(
        `SELECT doc_id, status, generated_file_path FROM official_documents
          WHERE student_id = $1 AND company_id = $2 AND type = 'cover_letter'
            AND document_number IS NOT DISTINCT FROM $3
          ORDER BY doc_id DESC LIMIT 1
            FOR UPDATE`,
        [row.student_id, row.company_id, row.officer_document_no]
      );
      const letter = doc.rows[0] as { doc_id: number; status: string; generated_file_path: string | null } | undefined;
      if (letter && letter.status !== 'pending_sign') {
        throw new IntentConflictError('คณบดีลงนามหนังสือฉบับนี้แล้ว จึงถอนกลับไม่ได้', 'letter_signed');
      }
      if (letter && input.docId !== undefined && letter.doc_id !== input.docId) {
        throw new IntentConflictError(
          'หนังสือฉบับนี้ไม่ใช่ฉบับล่าสุดของคำร้อง (อาจถูกออกใหม่แล้ว) กรุณารีเฟรชรายการ',
          'letter_missing'
        );
      }

      if (letter) await client.query('DELETE FROM official_documents WHERE doc_id = $1', [letter.doc_id]);
      await client.query(`UPDATE intent_forms SET status = 'pending_officer_request' WHERE form_id = $1`, [formId]);
      await recordStageEvent(client, formId, input.by === 'dean' ? 'dean_returned' : 'staff_recalled', {
        note: input.reason,
        actorId: input.actorUserId,
      });

      await client.query('COMMIT');
      return {
        studentId: row.student_id as number,
        documentNo: (row.officer_document_no as string | null) ?? null,
        draftPath: letter?.generated_file_path ?? null,
        officerId: (row.officer_approved_by as number | null) ?? null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * เจ้าหน้าที่แก้เลขที่หนังสือออกหลังรับคำร้อง — ได้จนกว่าคณบดีจะลงนาม
   *
   * ⛔ ต้องแก้ **สองที่ในทรานแซกชันเดียว**: `intent_forms.officer_document_no` และ
   *    `official_documents.document_number` — ทั้งระบบจับคู่หนังสือกับใบด้วยเลขนี้
   *    (LATERAL `document_number IS NOT DISTINCT FROM officer_document_no`) แก้ที่เดียว = หนังสือหลุดจากใบ
   * ผู้เรียกวาดไฟล์หนังสือใหม่หลัง COMMIT (`issueCoverLetter`)
   */
  static async changeOfficerDocumentNo(
    formId: number,
    input: { documentNo: string; allowDuplicateNo: boolean }
  ): Promise<{ studentId: number; previousNo: string | null }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT student_id, company_id, status, officer_document_no
           FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );
      if ((current.rowCount ?? 0) === 0) throw new Error('ไม่พบคำร้องที่ต้องการ');
      const row = current.rows[0];
      if (row.status !== 'approved_by_dept_head') {
        throw new IntentConflictError(
          'แก้เลขที่หนังสือได้เฉพาะคำร้องที่รับแล้วและยังรอคณบดีลงนาม',
          'not_awaiting_dean'
        );
      }

      const doc = await client.query(
        `SELECT doc_id, status FROM official_documents
          WHERE student_id = $1 AND company_id = $2 AND type = 'cover_letter'
            AND document_number IS NOT DISTINCT FROM $3
          ORDER BY doc_id DESC LIMIT 1
            FOR UPDATE`,
        [row.student_id, row.company_id, row.officer_document_no]
      );
      if ((doc.rowCount ?? 0) === 0) {
        throw new IntentConflictError(
          'คำร้องนี้ยังไม่มีหนังสือขอความอนุเคราะห์ กรุณาสร้างหนังสือก่อนแล้วจึงแก้เลข',
          'letter_missing'
        );
      }
      if (doc.rows[0].status !== 'pending_sign') {
        throw new IntentConflictError(
          'คณบดีลงนามหนังสือฉบับนี้แล้ว จึงแก้เลขที่หนังสือไม่ได้',
          'letter_signed'
        );
      }
      if (!input.allowDuplicateNo) {
        await assertDocumentNoUnused(client, formId, input.documentNo);
      }

      await client.query('UPDATE intent_forms SET officer_document_no = $1 WHERE form_id = $2', [
        input.documentNo,
        formId,
      ]);
      await client.query('UPDATE official_documents SET document_number = $1 WHERE doc_id = $2', [
        input.documentNo,
        doc.rows[0].doc_id,
      ]);

      await client.query('COMMIT');
      return {
        studentId: row.student_id as number,
        previousNo: row.officer_document_no as string | null,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * นักศึกษายกเลิกคำร้องของตัวเองก่อนเจ้าหน้าที่รับ — **ลบใบทิ้งทั้งใบ** (เจ้าของตัดสิน 2026-10-06)
   * ยื่นที่ใหม่ได้ทันที · ร่องรอยที่เหลือคือ `audit_log` (`intent.withdrawn`) เท่านั้น
   *
   * ⛔ ไม่ใช้ `failByStudent` ซ้ำ — เส้นนั้นตั้ง `rejected` และหน้าจอแปลว่า "สัมภาษณ์ไม่ผ่าน"
   *
   * ในทรานแซกชันเดียวกัน: แถวสถานประกอบการที่นักศึกษาสร้างเอง ยังไม่รับรอง และไม่มีอะไรอ้างถึงแล้ว
   * ถูกลบตามไปด้วย — ข้อมูลผิดคือเหตุที่ยกเลิก ปล่อยไว้จะค้างในทำเนียบและถูกจับคู่กลับมาตอนยื่นสถานที่เดิมใหม่
   * (ตารางลูกของใบ — `intent_stage_events` · `acceptance_link_tokens` — เป็น ON DELETE CASCADE · `student_memos` เป็น SET NULL)
   */
  static async withdrawByStudent(
    formId: number,
    studentId: number
  ): Promise<{ previousPath: string | null; companyId: number; companyName: string; companyDeleted: boolean }> {
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
      if (row.student_id !== studentId) {
        throw new Error('คุณยกเลิกได้เฉพาะคำร้องของตัวเองเท่านั้น');
      }
      assertAllowedTransition('student_withdraw', row.status, STUDENT_WITHDRAW_FROM);

      const company = await client.query('SELECT name_th FROM companies WHERE company_id = $1', [
        row.company_id,
      ]);
      await client.query('DELETE FROM intent_forms WHERE form_id = $1', [formId]);
      const companyDeleted = await IntentFormModel.deleteDraftCompanyIfOrphan(client, row.company_id, studentId);

      await client.query('COMMIT');
      return {
        previousPath: row.request_form_path as string | null,
        companyId: row.company_id as number,
        companyName: (company.rows[0]?.name_th as string) ?? '',
        companyDeleted,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** สร้างแถวสถานประกอบการที่นักศึกษากรอกเอง (ยังไม่รับรอง) — ใช้ทั้งตอนยื่นและตอนแก้ */
  private static async insertDraftCompany(
    client: PoolClient,
    studentId: number,
    c: TypedCompanyInput
  ): Promise<number> {
    const res = await client.query(
      `INSERT INTO companies (
         is_verified, created_by,
         name_th, address, province, district, postal_code, phone,
         contact_person, contact_position, email, google_place_id, contact_phone, contact_fax
       )
       VALUES (FALSE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING company_id`,
      [studentId, ...draftCompanyValues(c)]
    );
    return res.rows[0].company_id as number;
  }

  /**
   * ลบแถวสถานประกอบการที่นักศึกษาสร้างเอง ยังไม่รับรอง และไม่มีอะไรอ้างถึงแล้ว (ใบถูกยกเลิก/ย้ายไปบริษัทอื่น)
   * ⛔ ต้องเช็คทุกตารางที่อ้าง `companies` (FK เป็น RESTRICT ทั้งหมด) — หลุดตัวเดียวทรานแซกชันของผู้เรียกจะ rollback
   * ⛔ ห้ามผ่อนเงื่อนไข `created_by` / `is_verified` — แถวของทำเนียบและแถวของนักศึกษาคนอื่นต้องไม่หายจากเส้นนี้
   */
  private static async deleteDraftCompanyIfOrphan(
    client: PoolClient,
    companyId: number,
    studentId: number
  ): Promise<boolean> {
    const removed = await client.query(
      `DELETE FROM companies c
        WHERE c.company_id = $1 AND c.created_by = $2 AND c.is_verified = FALSE
          AND NOT EXISTS (SELECT 1 FROM intent_forms x WHERE x.company_id = c.company_id)
          AND NOT EXISTS (SELECT 1 FROM official_documents x WHERE x.company_id = c.company_id)
          AND NOT EXISTS (SELECT 1 FROM mentors x WHERE x.company_id = c.company_id)
          AND NOT EXISTS (SELECT 1 FROM report_outlines x WHERE x.company_id = c.company_id)
          AND NOT EXISTS (SELECT 1 FROM supervision_appointments x WHERE x.company_id = c.company_id)
          AND NOT EXISTS (SELECT 1 FROM supervision_records x WHERE x.company_id = c.company_id)`,
      [companyId, studentId]
    );
    return (removed.rowCount ?? 0) > 0;
  }

  /**
   * นักศึกษาแก้สถานประกอบการของใบที่ยื่นแล้ว **ก่อนอัปโหลดกระดาษที่ลงนาม** — ใบเดิม (form_id · ตราส่งช้า) คงอยู่
   * เปลี่ยนแค่ว่าใบชี้ไปสถานประกอบการไหน:
   *   - เลือกจากทำเนียบ          → ชี้ไปแถวนั้น (ต้องรับรองแล้ว)
   *   - พิมพ์เอง + แถวเดิมเป็นร่างของตัวเองที่ไม่มีใบอื่นอ้าง → **แก้ในแถวเดิม**
   *   - พิมพ์เอง + แถวเดิมเป็นของทำเนียบ/ของคนอื่น/มีใบอื่นอ้าง → สร้างแถวร่างใหม่
   * ⛔ เส้นนี้ **ห้าม UPDATE แถวที่รับรองแล้วหรือแถวที่คนอื่นสร้าง** — ชื่อ/ที่อยู่ของทำเนียบถูกพิมพ์ลงหนังสือของนักศึกษาคนอื่น
   * แถวร่างเดิมที่ไม่มีอะไรอ้างถึงแล้วถูกลบในทรานแซกชันเดียวกัน
   */
  static async changeCompanyByStudent(
    formId: number,
    studentId: number,
    target: { companyId: number } | { typed: TypedCompanyInput }
  ): Promise<{ fromCompanyId: number; toCompanyId: number }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const current = await client.query(
        `SELECT student_id, company_id, status FROM intent_forms WHERE form_id = $1 FOR UPDATE`,
        [formId]
      );
      if ((current.rowCount ?? 0) === 0) throw new Error('ไม่พบคำร้องที่ต้องการ');

      const row = current.rows[0];
      if (row.student_id !== studentId) {
        throw new Error('คุณแก้ไขได้เฉพาะคำร้องของตัวเองเท่านั้น');
      }
      assertAllowedTransition('student_edit_company', row.status, STUDENT_EDIT_COMPANY_FROM);

      const fromCompanyId = row.company_id as number;
      let toCompanyId: number;

      if ('companyId' in target) {
        const found = await client.query(
          'SELECT 1 FROM companies WHERE company_id = $1 AND is_verified = TRUE',
          [target.companyId]
        );
        if ((found.rowCount ?? 0) === 0) throw new Error('ไม่พบสถานประกอบการนี้ในทำเนียบของคณะ');
        toCompanyId = target.companyId;
      } else {
        const typed = target.typed;
        // สถานที่เดียวกันจาก Google Maps มีแถวอยู่แล้ว (ของคนอื่น) → ใช้แถวนั้น แบบเดียวกับตอนยื่น
        const samePlace = typed.google_place_id
          ? await client.query('SELECT company_id FROM companies WHERE google_place_id = $1', [typed.google_place_id])
          : null;
        const samePlaceId = samePlace?.rows[0]?.company_id as number | undefined;

        if (samePlaceId !== undefined && samePlaceId !== fromCompanyId) {
          toCompanyId = samePlaceId;
        } else {
          const updated = await client.query(
            `UPDATE companies c
                SET name_th = $3, address = $4, province = $5, district = $6, postal_code = $7, phone = $8,
                    contact_person = $9, contact_position = $10, email = $11, google_place_id = $12,
                    contact_phone = $13, contact_fax = $14
              WHERE c.company_id = $1 AND c.created_by = $2 AND c.is_verified = FALSE
                AND NOT EXISTS (
                  SELECT 1 FROM intent_forms x WHERE x.company_id = c.company_id AND x.form_id <> $15
                )`,
            [fromCompanyId, studentId, ...draftCompanyValues(typed), formId]
          );
          toCompanyId =
            (updated.rowCount ?? 0) > 0
              ? fromCompanyId
              : await IntentFormModel.insertDraftCompany(client, studentId, typed);
        }
      }

      if (toCompanyId !== fromCompanyId) {
        await client.query('UPDATE intent_forms SET company_id = $1 WHERE form_id = $2', [toCompanyId, formId]);
        await IntentFormModel.deleteDraftCompanyIfOrphan(client, fromCompanyId, studentId);
      }

      await client.query('COMMIT');
      return { fromCompanyId, toCompanyId };
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
    await recordStageEvent(client, intentId, 'exited');
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
    await recordStageEvent(client, intentId, 'acceptance_submitted');
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
      await recordStageEvent(client, intentId, 'mentor_set');

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
      await recordStageEvent(client, intentId, 'exited');

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
