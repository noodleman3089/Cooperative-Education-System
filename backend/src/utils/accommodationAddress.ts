/**
 * ที่อยู่ที่พักของนักศึกษา (สหกิจ 06) — ประกอบเป็นบรรทัดเดียวที่เดียวในระบบ
 *
 * ตั้งแต่ 2026-09-03 ตาราง `accommodations` เก็บที่อยู่เป็น **ช่องย่อยตามฟอร์มจริง**
 * ไม่ใช่ TEXT ก้อนเดียว · แต่ผู้อ่านส่วนใหญ่ (หน้านิเทศ · รายการของเจ้าหน้าที่)
 * ต้องการบรรทัดเดียวไว้แสดง จึงประกอบที่นี่ **ที่เดียว** ไม่ใช่ต่อสตริงใน SQL
 * หรือใน React ซ้ำกันสามที่ — วันที่รูปแบบเปลี่ยนจะได้แก้จุดเดียว
 *
 * ⛔ **ห้ามเขียนกลับลง `address_legacy`** คอลัมน์นั้นคือค่าเก่าก่อนแตกช่อง
 * มีไว้ให้นักศึกษาเห็นตอนกรอกใหม่ครั้งเดียวเท่านั้น
 */

export interface AccommodationAddressParts {
  house_no?: string | null;
  building?: string | null;
  room_no?: string | null;
  soi?: string | null;
  road?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postal_code?: string | null;
  /** ค่าเก่าก่อนแตกช่อง — ใช้เมื่อยังไม่มีใครกรอกช่องย่อย */
  address_legacy?: string | null;
}

const clean = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * คำนำหน้าของ ตำบล/อำเภอ ต่างกันระหว่างกรุงเทพฯ กับต่างจังหวัด
 *
 * ชุดข้อมูลที่โปรเจคใช้สะกดเขตของกรุงเทพฯ มาพร้อมคำว่า "เขต" อยู่แล้ว
 * (เช่น `เขตบางรัก`) แต่แขวงไม่มีคำว่า "แขวง" นำ — เติมทับโดยไม่ดูจะได้
 * "เขตเขตบางรัก" ซึ่งเคยหลุดไปทั้งระบบมาแล้ว (ดู `StudentProfile.tsx`)
 */
const withPrefix = (prefix: string, name: string): string =>
  !name || name.startsWith(prefix) ? name : `${prefix}${name}`;

/** ที่อยู่บรรทัดเดียวสำหรับแสดงผล — คืนสตริงว่างเมื่อยังไม่มีข้อมูลเลย */
export function formatAccommodationAddress(
  a: AccommodationAddressParts | null | undefined
): string {
  if (!a) return '';

  const isBangkok = clean(a.province) === 'กรุงเทพมหานคร';
  const parts = [
    clean(a.house_no) && `เลขที่ ${clean(a.house_no)}`,
    clean(a.building),
    clean(a.room_no) && `ห้อง ${clean(a.room_no)}`,
    clean(a.soi) && `ซอย${clean(a.soi)}`,
    clean(a.road) && `ถนน${clean(a.road)}`,
    clean(a.subdistrict) && withPrefix(isBangkok ? 'แขวง' : 'ตำบล', clean(a.subdistrict)),
    clean(a.district) && withPrefix(isBangkok ? 'เขต' : 'อำเภอ', clean(a.district)),
    clean(a.province) && (isBangkok ? clean(a.province) : `จังหวัด${clean(a.province)}`),
    clean(a.postal_code),
  ].filter(Boolean);

  // ยังไม่มีใครกรอกช่องย่อย = แถวเก่าก่อน 2026-09-03 → คืนค่าเดิมไปก่อน
  // ดีกว่าคืนค่าว่างแล้วอาจารย์นิเทศเห็นว่า "ไม่มีที่พัก" ทั้งที่มีข้อมูลอยู่
  return parts.length > 0 ? parts.join(' ') : clean(a.address_legacy);
}

/**
 * ลิงก์เปิดพิกัดใน Google Maps — คืน `null` เมื่อยังไม่มีพิกัด
 *
 * ⛔ ใช้ลิงก์ ไม่ใช่แผนที่ฝัง (เจ้าของเคาะไว้ใน `design_student_address_map.md`)
 * แผนที่ฝังกินโควตา API ทุกครั้งที่เปิดหน้า ทั้งที่อาจารย์ต้องดูจริงแค่ตอนวางแผนเดินทาง
 */
export function mapsLinkFor(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined
): string | null {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
    return null;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://maps.google.com/?q=${lat},${lng}`;
}

/** พิกัดที่รับได้จริง — นอกช่วงนี้คือค่าที่กรอกผิด ไม่ใช่ตำแหน่งบนโลก */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  return (
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    lngNum >= -180 &&
    lngNum <= 180
  );
}
