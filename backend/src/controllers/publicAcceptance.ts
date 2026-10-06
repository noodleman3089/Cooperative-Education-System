import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import pool, { query } from '../config/database';
import { IntentFormModel } from '../models/intent';
import { AuditAction, writeAudit } from '../utils/audit';
import { validateAcceptanceInput } from '../utils/acceptanceInput';
import { buildAcceptanceFormPdf } from '../utils/acceptanceFormPdf';
import { notifyStudentStatusChange } from '../utils/email';
import { getErrorMessage, sendUnexpectedError } from '../utils/httpError';
import { semesterLabel } from '../utils/semesterLabel';

/**
 * ตอบรับ/ไม่รับนักศึกษาจากลิงก์ในอีเมล (เอกสารหมายเลข 2) — **ไม่ต้องเข้าสู่ระบบ**
 * บริษัทไม่มีบัญชี (เจ้าของตัดสิน 2026-09-29) · ลิงก์ออกโดย `IntentFormController.sendCoverLetterToCompany`
 *
 * กติกาที่ผิดไม่ได้ในไฟล์นี้:
 *   ⛔ ทุก endpoint ผ่าน `acceptanceTokenGate` ก่อน (ที่ router ก่อน multer) — token ไม่รู้จัก 404 ·
 *      ใช้แล้ว/ยกเลิก/หมดอายุ 410 · ใบไม่อยู่ขั้นรอตอบรับหรือหนังสือไม่ signed 410
 *   ⛔ payload ของ GET เป็น allow-list ชัดเจน (แนว SEC-10) — ไม่มีเกรด เลขบัตร ที่อยู่ ข้อมูล SEC-12
 *      และ **ไม่มีสหกิจ 03** (เป็นของช่วงประกอบแฟ้มประเมินหลังตอบรับ)
 *   ⛔ token ใช้ได้ครั้งเดียว — burn ด้วย UPDATE เดียวที่มีเงื่อนไขในทรานแซกชันเดียวกับคำตอบ
 *      (0 แถว = มีคำขออื่นชนะก่อน = 410) · ตอบไม่สำเร็จ = rollback = token ยังใช้ได้
 *   ⛔ "ไม่รับ" มีผลทันที ไม่ผ่านเจ้าหน้าที่ · "รับ" ไปคิวเจ้าหน้าที่ (`pending_officer_approval`)
 *   ⛔ **ไม่มีสหกิจ 07 บนลิงก์แล้ว (เจ้าของสั่งตัด 2026-10-05)** — ลิงก์ไม่รับข้อมูลบริษัท/ตำแหน่งงาน/พี่เลี้ยง
 *      และ **ไม่เขียน `companies` เลย** (ลิงก์ไปถึงอีเมลที่นักศึกษาพิมพ์ ใครถือลิงก์ก็ไม่ควรแก้ทะเบียนได้)
 *      · พี่เลี้ยงนักศึกษาระบุเองทีหลัง `POST /intents/:id/mentor` แล้วเจ้าหน้าที่ตรวจก่อนกดรับ
 *   ⛔ ทุกการกระทำลง `audit_log` พร้อม `token_id` (ห้ามเก็บ token) เพราะไม่มีผู้ใช้ที่ล็อกอินให้ตามย้อน
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLOSED_MESSAGE =
  'เรื่องนี้ดำเนินการไปแล้ว หรืออยู่ในขั้นตอนอื่นแล้ว จึงตอบผ่านลิงก์นี้ไม่ได้ หากต้องการแก้ไข กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษาของคณะ';

/** สิ่งที่ด่าน token หาเจอ — เก็บใน `res.locals.acceptanceLink` ให้ทุก endpoint ใช้ต่อ */
interface LinkGate {
  token_id: number;
  form_id: number;
  student_id: number;
  company_id: number;
  semester_id: number;
  expires_at: Date;
  cover_letter_path: string;
}

const gateOf = (res: Response): LinkGate => res.locals.acceptanceLink as LinkGate;

/**
 * ด่านลิงก์ — ใช้กับทุก endpoint ก่อนอย่างอื่น (รวมก่อน multer ที่ router)
 * คำขอที่ไม่ผ่านต้องไม่เขียนไฟล์ลงดิสก์ และต้องไม่รู้ว่าใบนั้นมีอยู่จริงหรือไม่ นอกจาก token ถูกต้อง
 */
