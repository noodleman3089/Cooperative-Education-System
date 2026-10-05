-- 044 · ตัดสายแบบเสนองาน/ประกาศงาน (สหกิจ 02) ทั้งสาย
--
-- อาจารย์ที่ปรึกษาโปรเจคให้ตัด 2026-10-05: คู่มือสหกิจของคณะ (BAIT) ไม่มีสหกิจ 02
-- กระบวนการเริ่มที่เอกสารหมายเลข 1 ตรงๆ — นักศึกษากรอกสถานประกอบการในหน้ายื่นคำร้องเอง
-- ไม่มีขั้นเลือกจากประกาศ จึงไม่มีอะไรอ่านตารางพวกนี้อีก
--
-- ⛔ **ข้อมูลหายถาวร** — แบบเสนองานทุกใบ · ตำแหน่งทุกรายการ · โควตา · ลิงก์ /offer ที่ออกไปแล้ว
--    ฐานที่มีข้อมูลจริงให้ export สี่ตารางนี้ก่อนรัน ถ้าต้องการเก็บไว้เป็นประวัติ
--
-- ลำดับสำคัญ: คอลัมน์/ตารางที่ชี้เข้าหาต้องหายก่อนตารางที่ถูกชี้
--   intent_forms.job_id -> job_posts · job_post_majors -> job_posts · job_posts -> coop_job_offers
--   job_offer_tokens -> coop_job_offers
-- ไม่ใช้ CASCADE โดยตั้งใจ — ถ้ามีอะไรที่ไม่รู้จักชี้เข้ามา ให้ล้มแล้วมาดู ไม่ใช่ลบตามเงียบๆ
--
-- รันซ้ำได้ปลอดภัย: IF EXISTS ทุกบรรทัด
ALTER TABLE intent_forms DROP COLUMN IF EXISTS job_id;

DROP TABLE IF EXISTS job_offer_tokens;
DROP TABLE IF EXISTS job_post_majors;
DROP TABLE IF EXISTS job_posts;
DROP TABLE IF EXISTS coop_job_offers;
