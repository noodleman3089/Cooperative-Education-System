import fs from 'fs';
import path from 'path';
import { withDb, ensureLegacyTemplate } from './db';
import { BACKEND_ROOT } from './env';

/**
 * จัดฉาก "เอกสารราชการที่ออกไปแล้วและรอคณบดีลงนาม"
 *
 * การ *ออก* เอกสารถูกโละเมื่อ 2026-08-26 พร้อมแม่แบบ HTML ทั้งชุด แต่การ *ลงนาม*
 * ยังอยู่ในระบบจริง เทสต์ที่เคยกดออกเอกสารผ่านหน้าจอเจ้าหน้าที่จึงต้องยัดแถวเอง
 *
 * ต้องมีไฟล์ PDF จริงบนดิสก์ด้วย ไม่ใช่แค่แถวในฐาน — `batchSignDocuments` เปิดไฟล์
 * ที่ `generated_file_path` เพื่อแปะลายเซ็นลงไป ถ้าไม่มีไฟล์มันจะข้ามเอกสารนั้น
 * แล้วรายงานว่า 'PDF file not found on disk' ซึ่งเทสต์จะเห็นเป็น "ลงนามสำเร็จ 0 ใบ"
 *
 * ต้นแบบคือ `e2e/fixtures/mock_official_letter.pdf` ซึ่งเป็น PDF หนึ่งหน้าที่ `pdf-lib`
 * เปิดได้จริง · **ห้ามใช้ไฟล์จำลองที่เป็นแค่ magic bytes** ถึงจะนามสกุล .pdf เหมือนกัน —
 * ไฟล์พวกนั้นไม่มีโครงสร้าง PDF จริง ใช้ทดสอบการอัปโหลดได้เท่านั้น พอเอามาให้คณบดี
 * ลงนามจริงจะได้ 'No PDF header found' แล้วเทสต์จะเห็นเป็น "ลงนาม 0 ใบ"
 */
export async function seedPendingSignDocument(
  studentEmail = 'student2@test.com'
): Promise<number> {
  const templateId = await ensureLegacyTemplate();

  const fileName = `e2e_pending_sign_${Date.now()}.pdf`;
  const relativePath = path.posix.join('secure_private', 'documents', fileName);
  const absolutePath = path.join(BACKEND_ROOT, relativePath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '../fixtures/mock_official_letter.pdf'), absolutePath);

  return withDb(async (db) => {
    const studentId = (
      await db.query('SELECT user_id FROM users WHERE email = $1', [studentEmail])
    ).rows[0].user_id;
    const companyId = (await db.query('SELECT company_id FROM companies LIMIT 1')).rows[0]
      .company_id;

    const inserted = await db.query(
      `INSERT INTO official_documents
         (document_number, type, student_id, company_id, template_id, generated_file_path, status)
       VALUES ($1, 'cover_letter', $2, $3, $4, $5, 'pending_sign')
       RETURNING doc_id`,
      [`อว.e2e/${Date.now()}`, studentId, companyId, templateId, relativePath]
    );
    return inserted.rows[0].doc_id as number;
  });
}
