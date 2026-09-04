-- 018 · นักศึกษาได้สิทธิ์สหกิจโดยปริยาย (คู่กับ commit 2e0fc86 ที่ตัดขั้นตอน สหกิจ 01 ออก)
--
-- `schema.sql` ถูกแก้ DEFAULT ของ `students.is_eligible` / `is_orientation_passed`
-- จาก FALSE เป็น TRUE ไปแล้วใน commit นั้น แต่**ไม่ได้เขียนไฟล์ migration คู่**
-- ทำให้ `e2e/schema-drift.spec.ts` แดง และฐานที่มีข้อมูลจริงจะไม่มีวันได้รับการเปลี่ยนแปลงนี้
--
-- เหตุผลเชิงธุรกิจ: เจ้าของยืนยัน 2026-09-04 ว่า **ขั้นตอนคัดกรอง สหกิจ 01 ไม่มีอยู่จริง
-- ในกระบวนการของคณะ** นักศึกษาที่ลงทะเบียนเรียนย่อมได้ออกสหกิจอยู่แล้ว
-- คอลัมน์นี้จึงไม่ได้แปลว่า "ผ่านการคัดกรอง" อีกต่อไป
--
-- ⛔ **จงใจไม่ backfill แถวเดิม** — ค่าที่เจ้าหน้าที่ตั้งไว้เองผ่าน
--    `PUT /students/:id/verify-eligibility` ต้องไม่ถูกลบด้วย migration
--    (ดู SEC-02 · การเขียนทับสิทธิ์ที่คนตั้งไว้คือสิ่งที่ invariant ข้อนั้นมีไว้กัน)
--    ถ้าต้องการปลดสิทธิ์ให้รุ่นเก่าทั้งรุ่น ให้เจ้าหน้าที่สั่งเอง ไม่ใช่ migration ตัดสินใจแทน
ALTER TABLE students ALTER COLUMN is_eligible SET DEFAULT TRUE;
ALTER TABLE students ALTER COLUMN is_orientation_passed SET DEFAULT TRUE;
