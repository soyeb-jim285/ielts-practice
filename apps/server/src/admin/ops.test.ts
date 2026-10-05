import { readFileSync } from 'node:fs';
import { fakeFetch, guestUser, req, seedPrompt, testUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LrTest } from '@ielts/core';
import { setFetch } from '../ai/openrouter';
import { isCambridgeAllowed, OWNER_EMAILS } from '../auth';
import { clearBalanceCache } from '../community';
import { db } from '../db/client';
import { attempts, cambridgeAccess, emailLog, lrAttempts, lrTests } from '../db/schema';
import { env } from '../env';
import { setAnalyzer } from '../jobs';
import { clearCostsCache } from './costs';

const OWNER = OWNER_EMAILS[0]!;
const OR_KEY = env.OPENROUTER_API_KEY;
const XI_KEY = 'xi-test-secret-key';
const body = async (r: Response) => (await r.json()) as any;
const ago = (min: number) => new Date(Date.now() - min * 60_000);

const orKey = (d: Record<string, unknown>) => () => Response.json({ data: d });
const xiSub = (d: Record<string, unknown>) => () => Response.json(d);

beforeEach(() => {
  clearCostsCache();
  clearBalanceCache();
  (env as { ELEVENLABS_API_KEY?: string }).ELEVENLABS_API_KEY = undefined;
});

describe('non-owners get 404 on every ops endpoint', () => {
  it('anonymous, guest and ordinary user', async () => {
    const u = await testUser();
    const g = await guestUser();
    const calls: [string, string, unknown?][] = [['GET', '/api/admin/costs'], ['GET', '/api/admin/health'], ['POST', '/api/admin/attempts/x/retry'], ['POST', `/api/admin/users/${u.user.id}/cambridge`, { granted: true }]];
    for (const [method, path, b] of calls) for (const headers of [undefined, g.headers, u.headers]) expect((await req(path, { method, headers, body: b })).status).toBe(404);
  });
});

describe('costs', () => {
  it('reports both upstreams, warns by level and never leaks a key', async () => {
    (env as { ELEVENLABS_API_KEY?: string }).ELEVENLABS_API_KEY = XI_KEY;
    const f = fakeFetch({
      'openrouter.ai': orKey({ limit: 10, usage: 9, limit_remaining: 1, usage_daily: 0.5, usage_weekly: 2, usage_monthly: 9 }), // 1 < 4 * 0.25 is false -> ok; see below
      'elevenlabs.io': xiSub({ tier: 'creator', character_count: 96_000, character_limit: 100_000, next_character_count_reset_unix: 1_800_000_000 }),
    });
    setFetch(f);
    const o = await testUser(OWNER);
    const r = await req('/api/admin/costs', { headers: o.headers });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(OR_KEY);
    expect(text).not.toContain(XI_KEY);
    const b = JSON.parse(text);
    expect(b.openrouter).toMatchObject({ available: true, limit: 10, usage: 9, remaining: 1, usageDaily: 0.5, usageWeekly: 2, usageMonthly: 9, warn: 'ok' });
    expect(b.elevenlabs).toMatchObject({ available: true, tier: 'creator', characterCount: 96_000, characterLimit: 100_000, remaining: 4_000, resetsAt: new Date(1_800_000_000_000).toISOString(), warn: 'critical' });
    expect(b.minBalance).toBe(env.COMMUNITY_MIN_BALANCE);
    expect(b.community.remaining).toBe(1);
    expect(b.warnings).toHaveLength(1);
    expect(b.warnings[0]).toContain('ElevenLabs');
    expect(f.calls.find((c) => c.url.includes('elevenlabs'))!.headers['xi-api-key']).toBe(XI_KEY);
  });

  it('OpenRouter low and critical thresholds, unlimited key is ok, ElevenLabs skipped without a key', async () => {
    const o = await testUser(OWNER);
    const costs = async (d: Record<string, unknown>) => {
      clearCostsCache();
      clearBalanceCache();
      setFetch(fakeFetch({ 'openrouter.ai': orKey(d) }));
      return body(await req('/api/admin/costs', { headers: o.headers }));
    };
    const min = env.COMMUNITY_MIN_BALANCE;
    const crit = await costs({ limit: 10, usage: 9.9, limit_remaining: min / 2 });
    expect(crit.openrouter.warn).toBe('critical');
    expect(crit.warnings[0]).toContain('OpenRouter');
    expect((await costs({ limit: 10, usage: 9, limit_remaining: 3 * min })).openrouter.warn).toBe('low');
    const unlimited = await costs({ limit: null, usage: 3, limit_remaining: null });
    expect(unlimited.openrouter).toMatchObject({ warn: 'ok', remaining: null });
    expect(unlimited.warnings).toEqual([]);
    expect(unlimited.elevenlabs).toMatchObject({ available: false, warn: 'ok' });
  });

  it('caches 5 minutes, tolerates upstream failure and serves the last good value', async () => {
    (env as { ELEVENLABS_API_KEY?: string }).ELEVENLABS_API_KEY = XI_KEY;
    const o = await testUser(OWNER);
    const good = fakeFetch({ 'openrouter.ai': orKey({ limit: 10, usage: 1, limit_remaining: 9 }), 'elevenlabs.io': xiSub({ tier: 't', character_count: 1, character_limit: 100 }) });
    setFetch(good);
    await req('/api/admin/costs', { headers: o.headers });
    await req('/api/admin/costs', { headers: o.headers });
    expect(good.calls.filter((c) => c.url.includes('elevenlabs'))).toHaveLength(1);
    expect(good.calls.filter((c) => c.url.includes('/api/v1/key'))).toHaveLength(2); // one for costs, one for the community balance (its own 60 s cache); the second request added none

    clearBalanceCache();
    setFetch(fakeFetch({ 'openrouter.ai': () => new Response('secret upstream detail', { status: 500 }), 'elevenlabs.io': () => new Response('nope', { status: 500 }) }));
    const cached = await body(await req('/api/admin/costs', { headers: o.headers }));
    expect(cached.openrouter.available).toBe(true); // still inside the TTL

    clearCostsCache();
    const down = await req('/api/admin/costs', { headers: o.headers });
    expect(down.status).toBe(200);
    const d = await body(down);
    expect(d.openrouter).toMatchObject({ available: false, limit: null, usage: null, remaining: null, warn: 'ok' });
    expect(d.elevenlabs.available).toBe(false);
    expect(JSON.stringify(d)).not.toContain('secret upstream detail');
  });
});

