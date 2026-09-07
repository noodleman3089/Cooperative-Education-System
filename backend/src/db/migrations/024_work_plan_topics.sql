-- 024_work_plan_topics.sql
-- แผนปฏิบัติงานสหกิจศึกษา (สหกิจ 07 หน้า 3) — เปลี่ยนจาก "หนึ่งหัวข้อต่อหนึ่งเดือน"
-- เป็น **เมทริกซ์ หัวข้องาน × เดือน** ให้ตรงกับกระดาษ
--
-- ที่มา: ตาราง monthly_work_plans ที่ลงไปเมื่อ migration 022 มี UNIQUE (student_id, month_index)
-- ซึ่งบังคับให้หนึ่งเดือนมีได้หัวข้อเดียว แต่แบบฟอร์มตัวจริงเป็นตารางที่แถวคือหัวข้องาน
-- คอลัมน์คือเดือน และงานหนึ่งชิ้นกินได้หลายเดือน (แบบ Gantt อย่างง่าย)
--
-- ⛔ months เป็น INT[] ไม่ใช่ month_1..month_4 เพราะช่วงปฏิบัติงานจริงคร่อมได้ 5 เดือน
--    (1 พ.ย. – 20 มี.ค.) คอลัมน์ตายตัว 4 ช่องจะไม่มีที่ลงให้เดือนสุดท้าย
-- ⛔ ไฟล์นี้ **ไม่ลบ monthly_work_plans** — เก็บไว้หนึ่งรอบให้ย้อนดูข้อมูลเดิมได้
--    ลบเมื่อยืนยันว่าไม่มีโค้ดไหนอ่านมันแล้ว

CREATE TABLE IF NOT EXISTS work_plan_topics (
    topic_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    seq INT NOT NULL,
    topic TEXT NOT NULL,
    months INT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT work_plan_topics_student_seq_key UNIQUE (student_id, seq)
);

-- ย้ายข้อมูลเดิม: หนึ่งแถวของ monthly_work_plans กลายเป็นหนึ่งหัวข้อที่ติ๊กเดือนเดียว
-- เรียง seq ตามเดือนเพื่อให้ลำดับบนหน้าจอเหมือนที่นักศึกษาเคยกรอกไว้
-- (ทำครั้งเดียวและข้ามนักศึกษาที่มีข้อมูลใน work_plan_topics อยู่แล้ว)
INSERT INTO work_plan_topics (student_id, seq, topic, months, created_at, updated_at)
SELECT m.student_id,
       ROW_NUMBER() OVER (PARTITION BY m.student_id ORDER BY m.month_index),
       m.topic,
       ARRAY[m.month_index],
       COALESCE(m.created_at, NOW()),
       COALESCE(m.updated_at, NOW())
  FROM monthly_work_plans m
 WHERE btrim(m.topic) <> ''
   AND NOT EXISTS (
        SELECT 1 FROM work_plan_topics t WHERE t.student_id = m.student_id
   );