export async function acceptanceTokenGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = typeof req.query.token === 'string' ? req.query.token : '';
    if (!UUID_REGEX.test(raw)) {
      res.status(404).json({ message: 'ไม่พบลิงก์นี้ในระบบ กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษาของคณะ' });
      return;
    }

    // ตรวจหนังสือด้วย LATERAL เดียวกับ sendCoverLetterToCompany — ห้ามอ่านจากที่อื่นให้เกิดแหล่งความจริงที่สอง
    const found = await query(
      `SELECT t.token_id, t.form_id, t.expires_at, t.used_at, t.revoked_at,
              (t.expires_at <= NOW()) AS is_expired,
              i.student_id, i.company_id, i.semester_id, i.status,
              doc.status AS cover_letter_status, doc.generated_file_path AS cover_letter_path
         FROM acceptance_link_tokens t
         JOIN intent_forms i ON i.form_id = t.form_id
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
        WHERE t.token = $1`,
      [raw]
    );
    if ((found.rowCount ?? 0) === 0) {
      res.status(404).json({ message: 'ไม่พบลิงก์นี้ในระบบ กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษาของคณะ' });
      return;
    }

    const row = found.rows[0];
    // `code` ให้หน้าจอเลือกข้อความ/ไอคอนได้โดยไม่ต้องแกะข้อความไทย
    if (row.used_at) {
      res.status(410).json({ code: 'used', message: 'ลิงก์นี้ถูกใช้ตอบไปแล้ว หากต้องการแก้ไขคำตอบ กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษาของคณะ' });
      return;
    }
    if (row.revoked_at) {
      res.status(410).json({
        code: 'revoked',
        message: 'ลิงก์นี้ถูกยกเลิกแล้ว เพราะนักศึกษาส่งหนังสือฉบับใหม่ให้ท่าน กรุณาใช้ลิงก์ในอีเมลฉบับล่าสุด',
      });
      return;
    }
    if (row.is_expired) {
      res.status(410).json({
        code: 'expired',
        message: 'ลิงก์นี้หมดอายุแล้ว กรุณาติดต่อนักศึกษาให้ส่งหนังสือให้ท่านอีกครั้ง หรือติดต่องานสหกิจศึกษาของคณะ',
      });
      return;
    }
    if (row.status !== 'approved_by_dept_head' || row.cover_letter_status !== 'signed' || !row.cover_letter_path) {
      res.status(410).json({ code: 'closed', message: CLOSED_MESSAGE });
      return;
    }

    res.locals.acceptanceLink = {
      token_id: row.token_id,
      form_id: row.form_id,
      student_id: row.student_id,
      company_id: row.company_id,
      semester_id: row.semester_id,
      expires_at: row.expires_at,
      cover_letter_path: row.cover_letter_path,
    } satisfies LinkGate;
    next();
  } catch (error) {
    sendUnexpectedError(res, error, 'Public acceptance gate error', 'ไม่สามารถตรวจสอบลิงก์ได้');
  }
}

