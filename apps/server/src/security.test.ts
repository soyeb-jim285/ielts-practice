// Security review of community mode and own keys (docs/community.md): quota bypasses, IP trust, refund farming, the key-check oracle.
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
// helpers first: it loads the app (and zod-openapi's zod extension) before the settings schema is built
import { fakeFetch, guestUser, json, req, seedPrompt, testUser } from './test/helpers';
import { db } from './db/client';
import { attempts, quotaUsage } from './db/schema';
import { setFetch } from './ai/openrouter';
import { clientIp, normalizeIp } from './ip';
import { setAnalyzer } from './jobs';
import { refundAttempt, REFUND_CAP } from './quota';

beforeEach(() => setAnalyzer(async () => {}));
const ESSAY = 'Many people has argued that technology makes life easier, and I strongly agree with this view for several reasons that I will explain in this short essay.';
const body = async (r: Response) => (await r.json()) as any;
const rows = (userId: string) => db.select().from(quotaUsage).where(eq(quotaUsage.userId, userId));
const create = async (headers: Headers, promptId: string, extra: Record<string, unknown> = {}) => req('/api/attempts', { headers, body: { promptId, skill: 'writing', part: 2, ...extra } });
const submit = (headers: Headers, id: string) => req(`/api/attempts/${id}/submit`, { headers, body: { text: ESSAY } });

