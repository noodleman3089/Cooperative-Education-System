import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables for direct seeder execution
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

import pool from '../../backend/src/config/database';
import { setupDatabase } from '../../backend/src/db/setup';

/**
 * Resets the database to a known state before a test runs. That reset is what
 * makes these tests independent of each other and of the order they run in,
 * and is worth keeping.
 *
 * It used to shell out to `npm run db:setup`, which spawned node and compiled
 * setup.ts through ts-node every time — 2.5s of which nearly all was startup,
 * 41 times a run. Calling it in-process costs the SQL and nothing else.
 */
export async function seedTestData() {
  await setupDatabase(true);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 3. Find User IDs
    const studentRes = await client.query("SELECT user_id FROM users WHERE email = 'student2@test.com'");
    const advisorRes = await client.query("SELECT user_id FROM users WHERE email = 'advisor1@test.com'");
    const staffRes = await client.query("SELECT user_id FROM users WHERE email = 'staff1@test.com'");

    if (studentRes.rowCount === 0 || advisorRes.rowCount === 0 || staffRes.rowCount === 0) {
      throw new Error('Required default users are missing after db:setup.');
    }

    const studentId = studentRes.rows[0].user_id;
    const advisorId = advisorRes.rows[0].user_id;
    const staffId = staffRes.rows[0].user_id;
    // บริษัทไม่มีบัญชีแล้ว — เจ้าหน้าที่เป็นผู้บันทึกบริษัทของ seed (companies.created_by)
    const companyUserId = staffId;

    // 4. advisor1 เป็นทั้งอาจารย์ที่ปรึกษาและอาจารย์นิเทศของ student2 (กรณีที่พบบ่อยที่สุด)
    //    ⛔ ต้องตั้งทั้งสองคอลัมน์ — ตั้งแต่ SB-F9 งานนิเทศ (สหกิจ 12 · 13) เขียนได้เฉพาะ supervisor_id
    //    ถ้าตั้งแค่ advisor_id เคสยาวที่ร่างนัดนิเทศจะได้ 403 ทั้งชุด
    //    · เคสที่ต้องการแยกสองหน้าที่ให้ตั้งเองในไฟล์นั้น (faculty-duty-split.spec.ts)
    await client.query(
      'UPDATE students SET advisor_id = $1, supervisor_id = $1 WHERE student_id = $2',
      [advisorId, studentId]
    );

    // 5. Delete existing companies to avoid constraint conflicts or duplicates
    await client.query('DELETE FROM intent_forms');
    // mentors.company_id เป็น FK RESTRICT — ต้องลบพี่เลี้ยงก่อนบริษัท
    await client.query('DELETE FROM mentors');
    await client.query('DELETE FROM companies');

    // 6. Insert Test Company (Seagate Technology)
    const companyInsertRes = await client.query(
      `INSERT INTO companies (
        name_th, address, province, district, postal_code, phone,
        is_verified, created_by, contact_person, contact_position, email
      ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $10) RETURNING company_id`,
      [
        'บริษัท ซีเกท เทคโนโลยี (ประเทศไทย) จำกัด',
        '90 หมู่ 15 ถนนมิตรภาพ ตำบลสูงเนิน',
        'นครราชสีมา',
        'สูงเนิน',
        '30170',
        '021234567',
        companyUserId,
        'HR Manager Seagate',
        'HR Specialist',
        'company1@test.com'
      ]
    );
    const companyId = companyInsertRes.rows[0].company_id;

    // 6b. mentor1 = พี่เลี้ยงของบริษัทนี้ (บัญชี role mentor ล้วน)
    await client.query(
      `INSERT INTO mentors (mentor_id, company_id, name, position, department, phone)
       SELECT user_id, $1, 'สมศักดิ์ รักเรียน', 'Lead Engineer', 'Software Dept', '0819998888'
         FROM users WHERE email = 'mentor1@test.com'`,
      [companyId]
    );

    // 9. Create advisor2 from a DIFFERENT major (IT01) for Major Mismatch Guard testing
    const advisor2Check = await client.query("SELECT user_id FROM users WHERE email = 'advisor2@test.com'");
    let advisor2Id: number;
    if (advisor2Check.rowCount === 0) {
      // Import hash utility
      const { hashPassword: hashPw } = await import('../../backend/src/utils/password');
      const hashedPw = await hashPw('password123');
      const advisor2Insert = await client.query(
        "INSERT INTO users (email, password_hash) VALUES ('advisor2@test.com', $1) RETURNING user_id",
        [hashedPw]
      );
      advisor2Id = advisor2Insert.rows[0].user_id;
      await client.query(
        "INSERT INTO user_roles (user_id, role_name) VALUES ($1, 'advisor')",
        [advisor2Id]
      );
    } else {
      advisor2Id = advisor2Check.rows[0].user_id;
    }

    // Get IT01 major_id (different from student2's CS01 major)
    const itMajorRes = await client.query("SELECT major_id FROM master_major WHERE major_code = 'IT01'");
    if (itMajorRes.rowCount && itMajorRes.rowCount > 0) {
      const itMajorId = itMajorRes.rows[0].major_id;
      // Upsert personnel profile for advisor2 with IT01 major
      await client.query(
        `INSERT INTO personnel (personnel_id, major_id, status)
         VALUES ($1, $2, 'approved')
         ON CONFLICT (personnel_id) DO UPDATE SET major_id = $2`,
        [advisor2Id, itMajorId]
      );
    }

    // Create a mock E-Signature file path for Dean if not set
    await client.query(
      "UPDATE personnel SET e_signature_file = 'secure_private/signatures/dean_sig.png', status = 'approved' WHERE personnel_id = (SELECT user_id FROM users WHERE email = 'dean1@test.com')"
    );

    // Create fixtures directory if missing and write the mock upload file
    const fixturesDir = path.join(process.cwd(), 'e2e', 'fixtures');
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    // ไฟล์จำลองสำหรับการอัปโหลดหลักฐานการตอบรับ — เป็นแค่ magic bytes ของ PNG
    // ไม่ใช่รูปที่เปิดได้จริง ใช้ได้เพราะ multer ตรวจแค่ไบต์ต้นไฟล์
    // (`mock_consent.pdf` ถูกถอดออกพร้อมใบยินยอมผู้ปกครอง 2026-08-26 · เอกสารที่ต้อง
    //  ให้ pdf-lib เปิดได้จริงใช้ `mock_official_letter.pdf` แทน)
    fs.writeFileSync(path.join(fixturesDir, 'mock_evidence.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ E2E Test Seeder failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Support running the seeder directly from CLI
if (require.main === module) {
  seedTestData()
    .then(() => {
      console.log('Test Seeding Finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
