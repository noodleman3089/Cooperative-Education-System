-- 055 · ยุบคณะศิลปศาสตร์เข้าคณะบริหารธุรกิจและเทคโนโลยีสารสนเทศ — 2026-10-10
--
-- เจ้าของยืนยัน 2026-10-09: สองคณะรวมกันแล้ว — คณะเดียว คณบดีคนเดียว หัวกระดาษเดียว
-- seed (2026-10-06) ใส่คณะศิลปศาสตร์กับสาขา 3 สาขาที่ซ้อนกับสาขาของคณะบริหารธุรกิจฯ ไว้:
--   TH02  การท่องเที่ยวและการโรงแรม              → TH01
--   SBT01 การจัดการธุรกิจและเทคโนโลยีการกีฬา      → SM01
--   EIC01 ภาษาอังกฤษเพื่อการสื่อสารสากล            → LANG01
--
-- ไม่มีข้อมูลหาย: ทุกแถวที่อ้างสาขาเก่า (students · personnel · personnel_preseed_list — สามตารางที่มี major_id)
-- ถูกย้ายไปสาขาปลายทางก่อน แล้วจึงลบสาขาเก่า · คู่ไหนที่ฐานนี้ไม่มีสาขาปลายทาง = ข้ามคู่นั้น ไม่ลบ ไม่เดา
-- แถวคณะถูกลบเมื่อไม่เหลือสาขาใต้คณะนั้นแล้วเท่านั้น (master_major.faculty_id เป็น ON DELETE CASCADE —
-- ลบคณะทั้งที่ยังมีสาขาอื่นที่เจ้าหน้าที่เพิ่มเองจะพาสาขานั้นหายไปด้วย)
-- ⚠️ ถ้าสาขาเก่ากับสาขาปลายทางมีหัวหน้าสาขาคนละคน หลังรันจะมีหัวหน้าสาขาสองคนในสาขาเดียว — เจ้าหน้าที่ต้องถอนบทบาทหนึ่งคนเอง

CREATE TEMP TABLE merge_major_map ON COMMIT DROP AS
SELECT o.major_id AS from_id, n.major_id AS to_id
  FROM (VALUES ('TH02', 'TH01'), ('SBT01', 'SM01'), ('EIC01', 'LANG01')) AS v(from_code, to_code)
  JOIN master_major o ON o.major_code = v.from_code
  JOIN master_major n ON n.major_code = v.to_code;

UPDATE students s               SET major_id = m.to_id FROM merge_major_map m WHERE s.major_id = m.from_id;
UPDATE personnel p              SET major_id = m.to_id FROM merge_major_map m WHERE p.major_id = m.from_id;
UPDATE personnel_preseed_list l SET major_id = m.to_id FROM merge_major_map m WHERE l.major_id = m.from_id;

DELETE FROM master_major WHERE major_id IN (SELECT from_id FROM merge_major_map);

DELETE FROM master_faculty f
 WHERE f.faculty_name_th = 'คณะศิลปศาสตร์'
   AND NOT EXISTS (SELECT 1 FROM master_major mm WHERE mm.faculty_id = f.faculty_id);