export class PublicAcceptanceController {
  /**
   * ข้อมูลหน้าลิงก์ — **ไม่เผา token** (โหลดหน้า กรอก แล้วค่อยกดส่ง · รีเฟรชระหว่างกรอกเป็นเรื่องปกติ)
   * Route: GET /api/public/acceptance?token=...
   */
  static async getInfo(_req: Request, res: Response): Promise<void> {
    try {
      const gate = gateOf(res);

      const studentRes = await query(
        `SELECT s.first_name, s.last_name, s.student_code, s.resume_file,
                mj.major_name_th, f.faculty_name_th, u.email,
                sem.semester, sem.academic_year
           FROM students s
           JOIN users u          ON u.user_id = s.student_id
           JOIN master_major mj  ON mj.major_id = s.major_id
           JOIN master_faculty f ON f.faculty_id = mj.faculty_id
           JOIN coop_semesters sem ON sem.semester_id = $2
          WHERE s.student_id = $1`,
        [gate.student_id, gate.semester_id]
      );
      const companyRes = await query(
        `SELECT name_th FROM companies WHERE company_id = $1`,
        [gate.company_id]
      );
      if ((studentRes.rowCount ?? 0) === 0 || (companyRes.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบข้อมูลของคำร้องนี้ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา' });
        return;
      }
      const s = studentRes.rows[0];
      const c = companyRes.rows[0];

      // allow-list ชัดเจน ทีละคีย์ — ⛔ ห้ามส่ง `s` หรือ `c` ทั้งแถวออกไป และห้ามเพิ่มคีย์โดยไม่ถามว่า
      // "กระดาษใบไหนให้บริษัทเห็นสิ่งนี้" (เกรด · เลขบัตร · ที่อยู่นักศึกษา · SEC-12 ห้ามอยู่ที่นี่เด็ดขาด)
      res.status(200).json({
        student: {
          full_name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
          student_code: s.student_code,
          major_name_th: s.major_name_th,
          faculty_name_th: s.faculty_name_th,
          semester_label: semesterLabel(s.semester, s.academic_year),
          email: s.email,
        },
        has_resume: !!s.resume_file,
        company: {
          name_th: c.name_th,
        },
        token_expires_at: new Date(gate.expires_at).toISOString(),
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Public acceptance read error', 'ไม่สามารถเปิดหน้าตอบรับได้');
    }
  }

  /**
   * หนังสือขอความอนุเคราะห์ที่คณบดีลงนามแล้ว (ฉบับเดียวกับที่แนบในอีเมล)
   * Route: GET /api/public/acceptance/cover-letter?token=...
   */
  static async getCoverLetter(_req: Request, res: Response): Promise<void> {
    try {
      const filePath = path.resolve(process.cwd(), gateOf(res).cover_letter_path);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ message: 'ไม่พบไฟล์หนังสือขอความอนุเคราะห์ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา' });
        return;
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="cover-letter-signed.pdf"');
      res.sendFile(filePath);
    } catch (error) {
      sendUnexpectedError(res, error, 'Public acceptance cover letter error', 'ไม่สามารถเปิดหนังสือได้');
    }
  }

  /**
   * แบบตอบรับ (เอกสารหมายเลข 2) วาดสดจากข้อมูลใบ — ช่องเลขหนังสือส่งตัวเว้นว่าง (ยังไม่ออก)
   * Route: GET /api/public/acceptance/acceptance-form?token=...
   */
  static async getAcceptanceForm(_req: Request, res: Response): Promise<void> {
    try {
      const gate = gateOf(res);
      const result = await query(
        `SELECT s.first_name, s.last_name, mj.major_name_th, f.faculty_name_th, c.name_th AS company_name
           FROM students s
           JOIN master_major mj  ON mj.major_id = s.major_id
           JOIN master_faculty f ON f.faculty_id = mj.faculty_id
           JOIN companies c      ON c.company_id = $2
          WHERE s.student_id = $1`,
        [gate.student_id, gate.company_id]
      );
      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ message: 'ไม่พบข้อมูลของคำร้องนี้ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา' });
        return;
      }
      const row = result.rows[0];

