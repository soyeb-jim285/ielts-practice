import { defineConfig, devices } from '@playwright/test';

// Expects the API on :8787 (pnpm -F @ielts/server dev); starts the web dev server itself.
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'pnpm dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
