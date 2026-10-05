import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Read .env file for environment variables like database credentials, etc.
dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });

import { APP_URL, SERVER_URL } from './e2e/helpers/env';

// ⛔ E2E ต้องไม่ส่งอีเมลจริงเด็ดขาด — backend/.env ในเครื่องนี้ชี้ไป Gmail จริง
// worker ของ Playwright สืบทอด env จากโปรเซสที่โหลด config นี้ ดังนั้น spec ที่ import โมดูล backend ตรง ๆ
// (เช่น utils/email.ts ที่เลือก dry-run/SMTP จริงครั้งเดียวตอน import) จะไม่แตะ SMTP จริง
// ตั้งหลัง dotenv.config เพื่อทับค่าใน .env (dotenv ไม่ทับค่าที่ตั้งไว้แล้ว แต่ต้องการให้ชนะเสมอ)
process.env.MAIL_DRY_RUN = 'true';

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
  /* Opt out of parallel tests on local due to database resource sharing. */
  workers: 1,
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
  webServer: [
    {
      command: 'npm.cmd --prefix backend run dev',
      url: `${SERVER_URL}/api/master-data`,
      // E2E ต้องไม่ส่งอีเมลจริงเด็ดขาด — backend/.env ในเครื่องนี้ชี้ไป Gmail จริง
      env: { MAIL_DRY_RUN: 'true' },
      // ⛔ ห้ามเปลี่ยนเป็น true — `env` ข้างบนมีผลเฉพาะ backend ที่ Playwright เปิดเอง
      //    ถ้า reuse ตัวที่เปิดค้างไว้ (เช่น `npm run dev` ธรรมดา) เทสต์จะยิงใส่ backend ที่ต่อ Gmail จริง
      //    เกิดมาแล้ว 2026-10-05 · มี backend ค้างที่พอร์ต 5000 = ให้ Playwright หยุดด้วย error แทน
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
    {
      command: 'npm.cmd --prefix frontend run dev',
      url: APP_URL,
      reuseExistingServer: true,
      timeout: 120 * 1000,
    },
  ],
});
