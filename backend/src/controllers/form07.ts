import { Request, Response } from 'express';
import pool, { query } from '../config/database';
import { writeAudit } from '../utils/audit';
import { sendMentorInviteEmail } from '../utils/email';
import { getErrorMessage, sendUnexpectedError } from '../utils/httpError';
import { createInviteLink } from '../utils/invite';
import { buildForm07Pdf, type Form07PdfData } from '../utils/form07Pdf';

/**
 * แบบแจ้งรายละเอียดงาน ตำแหน่งงาน พนักงานที่ปรึกษา (สหกิจ 07 หน้า 1–2)
 *
 * ผู้ให้ข้อมูลตามกระดาษคือ "ผู้จัดการฝ่ายบุคคลหรือพนักงานที่ปรึกษา" และกำหนดส่งคืน
 * คือ **ภายในสัปดาห์แรกของการปฏิบัติงาน** ซึ่งคำนวณจาก `intent_forms.start_date`
 *
 * ⛔ หน้า 3 ของแบบฟอร์ม (แผนปฏิบัติงาน) **ไม่อยู่ที่นี่** — นักศึกษาเป็นผู้ร่างร่วมกับ
 *    พนักงานที่ปรึกษาและลงนามสองฝ่าย จึงอยู่ในเมนูของพี่เลี้ยง
 */
