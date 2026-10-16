import { defineConfig } from '@playwright/test';

const release = process.env.B03_TEST_BUILD === '1';
const baseURL = `http://127.0.0.1:${release ? 4174 : 4173}/b03/`;

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: release ? 'PORT=4174 npm run preview' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !release,
    timeout: 15_000,
  },
});
