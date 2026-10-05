import { readFileSync } from 'node:fs';
import { speakingLines, type LrTest } from '@ielts/core';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetRenderedAudio, speakingAudioHash } from '../ai/speaking-audio';
import { loadCambridgeGrants, OWNER_EMAILS } from '../auth';
import { db } from '../db/client';
import { analyses, attempts, cambridgeAccess, feedback, guestConversions, lrAttempts, lrTests, replaySessions, user as userT } from '../db/schema';
import { storage } from '../storage';
import { req, seedPrompt, testUser } from '../test/helpers';
import { dhakaTodayStart } from './common';

const OWNER = OWNER_EMAILS[0]!;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const fixture = (n: string) => JSON.parse(readFileSync(new URL(`../test/fixtures/lr/lr-${n}.json`, import.meta.url), 'utf8')) as LrTest;
const dhakaDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(ms);

let owner: Headers;
let start: number; // start of today in Dhaka, epoch ms
const at = (ms: number) => new Date(start + ms);
const get = async (path: string, headers = owner) => {
  const r = await req(path, { headers });
  expect(r.status).toBe(200);
  return (await r.json()) as any;
};

const mkUser = async (id: string, o: { guest?: boolean; created: number; email?: string }) => {
  await db.insert(userT).values({ id, name: id, email: o.guest ? `${id}@guest.local` : (o.email ?? `${id}@x.dev`), emailVerified: !o.guest, isAnonymous: !!o.guest, createdAt: at(o.created), updatedAt: at(o.created) });
};
const mkAttempt = async (id: string, userId: string, promptId: string, skill: 'speaking' | 'writing', status: 'recording' | 'analyzing' | 'done' | 'failed', created: number, o: { overall?: number; audioKey?: string; part?: number } = {}) => {
  await db.insert(attempts).values({ id, userId, promptId, skill, part: o.part ?? (skill === 'speaking' ? 2 : 1), status, audioKey: o.audioKey, durationMs: o.audioKey ? 90_000 : null, createdAt: at(created), updatedAt: at(created) });
  if (o.overall !== undefined) await db.insert(analyses).values({ attemptId: id, result: {}, overall: o.overall, criteria: {}, models: {} });
};
const mkLr = (id: string, userId: string, testId: string, o: Partial<typeof lrAttempts.$inferInsert>) => db.insert(lrAttempts).values({ id, userId, testId, mode: 'practice', ...o });

// Day layout (ms relative to the start of today in Dhaka):
//   alice  created yesterday 30 s before midnight   bob created today 1 min in    gus (guest) created today   dan 10 days ago   eve 40 days ago
beforeEach(async () => {
  const [row] = [...(await db.execute(sql`select extract(epoch from ${dhakaTodayStart}) * 1000 as ms`))] as { ms: string }[];
  start = Number(row!.ms);
  owner = (await testUser(OWNER)).headers;
  await mkUser('alice', { created: -30_000, email: 'alice@x.dev' });
  await mkUser('bob', { created: MIN, email: 'bob@x.dev' });
  await mkUser('gus', { guest: true, created: MIN });
  await mkUser('dan', { created: -10 * DAY + MIN, email: 'dan@x.dev' });
  await mkUser('eve', { created: -40 * DAY, email: 'eve@x.dev' });
});

