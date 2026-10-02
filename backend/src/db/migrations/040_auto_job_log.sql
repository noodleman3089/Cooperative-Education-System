-- 040 · สมุดจดงานอัตโนมัติของระบบ (เฟส 3 "เตือนพี่เลี้ยงอัตโนมัติ")
--
-- ใช้จำแค่ว่าอีเมลสรุปประจำสัปดาห์ถึงเจ้าหน้าที่ (พี่เลี้ยงที่เงียบหลังระบบเตือนครบเพดาน) ถูกส่งไปเมื่อไหร่
-- เพื่อไม่ส่งซ้ำภายใน 7 วัน — job_name = 'mentor_silent_digest'
-- ไม่เก็บข้อมูลส่วนตัวของใคร (detail = จำนวนที่ส่ง/จำนวนพี่เลี้ยงที่เงียบ) · การเตือนพี่เลี้ยงแต่ละครั้งอยู่ที่ mentor_reminders (kind = 'auto')
CREATE TABLE IF NOT EXISTS auto_job_log (
    log_id SERIAL PRIMARY KEY,
    job_name VARCHAR(40) NOT NULL,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    detail JSONB
);
CREATE INDEX IF NOT EXISTS idx_auto_job_log_job ON auto_job_log(job_name, ran_at DESC);
