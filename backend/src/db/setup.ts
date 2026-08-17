import { Client } from 'pg';
import pool from '../config/database';
import fs from 'fs';
import path from 'path';
import { hashPassword } from '../utils/password';
import { PDFDocument } from 'pdf-lib';
import { stampAllMigrations } from './migrate';


/**
 * Rebuilds the database from schema.sql and seeds it.
 *
 * Exported rather than run on import so the E2E seeder can call it in the same
 * process. It used to be reached only through `npm run db:setup`, which meant
 * spawning node and compiling this file through ts-node on every one of the 41
 * times a test reset the database.
 *
 * @param quiet suppresses the per-step logging, which is noise when this runs
 *        between tests rather than as a one-off command.
 */
export async function setupDatabase(quiet = false) {
  const log = quiet ? () => undefined : console.log;
  const dbName = process.env.DB_DATABASE || 'coop_edu_db';
  log(`Starting database setup for database: ${dbName}...`);

  // Step 1: Connect to default 'postgres' database to check/create the target database
  const initClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: 'postgres',
  });

  try {
    await initClient.connect();
    const dbCheck = await initClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if ((dbCheck.rowCount ?? 0) === 0) {
      log(`Database '${dbName}' does not exist. Creating it...`);
      await initClient.query(`CREATE DATABASE ${dbName}`);
      log(`Database '${dbName}' created successfully.`);
    } else {
      log(`Database '${dbName}' already exists.`);
    }
  } catch (err) {
    console.error('Error checking or creating database:', err);
    throw err;
  } finally {
    await initClient.end();
  }

  // Step 2: Connect to target database and execute Schema
  try {
    log('Connecting to target database to run schema and seeds...');
    const client = await pool.connect();
    
    // Read schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    log(`Reading schema from ${schemaPath}`);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schemaSql);
    log('Database schema created successfully.');

    // Ensure new columns exist in case tables were not dropped/recreated
    await client.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_year INT;');
    await client.query('ALTER TABLE personnel ADD COLUMN IF NOT EXISTS birth_date DATE;');
    await client.query('ALTER TABLE personnel_preseed_list ADD COLUMN IF NOT EXISTS email VARCHAR(255);');
    await client.query('ALTER TABLE personnel_preseed_list ADD COLUMN IF NOT EXISTS claimed_by INT REFERENCES users(user_id) ON DELETE SET NULL;');
    await client.query('ALTER TABLE personnel_preseed_list ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_personnel_preseed_email ON personnel_preseed_list (email) WHERE email IS NOT NULL;');
    await client.query('ALTER TABLE eligible_students_list ADD COLUMN IF NOT EXISTS email VARCHAR(255);');

    // ฐานที่เพิ่งสร้างจาก schema.sql มีทุกอย่างที่ migration ทั้งหมดจะทำอยู่แล้ว
    // ประทับตราไว้ ไม่งั้น `db:migrate` ครั้งถัดไปจะพยายามรันซ้ำตั้งแต่ baseline
    // ซึ่งมี DROP TABLE อยู่ข้างใน
    await stampAllMigrations(client);
    log('Migration history stamped to match schema.sql.');

    // Read seeds.sql
    const seedsPath = path.join(__dirname, 'seeds.sql');
    log(`Reading seeds from ${seedsPath}`);
    const seedsSql = fs.readFileSync(seedsPath, 'utf8');
    await client.query(seedsSql);
    log('Master data seeded successfully.');

    // Seed default document templates (re-syncing all required official templates)
    log('Seeding default document templates...');
    await client.query('DELETE FROM document_templates');
    await client.query(`
      INSERT INTO document_templates (name, file_path, type) VALUES
      ('หนังสือขอความอนุเคราะห์รับนักศึกษา (Cover Letter)', 'secure_private/templates/cover_letter_template.html', 'cover_letter'),
      ('หนังสือส่งตัวนักศึกษาสหกิจศึกษา (Transfer Letter)', 'secure_private/templates/transfer_letter_template.html', 'transfer_letter'),
      ('ใบสมัครงานสหกิจศึกษา / Resume (สหกิจ03)', 'secure_private/templates/sahatkit_03_template.html', 'sahatkit_03'),
      ('แบบแจ้งรายชื่อนักศึกษาสหกิจศึกษา (สหกิจ04)', 'secure_private/templates/sahatkit_04_template.html', 'sahatkit_04'),
      ('หนังสือสัญญาเข้ารับการปฏิบัติงาน (สหกิจ05)', 'secure_private/templates/sahatkit_05_template.html', 'sahatkit_05'),
      ('แบบบันทึกการนิเทศงาน (สหกิจ13)', 'secure_private/templates/sahatkit_13_template.html', 'sahatkit_13'),
      ('บันทึกข้อความขออนุมัติเดินทางไปราชการ (Travel Request)', 'secure_private/templates/travel_request_template.html', 'travel_request')
    `);
    log('Default document templates seeded.');

    // Step 3: Insert Default Testing Users with Hashed Passwords and Roles
    log('Seeding default test user accounts...');
    const defaultUsers = [
      { email: 'student1@test.com', password: 'password123', role: 'student' },
      { email: 'student2@test.com', password: 'password123', role: 'student' },
      { email: 'advisor1@test.com', password: 'password123', role: 'advisor' },
      { email: 'dean1@test.com', password: 'password123', role: 'dean' },
      { email: 'staff1@test.com', password: 'password123', role: 'staff' },
      { email: 'company1@test.com', password: 'password123', role: 'company' },
      { email: 'head1@test.com', password: 'password123', role: 'dept_head' }
    ];

    for (const u of defaultUsers) {
      const passwordHash = await hashPassword(u.password);
      
      // Insert or update user
      const userInsert = await client.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING user_id`,
        [u.email, passwordHash]
      );
      const userId = userInsert.rows[0].user_id;

      // Insert user role
      await client.query(
        `INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2)
         ON CONFLICT (user_id, role_name) DO NOTHING`,
        [userId, u.role]
      );
      
      log(`Seeded user: ${u.email} (Role: ${u.role}, ID: ${userId})`);

      // Ensure student profile exists for student2@test.com
      if (u.email === 'student2@test.com') {
        const majorRes = await client.query('SELECT major_id FROM master_major LIMIT 1');
        const provinceRes = await client.query('SELECT province_id FROM master_province LIMIT 1');
        
        if ((majorRes.rowCount ?? 0) > 0 && (provinceRes.rowCount ?? 0) > 0) {
          const majorId = majorRes.rows[0].major_id;
          const provinceId = provinceRes.rows[0].province_id;
          
          await client.query(
            `INSERT INTO students (student_id, student_code, major_id, province_id, cumulative_gpa, is_eligible, is_orientation_passed,
                                  first_name, last_name, nickname, year_level, birth_date, alt_email, phone, current_address, parent_name, parent_phone) 
             VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, 'สมชาย', 'สายดี', 'ชาย', 3, '2005-05-15', 'somchai@alt.com', '0812345678', '123/45 ถนนเจริญกรุง กรุงเทพฯ', 'สมพร สายดี', '0898765432')
             ON CONFLICT (student_id) DO NOTHING`,
            // GPA matches the eligible_students_list row seeded just below, since
            // that staging table is now the authoritative source for it.
            [userId, '640101001', majorId, provinceId, 3.75]
          );
          // Eligibility is owned by the staging list — mirror the seeded student
          // there so the dev database matches how production grants eligibility.
          await client.query(
            `INSERT INTO eligible_students_list (student_code, cumulative_gpa, is_eligible, email)
             VALUES ($1, 3.75, TRUE, $2)
             ON CONFLICT (student_code) DO UPDATE SET
               cumulative_gpa = EXCLUDED.cumulative_gpa,
               is_eligible = EXCLUDED.is_eligible,
               email = EXCLUDED.email`,
            ['640101001', u.email]
          );

          log(`Seeded profile for student2@test.com`);
        }
      }

      // Ensure personnel profile exists for dean, dept_head, advisor
      if (['dean', 'dept_head', 'advisor'].includes(u.role)) {
        const majorRes = await client.query('SELECT major_id FROM master_major LIMIT 1');
        if ((majorRes.rowCount ?? 0) > 0) {
          const majorId = majorRes.rows[0].major_id;
          await client.query(
            `INSERT INTO personnel (personnel_id, major_id, status) VALUES ($1, $2, 'approved')
             ON CONFLICT (personnel_id) DO NOTHING`,
            [userId, majorId]
          );
          log(`Seeded personnel profile for role ${u.role}: ${u.email}`);
        }
      }
    }

    // Seed default sample PR Announcement
    const staffRes = await client.query("SELECT user_id FROM users WHERE email = 'staff1@test.com'");
    if ((staffRes.rowCount ?? 0) > 0) {
      const staffId = staffRes.rows[0].user_id;
      const annCheck = await client.query('SELECT COUNT(*) FROM announcements');
      if (parseInt(annCheck.rows[0].count, 10) === 0) {
        await client.query(`
          INSERT INTO announcements (title, content, is_pinned, created_by)
          VALUES ('📢 กำหนดการยื่นสมัครสหกิจศึกษา ปีการศึกษา 2026', 'ขอให้นักศึกษาทุกคนส่งแบบสมัครสหกิจศึกษาพร้อมใบรายงานผลการเรียน (Transcript) ภายในวันที่ 30 กันยายนนี้', TRUE, $1)
        `, [staffId]);
        log('Seeded default PR announcement.');
      }
    }

    client.release();

    // ponytail: generate mock PDF templates and signature images directly during db:setup
    log('Checking and generating test assets...');
    await generateTestAssets();
    log('✅ Test assets checked/created.');

    log('Database setup completed successfully.');
  } catch (error) {
    console.error('Error setting up tables or seeds:', error);
    // Thrown, not exited: a caller running this between tests needs to see the
    // failure, not have its own process killed out from under it.
    throw error;
  }
}

async function generateTestAssets() {
  // Resolved from this file, not the working directory. `npm run db:setup` runs
  // with cwd = backend/, but the E2E seeder now calls this in-process from the
  // repo root, and these assets have to land where the server looks for them.
  const rootDir = path.resolve(__dirname, '../..');
  const dirs = [
    path.join(rootDir, 'secure_private'),
    path.join(rootDir, 'secure_private', 'templates'),
    path.join(rootDir, 'secure_private', 'signatures'),
    path.join(rootDir, 'secure_private', 'documents'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const templates = [
    'cover_letter_template.pdf',
    'transfer_letter_template.pdf'
  ];

  for (const templateName of templates) {
    const templatePath = path.join(rootDir, 'secure_private', 'templates', templateName);
    if (!fs.existsSync(templatePath)) {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595.276, 841.89]); // A4 Size
      
      page.drawText('OFFICIAL COOPERATIVE EDUCATION LETTER', { x: 100, y: 750, size: 16 });
      page.drawText('Rajamangala University of Technology East (RMUTTO)', { x: 100, y: 720, size: 11 });
      page.drawText('---------------------------------------------------------------------------', { x: 100, y: 700, size: 11 });

      page.drawText('Student Code: [STUDENT_CODE]', { x: 100, y: 650, size: 11 });
      page.drawText('GPA: [GPA]', { x: 100, y: 630, size: 11 });
      page.drawText('Company: [COMPANY]', { x: 100, y: 610, size: 11 });
      page.drawText('Contact Person: [CONTACT]', { x: 100, y: 590, size: 11 });
      page.drawText('Contact Position: [POSITION]', { x: 100, y: 570, size: 11 });

      page.drawText('Signed by:', { x: 100, y: 220, size: 11 });
      page.drawText('________________________', { x: 100, y: 170, size: 11 });
      page.drawText('Dean of Faculty of Science and Technology', { x: 100, y: 150, size: 11 });

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(templatePath, pdfBytes);
      console.log(`Generated mock PDF template: ${templateName}`);
    }
  }

  const signaturePath = path.join(rootDir, 'secure_private', 'signatures', 'dean_sig.png');
  if (!fs.existsSync(signaturePath)) {
    const pngHex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154785e63606060000000050001a5f840f30000000049454e44ae426082';
    fs.writeFileSync(signaturePath, Buffer.from(pngHex, 'hex'));
    console.log(`Generated valid 1x1 transparent PNG signature: dean_sig.png`);
  }
}


// `npm run db:setup` still works exactly as before.
if (require.main === module) {
  setupDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
