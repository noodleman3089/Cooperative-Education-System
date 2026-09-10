import { Router } from 'express';
import { MasterDataController } from '../controllers/masterData';
import { authenticateToken, authorizeRoles } from '../middlewares/auth';

const router = Router();

/**
 * ข้อมูลหลักของมหาวิทยาลัย — คณะ · สาขา · จังหวัด · ภาคเรียน
 *
 * ⛔ **ไฟล์นี้ไม่มีด่านระดับไฟล์โดยตั้งใจ** — `GET /` ต้องเปิดสาธารณะ เพราะหน้าสมัคร
 *    และหน้าล็อกอินใช้เติม dropdown ตั้งแต่ก่อนจะมี session
 *    เส้นที่ **เขียน** ทุกเส้นจึงต้องแปะ `authenticateToken` + `authorizeRoles('staff')`
 *    ของตัวเองทีละเส้น · ห้ามเผลอย้าย `GET /` ไปอยู่ใต้ด่าน และห้ามเพิ่มเส้นเขียน
 *    โดยไม่ใส่ด่าน (ไม่มี `router.use` ให้พึ่ง — ลืมแล้วเปิดโล่ง ไม่ใช่ 401)
 */

// Route: GET /api/master-data — เปิดสาธารณะ
router.get('/', MasterDataController.getMasterData);

const staffOnly = [authenticateToken, authorizeRoles('staff')];

// คณะ
router.post('/faculties', staffOnly, MasterDataController.createFaculty);
router.put('/faculties/:id', staffOnly, MasterDataController.updateFaculty);
router.delete('/faculties/:id', staffOnly, MasterDataController.deleteFaculty);

// สาขาวิชา
router.post('/majors', staffOnly, MasterDataController.createMajor);
router.put('/majors/:id', staffOnly, MasterDataController.updateMajor);
router.delete('/majors/:id', staffOnly, MasterDataController.deleteMajor);

export default router;
