import { PoolClient } from 'pg';
import { query } from '../config/database';

/**
 * แบบเสนองานสหกิจศึกษา (สหกิจ 02)
 *
 * ⛔ ในระบบนี้ไม่มีคำว่า "ประกาศรับสมัครงาน" — ตามคู่มือ งานสหกิจศึกษาประจำคณะ
 *    เป็นฝ่ายส่งแบบเสนองานไปถามสถานประกอบการล่วงหน้าประมาณหนึ่งภาคการศึกษา
 *    ตารางนี้คือ "ใบที่ส่งไปถาม" และ `job_posts` คือรายการตำแหน่งที่อยู่ข้างในใบนั้น
 *    (กระดาษหน้า 2 หนึ่งแผ่นต่อหนึ่งรายการ)
 *
 * ⛔ บริษัทสร้างใบเองไม่ได้ — เจ้าหน้าที่เปิดใบตอนส่งแบบสำรวจ (งาน B4)
 *    โมเดลนี้จึงมีแต่ "อ่านใบของตัวเอง" กับ "แก้คำตอบในใบ"
 */

/** ฟิลด์ของ `companies` ที่บัญชีบริษัทเขียนได้ — allow-list ที่เดียวของทั้งระบบ */
export const COMPANY_WRITABLE_FIELDS = [
  'phone',
  'fax',
  'email',
  'business_type',
  'employee_count',
  'manager_name',
  'manager_position',
  'manager_department',
  'manager_phone',
  'manager_fax',
  'contact_mode',
  'contact_person',
  'contact_position',
  'contact_department',
  'contact_phone',
  'contact_fax',
] as const;

/**
 * ⛔ ที่ **ไม่อยู่** ในรายการข้างบนโดยตั้งใจ: `name_th` `name_en` `address` `province`
 *    `district` `postal_code` `is_verified` `google_place_id` `created_by`
 *    — เป็นตัวตนที่เจ้าหน้าที่รับรอง และถูกพิมพ์ลงหนังสือราชการที่คณบดีลงนาม
 *    การให้บัญชีบริษัทเขียนทับเองคือการปล่อยให้แก้ชื่อบนหนังสือที่เซ็นไปแล้ว
 */

export interface JobOfferRow {
  offer_id: number;
  company_id: number;
  semester_id: number;
  status: 'draft' | 'submitted' | 'reviewed' | 'declined';
  due_date: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  informant_name: string | null;
  informant_position: string | null;
  decline_reason: string | null;
  reject_reason: string | null;
  copied_from_offer_id: number | null;
}

export interface JobOfferItemInput {
  job_id?: number | null;
  title?: string;
  description?: string;
  quota?: number;
  major_ids?: number[];
  duration_term?: string | null;
  skills_required?: string | null;
  other_requirements?: string | null;
  pay_amount?: number | null;
  pay_unit?: string | null;
  accommodation?: string | null;
  accommodation_cost?: string | null;
  welfare_other?: string | null;
}

/**
 * เนื้อหาของรายการตำแหน่งเปลี่ยนไปจากเดิมหรือไม่
 *
 * เทียบเป็นสตริงเพราะค่าจาก Postgres กับค่าที่หน้าจอส่งมาต่างชนิดกันโดยธรรมชาติ
 * (NUMERIC กลับมาเป็นสตริง · ช่องว่างมาเป็น null บ้าง '' บ้าง) การเทียบด้วย ===
 * ตรง ๆ จะรายงานว่า "เปลี่ยน" ทุกครั้งที่กดบันทึก แล้วประกาศจะถูกถอดจากกระดาน
 * ทั้งที่ไม่มีอะไรเปลี่ยนเลย
 */
const ITEM_FIELDS = [
  'title', 'description', 'quota', 'duration_term', 'skills_required',
  'other_requirements', 'pay_amount', 'pay_unit', 'accommodation',
  'accommodation_cost', 'welfare_other',
] as const;

