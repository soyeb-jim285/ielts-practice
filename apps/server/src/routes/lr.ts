import { createRoute, z } from '@hono/zod-openapi';
import { analyseAttempt, lrTypeLabel, maskWord, pickParts, scoreLr, stripAnswers, tfngPattern, type GapEntry, type LrAnalysis, type LrTest } from '@ielts/core';
import { and, desc, eq, like, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { currentUser, isCambridgeAllowed, isOwner, requireUser } from '../auth';
import { db } from '../db/client';
import { cards, lrAttempts, lrTests } from '../db/schema';
import { lrSaveLimit } from '../ratelimit';
import { storage } from '../storage';
import type { App } from '../types';
import { insertCards } from './cards';

/** The one place a Listening & Reading attempt row is created (the normal start and the full mock test). */
export const insertLrAttempt = (userId: string, testId: string, mode: 'exam' | 'practice', parts: number[] | null) =>
  db.insert(lrAttempts).values({ userId, testId, mode, parts }).returning().then((r) => r[0]!);

/** Where importer-uploaded assets live in storage (scripts/lr-import.ts). */
export const lrAssetKey = (key: string) => `lr/${key}`;

const Skill = z.enum(['listening', 'reading']);
const Variant = z.enum(['academic', 'general']);
const Source = z.enum(['cambridge', 'generated']);
const Mode = z.enum(['exam', 'practice']);
const Status = z.enum(['in_progress', 'submitted']);
const Parts = z.array(z.number().int().min(1).max(4)).nullable().openapi({ description: 'Chosen parts (listening 1–4, reading passages 1–3); null = the whole test. Partial attempts are scored raw/total with no band.' });

const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() }).openapi('LrError');
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const common = { tags: ['Listening & Reading'], security: [{ bearer: [] }], middleware: [requireUser] };
const errors = { 404: json(ErrorSchema, 'Not found (also for a Cambridge test this user may not open)') };

type Viewer = Parameters<typeof isCambridgeAllowed>[0];
/** Our own tests are open to everyone; Cambridge (restricted) tests only to allow-listed, verified accounts. */
export const canOpen = (t: { restricted: boolean }, u: Viewer) => !t.restricted || isCambridgeAllowed(u);
const visibleWhere = (u: Viewer): SQL | undefined => (isCambridgeAllowed(u) ? undefined : eq(lrTests.restricted, false));

const Option = z.object({ key: z.string(), text: z.string() });
const QuestionReview = z
  .object({
    evidence: z.string().optional(),
    at: z.number().optional(),
    why: z.string().optional(),
    wrong: z.record(z.string(), z.string()).optional(),
    paraphrase: z.array(z.array(z.string())).optional().openapi({ description: '[question wording, passage wording] pairs' }),
  })
  .openapi('LrQuestionReview');
const Stats = z
  .object({
    partS: z.record(z.string().regex(/^\d$/), z.number().min(0).max(86400)),
    changes: z.record(z.string().regex(/^\d{1,2}$/), z.number().int().min(0).max(500)),
    late: z.array(z.number().int().min(1).max(60)).max(60),
    audio: z
      .object({
        pos: z.record(z.string().regex(/^\d$/), z.number().min(0).max(3600)).openapi({ description: 'Practice listening: saved playback position (seconds) per part' }),
        rate: z.union([z.literal(0.75), z.literal(1), z.literal(1.25)]).optional(),
      })
      .optional(),
  })
  .openapi('LrStats', { description: 'Runner pacing: seconds per part, answer changes per question, questions answered in the final 5 minutes; audio = practice playback resume state' });
/** Clients that do not know `audio` (older apps) must not wipe it: keep the stored one when the incoming stats omit it. */
const keepAudio = (next: z.infer<typeof Stats>, old: z.infer<typeof Stats> | null) => (next.audio || !old?.audio ? next : { ...next, audio: old.audio });
const GapEntrySchema = z
  .object({ n: z.number(), kind: z.string(), label: z.string(), message: z.string(), word: z.string().optional(), typed: z.string().optional(), before: z.number().optional().openapi({ description: 'Times misspelt in earlier attempts' }) })
  .openapi('LrGapMistake');
