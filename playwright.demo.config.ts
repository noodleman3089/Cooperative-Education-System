import { defineConfig, devices } from '@playwright/test';
// ⛔ import config หลักเพื่อ **ใช้ของเดิมซ้ำ** — dotenv · `MAIL_DRY_RUN = 'true'` (SEC-17) · webServer
// เหตุผลเดียวกับ playwright.walkthrough.config.ts · อย่าตั้ง webServer ซ้ำที่นี่
import base from './playwright.config';

/**
 * demo: รันเทสต์แบบเห็นเบราว์เซอร์ เดินช้าลง และอัดวิดีโอ **ทุกเคส** (config หลักเก็บเฉพาะเคสที่ตก)
 * ใช้อัดคลิปประกอบผลงาน · ผลลัพธ์ลง `เอกสาร/portfolio/` (อยู่นอก git)
 * รัน: `npx.cmd playwright test -c playwright.demo.config.ts <ไฟล์>` — ระบุไฟล์เสมอ อย่ารันทั้งชุด
 * · รีเซ็ตฐานเหมือน E2E (seedTestData) ห้ามรันซ้อนกับ E2E
 */
export default defineConfig(base, {
  // slowMo ทำให้เคสยาวเกิน 90 วิของ config หลัก
  timeout: 300 * 1000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'เอกสาร/portfolio/demo-report', open: 'never' }]],
  outputDir: 'เอกสาร/portfolio/demo-results',
  use: {
    headless: false,
    launchOptions: { slowMo: 400 },
    trace: 'off',
    screenshot: 'off',
    video: { mode: 'on', size: { width: 1280, height: 720 } },
  },
  // project.use ทับ use ระดับบนสุด → ต้องตั้ง viewport ที่นี่
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
});
