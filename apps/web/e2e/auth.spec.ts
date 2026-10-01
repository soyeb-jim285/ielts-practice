import { expect, test, type Page } from '@playwright/test';

const email = (tag: string) => `${tag}+${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`;

async function fillSignup(page: Page, to: string, confirm = 'correct-horse-battery') {
  await page.getByLabel('Name').fill('E2E Tester');
  await page.getByLabel('Email').fill(to);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByLabel('Confirm password').fill(confirm);
  await page.getByRole('button', { name: 'Create account' }).click();
}

test.describe('guest browsing', () => {
  test('login is not the first screen: the dashboard explains the product', async ({ page }) => {
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Practise IELTS Speaking and Writing' })).toBeVisible();
    await expect(page.getByText('Example, not a real score').first()).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('hubs and the prompt bank open without an account (no Cambridge prompts)', async ({ page }) => {
    for (const [path, title] of [['/speaking', 'Speaking'], ['/writing', 'Writing'], ['/bank', 'Prompt bank']] as const) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    }
    await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
    await expect(page.getByText(/Cambridge/)).toHaveCount(0);
  });

  test('personal pages ask for sign-in and bring you back after signing up', async ({ page }) => {
    await page.goto('/speaking');
    await page.getByRole('link', { name: /Start full test/ }).click();
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect(page.getByText('Sign in to continue where you left off.')).toBeVisible();

    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/signup\?redirect=/);
    await fillSignup(page, email('back'));
    await expect(page).toHaveURL(/\/speaking\/session\?mode=full/);
  });

  test('history needs an account', async ({ page }) => {
    await page.goto('/history');
    await expect(page).toHaveURL(/\/login\?redirect=%2Fhistory/);
  });
});

test.describe('sign up', () => {
  test('the passwords must match', async ({ page }) => {
    await page.goto('/signup');
    await fillSignup(page, email('mismatch'), 'something-else-entirely');
    await expect(page.getByText('The two passwords don’t match.')).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
  });

  test('lands on the dashboard', async ({ page }) => {
    await page.goto('/signup');
    await fillSignup(page, email('e2e'));
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Get your first band' })).toBeVisible();
  });
});

test.describe('forgot password with an email code', () => {
  test('email, then 6-digit code (paste) and a new password', async ({ page }) => {
    let reset: Record<string, string> | undefined;
    await page.route('**/api/auth/email-otp/send-verification-otp', (r) => r.fulfill({ json: { success: true } }));
    await page.route('**/api/auth/email-otp/reset-password', (r) => {
      reset = r.request().postDataJSON();
      return r.fulfill({ json: { success: true } });
    });

    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();

    const first = page.getByLabel('Digit 1 of 6');
    await expect(first).toHaveAttribute('autocomplete', 'one-time-code');
    await first.focus();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text', '482 913');
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.getByLabel('Digit 6 of 6')).toHaveValue('3');

    await page.getByLabel('New password', { exact: true }).fill('a-brand-new-passphrase');
    await page.getByLabel('Confirm password').fill('a-different-passphrase');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('The two passwords don’t match.')).toBeVisible();

    await page.getByLabel('Confirm password').fill('a-brand-new-passphrase');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(reset).toEqual({ email: 'someone@example.com', otp: '482913', password: 'a-brand-new-passphrase' });
  });

  test('a wrong code is explained under the boxes', async ({ page }) => {
    await page.route('**/api/auth/email-otp/send-verification-otp', (r) => r.fulfill({ json: { success: true } }));
    await page.route('**/api/auth/email-otp/reset-password', (r) => r.fulfill({ status: 400, json: { code: 'INVALID_OTP', message: 'Invalid OTP' } }));
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Digit 1 of 6').fill('123456');
    await page.getByLabel('New password', { exact: true }).fill('a-brand-new-passphrase');
    await page.getByLabel('Confirm password').fill('a-brand-new-passphrase');
    await page.getByRole('button', { name: 'Update password' }).click();
    await expect(page.getByText('That code isn’t right. Check it and try again.')).toBeVisible();
  });
});
