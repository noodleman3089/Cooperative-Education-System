-- 047 · วงจรภาคเรียน — ปีเป็น พ.ศ. อย่างเดียว · ภาค active ได้ภาคเดียว · วันที่ปิดภาค
-- (แผน: .system_memory/design_semester_lifecycle.md เฟส 0 · R0-1)
--
-- ⚠️ แก้ข้อมูลที่มีอยู่: ปีที่ < 2400 ถือเป็น ค.ศ. → +543 (seed เดิมคือ 2026 → 2569)
--    ก่อนรัน ตรวจว่าไม่มีภาค active ซ้ำ: SELECT COUNT(*) FROM coop_semesters WHERE is_active
--    (ถ้ามากกว่า 1 ไฟล์นี้จะหยุดพร้อมข้อความ — ให้เจ้าของเลือกภาคที่ถูกต้องก่อน แล้วค่อยรันใหม่)
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM coop_semesters WHERE is_active) > 1 THEN
    RAISE EXCEPTION 'มีภาคเรียนที่ is_active = TRUE มากกว่า 1 แถว — ตั้งให้เหลือภาคเดียวก่อนรัน migration นี้';
  END IF;
END $$;

UPDATE coop_semesters SET academic_year = academic_year + 543 WHERE academic_year < 2400;

ALTER TABLE coop_semesters ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE coop_semesters
  ADD CONSTRAINT coop_semesters_year_be CHECK (academic_year >= 2500);
ALTER TABLE coop_semesters
  ADD CONSTRAINT coop_semesters_year_semester_key UNIQUE (academic_year, semester);
CREATE UNIQUE INDEX IF NOT EXISTS uq_coop_semesters_one_active
  ON coop_semesters (is_active) WHERE is_active;
