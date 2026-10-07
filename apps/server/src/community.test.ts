import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// helpers first: it loads the app (and zod-openapi's zod extension) before the settings schema is built
import { app, chatReply, fakeFetch, guestUser, json, req, seedPrompt, setKey, testUser } from './test/helpers';
import { and, eq } from 'drizzle-orm';
import { db } from './db/client';
import { analyses, attempts, mistakes, quotaUsage, user as userTable, userApiKeys, cards, lrAttempts, lrTests, emailLog } from './db/schema';
import { sendsIdle } from './auth-email';
import { auth } from './auth';
import { env } from './env';
import { keyCtx } from './ai/keyctx';
import { chatText, setFetch, speak, transcribe } from './ai/openrouter';
import { analyze, purgeGuests, recoverStale, setAnalyzer } from './jobs';
import { speakingLlm, sttWords, writingChat } from './ai/fixtures';
import { clearBalanceCache } from './community';
import { decryptKey, encryptKey } from './keys';
import { refundAttempt, reserve, windowOf, payerOf } from './quota';
import { hashIp } from './ip';
import { updateSettings } from './settings';
import { storage } from './storage';

const ESSAY = 'Many people has argued that technology makes life easier, and I strongly agree with this view for several reasons that I will explain in this short essay.';
let n = 0;
const ip = () => `203.0.113.${++n}`; // a fresh client address per test (the per-IP caps are in-memory/DB state)

beforeEach(() => setAnalyzer(async () => {}));
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

describe('windows', () => {
  it('daily windows reset at 00:00 UTC, weekly at Monday 00:00 UTC', () => {
    const d = (s: string) => new Date(s);
    expect(windowOf('community', d('2031-03-05T23:59:59.999Z'))).toMatchObject({ kind: 'day', start: d('2031-03-05T00:00:00Z'), resetAt: d('2031-03-06T00:00:00Z') });
    expect(windowOf('community', d('2031-03-06T00:00:00.000Z')).start).toEqual(d('2031-03-06T00:00:00Z'));
    expect(windowOf('community', d('2031-12-31T12:00:00Z')).resetAt).toEqual(d('2032-01-01T00:00:00Z'));
    // 2031-03-03 is a Monday
    expect(windowOf('guest', d('2031-03-03T00:00:00Z'))).toMatchObject({ kind: 'week', start: d('2031-03-03T00:00:00Z'), resetAt: d('2031-03-10T00:00:00Z') });
    expect(windowOf('guest', d('2031-03-09T23:59:59.999Z'))).toMatchObject({ start: d('2031-03-03T00:00:00Z'), resetAt: d('2031-03-10T00:00:00Z') }); // Sunday
    expect(windowOf('guest', d('2031-03-10T00:00:00Z')).start).toEqual(d('2031-03-10T00:00:00Z'));
  });

  it('a community user gets a fresh test at midnight UTC; a guest at Monday 00:00 UTC (fake time)', async () => {
    const nextMonday = new Date(windowOf('guest').resetAt.getTime() + 7 * 86_400_000); // a Monday at least a week out: sessions created after setSystemTime stay valid
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(nextMonday.getTime() - 3_600_000)); // Sunday 23:00 UTC
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const c = await testUser(undefined, { key: false });
    const g = await guestUser(ip());

    expect((await writing(c.headers, p)).submit!.status).toBe(200);
    expect((await writing(g.headers, p)).submit!.status).toBe(200);
    const blocked = await writing(c.headers, p);
    expect(blocked.create.status).toBe(429); // refused at create: before the essay
    expect(await body(blocked.create)).toMatchObject({ code: 'quota_exceeded', skill: 'writing', tier: 'community', resetAt: new Date(nextMonday.getTime()).toISOString() });
    expect((await writing(g.headers, p)).create.status).toBe(429);

    vi.setSystemTime(new Date(nextMonday.getTime() + 60_000)); // Monday 00:01 → both windows rolled (day and week)
    expect((await writing(c.headers, p)).submit!.status).toBe(200);
    expect((await writing(g.headers, p)).submit!.status).toBe(200);

    // later the same Monday: the community user's day has not rolled yet, the guest's week has not either
    vi.setSystemTime(new Date(nextMonday.getTime() + 12 * 3_600_000));
    expect((await writing(c.headers, p)).create.status).toBe(429);
    vi.setSystemTime(new Date(nextMonday.getTime() + 24 * 3_600_000 + 60_000)); // Tuesday 00:01
    expect((await writing(c.headers, p)).submit!.status).toBe(200);
    expect((await writing(g.headers, p)).create.status).toBe(429); // the guest's week runs to next Monday
  });
});

