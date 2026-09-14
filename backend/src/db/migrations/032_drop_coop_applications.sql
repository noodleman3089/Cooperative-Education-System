-- 032 · ตัด สหกิจ 01 (แบบสมัครเข้าร่วมโครงการสหกิจศึกษา) ออกทั้งชุด
--
-- เจ้าของตัดสิน 2026-09-14 ว่าไม่อยู่ในขอบเขต · หน้าจอไม่มีเมนูพาไปตั้งแต่ commit 2e0fc86
-- และหลัง SEC-02 เปลี่ยน (migration 031) มันไม่ได้ให้สิทธิ์อะไรแล้ว — เหลือหน้าที่เดียวคือคัดลอก
-- เกรดที่แจ้งเข้าทะเบียน ซึ่งเจ้าหน้าที่ทำได้ที่ PUT /students/:id/registry อยู่แล้ว
--
-- ⚠️ **ใบสมัคร สหกิจ 01 ทุกใบหายถาวรเมื่อรัน** — ถ้าต้องการเก็บไว้ดูย้อนหลังให้ export ก่อน `db:migrate`
--
-- ของที่ไม่แตะ: `students.claimed_gpa` (นักศึกษากรอกตอนตั้งโปรไฟล์ · ใช้ต่อ)
-- · แถว `application.*` เก่าใน audit_log (ประวัติ ห้ามลบ · SEC-07)
-- · `student.coop_application_printed` ใน audit_log เป็นของ สหกิจ 03 ไม่ใช่ 01 — คนละเรื่อง
DROP TABLE IF EXISTS coop_applications CASCADE;

-- แถวปฏิทินของกิจกรรม `coop_application` ไม่มีเมนูหรือ endpoint ให้ล็อกแล้ว
-- (key ถูกลบจาก utils/coopCalendar.ts) ปล่อยค้างไว้จะกลายเป็นแถวที่หน้าปฏิทินอ่านไม่ออก
DELETE FROM coop_calendar_events WHERE activity_key = 'coop_application';
