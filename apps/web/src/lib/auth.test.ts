import { afterEach, describe, expect, it, vi } from 'vitest';
import { authClient, otpError, safeRedirect } from './auth';

const reply = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe('authClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('posts JSON to /api/auth and returns { data }', async () => {
    reply(200, { token: 't' });
    const r = await authClient.signIn.email({ email: 'a@b.co', password: 'pw' });
    expect(r).toMatchObject({ data: { token: 't' }, error: null });
    expect(fetch).toHaveBeenCalledWith('/api/auth/sign-in/email', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@b.co', password: 'pw' }) }));
  });
  it('maps failures to { error: { status, code, message } }', async () => {
    reply(403, { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' });
    expect((await authClient.signIn.email({ email: 'a@b.co', password: 'pw' })).error).toEqual({ status: 403, code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' });
  });
  it('reports a network failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect((await authClient.signOut()).error?.status).toBe(0);
  });
});

describe('email codes', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('posts to the Better Auth emailOTP endpoints', async () => {
    reply(200, { success: true });
    await authClient.emailOtp.send({ email: 'a@b.co', type: 'forget-password' });
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/email-otp/send-verification-otp', expect.objectContaining({ body: JSON.stringify({ email: 'a@b.co', type: 'forget-password' }) }));
    await authClient.emailOtp.resetPassword({ email: 'a@b.co', otp: '123456', password: 'new-password' });
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/email-otp/reset-password', expect.objectContaining({ method: 'POST' }));
    await authClient.emailOtp.verifyEmail({ email: 'a@b.co', otp: '123456' });
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/email-otp/verify-email', expect.anything());
  });
  it('words code errors for people', () => {
    expect(otpError({ status: 400, code: 'INVALID_OTP' })).toMatch(/isn’t right/);
    expect(otpError({ status: 400, code: 'OTP_EXPIRED' })).toMatch(/expired/);
    expect(otpError({ status: 403, code: 'TOO_MANY_ATTEMPTS' })).toMatch(/new code/);
    expect(otpError({ status: 429 })).toMatch(/Too many requests/);
    expect(otpError({ status: 500, message: 'Boom' })).toBe('Boom');
  });
});

describe('safeRedirect', () => {
  it('keeps same-app paths (with their query) and rejects anything else', () => {
    expect(safeRedirect('/speaking/session?mode=p1')).toBe('/speaking/session?mode=p1');
    expect(safeRedirect('//evil.com')).toBe('/');
    expect(safeRedirect('https://evil.com')).toBe('/');
    expect(safeRedirect(undefined)).toBe('/');
  });
});
