import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { COMPANY_WRITABLE_FIELDS, JobOfferModel, JobOfferRow } from '../models/jobOffer';
import { writeAudit } from '../utils/audit';
import { getErrorMessage, sendUnexpectedError } from '../utils/httpError';

/**
 * แบบเสนองานสหกิจศึกษา (สหกิจ 02) — ฝั่งบัญชีสถานประกอบการ
 *
 * ⛔ ทุกเส้นในไฟล์นี้ต้อง **fail closed** (SEC-06): หา `company_id` ของผู้เรียกไม่เจอ
 *    = 403 ไม่ใช่ "คืนทุกบริษัท" · และทุกเส้นที่รับ `:id` ต้องตรวจว่าใบนั้นเป็นของบริษัทตัวเอง
 *
 * ⛔ วันที่ทุกตัวคำนวณฝั่งเซิร์ฟเวอร์จาก `CURRENT_DATE` ของ Postgres และส่งออกเป็น
 *    ISO `YYYY-MM-DD` พร้อม `days_left` / `is_overdue` — หน้าจอไม่ต้อง (และห้าม) คิดวันเอง
 */
export class JobOfferController {
  /**
   * ใบสำรวจของภาคเรียนที่กำลังถูกถามอยู่ + คำตอบของภาคที่แล้วไว้เทียบ
   * Route: GET /api/job-offers/current
   * Access: company
   */
  static async getCurrent(req: Request, res: Response): Promise<void> {
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const company = await fetchCompany(companyId);
      const majors = await query(
        `SELECT major_id, major_name_th FROM master_major ORDER BY major_name_th`
      );

      const offer = await JobOfferModel.findCurrentOffer(companyId);
      if (!offer) {
        // ⛔ บริษัทสร้างใบเองไม่ได้ — ไม่มีใบแปลว่าเจ้าหน้าที่ยังไม่ได้ส่งแบบสำรวจมา
        //    หน้าจอต้องบอกว่ารออะไรอยู่ ห้ามแสดงฟอร์มเปล่าให้กรอกลอย ๆ
        res.status(200).json({
          semester: null,
          offer: null,
          company,
          items: [],
          previous: null,
          majors: majors.rows,
        });
        return;
      }

      const [semester, dates, items, previous] = await Promise.all([
        fetchSemesterLabel(offer.semester_id),
        fetchDueDateFacts(offer.offer_id),
        JobOfferModel.listItems(offer.offer_id),
        JobOfferModel.findPreviousAnswered(companyId, offer.semester_id),
      ]);

      res.status(200).json({
        semester,
        offer: { ...offer, ...dates },
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
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get current job offer error', 'ไม่สามารถโหลดแบบเสนองานได้');
    }
  }

  /**
   * ประวัติความร่วมมือกับคณะ
   * Route: GET /api/job-offers/history
   * Access: company
   */
  static async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const rows = await JobOfferModel.history(companyId);
      res.status(200).json(
        rows.map((r) => ({
          semester_label: `ภาคเรียนที่ ${r.semester}/${r.academic_year}`,
          offered_quota: r.offered_quota,
          accepted_count: r.accepted_count,
          // ⛔ "ประเมินครบแล้วกี่คน" ไม่ใช่ "ผ่านกี่คน" — ระบบไม่รู้ว่าใครผ่าน
          //    อาจารย์เป็นผู้ตัดเกรดโดยใช้คะแนนชุดนี้ประกอบ ป้ายบนจอต้องไม่สัญญาเกินข้อมูล
          evaluated_count: r.evaluated_count,
        }))
      );
    } catch (error) {
      sendUnexpectedError(res, error, 'Get job offer history error', 'ไม่สามารถโหลดประวัติความร่วมมือได้');
    }
  }

  /**
   * บันทึกคำตอบทั้งใบ (ข้อมูลบริษัท + รายการตำแหน่ง) ในทรานแซกชันเดียว
   * Route: PUT /api/job-offers/:id
   * Access: company
   */
  static async updateOffer(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const offer = await loadOwnOffer(req, res, companyId);
      if (!offer) return;

      const body = req.body ?? {};
      await client.query('BEGIN');

      // 1. ข้อมูลบริษัท — เขียนได้เฉพาะฟิลด์ใน allow-list เท่านั้น
      //    ⛔ ห้ามส่ง object ทั้งก้อนลง UPDATE · ชื่อและที่อยู่เป็นของเจ้าหน้าที่
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
          values.push(companyId);
          await client.query(
            `UPDATE companies SET ${sets.join(', ')} WHERE company_id = $${values.length}`,
            values
          );
        }
      }

      // 2. หัวใบ — ช่อง "ลงชื่อผู้ให้ข้อมูล / ตำแหน่ง" ท้ายหน้า 2 ของกระดาษ
      //
      // ⛔ ยึด "ส่งคีย์มา = เขียน" ไม่ใช่ COALESCE — ถ้าใช้ COALESCE ผู้ใช้ที่ลบชื่อ
      //    ออกจากช่องแล้วกดบันทึกจะเห็นชื่อเดิมกลับมาเหมือนไม่มีอะไรเกิดขึ้น
      //    คีย์ที่ไม่ได้ส่งมาเลยยังคงค่าเดิมตามปกติ
      const informant = body.offer ?? {};
      const offerSets: string[] = [];
      const offerValues: unknown[] = [offer.offer_id];
      for (const field of ['informant_name', 'informant_position'] as const) {
        if (Object.prototype.hasOwnProperty.call(informant, field)) {
          offerValues.push(emptyToNull(informant[field]));
          offerSets.push(`${field} = $${offerValues.length}`);
        }
      }
      await client.query(
        `UPDATE coop_job_offers SET ${[...offerSets, 'updated_at = NOW()'].join(', ')} WHERE offer_id = $1`,
        offerValues
      );

      // 3. รายการตำแหน่ง
      if (Array.isArray(body.items)) {
        await JobOfferModel.replaceItems(client, offer, body.items, req.user!.userId);
      }

      // ตอบไปแล้วว่าไม่รับ แล้วกลับมาแก้ = เปลี่ยนใจ → ใบกลับเป็นร่างให้ส่งใหม่ได้
      if (offer.status === 'declined') {
        await client.query(
          `UPDATE coop_job_offers SET status = 'draft', decline_reason = NULL WHERE offer_id = $1`,
          [offer.offer_id]
        );
      }

      await client.query('COMMIT');

      const fresh = await JobOfferModel.findById(offer.offer_id);
      res.status(200).json({
        message: 'บันทึกแบบเสนองานสหกิจศึกษา (สหกิจ 02) เรียบร้อยแล้ว',
        offer: fresh,
        items: await JobOfferModel.listItems(offer.offer_id),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message = getErrorMessage(error, '');
      // ลบตำแหน่งที่มีคนยื่นเข้ามาแล้วไม่ได้ — เป็นคำขอที่ผิด ไม่ใช่ระบบพัง
      if (message.includes('ลบตำแหน่ง') || message.includes('ไม่ได้อยู่ในแบบเสนองาน')) {
        res.status(409).json({ message });
        return;
      }
      sendUnexpectedError(res, error, 'Update job offer error', 'ไม่สามารถบันทึกแบบเสนองานได้');
    } finally {
      client.release();
    }
  }

  /**
   * ก๊อปคำตอบของภาคเรียนที่แล้วมาเป็นค่าตั้งต้น
   * Route: POST /api/job-offers/:id/copy-previous
   * Access: company
   */
  static async copyPrevious(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const offer = await loadOwnOffer(req, res, companyId);
      if (!offer) return;

      if (offer.status === 'reviewed') {
        res.status(409).json({
          message: 'แบบเสนองานฉบับนี้ถูกตรวจและเปิดให้นักศึกษาเห็นแล้ว จึงเขียนทับด้วยคำตอบเดิมไม่ได้',
        });
        return;
      }

      const previous = await JobOfferModel.findPreviousAnswered(companyId, offer.semester_id);
      if (!previous) {
        res.status(404).json({ message: 'ยังไม่มีคำตอบของภาคเรียนก่อนหน้าให้คัดลอก' });
        return;
      }

      const source = await JobOfferModel.listItems(previous.offer_id);
      await client.query('BEGIN');
      await JobOfferModel.replaceItems(
        client,
        offer,
        // job_id ตั้งเป็น null เสมอ — เป็นการสร้างรายการใหม่ของภาคนี้
        // ⛔ ห้ามผูกกลับไปที่แถวของภาคที่แล้ว ไม่งั้นแก้ของภาคนี้แล้วประวัติภาคเก่าเปลี่ยนตาม
        source.map((s) => ({ ...s, job_id: null })),
        req.user!.userId
      );
      await client.query(
        `UPDATE coop_job_offers SET copied_from_offer_id = $2, updated_at = NOW() WHERE offer_id = $1`,
        [offer.offer_id, previous.offer_id]
      );
      await client.query('COMMIT');

      res.status(200).json({
        message: `คัดลอกคำตอบของภาคเรียนที่ ${previous.semester}/${previous.academic_year} มาให้แล้ว ตรวจและแก้ได้ตามต้องการ`,
        items: await JobOfferModel.listItems(offer.offer_id),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message = getErrorMessage(error, '');
      if (message.includes('ลบตำแหน่ง')) {
        res.status(409).json({ message });
        return;
      }
      sendUnexpectedError(res, error, 'Copy previous job offer error', 'ไม่สามารถคัดลอกคำตอบเดิมได้');
    } finally {
      client.release();
    }
  }

  /**
   * ส่งคำตอบกลับให้มหาวิทยาลัย
   * Route: POST /api/job-offers/:id/submit
   * Access: company
   */
  static async submitOffer(req: Request, res: Response): Promise<void> {
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const offer = await loadOwnOffer(req, res, companyId);
      if (!offer) return;

      if (offer.status === 'reviewed') {
        res.status(409).json({ message: 'แบบเสนองานฉบับนี้ถูกตรวจและเปิดให้นักศึกษาเห็นแล้ว' });
        return;
      }

      const items = await JobOfferModel.listItems(offer.offer_id);
      if (items.length === 0) {
        res.status(400).json({
          message: 'ยังไม่มีรายการตำแหน่งในแบบเสนองาน — เพิ่มอย่างน้อยหนึ่งตำแหน่งก่อนส่ง หรือเลือก “ภาคเรียนนี้ยังไม่รับนักศึกษา”',
        });
        return;
      }
      const incomplete = items.filter((i) => !String(i.title ?? '').trim() || !String(i.description ?? '').trim());
      if (incomplete.length > 0) {
        res.status(400).json({ message: 'มีรายการที่ยังไม่ได้กรอกตำแหน่งงานหรือลักษณะงาน กรุณากรอกให้ครบก่อนส่ง' });
        return;
      }

      // กระดาษมีช่องลงชื่อผู้ให้ข้อมูล — ใบที่ไม่มีชื่อคนตอบคือใบที่ไม่มีใครรับผิดชอบ
      const fresh = await JobOfferModel.findById(offer.offer_id);
      if (!fresh?.informant_name) {
        res.status(400).json({ message: 'กรุณาระบุชื่อผู้ให้ข้อมูลก่อนส่งแบบเสนองาน' });
        return;
      }

      await query(
        `UPDATE coop_job_offers
            SET status = 'submitted', submitted_at = NOW(), submitted_by = $2, updated_at = NOW()
          WHERE offer_id = $1`,
        [offer.offer_id, req.user!.userId]
      );

      writeAudit(
        {
          action: 'job_offer.submitted',
          entityType: 'coop_job_offer',
          entityId: offer.offer_id,
          detail: { company_id: companyId, semester_id: offer.semester_id, item_count: items.length },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: 'ส่งแบบเสนองานสหกิจศึกษา (สหกิจ 02) ให้มหาวิทยาลัยเรียบร้อยแล้ว เจ้าหน้าที่จะตรวจก่อนเปิดให้นักศึกษาเห็น',
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Submit job offer error', 'ไม่สามารถส่งแบบเสนองานได้');
    }
  }

  /**
   * ตอบว่าภาคเรียนนี้ยังไม่รับนักศึกษา
   * Route: POST /api/job-offers/:id/decline
   * Access: company
   *
   * ⛔ ไม่ใช่การลบใบ — การตอบว่าไม่รับก็เป็นคำตอบที่คณะต้องรู้ และเป็นข้อมูลที่ใช้
   *    ตัดสินใจว่าจะส่งแบบสำรวจไปที่ไหนในภาคถัดไป
   */
  static async declineOffer(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const offer = await loadOwnOffer(req, res, companyId);
      if (!offer) return;

      const reason = emptyToNull(req.body?.reason);
      await client.query('BEGIN');
      await client.query(
        `UPDATE coop_job_offers
            SET status = 'declined', decline_reason = $2, submitted_at = NOW(),
                submitted_by = $3, updated_at = NOW()
          WHERE offer_id = $1`,
        [offer.offer_id, reason, req.user!.userId]
      );
      // ถ้าเคยเปิดให้นักศึกษาเห็นแล้ว ต้องปิดรับด้วย ไม่งั้นยังมีคนสมัครเข้ามาเรื่อย ๆ
      await client.query(
        `UPDATE job_posts SET status = 'closed'
          WHERE offer_id = $1 AND status IN ('pending_approval', 'published')`,
        [offer.offer_id]
      );
      await client.query('COMMIT');

      writeAudit(
        {
          action: 'job_offer.declined',
          entityType: 'coop_job_offer',
          entityId: offer.offer_id,
          detail: { company_id: companyId, semester_id: offer.semester_id, reason },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: 'บันทึกคำตอบว่าภาคเรียนนี้ยังไม่รับนักศึกษาเรียบร้อยแล้ว คณะจะติดต่อกลับมาอีกครั้งในภาคเรียนถัดไป',
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      sendUnexpectedError(res, error, 'Decline job offer error', 'ไม่สามารถบันทึกคำตอบได้');
    } finally {
      client.release();
    }
  }
}

/* ── ตัวช่วยที่ใช้ร่วมกันในไฟล์นี้ ─────────────────────────────────── */

/** `''` ที่ผู้ใช้เว้นว่างควรลงฐานเป็น NULL ไม่ใช่สตริงว่าง */
function emptyToNull(value: unknown): string | null {
  if (typeof value !== 'string') return value === undefined ? null : (value as string | null);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * บริษัทของผู้เรียก — **ไม่พบ = 403** (SEC-06 fail closed)
 * ⛔ ห้ามเขียนเป็น `if (companyRow) { applyFilter }` ซึ่งจะกลายเป็นเห็นทุกบริษัท
 */
async function requireOwnCompany(req: Request, res: Response): Promise<number | null> {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized. Please log in.' });
    return null;
  }
  const companyId = await JobOfferModel.findCompanyIdByUser(req.user.userId);
  if (companyId === null) {
    res.status(403).json({
      message: 'ไม่พบข้อมูลสถานประกอบการที่ผูกกับบัญชีนี้ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา',
    });
    return null;
  }
  return companyId;
}

/** ใบตาม `:id` ที่ต้องเป็นของบริษัทตัวเองเท่านั้น */
async function loadOwnOffer(
  req: Request,
  res: Response,
  companyId: number
): Promise<JobOfferRow | null> {
  const offerId = parseInt(req.params.id, 10);
  if (!Number.isInteger(offerId)) {
    res.status(400).json({ message: 'รหัสแบบเสนองานไม่ถูกต้อง' });
    return null;
  }
  const offer = await JobOfferModel.findById(offerId);
  if (!offer || offer.company_id !== companyId) {
    // ไม่แยกระหว่าง "ไม่มี" กับ "ไม่ใช่ของคุณ" — ไม่งั้นเดารหัสใบของบริษัทอื่นได้ว่ามีจริงไหม
    res.status(404).json({ message: 'ไม่พบแบบเสนองานฉบับนี้' });
    return null;
  }
  return offer;
}

async function fetchCompany(companyId: number) {
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

async function fetchSemesterLabel(semesterId: number) {
  const res = await query(
    `SELECT semester_id, academic_year, semester FROM coop_semesters WHERE semester_id = $1`,
    [semesterId]
  );
  const row = res.rows[0];
  return row
    ? { semester_id: row.semester_id, label: `ภาคเรียนที่ ${row.semester}/${row.academic_year}` }
    : null;
}

/**
 * เหลืออีกกี่วัน / เลยกำหนดหรือยัง — **คิดจาก CURRENT_DATE ของ Postgres เสมอ**
 * เคยมีบั๊กวันเพี้ยนจาก timezone มาแล้ว การให้เบราว์เซอร์คิดเองคือเปิดประตูให้มันกลับมา
 */
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
