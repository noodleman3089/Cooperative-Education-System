import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Read .env file for environment variables like database credentials, etc.
dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });

import fs from 'fs';
import { APP_URL, BACKEND_START_COMMAND, WORKER_COUNT, workerSlot } from './e2e/helpers/env';

// ⛔ E2E ต้องไม่ส่งอีเมลจริงเด็ดขาด — backend/.env ในเครื่องนี้ชี้ไป Gmail จริง
// worker ของ Playwright สืบทอด env จากโปรเซสที่โหลด config นี้ ดังนั้น spec ที่ import โมดูล backend ตรง ๆ
// (เช่น utils/email.ts ที่เลือก dry-run/SMTP จริงครั้งเดียวตอน import) จะไม่แตะ SMTP จริง
// ตั้งหลัง dotenv.config เพื่อทับค่าใน .env (dotenv ไม่ทับค่าที่ตั้งไว้แล้ว แต่ต้องการให้ชนะเสมอ)
process.env.MAIL_DRY_RUN = 'true';

// ── หลาย worker: แต่ละตัวมีฐานข้อมูล · backend · frontend · โฟลเดอร์ไฟล์ของตัวเอง (ตารางอยู่ที่ e2e/helpers/env.ts) ──
const slots = Array.from({ length: WORKER_COUNT }, (_, index) => workerSlot(index));

// ชื่อฐานของ worker 0 คือฐาน dev เดิม · ตัวถัดไปต่อท้าย _e2e_w<เลข> (seedTestData สร้างให้เองครั้งแรก)
// เก็บชื่อฐานตั้งต้นไว้ใน env เพราะข้างล่างเขียนทับ DB_DATABASE ของโปรเซส worker
process.env.E2E_BASE_DB ??= process.env.DB_DATABASE || 'coop_edu_db';
const databaseOf = (index: number) =>
  index === 0 ? process.env.E2E_BASE_DB! : `${process.env.E2E_BASE_DB}_e2e_w${index}`;

if (process.env.TEST_PARALLEL_INDEX !== undefined) {
  // โปรเซสของ worker — config นี้ถูกโหลดก่อนไฟล์เทสต์ทุกไฟล์ ดังนั้น helper ที่ import pool ของ backend
  // (e2e/helpers/db.ts · test-seeder.ts) จะต่อฐานของ worker ตัวเอง ไม่ใช่ฐานของ worker อื่น
  const me = workerSlot(parseInt(process.env.TEST_PARALLEL_INDEX, 10));
  process.env.DB_DATABASE = databaseOf(me.index);
  process.env.FRONTEND_URL = me.appUrl;
} else {
  // โปรเซสหลัก (ก่อนเปิดเซิร์ฟเวอร์) — เตรียมโฟลเดอร์ของ worker 1 ขึ้นไป: ของที่ backend อ่านจาก cwd
  // (ฟอนต์ · ตรา · แม่แบบ · ลายเซ็นคณบดีจำลอง) คัดลอกจาก backend/ ทับทุกรอบ ให้ตรงกับของจริงเสมอ
  const source = path.join(workerSlot(0).backendRoot, 'secure_private');
  for (const slot of slots.slice(1)) {
    for (const dir of ['fonts', 'emblems', 'templates', 'signatures']) {
      const from = path.join(source, dir);
      const to = path.join(slot.backendRoot, 'secure_private', dir);
      fs.mkdirSync(to, { recursive: true });
      if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, force: true });
    }
  }
}

export default defineConfig({
  testDir: './e2e',
  // walkthrough (เดินโฟลว์ถ่ายภาพ) ไม่ใช่เทสต์ — รันแยกด้วย playwright.walkthrough.config.ts
  testIgnore: '**/walkthrough/**',
  /* Maximum time one test can run for. */
  timeout: 90 * 1000,
  expect: {
    timeout: 10 * 1000,
  },
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* One local retry: a retried test is still reported as flaky, so the signal
     survives, but a single environmental hiccup no longer costs a 6-minute rerun. */
  retries: process.env.CI ? 2 : 1,
  /* ไฟล์เทสต์กระจายไปตาม worker · เคสในไฟล์เดียวกันยังรันเรียงตามลำดับใน worker เดียว (fullyParallel: false)
     ⛔ ห้ามตั้งเกิน WORKER_COUNT — worker ที่ไม่มีเซิร์ฟเวอร์/ฐานของตัวเองจะไปชนของตัวอื่น */
  workers: WORKER_COUNT,
  /* Reporter to use. See https://playwright.dev/docs/reporters */
  reporter: [['html', { outputFolder: 'e2e/playwright-report' }]],
  outputDir: 'e2e/test-results',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: APP_URL,
    /* Artifacts for failures only. Recording a trace and a video of all 62
       passing tests cost ~100MB per run and slowed every one of them down. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run local dev servers before starting the tests */
  webServer: slots.flatMap((slot) => [
    {
      command: BACKEND_START_COMMAND,
      cwd: slot.backendRoot,
      // /health ไม่แตะฐานข้อมูล — ฐานของ worker ใหม่ยังไม่มีจนกว่า seedTestData ครั้งแรกจะสร้าง
      url: `${slot.serverUrl}/health`,
      env: {
        // E2E ต้องไม่ส่งอีเมลจริงเด็ดขาด — backend/.env ในเครื่องนี้ชี้ไป Gmail จริง
        MAIL_DRY_RUN: 'true',
        PORT: String(slot.backendPort),
        DB_DATABASE: databaseOf(slot.index),
        FRONTEND_URL: slot.appUrl,
      },
      // ⛔ ห้ามเปลี่ยนเป็น true — `env` ข้างบนมีผลเฉพาะ backend ที่ Playwright เปิดเอง
      //    ถ้า reuse ตัวที่เปิดค้างไว้ (เช่น `npm run dev` ธรรมดา) เทสต์จะยิงใส่ backend ที่ต่อ Gmail จริง
      //    เกิดมาแล้ว 2026-10-05 · มี backend ค้างที่พอร์ต 5000 = ให้ Playwright หยุดด้วย error แทน
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
    {
      command: `npm.cmd --prefix frontend run dev -- --port ${slot.appPort} --strictPort`,
      url: slot.appUrl,
      // vite.config.ts อ่านสองค่านี้: ส่ง /api ไป backend ของ worker เดียวกัน · แคช pre-bundle แยกกัน
      // (vite หลายตัวเขียนแคชโฟลเดอร์เดียวกันพร้อมกันไม่ได้) · worker 0 ไม่ตั้ง = ค่าเดิมของ dev
      // VITE_SHOW_ALL_MENUS: แถบเมนูพักบางรายการไว้ชั่วคราว (`PARKED_MENUS` ใน Sidebar.tsx) — ชุดเทสต์ต้องเห็นครบ
      env:
        slot.index === 0
          ? { VITE_SHOW_ALL_MENUS: 'true' }
          : {
              VITE_SHOW_ALL_MENUS: 'true',
              E2E_API_TARGET: slot.serverUrl,
              E2E_VITE_CACHE_DIR: `node_modules/.vite-e2e-w${slot.index}`,
            },
      // ตัวที่ 0 คือ dev server ปกติ ใช้ตัวที่เปิดค้างได้ · ตัวอื่นต้องเปิดเองเพราะต้องได้ env ข้างบน
      reuseExistingServer: slot.index === 0,
      timeout: 120 * 1000,
    },
  ]),
});
