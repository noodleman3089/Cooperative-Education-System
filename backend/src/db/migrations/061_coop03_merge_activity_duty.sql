-- 061 · สหกิจ 03: กิจกรรมนอกหลักสูตร — รวม "ตำแหน่ง" กับ "หน้าที่" เป็นช่องเดียว
--
-- แบบฟอร์มจริงมีคอลัมน์ "ระยะเวลา | ตำแหน่งและหน้าที่" (เจ้าของสั่ง 2026-10-18) — เก็บลงคีย์ `position` เดิม
-- แล้วเอา `duty` ออก · แถวเก่าที่มีสองช่องต่อกันด้วยช่องว่าง ไม่ให้ข้อมูลหาย (allow-list ฝั่งเซิร์ฟเวอร์ไม่รับ `duty` แล้ว)
UPDATE students s
   SET activity_history = (
         SELECT COALESCE(jsonb_agg(
                  CASE
                    WHEN jsonb_typeof(e.elem) = 'object' THEN
                      jsonb_strip_nulls(
                        (e.elem - 'duty')
                        || jsonb_build_object(
                             'position',
                             NULLIF(CONCAT_WS(' ', NULLIF(e.elem->>'position', ''), NULLIF(e.elem->>'duty', '')), '')
                           )
                      )
                    ELSE e.elem
                  END
                  ORDER BY e.ord
                ), '[]'::jsonb)
           FROM jsonb_array_elements(s.activity_history) WITH ORDINALITY AS e(elem, ord)
       )
 WHERE jsonb_typeof(s.activity_history) = 'array'
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(s.activity_history) AS x(elem)
          WHERE jsonb_typeof(x.elem) = 'object' AND x.elem ? 'duty'
       );