describe('reserve, refund, retry', () => {
  it('speaking and writing have separate quotas; GET /api/quota shows used / remaining / resetAt', async () => {
    const { headers } = await testUser(undefined, { key: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const s = await seedPrompt();
    expect(await quota(headers)).toMatchObject({
      tier: 'community',
      speaking: { used: 0, limit: 1, remaining: 1, window: 'day', blocked: null },
      writing: { used: 0, limit: 1, remaining: 1, window: 'day', blocked: null },
      liveProviders: [],
    });
    expect((await writing(headers, w)).submit!.status).toBe(200);
    const q = await quota(headers);
    expect(q.writing).toMatchObject({ used: 1, remaining: 0, blocked: 'quota_exceeded', resetAt: windowOf('community').resetAt.toISOString() });
    expect(q.speaking).toMatchObject({ used: 0, remaining: 1 });
    expect((await speaking(headers, s)).submit!.status).toBe(200);
    expect((await quota(headers)).speaking.remaining).toBe(0);
  });

  it('429 shape: code, skill, resetAt, tier', async () => {
    const { headers } = await testUser(undefined, { key: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    await writing(headers, w);
    const second = await writing(headers, w);
    expect(second.create.status).toBe(429);
    expect(await body(second.create)).toEqual({
      error: expect.stringContaining('Add your own OpenRouter key'),
      code: 'quota_exceeded',
      skill: 'writing',
      resetAt: windowOf('community').resetAt.toISOString(),
      tier: 'community',
    });
  });

  it('submitting the same attempt again never costs again (409), and the ledger has one row', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const { id } = await writing(headers, w);
    expect((await req(`/api/attempts/${id}/submit`, { headers, body: { text: ESSAY } })).status).toBe(409);
    expect(await rows(user.id)).toHaveLength(1);
    // reserving the same unit again is a no-op
    await reserve(await payerOf({ ...user, emailVerified: true, isAnonymous: false }), 'writing', id, null);
    expect(await rows(user.id)).toHaveLength(1);
  });

  it('a failed analysis refunds the test; retrying the same attempt reserves it again (one charge in total)', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
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
    const { headers, user } = await testUser(undefined, { key: false });
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
    const { headers } = await testUser(undefined, { key: false });
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
    const { headers, user } = await testUser(undefined, { key: false });
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
    const { headers, user } = await testUser(undefined, { key: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const { id } = await writing(headers, w);
    await db.update(attempts).set({ updatedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(attempts.id, id));
    await recoverStale();
    expect((await rows(user.id))[0]!.refundedAt).toBeInstanceOf(Date);
  });
});

describe('full tests count once', () => {
  it('three speaking parts of one session cost one test; the next session is refused', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    const [p1, p2, p3] = [await seedPrompt(), await seedPrompt({ part: 2, type: 'cue-card' }), await seedPrompt({ part: 3, type: 'p3-discussion' })];
    const sessionId = crypto.randomUUID();
    for (const [p, part] of [[p1, 1], [p2, 2], [p3, 3]] as const) expect((await speaking(headers, p, { sessionId }, part)).submit!.status).toBe(200);
    expect(await rows(user.id)).toHaveLength(1);
    expect((await quota(headers)).speaking).toMatchObject({ used: 1, remaining: 0 });
    expect((await speaking(headers, p1, { sessionId: crypto.randomUUID() })).create.status).toBe(429);
  });

  it('writing task 1 + task 2 of one session cost one test', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    const t1 = await seedPrompt({ skill: 'writing', part: 1, variant: 'academic', type: 'bar' });
    const t2 = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const sessionId = crypto.randomUUID();
    expect((await writing(headers, t1, { sessionId, part: 1 })).submit!.status).toBe(200);
    expect((await writing(headers, t2, { sessionId })).submit!.status).toBe(200); // create passes the check too: the unit is paid
    expect(await rows(user.id)).toHaveLength(1);
  });

  it('reusing one sessionId for the same part again is a new test, so it cannot bundle unlimited tests', async () => {
    const { headers } = await testUser(undefined, { key: false });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const sessionId = crypto.randomUUID();
    expect((await writing(headers, p, { sessionId })).submit!.status).toBe(200);
    const again = await writing(headers, p, { sessionId });
    expect(again.create.status).toBe(429);
  });

  it('a session refunds only when no other part of it still counts', async () => {
    const { user } = await testUser(undefined, { key: false });
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
    expect(await body(second.create)).toMatchObject({ code: 'quota_exceeded', tier: 'guest', skill: 'writing', resetAt: windowOf('guest').resetAt.toISOString() });
    expect((await quota(g.headers)).writing).toMatchObject({ window: 'week', used: 1, remaining: 0 });

    expect((await req(`/api/attempts/${first.id}`, { headers: g.headers })).status).toBe(200); // the result page right after the test
    expect(((await (await req('/api/attempts', { headers: g.headers })).json()) as any).items).toHaveLength(1); // a guest's own short recent list is open (capped); the full pages are not
    for (const path of ['/api/mistakes', '/api/cards/due', '/api/progress'])
      expect(await (async () => { const r = await req(path, { headers: g.headers }); return [r.status, (await r.json() as any).code]; })()).toEqual([403, 'account_required']);
    expect((await req('/api/settings', { method: 'PUT', headers: g.headers, body: { targetBand: 8 } })).status).toBe(403);
    expect((await req('/api/keys', { headers: g.headers })).status).toBe(403);
  });

  it('GET /api/me for a guest: anonymous, no email, no live', async () => {
    const g = await guestUser(ip());
    const me = (await (await req('/api/me', { headers: g.headers })).json()) as any;
    expect(me).toMatchObject({ user: { isAnonymous: true, email: '' }, tier: 'guest', liveProviders: [], gptLiveAvailable: false, geminiLiveAvailable: false, cambridgeAccess: false });
    expect(me.speaking).toMatchObject({ limit: 1, window: 'week' });
  });

  it('GET /api/quota works without any session (a guest by IP)', async () => {
    expect(await quota()).toMatchObject({ tier: 'guest', speaking: { limit: 1, remaining: 1, window: 'week' }, writing: { limit: 1, remaining: 1 }, liveProviders: [] });
  });

  it('per-IP cap: 3 guests per skill per IP per week, then the 4th anonymous user is refused; another IP is unaffected', async () => {
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const addr = ip();
    for (let i = 0; i < env.GUEST_IP_WEEKLY_CAP; i++) expect((await writing((await guestUser(addr)).headers, p)).submit!.status).toBe(200);
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
    for (let i = 0; i < env.GUEST_IP_WEEKLY_CAP - 1; i++) await writing((await guestUser(addr)).headers, p);
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
    const existing = await testUser(undefined, { key: false });
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

describe('own keys', () => {
  const store = (fetch: ReturnType<typeof fakeFetch>) => setFetch(fetch);
  const put = (headers: Headers, provider: string, key: string) => req(`/api/keys/${provider}`, { method: 'PUT', headers, body: { key } });

  it('encrypts with AES-256-GCM: round trip, random IV per row, bound to user and provider', () => {
    const a = encryptKey('sk-or-v1-abcdef123456', 'u1', 'openrouter');
    const b = encryptKey('sk-or-v1-abcdef123456', 'u1', 'openrouter');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(Buffer.from(a.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(a.ciphertext, 'base64').toString('latin1')).not.toContain('abcdef');
    expect(decryptKey(a, 'u1', 'openrouter')).toBe('sk-or-v1-abcdef123456');
    expect(() => decryptKey(a, 'u2', 'openrouter')).toThrow(); // a row copied to another user
    expect(() => decryptKey(a, 'u1', 'openai')).toThrow();
    const tampered = { ...a, ciphertext: flip(a.ciphertext) };
    expect(() => decryptKey(tampered, 'u1', 'openrouter')).toThrow();
  });

  it('PUT validates with the provider (their key in the right header), stores it encrypted, and never returns or logs it', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { headers, user } = await testUser(undefined, { key: false });
    const f = fakeFetch({ '/api/v1/key': () => json({ data: {} }), '/v1/models': () => json({ data: [] }), '/v1beta/models': () => json({ models: [] }) });
    store(f);
    const secrets = { openrouter: 'sk-or-v1-SECRETSECRET1111', openai: 'sk-proj-SECRETSECRET2222', gemini: 'AIzaSECRETSECRET3333' };
    const out: string[] = [];
    for (const [provider, key] of Object.entries(secrets)) {
      const r = await put(headers, provider, key);
      expect(r.status).toBe(200);
      const text = JSON.stringify(await r.json());
      out.push(text);
      expect(JSON.parse(text)).toEqual({ provider, last4: key.slice(-4), addedAt: expect.any(String), valid: true });
    }
    expect(f.calls.map((c) => c.url)).toEqual(['https://openrouter.ai/api/v1/key', 'https://api.openai.com/v1/models', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1']);
    expect(f.calls[0]!.headers.authorization).toBe(`Bearer ${secrets.openrouter}`);
    expect(f.calls[1]!.headers.authorization).toBe(`Bearer ${secrets.openai}`);
    expect(f.calls[2]!.headers['x-goog-api-key']).toBe(secrets.gemini);
    expect(f.calls[2]!.url).not.toContain(secrets.gemini); // never in a URL

    const list = await (await req('/api/keys', { headers })).text();
    out.push(list);
    expect(JSON.parse(list).keys.map((k: any) => k.provider)).toEqual(['openrouter', 'openai', 'gemini']);
    for (const s of Object.values(secrets)) {
      for (const o of out) expect(o).not.toContain(s);
      expect(JSON.stringify(await db.select().from(userApiKeys))).not.toContain(s); // at rest: ciphertext only
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(s);
    }
    expect(await db.select().from(userApiKeys).where(eq(userApiKeys.userId, user.id))).toHaveLength(3);
    // replacing a key overwrites the row
    expect((await put(headers, 'openai', 'sk-proj-OTHERKEY9999')).status).toBe(200);
    expect(await db.select().from(userApiKeys).where(and(eq(userApiKeys.userId, user.id), eq(userApiKeys.provider, 'openai')))).toHaveLength(1);
    spies.forEach((s) => s.mockRestore());
  });

  it('PUT: a key the provider rejects (401/403, Gemini 400) is refused with invalid_key and nothing is saved; an unreachable provider is 502', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    for (const status of [401, 403]) {
      store(fakeFetch({ '/api/v1/key': () => json({ error: 'no' }, status) }));
      const r = await put(headers, 'openrouter', 'sk-or-badbadbadbad');
      expect(r.status).toBe(400);
      expect(await body(r)).toMatchObject({ code: 'invalid_key', error: expect.stringContaining('OpenRouter') });
    }
    store(fakeFetch({ '/v1beta/models': () => json({ error: { message: 'API key not valid' } }, 400) }));
    expect((await put(headers, 'gemini', 'AIza-bad-bad-bad')).status).toBe(400);
    store(fakeFetch({ '/v1/models': () => json({}, 503) }));
    const down = await put(headers, 'openai', 'sk-proj-whatever1234');
    expect([down.status, (await body(down)).code]).toEqual([502, 'key_check_failed']);
    store(fakeFetch({}));
    expect((await put(headers, 'openai', 'sk-proj-whatever1234')).status).toBe(502); // network-level failure (599 from the stub)
    expect(await db.select().from(userApiKeys).where(eq(userApiKeys.userId, user.id))).toHaveLength(0);
  });

  it('PUT: validates the body, requires an account, and is unavailable without KEY_ENCRYPTION_SECRET in production', async () => {
    const { headers } = await testUser(undefined, { key: false });
    store(fakeFetch({ '/api/v1/key': () => json({ data: {} }) }));
    expect((await put(headers, 'openrouter', 'short')).status).toBe(400);
    expect((await put(headers, 'openrouter', 'has a space in it')).status).toBe(400);
    expect((await put(headers, 'mistral', 'sk-whatever12345')).status).toBe(400);
    expect((await req('/api/keys/openrouter', { method: 'PUT', body: { key: 'sk-or-whatever1234' } })).status).toBe(401);
    const g = await guestUser();
    const r = await put(g.headers, 'openrouter', 'sk-or-whatever1234');
    expect([r.status, (await body(r)).code]).toEqual([403, 'account_required']);

    const before = [env.NODE_ENV, env.KEY_ENCRYPTION_SECRET] as const;
    env.NODE_ENV = 'production';
    try {
      const off = await put(headers, 'openrouter', 'sk-or-whatever1234');
      expect([off.status, (await body(off)).code]).toEqual([503, 'keys_unavailable']);
      env.KEY_ENCRYPTION_SECRET = 'a-real-secret-for-the-test-0000';
      expect((await put(headers, 'openrouter', 'sk-or-whatever1234')).status).toBe(200);
    } finally {
      [env.NODE_ENV, env.KEY_ENCRYPTION_SECRET] = before as [string, string | undefined];
    }
  });

  it('DELETE removes the key and returns the user to the community tier', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    store(fakeFetch({ '/api/v1/key': () => json({ data: {} }) }));
    await put(headers, 'openrouter', 'sk-or-v1-abcdefabcdef');
    expect((await quota(headers)).tier).toBe('own-key');
    expect((await req('/api/keys/openrouter', { method: 'DELETE', headers })).status).toBe(200);
    expect(await db.select().from(userApiKeys).where(eq(userApiKeys.userId, user.id))).toHaveLength(0);
    expect((await quota(headers)).tier).toBe('community');
    expect((await req('/api/keys/openrouter', { method: 'DELETE', headers })).status).toBe(200); // idempotent
  });

  it('deleting the account removes the keys', async () => {
    const { headers, user } = await testUser();
    expect(await db.select().from(userApiKeys).where(eq(userApiKeys.userId, user.id))).toHaveLength(1);
    await req('/api/auth/delete-user', { headers, body: { password: 'password1234' } });
    expect(await db.select().from(userApiKeys)).toHaveLength(0);
  });
});

describe('routing to the user key', () => {
  const auth = (f: ReturnType<typeof fakeFetch>, path: string) => f.calls.filter((c) => c.url.includes(path)).map((c) => c.headers.authorization);

  it('every OpenRouter call of an analysis (STT, scoring) uses the user key; community users use the server key', async () => {
    const mine = await testUser(undefined, { key: false });
    await setKey(mine.user.id, 'openrouter', 'sk-or-USERKEY-0001');
    const other = await testUser(undefined, { key: false });
    const p = await seedPrompt();
    setAnalyzer(analyze);
    for (const [who, expected] of [[mine, 'Bearer sk-or-USERKEY-0001'], [other, 'Bearer test-openrouter']] as const) {
      const f = fakeFetch({ '/audio/transcriptions': () => json(sttWords), '/chat/completions': speakingChat });
      setFetch(f);
      const { id } = await speaking(who.headers, p);
      await settled(id, 'done');
      const used = [...auth(f, '/audio/transcriptions'), ...auth(f, '/chat/completions')];
      expect(used.length).toBeGreaterThan(2);
      expect(new Set(used)).toEqual(new Set([expected]));
    }
  });

  it('turn-based live primitives (STT, LLM, TTS) use the key in the request context', async () => {
    const f = fakeFetch({
      '/audio/transcriptions': () => json({ text: 'hi', duration: 1, words: [] }),
      '/chat/completions': () => chatReply('ok'),
      '/audio/speech': () => new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'audio/mpeg' } }),
    });
    setFetch(f);
    await keyCtx.run({ openrouter: 'sk-or-CTXKEY-0002' }, async () => {
      await transcribe({ model: 'openai/whisper-large-v3', audio: new Uint8Array([1]), format: 'webm' });
      await chatText({ model: 'a/b', messages: [{ role: 'user', content: 'x' }] });
      await speak({ model: 'openai/tts', voice: 'alloy', text: 'Hello.' });
    });
    expect(f.calls).toHaveLength(3);
    expect(new Set(f.calls.map((c) => c.headers.authorization))).toEqual(new Set(['Bearer sk-or-CTXKEY-0002']));
  });

  it('ElevenLabs Scribe stays on the server key for community users; users with their own OpenRouter key use Whisper on their key', async () => {
    env.ELEVENLABS_API_KEY = 'xi-owner';
    try {
      const eleven = fakeFetch({ 'api.elevenlabs.io': () => json({ words: [{ text: 'Hi', start: 0, end: 0.4, type: 'word' }] }), '/audio/transcriptions': () => json({ text: 'hi', duration: 1, words: [] }) });
      setFetch(eleven);
      const scribe = (key?: string) => keyCtx.run({ openrouter: key }, () => transcribe({ model: 'elevenlabs/scribe_v2', audio: new Uint8Array([1]), format: 'webm' }));
      expect((await scribe()).model).toBe('elevenlabs/scribe_v2');
      expect(eleven.calls.map((c) => c.url)).toEqual(['https://api.elevenlabs.io/v1/speech-to-text']);
      eleven.calls.length = 0;
      expect((await scribe('sk-or-OWN-0003')).model).toBe('openai/whisper-large-v3');
      expect(eleven.calls.some((c) => c.url.includes('elevenlabs'))).toBe(false);
      expect(eleven.calls.every((c) => c.headers.authorization === 'Bearer sk-or-OWN-0003')).toBe(true);
    } finally {
      env.ELEVENLABS_API_KEY = undefined;
    }
  });

  it('community analysis always runs on the default models; a custom model applies only on the user\'s own key', async () => {
    const community = await testUser(undefined, { key: false });
    const own = await testUser();
    for (const u of [community, own]) await updateSettings(u.user.id, { models: { analysis: 'custom/model-x' } });
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    setAnalyzer(analyze);
    const modelsUsed = async (who: typeof own) => {
      const f = fakeFetch({ '/chat/completions': writingChat() });
      setFetch(f);
      const { id } = await writing(who.headers, p);
      await settled(id, 'done');
      return new Set(f.calls.filter((c) => c.url.includes('/chat/completions')).map((c) => c.body.model));
    };
    expect([...(await modelsUsed(community))]).toEqual(['openai/gpt-6-luna']);
    expect([...(await modelsUsed(own))]).toEqual(['custom/model-x']);
  });

  it('a user key the provider rejects is flagged invalid, the attempt fails with a clear message, and the user is a community user again', async () => {
    const { headers, user } = await testUser();
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    setAnalyzer(analyze);
    setFetch(fakeFetch({ '/chat/completions': () => json({ error: { message: 'No auth' } }, 401) }));
    const { id } = await writing(headers, p);
    await settled(id, 'failed');
    expect((await db.query.attempts.findFirst({ where: eq(attempts.id, id) }))!.error).toContain('OpenRouter key was rejected');
    await vi.waitFor(async () => expect((await db.select().from(userApiKeys).where(eq(userApiKeys.userId, user.id)))[0]!.valid).toBe(false));
    expect(((await (await req('/api/keys', { headers })).json()) as any).keys[0]).toMatchObject({ provider: 'openrouter', valid: false });
    expect((await quota(headers)).tier).toBe('community');
  });

  it('the user\'s key never reaches logs or stored errors when the provider fails', async () => {
    const spies = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { headers, user } = await testUser(undefined, { key: false });
    await setKey(user.id, 'openrouter', 'sk-or-LEAKYKEY-0004');
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    setAnalyzer(analyze);
    setFetch(fakeFetch({ '/chat/completions': () => new Response('Incorrect API key provided: sk-or-LEAKYKEY-0004', { status: 402 }) }));
    const { id } = await writing(headers, p);
    await settled(id, 'failed');
    const a = await db.query.attempts.findFirst({ where: eq(attempts.id, id) });
    expect(JSON.stringify(a)).not.toContain('LEAKYKEY');
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('LEAKYKEY');
    spies.forEach((s) => s.mockRestore());
  });
});

describe('live access', () => {
  const live = async (headers: Headers) => ((await (await req('/api/me', { headers })).json()) as any);

  it('liveProviders follow the keys: turn-based needs OpenRouter, GPT-Live OpenAI, Gemini Live Gemini', async () => {
    const community = await testUser(undefined, { key: false });
    expect(await live(community.headers)).toMatchObject({ liveProviders: [], gptLiveAvailable: false, geminiLiveAvailable: false, realtimeAvailable: false });
    await setKey(community.user.id, 'openai');
    expect(await live(community.headers)).toMatchObject({ tier: 'community', liveProviders: ['gpt-live'], gptLiveAvailable: true, realtimeAvailable: true, geminiLiveAvailable: false });
    await setKey(community.user.id, 'gemini');
    expect((await live(community.headers)).liveProviders).toEqual(['gpt-live', 'gemini-live']);
    await setKey(community.user.id, 'openrouter');
    expect(await live(community.headers)).toMatchObject({ tier: 'own-key', liveProviders: ['turn', 'gpt-live', 'gemini-live'] });

    const orOnly = await testUser();
    expect(await live(orOnly.headers)).toMatchObject({ tier: 'own-key', liveProviders: ['turn'], gptLiveAvailable: false, geminiLiveAvailable: false });
  });

  it('server-wide OPENAI_API_KEY / GEMINI_API_KEY no longer unlock live for ordinary users; the owner may use them', async () => {
    env.OPENAI_API_KEY = 'sk-server';
    env.GEMINI_API_KEY = 'g-server';
    try {
      const ordinary = await testUser();
      expect(await live(ordinary.headers)).toMatchObject({ gptLiveAvailable: false, geminiLiveAvailable: false });
      const owner = await testUser('soyebjim@gmail.com', { key: false });
      expect(await live(owner.headers)).toMatchObject({ tier: 'own-key', gptLiveAvailable: true, geminiLiveAvailable: true, liveProviders: ['turn', 'gpt-live', 'gemini-live'] });
    } finally {
      env.OPENAI_API_KEY = env.GEMINI_API_KEY = undefined;
    }
  });

  it('403 live_requires_own_key on every live entry point for guests and community users', async () => {
    for (const u of [await guestUser(), await testUser(undefined, { key: false })]) {
      for (const [path, payload] of [
        ['/api/live/start', {}],
        ['/api/live/start', { skipTts: true }],
        ['/api/live/turn', { sessionId: 'x' }],
        ['/api/live/gpt-live/session', { sessionId: 'x', sdp: 'v=0' }],
        ['/api/live/gemini-token', { sessionId: 'x' }],
      ] as const) {
        const r = await req(path, { headers: u.headers, body: payload });
        expect([path, r.status, (await body(r)).code]).toEqual([path, 403, 'live_requires_own_key']);
      }
    }
  });
});

describe('community balance', () => {
  it('GET /api/community/balance is public and maps limit / usage / limit_remaining', async () => {
    setFetch(balanceFetch({ limit: 20, usage: 7.6, limit_remaining: 12.4 }));
    const r = await req('/api/community/balance');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ limit: 20, used: 7.6, remaining: 12.4, updatedAt: expect.any(String) });
  });

  it('is cached for 60 seconds, then refreshed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    const f = balanceFetch({ limit: 20, usage: 5, limit_remaining: 15 });
    setFetch(f);
    for (let i = 0; i < 5; i++) await req('/api/community/balance');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.headers.authorization).toBe('Bearer test-openrouter'); // the server's key
    vi.setSystemTime(new Date('2031-01-01T00:00:59Z'));
    await req('/api/community/balance');
    expect(f.calls).toHaveLength(1);
    vi.setSystemTime(new Date('2031-01-01T00:01:01Z'));
    await req('/api/community/balance');
    expect(f.calls).toHaveLength(2);
  });

  it('derives remaining when only limit and usage are given; null limit means unlimited', async () => {
    setFetch(balanceFetch({ limit: 10, usage: 4 }));
    expect(await (await req('/api/community/balance')).json()).toMatchObject({ limit: 10, used: 4, remaining: 6 });
    clearBalanceCache();
    setFetch(balanceFetch({ limit: null, usage: 4, limit_remaining: null }));
    expect(await (await req('/api/community/balance')).json()).toMatchObject({ limit: null, used: 4, remaining: null });
  });

  it('serves the last known value when OpenRouter is unreachable; with none, shows nulls and blocks nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setFetch(balanceFetch(500));
    expect(await (await req('/api/community/balance')).json()).toMatchObject({ limit: null, used: null, remaining: null });
    const { headers } = await testUser(undefined, { key: false });
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    expect((await writing(headers, w)).submit!.status).toBe(200); // fail open
    setFetch(balanceFetch({ limit: 20, usage: 5, limit_remaining: 15 }));
    vi.setSystemTime(new Date('2031-01-01T00:02:00Z'));
    expect((await (await req('/api/community/balance')).json() as any).remaining).toBe(15);
    setFetch(balanceFetch(500));
    vi.setSystemTime(new Date('2031-01-01T00:04:00Z'));
    expect((await (await req('/api/community/balance')).json() as any).remaining).toBe(15); // stale, not nothing
    spy.mockRestore();
  });

  it('below COMMUNITY_MIN_BALANCE community tests are refused with 402; own-key users and the owner are not affected', async () => {
    setFetch(balanceFetch({ limit: 20, usage: 19.9, limit_remaining: 0.1 }));
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const community = await testUser(undefined, { key: false });
    const guest = await guestUser(ip());
    for (const u of [community, guest]) {
      const r = await writing(u.headers, w);
      expect(r.create.status).toBe(402);
      expect(await body(r.create)).toMatchObject({ code: 'community_balance_exhausted', error: expect.stringContaining('OpenRouter key') });
      expect((await quota(u.headers)).writing).toMatchObject({ blocked: 'community_balance_exhausted' });
    }
    expect((await quota(community.headers)).communityBalance).toMatchObject({ remaining: 0.1 });
    expect((await writing((await testUser()).headers, w)).submit!.status).toBe(200);
    expect((await writing((await testUser('soyebjim@gmail.com', { key: false })).headers, w)).submit!.status).toBe(200);
    // exactly at the floor is allowed
    clearBalanceCache();
    setFetch(balanceFetch({ limit: 20, usage: 19.75, limit_remaining: env.COMMUNITY_MIN_BALANCE }));
    expect((await writing(community.headers, w)).submit!.status).toBe(200);
  });

  it('the balance can run out between create and submit: 402 and the draft is kept', async () => {
    const { headers } = await testUser(undefined, { key: false });
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
  it('COMMUNITY_MAX_PER_HOUR: past it everyone on the community balance gets a friendly 503 busy; own-key users are unaffected', async () => {
    const before = env.COMMUNITY_MAX_PER_HOUR;
    env.COMMUNITY_MAX_PER_HOUR = 2;
    try {
      const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
      expect((await writing((await testUser(undefined, { key: false })).headers, w)).submit!.status).toBe(200);
      expect((await writing((await guestUser(ip())).headers, w)).submit!.status).toBe(200);
      const late = await writing((await testUser(undefined, { key: false })).headers, w);
      expect(late.create.status).toBe(503);
      expect(await body(late.create)).toMatchObject({ code: 'community_busy', error: expect.stringContaining('try again') });
      expect((await quota((await testUser(undefined, { key: false })).headers)).writing.blocked).toBe('community_busy');
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
      const a = await testUser(undefined, { key: false });
      const { id } = await writing(a.headers, w);
      const [att] = await db.select().from(attempts).where(eq(attempts.id, id));
      await refundAttempt(att!);
      expect((await writing((await testUser(undefined, { key: false })).headers, w)).submit!.status).toBe(200);
    } finally {
      env.COMMUNITY_MAX_PER_HOUR = before;
    }
  });

  it('per-IP burst limit on creating attempts for community users and guests; own-key users are not limited', async () => {
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const addr = ip();
    const c = await testUser(undefined, { key: false });
    c.headers.set('CF-Connecting-IP', addr);
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await req('/api/attempts', { headers: c.headers, body: { promptId: w.id, skill: 'writing', part: 2 } })).status);
    expect(codes.slice(0, 20).every((s) => s === 201)).toBe(true);
    const limited = await req('/api/attempts', { headers: c.headers, body: { promptId: w.id, skill: 'writing', part: 2 } });
    expect([limited.status, (await body(limited)).code]).toEqual([429, 'too_many_requests']);
    // the address is the key: another community user behind the same address is limited too
    const c2 = await testUser(undefined, { key: false });
    c2.headers.set('CF-Connecting-IP', addr);
    expect((await req('/api/attempts', { headers: c2.headers, body: { promptId: w.id, skill: 'writing', part: 2 } })).status).toBe(429);
    const own = await testUser();
    own.headers.set('CF-Connecting-IP', addr);
    expect((await req('/api/attempts', { headers: own.headers, body: { promptId: w.id, skill: 'writing', part: 2 } })).status).toBe(201);
  });
});

