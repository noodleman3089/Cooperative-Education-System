import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Read .env file for environment variables like database credentials, etc.
dotenv.config({ path: path.resolve(__dirname, 'backend/.env') });

import { APP_URL, SERVER_URL } from './e2e/helpers/env';

export default defineConfig({
  testDir: './e2e',
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
      reuseExistingServer: true,
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
