-- 020_work_logs_and_outline_content.sql
-- บันทึกการปฏิบัติงาน สหกิจ 09 (รายสัปดาห์ 5 หัวข้อ), สหกิจ 10 (รายเดือน 2 ประเด็น)
-- และโครงร่างรายงาน สหกิจ 11 (หัวข้อรายงาน + โครงร่างเนื้อหาพอสังเขป)

-- 1. ขยาย weekly_logs (สหกิจ 09) ให้ครบ 5 หัวข้อตามแบบฟอร์มจริง + คอลัมน์ร่วม
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS assigned_work TEXT;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS methods TEXT;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS tools_used TEXT;
ALTER TABLE weekly_logs ALTER COLUMN achievements DROP NOT NULL;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft';
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS external_file_path VARCHAR(255);
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS mentor_certified_by INT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS mentor_certified_at TIMESTAMPTZ;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS returned_comment TEXT;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE weekly_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'weekly_logs_student_week_key'
    ) THEN
        ALTER TABLE weekly_logs ADD CONSTRAINT weekly_logs_student_week_key UNIQUE (student_id, week_number);
    END IF;
END $$;

-- 2. ตารางใหม่ monthly_logs (สหกิจ 10)
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

-- 3. สวิตช์ uses_company_log_form ที่ intent_forms (นักศึกษาเลือกใช้แบบฟอร์มของสถานประกอบการ)
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS uses_company_log_form BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. ขยาย report_outline_versions (สหกิจ 11) เก็บหัวข้อรายงานและโครงร่างสังเขป (ไฟล์แนบผ่อนให้ NULL ได้)
ALTER TABLE report_outline_versions ADD COLUMN IF NOT EXISTS report_title VARCHAR(500);
ALTER TABLE report_outline_versions ADD COLUMN IF NOT EXISTS outline_text TEXT;
ALTER TABLE report_outline_versions ALTER COLUMN file_path DROP NOT NULL;