async function seed() {
  const sp = await seedPrompt({ part: 2, title: 'Describe a trip', type: 'cue-card' });
  const wr = await seedPrompt({ skill: 'writing', part: 1, type: 'line', title: 'Chart task', source: 'cambridge' });
  await mkAttempt('a1', 'alice', sp.id, 'speaking', 'done', -30_000, { overall: 6.5, audioKey: 'audio/a1.webm' }); // yesterday, 30 s before midnight
  await mkAttempt('a2', 'alice', sp.id, 'speaking', 'done', 400_000, { overall: 7 });
  await mkAttempt('b1', 'bob', wr.id, 'writing', 'failed', 2 * MIN);
  await mkAttempt('g1', 'gus', sp.id, 'speaking', 'recording', 3 * MIN);
  await mkAttempt('d1', 'dan', wr.id, 'writing', 'done', -3 * DAY + MIN, { overall: 5.5 });
  const lt = fixture('listening');
  const rt = fixture('reading');
  const [l] = await db.insert(lrTests).values({ slug: lt.slug, skill: lt.skill, variant: lt.variant, source: lt.source, ref: lt.ref, title: lt.title, data: lt }).returning();
  const [r] = await db.insert(lrTests).values({ slug: rt.slug, skill: rt.skill, variant: rt.variant, source: rt.source, ref: rt.ref, title: rt.title, data: rt }).returning();
  const m = (n: number, given: string, correct: boolean) => ({ n, given, correct, answer: ['k'] });
  await mkLr('l1', 'alice', l!.id, { status: 'submitted', startedAt: at(200_000), submittedAt: at(210_000), band: 7, raw: 30, total: 40, marks: [m(1, 'x', false), m(2, 'y', true)] });
  await mkLr('l2', 'bob', l!.id, { status: 'in_progress', startedAt: at(4 * MIN), parts: [1, 3] });
  await mkLr('l3', 'alice', l!.id, { status: 'submitted', startedAt: at(290_000), submittedAt: at(300_000), band: 5, raw: 20, total: 40, marks: [m(1, '', false), m(2, 'z', false)] });
  await db.insert(replaySessions).values({ id: '11111111-1111-4111-8111-111111111111', userId: 'alice', startedAt: at(600_000), lastAt: at(900_000), pages: [{ path: '/x', at: 1 }], bytes: 10, chunks: 1 });
  await db.insert(feedback).values([{ message: 'a', page: '/', status: 'new' }, { message: 'b', page: '/', status: 'new' }, { message: 'c', page: '/', status: 'done' }]);
  await db.insert(guestConversions).values({ guestId: 'gone', userId: 'alice', guestCreatedAt: at(-60_000) });
  return { sp, wr, lt: l!, rt: r! };
}

