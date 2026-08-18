import { Request, Response } from 'express';
import { CompanyModel } from '../models/company';
import { GoogleSearchCompanyBody } from '../types';
import { sendUnexpectedError } from '../utils/httpError';

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
   * Verify a company in the database.
   * Route: PUT /api/companies/:id/verify
   * Access: staff, advisor, dean
   */
  static async verifyCompany(req: Request, res: Response): Promise<void> {
    try {
      const companyId = parseInt(req.params.id, 10);
      if (isNaN(companyId)) {
        res.status(400).json({ message: 'Invalid company ID format.' });
        return;
      }

      // Verify company exists
      const company = await CompanyModel.findById(companyId);
      if (!company) {
        res.status(404).json({ message: 'Company not found.' });
        return;
      }

      if (company.is_verified) {
        res.status(200).json({ message: 'Company is already verified.' });
        return;
      }

      // Verify the company
      await CompanyModel.verify(companyId);

      res.status(200).json({
        message: 'Company verified successfully.',
        company_id: companyId,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Verify Company Error', 'An internal server error occurred while verifying the company.');
    }
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
   * Get the logged-in company's details.
   * Route: GET /api/companies/my-company
   * Access: company
   */
  static async getMyCompany(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const { userId } = req.user;
      const company = await CompanyModel.findByCreatedBy(userId);
      if (!company) {
        res.status(404).json({ message: 'Company record not found for this user.' });
        return;
      }

      res.status(200).json(company);
    } catch (error) {
      sendUnexpectedError(res, error, 'Get My Company Error', 'An internal server error occurred while retrieving company profile.');
    }
  }

  /**
   * Update the logged-in company's contact info.
   * Route: PUT /api/companies/my-company/contact-info
   * Access: company
   */
  static async updateMyCompanyContactInfo(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ message: 'Unauthorized. Please log in.' });
        return;
      }

      const { userId } = req.user;
      const company = await CompanyModel.findByCreatedBy(userId);
      if (!company) {
        res.status(404).json({ message: 'Company record not found.' });
        return;
      }

      const { contact_person, contact_position, email } = req.body;

      if (!contact_person || !contact_position || !email) {
        res.status(400).json({ message: 'Required fields: contact_person, contact_position, email.' });
        return;
      }

      const updated = await CompanyModel.updateContactInfo(company.company_id, {
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
        company_id: company.company_id,
      });
    } catch (error) {
      sendUnexpectedError(res, error, 'Update My Company Contact Info Error', 'An internal server error occurred while updating contact info.');
    }
  }
}
