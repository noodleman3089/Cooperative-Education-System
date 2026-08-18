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
   * Verify a company by setting is_verified to true.
   */
  static async verify(companyId: number): Promise<boolean> {
    const res = await query(
      'UPDATE companies SET is_verified = TRUE WHERE company_id = $1',
      [companyId]
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
    let paramIndex = 1;

    const isStudent = userRoles.includes('student');
    const isStaffGroup = userRoles.some(role => ['staff', 'advisor', 'dean'].includes(role));

    // Force is_verified = true if student. Otherwise, allow filtering for staff/admin group.
    if (isStudent) {
      conditions.push('is_verified = TRUE');
    } else if (isStaffGroup) {
      if (filters.is_verified !== undefined) {
        conditions.push(`is_verified = $${paramIndex}`);
        values.push(filters.is_verified);
        paramIndex++;
      }
    } else {
      // Safe fallback for other roles: only return verified companies
      conditions.push('is_verified = TRUE');
    }

    // Search filter (partial match ILIKE on name_th or name_en)
    if (filters.search) {
      conditions.push(`(name_th ILIKE $${paramIndex} OR name_en ILIKE $${paramIndex})`);
      values.push(`%${filters.search}%`);
      paramIndex++;
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
}
