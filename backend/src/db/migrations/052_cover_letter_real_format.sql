-- 052 · หนังสือขอความอนุเคราะห์ตามรูปแบบฉบับจริงของคณะ — 2026-10-07
--
-- ฉบับจริงพิมพ์ข้อมูลสามอย่างที่ระบบยังไม่มีที่เก็บ (เพิ่มอย่างเดียว ไม่มีข้อมูลหาย):
--   (1) คำนำหน้าชื่อนักศึกษา — "นางสาวรัตลิตา …" · เดาจาก `gender` ไม่ได้ (นาง / นางสาว)
--   (2) ตำแหน่งทางวิชาการของผู้ลงนาม — "(ผู้ช่วยศาสตราจารย์… )" ใต้ลายมือชื่อคณบดี
--   (3) เขตพื้นที่ · ที่อยู่ · โทรศัพท์ของคณะ — หัวกระดาษมุมขวาและท้ายกระดาษ
-- อีเมลท้ายกระดาษไม่เก็บที่นี่: ใช้อีเมลของบัญชีเจ้าหน้าที่ที่กดรับคำร้องใบนั้น (`intent_forms.officer_approved_by`)
ALTER TABLE students  ADD COLUMN IF NOT EXISTS name_prefix VARCHAR(20);
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS academic_title VARCHAR(100);

ALTER TABLE master_faculty ADD COLUMN IF NOT EXISTS campus_name VARCHAR(255);
ALTER TABLE master_faculty ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE master_faculty ADD COLUMN IF NOT EXISTS phone VARCHAR(100);

-- สองคณะของเขตพื้นที่จักรพงษภูวนารถอยู่ที่อยู่เดียวกัน — ใส่ให้เฉพาะแถวที่ยังว่าง (ไม่ทับค่าที่มีคนแก้แล้ว)
-- เบอร์งานสหกิจศึกษาและฝึกงานรู้เฉพาะของคณะบริหารธุรกิจฯ (จากหนังสือฉบับจริง) คณะอื่นเว้นว่าง ไม่เดา
UPDATE master_faculty
   SET campus_name = COALESCE(campus_name, 'เขตพื้นที่จักรพงษภูวนารถ'),
       address     = COALESCE(address, E'ถนนวิภาวดีรังสิต เขตดินแดง\nกรุงเทพมหานคร 10400')
 WHERE faculty_name_th IN ('คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ', 'คณะศิลปศาสตร์');

UPDATE master_faculty
   SET phone = COALESCE(phone, '02-692-2360-4 ต่อ 817')
 WHERE faculty_name_th = 'คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ';
