-- PostgreSQL Database Schema for Online Cooperative Education Management System (Consolidated Base Schema)

-- Drop existing tables to start clean in development environment
DROP TABLE IF EXISTS audit_log CASCADE;
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
DROP TABLE IF EXISTS supervision_logs CASCADE;
DROP TABLE IF EXISTS supervision_appointments CASCADE;
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
    is_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    is_orientation_passed BOOLEAN NOT NULL DEFAULT FALSE,
    advisor_id INT REFERENCES personnel(personnel_id) ON DELETE SET NULL,
    supervisor_id INT REFERENCES personnel(personnel_id) ON DELETE SET NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    nickname VARCHAR(100),
    year_level INT,
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
    email VARCHAR(255)
);

-- Mentors Table (Profile for Company Supervisors)
CREATE TABLE IF NOT EXISTS mentors (
    mentor_id INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    position VARCHAR(255),
    department VARCHAR(255),
    phone VARCHAR(50) NOT NULL
);

-- 5. Coop Semesters Table
CREATE TABLE IF NOT EXISTS coop_semesters (
    semester_id SERIAL PRIMARY KEY,
    academic_year INT NOT NULL,
    semester VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 6. Job Posts Table
CREATE TABLE IF NOT EXISTS job_posts (
    job_id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    image_path VARCHAR(255),
    created_by INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    quota INT NOT NULL,
    applied_count INT NOT NULL DEFAULT 0,
    expire_date TIMESTAMP NOT NULL,
    -- 'rejected' is distinct from 'closed' on purpose: closed means the posting
    -- ran its course, rejected means staff turned it down. Reusing 'closed' for
    -- both would have told the company its advert expired when in fact it was
    -- refused, and left nowhere to put the reason.
    status VARCHAR(50) NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'published', 'closed', 'rejected')),
    reject_reason TEXT
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
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    -- วันสุดท้ายที่ยังรับแบบ "ส่งช้า" — NULL = ไม่เปิดผ่อนผัน = ปิดจริงที่ end_date
    -- ระบบเดาแทนคณะไม่ได้ว่าผ่อนผันถึงวันไหน จึงต้องมีคนกรอก ไม่มีค่าเริ่มต้น
    late_end_date DATE,
    note TEXT,
    -- SET NULL rather than RESTRICT or CASCADE, on purpose: deleting a staff
    -- account must not fail because of the calendar (RESTRICT) and must not take
    -- a whole cohort's schedule down with it (CASCADE, which is what
    -- `announcements` does). Who set what lives in `audit_log` per SEC-07.
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT coop_calendar_events_range CHECK (end_date >= start_date),
    CONSTRAINT coop_calendar_events_late_range CHECK (late_end_date IS NULL OR late_end_date >= end_date),
    CONSTRAINT coop_calendar_events_title_required CHECK (activity_key IS NOT NULL OR title IS NOT NULL)
);

-- A fixed activity gets one window per semester, so the staff screen is a fixed
-- list of rows with two date fields — no logic deciding which row is the real
-- one. Partial index: free-form entries (key NULL) may repeat freely.
CREATE UNIQUE INDEX IF NOT EXISTS idx_coop_calendar_activity_once
    ON coop_calendar_events (semester_id, activity_key)
    WHERE activity_key IS NOT NULL;

-- The only index with a real caller: fetch a whole semester in date order for
-- the calendar screen. The gate already rides the unique index above.
CREATE INDEX IF NOT EXISTS idx_coop_calendar_semester ON coop_calendar_events (semester_id, start_date);

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
    docusign_envelope_id VARCHAR(255)
);

-- 10. Staging Table for Eligible Students
-- This is the authoritative source for is_eligible and cumulative_gpa; students
-- can never set either on themselves. `email` optionally binds a student_code to
-- one account so a classmate's code cannot be claimed to inherit their eligibility.
CREATE TABLE IF NOT EXISTS eligible_students_list (
    student_code VARCHAR(50) PRIMARY KEY,
    cumulative_gpa NUMERIC(3, 2) NOT NULL,
    -- SEC-02: defaults to FALSE. Every insert supplies this column explicitly
    -- today, so the default is only a trap waiting for the next one that doesn't.
    is_eligible BOOLEAN NOT NULL DEFAULT FALSE,
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
    file_path VARCHAR(255) NOT NULL,
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

-- 17. Weekly Logs (Phase 3)
CREATE TABLE IF NOT EXISTS weekly_logs (
    weekly_log_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    week_number INT NOT NULL,
    achievements TEXT NOT NULL,
    problems TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 18. Final Reports (Phase 4)
CREATE TABLE IF NOT EXISTS final_reports (
    report_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    file_path VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
    rejection_comment TEXT,
    version INT NOT NULL DEFAULT 1,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP
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
