-- 002_split_mentor_evaluation_forms.sql
--
-- แยกแบบประเมินของพี่เลี้ยงเป็นสองใบตามแบบฟอร์มจริง
--   sahatkit_15 — แบบประเมินผลนักศึกษา 18 ข้อ เต็ม 100
--   sahatkit_16 — แบบประเมินรายงาน 14 ข้อ ระดับ 1-5 เต็ม 70
-- คู่แฝดของบล็อก 19 ใน ../schema.sql — DDL ต้องให้ผลเหมือนกัน โดยเฉพาะชื่อ
-- final_evaluations_student_form_key ซึ่งกลายเป็นชื่อ index ที่
-- e2e/schema-drift.spec.ts เอาไปเทียบผ่าน pg_indexes.indexdef
--
-- ⚠️ migration นี้ลบข้อมูลเดิมทิ้ง
-- scores_detail เดิมมีคีย์ punctuality / teamwork / reportContent ฯลฯ ซึ่งเป็น
-- rubric ที่ระบบคิดขึ้นเอง ไม่มีข้อไหนแมปเข้า 18 ข้อของ สหกิจ 15 ได้ และ
-- form_code เป็น NOT NULL จึง backfill ด้วยค่าที่ซื่อสัตย์ไม่ได้
-- (ทางที่ปฏิเสธ: ใส่ form_code = 'legacy' — แถวขยะจะรอดเข้ามาแล้วโผล่บน
--  กระดานเจ้าหน้าที่เป็นคะแนนที่ไม่มีแบบฟอร์มรองรับ)
-- สำรองก่อนรันกับฐานที่มีข้อมูลจริง:
--   pg_dump -t final_evaluations coop_edu_db > backup_final_evaluations.sql

DELETE FROM final_evaluations;

-- ADD COLUMN ... NOT NULL ไม่มี DEFAULT ทำได้เพราะ DELETE ข้างบนทำให้ตารางว่างแล้ว
-- ถ้ายังมีแถวค้างอยู่คำสั่งนี้จะ error ทันที — เป็น guard ในตัว
ALTER TABLE final_evaluations ADD COLUMN IF NOT EXISTS form_code VARCHAR(20) NOT NULL;

ALTER TABLE final_evaluations ADD CONSTRAINT final_evaluations_form_code_check
    CHECK (form_code IN ('sahatkit_15', 'sahatkit_16'));

-- ชื่ออัตโนมัติของ UNIQUE (student_id, evaluator_role) ใน 000_baseline.sql
-- IF EXISTS กันกรณีฐานถูกสร้างจาก schema.sql ใหม่แล้ว
ALTER TABLE final_evaluations DROP CONSTRAINT IF EXISTS final_evaluations_student_id_evaluator_role_key;

ALTER TABLE final_evaluations ADD CONSTRAINT final_evaluations_student_form_key
    UNIQUE (student_id, evaluator_role, form_code);