const AnalysisSchema = z
  .object({
    gaps: z.array(GapEntrySchema),
    tfng: z.array(z.object({ n: z.number(), kind: z.enum(['tfng', 'ynng']), chose: z.string(), answer: z.string() })),
    byType: z.array(z.object({ label: z.string(), right: z.number(), total: z.number() })),
  })
  .openapi('LrAnalysis');
const LrTestSchema = z
  .object({
    slug: z.string(),
    skill: Skill,
    variant: Variant,
    source: Source,
    ref: z.string(),
    title: z.string(),
    sections: z.array(
      z.object({
        part: z.number(),
        title: z.string().optional(),
        audio: z.string().optional().openapi({ description: 'Asset key; see `assets` for the URL' }),
        transcript: z.string().optional().openapi({ description: 'Only after submission' }),
        vocab: z.array(z.object({ word: z.string(), meaning: z.string(), example: z.string().optional() })).optional().openapi({ description: 'Only after submission' }),
        timings: z.array(z.array(z.union([z.string(), z.number()]))).optional().openapi({ description: 'Listening word timings [word, start s, end s]; only after submission' }),
        passage: z.object({ title: z.string(), subtitle: z.string().optional(), paragraphs: z.array(z.object({ label: z.string().optional(), text: z.string() })) }).optional(),
        groups: z.array(
          z.object({
            from: z.number(),
            to: z.number(),
            type: z.enum(['gap', 'mcq', 'mcq-multi', 'tfng', 'ynng', 'match']),
            instructions: z.string(),
            wordLimit: z.string().optional(),
            title: z.string().optional(),
            content: z.string().optional(),
            options: z.array(Option).optional(),
            reusable: z.boolean().optional(),
            image: z.string().optional(),
            questions: z.array(z.object({ n: z.number(), text: z.string().optional(), options: z.array(Option).optional(), answer: z.array(z.string()).optional().openapi({ description: 'Only after submission' }), review: QuestionReview.optional().openapi({ description: 'Only after submission' }) })),
          }),
        ),
      }),
    ),
  })
  .openapi('LrTest');

const Responses = z.record(z.string().regex(/^\d{1,2}$/), z.string().max(200)).refine((r) => Object.keys(r).length <= 60, 'too many answers').openapi('LrResponses');

const TestListItem = z
  .object({
    id: z.string(),
    slug: z.string(),
    skill: Skill,
    variant: Variant,
    source: Source,
    ref: z.string(),
    title: z.string(),
    total: z.number().openapi({ description: 'Questions in the in-progress attempt (only its parts), else 40' }),
    status: z.enum(['new', 'in_progress', 'submitted']).openapi({ description: 'From the latest attempt' }),
    attemptId: z.string().nullable().openapi({ description: 'The in-progress attempt, when there is one' }),
    mode: Mode.nullable().openapi({ description: 'Mode of the in-progress attempt' }),
    parts: Parts.openapi({ description: 'Parts of the in-progress attempt (null = whole test or none)' }),
    answered: z.number().openapi({ description: 'Answered questions in the in-progress attempt' }),
    bestBand: z.number().nullable().openapi({ description: 'Best band of a whole-test attempt (partial attempts have no band)' }),
    attempts: z.number().openapi({ description: 'Submitted attempts (whole and partial)' }),
  })
  .openapi('LrTestListItem');

const MarkSchema = z.object({ n: z.number(), given: z.string(), correct: z.boolean(), answer: z.array(z.string()) });
const AttemptSchema = z
  .object({
    id: z.string(),
    testId: z.string(),
    mode: Mode,
    parts: Parts,
    status: Status,
    responses: Responses,
    elapsedS: z.number(),
    startedAt: z.string(),
    submittedAt: z.string().nullable(),
    raw: z.number().nullable(),
    total: z.number().nullable(),
    band: z.number().nullable().openapi({ description: 'Null while in progress and for partial attempts' }),
    marks: z.array(MarkSchema).nullable(),
    stats: Stats.nullable(),
    analysis: AnalysisSchema.nullable().openapi({ description: 'Deterministic review computed at submit (null for older attempts)' }),
    test: LrTestSchema.openapi({ description: 'Only the chosen parts; stripped (no answers, no transcript) until submitted' }),
    assets: z.record(z.string(), z.string()).openapi({ description: 'Asset key → presigned GET URL (audio supports Range)' }),
  })
  .openapi('LrAttempt');

