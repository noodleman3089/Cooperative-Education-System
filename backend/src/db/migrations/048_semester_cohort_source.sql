-- 048 · ที่มาของรายชื่อรุ่นต่อภาค (`semester_cohort.source`) — เฟส 1 R1-1/R1-2 ของ design_semester_lifecycle.md
--   'import'     = นำเข้ารายชื่อ (`POST /students/import`)
--   'carry_over' = เจ้าหน้าที่กดยกยอดนักศึกษาที่ยังไม่ได้ที่ฝึกจากภาคก่อน
-- แถวที่มีอยู่ก่อนหน้านี้ทั้งหมดมาจากการนำเข้า (หรือเติมย้อนหลังจากใบคำร้องใน 046) จึงใช้ค่าเริ่มต้น 'import'
ALTER TABLE semester_cohort ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'import';
ALTER TABLE semester_cohort
  ADD CONSTRAINT semester_cohort_source_check CHECK (source IN ('import', 'carry_over'));
