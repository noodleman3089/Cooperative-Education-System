-- 046 · รุ่นนักศึกษาต่อภาคเรียน (`semester_cohort`)
--
-- แดชบอร์ด "นักศึกษาตอนนี้" ของเจ้าหน้าที่ต้องรู้ว่า "ภาคนี้มีนักศึกษากี่คนที่ต้องออกสหกิจ" เพื่อนับ
-- "ยังไม่ยื่นคำร้อง" และ "ได้ที่ฝึก X%" · ระบบไม่ตรวจสิทธิ์ (SEC-02) และตาราง `students` /
-- `eligible_students_list` ไม่มีมิติภาคเรียน (รายชื่อนำเข้าสะสมข้ามปีและไม่ถูกลบ) จึงต้องมีตารางนี้
--
-- · ผูกด้วย `student_code` ไม่ใช่ `student_id` — นักศึกษาที่ยังไม่เข้าระบบก็ต้องนับ (ขั้น "ยังไม่เข้าระบบ")
-- · **ไม่ใช่การตัดสินสิทธิ์** — แค่รายชื่อว่าภาคนี้เจ้าหน้าที่คาดหวังใคร · อยู่ในรายชื่อไม่ได้แปลว่าผ่านด่านใด
--   และไม่อยู่ในรายชื่อก็ยื่นคำร้องได้ตามเดิม (แดชบอร์ดนับ "รายชื่อรุ่น ∪ คนที่มีใบคำร้องในภาคนั้น")
-- · เติมโดยการนำเข้ารายชื่อ (`POST /students/import`) เข้าภาคที่เปิดใช้งานอยู่
-- · รันซ้ำได้ปลอดภัย (IF NOT EXISTS + ON CONFLICT DO NOTHING)
CREATE TABLE IF NOT EXISTS semester_cohort (
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE CASCADE,
    student_code VARCHAR(50) NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (semester_id, student_code)
);

-- เติมย้อนหลังให้ฐานที่มีข้อมูลอยู่แล้ว
-- 1) ทุกคนที่เคยมีใบคำร้องในภาคนั้น → เข้ารุ่นของภาคนั้น
INSERT INTO semester_cohort (semester_id, student_code)
SELECT DISTINCT i.semester_id, s.student_code
  FROM intent_forms i
  JOIN students s ON s.student_id = i.student_id
ON CONFLICT DO NOTHING;

-- 2) รายชื่อที่นำเข้าไว้แล้วทั้งหมด → เข้ารุ่นของภาคที่เปิดใช้งานอยู่ (ถ้ามี)
INSERT INTO semester_cohort (semester_id, student_code)
SELECT sem.semester_id, e.student_code
  FROM eligible_students_list e
  CROSS JOIN (SELECT semester_id FROM coop_semesters WHERE is_active = TRUE ORDER BY semester_id DESC LIMIT 1) sem
ON CONFLICT DO NOTHING;