describe('health', () => {
  it('lists failed and stuck analyses, failed emails and error counts', async () => {
    const o = await testUser(OWNER);
    const { user: u } = await testUser();
    const g = await guestUser();
    const p = await seedPrompt();
    const row = (extra: Partial<typeof attempts.$inferInsert>) => ({ userId: u.id, promptId: p.id, skill: 'speaking' as const, part: 1, audioKey: 'audio/x.webm', ...extra });
    const ins = async (extra: Partial<typeof attempts.$inferInsert>) => (await db.insert(attempts).values(row(extra)).returning())[0]!;
    const failed = await ins({ status: 'failed', error: 'Interrupted, retry', updatedAt: ago(30) });
    await ins({ status: 'failed', error: 'Interrupted, retry', errorRetryable: false, userId: g.user.id, updatedAt: ago(40) });
    await ins({ status: 'failed', error: 'Transcription failed', updatedAt: ago(60 * 24 * 3) }); // 3 days: listed, not in 24 h
    await ins({ status: 'failed', error: 'old', updatedAt: ago(60 * 24 * 9) }); // outside 7 days
    const stuck = await ins({ status: 'analyzing', stage: 'analyzing', updatedAt: ago(15) });
    await ins({ status: 'analyzing', updatedAt: ago(2) }); // healthy
    await ins({ status: 'done' });
    await db.insert(emailLog).values([
      { email: 'a@x.com', purpose: 'forget-password', status: 'failed', error: 'rejected', attempts: 2 },
      { email: 'b@x.com', purpose: 'email-verification', status: 'sent' },
      { email: 'c@x.com', purpose: 'email-verification', status: 'failed', error: 'network', createdAt: ago(60 * 24 * 3) },
    ]);

    const b = await body(await req('/api/admin/health', { headers: o.headers }));
    expect(b.counts).toEqual({ failed24h: 2, stuckAnalyzing: 1, emailFailed24h: 1 });
    expect(b.attempts).toHaveLength(4);
    expect(b.attempts.map((a: any) => a.id).slice(0, 2)).toEqual([stuck.id, failed.id]); // newest update first
    const st = b.attempts.find((a: any) => a.id === stuck.id);
    expect(st).toMatchObject({ status: 'analyzing', stage: 'analyzing', canRetry: true, resultPath: `/speaking/result/${stuck.id}`, email: expect.any(String) });
    expect(st.ageMin).toBeGreaterThanOrEqual(15);
    const guest = b.attempts.find((a: any) => a.isGuest);
    expect(guest).toMatchObject({ email: '', errorRetryable: false });
    expect(b.emailFailures.map((e: any) => e.email)).toEqual(['a@x.com', 'c@x.com']);
    expect(b.emailFailures[0]).toMatchObject({ purpose: 'forget-password', error: 'rejected', attempts: 2 });
    expect(b.recentErrors).toEqual([
      { error: 'Interrupted, retry', count: 2, lastAt: expect.any(String) },
      { error: 'Transcription failed', count: 1, lastAt: expect.any(String) },
    ]);
  });

  it('canRetry is false without input', async () => {
    const o = await testUser(OWNER);
    const { user: u } = await testUser();
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    await db.insert(attempts).values({ userId: u.id, promptId: p.id, skill: 'writing', part: 2, status: 'failed', error: 'x' });
    expect((await body(await req('/api/admin/health', { headers: o.headers }))).attempts[0].canRetry).toBe(false);
  });
});

