-- แบบคำร้องขอหนังสือขอความอนุเคราะห์ (เอกสารหมายเลข 1) — 2026-08-26
--
-- ลายเซ็นของอาจารย์ที่ปรึกษาและหัวหน้าสาขาย้ายไปอยู่บนกระดาษ ระบบไม่รอใครกด
-- นักศึกษาพิมพ์แบบคำร้อง → เอาไปให้เซ็น → อัปโหลดกลับ → เจ้าหน้าที่กดผ่านคนเดียว
-- แล้วกรอกชื่อผู้เซ็นทั้งสองคนจากกระดาษ พร้อมออกเลขที่หนังสือ

ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS request_form_path VARCHAR(255);
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS advisor_signer_name VARCHAR(255);
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS advisor_signed_date DATE;
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS dept_head_signer_name VARCHAR(255);
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS dept_head_signed_date DATE;
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS officer_document_no VARCHAR(100);
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS officer_approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS officer_approved_by INT REFERENCES users(user_id) ON DELETE SET NULL;
