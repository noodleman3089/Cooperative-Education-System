-- 023_coop_job_offers.sql
-- แบบเสนองานสหกิจศึกษา (สหกิจ 02) — เปลี่ยนฝั่งสถานประกอบการจาก "เว็บลงประกาศงาน"
-- เป็น "ที่ที่บริษัทตอบแบบสำรวจที่มหาวิทยาลัยส่งไปถามล่วงหน้า 1 ภาคการศึกษา"
--
-- โครงที่ได้คือ ใบสำรวจ 1 ใบ (coop_job_offers) ต่อ 1 บริษัท ต่อ 1 ภาคเรียน
-- และข้างในมีได้หลายรายการตำแหน่ง ซึ่งยังคงใช้ตาราง job_posts เดิม
-- (กระดาษหน้า 2 หนึ่งแผ่นต่อหนึ่งรายการ)
--
-- ⛔ ไฟล์นี้ **ไม่ลบ job_posts.image_path** ทั้งที่ตัดสินไว้แล้วว่าจะตัดทิ้ง
--    เพราะโค้ดที่ยังรันอยู่อ่านคอลัมน์นี้อยู่ 6 จุด (models/job.ts, controllers/job.ts,
--    types/index.ts) — ลบก่อนแก้โค้ดคือทำ SELECT พังทันทีในฐานที่ migrate แล้ว
--    การลบคอลัมน์จึงไปอยู่ใน migration ตัวหลังจากที่โค้ดเลิกอ้างถึงมันแล้ว

-- 1. ช่องของ สหกิจ 02 หน้า 1 ที่ทะเบียนสถานประกอบการเดิมไม่มี
--    อยู่ที่ระดับบริษัทเพราะเป็นข้อเท็จจริงที่ใช้ซ้ำทุกภาคเรียน ไม่ใช่คำตอบรายภาค
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fax VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_type VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS employee_count INT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS manager_name VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS manager_position VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS manager_department VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS manager_phone VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS manager_fax VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_department VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_fax VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_mode VARCHAR(10) NOT NULL DEFAULT 'delegate';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'companies_contact_mode_check'
    ) THEN
        ALTER TABLE companies ADD CONSTRAINT companies_contact_mode_check
            CHECK (contact_mode IN ('manager', 'delegate'));
    END IF;
END $$;

-- 2. ใบสำรวจ — บริษัทสร้างเองไม่ได้ เจ้าหน้าที่เป็นคนเปิดใบตอนส่งแบบสำรวจ
CREATE TABLE IF NOT EXISTS coop_job_offers (
    offer_id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    semester_id INT NOT NULL REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CONSTRAINT coop_job_offers_status_check
        CHECK (status IN ('draft', 'submitted', 'reviewed', 'declined')),
    due_date DATE,
    submitted_at TIMESTAMPTZ,
    submitted_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    informant_name VARCHAR(255),
    informant_position VARCHAR(255),
    decline_reason TEXT,
    reject_reason TEXT,
    copied_from_offer_id INT REFERENCES coop_job_offers(offer_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT coop_job_offers_company_semester_key UNIQUE (company_id, semester_id)
);

-- 3. ลิงก์ตอบแบบสำรวจทางอีเมล — 24 ชั่วโมง ใช้ได้ครั้งเดียว
CREATE TABLE IF NOT EXISTS job_offer_tokens (
    token_id SERIAL PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    offer_id INT NOT NULL REFERENCES coop_job_offers(offer_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_offer_tokens_offer ON job_offer_tokens(offer_id);

-- 4. ช่องของ สหกิจ 02 หน้า 2 ที่ job_posts เดิมไม่มี
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS offer_id INT REFERENCES coop_job_offers(offer_id) ON DELETE CASCADE;
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS semester_id INT REFERENCES coop_semesters(semester_id) ON DELETE RESTRICT;
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS duration_term VARCHAR(10);
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS skills_required TEXT;
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS other_requirements TEXT;
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS pay_amount NUMERIC(10, 2);
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS pay_unit VARCHAR(10);
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS accommodation VARCHAR(20);
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS accommodation_cost VARCHAR(100);
ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS welfare_other TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'job_posts_duration_term_check'
    ) THEN
        ALTER TABLE job_posts ADD CONSTRAINT job_posts_duration_term_check
            CHECK (duration_term IS NULL OR duration_term IN ('term1', 'term2', 'full_year'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'job_posts_pay_unit_check'
    ) THEN
        ALTER TABLE job_posts ADD CONSTRAINT job_posts_pay_unit_check
            CHECK (pay_unit IS NULL OR pay_unit IN ('day', 'month'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'job_posts_accommodation_check'
    ) THEN
        ALTER TABLE job_posts ADD CONSTRAINT job_posts_accommodation_check
            CHECK (accommodation IS NULL OR accommodation IN ('none', 'free', 'paid'));
    END IF;
END $$;

-- 5. สาขาที่ตำแหน่งหนึ่งต้องการ (หลายสาขาต่อหนึ่งรายการได้)
CREATE TABLE IF NOT EXISTS job_post_majors (
    job_id INT NOT NULL REFERENCES job_posts(job_id) ON DELETE CASCADE,
    major_id INT NOT NULL REFERENCES master_major(major_id) ON DELETE RESTRICT,
    CONSTRAINT job_post_majors_pkey PRIMARY KEY (job_id, major_id)
);

-- 6. แถวเดิมที่เกิดก่อนระบบใบสำรวจ — เติมภาคเรียนที่ใช้งานอยู่ให้ เพื่อให้กระดานหางาน
--    ฝั่งนักศึกษาที่จะเริ่มกรองด้วย semester_id ไม่ทำให้ประกาศเก่าหายไปทั้งหมด
--    ⛔ ไม่แตะ offer_id — แถวเก่าไม่มีใบสังกัดจริง การเดาให้มันคือการสร้างหลักฐานปลอม
UPDATE job_posts
   SET semester_id = (
        SELECT semester_id FROM coop_semesters
         WHERE is_active = TRUE
         ORDER BY semester_id DESC
         LIMIT 1
   )
 WHERE semester_id IS NULL
   AND EXISTS (SELECT 1 FROM coop_semesters WHERE is_active = TRUE);
