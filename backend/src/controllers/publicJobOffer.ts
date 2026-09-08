import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { COMPANY_WRITABLE_FIELDS, JobOfferModel } from '../models/jobOffer';
import { writeAudit } from '../utils/audit';
import { sendJobOfferSurveyEmail } from '../utils/email';
import { getErrorMessage, sendUnexpectedError } from '../utils/httpError';
import {
  JOB_OFFER_RESEND_COOLDOWN_MS,
  JOB_OFFER_TOKEN_TTL_LABEL,
  createJobOfferToken,
} from '../utils/jobOfferToken';

/**
 * ตอบแบบเสนองานสหกิจศึกษา (สหกิจ 02) จากลิงก์ในอีเมล — **ไม่ต้องเข้าสู่ระบบ**
 *
 * ของจริงคนที่ตอบคือฝ่ายบุคคล ซึ่งมักไม่มีบัญชีและไม่อยากมี การบังคับให้สมัคร
 * ก่อนตอบคือเหตุผลที่แบบสำรวจกระดาษยังชนะแบบออนไลน์อยู่ทุกวันนี้
 *
 * กติกาที่ผิดไม่ได้ในไฟล์นี้:
 *   ⛔ ไม่มีข้อมูลนักศึกษาในทุก response ของไฟล์นี้ — ใบสำรวจเป็นเรื่องของบริษัทล้วน
 *   ⛔ ไม่สร้าง session และไม่แตะคุกกี้ · token ให้สิทธิ์เฉพาะใบที่ผูกไว้ใบเดียว
 *   ⛔ token ใช้ตอบได้ **ครั้งเดียว** — เผาทิ้งในทรานแซกชันเดียวกับการเขียนคำตอบ
 *   ⛔ ขอลิงก์ใหม่ ส่งไปที่อีเมลใน**ทะเบียน**เท่านั้น ห้ามรับอีเมลปลายทางจากคำขอ
 *   ⛔ ระบบไม่ต่ออายุ token ให้เองเงียบ ๆ หมดอายุแล้วต้องมีคนกดขอใหม่
 *   ⛔ ทุกการกระทำลง `audit_log` เพราะไม่มีผู้ใช้ที่ล็อกอินให้ตามย้อนได้เลย
 */
