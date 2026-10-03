import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from './auth';
import { db } from './db/client';
import { emailLog } from './db/schema';
import { sendsIdle } from './auth-email';
import { retryDelaysMs } from './email';
import { app } from './test/helpers';

// Resend is mocked at the SDK boundary so the real retry / logging / cooldown / status code runs.
const send = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('./env', async (orig) => ({ ...(await orig<typeof import('./env')>()), env: { ...(await orig<typeof import('./env')>()).env, RESEND_API_KEY: 're_test' } }));

const ok = { data: { id: 'rs_1' }, error: null };
const err = (statusCode: number, name = 'application_error') => ({ data: null, error: { name, message: 'secret provider text', statusCode } });
let n = 0;
const fresh = () => `mail${++n}_${Math.random().toString(36).slice(2, 6)}@x.com`;
let ipn = 0;
const post = (path: string, body: unknown, ip = `10.1.${Math.floor(++ipn / 250)}.${ipn % 250}`) =>
  app.request(`/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });
const signUp = (email: string) => auth.api.signUpEmail({ body: { email, password: 'password1234', name: 'U' } });
const status = async (token: string | null, ip = '9.9.9.9') => {
  const r = await app.request('/api/auth-email/status', { headers: { 'CF-Connecting-IP': ip, ...(token && { 'x-email-status-token': token }) } });
  return { code: r.status, body: (await r.json()) as Record<string, unknown> };
};
/** What the apps do: call the endpoint, keep the status token from the response. */
const ask = async (email: string, type = 'email-verification') => {
  const r = type === 'forget-password' ? await post('/email-otp/request-password-reset', { email }) : await post('/email-otp/send-verification-otp', { email, type });
  await sendsIdle();
  return r.headers.get('x-email-status-token')!;
};
const rows = () => db.select().from(emailLog);
const verify = async (email: string) => {
  const r = await post('/email-otp/send-verification-otp', { email, type: 'email-verification' });
  await sendsIdle(); // sends run in the background
  return r;
};
const T = (r: Response) => r.headers.get('x-email-status-token')!;

beforeEach(() => {
  send.mockReset();
  retryDelaysMs.splice(0, 2, 1, 1); // ponytail: shrink the real 1 s / 4 s backoff
});

describe('sending', () => {
  it('logs a successful send with the provider id', async () => {
    const e = fresh();
    await signUp(e);
    send.mockResolvedValue(ok);
    await verify(e);
    expect(await rows()).toMatchObject([{ email: e, purpose: 'email-verification', status: 'sent', providerId: 'rs_1', attempts: 1, error: null }]);
  });

  it('retries a Resend error object, then succeeds', async () => {
    const e = fresh();
    await signUp(e);
    send.mockResolvedValueOnce(err(500)).mockResolvedValueOnce(err(429, 'rate_limit_exceeded')).mockResolvedValueOnce(ok);
    await verify(e);
    expect(send).toHaveBeenCalledTimes(3);
    expect(await rows()).toMatchObject([{ status: 'sent', attempts: 3 }]);
  });

  it('retries a thrown network error', async () => {
    const e = fresh();
    await signUp(e);
    send.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(ok);
    await verify(e);
    expect(await rows()).toMatchObject([{ status: 'sent', attempts: 2 }]);
  });

  it('gives up after 3 attempts, logs a short kind (never the provider text), and does not start the cooldown', async () => {
    const e = fresh();
    await signUp(e);
    send.mockResolvedValue(err(500));
    expect((await verify(e)).status).toBe(200); // Better Auth answers success either way: the status endpoint is how the user learns
    expect(send).toHaveBeenCalledTimes(3);
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'failed', error: 'unavailable', attempts: 3 });
    expect(JSON.stringify(row)).not.toContain('secret');
    send.mockResolvedValue(ok); // the immediate resend must go through: this was the bug
    await verify(e);
    expect(await rows()).toHaveLength(2);
    expect((await rows()).map((r) => r.status).sort()).toEqual(['failed', 'sent']);
  });

  it('does not retry a rejected request (bad key / domain / address)', async () => {
    const e = fresh();
    await signUp(e);
    send.mockResolvedValue(err(403, 'validation_error'));
    await verify(e);
    expect(send).toHaveBeenCalledOnce();
    expect(await rows()).toMatchObject([{ status: 'failed', error: 'rejected', attempts: 1 }]);
  });

  it('sign-up\'s own send (the plugin-overridden sendVerificationEmail) reaches Resend, and a failure there is recorded, not lost', async () => {
    const e = fresh();
    const { user } = (await signUp(e)) as { user: { id: string; email: string } };
    const ctx = await auth.$context;
    send.mockResolvedValue(err(500));
    await (ctx.options.emailVerification as unknown as { sendVerificationEmail: (d: unknown) => Promise<void> }).sendVerificationEmail({ user, url: 'http://x', token: 't' });
    await sendsIdle();
    expect(await rows()).toMatchObject([{ userId: user.id, status: 'failed' }]);
  });

  it('with a guest session open, sign-up links the guest and the code email is still sent once the hook runs', async () => {
    const e = fresh();
    const g = await app.request('/api/auth/sign-in/anonymous', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const token = g.headers.get('set-auth-token')!;
    send.mockResolvedValue(ok);
    const r = await app.request('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ email: e, password: 'password1234', name: 'U' }) });
    expect(r.status).toBe(200);
    expect(T(r)).toBeTruthy();
  });

  it('cooldown starts after a success only: a repeat within 30 s is skipped and recorded', async () => {
    const e = fresh();
    await signUp(e);
    send.mockResolvedValue(ok);
    await verify(e);
    const tok = T(await verify(e));
    expect(send).toHaveBeenCalledOnce();
    expect((await rows()).map((r) => r.status).sort()).toEqual(['sent', 'skipped_cooldown']);
    const s = (await status(tok)).body;
    expect(s).toMatchObject({ status: 'sent', alreadySent: true, error: null });
    expect(s.resendAvailableIn).toBeGreaterThan(25);
  });
});

describe('GET /api/auth-email/status', () => {
  it('reports sent / failed to the requester, with a masked address and no provider detail', async () => {
    const e = fresh();
    await signUp(e);
    send.mockResolvedValue(ok);
    const sent = await status(await ask(e.toUpperCase()));
    expect(sent.body).toMatchObject({ status: 'sent', maskedEmail: `${e[0]}•••@x.com`, alreadySent: false });
    expect(new Date(sent.body.sentAt as string).getTime()).toBeGreaterThan(Date.now() - 5000);
    expect(JSON.stringify(sent.body)).not.toContain(e);

    const f = fresh();
    await signUp(f);
    send.mockResolvedValue(err(500));
    expect((await status(await ask(f))).body).toMatchObject({ status: 'failed', error: 'unavailable', sentAt: null, resendAvailableIn: 0 });
  });

  it('a real and an unknown address are indistinguishable to the requester (same shape, times, cooldown, repeat flag)', async () => {
    const real = fresh();
    const ghost = fresh();
    await signUp(real);
    send.mockResolvedValue(ok);
    for (const type of ['email-verification', 'forget-password']) {
      const a = (await status(await ask(real, type))).body;
      const b = (await status(await ask(ghost, type))).body;
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
      expect(b).toMatchObject({ status: 'sent', error: null, alreadySent: false });
      expect(Math.abs(new Date(b.sentAt as string).getTime() - new Date(a.sentAt as string).getTime())).toBeLessThan(2000);
      expect(Math.abs((b.resendAvailableIn as number) - (a.resendAvailableIn as number))).toBeLessThanOrEqual(2);
      expect((await status(await ask(real, type))).body.alreadySent).toBe(true);
      expect((await status(await ask(ghost, type))).body.alreadySent).toBe(true);
    }
    expect(send).toHaveBeenCalledTimes(2); // one per purpose, real address only
  });

  it('without the token (a third party, an old log row, a forged or other address\'s token) every address gets the same generic answer', async () => {
    const real = fresh();
    await signUp(real);
    send.mockResolvedValue(ok);
    const tok = await ask(real); // real now has a 'sent' row in the log
    const generic = { status: 'none', sentAt: null, maskedEmail: null, resendAvailableIn: 0, alreadySent: false, error: null };
    expect((await status(null, '1.1.1.1')).body).toEqual(generic);
    expect((await status('garbage', '1.1.1.1')).body).toEqual(generic);
    expect((await status(`${tok.split('.')[0]}.AAAA`, '1.1.1.1')).body).toEqual(generic); // tampered signature
    const [payload] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), e: 'victim@x.com' })).toString('base64url');
    expect((await status(`${forged}.${tok.split('.')[1]}`, '1.1.1.1')).body).toEqual(generic); // payload swapped for another address
    expect((await app.request(`/api/auth-email/status?email=${real}&purpose=email-verification`)).status).toBe(200);
    expect(await (await app.request(`/api/auth-email/status?email=${real}&purpose=email-verification`)).json()).toEqual(generic); // address params are ignored
  });

  it('a token only reads rows from its own request window: older history for the address stays hidden', async () => {
    const e = fresh();
    await signUp(e);
    await db.insert(emailLog).values({ email: e, purpose: 'email-verification', status: 'failed', error: 'network', attempts: 3, createdAt: new Date(Date.now() - 3600_000) });
    send.mockResolvedValue(ok);
    expect((await status(await ask(e))).body).toMatchObject({ status: 'sent', error: null });
  });

  it('is rate limited per client address', async () => {
    const tok = await ask(fresh());
    const codes: number[] = [];
    for (let i = 0; i < 35; i++) codes.push((await status(tok, '7.7.7.7')).code);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    expect((await status(tok, '8.8.8.8')).code).toBe(200);
  });
});

describe('real and unknown addresses are indistinguishable to the requester', () => {
  const ageRows = (email: string) => db.execute(sql`update email_log set created_at = created_at - interval '31 seconds' where email = ${email}`);
  const sequence = async (email: string) => {
    const out: Record<string, unknown>[] = [];
    const snap = async (r: Response) => {
      await sendsIdle();
      const { sentAt, ...rest } = (await status(r.headers.get('x-email-status-token'))).body;
      out.push({ ...rest, hasSentAt: !!sentAt, headers: [...r.headers.keys()].filter((k) => k.startsWith('x-')).sort().join(), http: r.status });
    };
    await snap(await post('/email-otp/send-verification-otp', { email, type: 'email-verification' })); // first
    await snap(await post('/email-otp/send-verification-otp', { email, type: 'email-verification' })); // immediate second
    await ageRows(email);
    await snap(await post('/email-otp/send-verification-otp', { email, type: 'email-verification' })); // after the cooldown
    return out;
  };

  it('same status sequence: first request, immediate repeat, after the cooldown', async () => {
    const real = fresh();
    const ghost = fresh();
    await signUp(real);
    send.mockResolvedValue(ok);
    const a = await sequence(real);
    const b = await sequence(ghost);
    expect(b).toEqual(a);
    expect(a.map((x) => [x.status, x.alreadySent])).toEqual([['sent', false], ['sent', true], ['sent', false]]);
    expect(send).toHaveBeenCalledTimes(2); // real address only: first and after-cooldown
  });

  it('same during a provider outage: both read as failed, with the same kind', async () => {
    const real = fresh();
    const ghost = fresh();
    await signUp(real);
    send.mockResolvedValue(err(500));
    const a = (await status(T(await verify(real)))).body;
    const b = (await status(T(await verify(ghost)))).body;
    expect(a).toMatchObject({ status: 'failed', error: 'unavailable' });
    expect({ ...b, sentAt: null, maskedEmail: null }).toEqual({ ...a, sentAt: null, maskedEmail: null });
  });

  it('latency does not depend on the send: a slow, retrying provider does not slow a real address down', async () => {
    const real = fresh();
    const ghost = fresh();
    await signUp(real);
    send.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 400));
      return err(500);
    });
    const time = async (e: string) => {
      const t = performance.now();
      await post('/email-otp/send-verification-otp', { email: e, type: 'email-verification' });
      return performance.now() - t;
    };
    const tReal = await time(real);
    const tGhost = await time(ghost);
    expect(tReal).toBeLessThan(300); // the three 400 ms attempts happen after the response
    expect(Math.abs(tReal - tGhost)).toBeLessThan(250);
    await sendsIdle();
  });

  it('N concurrent requests send at most one email', async () => {
    const e = fresh();
    await signUp(e);
    send.mockResolvedValue(ok);
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => post('/email-otp/send-verification-otp', { email: e, type: 'email-verification' }, `10.9.0.${i}`)));
    await sendsIdle();
    expect(send).toHaveBeenCalledOnce();
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect((await rows()).map((r) => r.status).sort()).toEqual(['sent', 'skipped_cooldown', 'skipped_cooldown', 'skipped_cooldown', 'skipped_cooldown']);
  });

  it('is limited per target address and per client address on the code-sending endpoints', async () => {
    const e = fresh();
    send.mockResolvedValue(ok);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await post('/email-otp/send-verification-otp', { email: e, type: 'email-verification' }, `10.8.0.${i}`)).status); // different clients, same victim
    expect(codes.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(codes.slice(5)).toEqual([429, 429]);
    const ip: number[] = [];
    for (let i = 0; i < 33; i++) ip.push((await post('/email-otp/send-verification-otp', { email: fresh(), type: 'email-verification' }, '10.7.7.7')).status); // one client, many victims
    expect(ip.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(ip.at(-1)).toBe(429);
  });
});
