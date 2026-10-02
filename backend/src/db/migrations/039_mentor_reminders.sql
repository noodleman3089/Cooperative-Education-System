-- 039 · ประวัติการเตือนพี่เลี้ยง (Phase 2 "คณะตามพี่เลี้ยง")
--
-- คณะ/เจ้าหน้าที่เห็นว่าพี่เลี้ยงคนไหนมีงานค้างและกดเตือนได้ (อีเมลสรุป + ลิงก์เข้าสู่ระบบใช้ครั้งเดียว)
-- ตารางนี้เก็บทุกครั้งที่เตือน เพื่อ (1) กัน cooldown 24 ชม. ต่อพี่เลี้ยง (2) แสดง "เตือนไปกี่ครั้ง" ที่การ์ดนักศึกษา
--
-- kind: 'summary' = เตือนงานค้างรวม (หน้า คณะตามพี่เลี้ยง) · 'final_report' = แจ้งประเมินรายนักศึกษา (ปุ่มเดิมของอาจารย์)
--       'auto' = สงวนไว้สำหรับเฟสถัดไป — ยังไม่มีโค้ดไหนเขียนค่านี้
-- student_id = NULL เมื่อเป็นสรุปรวมหลายคน · sent_by = NULL เมื่อไม่ทราบผู้กด
CREATE TABLE IF NOT EXISTS mentor_reminders (
    reminder_id SERIAL PRIMARY KEY,
    mentor_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    student_id INT REFERENCES students(student_id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('summary', 'final_report', 'auto')),
    sent_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mentor_reminders_mentor ON mentor_reminders(mentor_id, created_at DESC);
