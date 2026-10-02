import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { JobOfferModel } from '../models/jobOffer';
import { writeAudit } from '../utils/audit';
import { sendJobOfferSurveyEmail } from '../utils/email';
import { createJobOfferToken } from '../utils/jobOfferToken';
import { sendUnexpectedError } from '../utils/httpError';

/**
 * แบบเสนองานสหกิจศึกษา (สหกิจ 02) — ฝั่งเจ้าหน้าที่ (ส่งแบบสำรวจ) + ตัวช่วยที่ jobOfferStaff ใช้ร่วม
 *
 * ⛔ สถานประกอบการไม่มีบัญชี — บริษัทตอบผ่านลิงก์ใช้ครั้งเดียวที่ `controllers/publicJobOffer.ts`
 *    (handler ฝั่งบัญชี `company` เดิมถูกลบแล้ว)
 *
 * ⛔ วันที่ทุกตัวคำนวณฝั่งเซิร์ฟเวอร์จาก `CURRENT_DATE` ของ Postgres และส่งออกเป็น
 *    ISO `YYYY-MM-DD` พร้อม `days_left` / `is_overdue` — หน้าจอไม่ต้อง (และห้าม) คิดวันเอง
 */
export class JobOfferController {
  /**
   * เจ้าหน้าที่ส่งแบบสำรวจ สหกิจ 02 ให้บริษัทที่เลือกจากทำเนียบ (ทีละหลายราย)
   * Route: POST /api/job-offers/send
   * Access: staff
   *
   * หนึ่งรายทำสองอย่างในทรานแซกชันเดียว: **เปิดใบ `draft` + ออก token 24 ชม.**
   * แล้วค่อยส่งอีเมล *นอก* ทรานแซกชัน
   * ⛔ ห้ามส่งเมลคาไว้ในทรานแซกชัน — เมลที่ออกไปแล้วย้อนคืนไม่ได้ ถ้า COMMIT ล้มทีหลัง
   *    บริษัทจะถือลิงก์ที่ชี้ไปยังใบที่ไม่มีอยู่จริง
   * ⛔ ใบกับ token ต้องอยู่ทรานแซกชัน**เดียวกัน** — ใบที่ไม่มี token คือใบที่ส่งซ้ำไม่ได้
   *    เพราะปุ่ม "ขอลิงก์ใหม่" ต้องใช้ token เดิมเป็นหลักฐานว่าเคยถูกส่งไปจริง
   * ⛔ **ส่งเมลไม่ออก = ลบใบที่เพิ่งเปิดทิ้ง** ไม่ใช่ปล่อยไว้แล้วบอกให้ไปกดขอลิงก์ใหม่
   *    ปุ่มนั้นอยู่บนหน้าที่เปิดจากลิงก์ในอีเมล — อีเมลที่ไม่เคยถึงมือใคร จึงไม่มีใครกดได้
   *    และใบที่ค้างอยู่จะทำให้การกดส่งรอบหน้าถูกข้ามด้วยเหตุผล "ส่งไปแล้ว" ตลอดกาล
   *    ใบที่เพิ่งเปิดยังไม่มีใครแตะ การลบจึงไม่ทำข้อมูลใครหาย และทำให้ "ลองใหม่" ใช้ได้จริง
   *
   * ล้มเป็นรายบริษัท ไม่ล้มทั้งชุด — เจ้าหน้าที่เลือกทีละหลายสิบราย การให้ทั้งชุดตกเพราะ
   * รายเดียวมีปัญหาแปลว่าต้องมานั่งหาว่าใครเป็นตัวปัญหาเอง `skipped[]` บอกให้ตรง ๆ ดีกว่า
   */
  static async sendSurvey(req: Request, res: Response): Promise<void> {
    try {
      const parsed = parseSendPayload(req.body);
      if ('error' in parsed) {
        res.status(400).json({ message: parsed.error });
        return;
      }
      const { companyIds, semesterId, dueDate } = parsed;

      // ⛔ "วันนี้" มาจาก Postgres เสมอ (กฎประจำโปรเจค) — นาฬิกาของ Node เพี้ยนได้
      const check = await query(
        `SELECT s.semester_id, s.academic_year, s.semester,
                ($2::date < (NOW() AT TIME ZONE 'Asia/Bangkok')::date) AS due_in_past
           FROM coop_semesters s WHERE s.semester_id = $1`,
        [semesterId, dueDate]
      );
      if ((check.rowCount ?? 0) === 0) {
        res.status(400).json({ message: 'ไม่พบภาคเรียนที่ระบุ' });
        return;
      }
      if (check.rows[0].due_in_past === true) {
        // ส่งแบบสำรวจที่หมดกำหนดไปแล้วตั้งแต่วันแรก = บริษัทเปิดมาเจอใบที่เลยกำหนด
        res.status(400).json({ message: 'กำหนดส่งคำตอบกลับต้องไม่เป็นวันที่ผ่านมาแล้ว' });
        return;
      }
      const semesterLabel = `ภาคเรียนที่ ${check.rows[0].semester}/${check.rows[0].academic_year}`;

      const targets = await JobOfferModel.listSendTargets(companyIds, semesterId);
      const found = new Set(targets.map((t) => t.company_id));

      const skipped: { company_id: number; name_th: string | null; reason: string }[] = [];
      for (const id of companyIds) {
        if (!found.has(id)) {
          skipped.push({ company_id: id, name_th: null, reason: 'ไม่พบสถานประกอบการนี้ในทะเบียน' });
        }
      }

      let created = 0;
      let emailed = 0;

      for (const target of targets) {
        if (target.existing_offer_id !== null) {
          // ⛔ ห้ามสร้างใบซ้ำ — หนึ่งบริษัทต่อหนึ่งภาคเรียนมีใบเดียว (UNIQUE กันอยู่แล้ว)
          //    อยากส่งลิงก์ซ้ำให้ใช้ปุ่มขอลิงก์ใหม่บนใบเดิม ไม่ใช่เปิดใบใหม่ทับ
          skipped.push({
            company_id: target.company_id,
            name_th: target.name_th,
            reason: 'ส่งแบบสำรวจของภาคเรียนนี้ไปแล้ว',
          });
          continue;
        }
        if (!target.email) {
          // ไม่เปิดใบทิ้งไว้ให้ลอย — ใบที่ส่งไม่ถึงใครคือใบที่ไม่มีวันถูกตอบ
          // และจะไปขวางการส่งรอบหน้าเพราะถูกนับว่า "ส่งไปแล้ว"
          skipped.push({
            company_id: target.company_id,
            name_th: target.name_th,
            reason: 'ไม่มีอีเมลผู้ประสานงานในทะเบียน',
          });
          continue;
        }

        const client = await pool.connect();
        let offerId: number | null = null;
        let link = '';
        try {
          await client.query('BEGIN');
          offerId = await JobOfferModel.createDraftOffer(client, target.company_id, semesterId, dueDate);
          if (offerId === null) {
            await client.query('ROLLBACK');
            skipped.push({
              company_id: target.company_id,
              name_th: target.name_th,
              reason: 'ส่งแบบสำรวจของภาคเรียนนี้ไปแล้ว',
            });
            continue;
          }
          const issued = await createJobOfferToken(offerId, req.user!.userId, client);
          link = issued.url;
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          console.error(`[JobOffer] send failed for company ${target.company_id}:`, error);
          skipped.push({
            company_id: target.company_id,
            name_th: target.name_th,
            reason: 'เปิดใบสำรวจไม่สำเร็จ',
          });
          continue;
        } finally {
          client.release();
        }

        const delivered = await sendJobOfferSurveyEmail(target.email, link, {
          companyName: target.name_th,
          semesterLabel,
          dueDate,
        });
        if (!delivered) {
          // ถอยกลับให้เหมือนไม่เคยกดส่ง — token หายตาม `ON DELETE CASCADE`
          // ⛔ ห้ามนับใน `created`/`emailed` ให้ตัวเลขสวย ตัวเลขที่โกหกแย่กว่าตัวเลขที่ไม่สวย
          await query(`DELETE FROM coop_job_offers WHERE offer_id = $1 AND status = 'draft'`, [
            offerId,
          ]).catch((err) => {
            // ลบไม่ออกคือกรณีเดียวที่จะเหลือใบค้าง — ต้องเห็นใน log ว่าใบไหน
            console.error(`[JobOffer] rollback delete failed for offer ${offerId}:`, err);
          });
          skipped.push({
            company_id: target.company_id,
            name_th: target.name_th,
            reason: 'ส่งอีเมลไม่สำเร็จ ยังไม่ได้เปิดใบให้บริษัทนี้ กรุณาลองส่งใหม่อีกครั้ง',
          });
          continue;
        }

        created += 1;
        emailed += 1;

        writeAudit(
          {
            action: 'job_offer.survey_sent',
            entityType: 'coop_job_offer',
            entityId: offerId,
            detail: {
              company_id: target.company_id,
              semester_id: semesterId,
              due_date: dueDate,
              sent_to: target.email,
            },
          },
          req
        ).catch(() => undefined);
      }

      res.status(200).json({ created, emailed, skipped });
    } catch (error) {
      sendUnexpectedError(res, error, 'Send job offer survey error', 'ไม่สามารถส่งแบบสำรวจได้');
    }
  }
}

