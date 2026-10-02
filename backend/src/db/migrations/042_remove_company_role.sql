-- 042 · ลบบทบาท 'company' ออกจากระบบ — สถานประกอบการไม่มีบัญชี
--
-- บริษัทตอบทางลิงก์สาธารณะใช้ครั้งเดียวเท่านั้น (/api/public/acceptance · /api/public/job-offer)
-- บัญชีที่ล็อกอินเป็นบริษัทไม่มีวันถูกสร้างอีก
--
-- (ก) ข้อมูล: ปิดบัญชีที่มีบทบาทเดียวคือ 'company' แล้วลบแถวบทบาท
--     ⛔ ไม่ลบแถว users — announcements.created_by เป็น ON DELETE CASCADE ส่วน
--        companies.created_by / job_posts.created_by เป็น RESTRICT การลบ users จะลบประกาศ
--        หรือถูกปฏิเสธ · ปิดบัญชี (is_active = FALSE) พอแล้วเพราะไม่มีบทบาทให้เข้าระบบอยู่ดี
-- (ข) โครงสร้าง: สร้าง CHECK ของ user_roles.role_name ใหม่โดยไม่มี 'company'
--     ชื่อ `user_roles_role_name_check` คือชื่อที่ Postgres ตั้งให้ CHECK แบบ inline
--     ใน schema.sql / 000_baseline.sql — schema.sql แก้คู่กันแล้วให้ตรงกัน
--
-- รันซ้ำได้ปลอดภัย: ไม่เหลือแถว 'company' ให้แตะ และ DROP ... IF EXISTS
UPDATE users
   SET is_active = FALSE
 WHERE user_id IN (
         SELECT user_id
           FROM user_roles
          GROUP BY user_id
         HAVING bool_and(role_name = 'company')
       );

DELETE FROM user_roles WHERE role_name = 'company';

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_name_check;
ALTER TABLE user_roles
  ADD CONSTRAINT user_roles_role_name_check
  CHECK (role_name IN ('student', 'advisor', 'dean', 'staff', 'dept_head', 'mentor'));
