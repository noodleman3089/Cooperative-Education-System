-- 017 · ปฏิทินสหกิจศึกษา รับชนิดวันที่ 5 แบบตามปฏิทินคณะตัวจริง (2026-09-04)
--
-- ที่มา: ปฏิทินสหกิจศึกษา ประจำปีการศึกษา 2569 คณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ
-- ถอดไว้ที่ `เอกสาร/analysis_calendar_2569.md` — 11 รายการ × 2 ภาค = 22 เซลล์
-- แต่โครงเดิม (start/end NOT NULL ทั้งคู่) เก็บได้จริงแค่ 8 เซลล์
--
-- ⛔ แถว weekly_log ถูกลบทิ้ง ไม่ใช่ย้ายข้อมูล — ตั้งแต่รอบนี้ช่วงบันทึกรายสัปดาห์
--    **คำนวณเอง** จาก coop_start → coop_end (ปฏิทินคณะไม่มีแถวของมันเพราะมันคือ
--    ช่วงระหว่างวันเริ่มกับวันสิ้นสุดพอดี) การเก็บแถวเดิมไว้คือปล่อยให้มีวันสองชุด
--    ที่วันหนึ่งจะไม่ตรงกัน โดยไม่มีใครอ่านแถวนั้นอีกแล้ว
--    · เจ้าหน้าที่ต้องกรอก "วันเริ่มปฏิบัติงาน" และ "วันสิ้นสุดการปฏิบัติงาน" แทน
DELETE FROM coop_calendar_events WHERE activity_key = 'weekly_log';

ALTER TABLE coop_calendar_events
    ADD COLUMN IF NOT EXISTS date_kind VARCHAR(20) NOT NULL DEFAULT 'range';
ALTER TABLE coop_calendar_events
    ADD CONSTRAINT coop_calendar_events_date_kind_check
    CHECK (date_kind IN ('range', 'deadline', 'single', 'relative', 'external'));

ALTER TABLE coop_calendar_events ADD COLUMN IF NOT EXISTS detail_text TEXT;
ALTER TABLE coop_calendar_events ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- แถวเดิมทุกแถวเป็นชนิด range ที่มีวันครบอยู่แล้ว (คอลัมน์เดิมเป็น NOT NULL)
-- จึงผ่าน CHECK ใหม่ได้ทันที ไม่ต้อง backfill อะไร
ALTER TABLE coop_calendar_events ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE coop_calendar_events ALTER COLUMN end_date DROP NOT NULL;

ALTER TABLE coop_calendar_events DROP CONSTRAINT IF EXISTS coop_calendar_events_range;
ALTER TABLE coop_calendar_events
    ADD CONSTRAINT coop_calendar_events_dates_by_kind CHECK (
           (date_kind = 'range'    AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
        OR (date_kind = 'deadline' AND start_date IS NULL     AND end_date IS NOT NULL)
        OR (date_kind = 'single'   AND start_date IS NOT NULL AND end_date = start_date)
        OR (date_kind IN ('relative', 'external') AND start_date IS NULL AND end_date IS NULL)
    );

-- เดิมเทียบ `late_end_date >= end_date` เฉยๆ ซึ่งเมื่อ end_date เป็น NULL ได้แล้ว
-- ผลจะเป็น NULL และ CHECK ถือว่าผ่าน → แถว relative แอบมีวันผ่อนผันได้
ALTER TABLE coop_calendar_events DROP CONSTRAINT IF EXISTS coop_calendar_events_late_range;
ALTER TABLE coop_calendar_events
    ADD CONSTRAINT coop_calendar_events_late_range CHECK (
        late_end_date IS NULL OR (end_date IS NOT NULL AND late_end_date >= end_date)
    );

ALTER TABLE coop_calendar_events
    ADD CONSTRAINT coop_calendar_events_detail_required CHECK (
        date_kind NOT IN ('relative', 'external') OR detail_text IS NOT NULL
    );

-- เรียงตามลำดับบนกระดาษแทนการเรียงตามวัน — แถวที่ไม่มีวันไม่มีที่ยืนในการเรียงตามวัน
DROP INDEX IF EXISTS idx_coop_calendar_semester;
CREATE INDEX IF NOT EXISTS idx_coop_calendar_semester_order
    ON coop_calendar_events (semester_id, sort_order);
