import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { JobOfferModel, diffCompanySnapshot } from '../models/jobOffer';
import { AuditAction, writeAudit } from '../utils/audit';
import { sendUnexpectedError } from '../utils/httpError';
import { fetchCompany, fetchDueDateFacts, fetchSemesterLabel } from './jobOffer';

/**
 * แบบเสนองานสหกิจศึกษา (สหกิจ 02) — **ฝั่งเจ้าหน้าที่งานสหกิจศึกษา**
 *
 * แยกไฟล์จาก `jobOffer.ts` เพราะเป็นคนละฝั่งของกระดาษใบเดียวกัน: ไฟล์นั้นคือ
 * "บริษัทตอบ" (ทุกเส้นถูกจำกัดด้วย `company_id` ของผู้เรียก) ส่วนไฟล์นี้คือ
 * "มหาวิทยาลัยถามและตรวจ" ซึ่งเห็นทุกใบตามสิทธิ์ของ role `staff`
 *
 * ⛔ **นี่คือจุดที่วงจรปิด** — ตำแหน่งที่บริษัทกรอกมาอยู่ในสถานะ `pending_approval`
 *    และไม่มีอะไรพามันขึ้นกระดานหางานได้เลยจนกว่าจะมีคนกด `review` ที่นี่
 *
 * ⛔ วันที่ทุกตัวคำนวณฝั่งเซิร์ฟเวอร์จาก Postgres และส่งออกเป็น ISO `YYYY-MM-DD`
 *    พร้อม `days_left` / `is_overdue` — หน้าจอไม่ต้อง (และห้าม) คิดวันเอง
 */
