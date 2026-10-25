import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// helpers first: it loads the app (and zod-openapi's zod extension) before the settings schema is built
import { app, chatReply, fakeFetch, guestUser, json, req, seedPrompt, testUser } from './test/helpers';
import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { analyses, attempts, mistakes, quotaUsage, user as userTable, userLimits, cards, lrAttempts, lrTests, emailLog } from './db/schema';
import { sendsIdle } from './auth-email';
import { auth } from './auth';
import { env } from './env';
import { setFetch } from './ai/openrouter';
import { analyze, purgeGuests, recoverStale, setAnalyzer, setMaxTries } from './jobs';
import { speakingLlm, sttWords, writingChat } from './ai/fixtures';
import { clearBalanceCache } from './community';
import { PLANS, refundAttempt, reserve, payerOf } from './quota';
import { hashIp } from './ip';
import { realPlans } from './test/setup';
import { LR_PLANS } from './routes/lr';
import { storage } from './storage';

const ESSAY = 'Many people has argued that technology makes life easier, and I strongly agree with this view for several reasons that I will explain in this short essay.';
let n = 0;
const ip = () => `203.0.113.${++n}`; // a fresh client address per test (the per-IP caps are in-memory/DB state)

beforeEach(() => {
  setAnalyzer(async () => {});
  setMaxTries(1); // these tests are about the final failure and its refund, not the queue's retries
});
afterEach(() => vi.useRealTimers());

/** Creates + submits one writing attempt; returns both responses. */
async function writing(headers: Headers, p: { id: string }, extra: Record<string, unknown> = {}, text = ESSAY) {
  const create = await req('/api/attempts', { headers, body: { promptId: p.id, skill: 'writing', part: 2, ...extra } });
  if (create.status !== 201) return { create, submit: undefined, id: undefined as unknown as string };
  const { id } = (await create.clone().json()) as { id: string };
  const submit = await req(`/api/attempts/${id}/submit`, { headers, body: { text } });
  return { create, submit, id };
}
async function speaking(headers: Headers, p: { id: string }, extra: Record<string, unknown> = {}, part = 1) {
  const create = await req('/api/attempts', { headers, body: { promptId: p.id, skill: 'speaking', part, ...extra } });
  if (create.status !== 201) return { create, submit: undefined, id: undefined as unknown as string };
  const { id, audioKey } = (await create.clone().json()) as { id: string; audioKey: string };
  await storage.put(audioKey, new Uint8Array([1, 2, 3]), 'audio/webm');
  const submit = await req(`/api/attempts/${id}/submit`, { headers, body: { durationMs: 30_000 } });
  return { create, submit, id };
}
const quota = async (headers?: Headers) => (await (await req('/api/quota', { headers })).json()) as any;
const rows = (userId: string) => db.select().from(quotaUsage).where(eq(quotaUsage.userId, userId));
const body = async (r: Response | undefined) => (await r!.json()) as any;

const balanceFetch = (data: Record<string, unknown> | number) => fakeFetch({ '/api/v1/key': () => (typeof data === 'number' ? json({}, data) : json({ data })) });

const DAY = 86_400_000;

describe('rolling windows', () => {
  it('a test frees up exactly one window after it was reserved, for accounts (24 h here) and guests (7 days)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date(Date.now() + 30 * DAY); // in the future, so sessions created now stay valid
    vi.setSystemTime(t0);
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const c = await testUser(undefined, { unlimited: false });
    const g = await guestUser(ip());
    expect((await writing(c.headers, p)).submit!.status).toBe(200);
    expect((await writing(g.headers, p)).submit!.status).toBe(200);
    const blocked = await writing(c.headers, p);
    expect(blocked.create.status).toBe(429); // refused at create: before the essay
    const err = await body(blocked.create);
    expect(err).toMatchObject({ code: 'quota_exceeded', skill: 'writing', tier: 'community', window: 'day' });
    const reset = new Date(err.resetAt).getTime();
    expect(Math.abs(reset - (t0.getTime() + DAY))).toBeLessThan(5_000);

    vi.setSystemTime(t0.getTime() + DAY - 60_000); // one minute short: no midnight reset any more
    expect((await writing(c.headers, p)).create.status).toBe(429);
    vi.setSystemTime(t0.getTime() + DAY + 60_000);
    expect((await writing(c.headers, p)).submit!.status).toBe(200);
    expect((await writing(g.headers, p)).create.status).toBe(429); // the guest's 7 days are not over
    vi.setSystemTime(t0.getTime() + 7 * DAY + 60_000);
    expect((await writing(g.headers, p)).submit!.status).toBe(200);
  });
});

