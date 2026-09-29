-- 037 · ลิงก์ตอบรับของสถานประกอบการ (เอกสารหมายเลข 2 + สหกิจ 07)
--
-- ใบสั่งงาน PROMPT-company-acceptance-link.md ขั้น 1 — บริษัทไม่มีบัญชี ตอบผ่านลิงก์ในอีเมล
-- ที่นักศึกษากดส่ง (`POST /api/intents/:id/send-to-company`)
--
-- acceptance_link_tokens: ใช้ครั้งเดียว · หมดอายุ 15 วันทำการ · ส่งใหม่ = ลิงก์เก่าถูก revoke
-- intent_forms.acceptance_source: 'link' | 'student' — ให้เจ้าหน้าที่เห็นว่าคำตอบรับมาจากไหน
-- intent_forms.company_form07_pending: ข้อมูลบริษัทส่วน สหกิจ 07 ที่พักไว้ ยังไม่เขียนทับ companies
--   จนกว่าเจ้าหน้าที่จะกดรับ (ลิงก์ไปถึงอีเมลที่นักศึกษาพิมพ์ ใครถือลิงก์ก็ไม่ควรแก้ทะเบียนบริษัทได้ทันที)
CREATE TABLE IF NOT EXISTS acceptance_link_tokens (
    token_id SERIAL PRIMARY KEY,
    token UUID NOT NULL UNIQUE,
    form_id INT NOT NULL REFERENCES intent_forms(form_id) ON DELETE CASCADE,
    sent_to VARCHAR(254) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acceptance_link_tokens_form ON acceptance_link_tokens(form_id);

ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS acceptance_source VARCHAR(16)
    CHECK (acceptance_source IN ('link', 'student'));
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS company_form07_pending JSONB;
