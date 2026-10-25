import { test, expect, type Page } from '@playwright/test';

const TEST_DIRECTOR_EMAIL = process.env.TEST_DIRECTOR_EMAIL!;
const TEST_DIRECTOR_PASSWORD = process.env.TEST_DIRECTOR_PASSWORD!;
const TEST_MASTER_EMAIL = process.env.TEST_MASTER_EMAIL!;
const TEST_MASTER_PASSWORD = process.env.TEST_MASTER_PASSWORD!;
const TEST_OWNER_EMAIL = process.env.TEST_OWNER_EMAIL!;
const TEST_OWNER_PASSWORD = process.env.TEST_OWNER_PASSWORD!;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Wait for navigation to complete
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 10000 });
}

async function goToConductActions(page: Page) {
  await page.goto('/conduct-actions');
  await page.waitForLoadState('networkidle');
}

test.describe('Conduct Actions - Bug Reproduction', () => {
  test.describe('As School Director', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, TEST_DIRECTOR_EMAIL, TEST_DIRECTOR_PASSWORD);
      await goToConductActions(page);
    });

    test('BUG A: parent notification checkbox should be tickable', async ({ page }) => {
      // Wait for the form to load
      await expect(page.locator('h2:has-text("New conduct entry")')).toBeVisible();

      // Find the checkbox - it's for "Notify parent via SMS"
      const checkbox = page.locator('input[type="checkbox"]').first();

      // Log initial state
      const initialChecked = await checkbox.isChecked();
      console.log('Initial checkbox state:', initialChecked);

      // Try to uncheck it if checked, or check it if unchecked
      if (initialChecked) {
        await checkbox.click();
        await page.waitForTimeout(500); // Give time for state update
        const afterClick = await checkbox.isChecked();
        console.log('After clicking (should be unchecked):', afterClick);
        expect(afterClick).toBe(false);

        // Click again to re-check
        await checkbox.click();
        await page.waitForTimeout(500);
        const afterSecondClick = await checkbox.isChecked();
        console.log('After second click (should be checked):', afterSecondClick);
        expect(afterSecondClick).toBe(true);
      } else {
        await checkbox.click();
        await page.waitForTimeout(500);
        const afterClick = await checkbox.isChecked();
        console.log('After clicking (should be checked):', afterClick);
        expect(afterClick).toBe(true);
      }
    });

    test('BUG B: whole level deduction should work', async ({ page }) => {
      // Click on "Whole level" mode
      await page.click('button:has-text("Whole level")');
      await page.waitForTimeout(500);

      // Select a class level (e.g., P1, S1, etc.)
      const levelSelect = page.locator('select').filter({ hasText: 'Choose level' }).or(page.locator('select').first());
      await levelSelect.selectOption({ index: 1 }); // Select first available level
      await page.waitForTimeout(500);

      // Select an offense
      const offenseSelect = page.locator('select').filter({ hasText: 'Select an offense' }).or(page.locator('select').nth(1));
      await offenseSelect.selectOption({ index: 1 }); // Select first offense
      await page.waitForTimeout(500);

      // Check if submit button is enabled
      const submitButton = page.locator('button[type="submit"]:has-text("Record conduct entry")');
      const isDisabled = await submitButton.isDisabled();
      console.log('Submit button disabled state for whole level:', isDisabled);

      if (!isDisabled) {
        // Try to submit
        await submitButton.click();

        // Should see confirmation dialog
        await expect(page.locator('text=Confirm Whole Level Entry')).toBeVisible({ timeout: 5000 });

        // Click confirm
        await page.click('button:has-text("Confirm and submit")');

        // Wait for success message
        await expect(page.locator('text=Recorded for')).toBeVisible({ timeout: 10000 });
      } else {
        console.error('Submit button is disabled - cannot proceed with test');
        // Take screenshot for debugging
        await page.screenshot({ path: 'whole-level-disabled.png', fullPage: true });
        throw new Error('Submit button is disabled for whole level entry');
      }
    });

    test('BUG B: whole school deduction should work', async ({ page }) => {
      // Click on "Whole school" mode
      const wholeSchoolButton = page.locator('button:has-text("Whole school")');
      if (await wholeSchoolButton.count() === 0) {
        console.log('Whole school option not available (requires school_wide_entries permission)');
        test.skip();
        return;
      }

      await wholeSchoolButton.click();
      await page.waitForTimeout(500);

      // Should see whole school summary
      await expect(page.locator('text=Whole school selected')).toBeVisible();

      // Select an offense
      const offenseSelect = page.locator('select').filter({ hasText: 'Select an offense' }).or(page.locator('select').first());
      await offenseSelect.selectOption({ index: 1 }); // Select first offense
      await page.waitForTimeout(500);

      // Check if submit button is enabled
      const submitButton = page.locator('button[type="submit"]:has-text("Record conduct entry")');
      const isDisabled = await submitButton.isDisabled();
      console.log('Submit button disabled state for whole school:', isDisabled);

      if (!isDisabled) {
        // Try to submit
        await submitButton.click();

        // Should see confirmation dialog
        await expect(page.locator('text=Confirm Whole School Entry')).toBeVisible({ timeout: 5000 });

        // Click confirm
        await page.click('button:has-text("Confirm and submit")');

        // Wait for success message
        await expect(page.locator('text=Recorded for')).toBeVisible({ timeout: 10000 });
      } else {
        console.error('Submit button is disabled - cannot proceed with test');
        // Take screenshot for debugging
        await page.screenshot({ path: 'whole-school-disabled.png', fullPage: true });
        throw new Error('Submit button is disabled for whole school entry');
      }
    });
  });

  test.describe('As Master of Discipline', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, TEST_MASTER_EMAIL, TEST_MASTER_PASSWORD);
      await goToConductActions(page);
    });

    test('BUG A: parent notification checkbox should be tickable', async ({ page }) => {
      // Wait for the form to load
      await expect(page.locator('h2:has-text("New conduct entry")')).toBeVisible();

      // Find the checkbox
      const checkbox = page.locator('input[type="checkbox"]').first();

      // Log initial state
      const initialChecked = await checkbox.isChecked();
      console.log('Initial checkbox state (Master):', initialChecked);

      // Try to toggle it
      await checkbox.click();
      await page.waitForTimeout(500);
      const afterClick = await checkbox.isChecked();
      console.log('After clicking (Master):', afterClick);
      expect(afterClick).not.toBe(initialChecked);
    });

    test('BUG B: whole level deduction should work', async ({ page }) => {
      // Similar test as Director
      await page.click('button:has-text("Whole level")');
      await page.waitForTimeout(500);

      const levelSelect = page.locator('select').first();
      await levelSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);

      const offenseSelect = page.locator('select').nth(1);
      await offenseSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);

      const submitButton = page.locator('button[type="submit"]:has-text("Record conduct entry")');
      const isDisabled = await submitButton.isDisabled();

      if (!isDisabled) {
        await submitButton.click();
        await expect(page.locator('text=Confirm Whole Level Entry')).toBeVisible({ timeout: 5000 });
        await page.click('button:has-text("Confirm and submit")');
        await expect(page.locator('text=Recorded for')).toBeVisible({ timeout: 10000 });
      } else {
        await page.screenshot({ path: 'whole-level-disabled-master.png', fullPage: true });
        throw new Error('Submit button is disabled for whole level entry (Master)');
      }
    });
  });

  test.describe('Single student operations should still work', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, TEST_DIRECTOR_EMAIL, TEST_DIRECTOR_PASSWORD);
      await goToConductActions(page);
    });

    test('Single student deduction', async ({ page }) => {
      // Make sure we're in "One student" mode
      await page.click('button:has-text("One student")');
      await page.waitForTimeout(500);

      // Search for a student
      const studentInput = page.locator('input[placeholder*="Search"]').first();
      await studentInput.click();
      await page.waitForTimeout(500);

      // Click on first student in the dropdown
      const firstStudent = page.locator('[role="button"]:has-text("·")').first();
      if (await firstStudent.count() > 0) {
        await firstStudent.click();
        await page.waitForTimeout(500);

        // Select offense
        const offenseSelect = page.locator('select').nth(1);
        await offenseSelect.selectOption({ index: 1 });

        // Submit
        const submitButton = page.locator('button[type="submit"]:has-text("Record conduct entry")');
        await submitButton.click();

        await expect(page.locator('text=Conduct log recorded successfully')).toBeVisible({ timeout: 10000 });
      }
    });

    test('Single student restoration', async ({ page }) => {
      await page.click('button:has-text("One student")');
      await page.waitForTimeout(500);

      const studentInput = page.locator('input[placeholder*="Search"]').first();
      await studentInput.click();
      await page.waitForTimeout(500);

      const firstStudent = page.locator('[role="button"]:has-text("·")').first();
      if (await firstStudent.count() > 0) {
        await firstStudent.click();
        await page.waitForTimeout(500);

        // Select "Restoration"
        await page.click('button:has-text("Restoration")');
        await page.waitForTimeout(500);

        // Enter marks
        const marksInput = page.locator('input[type="number"]').first();
        await marksInput.fill('5');

        const submitButton = page.locator('button[type="submit"]:has-text("Record conduct entry")');
        await submitButton.click();

        await expect(page.locator('text=Conduct log recorded successfully')).toBeVisible({ timeout: 10000 });
      }
    });

    test('Single student good deed', async ({ page }) => {
      await page.click('button:has-text("One student")');
      await page.waitForTimeout(500);

      const studentInput = page.locator('input[placeholder*="Search"]').first();
      await studentInput.click();
      await page.waitForTimeout(500);

      const firstStudent = page.locator('[role="button"]:has-text("·")').first();
      if (await firstStudent.count() > 0) {
        await firstStudent.click();
        await page.waitForTimeout(500);

        // Check if good deed button exists
        const goodDeedButton = page.locator('button:has-text("Good deed")');
        if (await goodDeedButton.count() > 0) {
          await goodDeedButton.click();
          await page.waitForTimeout(500);

          // Select a good deed category
          const categorySelect = page.locator('select').first();
          await categorySelect.selectOption({ index: 1 });

          const submitButton = page.locator('button[type="submit"]:has-text("Record conduct entry")');
          await submitButton.click();

          await expect(page.locator('text=Conduct log recorded successfully')).toBeVisible({ timeout: 10000 });
        }
      }
    });
  });

  test.describe('BUG C: Platform owner school links', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, TEST_OWNER_EMAIL, TEST_OWNER_PASSWORD);
    });

    test('Clicking school name in /platform should open school detail page', async ({ page }) => {
      // Go to platform page
      await page.goto('/platform');
      await page.waitForLoadState('networkidle');

      // Ensure we're on the Schools tab
      await expect(page.locator('h3, h2').filter({ hasText: 'Platform Admin' })).toBeVisible();

      // Find the first school name link
      const firstSchoolLink = page.locator('table tbody tr a').first();

      if (await firstSchoolLink.count() > 0) {
        const schoolName = await firstSchoolLink.textContent();
        console.log('Clicking on school:', schoolName);

        // Click the link
        await firstSchoolLink.click();

        // Wait for navigation
        await page.waitForURL((url) => url.pathname.includes('/platform/schools/'), { timeout: 10000 });

        // Should be on the school detail page
        expect(page.url()).toContain('/platform/schools/');

        // CRITICAL: Assert the school DETAIL CONTENT is visible, not just the URL
        // The school name should appear as the page heading (greeting in DashboardShell)
        await expect(page.locator('h1, h2').filter({ hasText: schoolName?.trim() || '' })).toBeVisible({ timeout: 5000 });

        // All four tabs should be visible
        await expect(page.locator('[role="tab"]:has-text("Overview")')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[role="tab"]:has-text("Staff")')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[role="tab"]:has-text("Subscription & Payments")')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('[role="tab"]:has-text("Support")')).toBeVisible({ timeout: 5000 });

        console.log(`School detail page fully loaded with heading "${schoolName}" and all four tabs visible`);
      } else {
        console.log('No schools found in the table');
        test.skip();
      }
    });
  });
});
