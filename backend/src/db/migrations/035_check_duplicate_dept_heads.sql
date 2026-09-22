-- 035 · ตรวจหัวหน้าสาขาซ้อน (หนึ่งสาขามีหัวหน้าได้คนเดียว — SB-G2 `0e0c43d`)
--
-- SB-G2 บังคับกติกานี้เฉพาะตอนมีคนตั้ง/นำเข้า/claim ใหม่ ไม่ได้แก้ข้อมูลที่ซ้อนอยู่ก่อนแล้ว
-- และเลือกแทนไม่ได้ว่าคนไหนคือหัวหน้าตัวจริง — ต้องเป็นคนตัดสิน
--
-- ไฟล์นี้ **ไม่แก้อะไร** แค่ปฏิเสธการ migrate ถ้าเจอสาขาที่มีหัวหน้าเกินหนึ่งคน
-- (ทรานแซกชันของไฟล์นี้ล้ม · migration ถัดไปไม่รัน · ไม่มีอะไรเปลี่ยนในฐาน)
--
-- วิธีแก้เมื่อเจอ: ให้เจ้าหน้าที่เปิด "จัดการสิทธิ์ & บัญชีผู้ใช้" แล้วบันทึกบทบาทหัวหน้าสาขา
-- ให้คนที่ถูกต้องซ้ำหนึ่งครั้ง — ระบบถอดคนอื่นในสาขาเดียวกันออกให้เอง แล้วรัน `db:migrate` ใหม่
DO $$
DECLARE
  dup TEXT;
BEGIN
  SELECT string_agg(format('major_id=%s (%s คน: %s)', major_id, n, ids), '; ')
    INTO dup
    FROM (
      SELECT p.major_id, COUNT(*) AS n, string_agg(p.personnel_id::text, ',' ORDER BY p.personnel_id) AS ids
        FROM user_roles r
        JOIN personnel p ON p.personnel_id = r.user_id
       WHERE r.role_name = 'dept_head' AND p.major_id IS NOT NULL
       GROUP BY p.major_id
      HAVING COUNT(*) > 1
    ) d;

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'พบหัวหน้าสาขาซ้อน: % — ให้เจ้าหน้าที่บันทึกบทบาทหัวหน้าสาขาให้คนที่ถูกต้องซ้ำหนึ่งครั้ง แล้วรัน db:migrate ใหม่', dup;
  END IF;
END $$;
