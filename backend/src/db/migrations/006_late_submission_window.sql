-- ช่วงผ่อนผัน (ส่งช้า) + ตราประทับว่าใบไหนยื่นแบบส่งช้า (2026-09-01)
--
-- เดิมปฏิทินมีวันปิดวันเดียว: เลย end_date = ปฏิเสธ 403 ทันที ซึ่งทำให้ "เลยกำหนด
-- 1 วัน" กับ "เลยกำหนด 3 เดือน" ถูกปฏิบัติเหมือนกัน · ของจริงคณะรับได้อีกช่วงหนึ่ง
-- แต่ถือเป็นการส่งช้าที่ต้องมีบันทึกข้อความชี้แจงแนบไปด้วย (เจ้าของยืนยัน 2026-09-01)

-- 1) วันสุดท้ายที่ยังรับแบบส่งช้า
--    NULL = ไม่เปิดผ่อนผันสำหรับกิจกรรมนั้น = พฤติกรรมเดิมทุกประการ
--    เจตนา: ระบบเดาแทนคณะไม่ได้ว่า "ผ่อนผันถึงวันไหน" ต้องมีคนตัดสินเสมอ
--    หน้าจอเจ้าหน้าที่ขึ้นแถบเตือนกิจกรรมที่ยังไม่ได้ตั้ง เหมือนที่ทำกับ not_configured
ALTER TABLE coop_calendar_events ADD COLUMN IF NOT EXISTS late_end_date DATE;

ALTER TABLE coop_calendar_events DROP CONSTRAINT IF EXISTS coop_calendar_events_late_range;
ALTER TABLE coop_calendar_events ADD CONSTRAINT coop_calendar_events_late_range
    CHECK (late_end_date IS NULL OR late_end_date >= end_date);

-- 2) ตราประทับบนใบความจำนง
--    ⛔ ปั๊มตอน INSERT เท่านั้น ห้ามคำนวณย้อนหลังจากวันที่ — เจ้าหน้าที่แก้ปฏิทิน
--       ทีหลังได้ ถ้าคำนวณสด ใบที่เคยส่งช้าจะกลายเป็นส่งตรงเวลาทันทีที่ขยายวัน
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS submitted_late BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS late_reason TEXT;

-- CHECK ระดับฐานเก็บแค่ข้อเท็จจริง "ส่งช้าต้องมีเหตุผล" ไม่ใช่ความยาวขั้นต่ำ
-- ความยาวเป็นกติกาหน้าจอ อยู่ที่ controller — ปรับได้โดยไม่ต้องมี migration ใหม่
ALTER TABLE intent_forms DROP CONSTRAINT IF EXISTS intent_forms_late_reason_required;
ALTER TABLE intent_forms ADD CONSTRAINT intent_forms_late_reason_required
    CHECK (submitted_late = FALSE OR (late_reason IS NOT NULL AND btrim(late_reason) <> ''));

-- 3) เปิดทางให้ "เปลี่ยนสถานประกอบการ" เป็นไปได้
--    เดิม index นี้บังคับ 1 คน 1 ใบต่อภาค ยกเว้นใบที่ถูกปฏิเสธ → นักศึกษาที่บริษัท
--    ตอบรับแล้ว (accepted) และต้องย้ายที่ ยื่นใบใหม่ไม่ได้เลย DB ปฏิเสธก่อนถึง
--    validation ด้วยซ้ำ · เพิ่มสถานะ 'superseded' = ใบเดิมถูกแทนที่ด้วยใบใหม่
--
--    ⚠️ คง 'rejected_by_dept_head' ไว้ทั้งที่สถานะนี้ถูกลบไปแล้วเมื่อ 2026-08-27
--       โดยตั้งใจ: ฐานจริงอาจมีแถวเก่าค้างอยู่ ถ้าถอดออกจากรายการยกเว้น แถวเก่านั้น
--       จะกลับมานับเป็น "ใบที่ยังใช้งานอยู่" แล้ว CREATE INDEX ล้มทั้ง migration
DROP INDEX IF EXISTS uq_student_semester_active;
CREATE UNIQUE INDEX uq_student_semester_active
ON intent_forms (student_id, semester_id)
WHERE status NOT IN ('rejected', 'company_rejected', 'rejected_by_dept_head', 'superseded');
