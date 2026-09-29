-- 036 · นักศึกษาส่งหนังสือขอความอนุเคราะห์ + แบบตอบรับถึงสถานประกอบการเอง
--
-- ใบสั่งงาน PROMPT-company-mail-by-student.md ขั้น 2 — ตอนคณบดีลงนามระบบไม่ส่งอะไรถึงบริษัทแล้ว
-- นักศึกษากรอกอีเมลสถานประกอบการแล้วกดส่งเอง (`POST /api/intents/:id/send-to-company`)
--
-- เก็บแค่ "ที่อยู่ล่าสุด · เวลาส่งล่าสุด · จำนวนครั้ง" — ประวัติทุกครั้งอยู่ใน audit_log
-- (เขียนอย่างเดียว ไม่มี read API ตาม SEC-07 จึงใช้ทำหน้าจอ/เพดานจำนวนครั้งไม่ได้)
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS company_mail_to VARCHAR(254);
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS company_mail_sent_at TIMESTAMPTZ;
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS company_mail_count INT NOT NULL DEFAULT 0;