function sameItem(before: Record<string, unknown>, values: unknown[]): boolean {
  const norm = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    // "350.00" กับ 350 คือค่าเดียวกัน — เทียบเป็นตัวเลขเมื่อทั้งคู่เป็นตัวเลขได้
    const n = Number(s);
    return s !== '' && Number.isFinite(n) ? String(n) : s;
  };
  return ITEM_FIELDS.every((field, i) => norm(before[field]) === norm(values[i]));
}

export class JobOfferModel {
  /** บริษัทของผู้ใช้คนนี้ — ไม่พบ = ไม่มีสิทธิ์ ไม่ใช่ "เห็นทุกบริษัท" (SEC-06) */
  static async findCompanyIdByUser(userId: number): Promise<number | null> {
    const res = await query(
      `SELECT company_id FROM companies WHERE created_by = $1 ORDER BY company_id LIMIT 1`,
      [userId]
    );
    return (res.rowCount ?? 0) > 0 ? (res.rows[0].company_id as number) : null;
  }

  /**
   * ใบสำรวจของภาคเรียนที่กำลังถูกสำรวจอยู่
   *
   * "ภาคที่กำลังสำรวจ" ไม่ใช่ภาคที่ `is_active` — คู่มือบอกว่าคณะส่งแบบสำรวจ
   * **ล่วงหน้าประมาณหนึ่งภาคการศึกษา** ใบที่บริษัทต้องตอบตอนนี้จึงเป็นใบของภาคหน้า
   * เลือกจาก "ใบล่าสุดของบริษัทนี้ที่ยังไม่ถูกตรวจ" ก่อน แล้วค่อยตกไปที่ใบล่าสุดสุด
   * ⛔ ห้ามเดาภาคเรียนเอง — ใบมีอยู่ก็ต่อเมื่อเจ้าหน้าที่ส่งไปถามจริง
   */
  static async findCurrentOffer(companyId: number): Promise<JobOfferRow | null> {
    const res = await query(
      `SELECT o.offer_id, o.company_id, o.semester_id, o.status,
              o.due_date::text AS due_date, o.submitted_at, o.reviewed_at,
              o.informant_name, o.informant_position, o.decline_reason,
              o.reject_reason, o.copied_from_offer_id
         FROM coop_job_offers o
        WHERE o.company_id = $1
        ORDER BY (o.status IN ('draft', 'submitted')) DESC, o.semester_id DESC, o.offer_id DESC
        LIMIT 1`,
      [companyId]
    );
    return (res.rowCount ?? 0) > 0 ? (res.rows[0] as JobOfferRow) : null;
  }

  static async findById(offerId: number): Promise<JobOfferRow | null> {
    const res = await query(
      `SELECT offer_id, company_id, semester_id, status, due_date::text AS due_date,
              submitted_at, reviewed_at, informant_name, informant_position,
              decline_reason, reject_reason, copied_from_offer_id
         FROM coop_job_offers WHERE offer_id = $1`,
      [offerId]
    );
    return (res.rowCount ?? 0) > 0 ? (res.rows[0] as JobOfferRow) : null;
  }

  /** ใบก่อนหน้าของบริษัทเดียวกันที่ตอบไปแล้ว — ต้นทางของปุ่ม "ใช้คำตอบเดิม" */
  static async findPreviousAnswered(companyId: number, beforeSemesterId: number) {
    const res = await query(
      `SELECT o.offer_id, o.semester_id,
              s.academic_year, s.semester,
              COUNT(j.job_id)::int          AS item_count,
              COALESCE(SUM(j.quota), 0)::int AS quota_total,
              COALESCE(SUM(j.applied_count), 0)::int AS accepted_count
         FROM coop_job_offers o
         JOIN coop_semesters s ON s.semester_id = o.semester_id
         LEFT JOIN job_posts j ON j.offer_id = o.offer_id
        WHERE o.company_id = $1
          AND o.semester_id < $2
          AND o.status IN ('submitted', 'reviewed')
        GROUP BY o.offer_id, o.semester_id, s.academic_year, s.semester
        ORDER BY o.semester_id DESC
        LIMIT 1`,
      [companyId, beforeSemesterId]
    );
    return (res.rowCount ?? 0) > 0 ? res.rows[0] : null;
  }

