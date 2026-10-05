import { googleMaps } from '../types/googleMaps';

/**
 * โหลดสคริปต์ Google Maps เข้าหน้าเว็บครั้งเดียว แล้วบอกผู้เรียกว่าพร้อมหรือล้ม
 *
 * ย้ายออกมาจากบอร์ดงานเดิม (ถูกลบ 2026-10-05) เมื่อ 2026-09-03 ตอนที่หน้าแจ้งที่พัก (สหกิจ 06)
 * ต้องใช้แผนที่เป็นที่ที่สอง — ถ้าปล่อยให้ต่างคนต่างแปะ `<script>` เอง หน้าที่เปิด
 * ทีหลังจะยิงโหลดซ้ำและ `window.google` ถูกเขียนทับกลางคัน
 *
 * ⛔ **ทุกหน้าที่ใช้แผนที่ต้องเดินได้เมื่อสคริปต์นี้โหลดไม่สำเร็จ** — API key หมดโควตา
 * หรือเน็ตองค์กรบล็อก googleapis.com เกิดขึ้นได้จริง และแผนที่เป็นตัวช่วย ไม่ใช่
 * เงื่อนไขของการกรอกฟอร์ม (`e2e/google-maps.spec.ts` บล็อกโดเมนนี้เพื่อตรวจข้อนี้)
 */
export function loadGoogleMapsScript(
  apiKey: string,
  onLoad: () => void,
  onError: () => void
): void {
  if (!apiKey) {
    onError();
    return;
  }
  if (googleMaps()) {
    onLoad();
    return;
  }
  const existingScript = document.getElementById('google-maps-script');
  if (existingScript) {
    existingScript.addEventListener('load', () => onLoad());
    existingScript.addEventListener('error', () => onError());
    return;
  }
  const script = document.createElement('script');
  script.id = 'google-maps-script';
  script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=th`;
  script.async = true;
  script.defer = true;
  script.onload = () => onLoad();
  script.onerror = () => onError();
  document.body.appendChild(script);
}
