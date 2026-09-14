-- PostgreSQL Database Schema for Online Cooperative Education Management System (Consolidated Base Schema)

-- Drop existing tables to start clean in development environment
--
-- ⛔ **ตารางใหม่ทุกตัวต้องมีชื่ออยู่ในรายการนี้ด้วย** ไม่ใช่แค่มี CREATE ข้างล่าง
--    ตารางที่ไม่ได้ถูก DROP จะรอดจากการรีเซ็ต แล้ว `CREATE TABLE IF NOT EXISTS`
--    ก็ข้ามมันไป → **แถวเก่าค้างข้ามการรีเซ็ตทุกครั้ง** และที่ร้ายกว่าคือ
--    `DROP TABLE <ตารางแม่> CASCADE` จะ**ลบ foreign key ของมันทิ้งเงียบ ๆ**
--    เหลือตารางที่ไม่มีด่านอ้างอิงอะไรเลย โดยที่ schema-drift ตรวจไม่เจอ
--    เพราะฐานสองตัวที่เอามาเทียบกันถูกสร้างด้วยวิธีเดียวกันทั้งคู่
--    · เจอ 8 ตารางที่ตกหล่นแบบนี้เมื่อ 2026-09-09 (เทสต์ล้มเพราะแถวของเทสต์ก่อนหน้าค้างอยู่)
--    · ตรวจซ้ำได้ด้วยการเทียบรายชื่อ DROP กับรายชื่อ CREATE ในไฟล์นี้ให้ตรงกัน
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS job_offer_tokens CASCADE;
DROP TABLE IF EXISTS job_post_majors CASCADE;
DROP TABLE IF EXISTS coop_job_offers CASCADE;
DROP TABLE IF EXISTS daily_logs CASCADE;
DROP TABLE IF EXISTS work_plan_topics CASCADE;
DROP TABLE IF EXISTS work_plan_approvals CASCADE;
DROP TABLE IF EXISTS monthly_work_plans CASCADE;
DROP TABLE IF EXISTS report_confirmations CASCADE;
DROP TABLE IF EXISTS final_reports CASCADE;
DROP TABLE IF EXISTS final_evaluations CASCADE;
DROP TABLE IF EXISTS mentor_notifications CASCADE;
DROP TABLE IF EXISTS official_documents CASCADE;
DROP TABLE IF EXISTS document_templates CASCADE;
DROP TABLE IF EXISTS coop_applications CASCADE;
DROP TABLE IF EXISTS intent_forms CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS student_memos CASCADE;
DROP TABLE IF EXISTS coop_calendar_events CASCADE;
DROP TABLE IF EXISTS job_posts CASCADE;
DROP TABLE IF EXISTS report_outline_versions CASCADE;
DROP TABLE IF EXISTS report_outlines CASCADE;
DROP TABLE IF EXISTS supervision_records CASCADE;
DROP TABLE IF EXISTS supervision_logs CASCADE;
DROP TABLE IF EXISTS supervision_appointments CASCADE;
DROP TABLE IF EXISTS monthly_logs CASCADE;
DROP TABLE IF EXISTS weekly_logs CASCADE;
DROP TABLE IF EXISTS coop_semesters CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP TABLE IF EXISTS mentors CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS personnel CASCADE;
DROP TABLE IF EXISTS personnel_preseed_list CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS master_major CASCADE;
DROP TABLE IF EXISTS master_faculty CASCADE;
DROP TABLE IF EXISTS master_province CASCADE;
DROP TABLE IF EXISTS eligible_students_list CASCADE;
DROP TABLE IF EXISTS accommodations CASCADE;
DROP TABLE IF EXISTS weekly_work_plans CASCADE;

-- 1. Master Data Tables
CREATE TABLE IF NOT EXISTS master_faculty (
    faculty_id SERIAL PRIMARY KEY,
    faculty_name_th VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS master_major (
    major_id SERIAL PRIMARY KEY,
    faculty_id INT NOT NULL REFERENCES master_faculty(faculty_id) ON DELETE CASCADE,
    major_code VARCHAR(50) NOT NULL UNIQUE,
    major_name_th VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS master_province (
    province_id SERIAL PRIMARY KEY,
    province_name_th VARCHAR(255) NOT NULL UNIQUE
);

-- 2. Authentication & Core User Table
-- password_hash is NULLABLE to support Google SSO login
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    reset_token VARCHAR(255),
    reset_token_expires TIMESTAMP
);

-- Index for token lookup performance
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token) WHERE reset_token IS NOT NULL;

-- User Roles Table (Supports multiple roles per user, e.g. 'advisor' and 'dept_head')
CREATE TABLE IF NOT EXISTS user_roles (
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_name VARCHAR(50) NOT NULL CHECK (role_name IN ('student', 'advisor', 'dean', 'staff', 'dept_head', 'company', 'mentor')),
    PRIMARY KEY (user_id, role_name)
);

-- 3. Profile Tables
-- Additional views can be added below



-- Personnel first because student references advisor_id and supervisor_id pointing to personnel
CREATE TABLE IF NOT EXISTS personnel (
    personnel_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    major_id INT NOT NULL REFERENCES master_major(major_id),
    e_signature_file VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    birth_date DATE
);

CREATE TABLE IF NOT EXISTS students (
    student_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    student_code VARCHAR(50) NOT NULL UNIQUE,
    major_id INT NOT NULL REFERENCES master_major(major_id),
    province_id INT REFERENCES master_province(province_id),
    cumulative_gpa NUMERIC(3, 2),
    resume_file VARCHAR(255),
    -- รูปโปรไฟล์ — path สัมพัทธ์ใต้ `uploads/` แบบเดียวกับ `resume_file`
    -- ⛔ ระบบ **ไม่ตรวจว่าเป็นรูปตามระเบียบ** (สัดส่วน · พื้นหลังฟ้า · หน้าตรง)
    --    เจ้าของเคาะ 2026-09-03 ว่าฐานรูปของมหาวิทยาลัยบังคับอยู่แล้ว
    --    ที่ยังตรวจคือชนิดไฟล์จริงจาก magic bytes กับขนาด ซึ่งเป็นด่านเดียวกับ
    --    ทุกการอัปโหลดในระบบ ไม่ใช่เรื่องระเบียบรูปถ่าย
    profile_image VARCHAR(255),
    -- เกรดที่นักศึกษาแจ้งเองตอนกรอกข้อมูลครั้งแรก
    -- ⛔ **คนละคอลัมน์กับ `cumulative_gpa` ด้านบนโดยตั้งใจ** (SEC-05) — ตัวนั้นคือเลข
    --    ทะเบียนที่ถูกพิมพ์ลงหนังสือราชการที่คณบดีเซ็น เลขที่ยังไม่มีมนุษย์ยืนยันลงไม่ได้
    --    · เดิมค่านี้อยู่ที่ `coop_applications.claimed_gpa` (สหกิจ 01) ซึ่งถูกข้ามไปแล้ว
    claimed_gpa NUMERIC(3, 2),
    -- ⛔ is_eligible / is_orientation_passed ถูกลบ 2026-09-14 (migration 031 · SEC-02)
    --    ระบบไม่ตรวจสิทธิ์สหกิจและไม่มีขั้นปฐมนิเทศ — ไม่อยู่ในขอบเขต · ห้ามเพิ่มกลับโดยไม่แก้ SEC-02
    advisor_id INT REFERENCES personnel(personnel_id) ON DELETE SET NULL,
    supervisor_id INT REFERENCES personnel(personnel_id) ON DELETE SET NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    nickname VARCHAR(100),
    year_level INT,
    -- "ห้อง" บนหัวใบ สหกิจ 06 (ข้าง "ชั้นปีที่") = ห้องเรียน ไม่ใช่ห้องพัก (migration 016)
    -- ⛔ อย่าสับกับ `accommodations.room_no` ซึ่งเป็นเลขห้องของหอพัก คนละความหมาย
    section VARCHAR(50),
    birth_date DATE,
    alt_email VARCHAR(255),
    phone VARCHAR(50),
    current_address TEXT,
    parent_name VARCHAR(255),
    parent_phone VARCHAR(50),
    enrollment_year INT,
    skills_and_activities TEXT,
    language_proficiency JSONB,
    preferred_work_region VARCHAR(255),
    interested_job_types JSONB,
    -- สหกิจ 03 · ช่องตัวตน/ติดต่อ (migration 013)
    -- ⛔ `nationality` (สัญชาติ) ≠ `ethnicity` (เชื้อชาติ) — ตัวหลังเป็นข้อมูลอ่อนไหว
    --    พิเศษ PDPA ม.26 ที่ต้องเข้ารหัส+ยินยอมแยก อยู่ท้ายตารางนี้ อย่าเอามารวมกัน
    first_name_en VARCHAR(255),
    last_name_en VARCHAR(255),
    gender VARCHAR(20),
    nationality VARCHAR(100),
    mobile_phone VARCHAR(50),
    fax VARCHAR(50),
    -- ⛔ ผู้ติดต่อฉุกเฉินเป็นของ **คน** ไม่ใช่ของ **ที่พัก** — ย้ายขึ้นมาจาก
    --    `accommodations` เมื่อ 2026-09-03 เพราะทั้ง สหกิจ 03 และ 06 ถามช่องเดียวกัน
    emergency_contact_name VARCHAR(255),
    emergency_relationship VARCHAR(100),
    emergency_address TEXT,
    emergency_phone VARCHAR(50),
    -- สหกิจ 03 · ประวัติที่เป็น "ตาราง" — JSONB ไม่ใช่ตารางใหม่ 4 ตัว (migration 014)
    -- ไม่เคยถูกค้นข้ามนักศึกษา และอ่านทีเดียวพร้อมโปรไฟล์เสมอ
    family_info JSONB,
    education_history JSONB,
    training_history JSONB,
    -- ⛔ คนละอย่างกับ `skills_and_activities` (TEXT ก้อนเดียวที่หน้าโปรไฟล์ใช้)
    activity_history JSONB,
    -- ⛔ คนละอย่างกับ `interested_job_types` (รายการประเภทงานสำหรับจับคู่ตำแหน่ง)
    career_objective TEXT,
    -- SEC-12 · สหกิจ 03 — เข้ารหัสสองทาง (AES-256-GCM) เพราะต้องพิมพ์กลับลงใบสมัคร
    -- ห้าม hash (อ่านกลับไม่ได้) · ดู migration 012 และ utils/encryption.ts
    national_id_ciphertext TEXT,
    national_id_iv VARCHAR(64),
    national_id_tag VARCHAR(64),
    -- ไม่เข้ารหัส — ไม่ใช่ข้อมูลที่ระบุตัวบุคคลได้เท่าตัวเลขบัตร
    national_id_issued_district VARCHAR(100),
    national_id_expiry_date DATE,
    -- เชื้อชาติ/ศาสนา = ข้อมูลอ่อนไหวพิเศษ PDPA ม.26 — ต้องมีความยินยอมแยกก่อนเขียน
    ethnicity_ciphertext TEXT,
    ethnicity_iv VARCHAR(64),
    ethnicity_tag VARCHAR(64),
    religion_ciphertext TEXT,
    religion_iv VARCHAR(64),
    religion_tag VARCHAR(64),
    sensitive_data_consented_at TIMESTAMP WITH TIME ZONE
);

