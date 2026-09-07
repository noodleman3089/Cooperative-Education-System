-- 025_daily_logs_and_mentor_fields.sql
-- สามอย่างที่ฝ่ายพี่เลี้ยงต้องใช้และยังไม่มีในฐานเลย:
--   1. บันทึกรายวัน (สหกิจ 08) พร้อมสวิตช์ที่พี่เลี้ยงเป็นคนเปิด
--   2. ช่องโทรสารของพนักงานที่ปรึกษา (สหกิจ 07 หน้า 2)
--   3. งานที่มอบหมายนักศึกษารายคน (ตารางกลางหน้า 2 ของ สหกิจ 07)

-- 1. บันทึกรายวัน — ส่งและรับรอง **เป็นชุดทั้งสัปดาห์** ไม่ใช่ทีละวัน
--    (รับรองรายวัน = พี่เลี้ยงต้องกด ~90 ครั้งต่อนักศึกษาหนึ่งคน ซึ่งจะไม่มีใครทำ)
CREATE TABLE IF NOT EXISTS daily_logs (
    daily_log_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    week_number INT NOT NULL,
    log_date DATE NOT NULL,
    work_detail TEXT,
    remark TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    external_file_path VARCHAR(255),
    summary TEXT,
    mentor_certified_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    mentor_certified_at TIMESTAMPTZ,
    returned_comment TEXT,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT daily_logs_student_date_key UNIQUE (student_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_logs_student_week ON daily_logs (student_id, week_number);

-- 2. สวิตช์บันทึกรายวัน — อยู่ที่ intent_forms เพราะเป็นข้อตกลงของการไปฝึกครั้งนี้
--    ⛔ ห้ามย้ายไปที่ students · ค่าเริ่มต้นคือปิด ตามคู่มือที่ให้ตกลงกันเอง
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS daily_log_required BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. งานที่มอบหมายนักศึกษา (สหกิจ 07 หน้า 2) — สิ่งที่ได้ทำจริง คนละอย่างกับตำแหน่งที่เสนอไว้
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS job_position VARCHAR(255);
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS job_description TEXT;

-- 4. โทรสารของพนักงานที่ปรึกษา (อีเมลอยู่ที่ users.email อยู่แล้ว ไม่เก็บซ้ำ)
ALTER TABLE mentors ADD COLUMN IF NOT EXISTS fax VARCHAR(50);
