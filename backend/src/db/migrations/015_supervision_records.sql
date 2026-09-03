-- สหกิจ 13 — แบบบันทึกการนิเทศงานสหกิจศึกษา (2026-09-03)
--
-- ⛔ **คนละชั้นกับสองตารางที่มีอยู่แล้ว อย่าสับสน**
--    `supervision_appointments` = การ **นัดหมาย** ไปนิเทศ
--    `supervision_logs`         = บันทึกย่อหลังนิเทศ ผูกกับนัดหมายหนึ่งครั้ง
--    `supervision_records`      = **แบบฟอร์ม สหกิจ 13 อย่างเป็นทางการ 37 ข้อ**
--
-- เหตุที่ **ไม่ผูกกับ `appointment_id`**: การนิเทศเกิดขึ้นได้แม้ไม่ได้นัดผ่านระบบ
-- (โทรนัดเองก็มี) การบังคับให้มีนัดก่อนเท่ากับปิดทางบันทึกของจริง
CREATE TABLE IF NOT EXISTS supervision_records (
    record_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    -- ⛔ RESTRICT เพราะบันทึกนี้เป็นหลักฐาน ต้องรู้เสมอว่าใครเป็นคนนิเทศ
    supervisor_id INT NOT NULL REFERENCES personnel(personnel_id) ON DELETE RESTRICT,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE RESTRICT,
    -- "การนิเทศครั้งที่ __" บนหัวฟอร์ม — คู่มือกำหนดให้นิเทศ 2 ครั้ง
    visit_number INT NOT NULL CHECK (visit_number IN (1, 2)),
    visit_date DATE NOT NULL,
    -- คีย์ตาม `config/supervisionRubric.ts` · ค่า 1-5 หรือ **null** เมื่ออาจารย์เลือก "-"
    -- ⛔ null = "ไม่ประเมิน" ไม่ใช่ 0 · ใบนี้ **จงใจไม่มี total_score** เพราะไม่ได้ตัดเกรด
    --    (ต่างจาก สหกิจ 15/16) การรวมคะแนนที่มี null ปนให้ตัวเลขที่ตีความไม่ได้
    scores JSONB NOT NULL,
    -- ทุกข้อมีช่อง "หมายเหตุ" ของตัวเองบนกระดาษ — เก็บครบ ไม่ยุบเหลือช่องเดียว
    remarks JSONB,
    -- checkbox 4 รายการ: เอกสารที่ **อาจารย์สั่ง** ให้นักศึกษาส่ง
    -- ไม่ใช่สถานะที่ระบบคำนวณเอง (คู่มือ: "ขึ้นอยู่กับอาจารย์ผู้นิเทศเป็นผู้พิจารณา")
    documents_required JSONB,
    additional_notes TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- นิเทศครั้งเดียวได้บันทึกเดียว · แก้ได้ด้วยการส่งทับ (UPSERT)
    UNIQUE (student_id, visit_number)
);

-- อาจารย์เปิดหน้าจอแล้วดึง "บันทึกของนักศึกษาคนนี้" เป็นหลัก
CREATE INDEX IF NOT EXISTS idx_supervision_records_student
    ON supervision_records (student_id, visit_number);