export class Form07Controller {
  /**
   * Route: GET /api/form07
   * Access: company
   */
  static async getForm(req: Request, res: Response): Promise<void> {
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const [company, mentors, students, deadline] = await Promise.all([
        fetchCompany(companyId),
        fetchMentors(companyId),
        fetchStudents(companyId),
        fetchDeadline(companyId),
      ]);

      res.status(200).json({ company, mentors, students, ...deadline });
    } catch (error) {
      sendUnexpectedError(res, error, 'Get form07 error', 'ไม่สามารถโหลดแบบแจ้งรายละเอียดงานได้');
    }
  }

  /**
   * Route: GET /api/form07/print
   * Access: company — พิมพ์ได้เฉพาะบริษัทของตัวเอง (บริษัทมาจาก token ไม่รับ `:id`)
   *
   * หน้า 1–2 ของกระดาษ จากข้อมูลที่บันทึกไว้ล่าสุด · หน้า 3 (แผนปฏิบัติงาน) ไม่อยู่ที่นี่
   */
  static async printForm(req: Request, res: Response): Promise<void> {
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const [company, mentors, students] = await Promise.all([
        fetchCompany(companyId),
        fetchMentors(companyId),
        fetchStudents(companyId),
      ]);

      const pdf = await buildForm07Pdf({
        company,
        mentors,
        students,
      } as unknown as Form07PdfData);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="coop07-company-${companyId}.pdf"`);
      res.status(200).send(pdf);
    } catch (error) {
      sendUnexpectedError(res, error, 'Print form07 error', 'ไม่สามารถสร้างแบบแจ้งรายละเอียดงาน (สหกิจ 07) ได้');
    }
  }

  /**
   * Route: PUT /api/form07
   * Access: company
   *
   * สามอย่างในทรานแซกชันเดียว: ข้อมูลบริษัท · พนักงานที่ปรึกษา · งานที่มอบหมายรายคน
   */
  static async updateForm(req: Request, res: Response): Promise<void> {
    const client = await pool.connect();
    try {
      const companyId = await requireOwnCompany(req, res);
      if (companyId === null) return;

      const body = req.body ?? {};
      await client.query('BEGIN');

      if (body.company && typeof body.company === 'object') {
        await updateCompanyFields(client, companyId, body.company);
      }

      const invited: { email: string; link: string }[] = [];
      if (Array.isArray(body.mentors)) {
        for (const m of body.mentors) {
          const created = await upsertMentor(client, companyId, m);
          if (created) invited.push(created);
        }
      }

      if (Array.isArray(body.assignments ?? body.students)) {
        await saveAssignments(client, companyId, body.assignments ?? body.students);
      }

      await client.query('COMMIT');

      // ⛔ ส่งอีเมลหลัง COMMIT เสมอ — ถ้าส่งก่อนแล้วทรานแซกชัน rollback
      //    พี่เลี้ยงจะได้ลิงก์เชิญไปยังบัญชีที่ไม่เคยมีอยู่จริง
      for (const inv of invited) {
        await sendMentorInviteEmail(inv.email, inv.link);
      }

      writeAudit(
        {
          action: 'form07.updated',
          entityType: 'company',
          entityId: companyId,
          detail: { invited: invited.map((i) => i.email) },
        },
        req
      ).catch(() => undefined);

      const [company, mentors, students, deadline] = await Promise.all([
        fetchCompany(companyId),
        fetchMentors(companyId),
        fetchStudents(companyId),
        fetchDeadline(companyId),
      ]);

      res.status(200).json({
        message: invited.length
          ? `บันทึกเรียบร้อยแล้ว และส่งลิงก์เชิญเข้าระบบให้พนักงานที่ปรึกษา ${invited.length} คน`
          : 'บันทึกแบบแจ้งรายละเอียดงาน ตำแหน่งงาน พนักงานที่ปรึกษา (สหกิจ 07) เรียบร้อยแล้ว',
        company,
        mentors,
        students,
        ...deadline,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message = getErrorMessage(error, '');
      if (message.includes('อีเมลนี้')) {
        res.status(409).json({ message });
        return;
      }
      if (message.includes('ไม่ได้อยู่ในความดูแล') || message.includes('ไม่ใช่พนักงานที่ปรึกษา')) {
        res.status(403).json({ message });
        return;
      }
      sendUnexpectedError(res, error, 'Update form07 error', 'ไม่สามารถบันทึกแบบแจ้งรายละเอียดงานได้');
    } finally {
      client.release();
    }
  }
}

/* ── ตัวช่วย ──────────────────────────────────────────────────────── */

type Client = { query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> };

async function requireOwnCompany(req: Request, res: Response): Promise<number | null> {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized. Please log in.' });
    return null;
  }
  const found = await query(
    `SELECT company_id FROM companies WHERE created_by = $1 ORDER BY company_id LIMIT 1`,
    [req.user.userId]
  );
  if ((found.rowCount ?? 0) === 0) {
    res.status(403).json({
      message: 'ไม่พบข้อมูลสถานประกอบการที่ผูกกับบัญชีนี้ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา',
    });
    return null;
  }
  return found.rows[0].company_id as number;
}

/**
 * ฟิลด์ที่บริษัทแก้ได้ผ่าน **สหกิจ 07 เท่านั้น**
 *
 * ต่างจาก allow-list ของ สหกิจ 02 ตรงที่มีที่อยู่รวมอยู่ด้วย — เพราะกระดาษ 07
 * สั่งตรง ๆ ว่า "โปรดระบุที่อยู่ตามสถานที่ที่นักศึกษาปฏิบัติงาน" ซึ่งเป็นข้อมูลที่
 * มีแต่บริษัทเท่านั้นที่รู้ และอาจารย์นิเทศใช้เดินทางจริง
 *
 * ⛔ ยังห้ามแก้ `name_th` `name_en` และ `is_verified` — ชื่อทางการเป็นของทะเบียนที่
 *    เจ้าหน้าที่รับรอง และถูกพิมพ์ลงใบรับรองภาษาอังกฤษของนักศึกษา
 */
const FORM07_WRITABLE_FIELDS = [
  'house_no', 'road', 'soi', 'subdistrict', 'district', 'province', 'postal_code',
  'phone', 'fax', 'email',
  'manager_name', 'manager_position', 'manager_department', 'manager_phone',
  'manager_fax', 'manager_email',
  'contact_mode', 'contact_person', 'contact_position', 'contact_department',
  'contact_phone', 'contact_fax',
] as const;

async function updateCompanyFields(client: Client, companyId: number, input: Record<string, unknown>) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const field of FORM07_WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      values.push(input[field] === '' ? null : input[field]);
      sets.push(`${field} = $${values.length}`);
    }
  }
  if (sets.length === 0) return;

  values.push(companyId);
  await client.query(
    `UPDATE companies SET ${sets.join(', ')} WHERE company_id = $${values.length}`,
    values
  );

  // ประกอบ `address` ใหม่จากช่องย่อย เพื่อให้หนังสือราชการที่วาดจากคอลัมน์เดิม
  // ยังได้ที่อยู่ล่าสุดโดยไม่ต้องแก้ตัวสร้างเอกสารสักตัว
  // ⛔ ทำเฉพาะเมื่อมีช่องย่อยอย่างน้อยหนึ่งช่อง — ไม่งั้นบริษัทที่ยังไม่เคยกรอกช่องย่อย
  //    จะถูกล้างที่อยู่เดิมที่เจ้าหน้าที่คีย์ไว้ทิ้งไปเฉย ๆ
  const touchesAddress = ['house_no', 'road', 'soi', 'subdistrict'].some((f) =>
    Object.prototype.hasOwnProperty.call(input, f)
  );
  if (touchesAddress) {
    await client.query(
      `UPDATE companies
          SET address = btrim(regexp_replace(
                concat_ws(' ',
                  NULLIF(btrim(coalesce(house_no, '')), ''),
                  -- รูปแบบเดียวกับที่อยู่ที่เจ้าหน้าที่คีย์ไว้เดิม
                  -- ("90 หมู่ 15 ถนนมิตรภาพ ตำบลสูงเนิน") เพื่อให้หนังสือราชการ
                  -- ที่พิมพ์จากคอลัมน์นี้หน้าตาไม่เปลี่ยนไปจากของเดิม
                  CASE WHEN NULLIF(btrim(coalesce(soi, '')), '') IS NOT NULL
                       THEN 'ซอย ' || soi END,
                  CASE WHEN NULLIF(btrim(coalesce(road, '')), '') IS NOT NULL
                       THEN 'ถนน' || road END,
                  CASE WHEN NULLIF(btrim(coalesce(subdistrict, '')), '') IS NOT NULL
                       THEN 'ตำบล' || subdistrict END
                ), '\\s+', ' ', 'g'))
        WHERE company_id = $1
          AND concat_ws('', house_no, soi, road, subdistrict) <> ''`,
      [companyId]
    );
  }
}

/**
 * เพิ่มหรือแก้พนักงานที่ปรึกษาหนึ่งคน · คืนข้อมูลลิงก์เชิญเมื่อเป็นบัญชีที่เพิ่งสร้าง
 *
 * ⛔ SEC-09: คนนอกเข้าระบบด้วย **ลิงก์เชิญใช้ครั้งเดียว** ไม่ใช่รหัสผ่านที่ส่งทางเมล
 * ⛔ SEC-03: **ห้ามแปะ role `mentor` ทับบัญชีที่มีอยู่แล้ว** — ตัวตนของพี่เลี้ยงต้องไม่ได้
 *    มาจากคำบอกเล่าของผู้เรียก ถ้าอีเมลนั้นมีบัญชีอยู่แล้วต้องปฏิเสธ ไม่ใช่ยึดบัญชีเขามา
 */
async function upsertMentor(
  client: Client,
  companyId: number,
  input: Record<string, unknown>
): Promise<{ email: string; link: string } | null> {
  const name = String(input.name ?? '').trim();
  const email = String(input.email ?? '').trim().toLowerCase();
  const phone = String(input.phone ?? '').trim();
  if (!name) return null;

  const position = emptyToNull(input.position);
  const department = emptyToNull(input.department);
  const fax = emptyToNull(input.fax);

  // แก้คนเดิม
  if (input.mentor_id !== null && input.mentor_id !== undefined && input.mentor_id !== '') {
    const mentorId = Number(input.mentor_id);
    const owned = await client.query(
      `UPDATE mentors SET name = $2, position = $3, department = $4, phone = $5, fax = $6
        WHERE mentor_id = $1 AND company_id = $7 RETURNING mentor_id`,
      [mentorId, name, position, department, phone || '-', fax, companyId]
    );
    if ((owned.rowCount ?? 0) === 0) {
      throw new Error('พนักงานที่ปรึกษาคนนี้ไม่ใช่พนักงานที่ปรึกษาของสถานประกอบการท่าน');
    }
    return null;
  }

  // คนใหม่ — ต้องมีอีเมลเพื่อส่งลิงก์เชิญ
  if (!email) {
    throw new Error('กรุณาระบุอีเมลของพนักงานที่ปรึกษา เพื่อให้ระบบส่งลิงก์เชิญเข้าใช้งานได้');
  }

  const existing = await client.query(`SELECT user_id FROM users WHERE lower(email) = $1`, [email]);
  if ((existing.rowCount ?? 0) > 0) {
    const userId = existing.rows[0].user_id as number;
    const alreadyMentor = await client.query(
      `SELECT 1 FROM mentors WHERE mentor_id = $1 AND company_id = $2`,
      [userId, companyId]
    );
    if ((alreadyMentor.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE mentors SET name = $2, position = $3, department = $4, phone = $5, fax = $6
          WHERE mentor_id = $1`,
        [userId, name, position, department, phone || '-', fax]
      );
      return null;
    }
    // SEC-03 — มีบัญชีอยู่แล้วแต่ยังไม่ใช่พี่เลี้ยงของบริษัทนี้ ⛔ ห้ามแปะ role ทับให้
    throw new Error(
      'อีเมลนี้มีบัญชีอยู่ในระบบแล้ว จึงเพิ่มเป็นพนักงานที่ปรึกษาจากหน้านี้ไม่ได้ กรุณาติดต่อเจ้าหน้าที่งานสหกิจศึกษา'
    );
  }

  const created = await client.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, NULL) RETURNING user_id`,
    [email]
  );
  const userId = created.rows[0].user_id as number;
  await client.query(
    `INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'mentor') ON CONFLICT DO NOTHING`,
    [userId]
  );
  await client.query(
    `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone, fax)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, companyId, name, position, department, phone || '-', fax]
  );

  const link = await createInviteLink(userId, client as never);
  return { email, link };
}

