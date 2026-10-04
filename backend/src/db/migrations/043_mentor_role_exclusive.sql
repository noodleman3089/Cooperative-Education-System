-- 043 · บทบาทพี่เลี้ยง (mentor) ต้องเป็นบทบาทเดียวของบัญชี — บังคับที่ฐานข้อมูล (SEC-03 / SEC-15)
--
-- เจ้าของยืนยัน: บัญชีที่เป็นพี่เลี้ยงถือบทบาทอื่นร่วมไม่ได้ และบัญชีที่ถือบทบาทอื่นอยู่ก็เป็นพี่เลี้ยงไม่ได้
-- เหตุผล: พี่เลี้ยงเข้าระบบด้วยลิงก์ใช้ครั้งเดียวและไม่มีรหัสผ่าน (SEC-15) ส่วนบัญชีที่มีบทบาทอื่นร่วมด้วย
-- (อาจารย์ · เจ้าหน้าที่ · นักศึกษา) ใช้รหัสผ่าน/SSO ตามปกติ — ถ้าบัญชีเดียวถือทั้งสองแบบ ด่าน `hasOnlyMentorRole`
-- ที่คอยกันไม่ให้ออกลิงก์/รีเซ็ตรหัสผ่านทับบัญชีของคนอื่นก็ต้องพึ่งแอปอย่างเดียว · ย้ายด่านลงมาที่ฐาน
-- ให้ SQL มือก็สร้างบัญชีสองบทบาทไม่ได้ · ด่านในแอป (`hasOnlyMentorRole` · SEC-03 `hasForeignRole`) คงไว้เป็นชั้นสอง
--
-- (ก) ด่านตรวจข้อมูลเดิมก่อน — ถ้ามีบัญชีที่ถือ mentor ร่วมกับบทบาทอื่นอยู่แล้ว **หยุดทั้งไฟล์ทันที**
--     ไม่ลบบทบาทหรือข้อมูลของใครเงียบ ๆ (ต้องให้คนตัดสินว่าจะเก็บบทบาทไหน) · migration รันใน transaction
--     ของตัวเอง ล้มแล้ว rollback ทั้งหมด จึงไม่เหลือ trigger ครึ่งเดียว
-- (ข) trigger `BEFORE INSERT OR UPDATE ON user_roles`
--     · ล็อกแถว users ของบัญชีนั้นก่อน (`FOR NO KEY UPDATE`) — สอง transaction ที่เพิ่มบทบาทให้บัญชีเดียวกัน
--       พร้อมกันจึงเรียงคิวกัน คนหลังเห็นแถวของคนแรกแล้วค่อยตัดสิน ไม่ผ่านทั้งคู่
--       ใช้ NO KEY UPDATE แทน UPDATE เพราะไม่ชนกับ FOR KEY SHARE ที่ foreign key ของตารางลูก
--       (personnel · students · mentors) ถือไว้ — กัน deadlock ในทรานแซกชันที่เขียนทั้งสองอย่าง
--     · ตอน UPDATE ไม่นับแถวที่กำลังถูกแก้เอง (เทียบกับคีย์เดิม OLD) เปลี่ยนชื่อบทบาทของบัญชีแถวเดียวจึงไม่ถูกบล็อกผิด
--     · ใช้ ERRCODE 23514 (check_violation) + ข้อความขึ้นต้นคงที่ `mentor_role_exclusive:` — แอปจับสองอย่างนี้
--       แล้วตอบ 400 ภาษาไทยแทน 500
--
-- รันซ้ำได้ปลอดภัย: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS
DO $$
DECLARE
  offenders TEXT;
BEGIN
  SELECT string_agg(u.email, ', ' ORDER BY u.email)
    INTO offenders
    FROM users u
   WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id AND r.role_name = 'mentor')
     AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.user_id AND r.role_name <> 'mentor');

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'migration 043 หยุด: มีบัญชีที่ถือบทบาทพี่เลี้ยง (mentor) ร่วมกับบทบาทอื่นอยู่แล้ว ได้แก่ % — กรุณาแก้ด้วยมือก่อน (ลบบทบาทใดบทบาทหนึ่งออกจาก user_roles ตามที่เจ้าของข้อมูลตัดสิน) แล้วรัน db:migrate ใหม่ ระบบไม่ลบบทบาทหรือข้อมูลให้เอง',
      offenders;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_mentor_role_exclusive() RETURNS trigger AS $$
BEGIN
  -- serialize ต่อบัญชี — ต้องทำก่อนอ่านบทบาทอื่นของบัญชีนี้
  PERFORM 1 FROM users WHERE user_id = NEW.user_id FOR NO KEY UPDATE;

  IF NEW.role_name = 'mentor' THEN
    IF EXISTS (
      SELECT 1 FROM user_roles r
       WHERE r.user_id = NEW.user_id
         AND r.role_name <> 'mentor'
         AND NOT (TG_OP = 'UPDATE' AND r.user_id = OLD.user_id AND r.role_name = OLD.role_name)
    ) THEN
      RAISE EXCEPTION 'mentor_role_exclusive: บทบาทพี่เลี้ยง (mentor) ต้องเป็นบทบาทเดียวของบัญชี ไม่สามารถอยู่ร่วมกับบทบาทอื่นได้'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM user_roles r
       WHERE r.user_id = NEW.user_id
         AND r.role_name = 'mentor'
         AND NOT (TG_OP = 'UPDATE' AND r.user_id = OLD.user_id AND r.role_name = OLD.role_name)
    ) THEN
      RAISE EXCEPTION 'mentor_role_exclusive: บทบาทพี่เลี้ยง (mentor) ต้องเป็นบทบาทเดียวของบัญชี ไม่สามารถอยู่ร่วมกับบทบาทอื่นได้'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mentor_role_exclusive ON user_roles;
CREATE TRIGGER trg_mentor_role_exclusive
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_mentor_role_exclusive();
