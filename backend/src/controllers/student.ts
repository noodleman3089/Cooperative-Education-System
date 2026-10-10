import { Request, Response } from 'express';
import { StudentModel } from '../models/student';
import { MasterModel } from '../models/master';
import pool, { query } from '../config/database';
import {
  assertCanAccessStudent,
  assertCanReviewStudentWork,
  assertMentorOwnsStudent,
  resolveMajorScope,
  sendAccessError,
} from '../utils/access';
import { AuditAction, writeAudit } from '../utils/audit';
import { COMPANY_MAIL_LIMIT, IntentFormModel } from '../models/intent';
import { sendPersonnelAssignmentEmail } from '../utils/email';
import { sendUnexpectedError } from '../utils/httpError';
import { formatAccommodationAddress, isValidCoordinate } from '../utils/accommodationAddress';
import { decryptSensitive, encryptSensitive, maskNationalId } from '../utils/encryption';
import { COOP03_REQUIRED_COLUMNS, coop03MissingKeys } from '../utils/coop03Required';
import {
  ACTIVITY_KEYS,
  EDUCATION_KEYS,
  LANGUAGE_KEYS,
  MAX_ACTIVITY_ROWS,
  MAX_EDUCATION_ROWS,
  MAX_LANGUAGE_ROWS,
  MAX_TRAINING_ROWS,
  TRAINING_KEYS,
  sanitizeFamilyInfo,
  sanitizeRows,
} from '../utils/coopApplicationHistory';
import {
  buildCoopApplicationPdf,
  fetchCoopApplicationPdfData,
} from '../utils/coopApplicationPdf';
import {
  buildAccommodationFormPdf,
  fetchAccommodationFormData,
} from '../utils/accommodationFormPdf';

