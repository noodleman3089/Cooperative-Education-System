-- 001_add_coop_calendar.sql
--
-- ปฏิทินสหกิจศึกษา: ช่วงเวลาที่เจ้าหน้าที่ตั้งได้ต่อภาคการศึกษา
-- คู่แฝดของบล็อก 6.2 ใน ../schema.sql — DDL ต้องเหมือนกันคำต่อคำ
-- ไม่งั้น e2e/schema-drift.spec.ts จะแดง (มันเทียบ information_schema
-- และ pg_indexes.indexdef ทีละแถว ชื่อ constraint จึงต้องสะกดตรงกันด้วย)

CREATE TABLE IF NOT EXISTS coop_calendar_events (
    event_id SERIAL PRIMARY KEY,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE CASCADE,
    activity_key VARCHAR(50),
    title VARCHAR(255),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    note TEXT,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT coop_calendar_events_range CHECK (end_date >= start_date),
    CONSTRAINT coop_calendar_events_title_required CHECK (activity_key IS NOT NULL OR title IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coop_calendar_activity_once
    ON coop_calendar_events (semester_id, activity_key)
    WHERE activity_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coop_calendar_semester ON coop_calendar_events (semester_id, start_date);
