import { query } from '../config/database';
import { Company } from '../types';

export class CompanyModel {
  /**
   * Find a company by its unique google_place_id (used for deduplication).
   */
  static async findByGooglePlaceId(googlePlaceId: string): Promise<Company | null> {
    const res = await query(
      `SELECT company_id, name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by, contact_person, contact_position, email 
       FROM companies 
       WHERE google_place_id = $1`,
      [googlePlaceId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Company;
  }

  /**
   * Find a company by its primary key id.
   */
  static async findById(companyId: number): Promise<Company | null> {
    const res = await query(
      `SELECT company_id, name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by, contact_person, contact_position, email 
       FROM companies 
       WHERE company_id = $1`,
      [companyId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Company;
  }

  /**
   * Find a company by its creator user ID.
   */
  static async findByCreatedBy(userId: number): Promise<Company | null> {
    const res = await query(
      `SELECT company_id, name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by, contact_person, contact_position, email 
       FROM companies 
       WHERE created_by = $1 LIMIT 1`,
      [userId]
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Company;
  }

  /**
   * Create a new company record (default is_verified is false).
   */
  static async create(companyData: {
    name_th: string;
    name_en?: string | null;
    address: string;
    province: string;
    district: string;
    postal_code: string;
    phone: string;
    google_place_id: string | null;
    created_by: number;
  }): Promise<Company> {
    const res = await query(
      `INSERT INTO companies (name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9)
       RETURNING company_id, name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by, contact_person, contact_position, email`,
      [
        companyData.name_th,
        companyData.name_en || null,
        companyData.address,
        companyData.province,
        companyData.district,
        companyData.postal_code,
        companyData.phone,
        companyData.google_place_id,
        companyData.created_by,
      ]
    );
    return res.rows[0] as Company;
  }

  /**
   * Set (or clear) the co-op office's endorsement of a company.
   *
   * เดิมมีแต่ทางไป — กดรับรองผิดแล้วต้องไปแก้ที่ฐานข้อมูลเอง ซึ่งไม่ใช่สิ่งที่
   * เจ้าหน้าที่ทำได้ · การรับรองคุมว่านักศึกษาเห็นบริษัทนี้ไหม และคุมว่าออกหนังสือ
   * ราชการถึงบริษัทนี้ได้ไหม (ดู DocumentController.generateDocument) จึงต้องถอยได้
   */
  static async setVerified(companyId: number, verified: boolean): Promise<boolean> {
    const res = await query(
      'UPDATE companies SET is_verified = $2 WHERE company_id = $1',
      [companyId, verified]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Get list of companies dynamically based on search, verification status, and user role.
   */
  static async getCompanies(
    filters: { search?: string; is_verified?: boolean },
    userRoles: string[]
  ): Promise<Company[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const isStudent = userRoles.includes('student');
    const isStaffGroup = userRoles.some(role => ['staff', 'advisor', 'dean'].includes(role));

    // Force is_verified = true if student. Otherwise, allow filtering for staff/admin group.
    if (isStudent) {
      conditions.push('is_verified = TRUE');
    } else if (isStaffGroup) {
      if (filters.is_verified !== undefined) {
        conditions.push(`is_verified = $${values.length + 1}`);
        values.push(filters.is_verified);
      }
    } else {
      // Safe fallback for other roles: only return verified companies
      conditions.push('is_verified = TRUE');
    }

    // Search filter (partial match ILIKE on name_th or name_en)
    if (filters.search) {
      conditions.push(`(name_th ILIKE $${values.length + 1} OR name_en ILIKE $${values.length + 1})`);
      values.push(`%${filters.search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT company_id, name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by, contact_person, contact_position, email 
      FROM companies 
      ${whereClause} 
      ORDER BY name_th ASC
    `;

    const res = await query(sql, values);
    return res.rows as Company[];
  }

  /**
   * Update contact person, contact position, and email for a company.
   */
  static async updateContactInfo(
    companyId: number,
    contactData: { contact_person: string; contact_position: string; email: string }
  ): Promise<boolean> {
    const res = await query(
      `UPDATE companies 
       SET contact_person = $1, contact_position = $2, email = $3 
       WHERE company_id = $4`,
      [
        contactData.contact_person,
        contactData.contact_position,
        contactData.email,
        companyId
      ]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * หาบริษัทจากชื่อไทยแบบไม่สนตัวพิมพ์และช่องว่างหัวท้าย — ใช้กันชื่อซ้ำตอนเจ้าหน้าที่
   * เพิ่มเอง · `google_place_id` ที่ UNIQUE กันซ้ำได้เฉพาะรายการที่มาจาก Google
   * ส่วนรายการที่กรอกมือ (ทั้งของนักศึกษาที่หาที่ฝึกเองและของเจ้าหน้าที่) ไม่มีอะไรกันเลย
   */
  static async findByNameTh(nameTh: string, excludeId?: number): Promise<Company | null> {
    const values: unknown[] = [nameTh.trim()];
    let sql = `SELECT company_id, name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by, contact_person, contact_position, email FROM companies WHERE LOWER(TRIM(name_th)) = LOWER($1)`;
    if (excludeId !== undefined) {
      sql += ' AND company_id <> $2';
      values.push(excludeId);
    }
    const res = await query(sql + ' LIMIT 1', values);
    if ((res.rowCount ?? 0) === 0) return null;
    return res.rows[0] as Company;
  }

  /**
   * เจ้าหน้าที่เพิ่มบริษัทเข้าทำเนียบเอง — รับรองทันทีเพราะคนกรอกคือคณะเอง
   * (ต่างจาก `create` ซึ่งเป็นทางของนักศึกษาและได้ is_verified = FALSE)
   *
   * รองรับกระบวนการจริงตาม สหกิจ 02: คณะส่งแบบสำรวจไปสถานประกอบการล่วงหน้า
   * หนึ่งภาคเรียน แล้วนำรายที่ตอบกลับมาเข้าฐานข้อมูล — เดิมทำไม่ได้เลย
   * บริษัทเข้าระบบได้ทางเดียวคือรอให้นักศึกษาไปค้นเจอเอง
   */
  static async createByStaff(companyData: {
    name_th: string;
    name_en?: string | null;
    address: string;
    province: string;
    district: string;
    postal_code: string;
    phone: string;
    contact_person?: string | null;
    contact_position?: string | null;
    email?: string | null;
    created_by: number;
  }): Promise<Company> {
    const res = await query(
      `INSERT INTO companies (name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by, contact_person, contact_position, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, TRUE, $8, $9, $10, $11)
       RETURNING company_id, name_th, name_en, address, province, district, postal_code, phone, google_place_id, is_verified, created_by, contact_person, contact_position, email`,
      [
        companyData.name_th.trim(),
        companyData.name_en?.trim() || null,
        companyData.address.trim(),
        companyData.province.trim(),
        companyData.district.trim(),
        companyData.postal_code.trim(),
        companyData.phone.trim(),
        companyData.created_by,
        companyData.contact_person?.trim() || null,
        companyData.contact_position?.trim() || null,
        companyData.email?.trim() || null,
      ]
    );
    return res.rows[0] as Company;
  }

  /**
   * แก้ข้อมูลบริษัททุกฟิลด์ที่เจ้าหน้าที่แก้ได้
   *
   * ต่างจาก `updateContactInfo` ที่แก้ได้แค่ผู้ติดต่อ — ตัวนั้นเป็นของ role `company`
   * ที่แก้ข้อมูลตัวเอง จึงจงใจแตะชื่อ/ที่อยู่ของตัวเองไม่ได้
   */
  static async updateDetails(
    companyId: number,
    data: {
      name_th: string;
      name_en?: string | null;
      address: string;
      province: string;
      district: string;
      postal_code: string;
      phone: string;
      contact_person?: string | null;
      contact_position?: string | null;
      email?: string | null;
    }
  ): Promise<boolean> {
    const res = await query(
      `UPDATE companies
       SET name_th = $2, name_en = $3, address = $4, province = $5, district = $6,
           postal_code = $7, phone = $8, contact_person = $9, contact_position = $10, email = $11
       WHERE company_id = $1`,
      [
        companyId,
        data.name_th.trim(),
        data.name_en?.trim() || null,
        data.address.trim(),
        data.province.trim(),
        data.district.trim(),
        data.postal_code.trim(),
        data.phone.trim(),
        data.contact_person?.trim() || null,
        data.contact_position?.trim() || null,
        data.email?.trim() || null,
      ]
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * นับว่ามีอะไรผูกกับบริษัทนี้อยู่บ้าง ก่อนยอมให้ลบ
   *
   * ⛔ ต้องนับเองทั้ง 6 ตาราง ห้ามพึ่ง ON DELETE ของ FK — เพราะ `job_posts` เป็น
   * CASCADE ตัวเดียวในกลุ่ม ถ้าปล่อยให้ฐานข้อมูลจัดการ การลบบริษัทจะลบประกาศงาน
   * ทิ้งไปด้วยเงียบๆ ส่วนอีก 5 ตารางเป็น RESTRICT ซึ่งจะโยน error ดิบออกมาแทน
   * ที่จะบอกผู้ใช้ได้ว่าติดอะไรอยู่
   */
  static async countReferences(companyId: number): Promise<Record<string, number>> {
    const res = await query(
      `SELECT
         (SELECT COUNT(*) FROM intent_forms WHERE company_id = $1) AS intents,
         (SELECT COUNT(*) FROM job_posts WHERE company_id = $1) AS jobs,
         (SELECT COUNT(*) FROM official_documents WHERE company_id = $1) AS documents,
         (SELECT COUNT(*) FROM mentors WHERE company_id = $1) AS mentors,
         (SELECT COUNT(*) FROM report_outlines WHERE company_id = $1) AS outlines,
         (SELECT COUNT(*) FROM supervision_appointments WHERE company_id = $1) AS appointments`,
      [companyId]
    );
    const row = res.rows[0];
    const counts: Record<string, number> = {};
    for (const key of Object.keys(row)) counts[key] = Number(row[key]);
    return counts;
  }

  static async remove(companyId: number): Promise<boolean> {
    const res = await query('DELETE FROM companies WHERE company_id = $1', [companyId]);
    return (res.rowCount ?? 0) > 0;
  }
}
