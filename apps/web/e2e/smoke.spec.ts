import { expect, test } from '@playwright/test';

// Main flows (spec §11): sign up → onboarding → target band persists → bank lists prompts. Needs a seeded bank.
test('sign up, set a target band, browse the bank', async ({ page }) => {
  await page.goto('/signup');
  await page.getByLabel('Name').fill('Smoke Tester');
  await page.getByLabel('Email').fill(`smoke+${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Get your first band' })).toBeVisible();

  await page.goto('/settings');
  const band = page.getByLabel('Target band');
  await expect(band).toHaveAttribute('aria-valuenow', '7');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT' && r.ok());
  await band.press('End'); // Radix slider thumb: keyboard, not fill()
  await saved;
  await page.reload();
  await expect(page.getByLabel('Target band')).toHaveAttribute('aria-valuenow', '9');

  await page.goto('/bank');
  await expect(page.getByRole('heading', { name: 'Prompt bank' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
});
