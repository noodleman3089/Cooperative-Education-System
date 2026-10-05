import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import {
  IntentFormModel,
  COMPANY_MAIL_LIMIT,
  LateStamp,
} from '../models/intent';
import { isLateWindow } from '../middlewares/calendarGate';
import pool, { query } from '../config/database';
import { notifyStudentStatusChange, sendCoverLetterToCompany } from '../utils/email';
import {
  assertCanAccessStudent,
  assertCanReviewStudentWork,
  resolveMajorScope,
  sendAccessError,
} from '../utils/access';
import { renderRequestFormHtml, RequestFormData } from '../utils/requestFormHtml';
import { buildRequestFormPdf, RequestFormPdfData } from '../utils/requestFormPdf';
import {
  buildCoverLetterPdf,
  fetchCoverLetterData,
  toCoverLetterData,
} from '../utils/coverLetterPdf';
import { buildAcceptanceFormPdf } from '../utils/acceptanceFormPdf';
import {
  buildDispatchLetterPdf,
  fetchDispatchLetterData,
  toDispatchLetterData,
} from '../utils/dispatchLetterPdf';
import { OfficialDocumentModel } from '../models/officialDocument';
import { AuditAction, writeAudit } from '../utils/audit';
import {
  IssuedAcceptanceLink,
  createAcceptanceLinkToken,
  revokeAcceptanceLinkToken,
  revokeOtherAcceptanceLinkTokens,
} from '../utils/acceptanceLinkToken';
import { getErrorMessage } from '../utils/httpError';
import { sendUnexpectedError } from '../utils/httpError';

/** ความยาวขั้นต่ำของเหตุผลการส่งช้า — กติกาหน้าจอ ไม่ใช่ข้อบังคับของฐาน */
const LATE_REASON_MIN_LENGTH = 20;