export class JobOfferStaffController {
  /**
   * ทำเนียบพร้อมสถานะ "ส่งแบบสำรวจได้ไหม" ของภาคเรียนที่เลือก (SB1)
   * Route: GET /api/job-offers/recipients?semester_id=7
   * Access: staff
   *
   * ⛔ `semester_id` **บังคับ** ไม่มีค่าตั้งต้น — การเดาภาคเรียนผิดที่หน้านี้แปลว่า
   *    จดหมายหลายสิบฉบับออกไปถามภาคที่ไม่ได้ตั้งใจ และย้อนคืนไม่ได้
   * ⛔ ไม่รับ `search` — ทำเนียบมีไม่กี่ร้อยแถว กรองและค้นหาทำฝั่งหน้าจอ
   */
  static async listRecipients(req: Request, res: Response): Promise<void> {
    try {
      const semesterId = parseInt(String(req.query.semester_id ?? ''), 10);
      if (!Number.isInteger(semesterId) || semesterId <= 0) {
        res.status(400).json({ message: 'กรุณาระบุภาคเรียนที่ต้องการส่งแบบสำรวจ' });
        return;
      }
      const semester = await fetchSemesterLabel(semesterId);
      if (!semester) {
        res.status(404).json({ message: 'ไม่พบภาคเรียนที่ระบุ' });
        return;
      }

      const rows = await JobOfferModel.listRecipients(semesterId);
      const companies = rows.map((r) => {
        // ⛔ ลำดับนี้ต้องตรงกับ `sendSurvey` เป๊ะ ๆ: "มีใบแล้ว" มาก่อน "ไม่มีอีเมล"
        //    ไม่งั้นหน้าจอจะบอกเหตุผลคนละอย่างกับที่ปุ่มส่งทำจริง
        const status =
          r.offer_id !== null ? 'already_sent' : r.email === null ? 'no_email' : 'ready';
        return {
          company_id: r.company_id,
          name_th: r.name_th,
          province: r.province,
          district: r.district,
          email: r.email,
          contact_person: r.contact_person,
          status,
          offer_id: r.offer_id,
          sent_at: r.sent_at,
          offer_status: r.offer_status,
          history: {
            semesters_offered: r.semesters_offered,
            accepted_total: r.accepted_total,
            last_semester_label: r.last_semester_label,
          },
        };
      });

      res.status(200).json({
        semester,
        summary: {
          total: companies.length,
          ready: companies.filter((c) => c.status === 'ready').length,
          already_sent: companies.filter((c) => c.status === 'already_sent').length,
          no_email: companies.filter((c) => c.status === 'no_email').length,
        },
        companies,
      });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'List survey recipients error',
        'ไม่สามารถโหลดทำเนียบสถานประกอบการได้'
      );
    }
  }

  /**
   * ใบทั้งหมดของภาคเรียนหนึ่ง สำหรับหน้าตรวจแบบเสนองาน (SB2)
   * Route: GET /api/job-offers/staff?semester_id=7&status=submitted
   * Access: staff
   *
   * `semester_id` ไม่ใส่ก็ได้ — ตกไปที่ **ภาคล่าสุดที่มีใบอยู่จริง** และคืน `semester`
   * ที่ใช้จริงกลับไปเสมอ เพื่อให้หน้าจอรู้ว่ากำลังดูภาคไหน (ห้ามให้หน้าจอเดาเอง)
   */
  static async listOffers(req: Request, res: Response): Promise<void> {
    try {
      const raw = req.query.semester_id;
      let semesterId: number | null;
      if (raw !== undefined && String(raw).trim() !== '') {
        const parsed = parseInt(String(raw), 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          res.status(400).json({ message: 'ภาคเรียนที่ระบุไม่ถูกต้อง' });
          return;
        }
        semesterId = parsed;
      } else {
        semesterId = await JobOfferModel.latestSemesterWithOffers();
      }

      if (semesterId === null) {
        // ยังไม่เคยส่งแบบสำรวจเลยสักใบ — ไม่ใช่ข้อผิดพลาด แต่หน้าจอต้องรู้ว่าว่างเพราะอะไร
        res.status(200).json({
          semester: null,
          counts: { draft: 0, submitted: 0, reviewed: 0, declined: 0 },
          offers: [],
        });
        return;
      }

      const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const ALLOWED = ['draft', 'submitted', 'reviewed', 'declined'];
      if (statusRaw !== '' && !ALLOWED.includes(statusRaw)) {
        res.status(400).json({ message: 'สถานะที่ใช้กรองไม่ถูกต้อง' });
        return;
      }

      const [semester, counts, offers] = await Promise.all([
        fetchSemesterLabel(semesterId),
        JobOfferModel.staffStatusCounts(semesterId),
        JobOfferModel.listStaffOffers(semesterId, statusRaw === '' ? null : statusRaw),
      ]);

      res.status(200).json({ semester, counts, offers });
    } catch (error) {
      sendUnexpectedError(
        res,
        error,
        'List staff job offers error',
        'ไม่สามารถโหลดรายการแบบเสนองานได้'
      );
    }
  }

  /**
   * ใบเดียวแบบเต็ม สำหรับหน้าตรวจ (SB3)
   * Route: GET /api/job-offers/staff/:offerId
   * Access: staff
   *
   * รูปร่าง payload **เหมือน `GET /job-offers/current` ของฝั่งบริษัททุกคีย์**
   * (`semester` `offer` `company` `items` `previous` `majors`) โดยตั้งใจ — คนตรวจ
   * ต้องเห็นสิ่งเดียวกับที่บริษัทเห็นตอนกรอก ไม่ใช่สรุปย่อคนละชุดที่เทียบกันไม่ได้
   * เพิ่มสามคีย์ที่มีเฉพาะฝั่งเจ้าหน้าที่: `sent_at` `sent_by_name` `changed_fields`
   */
  static async getOffer(req: Request, res: Response): Promise<void> {
    try {
      const offerId = parseInt(req.params.offerId, 10);
      if (!Number.isInteger(offerId) || offerId <= 0) {
        res.status(400).json({ message: 'รหัสแบบเสนองานไม่ถูกต้อง' });
        return;
      }
      const offer = await JobOfferModel.findById(offerId);
      if (!offer) {
        res.status(404).json({ message: 'ไม่พบแบบเสนองานฉบับนี้' });
        return;
      }

      const [semester, dates, company, items, previous, majors, sendInfo, snapshot] =
        await Promise.all([
          fetchSemesterLabel(offer.semester_id),
          fetchDueDateFacts(offer.offer_id),
          fetchCompany(offer.company_id),
          JobOfferModel.listItems(offer.offer_id),
          JobOfferModel.findPreviousAnswered(offer.company_id, offer.semester_id),
          query(`SELECT major_id, major_name_th FROM master_major ORDER BY major_name_th`),
          JobOfferModel.sendInfo(offer.offer_id),
          JobOfferModel.companySnapshot(offer.offer_id),
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
        sent_at: sendInfo.sent_at,
        sent_by_name: sendInfo.sent_by_name,
        // ⛔ `[]` ที่มาจากใบเก่าที่ไม่มีสำเนาแปลว่า "ไม่รู้ว่าอะไรเปลี่ยน" ไม่ใช่ "ไม่เปลี่ยน"
        //    หน้าจอทำได้แค่ไม่ระบายสี ห้ามขึ้นป้ายว่าบริษัทไม่ได้แก้อะไร
        changed_fields: diffCompanySnapshot(snapshot, company),
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get staff job offer error', 'ไม่สามารถโหลดแบบเสนองานได้');
    }
  }

  /**
   * ตรวจผ่านทั้งใบ แล้วเปิดตำแหน่งที่เหลือให้นักศึกษาเห็น (SB4)
   * Route: PUT /api/job-offers/:offerId/review
   * Access: staff
   *
   * ⛔ **นี่คือปุ่มที่ปิดวงจรทั้งระบบ** — ก่อนหน้านี้บริษัทตอบแบบสำรวจแล้วตำแหน่ง
   *    ค้างอยู่ที่ `pending_approval` ตลอดกาลเพราะไม่มีที่ไหนให้กด
   *
   * ⛔ ทำในทรานแซกชันเดียว: ใบเปลี่ยนสถานะ **พร้อมกับ** ตำแหน่งข้างในถูกเปิด
   *    ถ้าแยกกัน ใบจะขึ้นว่า "ตรวจแล้ว" ทั้งที่ไม่มีตำแหน่งไหนขึ้นกระดานเลย
   *    และไม่มีปุ่มไหนพากลับมาแก้ได้อีก (สถานะ `reviewed` ตรวจซ้ำไม่ได้)
   *
   * ⛔ เปิดเฉพาะแถวที่ยังเป็น `pending_approval` — รายการที่เจ้าหน้าที่กดปฏิเสธไปทีละอัน
   *    ก่อนหน้านี้ (`PUT /jobs/:id/reject`) ต้องอยู่ที่ `rejected` ต่อไป
   *    นี่คือกลไกของ "ปฏิเสธรายอันแล้วค่อยผ่านทั้งใบ" ตาม spec-E ข้อ 7.3
   */
  static async reviewOffer(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const offerId = parseInt(req.params.offerId, 10);
      if (!Number.isInteger(offerId) || offerId <= 0) {
        res.status(400).json({ message: 'รหัสแบบเสนองานไม่ถูกต้อง' });
        return;
      }
      const offer = await JobOfferModel.findById(offerId);
      if (!offer) {
        res.status(404).json({ message: 'ไม่พบแบบเสนองานฉบับนี้' });
        return;
      }
      if (offer.status !== 'submitted') {
        res.status(409).json({ message: statusConflictMessage(offer.status) });
        return;
      }

      await client.query('BEGIN');
      await client.query(
        `UPDATE coop_job_offers
            SET status = 'reviewed', reviewed_at = NOW(), reviewed_by = $2,
                reject_reason = NULL, updated_at = NOW()
          WHERE offer_id = $1`,
        [offerId, req.user!.userId]
      );
      const published = await client.query(
        `UPDATE job_posts SET status = 'published', reject_reason = NULL
          WHERE offer_id = $1 AND status = 'pending_approval'
          RETURNING job_id, title`,
        [offerId]
      );
      const total = await client.query(
        `SELECT COUNT(*)::int AS n FROM job_posts WHERE offer_id = $1`,
        [offerId]
      );
      await client.query('COMMIT');

      const publishedCount = published.rowCount ?? 0;
      const skippedCount = (total.rows[0]?.n ?? 0) - publishedCount;

      writeAudit(
        {
          action: AuditAction.JOB_OFFER_REVIEWED,
          entityType: 'coop_job_offer',
          entityId: offerId,
          detail: {
            company_id: offer.company_id,
            semester_id: offer.semester_id,
            published_job_ids: published.rows.map((r) => r.job_id),
            skipped_count: skippedCount,
          },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        // ⛔ ป้ายต้องไม่สัญญาเกินกว่าที่เกิดขึ้นจริง — ผ่านทั้งใบแต่ไม่มีตำแหน่งไหนถูกเปิด
        //    เป็นกรณีที่เกิดได้จริง (ปฏิเสธรายอันไปหมดแล้ว) และคนกดต้องรู้ทันที
        message:
          publishedCount > 0
            ? `เปิดตำแหน่งให้นักศึกษาเห็นแล้ว ${publishedCount} รายการ`
            : 'ตรวจแบบเสนองานเรียบร้อยแล้ว แต่ไม่มีรายการใดถูกเปิดให้นักศึกษาเห็น (ถูกปฏิเสธไปก่อนหน้านี้ทั้งหมด)',
        published_count: publishedCount,
        skipped_count: skippedCount,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      sendUnexpectedError(
        res,
        error,
        'Review job offer error',
        'ไม่สามารถบันทึกผลการตรวจแบบเสนองานได้'
      );
    } finally {
      client.release();
    }
  }

  /**
   * ตีกลับทั้งใบให้สถานประกอบการแก้ (SB5)
   * Route: POST /api/job-offers/:offerId/reject
   * Access: staff
   *
   * ⛔ **ไม่ส่งอีเมลแจ้งบริษัทเอง** — การเรียกบริษัทกลับมาแก้ทำผ่านปุ่ม "ขอลิงก์ใหม่"
   *    (SB6) ซึ่งยังไม่ได้ทำ · หน้าจอต้องเขียนให้ตรงว่าใบถูกตีกลับแล้วแต่ยังไม่มีใคร
   *    ที่บริษัทได้รับแจ้ง ⛔ ห้ามขึ้นป้ายว่า "แจ้งบริษัทแล้ว"
   *
   * ⛔ ตำแหน่งที่มีนักศึกษายื่นเข้ามาแล้วตีกลับไม่ได้ → 409 พร้อมบอกว่าติดรายการไหน
   *    (คำร้องที่อ้าง `job_id` นั้นจะชี้ไปที่ตำแหน่งที่ถูกปฏิเสธ และตรรกะโควตายังอ่านแถวนั้นอยู่)
   */
  static async rejectOffer(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const offerId = parseInt(req.params.offerId, 10);
      if (!Number.isInteger(offerId) || offerId <= 0) {
        res.status(400).json({ message: 'รหัสแบบเสนองานไม่ถูกต้อง' });
        return;
      }
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (reason === '') {
        // ใบที่ถูกตีกลับโดยไม่บอกเหตุผล = บริษัทไม่รู้ว่าต้องแก้อะไร แล้วส่งกลับมาเหมือนเดิม
        res.status(400).json({ message: 'กรุณาระบุเหตุผลที่ส่งกลับให้สถานประกอบการแก้ไข' });
        return;
      }

      const offer = await JobOfferModel.findById(offerId);
      if (!offer) {
        res.status(404).json({ message: 'ไม่พบแบบเสนองานฉบับนี้' });
        return;
      }
      if (offer.status !== 'submitted') {
        res.status(409).json({ message: statusConflictMessage(offer.status) });
        return;
      }

      const blocked = await JobOfferModel.itemsWithApplicants(offerId);
      if (blocked.length > 0) {
        res.status(409).json({
          message: `ส่งกลับทั้งใบไม่ได้ เพราะมีนักศึกษายื่นความจำนงเข้ามาแล้วในตำแหน่ง: ${blocked
            .map((b) => `${b.title} (${b.applied_count} คน)`)
            .join(', ')} — ถ้าต้องการแก้เฉพาะบางรายการให้ใช้ปุ่มปฏิเสธรายรายการแทน`,
        });
        return;
      }

      await client.query('BEGIN');
      await client.query(
        `UPDATE coop_job_offers
            SET status = 'draft', reject_reason = $2, updated_at = NOW()
          WHERE offer_id = $1`,
        [offerId, reason]
      );
      const rejected = await client.query(
        `UPDATE job_posts SET status = 'rejected', reject_reason = $2
          WHERE offer_id = $1 AND status IN ('pending_approval', 'published')
          RETURNING job_id`,
        [offerId, reason]
      );
      await client.query('COMMIT');

      writeAudit(
        {
          action: AuditAction.JOB_OFFER_REJECTED,
          entityType: 'coop_job_offer',
          entityId: offerId,
          detail: {
            company_id: offer.company_id,
            semester_id: offer.semester_id,
            reason,
            rejected_job_ids: rejected.rows.map((r) => r.job_id),
          },
        },
        req
      ).catch(() => undefined);

      res.status(200).json({
        message: 'ส่งแบบเสนองานกลับให้สถานประกอบการแก้ไขแล้ว — ระบบยังไม่ได้แจ้งบริษัททางอีเมล',
        rejected_count: rejected.rowCount ?? 0,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      sendUnexpectedError(res, error, 'Reject job offer error', 'ไม่สามารถส่งแบบเสนองานกลับได้');
    } finally {
      client.release();
    }
  }
}

/** ใบที่ไม่ได้อยู่สถานะ `submitted` — บอกสถานะปัจจุบันเสมอ ไม่ใช่ "ทำรายการไม่ได้" ลอย ๆ */
function statusConflictMessage(status: string): string {
  const label: Record<string, string> = {
    draft: 'ยังไม่ได้ส่งคำตอบกลับมา (ยังเป็นร่าง)',
    reviewed: 'ถูกตรวจและเปิดให้นักศึกษาเห็นไปแล้ว',
    declined: 'สถานประกอบการตอบว่าภาคเรียนนี้ยังไม่รับนักศึกษา',
  };
  return `แบบเสนองานฉบับนี้${label[status] ?? `อยู่ในสถานะ ${status}`} จึงทำรายการนี้ไม่ได้`;
}
