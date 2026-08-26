-- หนังสือขอความอนุเคราะห์ถูกวาดจากโค้ดแทนแม่แบบ (2026-08-26)
--
-- `utils/coverLetterPdf.ts` วาดเอกสารทั้งใบด้วย pdf-lib จึงไม่มีแถวใน
-- document_templates ให้อ้างถึงอีก · คอลัมน์ยังอยู่เพื่อเอกสารเก่าที่เคยผูกกับ
-- แม่แบบจริง แต่ต้องยอมให้เป็น NULL สำหรับใบที่ออกด้วยวิธีใหม่

ALTER TABLE official_documents ALTER COLUMN template_id DROP NOT NULL;