const AttemptListItem = z
  .object({
    id: z.string(),
    testId: z.string(),
    skill: Skill,
    variant: Variant,
    ref: z.string(),
    title: z.string(),
    mode: Mode,
    parts: Parts,
    status: Status,
    raw: z.number().nullable(),
    total: z.number().nullable(),
    band: z.number().nullable(),
    answered: z.number(),
    startedAt: z.string(),
    submittedAt: z.string().nullable(),
  })
  .openapi('LrAttemptListItem');

const answered = (r: Record<string, string>) => Object.values(r).filter((v) => v.trim()).length;

/** Drops junk keys/blank values; only question numbers of this (possibly partial) test survive. */
const cleanResponses = (r: Record<string, string>, t: LrTest) => {
  const ns = new Set(t.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => String(q.n)))));
  return Object.fromEntries(Object.entries(r).filter(([k, v]) => ns.has(k) && v.trim()).map(([k, v]) => [k, v.slice(0, 200)]));
};

async function assetUrls(test: LrTest) {
  const keys = new Set<string>();
  for (const s of test.sections) {
    if (s.audio) keys.add(s.audio);
    for (const g of s.groups) if (g.image) keys.add(g.image);
  }
  return Object.fromEntries(await Promise.all([...keys].map(async (k) => [k, await storage.presignGet(lrAssetKey(k), 6 * 3600)] as const)));
}

/** `readAny`: the owner (admin area) may open anyone's attempt; only GET passes it, every write stays own-rows-only. */
async function ownAttempt(id: string, user: { id: string; email: string; emailVerified: boolean; isAnonymous?: boolean }, readAny = false) {
  const any = readAny && isOwner(user);
  const a = await db.query.lrAttempts.findFirst({ where: and(eq(lrAttempts.id, id), any ? undefined : eq(lrAttempts.userId, user.id)) });
  if (!a) throw new HTTPException(404, { message: 'Attempt not found' });
  const t = await db.query.lrTests.findFirst({ where: eq(lrTests.id, a.testId) });
  if (!t || (!any && !canOpen(t, user))) throw new HTTPException(404, { message: 'Test not found' });
  return { a, t };
}

type AttemptRow = typeof lrAttempts.$inferSelect;
async function toAttempt(a: AttemptRow, t: typeof lrTests.$inferSelect) {
  const done = a.status === 'submitted';
  const test = pickParts(t.data, a.parts);
  return {
    id: a.id,
    testId: a.testId,
    mode: a.mode,
    parts: a.parts ?? null,
    status: a.status,
    responses: a.responses as Record<string, string>,
    elapsedS: a.elapsedS,
    startedAt: a.startedAt.toISOString(),
    submittedAt: a.submittedAt?.toISOString() ?? null,
    raw: a.raw,
    total: a.total,
    band: a.band,
    marks: a.marks,
    stats: a.stats ?? null,
    analysis: a.analysis ?? null,
    test: done ? test : stripAnswers(test),
    assets: await assetUrls(test),
  };
}

