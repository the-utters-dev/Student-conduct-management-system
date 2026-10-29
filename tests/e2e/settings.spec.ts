import { test, expect } from '@playwright/test';
import { signIn, trackErrors, expectNoErrorPage, hasAccount, type AccountKey } from './helpers';

const users: AccountKey[] = ['director', 'master', 'matron'];

for (const user of users) {
  test.describe(`Settings as ${user}`, () => {
    test.skip(!hasAccount(user), `TEST_${user.toUpperCase()}_EMAIL / _PASSWORD not set in .env`);

    test('opening /settings directly and every tab renders without crashing', async ({ page }) => {
      const errors = trackErrors(page);
      await signIn(page, user);

      // Typing the URL into a new tab = a full document load, not a client-side navigation.
      await page.goto('/settings');
      await expect(page.getByRole('tab', { name: 'Profile & Avatar' })).toBeVisible({ timeout: 30_000 });
      await expectNoErrorPage(page);

      const tabs = page.getByRole('tab');
      const names = (await tabs.allTextContents()).map((t) => t.trim());
      console.log(`${user} sees tabs:`, names.join(' | '));
      expect(names.length).toBeGreaterThanOrEqual(3);

      for (const name of names) {
        await page.getByRole('tab', { name, exact: true }).click();
        await expect(page.getByRole('tabpanel')).toBeVisible();
        // Give queries a moment to resolve so late render errors surface.
        await page.waitForTimeout(1500);
        await expectNoErrorPage(page);
      }

      if (names.includes('Certificates')) {
        await page.getByRole('tab', { name: 'Certificates', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Director Signature' })).toBeVisible();
        await expect(page.locator('canvas')).toBeVisible();
      }

      const crashes = errors.filter((e) => e.startsWith('pageerror'));
      expect(crashes, crashes.join('\n')).toEqual([]);
    });
  });
}

test.describe('Certificate pages linked from Settings', () => {
  test.skip(!hasAccount('director'), 'TEST_DIRECTOR_* not set');

  test('Templates & Register and Bulk Certificates open', async ({ page }) => {
    const errors = trackErrors(page);
    await signIn(page, 'director');
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Certificates', exact: true }).click();

    await page.getByRole('link', { name: /Templates & Register/ }).click();
    await page.waitForURL('**/settings/certificates');
    await expectNoErrorPage(page);
    await expect(page.getByText('Page not found')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Profile & Avatar' })).toHaveCount(0);

    await page.goto('/certificates/bulk');
    await expectNoErrorPage(page);
    await expect(page.getByText('Page not found')).toHaveCount(0);

    const crashes = errors.filter((e) => e.startsWith('pageerror'));
    expect(crashes, crashes.join('\n')).toEqual([]);
  });
});
