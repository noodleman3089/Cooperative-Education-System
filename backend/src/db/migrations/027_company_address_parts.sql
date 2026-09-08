-- 027_company_address_parts.sql
-- ที่อยู่แยกช่องของสถานประกอบการ ตามกล่องบน **สหกิจ 07 หน้า 1**
-- (เลขที่ · ถนน · ซอย · ตำบล/แขวง — ส่วน อำเภอ/จังหวัด/รหัสไปรษณีย์ มีอยู่แล้ว)
--
-- กระดาษเขียนกำกับไว้เองว่า "เพื่อประกอบการเดินทางไปนิเทศงานนักศึกษาที่ถูกต้อง
-- โปรดระบุที่อยู่ตามสถานที่ที่นักศึกษาปฏิบัติงาน" — ที่อยู่ช่องนี้จึงเป็นที่ที่นักศึกษา
-- ไปทำงานจริง ไม่ใช่สำนักงานใหญ่ และเป็นสิ่งที่สถานประกอบการต้องแก้ได้เอง
--
-- `companies.address` เดิมยังอยู่และยังเป็นแหล่งความจริงของหนังสือราชการ
-- เซิร์ฟเวอร์ประกอบค่าใหม่จากช่องย่อยให้ทุกครั้งที่มีการแก้ผ่าน สหกิจ 07
-- ⛔ ไม่แยก `address` เดิมกลับเป็นช่องย่อยอัตโนมัติ — ที่อยู่ไทยแยกด้วยโปรแกรมไม่ได้
--    (บทเรียนเดียวกับ accommodations.address_legacy) ช่องย่อยว่างจนกว่าจะมีคนกรอก
ALTER TABLE companies ADD COLUMN IF NOT EXISTS house_no VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS road VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS soi VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subdistrict VARCHAR(100);

-- อีเมลของผู้จัดการ (กล่องแยกบนหน้า 1 ของ สหกิจ 07)
-- companies.email เดิมคืออีเมลผู้ประสานงาน คนละคนกัน
ALTER TABLE companies ADD COLUMN IF NOT EXISTS manager_email VARCHAR(255);
