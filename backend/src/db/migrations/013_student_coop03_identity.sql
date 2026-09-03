-- สหกิจ 03 ก้อน 4b — ช่องตัวตน/ติดต่อ/ฉุกเฉิน ของใบสมัครงานสหกิจศึกษา (2026-09-03)
--
-- ต่อจาก migration 012 ที่ทำเฉพาะช่องที่ต้องเข้ารหัส (SEC-12)
-- ⛔ **`nationality` (สัญชาติ) ไม่ใช่ `ethnicity` (เชื้อชาติ)** — สัญชาติเป็นข้อมูลทั่วไป
--    ส่วนเชื้อชาติเป็นข้อมูลอ่อนไหวพิเศษตาม PDPA ม.26 ที่ต้องเข้ารหัส+ยินยอมแยก
--    (อยู่ใน migration 012 แล้ว) ฟอร์มจริงถามทั้งสองช่อง อย่าเอามารวมกัน
ALTER TABLE students ADD COLUMN IF NOT EXISTS first_name_en VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_name_en VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE students ADD COLUMN IF NOT EXISTS nationality VARCHAR(100);

-- `phone` เดิมคือโทรศัพท์ที่ติดต่อได้ · ฟอร์มแยกมือถือกับโทรสารต่างหาก
ALTER TABLE students ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR(50);
ALTER TABLE students ADD COLUMN IF NOT EXISTS fax VARCHAR(50);

-- ⛔ **ผู้ติดต่อฉุกเฉินย้ายมาเป็นของโปรไฟล์** — เดิมอยู่บน `accommodations` ที่เดียว
--    ซึ่งผิดตั้งแต่ต้น: มันเป็นคุณสมบัติของ *คน* ไม่ใช่ของ *ที่พัก* และทั้ง สหกิจ 03
--    กับ สหกิจ 06 ต่างก็ถามช่องเดียวกัน · ปล่อยไว้จะได้ข้อมูลสองชุดที่ขัดกันเองได้
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_relationship VARCHAR(100);
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_address TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(50);

-- ย้ายของเดิมขึ้นมา — ต่างจากที่อยู่ที่พัก (migration 010) ตรงที่ **ช่องแมปกัน 1:1
-- ย้ายอัตโนมัติได้จริง ไม่ต้องให้ใครกรอกใหม่** · เขียนเฉพาะแถวที่โปรไฟล์ยังว่าง
UPDATE students s
   SET emergency_contact_name = a.emergency_contact,
       emergency_relationship = a.emergency_relationship,
       emergency_phone        = a.emergency_phone
  FROM accommodations a
 WHERE s.student_id = a.student_id
   AND s.emergency_contact_name IS NULL
   AND a.emergency_contact IS NOT NULL;

-- ของเดิมบน `accommodations` กลายเป็นค่าอ่านอย่างเดียว — เปลี่ยนชื่อให้เห็นชัดว่า
-- ห้ามเขียนเพิ่ม (บรรทัดฐานเดียวกับ `address_legacy` ใน migration 010)
-- ⛔ **ห้าม DROP** — เก็บไว้เทียบได้ว่าเคยมีอะไรก่อนย้าย
ALTER TABLE accommodations RENAME COLUMN emergency_contact TO emergency_contact_legacy;
ALTER TABLE accommodations RENAME COLUMN emergency_relationship TO emergency_relationship_legacy;
ALTER TABLE accommodations RENAME COLUMN emergency_phone TO emergency_phone_legacy;
