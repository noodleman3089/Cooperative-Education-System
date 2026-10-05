-- 049 · เวลาที่ใบคำร้องเข้าแต่ละขั้น (`intent_stage_events`) — เฟส 2 R2-1 ของ design_semester_lifecycle.md
--
-- ตารางปฏิบัติการ **แยกจาก `audit_log`** — `audit_log` จงใจไม่มี read API (SEC-07) จึงอ่านมาทำ "ค้างกี่วัน"
-- ไม่ได้ · ตารางนี้เขียนอย่างเดียวที่จุดเปลี่ยนสถานะ (utils/stageEvents.ts) และอ่านโดยแดชบอร์ดเจ้าหน้าที่เท่านั้น
-- ไม่เก็บข้อมูลส่วนตัว (form_id + ชื่อขั้น + เวลา) · ใบถูกลบ = แถวหายตาม (CASCADE)
--
-- ใบเก่าที่เกิดก่อนมีตารางนี้: เติมย้อนหลังเท่าที่คอลัมน์เดิมบอกได้ (ยื่น · เจ้าหน้าที่รับ · คณบดีลงนาม · ส่งเมลหาบริษัท)
-- ขั้นที่ไม่มีเวลาเดิมให้อ่านไม่เติม = "ไม่ทราบ" (ห้ามเดา)
CREATE TABLE IF NOT EXISTS intent_stage_events (
    event_id SERIAL PRIMARY KEY,
    form_id INT NOT NULL REFERENCES intent_forms(form_id) ON DELETE CASCADE,
    stage VARCHAR(30) NOT NULL,
    entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intent_stage_events_form ON intent_stage_events (form_id, stage, entered_at DESC);

INSERT INTO intent_stage_events (form_id, stage, entered_at)
SELECT form_id, 'form_created', created_at FROM intent_forms WHERE created_at IS NOT NULL;

INSERT INTO intent_stage_events (form_id, stage, entered_at)
SELECT form_id, 'officer_approved', officer_approved_at FROM intent_forms WHERE officer_approved_at IS NOT NULL;

INSERT INTO intent_stage_events (form_id, stage, entered_at)
SELECT form_id, 'mail_sent', company_mail_sent_at FROM intent_forms WHERE company_mail_sent_at IS NOT NULL;

-- คณบดีลงนามหนังสือขอความอนุเคราะห์ — LATERAL เดียวกับที่แดชบอร์ด/SEC-13 ใช้ (เทียบเลขที่หนังสือกับ officer_document_no)
INSERT INTO intent_stage_events (form_id, stage, entered_at)
SELECT i.form_id, 'dean_signed', doc.dean_signature_date::timestamptz
  FROM intent_forms i
  JOIN LATERAL (
    SELECT d.dean_signature_date
      FROM official_documents d
     WHERE d.student_id = i.student_id AND d.company_id = i.company_id
       AND d.type = 'cover_letter' AND d.status = 'signed'
       AND d.document_number IS NOT DISTINCT FROM i.officer_document_no
       AND d.dean_signature_date IS NOT NULL
     ORDER BY d.doc_id DESC
     LIMIT 1
  ) doc ON TRUE;