export function register(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lr/tests',
      tags: common.tags,
      security: [{ bearer: [] }, {}] as Record<string, string[]>[], // {} = optional: a visitor sees the open tests, like the prompt bank
      summary: 'List the Listening & Reading tests you may open (Cambridge ones only for allow-listed accounts) with your latest status and best band',
      request: { query: z.object({ skill: Skill.optional(), variant: Variant.optional(), source: Source.optional() }) },
      responses: { 200: json(z.object({ items: z.array(TestListItem) }), 'Tests') },
    }),
    async (c) => {
      const user = c.get('user');
      const q = c.req.valid('query');
      const rows = await db
        .select({
          id: lrTests.id, slug: lrTests.slug, skill: lrTests.skill, variant: lrTests.variant, source: lrTests.source, ref: lrTests.ref, title: lrTests.title,
          // questions per part, for the total of a partial in-progress attempt
          sizes: sql<Record<string, number>>`(select jsonb_object_agg(s->>'part', (select count(*) from jsonb_array_elements(s->'groups') g, jsonb_array_elements(g->'questions'))) from jsonb_array_elements(${lrTests.data}->'sections') s)`,
        })
        .from(lrTests)
        .where(and(visibleWhere(user), eq(lrTests.retired, false), q.skill ? eq(lrTests.skill, q.skill) : undefined, q.variant ? eq(lrTests.variant, q.variant) : undefined, q.source ? eq(lrTests.source, q.source) : undefined))
        .orderBy(lrTests.ref);
      const mine = user ? await db.select().from(lrAttempts).where(eq(lrAttempts.userId, user.id)).orderBy(desc(lrAttempts.startedAt)) : [];
      const byTest = new Map<string, typeof mine>();
      for (const a of mine) byTest.set(a.testId, [...(byTest.get(a.testId) ?? []), a]);
      const items = rows.map(({ sizes, ...t }) => {
        const as = byTest.get(t.id) ?? [];
        const open = as.find((a) => a.status === 'in_progress');
        const subs = as.filter((a) => a.status === 'submitted');
        return {
          ...t,
          total: open?.parts ? open.parts.reduce((n, p) => n + Number(sizes?.[p] ?? 0), 0) : 40,
          status: (as[0] ? as[0].status : 'new') as 'new' | 'in_progress' | 'submitted',
          attemptId: open?.id ?? null,
          mode: open?.mode ?? null,
          parts: open?.parts ?? null,
          answered: open ? answered(open.responses as Record<string, string>) : 0,
          bestBand: subs.some((a) => a.band != null) ? Math.max(...subs.map((a) => a.band ?? 0)) : null,
          attempts: subs.length,
        };
      });
      return c.json({ items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/lr/tests/{id}/attempts',
      ...common,
      summary: 'Start an attempt, or resume the in-progress one for this test',
      description: 'Without `fresh`, an in-progress attempt of this test is resumed whatever mode/parts are asked. With `fresh: true` any in-progress attempt of this test is discarded and a new one starts.',
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: {
            'application/json': {
              schema: z.object({
                mode: Mode,
                parts: z.array(z.number().int().min(1).max(4)).min(1).max(4).optional().openapi({ description: 'Take only these parts; omit for the whole test' }),
                fresh: z.boolean().optional().openapi({ description: 'Discard the in-progress attempt of this test (if any) and start a new one' }),
              }),
            },
          },
          required: true,
        },
      },
      responses: { 200: json(AttemptSchema, 'Attempt (resumed or new). Test is stripped.'), 400: json(ErrorSchema, 'A part this test does not have'), ...errors },
    }),
    async (c) => {
      const user = currentUser(c);
      const t = await db.query.lrTests.findFirst({ where: eq(lrTests.id, c.req.valid('param').id) });
      if (!t || !canOpen(t, user)) throw new HTTPException(404, { message: 'Test not found' });
      const { mode, parts, fresh } = c.req.valid('json');
      const have = t.data.sections.map((s) => s.part);
      if (parts?.some((p) => !have.includes(p))) throw new HTTPException(400, { message: 'This test has no such part' });
      // every part chosen = the whole test (keeps the band)
      const chosen = parts && have.some((p) => !parts.includes(p)) ? [...new Set(parts)].sort((x, y) => x - y) : null;
      const mineOpen = and(eq(lrAttempts.userId, user.id), eq(lrAttempts.testId, t.id), eq(lrAttempts.status, 'in_progress'));
      const open = await db.query.lrAttempts.findFirst({ where: mineOpen });
      // a replaced test can still be finished, never started again
      if (t.retired && (fresh || !open)) throw new HTTPException(404, { message: 'This test has been replaced by a newer version' });
      if (fresh && open) await db.delete(lrAttempts).where(mineOpen);
      const a = (!fresh && open) || await insertLrAttempt(user.id, t.id, mode, chosen);
      return c.json(await toAttempt(a, t), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lr/tests/{id}',
      ...common,
      summary: 'A test without answers or transcripts, with presigned asset URLs',
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: json(z.object({ id: z.string(), test: LrTestSchema, assets: z.record(z.string(), z.string()) }), 'Stripped test'), ...errors },
    }),
    async (c) => {
      const t = await db.query.lrTests.findFirst({ where: eq(lrTests.id, c.req.valid('param').id) });
      if (!t || !canOpen(t, currentUser(c))) throw new HTTPException(404, { message: 'Test not found' });
      return c.json({ id: t.id, test: stripAnswers(t.data), assets: await assetUrls(t.data) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lr/attempts',
      ...common,
      summary: 'My Listening & Reading attempts, newest first',
      responses: { 200: json(z.object({ items: z.array(AttemptListItem) }), 'Attempts'), ...errors },
    }),
    async (c) => {
      const user = currentUser(c);
      const rows = await db
        .select({ a: lrAttempts, skill: lrTests.skill, variant: lrTests.variant, ref: lrTests.ref, title: lrTests.title })
        .from(lrAttempts)
        .innerJoin(lrTests, eq(lrTests.id, lrAttempts.testId))
        .where(eq(lrAttempts.userId, user.id))
        .orderBy(desc(lrAttempts.startedAt))
        .limit(200);
      return c.json(
        {
          items: rows.map(({ a, ...t }) => ({
            id: a.id, testId: a.testId, ...t, mode: a.mode, parts: a.parts ?? null, status: a.status, raw: a.raw, total: a.total, band: a.band,
            answered: answered(a.responses as Record<string, string>),
            startedAt: a.startedAt.toISOString(), submittedAt: a.submittedAt?.toISOString() ?? null,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lr/attempts/{id}',
      ...common,
      summary: 'An attempt: stripped test + responses while in progress; full test, marks and transcripts once submitted',
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: json(AttemptSchema, 'Attempt'), ...errors },
    }),
    async (c) => {
      const { a, t } = await ownAttempt(c.req.valid('param').id, currentUser(c), true);
      return c.json(await toAttempt(a, t), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/api/lr/attempts/{id}',
      ...common,
      middleware: [requireUser, lrSaveLimit],
      summary: 'Autosave responses and elapsed seconds',
      request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: z.object({ responses: Responses, elapsedS: z.number().int().min(0).max(86400), stats: Stats.optional() }) } }, required: true },
      },
      responses: { 200: json(z.object({ savedAt: z.string() }), 'Saved'), 409: json(ErrorSchema, 'Already submitted'), ...errors },
    }),
    async (c) => {
      const { a, t } = await ownAttempt(c.req.valid('param').id, currentUser(c));
      if (a.status !== 'in_progress') throw new HTTPException(409, { message: 'Attempt already submitted' });
      const { responses, elapsedS, stats } = c.req.valid('json');
      await db
        .update(lrAttempts)
        .set({ responses: cleanResponses(responses, pickParts(t.data, a.parts)), elapsedS, ...(stats && { stats: keepAudio(stats, a.stats) }) })
        .where(and(eq(lrAttempts.id, a.id), eq(lrAttempts.status, 'in_progress')));
      return c.json({ savedAt: new Date().toISOString() }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/lr/attempts/{id}/submit',
      ...common,
      summary: 'Submit and score (objective, no AI, no quota)',
      request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: z.object({ responses: Responses.optional(), elapsedS: z.number().int().min(0).max(86400).optional(), stats: Stats.optional() }) } }, required: false },
      },
      responses: { 200: json(AttemptSchema, 'Scored attempt with the full test'), 409: json(ErrorSchema, 'Already submitted'), ...errors },
    }),
    async (c) => {
      const { a, t } = await ownAttempt(c.req.valid('param').id, currentUser(c));
      if (a.status !== 'in_progress') throw new HTTPException(409, { message: 'Attempt already submitted' });
      const body = c.req.valid('json') ?? {};
      const test = pickParts(t.data, a.parts);
      const responses = cleanResponses(body.responses ?? (a.responses as Record<string, string>), test);
      const score = scoreLr(test, Object.fromEntries(Object.entries(responses).map(([k, v]) => [+k, v])));
      const user = currentUser(c);
      const prior = await priorGaps(user.id);
      const analysis = analyseAttempt(test, score.marks, Object.fromEntries(Object.entries(responses).map(([k, v]) => [+k, v])), (w) => prior.filter((g) => g.word === w).length);
      // status guard in WHERE: two concurrent submits cannot both score
      const [row] = await db
        .update(lrAttempts)
        .set({ status: 'submitted', responses, elapsedS: body.elapsedS ?? a.elapsedS, submittedAt: new Date(), raw: score.raw, total: score.total, band: a.parts ? null : score.band, marks: score.marks, analysis, stats: body.stats ? keepAudio(body.stats, a.stats) : a.stats })
        .where(and(eq(lrAttempts.id, a.id), eq(lrAttempts.status, 'in_progress')))
        .returning();
      if (!row) throw new HTTPException(409, { message: 'Attempt already submitted' });
      await spellingCards(user.id, t.data.skill, analysis);
      return c.json(await toAttempt(row, t), 200);
    },
  );

  const Skills = ['listening', 'reading'] as const;
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lr/progress',
      ...common,
      summary: 'Listening & Reading trends: band per attempt, accuracy by question type, weakest 3 types, a suggested next test, TRUE/FALSE/NOT GIVEN pattern',
      responses: {
        200: json(
          z
            .object({
              trend: z.array(z.object({ attemptId: z.string(), skill: Skill, date: z.string(), band: z.number() })).openapi({ description: 'Last 30 submitted whole-test attempts per skill, oldest first' }),
              byType: z.array(z.object({ skill: Skill, label: z.string(), right: z.number(), total: z.number() })),
              weakest: z.array(z.object({ skill: Skill, label: z.string(), right: z.number(), total: z.number() })).openapi({ description: 'Up to 3 types with the lowest accuracy (at least 4 questions seen)' }),
              suggested: z.object({ id: z.string(), title: z.string(), skill: Skill, label: z.string(), count: z.number() }).nullable().openapi({ description: 'A test you have not done with the most questions of your weakest type' }),
              tfng: z.object({ pattern: z.object({ kind: z.enum(['tfng', 'ynng']), answer: z.string(), chose: z.string(), count: z.number(), of: z.number(), pct: z.number(), text: z.string() }).nullable(), rows: z.number() }),
            })
            .openapi('LrProgress'),
          'Progress',
        ),
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const rows = await db
        .select({ id: lrAttempts.id, skill: lrTests.skill, band: lrAttempts.band, at: lrAttempts.submittedAt, analysis: lrAttempts.analysis })
        .from(lrAttempts)
        .innerJoin(lrTests, eq(lrTests.id, lrAttempts.testId))
        .where(and(eq(lrAttempts.userId, user.id), eq(lrAttempts.status, 'submitted')))
        .orderBy(desc(lrAttempts.submittedAt))
        .limit(300);
      // partial attempts have no band: they count towards accuracy by type, not the band trend
      const trend = Skills.flatMap((k) => rows.filter((r) => r.skill === k && r.band != null).slice(0, 30).reverse()).map((r) => ({ attemptId: r.id, skill: r.skill as 'listening' | 'reading', date: (r.at ?? new Date()).toISOString(), band: r.band! }));
      const acc = new Map<string, { skill: 'listening' | 'reading'; label: string; right: number; total: number }>();
      for (const r of rows) for (const t of r.analysis?.byType ?? []) {
        const e = acc.get(`${r.skill}|${t.label}`) ?? { skill: r.skill as 'listening' | 'reading', label: t.label, right: 0, total: 0 };
        e.right += t.right;
        e.total += t.total;
        acc.set(`${r.skill}|${t.label}`, e);
      }
      const byType = [...acc.values()].sort((a, b) => a.skill.localeCompare(b.skill) || a.label.localeCompare(b.label));
      const weakest = byType.filter((t) => t.total >= 4).sort((a, b) => a.right / a.total - b.right / b.total || b.total - a.total).slice(0, 3);
      const rowsT = weakest[0]
        ? ((await db.execute(sql`
            select t.id, t.title, (select coalesce(jsonb_agg(jsonb_build_object('type', g->>'type', 'title', g->>'title', 'instructions', g->>'instructions', 'options', g->'options', 'image', g->>'image', 'n', jsonb_array_length(g->'questions'))), '[]'::jsonb)
              from jsonb_array_elements(t.data->'sections') s, jsonb_array_elements(s->'groups') g) as groups
            from lr_tests t
            where t.skill = ${weakest[0].skill} ${isCambridgeAllowed(user) ? sql`` : sql`and t.restricted = false`}
              and not exists (select 1 from lr_attempts a where a.test_id = t.id and a.user_id = ${user.id} and a.status = 'submitted' and a.parts is null)
          `)) as unknown as { id: string; title: string; groups: { type: 'gap'; title?: string; instructions: string; options?: unknown; image?: unknown; n: number }[] }[])
        : [];
      const w = weakest[0];
      const best = w
        ? rowsT.map((t) => ({ id: t.id, title: t.title, count: t.groups.filter((g) => lrTypeLabel(g) === w.label).reduce((n, g) => n + g.n, 0) })).filter((t) => t.count > 0).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))[0]
        : undefined;
      const tf = rows.flatMap((r) => r.analysis?.tfng ?? []);
      return c.json({ trend, byType, weakest, suggested: best && w ? { ...best, skill: w.skill, label: w.label } : null, tfng: { pattern: tfngPattern(tf), rows: tf.length } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/lr/spelling',
      ...common,
      summary: 'Words you misspelt (or pluralised wrongly) in Listening & Reading gap answers, with counts',
      responses: { 200: json(z.object({ items: z.array(z.object({ word: z.string(), kind: z.enum(['spelling', 'plural']), count: z.number(), typed: z.array(z.string()), lastAt: z.string() })) }).openapi('LrSpelling'), 'Words, most frequent first') },
    }),
    async (c) => {
      const rows = await db
        .select({ at: lrAttempts.submittedAt, analysis: lrAttempts.analysis })
        .from(lrAttempts)
        .where(and(eq(lrAttempts.userId, currentUser(c).id), eq(lrAttempts.status, 'submitted')))
        .orderBy(desc(lrAttempts.submittedAt))
        .limit(300);
      const out = new Map<string, { word: string; kind: 'spelling' | 'plural'; count: number; typed: Set<string>; lastAt: string }>();
      for (const r of rows) for (const g of r.analysis?.gaps ?? []) {
        if ((g.kind !== 'spelling' && g.kind !== 'plural') || !g.word) continue;
        const e = out.get(`${g.kind}|${g.word}`) ?? { word: g.word, kind: g.kind, count: 0, typed: new Set<string>(), lastAt: (r.at ?? new Date()).toISOString() };
        e.count++;
        if (g.typed) e.typed.add(g.typed);
        out.set(`${g.kind}|${g.word}`, e);
      }
      return c.json({ items: [...out.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).map((e) => ({ ...e, typed: [...e.typed].slice(0, 5) })) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/lr/attempts/{id}',
      ...common,
      middleware: [requireUser, lrSaveLimit],
      summary: 'Remove an attempt from my history (submitted or still in progress)',
      description: 'Hard delete of the row (responses, marks, stats and analysis live in it), so progress, trend and spelling lists drop it. Review cards stay. There is no quota on Listening & Reading.',
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: json(z.object({ ok: z.boolean() }), 'Deleted'), ...errors },
    }),
    async (c) => {
      const [gone] = await db.delete(lrAttempts).where(and(eq(lrAttempts.id, c.req.valid('param').id), eq(lrAttempts.userId, currentUser(c).id))).returning({ id: lrAttempts.id });
      if (!gone) return c.json({ error: 'Attempt not found' }, 404);
      return c.json({ ok: true }, 200);
    },
  );
}