describe('reserve, refund, retry', () => {
  it('speaking and writing have separate quotas; GET /api/quota shows used / remaining / resetAt', async () => {
    const { headers } = await testUser(undefined, { unlimited: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const s = await seedPrompt();
    expect(await quota(headers)).toMatchObject({
      tier: 'community',
      speaking: { used: 0, limit: 1, remaining: 1, window: 'day', blocked: null },
      writing: { used: 0, limit: 1, remaining: 1, window: 'day', blocked: null },
      live: false,
    });
    expect((await writing(headers, w)).submit!.status).toBe(200);
    const q = await quota(headers);
    expect(q.writing).toMatchObject({ used: 1, remaining: 0, blocked: 'quota_exceeded', resetAt: expect.any(String) });
    expect(q.speaking).toMatchObject({ used: 0, remaining: 1 });
    expect((await speaking(headers, s)).submit!.status).toBe(200);
    expect((await quota(headers)).speaking.remaining).toBe(0);
  });

  it('429 shape: code, skill, resetAt, tier', async () => {
    const { headers } = await testUser(undefined, { unlimited: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    await writing(headers, w);
    const second = await writing(headers, w);
    expect(second.create.status).toBe(429);
    expect(await body(second.create)).toEqual({
      error: "You've used your writing tests for today.",
      code: 'quota_exceeded',
      skill: 'writing',
      resetAt: expect.any(String),
      tier: 'community',
      window: 'day',
    });
  });

  it('submitting the same attempt again never costs again (409), and the ledger has one row', async () => {
    const { headers, user } = await testUser(undefined, { unlimited: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const { id } = await writing(headers, w);
    expect((await req(`/api/attempts/${id}/submit`, { headers, body: { text: ESSAY } })).status).toBe(409);
    expect(await rows(user.id)).toHaveLength(1);
    // reserving the same unit again is a no-op
    await reserve(await payerOf({ ...user, emailVerified: true, isAnonymous: false }), 'writing', id, null);
    expect(await rows(user.id)).toHaveLength(1);
  });

  it('a failed analysis refunds the test; retrying the same attempt reserves it again (one charge in total)', async () => {
    const { headers, user } = await testUser(undefined, { unlimited: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    setAnalyzer(analyze);
    setFetch(fakeFetch({ '/chat/completions': () => chatReply('garbage') }));
    const { id } = await writing(headers, w);
    await settled(id, 'failed');
    // the refund is written after the status: wait for it rather than assume settled's 30 ms covers it under load
    await vi.waitFor(async () => expect((await rows(user.id))[0]).toMatchObject({ refundedAt: expect.any(Date) }), { timeout: 8000 });
    expect((await quota(headers)).writing).toMatchObject({ used: 0, remaining: 1 });

    setFetch(fakeFetch({ '/chat/completions': writingChat() }));
    const retry = await req(`/api/attempts/${id}/submit`, { headers, body: {} });
    expect(retry.status).toBe(200);
    await settled(id, 'done');
    expect(await rows(user.id)).toHaveLength(1);
    expect((await rows(user.id))[0]!.refundedAt).toBeNull();
    expect((await quota(headers)).writing.remaining).toBe(0);
  });

  it('a retry after the quota was spent elsewhere is refused (429) and the draft survives', async () => {
    const { headers, user } = await testUser(undefined, { unlimited: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    setAnalyzer(analyze);
    setFetch(fakeFetch({ '/chat/completions': () => chatReply('garbage') }));
    const first = await writing(headers, w);
    await settled(first.id, 'failed'); // refunded
    setAnalyzer(async () => {});
    expect((await writing(headers, w)).submit!.status).toBe(200); // a second tab uses the freed test
    const retry = await req(`/api/attempts/${first.id}/submit`, { headers, body: {} });
    expect(retry.status).toBe(429);
    expect((await db.query.attempts.findFirst({ where: eq(attempts.id, first.id) }))!.text).toBe(ESSAY);
    expect((await rows(user.id)).filter((r) => !r.refundedAt)).toHaveLength(1);
  });

  it('a draft sent with a refused submit is kept on the attempt (second tab used the last test)', async () => {
    const { headers } = await testUser(undefined, { unlimited: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const a = await req('/api/attempts', { headers, body: { promptId: w.id, skill: 'writing', part: 2 } });
    const b = await req('/api/attempts', { headers, body: { promptId: w.id, skill: 'writing', part: 2 } }); // both started before either submitted
    const [ida, idb] = [(await body(a)).id, (await body(b)).id];
    expect((await req(`/api/attempts/${ida}/submit`, { headers, body: { text: ESSAY } })).status).toBe(200);
    const refused = await req(`/api/attempts/${idb}/submit`, { headers, body: { text: 'my long draft', plan: 'plan' } });
    expect(refused.status).toBe(429);
    expect(await db.query.attempts.findFirst({ where: eq(attempts.id, idb) })).toMatchObject({ status: 'recording', text: 'my long draft', plan: 'plan' });
  });

  it('no speech heard refunds the test', async () => {
    const { headers, user } = await testUser(undefined, { unlimited: false });
    const s = await seedPrompt();
    setAnalyzer(analyze);
    setFetch(fakeFetch({ '/audio/transcriptions': () => json({ text: '', duration: 3, words: [] }), '/chat/completions': () => chatReply(speakingLlm) }));
    const { id } = await speaking(headers, s);
    await settled(id, 'done');
    expect(((await db.query.analyses.findFirst({ where: eq(analyses.attemptId, id) }))!.result as any).noSpeech).toBe(true);
    expect((await rows(user.id))[0]!.refundedAt).toBeInstanceOf(Date);
    expect((await quota(headers)).speaking.remaining).toBe(1);
  });

  it('recoverStale refunds attempts that were interrupted', async () => {
    const { headers, user } = await testUser(undefined, { unlimited: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const { id } = await writing(headers, w);
    await db.update(attempts).set({ updatedAt: new Date(Date.now() - 31 * 60_000) }).where(eq(attempts.id, id));
    await recoverStale();
    expect((await rows(user.id))[0]!.refundedAt).toBeInstanceOf(Date);
  });
});

describe('full tests count once', () => {
  it('three speaking parts of one session cost one test; the next session is refused', async () => {
    const { headers, user } = await testUser(undefined, { unlimited: false });
    const [p1, p2, p3] = [await seedPrompt(), await seedPrompt({ part: 2, type: 'cue-card' }), await seedPrompt({ part: 3, type: 'p3-discussion' })];
    const sessionId = crypto.randomUUID();
    for (const [p, part] of [[p1, 1], [p2, 2], [p3, 3]] as const) expect((await speaking(headers, p, { sessionId }, part)).submit!.status).toBe(200);
    expect(await rows(user.id)).toHaveLength(1);
    expect((await quota(headers)).speaking).toMatchObject({ used: 1, remaining: 0 });
    expect((await speaking(headers, p1, { sessionId: crypto.randomUUID() })).create.status).toBe(429);
  });

  it('writing task 1 + task 2 of one session cost one test', async () => {
    const { headers, user } = await testUser(undefined, { unlimited: false });
    const t1 = await seedPrompt({ skill: 'writing', part: 1, variant: 'academic', type: 'bar' });
    const t2 = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const sessionId = crypto.randomUUID();
    expect((await writing(headers, t1, { sessionId, part: 1 })).submit!.status).toBe(200);
    expect((await writing(headers, t2, { sessionId })).submit!.status).toBe(200); // create passes the check too: the unit is paid
    expect(await rows(user.id)).toHaveLength(1);
  });

  it('reusing one sessionId for the same part again is a new test, so it cannot bundle unlimited tests', async () => {
    const { headers } = await testUser(undefined, { unlimited: false });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const sessionId = crypto.randomUUID();
    expect((await writing(headers, p, { sessionId })).submit!.status).toBe(200);
    const again = await writing(headers, p, { sessionId });
    expect(again.create.status).toBe(429);
  });

  it('a session refunds only when no other part of it still counts', async () => {
    const { user } = await testUser(undefined, { unlimited: false });
    const p = await seedPrompt();
    const sessionId = crypto.randomUUID();
    const mk = (part: number, status: 'done' | 'failed') => db.insert(attempts).values({ userId: user.id, promptId: p.id, skill: 'speaking', part, sessionId, status }).returning().then((r) => r[0]!);
    const [a1, a2] = [await mk(1, 'failed'), await mk(2, 'done')];
    await db.insert(analyses).values({ attemptId: a2.id, result: {}, overall: 6, criteria: {}, models: {} });
    await db.insert(quotaUsage).values({ userId: user.id, skill: 'speaking', unitKey: sessionId, tier: 'community' });
    await refundAttempt(a1); // part 2 is fine: the session stays paid
    expect((await rows(user.id))[0]!.refundedAt).toBeNull();
    await db.update(analyses).set({ result: { noSpeech: true } }).where(eq(analyses.attemptId, a2.id));
    await refundAttempt(a1); // now nothing in it counts
    expect((await rows(user.id))[0]!.refundedAt).toBeInstanceOf(Date);
  });
});

describe('guests', () => {
  it('1 per week per anonymous user; the attempt is theirs to open; nothing personal is open to them', async () => {
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const g = await guestUser(ip());
    const first = await writing(g.headers, p);
    expect(first.submit!.status).toBe(200);
    const second = await writing(g.headers, p);
    expect(second.create.status).toBe(429);
    expect(await body(second.create)).toMatchObject({ code: 'quota_exceeded', tier: 'guest', skill: 'writing', resetAt: expect.any(String) });
    expect((await quota(g.headers)).writing).toMatchObject({ window: 'week', used: 1, remaining: 0 });

    expect((await req(`/api/attempts/${first.id}`, { headers: g.headers })).status).toBe(200); // the result page right after the test
    expect(((await (await req('/api/attempts', { headers: g.headers })).json()) as any).items).toHaveLength(1); // a guest's own short recent list is open (capped); the full pages are not
    for (const path of ['/api/mistakes', '/api/cards/due', '/api/progress'])
      expect(await (async () => { const r = await req(path, { headers: g.headers }); return [r.status, (await r.json() as any).code]; })()).toEqual([403, 'account_required']);
    expect((await req('/api/settings', { method: 'PUT', headers: g.headers, body: { targetBand: 8 } })).status).toBe(403);
  });

  it('GET /api/me for a guest: anonymous, no email, no live', async () => {
    const g = await guestUser(ip());
    const me = (await (await req('/api/me', { headers: g.headers })).json()) as any;
    expect(me).toMatchObject({ user: { isAnonymous: true, email: '' }, tier: 'guest', live: false, cambridgeAccess: false });
    expect(me.speaking).toMatchObject({ limit: 1, window: 'week' });
  });

  it('GET /api/quota works without any session (a guest by IP)', async () => {
    expect(await quota()).toMatchObject({ tier: 'guest', speaking: { limit: 1, remaining: 1, window: 'week' }, writing: { limit: 1, remaining: 1 }, live: false });
  });

  it('per-IP cap: 3 guests per skill per IP per week, then the 4th anonymous user is refused; another IP is unaffected', async () => {
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const addr = ip();
    for (let i = 0; i < env.GUESTS_PER_IP; i++) expect((await writing((await guestUser(addr)).headers, p)).submit!.status).toBe(200);
    const fourth = await guestUser(addr); // a fresh anonymous user (cleared storage)
    expect((await quota(fourth.headers)).writing).toMatchObject({ remaining: 0, blocked: 'quota_exceeded' });
    const refused = await writing(fourth.headers, p);
    expect(refused.create.status).toBe(429);
    expect(await body(refused.create)).toMatchObject({ code: 'quota_exceeded', tier: 'guest' });
    expect((await writing((await guestUser(ip())).headers, p)).submit!.status).toBe(200);
    // the cap is per skill: speaking from the same IP is still open
    expect((await speaking(fourth.headers, await seedPrompt())).submit!.status).toBe(200);
  });

  it('the IP cap follows a guest who signs up: their used test still counts against the address', async () => {
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const addr = ip();
    const g = await guestUser(addr);
    await writing(g.headers, p);
    const { headers } = await signUp(g, `link${++n}@test.dev`);
    expect(((await quota(headers)) as any).tier).toBe('community');
    for (let i = 0; i < env.GUESTS_PER_IP - 1; i++) await writing((await guestUser(addr)).headers, p);
    expect((await writing((await guestUser(addr)).headers, p)).create.status).toBe(429);
  });

  it('the IP is stored only as a salted hash, never raw', async () => {
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const addr = '198.51.100.77';
    const g = await guestUser(addr);
    await writing(g.headers, p);
    const [row] = await rows(g.user.id);
    expect(row!.ipHash).toBe(hashIp(addr));
    expect(row!.ipHash).not.toContain(addr);
    expect(row!.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(await db.select().from(quotaUsage))).not.toContain(addr);
    expect(JSON.stringify(await db.select().from(userTable))).not.toContain(addr);
  });

  it('falls back to the last X-Forwarded-For hop (the one our proxy wrote) when CF-Connecting-IP is absent', async () => {
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const g = await guestUser();
    g.headers.set('X-Forwarded-For', '10.0.0.1, 198.51.100.9'); // a client-written first hop is not trusted
    await writing(g.headers, p);
    expect((await rows(g.user.id))[0]!.ipHash).toBe(hashIp('198.51.100.9'));
  });

  it('anonymous sign-ins are limited per IP', async () => {
    const addr = ip();
    const statuses: number[] = [];
    for (let i = 0; i < 17; i++) statuses.push((await app.request('/api/auth/sign-in/anonymous', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': addr }, body: '{}' })).status);
    expect(statuses.slice(0, 15).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(15)).toEqual([429, 429]);
  });
});

/** Signs up a real account while holding the guest's bearer token (how the apps do it). */
async function signUp(g: { headers: Headers }, email: string) {
  const h = new Headers(g.headers);
  const res = await app.request('/api/auth/sign-up/email', { method: 'POST', headers: h, body: JSON.stringify({ email, password: 'password1234', name: 'Real Person' }) });
  const token = res.headers.get('set-auth-token');
  if (!token) throw new Error(`sign-up failed ${res.status} ${await res.text()}`);
  const user = ((await res.json()) as any).user as { id: string };
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, user.id));
  return { headers: new Headers({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), user, res };
}

describe('guest → account linking', () => {
  it('sign-up moves attempts, recordings and used quota to the new account; the guest user is gone', async () => {
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const s = await seedPrompt();
    const g = await guestUser(ip());
    const wr = await writing(g.headers, w);
    const sp = await speaking(g.headers, s);
    const oldKey = (await db.query.attempts.findFirst({ where: eq(attempts.id, sp.id) }))!.audioKey!;
    expect(oldKey).toContain(`audio/${g.user.id}/`);

    const acct = await signUp(g, `real${++n}@test.dev`);
    expect(acct.user.id).not.toBe(g.user.id);
    expect(await db.query.user.findFirst({ where: eq(userTable.id, g.user.id) })).toBeUndefined();
    const mine = await db.select().from(attempts).where(eq(attempts.userId, acct.user.id));
    expect(mine.map((a) => a.id).sort()).toEqual([wr.id, sp.id].sort());
    const moved = mine.find((a) => a.id === sp.id)!;
    expect(moved.audioKey).toBe(oldKey.replace(g.user.id, acct.user.id));
    expect(await storage.size(moved.audioKey!)).toBe(3);
    expect(await storage.size(oldKey)).toBeNull();
    expect(await rows(acct.user.id)).toHaveLength(2);

    // the new account is a community user whose daily tests the guest already used today
    const me = (await (await req('/api/me', { headers: acct.headers })).json()) as any;
    expect(me).toMatchObject({ user: { isAnonymous: false }, tier: 'community', speaking: { used: 1, remaining: 0, window: 'day' }, writing: { used: 1, remaining: 0 } });
    expect((await req(`/api/attempts/${wr.id}`, { headers: acct.headers })).status).toBe(200);
    expect((await req('/api/attempts', { headers: acct.headers })).status).toBe(200); // history now open
    expect((await req('/api/me', { headers: g.headers })).status).toBe(401); // the guest token died with the guest
  });

  it('sign-up also moves Listening & Reading attempts and Review cards (they would cascade-delete with the guest)', async () => {
    const g = await guestUser(ip());
    const [t] = await db.insert(lrTests).values({ slug: `link-lr-${++n}`, skill: 'reading', variant: 'academic', source: 'generated', ref: 'X', title: 'x', data: { sections: [] } as never, restricted: false }).returning();
    const [a] = await db.insert(lrAttempts).values({ userId: g.user.id, testId: t!.id, mode: 'practice' }).returning();
    const [c] = await db.insert(cards).values({ userId: g.user.id, front: 'spell it', back: 'accommodation', source: 'mistake' }).returning();
    const acct = await signUp(g, `lr${++n}@test.dev`);
    expect((await db.query.lrAttempts.findFirst({ where: eq(lrAttempts.id, a!.id) }))?.userId).toBe(acct.user.id);
    expect((await db.query.cards.findFirst({ where: eq(cards.id, c!.id) }))?.userId).toBe(acct.user.id);
  });

  it('signing in to an existing account carries the guest result over too', async () => {
    const existing = await testUser(undefined, { unlimited: false });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const g = await guestUser(ip());
    const wr = await writing(g.headers, p);
    const res = await app.request('/api/auth/sign-in/email', { method: 'POST', headers: new Headers(g.headers), body: JSON.stringify({ email: existing.user.email, password: 'password1234' }) });
    expect(res.status).toBe(200);
    expect((await db.query.attempts.findFirst({ where: eq(attempts.id, wr.id) }))!.userId).toBe(existing.user.id);
    expect(await rows(existing.user.id)).toHaveLength(1);
  });
});

describe('guest signs up while an attempt is being analysed', () => {
  const guestWriting = async () => {
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const g = await guestUser(ip());
    return { g, w };
  };

  it('a failure after the link still refunds the test on the new account', async () => {
    const { g, w } = await guestWriting();
    let signed: ReturnType<typeof signUp> | undefined;
    setAnalyzer(analyze);
    setFetch(fakeFetch({ '/chat/completions': async () => ((signed ??= signUp(g, `mid${++n}@test.dev`)), await signed, chatReply('garbage')) }));
    const { id } = await writing(g.headers, w);
    await settled(id, 'failed');
    const acct = await signed!;
    expect((await rows(acct.user.id))[0]).toMatchObject({ refundedAt: expect.any(Date) });
    expect((await quota(acct.headers)).writing).toMatchObject({ used: 0, remaining: 1 });
  });

  it('a result that arrives after the link is stored for the new account (mistakes and all)', async () => {
    const { g, w } = await guestWriting();
    let signed: ReturnType<typeof signUp> | undefined;
    setAnalyzer(analyze);
    const ok = writingChat();
    setFetch(fakeFetch({ '/chat/completions': async (u, i) => ((signed ??= signUp(g, `mid${++n}@test.dev`)), await signed, ok(u, i)) }));
    const { id } = await writing(g.headers, w);
    await settled(id, 'done');
    const acct = await signed!;
    expect((await db.query.attempts.findFirst({ where: eq(attempts.id, id) }))!.userId).toBe(acct.user.id);
    const ms = await db.select().from(mistakes).where(eq(mistakes.attemptId, id));
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((m) => m.userId === acct.user.id)).toBe(true);
  });
});

describe('guest → account linking with email verification (production flow)', () => {
  it('sign-up returns no session; the OTP verification, sent with the guest token, links the guest', async () => {
    const opts = auth.options.emailAndPassword!;
    opts.requireEmailVerification = true;
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
      const g = await guestUser(ip());
      const wr = await writing(g.headers, w);
      const email = `verify${++n}@test.dev`;
      const up = await app.request('/api/auth/sign-up/email', { method: 'POST', headers: new Headers(g.headers), body: JSON.stringify({ email, password: 'password1234', name: 'Real Person' }) });
      expect(up.status).toBe(200);
      expect(up.headers.get('set-auth-token')).toBeNull(); // no session until the email is verified
      // the guest is untouched meanwhile
      expect((await req(`/api/attempts/${wr.id}`, { headers: g.headers })).status).toBe(200);

      await db.delete(emailLog); // sendOnSignUp is off under test: the sign-up left a stand-in row that would hold the 30 s cooldown
      const sent = await app.request('/api/auth/email-otp/send-verification-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, type: 'email-verification' }) });
      expect(sent.status).toBe(200);
      await sendsIdle();
      const otp = logs.mock.calls.map((c) => String(c[0])).join('\n').match(/letter-spacing:6px[^>]*>(\d{6})</)?.[1];
      expect(otp).toBeTruthy();
      const verified = await app.request('/api/auth/email-otp/verify-email', { method: 'POST', headers: new Headers(g.headers), body: JSON.stringify({ email, otp }) });
      expect(verified.status).toBe(200);
      const token = verified.headers.get('set-auth-token');
      expect(token).toBeTruthy();
      const me = (await (await req('/api/me', { headers: new Headers({ Authorization: `Bearer ${token}` }) })).json()) as any;
      expect(me).toMatchObject({ user: { isAnonymous: false, email }, writing: { used: 1 } });
      expect((await db.query.attempts.findFirst({ where: eq(attempts.id, wr.id) }))!.userId).toBe(me.user.id);
    } finally {
      opts.requireEmailVerification = false;
      logs.mockRestore();
    }
  });
});

describe('guest retention', () => {
  it('guests older than 30 days are deleted with their attempts, quota rows and recordings; newer guests and real users stay', async () => {
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const s = await seedPrompt();
    const old = await guestUser(ip());
    const fresh = await guestUser(ip());
    const real = await testUser();
    await writing(old.headers, w);
    const sp = await speaking(old.headers, s);
    await writing(fresh.headers, w);
    const key = (await db.query.attempts.findFirst({ where: eq(attempts.id, sp.id) }))!.audioKey!;
    await db.update(userTable).set({ createdAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(userTable.id, old.user.id));
    await db.update(userTable).set({ createdAt: new Date(Date.now() - 400 * 86_400_000) }).where(eq(userTable.id, real.user.id));
    expect(await purgeGuests()).toBe(1);
    expect(await db.query.user.findFirst({ where: eq(userTable.id, old.user.id) })).toBeUndefined();
    expect(await db.select().from(attempts).where(eq(attempts.userId, old.user.id))).toHaveLength(0);
    expect(await rows(old.user.id)).toHaveLength(0);
    expect(await storage.size(key)).toBeNull();
    expect(await db.query.user.findFirst({ where: eq(userTable.id, fresh.user.id) })).toBeTruthy();
    expect(await db.query.user.findFirst({ where: eq(userTable.id, real.user.id) })).toBeTruthy();
  });
});

describe('live access', () => {
  it('live is open to everyone once the LiveKit examiner is configured, and refused (503) until then', async () => {
    const me = async (headers: Headers) => ((await (await req('/api/me', { headers })).json()) as any);
    for (const u of [await guestUser(), await testUser(undefined, { unlimited: false }), await testUser()]) {
      expect((await me(u.headers)).live).toBe(false);
      expect((await req('/api/live/start', { headers: u.headers, body: {} })).status).toBe(503);
    }
    Object.assign(env, { LIVEKIT_URL: 'wss://x', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', LIVEKIT_REPORT_SECRET: 'r'.repeat(32), SONIOX_API_KEY: 'sx' });
    try {
      expect((await me((await testUser(undefined, { unlimited: false })).headers)).live).toBe(true);
    } finally {
      Object.assign(env, { LIVEKIT_URL: undefined, LIVEKIT_API_KEY: undefined, LIVEKIT_API_SECRET: undefined, LIVEKIT_REPORT_SECRET: undefined, SONIOX_API_KEY: undefined });
    }
  });
});

describe('server balance guard', () => {
  it('below COMMUNITY_MIN_BALANCE limited tests are refused with 402; unlimited users and the owner are not affected', async () => {
    setFetch(balanceFetch({ limit: 20, usage: 19.9, limit_remaining: 0.1 }));
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const community = await testUser(undefined, { unlimited: false });
    const guest = await guestUser(ip());
    for (const u of [community, guest]) {
      const r = await writing(u.headers, w);
      expect(r.create.status).toBe(402);
      expect(await body(r.create)).toMatchObject({ code: 'community_balance_exhausted', error: expect.stringContaining('try again later') });
      expect((await quota(u.headers)).writing).toMatchObject({ blocked: 'community_balance_exhausted' });
    }
    expect(await quota(community.headers)).not.toHaveProperty('communityBalance');
    expect((await writing((await testUser()).headers, w)).submit!.status).toBe(200);
    expect((await writing((await testUser('soyebjim@gmail.com', { unlimited: false })).headers, w)).submit!.status).toBe(200);
    // exactly at the floor is allowed
    clearBalanceCache();
    setFetch(balanceFetch({ limit: 20, usage: 19.75, limit_remaining: env.COMMUNITY_MIN_BALANCE }));
    expect((await writing(community.headers, w)).submit!.status).toBe(200);
  });

  it('the balance can run out between create and submit: 402 and the draft is kept', async () => {
    const { headers } = await testUser(undefined, { unlimited: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    setFetch(balanceFetch({ limit: 20, usage: 1, limit_remaining: 19 }));
    const { id } = await body(await req('/api/attempts', { headers, body: { promptId: w.id, skill: 'writing', part: 2 } }));
    clearBalanceCache();
    setFetch(balanceFetch({ limit: 20, usage: 20, limit_remaining: 0 }));
    const r = await req(`/api/attempts/${id}/submit`, { headers, body: { text: 'a long draft' } });
    expect(r.status).toBe(402);
    expect((await db.query.attempts.findFirst({ where: eq(attempts.id, id) }))!.text).toBe('a long draft');
  });
});

describe('rate limits and the global guard', () => {
  it('COMMUNITY_MAX_PER_HOUR: past it everyone with limits gets a friendly 503 busy; unlimited users are unaffected', async () => {
    const before = env.COMMUNITY_MAX_PER_HOUR;
    env.COMMUNITY_MAX_PER_HOUR = 2;
    try {
      const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
      expect((await writing((await testUser(undefined, { unlimited: false })).headers, w)).submit!.status).toBe(200);
      expect((await writing((await guestUser(ip())).headers, w)).submit!.status).toBe(200);
      const late = await writing((await testUser(undefined, { unlimited: false })).headers, w);
      expect(late.create.status).toBe(503);
      expect(await body(late.create)).toMatchObject({ code: 'community_busy', error: expect.stringContaining('try again') });
      expect((await quota((await testUser(undefined, { unlimited: false })).headers)).writing.blocked).toBe('community_busy');
      expect((await writing((await testUser()).headers, w)).submit!.status).toBe(200);
    } finally {
      env.COMMUNITY_MAX_PER_HOUR = before;
    }
  });

  it('refunded tests do not count towards the hourly guard', async () => {
    const before = env.COMMUNITY_MAX_PER_HOUR;
    env.COMMUNITY_MAX_PER_HOUR = 1;
    try {
      const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
      const a = await testUser(undefined, { unlimited: false });
      const { id } = await writing(a.headers, w);
      const [att] = await db.select().from(attempts).where(eq(attempts.id, id));
      await refundAttempt(att!);
      expect((await writing((await testUser(undefined, { unlimited: false })).headers, w)).submit!.status).toBe(200);
    } finally {
      env.COMMUNITY_MAX_PER_HOUR = before;
    }
  });

  it('per-IP burst limit on creating attempts for free users and guests; unlimited users are not limited', async () => {
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const addr = ip();
    const c = await testUser(undefined, { unlimited: false });
    c.headers.set('CF-Connecting-IP', addr);
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await req('/api/attempts', { headers: c.headers, body: { promptId: w.id, skill: 'writing', part: 2 } })).status);
    expect(codes.slice(0, 20).every((s) => s === 201)).toBe(true);
    const limited = await req('/api/attempts', { headers: c.headers, body: { promptId: w.id, skill: 'writing', part: 2 } });
    expect([limited.status, (await body(limited)).code]).toEqual([429, 'too_many_requests']);
    // the address is the key: another community user behind the same address is limited too
    const c2 = await testUser(undefined, { unlimited: false });
    c2.headers.set('CF-Connecting-IP', addr);
    expect((await req('/api/attempts', { headers: c2.headers, body: { promptId: w.id, skill: 'writing', part: 2 } })).status).toBe(429);
    const own = await testUser();
    own.headers.set('CF-Connecting-IP', addr);
    expect((await req('/api/attempts', { headers: own.headers, body: { promptId: w.id, skill: 'writing', part: 2 } })).status).toBe(201);
  });
});

describe('owner and unlimited exemption', () => {
  it('the verified owner and admin-unlimited users have no limit; an unverified owner address gets none', async () => {
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const owner = await testUser('soyebjim@gmail.com', { unlimited: false });
    expect(await quota(owner.headers)).toMatchObject({ tier: 'unlimited', speaking: { limit: null, remaining: null, resetAt: null, window: null, blocked: null }, writing: { limit: null } });
    for (let i = 0; i < 3; i++) expect((await writing(owner.headers, w)).submit!.status).toBe(200);
    expect(await rows(owner.user.id)).toHaveLength(0); // nothing to count

    const own = await testUser();
    for (let i = 0; i < 3; i++) expect((await writing(own.headers, w)).submit!.status).toBe(200);

    const other = await testUser('someone@gmail.com', { unlimited: false });
    expect((await quota(other.headers)).tier).toBe('community');
  });

  it('an allow-listed address that is not verified is not the owner', async () => {
    const spoof = await testUser('SoyebJim@Gmail.com', { unlimited: false, verified: false });
    expect((await quota(spoof.headers)).tier).toBe('community');
  });
});

// ---- helpers used above ----
async function settled(id: string, status: 'done' | 'failed') {
  await vi.waitFor(async () => expect((await db.query.attempts.findFirst({ where: eq(attempts.id, id) }))!.status).toBe(status), { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 30)); // refund / flag writes that follow the status update
}
const speakingChat = (_: string, init: RequestInit) => {
  const b = JSON.parse(String(init.body));
  if (b.response_format?.json_schema?.name !== 'criterion_score') return chatReply(speakingLlm);
  return chatReply({ checks: [], evidence: [], descriptor: '', summary: '', injection: false, band: 6 });
};

describe('plans', () => {
  beforeEach(() => {
    const real = realPlans();
    Object.assign(PLANS, real.plans);
    Object.assign(LR_PLANS, real.lr);
  });
  const subscribe = (userId: string) => db.insert(userLimits).values({ userId, updatedBy: 'test', subscribedUntil: new Date(Date.now() + 30 * DAY) });
  const examiner = async (_userId: string, u: object, addr: string) =>
    reserve(await payerOf(u as Parameters<typeof payerOf>[0]), 'examiner', crypto.randomUUID(), hashIp(addr)).then(() => 200, (e) => e.status as number);

  it('guests: 2 writing / 7 days, 5 practice speaking and 3 live sessions / 30 days, each counted on its own', async () => {
    const addr = ip();
    const g = await guestUser(addr);
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const s = await seedPrompt();
    expect(await quota(g.headers)).toMatchObject({
      tier: 'guest',
      writing: { limit: 2, window: 'week' },
      speaking: { limit: 5, window: 'month' },
      examiner: { limit: 3, window: 'month' },
    });
    for (let i = 0; i < 2; i++) expect((await writing(g.headers, w)).submit!.status).toBe(200);
    expect((await writing(g.headers, w)).create.status).toBe(429);
    for (let i = 0; i < 3; i++) expect(await examiner(g.user.id, g.user, addr)).toBe(200);
    expect(await examiner(g.user.id, g.user, addr)).toBe(429);
    // live sessions do not eat practice tests
    for (let i = 0; i < 5; i++) expect((await speaking(g.headers, s)).submit!.status).toBe(200);
    expect((await speaking(g.headers, s)).create.status).toBe(429);
  });

  it('signed in: 5 writing / 7 days, 10 practice and 5 live / 30 days; the 429 says which window', async () => {
    const c = await testUser(undefined, { unlimited: false });
    expect(await quota(c.headers)).toMatchObject({ tier: 'community', writing: { limit: 5, window: 'week' }, speaking: { limit: 10, window: 'month' }, examiner: { limit: 5, window: 'month' } });
    for (let i = 0; i < 5; i++) expect(await examiner(c.user.id, c.user, ip())).toBe(200);
    expect(await examiner(c.user.id, c.user, ip())).toBe(429);
    expect((await quota(c.headers)).examiner).toMatchObject({ used: 5, remaining: 0, blocked: 'quota_exceeded', resetAt: expect.any(String) });
  });

  it('subscribers: unlimited writing and practice; live 5 a day and 40 a month', async () => {
    const c = await testUser(undefined, { unlimited: false });
    await subscribe(c.user.id);
    const q = await quota(c.headers);
    expect(q).toMatchObject({ tier: 'subscriber', writing: { limit: null }, speaking: { limit: null }, examiner: { limit: 5, window: 'day', remaining: 5 } });
    for (let i = 0; i < 5; i++) expect(await examiner(c.user.id, c.user, ip())).toBe(200);
    expect(await examiner(c.user.id, c.user, ip())).toBe(429);
    // 35 more spread over earlier days: the month (40) binds even when today has room
    await db.insert(quotaUsage).values(Array.from({ length: 35 }, (_, i) => ({ userId: c.user.id, skill: 'examiner' as const, unitKey: `old-${i}`, tier: 'subscriber', createdAt: new Date(Date.now() - (2 + (i % 20)) * DAY) })));
    expect((await quota(c.headers)).examiner).toMatchObject({ window: 'month', used: 40, remaining: 0 });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    for (let i = 0; i < 7; i++) expect((await writing(c.headers, w)).submit!.status).toBe(200);
  });

  it('a lapsed subscription is the free plan again', async () => {
    const c = await testUser(undefined, { unlimited: false });
    await db.insert(userLimits).values({ userId: c.user.id, updatedBy: 'test', subscribedUntil: new Date(Date.now() - 1000) });
    expect((await quota(c.headers)).tier).toBe('community');
  });

  it('Listening & Reading: guests open the guest 10, accounts 20 more, subscribers every generated test; Cambridge stays allow-list only', async () => {
    const seed = (slug: string, source: 'generated' | 'cambridge' = 'generated') =>
      db.insert(lrTests).values({ slug, skill: 'reading', variant: 'academic', source, ref: slug, title: slug, data: { sections: [] } as never, restricted: source === 'cambridge' })
        .onConflictDoUpdate({ target: lrTests.slug, set: { retired: false } }).returning().then((r) => r[0]!);
    const [guestT, accountT, subT, camT] = [await seed('gen-r-10-v2'), await seed('gen-r-17'), await seed('gen-r-499'), await seed(`plans-cam-${++n}`, 'cambridge')]; // -v2: a replaced test keeps its plan
    const slugs = async (headers?: Headers) => new Set(((await (await req('/api/lr/tests', { headers })).json()) as { items: { id: string }[] }).items.map((i) => i.id));
    const open = async (headers: Headers | undefined, id: string) => (await req(`/api/lr/tests/${id}`, { headers })).status;
    const g = await guestUser(ip());
    const c = await testUser(undefined, { unlimited: false });
    const s = await testUser(undefined, { unlimited: false });
    await subscribe(s.user.id);
    const see = { visitor: await slugs(), guest: await slugs(g.headers), account: await slugs(c.headers), subscriber: await slugs(s.headers) };
    expect([see.visitor.has(guestT.id), see.visitor.has(accountT.id), see.visitor.has(subT.id)]).toEqual([true, false, false]);
    expect([see.guest.has(guestT.id), see.guest.has(accountT.id), see.guest.has(subT.id)]).toEqual([true, false, false]);
    expect([see.account.has(guestT.id), see.account.has(accountT.id), see.account.has(subT.id)]).toEqual([true, true, false]);
    expect([see.subscriber.has(guestT.id), see.subscriber.has(accountT.id), see.subscriber.has(subT.id), see.subscriber.has(camT.id)]).toEqual([true, true, true, false]);
    expect(await open(g.headers, accountT.id)).toBe(404);
    expect(await open(c.headers, subT.id)).toBe(404);
    expect(await open(s.headers, subT.id)).toBe(200);
  });
});