-- 4. Companies Table
CREATE TABLE IF NOT EXISTS companies (
    company_id SERIAL PRIMARY KEY,
    name_th VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    address VARCHAR(255) NOT NULL,
    province VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    postal_code VARCHAR(10) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    google_place_id VARCHAR(255) UNIQUE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    contact_person VARCHAR(255),
    contact_position VARCHAR(255),
    email VARCHAR(255),
    -- ช่องที่ **แบบเสนองานสหกิจ (สหกิจ 02) หน้า 1 บังคับ** แต่ทะเบียนเดิมไม่มี
    --
    -- อยู่ที่ระดับบริษัทไม่ใช่ระดับใบสำรวจ เพราะเป็นข้อเท็จจริงของบริษัทที่ใช้ซ้ำทุกภาคเรียน
    -- (ของจริงเจ้าหน้าที่ส่งฟอร์มเดิมทุกปีและบริษัทกรอกเรื่องเดิมทุกปี) การเก็บที่ใบสำรวจ
    -- จะทำให้ปุ่ม "ใช้คำตอบเดิมของภาคที่แล้ว" ต้องก๊อปข้อมูลบริษัทตามไปด้วยทุกครั้ง
    --
    -- ⛔ บัญชีบริษัทเขียนได้เฉพาะกลุ่มนี้ **ห้ามเขียน name_th/name_en/address/province/
    --    district/postal_code/is_verified** ซึ่งเป็นตัวตนที่เจ้าหน้าที่รับรองและถูกพิมพ์
    --    ลงหนังสือราชการที่คณบดีลงนาม (ดู spec-D ข้อ 3.2)
    fax VARCHAR(50),
    business_type VARCHAR(255),          -- ผลิตภัณฑ์ / ลักษณะการดำเนินงาน
    employee_count INT,                  -- จำนวนพนักงานรวม
    manager_name VARCHAR(255),           -- ผู้จัดการสถานประกอบการ / หัวหน้าหน่วยงาน
    manager_position VARCHAR(255),
    manager_department VARCHAR(255),
    manager_phone VARCHAR(50),
    manager_fax VARCHAR(50),
    -- ช่องติ๊กบนกระดาษ: ติดต่อผู้จัดการโดยตรง หรือ ติดต่อผู้ที่ได้รับมอบหมาย
    -- ค่าเริ่มต้นเป็น delegate เพราะ contact_person/contact_position ที่มีอยู่เดิม
    -- คือ "ผู้ประสานงานที่ได้รับมอบหมาย" อยู่แล้ว การตั้ง manager จะเปลี่ยนความหมายของแถวเก่า
    contact_mode VARCHAR(10) NOT NULL DEFAULT 'delegate'
        CONSTRAINT companies_contact_mode_check CHECK (contact_mode IN ('manager', 'delegate')),
    contact_department VARCHAR(255),
    contact_phone VARCHAR(50),
    contact_fax VARCHAR(50),
    -- ที่อยู่แยกช่องตาม **สหกิจ 07 หน้า 1** ซึ่งมีกล่องแยก เลขที่ · ถนน · ซอย · ตำบล/แขวง
    --
    -- `address` ด้านบนยังเป็นแหล่งความจริงของหนังสือราชการเหมือนเดิม — เซิร์ฟเวอร์
    -- ประกอบค่าใหม่จากช่องย่อยพวกนี้ให้ทุกครั้งที่บริษัทแก้ผ่าน สหกิจ 07 เอกสารที่
    -- วาดจาก `address` จึงไม่ต้องแก้อะไรเลย
    -- ⛔ ห้ามแยก `address` เดิมกลับเป็นช่องย่อยอัตโนมัติ — ที่อยู่ไทยแยกด้วยโปรแกรมไม่ได้
    --    (บทเรียนเดียวกับ `accommodations.address_legacy`) ช่องย่อยว่างจนกว่าจะมีคนกรอกเอง
    house_no VARCHAR(50),
    road VARCHAR(255),
    soi VARCHAR(255),
    subdistrict VARCHAR(100),
    manager_email VARCHAR(255)
);

-- Mentors Table (Profile for Company Supervisors)
CREATE TABLE IF NOT EXISTS mentors (
    mentor_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    position VARCHAR(255),
    department VARCHAR(255),
    phone VARCHAR(50) NOT NULL,
    -- ช่องโทรสารของ "พนักงานที่ปรึกษา (Job Supervisor)" บน สหกิจ 07 หน้า 2
    -- อีเมลไม่ต้องเก็บซ้ำที่นี่ — อยู่ที่ users.email ของบัญชีพี่เลี้ยงคนนั้นแล้ว
    fax VARCHAR(50)
);

