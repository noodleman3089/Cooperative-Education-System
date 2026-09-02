-- หนังสือส่งตัวนักศึกษาเข้าปฏิบัติงานสหกิจศึกษา (2026-09-02)
--
-- คนละใบกับหนังสือขอความอนุเคราะห์: ใบนั้นถามว่า "จะรับไหม" ออกก่อนตอบรับ
-- ใบนี้คือ "ตกลงแล้ว" ออกหลังเจ้าหน้าที่รับแบบตอบรับ (เอกสารหมายเลข ๒) เข้าระบบ
-- และเป็นข้อ ๙ ของ ๑๓ ขั้นตอนในคู่มือ

-- เลขที่หนังสือส่งตัว — เจ้าหน้าที่ออกตอนสั่งสร้างหนังสือ
-- ⛔ เก็บบน intent_forms ด้วย ไม่ใช่แค่ official_documents.document_number เพราะเลขนี้
--    ต้องถูกพิมพ์กลับลงช่อง "ส่วนของเจ้าหน้าที่ประจำมหาวิทยาลัยฯ" ของเอกสารหมายเลข ๒
--    ซึ่งวาดสดจาก intent_forms ล้วน (กลไกเดียวกับ officer_document_no ของหนังสือขอความอนุเคราะห์)
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS dispatch_document_no VARCHAR(100);

-- วันสิ้นสุดการปฏิบัติงาน — มีแต่หนังสือส่งตัวที่ต้องใช้ เพราะบนใบนี้เขียนช่วงเวลา
-- "ตั้งแต่วันที่ … ถึงวันที่ …" ส่วน start_date มีอยู่แล้วตั้งแต่ตอนตอบรับ
-- ⛔ ระบบไม่คำนวณให้เอง — เจ้าหน้าที่คีย์จากที่ตกลงกับสถานประกอบการจริง
--    (หน้าจอเสนอ start_date + ๑๖ สัปดาห์ ไว้ให้เป็นค่าตั้งต้นเท่านั้น)
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS end_date DATE;

-- ช่วงเวลาต้องเดินไปข้างหน้าเสมอ · NULL ได้ทั้งคู่ (ใบที่ยังไม่ถึงขั้นออกหนังสือส่งตัว)
ALTER TABLE intent_forms DROP CONSTRAINT IF EXISTS intent_forms_work_period_order;
ALTER TABLE intent_forms ADD CONSTRAINT intent_forms_work_period_order
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
