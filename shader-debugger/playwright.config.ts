import { defineConfig } from '@playwright/test';

/**
 * Smoke tests against the real app in your installed Chrome (no browser
 * download): the GPU paths, the controllers, and the tutor UI with the API
 * mocked (no model calls, no key needed).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