/** อีเมลหนึ่งที่อยู่ล้วน — ไม่รับรูปแบบ "ชื่อ <a@b.c>" หรืออักขระที่ใช้ต่อหลายที่อยู่ */
const SINGLE_EMAIL_REGEX = /^[^\s@,;<>()"[\]\\]+@[^\s@,;<>()"[\]\\]+\.[^\s@,;<>()"[\]\\]+$/;

export class IntentFormController {
  /**
   * Submit cooperative education intent form.
   * Route: POST /api/intents
   * Access: student
   */
  static async submitIntent(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = req.user.userId;
      const body = req.body;
      const { is_self_found, semester_id } = body;

      if (semester_id === undefined) {
        res.status(400).json({ message: 'Required field: semester_id.' });
        return;
      }
      const parsedSemesterId = parseInt(String(semester_id), 10);
      if (isNaN(parsedSemesterId)) {
        res.status(400).json({ message: 'semester_id must be a valid integer.' });
        return;
      }

      // ยื่นในช่วงผ่อนผันต้องชี้แจงเหตุผล — บันทึกข้อความที่ระบบพิมพ์ให้เอาข้อความ
      // ท่อนนี้ไปวางในบรรทัด "มีความประสงค์…เนื่องจาก…" ซึ่งคณบดีเป็นคนอ่านจริง
      //
      // ธงมาจากด่านปฏิทินเท่านั้น (`isLateWindow`) ไม่ใช่จาก body — นักศึกษาจึงทั้ง
      // ประกาศตัวเองว่าส่งช้าไม่ได้ และหลบธงไม่ได้ (แนวเดียวกับ SEC-05)
      const late: LateStamp = { submitted_late: false, late_reason: null };
      if (isLateWindow(res)) {
        const reason = typeof body.late_reason === 'string' ? body.late_reason.trim() : '';
        if (reason.length < LATE_REASON_MIN_LENGTH) {
          res.status(400).json({
            message:
              'การยื่นครั้งนี้เลยกำหนดปกติแล้ว แต่ยังอยู่ในช่วงผ่อนผัน ระบบจึงรับได้แต่นับเป็นการส่งช้า ' +
              `กรุณาระบุเหตุผลอย่างน้อย ${LATE_REASON_MIN_LENGTH} ตัวอักษร ` +
              'ระบบจะพิมพ์ลงบันทึกข้อความชี้แจงให้พร้อมแบบคำร้อง เพื่อนำไปเสนอตามขั้นตอน',
          });
          return;
        }
        late.submitted_late = true;
        late.late_reason = reason;
      }

      let intentForm;

      if (is_self_found === true) {
        const {
          company_name_th,
          company_name_en,
          company_address,
          company_province,
          company_district,
          company_postal_code,
          company_phone,
          contact_person,
          contact_position,
          contact_email
        } = body;

        if (!company_name_th || !company_address || !company_province || !company_district || !company_postal_code || !company_phone) {
          res.status(400).json({ message: 'กรุณากรอกข้อมูลสถานที่ฝึกงานที่จำเป็นให้ครบถ้วน' });
          return;
        }

        intentForm = await IntentFormModel.createSelfFoundWithTransaction(studentId, parsedSemesterId, {
          name_th: company_name_th,
          name_en: company_name_en,
          address: company_address,
          province: company_province,
          district: company_district,
          postal_code: company_postal_code,
          phone: company_phone,
          contact_person,
          contact_position,
          email: contact_email
        }, late);
      } else {
        const { company_id, job_id } = body;
        if (company_id === undefined) {
          res.status(400).json({ message: 'Required fields: company_id.' });
          return;
        }

        const parsedCompanyId = parseInt(String(company_id), 10);
        const parsedJobId = job_id !== undefined && job_id !== null ? parseInt(String(job_id), 10) : null;

        if (isNaN(parsedCompanyId)) {
          res.status(400).json({ message: 'company_id must be a valid integer.' });
          return;
        }

        if (parsedJobId !== null && isNaN(parsedJobId)) {
          res.status(400).json({ message: 'job_id must be a valid integer or null.' });
          return;
        }

        // Call database transaction method
        intentForm = await IntentFormModel.createWithTransaction({
          student_id: studentId,
          company_id: parsedCompanyId,
          semester_id: parsedSemesterId,
          job_id: parsedJobId,
          late,
        });
      }

      res.status(201).json({
        message: 'Cooperative education intent submitted successfully.',
        intentForm,
      });
    } catch (error) {
      console.error('Submit Intent Error:', error);
      
      // Return business logic validation error as 400 Bad Request
      res.status(400).json({
        message: getErrorMessage(error, 'An error occurred while submitting your cooperative education intent.'),
      });
    }
  }

  /**
   * Get intents submitted by the current student.
   * Route: GET /api/intents/me
   * Access: student
   */
  static async getStudentIntents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }
      const studentId = req.user.userId;
      const result = await query(
        `SELECT i.form_id, i.student_id, i.company_id, c.name_th as company_name_th, c.name_en as company_name_en,
                i.semester_id, i.job_id, j.title as job_title, i.status, i.mentor_id, i.start_date, i.end_date, i.uses_company_log_form, i.acceptance_evidence_path,
                i.request_form_path, i.reject_reason, i.officer_document_no,
                i.submitted_late, i.late_reason,
                i.acceptance_due_date, i.acceptance_submitted_late
         FROM intent_forms i
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN job_posts j ON i.job_id = j.job_id
         WHERE i.student_id = $1
         ORDER BY i.form_id DESC`,
        [studentId]
      );
      res.status(200).json(result.rows);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Student Intents Error', 'An internal server error occurred while retrieving your intents.');
    }
  }

  /**
   * Get list of intents with filtering.
   * Route: GET /api/intents
   * Access: advisor, dept_head, staff, dean
   */
  static async getIntents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { roles, userId } = req.user;
      const { status, major_id, company_id } = req.query;

      const isStaffOrDean = roles.some((r: string) => ['staff', 'dean'].includes(r));
      let userMajorId: number | null = null;

      if (!isStaffOrDean) {
        // SEC-06: fails closed — an advisor/dept_head without a personnel profile
        // used to fall through with no filter and see every student's PII.
        userMajorId = (await resolveMajorScope(userId, roles)).majorId;
      }

      let queryStr = `
        SELECT i.form_id, i.student_id, s.student_code, s.major_id, m.major_name_th,
               s.cumulative_gpa,
               i.company_id, c.name_th as company_name_th, i.semester_id, i.job_id, j.title as job_title, i.status,
               s.resume_file, i.acceptance_evidence_path, i.request_form_path,
               i.advisor_signer_name, i.advisor_signed_date,
               i.dept_head_signer_name, i.dept_head_signed_date, i.officer_document_no,
               s.first_name, s.last_name, s.nickname, s.phone as student_phone, s.alt_email, s.year_level, s.current_address,
               s.parent_name, s.parent_phone, c.phone as company_phone, c.contact_person as company_contact_person,
               i.start_date, i.reject_reason,
               i.submitted_late, i.late_reason,
               i.acceptance_due_date, i.acceptance_submitted_late,
               i.acceptance_signer_name, i.acceptance_signer_position, i.acceptance_signed_date,
               i.dispatch_document_no, i.end_date, men.name AS mentor_name,
               men.phone AS mentor_phone, men.position AS mentor_position, men.department AS mentor_department,
               u_men.email AS mentor_email,
               -- ที่มาของคำตอบรับ + สหกิจ 07 ที่บริษัทกรอกผ่านลิงก์ (พักไว้ ยังไม่เข้า companies จนกดรับ)
               i.acceptance_source, i.company_form07_pending, i.job_position, i.job_description,
               doc.status AS cover_letter_status
        FROM intent_forms i
        JOIN students s ON i.student_id = s.student_id
        JOIN master_major m ON s.major_id = m.major_id
        JOIN companies c ON i.company_id = c.company_id
        LEFT JOIN job_posts j ON i.job_id = j.job_id
        -- พี่เลี้ยงที่สถานประกอบการมอบหมาย — เจ้าหน้าที่ต้องเห็นตอนตรวจก่อนออกหนังสือส่งตัว
        -- เพราะชื่อนี้ถูกพิมพ์ลงหนังสือฉบับที่คณบดีเซ็น (SEC-10: บริษัทถูกตัดฟิลด์ด้านล่างอยู่แล้ว)
        LEFT JOIN mentors men ON i.mentor_id = men.mentor_id
        LEFT JOIN users u_men ON i.mentor_id = u_men.user_id
        -- ⛔ ห้ามใส่ backtick ในคอมเมนต์ก้อนนี้ — SQL ทั้งก้อนอยู่ใน template literal
        --    ของ JS มันจะปิดสตริงกลางทาง (พลาดมาแล้วสองครั้ง 2026-08-27)
        -- ใบความจำนงหยุดอยู่ที่ approved_by_dept_head ตั้งแต่เจ้าหน้าที่กดรับคำร้อง
        -- ความคืบหน้าที่เหลือไปอยู่บนหนังสือขาออกแทน หน้าที่ปรึกษา/หัวหน้าสาขาจึงเคย
        -- ค้างคำว่า "รอออกหนังสือ" ทั้งที่คณบดีเซ็นไปแล้ว (เจอตอนเดินจริง 2026-08-27)
        -- · official_documents ไม่มี form_id จึงต้องจับคู่ด้วยสามค่าเหมือน
        --   fetchCoverLetterDataByDoc — เลขที่หนังสือคือตัวที่กันไม่ให้ชนกันเอง
        --   เมื่อนักศึกษาคนเดิมยื่นซ้ำ
        LEFT JOIN LATERAL (
          SELECT d.status
            FROM official_documents d
           WHERE d.student_id = i.student_id
             AND d.company_id = i.company_id
             AND d.type = 'cover_letter'
             AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
           ORDER BY d.doc_id DESC
           LIMIT 1
        ) doc ON TRUE
        WHERE 1=1
      `;
      const queryParams: unknown[] = [];

      if (status) {
        queryParams.push(status);
        queryStr += ` AND i.status = $${queryParams.length}`;
      }

      if (userMajorId !== null) {
        queryParams.push(userMajorId);
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      } else if (major_id) {
        queryParams.push(parseInt(major_id as string, 10));
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      }

      if (company_id) {
        queryParams.push(parseInt(company_id as string, 10));
        queryStr += ` AND i.company_id = $${queryParams.length}`;
      }

      queryStr += ` ORDER BY i.form_id DESC`;

      const result = await query(queryStr, queryParams);

      res.status(200).json(result.rows);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Intents Error', 'An internal server error occurred while retrieving intents.');
    }
  }

  /**
   * Get detailed view of an intent form.
   * Route: GET /api/intents/:id
   * Access: student owner, advisor, dept_head, staff, dean
   */
  static async getIntentDetail(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const result = await query(
        `SELECT i.form_id, i.status, i.start_date, i.acceptance_evidence_path,
                s.student_id, s.student_code, s.cumulative_gpa, s.resume_file,
                m_maj.major_name_th, m_maj.major_code, f.faculty_name_th,
                u_std.email as student_email,
                c.company_id, c.name_th as company_name_th, c.name_en as company_name_en, c.address as company_address,
                c.province as company_province, c.district as company_district, c.postal_code as company_postal_code,
                c.phone as company_phone, c.contact_person as company_contact_person, c.contact_position as company_contact_position,
                c.email as company_email,
                i.job_id, j.title as job_title, j.description as job_description,
                i.mentor_id, men.name as mentor_name, u_men.email as mentor_email, men.phone as mentor_phone,
                men.position as mentor_position, men.department as mentor_department
         FROM intent_forms i
         JOIN students s ON i.student_id = s.student_id
         JOIN users u_std ON s.student_id = u_std.user_id
         JOIN master_major m_maj ON s.major_id = m_maj.major_id
         JOIN master_faculty f ON m_maj.faculty_id = f.faculty_id
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN job_posts j ON i.job_id = j.job_id
         LEFT JOIN mentors men ON i.mentor_id = men.mentor_id
         LEFT JOIN users u_men ON i.mentor_id = u_men.user_id
         WHERE i.form_id = $1`,
        [formId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Intent form not found.' });
        return;
      }

      const row = result.rows[0];

      // RBAC validation
      const { roles, userId } = req.user;
      
      let isAuthorized = false;

      if (roles.some(r => ['staff', 'dean', 'advisor', 'dept_head'].includes(r))) {
        // SEC-06: personnel could previously open any intent detail regardless of
        // major, even though the list endpoint scoped them. Apply the same scope.
        await assertCanAccessStudent(userId, roles, row.student_id);
        isAuthorized = true;
      } else if (roles.includes('student') && row.student_id === userId) {
        isAuthorized = true;
      }

      if (!isAuthorized) {
        res.status(403).json({ message: 'Forbidden. You do not have access to view this intent form.' });
        return;
      }

      res.status(200).json(row);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Intent Detail Error', 'An internal server error occurred while retrieving intent details.');
    }
  }


  /**
   * Get pipeline summary counts for all statuses.
   * Route: GET /api/intents/pipeline-summary
   *
   * ⛔ SEC-06: advisor/dept_head เห็นเฉพาะสาขาตัวเอง (`resolveMajorScope` · ไม่มีโปรไฟล์ = 403)
   *    staff/dean เห็นทั้งคณะ · เดิมไม่กรองเลย advisor ได้ตัวเลขทั้งคณะ
   */
  static async getPipelineSummary(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }
      const { majorId } = await resolveMajorScope(req.user.userId, req.user.roles);
      // $1 = majorId หรือ NULL (ทั้งคณะ) — ใช้ร่วมกันทั้งสาม query
      const scope = `AND ($1::int IS NULL OR i.student_id IN (SELECT student_id FROM students WHERE major_id = $1))`;

      const summaryResult = await query(`
        SELECT i.status, COUNT(*)::int as count
        FROM intent_forms i
        WHERE TRUE ${scope}
        GROUP BY i.status
      `, [majorId]);

      // ⛔ คีย์ในนี้คือ allow-list จริง — สถานะที่ไม่ได้อยู่ตรงนี้จะถูกทิ้งเงียบๆ ที่
      //    ลูปข้างล่าง (`hasOwnProperty`) ไม่ใช่แค่ค่าเริ่มต้นสวยงาม
      //    · `pending_officer_request` เพิ่มเมื่อ 2026-08-27 เพราะแถบขั้นตอนของเจ้าหน้าที่
      //      อ่านค่านี้แล้วได้ 0 ตลอด ทั้งที่เป็นคิวจริงที่ต้องกด
      //    · `approved_by_advisor` / `rejected_by_advisor` ถอดออก — ตัวแรกไม่มีใบใหม่ไปถึงอีก
      //      ตั้งแต่ลายเซ็นย้ายไปกระดาษ ส่วนตัวหลัง **ไม่เคยเป็นสถานะจริง** (ของจริงคือ
      //      `rejected`) จึงนับได้ 0 มาตลอดโดยไม่มีใครสังเกต
      const counts: Record<string, number> = {
        pending_advisor: 0,
        pending_officer_request: 0,
        approved_by_dept_head: 0,
        pending_sign: 0,
        dean_signed: 0,
        accepted: 0,
        pending_officer_approval: 0,
        rejected: 0,
        company_rejected: 0,
        dispatch_eligible: 0
      };

      summaryResult.rows.forEach((row: { status: string; count: number }) => {
        if (Object.prototype.hasOwnProperty.call(counts, row.status)) {
          counts[row.status] = Number(row.count);
        }
      });

      // ponytail: แยกใบที่เจ้าหน้าที่รับคำร้องแล้ว (approved_by_dept_head) ออกเป็นสองด่าน:
      // 1) รอคณบดีลงนาม: cover letter สถานะ pending_sign (หรือยังไม่ออกหนังสือ)
      // 2) คณบดีลงนามแล้ว: cover letter ลงนามแล้ว (signed) รอนักศึกษานำส่งและรอแบบตอบรับ
      // ป้องกันเจ้าหน้าที่สับสนว่าทำไมคณบดีเซ็นแล้วแต่ตัวเลขยังค้างที่ "รอคณบดีลงนาม"
      const deanSignedResult = await query(`
        SELECT COUNT(*)::int as count
        FROM intent_forms i
        JOIN LATERAL (
          SELECT d.status
            FROM official_documents d
           WHERE d.student_id = i.student_id
             AND d.company_id = i.company_id
             AND d.type = 'cover_letter'
             AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
           ORDER BY d.doc_id DESC
           LIMIT 1
        ) doc ON TRUE
        WHERE i.status = 'approved_by_dept_head'
          AND doc.status = 'signed'
          ${scope}
      `, [majorId]);
      const deanSignedCount = Number(deanSignedResult.rows[0]?.count || 0);
      counts.dean_signed = deanSignedCount;
      counts.pending_sign = Math.max(0, counts.approved_by_dept_head - deanSignedCount);

      // ใบที่รอออกหนังสือส่งตัว = ตอบรับแล้ว และยังไม่มีหนังสือส่งตัวของบริษัทนั้น
      //
      // ⛔ ของเดิมเทียบ \`d.type = 'dispatch_letter'\` ซึ่ง **ไม่มีอยู่จริงในระบบ** (ชนิดจริง
      //    คือ 'send_letter' ตามที่หน้าจอทั้งสองฝั่งแปลป้ายไว้) และ join ด้วย student_id
      //    อย่างเดียว ตัวเลขจึงเท่ากับ "จำนวนใบที่ accepted" มาตลอดโดยไม่มีใครสังเกต
      //    เพราะไม่เคยมีแถวชนิดนั้นให้ตัดออกเลย · ตอนนี้เทียบทั้งชนิดและสถานประกอบการ
      //    เหมือนที่ \`issueDispatchLetter\` ใช้กันออกซ้ำ ทั้งสองที่จึงตอบตรงกันเสมอ
      const dispatchEligibleResult = await query(`
        SELECT COUNT(*)::int as count
        FROM intent_forms i
        WHERE i.status = 'accepted'
          AND NOT EXISTS (
            SELECT 1 FROM official_documents d
             WHERE d.student_id = i.student_id
               AND d.company_id = i.company_id
               AND d.type = 'send_letter'
          )
          ${scope}
      `, [majorId]);
      counts.dispatch_eligible = Number(dispatchEligibleResult.rows[0]?.count || 0);

      res.status(200).json(counts);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Pipeline Summary Error', 'An error occurred while fetching pipeline summary.');
    }
  }

  /**
   * นักศึกษาอัปโหลดแบบคำร้องที่ลงนามบนกระดาษแล้ว
   * Route: POST /api/intents/:id/request-form
   * Access: student (ของตัวเองเท่านั้น — ตรวจในทรานแซกชันของโมเดล)
   */
  static async uploadRequestForm(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ message: 'กรุณาแนบไฟล์แบบคำร้องที่ลงนามแล้ว' });
        return;
      }

      const filePath = `request_forms/${req.file.filename}`;
      // ชื่อผู้ลงนามที่นักศึกษาพิมพ์ — ใช้เฉพาะช่องที่ระบบยังไม่รู้ (โมเดลตัดสิน)
      const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
      let previousPath: string | null;
      try {
        ({ previousPath } = await IntentFormModel.attachRequestForm(formId, req.user.userId, filePath, {
          advisorName: text(req.body?.advisor_signer_name),
          deptHeadName: text(req.body?.dept_head_signer_name),
        }));
      } catch (error) {
        // multer เขียนไฟล์ลงดิสก์ไปแล้ว — ถูกปฏิเสธก็ต้องลบทิ้ง ไม่ให้ค้างเป็นไฟล์กำพร้า
        fs.promises.unlink(path.join(process.cwd(), 'uploads', filePath)).catch(() => undefined);
        throw error;
      }

      // อัปทับของเดิม = ไฟล์เก่าไม่มีใครอ้างถึงแล้ว ลบทิ้งไม่ให้โฟลเดอร์บวม
      // (ทำหลัง COMMIT เสมอ ถ้าลบก่อนแล้วทรานแซกชันล้ม จะเสียไฟล์ที่ยังใช้อยู่)
      if (previousPath && previousPath !== filePath) {
        const abs = path.join(process.cwd(), 'uploads', previousPath);
        fs.promises.unlink(abs).catch(() => undefined);
      }

      writeAudit(
        {
          action: AuditAction.INTENT_REQUEST_FORM_UPLOADED,
          entityType: 'intent_form',
          entityId: formId,
          subjectId: req.user.userId,
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: 'อัปโหลดแบบคำร้องที่ลงนามแล้วเรียบร้อย รอเจ้าหน้าที่ตรวจสอบ',
        form_id: formId,
        request_form_path: filePath,
      });
    } catch (error) {
      // ข้อความจากโมเดลเป็นภาษาไทยและอธิบายสาเหตุอยู่แล้ว (สถานะไม่ถูก / ไม่ใช่ของตัวเอง)
      res.status(400).json({ message: getErrorMessage(error, 'อัปโหลดแบบคำร้องไม่สำเร็จ') });
    }
  }

  /**
   * เจ้าหน้าที่รับคำร้อง — ตรวจกระดาษ แล้วกรอก **เลขที่หนังสือออก** ช่องเดียว
   * Route: PATCH /api/intents/:id/officer-approve
   * Access: staff
   *
   * ⛔ ชื่อผู้ลงนาม (ที่ปรึกษา · หัวหน้าสาขา) **ไม่รับจากเจ้าหน้าที่แล้ว** — ระบบดึงเอง
   *    หรือนักศึกษากรอกตอนอัปโหลด (เจ้าของตัดสิน 2026-09-21: เดิมบังคับเจ้าหน้าที่คีย์
   *    ชื่อ+วันที่ 4 ช่องจากกระดาษทุกใบ ทั้งที่ไม่ได้ถูกพิมพ์ลงหนังสือเลย) · ส่งมาก็เมิน
   */
  static async officerApproveRequest(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const { document_no } = req.body ?? {};
      if (typeof document_no !== 'string' || !document_no.trim()) {
        res.status(400).json({ message: 'กรุณากรอกเลขที่หนังสือออก' });
        return;
      }

      const { studentId, companyId } = await IntentFormModel.officerApproveRequest(
        formId,
        req.user.userId,
        { documentNo: document_no.trim() }
      );

      // ออกหนังสือขอความอนุเคราะห์ (ยังไม่ลงนาม) แล้วส่งเข้าคิวคณบดี
      //
      // ทำ *หลัง* ทรานแซกชันจบโดยตั้งใจ — การเขียนไฟล์ลงดิสก์ย้อนกลับไม่ได้พร้อมกับ
      // ฐานข้อมูล ถ้าออกเอกสารล้มเหลว คำร้องที่ผ่านแล้วต้องไม่ย้อนกลับไปหานักศึกษา
      // เจ้าหน้าที่กดออกใหม่ได้จากหน้าเดิม (ดูข้อความ error)
      const letterRow = await fetchCoverLetterData(formId);
      if (letterRow) {
        const pdfBytes = await buildCoverLetterPdf(toCoverLetterData(letterRow));
        const fileName = `cover_letter_${formId}_${Date.now()}.pdf`;
        const relativePath = path.posix.join('secure_private', 'documents', fileName);
        const absolutePath = path.join(process.cwd(), relativePath);

        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, pdfBytes);

        await OfficialDocumentModel.create({
          document_number: document_no.trim(),
          type: 'cover_letter',
          student_id: studentId,
          company_id: companyId,
          // ไม่มี template_id — หนังสือถูกวาดจากโค้ด ไม่ได้มาจากแม่แบบ (migration 005)
          generated_file_path: relativePath,
          status: 'pending_sign',
        });
      }

      writeAudit(
        {
          action: AuditAction.INTENT_OFFICER_APPROVED,
          entityType: 'intent_form',
          entityId: formId,
          subjectId: studentId,
          detail: { document_no: document_no.trim() },
        },
        req
      ).catch(() => undefined);

      notifyStudentStatusChange(formId, 'approved_by_dept_head').catch(console.error);

      res.status(200).json({ message: 'รับคำร้องเรียบร้อยแล้ว', form_id: formId });
    } catch (error) {
      res.status(400).json({ message: getErrorMessage(error, 'ไม่สามารถรับคำร้องได้') });
    }
  }

  /**
   * เจ้าหน้าที่ตีกลับคำร้อง — เหตุผลบังคับ
   * Route: PATCH /api/intents/:id/officer-reject
   * Access: staff
   */
  static async officerRejectRequest(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!reason) {
        res.status(400).json({ message: 'กรุณาระบุเหตุผลที่ตีกลับ เพื่อให้นักศึกษาแก้ไขได้ถูกจุด' });
        return;
      }

      const { studentId, previousPath } = await IntentFormModel.officerRejectRequest(formId, reason);

      if (previousPath) {
        const abs = path.join(process.cwd(), 'uploads', previousPath);
        fs.promises.unlink(abs).catch(() => undefined);
      }

      writeAudit(
        {
          action: AuditAction.INTENT_OFFICER_REJECTED,
          entityType: 'intent_form',
          entityId: formId,
          subjectId: studentId,
          detail: { reason },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({ message: 'ตีกลับคำร้องเรียบร้อยแล้ว', form_id: formId });
    } catch (error) {
      res.status(400).json({ message: getErrorMessage(error, 'ไม่สามารถตีกลับคำร้องได้') });
    }
  }

  /**
   * ตัวอย่างหนังสือขอความอนุเคราะห์ก่อนส่งเข้าคิวคณบดี
   * Route: GET /api/intents/:id/cover-letter/preview
   * Access: staff
   *
   * เจ้าของเคาะว่าด่านตรวจของเจ้าหน้าที่อยู่ **ก่อน** คณบดีลงนาม ไม่ใช่หลัง —
   * เพราะถ้าตรวจหลังเซ็นแล้วเจอผิด ต้องรบกวนคณบดีให้กดใหม่ ซึ่งขัดกับเจตนา
   * "ลดความลำบากฝั่งนั้น" · ตัวอย่างนี้จึงวาดด้วยตัววาดตัวเดียวกับฉบับจริง
   * ต่างกันแค่ยังไม่มีลายเซ็น
   */
  static async previewCoverLetter(req: Request, res: Response): Promise<void> {
    try {
      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const row = await fetchCoverLetterData(formId);
      if (!row) {
        res.status(404).json({ message: 'ไม่พบคำร้องที่ต้องการ' });
        return;
      }

      const pdfBytes = await buildCoverLetterPdf(toCoverLetterData(row));
      res.contentType('application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="cover-letter-preview.pdf"');
      res.send(pdfBytes);
    } catch (error) {
      sendUnexpectedError(res, error, 'Preview Cover Letter Error', 'สร้างตัวอย่างหนังสือไม่สำเร็จ');
    }
  }

  /**
   * เจ้าหน้าที่สั่งออก **หนังสือส่งตัว** แล้วส่งเข้าคิวคณบดี
   * Route: POST /api/intents/:id/dispatch-letter
   * Access: staff
   *
   * เป็นขั้นที่ ๙ ของ ๑๓ ขั้นตอนในคู่มือ และเป็นจุดที่ผลการตอบรับที่เจ้าหน้าที่คีย์ไว้
   * ตอนรับแบบตอบรับ (รอบ 53) **ถูกนำไปใช้จริง** — ชื่อผู้อนุมัติกลายเป็นผู้รับหนังสือ
   * และวันที่บนแบบตอบรับกลายเป็นบรรทัด "อ้างถึง"
   *
   * ⛔ **ด่านลำดับคือสถานะ `accepted` เท่านั้น** — ก่อนหน้านั้นยังไม่มีอะไรให้ส่งตัวไป
   * · เจ้าหน้าที่คีย์ **เลขที่หนังสือส่งตัว** และ **วันสิ้นสุดการปฏิบัติงาน** เอง
   *   ระบบไม่ออกเลขให้และไม่คำนวณวันจบให้ ทั้งสองอย่างมาจากของจริงนอกระบบ
   * · **กันออกซ้ำที่การมีอยู่ของเอกสาร ไม่ใช่ที่คอลัมน์เลขที่** เพื่อให้กดใหม่ได้จริง
   *   เมื่อรอบก่อนล้มตอนเขียนไฟล์ (ฐานอัปเดตแล้วแต่ไม่มีเอกสาร = ตันถาวรถ้ากันที่คอลัมน์)
   */
  static async issueDispatchLetter(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const documentNo =
        typeof req.body?.document_no === 'string' ? req.body.document_no.trim() : '';
      const endDate = typeof req.body?.end_date === 'string' ? req.body.end_date.trim() : '';

      if (!documentNo || !endDate) {
        res
          .status(400)
          .json({ message: 'กรุณากรอกเลขที่หนังสือส่งตัว และวันสิ้นสุดการปฏิบัติงาน' });
        return;
      }
      // ⛔ **สองคอลัมน์ที่เก็บเลขนี้กว้างไม่เท่ากัน** — `intent_forms.dispatch_document_no`
      //    เป็น VARCHAR(100) แต่ `official_documents.document_number` เป็น VARCHAR(50)
      //    เลขยาว 51-100 จึงผ่านการอัปเดตใบความจำนงแล้วไปตกตอน INSERT เอกสาร
      //    ผู้ใช้จะได้ข้อความ "ข้อมูลที่กรอกยาวเกินกำหนด" ที่ไม่บอกว่าช่องไหน
      //    → กันที่ค่าแคบกว่าตั้งแต่ต้นทาง พร้อมบอกให้ตรงจุด (เจอตอนเขียนเทสต์ D6 รอบ 61)
      if (documentNo.length > 50) {
        res.status(400).json({ message: 'เลขที่หนังสือส่งตัวยาวเกิน 50 ตัวอักษร' });
        return;
      }
      // วันที่เป็นสตริง YYYY-MM-DD ล้วน — ห้าม new Date() แล้วส่งต่อ (เลื่อนวันตาม timezone)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        res.status(400).json({ message: 'รูปแบบวันสิ้นสุดการปฏิบัติงานต้องเป็น ปี-เดือน-วัน (YYYY-MM-DD)' });
        return;
      }

      await client.query('BEGIN');

      const intentRes = await client.query(
        `SELECT i.form_id, i.student_id, i.company_id, i.status, i.start_date::text AS start_date,
                EXISTS (
                  SELECT 1 FROM official_documents d
                   WHERE d.student_id = i.student_id
                     AND d.company_id = i.company_id
                     AND d.type = 'send_letter'
                ) AS already_issued
           FROM intent_forms i
          WHERE i.form_id = $1
          FOR UPDATE`,
        [formId]
      );

      if ((intentRes.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ message: 'ไม่พบคำร้องที่ต้องการ' });
        return;
      }

      const intent = intentRes.rows[0];

      if (intent.status !== 'accepted') {
        await client.query('ROLLBACK');
        res.status(409).json({
          message:
            'หนังสือส่งตัวออกได้เมื่อเจ้าหน้าที่รับแบบตอบรับจากสถานประกอบการเรียบร้อยแล้วเท่านั้น',
        });
        return;
      }

      if (intent.already_issued) {
        await client.query('ROLLBACK');
        res.status(409).json({ message: 'ใบนี้ออกหนังสือส่งตัวไปแล้ว' });
        return;
      }

      if (!intent.start_date) {
        await client.query('ROLLBACK');
        res.status(400).json({
          message: 'ใบนี้ยังไม่มีวันเริ่มปฏิบัติงาน จึงพิมพ์ช่วงเวลาลงหนังสือส่งตัวไม่ได้',
        });
        return;
      }
      if (endDate < intent.start_date) {
        await client.query('ROLLBACK');
        res.status(400).json({
          message: `วันสิ้นสุดการปฏิบัติงาน (${endDate}) มาก่อนวันเริ่มปฏิบัติงาน (${intent.start_date})`,
        });
        return;
      }

      await client.query(
        `UPDATE intent_forms SET dispatch_document_no = $2, end_date = $3 WHERE form_id = $1`,
        [formId, documentNo, endDate]
      );

      await client.query('COMMIT');

      // วาดหนังสือ *หลัง* ทรานแซกชันจบ ด้วยเหตุผลเดียวกับหนังสือขอความอนุเคราะห์ —
      // การเขียนไฟล์ลงดิสก์ย้อนกลับพร้อมฐานไม่ได้ · ล้มตรงนี้เจ้าหน้าที่กดใหม่ได้
      // เพราะด่านกันซ้ำอยู่ที่การมีอยู่ของเอกสาร ไม่ใช่ที่เลขบนใบความจำนง
      const letterRow = await fetchDispatchLetterData(formId);
      if (!letterRow) {
        res.status(500).json({ message: 'ไม่พบข้อมูลสำหรับวาดหนังสือส่งตัว' });
        return;
      }

      const pdfBytes = await buildDispatchLetterPdf(toDispatchLetterData(letterRow));
      const fileName = `dispatch_letter_${formId}_${Date.now()}.pdf`;
      const relativePath = path.posix.join('secure_private', 'documents', fileName);
      const absolutePath = path.join(process.cwd(), relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, pdfBytes);

      const doc = await OfficialDocumentModel.create({
        document_number: documentNo,
        type: 'send_letter',
        student_id: intent.student_id,
        company_id: intent.company_id,
        generated_file_path: relativePath,
        status: 'pending_sign',
      });

      writeAudit(
        {
          action: AuditAction.DOCUMENT_GENERATED,
          entityType: 'official_document',
          entityId: doc.doc_id,
          subjectId: intent.student_id,
          detail: { type: 'send_letter', document_no: documentNo, end_date: endDate },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: 'ออกหนังสือส่งตัวเรียบร้อยแล้ว รอคณบดีลงนาม',
        form_id: formId,
        doc_id: doc.doc_id,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      sendUnexpectedError(
        res,
        error,
        'Issue Dispatch Letter Error',
        'ไม่สามารถออกหนังสือส่งตัวได้'
      );
    } finally {
      client.release();
    }
  }

  /**
   * แบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1) — หน้า HTML สำหรับสั่งพิมพ์
   * Route: GET /api/intents/:id/request-form
   * Access: นักศึกษาเจ้าของคำร้อง · advisor / dept_head / staff / dean ตาม SEC-06
   *
   * ตอบเป็น `text/html` ไม่ใช่ PDF โดยตั้งใจ — ปลายทางคือกระดาษที่เอาไปให้เซ็นด้วยปากกา
   * ผู้ใช้กด Ctrl+P เอง · ไม่ต้องมีตัว render ฝั่งเซิร์ฟเวอร์
   */
  /**
   * เอกสารหมายเลข ๒ — แบบยืนยันแบบตอบรับ (สถานประกอบการเป็นผู้กรอก)
   * Route: GET /api/intents/:id/acceptance-form
   *
   * ⛔ เปิดได้ต่อเมื่อ **คณบดีลงนามหนังสือขอความอนุเคราะห์แล้ว** เพราะคำชี้แจง
   * บนฟอร์มเขียนว่าให้บริษัทตอบ "หลังจากได้รับหนังสือขอความอนุเคราะห์ฯ"
   * — พิมพ์ก่อนหน้านั้นคือให้นักศึกษาถือใบตอบรับไปโดยไม่มีหนังสือที่ต้องตอบ
   *
   * วาดสดทุกครั้ง ไม่เก็บไฟล์ เพราะเป็นฟอร์มเปล่าที่คำนวณจากข้อมูลในฐานล้วนๆ
   * (เหตุผลเดียวกับบันทึกข้อความ ต่างจากหนังสือขาออกที่มีลายเซ็นอยู่บนไฟล์)
   */
  static async getAcceptanceForm(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const result = await query(
        `SELECT i.student_id, i.officer_document_no, i.dispatch_document_no,
                s.first_name, s.last_name,
                mj.major_name_th, f.faculty_name_th,
                c.name_th AS company_name,
                doc.status AS cover_letter_status
           FROM intent_forms i
           JOIN students s        ON i.student_id = s.student_id
           JOIN master_major mj   ON s.major_id = mj.major_id
           JOIN master_faculty f  ON mj.faculty_id = f.faculty_id
           JOIN companies c       ON i.company_id = c.company_id
           LEFT JOIN LATERAL (
             SELECT d.status
               FROM official_documents d
              WHERE d.student_id = i.student_id
                AND d.company_id = i.company_id
                AND d.type = 'cover_letter'
                AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
              ORDER BY d.doc_id DESC
              LIMIT 1
           ) doc ON TRUE
          WHERE i.form_id = $1`,
        [formId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบคำร้องที่ต้องการ' });
        return;
      }

      const row = result.rows[0];
      const { userId, roles } = req.user;

      if (roles.includes('student')) {
        if (row.student_id !== userId) {
          res.status(403).json({ message: 'คุณเปิดดูได้เฉพาะเอกสารของตัวเองเท่านั้น' });
          return;
        }
      } else {
        await assertCanReviewStudentWork(userId, roles, row.student_id);
      }

      if (row.cover_letter_status !== 'signed') {
        res.status(409).json({
          message:
            'แบบตอบรับจะออกให้เมื่อคณบดีลงนามหนังสือขอความอนุเคราะห์แล้ว เพราะสถานประกอบการต้องตอบรับหลังจากได้รับหนังสือฉบับนั้น',
        });
        return;
      }

      const pdf = await buildAcceptanceFormPdf({
        faculty_name_th: row.faculty_name_th,
        company_name: row.company_name,
        first_name: row.first_name,
        last_name: row.last_name,
        major_name_th: row.major_name_th,
        // ว่างจนกว่าจะออกหนังสือส่งตัว — ตอนนักศึกษาพิมพ์ไปให้บริษัทยังไม่มีเลขนี้
        dispatch_document_no: row.dispatch_document_no,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="acceptance-form-${formId}.pdf"`
      );
      res.status(200).send(pdf);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(
        res,
        error,
        'Get Acceptance Form Error',
        'เกิดข้อผิดพลาดขณะสร้างแบบตอบรับ'
      );
    }
  }

  /**
   * นักศึกษาสั่งระบบส่งหนังสือขอความอนุเคราะห์ (ลงนามแล้ว) + แบบตอบรับ (เอกสารหมายเลข ๒)
   * ไปยังอีเมลสถานประกอบการที่พิมพ์เอง
   * Route: POST /api/intents/:id/send-to-company
   * Access: student เจ้าของใบเท่านั้น
   *
   * ⛔ นี่คือช่องที่ให้ผู้ใช้สั่งระบบส่งเอกสารที่คณบดีลงนามจากโดเมนมหาวิทยาลัยไปที่อยู่ใดก็ได้
   *    จึงต้องมีด่านครบตามลำดับ: เจ้าของใบ → หนังสือ signed → สถานะใบ → ที่อยู่เดียวที่รูปแบบถูก
   *    → เพดาน COMPANY_MAIL_LIMIT ครั้งต่อใบ
   * ⛔ ไม่ตรวจว่าอีเมลเป็นของบริษัทจริง (ระบบไม่มีทางรู้) · ไม่ผูกปฏิทินกิจกรรม (ไม่ใช่การยื่นเอกสาร)
   * ⛔ เพดานจองที่ก่อนส่ง (นับ +1 ด้วย UPDATE เดียวที่มีเงื่อนไข `< limit` — แถวถูกล็อกจึงกันกดรัว
   *    สองแท็บได้เทียบเท่า SELECT … FOR UPDATE) แล้วไม่ถือล็อกระหว่างรอ SMTP · ส่งล้ม = คืนที่ (−1)
   *    และไม่ตั้ง sent_at/to
   */
  static async sendCoverLetterToCompany(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const result = await query(
        `SELECT i.student_id, i.status, i.officer_document_no,
                s.first_name, s.last_name, s.student_code,
                u.email AS student_email,
                mj.major_name_th, f.faculty_name_th,
                c.name_th AS company_name,
                doc.status AS cover_letter_status,
                doc.generated_file_path AS cover_letter_path
           FROM intent_forms i
           JOIN students s        ON i.student_id = s.student_id
           JOIN users u           ON s.student_id = u.user_id
           JOIN master_major mj   ON s.major_id = mj.major_id
           JOIN master_faculty f  ON mj.faculty_id = f.faculty_id
           JOIN companies c       ON i.company_id = c.company_id
           LEFT JOIN LATERAL (
             SELECT d.status, d.generated_file_path
               FROM official_documents d
              WHERE d.student_id = i.student_id
                AND d.company_id = i.company_id
                AND d.type = 'cover_letter'
                AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
              ORDER BY d.doc_id DESC
              LIMIT 1
           ) doc ON TRUE
          WHERE i.form_id = $1`,
        [formId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบคำร้องที่ต้องการ' });
        return;
      }

      const row = result.rows[0];

      if (row.student_id !== req.user.userId) {
        res.status(403).json({ message: 'คุณส่งหนังสือได้เฉพาะใบคำร้องของตัวเองเท่านั้น' });
        return;
      }

      if (row.cover_letter_status !== 'signed' || !row.cover_letter_path) {
        res.status(409).json({
          message:
            'ยังส่งหนังสือให้สถานประกอบการไม่ได้ เพราะคณบดียังไม่ลงนามหนังสือขอความอนุเคราะห์ของใบนี้',
        });
        return;
      }

      if (row.status !== 'approved_by_dept_head') {
        res.status(409).json({
          message:
            'ส่งหนังสือให้สถานประกอบการได้เฉพาะช่วงที่ใบคำร้องอยู่ในขั้นรอสถานประกอบการตอบรับ ใบนี้เลยขั้นนั้นแล้วหรือถูกปฏิเสธ จึงส่งอีกไม่ได้',
        });
        return;
      }

      // ที่อยู่เดียวเท่านั้น — ห้าม , ; ช่องว่าง ขึ้นบรรทัดใหม่ (กัน header injection และกันส่งเป็นชุด)
      const companyEmail =
        typeof req.body?.company_email === 'string' ? req.body.company_email.trim() : '';
      if (
        !companyEmail ||
        companyEmail.length > 254 ||
        /[,;\s]/.test(companyEmail) ||
        !SINGLE_EMAIL_REGEX.test(companyEmail)
      ) {
        res.status(400).json({
          message:
            'อีเมลสถานประกอบการไม่ถูกต้อง กรุณากรอกอีเมลเพียงหนึ่งที่อยู่ (ห้ามใส่หลายที่อยู่หรือเว้นวรรค) และไม่ยาวเกิน 254 ตัวอักษร',
        });
        return;
      }

      // จองที่ก่อนส่ง — UPDATE เดียวที่เช็คเพดานในตัว จึงไม่มีช่องให้สองคำขอลอดพร้อมกัน
      const reserved = await query(
        `UPDATE intent_forms
            SET company_mail_count = company_mail_count + 1
          WHERE form_id = $1 AND company_mail_count < $2
          RETURNING company_mail_count`,
        [formId, COMPANY_MAIL_LIMIT]
      );
      if ((reserved.rowCount ?? 0) === 0) {
        res.status(429).json({
          message: `ส่งหนังสือให้สถานประกอบการครบ ${COMPANY_MAIL_LIMIT} ครั้งแล้ว ไม่สามารถส่งเพิ่มได้ หากที่อยู่ไม่ถูกต้องให้ติดต่อเจ้าหน้าที่`,
        });
        return;
      }

      // ลิงก์ตอบรับออนไลน์ (ใช้ครั้งเดียว · หมดอายุ ๑๕ วันทำการ) — สร้างหลังจองโควตา ก่อนส่งเมล
      // ⛔ ยังไม่ยกเลิกลิงก์เก่าตรงนี้ — ทำหลังส่งสำเร็จเท่านั้น เพื่อให้ส่งล้มไม่ฆ่าลิงก์ที่บริษัทถืออยู่แล้ว
      //    และไม่ถือทรานแซกชันค้างระหว่างรอ SMTP
      let link: IssuedAcceptanceLink | null = null;
      try {
        link = await createAcceptanceLinkToken(formId, companyEmail);
        await sendCoverLetterToCompany({
          toEmail: companyEmail,
          replyTo: row.student_email,
          studentName: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'นักศึกษา',
          studentCode: row.student_code,
          majorName: (row.major_name_th ?? '').replace(/^สาขาวิชา\s*/, '') || '-',
          companyName: row.company_name ?? '',
          coverLetterPath: row.cover_letter_path,
          acceptanceForm: {
            faculty_name_th: row.faculty_name_th,
            company_name: row.company_name,
            first_name: row.first_name,
            last_name: row.last_name,
            major_name_th: row.major_name_th,
            dispatch_document_no: null,
          },
          acceptanceLink: { url: link.url, expiresOn: link.lastDay },
        });
      } catch (sendError) {
        console.error(`[Email] Send cover letter to company failed for intent ${formId}:`, sendError);
        // ลิงก์ใหม่ยังไม่ถึงมือบริษัท — ต้องใช้ไม่ได้ (ลิงก์เก่าที่บริษัทถืออยู่ยังอยู่ครบ)
        if (link) {
          await revokeAcceptanceLinkToken(link.tokenId).catch((revokeError) =>
            console.error(`[Email] Failed to revoke unsent acceptance link for intent ${formId}:`, revokeError)
          );
        }
        // คืนที่ที่จองไว้ — ส่งไม่สำเร็จต้องไม่ถูกนับ
        await query(
          `UPDATE intent_forms
              SET company_mail_count = GREATEST(company_mail_count - 1, 0)
            WHERE form_id = $1`,
          [formId]
        ).catch((releaseError) =>
          console.error(`[Email] Failed to release mail quota for intent ${formId}:`, releaseError)
        );
        res.status(502).json({
          message:
            'ส่งอีเมลไม่สำเร็จ ระบบยังไม่ได้ส่งเอกสารถึงสถานประกอบการและยังไม่นับเป็นการส่ง กรุณาตรวจสอบอีเมลที่กรอกแล้วลองใหม่อีกครั้ง',
        });
        return;
      }

      // reject_reason = NULL: นักศึกษาลงมือตามที่ถูกตีกลับแล้ว (ส่งใหม่สำเร็จ) — เหตุผลยังอยู่ใน audit_log จากการตัดสินของเจ้าหน้าที่
      const sent = await query(
        `UPDATE intent_forms
            SET company_mail_to = $2, company_mail_sent_at = NOW(), reject_reason = NULL
          WHERE form_id = $1
          RETURNING company_mail_to, company_mail_sent_at, company_mail_count`,
        [formId, companyEmail]
      );
      const saved = sent.rows[0];

      // ส่งสำเร็จแล้ว — ยกเลิกลิงก์เก่าที่ยังไม่ใช้ของใบนี้ (เหลือแต่ลิงก์ในอีเมลฉบับล่าสุด)
      await revokeOtherAcceptanceLinkTokens(formId, link.tokenId);

      writeAudit(
        {
          action: AuditAction.INTENT_COVER_LETTER_EMAILED,
          entityType: 'intent_form',
          entityId: formId,
          subjectId: row.student_id,
          detail: { to: companyEmail },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: 'ส่งหนังสือขอความอนุเคราะห์และแบบตอบรับถึงสถานประกอบการเรียบร้อยแล้ว',
        company_mail_to: saved.company_mail_to,
        company_mail_sent_at: saved.company_mail_sent_at,
        company_mail_count: saved.company_mail_count,
        company_mail_limit: COMPANY_MAIL_LIMIT,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Send Cover Letter To Company Error',
        'เกิดข้อผิดพลาดขณะส่งหนังสือให้สถานประกอบการ'
      );
    }
  }

  static async getRequestForm(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }

      const result = await query(
        `SELECT i.student_id, i.start_date,
                s.student_code, s.first_name, s.last_name, s.year_level, s.phone, s.alt_email,
                u.email AS university_email,
                mj.major_name_th, f.faculty_name_th,
                c.name_th AS company_name, c.address AS company_address,
                c.district AS company_district, c.province AS company_province,
                c.postal_code AS company_postal_code,
                c.contact_person, c.contact_position,
                c.phone AS company_phone, c.email AS company_email,
                sem.academic_year, sem.semester,
                to_char((NOW() AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS today,
                (SELECT to_char(e.start_date, 'YYYY-MM-DD') FROM coop_calendar_events e
                  WHERE e.semester_id = i.semester_id AND e.activity_key = 'coop_start'
                  LIMIT 1) AS coop_start_date,
                (SELECT to_char(e.end_date, 'YYYY-MM-DD') FROM coop_calendar_events e
                  WHERE e.semester_id = i.semester_id AND e.activity_key = 'coop_end'
                  LIMIT 1) AS coop_end_date
           FROM intent_forms i
           JOIN students s        ON i.student_id = s.student_id
           JOIN users u           ON s.student_id = u.user_id
           JOIN master_major mj   ON s.major_id = mj.major_id
           JOIN master_faculty f  ON mj.faculty_id = f.faculty_id
           JOIN companies c       ON i.company_id = c.company_id
           JOIN coop_semesters sem ON i.semester_id = sem.semester_id
          WHERE i.form_id = $1`,
        [formId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบคำร้องที่ต้องการ' });
        return;
      }

      const row = result.rows[0];
      const { userId, roles } = req.user;

      // นักศึกษาเปิดได้เฉพาะของตัวเอง — บุคลากรใช้กติกาเดียวกับการตรวจงานนักศึกษา
      // (SEC-06 fail closed: ไม่เข้าเงื่อนไขไหนเลย = ปฏิเสธ ไม่ใช่ปล่อยผ่าน)
      if (roles.includes('student')) {
        if (row.student_id !== userId) {
          res.status(403).json({ message: 'คุณเปิดดูได้เฉพาะคำร้องของตัวเองเท่านั้น' });
          return;
        }
      } else {
        await assertCanReviewStudentWork(userId, roles, row.student_id);
      }

      // แบบฟอร์มตัวจริงของคณะ (PDF 2 หน้า) ที่ระบบกรอกข้อมูลให้แล้ว — ดู `utils/requestFormPdf.ts`
      // (รองรับ ?format=html สำหรับกรณีที่ต้องการผลลัพธ์แบบ HTML เดิม)
      if (req.query.format === 'html') {
        const html = renderRequestFormHtml(row as RequestFormData);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(html);
        return;
      }

      const templatePathCandidates = [
        path.join(process.cwd(), 'secure_private', 'templates', 'request_form_template.pdf'),
        path.join(process.cwd(), 'backend', 'secure_private', 'templates', 'request_form_template.pdf'),
        path.resolve(__dirname, '../../secure_private/templates/request_form_template.pdf'),
      ];
      const templatePath = templatePathCandidates.find((p) => fs.existsSync(p));

      if (templatePath) {
        const pdf = await buildRequestFormPdf(templatePath, row as RequestFormPdfData);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="request_form_${formId}.pdf"`);
        // มีชื่อ เบอร์โทร และอีเมลของนักศึกษา — ห้ามค้างในแคชของเบราว์เซอร์/พร็อกซี
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(Buffer.from(pdf));
        return;
      }

      // Fallback กรณีหาไฟล์เทมเพลตไม่เจอ
      const html = renderRequestFormHtml(row as RequestFormData);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(html);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Request Form Error', 'เกิดข้อผิดพลาดขณะสร้างแบบคำร้อง');
    }
  }

  /**
   * Student toggles uses_company_log_form
   * Route: PATCH /api/intents/:id/company-log-form
   * Access: student
   */
  static async updateCompanyLogForm(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }
      const studentId = req.user.userId;
      const formId = parseInt(req.params.id, 10);
      if (isNaN(formId)) {
        res.status(400).json({ message: 'Invalid intent form ID format.' });
        return;
      }
      const { uses_company_log_form } = req.body;
      if (typeof uses_company_log_form !== 'boolean') {
        res.status(400).json({ message: 'uses_company_log_form must be a boolean.' });
        return;
      }

      const result = await query(
        `UPDATE intent_forms
         SET uses_company_log_form = $1
         WHERE form_id = $2 AND student_id = $3
         RETURNING form_id, uses_company_log_form`,
        [uses_company_log_form, formId, studentId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Intent form not found or not owned by you.' });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Company log form setting updated.',
        data: result.rows[0],
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Update Company Log Form Error', 'An internal server error occurred.');
    }
  }

}
