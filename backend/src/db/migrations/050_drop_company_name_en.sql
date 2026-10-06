-- 050 · ตัดชื่อสถานประกอบการภาษาอังกฤษ (`companies.name_en`) — เจ้าของสั่ง 2026-10-06
--   เหลือช่อง "ชื่อสถานประกอบการ" ช่องเดียว (คอลัมน์ `name_th` คงชื่อเดิม)
--
-- ⚠️ ข้อมูลในคอลัมน์นี้หายถาวร ย้อนไม่ได้ — ระบบยังไม่เคยขึ้นใช้จริงจึงยอมได้
--    ฐานที่มีข้อมูลจริงและอยากเก็บชื่อภาษาอังกฤษไว้ ให้ export ก่อนรัน:
--    \copy (SELECT company_id, name_th, name_en FROM companies WHERE name_en IS NOT NULL) TO 'company_name_en.csv' CSV HEADER
--
-- ไม่เกี่ยวกับ `students.first_name_en` / `last_name_en` (สหกิจ 03 ใช้) และ `major_name_en` / `faculty_name_en`
ALTER TABLE companies DROP COLUMN IF EXISTS name_en;