/** Gap mistakes (spelling / plural) of the user's earlier submitted attempts. */
async function priorGaps(userId: string): Promise<GapEntry[]> {
  const rows = await db.select({ analysis: lrAttempts.analysis }).from(lrAttempts).where(and(eq(lrAttempts.userId, userId), eq(lrAttempts.status, 'submitted'))).orderBy(desc(lrAttempts.startedAt)).limit(300);
  return rows.flatMap((r) => r.analysis?.gaps ?? []).filter((g) => (g.kind === 'spelling' || g.kind === 'plural') && g.word);
}

/** One Review card per misspelt word (de-duplicated per user + word); shows up in the normal Review flow. */
async function spellingCards(userId: string, skill: 'listening' | 'reading', analysis: LrAnalysis) {
  const slips = [...new Map(analysis.gaps.filter((g) => g.kind === 'spelling' && g.word && g.typed).map((g) => [g.word!, g])).values()];
  if (!slips.length) return;
  const head = (w: string) => `${skill === 'listening' ? '🎧 Listening' : '📖 Reading'} · spell the word ${skill === 'listening' ? 'you heard' : 'from the passage'}: '${maskWord(w)}'`;
  const have = await db.select({ front: cards.front }).from(cards).where(and(eq(cards.userId, userId), or(...slips.map((g) => like(cards.front, `${head(g.word!).replace(/[%_\\]/g, '\\$&')}%`)))));
  const fresh = slips.filter((g) => !have.some((h) => h.front.startsWith(head(g.word!))));
  if (!fresh.length) return;
  await insertCards(userId, fresh.map((g) => ({ front: `${head(g.word!)} (${g.word!.length} letters)`, back: `${g.word}\nYou wrote: ${g.typed}`, source: 'mistake' as const })));
}