-- 5. Coop Semesters Table
CREATE TABLE IF NOT EXISTS coop_semesters (
    semester_id SERIAL PRIMARY KEY,
    academic_year INT NOT NULL,
    semester VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 5.1 แบบเสนองานสหกิจศึกษา (สหกิจ 02) — "ใบสำรวจ" หนึ่งใบต่อหนึ่งบริษัทต่อหนึ่งภาคเรียน
--
-- ⛔ ในระบบนี้ไม่มีคำว่า "ประกาศรับสมัครงาน" — ตามคู่มือ งานสหกิจศึกษาประจำคณะเป็นฝ่าย
--    ส่งแบบเสนองานไปถามสถานประกอบการ **ล่วงหน้าประมาณ 1 ภาคการศึกษา** เพื่อสำรวจ
--    ความต้องการรับนักศึกษา · ตารางนี้คือ "ใบที่ส่งไปถาม" และคำตอบที่ได้กลับมา
--    ส่วน job_posts คือ "รายการตำแหน่ง" ที่อยู่ข้างในใบนั้น (กระดาษหน้า 2 หนึ่งแผ่นต่อหนึ่งรายการ)
--
-- ⛔ บริษัทสร้างใบเองไม่ได้ — เจ้าหน้าที่เป็นคนเปิดใบพร้อมกับตอนส่งแบบสำรวจ
--    (POST /api/job-offers/send) ซึ่งตรงกับความจริงว่ามหาวิทยาลัยเป็นฝ่ายเริ่มเสมอ
CREATE TABLE IF NOT EXISTS coop_job_offers (
    offer_id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT,
    -- draft     บริษัทกรอกค้างไว้ (หรือเจ้าหน้าที่เพิ่งส่งไปถาม ยังไม่มีใครตอบ)
    -- submitted ตอบกลับแล้ว รอเจ้าหน้าที่ตรวจ
    -- reviewed  เจ้าหน้าที่ตรวจแล้ว รายการข้างในถูกเปิดให้นักศึกษาเห็น
    -- declined  บริษัทตอบว่า "ภาคเรียนนี้ยังไม่รับ"
    --           ⛔ ไม่ใช่การลบใบ — การตอบว่าไม่รับก็เป็นคำตอบที่ต้องเก็บไว้
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CONSTRAINT coop_job_offers_status_check
        CHECK (status IN ('draft', 'submitted', 'reviewed', 'declined')),
    -- "กรุณาส่งเอกสารฉบับนี้กลับมา ... ก่อนวันที่ ......" ท้ายหน้า 2 ของกระดาษ
    -- เจ้าหน้าที่เป็นคนกำหนดตอนกดส่งแบบสำรวจ
    due_date DATE,
    submitted_at TIMESTAMPTZ,
    submitted_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    -- ช่อง "ลงชื่อผู้ให้ข้อมูล / ตำแหน่ง" ท้ายหน้า 2
    informant_name VARCHAR(255),
    informant_position VARCHAR(255),
    decline_reason TEXT,
    reject_reason TEXT,                  -- เจ้าหน้าที่ตีกลับทั้งใบ
    -- สำเนาข้อมูลบริษัท (เฉพาะฟิลด์ที่บริษัทเขียนได้) ณ วินาทีที่เจ้าหน้าที่กดส่งไปถาม
    -- ⛔ มีไว้เพื่อตอบคำถามเดียว: "บริษัทแก้อะไรจากที่คณะมีอยู่บ้าง" ซึ่งเป็นสิ่งที่
    --    คนตรวจใบต้องเห็น (SB3 → changed_fields) และหาจากที่อื่นไม่ได้เลย
    --    audit_log เขียนอย่างเดียวและจงใจไม่มี read API (SEC-07) จึงเอามาอ่านไม่ได้
    -- ⛔ NULL = ใบที่เปิดก่อน migration 029 · แปลว่า "ไม่รู้" ไม่ใช่ "ไม่มีอะไรเปลี่ยน"
    company_snapshot JSONB,
    -- ใบของภาคที่แล้วที่ถูกก๊อปมาเป็นค่าตั้งต้น (ปุ่ม "ใช้คำตอบเดิม")
    -- เก็บไว้เพื่อให้หน้าจอบอกได้ว่าค่าที่เห็นมาจากไหน และตรวจย้อนได้ว่าใครตอบซ้ำของใคร
    copied_from_offer_id INT REFERENCES coop_job_offers(offer_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT coop_job_offers_company_semester_key UNIQUE (company_id, semester_id)
);

-- 5.2 ลิงก์ตอบแบบสำรวจทางอีเมล — **อายุ 24 ชั่วโมง ใช้ได้ครั้งเดียว**
--
-- ⛔ token นี้เปิดได้ **หน้าเดียวคือแบบเสนองาน สหกิจ 02** ซึ่งไม่มีข้อมูลนักศึกษาอยู่เลย
--    ทุกหน้าที่มีข้อมูลนักศึกษา (ใบสมัคร 03 · แบบประเมิน 15/16 · บันทึกการปฏิบัติงาน)
--    ต้องล็อกอินเต็มเสมอ **ห้ามเปิดด้วย token เด็ดขาด**
-- ⛔ ห้ามให้ระบบต่ออายุเองเงียบ ๆ — หมดอายุแล้วต้องกดขอลิงก์ใหม่ ซึ่งส่งไปที่อีเมล
--    ในทะเบียนเท่านั้น (ห้ามให้พิมพ์อีเมลปลายทางเอง ไม่งั้นใครก็ดึงลิงก์ของบริษัทอื่นได้)
-- token เก็บเป็นค่าดิบแบบเดียวกับลิงก์เชิญใน utils/invite.ts โดยตั้งใจ — ให้ทั้งระบบ
-- มีแบบแผนเดียว และ token นี้ไม่ได้ให้ session หรือสิทธิ์ใด ๆ นอกจากใบสำรวจใบเดียว
CREATE TABLE IF NOT EXISTS job_offer_tokens (
    token_id SERIAL PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    offer_id INT NOT NULL REFERENCES coop_job_offers(offer_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_offer_tokens_offer ON job_offer_tokens(offer_id);

-- 6. Job Posts Table — **หนึ่งแถวคือหนึ่งรายการตำแหน่งในแบบเสนองาน (สหกิจ 02 หน้า 2)**
CREATE TABLE IF NOT EXISTS job_posts (
    job_id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    -- ⛔ ไม่มี image_path — แบนเนอร์ประกาศงานถูกลบเมื่อ 2026-09-08 (migration 028)
    --    ตรวจกับแบบฟอร์ม สหกิจ 02 ตัวจริงแล้วไม่มีช่องรูปภาพ และไม่มีในขอบเขต
    created_by INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    quota INT NOT NULL,
    -- "จำนวนงานที่เสนอนักศึกษา" คู่กับ quota บนกระดาษ — บนหน้าจออ่านว่า
    -- "รับแล้วกี่คนจากที่เสนอ" ไม่ใช่ "จำนวนผู้สมัคร"
    -- ⛔ ห้ามตัดคอลัมน์นี้ทิ้ง — ตรรกะโควตาเต็มใน controllers/acceptance.ts และ
    --    models/intent.ts อ่านค่านี้อยู่
    applied_count INT NOT NULL DEFAULT 0,
    -- เดิมหมายถึง "วันที่ประกาศหมดอายุ" · ตอนนี้คือ **กำหนดส่งแบบสำรวจกลับ**
    -- ซึ่งสืบค่ามาจาก coop_job_offers.due_date ของใบที่รายการนี้สังกัด
    expire_date TIMESTAMP NOT NULL,
    -- 'rejected' is distinct from 'closed' on purpose: closed means the posting
    -- ran its course, rejected means staff turned it down. Reusing 'closed' for
    -- both would have told the company its advert expired when in fact it was
    -- refused, and left nowhere to put the reason.
    status VARCHAR(50) NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'published', 'closed', 'rejected')),
    reject_reason TEXT,
    -- ใบสำรวจที่รายการนี้สังกัด · NULL ได้เพราะแถวที่มีอยู่ก่อนระบบใบสำรวจยังต้องใช้งานได้
    -- ⛔ ของใหม่ที่สร้างจากหน้าจอต้องมีค่าเสมอ — ห้ามปล่อยให้เกิดรายการลอยที่ไม่มีใบสังกัด
    offer_id INT REFERENCES coop_job_offers(offer_id) ON DELETE CASCADE,
    -- ⛔ หลักฐานว่าต้องมี: กระดาษหน้า 2 มีช่อง "ระยะเวลาที่ต้องการให้นักศึกษาไปปฏิบัติงาน"
    --    ถ้าไม่มีคอลัมน์นี้ ระบบไม่รู้ว่าตำแหน่งนี้เป็นการเสนอของภาคเรียนไหน และปุ่ม
    --    "ใช้คำตอบเดิมของภาคที่แล้ว" ทำไม่ได้เลย
    semester_id INT REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT,
    -- ช่องติ๊กสามข้อบนกระดาษ · full_year = นักศึกษาคนนั้นอยู่ยาวถึงภาคเรียนที่ 2
    -- ⛔ **ไม่ได้แปลว่ารายการนี้ไปโผล่ในแบบสำรวจของสองภาค** — หนึ่งรายการสังกัดภาคเดียว
    --    คือภาคที่เริ่มปฏิบัติงาน · ภาคหน้าใช้ปุ่ม "ใช้คำตอบเดิม" ซึ่งเป็นการกดของคน
    --    (ถ้าระบบก๊อปเอง บริษัทจะถูกนับว่ารับนักศึกษาทั้งที่ไม่เคยตอบอะไรในภาคนั้น)
    duration_term VARCHAR(10)
        CONSTRAINT job_posts_duration_term_check
        CHECK (duration_term IS NULL OR duration_term IN ('term1', 'term2', 'full_year')),
    skills_required TEXT,                -- ความสามารถทางวิชาการหรือทักษะที่นักศึกษาควรมี
    other_requirements TEXT,             -- ข้อกำหนดอื่น ๆ (อุปกรณ์ · สถานที่ปฏิบัติงานจริง)
    -- สวัสดิการอยู่ที่ระดับ **รายการ** ไม่ใช่ระดับใบ เพราะกระดาษวางไว้หน้าเดียวกับตำแหน่ง
    -- และของจริงตำแหน่งต่างกันอาจให้ค่าตอบแทนต่างกัน
    -- pay_amount IS NULL = ช่อง "( ) ไม่มี" · หน่วยบนกระดาษมีสองแบบ ห้ามยุบเป็นข้อความเดียว
    pay_amount NUMERIC(10, 2),
    pay_unit VARCHAR(10)
        CONSTRAINT job_posts_pay_unit_check
        CHECK (pay_unit IS NULL OR pay_unit IN ('day', 'month')),
    accommodation VARCHAR(20)
        CONSTRAINT job_posts_accommodation_check
        CHECK (accommodation IS NULL OR accommodation IN ('none', 'free', 'paid')),
    accommodation_cost VARCHAR(100),     -- "1,200 ต่อเดือน" — กระดาษเขียน "ต่อเดือน / วัน"
    welfare_other TEXT
);

-- 6.0.1 สาขาที่ตำแหน่งหนึ่งต้องการ — หนึ่งรายการรับได้หลายสาขา
--
-- กระดาษเขียนว่า "หากต้องการมากกว่า 1 สาขาวิชา กรุณาทำสำเนาเฉพาะแผ่นนี้และเขียนแยก
-- สาขาวิชาละ 1 แผ่น" ซึ่งเป็นข้อจำกัดของกระดาษที่เขียนได้บรรทัดเดียว ไม่ใช่กติกาของงาน
-- ถ้าบังคับให้แยกรายการตามนั้น บริษัทที่บอกว่า "IT หรือ วิศวะซอฟต์แวร์ก็ได้ 2 คน"
-- จะถูกนับโควตาเป็น 4 ซึ่งผิด · ตอนพิมพ์ยังเป็นหนึ่งแผ่นต่อหนึ่งรายการเหมือนเดิม
-- แค่พิมพ์ชื่อสาขาหลายชื่อในบรรทัดเดียว
CREATE TABLE IF NOT EXISTS job_post_majors (
    job_id INT NOT NULL REFERENCES job_posts(job_id) ON DELETE CASCADE,
    major_id INT NOT NULL REFERENCES master_major(major_id) ON DELETE RESTRICT,
    CONSTRAINT job_post_majors_pkey PRIMARY KEY (job_id, major_id)
);

-- 6.1. PR Announcements Table (Staff PR & News System)
CREATE TABLE IF NOT EXISTS announcements (
    announcement_id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    image_url VARCHAR(255),
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6.2. Coop Calendar Events Table (ปฏิทินสหกิจศึกษา)
--
-- One row = one window of one academic semester.
--   activity_key NOT NULL -- a fixed activity wired to a real endpoint. Outside
--                            its window the server refuses the submission.
--   activity_key NULL     -- a free-form entry staff typed in (orientation day,
--                            fieldwork period). It shows on the calendar and
--                            locks nothing.
--
-- The Thai label of a fixed activity is deliberately NOT stored here (hence
-- `title` is nullable): the single source of truth is
-- backend/src/utils/coopCalendar.ts. Keeping a second copy in the database
-- means that one day the two disagree and nobody knows which one is right.
--
-- There is deliberately no CHECK constraining `activity_key` to the known set.
-- Adding an activity would then require a migration every time and would create
-- exactly the second source of truth this table avoids. The controller
-- validates against the constant instead, and a key the code does not recognise
-- simply locks nothing — the same fail-open direction as an unset window.
CREATE TABLE IF NOT EXISTS coop_calendar_events (
    event_id SERIAL PRIMARY KEY,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE CASCADE,
    activity_key VARCHAR(50),
    title VARCHAR(255),
    -- ชนิดเซลล์วันที่ตามที่พิมพ์อยู่บนปฏิทินคณะ — กระดาษมี 5 แบบ ไม่ใช่แบบเดียว
    -- ⛔ "ภายในวันที่ 5 มิ.ย." (deadline) **ไม่เท่ากับ** "5 มิ.ย. – 5 มิ.ย." (range)
    --    บังคับให้ทุกอย่างเป็นช่วงสองช่อง = เจ้าหน้าที่กรอกวันเดียวกันลงทั้งคู่
    --    แล้วระบบเปิดวันเดียวและปฏิเสธทุกวันก่อนหน้า ซึ่งกลับหัวจากกระดาษ
    -- เหตุผลเต็มและรายการทั้ง 5 แบบอยู่ที่ `utils/coopCalendar.ts`
    date_kind VARCHAR(20) NOT NULL DEFAULT 'range'
        CHECK (date_kind IN ('range', 'deadline', 'single', 'relative', 'external')),
    -- NULL ได้แล้วตั้งแต่ 2026-09-04 — ชนิด deadline ไม่มีวันเริ่ม และ
    -- relative/external ไม่มีวันจริงทั้งคู่ ตัว CHECK ข้างล่างบังคับตามชนิด
    start_date DATE,
    end_date DATE,
    -- วันสุดท้ายที่ยังรับแบบ "ส่งช้า" — NULL = ไม่เปิดผ่อนผัน = ปิดจริงที่ end_date
    -- ระบบเดาแทนคณะไม่ได้ว่าผ่อนผันถึงวันไหน จึงต้องมีคนกรอก ไม่มีค่าเริ่มต้น
    late_end_date DATE,
    -- ข้อความแทนวันที่ สำหรับแถวที่กระดาษไม่ได้ให้วันตายตัว เช่น
    -- "ภายใน 3 วันทำการหลังส่ง สหกิจ 03/06/13/15" · "ให้เป็นไปตามสาขาวิชากำหนด"
    detail_text TEXT,
    -- กระดาษเรียงตาม "เลขรายการ" ไม่ใช่ตามวัน และ 12 ใน 22 เซลล์ไม่มีวันเลย
    -- การเรียงด้วย start_date อย่างเดียวจึงไม่มีที่ยืนให้แถวพวกนั้น
    sort_order INT NOT NULL DEFAULT 0,
    note TEXT,
    -- SET NULL rather than RESTRICT or CASCADE, on purpose: deleting a staff
    -- account must not fail because of the calendar (RESTRICT) and must not take
    -- a whole cohort's schedule down with it (CASCADE, which is what
    -- `announcements` does). Who set what lives in `audit_log` per SEC-07.
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- วันที่ต้องครบ/ว่างตามชนิด — ด่านนี้คือสิ่งที่กัน "เส้นตายถูกกรอกเป็นช่วงวันเดียว"
    CONSTRAINT coop_calendar_events_dates_by_kind CHECK (
           (date_kind = 'range'    AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
        OR (date_kind = 'deadline' AND start_date IS NULL     AND end_date IS NOT NULL)
        OR (date_kind = 'single'   AND start_date IS NOT NULL AND end_date = start_date)
        OR (date_kind IN ('relative', 'external') AND start_date IS NULL AND end_date IS NULL)
    ),
    -- เขียน `end_date IS NOT NULL AND ...` ให้ครบ ไม่ใช่ `late_end_date >= end_date` เฉยๆ
    -- เพราะการเทียบกับ NULL ได้ผลเป็น NULL ซึ่ง CHECK ถือว่า "ผ่าน" → แถว relative
    -- จะแอบมีวันผ่อนผันได้ทั้งที่ไม่มีวันปิด
    CONSTRAINT coop_calendar_events_late_range CHECK (
        late_end_date IS NULL OR (end_date IS NOT NULL AND late_end_date >= end_date)
    ),
    CONSTRAINT coop_calendar_events_detail_required CHECK (
        date_kind NOT IN ('relative', 'external') OR detail_text IS NOT NULL
    ),
    CONSTRAINT coop_calendar_events_title_required CHECK (activity_key IS NOT NULL OR title IS NOT NULL)
);

-- A fixed activity gets one window per semester, so the staff screen is a fixed
-- list of rows with two date fields — no logic deciding which row is the real
-- one. Partial index: free-form entries (key NULL) may repeat freely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coop_calendar_activity_once
    ON coop_calendar_events (semester_id, activity_key)
    WHERE activity_key IS NOT NULL;

-- The only index with a real caller: fetch a whole semester in the order the
-- paper calendar prints it. Ordered by sort_order rather than start_date since
-- 2026-09-04 — over half the rows on the real calendar carry no date at all,
-- and those have no place in a date ordering. The gate already rides the
-- unique index above.
CREATE INDEX IF NOT EXISTS idx_coop_calendar_semester_order ON coop_calendar_events (semester_id, sort_order);

-- 6.5. Coop Applications Table (System 1)
CREATE TABLE IF NOT EXISTS coop_applications (
    application_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT,
    
    -- ข้อมูลจากนักศึกษา
    expected_region VARCHAR(255),
    special_skills TEXT,

    -- เกรดที่นักศึกษา *แจ้ง* เอง ตามที่กรอกใน สหกิจ 01 — ยังไม่ใช่เกรดทางการ
    -- SEC-05: students.cumulative_gpa ยังเป็นของเซิร์ฟเวอร์เหมือนเดิม ค่านี้จะถูก
    -- คัดลอกไปที่นั่นก็ต่อเมื่อหัวหน้าสาขาอนุมัติใบสมัคร (มีคนรับผิดชอบใน audit_log)
    claimed_gpa NUMERIC(3, 2),

    -- สถานะปัจจุบัน (pending_advisor, pending_dept_head, approved, waitlisted, other)
    status VARCHAR(50) NOT NULL DEFAULT 'pending_advisor',
    
    -- Step 1: Advisor Evaluation (วิชาการ, ความประพฤติ, วุฒิภาวะ -> 'appropriate' / 'inappropriate')
    academic_evaluation VARCHAR(50),
    academic_remark TEXT,
    behavior_evaluation VARCHAR(50),
    behavior_remark TEXT,
    maturity_evaluation VARCHAR(50),
    maturity_remark TEXT,
    advisor_id INT REFERENCES personnel(personnel_id) ON DELETE SET NULL,
    advisor_evaluated_at TIMESTAMP,
    
    -- Step 2: Final Conclusion (Dept Head)
    overall_conclusion VARCHAR(50), -- 'approved', 'waitlisted', 'other'
    conclusion_remark TEXT,
    dept_head_id INT REFERENCES personnel(personnel_id) ON DELETE SET NULL,
    dept_head_approved_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, semester_id)
);

-- 7. Intent Forms Table
CREATE TABLE IF NOT EXISTS intent_forms (
    form_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE RESTRICT,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT,
    job_id INT REFERENCES job_posts(job_id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending_advisor',
    mentor_id INT REFERENCES mentors(mentor_id) ON DELETE SET NULL,
    start_date DATE,
    acceptance_evidence_path VARCHAR(255),
    -- แบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1)
    --
    -- ลายเซ็นของอาจารย์ที่ปรึกษาและหัวหน้าสาขาอยู่บน **กระดาษ** ไม่ใช่ในระบบ
    -- (เจ้าของเคาะ 2026-08-26) นักศึกษาพิมพ์แบบคำร้องจากระบบ เอาไปให้เซ็นจริง
    -- แล้วอัปโหลดกลับ · เจ้าหน้าที่เป็นคนเดียวที่กดผ่านในระบบ และกรอกชื่อผู้เซ็น
    -- ทั้งสองคนจากกระดาษลงมาให้ระบบรู้ว่าใครเซ็นและเซ็นวันไหน
    request_form_path VARCHAR(255),
    advisor_signer_name VARCHAR(255),
    advisor_signed_date DATE,
    dept_head_signer_name VARCHAR(255),
    dept_head_signed_date DATE,
    -- เลขที่หนังสือออก — ช่อง "ส่วนของเจ้าหน้าที่" ท้ายกระดาษ เจ้าหน้าที่เป็นคนออก
    -- ตอนรับคำร้อง และเลขนี้จะถูกพิมพ์ลงหนังสือขอความอนุเคราะห์ที่ออกให้นักศึกษา
    officer_document_no VARCHAR(100),
    officer_approved_at TIMESTAMP WITH TIME ZONE,
    officer_approved_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    -- Why the placement was turned down. Written by the company's rejection for
    -- now: the advisor and department head already mail their reason and record
    -- it in audit_log, but the company had nowhere at all to put one, so a
    -- student was told they were rejected and never why. It lives on the row
    -- rather than only in audit_log because the person who has to read it is the
    -- student, and audit_log has no read API by design (SEC-07) — the same
    -- reasoning as job_posts.reject_reason in round 17.
    reject_reason TEXT,
    -- ยื่นในช่วงผ่อนผัน (เลย end_date แต่ยังไม่เลย late_end_date)
    -- ⛔ ปั๊มตอน INSERT เท่านั้น ห้ามคำนวณย้อนหลัง — เจ้าหน้าที่แก้ปฏิทินทีหลังได้
    --    ถ้าคำนวณสด ใบที่เคยส่งช้าจะกลายเป็นส่งตรงเวลาทันทีที่ขยายวัน หลักฐานหาย
    submitted_late BOOLEAN NOT NULL DEFAULT FALSE,
    late_reason TEXT,
    -- เอกสารหมายเลข 2 (แบบยืนยันแบบตอบรับ)
    -- วันครบกำหนด ๑๕ วันทำการ ปั๊มตอนคณบดีลงนามหนังสือขอความอนุเคราะห์
    -- NULL = ยังไม่ลงนาม = ยังอัปโหลดแบบตอบรับไม่ได้ (คอลัมน์นี้เป็นด่านลำดับในตัว)
    acceptance_due_date DATE,
    -- ⛔ ปั๊มตอนอัปโหลด ห้ามคำนวณย้อนหลัง (เหตุผลเดียวกับ submitted_late)
    acceptance_submitted_late BOOLEAN NOT NULL DEFAULT FALSE,
    -- สิ่งที่เจ้าหน้าที่อ่านจากกระดาษแบบตอบรับแล้วคีย์เข้าระบบ
    acceptance_signer_name VARCHAR(255),
    acceptance_signer_position VARCHAR(255),
    acceptance_signed_date DATE,
    -- หนังสือส่งตัว (ข้อ ๙ ของ ๑๓ ขั้นตอนในคู่มือ) — ออกหลังเจ้าหน้าที่รับแบบตอบรับแล้ว
    -- ⛔ เลขนี้ต้องถูกพิมพ์กลับลงช่อง "ส่วนของเจ้าหน้าที่ฯ" ของเอกสารหมายเลข ๒
    --    ซึ่งวาดสดจาก intent_forms ล้วน จึงเก็บที่นี่ด้วย ไม่ใช่แค่ official_documents
    dispatch_document_no VARCHAR(100),
    -- วันสิ้นสุดการปฏิบัติงาน — มีแต่หนังสือส่งตัวที่ใช้ ("ตั้งแต่วันที่ … ถึงวันที่ …")
    -- ⛔ เจ้าหน้าที่คีย์จากที่ตกลงกับสถานประกอบการจริง ระบบไม่คำนวณให้เอง
    end_date DATE,
    -- นักศึกษาเลือกใช้แบบฟอร์มบันทึกการทำงานของสถานประกอบการแทนแบบฟอร์มกลาง (สหกิจ ๐๙, ๑๐)
    uses_company_log_form BOOLEAN NOT NULL DEFAULT FALSE,
    -- ต้องบันทึกรายวัน (สหกิจ ๐๘) หรือไม่ — **พี่เลี้ยงเป็นคนเปิด/ปิด**
    --
    -- อยู่ที่นี่ไม่ใช่ที่ students เพราะเป็นข้อตกลงของ **การไปฝึกครั้งนี้** ไม่ใช่คุณสมบัติ
    -- ถาวรของตัวนักศึกษา · แถวนี้คือแถวที่ผูกนักศึกษากับพี่เลี้ยง (mentor_id) อยู่แล้ว
    -- ⛔ นักศึกษาปิดเองไม่ได้ · ปิดอยู่ = แท็บรายวันยังแสดงแต่บอกว่าพี่เลี้ยงยังไม่เปิด
    --    (ห้ามซ่อนเงียบ ๆ) และ POST /api/daily-logs ต้องตอบ 403
    -- ⛔ เปิดกลางเทอมมีผล **ตั้งแต่สัปดาห์ปัจจุบันเป็นต้นไป ห้ามย้อนหลัง** — ไม่งั้น
    --    สัปดาห์ที่ผ่านมากลายเป็น "ขาดส่ง" จากการตัดสินใจของคนอื่น (spec-D ข้อ 14.8)
    daily_log_required BOOLEAN NOT NULL DEFAULT FALSE,
    -- งานที่มอบหมายนักศึกษา — ตารางกลางหน้า 2 ของ สหกิจ 07 (สถานประกอบการกรอก)
    -- อยู่ที่นี่เพราะเป็นงานของการไปฝึกครั้งนั้น ไม่ใช่ของตำแหน่งที่ประกาศไว้
    -- (job_posts.title/description คือตำแหน่งที่ "เสนอ" ส่วนนี่คือสิ่งที่ "ได้ทำจริง")
    job_position VARCHAR(255),
    job_description TEXT,
    -- "ใบนี้เข้าคิวมาตั้งแต่เมื่อไหร่" — หน้าแรกของเจ้าหน้าที่นับ "คำร้องค้างเกิน 7 วัน"
    -- (`officer_approved_at` เกิดตอน *จบ* คิว จึงตอบคำถามนี้ไม่ได้)
    -- ⛔ NULL ได้ = แถวที่มีก่อน migration 030 ซึ่งไม่มีใครรู้อายุจริง → อ่านเป็น
    --    "ไม่ทราบ" และ **ห้ามนับเป็นเลยกำหนด** (นับจากค่าที่เดาเอง = ตัวเลขบนจอโกหก)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- ฐานเก็บแค่ข้อเท็จจริง "ส่งช้าต้องมีเหตุผล" ส่วนความยาวขั้นต่ำเป็นกติกาหน้าจอ
    -- อยู่ที่ controller ปรับได้โดยไม่ต้องมี migration ใหม่
    CONSTRAINT intent_forms_late_reason_required
        CHECK (submitted_late = FALSE OR (late_reason IS NOT NULL AND btrim(late_reason) <> '')),
    CONSTRAINT intent_forms_work_period_order
        CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- 8. Document Templates Table
CREATE TABLE IF NOT EXISTS document_templates (
    template_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL -- e.g., 'cover_letter', 'transfer_letter'
);

-- 9. Official Documents Table
CREATE TABLE IF NOT EXISTS official_documents (
    doc_id SERIAL PRIMARY KEY,
    document_number VARCHAR(50),
    type VARCHAR(50) NOT NULL, -- e.g., 'cover_letter', 'transfer_letter', 'dispatch_letter'
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE RESTRICT,
    -- NULL ได้ตั้งแต่ 2026-08-26: หนังสือถูก **วาดจากโค้ด** (utils/coverLetterPdf.ts)
    -- ไม่ได้มาจากแม่แบบอีกแล้ว · คอลัมน์ยังอยู่เพื่อเอกสารเก่าที่เคยผูกกับแม่แบบจริง
    template_id INT REFERENCES document_templates(template_id) ON DELETE RESTRICT,
    generated_file_path VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'created', -- 'created', 'pending_sign', 'signed', 'rejected'
    dean_signature_date TIMESTAMP,
    -- ⚠️ DocuSign ถูกถอดออกทั้งหมดเมื่อ 2026-08-26 (คณบดีกดยืนยันในระบบแทน)
    -- คอลัมน์นี้เก็บไว้เพราะฐานจริงอาจมีค่าเก่าค้างอยู่ ไม่มีใครเขียนลงไปอีกแล้ว
    docusign_envelope_id VARCHAR(255),
    -- "ใบนี้ถูกออกเมื่อไหร่" — กองงาน "ค้างที่คณบดี" บนหน้าแรกของเจ้าหน้าที่ต้องบอกได้ว่า
    -- ค้างมากี่วัน ไม่ใช่แค่ว่ามีกี่ใบ · ⛔ NULL ได้ด้วยเหตุผลเดียวกับ intent_forms.created_at
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Staging Table for the Student Roster (ชื่อตารางยังเป็น eligible_ ตามประวัติ)
-- This is the authoritative source for the registry cumulative_gpa; students can
-- never set it on themselves. `email` optionally binds a student_code to one
-- account so a classmate's code cannot be claimed to inherit their GPA.
-- ⛔ คอลัมน์ is_eligible ถูกลบ 2026-09-14 (migration 031 · SEC-02)
CREATE TABLE IF NOT EXISTS eligible_students_list (
    student_code VARCHAR(50) PRIMARY KEY,
    cumulative_gpa NUMERIC(3, 2) NOT NULL,
    email VARCHAR(255)
);

-- 11. Staging Table for Personnel (CSV Import for Onboarding)
-- SEC-01: `email` binds an employee_code to exactly one identity. A claim is only
-- accepted when the authenticated account's email matches this column, so knowing
-- (or guessing) an employee_code is not by itself enough to obtain a staff role.
CREATE TABLE IF NOT EXISTS personnel_preseed_list (
    employee_code VARCHAR(50) PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL CHECK (role_name IN ('advisor', 'dean', 'staff', 'dept_head')),
    major_id INT REFERENCES master_major(major_id) ON DELETE SET NULL,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    is_claimed BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    claimed_at TIMESTAMP
);

-- Ensure only one active (non-rejected) intent form exists per student and semester
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_semester_active 
ON intent_forms (student_id, semester_id) 
--
-- 'superseded' = ใบเดิมถูกแทนที่ตอนนักศึกษาเปลี่ยนสถานประกอบการ ถ้าไม่ยกเว้นไว้
-- คนที่บริษัทตอบรับแล้วและต้องย้ายที่จะยื่นใบใหม่ไม่ได้เลย
-- 'rejected_by_dept_head' เลิกใช้แล้ว (2026-08-27) แต่คงไว้เพราะฐานจริงอาจมีแถวเก่าค้าง
-- ถอดออกเมื่อไหร่ แถวเก่าจะกลับมานับเป็นใบที่ยังใช้งานอยู่แล้ว index สร้างไม่ผ่าน
WHERE status NOT IN ('rejected', 'company_rejected', 'rejected_by_dept_head', 'superseded');

-- บันทึกข้อความของนักศึกษา (2026-09-01)
--
-- คู่มือ PDF หน้า 45-50 ระบุกรณียกเว้น 3 กรณีที่ต้องยื่น "บันทึกข้อความ" ถึงคณบดี
-- (ออกก่อนกำหนด · เปลี่ยนสถานประกอบการ · ถูกส่งตัวกลับ) และเจ้าหน้าที่งานสหกิจเล่าถึง
-- กรณีที่สี่คือส่งเอกสารล่าช้า ซึ่งใช้กลไกเดียวกันแต่ยังไม่ถูกเขียนเป็นลายลักษณ์อักษร
--
-- ⛔ ทำไมต้องเป็นตารางแยก ไม่ใช่คอลัมน์บน intent_forms:
--    สามกรณีในคู่มือเกิดได้ **ระหว่างปฏิบัติงาน** ไม่ผูกกับช่วงยื่นใบความจำนง และคนหนึ่ง
--    ยื่นได้หลายใบในภาคเดียว (เช่นเปลี่ยนที่แล้วต่อมาถูกส่งตัวกลับ) ต่างจากธง
--    submitted_late ที่เป็นคุณสมบัติของ "การยื่นครั้งนั้น" จึงอยู่บน intent_forms ถูกแล้ว

CREATE TABLE IF NOT EXISTS student_memos (
    memo_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT,

    -- หัวข้อที่ **นักศึกษาเลือกเอง** — ระบบเลือกไว้ให้ล่วงหน้าตามบริบทเท่านั้น
    -- ไม่ตัดสินแทน (เจ้าของเคาะ 2026-09-01) · ชุดค่าที่ยอมรับอยู่ที่
    -- backend/src/config/memoTypes.ts ที่เดียว จงใจไม่ทำ CHECK ตรงนี้ให้เป็น
    -- แหล่งความจริงที่สอง (เหตุผลเดียวกับ coop_calendar_events.activity_key)
    memo_type VARCHAR(30) NOT NULL,

    -- ใบความจำนงที่บันทึกฉบับนี้อ้างถึง ถ้ามี · SET NULL เพราะบันทึกเป็นหลักฐาน
    -- ที่ต้องอยู่ต่อแม้ใบความจำนงจะถูกลบ
    intent_form_id INT REFERENCES intent_forms(form_id) ON DELETE SET NULL,

    -- เหตุผลที่นักศึกษาเขียนเอง — ถูกพิมพ์ลงบรรทัด "มีความประสงค์…เนื่องจาก…"
    -- ซึ่งเป็นสิ่งที่คณบดีอ่านจริง ระบบเติมแทนไม่ได้
    reason TEXT NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT student_memos_reason_required CHECK (btrim(reason) <> '')
);

-- ผู้เรียกจริงมีสองแบบ: "บันทึกของนักศึกษาคนนี้" และ "บันทึกของภาคนี้ทั้งหมด"
-- ทั้งคู่เรียงตามใหม่สุดก่อน จึงพอด้วย index เดียว
CREATE INDEX IF NOT EXISTS idx_student_memos_student ON student_memos (student_id, memo_id DESC);
CREATE INDEX IF NOT EXISTS idx_student_memos_semester ON student_memos (semester_id, memo_id DESC);

-- 12. Accommodations Table
-- สหกิจ 06 — แบบแจ้งรายละเอียดที่พัก · **ผู้กรอกคือนักศึกษา** เรียนหัวหน้าสหกิจศึกษาฯ
CREATE TABLE IF NOT EXISTS accommodations (
    student_id INT PRIMARY KEY REFERENCES students(student_id) ON DELETE CASCADE,
    -- ⛔ ที่อยู่ก้อนเดียวของเดิม (ก่อน 2026-09-03) — **อ่านอย่างเดียว ห้ามเขียนเพิ่ม**
    --    แยกอัตโนมัติไม่ได้เพราะชื่อสถานที่ไทยไม่มีตัวคั่นคำ เดาผิดแล้วเพี้ยนเงียบ
    --    เก็บไว้ให้นักศึกษาเห็นตอนกรอกใหม่ครั้งเดียว (migration 010)
    address_legacy TEXT,
    -- ช่องที่อยู่ตามฟอร์มจริง
    house_no VARCHAR(50),
    building VARCHAR(255),
    room_no VARCHAR(50),
    soi VARCHAR(255),
    road VARCHAR(255),
    subdistrict VARCHAR(100),
    district VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(10),
    -- `phone` = โทรศัพท์ของที่พัก (ของเดิม) · `mobile_phone` = มือถือนักศึกษา
    phone VARCHAR(50),
    mobile_phone VARCHAR(50),
    fax VARCHAR(50),
    email VARCHAR(255),
    -- "แผนที่แสดงตำแหน่งที่ตั้ง" บนฟอร์ม — มีไว้ให้อาจารย์ใช้ตอนออกนิเทศ
    -- ⛔ เก็บพิกัดอย่างเดียว ฝั่งอาจารย์เป็น**ลิงก์**ออกไป Google Maps ไม่ฝังแผนที่
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    -- ⛔ ค่าเก่าก่อนย้ายผู้ติดต่อฉุกเฉินไปอยู่บน `students` (migration 013)
    --    **อ่านอย่างเดียว ห้ามเขียนเพิ่ม** — แหล่งความจริงคือโปรไฟล์นักศึกษาแล้ว
    emergency_contact_legacy VARCHAR(255),
    emergency_relationship_legacy VARCHAR(100),
    emergency_phone_legacy VARCHAR(50)
);

-- 13. Weekly Work Plans Table
CREATE TABLE IF NOT EXISTS weekly_work_plans (
    plan_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    week_number INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    tasks TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'planned',
    UNIQUE (student_id, week_number)
);

-- 14. Report Outlines Table (Phase 3)
CREATE TABLE IF NOT EXISTS report_outlines (
    outline_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending_mentor', -- 'pending_mentor', 'pending_advisor', 'approved', 'rejected'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Report Outline Versions Table
CREATE TABLE IF NOT EXISTS report_outline_versions (
    version_id SERIAL PRIMARY KEY,
    outline_id INT NOT NULL REFERENCES report_outlines(outline_id) ON DELETE CASCADE,
    file_path VARCHAR(255),
    report_title VARCHAR(500),
    outline_text TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rejection_comment TEXT,
    reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL, -- Who rejected/approved it
    status VARCHAR(50) NOT NULL DEFAULT 'submitted' -- 'submitted', 'rejected', 'approved'
);

-- 15. Supervision Appointments (Phase 3)
CREATE TABLE IF NOT EXISTS supervision_appointments (
    appointment_id SERIAL PRIMARY KEY,
    advisor_id INT NOT NULL REFERENCES personnel(personnel_id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE RESTRICT,
    appointment_date DATE,
    student_time VARCHAR(50),
    mentor_time VARCHAR(50),
    tour_requested BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'pending_company', 'accepted', 'rescheduled', 'offline_agreed'
    proposed_reschedule_date DATE,
    proposed_mentor_time VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 16. Supervision Logs (Phase 3)
CREATE TABLE IF NOT EXISTS supervision_logs (
    log_id SERIAL PRIMARY KEY,
    appointment_id INT NOT NULL REFERENCES supervision_appointments(appointment_id) ON DELETE CASCADE,
    preliminary_score INT,
    behavior_notes TEXT,
    evidence_photos JSONB, -- JSON array of file paths
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- 'draft', 'submitted'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 16b. Supervision Records (สหกิจ 13 — แบบบันทึกการนิเทศงาน)
--
-- ⛔ **คนละชั้นกับสองตารางด้านบน อย่าสับสน**
--    `supervision_appointments` = การ **นัดหมาย** ไปนิเทศ (อาจารย์ ↔ นักศึกษา ↔ บริษัท)
--    `supervision_logs`         = บันทึกย่อหลังนิเทศ ผูกกับนัดหมายหนึ่งครั้ง
--    `supervision_records`      = **แบบฟอร์ม สหกิจ 13 อย่างเป็นทางการ 37 ข้อ**
--                                 ผูกกับ *นักศึกษา + ครั้งที่นิเทศ* ไม่ใช่กับนัดหมาย
--    เหตุที่ไม่ผูกกับ `appointment_id`: การนิเทศเกิดขึ้นได้แม้ไม่ได้นัดผ่านระบบ
--    การบังคับให้มีนัดก่อนเท่ากับปิดทางบันทึกของจริง
-- 🟡 หนี้ที่รู้ตัว: `supervision_logs.preliminary_score` ซ้อนความหมายกับข้อ 7 ของใบนี้
--    (สรุปโดยรวมของนักศึกษา) — ยังไม่ยุบเพราะหน้าจอนัดหมายใช้อยู่ ยุบเมื่อไหร่ให้ย้ายมาทางนี้
CREATE TABLE IF NOT EXISTS supervision_records (
    record_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    -- ⛔ RESTRICT เพราะบันทึกนี้เป็นหลักฐาน ต้องรู้เสมอว่าใครเป็นคนนิเทศ
    supervisor_id INT NOT NULL REFERENCES personnel(personnel_id) ON DELETE RESTRICT,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE RESTRICT,
    -- "การนิเทศครั้งที่ __" บนหัวฟอร์ม — คู่มือกำหนดให้นิเทศ 2 ครั้ง
    visit_number INT NOT NULL CHECK (visit_number IN (1, 2)),
    visit_date DATE NOT NULL,
    -- คีย์ตาม `config/supervisionRubric.ts` · ค่าเป็น 1-5 หรือ **null** เมื่ออาจารย์เลือก "-"
    -- ⛔ null = "ไม่ประเมิน" ไม่ใช่ 0 — และใบนี้ **จงใจไม่มี total_score**
    --    เพราะไม่ได้เอาไปตัดเกรด การรวมคะแนนที่มี null ปนให้ตัวเลขที่ตีความไม่ได้
    scores JSONB NOT NULL,
    -- ทุกข้อมีช่อง "หมายเหตุ" ของตัวเองบนกระดาษ
    remarks JSONB,
    -- checkbox 4 รายการ: เอกสารที่อาจารย์สั่งให้นักศึกษาส่ง (ไม่ใช่สถานะที่ระบบคำนวณ)
    documents_required JSONB,
    additional_notes TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- นิเทศครั้งเดียวได้บันทึกเดียว · แก้ได้ด้วยการส่งทับ (UPSERT)
    UNIQUE (student_id, visit_number)
);

-- อาจารย์เปิดหน้าจอแล้วดึง "บันทึกของนักศึกษาคนนี้" เป็นหลัก
CREATE INDEX IF NOT EXISTS idx_supervision_records_student
    ON supervision_records (student_id, visit_number);

-- 16.9 Daily Logs (สหกิจ 08 แบบรายงานการปฏิบัติงานประจำวัน)
--
-- คู่มือไม่ได้บังคับให้ทุกคนทำ — ให้ตกลงกันเองตามลักษณะงาน สวิตช์จึงอยู่ที่
-- intent_forms.daily_log_required และ **พี่เลี้ยงเป็นคนเปิด** (นักศึกษาปิดเองไม่ได้
-- เพราะนั่นคือการยกเลิกภาระงานของตัวเอง)
--
-- ⛔ **ส่งและรับรองเป็นชุดทั้งสัปดาห์ ไม่ใช่ทีละวัน** — ถ้ารับรองรายวัน พี่เลี้ยงต้องกด
--    ~90 ครั้งต่อนักศึกษาหนึ่งคน ซึ่งจะไม่มีใครทำ · week_number จึงต้องมีในแถว
--    ไม่ใช่คำนวณสดจาก log_date ตอน query
-- คอลัมน์ชุดสถานะ/การรับรองเหมือน weekly_logs และ monthly_logs ทุกประการโดยตั้งใจ
-- หน้าจอและตรรกะการรับรองจะได้เป็นชุดเดียวกันทั้งสามใบ
CREATE TABLE IF NOT EXISTS daily_logs (
    daily_log_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    week_number INT NOT NULL,
    log_date DATE NOT NULL,
    work_detail TEXT,
    -- คอลัมน์ "หมายเหตุ" ที่อยู่ท้ายตารางบนกระดาษ สหกิจ 08
    remark TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',   -- draft | submitted | returned
    external_file_path VARCHAR(255),
    summary TEXT,
    mentor_certified_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    mentor_certified_at TIMESTAMPTZ,               -- NULL = ยังไม่รับรอง
    returned_comment TEXT,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT daily_logs_student_date_key UNIQUE (student_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_logs_student_week ON daily_logs (student_id, week_number);

-- 17. Weekly Logs (Phase 3)
CREATE TABLE IF NOT EXISTS weekly_logs (
    weekly_log_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    week_number INT NOT NULL,
    assigned_work TEXT,
    methods TEXT,
    tools_used TEXT,
    achievements TEXT,
    problems TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    start_date DATE,
    end_date DATE,
    external_file_path VARCHAR(255),
    summary TEXT,
    mentor_certified_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    mentor_certified_at TIMESTAMPTZ,
    returned_comment TEXT,
    submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT weekly_logs_student_week_key UNIQUE (student_id, week_number)
);

-- 17.1 Monthly Logs (สหกิจ 10)
CREATE TABLE IF NOT EXISTS monthly_logs (
    monthly_log_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    year INT NOT NULL,
    month INT NOT NULL,
    work_summary TEXT,
    effectiveness TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    start_date DATE,
    end_date DATE,
    external_file_path VARCHAR(255),
    summary TEXT,
    mentor_certified_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    mentor_certified_at TIMESTAMPTZ,
    returned_comment TEXT,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT idx_monthly_logs_student_month UNIQUE (student_id, year, month)
);

-- 18. Final Reports (Phase 4)
CREATE TABLE IF NOT EXISTS final_reports (
    report_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    file_path VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
    rejection_comment TEXT,
    version INT NOT NULL DEFAULT 1,
    reviewer_kind VARCHAR(10) NOT NULL DEFAULT 'advisor',
    reviewer_comment TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP
);

-- 18.1 Report Confirmations (สหกิจ 14)
CREATE TABLE IF NOT EXISTS report_confirmations (
    confirmation_id SERIAL PRIMARY KEY,
    student_id  INT NOT NULL UNIQUE REFERENCES students(student_id) ON DELETE CASCADE,
    report_id   INT NOT NULL REFERENCES final_reports(report_id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    certified_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    certified_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'   -- pending | certified
);

-- 19. Final Evaluations (Phase 4)
--
-- พนักงานที่ปรึกษา (พี่เลี้ยง) กรอกสองใบต่อนักศึกษาหนึ่งคน — ทั้งคู่เป็นของพี่เลี้ยง
-- ตามที่แบบฟอร์มจริงระบุ ไม่ใช่ของอาจารย์:
--   sahatkit_15 — แบบประเมินผลนักศึกษา 18 ข้อ เต็ม 100 → ใช้ตัดเกรด
--   sahatkit_16 — แบบประเมินรายงาน 14 ข้อ ระดับ 1-5 เต็ม 70 → เรตติ้งดิบ ไม่รวมเกรด
--
-- คีย์เดิมเป็น (student_id, evaluator_role) ใบที่สองจึงไป ON CONFLICT ทับใบแรก
-- form_code เข้ามาเป็นคอลัมน์ที่สามของ UNIQUE เพื่อให้สองใบอยู่ร่วมกันได้
--
-- `evaluator_role` ยังอนุญาต 'advisor' ทั้งที่เฟสนี้ไม่มีใครเขียน — จงใจไม่แตะ
-- เพราะ สหกิจ 13 (แบบบันทึกการนิเทศของอาจารย์) ยังไม่ตัดสินว่าจะลงตารางนี้
-- หรือไปอยู่กับ supervision_logs การตัด CHECK ทิ้งตอนนี้คือการปิดทางล่วงหน้า
--
-- ⚠️ ต้องตั้งชื่อ UNIQUE เอง — e2e/schema-drift.spec.ts เทียบ pg_indexes.indexdef
-- ซึ่งมีชื่อ index อยู่ในสตริง ถ้าปล่อยให้ Postgres ตั้งเอง ชื่อจะไม่ตรงกับฝั่ง
-- migration ที่ใช้ ADD CONSTRAINT แล้วเทสต์จะแดง
CREATE TABLE IF NOT EXISTS final_evaluations (
    evaluation_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    evaluator_role VARCHAR(50) NOT NULL CHECK (evaluator_role IN ('mentor', 'advisor')),
    form_code VARCHAR(20) NOT NULL CHECK (form_code IN ('sahatkit_15', 'sahatkit_16')),
    scores_detail JSONB NOT NULL,
    total_score NUMERIC(5, 2) NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT final_evaluations_student_form_key UNIQUE (student_id, evaluator_role, form_code)
);

-- 20. Audit Log (append-only)
-- The system issues signed official documents and records grades, but had no
-- record of who approved, signed, or changed a role. Rows are never updated or
-- deleted by application code; actor_id is nullable so a deleted account does not
-- erase its own history.
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    actor_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    actor_roles TEXT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    subject_id INT,
    detail JSONB,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_subject ON audit_log (subject_id);

-- 21. Mentor Notifications (Phase 4 Cooldown)
CREATE TABLE IF NOT EXISTS mentor_notifications (
    student_id INT PRIMARY KEY REFERENCES students(student_id) ON DELETE CASCADE,
    last_notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notification_count INT NOT NULL DEFAULT 1
);

-- 22. Monthly Work Plans (สหกิจ 07 หน้า 3 แผนปฏิบัติงานรายเดือน)
--
-- ⛔ **เลิกใช้แล้ว — ของจริงย้ายไปที่ work_plan_topics ข้างล่าง (ข้อ 22.1)**
--    ตารางนี้เก็บ "หนึ่งหัวข้อต่อหนึ่งเดือน" (UNIQUE student_id, month_index)
--    แต่กระดาษ สหกิจ 07 หน้า 3 เป็น **เมทริกซ์ หัวข้องาน × เดือน** คือหนึ่งหัวข้องาน
--    กินได้หลายเดือน (แบบ Gantt อย่างง่าย) โครงเดิมจึงเก็บของจริงไม่ได้
--    ยังไม่ลบทิ้งในรอบนี้โดยตั้งใจ เพื่อให้ฐานที่ migrate แล้วยังมีข้อมูลเดิมให้ย้อนดูได้
--    หนึ่งรอบ · ลบเมื่อยืนยันว่าไม่มีโค้ดไหนอ่านมันแล้ว
CREATE TABLE IF NOT EXISTS monthly_work_plans (
    plan_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    month_index INT NOT NULL,
    topic TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (student_id, month_index)
);

-- 22.1 Work Plan Topics — **แผนปฏิบัติงานตัวจริงตาม สหกิจ 07 หน้า 3**
--
-- กระดาษเป็นตารางเมทริกซ์: แถวคือหัวข้องาน คอลัมน์คือเดือน · งานหนึ่งชิ้นติ๊กได้หลายเดือน
--
--   | หัวข้องาน | เดือนที่ 1 | เดือนที่ 2 | เดือนที่ 3 | เดือนที่ 4 |
--
-- ⛔ **months เป็น INT[] ไม่ใช่คอลัมน์ month_1..month_4** — ช่วงปฏิบัติงานจริงคร่อมได้
--    5 เดือน (เช่น 1 พ.ย. – 20 มี.ค.) คอลัมน์ตายตัว 4 ช่องจะไม่มีที่ลงให้เดือนสุดท้าย
--    ซึ่งขัดกับกฎ "ห้ามฮาร์ดโค้ด 4 เดือน" ที่ตั้งไว้เอง · จำนวนคอลัมน์บนหน้าจอคำนวณ
--    จาก intent_forms.start_date – end_date เสมอ
-- ผู้ให้ข้อมูลคือ **นักศึกษาร่วมกับพนักงานที่ปรึกษา** และลงนามสองฝ่าย
-- สถานะการลงนามอยู่ที่ work_plan_approvals (ข้อ 23) ไม่ซ้ำที่นี่
CREATE TABLE IF NOT EXISTS work_plan_topics (
    topic_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    seq INT NOT NULL,                    -- ลำดับแถวบนกระดาษ
    topic TEXT NOT NULL,
    months INT[] NOT NULL DEFAULT '{}',  -- เดือนที่งานนี้กิน เช่น {2,3}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT work_plan_topics_student_seq_key UNIQUE (student_id, seq)
);

-- 23. Work Plan Approvals (สายการรับรองแผนงาน 3 ฝ่าย)
CREATE TABLE IF NOT EXISTS work_plan_approvals (
    approval_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    approver_role VARCHAR(20) NOT NULL, -- 'mentor', 'advisor', 'supervisor'
    approver_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    approved_at TIMESTAMPTZ,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (student_id, approver_role)
);

