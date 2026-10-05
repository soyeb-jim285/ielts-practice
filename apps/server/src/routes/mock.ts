// Full mock test (docs/mock-exam.md): a thin layer over the normal sections. It picks the tests, sequences them and gathers the bands;
// every section still creates its own lr_attempts / attempts rows and is scored and charged as usual.
import { createRoute, z } from '@hono/zod-openapi';
import { overallBand, sessionBand, weightedWritingBand } from '@ielts/core';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { visiblePromptWhere } from '../access';
import { currentUser, isCambridgeAllowed, requireAccount } from '../auth';
import { db } from '../db/client';
import { analyses, attempts, liveSessions, lrAttempts, lrTests, mockExams, prompts } from '../db/schema';
import { ApiError } from '../errors';
import { clientIpHash } from '../ip';
import { checkStart, liveProviders, payerOf, quotaSnapshot, requireLive } from '../quota';
import { lrSaveLimit } from '../ratelimit';
import type { App, SessionUser } from '../types';
import { CodedError, QuotaFields } from './community';
import { canOpen, insertLrAttempt } from './lr';
import { pick, pickSpeakingTest, PromptSchema, promptsByIds, SpeakingTestSchema, speakingTestByIds } from './prompts';

type Row = typeof mockExams.$inferSelect;
type Skill = 'listening' | 'reading' | 'writing' | 'speaking';
type State = 'todo' | 'in_progress' | 'submitted' | 'marking' | 'done' | 'failed' | 'skipped';

const DAY = 86_400_000;
const LIMIT_S: Record<Skill, number | null> = { listening: 1800, reading: 3600, writing: 3600, speaking: null };
const Variant = z.enum(['academic', 'general']);
const Id = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });
const MockError = z.object({ error: z.string(), code: z.string().optional(), mockId: z.string().optional() }).openapi('MockError');
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const common = { tags: ['Mock exam'], security: [{ bearer: [] }], middleware: [requireAccount] };
const notFound = { 404: json(MockError, 'Not found (also for another person\'s mock)') };
const conflict = { 409: json(MockError, 'mock_closed | out_of_order | section_done') };

const SectionSchema = z.object({
  skill: z.enum(['listening', 'reading', 'writing', 'speaking']),
  state: z.enum(['todo', 'in_progress', 'submitted', 'marking', 'done', 'failed', 'skipped']),
  band: z.number().nullable(),
  attemptId: z.string().nullable().openapi({ description: 'LR attempt, first writing attempt, first speaking attempt (link target)' }),
  sessionId: z.string().nullable().openapi({ description: 'Writing / speaking session for the result switcher' }),
  elapsedS: z.number().nullable(),
  limitS: z.number().nullable().openapi({ description: 'Listening 1800 (plus the 2-minute check), reading 3600, writing 3600, speaking none' }),
  mode: z.enum(['recorded', 'live']).nullable(),
});
const MockSchema = z
  .object({
    id: z.string(),
    variant: Variant,
    source: z.enum(['cambridge', 'generated']),
    ref: z.string().nullable(),
    status: z.enum(['in_progress', 'completed', 'closed']),
    startedAt: z.string(),
    expiresAt: z.string(),
    completedAt: z.string().nullable(),
    next: z.enum(['listening', 'reading', 'writing', 'speaking']).nullable().openapi({ description: 'First section not yet submitted; null once the mock is completed or closed' }),
    overall: z.number().nullable().openapi({ description: 'Mean of the four section bands to the nearest 0.5; null until all four exist' }),
    sections: z.array(SectionSchema),
  })
  .openapi('Mock');

// ---------- section state, derived from the linked attempts ----------
type Att = { id: string; part: number; status: 'recording' | 'analyzing' | 'done' | 'failed'; createdAt: Date; overall: number | null; noSpeech: boolean; at: Date | null };
type Sec = z.infer<typeof SectionSchema> & { at: Date | null };

