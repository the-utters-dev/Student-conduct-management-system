import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { accounts, hasAccount, signIn, trackErrors, expectNoErrorPage, type AccountKey } from './helpers';

// These tests record real entries in the connected database. Every bulk deduction of 1 mark
// is followed by a bulk restoration of 1 mark, so balances end where they started.
const REASON = 'Automated e2e check (reversed immediately)';

/** A Supabase client signed in as the same test user, to read balances independently of the UI. */
async function dbAs(key: AccountKey): Promise<SupabaseClient> {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword(accounts[key]);
  if (error) throw error;
  return client;
}

/** Sum of current marks for the user's school, optionally one class level. */
async function totalMarks(db: SupabaseClient, level?: string) {
  let q = db.from('student_conduct_balances').select('student_id, class_name, current_marks');
  if (level) q = q.like('class_name', `${level}%`);
  const { data, error } = await q;
  if (error) throw error;
  return { total: (data ?? []).reduce((s, r) => s + (r.current_marks ?? 0), 0), count: data?.length ?? 0 };
}

const field = (page: Page, label: string, tag: 'select' | 'input') =>
  page.locator(`label:text-is("${label}") + ${tag}`);

async function openConductActions(page: Page, key: AccountKey) {
  await signIn(page, key);
  await page.goto('/conduct-actions');
  await expect(page.getByRole('heading', { name: 'New conduct entry' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Recording against /)).toBeVisible({ timeout: 30_000 });
}

/** Picks the first offence, then forces the marks to 1 (the offence fills in its own default). */
async function chooseOffenceAndOneMark(page: Page, entry: 'Deduction' | 'Restoration') {
  await page.getByRole('button', { name: new RegExp(`^${entry}`) }).click();
  if (entry === 'Deduction') {
    const offence = field(page, 'Offense / reason code', 'select');
    const firstOffence = await offence.locator('option').nth(1).getAttribute('value');
    expect(firstOffence, 'The school has no active offences in its catalogue').toBeTruthy();
    await offence.selectOption(firstOffence!);
  }
  await field(page, entry === 'Deduction' ? 'Marks to deduct' : 'Marks to restore', 'input').fill('1');
  await page.locator('label:text-is("Incident details") + textarea').fill(REASON);
  // Never queue real parent messages from a test run.
  const notify = page.locator('label:has-text("Notify parent via SMS") input[type="checkbox"]');
  if ((await notify.count()) && (await notify.isChecked())) await notify.uncheck();
}

async function submitBulk(page: Page, title: 'Whole Level' | 'Whole School') {
  const submit = page.getByRole('button', { name: 'Record conduct entry' });
  await expect(submit).toBeEnabled();
  await submit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(`Confirm ${title} Entry`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm and submit' }).click();
  await expect(page.getByText(/^Recorded for \d+ students/)).toBeVisible({ timeout: 30_000 });
}

/** Chooses the first class level that has students; returns it. */
async function chooseLevelWithStudents(page: Page) {
  const select = field(page, 'Class level', 'select');
  const levels = (await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)))
    .filter(Boolean);
  for (const level of levels) {
    await select.selectOption(level);
    if (await page.getByText(new RegExp(`^\\d+ students? in ${level}$`)).isVisible()) return level;
  }
  throw new Error(`No class level with students (levels offered: ${levels.join(', ')})`);
}

for (const user of ['director', 'master'] as const) {
  test.describe(`Conduct actions as ${user}`, () => {
    test.skip(!hasAccount(user), `TEST_${user.toUpperCase()}_* not set in .env`);

    test('"Notify parent" checkbox toggles on and off', async ({ page }) => {
      const errors = trackErrors(page);
      await openConductActions(page, user);
      const checkbox = page.locator('label:has-text("Notify parent via SMS") input[type="checkbox"]');
      await expect(checkbox, 'Checkbox hidden: this role lacks the "Message parents" permission').toBeVisible();
      const initial = await checkbox.isChecked();
      await checkbox.click();
      await expect(checkbox).toBeChecked({ checked: !initial });
      await checkbox.click();
      await expect(checkbox).toBeChecked({ checked: initial });
      expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
    });

    test('"Whole level" deduction saves and changes the balances', async ({ page }) => {
      const db = await dbAs(user);
      await openConductActions(page, user);
      await expect(page.getByRole('button', { name: /^Whole level/ }),
        'Hidden: this role lacks the "Whole-school conduct entries" permission').toBeVisible();

      await page.getByRole('button', { name: /^Whole level/ }).click();
      const level = await chooseLevelWithStudents(page);
      const before = await totalMarks(db, level);
      console.log(`${user}: ${level} has ${before.count} students, total ${before.total}`);

      await chooseOffenceAndOneMark(page, 'Deduction');
      await submitBulk(page, 'Whole Level');
      await expect.poll(async () => (await totalMarks(db, level)).total, { timeout: 20_000 }).toBeLessThan(before.total);
      const afterDeduction = (await totalMarks(db, level)).total;

      // Put the marks back.
      await page.getByRole('button', { name: /^Whole level/ }).click();
      await field(page, 'Class level', 'select').selectOption(level);
      await chooseOffenceAndOneMark(page, 'Restoration');
      await submitBulk(page, 'Whole Level');
      await expect.poll(async () => (await totalMarks(db, level)).total, { timeout: 20_000 }).toBeGreaterThan(afterDeduction);
      await expectNoErrorPage(page);
    });

    test('"Whole school" deduction saves and changes the balances', async ({ page }) => {
      const db = await dbAs(user);
      await openConductActions(page, user);
      const wholeSchool = page.getByRole('button', { name: /^Whole school/ });
      await expect(wholeSchool, 'Hidden: this role lacks the "Whole-school conduct entries" permission').toBeVisible();

      await wholeSchool.click();
      await expect(page.getByText(/^Whole school selected: \d+ students?/)).toBeVisible();
      const before = await totalMarks(db);
      console.log(`${user}: school has ${before.count} students, total ${before.total}`);

      await chooseOffenceAndOneMark(page, 'Deduction');
      await submitBulk(page, 'Whole School');
      await expect.poll(async () => (await totalMarks(db)).total, { timeout: 20_000 }).toBeLessThan(before.total);
      const afterDeduction = (await totalMarks(db)).total;

      await wholeSchool.click();
      await chooseOffenceAndOneMark(page, 'Restoration');
      await submitBulk(page, 'Whole School');
      await expect.poll(async () => (await totalMarks(db)).total, { timeout: 20_000 }).toBeGreaterThan(afterDeduction);
      await expectNoErrorPage(page);
    });
  });
}

test.describe('Platform owner school links', () => {
  test.skip(!hasAccount('owner'), 'TEST_OWNER_* not set in .env');

  test('a school name in /platform opens that school page, not the list', async ({ page }) => {
    await signIn(page, 'owner');
    await page.goto('/platform');
    const firstSchoolLink = page.locator('table tbody tr a').first();
    await expect(firstSchoolLink).toBeVisible({ timeout: 30_000 });
    const schoolName = (await firstSchoolLink.textContent())?.trim() ?? '';

    await firstSchoolLink.click();
    await page.waitForURL('**/platform/schools/**');
    // School details load through a server function; the tabs appear once they arrive.
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(schoolName, { exact: true }).first()).toBeVisible();
    for (const tab of ['Staff', 'Subscription & Payments', 'Support']) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    }
    // The school list must be gone (a parent route without <Outlet/> would keep showing it).
    await expect(page.locator('table tbody tr a')).toHaveCount(0);

    // A direct load of the same URL (new tab) must show the school page too.
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
  });
});
