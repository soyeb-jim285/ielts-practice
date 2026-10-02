import { expect, test, type Page } from '@playwright/test';

// Community mode (docs/community.md): guests take a free test, limits are explained before anything is typed, own keys unlock the rest.
// Needs the API on :8787 with a seeded bank. No AI call is paid for: attempts are created and submitted, and the analysis step is never waited on.

const quota = (over: Record<string, unknown> = {}) => ({
  tier: 'guest',
  speaking: { used: 0, limit: 1, remaining: 1, resetAt: new Date(Date.now() + 5 * 3_600_000).toISOString(), window: 'week', blocked: null },
  writing: { used: 0, limit: 1, remaining: 1, resetAt: new Date(Date.now() + 5 * 3_600_000).toISOString(), window: 'week', blocked: null },
  liveProviders: [],
  communityBalance: { limit: 20, used: 7.6, remaining: 12.4, updatedAt: new Date().toISOString() },
  ...over,
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

async function startWriting(page: Page) {
  await page.goto('/writing');
  await page.getByRole('button', { name: /Task 2/ }).first().click();
}

test.describe('guest test flow', () => {
  test('no guest session until Start is pressed; the fair-use dialog comes before the test', async ({ page }) => {
    const anon: string[] = [];
    page.on('request', (r) => r.url().includes('/sign-in/anonymous') && anon.push(r.url()));
    await page.goto('/writing');
    await expect(page.getByText('1 test left this week').first()).toBeVisible();
    expect(anon).toHaveLength(0); // browsing never creates a guest

    await startWriting(page);
    const dialog = page.getByRole('dialog', { name: "You're using the community balance" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Please don't abuse it", { exact: false })).toBeVisible();
    await expect(dialog.getByText('You have 1 writing test left this week.', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Create an account' })).toBeVisible();
    expect(anon).toHaveLength(1); // made when Start was pressed (picking a prompt needs a session), once

    await dialog.getByRole('button', { name: 'Start test' }).click();
    await expect(page.getByRole('textbox', { name: /Your answer/ })).toBeVisible();
    expect(anon).toHaveLength(1);
  });

  test('the dialog is shown once a day', async ({ page }) => {
    await startWriting(page);
    await page.getByRole('button', { name: 'Start test' }).click();
    await expect(page.getByRole('textbox', { name: /Your answer/ })).toBeVisible();
    await page.goto('/writing');
    await startWriting(page);
    await expect(page.getByRole('textbox', { name: /Your answer/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('closing the dialog leaves without starting', async ({ page }) => {
    await startWriting(page);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL(/\/writing$/);
  });

  test('a finished test shows the guest result, and signing up keeps it', async ({ page }) => {
    await startWriting(page);
    await page.getByRole('button', { name: 'Start test' }).click();
    await page.getByRole('textbox', { name: /Your answer/ }).fill(words(60));
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();

    await expect(page).toHaveURL(/\/writing\/result\//);
    const result = page.url();
    await expect(page.getByText('Create an account to keep this result')).toBeVisible();

    await page.getByRole('main').getByRole('link', { name: 'Create account' }).click();
    await page.getByLabel('Name').fill('Guest Turned Member');
    await page.getByLabel('Email').fill(`keep+${Date.now()}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
    await page.getByLabel('Confirm password').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(result); // back on the same result, now under the account
    await expect(page.getByText('Create an account to keep this result')).toHaveCount(0);
  });

  test('live needs an own key: guests are told so and offered an account', async ({ page }) => {
    await page.goto('/speaking/live');
    await expect(page.getByRole('heading', { name: 'Live needs your own OpenAI or Gemini key' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  });
});

test.describe('limits are explained before anything is typed', () => {
  test('a used-up guest week offers an account, with the reset time', async ({ page }) => {
    await page.route('**/api/quota', (r) => r.fulfill({ json: quota({ writing: { ...quota().writing, remaining: 0, used: 1, blocked: 'quota_exceeded' } }) }));
    await startWriting(page);
    await expect(page.getByRole('heading', { name: "You've used this week's free test" })).toBeVisible();
    await expect(page.getByText(/It resets/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account for 1 test a day' })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

  test('a used-up day offers the settings page for own keys', async ({ page }) => {
    await page.route('**/api/quota', (r) => r.fulfill({ json: quota({ tier: 'community', writing: { ...quota().writing, window: 'day', remaining: 0, used: 1, blocked: 'quota_exceeded' } }) }));
    await startWriting(page);
    await expect(page.getByRole('heading', { name: "You've used today's free test" })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add your own key' })).toHaveAttribute('href', /\/settings#api-keys/);
  });

  test('an empty community balance blocks tests: signed-in users add a key, guests create an account', async ({ page }) => {
    const empty = (tier: string) => (r: { fulfill: (o: { json: unknown }) => unknown }) =>
      r.fulfill({ json: quota({ tier, writing: { ...quota().writing, blocked: 'community_balance_exhausted' }, communityBalance: { limit: 20, used: 19.9, remaining: 0.1, updatedAt: new Date().toISOString() } }) });
    await page.route('**/api/quota', empty('guest'));
    await startWriting(page);
    await expect(page.getByRole('heading', { name: 'The community balance is used up for now' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create an account' }).first()).toBeVisible();
    await page.unroute('**/api/quota');
    await page.route('**/api/quota', empty('community'));
    await startWriting(page);
    await expect(page.getByRole('link', { name: 'Add your own OpenRouter key' })).toBeVisible();
  });

  test('a limit hit at submit keeps the essay and explains', async ({ page }) => {
    await startWriting(page);
    await page.getByRole('button', { name: 'Start test' }).click();
    const box = page.getByRole('textbox', { name: /Your answer/ });
    await box.fill(words(60));
    await page.route('**/api/attempts/*/submit', (r) => r.fulfill({ status: 429, json: { error: 'No tests left', code: 'quota_exceeded', skill: 'writing', tier: 'guest', resetAt: new Date(Date.now() + 5 * 3_600_000).toISOString() } }));
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText("You've used this week's free test")).toBeVisible();
    await expect(box).toHaveValue(words(60)); // nothing lost
  });
});

test.describe('your API keys', () => {
  test('add with a validation error, save, replace and remove', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Key Tester');
    await page.getByLabel('Email').fill(`keys+${Date.now()}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
    await page.getByLabel('Confirm password').fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/$/);

    let saved: { provider: string; last4: string; addedAt: string; valid: boolean } | null = null;
    await page.route('**/api/keys', (r) => r.fulfill({ json: { keys: saved ? [saved] : [] } }));
    await page.route('**/api/keys/openai', async (r) => {
      if (r.request().method() === 'DELETE') {
        saved = null;
        return r.fulfill({ json: { ok: true } });
      }
      const key = r.request().postDataJSON().key as string;
      if (key.startsWith('bad')) return r.fulfill({ status: 400, json: { error: 'x', code: 'invalid_key' } });
      saved = { provider: 'openai', last4: key.slice(-4), addedAt: new Date().toISOString(), valid: true };
      return r.fulfill({ json: saved });
    });

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Your API keys' })).toBeVisible();
    await expect(page.getByText('Your key is stored encrypted on our server')).toBeVisible();

    const field = page.getByLabel('OpenAI API key');
    await field.fill('bad-key-12345678');
    await page.getByRole('button', { name: 'Save' }).nth(1).click();
    await expect(page.getByText("OpenAI didn't accept that key. Check that you copied all of it.")).toBeVisible();

    await field.fill('sk-good-key-ab12');
    await page.getByRole('button', { name: 'Save' }).nth(1).click();
    await expect(page.getByText('•••• ab12')).toBeVisible();
    await expect(page.getByLabel('OpenAI API key')).toHaveCount(0);

    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove key' }).click();
    await expect(page.getByLabel('OpenAI API key')).toBeVisible();
  });
});
