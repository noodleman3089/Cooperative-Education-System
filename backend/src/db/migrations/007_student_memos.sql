-- บันทึกข้อความของนักศึกษา (2026-09-01)
--
-- คู่มือ PDF หน้า 45-50 ระบุกรณียกเว้น 3 กรณีที่ต้องยื่น "บันทึกข้อความ" ถึงคณบดี
-- (ออกก่อนกำหนด · เปลี่ยนสถานประกอบการ · ถูกส่งตัวกลับ) และเจ้าหน้าที่งานสหกิจเล่าถึง
-- กรณีที่สี่คือส่งเอกสารล่าช้า ซึ่งใช้กลไกเดียวกันแต่ยังไม่ถูกเขียนเป็นลายลักษณ์อักษร
--
-- ⛔ ทำไมต้องเป็นตารางแยก ไม่ใช่คอลัมน์บน intent_forms:
--    สามกรณีในคู่มือเกิดได้ **ระหว่างปฏิบัติงาน** ไม่ผูกกับช่วงยื่นใบความจำนง และคนหนึ่ง
--    ยื่นได้หลายใบในภาคเดียว (เช่นเปลี่ยนที่แล้วต่อมาถูกส่งตัวกลับ) ต่างจากธง
--    submitted_late ที่เป็นคุณสมบัติของ "การยื่นครั้งนั้น" จึงอยู่บน intent_forms ถูกแล้ว

CREATE TABLE IF NOT EXISTS student_memos (
    memo_id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT,

    -- หัวข้อที่ **นักศึกษาเลือกเอง** — ระบบเลือกไว้ให้ล่วงหน้าตามบริบทเท่านั้น
    -- ไม่ตัดสินแทน (เจ้าของเคาะ 2026-09-01) · ชุดค่าที่ยอมรับอยู่ที่
    -- backend/src/config/memoTypes.ts ที่เดียว จงใจไม่ทำ CHECK ตรงนี้ให้เป็น
    -- แหล่งความจริงที่สอง (เหตุผลเดียวกับ coop_calendar_events.activity_key)
    memo_type VARCHAR(30) NOT NULL,

    -- ใบความจำนงที่บันทึกฉบับนี้อ้างถึง ถ้ามี · SET NULL เพราะบันทึกเป็นหลักฐาน
    -- ที่ต้องอยู่ต่อแม้ใบความจำนงจะถูกลบ
    intent_form_id INT REFERENCES intent_forms(form_id) ON DELETE SET NULL,

    -- เหตุผลที่นักศึกษาเขียนเอง — ถูกพิมพ์ลงบรรทัด "มีความประสงค์…เนื่องจาก…"
    -- ซึ่งเป็นสิ่งที่คณบดีอ่านจริง ระบบเติมแทนไม่ได้
    reason TEXT NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT student_memos_reason_required CHECK (btrim(reason) <> '')
);

-- ผู้เรียกจริงมีสองแบบ: "บันทึกของนักศึกษาคนนี้" และ "บันทึกของภาคนี้ทั้งหมด"
-- ทั้งคู่เรียงตามใหม่สุดก่อน จึงพอด้วย index เดียว
CREATE INDEX IF NOT EXISTS idx_student_memos_student ON student_memos (student_id, memo_id DESC);
CREATE INDEX IF NOT EXISTS idx_student_memos_semester ON student_memos (semester_id, memo_id DESC);
