-- 045 · ตัดสหกิจ 07 ฝั่งสถานประกอบการ (ข้อมูลบริษัท · ตำแหน่งงาน · ลักษณะงาน)
--
-- เจ้าของสั่งตัด 2026-10-05: ลิงก์ตอบรับของบริษัทเหลือแค่ ดูเอกสาร + แนบเอกสารหมายเลข 2 + รับ/ไม่รับ
-- พี่เลี้ยงนักศึกษาระบุเองทีหลัง (POST /api/intents/:id/mentor) ไม่ได้มาจากบริษัทอีก
--
-- ⛔ **ข้อมูลหายถาวร** — `company_form07_pending` (ข้อมูลบริษัทที่พักรอเจ้าหน้าที่กดรับ ของใบที่ยังค้างอยู่)
--    · `job_position` / `job_description` (ตำแหน่ง/ลักษณะงานที่บริษัทเคยกรอก) ฐานที่มีข้อมูลจริงให้ export ก่อนรัน
-- ไม่แตะคอลัมน์ของตาราง companies (ผู้จัดการ · ผู้ประสานงาน · ที่อยู่แยกช่อง) — เป็นทะเบียนบริษัท ยังมีข้อมูลเดิมอยู่
--
-- รันซ้ำได้ปลอดภัย: IF EXISTS ทุกบรรทัด
ALTER TABLE intent_forms DROP COLUMN IF EXISTS company_form07_pending;
ALTER TABLE intent_forms DROP COLUMN IF EXISTS job_position;
ALTER TABLE intent_forms DROP COLUMN IF EXISTS job_description;
