import { defineConfig, devices } from '@playwright/test';

// Load TEST_* accounts and Supabase keys from .env (Node's built-in loader; no dotenv dependency).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on variables already set in the environment.
}

// Override with E2E_PORT to test against a dev server on another port.
const port = Number(process.env.E2E_PORT ?? 8080);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 150 * 1000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: port === 8080 ? 'npm run dev' : `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
  },
});