export class StudentController {
  /**
   * Get Student Dashboard overview: profile, milestones, active intent, and official documents.
   * Route: GET /api/students/dashboard
   * Access: Student only
   */
  static async getStudentDashboard(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const userId = req.user.userId;

      // 1. Fetch student profile with major, faculty, province, advisor email, and supervisor email
      const studentQuery = await query(
        `SELECT s.student_id, s.student_code, s.cumulative_gpa, s.resume_file, s.profile_image,
                s.major_id, m.major_name_th, m.major_code, f.faculty_name_th, s.province_id, p.province_name_th,
                s.first_name, s.last_name,
                s.advisor_id, u_adv.email as advisor_email, p_adv.first_name as advisor_first_name, p_adv.last_name as advisor_last_name,
                s.supervisor_id, u_sup.email as supervisor_email, p_sup.first_name as supervisor_first_name, p_sup.last_name as supervisor_last_name
         FROM students s
         JOIN master_major m ON s.major_id = m.major_id
         JOIN master_faculty f ON m.faculty_id = f.faculty_id
         LEFT JOIN master_province p ON s.province_id = p.province_id
         LEFT JOIN users u_adv ON s.advisor_id = u_adv.user_id
         LEFT JOIN personnel p_adv ON s.advisor_id = p_adv.personnel_id
         LEFT JOIN users u_sup ON s.supervisor_id = u_sup.user_id
         LEFT JOIN personnel p_sup ON s.supervisor_id = p_sup.personnel_id
         WHERE s.student_id = $1`,
        [userId]
      );

      if ((studentQuery.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Student profile not found. Please setup profile first.' });
        return;
      }

      const student = studentQuery.rows[0];

      // 2. Fetch current active semester (to filter active intent form)
      const semesterQuery = await query(
        `SELECT semester_id FROM coop_semesters WHERE is_active = TRUE LIMIT 1`
      );
      
      let activeIntent = null;
      // ใบที่ถูกปิด (ตีกลับ/บริษัทไม่รับ) ล่าสุดของภาคนี้ — ให้การ์ดสถานะบอกเหตุผลได้
      // ⛔ แยกจาก activeIntent โดยตั้งใจ: โค้ดอื่นอ่าน activeIntent === null ว่า "ยื่นใหม่ได้" ห้ามยัดใบที่ปิดแล้วลงไป
      // · ส่งเฉพาะตอนไม่มี activeIntent · ส่งแค่ 4 ฟิลด์ (ไม่มีข้อมูลบริษัทอื่น — SEC-10)
      let closedIntent: {
        form_id: number;
        status: string;
        company_name_th: string;
        reject_reason: string | null;
      } | null = null;
      if ((semesterQuery.rowCount ?? 0) > 0) {
        const semesterId = semesterQuery.rows[0].semester_id;
        
        // Fetch student's intent form for this semester (not rejected/failed)
        const intentQuery = await query(
          `SELECT i.form_id, i.company_id, c.name_th as company_name_th,
                  i.status, i.start_date, i.acceptance_evidence_path,
                  -- ล็อกการระบุพี่เลี้ยง: ต้อง accepted และถึงวันเริ่มฝึกแล้ว (เงื่อนไขเดียวกับ setMentorWithTransaction)
                  -- ไม่มีวันเริ่ม = ไม่ล็อกด้วยวันที่ · mentor_opens_on = วันที่จะเปิดให้ระบุ (เฉพาะใบ accepted ที่ยังไม่ถึงวัน)
                  NOT (i.status = 'accepted'
                       AND (i.start_date IS NULL OR i.start_date <= (NOW() AT TIME ZONE 'Asia/Bangkok')::date)) AS mentor_locked,
                  CASE WHEN i.status = 'accepted' AND i.start_date > (NOW() AT TIME ZONE 'Asia/Bangkok')::date
                       THEN i.start_date::text END AS mentor_opens_on,
                  i.request_form_path, i.reject_reason, i.officer_document_no,
                  i.submitted_late, i.acceptance_due_date, i.acceptance_submitted_late,
                  i.company_mail_to, i.company_mail_sent_at, i.company_mail_count,
                  c.email AS company_email, i.acceptance_source,
                  i.acceptance_signer_name,
                  i.mentor_id, m.name as mentor_name, u_men.email as mentor_email, m.phone as mentor_phone,
                  m.position as mentor_position, m.department as mentor_department,
                  COALESCE(u_men.is_active, FALSE) AS mentor_confirmed,
                  doc.status AS cover_letter_status
           FROM intent_forms i
           JOIN companies c ON i.company_id = c.company_id
           LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
           LEFT JOIN users u_men ON i.mentor_id = u_men.user_id
           -- หนังสือขอความอนุเคราะห์ **ของใบนี้** — LATERAL เดียวกับ SEC-13 ด่าน 2 / ด่านลิงก์ (เทียบ officer_document_no)
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
           WHERE i.student_id = $1 AND i.semester_id = $2
             AND i.status NOT IN ('rejected', 'company_rejected', 'superseded')
           ORDER BY i.form_id DESC
           LIMIT 1`,
          [userId, semesterId]
        );

        if ((intentQuery.rowCount ?? 0) > 0) {
          const row = intentQuery.rows[0];
          activeIntent = {
            form_id: row.form_id,
            company_id: row.company_id,
            company_name_th: row.company_name_th,
            status: row.status,
            start_date: row.start_date,
            acceptance_evidence_path: row.acceptance_evidence_path,
            request_form_path: row.request_form_path,
            reject_reason: row.reject_reason,
            officer_document_no: row.officer_document_no,
            // สถานะหนังสือขอความอนุเคราะห์ของใบนี้เอง (null = ยังไม่ออก) — แถบเส้นทางและป้ายสถานะอ่านจากตรงนี้
            // ⛔ ห้ามให้หน้าจอไปหยิบจาก `documents` เอง: รายการนั้นมีหนังสือของใบที่ปิดไปแล้วปนอยู่ (บั๊ก 2026-10-08)
            cover_letter_status: row.cover_letter_status,
            // ยื่นล่าช้า + กำหนดตอบกลับ ๑๕ วันทำการ — หน้าแรกของนักศึกษาอ่านจากตรงนี้
            // ไม่ใช่จาก `documents` ซึ่งจะกลายเป็นแหล่งความจริงที่สอง
            submitted_late: row.submitted_late,
            acceptance_due_date: row.acceptance_due_date,
            acceptance_submitted_late: row.acceptance_submitted_late,
            // ส่งหนังสือ+แบบตอบรับถึงสถานประกอบการเอง · `company_email` ไว้เติมช่องอีเมลครั้งแรก
            // (ส่งเฉพาะอีเมล ไม่ขยายฟิลด์บริษัทอื่น — SEC-10)
            company_mail_to: row.company_mail_to,
            company_mail_sent_at: row.company_mail_sent_at,
            company_mail_count: row.company_mail_count,
            company_mail_limit: COMPANY_MAIL_LIMIT,
            company_email: row.company_email,
            // ที่มาของคำตอบรับ: 'link' = บริษัทตอบผ่านลิงก์ · 'student' = นักศึกษาอัปโหลดเอง · null = ยังไม่มี
            acceptance_source: row.acceptance_source,
            acceptance_signer_name: row.acceptance_signer_name,
            // ชื่อผู้ลงนามแบบคำร้อง (เอกสารหมายเลข 1) ที่ระบบรู้เอง — null = นักศึกษาต้องกรอกตอนอัปโหลด
            // `candidates` = รายชื่อในสาขา ไว้ช่วยค้นตอนนักศึกษาระบุผู้ลงนามเอง (ผู้ลงนามจริงไม่ใช่คนที่ระบบรู้)
            request_signers: {
              ...(await IntentFormModel.resolveRequestSigners(userId)),
              candidates: await IntentFormModel.listSignerCandidates(userId),
            },
            // ล็อกการระบุพี่เลี้ยง — หน้าจอใช้ล็อกเมนู ⛔ ห้ามคำนวณวันเอง (ด่านจริงคือ 409 `internship_not_started`)
            // `mentor_locked` = ใบยังไม่ `accepted` หรือยังไม่ถึงวันเริ่มฝึก · `mentor_opens_on` = วันที่จะเปิด (null = ไม่ทราบ/ไม่ได้ล็อกด้วยวันที่)
            // `supervisor_assigned: false` = ระบุได้แต่จะค้าง "รอยืนยัน" จนกว่าหัวหน้าสาขาจะจัดสรรอาจารย์นิเทศ
            mentor_locked: row.mentor_locked === true,
            mentor_opens_on: row.mentor_opens_on ?? null,
            supervisor_assigned: student.supervisor_id !== null,
            // พี่เลี้ยงระบุได้เมื่อใบ `accepted` — null = ยังไม่ระบุ · `confirmed: false` = รออาจารย์นิเทศยืนยัน (ยังแก้เองได้)
            // · `confirmed: true` = บัญชีพี่เลี้ยงเปิดแล้ว นักศึกษาแก้ไม่ได้ (POST /intents/:id/mentor ตอบ 409)
            mentor: row.mentor_id ? {
              mentor_id: row.mentor_id,
              name: row.mentor_name,
              email: row.mentor_email,
              phone: row.mentor_phone,
              position: row.mentor_position,
              department: row.mentor_department,
              confirmed: row.mentor_confirmed === true
            } : null
          };
        } else {
          const closedQuery = await query(
            `SELECT i.form_id, i.status, c.name_th AS company_name_th, i.reject_reason
             FROM intent_forms i
             JOIN companies c ON i.company_id = c.company_id
             WHERE i.student_id = $1 AND i.semester_id = $2
               AND i.status IN ('rejected', 'company_rejected')
             ORDER BY i.form_id DESC
             LIMIT 1`,
            [userId, semesterId]
          );
          if ((closedQuery.rowCount ?? 0) > 0) {
            const row = closedQuery.rows[0];
            closedIntent = {
              form_id: row.form_id,
              status: row.status,
              company_name_th: row.company_name_th,
              reject_reason: row.reject_reason,
            };
          }
        }
      }

      // 3. Fetch generated official documents for this student
      // `of_closed_request` = หนังสือฉบับนี้เป็นของคำร้องที่ปิดไปแล้ว (บริษัทไม่รับ · นักศึกษาแจ้งเอง · ระบบปิด) ใช้ยื่นไม่ได้อีก
      //   จับคู่ด้วยเลขที่หนังสือของใบ (นักศึกษา + บริษัท + เลขที่) แบบเดียวกับที่ระบบใช้ทุกที่
      //   ⛔ ติดป้ายเมื่อ **มีหลักฐานชัด** เท่านั้น: เลขที่ตรงกับใบที่ปิดแล้ว และไม่ตรงกับใบที่ยังเดินอยู่
      //      หาใบไม่เจอ / เลขที่ว่าง = ไม่รู้ = ไม่ติดป้าย (ใช้ `=` ไม่ใช่ IS NOT DISTINCT FROM — NULL ต้องไม่จับคู่กัน)
      const docQuery = await query(
        `SELECT d.doc_id, d.type, d.status, d.generated_file_path, d.dean_signature_date, d.docusign_envelope_id,
                c.name_th as company_name_th,
                COALESCE(f.matched > 0 AND f.still_open = 0, FALSE) AS of_closed_request
         FROM official_documents d
         JOIN companies c ON d.company_id = c.company_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS matched,
                  COUNT(*) FILTER (WHERE i.status NOT IN ('rejected', 'company_rejected', 'superseded')) AS still_open
             FROM intent_forms i
            WHERE i.student_id = d.student_id
              AND i.company_id = d.company_id
              AND ((d.type = 'cover_letter' AND d.document_number = i.officer_document_no)
                OR (d.type = 'send_letter'  AND d.document_number = i.dispatch_document_no))
         ) f ON TRUE
         WHERE d.student_id = $1
         ORDER BY of_closed_request, d.doc_id DESC`,
        [userId]
      );

      // 4. ความคืบหน้าเฟส 2–4 — ตัว stepper บนหน้าแรกอ่านจากตรงนี้ **ที่เดียว**
      // ⛔ เดิมหน้าจอเดาเอง: 2.x ติ๊กเสร็จทันทีที่บริษัทตอบรับ และ 3.x/4.x เป็น `&& false` ตลอดกาล
      //    ทุกค่าข้างล่างต้องมาจากแถวจริงของขั้นนั้น
      const progressQuery = await query(
        `SELECT
           EXISTS (SELECT 1 FROM accommodations WHERE student_id = $1) AS accommodation_submitted,
           -- ส่งผ่านพี่เลี้ยงไปถึงอาจารย์แล้ว = ขั้นนักศึกษาจบ · ใบที่ยังรอพี่เลี้ยงยังไม่นับ
           EXISTS (SELECT 1 FROM report_outlines
                    WHERE student_id = $1 AND status IN ('pending_advisor', 'approved')) AS outline_submitted,
           EXISTS (SELECT 1 FROM report_outlines
                    WHERE student_id = $1 AND status = 'approved') AS outline_approved,
           (SELECT COUNT(DISTINCT visit_number)::int FROM supervision_records
             WHERE student_id = $1) AS supervision_visits,
           -- ⛔ ต้อง reviewer_kind = 'advisor' — แถว 'mentor' คือร่างที่ส่งพี่เลี้ยงดูก่อน ไม่ใช่เล่มสมบูรณ์
           EXISTS (SELECT 1 FROM final_reports
                    WHERE student_id = $1 AND reviewer_kind = 'advisor' AND status = 'approved') AS final_report_approved,
           -- สหกิจ 15 และ 16 — พี่เลี้ยงกรอกทั้งสองใบ
           (SELECT COUNT(DISTINCT form_code)::int FROM final_evaluations
             WHERE student_id = $1 AND evaluator_role = 'mentor') AS mentor_evaluations`,
        [userId]
      );

      // 5. จำนวนครั้งที่คณะ/อาจารย์เตือนพี่เลี้ยงของที่ฝึก (ทุกชนิดการเตือน) — การ์ดพี่เลี้ยงบนหน้าแรกอ่านจากตรงนี้
      // ⛔ ส่งแค่จำนวนกับเวลาล่าสุด — ไม่บอกว่าใครกดเตือน ไม่เปิดอีเมลพี่เลี้ยงเพิ่ม · ไม่มีที่ฝึกที่ตอบรับ = 0 / null
      const reminderQuery = await query(
        `SELECT COUNT(*)::int AS count, MAX(r.created_at) AS last_at
           FROM mentor_reminders r
          WHERE r.mentor_id IN (SELECT i.mentor_id FROM intent_forms i
                                 WHERE i.student_id = $1 AND i.status = 'accepted' AND i.mentor_id IS NOT NULL)`,
        [userId]
      );
      const reminderRow = reminderQuery.rows[0];

      // สหกิจ 03 ครบช่องบังคับหรือยัง — ขั้นย่อยของเฟส 2 และเงื่อนไขที่คณะใช้ก่อนออกหนังสือส่งตัว
      const coop03Query = await query(
        `SELECT ${COOP03_REQUIRED_COLUMNS.join(', ')} FROM students WHERE student_id = $1`,
        [userId]
      );

      res.status(200).json({
        progress: {
          ...progressQuery.rows[0],
          coop03_missing_count: coop03MissingKeys(coop03Query.rows[0] ?? {}).length,
        },
        mentor_reminders: {
          count: Number(reminderRow?.count ?? 0),
          last_at: reminderRow?.last_at ? new Date(reminderRow.last_at).toISOString() : null,
        },
        student: {
          student_id: student.student_id,
          student_code: student.student_code,
          first_name: student.first_name,
          last_name: student.last_name,
          cumulative_gpa: parseFloat(student.cumulative_gpa),
          resume_file: student.resume_file,
          // รูปโปรไฟล์ — หน้าแรกแสดงแทนตัวอักษรแรกของชื่อเมื่อมีค่า
          profile_image: student.profile_image,
          major_id: student.major_id,
          major_name_th: student.major_name_th,
          major_code: student.major_code,
          faculty_name_th: student.faculty_name_th,
          province_id: student.province_id,
          province_name_th: student.province_name_th,
          advisor: student.advisor_id ? {
            personnel_id: student.advisor_id,
            email: student.advisor_email,
            name: `${student.advisor_first_name || ''} ${student.advisor_last_name || ''}`.trim()
          } : null,
          supervisor: student.supervisor_id ? {
            personnel_id: student.supervisor_id,
            email: student.supervisor_email,
            name: `${student.supervisor_first_name || ''} ${student.supervisor_last_name || ''}`.trim()
          } : null
        },
        activeIntent,
        closedIntent,
        documents: docQuery.rows
      });

    } catch (error) {
      sendUnexpectedError(res, error, 'Get Student Dashboard Error', 'An internal server error occurred while retrieving student dashboard.');
    }
  }

