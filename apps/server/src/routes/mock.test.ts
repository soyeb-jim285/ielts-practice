import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LrTest } from '@ielts/core';
import { analyses, attempts, liveSessions, lrAttempts, lrTests, mockExams, quotaUsage } from '../db/schema';
import { db } from '../db/client';
import { req, seedPrompt, testUser } from '../test/helpers';

const body = async (r: Response) => (await r.json()) as any;
const fixture = (n: string) => JSON.parse(readFileSync(new URL(`../test/fixtures/lr/lr-${n}.json`, import.meta.url), 'utf8')) as LrTest;
const ALLOWED = 'soyebjim@gmail.com';

async function seedLr(t: LrTest, over: Partial<typeof lrTests.$inferInsert> = {}) {
  const [row] = await db.insert(lrTests).values({ slug: t.slug, skill: t.skill, variant: t.variant, source: t.source, ref: t.ref, title: t.title, data: t, restricted: t.source === 'cambridge', ...over }).returning();
  return row!.id;
}
/** One complete set: Listening, Reading, Writing 1 + 2, Speaking (P1, P2 card with its P3). Our own tests, or a Cambridge ref. */
async function seedSet(ref?: string, skip?: 'speaking') {
  const cam = ref ? ({ source: 'cambridge', sourceRef: ref, restricted: true } as const) : {};
  const tag = ref ? ref.replace(/\W/g, '') : 'gen';
  await seedLr(fixture('listening'), { slug: `l-${tag}`, ...(ref && { source: 'cambridge', ref, restricted: true }) });
  await seedLr(fixture('reading'), { slug: `r-${tag}`, ...(ref && { source: 'cambridge', ref, restricted: true }) });
  await seedPrompt({ skill: 'writing', part: 1, variant: 'academic', type: 'line', ...cam });
  await seedPrompt({ skill: 'writing', part: 2, type: 'opinion', ...cam });
  if (skip === 'speaking') return;
  await seedPrompt({ part: 1, ...cam });
  await seedPrompt({ part: 2, type: 'cue-card', groupId: `g-${tag}`, ...cam });
  await seedPrompt({ part: 3, type: 'p3-discussion', groupId: `g-${tag}`, ...cam });
}
const create = (headers: Headers, b: object = { variant: 'academic', source: 'generated' }, q = '') => req(`/api/mock${q}`, { headers, body: b });
const submitLr = async (_h: Headers, attemptId: string, band: number) => {
  await db.update(lrAttempts).set({ status: 'submitted', band, submittedAt: new Date() }).where(eq(lrAttempts.id, attemptId));
};
const section = async (headers: Headers, id: string, skill: 'listening' | 'reading') => req(`/api/mock/${id}/sections/${skill}/start`, { headers, body: {} });
/** A submitted, marked writing/speaking attempt of a session, as the analysis job leaves it. */
async function markedAttempt(userId: string, promptId: string, skill: 'writing' | 'speaking', part: number, sessionId: string, overall: number, status: 'done' | 'failed' | 'analyzing' = 'done') {
  const [a] = await db.insert(attempts).values({ userId, promptId, skill, part, sessionId, status }).returning();
  if (status === 'done') await db.insert(analyses).values({ attemptId: a!.id, result: {}, overall, criteria: {}, models: {} });
  return a!.id;
}