export class PublicJobOfferController {
  /**
   * เปิดใบสำรวจจากลิงก์
   * Route: GET /api/public/job-offer?token=...
   * Access: สาธารณะ (token)
   *
   * การเปิดอ่าน **ไม่เผา token** — ผู้ใช้ต้องโหลดหน้า กรอก แล้วค่อยกดส่ง
   * และรีเฟรชหน้าระหว่างกรอกเป็นเรื่องปกติ · สิ่งที่ใช้ได้ครั้งเดียวคือ "การตอบ"
   */
  static async getOffer(req: Request, res: Response): Promise<void> {
    try {
      const token = await resolveToken(req, res);
      if (!token) return;

      const [company, majors, semester, dates, items, previous] = await Promise.all([
        fetchCompanyPublic(token.company_id),
        query(`SELECT major_id, major_name_th FROM master_major ORDER BY major_name_th`),
        fetchSemesterLabel(token.offer_id),
        fetchDueDateFacts(token.offer_id),
        JobOfferModel.listItems(token.offer_id),
        (async () => {
          const offer = await JobOfferModel.findById(token.offer_id);
          return offer
            ? JobOfferModel.findPreviousAnswered(offer.company_id, offer.semester_id)
            : null;
        })(),
      ]);

      const offer = await JobOfferModel.findById(token.offer_id);

      writeAudit(
        {
          action: 'job_offer.token_opened',
          entityType: 'coop_job_offer',
          entityId: token.offer_id,
          detail: { company_id: token.company_id },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        semester,
        offer: offer ? { ...offer, ...dates } : null,
        company,
        items,
        previous: previous
          ? {
              offer_id: previous.offer_id,
              semester_label: `ภาคเรียนที่ ${previous.semester}/${previous.academic_year}`,
              item_count: previous.item_count,
              quota_total: previous.quota_total,
              accepted_count: previous.accepted_count,
            }
          : null,
        majors: majors.rows,
        token_expires_at: token.expires_at,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Public job offer read error', 'ไม่สามารถเปิดแบบเสนองานได้');
    }
  }

  /**
   * ตอบแบบสำรวจแล้วส่งกลับ (เผา token ทิ้งในทรานแซกชันเดียวกัน)
   * Route: PUT /api/public/job-offer?token=...
   */
  static async submitOffer(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const token = await resolveToken(req, res);
      if (!token) return;

      const offer = await JobOfferModel.findById(token.offer_id);
      if (!offer) {
        res.status(404).json({ message: 'ไม่พบแบบเสนองานฉบับนี้' });
        return;
      }
      if (offer.status === 'reviewed') {
        res.status(409).json({
          message: 'แบบเสนองานฉบับนี้ถูกตรวจและเปิดให้นักศึกษาเห็นแล้ว หากต้องการแก้ไข กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา',
        });
        return;
      }

      const body = req.body ?? {};
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        res.status(400).json({
          message: 'ยังไม่มีรายการตำแหน่งในแบบเสนองาน — เพิ่มอย่างน้อยหนึ่งตำแหน่งก่อนส่ง หรือเลือก “ภาคเรียนนี้ยังไม่รับนักศึกษา”',
        });
        return;
      }
      const informantName = typeof body.offer?.informant_name === 'string'
        ? body.offer.informant_name.trim()
        : '';
      if (!informantName) {
        res.status(400).json({ message: 'กรุณาระบุชื่อผู้ให้ข้อมูลก่อนส่งแบบเสนองาน' });
        return;
      }

      await client.query('BEGIN');

      // ข้อมูลบริษัท — allow-list ชุดเดียวกับเส้นที่ต้องล็อกอิน
      // ⛔ ชื่อและที่อยู่แก้ไม่ได้ เพราะเป็นค่าที่เจ้าหน้าที่รับรองและถูกพิมพ์ลงหนังสือราชการ
      if (body.company && typeof body.company === 'object') {
        const sets: string[] = [];
        const values: unknown[] = [];
        for (const field of COMPANY_WRITABLE_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(body.company, field)) {
            const raw = body.company[field];
            values.push(raw === '' ? null : raw);
            sets.push(`${field} = $${values.length}`);
          }
        }
        if (sets.length > 0) {
          values.push(token.company_id);
          await client.query(
            `UPDATE companies SET ${sets.join(', ')} WHERE company_id = $${values.length}`,
            values
          );
        }
      }

      // ⛔ `submitted_by` เป็น NULL โดยตั้งใจ — ไม่มีผู้ใช้ที่ล็อกอิน การยัด user_id
      //    ของใครลงไปคือการบอกว่ามีคนกดทั้งที่ไม่มี · หลักฐานว่าใครตอบอยู่ที่
      //    ชื่อผู้ให้ข้อมูลบนใบ และที่ audit_log
      await client.query(
        `UPDATE coop_job_offers
            SET informant_name = $2,
                informant_position = $3,
                status = 'submitted',
                submitted_at = NOW(),
                decline_reason = NULL,
                updated_at = NOW()
          WHERE offer_id = $1`,
        [
          offer.offer_id,
          informantName,
          typeof body.offer?.informant_position === 'string' && body.offer.informant_position.trim()
            ? body.offer.informant_position.trim()
            : null,
        ]
      );

      // `job_posts.created_by` เป็น NOT NULL และไม่มีผู้ใช้ที่ล็อกอินในเส้นนี้
      // จึงลงชื่อบัญชีเจ้าของทะเบียนบริษัทนั้นแทน ซึ่งเป็นความจริงที่ใกล้ที่สุด —
      // รายการนี้เป็นของบริษัทนั้นจริง ๆ · ส่วน "ใครกดส่ง" อยู่ที่ชื่อผู้ให้ข้อมูล
      // บนใบและที่ audit_log ไม่ใช่ที่คอลัมน์นี้
      const ownerRes = await client.query(
        `SELECT created_by FROM companies WHERE company_id = $1`,
        [token.company_id]
      );
      const ownerId = ownerRes.rows[0]?.created_by as number | undefined;
      if (!ownerId) {
        throw new Error('ทะเบียนสถานประกอบการนี้ไม่มีบัญชีเจ้าของ กรุณาติดต่อเจ้าหน้าที่');
      }

      await JobOfferModel.replaceItems(client, offer, items, ownerId);
      await JobOfferModel.burnToken(client, token.token_id);
      await client.query('COMMIT');

      writeAudit(
        {
          action: 'job_offer.token_submitted',
          entityType: 'coop_job_offer',
          entityId: offer.offer_id,
          detail: { company_id: token.company_id, item_count: items.length, informant: informantName },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: 'ส่งแบบเสนองานสหกิจศึกษา (สหกิจ 02) เรียบร้อยแล้ว ขอบคุณที่ให้ความอนุเคราะห์',
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message = getErrorMessage(error, '');
      if (message.includes('ลบตำแหน่ง') || message.includes('ไม่ได้อยู่ในแบบเสนองาน')) {
        res.status(409).json({ message });
        return;
      }
      sendUnexpectedError(res, error, 'Public job offer submit error', 'ไม่สามารถส่งแบบเสนองานได้');
    } finally {
      client.release();
    }
  }

  /**
   * ตอบว่าภาคเรียนนี้ยังไม่รับนักศึกษา (เผา token เช่นกัน)
   * Route: POST /api/public/job-offer/decline?token=...
   */
  static async declineOffer(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const token = await resolveToken(req, res);
      if (!token) return;

      if (token.offer_status === 'reviewed') {
        res.status(409).json({
          message: 'แบบเสนองานฉบับนี้ถูกตรวจและเปิดให้นักศึกษาเห็นแล้ว กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา',
        });
        return;
      }

      const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : null;

      await client.query('BEGIN');
      await client.query(
        `UPDATE coop_job_offers
            SET status = 'declined', decline_reason = $2, submitted_at = NOW(), updated_at = NOW()
          WHERE offer_id = $1`,
        [token.offer_id, reason]
      );
      await client.query(
        `UPDATE job_posts SET status = 'closed'
          WHERE offer_id = $1 AND status IN ('pending_approval', 'published')`,
        [token.offer_id]
      );
      await JobOfferModel.burnToken(client, token.token_id);
      await client.query('COMMIT');

      writeAudit(
        {
          action: 'job_offer.token_declined',
          entityType: 'coop_job_offer',
          entityId: token.offer_id,
          detail: { company_id: token.company_id, reason },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: 'บันทึกคำตอบว่าภาคเรียนนี้ยังไม่รับนักศึกษาเรียบร้อยแล้ว คณะจะติดต่อกลับมาอีกครั้งในภาคเรียนถัดไป',
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      sendUnexpectedError(res, error, 'Public job offer decline error', 'ไม่สามารถบันทึกคำตอบได้');
    } finally {
      client.release();
    }
  }

  /**
   * ขอลิงก์ใหม่เมื่อลิงก์เดิมหมดอายุหรือถูกใช้ไปแล้ว
   * Route: POST /api/public/job-offer/resend?token=...
   *
   * ⛔ รับ token เดิมที่หมดอายุ/ถูกใช้แล้วได้ (นั่นคือทั้งหมดของฟีเจอร์นี้)
   *    แต่ token ที่ไม่มีอยู่จริงต้องปฏิเสธ ไม่งั้นกลายเป็นปุ่มยิงเมลให้ใครก็ได้
   * ⛔ ปลายทางมาจากทะเบียนเสมอ — คำขอไม่มีสิทธิ์บอกว่าจะส่งไปที่ไหน
   */
  static async resendLink(req: Request, res: Response): Promise<void> {
    try {
      const raw = typeof req.query.token === 'string' ? req.query.token : '';
      if (!raw) {
        res.status(400).json({ message: 'ลิงก์ไม่ถูกต้อง กรุณาเปิดจากอีเมลที่ได้รับ' });
        return;
      }
      const token = await JobOfferModel.findToken(raw);
      if (!token) {
        res.status(404).json({ message: 'ไม่พบลิงก์นี้ในระบบ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา' });
        return;
      }

      const lastIssued = await JobOfferModel.lastTokenIssuedAt(token.offer_id);
      if (lastIssued && Date.now() - lastIssued.getTime() < JOB_OFFER_RESEND_COOLDOWN_MS) {
        const waitMinutes = Math.ceil(
          (JOB_OFFER_RESEND_COOLDOWN_MS - (Date.now() - lastIssued.getTime())) / 60000
        );
        res.status(429).json({
          message: `เพิ่งส่งลิงก์ใหม่ไปเมื่อสักครู่ กรุณารออีก ${waitMinutes} นาทีแล้วลองใหม่ (ตรวจกล่องจดหมายขยะด้วย)`,
        });
        return;
      }

      const email = await JobOfferModel.contactEmail(token.company_id);
      const headline = await JobOfferModel.offerHeadline(token.offer_id);
      if (!email || !headline) {
        res.status(400).json({
          message: 'ยังไม่มีอีเมลผู้ประสานงานในทะเบียนของมหาวิทยาลัย กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษาโดยตรง',
        });
        return;
      }

      const issued = await createJobOfferToken(token.offer_id, null);
      await sendJobOfferSurveyEmail(email, issued.url, {
        companyName: headline.companyName,
        semesterLabel: headline.semesterLabel,
        dueDate: headline.dueDate,
      });

      writeAudit(
        {
          action: 'job_offer.token_resent',
          entityType: 'coop_job_offer',
          entityId: token.offer_id,
          detail: { company_id: token.company_id, sent_to: email },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: `ส่งลิงก์ใหม่ไปที่อีเมลผู้ประสานงานในทะเบียนแล้ว ลิงก์ใหม่ใช้ได้ ${JOB_OFFER_TOKEN_TTL_LABEL}`,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Public job offer resend error', 'ไม่สามารถส่งลิงก์ใหม่ได้');
    }
  }
}

/* ── ตัวช่วยของไฟล์นี้ ─────────────────────────────────────────────── */

/**
 * ตรวจ token แล้วคืนแถวที่ยังใช้ได้ — ไม่ผ่านตอบเองแล้วคืน `null`
 *
 * ใช้ **410 Gone** สำหรับหมดอายุ/ถูกใช้แล้ว ไม่ใช่ 404 หรือ 401 โดยตั้งใจ:
 * หน้าจอต้องแยกให้ออกระหว่าง "ลิงก์นี้เคยมีจริงแต่หมดเวลาแล้ว" (มีปุ่มขอใหม่ให้กด)
 * กับ "ลิงก์นี้ไม่เคยมี" (พิมพ์ผิด/ถูกแก้ระหว่างทาง ต้องติดต่อเจ้าหน้าที่)
 */
async function resolveToken(req: Request, res: Response) {
  const raw = typeof req.query.token === 'string' ? req.query.token : '';
  if (!raw) {
    res.status(400).json({ message: 'ลิงก์ไม่ถูกต้อง กรุณาเปิดจากอีเมลที่ได้รับ' });
    return null;
  }

  const token = await JobOfferModel.findToken(raw);
  if (!token) {
    res.status(404).json({ message: 'ไม่พบลิงก์นี้ในระบบ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา' });
    return null;
  }
  if (token.used_at) {
    res.status(410).json({
      message: 'ลิงก์นี้ถูกใช้ตอบแบบสำรวจไปแล้ว หากต้องการแก้ไขคำตอบ กรุณากดขอลิงก์ใหม่',
    });
    return null;
  }
  if (token.is_expired) {
    res.status(410).json({
      message: `ลิงก์นี้หมดอายุแล้ว (ลิงก์มีอายุ ${JOB_OFFER_TOKEN_TTL_LABEL}) กรุณากดขอลิงก์ใหม่ ระบบจะส่งไปที่อีเมลผู้ประสานงานในทะเบียน`,
    });
    return null;
  }
  return token;
}

/**
 * ข้อมูลบริษัทเท่าที่หน้าตอบแบบสำรวจต้องใช้
 * ⛔ ไม่มีข้อมูลนักศึกษา และไม่มี `created_by` — คนถือลิงก์ไม่จำเป็นต้องรู้ว่า
 *    บัญชีไหนเป็นเจ้าของทะเบียนนี้
 */
async function fetchCompanyPublic(companyId: number) {
  const res = await query(
    `SELECT company_id, name_th, name_en, address, province, district, postal_code,
            phone, fax, email, is_verified, business_type, employee_count,
            manager_name, manager_position, manager_department, manager_phone, manager_fax,
            contact_mode, contact_person, contact_position, contact_department,
            contact_phone, contact_fax
       FROM companies WHERE company_id = $1`,
    [companyId]
  );
  return res.rows[0] ?? null;
}

async function fetchSemesterLabel(offerId: number) {
  const res = await query(
    `SELECT s.semester_id, s.academic_year, s.semester
       FROM coop_job_offers o JOIN coop_semesters s ON s.semester_id = o.semester_id
      WHERE o.offer_id = $1`,
    [offerId]
  );
  const row = res.rows[0];
  return row
    ? { semester_id: row.semester_id, label: `ภาคเรียนที่ ${row.semester}/${row.academic_year}` }
    : null;
}

async function fetchDueDateFacts(offerId: number) {
  const res = await query(
    `SELECT (due_date - (NOW() AT TIME ZONE 'Asia/Bangkok')::date) AS days_left,
            (due_date IS NOT NULL AND due_date < (NOW() AT TIME ZONE 'Asia/Bangkok')::date) AS is_overdue
       FROM coop_job_offers WHERE offer_id = $1`,
    [offerId]
  );
  const row = res.rows[0] ?? {};
  return {
    days_left: row.days_left === null || row.days_left === undefined ? null : Number(row.days_left),
    is_overdue: row.is_overdue === true,
  };
}