  /** รายการตำแหน่งในใบหนึ่งใบ พร้อมสาขาที่ต้องการ */
  static async listItems(offerId: number) {
    const res = await query(
      `SELECT j.job_id, j.title, j.description, j.quota, j.applied_count,
              j.duration_term, j.skills_required, j.other_requirements,
              j.pay_amount, j.pay_unit, j.accommodation, j.accommodation_cost,
              j.welfare_other, j.status, j.reject_reason,
              COALESCE(
                ARRAY_AGG(m.major_id ORDER BY m.major_id) FILTER (WHERE m.major_id IS NOT NULL),
                '{}'
              ) AS major_ids
         FROM job_posts j
         LEFT JOIN job_post_majors m ON m.job_id = j.job_id
        WHERE j.offer_id = $1
        GROUP BY j.job_id
        ORDER BY j.job_id`,
      [offerId]
    );
    return res.rows.map((r) => ({
      ...r,
      // NUMERIC กลับมาเป็นสตริงจาก pg — หน้าจอคาดหวังตัวเลข
      pay_amount: r.pay_amount === null ? null : Number(r.pay_amount),
      can_delete: r.applied_count === 0,
    }));
  }

  /**
   * ประวัติความร่วมมือ — ใช้บนการ์ดขวาล่างของหน้าแรกบริษัท
   *
   * ⛔ ทั้งสามตัวเลขใช้ subquery แยกกัน **ห้ามยุบเป็น LEFT JOIN หลายตัวแล้ว SUM**
   *    ตำแหน่ง 2 แถว x คำร้อง 2 แถว = 4 แถวหลัง join → โควตา 3 กลายเป็น 6
   *    (เจอจริงตอนทดสอบกับข้อมูล seed)
   *
   * ⛔ `evaluated_count` คือ "มีใบประเมิน สหกิจ 15 แล้วกี่คน" **ไม่ใช่ "ผ่านกี่คน"**
   *    ระบบนี้ไม่รู้ว่าใครผ่าน — อาจารย์เป็นผู้ตัดเกรดโดยใช้คะแนนชุดนี้ประกอบเท่านั้น
   *    ป้ายบนหน้าจอจึงต้องเขียนว่า "ประเมินครบ" ห้ามเขียนว่า "ผ่าน"
   */
  static async history(companyId: number) {
    const res = await query(
      `SELECT s.academic_year, s.semester,
              (SELECT COALESCE(SUM(j.quota), 0)::int
                 FROM job_posts j WHERE j.offer_id = o.offer_id) AS offered_quota,
              (SELECT COUNT(*)::int
                 FROM intent_forms i
                WHERE i.company_id = o.company_id
                  AND i.semester_id = o.semester_id
                  AND i.status = 'accepted') AS accepted_count,
              (SELECT COUNT(DISTINCT e.student_id)::int
                 FROM final_evaluations e
                 JOIN intent_forms i2 ON i2.student_id = e.student_id
                  AND i2.company_id = o.company_id
                  AND i2.semester_id = o.semester_id
                WHERE e.form_code = 'sahatkit_15') AS evaluated_count
         FROM coop_job_offers o
         JOIN coop_semesters s ON s.semester_id = o.semester_id
        WHERE o.company_id = $1 AND o.status IN ('submitted', 'reviewed')
        ORDER BY s.semester_id DESC
        LIMIT 8`,
      [companyId]
    );
    return res.rows;
  }

  /**
   * แถว token พร้อมข้อมูลที่ต้องใช้ตัดสินว่ายังใช้ได้ไหม
   *
   * ⛔ ตัดสิน "หมดอายุ" ด้วย `NOW()` ของ Postgres ไม่ใช่ของ Node — สองตัวนี้เพี้ยนกันได้
   *    และเวลาที่เขียน `expires_at` ลงไปก็มาจากฐาน จึงต้องเทียบกับนาฬิกาเรือนเดียวกัน
   */
  static async findToken(token: string) {
    const res = await query(
      `SELECT t.token_id, t.token, t.offer_id, t.used_at, t.expires_at,
              (t.expires_at <= NOW()) AS is_expired,
              o.company_id, o.status AS offer_status
         FROM job_offer_tokens t
         JOIN coop_job_offers o ON o.offer_id = t.offer_id
        WHERE t.token = $1`,
      [token]
    );
    return (res.rowCount ?? 0) > 0 ? res.rows[0] : null;
  }

