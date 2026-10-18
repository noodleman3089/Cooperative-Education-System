/**
 * ถาม Google ว่า place id นี้มีอยู่จริงหรือไม่ — ด่านของ SEC-04 ข้อยกเว้น "ค้นจาก Google Maps รับรองทันที"
 *
 * `google_place_id` มาจากฝั่งนักศึกษา เซิร์ฟเวอร์จึงเชื่อไม่ได้ว่ามาจากการเลือกใน Google Maps จริง
 * (ยิง `POST /intents` ตรงด้วย id ที่แต่งเองได้) · ตรวจกับ Places API (New) ด้วยคีย์ฝั่งเซิร์ฟเวอร์
 * ก่อนปล่อยให้แถวถูกตั้ง `is_verified = TRUE`
 *
 * ⛔ **fail closed** — ตอบไม่ได้ · ไม่มีคีย์ · คีย์ไม่ได้เปิด Places API · หมดโควตา = `false`
 *    ผู้เรียกต้องปฏิบัติเหมือนไม่มี place id (รอเจ้าหน้าที่) **ห้ามปฏิเสธการยื่นเพราะตรวจไม่ผ่าน**
 * ⛔ `GOOGLE_PLACES_API_BASE` มีไว้ให้ E2E ชี้ไป stub ในเครื่อง (playwright.config.ts) — E2E ห้ามเรียก Google จริง
 */
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const TIMEOUT_MS = 5000;

export async function isRealGooglePlace(placeId: string): Promise<boolean> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !PLACE_ID_PATTERN.test(placeId)) return false;

  const base = process.env.GOOGLE_PLACES_API_BASE || 'https://places.googleapis.com';
  try {
    const response = await fetch(`${base}/v1/places/${placeId}`, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'id,businessStatus' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 200) {
      const place = (await response.json()) as { id?: string; businessStatus?: string };
      return place.id === placeId && place.businessStatus !== 'CLOSED_PERMANENTLY';
    }
    // 400/404 = Google บอกว่า id นี้ไม่มี (ปกติของ id ปลอม) · อย่างอื่น = ตรวจไม่ได้ ให้ผู้ดูแลเห็นใน log
    if (response.status !== 400 && response.status !== 404) {
      console.warn(`Google Places verify failed: HTTP ${response.status}`);
    }
  } catch (error) {
    console.warn('Google Places verify failed:', error instanceof Error ? error.message : error);
  }
  return false;
}
