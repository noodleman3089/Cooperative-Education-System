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

// Route: POST /api/companies (Staff only)
// เจ้าหน้าที่เพิ่มสถานประกอบการเข้าทำเนียบเอง — รองรับ สหกิจ 02 ที่คณะสำรวจบริษัท
// ล่วงหน้าหนึ่งภาคเรียน · เดิมบริษัทเข้าระบบได้ทางเดียวคือรอให้นักศึกษาไปค้นเจอเอง
router.post('/', authorizeRoles('staff'), CompanyController.createCompany);

// Route: PUT /api/companies/:id/verify · PUT /api/companies/:id/unverify (Co-op office)
// SEC-06: การรับรองคือการยืนยันว่าแถวที่นักศึกษาสร้างขึ้นมีอยู่จริง และเป็นเงื่อนไข
// ของการออกหนังสือราชการ (DocumentController.generateDocument) จึงเป็นงานของ
// งานสหกิจศึกษา ไม่ใช่ของอาจารย์ทุกคนในคณะ
router.put('/:id/verify', authorizeRoles('staff', 'dean'), CompanyController.verifyCompany);
router.put('/:id/unverify', authorizeRoles('staff', 'dean'), CompanyController.unverifyCompany);

// Route: PUT /api/companies/:id (Staff only) — แก้ได้ทุกฟิลด์
router.put('/:id', authorizeRoles('staff'), CompanyController.updateCompany);

// Route: DELETE /api/companies/:id (Staff only) — เฉพาะรายการที่ยังไม่มีใครใช้
router.delete('/:id', authorizeRoles('staff'), CompanyController.deleteCompany);

// Route: PUT /api/companies/:id/contact-info (Staff only)
// ยังคงไว้เพื่อความเข้ากันได้ — แก้เฉพาะผู้ติดต่อ 3 ฟิลด์
router.put(
  '/:id/contact-info',
  authorizeRoles('staff'),
  CompanyController.updateContactInfo
);

export default router;
