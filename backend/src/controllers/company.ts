import { Request, Response } from 'express';
import { CompanyModel } from '../models/company';
import { GoogleSearchCompanyBody } from '../types';
import { sendUnexpectedError } from '../utils/httpError';
import { AuditAction, writeAudit } from '../utils/audit';

export class CompanyController {
  /**
   * Search for a company using Google Place ID.
   * If it exists, returns the existing company_id.
   * If it doesn't, auto-inserts the company (is_verified = false) and returns the new company_id.
   * Route: POST /api/companies/google-search
   * Access: student
   */
  static async googleSearchCompany(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const body = req.body as GoogleSearchCompanyBody;
      const { google_place_id, name_th, name_en, address, province, district, postal_code, phone } = body;

      if (!google_place_id || typeof google_place_id !== 'string') {
        res.status(400).json({ message: 'google_place_id is required and must be a valid string.' });
        return;
      }

      // Check if it already exists in the database
      const existingCompany = await CompanyModel.findByGooglePlaceId(google_place_id);
      if (existingCompany) {
        res.status(200).json({
          message: 'Company already exists in directory.',
          company_id: existingCompany.company_id,
          is_verified: existingCompany.is_verified,
        });
        return;
      }

      // If it doesn't exist, we must validate that other fields are provided to perform the insert
      if (!name_th || !address || !province || !district || !postal_code || !phone) {
        res.status(400).json({
          message: 'Company not found. To create it, please provide: name_th, address, province, district, postal_code, phone.',
        });
        return;
      }

      // Create new unverified company record
      const studentUserId = req.user.userId;
      const newCompany = await CompanyModel.create({
        name_th,
        name_en: name_en || null,
        address,
        province,
        district,
        postal_code,
        phone,
        google_place_id,
        created_by: studentUserId,
      });

      res.status(201).json({
        message: 'New company successfully added to directory (pending verification).',
        company_id: newCompany.company_id,
        is_verified: newCompany.is_verified,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Google Search Company Error', 'An internal server error occurred during company lookup.');
    }
  }

  /**
   * รับรอง / ยกเลิกการรับรองสถานประกอบการ
   * Route: PUT /api/companies/:id/verify · PUT /api/companies/:id/unverify
   * Access: staff, dean
   *
   * การรับรองมีผลจริง 2 อย่าง: นักศึกษาเห็นบริษัทนี้ในทำเนียบ (CompanyModel.getCompanies)
   * และเจ้าหน้าที่ออกหนังสือราชการถึงบริษัทนี้ได้ (DocumentController.generateDocument)
   * — ข้อความบนหน้าจอต้องบอกแค่สองอย่างนี้ อย่าสัญญาเกินกว่าที่โค้ดทำ
   */
  private static async setVerification(req: Request, res: Response, verified: boolean): Promise<void> {
    const label = verified ? 'รับรอง' : 'ยกเลิกการรับรอง';
    try {
      const companyId = parseInt(req.params.id, 10);
      if (isNaN(companyId)) {
        res.status(400).json({ message: 'Invalid company ID format.' });
        return;
      }

      const company = await CompanyModel.findById(companyId);
      if (!company) {
        res.status(404).json({ message: 'Company not found.' });
        return;
      }

      if (company.is_verified === verified) {
        res.status(200).json({
          message: verified ? 'สถานประกอบการนี้ผ่านการรับรองอยู่แล้ว' : 'สถานประกอบการนี้ยังไม่ได้รับรองอยู่แล้ว',
          company_id: companyId,
        });
        return;
      }

      await CompanyModel.setVerified(companyId, verified);

      await writeAudit(
        {
          action: verified ? AuditAction.COMPANY_VERIFIED : AuditAction.COMPANY_UNVERIFIED,
          entityType: 'company',
          entityId: companyId,
          detail: { name_th: company.name_th },
        },
        req
      );

      res.status(200).json({
        message: `${label}สถานประกอบการเรียบร้อยแล้ว`,
        company_id: companyId,
      });
    } catch (error) {
      sendUnexpectedError(res, error, `Set Company Verification (${verified}) Error`, 'An internal server error occurred while verifying the company.');
    }
  }

  static async verifyCompany(req: Request, res: Response): Promise<void> {
    await CompanyController.setVerification(req, res, true);
  }

  static async unverifyCompany(req: Request, res: Response): Promise<void> {
    await CompanyController.setVerification(req, res, false);
  }

  /**
   * Get all companies in directory with filtering.
   * Route: GET /api/companies
   * Access: student, staff, advisor, dean
   */
  static async getCompanies(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const search = req.query.search ? String(req.query.search).trim() : undefined;
      let isVerified: boolean | undefined = undefined;

      if (req.query.is_verified !== undefined) {
        const isVerifiedStr = String(req.query.is_verified).toLowerCase();
        isVerified = isVerifiedStr === 'true' || isVerifiedStr === '1';
      }

      const userRoles = req.user.roles || [];

      const companies = await CompanyModel.getCompanies({ search, is_verified: isVerified }, userRoles);

      res.status(200).json(companies);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get Companies Directory Error', 'An internal server error occurred while retrieving the company directory.');
    }
  }

