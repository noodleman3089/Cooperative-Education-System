-- 057 · รอบพิเศษของปฏิทินสหกิจ (`coop_special_rounds`) — design_special_rounds.md
--
-- เจ้าหน้าที่เปิดรอบให้ "นักศึกษาที่เลือกรายคน" ส่งกิจกรรมที่ติ๊กไว้ได้แม้ช่วงปกติปิดแล้ว (ใช้แทนขั้นตอนกระดาษ
-- นักศึกษา → อาจารย์ที่ปรึกษา → หัวหน้าสาขา → คณะ) · ช่วงปกติ/ช่วงผ่อนผันไม่ถูกแตะ
--
-- แยกจาก `coop_calendar_events` โดยตั้งใจ: ตารางนั้นมี unique ต่อ (ภาค, activity_key) = "หนึ่งกิจกรรม หนึ่งช่วง"
-- รอบพิเศษคือหลายช่วงต่อหนึ่งกิจกรรม
--
-- ไม่มี CHECK ชุด activity_key (เหตุผลเดียวกับ coop_calendar_events) — controller ตรวจกับ COOP_ACTIVITIES
CREATE TABLE IF NOT EXISTS coop_special_rounds (
    round_id SERIAL PRIMARY KEY,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    note TEXT,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT coop_special_rounds_dates CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_coop_special_rounds_semester ON coop_special_rounds (semester_id, start_date);

CREATE TABLE IF NOT EXISTS coop_special_round_activities (
    round_id INT NOT NULL REFERENCES coop_special_rounds(round_id) ON DELETE CASCADE,
    activity_key VARCHAR(50) NOT NULL,
    PRIMARY KEY (round_id, activity_key)
);

CREATE TABLE IF NOT EXISTS coop_special_round_students (
    round_id INT NOT NULL REFERENCES coop_special_rounds(round_id) ON DELETE CASCADE,
    student_id INT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    PRIMARY KEY (round_id, student_id)
);
-- ด่านถามจากฝั่งนักศึกษา: "ฉันอยู่ในรอบไหนบ้าง"
CREATE INDEX IF NOT EXISTS idx_coop_special_round_students_student ON coop_special_round_students (student_id);