  /**
   * Update optional student profile information (skills, language, region, job types).
   * Route: PUT /api/profile/student/optional
   * Access: Student only
   */
  static async updateOptionalProfile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || !req.user.roles.includes('student')) {
        res.status(401).json({ message: 'Unauthorized. Only students can update this profile.' });
        return;
      }

      const studentId = req.user.userId;
      const { skills_and_activities, language_proficiency, preferred_work_region, interested_job_types } = req.body;

      const updatedStudent = await StudentModel.updateOptionalProfile(
        studentId,
        skills_and_activities || null,
        language_proficiency || null,
        preferred_work_region || null,
        interested_job_types || null
      );

      if (!updatedStudent) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Optional profile updated successfully.',
        student: updatedStudent,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Update Optional Profile Error', 'An internal server error occurred while updating optional profile.');
    }
  }

  /**
   * สหกิจ 03 — อ่านข้อมูลใบสมัครงานของตัวเอง
   * Route: GET /api/students/coop-application
   * Access: student (ของตัวเองเสมอ — ใช้ userId จาก token ไม่รับ id จากผู้เรียก)
   *
   * ⛔ **เลขบัตร/เชื้อชาติ/ศาสนาไม่เคยถูกส่งกลับเป็นค่าจริง** (SEC-12 ข้อ 2)
   * เลขบัตรส่งเป็นมาสก์ `x-xxxx-xxxxx-xx-3` ส่วนเชื้อชาติ/ศาสนาส่งแค่ธงว่า "กรอกแล้ว"
   * — การถอดรหัสมีที่เดียวคือตอนวาดเอกสารจริง ไม่ใช่ตอนเปิดหน้าจอ
   */
  static async getCoopApplication(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      // ⛔ **ไม่ใช้ `StudentModel.findByStudentId`** — เมธอดนั้นมีรายชื่อคอลัมน์ตายตัว
      //    และถูกใช้โดย `/profile/me` ด้วย · การไปเติมคอลัมน์ ciphertext เข้าไปที่นั่น
      //    เท่ากับส่งข้อมูลเข้ารหัสไปโผล่ใน endpoint ที่ไม่ได้ต้องการมันเลย
      const result = await query(
        `SELECT first_name, last_name, student_code, phone, alt_email,
                first_name_en, last_name_en, gender, nationality, mobile_phone, fax,
                emergency_contact_name, emergency_relationship, emergency_address,
                emergency_phone, national_id_issued_district,
                national_id_expiry_date::text AS national_id_expiry_date,
                national_id_ciphertext, national_id_iv, national_id_tag,
                ethnicity_ciphertext, religion_ciphertext, sensitive_data_consented_at,
                career_objective, family_info, education_history,
                training_history, activity_history, language_proficiency
           FROM students WHERE student_id = $1`,
        [req.user.userId]
      );
      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบประวัตินักศึกษา กรุณาตั้งค่าโปรไฟล์ก่อน' });
        return;
      }

      const row = result.rows[0] as Record<string, unknown>;
      const hasCipher = (prefix: string) => Boolean(row[`${prefix}_ciphertext`]);

      // มาสก์ต้องถอดรหัสก่อนจึงจะรู้หลักสุดท้าย — ล้มเหลว (กุญแจเปลี่ยน/ข้อมูลเสีย)
      // ต้องไม่ทำให้ทั้งหน้าจอเปิดไม่ได้ ตกไปเป็นมาสก์กลางๆ แทน
      let nationalIdMasked: string | null = null;
      if (hasCipher('national_id')) {
        try {
          nationalIdMasked = maskNationalId(
            decryptSensitive({
              ciphertext: row.national_id_ciphertext as string,
              iv: row.national_id_iv as string,
              authTag: row.national_id_tag as string,
            })
          );
        } catch {
          nationalIdMasked = 'x-xxxx-xxxxx-xx-x';
        }
      }

      res.status(200).json({
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        student_code: row.student_code ?? null,
        first_name_en: row.first_name_en ?? null,
        last_name_en: row.last_name_en ?? null,
        gender: row.gender ?? null,
        nationality: row.nationality ?? null,
        phone: row.phone ?? null,
        mobile_phone: row.mobile_phone ?? null,
        fax: row.fax ?? null,
        alt_email: row.alt_email ?? null,
        emergency_contact_name: row.emergency_contact_name ?? null,
        emergency_relationship: row.emergency_relationship ?? null,
        emergency_address: row.emergency_address ?? null,
        emergency_phone: row.emergency_phone ?? null,
        national_id_issued_district: row.national_id_issued_district ?? null,
        national_id_expiry_date: row.national_id_expiry_date ?? null,
        // ⛔ มาสก์และธงเท่านั้น — ห้ามส่งค่าจริงออกจาก endpoint นี้ไม่ว่ากรณีใด
        national_id_masked: nationalIdMasked,
        has_ethnicity: hasCipher('ethnicity'),
        has_religion: hasCipher('religion'),
        sensitive_data_consented_at: row.sensitive_data_consented_at ?? null,
        // ช่องบังคับที่ยังว่าง (คีย์) — ครบแล้วคณะจึงออกหนังสือส่งตัวได้ · กติกาอยู่ที่ `utils/coop03Required.ts` ที่เดียว
        missing_required: coop03MissingKeys(row),
        // JSONB — `pg` แปลงกลับเป็น object/array ให้แล้ว ไม่ต้อง parse ซ้ำ
        career_objective: row.career_objective ?? null,
        family_info: row.family_info ?? null,
        education_history: row.education_history ?? null,
        training_history: row.training_history ?? null,
        activity_history: row.activity_history ?? null,
        language_proficiency: row.language_proficiency ?? null,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Get Coop Application Error',
        'เกิดข้อผิดพลาดขณะดึงข้อมูลใบสมัครงานสหกิจศึกษา'
      );
    }
  }

  /**
   * สหกิจ 03 — บันทึกข้อมูลใบสมัครงานของตัวเอง (ส่วนตัวตน/ติดต่อ/ฉุกเฉิน)
   * Route: PUT /api/students/coop-application
   * Access: student
   *
   * ⛔ **เชื้อชาติ/ศาสนาเขียนได้ต่อเมื่อยินยอมโดยชัดแจ้งแล้วเท่านั้น** (PDPA ม.26)
   * ไม่ใช่ยินยอมรวมอยู่ในเงื่อนไขการใช้งานทั่วไป — ต้องติ๊กแยกและระบบบันทึกเวลาที่ติ๊ก
   * ลง `audit_log` · ส่งสองช่องนี้มาโดยยังไม่เคยยินยอม = ปฏิเสธทั้งคำขอ ไม่ใช่เขียนเงียบๆ
   */
  static async updateCoopApplication(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = req.user.userId;
      const existingRes = await query(
        'SELECT sensitive_data_consented_at FROM students WHERE student_id = $1',
        [studentId]
      );
      if ((existingRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบประวัตินักศึกษา กรุณาตั้งค่าโปรไฟล์ก่อน' });
        return;
      }

      const body = req.body ?? {};
      const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
      const optional = (v: unknown): string | null => text(v) || null;

      // เลขบัตรประชาชนไทยมี 13 หลัก — ยอมให้พิมพ์ขีดคั่นได้ แล้วเก็บเฉพาะตัวเลข
      const nationalIdDigits = text(body.national_id).replace(/\D/g, '');
      if (text(body.national_id) && nationalIdDigits.length !== 13) {
        res.status(400).json({ message: 'เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก' });
        return;
      }

      const expiry = text(body.national_id_expiry_date);
      if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        res.status(400).json({ message: 'รูปแบบวันหมดอายุบัตรต้องเป็น ปี-เดือน-วัน (YYYY-MM-DD)' });
        return;
      }

      const ethnicity = text(body.ethnicity);
      const religion = text(body.religion);
      const alreadyConsented = Boolean(existingRes.rows[0].sensitive_data_consented_at);
      const consentingNow = body.sensitive_data_consent === true;

      if ((ethnicity || religion) && !alreadyConsented && !consentingNow) {
        res.status(400).json({
          message:
            'เชื้อชาติและศาสนาเป็นข้อมูลอ่อนไหวตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล มาตรา 26 — ต้องให้ความยินยอมก่อนจึงจะบันทึกได้',
        });
        return;
      }

      const updated = await StudentModel.updateCoopApplicationIdentity(
        studentId,
        {
          firstNameEn: optional(body.first_name_en),
          lastNameEn: optional(body.last_name_en),
          gender: optional(body.gender),
          nationality: optional(body.nationality),
          mobilePhone: optional(body.mobile_phone),
          fax: optional(body.fax),
          emergencyContactName: optional(body.emergency_contact_name),
          emergencyRelationship: optional(body.emergency_relationship),
          emergencyAddress: optional(body.emergency_address),
          emergencyPhone: optional(body.emergency_phone),
          nationalIdIssuedDistrict: optional(body.national_id_issued_district),
          nationalIdExpiryDate: expiry || null,
          careerObjective: optional(body.career_objective),
        },
        {
          // ⛔ ตรวจรูปทรงก่อนลงฐานเสมอ — JSONB รับอะไรก็ได้ ปล่อยผ่านคือปล่อยให้
          //    ก้อนข้อมูลรูปทรงแปลกๆ นอนอยู่ในคอลัมน์แล้วหน้าจอที่อ่านมันพังทีหลัง
          familyInfo: sanitizeFamilyInfo(body.family_info),
          educationHistory: sanitizeRows(body.education_history, EDUCATION_KEYS, MAX_EDUCATION_ROWS),
          trainingHistory: sanitizeRows(body.training_history, TRAINING_KEYS, MAX_TRAINING_ROWS),
          activityHistory: sanitizeRows(body.activity_history, ACTIVITY_KEYS, MAX_ACTIVITY_ROWS),
          languageProficiency: sanitizeRows(
            body.language_proficiency,
            LANGUAGE_KEYS,
            MAX_LANGUAGE_ROWS
          ),
        },
        {
          // ไม่ได้ส่งมา = ไม่ได้แก้ (หน้าจอเห็นแต่มาสก์) — โมเดลใช้ COALESCE รับไม้ต่อ
          nationalId: nationalIdDigits ? encryptSensitive(nationalIdDigits) : null,
          ethnicity: ethnicity ? encryptSensitive(ethnicity) : null,
          religion: religion ? encryptSensitive(religion) : null,
          consentAt: !alreadyConsented && consentingNow ? new Date() : null,
        }
      );

      // เวลาที่ให้ความยินยอมต้องตามย้อนได้ว่าเกิดขึ้นจริงเมื่อไหร่ ไม่ใช่มีแต่คอลัมน์
      // ที่แก้ทับได้ — `audit_log` เขียนอย่างเดียว (SEC-07)
      if (!alreadyConsented && consentingNow) {
        writeAudit(
          {
            action: AuditAction.SENSITIVE_DATA_CONSENT_GIVEN,
            entityType: 'student',
            entityId: studentId,
            subjectId: studentId,
            detail: { basis: 'PDPA_s26', fields: ['ethnicity', 'religion'] },
          },
          req
        ).catch(() => undefined);
      }

      res.status(200).json({
        message: 'บันทึกข้อมูลใบสมัครงานสหกิจศึกษาเรียบร้อยแล้ว',
        sensitive_data_consented_at:
          (updated as unknown as Record<string, unknown>)?.sensitive_data_consented_at ?? null,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Update Coop Application Error',
        'เกิดข้อผิดพลาดขณะบันทึกข้อมูลใบสมัครงานสหกิจศึกษา'
      );
    }
  }

  /**
   * สหกิจ 03 — พิมพ์ใบสมัครงานของตัวเองเป็น PDF
   * Route: GET /api/students/coop-application/print
   * Access: student (ของตัวเองเสมอ — ไม่รับ `:id` จากผู้เรียก)
   *
   * ⛔⛔ **นี่คือ endpoint เดียวที่ทำให้ค่าจริงของเลขบัตร/เชื้อชาติ/ศาสนาออกจากฐาน**
   * (`utils/coopApplicationPdf.ts` ถอดรหัสตอนวาด) จึงมีกติกาสามข้อที่ห้ามแก้:
   *   1. **ห้ามรับ id จากผู้เรียก** — ใช้ `req.user.userId` เท่านั้น
   *   2. **ห้ามเปิดให้ role อื่น** ไม่ว่าบริษัท เจ้าหน้าที่ หรืออาจารย์
   *      (บริษัทอ่านใบสมัครได้ทาง `…/company-view` ซึ่งตัดชั้น C ออกหมดแล้ว)
   *   3. **ต้องลง `audit_log` ทุกครั้ง** — SEC-07 · การเปิดค่าจริงต้องตามย้อนได้
   *
   * ปุ่มนี้เป็น **ทางออกสำรอง** สำหรับบริษัทที่ยังไม่มีบัญชีในระบบเท่านั้น
   * ไม่ใช่ขั้นตอนบังคับ — ไม่มีใครกดเลย ระบบก็ยังเดินได้ครบเหมือนเดิม
   */
  static async printCoopApplication(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const studentId = req.user.userId;
      const data = await fetchCoopApplicationPdfData(studentId);
      if (!data) {
        res.status(404).json({ message: 'ไม่พบประวัตินักศึกษา กรุณาตั้งค่าโปรไฟล์ก่อน' });
        return;
      }

      const pdf = await buildCoopApplicationPdf(data);

      // เขียนหลังวาดสำเร็จ — การวาดล้มเหลวแล้วยังมีบรรทัดว่า "เปิดค่าจริงแล้ว"
      // จะทำให้บันทึกโกหก · `writeAudit` เป็น fire-and-forget ตามบรรทัดฐานของระบบ
      writeAudit(
        {
          action: AuditAction.COOP_APPLICATION_PRINTED,
          entityType: 'student',
          entityId: studentId,
          subjectId: studentId,
          detail: {
            decrypted: {
              national_id: Boolean(data.national_id),
              ethnicity: Boolean(data.ethnicity),
              religion: Boolean(data.religion),
            },
          },
        },
        req
      ).catch(() => undefined);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="coop03-application-${studentId}.pdf"`
      );
      res.status(200).send(pdf);
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'Print Coop Application Error',
        'เกิดข้อผิดพลาดขณะสร้างใบสมัครงานสหกิจศึกษา'
      );
    }
  }

  /**
   * สหกิจ 06 — พิมพ์แบบแจ้งรายละเอียดที่พักเป็น PDF
   * Route: GET /api/students/:id/accommodation-plan/print
   * Access: เหมือน GET ของหน้าเดียวกันเป๊ะ (นักศึกษาเจ้าของ + บุคลากรที่ดูแลจริง)
   *
   * ใบนี้**ไม่มีข้อมูลชั้น C** จึงไม่ต้องล็อกแน่นเท่า สหกิจ 03 · เปิดให้บุคลากรพิมพ์ได้
   * เพราะหัวหน้าสหกิจศึกษาฯ คือผู้รับใบนี้ตามหัวเรื่อง ("เรียน หัวหน้าสหกิจศึกษาฯ")
   * ⛔ แต่ยังต้องผ่าน `assertCanReviewStudentWork` เหมือนเดิม — ที่พักและผู้ติดต่อ
   *    ฉุกเฉินไม่ใช่ของที่อาจารย์คนไหนในมหาวิทยาลัยก็เปิดดูได้ (SEC-06)
   */
  static async printAccommodationForm(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      const isPersonnel = req.user.roles.some((r: string) =>
        ['staff', 'dean', 'advisor', 'dept_head'].includes(r)
      );
      if (isPersonnel) {
        await assertCanReviewStudentWork(req.user.userId, req.user.roles, studentId);
      } else if (req.user.userId !== studentId) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }

      const data = await fetchAccommodationFormData(studentId);
      if (!data) {
        res.status(404).json({ message: 'ไม่พบประวัตินักศึกษา' });
        return;
      }

      const pdf = await buildAccommodationFormPdf(data);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="coop06-accommodation-${studentId}.pdf"`
      );
      res.status(200).send(pdf);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(
        res,
        error,
        'Print Accommodation Form Error',
        'เกิดข้อผิดพลาดขณะสร้างแบบแจ้งที่พัก'
      );
    }
  }

  /*
   * ⛔ `PUT /api/students/:id/verify-eligibility` ถูกลบ 2026-09-14 — ระบบไม่มีการตรวจสิทธิ์สหกิจ
   *    และไม่มีขั้นปฐมนิเทศ (ไม่อยู่ในขอบเขต · SEC-02 · migration 031 ลบคอลัมน์ทิ้งแล้ว)
   *    แถว `student.eligibility_changed` เก่าใน audit_log ยังอยู่เป็นประวัติ
   */

  /**
   * Correct registry-owned student fields.
   * Route: PUT /api/students/:id/registry
   * Access: staff, dept_head (within their own major)
   *
   * Counterpart to SEC-05: students can no longer edit student_code, major_id,
   * enrollment_year or cumulative_gpa themselves, so the co-op office needs a
   * supported way to fix mistakes made at onboarding.
   */
  static async updateRegistryFields(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      await assertCanAccessStudent(req.user.userId, req.user.roles, studentId);

      const existing = await StudentModel.findByStudentId(studentId);
      if (!existing) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }

      const { student_code, major_id, enrollment_year, cumulative_gpa } = req.body;

      let nextStudentCode = existing.student_code;
      if (student_code !== undefined && student_code !== null && student_code !== '') {
        if (typeof student_code !== 'string' || !/^\d{12}-\d$/.test(student_code.trim())) {
          res.status(400).json({ message: 'รูปแบบรหัสนักศึกษาไม่ถูกต้อง (เช่น 123456789012-3)' });
          return;
        }
        nextStudentCode = student_code.trim();
        if (await StudentModel.existsByStudentCodeExcludeUser(nextStudentCode, studentId)) {
          res.status(400).json({ message: 'รหัสนักศึกษานี้ถูกใช้งานโดยบัญชีอื่นแล้ว' });
          return;
        }
      }

      let nextMajorId = existing.major_id;
      if (major_id !== undefined && major_id !== null && major_id !== '') {
        const parsed = parseInt(major_id, 10);
        if (isNaN(parsed) || !(await MasterModel.verifyMajorExists(parsed))) {
          res.status(400).json({ message: 'Invalid major_id. Referenced major does not exist.' });
          return;
        }
        // A dept_head may not move a student out of (or into) their own major.
        if (req.user.roles.includes('dept_head') && !req.user.roles.some((r) => ['staff', 'dean'].includes(r))) {
          const scope = await resolveMajorScope(req.user.userId, req.user.roles);
          if (scope.isScoped && parsed !== scope.majorId) {
            res.status(403).json({ message: 'Forbidden. You cannot move a student into another major.' });
            return;
          }
        }
        nextMajorId = parsed;
      }

      let nextEnrollmentYear = existing.enrollment_year ?? null;
      if (enrollment_year !== undefined && enrollment_year !== null && enrollment_year !== '') {
        const parsed = parseInt(enrollment_year, 10);
        if (isNaN(parsed) || parsed < 2500 || parsed > 2700) {
          res.status(400).json({ message: 'ปีการศึกษาที่เข้าศึกษาต้องเป็นปี พ.ศ. (เช่น 2568)' });
          return;
        }
        nextEnrollmentYear = parsed;
      }

      let nextGpa = existing.cumulative_gpa !== null && existing.cumulative_gpa !== undefined
        ? Number(existing.cumulative_gpa)
        : null;
      if (cumulative_gpa !== undefined && cumulative_gpa !== null && cumulative_gpa !== '') {
        const parsed = parseFloat(cumulative_gpa);
        if (isNaN(parsed) || parsed < 0 || parsed > 4.0) {
          res.status(400).json({ message: 'เกรดเฉลี่ยต้องอยู่ระหว่าง 0.00 ถึง 4.00' });
          return;
        }
        nextGpa = parsed;
      }

      const updated = await StudentModel.updateRegistryFields(
        studentId,
        nextStudentCode,
        nextMajorId,
        nextGpa,
        nextEnrollmentYear
      );

      writeAudit({
        action: AuditAction.REGISTRY_CHANGED,
        entityType: 'student',
        entityId: studentId,
        subjectId: studentId,
        detail: {
          student_code_before: existing.student_code,
          student_code_after: nextStudentCode,
          major_id_before: existing.major_id,
          major_id_after: nextMajorId,
          gpa_before: existing.cumulative_gpa ?? null,
          gpa_after: nextGpa,
          enrollment_year_before: existing.enrollment_year ?? null,
          enrollment_year_after: nextEnrollmentYear,
        },
      }, req).catch(() => undefined);

      res.status(200).json({
        message: 'อัปเดตข้อมูลทะเบียนนักศึกษาเรียบร้อยแล้ว',
        student: updated,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Update Registry Fields Error', 'An internal server error occurred while updating registry fields.');
    }
  }

  /**
   * Get list of all students with filtering.
   * Route: GET /api/students
   * Access: staff, dept_head, advisor
   */
  static async getStudents(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const majorIdParam = req.query.major_id;

      const { roles, userId } = req.user;
      // SEC-06: resolveMajorScope throws instead of silently returning an
      // unfiltered institution-wide list when the personnel profile is missing.
      const userMajorId = (await resolveMajorScope(userId, roles)).majorId;

      let queryStr = `
        SELECT s.student_id, s.student_code, s.cumulative_gpa, s.resume_file,
               s.major_id, m.major_name_th, m.major_code, f.faculty_name_th, s.province_id, p.province_name_th,
               s.advisor_id, u_adv.email as advisor_email,
               s.supervisor_id, u_sup.email as supervisor_email,
               s.first_name, s.last_name, s.phone,
               c.name_th as company_name, c.province as company_province
        FROM students s
        JOIN master_major m ON s.major_id = m.major_id
        JOIN master_faculty f ON m.faculty_id = f.faculty_id
        LEFT JOIN master_province p ON s.province_id = p.province_id
        LEFT JOIN users u_adv ON s.advisor_id = u_adv.user_id
        LEFT JOIN users u_sup ON s.supervisor_id = u_sup.user_id
        LEFT JOIN intent_forms i ON s.student_id = i.student_id AND i.status NOT IN ('rejected', 'company_rejected', 'superseded')
        LEFT JOIN companies c ON i.company_id = c.company_id
        WHERE 1=1
      `;
      const queryParams: unknown[] = [];

      if (userMajorId !== null) {
        queryParams.push(userMajorId);
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      } else if (majorIdParam) {
        queryParams.push(parseInt(majorIdParam as string, 10));
        queryStr += ` AND s.major_id = $${queryParams.length}`;
      }

      queryStr += ` ORDER BY s.student_code ASC`;

      const result = await query(queryStr, queryParams);
      res.status(200).json(result.rows);
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get Students List Error', 'An internal server error occurred while retrieving student list.');
    }
  }

  /**
   * Assign advisor and/or supervisor to a student.
   * Route: PUT /api/students/:id/assign-advisor
   * Access: dept_head, staff
   */
  static async assignAdvisor(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      const { advisor_id, supervisor_id } = req.body;
      const { roles, userId } = req.user;

      // 1. Fetch student's major_id
      const studentMajorRes = await query('SELECT major_id FROM students WHERE student_id = $1', [studentId]);
      if ((studentMajorRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }
      const studentMajorId = studentMajorRes.rows[0].major_id;

      // 2. Scope check — SEC-06: a dept_head with no personnel row used to skip
      // this guard entirely and could assign advisors across any major.
      await assertCanAccessStudent(userId, roles, studentId);

      // 3. Validate advisor exists, has advisor role, and matches student's major
      if (advisor_id !== undefined && advisor_id !== null) {
        const advCheck = await query(
          `SELECT 1 FROM personnel p 
           JOIN user_roles r ON p.personnel_id = r.user_id 
           WHERE p.personnel_id = $1 AND r.role_name = 'advisor' AND p.major_id = $2`,
          [advisor_id, studentMajorId]
        );
        if ((advCheck.rowCount ?? 0) === 0) {
          res.status(400).json({ message: 'Invalid advisor_id. Advisor must be in the same major as the student.' });
          return;
        }
      }

      // 4. Validate supervisor exists, has valid role, and matches student's major
      if (supervisor_id !== undefined && supervisor_id !== null) {
        const supCheck = await query(
          `SELECT 1 FROM personnel p 
           JOIN user_roles r ON p.personnel_id = r.user_id 
           WHERE p.personnel_id = $1 AND r.role_name IN ('advisor', 'staff', 'dept_head') AND p.major_id = $2`,
          [supervisor_id, studentMajorId]
        );
        if ((supCheck.rowCount ?? 0) === 0) {
          res.status(400).json({ message: 'Invalid supervisor_id. Supervisor must be in the same major as the student.' });
          return;
        }
      }

      const updated = await StudentModel.assignAdvisorAndSupervisor(
        studentId,
        advisor_id !== undefined ? advisor_id : null,
        supervisor_id !== undefined ? supervisor_id : null
      );

      if (!updated) {
        res.status(404).json({ message: 'Student profile not found.' });
        return;
      }

      res.status(200).json({
        message: 'Advisor/Supervisor assigned successfully.',
        student: updated
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Assign Advisor Error', 'An internal server error occurred while assigning advisor.');
    }
  }

  /**
   * Batch assign advisor and supervisor to multiple students
   * Route: PUT /api/students/batch-assign-personnel
   * Allowed Roles: Dept Head, Staff
   */
  static async batchAssignPersonnel(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const { studentIds, advisor_id, supervisor_id } = req.body;
      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        res.status(400).json({ message: 'Required field: studentIds array' });
        return;
      }
      
      // According to System 2 rules, both advisor and supervisor MUST be selected
      if (!advisor_id || !supervisor_id) {
        res.status(400).json({ message: 'กรุณามอบหมายอาจารย์ให้ครบทั้ง 2 ตำแหน่ง' });
        return;
      }

      const { roles, userId } = req.user;
      // SEC-06: fails closed when the dept_head has no personnel profile.
      const deptHeadMajorId = (await resolveMajorScope(userId, roles)).majorId;

      // Fetch advisor major
      const advCheck = await query(
        `SELECT major_id FROM personnel p JOIN user_roles r ON p.personnel_id = r.user_id WHERE p.personnel_id = $1 AND r.role_name = 'advisor'`,
        [advisor_id]
      );
      if ((advCheck.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'ไม่พบข้อมูลอาจารย์ที่ปรึกษาที่เลือก หรือตำแหน่งไม่ถูกต้อง' });
        return;
      }
      const advisorMajorId = advCheck.rows[0].major_id;

      // Fetch supervisor major
      const supCheck = await query(
        `SELECT major_id FROM personnel p JOIN user_roles r ON p.personnel_id = r.user_id WHERE p.personnel_id = $1 AND r.role_name IN ('advisor', 'staff', 'dept_head')`,
        [supervisor_id]
      );
      if ((supCheck.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'ไม่พบข้อมูลอาจารย์นิเทศที่เลือก หรือตำแหน่งไม่ถูกต้อง' });
        return;
      }
      const supervisorMajorId = supCheck.rows[0].major_id;

      // Validate the whole batch BEFORE writing anything. The previous version
      // returned 403/400 from inside the write loop, so a rejected batch could
      // still leave the first N students reassigned.
      const targetIds: number[] = [];
      for (const id of studentIds) {
        const studentId = parseInt(String(id), 10);
        if (isNaN(studentId)) continue;

        const studentRes = await query('SELECT major_id FROM students WHERE student_id = $1', [studentId]);
        if ((studentRes.rowCount ?? 0) === 0) continue;
        const studentMajorId = studentRes.rows[0].major_id;

        // Dept Head Major Check
        if (deptHeadMajorId !== null && studentMajorId !== deptHeadMajorId) {
          res.status(403).json({ message: 'Forbidden. You can only assign personnel to students in your own major.' });
          return;
        }

        // Verify advisor and supervisor belong to student's major
        if (advisorMajorId !== studentMajorId || supervisorMajorId !== studentMajorId) {
          res.status(400).json({ message: 'อาจารย์ที่ปรึกษาและอาจารย์นิเทศต้องอยู่ในสาขาวิชาเดียวกันกับนักศึกษา' });
          return;
        }

        targetIds.push(studentId);
      }

      if (targetIds.length === 0) {
        res.status(400).json({ message: 'ไม่พบนักศึกษาที่สามารถมอบหมายได้' });
        return;
      }

      // Apply the whole batch atomically.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const studentId of targetIds) {
          await client.query(
            'UPDATE students SET advisor_id = $2, supervisor_id = $3 WHERE student_id = $1',
            [studentId, advisor_id, supervisor_id]
          );
          await StudentModel.transferOpenAppointments(client, studentId, supervisor_id);
        }
        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }

      // Notify only after the transaction is durable.
      for (const studentId of targetIds) {
        sendPersonnelAssignmentEmail(studentId, advisor_id, supervisor_id).catch(console.error);
      }

      res.status(200).json({
        message: `มอบหมายอาจารย์ที่ปรึกษาและอาจารย์นิเทศสำเร็จจำนวน ${targetIds.length} คน`,
        successCount: targetIds.length
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Batch Assign Personnel Error', 'An internal server error occurred while assigning personnel.');
    }
  }

  /**
   * System 3: Get existing Accommodation & Work Plan for student
   * Route: GET /api/students/:id/accommodation-plan
   */
  static async getAccommodationAndPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      // IDOR guard: students can only view their own data.
      // SEC-06: personnel are additionally scoped — this record holds the
      // student's residential address and emergency contacts, so "any advisor in
      // the university" was far too wide.
      const isPersonnel = req.user.roles.some((r: string) => ['staff', 'dean', 'advisor', 'dept_head'].includes(r));
      if (isPersonnel) {
        await assertCanReviewStudentWork(req.user.userId, req.user.roles, studentId);
      } else if (req.user.userId !== studentId) {
        res.status(403).json({ message: 'Forbidden.' });
        return;
      }

      const accRes = await query('SELECT * FROM accommodations WHERE student_id = $1', [studentId]);
      const plansRes = await query('SELECT * FROM weekly_work_plans WHERE student_id = $1 ORDER BY week_number ASC', [studentId]);
      // แผนปฏิบัติงานตัวจริงตามกระดาษ สหกิจ 07 หน้า 3 — เมทริกซ์ หัวข้องาน x เดือน
      // (โครงเก่า `monthly_work_plans` หนึ่งหัวข้อต่อหนึ่งเดือน ถูกถอดออกแล้ว — spec-D 16.2.1)
      const topicsRes = await query(
        'SELECT topic_id, seq, topic, months FROM work_plan_topics WHERE student_id = $1 ORDER BY seq ASC',
        [studentId]
      );
      const approvalsRes = await query(
        `SELECT a.approval_id, a.approver_role, a.approver_id, a.status, a.approved_at, a.comment,
                p.first_name as personnel_first_name, p.last_name as personnel_last_name,
                m.name as mentor_name
         FROM work_plan_approvals a
         LEFT JOIN personnel p ON a.approver_id = p.personnel_id
         LEFT JOIN mentors m ON a.approver_id = m.mentor_id
         WHERE a.student_id = $1
         ORDER BY a.approval_id ASC`,
        [studentId]
      );

      // Fetch company and job details from accepted intent_forms (สหกิจ 07 หน้า 1-2)
      const intentRes = await query(
        `SELECT i.start_date, i.end_date, i.mentor_id, i.company_id,
                c.name_th as company_name,
                m.name as mentor_name, m.position as mentor_position, m.phone as mentor_phone,
                COALESCE(i.start_date, i.acceptance_signed_date) as intent_created_at
         FROM intent_forms i
         JOIN companies c ON i.company_id = c.company_id
         LEFT JOIN mentors m ON i.mentor_id = m.mentor_id
         WHERE i.student_id = $1 AND i.status = 'accepted'
         ORDER BY i.form_id DESC LIMIT 1`,
        [studentId]
      );
      const intent = intentRes.rows[0] ?? null;

      // ⛔ ผู้ติดต่อฉุกเฉินอยู่บนโปรไฟล์นักศึกษาแล้ว ไม่ใช่บนแถวที่พัก (migration 013)
      //    — มันเป็นคุณสมบัติของคน และทั้ง สหกิจ 03 กับ 06 ถามช่องเดียวกัน
      const emgRes = await query(
        `SELECT emergency_contact_name, emergency_relationship, emergency_phone, emergency_address, section
           FROM students WHERE student_id = $1`,
        [studentId]
      );
      const emg = emgRes.rows[0] ?? {};

      const accRow = accRes.rowCount && accRes.rowCount > 0 ? accRes.rows[0] : null;

      res.status(200).json({
        section: emg.section ?? null,
        accommodation: accRow
          ? {
              ...accRow,
              formatted_address: formatAccommodationAddress(accRow),
              emergency_contact: emg.emergency_contact_name ?? null,
              emergency_relationship: emg.emergency_relationship ?? null,
              emergency_phone: emg.emergency_phone ?? null,
            }
          : null,
        company_job_info: intent
          ? {
              mentor_name: intent.mentor_name ?? null,
              mentor_position: intent.mentor_position ?? null,
              mentor_phone: intent.mentor_phone ?? null,
              company_name: intent.company_name ?? null,
              submitted_at: intent.intent_created_at ?? null,
            }
          : null,
        emergency_contact: {
          name: emg.emergency_contact_name ?? null,
          relationship: emg.emergency_relationship ?? null,
          phone: emg.emergency_phone ?? null,
          address: emg.emergency_address ?? null,
        },
        weekly_plans: plansRes.rows || [],
        // ⛔ ของจริงตามกระดาษ — เมทริกซ์หัวข้องาน x เดือน (โครงเก่า monthly_plans/
        //    months_count ถูกถอดออกแล้ว ไม่มีหน้าจอไหนอ่านอีก — spec-D 16.2.1)
        work_plan_topics: topicsRes.rows || [],
        approvals: approvalsRes.rows || [],
        // คอลัมน์เดือนของตาราง สหกิจ 07 หน้า 3 — ตัวเดียวกับที่ผู้ตรวจเห็นใน GET /:id/work-plan
        // ไม่มีวันที่ = [] (ห้ามเดาจำนวนเดือนให้)
        months: await StudentModel.placementMonths(studentId),
        intent: intent
          ? {
              start_date: intent.start_date,
              end_date: intent.end_date,
            }
          : null,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'getAccommodationAndPlan Error', 'Failed to retrieve accommodation and work plan');
    }
  }

  /**
   * System 3: Submit Accommodation & Work Plan
   * Route: POST /api/students/:id/accommodation-plan
   */
  static async submitAccommodationAndPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }

      const studentId = parseInt(req.params.id, 10);
      if (isNaN(studentId)) {
        res.status(400).json({ message: 'Invalid student ID format.' });
        return;
      }

      // IDOR Guard: students can only submit their own accommodation & plan
      if (req.user.roles.includes('student') && req.user.userId !== studentId) {
        res.status(403).json({ message: 'Forbidden. You can only submit accommodation and plans for yourself.' });
        return;
      }
      const { accommodation, weekly_plans, work_plan_topics, submit_to_mentor } = req.body;

      if (!accommodation || typeof accommodation !== 'object') {
        res.status(400).json({ message: 'กรุณากรอกข้อมูลที่พักระหว่างปฏิบัติงานให้ครบถ้วน' });
        return;
      }

      const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
      const missing = [
        ['บ้านเลขที่', text(accommodation.house_no)],
        ['ตำบล/แขวง', text(accommodation.subdistrict)],
        ['อำเภอ/เขต', text(accommodation.district)],
        ['จังหวัด', text(accommodation.province)],
        ['รหัสไปรษณีย์', text(accommodation.postal_code)],
      ]
        .filter(([, value]) => !value)
        .map(([label]) => label);

      if (missing.length > 0) {
        res.status(400).json({ message: `กรุณากรอกข้อมูลที่พักให้ครบ: ${missing.join(' · ')}` });
        return;
      }

      if (!/^\d{5}$/.test(text(accommodation.postal_code))) {
        res.status(400).json({ message: 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก' });
        return;
      }

      const hasCoords =
        accommodation.latitude !== undefined &&
        accommodation.latitude !== null &&
        accommodation.latitude !== '' &&
        accommodation.longitude !== undefined &&
        accommodation.longitude !== null &&
        accommodation.longitude !== '';
      if (hasCoords && !isValidCoordinate(accommodation.latitude, accommodation.longitude)) {
        res.status(400).json({ message: 'พิกัดที่พักไม่ถูกต้อง กรุณาปักหมุดใหม่บนแผนที่' });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Upsert accommodation
        const accQuery = `
          INSERT INTO accommodations (
            student_id, house_no, building, room_no, soi, road,
            subdistrict, district, province, postal_code,
            phone, mobile_phone, fax, email, latitude, longitude
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (student_id) DO UPDATE SET
            house_no = EXCLUDED.house_no,
            building = EXCLUDED.building,
            room_no = EXCLUDED.room_no,
            soi = EXCLUDED.soi,
            road = EXCLUDED.road,
            subdistrict = EXCLUDED.subdistrict,
            district = EXCLUDED.district,
            province = EXCLUDED.province,
            postal_code = EXCLUDED.postal_code,
            phone = EXCLUDED.phone,
            mobile_phone = EXCLUDED.mobile_phone,
            fax = EXCLUDED.fax,
            email = EXCLUDED.email,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude
        `;
        const optional = (v: unknown): string | null => text(v) || null;
        await client.query(accQuery, [
          studentId,
          text(accommodation.house_no),
          optional(accommodation.building),
          optional(accommodation.room_no),
          optional(accommodation.soi),
          optional(accommodation.road),
          text(accommodation.subdistrict),
          text(accommodation.district),
          text(accommodation.province),
          text(accommodation.postal_code),
          optional(accommodation.phone),
          optional(accommodation.mobile_phone),
          optional(accommodation.fax),
          optional(accommodation.email),
          hasCoords ? Number(accommodation.latitude) : null,
          hasCoords ? Number(accommodation.longitude) : null,
        ]);

        if (accommodation.section !== undefined) {
          await client.query(
            `UPDATE students SET section = $2 WHERE student_id = $1`,
            [studentId, optional(accommodation.section)]
          );
        }

        // แผนรายสัปดาห์ — วันของแต่ละสัปดาห์เซิร์ฟเวอร์คำนวณจากวันเริ่มของใบที่ตอบรับแล้ว
        //
        // ⛔ ไม่อ่าน start_date/end_date จากผู้เรียก: หน้าจอที่รีเมคแล้วส่งมาเป็นค่าว่าง ของเดิม
        //    **ลบแผนทั้งหมดก่อน** แล้วข้ามทุกแถวที่ไม่มีวัน → แผนที่พิมพ์หายเงียบ และแผนเก่าหายด้วย
        //    ทุกครั้งที่กดบันทึก · และวันที่ต้องมาจากเซิร์ฟเวอร์อยู่แล้ว (ห้ามคำนวณวันที่หน้าจอ)
        // ⛔ ยังไม่มีวันเริ่มจากสถานประกอบการ = ไม่แตะแผนเดิมเลย (ห้ามลบก่อนรู้ว่าจะเขียนได้)
        if (Array.isArray(weekly_plans) && weekly_plans.length > 0) {
          const startRes = await client.query(
            `SELECT start_date FROM intent_forms
             WHERE student_id = $1 AND status = 'accepted' AND start_date IS NOT NULL
             ORDER BY form_id DESC LIMIT 1`,
            [studentId]
          );
          if ((startRes.rowCount ?? 0) > 0) {
            await client.query('DELETE FROM weekly_work_plans WHERE student_id = $1', [studentId]);
            for (const plan of weekly_plans) {
              const week = parseInt(String(plan.week_number), 10);
              if (!Number.isInteger(week) || week < 1) continue;
              await client.query(
                `INSERT INTO weekly_work_plans (student_id, week_number, start_date, end_date, tasks, status)
                 SELECT $1, $2, i.start_date + 7 * ($2 - 1), i.start_date + 7 * ($2 - 1) + 6, $3, 'planned'
                 FROM intent_forms i
                 WHERE i.student_id = $1 AND i.status = 'accepted' AND i.start_date IS NOT NULL
                 ORDER BY i.form_id DESC LIMIT 1`,
                [studentId, week, typeof plan.tasks === 'string' ? plan.tasks : '']
              );
            }
          }
        }

        // แผนปฏิบัติงาน (สหกิจ 07 หน้า 3) — เมทริกซ์ หัวข้องาน x เดือน
        // work_plan_topics: [{ topic, months: [1,2] }] เท่านั้น (โครงเก่า monthly_plans
        // หนึ่งหัวข้อต่อเดือน ถูกถอดออกแล้ว — spec-D 16.2.1)
        const topicRows: { topic: string; months: number[] }[] = [];
        if (Array.isArray(work_plan_topics)) {
          for (const t of work_plan_topics) {
            const topic = String((t as { topic?: unknown }).topic ?? '').trim();
            if (!topic) continue;
            const months = Array.isArray((t as { months?: unknown }).months)
              ? ((t as { months: unknown[] }).months)
                  .map((m) => parseInt(String(m), 10))
                  .filter((m) => Number.isInteger(m) && m > 0)
              : [];
            topicRows.push({ topic, months: Array.from(new Set(months)).sort((a, b) => a - b) });
          }
        }

        if (topicRows.length > 0 || Array.isArray(work_plan_topics)) {
          // เขียนทับทั้งชุด — ตารางบนกระดาษเป็นใบเดียว ไม่ใช่การต่อแถวสะสม
          await client.query('DELETE FROM work_plan_topics WHERE student_id = $1', [studentId]);
          let seq = 1;
          for (const row of topicRows) {
            await client.query(
              `INSERT INTO work_plan_topics (student_id, seq, topic, months, updated_at)
               VALUES ($1, $2, $3, $4, NOW())`,
              [studentId, seq++, row.topic, row.months]
            );
          }
        }

        // Submit to mentor if requested
        if (submit_to_mentor === true) {
          const mentorRes = await client.query(
            `SELECT mentor_id FROM intent_forms WHERE student_id = $1 AND status = 'accepted' ORDER BY form_id DESC LIMIT 1`,
            [studentId]
          );
          const mentorId = mentorRes.rows[0]?.mentor_id ?? null;

          await client.query(
            `INSERT INTO work_plan_approvals (student_id, approver_role, approver_id, status, created_at)
             VALUES ($1, 'mentor', $2, 'pending', NOW())
             ON CONFLICT (student_id, approver_role)
             DO UPDATE SET status = 'pending', approver_id = EXCLUDED.approver_id, approved_at = NULL, comment = NULL`,
            [studentId, mentorId]
          );
        }

        await client.query('COMMIT');
        res.status(200).json({
          message: submit_to_mentor
            ? 'บันทึกและส่งแผนปฏิบัติงานให้พี่เลี้ยงรับรองสำเร็จแล้ว'
            : 'บันทึกข้อมูลที่พักสำเร็จ',
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      sendUnexpectedError(res, error, 'submitAccommodationAndPlan Error', 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง');
    }
  }

  /**
   * แผนปฏิบัติงานที่รอลงนาม — สำหรับพี่เลี้ยงและอาจารย์
   * Route: GET /api/students/:id/work-plan
   * Access: mentor (ของตัวเอง) · advisor/staff (ตามขอบเขตเดิม)
   *
   * ⛔ คอลัมน์เดือนคำนวณจากช่วงวันจริงเสมอ **ห้ามฮาร์ดโค้ด 4 เดือน** — ฝึก 1 พ.ย. ถึง
   *    20 มี.ค. คร่อม 5 เดือน ซึ่งเป็นเหตุผลที่ `work_plan_topics.months` เป็น INT[]
   *    ไม่ใช่คอลัมน์ month_1..month_4
   */
  static async getWorkPlanForReview(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = parseInt(req.params.id, 10);
      if (!Number.isInteger(studentId)) {
        res.status(400).json({ message: 'รหัสนักศึกษาไม่ถูกต้อง' });
        return;
      }

      const roles = req.user.roles;
      if (roles.includes('mentor')) {
        await assertMentorOwnsStudent(req.user.userId, studentId);
      } else {
        await assertCanReviewStudentWork(req.user.userId, roles, studentId);
      }

      const headRes = await query(
        `SELECT s.student_id, s.student_code,
                btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) AS full_name,
                mj.major_name_th, f.faculty_name_th, c.name_th AS company_name,
                i.start_date, i.end_date
           FROM students s
           LEFT JOIN master_major mj ON mj.major_id = s.major_id
           LEFT JOIN master_faculty f ON f.faculty_id = mj.faculty_id
           LEFT JOIN intent_forms i ON i.student_id = s.student_id AND i.status = 'accepted'
           LEFT JOIN companies c ON c.company_id = i.company_id
          WHERE s.student_id = $1`,
        [studentId]
      );
      if ((headRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบข้อมูลนักศึกษา' });
        return;
      }
      const head = headRes.rows[0];

      const [topicsRes, weeklyRes, approvalsRes] = await Promise.all([
        query('SELECT topic_id, seq, topic, months FROM work_plan_topics WHERE student_id = $1 ORDER BY seq', [studentId]),
        query('SELECT week_number, start_date, end_date, tasks FROM weekly_work_plans WHERE student_id = $1 ORDER BY week_number', [studentId]),
        query(
          `SELECT a.approver_role, a.status, a.approved_at, a.comment, a.created_at,
                  COALESCE(m.name, btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))) AS approver_name
             FROM work_plan_approvals a
             LEFT JOIN mentors m ON m.mentor_id = a.approver_id
             LEFT JOIN personnel p ON p.personnel_id = a.approver_id
            WHERE a.student_id = $1`,
          [studentId]
        ),
      ]);

      // เดือนปฏิทินที่คร่อม (ไม่ใช่ 30 วัน — กระดาษเขียน "เดือนที่ 1..N") · สูตรเดียวกับหน้านักศึกษา
      // (`getAccommodationAndPlan`) ผ่าน `StudentModel.placementMonths` — ห้ามคิดแยกที่นี่อีก
      const months = await StudentModel.placementMonths(studentId);

      const approvals: Record<string, unknown> = {};
      for (const row of approvalsRes.rows) approvals[row.approver_role] = row;

      res.status(200).json({
        student: {
          student_id: head.student_id,
          student_code: head.student_code,
          full_name: head.full_name,
          major_name_th: head.major_name_th,
          faculty_name_th: head.faculty_name_th,
          company_name: head.company_name,
          start_date: head.start_date ? new Date(head.start_date).toISOString().slice(0, 10) : null,
          end_date: head.end_date ? new Date(head.end_date).toISOString().slice(0, 10) : null,
        },
        // ⛔ ป้ายเดือนเป็นตัวเลขล้วน (year/month) หน้าจอเป็นคนแปลงเป็นชื่อเดือนไทย
        months,
        topics: topicsRes.rows,
        weekly: weeklyRes.rows.map((w) => ({
          ...w,
          start_date: w.start_date ? new Date(w.start_date).toISOString().slice(0, 10) : null,
          end_date: w.end_date ? new Date(w.end_date).toISOString().slice(0, 10) : null,
        })),
        // นักศึกษา "ลงนาม" ด้วยการกดส่งให้พี่เลี้ยง — ระบบไม่มีช่องลายเซ็นแยก
        // เวลาที่แถวคำรับรองของพี่เลี้ยงถูกสร้างจึงคือเวลาที่นักศึกษายืนยันแผน
        student_signed_at: approvals.mentor ? (approvals.mentor as { created_at: string }).created_at : null,
        approvals,
      });
    } catch (error) {
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Get work plan for review error', 'ไม่สามารถโหลดแผนปฏิบัติงานได้');
    }
  }

  /**
   * Approve work plan — พี่เลี้ยงเท่านั้น
   * Route: PATCH /api/students/:id/work-plan/approve
   *
   * ⛔ สหกิจ 07 หน้า 3 ลงนามสองฝ่ายคือนักศึกษา (กดส่ง) + พนักงานที่ปรึกษา แล้วส่งคืนงานสหกิจศึกษา
   *    อาจารย์ไม่มีช่องลงนาม — เดิมสร้างแถว advisor/supervisor `pending` ไว้โดยไม่มีปุ่มให้กด
   *    หน้านักศึกษาจึงขึ้น "รอตรวจ" ค้างถาวร (ถอดแล้ว 2026-09-22 · migration 034)
   */
  static async approveWorkPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = parseInt(req.params.id, 10);
      if (!Number.isInteger(studentId)) {
        res.status(400).json({ message: 'รหัสนักศึกษาไม่ถูกต้อง' });
        return;
      }

      // ⛔ SEC-06: ต้องตรวจว่านักศึกษาคนนี้เป็นของผู้เรียกจริง **ก่อน** เขียนอะไรลงฐาน
      //    ของเดิมรับ `:id` มาแล้วเขียนเลย แปลว่าพี่เลี้ยงคนไหนก็ได้ใส่รหัสนักศึกษา
      //    ของบริษัทอื่นแล้วลงนามรับรองแผนงานให้เขาได้ · หน้าจอไม่เคยมีปุ่มนั้น
      //    ซึ่งเป็นเหตุผลที่ไม่มีใครสังเกต แต่ URL มี
      await assertMentorOwnsStudent(req.user.userId, studentId);

      await query(
        `INSERT INTO work_plan_approvals (student_id, approver_role, approver_id, status, approved_at)
         VALUES ($1, 'mentor', $2, 'approved', NOW())
         ON CONFLICT (student_id, approver_role)
         DO UPDATE SET status = 'approved', approver_id = $2, approved_at = NOW(), comment = NULL`,
        [studentId, req.user.userId]
      );

      res.status(200).json({ success: true, message: 'รับรองแผนปฏิบัติงานเรียบร้อยแล้ว' });
    } catch (error) {
      // ด่านสิทธิ์โยน AccessDeniedError ซึ่งเป็น 403 ของผู้เรียก ไม่ใช่ระบบพัง
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Approve Work Plan Error', 'เกิดข้อผิดพลาดในการรับรองแผนงาน');
    }
  }

  /**
   * Reject / return work plan with comments
   * Route: PATCH /api/students/:id/work-plan/reject
   */
  static async rejectWorkPlan(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized.' });
        return;
      }
      const studentId = parseInt(req.params.id, 10);
      if (!Number.isInteger(studentId)) {
        res.status(400).json({ message: 'รหัสนักศึกษาไม่ถูกต้อง' });
        return;
      }
      const { comment } = req.body;

      // ⛔ SEC-06 เหมือนกับ approveWorkPlan ด้านบน — การตีกลับก็เป็นการเขียนสถานะ
      //    ลงแผนงานของคนอื่นได้เท่ากัน และยังทำให้แผนที่เขาลงนามไว้แล้วกลับเป็นร่าง
      await assertMentorOwnsStudent(req.user.userId, studentId);

      await query(
        `INSERT INTO work_plan_approvals (student_id, approver_role, approver_id, status, comment)
         VALUES ($1, 'mentor', $2, 'rejected', $3)
         ON CONFLICT (student_id, approver_role)
         DO UPDATE SET status = 'rejected', approver_id = $2, comment = $3`,
        [studentId, req.user.userId, comment || null]
      );

      res.status(200).json({ success: true, message: 'ส่งกลับแผนปฏิบัติงานให้แก้ไขเรียบร้อยแล้ว' });
    } catch (error) {
      // ด่านสิทธิ์โยน AccessDeniedError ซึ่งเป็น 403 ของผู้เรียก ไม่ใช่ระบบพัง
      if (sendAccessError(res, error)) return;
      sendUnexpectedError(res, error, 'Reject Work Plan Error', 'เกิดข้อผิดพลาดในการส่งกลับแผนงาน');
    }
  }
}