  /** เผา token ทิ้งหลังใช้ตอบไปแล้ว — ใช้ครั้งเดียวจริง ๆ */
  static async burnToken(client: PoolClient, tokenId: number): Promise<void> {
    await client.query(`UPDATE job_offer_tokens SET used_at = NOW() WHERE token_id = $1`, [tokenId]);
  }

  /** ออก token ล่าสุดของใบนี้เมื่อไหร่ — ใช้คุมจังหวะการขอลิงก์ใหม่ */
  static async lastTokenIssuedAt(offerId: number): Promise<Date | null> {
    const res = await query(
      `SELECT MAX(created_at) AS last_at FROM job_offer_tokens WHERE offer_id = $1`,
      [offerId]
    );
    const value = res.rows[0]?.last_at;
    return value ? new Date(value) : null;
  }

  /**
   * อีเมลที่ระบบจะส่งลิงก์ไปให้ — **จากทะเบียนเท่านั้น**
   *
   * ⛔ ห้ามรับอีเมลปลายทางจากคำขอ ไม่ว่าในรูปแบบไหน — ไม่งั้นใครที่ถือลิงก์เก่า
   *    (หรือเดา token ถูก) ก็สั่งให้ระบบส่งลิงก์ของบริษัทอื่นเข้าเมลตัวเองได้
   */
  static async contactEmail(companyId: number): Promise<string | null> {
    const res = await query(
      `SELECT COALESCE(NULLIF(btrim(c.email), ''), NULLIF(btrim(u.email), '')) AS email
         FROM companies c
         LEFT JOIN users u ON u.user_id = c.created_by
        WHERE c.company_id = $1`,
      [companyId]
    );
    return res.rows[0]?.email ?? null;
  }

  /** ชื่อบริษัทและป้ายภาคเรียน — ใช้ประกอบเนื้ออีเมล */
  static async offerHeadline(offerId: number) {
    const res = await query(
      `SELECT c.name_th, s.academic_year, s.semester, o.due_date::text AS due_date
         FROM coop_job_offers o
         JOIN companies c ON c.company_id = o.company_id
         JOIN coop_semesters s ON s.semester_id = o.semester_id
        WHERE o.offer_id = $1`,
      [offerId]
    );
    const row = res.rows[0];
    return row
      ? {
          companyName: row.name_th as string,
          semesterLabel: `ภาคเรียนที่ ${row.semester}/${row.academic_year}`,
          dueDate: row.due_date as string | null,
        }
      : null;
  }

  /* ── ฝั่งเจ้าหน้าที่: เปิดใบแล้วส่งไปถาม ──────────────────────────── */

  /**
   * รายชื่อที่เจ้าหน้าที่เลือกไว้ พร้อมทุกอย่างที่ต้องใช้ตัดสินว่าส่งได้ไหม
   *
   * คืน **เฉพาะบริษัทที่มีอยู่จริง** — id ที่หายไปจากผลลัพธ์คือ id ที่ไม่มีในทะเบียน
   * ซึ่ง controller ต้องรายงานกลับใน `skipped[]` ไม่ใช่เงียบหายไป
   *
   * ⛔ ปลายทางคือ `companies.email` **เท่านั้น ไม่ตกไปที่ `users.email` ของ `created_by`**
   *    ต่างจาก `contactEmail` ที่ใช้ตอนขอลิงก์ใหม่ — ตรงนั้นผู้เรียกถือ token ของบริษัท
   *    ที่มีบัญชีของตัวเองอยู่แล้ว `created_by` จึงเป็นบัญชีของบริษัทเอง
   *    แต่แถวที่ **เจ้าหน้าที่เพิ่มเข้าทำเนียบเอง** มี `created_by` เป็นตัวเจ้าหน้าที่ —
   *    ถ้าตกไปใช้ค่านั้น แบบสำรวจจะถูกส่งกลับเข้าเมลของเจ้าหน้าที่แทนที่จะไปถึงบริษัท
   *    และเจ้าหน้าที่จะเห็นว่า "ส่งสำเร็จ" ทั้งที่ไม่มีใครที่บริษัทได้รับอะไรเลย
   *    (เจอตอนทดสอบ B4 — บริษัทที่เจ้าหน้าที่เพิ่มเองทุกแถวเข้าเงื่อนไขนี้)
   */
  static async listSendTargets(companyIds: number[], semesterId: number) {
    const res = await query(
      `SELECT c.company_id,
              c.name_th,
              NULLIF(btrim(c.email), '') AS email,
              o.offer_id AS existing_offer_id,
              o.status   AS existing_status
         FROM companies c
         LEFT JOIN coop_job_offers o
                ON o.company_id = c.company_id AND o.semester_id = $2
        WHERE c.company_id = ANY($1::int[])
        ORDER BY c.name_th`,
      [companyIds, semesterId]
    );
    return res.rows as {
      company_id: number;
      name_th: string;
      email: string | null;
      existing_offer_id: number | null;
      existing_status: string | null;
    }[];
  }

