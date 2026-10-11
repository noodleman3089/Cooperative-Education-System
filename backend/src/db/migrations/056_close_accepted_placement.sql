-- 056 · ขั้น 9 — 2026-10-11 (เพิ่มอย่างเดียว ไม่มีข้อมูลหาย)
--
-- เจ้าหน้าที่ปิดใบที่ตอบรับแล้ว (นักศึกษาถูกส่งตัวกลับ / เปลี่ยนที่ฝึก) → ใบเป็น `superseded` นักศึกษายื่นที่ใหม่ได้
-- `closed_kind`          เหตุที่ปิด · เหตุผลที่เจ้าหน้าที่พิมพ์อยู่ที่ `reject_reason`
-- `closed_accommodation` แถว `accommodations` (สหกิจ 06) ณ ตอนปิด — แถวจริงถูกลบเพื่อให้นักศึกษาส่งใหม่
--                        เก็บไว้คืนเมื่อเจ้าหน้าที่ยกเลิกการปิด · ⛔ มีที่อยู่ของนักศึกษา ห้ามส่งออกทาง API
-- NULL ทั้งคู่ = ใบไม่ได้ถูกปิดด้วยทางนี้ (หรือยกเลิกการปิดแล้ว)
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS closed_kind VARCHAR(30)
    CHECK (closed_kind IN ('sent_back', 'change_company'));
ALTER TABLE intent_forms ADD COLUMN IF NOT EXISTS closed_accommodation JSONB;
