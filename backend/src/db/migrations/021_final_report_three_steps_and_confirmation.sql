-- 021_final_report_three_steps_and_confirmation.sql
-- รองรับการส่งรายงานฉบับสมบูรณ์ 3 ขั้นตอน:
-- ขั้นที่ 1: ส่งร่างรายงานให้พี่เลี้ยงตรวจ (reviewer_kind='mentor')
-- ขั้นที่ 2: ส่งฉบับสมบูรณ์ให้อาจารย์ (reviewer_kind='advisor')
-- ขั้นที่ 3: ใบแจ้งยืนยันการส่งรายงาน สหกิจ 14 (report_confirmations)

-- 1. เพิ่มคอลัมน์ใน final_reports สำหรับแยกชนิดผู้ตรวจและความเห็น
ALTER TABLE final_reports ADD COLUMN IF NOT EXISTS reviewer_kind VARCHAR(10) NOT NULL DEFAULT 'advisor';
ALTER TABLE final_reports ADD COLUMN IF NOT EXISTS reviewer_comment TEXT;

-- 2. สร้างตารางใหม่ report_confirmations (สหกิจ 14)
CREATE TABLE IF NOT EXISTS report_confirmations (
    confirmation_id SERIAL PRIMARY KEY,
    student_id  INT NOT NULL UNIQUE REFERENCES students(student_id) ON DELETE CASCADE,
    report_id   INT NOT NULL REFERENCES final_reports(report_id) ON DELETE RESTRICT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    certified_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    certified_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'   -- pending | certified
);
