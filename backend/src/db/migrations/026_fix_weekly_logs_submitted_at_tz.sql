-- 026_fix_weekly_logs_submitted_at_tz.sql
-- ⚠️ **ไม่ใช่งานของฝ่ายสถานประกอบการ — เป็นการปิดรอยรั่วที่ค้างมาจากก้อน ก**
--
-- `weekly_logs.submitted_at` ใน schema.sql เป็น TIMESTAMPTZ (แก้ตอนก้อน ก)
-- แต่ฝั่ง migration คอลัมน์นี้เกิดมาตั้งแต่ 000_baseline เป็น TIMESTAMP ธรรมดา
-- และ 020 ไม่ได้แปลงชนิดให้ → สองทางให้ผลไม่เท่ากัน และ e2e/schema-drift.spec.ts
-- แดงอยู่ตั้งแต่ก่อนงานนี้ · ปล่อยไว้แปลว่าครั้งหน้าจะแยกไม่ออกว่าใครทำให้แดง
--
-- เลือกยกฝั่ง migration ขึ้นเป็น TIMESTAMPTZ ตาม schema.sql เพราะตารางบันทึกอีกสองใบ
-- (monthly_logs, daily_logs) เป็น TIMESTAMPTZ อยู่แล้ว และทั้งระบบยึดเวลาไทยเป็นหลัก
--
-- USING ... AT TIME ZONE 'Asia/Bangkok' ระบุไว้ชัดเจนโดยตั้งใจ: ค่าที่เก็บมาก่อนหน้านี้
-- ถูกเขียนด้วย CURRENT_TIMESTAMP ลงคอลัมน์ที่ไม่มีโซน คือเป็นเวลาท้องถิ่นของฐาน
-- ถ้าปล่อยให้ cast เอง Postgres จะใช้ TimeZone ของ session ตอนรัน migration
-- ซึ่งบนเครื่องคนละตัวอาจไม่ใช่เวลาไทย แล้วเวลาส่งงานจะเพี้ยนไปเงียบ ๆ
ALTER TABLE weekly_logs
    ALTER COLUMN submitted_at TYPE TIMESTAMPTZ
    USING submitted_at AT TIME ZONE 'Asia/Bangkok';