  /**
   * เปิดใบเปล่าสถานะ `draft` ให้บริษัทหนึ่งราย
   *
   * `ON CONFLICT DO NOTHING` ไม่ใช่ของประดับ — เจ้าหน้าที่สองคนกดส่งภาคเดียวกัน
   * พร้อมกันได้จริง และ `listSendTargets` อ่านไปก่อนหน้านี้แล้ว ช่องว่างระหว่าง
   * "อ่านว่ายังไม่มี" กับ "เขียน" จึงต้องมีตัวกันชนที่ระดับฐาน
   * คืน `null` = มีใบอยู่แล้ว (คนอื่นชิงสร้างไปก่อน) ให้ controller นับเป็นข้าม
   */
  static async createDraftOffer(
    client: PoolClient,
    companyId: number,
    semesterId: number,
    dueDate: string
  ): Promise<number | null> {
    const res = await client.query(
      `INSERT INTO coop_job_offers (company_id, semester_id, due_date, status)
       VALUES ($1, $2, $3, 'draft')
       ON CONFLICT ON CONSTRAINT coop_job_offers_company_semester_key DO NOTHING
       RETURNING offer_id`,
      [companyId, semesterId, dueDate]
    );
    return (res.rowCount ?? 0) > 0 ? (res.rows[0].offer_id as number) : null;
  }