  /**
   * Update contact info for a company.
   * Route: PUT /api/companies/:id/contact-info
   * Access: staff
   */
  static async updateContactInfo(req: Request, res: Response): Promise<void> {
    try {
      const companyId = parseInt(req.params.id, 10);
      if (isNaN(companyId)) {
        res.status(400).json({ message: 'Invalid company ID format.' });
        return;
      }

      const { contact_person, contact_position, email } = req.body;

      if (!contact_person || !contact_position || !email) {
        res.status(400).json({ message: 'Required fields: contact_person, contact_position, email.' });
        return;
      }

      // Check company exists
      const company = await CompanyModel.findById(companyId);
      if (!company) {
        res.status(404).json({ message: 'Company not found.' });
        return;
      }

      const updated = await CompanyModel.updateContactInfo(companyId, {
        contact_person,
        contact_position,
        email,
      });

      if (!updated) {
        res.status(400).json({ message: 'Failed to update company contact info.' });
        return;
      }

      res.status(200).json({
        message: 'Company contact info updated successfully.',
        company_id: companyId,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Update Company Contact Info Error', 'An internal server error occurred while updating contact info.');
    }
  }

  /**
   * ตรวจฟิลด์ที่ทำเนียบต้องมีครบ และคืนค่าที่ trim แล้ว
   * ความยาวตรงกับความกว้างคอลัมน์ใน schema — กัน 22001 จาก pg ก่อนถึงฐานข้อมูล
   */
  private static readFields(body: Record<string, unknown>): { values?: Record<string, string | null>; error?: string } {
    const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
    const required: Array<[string, number, string]> = [
      ['name_th', 255, 'ชื่อสถานประกอบการ (ภาษาไทย)'],
      ['address', 255, 'ที่อยู่'],
      ['province', 100, 'จังหวัด'],
      ['district', 100, 'อำเภอ/เขต'],
      ['postal_code', 10, 'รหัสไปรษณีย์'],
      ['phone', 20, 'หมายเลขโทรศัพท์'],
    ];

    for (const [key, max, label] of required) {
      const value = text(key);
      if (!value) return { error: `กรุณากรอก${label}` };
      if (value.length > max) return { error: `${label}ยาวเกิน ${max} ตัวอักษร` };
    }

    const optional: Array<[string, number, string]> = [
      ['name_en', 255, 'ชื่อสถานประกอบการ (ภาษาอังกฤษ)'],
      ['contact_person', 255, 'ชื่อผู้ติดต่อ'],
      ['contact_position', 255, 'ตำแหน่งผู้ติดต่อ'],
      ['email', 255, 'อีเมล'],
    ];
    for (const [key, max, label] of optional) {
      if (text(key).length > max) return { error: `${label}ยาวเกิน ${max} ตัวอักษร` };
    }

    const values: Record<string, string | null> = {};
    for (const [key] of required) values[key] = text(key);
    for (const [key] of optional) values[key] = text(key) || null;
    return { values };
  }

  /**
   * เจ้าหน้าที่เพิ่มสถานประกอบการเข้าทำเนียบเอง
   * Route: POST /api/companies · Access: staff
   */
  static async createCompany(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const { values, error } = CompanyController.readFields(req.body);
      if (!values) {
        res.status(400).json({ message: error });
        return;
      }

      // Alternative flow ของ Use Case: กันข้อมูลซ้ำซ้อนตั้งแต่ตอนสร้าง
      const existing = await CompanyModel.findByNameTh(values.name_th!);
      if (existing) {
        res.status(409).json({
          message: 'ชื่อสถานประกอบการนี้มีอยู่ในระบบแล้ว',
          company_id: existing.company_id,
        });
        return;
      }

      const company = await CompanyModel.createByStaff({
        name_th: values.name_th!,
        name_en: values.name_en,
        address: values.address!,
        province: values.province!,
        district: values.district!,
        postal_code: values.postal_code!,
        phone: values.phone!,
        contact_person: values.contact_person,
        contact_position: values.contact_position,
        email: values.email,
        created_by: req.user.userId,
      });

      await writeAudit(
        {
          action: AuditAction.COMPANY_CREATED,
          entityType: 'company',
          entityId: company.company_id,
          detail: { name_th: company.name_th },
        },
        req
      );

      res.status(201).json({ message: 'บันทึกทำเนียบสถานประกอบการสำเร็จ', company });
    } catch (error) {
      sendUnexpectedError(res, error, 'Create Company Error', 'เกิดข้อผิดพลาดในการเพิ่มสถานประกอบการ');
    }
  }

  /**
   * เจ้าหน้าที่แก้ข้อมูลสถานประกอบการ (ทุกฟิลด์ ไม่ใช่แค่ผู้ติดต่อ)
   * Route: PUT /api/companies/:id · Access: staff
   */
  static async updateCompany(req: Request, res: Response): Promise<void> {
    try {
      const companyId = parseInt(req.params.id, 10);
      if (isNaN(companyId)) {
        res.status(400).json({ message: 'Invalid company ID format.' });
        return;
      }

      const company = await CompanyModel.findById(companyId);
      if (!company) {
        res.status(404).json({ message: 'Company not found.' });
        return;
      }

      const { values, error } = CompanyController.readFields(req.body);
      if (!values) {
        res.status(400).json({ message: error });
        return;
      }

      const duplicate = await CompanyModel.findByNameTh(values.name_th!, companyId);
      if (duplicate) {
        res.status(409).json({
          message: 'ชื่อสถานประกอบการนี้มีอยู่ในระบบแล้ว',
          company_id: duplicate.company_id,
        });
        return;
      }

      await CompanyModel.updateDetails(companyId, {
        name_th: values.name_th!,
        name_en: values.name_en,
        address: values.address!,
        province: values.province!,
        district: values.district!,
        postal_code: values.postal_code!,
        phone: values.phone!,
        contact_person: values.contact_person,
        contact_position: values.contact_position,
        email: values.email,
      });

      await writeAudit(
        {
          action: AuditAction.COMPANY_UPDATED,
          entityType: 'company',
          entityId: companyId,
          detail: { name_th: values.name_th },
        },
        req
      );

      res.status(200).json({ message: 'บันทึกทำเนียบสถานประกอบการสำเร็จ', company_id: companyId });
    } catch (error) {
      sendUnexpectedError(res, error, 'Update Company Error', 'เกิดข้อผิดพลาดในการแก้ไขสถานประกอบการ');
    }
  }

  /**
   * ลบสถานประกอบการออกจากทำเนียบ — ได้เฉพาะรายการที่ยังไม่มีใครใช้
   * Route: DELETE /api/companies/:id · Access: staff
   */
  static async deleteCompany(req: Request, res: Response): Promise<void> {
    try {
      const companyId = parseInt(req.params.id, 10);
      if (isNaN(companyId)) {
        res.status(400).json({ message: 'Invalid company ID format.' });
        return;
      }

      const company = await CompanyModel.findById(companyId);
      if (!company) {
        res.status(404).json({ message: 'Company not found.' });
        return;
      }

      const counts = await CompanyModel.countReferences(companyId);
      const labels: Record<string, string> = {
        intents: 'ใบแจ้งความจำนง',
        documents: 'เอกสารราชการ',
        mentors: 'พนักงานที่ปรึกษา',
        outlines: 'โครงร่างรายงาน',
        appointments: 'การนัดหมายนิเทศ',
      };
      const blocking = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([key, n]) => `${labels[key] ?? key} ${n} รายการ`);

      if (blocking.length > 0) {
        res.status(409).json({
          message: `ลบไม่ได้ เพราะมีข้อมูลผูกอยู่: ${blocking.join(' · ')}`,
          references: counts,
        });
        return;
      }

      await CompanyModel.remove(companyId);

      await writeAudit(
        {
          action: AuditAction.COMPANY_DELETED,
          entityType: 'company',
          entityId: companyId,
          detail: { name_th: company.name_th },
        },
        req
      );

      res.status(200).json({ message: 'ลบสถานประกอบการออกจากทำเนียบแล้ว', company_id: companyId });
    } catch (error) {
      sendUnexpectedError(res, error, 'Delete Company Error', 'เกิดข้อผิดพลาดในการลบสถานประกอบการ');
    }
  }
}
