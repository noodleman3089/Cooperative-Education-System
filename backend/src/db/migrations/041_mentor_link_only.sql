-- 041 · พี่เลี้ยงไม่มีรหัสผ่านอีกต่อไป (SEC-15 — เข้าด้วยลิงก์ใช้ครั้งเดียวทางอีเมลเท่านั้น)
--
-- ล้าง password_hash / reset_token ของ "บัญชีพี่เลี้ยงล้วน" (ทุกบทบาทของบัญชีเป็น 'mentor')
-- บัญชีที่มี mentor ร่วมกับบทบาทอื่นไม่แตะ — ยังใช้รหัสผ่านตามบทบาทอื่นนั้นต่อ
--
-- ⚠️ migration นี้แก้ "ข้อมูล" ล้วน ไม่มีการเปลี่ยนโครงสร้าง จึงไม่ต้องแก้ schema.sql คู่กัน
-- (ฐานใหม่จาก db:setup ไม่มีแถวพี่เลี้ยงที่มีรหัสผ่านอยู่แล้ว — seed ของ mentor1@test.com ไม่ใส่รหัสผ่าน)
-- รันซ้ำได้ปลอดภัย: ตั้งเป็น NULL ซ้ำไม่มีผลอะไร
UPDATE users
   SET password_hash = NULL,
       reset_token = NULL,
       reset_token_expires = NULL
 WHERE user_id IN (
         SELECT user_id
           FROM user_roles
          GROUP BY user_id
         HAVING bool_and(role_name = 'mentor')
       );
