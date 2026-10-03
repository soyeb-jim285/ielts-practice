import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth, webLink } from './auth';
import { sendsIdle } from './auth-email';
import { sendEmail } from './email';
import { req } from './test/helpers';

vi.mock('./email', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1', attempts: 1 })) }));

const api = 'http://192.168.0.105:8787/api/auth/verify-email?token=t&callbackURL=%2F';
describe('webLink', () => {
  it('points email links at the web origin, not the API host, with an absolute callbackURL', () => {
    const u = new URL(webLink(api));
    expect(u.origin).toBe('http://localhost:5173');
    expect(u.pathname).toBe('/api/auth/verify-email');
    expect(u.searchParams.get('callbackURL')).toBe('http://localhost:5173/');
  });
  it('uses the request Origin when it is trusted and ignores unknown ones', () => {
    const req = (origin: string) => new Request('http://x', { headers: { origin } });
    expect(new URL(webLink(api, req('http://localhost:5173'))).origin).toBe('http://localhost:5173');
    expect(new URL(webLink(api, req('https://evil.example'))).origin).toBe('http://localhost:5173');
  });
});

const mail = vi.mocked(sendEmail);
const post = async (path: string, body: unknown) => {
  const r = await req(`/api/auth${path}`, { body });
  await sendsIdle(); // code emails are sent in the background
  return r;
};
const lastCode = () => /(\d{6})<\/p>/.exec(mail.mock.calls.at(-1)![0].html)![1]!;
const signUp = (email: string) => auth.api.signUpEmail({ body: { email, password: 'password1234', name: 'Otp User' } });

describe('email OTP', () => {
  beforeEach(() => mail.mockClear()); // keeps the implementation

  it('password reset: code by email, new password works, old one does not, code is single-use', async () => {
    await signUp('reset@x.com');
    expect((await post('/email-otp/request-password-reset', { email: 'reset@x.com' })).status).toBe(200);
    expect(mail).toHaveBeenCalledOnce();
    expect(mail.mock.calls[0]![0]).toMatchObject({ to: 'reset@x.com', subject: expect.stringContaining('password reset') });
    const otp = lastCode();
    expect(otp).toMatch(/^\d{6}$/);

    expect((await post('/email-otp/reset-password', { email: 'reset@x.com', otp, password: 'new-password-123' })).status).toBe(200);
    expect((await post('/sign-in/email', { email: 'reset@x.com', password: 'new-password-123' })).status).toBe(200);
    expect((await post('/sign-in/email', { email: 'reset@x.com', password: 'password1234' })).status).toBe(401);
    expect((await post('/email-otp/reset-password', { email: 'reset@x.com', otp, password: 'another-pass-123' })).status).toBe(400);
  });

  it('a wrong code is rejected, and 5 wrong guesses burn the real one', async () => {
    await signUp('guess@x.com');
    await post('/email-otp/request-password-reset', { email: 'guess@x.com' });
    const otp = lastCode();
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await post('/email-otp/reset-password', { email: 'guess@x.com', otp: wrong, password: 'new-password-123' })).status).toBe(400);
    expect((await post('/email-otp/reset-password', { email: 'guess@x.com', otp, password: 'new-password-123' })).status).toBe(403);
  });

  it('does not reveal whether an address has an account', async () => {
    await signUp('real@x.com');
    const real = await post('/email-otp/request-password-reset', { email: 'real@x.com' });
    mail.mockClear();
    const ghost = await post('/email-otp/request-password-reset', { email: 'ghost@x.com' });
    expect([ghost.status, await ghost.json()]).toEqual([real.status, await real.json()]);
    expect(mail).not.toHaveBeenCalled();
    const a = await post('/email-otp/reset-password', { email: 'ghost@x.com', otp: '123456', password: 'new-password-123' });
    const b = await post('/email-otp/reset-password', { email: 'real@x.com', otp: '123456', password: 'new-password-123' });
    expect([a.status, await a.json()]).toEqual([b.status, await b.json()]);
    const v = await post('/email-otp/send-verification-otp', { email: 'ghost@x.com', type: 'email-verification' });
    expect(v.status).toBe(200);
    expect(mail).not.toHaveBeenCalled();
  });

  it('rejects a too-short new password', async () => {
    await signUp('short@x.com');
    await post('/email-otp/request-password-reset', { email: 'short@x.com' });
    expect((await post('/email-otp/reset-password', { email: 'short@x.com', otp: lastCode(), password: 'short' })).status).toBe(400);
  });

  it('resend within 30 s sends no second email, and the first code still works', async () => {
    await signUp('twice@x.com');
    await post('/email-otp/request-password-reset', { email: 'twice@x.com' });
    await post('/email-otp/request-password-reset', { email: 'twice@x.com' });
    expect(mail).toHaveBeenCalledOnce();
    expect((await post('/email-otp/reset-password', { email: 'twice@x.com', otp: lastCode(), password: 'new-password-123' })).status).toBe(200);
  });

  it('verifies an email with the code and signs the user in', async () => {
    await signUp('verify@x.com');
    mail.mockClear();
    expect((await post('/email-otp/send-verification-otp', { email: 'verify@x.com', type: 'email-verification' })).status).toBe(200);
    expect(mail.mock.calls[0]![0].subject).toContain('verification');
    const res = await post('/email-otp/verify-email', { email: 'verify@x.com', otp: lastCode() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: { emailVerified: boolean } };
    expect(body.user.emailVerified).toBe(true);
    expect(body.token).toBeTruthy();
    expect(res.headers.get('set-auth-token')).toBeTruthy();
  });

  it('offers no passwordless sign-in code', async () => {
    await signUp('nopw@x.com');
    mail.mockClear();
    await post('/email-otp/send-verification-otp', { email: 'nopw@x.com', type: 'sign-in' });
    expect(mail).not.toHaveBeenCalled();
  });
});
