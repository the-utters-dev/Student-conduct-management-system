import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { accounts, hasAccount, signIn, trackErrors, expectNoErrorPage, type AccountKey } from './helpers';

async function dbAs(key: AccountKey) {
  const client = createClient(
    process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
    { auth: { persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword(accounts[key]);
  if (error) throw error;
  return client;
}

test.describe('Platform owner support view', () => {
  test.skip(!hasAccount('owner') || !hasAccount('director'), 'TEST_OWNER_* and TEST_DIRECTOR_* are required');

  test('owner opens the Director\'s school (EP Ngoma) and sees only its students', async ({ page }) => {
    const errors = trackErrors(page);

    // The Director's school and one of its active students, read as the Director.
    const director = await dbAs('director');
    const { data: me } = await director.auth.getUser();
    const { data: profile } = await director.from('profiles').select('school_id').eq('id', me.user!.id).single();
    const schoolId = profile!.school_id as string;
    const { data: school } = await director.from('schools').select('id, name').eq('id', schoolId).single();
    const { data: ownStudent } = await director
      .from('students').select('full_name').eq('school_id', schoolId).eq('is_active', true).limit(1).single();
    console.log(`Director's school: ${school!.name}; sample student: ${ownStudent!.full_name}`);
    expect.soft(school!.name, 'TEST_DIRECTOR is expected to belong to EP Ngoma').toMatch(/ngoma/i);

    // A student from a different school, read as the owner (who can read every school).
    const owner = await dbAs('owner');
    const { data: otherStudents } = await owner
      .from('students').select('full_name, school_id').neq('school_id', schoolId).eq('is_active', true).limit(1);
    const otherStudent = otherStudents?.[0];

    await signIn(page, 'owner');
    await page.goto(`/platform/schools/${schoolId}`);
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Support view not yet implemented')).toHaveCount(0);

    await page.getByRole('button', { name: 'Open school view' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    const banner = page.getByRole('status').filter({ hasText: 'as platform owner' });
    await expect(banner).toContainText(`Viewing ${school!.name} as platform owner`);
    await expect(banner.getByRole('button', { name: 'Exit' })).toBeVisible();

    // Students page: only this school's students.
    await page.getByRole('link', { name: 'Students' }).first().click();
    await page.waitForURL('**/students');
    const search = page.getByPlaceholder('Student, parent name or phone');
    await search.fill(ownStudent!.full_name);
    await expect(page.getByText(ownStudent!.full_name).first()).toBeVisible({ timeout: 30_000 });
    if (otherStudent) {
      await search.fill(otherStudent.full_name);
      await expect(page.getByText(otherStudent.full_name)).toHaveCount(0);
    }

    // The choice survives a reload (sessionStorage) and every school page keeps the banner.
    for (const path of ['/conduct-actions', '/reports', '/audit-logs', '/settings']) {
      await page.goto(path);
      await expect(banner).toContainText(`Viewing ${school!.name} as platform owner`, { timeout: 30_000 });
      await expectNoErrorPage(page);
    }

    // Exit returns to the school page and school pages ask the owner to pick a school again.
    await banner.getByRole('button', { name: 'Exit' }).click();
    await page.waitForURL(`**/platform/schools/${schoolId}`);
    await expect(page.getByText('as platform owner')).toHaveCount(0);
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: 'Choose a school' })).toBeVisible({ timeout: 30_000 });

    expect(errors.filter((e) => e.startsWith('pageerror'))).toEqual([]);
  });
});
