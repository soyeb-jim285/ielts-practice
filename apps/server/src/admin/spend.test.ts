import { fakeFetch, guestUser, req, seedPrompt, testUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { beforeEach, describe, expect, it } from 'vitest';
import { setFetch } from '../ai/openrouter';
import { OWNER_EMAILS } from '../auth';
import { clearBalanceCache } from '../community';
import { db } from '../db/client';
import { aiCosts, attempts, liveSessions, quotaUsage } from '../db/schema';
import { env } from '../env';
import { clearCostsCache } from './costs';

let owner: Headers;
let prompt: Awaited<ReturnType<typeof seedPrompt>>;
let uid: string;
const DAY = 86_400_000;
const get = async (path: string, headers = owner) => {
  const r = await req(path, { headers });
  expect(r.status).toBe(200);
  return (await r.json()) as any;
};
const orKey = (d: Record<string, unknown>) => () => Response.json({ data: d });

type Row = Partial<typeof aiCosts.$inferInsert>;
const cost = (o: Row) => ({ stage: 'score', provider: 'openrouter', model: 'm/a', paidBy: 'house', costUsd: 0.01, ...o }) as typeof aiCosts.$inferInsert;
const attempt = async (status: 'done' | 'failed', o: Partial<typeof attempts.$inferInsert> = {}) =>
  (await db.insert(attempts).values({ userId: uid, promptId: prompt.id, skill: 'speaking', part: 2, status, ...o }).returning())[0]!;

beforeEach(async () => {
  clearCostsCache();
  clearBalanceCache();
  (env as { ELEVENLABS_API_KEY?: string }).ELEVENLABS_API_KEY = undefined;
  setFetch(fakeFetch({ 'openrouter.ai': orKey({ limit: 10, usage: 2, limit_remaining: 8, usage_daily: 0, usage_weekly: 0, usage_monthly: 0 }) }));
  const o = await testUser(OWNER_EMAILS[0]);
  owner = o.headers;
  uid = o.user.id;
  prompt = await seedPrompt();
});

describe('owner only', () => {
  it('404 for anonymous, guests and ordinary users on every spend endpoint', async () => {
    const u = await testUser();
    const g = await guestUser();
    for (const p of ['summary', 'series', 'by?dim=stage', 'attempt/x', 'waste', 'forecast']) for (const headers of [undefined, g.headers, u.headers]) expect((await req(`/api/admin/spend/${p}`, { headers })).status).toBe(404);
  });
});

describe('aggregation', () => {
  it('summary splits house and own key per window and counts waste; series buckets by Dhaka day', async () => {
    const now = Date.now();
    await db.insert(aiCosts).values([
      cost({ costUsd: 0.5, createdAt: new Date(now) }),
      cost({ costUsd: 0.25, paidBy: 'own_key', createdAt: new Date(now) }),
      cost({ costUsd: 1, createdAt: new Date(now - 3 * DAY) }),
      cost({ costUsd: 4, createdAt: new Date(now - 20 * DAY) }),
      cost({ costUsd: 10, createdAt: new Date(now - 60 * DAY) }),
      cost({ costUsd: 0, ok: false, createdAt: new Date(now) }),
    ]);
    const s = await get('/api/admin/spend/summary');
    expect(s.today).toMatchObject({ house: 0.5, ownKey: 0.25, calls: 3 });
    expect(s.last7d).toMatchObject({ house: 1.5 });
    expect(s.last30d).toMatchObject({ house: 5.5 });
    expect(s.allTime).toMatchObject({ house: 15.5, ownKey: 0.25 });
    expect(s.okRate).toBeCloseTo(4 / 5);
    expect(s.drift.recorded).toMatchObject({ day: 0.5, week: 1.5, month: 5.5 });
    expect(s.drift.warn).toBe(true); // OpenRouter reports 0 for the week but we recorded $1.50
    const d = await get('/api/admin/spend/series?bucket=day&days=30');
    expect(d.points.at(-1)).toMatchObject({ house: 0.5, ownKey: 0.25 });
    expect(d.points.reduce((t: number, p: any) => t + p.house, 0)).toBeCloseTo(5.5);
    const m = await get('/api/admin/spend/series?bucket=month&days=90');
    expect(m.points.every((p: any) => /^\d{4}-\d{2}-01$/.test(p.date))).toBe(true);
  });

  it('flags drift when OpenRouter reports far more than we recorded', async () => {
    setFetch(fakeFetch({ 'openrouter.ai': orKey({ limit: 10, usage: 2, limit_remaining: 8, usage_daily: 1, usage_weekly: 3, usage_monthly: 3 }) }));
    await db.insert(aiCosts).values(cost({ costUsd: 1 }));
    expect((await get('/api/admin/spend/summary')).drift.warn).toBe(false); // ledger is minutes old: a partial week proves nothing
    await db.insert(aiCosts).values(cost({ costUsd: 0.001, createdAt: new Date(Date.now() - 10 * DAY) }));
    clearCostsCache();
    expect((await get('/api/admin/spend/summary')).drift.warn).toBe(true);
    clearCostsCache();
    setFetch(fakeFetch({ 'openrouter.ai': orKey({ limit: 10, usage: 2, limit_remaining: 8, usage_daily: 1, usage_weekly: 1.02, usage_monthly: 1.02 }) }));
    expect((await get('/api/admin/spend/summary')).drift.warn).toBe(false);
  });

  it('by: ranks by dimension with share, attempts and labels; paidBy filters', async () => {
    const a = await attempt('done');
    await db.insert(aiCosts).values([
      cost({ stage: 'score', costUsd: 0.3, attemptId: a.id, userId: uid, promptId: prompt.id }),
      cost({ stage: 'score', costUsd: 0.1, attemptId: a.id, userId: uid, promptId: prompt.id }),
      cost({ stage: 'feedback', costUsd: 0.1, model: 'm/b', attemptId: a.id, userId: uid, promptId: prompt.id }),
      cost({ stage: 'feedback', costUsd: 9, paidBy: 'own_key' }),
    ]);
    const stage = await get('/api/admin/spend/by?dim=stage');
    expect(stage.total).toBeCloseTo(0.5);
    expect(stage.items.map((i: any) => [i.key, i.costUsd, i.calls])).toEqual([['score', 0.4, 2], ['feedback', 0.1, 1]]);
    expect(stage.items[0].share).toBeCloseTo(0.8);
    expect(stage.items[0].avgPerCall).toBeCloseTo(0.2);
    expect((await get('/api/admin/spend/by?dim=model')).items.map((i: any) => i.key)).toEqual(['m/a', 'm/b']);
    const u = await get('/api/admin/spend/by?dim=user');
    expect(u.items[0]).toMatchObject({ key: uid, label: OWNER_EMAILS[0], attempts: 1 });
    expect((await get('/api/admin/spend/by?dim=prompt')).items[0]).toMatchObject({ key: prompt.id, label: prompt.title });
    expect((await get('/api/admin/spend/by?dim=skill_part')).items[0].label).toBe('live');
    expect((await get('/api/admin/spend/by?dim=stage&paidBy=all')).items[0]).toMatchObject({ key: 'feedback', costUsd: 9.1 });
    expect((await get('/api/admin/spend/by?dim=stage&paidBy=own_key')).total).toBeCloseTo(9);
  });

  it('attempt: line items in time order, stage subtotals, waste, session total, whitelisted flags only', async () => {
    const a = await attempt('done', { sessionId: 'sess1' });
    const other = await attempt('done', { sessionId: 'sess1', part: 3 });
    const t = Date.now();
    await db.insert(aiCosts).values([
      cost({ stage: 'stt', costUsd: 0.02, attemptId: a.id, sessionId: 'sess1', skill: 'speaking', part: 2, audioSeconds: 12, meta: { estimated: true, generationId: 'secret-gen' }, createdAt: new Date(t - 3000) }),
      cost({ stage: 'stt_verbatim', costUsd: 0.02, attemptId: a.id, sessionId: 'sess1', meta: { kept: false }, createdAt: new Date(t - 2000) }),
      cost({ stage: 'score', costUsd: 0.05, attemptId: a.id, sessionId: 'sess1', meta: { criterion: 'fc', sample: 1 }, createdAt: new Date(t - 1000) }),
      cost({ stage: 'score', costUsd: 0.05, attemptId: a.id, sessionId: 'sess1', retry: true, createdAt: new Date(t) }),
      cost({ stage: 'score', costUsd: 0.1, attemptId: other.id, sessionId: 'sess1' }),
    ]);
    const r = await get(`/api/admin/spend/attempt/${a.id}`);
    expect(r.recorded).toBe(true);
    expect(r.attempt).toMatchObject({ id: a.id, skill: 'speaking', part: 2, status: 'done', email: OWNER_EMAILS[0], title: prompt.title });
    expect(r.items.map((i: any) => i.stage)).toEqual(['stt', 'stt_verbatim', 'score', 'score']);
    expect(r.items[0]).toMatchObject({ estimated: true, audioSeconds: 12 });
    expect(r.items[2]).toMatchObject({ criterion: 'fc', sample: 1 });
    expect(JSON.stringify(r)).not.toContain('secret-gen');
    expect(r.stages).toEqual([{ stage: 'stt', costUsd: 0.02, calls: 1 }, { stage: 'stt_verbatim', costUsd: 0.02, calls: 1 }, { stage: 'score', costUsd: 0.1, calls: 2 }]);
    expect(r.totalUsd).toBeCloseTo(0.14);
    expect(r.wasteUsd).toBeCloseTo(0.07); // discarded primed pass + the retry
    expect(r.sessionTotal).toMatchObject({ parts: 2 });
    expect(r.sessionTotal.usd).toBeCloseTo(0.24);
  });

  it('a live attempt also lists the live session\'s own calls (shared by its parts) and its transcript; practice attempts have no live block', async () => {
    const [ls] = await db.insert(liveSessions).values({ userId: uid, state: { history: [
      { role: 'examiner', text: 'Do you work or study?', at: Date.now() - 5000, phase: 'p1' },
      { role: 'candidate', text: 'I study physics.', at: Date.now() - 3000, phase: 'p1' },
      { role: 'candidate', text: '  ', at: Date.now() - 2000, phase: 'p1' },
    ] } }).returning();
    const a = await attempt('done', { sessionId: ls!.id, mode: 'live', part: 1 });
    await db.insert(aiCosts).values([
      cost({ stage: 'feedback', costUsd: 0.01, attemptId: a.id, sessionId: ls!.id }),
      cost({ stage: 'live_realtime', provider: 'openai', model: 'gpt-live-1', costUsd: 0.5, sessionId: ls!.id, audioSeconds: 600, meta: { estimated: true } }),
      cost({ stage: 'examiner_tts', costUsd: 0.002, sessionId: ls!.id }),
      cost({ stage: 'live_realtime', costUsd: 9, sessionId: 'another-session' }),
    ]);
    const r = await get(`/api/admin/spend/attempt/${a.id}`);
    expect(r.items.map((i: any) => i.stage)).toEqual(['feedback']);
    expect(r.live.items.map((i: any) => i.stage).sort()).toEqual(['examiner_tts', 'live_realtime']);
    expect(r.live.items.find((i: any) => i.stage === 'live_realtime')).toMatchObject({ model: 'gpt-live-1', audioSeconds: 600, estimated: true });
    expect(r.live.totalUsd).toBeCloseTo(0.502);
    expect(r.live.transcript.map((t: any) => [t.role, t.text])).toEqual([['examiner', 'Do you work or study?'], ['candidate', 'I study physics.']]); // blank turns dropped
    expect((await get(`/api/admin/spend/attempt/${(await attempt('done')).id}`)).live).toBeNull();
  });

  it('attempt without cost rows is "not recorded", not zero; unknown attempt is 404', async () => {
    const a = await attempt('done');
    expect(await get(`/api/admin/spend/attempt/${a.id}`)).toMatchObject({ recorded: false, items: [], totalUsd: 0, sessionTotal: null });
    expect((await req('/api/admin/spend/attempt/nope', { headers: owner })).status).toBe(404);
    const s = await get('/api/admin/spend/summary');
    expect(s.unrecordedAttempts).toBe(1);
    expect(s.perAttempt).toEqual([]);
  });

  it('per finished attempt: average, median, p90 and waste; failed attempts only count as waste', async () => {
    const [a, b, f] = [await attempt('done'), await attempt('done'), await attempt('failed')];
    await db.insert(aiCosts).values([
      cost({ attemptId: a.id, costUsd: 0.1 }),
      cost({ attemptId: b.id, costUsd: 0.2 }),
      cost({ attemptId: b.id, costUsd: 0.05, retry: true }),
      cost({ attemptId: f.id, costUsd: 0.4, userId: uid }),
    ]);
    const s = await get('/api/admin/spend/summary');
    expect(s.perAttempt).toHaveLength(1);
    expect(s.perAttempt[0]).toMatchObject({ skill: 'speaking', part: 2, n: 2 });
    expect(s.perAttempt[0].avgUsd).toBeCloseTo(0.175);
    expect(s.perAttempt[0].medianUsd).toBeCloseTo(0.175);
    expect(s.perAttempt[0].wasteUsd).toBeCloseTo(0.025);
    expect(s.waste.usd).toBeCloseTo(0.45); // retry 0.05 + the failed attempt's 0.4
  });

  it('waste: one category per row, in priority order, with its share of all spend', async () => {
    const f = await attempt('failed');
    const r = await attempt('done');
    await db.insert(quotaUsage).values({ userId: uid, skill: 'speaking', unitKey: r.id, tier: 'community', refundedAt: new Date() });
    await db.insert(aiCosts).values([
      cost({ costUsd: 0, ok: false }),
      cost({ costUsd: 0.3, retry: true }),
      cost({ stage: 'stt_verbatim', costUsd: 0.2, meta: { kept: false } }),
      cost({ stage: 'stt_verbatim', costUsd: 0.2, meta: { kept: true } }),
      cost({ costUsd: 0.1, meta: { extra: true } }),
      cost({ costUsd: 0.4, attemptId: f.id }),
      cost({ costUsd: 0.5, attemptId: r.id, userId: uid }),
    ]);
    const w = await get('/api/admin/spend/waste');
    const kind = Object.fromEntries(w.parts.map((p: any) => [p.kind, p.usd]));
    expect(kind).toEqual({ failed: 0, retry: 0.3, discarded_stt: 0.2, extra_samples: 0.1, failed_attempt: 0.9 });
    expect(w.totalUsd).toBeCloseTo(1.5);
    expect(w.spendUsd).toBeCloseTo(1.7);
    expect(w.share).toBeCloseTo(1.5 / 1.7);
  });

  it('forecast: a speaking session of several parts counts as one test', async () => {
    const [p1, p2] = [await attempt('done', { sessionId: 'sess-1', part: 1 }), await attempt('done', { sessionId: 'sess-1', part: 2 })];
    await db.insert(aiCosts).values([cost({ costUsd: 0.2, attemptId: p1.id }), cost({ costUsd: 0.4, attemptId: p2.id })]);
    expect((await get('/api/admin/spend/forecast')).avgCostPerTest).toBeCloseTo(0.6);
  });

  it('forecast: days left from the 7-day house burn, tests left above the community floor; unknown without a ledger', async () => {
    expect(await get('/api/admin/spend/forecast')).toMatchObject({ remaining: 8, burnPerDay7d: null, daysLeft: null, runsOutOn: null, status: 'unknown' });
    const a = await attempt('done');
    const day = (n: number) => new Date(Date.now() - n * DAY);
    await db.insert(aiCosts).values([
      cost({ costUsd: 8, createdAt: day(9) }), // ledger starts 9 days ago: the 7 d window is fully covered, 7 / 7 = $1/day
      cost({ costUsd: 7, createdAt: day(2) }),
      cost({ costUsd: 0.5, attemptId: a.id, createdAt: new Date() }),
      cost({ costUsd: 3, paidBy: 'own_key', createdAt: day(2) }), // not the house's
    ]);
    const fc = await get('/api/admin/spend/forecast');
    expect(fc.burnPerDay7d).toBeCloseTo(1);
    expect(fc.daysLeft).toBeCloseTo(8);
    expect(fc.status).toBe('ok');
    expect(fc.burnPerDay14d).toBeCloseTo(7 / 8); // 14 d window: only the 8 full days after the ledger's first (partial) day count
    expect(fc.usableLeft).toBeCloseTo(8 - env.COMMUNITY_MIN_BALANCE);
    expect(fc.avgCostPerTest).toBeCloseTo(0.5);
    expect(fc.testsLeft).toBe(Math.floor((8 - env.COMMUNITY_MIN_BALANCE) / 0.5));
    clearCostsCache();
    setFetch(fakeFetch({ 'openrouter.ai': orKey({ limit: 10, usage: 7, limit_remaining: 2.5, usage_daily: 0, usage_weekly: 0, usage_monthly: 0 }) }));
    expect((await get('/api/admin/spend/forecast')).status).toBe('critical');
    const costs = await get('/api/admin/costs');
    expect(costs.warnings.join(' ')).toContain('runs out in about 3 days');
  });
});