/**
 * ตารางงานที่มอบหมายนักศึกษา (กลางหน้า 2 ของกระดาษ)
 *
 * ⛔ รายชื่อมาจากคำร้องที่ตอบรับแล้วเท่านั้น **เพิ่มคนเองไม่ได้** — `WHERE` ที่ผูก
 *    ทั้ง `company_id` และ `status = 'accepted'` คือด่านนั้น
 */
async function saveAssignments(client: Client, companyId: number, rows: unknown[]) {
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const studentId = Number(row.student_id);
    if (!Number.isInteger(studentId)) continue;

    const mentorId = row.mentor_id === null || row.mentor_id === undefined || row.mentor_id === ''
      ? null
      : Number(row.mentor_id);

    if (mentorId !== null) {
      const ok = await client.query(
        `SELECT 1 FROM mentors WHERE mentor_id = $1 AND company_id = $2`,
        [mentorId, companyId]
      );
      if ((ok.rowCount ?? 0) === 0) {
        throw new Error('เลือกพนักงานที่ปรึกษาที่ไม่ใช่ของสถานประกอบการท่านไม่ได้');
      }
    }

    const updated = await client.query(
      `UPDATE intent_forms
          SET job_position = $3, job_description = $4, mentor_id = COALESCE($5, mentor_id)
        WHERE student_id = $1 AND company_id = $2 AND status = 'accepted'`,
      [studentId, companyId, emptyToNull(row.job_position), emptyToNull(row.job_description), mentorId]
    );
    if ((updated.rowCount ?? 0) === 0) {
      throw new Error('นักศึกษาบางคนในรายการไม่ได้อยู่ในความดูแลของสถานประกอบการท่าน');
    }
  }
}