describe('retry', () => {
  let analyzed: string[];
  beforeEach(() => {
    analyzed = [];
    setAnalyzer(async (id) => void analyzed.push(id));
  });

  it('restarts a failed attempt for any user, without touching quota', async () => {
    const o = await testUser(OWNER);
    const { user: u } = await testUser();
    const p = await seedPrompt();
    const [a] = await db.insert(attempts).values({ userId: u.id, promptId: p.id, skill: 'speaking', part: 1, audioKey: 'audio/x.webm', status: 'failed', error: 'boom', errorRetryable: false, stage: 'analyzing', partial: { a: 1 } }).returning();
    const r = await req(`/api/admin/attempts/${a!.id}/retry`, { method: 'POST', headers: o.headers });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ id: a!.id, status: 'analyzing' });
    expect(analyzed).toEqual([a!.id]);
    const after = await db.query.attempts.findFirst({ where: eq(attempts.id, a!.id) });
    expect(after).toMatchObject({ status: 'analyzing', error: null, errorRetryable: true, stage: null, partial: null });
    expect((await req(`/api/admin/attempts/${a!.id}/retry`, { method: 'POST', headers: o.headers })).status).toBe(409); // now fresh analyzing
  });

  it('retries an analysis stuck for over 10 minutes', async () => {
    const o = await testUser(OWNER);
    const { user: u } = await testUser();
    const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const [a] = await db.insert(attempts).values({ userId: u.id, promptId: p.id, skill: 'writing', part: 2, text: 'essay', status: 'analyzing', updatedAt: ago(11) }).returning();
    expect((await req(`/api/admin/attempts/${a!.id}/retry`, { method: 'POST', headers: o.headers })).status).toBe(202);
  });

  it('404 unknown, 409 done / recent analyzing / no input', async () => {
    const o = await testUser(OWNER);
    const { user: u } = await testUser();
    const sp = await seedPrompt();
    const wp = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
    const mk = async (v: Partial<typeof attempts.$inferInsert>) => (await db.insert(attempts).values({ userId: u.id, promptId: sp.id, skill: 'speaking', part: 1, ...v }).returning())[0]!.id;
    expect((await req('/api/admin/attempts/nope/retry', { method: 'POST', headers: o.headers })).status).toBe(404);
    for (const id of [
      await mk({ audioKey: 'audio/x', status: 'done' }),
      await mk({ audioKey: 'audio/x', status: 'analyzing' }),
      await mk({ status: 'failed' }), // speaking, no audio
      await mk({ promptId: wp.id, skill: 'writing', part: 2, status: 'failed' }), // writing, no text
    ]) {
      const r = await req(`/api/admin/attempts/${id}/retry`, { method: 'POST', headers: o.headers });
      expect(r.status).toBe(409);
      expect((await body(r)).error).toEqual(expect.any(String));
    }
    expect(analyzed).toEqual([]);
  });
});