describe('full mock test', () => {
  beforeEach(() => seedSet());

  it('starts on our own tests, picks a complete set, and nothing is reserved', async () => {
    const { headers } = await testUser();
    const r = await create(headers);
    expect(r.status).toBe(201);
    const m = await body(r);
    expect(m).toMatchObject({ source: 'generated', ref: null, status: 'in_progress', next: 'listening', overall: null });
    expect(m.sections.map((s: any) => [s.skill, s.state, s.limitS])).toEqual([['listening', 'todo', 1800], ['reading', 'todo', 3600], ['writing', 'todo', 3600], ['speaking', 'todo', null]]);
    expect((await body(await req('/api/mock/current', { headers }))).mock.id).toBe(m.id);
    expect(await db.select().from(quotaUsage)).toHaveLength(0);
  });

  it('only the owner can see or touch a mock; one open mock per person', async () => {
    const me = await testUser();
    const other = await testUser();
    const m = await body(await create(me.headers));
    for (const [method, path, b] of [
      ['GET', `/api/mock/${m.id}`, undefined],
      ['POST', `/api/mock/${m.id}/sections/listening/start`, {}],
      ['POST', `/api/mock/${m.id}/writing/start`, {}],
      ['PATCH', `/api/mock/${m.id}/writing/clock`, { elapsedS: 10 }],
      ['POST', `/api/mock/${m.id}/speaking/choose`, { mode: 'recorded' }],
      ['POST', `/api/mock/${m.id}/speaking/attach`, { sessionId: 'x' }],
      ['POST', `/api/mock/${m.id}/close`, {}],
      ['DELETE', `/api/mock/${m.id}`, undefined],
    ] as const)
      expect((await req(path, { headers: other.headers, method, body: b })).status, `${method} ${path}`).toBe(404);
    expect((await body(await req('/api/mock', { headers: other.headers }))).items).toEqual([]);
    expect((await body(await req('/api/mock/current', { headers: other.headers }))).mock).toBeNull();
    // the owner of the mock is untouched
    expect((await req(`/api/mock/${m.id}`, { headers: me.headers })).status).toBe(200);

    const again = await create(me.headers);
    expect(again.status).toBe(409);
    expect(await body(again)).toMatchObject({ code: 'mock_open', mockId: m.id });
    const replaced = await create(me.headers, { variant: 'academic', source: 'generated' }, '?replace=true');
    expect(replaced.status).toBe(201);
    expect((await body(replaced)).id).not.toBe(m.id);
    expect(await db.select().from(mockExams)).toHaveLength(1);
  });

  it('guests need an account', async () => {
    const res = await req('/api/mock/current');
    expect(res.status).toBe(401);
  });

  it('runs the sections in order and links the same attempts the sections use', async () => {
    const { headers, user } = await testUser();
    const m = await body(await create(headers));
    // out of order
    const early = await section(headers, m.id, 'reading');
    expect([early.status, (await body(early)).code]).toEqual([409, 'out_of_order']);
    expect((await req(`/api/mock/${m.id}/writing/start`, { headers, body: {} })).status).toBe(409);
    expect((await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'recorded' } })).status).toBe(409);
    expect((await req(`/api/mock/${m.id}/close`, { headers, body: {} })).status).toBe(409);

    // Listening: exam-mode whole-test attempt, resumed on a second start
    const { attemptId: la } = await body(await section(headers, m.id, 'listening'));
    expect((await db.query.lrAttempts.findFirst({ where: eq(lrAttempts.id, la) }))).toMatchObject({ mode: 'exam', parts: null, userId: user.id });
    expect((await body(await section(headers, m.id, 'listening'))).attemptId).toBe(la);
    expect((await body(await req(`/api/mock/${m.id}`, { headers }))).sections[0]).toMatchObject({ state: 'in_progress', attemptId: la });
    expect((await req(`/api/mock/${m.id}/sections/reading/start`, { headers, body: {} })).status).toBe(409);
    await submitLr(headers, la, 7);
    const done = await section(headers, m.id, 'listening');
    expect([done.status, (await body(done)).code]).toEqual([409, 'section_done']);

    const { attemptId: ra } = await body(await section(headers, m.id, 'reading'));
    expect((await body(await req(`/api/mock/${m.id}`, { headers }))).next).toBe('reading');
    await submitLr(headers, ra, 7);

    // Writing: both prompts + shared session; the clock only goes up
    const w = await body(await req(`/api/mock/${m.id}/writing/start`, { headers, body: {} }));
    expect(w.prompts.map((p: any) => p.part)).toEqual([1, 2]);
    expect(w.elapsedS).toBe(0);
    expect((await body(await req(`/api/mock/${m.id}/writing/clock`, { headers, method: 'PATCH', body: { elapsedS: 900 } }))).elapsedS).toBe(900);
    expect((await body(await req(`/api/mock/${m.id}/writing/clock`, { headers, method: 'PATCH', body: { elapsedS: 300 } }))).elapsedS).toBe(900);
    expect((await body(await req(`/api/mock/${m.id}/writing/start`, { headers, body: {} }))).elapsedS).toBe(900);

    // attempts created by the unchanged writing flow carry mockId + the mock's session
    const mk = (promptId: string, over: object = {}) => req('/api/attempts', { headers, body: { promptId, skill: 'writing', part: promptId === w.prompts[0].id ? 1 : 2, sessionId: w.writingSessionId, mockId: m.id, ...over } });
    expect((await mk(w.prompts[0].id, { sessionId: 'someone-elses' })).status).toBe(400);
    expect((await mk(w.prompts[0].id, { mockId: 'nope' })).status).toBe(404);
    const a1 = (await body(await mk(w.prompts[0].id))).id;
    const a2 = (await body(await mk(w.prompts[1].id))).id;
    expect((await db.query.mockExams.findFirst({ where: eq(mockExams.id, m.id) }))!.writingAttemptIds).toEqual([a1, a2]);
    expect((await body(await req(`/api/mock/${m.id}`, { headers }))).sections[2]).toMatchObject({ state: 'in_progress', attemptId: a1, sessionId: w.writingSessionId });
    await db.update(attempts).set({ status: 'analyzing' }).where(eq(attempts.userId, user.id));
    expect((await body(await req(`/api/mock/${m.id}`, { headers }))).sections[2].state).toBe('marking');
    await db.update(attempts).set({ status: 'done' }).where(eq(attempts.id, a1));
    await db.update(attempts).set({ status: 'failed' }).where(eq(attempts.id, a2));
    await db.insert(analyses).values({ attemptId: a1, result: {}, overall: 6, criteria: {}, models: {} });
    expect((await body(await req(`/api/mock/${m.id}`, { headers }))).sections[2]).toMatchObject({ state: 'failed', band: null });

    // Speaking: recorded set, then the same questions again on re-choose
    const c1 = await body(await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'recorded' } }));
    expect(c1.test.part2.groupId).toBe(c1.test.part3.groupId);
    const c2 = await body(await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'recorded' } }));
    expect(c2.sessionId).toBe(c1.sessionId);
    expect(c2.test.part2.id).toBe(c1.test.part2.id);
    const sp = (promptId: string, part: number, over: object = {}) => req('/api/attempts', { headers, body: { promptId, skill: 'speaking', part, sessionId: c1.sessionId, mockId: m.id, ...over } });
    expect((await sp(c1.test.part2.id, 2, { sessionId: w.writingSessionId })).status).toBe(400);
    expect((await sp(c1.test.part2.id, 2)).status).toBe(201);
    // finishing without Speaking
    const closed = await body(await req(`/api/mock/${m.id}/close`, { headers, body: {} }));
    expect(closed).toMatchObject({ status: 'closed', next: null, overall: null });
    expect(closed.sections[3].state).toBe('skipped');
    expect((await section(headers, m.id, 'listening')).status).toBe(409);
    expect((await body(await req('/api/mock/current', { headers }))).mock).toBeNull();
  });

  it('works out the section bands and the overall band (writing 1:2, speaking part mean, nearest half)', async () => {
    const { headers, user } = await testUser();
    const m = await body(await create(headers));
    const row = (await db.query.mockExams.findFirst({ where: eq(mockExams.id, m.id) }))!;
    await submitLr(headers, (await body(await section(headers, m.id, 'listening'))).attemptId, 7);
    const rd = await body(await section(headers, m.id, 'reading'));
    await submitLr(headers, rd.attemptId, 7);
    await db.update(mockExams).set({ writingStartedAt: new Date() }).where(eq(mockExams.id, m.id));
    const [p1, p2] = row.writingPromptIds as [string, string];
    await markedAttempt(user.id, p1, 'writing', 1, row.writingSessionId, 6);
    await markedAttempt(user.id, p2, 'writing', 2, row.writingSessionId, 7); // (6 + 14) / 3 = 6.67 -> 6.5
    const mid = await body(await req(`/api/mock/${m.id}`, { headers }));
    expect(mid.sections[2]).toMatchObject({ state: 'done', band: 6.5 });
    expect(mid.overall).toBeNull();

    const c = await body(await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'recorded' } }));
    await markedAttempt(user.id, c.test.part1[0].id, 'speaking', 1, c.sessionId, 6);
    expect((await body(await req(`/api/mock/${m.id}`, { headers }))).sections[3].state).toBe('in_progress');
    await markedAttempt(user.id, c.test.part2.id, 'speaking', 2, c.sessionId, 6.5);
    await markedAttempt(user.id, c.test.part3.id, 'speaking', 3, c.sessionId, 7); // mean 6.5
    const fin = await body(await req(`/api/mock/${m.id}`, { headers }));
    expect(fin.sections.map((s: any) => s.band)).toEqual([7, 7, 6.5, 6.5]); // mean 6.75 -> 7
    expect(fin).toMatchObject({ overall: 7, status: 'completed', next: null });
    expect(fin.completedAt).not.toBeNull();
    // finished: nothing more can be started, and a new mock is allowed again
    expect((await req(`/api/mock/${m.id}/writing/start`, { headers, body: {} })).status).toBe(409);
    expect((await create(headers)).status).toBe(201);
  });

  it('speaking: every Part 1 segment counts, and a recorded test with parts in can be resumed', async () => {
    const { headers, user } = await testUser();
    const m = await body(await create(headers));
    const row = (await db.query.mockExams.findFirst({ where: eq(mockExams.id, m.id) }))!;
    await submitLr(headers, (await body(await section(headers, m.id, 'listening'))).attemptId, 7);
    await submitLr(headers, (await body(await section(headers, m.id, 'reading'))).attemptId, 7);
    await markedAttempt(user.id, row.writingPromptIds[0]!, 'writing', 1, row.writingSessionId, 6);
    await markedAttempt(user.id, row.writingPromptIds[1]!, 'writing', 2, row.writingSessionId, 6);
    const c = await body(await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'recorded' } }));
    const p1 = c.test.part1[0].id;
    await markedAttempt(user.id, p1, 'speaking', 1, c.sessionId, 5);
    const again = await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'recorded' } }); // resume
    expect([again.status, (await body(again)).sessionId]).toEqual([200, c.sessionId]);
    expect((await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'live' } })).status).toBe(409);
    await markedAttempt(user.id, p1, 'speaking', 1, c.sessionId, 7); // retry of the same prompt replaces it
    await markedAttempt(user.id, c.test.part2.id, 'speaking', 2, c.sessionId, 6);
    await markedAttempt(user.id, c.test.part3.id, 'speaking', 3, c.sessionId, 6, 'analyzing');
    expect((await body(await req(`/api/mock/${m.id}`, { headers }))).sections[3].state).toBe('marking');
    await db.update(attempts).set({ status: 'done' }).where(eq(attempts.sessionId, c.sessionId));
    const sp = (await body(await req(`/api/mock/${m.id}`, { headers }))).sections[3];
    expect(sp.state).toBe('done'); // part 3 has no analysis row, so scored parts are 1 and 2: (7 + 6) / 2 = 6.5
    expect(sp.band).toBe(6.5);
  });

  it('a deleted attempt reads as skipped and the overall stays empty', async () => {
    const { headers } = await testUser();
    const m = await body(await create(headers));
    const { attemptId } = await body(await section(headers, m.id, 'listening'));
    await db.delete(lrAttempts).where(eq(lrAttempts.id, attemptId));
    const after = await body(await req(`/api/mock/${m.id}`, { headers }));
    expect(after.sections[0].state).toBe('skipped');
    expect(after.next).toBe('reading');
  });

  it('closes lazily when it expires with Speaking still to do', async () => {
    const { headers } = await testUser();
    const m = await body(await create(headers));
    await db.update(mockExams).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(mockExams.id, m.id));
    const r = await body(await req(`/api/mock/${m.id}`, { headers }));
    expect(r).toMatchObject({ status: 'closed', next: null, overall: null });
    expect(r.sections.map((s: any) => s.state)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
    expect((await db.query.mockExams.findFirst({ where: eq(mockExams.id, m.id) }))!.status).toBe('closed');
    expect((await create(headers)).status).toBe(201);
  });

  it('speaking attach only takes a finished session of the same person, and live needs the live examiner', async () => {
    const me = await testUser();
    const other = await testUser();
    const m = await body(await create(me.headers));
    const row = (await db.query.mockExams.findFirst({ where: eq(mockExams.id, m.id) }))!;
    const l = await body(await section(me.headers, m.id, 'listening'));
    await submitLr(me.headers, l.attemptId, 6);
    await submitLr(me.headers, (await body(await section(me.headers, m.id, 'reading'))).attemptId, 6);
    await db.update(mockExams).set({ writingStartedAt: new Date() }).where(eq(mockExams.id, m.id));
    await markedAttempt(me.user.id, row.writingPromptIds[0]!, 'writing', 1, row.writingSessionId, 6);
    await markedAttempt(me.user.id, row.writingPromptIds[1]!, 'writing', 2, row.writingSessionId, 6);
    const attach = (sessionId: string) => req(`/api/mock/${m.id}/speaking/attach`, { headers: me.headers, body: { sessionId } });
    expect((await attach('live-1')).status).toBe(409); // live not chosen yet
    const chosen = await body(await req(`/api/mock/${m.id}/speaking/choose`, { headers: me.headers, body: { mode: 'live' } }));
    expect(chosen).toEqual({ mode: 'live', source: 'generated', ref: null });
    const [p] = await db.select().from(attempts).limit(1);
    await db.insert(liveSessions).values([{ id: 'foreign-live', userId: other.user.id, state: {} }, { id: 'mine-live', userId: me.user.id, state: {} }, { id: 'old-live', userId: me.user.id, state: {} }]);
    await markedAttempt(other.user.id, p!.promptId, 'speaking', 1, 'foreign-live', 6);
    expect((await attach('foreign-live')).status).toBe(400); // someone else's session
    expect((await attach('does-not-exist')).status).toBe(400);
    const old = await markedAttempt(me.user.id, p!.promptId, 'speaking', 1, 'old-live', 6);
    await db.update(attempts).set({ createdAt: new Date(row.startedAt.getTime() - 60_000) }).where(eq(attempts.id, old));
    expect((await attach('old-live')).status).toBe(400); // practised before the mock began
    await markedAttempt(me.user.id, p!.promptId, 'speaking', 1, 'mine-live', 6.5);
    const ok = await attach('mine-live');
    expect(ok.status).toBe(200);
    expect((await body(ok)).sections[3]).toMatchObject({ mode: 'live', sessionId: 'mine-live', state: 'done', band: 6.5 });
  });

  it('live mode is refused without the person\'s own key, and recorded checks the allowance again', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    const m = await body(await create(headers));
    const row = (await db.query.mockExams.findFirst({ where: eq(mockExams.id, m.id) }))!;
    await submitLr(headers, (await body(await section(headers, m.id, 'listening'))).attemptId, 6);
    await submitLr(headers, (await body(await section(headers, m.id, 'reading'))).attemptId, 6);
    await markedAttempt(user.id, row.writingPromptIds[0]!, 'writing', 1, row.writingSessionId, 6);
    await markedAttempt(user.id, row.writingPromptIds[1]!, 'writing', 2, row.writingSessionId, 6);
    const live = await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'live' } });
    expect([live.status, (await body(live)).code]).toEqual([403, 'live_requires_own_key']);
    // the day's speaking test was used elsewhere in the meantime
    await db.insert(quotaUsage).values({ userId: user.id, skill: 'speaking', unitKey: 'other', tier: 'community', members: [] });
    const rec = await req(`/api/mock/${m.id}/speaking/choose`, { headers, body: { mode: 'recorded' } });
    expect([rec.status, (await body(rec)).code]).toEqual([429, 'quota_exceeded']);
  });

  it('create is blocked by the writing or speaking allowance before anything starts', async () => {
    const { headers, user } = await testUser(undefined, { key: false });
    await db.insert(quotaUsage).values({ userId: user.id, skill: 'writing', unitKey: 'used', tier: 'community', members: [] });
    const r = await create(headers);
    expect([r.status, await body(r)]).toEqual([429, expect.objectContaining({ code: 'quota_exceeded', skill: 'writing' })]);
    expect(await db.select().from(mockExams)).toHaveLength(0);
    const second = await testUser(undefined, { key: false });
    await db.insert(quotaUsage).values({ userId: second.user.id, skill: 'speaking', unitKey: 'used', tier: 'community', members: [] });
    expect((await create(second.headers)).status).toBe(429);
    const free = await testUser(undefined, { key: false });
    expect((await create(free.headers)).status).toBe(201);
    // the pre-check reserved nothing
    expect((await db.select().from(quotaUsage)).map((q) => q.userId).sort()).toEqual([user.id, second.user.id].sort());
  });

  describe('Cambridge complete tests', () => {
    beforeEach(async () => {
      await seedSet('C19 T2');
      await seedSet('C18 T1', 'speaking'); // no speaking set: not a complete test
    });

    it('are hidden from, and refused to, accounts without Cambridge access', async () => {
      const { headers } = await testUser('someone@x.com');
      const o = await body(await req('/api/mock/options?variant=academic', { headers }));
      expect(o).toMatchObject({ cambridge: [], own: true });
      const r = await create(headers, { variant: 'academic', source: 'cambridge', ref: 'C19 T2' });
      expect([r.status, (await body(r)).code]).toEqual([404, 'no_complete_set']);
      const unverified = await testUser(ALLOWED, { verified: false });
      expect((await body(await req('/api/mock/options?variant=academic', { headers: unverified.headers }))).cambridge).toEqual([]);
      expect((await create(unverified.headers, { variant: 'academic', source: 'cambridge', ref: 'C19 T2' })).status).toBe(404);
      expect(await db.select().from(mockExams)).toHaveLength(0);
    });

    it('are offered to allowed accounts only when all four skills exist, and start with that book test', async () => {
      const { headers } = await testUser(ALLOWED);
      const o = await body(await req('/api/mock/options?variant=academic', { headers }));
      expect(o.cambridge).toEqual([{ ref: 'C19 T2', bookTest: 'C19 T2', started: false }]);
      expect((await create(headers, { variant: 'academic', source: 'cambridge', ref: 'C18 T1' })).status).toBe(404);
      expect((await create(headers, { variant: 'general', source: 'cambridge', ref: 'C19 T2' })).status).toBe(404); // no General reading/writing 1
      expect((await create(headers, { variant: 'academic', source: 'cambridge' })).status).toBe(404);
      const m = await body(await create(headers, { variant: 'academic', source: 'cambridge', ref: 'C19 T2' }));
      expect(m).toMatchObject({ source: 'cambridge', ref: 'C19 T2' });
      const row = (await db.query.mockExams.findFirst({ where: eq(mockExams.id, m.id) }))!;
      const tests = await db.select().from(lrTests);
      expect(tests.filter((t) => [row.listeningTestId, row.readingTestId].includes(t.id)).map((t) => t.ref)).toEqual(['C19 T2', 'C19 T2']);
      expect((await body(await req('/api/mock/options?variant=academic', { headers }))).cambridge[0].started).toBe(true);
    });
  });
});