function emptyToNull(value: unknown): string | null {
  if (typeof value !== 'string') return (value ?? null) as string | null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

async function fetchCompany(companyId: number) {
  const res = await query(
    `SELECT company_id, name_th, name_en, address, house_no, road, soi, subdistrict,
            district, province, postal_code, phone, fax, email, is_verified,
            business_type, employee_count,
            manager_name, manager_position, manager_department, manager_phone,
            manager_fax, manager_email,
            contact_mode, contact_person, contact_position, contact_department,
            contact_phone, contact_fax
       FROM companies WHERE company_id = $1`,
    [companyId]
  );
  return res.rows[0] ?? null;
}

async function fetchMentors(companyId: number) {
  const res = await query(
    `SELECT m.mentor_id, m.name, m.position, m.department, m.phone, m.fax,
            u.email, (u.password_hash IS NOT NULL) AS has_account,
            (SELECT COUNT(*)::int FROM intent_forms i
              WHERE i.mentor_id = m.mentor_id AND i.status = 'accepted') AS student_count
       FROM mentors m JOIN users u ON u.user_id = m.mentor_id
      WHERE m.company_id = $1
      ORDER BY m.name`,
    [companyId]
  );
  return res.rows;
}

async function fetchStudents(companyId: number) {
  const res = await query(
    `SELECT s.student_id, s.student_code,
            btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) AS full_name,
            mj.major_name_th, i.mentor_id, i.job_position, i.job_description,
            i.start_date
       FROM intent_forms i
       JOIN students s ON s.student_id = i.student_id
       LEFT JOIN master_major mj ON mj.major_id = s.major_id
      WHERE i.company_id = $1 AND i.status = 'accepted'
      ORDER BY s.student_code`,
    [companyId]
  );
  return res.rows.map((r) => ({
    ...r,
    start_date: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : null,
  }));
}

/**
 * กำหนดส่ง = **ภายในสัปดาห์แรกของการปฏิบัติงาน** ตามที่กระดาษเขียนไว้เอง
 * นับจากวันเริ่มงานของนักศึกษาคนแรกที่เริ่มก่อน ⛔ ห้ามฮาร์ดโค้ดวัน
 */
async function fetchDeadline(companyId: number) {
  const res = await query(
    `SELECT (MIN(i.start_date) + 6) AS due_date,
            ((MIN(i.start_date) + 6) - (NOW() AT TIME ZONE 'Asia/Bangkok')::date) AS days_left,
            ((MIN(i.start_date) + 6) < (NOW() AT TIME ZONE 'Asia/Bangkok')::date) AS is_overdue
       FROM intent_forms i
      WHERE i.company_id = $1 AND i.status = 'accepted' AND i.start_date IS NOT NULL`,
    [companyId]
  );
  const row = res.rows[0] ?? {};
  return {
    due_date: row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : null,
    days_left: row.days_left === null || row.days_left === undefined ? null : Number(row.days_left),
    is_overdue: row.is_overdue === true,
  };
}
