-- 058 · คำตัดสินของคณบดีบนบันทึกข้อความถึงคณบดี (`student_memos`) — design_special_rounds.md ข้อ 8.3
--
-- เจ้าของสั่ง 2026-10-18 (กลับคำตัดสิน 2026-08-27 ที่ให้บันทึกไม่มีสถานะ): คณบดีกดอนุมัติ/ไม่อนุมัติในระบบ
-- แล้วเจ้าหน้าที่นำบันทึกที่อนุมัติไปเปิดรอบพิเศษให้นักศึกษา (หัวข้อ early_departure · late_submission)
--
-- ลายเซ็นบนกระดาษยังคงเป็นหลักฐานทางการ · คำตัดสินในระบบคือสิ่งที่ปลดล็อกรอบพิเศษ
-- บันทึกเดิมทุกใบเริ่มที่ 'pending' (ไม่เดาว่าใบเก่าเคยได้รับอนุมัติ)
ALTER TABLE student_memos
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS decided_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decision_note TEXT;

ALTER TABLE student_memos
    ADD CONSTRAINT student_memos_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
    -- ตัดสินแล้วต้องมีเวลา · ยังไม่ตัดสินต้องไม่มี — กันแถวที่สถานะกับเวลาขัดกัน
    ADD CONSTRAINT student_memos_decision_consistent CHECK (
        (status = 'pending' AND decided_at IS NULL)
        OR (status <> 'pending' AND decided_at IS NOT NULL)
    );

-- ปุ่ม "นำเข้าจากบันทึกข้อความ" ของเจ้าหน้าที่ถามเฉพาะที่อนุมัติแล้วในภาคหนึ่ง
CREATE INDEX IF NOT EXISTS idx_student_memos_approved
    ON student_memos (semester_id, memo_id DESC) WHERE status = 'approved';
