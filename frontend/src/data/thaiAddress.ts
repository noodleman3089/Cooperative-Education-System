export interface SubdistrictItem {
  name: string;
  zipcode: string;
}

export interface DistrictItem {
  name: string;
  subdistricts: SubdistrictItem[];
}

export interface ProvinceItem {
  name: string;
  districts: DistrictItem[];
}

let cache: ProvinceItem[] | null = null;
let inFlight: Promise<ProvinceItem[]> | null = null;

/**
 * ทุกจังหวัด อำเภอ และตำบลในประเทศไทย — 77 / 930 / 7,452 รายการ
 *
 * เดิมเป็น `import` ธรรมดาที่หัวไฟล์ ทำให้ก้อน 2 MB ขี่เข้า bundle หลักและผู้ใช้
 * ทุกบทบาทต้องดาวน์โหลดให้เสร็จก่อนหน้าล็อกอินจะขึ้น เพื่อเติม dropdown สามช่อง
 * ในหน้าเดียว · แก้เป็น dynamic import แล้ว มันจึงมาเมื่อฟอร์มต้องใช้จริงเท่านั้น
 *
 * รอบ 35 ตัดต่ออีกชั้น: ต้นฉบับพ่วง id, name_en, lat/long และ timestamp มาทุกระดับ
 * ซึ่งไม่มีที่ไหนในระบบใช้เลย · `scripts/build-thai-address.mjs` ย่อให้เหลือเฉพาะ
 * ชื่อไทยกับรหัสไปรษณีย์ → **2,022 KB เหลือ 431 KB (gzip 211 → 61 KB)**
 * และรูปร่างที่ได้ตรงกับ `ProvinceItem` พอดี จึงไม่ต้อง map 7,452 รายการใหม่
 * ทุกครั้งที่โหลด — เร็วขึ้นทั้งการดาวน์โหลดและการ parse
 *
 * **แก้ข้อมูลต้องแก้ที่ `thai_geography.source.json` แล้วรันสคริปต์ ห้ามแก้ไฟล์ผลลัพธ์มือ**
 */
export async function loadThaiAddressData(): Promise<ProvinceItem[]> {
  if (cache) return cache;
  if (!inFlight) {
    inFlight = import('./thai_address.json').then(({ default: data }) => {
      cache = data as ProvinceItem[];
      return cache;
    });
  }
  return inFlight;
}
