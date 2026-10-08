/**
 * ย่อข้อมูลที่อยู่ประเทศไทยให้เหลือเฉพาะที่ระบบใช้จริง
 *
 *   node scripts/build-thai-address.mjs
 *   src/data/thai_geography.source.json  ->  src/data/thai_address.json
 *
 * ต้นฉบับ (2 MB) มาจากชุดข้อมูลสาธารณะที่พ่วง id, name_en, lat/long,
 * created_at/updated_at/deleted_at มาทุกระดับ — ฟอร์มที่อยู่ในระบบนี้ใช้แค่
 * ชื่อภาษาไทยกับรหัสไปรษณีย์ ที่เหลือจึงเป็นน้ำหนักที่ผู้ใช้ต้องดาวน์โหลดฟรีๆ
 *
 * ผลลัพธ์มีรูปร่างตรงกับ `ProvinceItem` ใน `src/data/thaiAddress.ts` พอดี
 * ตัวโหลดจึงไม่ต้อง map ข้อมูล 7,452 ตำบลใหม่ทุกครั้งที่เปิดฟอร์ม
 *
 * **อัปเดตข้อมูลเมื่อไหร่: วางต้นฉบับใหม่ทับ .source.json แล้วรันสคริปต์นี้ซ้ำ**
 * แล้วรัน `npx playwright test thai-address` เพื่อยืนยันว่าจำนวนและรหัสไปรษณีย์ยังครบ
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(dir, '../src/data/thai_geography.source.json');
const TARGET = path.join(dir, '../src/data/thai_address.json');

const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));

const trimmed = raw.map((province) => ({
  name: province.name_th,
  districts: (province.districts || []).map((district) => ({
    name: district.name_th,
    subdistricts: (district.sub_districts || []).map((sub) => ({
      name: sub.name_th,
      zipcode: sub.zip_code ? String(sub.zip_code) : '',
    })),
  })),
}));

// เขียนเฉพาะตอนเนื้อหาเปลี่ยน — เขียนทับด้วยเนื้อเดิมก็ทำให้ vite dev ที่เปิดอยู่รีโหลดหน้า
// (E2E รันสคริปต์นี้ระหว่างที่ worker อื่นกำลังใช้หน้าจออยู่)
const output = JSON.stringify(trimmed);
const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;
if (current !== output) fs.writeFileSync(TARGET, output);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const districts = trimmed.reduce((n, p) => n + p.districts.length, 0);
const subdistricts = trimmed.reduce(
  (n, p) => n + p.districts.reduce((m, d) => m + d.subdistricts.length, 0),
  0
);

console.log(`จังหวัด ${trimmed.length} · อำเภอ ${districts} · ตำบล ${subdistricts}`);
console.log(`${kb(fs.statSync(SOURCE).size)} -> ${kb(fs.statSync(TARGET).size)}`);