describe('admin stats', () => {
  it('is owner-only: 404 for visitors and ordinary users on every endpoint', async () => {
    const user = (await testUser()).headers;
    for (const p of ['overview', 'growth', 'activity', 'users', 'users/alice', 'tests', 'tests/x/missed', 'funnel', 'content']) {
      for (const h of [undefined, user]) expect((await req(`/api/admin/${p}`, { headers: h })).status).toBe(404);
    }
  });

  it('overview counts accounts, guests, Dhaka-day signups, active users and tests today', async () => {
    await seed();
    const o = await get('/api/admin/overview');
    expect(o.accounts).toBe(5); // owner, alice, bob, dan, eve
    expect(o.guests).toBe(1);
    expect(o.signups).toEqual({ today: 2, d7: 3, d30: 4 }); // owner+bob today; alice 30 s before midnight is yesterday; dan 10 days ago
    expect(o.newGuests).toEqual({ today: 1, d7: 1, d30: 1 });
    expect(o.activeUsers).toEqual({ today: { accounts: 2, guests: 1 }, d7: { accounts: 3, guests: 1 } }); // dan: 3 days ago
    expect(o.testsToday).toEqual({ speaking: { started: 2, finished: 1 }, writing: { started: 1, finished: 0 }, listening: { started: 3, finished: 2 }, reading: { started: 0, finished: 0 } });
    expect(o.feedbackNew).toBe(2);
  });

  it('growth is zero-filled per Dhaka day with guest conversion', async () => {
    await seed();
    const g = await get('/api/admin/growth');
    expect(g.days).toBe(30);
    expect(g.series).toHaveLength(30);
    expect(g.series.at(-1)).toEqual({ date: dhakaDate(start + MIN), signups: 2, newGuests: 1, active: 3 });
    expect(g.series.at(-2)).toEqual({ date: dhakaDate(start - MIN), signups: 1, newGuests: 0, active: 1 });
    expect(g.series.reduce((n: number, d: any) => n + d.signups, 0)).toBe(4);
    expect(g.series[0].date < g.series[1].date).toBe(true);
    expect(g.conversion).toEqual({ guests: 2, converted: 1, rate: 0.5 });
    expect((await get('/api/admin/growth?days=90')).series).toHaveLength(90);
    expect((await req('/api/admin/growth?days=45', { headers: owner })).status).toBe(400);
  });

  it('activity lists attempts and L/R attempts newest first with filters, parts and replays', async () => {
    const { lt } = await seed();
    const a = await get('/api/admin/activity?pageSize=3');
    expect(a.total).toBe(8);
    expect(a.items.map((i: any) => i.id)).toEqual(['a2', 'l3', 'l2']);
    expect(a.items[0]).toMatchObject({ kind: 'attempt', email: 'alice@x.dev', isGuest: false, skill: 'speaking', parts: 'Part 2', score: 7, status: 'done', resultPath: '/speaking/result/a2', title: 'Describe a trip' });
    expect(a.items[0].replays.map((r: any) => r.id)).toEqual(['11111111-1111-4111-8111-111111111111']); // the replay starts 10 min in; a2 is 6.7 min in, inside the 5 min slack
    expect(a.items[1]).toMatchObject({ kind: 'lr', skill: 'listening', parts: 'All', score: 5, raw: { raw: 20, total: 40 }, resultPath: '/lr/result/l3', title: lt.title });
    expect(a.items[1].replays).toEqual([]); // l3 is 310 s before the replay: 10 s outside the slack
    expect(a.items[0].startedAt).toBe(at(400_000).toISOString());

    const all = (await get('/api/admin/activity?pageSize=100')).items;
    expect(all.find((i: any) => i.id === 'l2')).toMatchObject({ parts: 'Parts 1, 3', status: 'in_progress', resultPath: '/lr/run/l2', score: null, raw: null });
    expect(all.find((i: any) => i.id === 'a1').replays).toEqual([]); // 10 min before the replay: outside the slack
    expect(all.find((i: any) => i.id === 'g1')).toMatchObject({ email: '', isGuest: true, status: 'recording', score: null });
    expect(all.find((i: any) => i.id === 'b1')).toMatchObject({ skill: 'writing', parts: 'Task 1', status: 'failed' });
    expect((await get('/api/admin/activity?page=2&pageSize=3')).items.map((i: any) => i.id)).toHaveLength(3);
    expect((await get('/api/admin/activity?skill=listening')).total).toBe(3);
    const q = await get('/api/admin/activity?q=ALI');
    expect(q.total).toBe(4);
    expect(q.items.every((i: any) => i.userId === 'alice')).toBe(true);
  });

  it('users lists accounts by default, guests on request, with counts, last activity and Cambridge info', async () => {
    await seed();
    await db.insert(cambridgeAccess).values({ email: 'dan@x.dev', grantedBy: OWNER });
    await loadCambridgeGrants();
    const u = await get('/api/admin/users');
    expect(u.total).toBe(5);
    expect(u.items.map((i: any) => i.id).slice(0, 3)).toEqual([expect.any(String), 'bob', 'alice']); // owner, bob, alice: newest first
    const by = (id: string) => u.items.find((i: any) => i.id === id);
    expect(by('alice')).toMatchObject({ email: 'alice@x.dev', isGuest: false, counts: { speaking: 2, writing: 0, listening: 2, reading: 0 }, replays: 1, cambridge: { allowed: false, source: null, canToggle: true } });
    expect(by('alice').lastActiveAt).toBe(at(900_000).toISOString()); // the replay session's last_at
    expect(by('dan')).toMatchObject({ counts: { writing: 1 }, cambridge: { allowed: true, source: 'granted', canToggle: true } });
    expect(by('eve').lastActiveAt).toBeNull();
    expect(u.items.find((i: any) => i.email === OWNER).cambridge).toEqual({ allowed: true, source: 'owner', canToggle: false });

    const g = await get('/api/admin/users?kind=guests');
    expect(g.items).toHaveLength(1);
    expect(g.items[0]).toMatchObject({ id: 'gus', email: '', isGuest: true, cambridge: { allowed: false, source: null, canToggle: false } });
    expect((await get('/api/admin/users?kind=all')).total).toBe(6);
    expect((await get('/api/admin/users?q=DAN')).items.map((i: any) => i.id)).toEqual(['dan']);
    const paged = await get('/api/admin/users?pageSize=2&page=3');
    expect(paged).toMatchObject({ total: 5, page: 3, pageSize: 2 });
    expect(paged.items).toHaveLength(1);

    const act = await get('/api/admin/users?sort=active');
    expect(act.items[0].id).toBe('alice'); // replay last_at is the latest activity
    expect(act.items.slice(-2).map((i: any) => i.lastActiveAt)).toEqual([null, null]);
  });

  it('user detail has attempts, band trend (oldest first), recordings and replays; 404 for unknown', async () => {
    await seed();
    const d = await get('/api/admin/users/alice');
    expect(d.user.id).toBe('alice');
    expect(d.attempts.map((a: any) => a.id)).toEqual(['a2', 'l3', 'l1', 'a1']);
    expect(d.bandTrend.speaking.map((p: any) => p.band)).toEqual([6.5, 7]);
    expect(d.bandTrend.listening.map((p: any) => p.band)).toEqual([7, 5]);
    expect(d.bandTrend.writing).toEqual([]);
    expect(d.bandTrend.reading).toEqual([]);
    expect(d.recordings).toEqual([{ attemptId: 'a1', part: 2, createdAt: at(-30_000).toISOString(), durationMs: 90_000, audioUrl: 'https://download.test/audio/a1.webm' }]);
    expect(d.replays).toHaveLength(1);
    expect(d.replays[0]).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', userId: 'alice', email: 'alice@x.dev', durationS: 300, chunks: 1 });
    expect(d.cambridge).toEqual(d.user.cambridge);
    expect((await req('/api/admin/users/nobody', { headers: owner })).status).toBe(404);
  });

  it('tests: completion and scores per prompt and per L/R test inside the window; most-missed questions', async () => {
    const { lt } = await seed();
    const t = await get('/api/admin/tests');
    expect(t.prompts.map((p: any) => [p.title, p.skill, p.part, p.source, p.started, p.finished])).toEqual([
      ['Describe a trip', 'speaking', 2, 'generated', 3, 2],
      ['Chart task', 'writing', 1, 'cambridge', 2, 1],
    ]);
    expect(t.prompts[0]).toMatchObject({ completionRate: 2 / 3, avgBand: 6.75, avgRaw: null });
    expect(t.prompts[1].avgBand).toBe(5.5);
    expect(t.lr).toHaveLength(1);
    expect(t.lr[0]).toMatchObject({ id: lt.id, part: null, started: 3, finished: 2, avgBand: 6, avgRaw: 25 });
    expect(t.lr[0].completionRate).toBeCloseTo(2 / 3);

    const today = await get('/api/admin/tests?days=1'); // a1 (30 s before midnight) and d1 fall outside
    expect(today.prompts.map((p: any) => [p.title, p.started])).toEqual([['Describe a trip', 2], ['Chart task', 1]]);

    const m = await get(`/api/admin/tests/${lt.id}/missed`);
    expect(m).toMatchObject({ testId: lt.id, title: lt.title, submitted: 2 });
    expect(m.questions).toEqual([{ n: 1, answered: 1, missed: 2, missRate: 1 }, { n: 2, answered: 2, missed: 1, missRate: 0.5 }]);
    expect((await req('/api/admin/tests/nope/missed', { headers: owner })).status).toBe(404);
  });

  it('funnel counts the cohort created in the window through its five steps', async () => {
    await seed();
    const f = await get('/api/admin/funnel');
    expect(f.days).toBe(30);
    expect(f.steps.map((s: any) => [s.key, s.users])).toEqual([['visited', 5], ['started', 4], ['finished', 2], ['signedUp', 4], ['returned', 2]]);
    expect(f.steps[1].pctOfVisited).toBeCloseTo(0.8);
    expect(f.steps[0].pctOfVisited).toBe(1);
    const w = await get('/api/admin/funnel?days=7'); // dan (10 days ago) and eve are outside
    expect(w.steps.map((s: any) => s.users)).toEqual([4, 3, 1, 3, 1]);
    expect((await get('/api/admin/funnel?days=90')).steps[0].users).toBe(6);
  });

  it('content counts the bank and the examiner-audio coverage', async () => {
    const { rt, lt } = await seed();
    const p1 = await seedPrompt({ part: 1, title: 'Hometown' });
    const c = await get('/api/admin/content');
    expect(c.prompts).toEqual([
      { skill: 'speaking', part: 1, source: 'generated', count: 1 },
      { skill: 'speaking', part: 2, source: 'generated', count: 1 },
      { skill: 'writing', part: 1, source: 'cambridge', count: 1 },
    ]);
    expect(c.lr).toEqual([
      { skill: 'listening', source: lt.source, variant: lt.variant, tests: 1 },
      { skill: 'reading', source: rt.source, variant: rt.variant, tests: 1 },
    ]);
    expect(c.speakingAudio).toMatchObject({ prompts: 2, promptsFullyRendered: 0, linesRendered: 0, manifestEntries: null });
    const total = c.speakingAudio.lines;
    expect(total).toBeGreaterThan(2);

    const l = speakingLines(p1);
    const hashes = [l.intro, l.lead, ...l.questions].map((t) => speakingAudioHash(t!));
    await storage.put('speaking/manifest.json', new TextEncoder().encode(JSON.stringify(Object.fromEntries(hashes.map((h) => [h, `speaking/${h}.mp3`])))), 'application/json');
    forgetRenderedAudio();
    expect((await get('/api/admin/content')).speakingAudio).toEqual({ prompts: 2, promptsFullyRendered: 1, lines: total, linesRendered: new Set(hashes).size, manifestEntries: new Set(hashes).size });
    forgetRenderedAudio();
  });
});
