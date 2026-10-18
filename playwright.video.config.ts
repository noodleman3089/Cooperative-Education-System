import { defineConfig, devices } from '@playwright/test';
// ใช้ของ config หลักซ้ำ (dotenv · MAIL_DRY_RUN=true · webServer) เหมือน walkthrough — ห้ามตั้ง webServer ซ้ำที่นี่
import base from './playwright.config';

/**
 * วิดีโอเส้นทางสหกิจต้นสายถึงปลายสาย (`e2e/walkthrough/video-*.spec.ts`) — ไม่ใช่เทสต์ในชุดเต็ม
 * รัน: `npm.cmd run test:video` · ผลลัพธ์ `เอกสาร/walkthrough/full-journey-video/*.webm`
 * รีเซ็ตฐานเหมือน E2E ห้ามรันซ้อนกับ E2E · เซิร์ฟเวอร์ชุดเดียว (worker 0) จึงตั้ง `E2E_WORKERS=1` ให้เอง
 */
process.env.E2E_WORKERS ??= '1';

export default defineConfig(base, {
  testDir: './e2e/walkthrough',
  testIgnore: [],
  testMatch: '**/video-*.spec.ts',
  timeout: 30 * 60 * 1000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: 'e2e/test-results-video',
  use: {
    trace: 'off',
    screenshot: 'off',
    // ⛔ ต้องมีเพดานเวลา — ไม่ตั้งแล้วคลิกที่หาไม่เจอแขวนจนหมดเวลาทั้งเคส (รอบแรกค้าง 1 ชั่วโมง)
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    video: { mode: 'on', size: { width: 1366, height: 900 } },
    // หน่วงทุกการกระทำเล็กน้อยให้ผู้ชมตามทัน
    // หน่วงเล็กน้อยทุกการกระทำ — คำบรรยายและการพิมพ์ทีละตัวอักษรอยู่ในสเปคเอง
    launchOptions: { slowMo: 100 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
});