/* ── ตัวช่วยที่ใช้ร่วมกันในไฟล์นี้ ─────────────────────────────────── */

/** เพดานต่อหนึ่งครั้ง — ทำเนียบทั้งหมดมีไม่กี่ร้อยราย และหนึ่งรายคือหนึ่งจดหมาย */
const SEND_BATCH_LIMIT = 100;

/**
 * ตรวจ body ของ `POST /job-offers/send` ให้จบในที่เดียว
 * คืนข้อความไทยที่บอกว่าผิดตรงไหน ไม่ใช่ "ข้อมูลไม่ถูกต้อง" ลอย ๆ
 */
function parseSendPayload(
  body: unknown
): { companyIds: number[]; semesterId: number; dueDate: string } | { error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;

  if (!Array.isArray(raw.company_ids) || raw.company_ids.length === 0) {
    return { error: 'กรุณาเลือกสถานประกอบการอย่างน้อยหนึ่งราย' };
  }
  const ids: number[] = [];
  for (const value of raw.company_ids) {
    const id = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: 'รายชื่อสถานประกอบการไม่ถูกต้อง' };
    }
    if (!ids.includes(id)) ids.push(id); // เลือกซ้ำ = ไม่ควรได้จดหมายสองฉบับ
  }
  if (ids.length > SEND_BATCH_LIMIT) {
    return { error: `ส่งได้ครั้งละไม่เกิน ${SEND_BATCH_LIMIT} ราย กรุณาแบ่งส่งเป็นหลายรอบ` };
  }

  const semesterId =
    typeof raw.semester_id === 'number' ? raw.semester_id : parseInt(String(raw.semester_id), 10);
  if (!Number.isInteger(semesterId) || semesterId <= 0) {
    return { error: 'กรุณาระบุภาคเรียนที่ต้องการสำรวจ' };
  }

  // กระดาษ สหกิจ 02 ท้ายหน้า 2 มีบรรทัด "กรุณาส่งกลับก่อนวันที่ ..." เสมอ
  // แบบสำรวจที่ไม่มีกำหนดส่งกลับคือแบบสำรวจที่ไม่มีใครรีบตอบ จึงบังคับ
  const dueDate = typeof raw.due_date === 'string' ? raw.due_date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) {
    return { error: 'กรุณาระบุกำหนดส่งคำตอบกลับในรูปแบบ YYYY-MM-DD' };
  }

  return { companyIds: ids, semesterId, dueDate };
}

export async function fetchCompany(companyId: number) {
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

export async function fetchSemesterLabel(semesterId: number) {
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
export async function fetchDueDateFacts(offerId: number) {
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