describe('owner and own-key exemption', () => {
  it('the verified owner and own-key users have no limit; an unverified owner address gets none', async () => {
    const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const owner = await testUser('soyebjim@gmail.com', { key: false });
    expect(await quota(owner.headers)).toMatchObject({ tier: 'own-key', speaking: { limit: null, remaining: null, resetAt: null, window: null, blocked: null }, writing: { limit: null } });
    for (let i = 0; i < 3; i++) expect((await writing(owner.headers, w)).submit!.status).toBe(200);
    expect(await rows(owner.user.id)).toHaveLength(0); // nothing to count

    const own = await testUser();
    for (let i = 0; i < 3; i++) expect((await writing(own.headers, w)).submit!.status).toBe(200);

    const other = await testUser('someone@gmail.com', { key: false });
    expect((await quota(other.headers)).tier).toBe('community');
  });

  it('an allow-listed address that is not verified is not the owner', async () => {
    const spoof = await testUser('SoyebJim@Gmail.com', { key: false, verified: false });
    expect((await quota(spoof.headers)).tier).toBe('community');
  });
});

// ---- helpers used above ----
const flip = (b64: string) => { const b = Buffer.from(b64, 'base64'); b[0] = b[0]! ^ 1; return b.toString('base64'); };
async function settled(id: string, status: 'done' | 'failed') {
  await vi.waitFor(async () => expect((await db.query.attempts.findFirst({ where: eq(attempts.id, id) }))!.status).toBe(status), { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 30)); // refund / flag writes that follow the status update
}
const speakingChat = (_: string, init: RequestInit) => {
  const b = JSON.parse(String(init.body));
  if (b.response_format?.json_schema?.name !== 'criterion_score') return chatReply(speakingLlm);
  return chatReply({ checks: [], evidence: [], descriptor: '', summary: '', injection: false, band: 6 });
};
