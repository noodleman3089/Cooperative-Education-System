import { Router } from 'express';
import { CompanyController } from '../controllers/company';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

// Protect all company directory endpoints with authentication
router.use(authenticateToken);

// Route: POST /api/companies/google-search (Used by students to search/insert)
router.post(
  '/google-search',
  authorizeRoles('student'),
  CompanyController.googleSearchCompany
);

// Route: GET /api/companies/my-company (Company role self-view)
router.get(
  '/my-company',
  authorizeRoles('company'),
  CompanyController.getMyCompany
);

// Route: PUT /api/companies/my-company/contact-info (Company role self-edit)
router.put(
  '/my-company/contact-info',
  authorizeRoles('company'),
  CompanyController.updateMyCompanyContactInfo
);

// Route: GET /api/companies (Company Directory with role-based filters)
router.get(
  '/',
  authorizeRoles('student', 'staff', 'advisor', 'dean'),
  CompanyController.getCompanies
);

// Route: PUT /api/companies/:id/verify (Co-op office only)
// SEC-06: verification marks a student-created company record as legitimate and
// gates the document pipeline, so it belongs to the co-op office — not to every
// advisor in the faculty.
router.put(
  '/:id/verify',
  authorizeRoles('staff', 'dean'),
  CompanyController.verifyCompany
);

// Route: PUT /api/companies/:id/contact-info (Staff only)
router.put(
  '/:id/contact-info',
  authorizeRoles('staff'),
  CompanyController.updateContactInfo
);

export default router;
