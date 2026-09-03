-- สหกิจ 06 · แบบแจ้งรายละเอียดที่พัก — แตกที่อยู่เป็นช่องย่อยตามฟอร์มจริง (2026-09-03)
--
-- ของเดิม `address` เป็น TEXT ก้อนเดียว ซึ่งพิมพ์ลงแบบฟอร์มที่มีช่องแยก
-- (เลขที่ · อาคาร · ห้อง · ซอย · ถนน · ตำบล · อำเภอ · จังหวัด · รหัสไปรษณีย์) ไม่ได้
-- และอาจารย์นิเทศเอาไปหาทางไม่ได้เพราะไม่มีพิกัด

-- ⛔ **ห้าม DROP ของเดิมทิ้งเฉยๆ** — แถวที่มีอยู่เป็นก้อนเดียว แยกอัตโนมัติไม่ได้
--    (ชื่อสถานที่ไทยไม่มีตัวคั่นคำ เดาผิดแล้วที่อยู่เพี้ยนเงียบๆ) จึงย้ายไปเก็บไว้
--    ให้นักศึกษากรอกใหม่ครั้งเดียว · หน้าจอโชว์ค่าเก่าเป็นข้อความช่วยจำตอนกรอก
ALTER TABLE accommodations RENAME COLUMN address TO address_legacy;
ALTER TABLE accommodations ALTER COLUMN address_legacy DROP NOT NULL;

-- ช่องที่อยู่ตามฟอร์ม
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS house_no VARCHAR(50);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS building VARCHAR(255);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS room_no VARCHAR(50);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS soi VARCHAR(255);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS road VARCHAR(255);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS subdistrict VARCHAR(100);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS district VARCHAR(100);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS province VARCHAR(100);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS postal_code VARCHAR(10);

-- ช่องติดต่อที่ฟอร์มมีแต่ระบบยังไม่เคยเก็บ · `phone` เดิม = โทรศัพท์ที่พัก
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS mobile_phone VARCHAR(50);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS fax VARCHAR(50);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- "แผนที่แสดงตำแหน่งที่ตั้ง" บนฟอร์ม — มีไว้ให้อาจารย์ใช้ตอนออกนิเทศ
-- ⛔ เก็บพิกัดอย่างเดียว **ไม่ฝังแผนที่ในหน้าจออาจารย์** (ค่า API + พื้นที่จอ)
--    ฝั่งอาจารย์เป็นลิงก์ออกไป Google Maps ซึ่งฟรี — ดู design_student_address_map.md
-- NUMERIC(10,7) พอสำหรับพิกัดโลก (ละติจูดสูงสุด 3 หลักหน้าจุด) ความละเอียด ~1 ซม.
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7);
ALTER TABLE accommodations ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);
