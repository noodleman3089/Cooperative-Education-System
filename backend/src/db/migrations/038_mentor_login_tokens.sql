-- 038 · ลิงก์เข้าสู่ระบบของพี่เลี้ยง (ใช้ครั้งเดียว ไม่มีรหัสผ่าน)
--
-- พี่เลี้ยงเป็นคนนอก (เจ้าของตัดสิน 2026-10-02) — เข้าสู่ระบบด้วยลิงก์ในอีเมลแทนรหัสผ่าน
-- (ขั้นทดลอง) · ลิงก์ออกได้ 3 ทาง: เจ้าหน้าที่กดรับแบบตอบรับ (อายุ 7 วัน) · พี่เลี้ยงกดขอเองที่หน้า
-- เข้าสู่ระบบ (อายุ 30 นาที) · พี่เลี้ยงกดขอใหม่จากลิงก์ที่หมดอายุ (30 นาที ส่งไปอีเมลในทะเบียนเท่านั้น)
--
-- mentor_login_tokens: ใช้ครั้งเดียว (used_at) · `target` เก็บ path ภายในที่จะพาไปหลังเข้าสู่ระบบ (NULL = /dashboard)
-- ⛔ ออกให้เฉพาะบัญชีที่มีโปรไฟล์ mentors และมีบทบาท 'mentor' บทบาทเดียว (SEC-03) — ตรวจซ้ำตอนใช้ลิงก์ด้วย
CREATE TABLE IF NOT EXISTS mentor_login_tokens (
    token_id SERIAL PRIMARY KEY,
    token UUID NOT NULL UNIQUE,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    target VARCHAR(300),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mentor_login_tokens_user ON mentor_login_tokens(user_id);
