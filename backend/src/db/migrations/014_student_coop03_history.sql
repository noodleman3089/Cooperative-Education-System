-- สหกิจ 03 ก้อน 4c — ประวัติครอบครัว/การศึกษา/ฝึกอบรม/กิจกรรม (2026-09-03)
--
-- ⛔ **เก็บเป็น JSONB ไม่ใช่ตารางใหม่ 4 ตัว** — ทั้งสี่ก้อนนี้ไม่เคยถูกค้นข้ามนักศึกษา
--    และอ่านทีเดียวพร้อมโปรไฟล์เสมอ · ตารางใหม่ 4 ตัวแปลว่า JOIN เพิ่ม 4 ที่ +
--    โมเดลเพิ่ม 4 ไฟล์ ทั้งที่ไม่มี query ไหนต้องการ (เจ้าของทำโปรเจคนี้คนเดียว)
--    ทำแบบเดียวกับ `language_proficiency` / `interested_job_types` ที่มีอยู่แล้ว
--    · ถ้าวันหนึ่งต้องรายงาน "นักศึกษาจบจากโรงเรียนไหนบ้าง" ค่อยแตกออกมา

-- บิดา/มารดา (ชื่อ อายุ อาชีพ โทร) · จำนวนพี่น้อง · เป็นบุตรคนที่ · ตารางพี่น้อง
ALTER TABLE students ADD COLUMN IF NOT EXISTS family_info JSONB;

-- ตาราง 5 ระดับ × (สถานศึกษา · ปีเริ่ม · ปีจบ · วุฒิ · สาขาวิชา)
ALTER TABLE students ADD COLUMN IF NOT EXISTS education_history JSONB;

-- ประวัติฝึกอบรม/ปฏิบัติงาน
ALTER TABLE students ADD COLUMN IF NOT EXISTS training_history JSONB;

-- ⛔ **คนละอย่างกับ `skills_and_activities`** ที่มีอยู่แล้ว — ตัวนั้นเป็น TEXT ก้อนเดียว
--    ที่หน้าโปรไฟล์ใช้อยู่ ส่วนใบ สหกิจ 03 ขอเป็น **ตาราง** (ระยะเวลา · ตำแหน่ง · หน้าที่)
--    คนละรูปทรง เอามาใช้แทนกันไม่ได้ · ของเดิมไม่ถูกแตะ
ALTER TABLE students ADD COLUMN IF NOT EXISTS activity_history JSONB;

-- ⛔ **คนละอย่างกับ `interested_job_types`** — ตัวนั้นเป็นรายการประเภทงานที่ใช้จับคู่
--    ตำแหน่งงาน ส่วนช่องนี้คือ "จุดมุ่งหมายในอาชีพ" 4 บรรทัดที่นักศึกษาเขียนเอง
ALTER TABLE students ADD COLUMN IF NOT EXISTS career_objective TEXT;