describe('one payment cannot cover endless attempts of a session', () => {
  it('concurrent submits of the same part in one session: exactly one rides on the payment', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const sessionId = crypto.randomUUID();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await body(await create(headers, p.id, { sessionId }))).id);
    const res = await Promise.all(ids.map((id) => submit(headers, id)));
    expect(res.map((r) => r.status).sort()).toEqual([200, 429, 429, 429, 429]);
    expect((await rows(user.id)).filter((r) => !r.refundedAt)).toHaveLength(1);
  });

  it('deleting the paid attempt does not free its slot: the same part again in that session is a new test', async () => {
    const { headers } = await testUser(undefined, { key: false });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const sessionId = crypto.randomUUID();
    const first = await body(await create(headers, p.id, { sessionId }));
    expect((await submit(headers, first.id)).status).toBe(200);
    expect((await req(`/api/attempts/${first.id}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await create(headers, p.id, { sessionId })).status).toBe(429); // refused before the essay
    // the other task of the same test is still covered
    const t1 = await seedPrompt({ skill: 'writing', part: 1, variant: 'academic', type: 'bar' });
    const second = await create(headers, t1.id, { sessionId, part: 1 });
    expect(second.status).toBe(201);
    expect((await submit(headers, (await body(second)).id)).status).toBe(200);
  });

  it('a retry of a paid attempt in a session stays free', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const sessionId = crypto.randomUUID();
    const { id } = await body(await create(headers, p.id, { sessionId }));
    expect((await submit(headers, id)).status).toBe(200);
    await db.update(attempts).set({ status: 'failed' }).where(eq(attempts.id, id));
    expect((await submit(headers, id)).status).toBe(200);
    expect(await rows(user.id)).toHaveLength(1);
  });
});

describe('refunds cannot be farmed', () => {
  it('past the cap in 24 h a failed analysis keeps the test spent', async () => {
    const { user } = await testUser(undefined, { key: false });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const mk = async () => {
      const [a] = await db.insert(attempts).values({ userId: user.id, promptId: p.id, skill: 'writing', part: 2, status: 'failed' }).returning();
      await db.insert(quotaUsage).values({ userId: user.id, skill: 'writing', unitKey: a!.id, tier: 'community', createdAt: new Date(Date.now() - 1000 * (10 + Math.random() * 100)) });
      return { id: a!.id, userId: user.id, skill: 'writing' as const, part: 2, sessionId: null };
    };
    for (let i = 0; i < REFUND_CAP; i++) {
      await refundAttempt(await mk());
    }
    const all = await rows(user.id);
    expect(all.filter((r) => r.refundedAt)).toHaveLength(REFUND_CAP);
    const last = await mk();
    await refundAttempt(last);
    expect((await rows(user.id)).find((r) => r.unitKey === last.id)!.refundedAt).toBeNull();
  });

  it('a refund that is re-reserved and refunded again still counts every time', async () => {
    const { user } = await testUser(undefined, { key: false });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const [a] = await db.insert(attempts).values({ userId: user.id, promptId: p.id, skill: 'writing', part: 2, status: 'failed' }).returning();
    await db.insert(quotaUsage).values({ userId: user.id, skill: 'writing', unitKey: a!.id, tier: 'community' });
    const ref = { id: a!.id, userId: user.id, skill: 'writing' as const, part: 2, sessionId: null };
    for (let i = 0; i < REFUND_CAP + 2; i++) {
      await refundAttempt(ref);
      await db.update(quotaUsage).set({ refundedAt: null }).where(and(eq(quotaUsage.userId, user.id), eq(quotaUsage.unitKey, a!.id))); // the retry reserved it again
    }
    expect((await rows(user.id))[0]!.refunds).toBe(REFUND_CAP);
  });
});

describe('client address', () => {
  const ipOf = async (headers: Record<string, string>) => {
    const app = new Hono().get('/', (c) => c.json({ ip: clientIp(c) }));
    return ((await (await app.request('/', { headers })).json()) as { ip: string | null }).ip;
  };

  it('IPv6 is counted per /64; IPv4-mapped is IPv4; junk is not an address', () => {
    expect(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(normalizeIp('2001:0db8:0001:0002::1'));
    expect(normalizeIp('2001:db8:1:2::1')).not.toBe(normalizeIp('2001:db8:1:3::1'));
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp('::1')).toBe('0000:0000:0000:0000::/64');
    for (const junk of ['', 'abc', '1.2.3', '1.2.3.4, 5.6.7.8', '1.2.3.4\r\nX: y', '999.1.1.1']) expect(normalizeIp(junk)).toBeNull();
  });

  it('CF-Connecting-IP wins and X-Forwarded-For is ignored; without it only the last (proxy-written) hop counts; junk falls through', async () => {
    expect(await ipOf({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })).toBe('203.0.113.7');
    expect(await ipOf({ 'x-forwarded-for': '6.6.6.6, 203.0.113.8' })).toBe('203.0.113.8');
    expect(await ipOf({ 'cf-connecting-ip': 'not-an-ip', 'x-forwarded-for': '6.6.6.6' })).toBeNull(); // no socket in tests; never the spoofable header
    expect(await ipOf({ 'x-forwarded-for': 'garbage' })).toBeNull();
  });

  it('a guest cannot dodge the per-IP weekly cap by rotating the low half of an IPv6 address', async () => {
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const net = `2001:db8:${Math.floor(Math.random() * 0xffff).toString(16)}:${Math.floor(Math.random() * 0xffff).toString(16)}`;
    const results: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const g = await guestUser(`${net}:${i}:${i}::${i}`);
      const c = await create(g.headers, p.id);
      results.push(c.status === 201 ? (await submit(g.headers, (await body(c)).id)).status : c.status);
    }
    expect(results).toEqual([200, 200, 200, 429]);
  });
});

describe('the key check is not an oracle', () => {
  it('a client address gets a handful of checks, then 429 without any call to the provider', async () => {
    const f = fakeFetch({ '/api/v1/key': () => json({ error: 'no' }, 401) });
    setFetch(f);
    const ip = '198.51.100.77';
    const who = await Promise.all([testUser(undefined, { key: false }), testUser(undefined, { key: false })]);
    const codes: string[] = [];
    for (let i = 0; i < 7; i++) {
      const h = new Headers(who[i % 2]!.headers);
      h.set('CF-Connecting-IP', ip);
      const r = await req('/api/keys/openrouter', { method: 'PUT', headers: h, body: { key: `sk-or-guess-${i}-aaaaaaaa` } });
      codes.push((await body(r)).code);
    }
    expect(codes).toEqual(['invalid_key', 'invalid_key', 'invalid_key', 'invalid_key', 'invalid_key', 'too_many_requests', 'too_many_requests']);
    expect(f.calls).toHaveLength(5);
  });
});