/** Newest attempt per part, in part order: a retried part counts once. */
const latestPerPart = (rows: Att[]) => [...new Map([...rows].sort((a, b) => +a.createdAt - +b.createdAt).map((r) => [r.part, r])).values()].sort((a, b) => a.part - b.part);
/** Speaking: newest attempt per prompt (Part 1 has several), in part order. */
const latestPerPrompt = (rows: (Att & { promptId: string })[]) => [...new Map([...rows].sort((a, b) => +a.createdAt - +b.createdAt).map((r) => [r.promptId, r])).values()].sort((a, b) => a.part - b.part);
const rollup = (rows: Att[]): State => (rows.some((r) => r.status === 'analyzing') ? 'marking' : rows.some((r) => r.status === 'failed') ? 'failed' : 'done');
const latest = (ds: (Date | null)[]) => ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

async function sectionsOf(m: Row): Promise<Sec[]> {
  const lrIds = [m.listeningAttemptId, m.readingAttemptId].filter((x): x is string => !!x);
  const sessions = [m.writingSessionId, m.speakingSessionId].filter((x): x is string => !!x);
  const [lr, rows] = await Promise.all([
    lrIds.length ? db.select().from(lrAttempts).where(and(eq(lrAttempts.userId, m.userId), inArray(lrAttempts.id, lrIds))) : [],
    db
      .select({
        id: attempts.id, promptId: attempts.promptId, part: attempts.part, sessionId: attempts.sessionId, status: attempts.status, createdAt: attempts.createdAt, overall: analyses.overall, at: analyses.createdAt,
        noSpeech: sql<boolean>`coalesce(${analyses.result}->>'noSpeech', 'false') = 'true'`,
      })
      .from(attempts)
      .leftJoin(analyses, eq(analyses.attemptId, attempts.id))
      .where(and(eq(attempts.userId, m.userId), inArray(attempts.sessionId, sessions))),
  ]);
  const lrSec = (skill: 'listening' | 'reading', id: string | null): Sec => {
    const a = lr.find((x) => x.id === id);
    const state: State = !id ? 'todo' : !a ? 'skipped' : a.status === 'submitted' ? 'done' : 'in_progress';
    return { skill, state, band: a?.status === 'submitted' ? a.band : null, attemptId: id, sessionId: null, elapsedS: a?.elapsedS ?? null, limitS: LIMIT_S[skill], mode: null, at: a?.submittedAt ?? null };
  };

  const w = latestPerPart(rows.filter((r) => r.sessionId === m.writingSessionId));
  const wSub = w.filter((r) => r.status !== 'recording');
  const wState: State = wSub.length >= 2 ? rollup(wSub) : !w.length && m.writingAttemptIds.length ? 'skipped' : m.writingStartedAt || w.length ? 'in_progress' : 'todo';
  const [t1, t2] = [wSub.find((r) => r.part === 1)?.overall, wSub.find((r) => r.part === 2)?.overall];
  const writing: Sec = {
    skill: 'writing', state: wState, band: wState === 'done' && t1 != null && t2 != null ? weightedWritingBand(t1, t2) : null,
    attemptId: w[0]?.id ?? m.writingAttemptIds[0] ?? null, sessionId: m.writingSessionId, elapsedS: m.writingElapsedS, limitS: LIMIT_S.writing, mode: null,
    at: wState === 'done' ? latest(wSub.map((r) => r.at)) : null,
  };

  const s = latestPerPrompt(rows.filter((r) => r.sessionId === m.speakingSessionId));
  const sSub = s.filter((r) => r.status !== 'recording');
  const complete = m.speakingMode === 'live' ? sSub.length >= 1 : [2, 3].every((p) => sSub.some((r) => r.part === p)) && sSub.length === s.length;
  let sState: State = complete ? rollup(sSub) : sSub.length ? 'in_progress' : 'todo';
  // mean of the per-part means, so Part 1's several segments weigh as one part
  const byPart = new Map<number, number[]>();
  for (const r of sSub) if (r.status === 'done' && r.overall != null && !r.noSpeech) byPart.set(r.part, [...(byPart.get(r.part) ?? []), r.overall]);
  const scored = [...byPart.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  if (sState === 'done' && !scored.length) sState = 'failed'; // nothing was heard: no band to give
  const speaking: Sec = {
    skill: 'speaking', state: sState, band: sState === 'done' ? sessionBand(scored) : null, attemptId: s[0]?.id ?? null, sessionId: m.speakingSessionId,
    elapsedS: null, limitS: null, mode: m.speakingMode, at: sState === 'done' ? latest(sSub.map((r) => r.at)) : null,
  };

  const all = [lrSec('listening', m.listeningAttemptId), lrSec('reading', m.readingAttemptId), writing, speaking];
  // A closed mock never runs again: whatever was not taken reads as skipped.
  return m.status === 'closed' ? all.map((x) => (x.state === 'todo' || x.state === 'in_progress' ? { ...x, state: 'skipped' as const } : x)) : all;
}

const waiting = (s: Sec) => s.state === 'todo' || s.state === 'in_progress';
/** A section the person is past: submitted (marked or not) or skipped. */
const past = (m: { sections: Sec[] }, skill: Skill) => !waiting(m.sections.find((s) => s.skill === skill)!);

/** Loads one of the caller's mocks (404 for anyone else's) and settles it lazily: completed once all four bands exist, closed once expired with Speaking still to do. */
async function loadMock(userId: string, id: string) {
  let m = await db.query.mockExams.findFirst({ where: and(eq(mockExams.id, id), eq(mockExams.userId, userId)) });
  if (!m) throw new HTTPException(404, { message: 'Mock test not found' });
  return settle(m);
}
async function settle(m: Row) {
  let sections = await sectionsOf(m);
  if (m.status === 'in_progress') {
    const set = sections.every((s) => s.band != null)
      ? { status: 'completed' as const, completedAt: latest(sections.map((s) => s.at)) ?? new Date() }
      : m.expiresAt < new Date() && waiting(sections[3]!) ? { status: 'closed' as const } : null;
    if (set) {
      const [u] = await db.update(mockExams).set(set).where(and(eq(mockExams.id, m.id), eq(mockExams.status, 'in_progress'))).returning();
      if (u) {
        m = u;
        sections = await sectionsOf(m);
      }
    }
  }
  return { m, sections };
}
async function openMock(userId: string, id: string) {
  const r = await loadMock(userId, id);
  if (r.m.status !== 'in_progress') throw new ApiError(409, { error: 'This mock test is finished.', code: 'mock_closed' });
  return r;
}

function toMock({ m, sections }: { m: Row; sections: Sec[] }) {
  const bands = sections.map((s) => s.band);
  return {
    id: m.id, variant: m.variant, source: m.source, ref: m.ref, status: m.status,
    startedAt: m.startedAt.toISOString(), expiresAt: m.expiresAt.toISOString(), completedAt: m.completedAt?.toISOString() ?? null,
    next: m.status === 'in_progress' ? (sections.find(waiting)?.skill ?? null) : null,
    overall: bands.every((b): b is number => b != null) ? overallBand(bands) : null,
    sections: sections.map(({ at: _at, ...s }) => s),
  };
}

// ---------- hooks used by attempts.ts and live.ts ----------
/** POST /api/attempts with a mockId: the mock is the caller's, open, and the attempt is one of its own tasks in its own session. */
export async function checkMockAttempt(userId: string, mockId: string, b: { skill: 'speaking' | 'writing'; sessionId?: string; promptId: string }) {
  const { m } = await openMock(userId, mockId);
  const ok = b.skill === 'writing' ? b.sessionId === m.writingSessionId && m.writingPromptIds.includes(b.promptId) : !!b.sessionId && b.sessionId === m.speakingSessionId && !!m.speakingPromptIds?.includes(b.promptId);
  if (!ok) throw new HTTPException(400, { message: 'This attempt does not belong to that mock test' });
}
/** POST /api/live/start with a mockId: the caller's open mock, with Live examiner chosen. */
export async function liveMock(userId: string, mockId: string) {
  const { m } = await openMock(userId, mockId);
  if (m.speakingMode !== 'live') throw new ApiError(409, { error: 'Choose the live examiner for this mock test first.', code: 'out_of_order' });
  return m;
}

// ---------- picking content ----------
/** Refs ("C19 T2") with everything a mock needs for a variant: Listening, Reading, Writing 1 + 2 and a Speaking set (a Part 2 card with its Part 3). */
async function completeRefs(variant: 'academic' | 'general'): Promise<string[]> {
  const rows = [...(await db.execute(sql`
    select distinct l.ref from lr_tests l
    where l.skill = 'listening' and l.source = 'cambridge'
      and exists (select 1 from lr_tests r where r.skill = 'reading' and r.source = 'cambridge' and r.ref = l.ref and r.variant = ${variant})
      and exists (select 1 from prompts w where w.skill = 'writing' and w.source = 'cambridge' and w.source_ref = l.ref and w.part = 1 and w.variant = ${variant})
      and exists (select 1 from prompts w where w.skill = 'writing' and w.source = 'cambridge' and w.source_ref = l.ref and w.part = 2)
      and exists (select 1 from prompts s where s.skill = 'speaking' and s.source = 'cambridge' and s.source_ref = l.ref and s.part = 1)
      and exists (select 1 from prompts s where s.skill = 'speaking' and s.source = 'cambridge' and s.source_ref = l.ref and s.part = 2 and s.group_id is not null
        and exists (select 1 from prompts s3 where s3.group_id = s.group_id and s3.part = 3 and s3.skill = 'speaking'))
    order by l.ref`))] as { ref: string }[];
  // "C9 T1" sorts before "C10 T1" by number, not by text
  return rows.map((r) => r.ref).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** An LR test of ours, preferring one the person has not submitted yet (and, for Listening, the asked variant: it is the same recording for both). */
const pickLr = async (userId: string, skill: 'listening' | 'reading', variant: 'academic' | 'general', where: ReturnType<typeof eq>) =>
  (
    await db
      .select({ id: lrTests.id })
      .from(lrTests)
      .where(and(eq(lrTests.skill, skill), where))
      .orderBy(
        sql`exists(select 1 from lr_attempts a where a.test_id = "lr_tests".id and a.user_id = ${userId} and a.status = 'submitted')`,
        ...(skill === 'listening' ? [sql`(${lrTests.variant} = ${variant}) desc`] : []),
        sql`random()`,
      )
      .limit(1)
  )[0]?.id;

const noSet = () => new ApiError(404, { error: 'There is no complete set of tests for that yet.', code: 'no_complete_set' });

async function pickContent(user: SessionUser, variant: 'academic' | 'general', source: 'cambridge' | 'generated', ref?: string) {
  if (source === 'cambridge') {
    // Not allowed and not complete look the same from outside.
    if (!ref || !isCambridgeAllowed(user) || !(await completeRefs(variant)).includes(ref)) throw noSet();
  } else if (!(await pickSpeakingTest(user, 'generated'))) throw noSet();
  const cam = source === 'cambridge';
  const at = (skill: 'listening' | 'reading') => and(eq(lrTests.source, source), cam ? eq(lrTests.ref, ref!) : undefined, skill === 'reading' ? eq(lrTests.variant, variant) : undefined)!;
  const task = (part: number) => and(eq(prompts.skill, 'writing'), eq(prompts.part, part), eq(prompts.source, source), part === 1 ? eq(prompts.variant, variant) : undefined, cam ? eq(prompts.sourceRef, ref!) : undefined);
  const [listening, reading, [w1], [w2]] = await Promise.all([pickLr(user.id, 'listening', variant, at('listening')), pickLr(user.id, 'reading', variant, at('reading')), pick(user, task(1), 1), pick(user, task(2), 1)]);
  if (!listening || !reading || !w1 || !w2) throw noSet();
  return { listeningTestId: listening, readingTestId: reading, writingPromptIds: [w1.id, w2.id] };
}

export function register(app: App) {
  app.openapi(
    createRoute({
      ...common,
      method: 'get',
      path: '/api/mock/options',
      summary: 'What a full mock test can be started from, and whether the writing and speaking allowance lets it start',
      request: { query: z.object({ variant: Variant }) },
      responses: {
        200: json(
          z
            .object({
              cambridge: z.array(z.object({ ref: z.string(), bookTest: z.string(), started: z.boolean().openapi({ description: 'You already started a mock on this test' }) })).openapi({ description: 'Complete Cambridge tests; empty unless this account has Cambridge access' }),
              own: z.boolean().openapi({ description: 'Our own tests can make a complete set' }),
              quota: z.object({ writing: QuotaFields.writing, speaking: QuotaFields.speaking }),
            })
            .openapi('MockOptions'),
          'Options',
        ),
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const { variant } = c.req.valid('query');
      const [refs, mine, [own], q] = await Promise.all([
        isCambridgeAllowed(user) ? completeRefs(variant) : [],
        db.select({ ref: mockExams.ref }).from(mockExams).where(eq(mockExams.userId, user.id)),
        db.execute(sql`select (
            exists (select 1 from lr_tests where skill = 'listening' and source = 'generated')
            and exists (select 1 from lr_tests where skill = 'reading' and source = 'generated' and variant = ${variant})
            and exists (select 1 from prompts where skill = 'writing' and source = 'generated' and part = 1 and variant = ${variant})
            and exists (select 1 from prompts where skill = 'writing' and source = 'generated' and part = 2)
            and exists (select 1 from prompts where skill = 'speaking' and source = 'generated' and part = 2)) as ok`),
        quotaSnapshot(await payerOf(user), clientIpHash(c)),
      ]);
      const started = new Set(mine.map((r) => r.ref));
      return c.json({ cambridge: refs.map((ref) => ({ ref, bookTest: ref, started: started.has(ref) })), own: !!(own as { ok: boolean } | undefined)?.ok, quota: { writing: q.writing, speaking: q.speaking } }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'get',
      path: '/api/mock/current',
      summary: 'My open mock test, or null',
      responses: { 200: json(z.object({ mock: MockSchema.nullable() }).openapi('CurrentMock'), 'The open mock') },
    }),
    async (c) => {
      const open = await db.query.mockExams.findFirst({ where: and(eq(mockExams.userId, currentUser(c).id), eq(mockExams.status, 'in_progress')) });
      const r = open && (await settle(open));
      return c.json({ mock: r && r.m.status === 'in_progress' ? toMock(r) : null }, 200); // settling may have closed or completed it
    },
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'post',
      path: '/api/mock',
      summary: 'Start a full mock test: picks the tests and checks the writing and speaking allowance (reserves nothing)',
      description: 'One open mock per person: 409 mock_open (with `mockId`) unless `replace=true`, which deletes the open mock row only (its attempts stay). 404 no_complete_set when there is no complete set (also a Cambridge ref this account may not open). Quota errors as for any test: 429, 402, 503.',
      request: {
        query: z.object({ replace: z.enum(['true', 'false']).optional() }),
        body: { required: true, content: { 'application/json': { schema: z.object({ variant: Variant, source: z.enum(['cambridge', 'generated']), ref: z.string().max(20).optional().openapi({ description: '"C19 T2"; Cambridge only' }) }).openapi('CreateMock') } } },
      },
      responses: {
        201: json(MockSchema, 'Created'),
        402: json(CodedError, 'community_balance_exhausted'),
        404: json(MockError, 'no_complete_set'),
        409: json(MockError, 'mock_open'),
        429: json(CodedError, 'quota_exceeded'),
        503: json(CodedError, 'community_busy'),
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const b = c.req.valid('json');
      const open = await db.query.mockExams.findFirst({ where: and(eq(mockExams.userId, user.id), eq(mockExams.status, 'in_progress')) });
      const still = open && (await settle(open)).m.status === 'in_progress' ? open : null;
      if (still) {
        if (c.req.valid('query').replace !== 'true') throw new ApiError(409, { error: 'You already have a mock test open.', code: 'mock_open', mockId: still.id });
        await db.delete(mockExams).where(and(eq(mockExams.id, still.id), eq(mockExams.userId, user.id)));
      }
      const content = await pickContent(user, b.variant, b.source, b.ref);
      const writingSessionId = crypto.randomUUID();
      // Writing is charged by its session, so ask for exactly that unit; Speaking only has to be not blocked now (it is often done days later).
      const payer = await payerOf(user);
      await checkStart(payer, 'writing', clientIpHash(c), writingSessionId);
      await checkStart(payer, 'speaking', clientIpHash(c));
      const [row] = await db
        .insert(mockExams)
        .values({ userId: user.id, variant: b.variant, source: b.source, ref: b.source === 'cambridge' ? b.ref : null, ...content, writingSessionId, expiresAt: new Date(Date.now() + 7 * DAY) })
        .returning();
      return c.json(toMock(await settle(row!)), 201);
    },
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'get',
      path: '/api/mock',
      summary: 'My mock tests, newest first',
      responses: { 200: json(z.object({ items: z.array(MockSchema) }).openapi('MockList'), 'Mocks') },
    }),
    async (c) => {
      const rows = await db.select().from(mockExams).where(eq(mockExams.userId, currentUser(c).id)).orderBy(desc(mockExams.startedAt)).limit(50);
      return c.json({ items: (await Promise.all(rows.map(settle))).map(toMock) }, 200);
    },
  );

  app.openapi(
    createRoute({ ...common, method: 'get', path: '/api/mock/{id}', summary: 'One mock test with the state and band of each section', request: { params: Id }, responses: { 200: json(MockSchema, 'Mock'), ...notFound } }),
    async (c) => c.json(toMock(await loadMock(currentUser(c).id, c.req.valid('param').id)), 200),
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'post',
      path: '/api/mock/{id}/sections/{skill}/start',
      summary: 'Start (or resume) the Listening or Reading attempt of a mock: an exam-mode whole-test attempt',
      description: 'Listening first; Reading only after Listening is submitted (409 out_of_order). A submitted section is 409 section_done. Load the attempt with GET /api/lr/attempts/{attemptId}.',
      request: { params: z.object({ id: z.string(), skill: z.enum(['listening', 'reading']) }) },
      responses: { 200: json(z.object({ attemptId: z.string() }).openapi('MockSectionStarted'), 'Attempt'), ...notFound, ...conflict },
    }),
    async (c) => {
      const user = currentUser(c);
      const { id, skill } = c.req.valid('param');
      const { m, sections } = await openMock(user.id, id);
      if (skill === 'reading' && !past({ sections }, 'listening')) throw new ApiError(409, { error: 'Finish Listening first.', code: 'out_of_order' });
      const sec = sections.find((s) => s.skill === skill)!;
      if (sec.state === 'done') throw new ApiError(409, { error: 'This section is already submitted.', code: 'section_done' });
      if (sec.attemptId && sec.state === 'in_progress') return c.json({ attemptId: sec.attemptId }, 200);
      const t = await db.query.lrTests.findFirst({ where: eq(lrTests.id, skill === 'listening' ? m.listeningTestId : m.readingTestId) });
      if (!t || !canOpen(t, user)) throw new HTTPException(404, { message: 'Test not found' }); // Cambridge access lost mid-mock
      const a = await insertLrAttempt(user.id, t.id, 'exam', null);
      await db.update(mockExams).set(skill === 'listening' ? { listeningAttemptId: a.id } : { readingAttemptId: a.id }).where(eq(mockExams.id, m.id));
      return c.json({ attemptId: a.id }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'post',
      path: '/api/mock/{id}/writing/start',
      summary: 'Start (or resume) Writing: both prompts, the shared session id and the time already used',
      description: 'Only after Reading is submitted (409 out_of_order). Send `mockId` and `sessionId` with each POST /api/attempts; keep the clock with PATCH writing/clock.',
      request: { params: Id },
      responses: { 200: json(z.object({ prompts: z.array(PromptSchema), writingSessionId: z.string(), elapsedS: z.number() }).openapi('MockWritingStarted'), 'Prompts'), ...notFound, ...conflict },
    }),
    async (c) => {
      const user = currentUser(c);
      const { m, sections } = await openMock(user.id, c.req.valid('param').id);
      if (!past({ sections }, 'reading')) throw new ApiError(409, { error: 'Finish Reading first.', code: 'out_of_order' });
      if (sections[2]!.state !== 'todo' && sections[2]!.state !== 'in_progress') throw new ApiError(409, { error: 'Writing is already submitted.', code: 'section_done' });
      const ps = await promptsByIds(user, m.writingPromptIds);
      if (!ps) throw new HTTPException(404, { message: 'Prompt not found' });
      await db.update(mockExams).set({ writingStartedAt: m.writingStartedAt ?? new Date() }).where(eq(mockExams.id, m.id));
      return c.json({ prompts: ps, writingSessionId: m.writingSessionId, elapsedS: m.writingElapsedS }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...common,
      middleware: [requireAccount, lrSaveLimit],
      method: 'patch',
      path: '/api/mock/{id}/writing/clock',
      summary: 'Autosave the Writing clock (only ever increases)',
      request: { params: Id, body: { required: true, content: { 'application/json': { schema: z.object({ elapsedS: z.number().int().min(0).max(7200) }) } } } },
      responses: { 200: json(z.object({ elapsedS: z.number() }), 'Saved'), ...notFound, ...conflict },
    }),
    async (c) => {
      const { m } = await openMock(currentUser(c).id, c.req.valid('param').id);
      const [u] = await db.update(mockExams).set({ writingElapsedS: sql`greatest(${mockExams.writingElapsedS}, ${c.req.valid('json').elapsedS})` }).where(eq(mockExams.id, m.id)).returning({ elapsedS: mockExams.writingElapsedS });
      return c.json({ elapsedS: u!.elapsedS }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'post',
      path: '/api/mock/{id}/speaking/choose',
      summary: 'Choose how to do Speaking: recorded test or live examiner',
      description: 'Needs Writing submitted. recorded: returns the test and the session id (send both `mockId` and `sessionId` with each speaking attempt); the speaking allowance is checked again now. live: needs the person\'s own key (403 live_requires_own_key); pass `mockId` to /api/live/start, then POST speaking/attach. Switching is allowed until a speaking attempt has been submitted.',
      request: { params: Id, body: { required: true, content: { 'application/json': { schema: z.object({ mode: z.enum(['recorded', 'live']) }) } } } },
      responses: {
        200: json(
          z.object({ mode: z.enum(['recorded', 'live']), sessionId: z.string().optional(), test: SpeakingTestSchema.optional(), source: z.enum(['cambridge', 'generated']).optional(), ref: z.string().nullable().optional() }).openapi('MockSpeakingChosen'),
          'Chosen',
        ),
        402: json(CodedError, 'community_balance_exhausted'),
        403: json(CodedError, 'live_requires_own_key'),
        429: json(CodedError, 'quota_exceeded'),
        503: json(CodedError, 'community_busy'),
        ...notFound,
        ...conflict,
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const { m, sections } = await openMock(user.id, c.req.valid('param').id);
      if (!past({ sections }, 'writing')) throw new ApiError(409, { error: 'Finish Writing first.', code: 'out_of_order' });
      const { mode } = c.req.valid('json');
      // A recorded test with some parts in can be resumed (it restarts at Part 1); anything else is final once an attempt exists.
      const resume = sections[3]!.state === 'in_progress' && mode === 'recorded' && m.speakingMode === 'recorded' && !!m.speakingSessionId && !!m.speakingPromptIds;
      if (sections[3]!.state !== 'todo' && !resume) throw new ApiError(409, { error: 'Speaking has already been submitted.', code: 'section_done' });
      const payer = await payerOf(user);
      if (mode === 'live') {
        if (!liveProviders(payer).length) requireLive(payer, 'turn');
        await db.update(mockExams).set({ speakingMode: 'live', speakingPromptIds: null, speakingSessionId: null }).where(eq(mockExams.id, m.id));
        return c.json({ mode: 'live' as const, source: m.source, ref: m.ref }, 200);
      }
      const sessionId = m.speakingMode === 'recorded' && m.speakingSessionId && m.speakingPromptIds ? m.speakingSessionId : crypto.randomUUID();
      await checkStart(payer, 'speaking', clientIpHash(c), sessionId);
      // Chosen before and not submitted: the same questions again (it restarts at Part 1).
      const kept = sessionId === m.speakingSessionId ? await speakingTestByIds(user, m.speakingPromptIds!) : null;
      const test = kept ?? (await pickSpeakingTest(user, m.source, m.ref));
      if (!test) throw noSet();
      if (!kept) {
        const ids = [...test.part1.map((p) => p.id), test.part2.id, test.part3.id];
        await db.update(mockExams).set({ speakingMode: 'recorded', speakingPromptIds: ids, speakingSessionId: sessionId }).where(eq(mockExams.id, m.id));
      }
      return c.json({ mode: 'recorded' as const, sessionId, test }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'post',
      path: '/api/mock/{id}/speaking/attach',
      summary: 'Live examiner: link the finished live session to the mock',
      description: 'After POST /api/live/finish. 400 unless that session has attempts of this person.',
      request: { params: Id, body: { required: true, content: { 'application/json': { schema: z.object({ sessionId: z.string() }) } } } },
      responses: { 200: json(MockSchema, 'Mock'), 400: json(MockError, 'Not your finished live session'), ...notFound, ...conflict },
    }),
    async (c) => {
      const user = currentUser(c);
      const { m } = await openMock(user.id, c.req.valid('param').id);
      if (m.speakingMode !== 'live') throw new ApiError(409, { error: 'Choose the live examiner for this mock test first.', code: 'out_of_order' });
      const { sessionId } = c.req.valid('json');
      const [live] = await db.select({ id: liveSessions.id }).from(liveSessions).where(and(eq(liveSessions.id, sessionId), eq(liveSessions.userId, user.id)));
      const [a] = live ? await db.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.userId, user.id), eq(attempts.sessionId, sessionId), eq(attempts.skill, 'speaking'), gte(attempts.createdAt, m.startedAt))).limit(1) : [];
      if (!a) throw new HTTPException(400, { message: 'No finished live session with that id' });
      const [taken] = await db.select({ id: mockExams.id }).from(mockExams).where(and(eq(mockExams.speakingSessionId, sessionId), ne(mockExams.id, m.id))).limit(1);
      if (taken) throw new HTTPException(400, { message: 'That live session belongs to another mock test' });
      const [u] = await db.update(mockExams).set({ speakingSessionId: sessionId }).where(eq(mockExams.id, m.id)).returning();
      return c.json(toMock(await settle(u!)), 200);
    },
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'post',
      path: '/api/mock/{id}/close',
      summary: 'Finish without Speaking: closes the mock, Speaking is skipped and there is no overall band',
      request: { params: Id },
      responses: { 200: json(MockSchema, 'Mock'), ...notFound, ...conflict },
    }),
    async (c) => {
      const { m, sections } = await openMock(currentUser(c).id, c.req.valid('param').id);
      if (!past({ sections }, 'writing')) throw new ApiError(409, { error: 'Finish Writing first.', code: 'out_of_order' });
      const [u] = await db.update(mockExams).set({ status: 'closed' }).where(and(eq(mockExams.id, m.id), eq(mockExams.status, 'in_progress'))).returning();
      return c.json(toMock(await settle(u ?? m)), 200);
    },
  );

  app.openapi(
    createRoute({
      ...common,
      method: 'delete',
      path: '/api/mock/{id}',
      summary: 'Abandon a mock test: deletes the mock only, its attempts stay as practice history',
      request: { params: Id },
      responses: { 200: json(z.object({ ok: z.boolean() }), 'Deleted'), ...notFound },
    }),
    async (c) => {
      const [gone] = await db.delete(mockExams).where(and(eq(mockExams.id, c.req.valid('param').id), eq(mockExams.userId, currentUser(c).id))).returning({ id: mockExams.id });
      if (!gone) return c.json({ error: 'Mock test not found' }, 404);
      return c.json({ ok: true }, 200);
    },
  );
}
