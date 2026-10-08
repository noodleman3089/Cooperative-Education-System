import path from 'path';

/**
 * Where the suite points. These were spelled out as literals in 47 places
 * across the specs, so moving the ports — or pointing the suite at a staging
 * deployment — meant a find-and-replace that was easy to get half right.
 *
 * 2026-10-08: ชุดเทสต์รันหลาย worker พร้อมกัน — **แต่ละ worker มีของตัวเองครบชุด**
 * (ฐานข้อมูล · backend · frontend · โฟลเดอร์ไฟล์) จึงไม่มีอะไรชนกันข้าม worker
 * · worker 0 ใช้ของเดิมทั้งหมด: ฐาน dev · พอร์ต 5000/5173 · โฟลเดอร์ `backend/`
 * · worker ถัดไปบวกเลขตามลำดับ: 5001/5174 · 5002/5175 · …
 * `playwright.config.ts` เป็นคนเปิดเซิร์ฟเวอร์และตั้งชื่อฐานตามตารางนี้
 */
const REPO_ROOT = path.resolve(__dirname, '../..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');

/** จำนวน worker (และจำนวนชุดเซิร์ฟเวอร์ที่เปิด) · `E2E_WORKERS=1` = รันแบบเดิมทุกอย่าง */
export const WORKER_COUNT = Math.max(1, parseInt(process.env.E2E_WORKERS || '4', 10) || 1);

export function workerSlot(index: number) {
  const backendPort = 5000 + index;
  const appPort = 5173 + index;
  return {
    index,
    backendPort,
    appPort,
    serverUrl: `http://localhost:${backendPort}`,
    appUrl: `http://localhost:${appPort}`,
    /**
     * cwd ของ backend ตัวนี้ — `uploads/` และ `secure_private/` ของมันอยู่ใต้โฟลเดอร์นี้
     * ต้องแยกกัน เพราะชื่อไฟล์ผูกกับเลข id และทุกฐานเริ่มนับ id จาก 1 เหมือนกัน
     */
    backendRoot: index === 0 ? BACKEND_DIR : path.join(REPO_ROOT, 'e2e', '.workers', `w${index}`),
    /** พอร์ตของ backend ตัวที่ spec เปิดเอง (rate-limit · company-mail) */
    childServerPort: 5090 + index,
  };
}

// Playwright ตั้ง TEST_PARALLEL_INDEX ให้โปรเซสของ worker (0 … จำนวน worker − 1 · worker ที่ถูกเปิดใหม่
// หลังเคสแดงได้เลขเดิม) · โปรเซสหลักที่อ่าน config ไม่มีค่านี้ = ใช้ช่อง 0
const self = workerSlot(parseInt(process.env.TEST_PARALLEL_INDEX || '0', 10));

export const API_URL = process.env.E2E_API_URL || `${self.serverUrl}/api`;
export const APP_URL = process.env.E2E_APP_URL || self.appUrl;

/** The backend origin, for the handful of routes that sit outside /api. */
export const SERVER_URL = API_URL.replace(/\/api$/, '');

/**
 * โฟลเดอร์ที่ backend ของ worker นี้เขียนและอ่านไฟล์ — ใช้ตรวจไฟล์บนดิสก์:
 * `path.join(BACKEND_ROOT, 'uploads', …)` · `path.join(BACKEND_ROOT, 'secure_private', …)`
 * ⛔ อย่าเขียน `'../../backend/uploads'` ตรง ๆ — นั่นคือโฟลเดอร์ของ worker 0 เท่านั้น
 * (ซอร์สโค้ด เช่น `backend/src/db/migrations/` ยังอ้าง `../../backend` ได้ตามเดิม)
 */
export const BACKEND_ROOT = self.backendRoot;

/** พอร์ตสำหรับ backend ตัวที่ spec เปิดเองชั่วคราว — ไม่ชนกันข้าม worker */
export const CHILD_SERVER_PORT = self.childServerPort;

/**
 * คำสั่งเปิด backend จาก cwd ไหนก็ได้ (ต้องใส่ `cwd: BACKEND_ROOT` เอง)
 * ไม่ผ่าน nodemon: เซิร์ฟเวอร์ของเทสต์ไม่ควรรีสตาร์ทเองเมื่อมีคนแก้ไฟล์ระหว่างรัน
 */
export const BACKEND_START_COMMAND =
  `node "${path.join(BACKEND_DIR, 'node_modules', 'ts-node', 'dist', 'bin.js')}" "${path.join(BACKEND_DIR, 'src', 'index.ts')}"`;
