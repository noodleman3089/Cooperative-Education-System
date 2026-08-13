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
    interested_job_types JSONB
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

-- 6.5. Coop Applications Table (System 1)
CREATE TABLE IF NOT EXISTS coop_applications (
    application_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT,
    
    -- ข้อมูลจากนักศึกษา
    expected_region VARCHAR(255),
    special_skills TEXT,
    
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
    parental_consent_path VARCHAR(255),
    -- Why the placement was turned down. Written by the company's rejection for
    -- now: the advisor and department head already mail their reason and record
    -- it in audit_log, but the company had nowhere at all to put one, so a
    -- student was told they were rejected and never why. It lives on the row
    -- rather than only in audit_log because the person who has to read it is the
    -- student, and audit_log has no read API by design (SEC-07) — the same
    -- reasoning as job_posts.reject_reason in round 17.
    reject_reason TEXT
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
    template_id INT NOT NULL REFERENCES document_templates(template_id) ON DELETE RESTRICT,
    generated_file_path VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'created', -- 'created', 'pending_sign', 'signed', 'rejected'
    dean_signature_date TIMESTAMP,
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
WHERE status NOT IN ('rejected', 'company_rejected', 'rejected_by_dept_head');

-- 12. Accommodations Table
CREATE TABLE IF NOT EXISTS accommodations (
    student_id INT PRIMARY KEY REFERENCES students(student_id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    phone VARCHAR(50),
    emergency_contact VARCHAR(255),
    emergency_relationship VARCHAR(100),
    emergency_phone VARCHAR(50)
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
CREATE TABLE IF NOT EXISTS final_evaluations (
    evaluation_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    evaluator_role VARCHAR(50) NOT NULL CHECK (evaluator_role IN ('mentor', 'advisor')),
    scores_detail JSONB NOT NULL,
    total_score NUMERIC(5, 2) NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, evaluator_role)
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
