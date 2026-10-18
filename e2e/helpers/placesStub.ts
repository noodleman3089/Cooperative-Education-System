import http from 'http';
import { PLACES_STUB_PORT } from './env';

/**
 * Places API จำลอง — backend ของ worker นี้ถามที่นี่แทน Google (`GOOGLE_PLACES_API_BASE` ใน playwright.config.ts)
 * ใช้เมื่อเทสต์ต้องการให้ place id ใด "มีจริงใน Google" · ไม่เปิด stub = ทุก id ตรวจไม่ผ่าน (เหมือน Google ตอบไม่ได้)
 *
 *   const stub = await startPlacesStub({ 'place-ok': 'OPERATIONAL', 'place-closed': 'CLOSED_PERMANENTLY' });
 *   try { … } finally { await stub.close(); }
 *
 * ⛔ ต้อง `close()` ใน `finally` — พอร์ตเป็นของ worker นี้ เคสถัดไปในไฟล์/worker เดียวกันจะเปิดซ้ำไม่ได้
 * ⛔ backend ต้องมี `GOOGLE_MAPS_API_KEY` ใน env (ไม่ใช่ค่าว่าง) ถึงจะยิงมาที่ stub — คีย์จริงไม่ถูกส่งออกนอกเครื่องเพราะปลายทางคือ stub
 */
export async function startPlacesStub(
  places: Record<string, string>
): Promise<{ close: () => Promise<void>; requests: string[] }> {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error('backend/.env ไม่มี GOOGLE_MAPS_API_KEY — backend จะไม่ถาม stub และทุก place id จะตรวจไม่ผ่าน');
  }
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const placeId = decodeURIComponent((req.url ?? '').replace(/^\/v1\/places\//, '').split('?')[0]);
    requests.push(placeId);
    const status = places[placeId];
    res.setHeader('Content-Type', 'application/json');
    if (!status) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT' } }));
      return;
    }
    res.end(JSON.stringify({ id: placeId, businessStatus: status }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(PLACES_STUB_PORT, '127.0.0.1', () => resolve());
  });
  return { requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
