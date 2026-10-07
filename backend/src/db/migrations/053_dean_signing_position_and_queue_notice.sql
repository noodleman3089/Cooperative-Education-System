-- 053 · ขั้น 3 คณบดีลงนามหนังสือ — 2026-10-07 (เพิ่มอย่างเดียว ไม่มีข้อมูลหาย)
--
-- (1) `signing_position` — ตำแหน่งที่พิมพ์ใต้ลายมือชื่อ · ว่าง = "คณบดี" + ชื่อคณะ เหมือนเดิม
--     มีค่า = พิมพ์ค่านั้นแทนทั้งบรรทัด (ขึ้นบรรทัดใหม่ได้) เพราะผู้รักษาการแทนลงนามแล้วตำแหน่ง "คณบดี…" ผิด
--     ไม่มีชุดถ้อยคำสำเร็จรูป: ถ้อยคำทางการยังไม่ได้ยืนยันกับคณะ ผู้ลงนามพิมพ์เอง
-- (2) `sign_queue_seen_at` / `sign_queue_notified_at` — ตัวแจ้งคณบดีว่ามีหนังสือเข้าคิวลงนาม
--     seen = ครั้งล่าสุดที่คณบดีเปิดคิว · notified = ครั้งล่าสุดที่ระบบส่งอีเมลเตือน
--     (ไม่มีตารางจดการเตือน ไม่มีตัวตั้งเวลา — สองช่องนี้พอสำหรับ "ไม่อยู่ให้ส่ง · รับ 30 ใบได้ฉบับเดียว")
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS signing_position VARCHAR(255);
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS sign_queue_seen_at TIMESTAMPTZ;
ALTER TABLE personnel ADD COLUMN IF NOT EXISTS sign_queue_notified_at TIMESTAMPTZ;