describe('cambridge toggle', () => {
  const toggle = (headers: Headers, id: string, granted: boolean) => req(`/api/admin/users/${id}/cambridge`, { headers, body: { granted } });

  it('grants and revokes, effective at once for isCambridgeAllowed', async () => {
    const o = await testUser(OWNER);
    const { user: u } = await testUser('learner@test.dev');
    const me = { email: u.email, emailVerified: true };
    expect(isCambridgeAllowed(me)).toBe(false);

    const on = await toggle(o.headers, u.id, true);
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ allowed: true, source: 'granted', canToggle: true });
    expect(isCambridgeAllowed(me)).toBe(true);
    expect((await db.select().from(cambridgeAccess))[0]).toMatchObject({ email: 'learner@test.dev', grantedBy: OWNER });
    expect((await toggle(o.headers, u.id, true)).status).toBe(200); // idempotent

    const off = await toggle(o.headers, u.id, false);
    expect(await off.json()).toEqual({ allowed: false, source: null, canToggle: true });
    expect(isCambridgeAllowed(me)).toBe(false);
    expect(await db.select().from(cambridgeAccess)).toEqual([]);
  });

  it('env-managed emails answer 409, guests and unknown ids 404', async () => {
    const o = await testUser(OWNER);
    const cfg = await testUser(env.CAMBRIDGE_ALLOWED_EMAILS[0]!);
    for (const id of [o.user.id, cfg.user.id]) {
      const r = await toggle(o.headers, id, false);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: 'Managed in server config' });
    }
    expect((await toggle(o.headers, (await guestUser()).user.id, true)).status).toBe(404);
    expect((await toggle(o.headers, 'nope', true)).status).toBe(404);
  });
});

describe('owner bypass on result endpoints', () => {
  const fixture = JSON.parse(readFileSync(new URL('../test/fixtures/lr/lr-reading.json', import.meta.url), 'utf8')) as LrTest;

  async function setup() {
    const o = await testUser(OWNER);
    const learner = await testUser();
    const other = await testUser();
    const p = await seedPrompt();
    const [a] = await db.insert(attempts).values({ userId: learner.user.id, promptId: p.id, skill: 'speaking', part: 1, audioKey: `audio/${learner.user.id}/a.webm`, status: 'done' }).returning();
    const [t] = await db.insert(lrTests).values({ slug: fixture.slug, skill: fixture.skill, variant: fixture.variant, source: 'cambridge', ref: fixture.ref, title: fixture.title, data: fixture, restricted: true }).returning();
    const [lr] = await db.insert(lrAttempts).values({ userId: learner.user.id, testId: t!.id, mode: 'practice' }).returning();
    return { o, learner, other, a: a!, lr: lr! };
  }

  it("the owner opens another user's speaking attempt (audio included) and its status", async () => {
    const { o, a } = await setup();
    const r = await req(`/api/attempts/${a.id}`, { headers: o.headers });
    expect(r.status).toBe(200);
    const b = await body(r);
    expect(b.id).toBe(a.id);
    expect(b.audioUrl).toContain(a.audioKey);
    expect(b).not.toHaveProperty('userId');
    expect(b).not.toHaveProperty('email');
    expect((await req(`/api/attempts/${a.id}/status`, { headers: o.headers })).status).toBe(200);
    expect((await req('/api/attempts/nope', { headers: o.headers })).status).toBe(404);
  });

  it("the owner opens another user's Listening/Reading attempt, even of a Cambridge test", async () => {
    const { o, lr } = await setup();
    const r = await req(`/api/lr/attempts/${lr.id}`, { headers: o.headers });
    expect(r.status).toBe(200);
    expect((await body(r)).id).toBe(lr.id);
  });

  it('an ordinary user still cannot read or change somebody else’s results', async () => {
    const { other, a, lr } = await setup();
    for (const path of [`/api/attempts/${a.id}`, `/api/attempts/${a.id}/status`, `/api/lr/attempts/${lr.id}`]) expect((await req(path, { headers: other.headers })).status).toBe(404);
    expect((await req(`/api/attempts/${a.id}`, { method: 'DELETE', headers: other.headers })).status).toBe(404);
    expect((await req(`/api/lr/attempts/${lr.id}`, { method: 'DELETE', headers: other.headers })).status).toBe(404);
  });

  it('the owner cannot write to or delete another user’s attempts', async () => {
    const { o, a, lr } = await setup();
    expect((await req(`/api/attempts/${a.id}`, { method: 'DELETE', headers: o.headers })).status).toBe(404);
    expect((await req(`/api/attempts/${a.id}/submit`, { headers: o.headers, body: {} })).status).toBe(404);
    expect((await req(`/api/lr/attempts/${lr.id}`, { method: 'DELETE', headers: o.headers })).status).toBe(404);
    expect((await req(`/api/lr/attempts/${lr.id}`, { method: 'PUT', headers: o.headers, body: { responses: {}, elapsedS: 1 } })).status).toBe(404);
    expect((await req(`/api/lr/attempts/${lr.id}/submit`, { headers: o.headers, body: {} })).status).toBe(404);
    expect(await db.query.attempts.findFirst({ where: eq(attempts.id, a.id) })).toBeTruthy();
    expect(await db.query.lrAttempts.findFirst({ where: eq(lrAttempts.id, lr.id) })).toBeTruthy();
  });
});
