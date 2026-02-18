import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test-suites',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['html', { outputFolder: './report', open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'off', // we handle screenshots manually
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