  /**
   * เขียนรายการตำแหน่งทั้งชุดของใบหนึ่งใบ (แทนที่ของเดิม)
   *
   * ⛔ รายการที่มีคนสมัครแล้ว (`applied_count > 0`) ลบไม่ได้ — โยน Error ให้ controller
   *    ตอบ 409 · ตรรกะโควตาเต็มใน `controllers/acceptance.ts` และ `models/intent.ts`
   *    อ่านค่านี้อยู่ และคำร้องที่อ้าง `job_id` นั้นจะชี้ไปที่ความว่างเปล่า
   *    อยากเลิกรับตำแหน่งนั้นให้ตั้ง `status='closed'` แทน
   */
  static async replaceItems(
    client: PoolClient,
    offer: JobOfferRow,
    items: JobOfferItemInput[],
    userId: number
  ): Promise<void> {
    const existing = await client.query(
      `SELECT job_id, title, description, quota, duration_term, skills_required,
              other_requirements, pay_amount, pay_unit, accommodation,
              accommodation_cost, welfare_other, applied_count, status
         FROM job_posts WHERE offer_id = $1`,
      [offer.offer_id]
    );
    const previousById = new Map<number, Record<string, unknown>>(
      existing.rows.map((r) => [r.job_id as number, r])
    );

    const keptIds = new Set(
      items.map((i) => i.job_id).filter((id): id is number => typeof id === 'number')
    );
    const blocked = existing.rows.filter(
      (r) => !keptIds.has(r.job_id) && r.applied_count > 0
    );
    if (blocked.length > 0) {
      throw new Error(
        `ลบตำแหน่งที่มีนักศึกษายื่นเข้ามาแล้วไม่ได้: ${blocked
          .map((r) => r.title)
          .join(', ')} — ถ้าไม่ต้องการรับเพิ่มแล้วให้ใช้ปุ่มปิดรับตำแหน่งแทน`
      );
    }

    const removedIds = existing.rows
      .filter((r) => !keptIds.has(r.job_id))
      .map((r) => r.job_id);
    if (removedIds.length > 0) {
      await client.query(`DELETE FROM job_posts WHERE job_id = ANY($1::int[])`, [removedIds]);
    }

    for (const item of items) {
      const values = [
        (item.title ?? '').trim(),
        (item.description ?? '').trim(),
        Number(item.quota) > 0 ? Number(item.quota) : 1,
        item.duration_term ?? null,
        item.skills_required ?? null,
        item.other_requirements ?? null,
        item.pay_amount === null || item.pay_amount === undefined ? null : Number(item.pay_amount),
        item.pay_unit ?? null,
        item.accommodation ?? null,
        item.accommodation_cost ?? null,
        item.welfare_other ?? null,
      ];

      let jobId: number;
      if (typeof item.job_id === 'number' && keptIds.has(item.job_id)) {
        /**
         * รายการที่เปิดให้นักศึกษาเห็นแล้วและ **เนื้อหาเปลี่ยนจริง** ต้องกลับไปรอ
         * เจ้าหน้าที่ตรวจอีกครั้ง เพราะสิ่งที่นักศึกษาเห็นจะไม่ตรงกับที่เคยตรวจไว้
         *
         * ⛔ แต่ถ้าเนื้อหาไม่ได้เปลี่ยน **ห้ามถอดออกจากกระดานหางาน** — ของเดิมที่เขียนว่า
         *    "แก้ใบแล้วทั้งใบกลับไปรอตรวจ" ทำให้บริษัทที่แค่แก้เบอร์โทรของตัวเอง
         *    ทำให้ตำแหน่งที่นักศึกษากำลังสมัครอยู่หายไปจากกระดานกลางคัน
         */
        const before = previousById.get(item.job_id);
        const changed = before !== undefined && !sameItem(before, values);
        const upd = await client.query(
          `UPDATE job_posts
              SET title = $2, description = $3, quota = $4, duration_term = $5,
                  skills_required = $6, other_requirements = $7, pay_amount = $8,
                  pay_unit = $9, accommodation = $10, accommodation_cost = $11,
                  welfare_other = $12,
                  status = CASE WHEN $14::boolean AND status = 'published'
                                THEN 'pending_approval' ELSE status END
            WHERE job_id = $1 AND offer_id = $13
            RETURNING job_id`,
          [item.job_id, ...values, offer.offer_id, changed]
        );
        if ((upd.rowCount ?? 0) === 0) {
          // job_id ที่ส่งมาไม่ได้อยู่ในใบนี้ — ปฏิเสธ ไม่ใช่แอบสร้างใหม่ให้
          throw new Error('พบรายการตำแหน่งที่ไม่ได้อยู่ในแบบเสนองานใบนี้');
        }
        jobId = item.job_id;
      } else {
        const ins = await client.query(
          `INSERT INTO job_posts (company_id, offer_id, semester_id, created_by, applied_count,
                                  expire_date, status,
                                  title, description, quota, duration_term, skills_required,
                                  other_requirements, pay_amount, pay_unit, accommodation,
                                  accommodation_cost, welfare_other)
           VALUES ($1, $2, $3, $4, 0,
                   COALESCE($5::date, CURRENT_DATE + 30)::timestamp, 'pending_approval',
                   $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           RETURNING job_id`,
          [offer.company_id, offer.offer_id, offer.semester_id, userId, offer.due_date, ...values]
        );
        jobId = ins.rows[0].job_id;
      }

      await client.query(`DELETE FROM job_post_majors WHERE job_id = $1`, [jobId]);
      const majorIds = Array.from(new Set(item.major_ids ?? [])).filter((n) => Number.isInteger(n));
      for (const majorId of majorIds) {
        await client.query(
          `INSERT INTO job_post_majors (job_id, major_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [jobId, majorId]
        );
      }
    }
  }
}
