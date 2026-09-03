-- SEC-12 · สหกิจ 03 — ข้อมูลอ่อนไหวที่ต้องเข้ารหัสสองทาง (2026-09-03)
--
-- เลขบัตรประชาชน · เชื้อชาติ · ศาสนา ต้องถูก **พิมพ์กลับ** ลงใบสมัครงานสหกิจศึกษา
-- (สหกิจ 03) จึง hash ไม่ได้ (อ่านกลับไม่ได้) ต้องเป็น encryption at rest แบบถอดได้
-- (AES-256-GCM · `utils/encryption.ts`) — เก็บ ciphertext/iv/authTag แยกคอลัมน์ตรงตัว
--
-- ⛔ **เขต/วันหมดอายุของบัตรไม่เข้ารหัส** — ไม่ใช่ข้อมูลที่ระบุตัวบุคคลได้เท่าตัวเลขบัตร
--    เข้ารหัสเพิ่มโดยไม่มีประโยชน์จริงคือความซับซ้อนเปล่าประโยชน์
ALTER TABLE students ADD COLUMN IF NOT EXISTS national_id_ciphertext TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS national_id_iv VARCHAR(64);
ALTER TABLE students ADD COLUMN IF NOT EXISTS national_id_tag VARCHAR(64);
ALTER TABLE students ADD COLUMN IF NOT EXISTS national_id_issued_district VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS national_id_expiry_date DATE;

-- เชื้อชาติ · ศาสนา = ข้อมูลอ่อนไหวพิเศษตาม PDPA มาตรา 26 — ต้องมีความยินยอมโดยชัดแจ้ง
-- แยกต่างหาก ไม่ใช่รวมอยู่ในเงื่อนไขการใช้งานทั่วไป · NULL ใน `sensitive_data_consented_at`
-- = ยังไม่เคยยินยอม (ห้ามเขียนสองคอลัมน์นี้ก่อนมีเวลายินยอมจริง)
ALTER TABLE students ADD COLUMN IF NOT EXISTS ethnicity_ciphertext TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS ethnicity_iv VARCHAR(64);
ALTER TABLE students ADD COLUMN IF NOT EXISTS ethnicity_tag VARCHAR(64);
ALTER TABLE students ADD COLUMN IF NOT EXISTS religion_ciphertext TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS religion_iv VARCHAR(64);
ALTER TABLE students ADD COLUMN IF NOT EXISTS religion_tag VARCHAR(64);
ALTER TABLE students ADD COLUMN IF NOT EXISTS sensitive_data_consented_at TIMESTAMP WITH TIME ZONE;

-- ⛔ นโยบายลบอัตโนมัติ (เจ้าของเคาะ 2026-09-03 — แทนที่คำตอบเดิมที่ต้องรออาจารย์กด):
-- ๙๐ วันหลังพี่เลี้ยงส่งประเมินครบทั้งสหกิจ 15 และ 16 → ลบคอลัมน์ทั้งหมดข้างบนอัตโนมัติ
-- ผูกเข้ากับ `DeactivationScheduler` ที่มีอยู่แล้ว ไม่มีปุ่มให้ใครกด
-- ดูเหตุผลเต็มใน `.system_memory/design_stage3_forms.md` หัวข้อ ❓ ข้อ 2
