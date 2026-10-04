import { defineConfig, devices } from '@playwright/test';
// ⛔ import config หลักเพื่อ **ใช้ของเดิมซ้ำ** — โหลด dotenv · ตั้ง `process.env.MAIL_DRY_RUN = 'true'`
// (SEC-17: backend/.env ชี้ Gmail จริง) · webServer (พอร์ต · command · `env: { MAIL_DRY_RUN: 'true' }`
// · reuseExistingServer) ไม่ต้องคัดลอกมาให้สองที่ค่าหลุดจากกัน · อย่าตั้ง webServer ซ้ำที่นี่
import base from './playwright.config';

/**
 * walkthrough: เดินโฟลว์จริงถ่ายภาพ → `เอกสาร/walkthrough/<flow>/index.html`
 * รัน: `npm.cmd run test:walkthrough` · รีเซ็ตฐานเหมือน E2E (seedTestData) ห้ามรันซ้อนกับ E2E
 */
export default defineConfig(base, {
  testDir: './e2e/walkthrough',
  // config หลักกัน walkthrough ไว้ — ที่นี่ต้องเปิดคืน ไม่งั้น testIgnore ตรงทุกไฟล์
  testIgnore: [],
  timeout: 300 * 1000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: 'e2e/test-results-walkthrough',
  use: {
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  // project.use ทับ use ระดับบนสุด → ต้องตั้ง viewport ที่นี่
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
});
