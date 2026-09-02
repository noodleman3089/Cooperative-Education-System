-- เอกสารหมายเลข 2 · ก้อน B — รับแบบตอบรับกลับ + กำหนด ๑๕ วันทำการ (2026-09-02)
--
-- ฟอร์มจริงเขียนว่าให้สถานประกอบการตอบกลับ "ภายใน ๑๕ วันทำการ … หลังจากได้รับ
-- หนังสือขอความอนุเคราะห์ฯ" ระบบจึงต้องรู้ว่ากำหนดคือวันไหน เพื่อเตือนนักศึกษา
-- และเพื่อแยกว่าใบไหนส่งกลับตรงเวลา ใบไหนช้า

-- วันครบกำหนด — ปั๊มตอน **คณบดีลงนามหนังสือขอความอนุเคราะห์** เพราะนั่นคือจุดที่
-- นักศึกษาได้หนังสือไปยื่น · NULL = ยังไม่ลงนาม = ยังอัปโหลดแบบตอบรับไม่ได้
-- (คอลัมน์นี้จึงทำหน้าที่เป็นด่านลำดับไปในตัว ไม่ต้อง join หา official_documents ซ้ำ)
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS acceptance_due_date DATE;

-- ⛔ ปั๊มตอนอัปโหลด ห้ามคำนวณย้อนหลัง — เหตุผลเดียวกับ submitted_late ของการยื่น
--    เจ้าหน้าที่แก้วันที่ต้นทางได้ ถ้าคำนวณสดหลักฐานว่าใครส่งช้าจะหายเงียบ
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS acceptance_submitted_late BOOLEAN NOT NULL DEFAULT FALSE;

-- สิ่งที่เจ้าหน้าที่ **อ่านจากกระดาษ** แล้วคีย์เข้าระบบตอนรับแบบตอบรับ
-- ก่อนหน้านี้ระบบรับไฟล์ได้แต่ไม่รู้ว่าในนั้นเขียนว่าอะไร — สามช่องนี้คือคำตอบ
-- (กลไกเดียวกับที่เจ้าหน้าที่คีย์ชื่อผู้ลงนามจากเอกสารหมายเลข 1)
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS acceptance_signer_name VARCHAR(255);
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS acceptance_signer_position VARCHAR(255);
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS acceptance_signed_date DATE;
