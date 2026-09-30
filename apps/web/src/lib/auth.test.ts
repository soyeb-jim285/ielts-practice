import { afterEach, describe, expect, it, vi } from 'vitest';
import { authClient } from './auth';

const reply = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe('authClient', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('posts JSON to /api/auth and returns { data }', async () => {
    reply(200, { token: 't' });
    const r = await authClient.signIn.email({ email: 'a@b.co', password: 'pw' });
    expect(r).toEqual({ data: { token: 't' }, error: null });
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
