-- 051 · ขั้น 2 เจ้าหน้าที่รับ/ตีกลับคำร้อง (เอกสารหมายเลข 1) — 2026-10-07
--
-- (1) เลขที่หนังสือสองคอลัมน์กว้างไม่เท่ากัน: `intent_forms.officer_document_no` / `dispatch_document_no`
--     เป็น VARCHAR(100) แต่ `official_documents.document_number` เป็น VARCHAR(50)
--     เลขยาว 51–100 ผ่านขั้นรับคำร้องแล้วไปล้มตอนบันทึกหนังสือ = ใบผ่านแล้วแต่ไม่มีหนังสือเข้าคิวคณบดี
ALTER TABLE official_documents ALTER COLUMN document_number TYPE VARCHAR(100);

-- (2) ประวัติการตีกลับคำร้อง — `intent_forms.reject_reason` ถูกล้างเมื่อนักศึกษาส่งใหม่ เจ้าหน้าที่จึงไม่เห็นว่า
--     ใบนี้เคยถูกตีกลับเพราะอะไร · เก็บเหตุผลและผู้กดไว้กับเหตุการณ์ `request_returned`
--     ทั้งสองคอลัมน์ว่างได้: เหตุการณ์อื่นไม่ใช้ และแถวก่อน migration นี้ไม่มีข้อมูล (= ไม่แสดง ห้ามแต่ง)
ALTER TABLE intent_stage_events ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE intent_stage_events ADD COLUMN IF NOT EXISTS actor_id INT REFERENCES users(user_id) ON DELETE SET NULL;
