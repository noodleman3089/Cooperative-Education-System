import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { IntentFormModel, COMPANY_VISIBLE_STATUSES, LateStamp } from '../models/intent';
import { isLateWindow } from '../middlewares/calendarGate';
import { query } from '../config/database';
import { notifyStudentStatusChange } from '../utils/email';
import {
  assertCanAccessStudent,
  assertCanReviewStudentWork,
  resolveMajorScope,
  sendAccessError,
} from '../utils/access';
import { renderRequestFormHtml, RequestFormData } from '../utils/requestFormHtml';
import {
  buildCoverLetterPdf,
  fetchCoverLetterData,
  toCoverLetterData,
} from '../utils/coverLetterPdf';
import { buildAcceptanceFormPdf } from '../utils/acceptanceFormPdf';
import { OfficialDocumentModel } from '../models/officialDocument';
import { AuditAction, writeAudit } from '../utils/audit';
import { getErrorMessage } from '../utils/httpError';
import { sendUnexpectedError } from '../utils/httpError';

/** ความยาวขั้นต่ำของเหตุผลการส่งช้า — กติกาหน้าจอ ไม่ใช่ข้อบังคับของฐาน */
const LATE_REASON_MIN_LENGTH = 20;

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
                i.semester_id, i.job_id, j.title as job_title, i.status, i.mentor_id, i.start_date, i.acceptance_evidence_path,
                i.request_form_path, i.reject_reason, i.officer_document_no,
                i.submitted_late, i.late_reason
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
   * Access: advisor, dept_head, staff, dean, company
   */
  static async getIntents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { roles, userId } = req.user;
      const { status, major_id } = req.query;
      let { company_id } = req.query;

      // Restrict query for company role
      const isCompany = roles.includes('company');
      if (isCompany) {
        const companyQuery = await query('SELECT company_id FROM companies WHERE created_by = $1 LIMIT 1', [userId]);
        if ((companyQuery.rowCount ?? 0) === 0) {
          res.status(200).json([]);
          return;
        }
        company_id = companyQuery.rows[0].company_id.toString();
      }

      const isStaffOrDeanOrCompany = roles.some((r: string) => ['staff', 'dean', 'company'].includes(r));
      let userMajorId: number | null = null;

      if (!isStaffOrDeanOrCompany) {
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
               doc.status AS cover_letter_status
        FROM intent_forms i
        JOIN students s ON i.student_id = s.student_id
        JOIN master_major m ON s.major_id = m.major_id
        JOIN companies c ON i.company_id = c.company_id
        LEFT JOIN job_posts j ON i.job_id = j.job_id
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

      // SEC-10: a company must not see a placement the faculty has not sent it.
      // On paper nothing reaches the company until the department head has
      // selected the students and สหกิจ 04 goes out; the screen now starts at the
      // same point instead of listing applications from the moment they are filed.
      if (isCompany) {
        queryParams.push(COMPANY_VISIBLE_STATUSES);
        queryStr += ` AND i.status = ANY($${queryParams.length}::text[])`;
      }

      queryStr += ` ORDER BY i.form_id DESC`;

      const result = await query(queryStr, queryParams);

      // SEC-10: one query serves five roles, so the columns it selects are the
      // union of what all five need — and an advisor needs the student's home
      // address and parent contacts. A company does not: its paper equivalent,
      // สหกิจ 04, carries only the name, student code, major and job title, and
      // everything personal reaches the company through the student's own
      // สหกิจ 03 — the resume file they chose to attach, still linked below.
      // The rest of each row is dropped here rather than by narrowing the query,
      // because the other four roles genuinely use all of it.
      if (isCompany) {
        const visible = result.rows.map((row) => ({
          form_id: row.form_id,
          student_code: row.student_code,
          first_name: row.first_name,
          last_name: row.last_name,
          major_name_th: row.major_name_th,
          job_title: row.job_title,
          status: row.status,
          resume_file: row.resume_file,
          reject_reason: row.reject_reason,
        }));
        res.status(200).json(visible);
        return;
      }

      res.status(200).json(result.rows);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Intents Error', 'An internal server error occurred while retrieving intents.');
    }
  }

  /**
   * Get detailed view of an intent form.
   * Route: GET /api/intents/:id
   * Access: student owner, advisor, dept_head, staff, dean, company
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
                s.student_id, s.student_code, s.cumulative_gpa, s.resume_file, s.is_eligible, s.is_orientation_passed,
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
      let isCompanyViewer = false;

      if (roles.some(r => ['staff', 'dean', 'advisor', 'dept_head'].includes(r))) {
        // SEC-06: personnel could previously open any intent detail regardless of
        // major, even though the list endpoint scoped them. Apply the same scope.
        await assertCanAccessStudent(userId, roles, row.student_id);
        isAuthorized = true;
      } else if (roles.includes('student') && row.student_id === userId) {
        isAuthorized = true;
      } else if (roles.includes('company')) {
        const companyQuery = await query('SELECT company_id FROM companies WHERE created_by = $1 LIMIT 1', [userId]);
        if ((companyQuery.rowCount ?? 0) > 0 && companyQuery.rows[0].company_id === row.company_id) {
          isAuthorized = true;
          isCompanyViewer = true;
        }
      }

      if (!isAuthorized) {
        res.status(403).json({ message: 'Forbidden. You do not have access to view this intent form.' });
        return;
      }

      // SEC-10: endpoint นี้เคยคืนทั้งแถวให้ทุก role ที่ผ่านด่าน — รวมถึงบริษัท
      // ซึ่งได้ `cumulative_gpa` · อีเมลนักศึกษา · ผลคัดกรอง ไปด้วยเต็มๆ ทั้งที่
      // `GET /intents` (หน้าจอเดียวกัน) ตัดฟิลด์ให้เหลือเท่า สหกิจ 04 มาตั้งแต่รอบ 39
      //
      // ที่นี่ใช้ allow-list เหมือนกัน ไม่ใช่ blocklist: ฟิลด์ใหม่ที่ใครเพิ่มลง SELECT
      // ข้างบนวันหลัง จะ **ไม่** หลุดไปหาบริษัทเองโดยอัตโนมัติ
      //
      // สิ่งที่ให้ = ของที่บริษัทเป็นเจ้าของเอง (บริษัท · ประกาศงาน · พี่เลี้ยงที่ตัวเอง
      // ลงทะเบียน) + เท่าที่ สหกิจ 04 ให้ (รหัสนักศึกษา · สาขา) + แฟ้มประวัติที่นักศึกษา
      // เลือกแนบเอง (สหกิจ 03) · ⛔ ห้ามเพิ่มเกรด ผลคัดกรอง หรือช่องทางติดต่อส่วนตัว
      if (isCompanyViewer) {
        res.status(200).json({
          form_id: row.form_id,
          status: row.status,
          start_date: row.start_date,
          student_code: row.student_code,
          major_name_th: row.major_name_th,
          resume_file: row.resume_file,
          company_id: row.company_id,
          company_name_th: row.company_name_th,
          job_id: row.job_id,
          job_title: row.job_title,
          job_description: row.job_description,
          mentor_id: row.mentor_id,
          mentor_name: row.mentor_name,
          mentor_email: row.mentor_email,
          mentor_phone: row.mentor_phone,
          mentor_position: row.mentor_position,
          mentor_department: row.mentor_department,
        });
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
   */
  static async getPipelineSummary(_req: Request, res: Response): Promise<void> {
    try {
      const summaryResult = await query(`
        SELECT status, COUNT(*)::int as count
        FROM intent_forms
        GROUP BY status
      `);

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

      // Count dispatch eligible (status = 'accepted' AND no dispatch_letter doc)
      const dispatchEligibleResult = await query(`
        SELECT COUNT(*)::int as count
        FROM intent_forms i
        LEFT JOIN official_documents d ON d.student_id = i.student_id AND d.type = 'dispatch_letter'
        WHERE i.status = 'accepted' AND d.doc_id IS NULL
      `);
      counts.dispatch_eligible = Number(dispatchEligibleResult.rows[0]?.count || 0);

      res.status(200).json(counts);
    } catch (error) {
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
      const { previousPath } = await IntentFormModel.attachRequestForm(
        formId,
        req.user.userId,
        filePath
      );

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
   * เจ้าหน้าที่รับคำร้อง — กรอกชื่อผู้ลงนามจากกระดาษ + ออกเลขที่หนังสือ
   * Route: PATCH /api/intents/:id/officer-approve
   * Access: staff
   *
   * ⛔ **บังคับครบทุกช่อง** — ค่าพวกนี้จะถูกพิมพ์ลงหนังสือขอความอนุเคราะห์ที่คณบดี
   * ลงนาม ปล่อยว่างช่องใดช่องหนึ่งแปลว่าหนังสือราชการออกไปโดยมีที่ว่าง
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

      const {
        advisor_signer_name,
        advisor_signed_date,
        dept_head_signer_name,
        dept_head_signed_date,
        document_no,
      } = req.body ?? {};

      const missing = [
        ['ชื่ออาจารย์ที่ปรึกษาผู้ลงนาม', advisor_signer_name],
        ['วันที่อาจารย์ที่ปรึกษาลงนาม', advisor_signed_date],
        ['ชื่อหัวหน้าสาขาวิชาผู้ลงนาม', dept_head_signer_name],
        ['วันที่หัวหน้าสาขาวิชาลงนาม', dept_head_signed_date],
        ['เลขที่หนังสือออก', document_no],
      ]
        .filter(([, value]) => typeof value !== 'string' || !value.trim())
        .map(([label]) => label);

      if (missing.length > 0) {
        res.status(400).json({ message: `กรุณากรอกให้ครบ: ${missing.join(' · ')}` });
        return;
      }

      // วันที่รับเป็นสตริง YYYY-MM-DD ล้วน — ห้าม new Date() แล้วส่งต่อ เพราะจะเลื่อนวัน
      const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
      if (!isDate(advisor_signed_date) || !isDate(dept_head_signed_date)) {
        res.status(400).json({ message: 'รูปแบบวันที่ลงนามต้องเป็น ปี-เดือน-วัน (YYYY-MM-DD)' });
        return;
      }

      const { studentId, companyId } = await IntentFormModel.officerApproveRequest(
        formId,
        req.user.userId,
        {
          advisorSignerName: advisor_signer_name.trim(),
          advisorSignedDate: advisor_signed_date.trim(),
          deptHeadSignerName: dept_head_signer_name.trim(),
          deptHeadSignedDate: dept_head_signed_date.trim(),
          documentNo: document_no.trim(),
        }
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
        `SELECT i.student_id, i.officer_document_no,
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
                sem.academic_year, sem.semester
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

      // `pg` คืน DATE เป็นสตริง YYYY-MM-DD อยู่แล้ว — ห้าม new Date() (เลื่อนวัน)
      const html = renderRequestFormHtml(row as RequestFormData);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send(html);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Request Form Error', 'เกิดข้อผิดพลาดขณะสร้างแบบคำร้อง');
    }
  }

}
