-- 022_monthly_work_plans_and_approvals.sql
-- รองรับแผนปฏิบัติงานรายเดือน (สหกิจ 07 หน้า 3) และสายการรับรอง 3 ฝ่าย (พี่เลี้ยง -> อาจารย์ที่ปรึกษา -> อาจารย์นิเทศ)

-- 1. ตาราง monthly_work_plans สำหรับแผนปฏิบัติงานรายเดือน
CREATE TABLE IF NOT EXISTS monthly_work_plans (
    plan_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    month_index INT NOT NULL,
    topic TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (student_id, month_index)
);

-- 2. ตาราง work_plan_approvals สำหรับสายการรับรองแผนงาน
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
