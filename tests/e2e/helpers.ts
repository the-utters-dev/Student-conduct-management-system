import { expect, type Page } from '@playwright/test';

export const accounts = {
  owner: { email: process.env.TEST_OWNER_EMAIL ?? '', password: process.env.TEST_OWNER_PASSWORD ?? '' },
  director: { email: process.env.TEST_DIRECTOR_EMAIL ?? '', password: process.env.TEST_DIRECTOR_PASSWORD ?? '' },
  master: { email: process.env.TEST_MASTER_EMAIL ?? '', password: process.env.TEST_MASTER_PASSWORD ?? '' },
  matron: { email: process.env.TEST_MATRON_EMAIL ?? '', password: process.env.TEST_MATRON_PASSWORD ?? '' },
};

export type AccountKey = keyof typeof accounts;

export function hasAccount(key: AccountKey) {
  return Boolean(accounts[key].email && accounts[key].password);
}

/** Signs in through the real /auth form and waits for the dashboard. */
export async function signIn(page: Page, key: AccountKey) {
  const { email, password } = accounts[key];
  await page.goto('/auth', { timeout: 60_000 });
  // The first page of a run can be slow while the browser and server warm up.
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 60_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 30_000 });
  // The dashboard shell renders once identity has loaded.
  await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeAttached({ timeout: 30_000 });
}

/** Collects uncaught page errors and console errors so a test can assert on them. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

export async function expectNoErrorPage(page: Page) {
  await expect(page.getByText("This page didn't load")).toHaveCount(0);
}