      const pdf = await buildAcceptanceFormPdf({
        faculty_name_th: row.faculty_name_th,
        company_name: row.company_name,
        first_name: row.first_name,
        last_name: row.last_name,
        major_name_th: row.major_name_th,
        dispatch_document_no: null,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="acceptance-form-${gate.form_id}.pdf"`);
      res.status(200).send(pdf);
    } catch (error) {
      sendUnexpectedError(res, error, 'Public acceptance form error', 'ไม่สามารถสร้างแบบตอบรับได้');
    }
  }

  /**
   * Resume ของนักศึกษา (ถ้ามี) — 404 ถ้าไม่มี
   * Route: GET /api/public/acceptance/resume?token=...
   */
  static async getResume(_req: Request, res: Response): Promise<void> {
    try {
      const result = await query(`SELECT resume_file FROM students WHERE student_id = $1`, [gateOf(res).student_id]);
      const resumeFile: string | null = result.rows[0]?.resume_file ?? null;
      if (!resumeFile) {
        res.status(404).json({ message: 'นักศึกษายังไม่ได้แนบ Resume' });
        return;
      }
      // `resume_file` เก็บเป็น `resumes/<ชื่อไฟล์>` — เปิดจากโฟลเดอร์ resumes เท่านั้นด้วยชื่อไฟล์ล้วน
      const filePath = path.join(process.cwd(), 'uploads', 'resumes', path.basename(resumeFile));
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ message: 'ไม่พบไฟล์ Resume' });
        return;
      }
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
      res.sendFile(filePath);
    } catch (error) {
      sendUnexpectedError(res, error, 'Public acceptance resume error', 'ไม่สามารถเปิด Resume ได้');
    }
  }

  /**
   * สถานประกอบการไม่รับ — มีผลทันที ไม่ผ่านเจ้าหน้าที่ (D2)
   * Route: POST /api/public/acceptance/decline?token=...
   */
  static async decline(req: Request, res: Response): Promise<void> {
    const gate = gateOf(res);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) {
      res.status(400).json({ message: 'กรุณาระบุเหตุผลที่ไม่รับนักศึกษาเข้าปฏิบัติงาน เพื่อให้นักศึกษาทราบและหาที่ฝึกงานใหม่ได้' });
      return;
    }
    if (reason.length > 1000) {
      res.status(400).json({ message: 'เหตุผลยาวเกินไป (ไม่เกิน 1,000 ตัวอักษร)' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ล็อกใบก่อน แล้วเช็คสถานะซ้ำใต้ล็อก — ระหว่างด่านกับตรงนี้ใบอาจถูกกดไปทางอื่น
      const locked = await client.query(`SELECT status FROM intent_forms WHERE form_id = $1 FOR UPDATE`, [gate.form_id]);
      if (locked.rows[0]?.status !== 'approved_by_dept_head') {
        await client.query('ROLLBACK');
        res.status(410).json({ code: 'closed', message: CLOSED_MESSAGE });
        return;
      }
      if (!(await burnToken(client, gate.token_id))) {
        await client.query('ROLLBACK');
        res.status(410).json({ code: 'used', message: 'ลิงก์นี้ถูกใช้ไปแล้ว ถูกยกเลิก หรือหมดอายุแล้ว กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษาของคณะ' });
        return;
      }

      await IntentFormModel.rejectByCompanyWithClient(client, gate.form_id, reason, ['approved_by_dept_head']);

      await writeAudit(
        {
          action: AuditAction.INTENT_DECLINED_VIA_LINK,
          entityType: 'intent_form',
          entityId: gate.form_id,
          subjectId: gate.student_id,
          detail: { token_id: gate.token_id },
        },
        req,
        client
      );

      await client.query('COMMIT');

      notifyStudentStatusChange(gate.form_id, 'company_rejected', reason).catch(console.error);

      res.status(200).json({ message: 'บันทึกคำตอบว่าไม่รับนักศึกษาเรียบร้อยแล้ว ระบบแจ้งนักศึกษาให้ทราบแล้ว ขอบคุณที่ให้ความอนุเคราะห์' });
    } catch (error) {
      await client.query('ROLLBACK').catch(console.error);
      sendUnexpectedError(res, error, 'Public acceptance decline error', 'ไม่สามารถบันทึกคำตอบได้');
    } finally {
      client.release();
    }
  }

  /**
   * สถานประกอบการตอบรับ — แนบเอกสารหมายเลข 2 ที่ลงนามแล้ว + สหกิจ 07 → ไปคิวเจ้าหน้าที่
   * Route: POST /api/public/acceptance/accept?token=...  (multipart)
   * ลำดับที่ router: tokenGate → requireCalendarWindow('acceptance_form') → multer → validateUploadedFile
   * ⛔ ล้มหลัง multer ที่ไหนก็ตามต้องลบไฟล์ที่เพิ่งเขียนทิ้งเสมอ
   */
  static async accept(req: Request, res: Response): Promise<void> {
    const gate = gateOf(res);
    const file = req.file;
    const discardFile = () => {
      if (file) {
        fs.promises.unlink(file.path).catch((e) => console.error('[Public acceptance] cannot remove rejected upload:', e));
      }
    };
    const reject = (status: number, body: Record<string, unknown>) => {
      discardFile();
      res.status(status).json(body);
    };

    let client: PoolClient | null = null;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

      const startDate = str(body.start_date);
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        return reject(400, { message: 'รูปแบบวันเริ่มปฏิบัติงานไม่ถูกต้อง' });
      }

      // ด่านตรวจร่วมกับทางนักศึกษาอัปโหลดเอง (utils/acceptanceInput.ts) — ไม่มีสำเนาตรรกะที่นี่
      // ⛔ ไม่ส่ง `mentor` = ไม่ถามพี่เลี้ยงบนลิงก์ (ตัด สหกิจ 07 ฝั่งบริษัท 2026-10-05) · นักศึกษาระบุทีหลัง
      const input = await validateAcceptanceInput(
        gate.form_id,
        { hasFile: !!file, start_date: startDate, signer: body },
        {
          noFile: 'กรุณาแนบไฟล์แบบตอบรับ (เอกสารหมายเลข ๒) ที่ลงนามและประทับตราแล้ว',
          requiredFields: 'กรุณาระบุวันเริ่มปฏิบัติงาน',
          badEmail: '',
          badStartDate: 'รูปแบบวันเริ่มปฏิบัติงานไม่ถูกต้อง',
        }
      );
      if (!input.ok) return reject(input.status, { message: input.message });

      client = await pool.connect();
      await client.query('BEGIN');

      const locked = await client.query(`SELECT status FROM intent_forms WHERE form_id = $1 FOR UPDATE`, [gate.form_id]);
      if (locked.rows[0]?.status !== 'approved_by_dept_head') {
        await client.query('ROLLBACK');
        return reject(410, { code: 'closed', message: CLOSED_MESSAGE });
      }
      if (!(await burnToken(client, gate.token_id))) {
        await client.query('ROLLBACK');
        return reject(410, { code: 'used', message: 'ลิงก์นี้ถูกใช้ไปแล้ว ถูกยกเลิก หรือหมดอายุแล้ว กรุณาติดต่อนักศึกษาหรืองานสหกิจศึกษาของคณะ' });
      }

      await IntentFormModel.acceptWithClient(client, {
        intentId: gate.form_id,
        source: 'link',
        startDate,
        evidencePath: `acceptance_evidence/${file!.filename}`,
        submittedLate: input.submittedLate,
        signer: input.signer,
      });

      await writeAudit(
        {
          action: AuditAction.INTENT_ACCEPTED_VIA_LINK,
          entityType: 'intent_form',
          entityId: gate.form_id,
          subjectId: gate.student_id,
          detail: { token_id: gate.token_id },
        },
        req,
        client
      );

      await client.query('COMMIT');

      notifyStudentStatusChange(gate.form_id, 'pending_officer_approval').catch(console.error);

      res.status(200).json({
        message: 'ส่งแบบตอบรับเรียบร้อยแล้ว ขอบคุณที่ให้ความอนุเคราะห์ เจ้าหน้าที่คณะจะตรวจสอบและแจ้งนักศึกษาต่อไป',
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(console.error);
      discardFile();
      // ข้อความจาก model คือกติกา SEC-03 (อีเมลพี่เลี้ยงซ้ำกับนักศึกษา · เป็นบัญชีอื่น · เป็นของบริษัทอื่น) → 400
      // error ของฐานข้อมูล (ความยาว/รูปแบบ) ผ่าน sendUnexpectedError เพื่อไม่ปล่อยข้อความดิบของ pg ออกไป
      if ((error as { code?: string } | undefined)?.code) {
        sendUnexpectedError(res, error, 'Public acceptance accept error', 'ไม่สามารถบันทึกคำตอบรับได้');
      } else {
        console.error('Public acceptance accept error:', error);
        res.status(400).json({ message: getErrorMessage(error, 'ไม่สามารถบันทึกคำตอบรับได้') });
      }
    } finally {
      client?.release();
    }
  }
}

/** เผา token — 0 แถว = ถูกใช้/ยกเลิก/หมดอายุไปแล้วระหว่างทาง (มีคำขออื่นชนะก่อน) */
async function burnToken(client: PoolClient, tokenId: number): Promise<boolean> {
  const burned = await client.query(
    `UPDATE acceptance_link_tokens SET used_at = NOW()
      WHERE token_id = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
      RETURNING token_id`,
    [tokenId]
  );
  return (burned.rowCount ?? 0) > 0;
}
