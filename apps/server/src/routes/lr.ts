import { createRoute, z } from '@hono/zod-openapi';
import { scoreLr, stripAnswers, type LrTest } from '@ielts/core';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { currentUser, isCambridgeAllowed, requireUser } from '../auth';
import { db } from '../db/client';
import { lrAttempts, lrTests } from '../db/schema';
import { lrSaveLimit } from '../ratelimit';
import { storage } from '../storage';
import type { App } from '../types';

/** Where importer-uploaded assets live in storage (scripts/lr-import.ts). */
export const lrAssetKey = (key: string) => `lr/${key}`;

const Skill = z.enum(['listening', 'reading']);
const Variant = z.enum(['academic', 'general']);
const Source = z.enum(['cambridge', 'generated']);
const Mode = z.enum(['exam', 'practice']);
const Status = z.enum(['in_progress', 'submitted']);

const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() }).openapi('LrError');
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const common = { tags: ['Listening & Reading'], security: [{ bearer: [] }], middleware: [requireUser] };
const errors = { 404: json(ErrorSchema, 'Not found (also for a Cambridge test this user may not open)') };

type Viewer = Parameters<typeof isCambridgeAllowed>[0];
/** Our own tests are open to everyone; Cambridge (restricted) tests only to allow-listed, verified accounts. */
const canOpen = (t: { restricted: boolean }, u: Viewer) => !t.restricted || isCambridgeAllowed(u);
const visibleWhere = (u: Viewer): SQL | undefined => (isCambridgeAllowed(u) ? undefined : eq(lrTests.restricted, false));

const Option = z.object({ key: z.string(), text: z.string() });
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
            questions: z.array(z.object({ n: z.number(), text: z.string().optional(), options: z.array(Option).optional(), answer: z.array(z.string()).optional().openapi({ description: 'Only after submission' }) })),
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
    total: z.number(),
    status: z.enum(['new', 'in_progress', 'submitted']).openapi({ description: 'From the latest attempt' }),
    attemptId: z.string().nullable().openapi({ description: 'The in-progress attempt, when there is one' }),
    mode: Mode.nullable().openapi({ description: 'Mode of the in-progress attempt' }),
    answered: z.number().openapi({ description: 'Answered questions in the in-progress attempt' }),
    bestBand: z.number().nullable(),
    attempts: z.number().openapi({ description: 'Submitted attempts' }),
  })
  .openapi('LrTestListItem');

const MarkSchema = z.object({ n: z.number(), given: z.string(), correct: z.boolean(), answer: z.array(z.string()) });
const AttemptSchema = z
  .object({
    id: z.string(),
    testId: z.string(),
    mode: Mode,
    status: Status,
    responses: Responses,
    elapsedS: z.number(),
    startedAt: z.string(),
    submittedAt: z.string().nullable(),
    raw: z.number().nullable(),
    total: z.number().nullable(),
    band: z.number().nullable(),
    marks: z.array(MarkSchema).nullable(),
    test: LrTestSchema.openapi({ description: 'Stripped (no answers, no transcript) until submitted' }),
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

/** Drops junk keys/blank values; only 1..N question numbers of this test survive. */
const cleanResponses = (r: Record<string, string>, total: number) =>
  Object.fromEntries(Object.entries(r).filter(([k, v]) => +k >= 1 && +k <= total && v.trim()).map(([k, v]) => [k, v.slice(0, 200)]));

async function assetUrls(test: LrTest) {
  const keys = new Set<string>();
  for (const s of test.sections) {
    if (s.audio) keys.add(s.audio);
    for (const g of s.groups) if (g.image) keys.add(g.image);
  }
  return Object.fromEntries(await Promise.all([...keys].map(async (k) => [k, await storage.presignGet(lrAssetKey(k), 6 * 3600)] as const)));
}

async function ownAttempt(id: string, user: { id: string; email: string; emailVerified: boolean }) {
  const a = await db.query.lrAttempts.findFirst({ where: and(eq(lrAttempts.id, id), eq(lrAttempts.userId, user.id)) });
  if (!a) throw new HTTPException(404, { message: 'Attempt not found' });
  const t = await db.query.lrTests.findFirst({ where: eq(lrTests.id, a.testId) });
  if (!t || !canOpen(t, user)) throw new HTTPException(404, { message: 'Test not found' });
  return { a, t };
}

type AttemptRow = typeof lrAttempts.$inferSelect;
async function toAttempt(a: AttemptRow, t: typeof lrTests.$inferSelect) {
  const done = a.status === 'submitted';
  return {
    id: a.id,
    testId: a.testId,
    mode: a.mode,
    status: a.status,
    responses: a.responses as Record<string, string>,
    elapsedS: a.elapsedS,
    startedAt: a.startedAt.toISOString(),
    submittedAt: a.submittedAt?.toISOString() ?? null,
    raw: a.raw,
    total: a.total,
    band: a.band,
    marks: a.marks,
    test: done ? t.data : stripAnswers(t.data),
    assets: await assetUrls(t.data),
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
        .select({ id: lrTests.id, slug: lrTests.slug, skill: lrTests.skill, variant: lrTests.variant, source: lrTests.source, ref: lrTests.ref, title: lrTests.title })
        .from(lrTests)
        .where(and(visibleWhere(user), q.skill ? eq(lrTests.skill, q.skill) : undefined, q.variant ? eq(lrTests.variant, q.variant) : undefined, q.source ? eq(lrTests.source, q.source) : undefined))
        .orderBy(lrTests.ref);
      const mine = user ? await db.select().from(lrAttempts).where(eq(lrAttempts.userId, user.id)).orderBy(desc(lrAttempts.startedAt)) : [];
      const byTest = new Map<string, typeof mine>();
      for (const a of mine) byTest.set(a.testId, [...(byTest.get(a.testId) ?? []), a]);
      const items = rows.map((t) => {
        const as = byTest.get(t.id) ?? [];
        const open = as.find((a) => a.status === 'in_progress');
        const subs = as.filter((a) => a.status === 'submitted');
        return {
          ...t,
          total: 40,
          status: (as[0] ? as[0].status : 'new') as 'new' | 'in_progress' | 'submitted',
          attemptId: open?.id ?? null,
          mode: open?.mode ?? null,
          answered: open ? answered(open.responses as Record<string, string>) : 0,
          bestBand: subs.length ? Math.max(...subs.map((a) => a.band ?? 0)) : null,
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
      request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ mode: Mode }) } }, required: true } },
      responses: { 200: json(AttemptSchema, 'Attempt (resumed or new). Test is stripped.'), ...errors },
    }),
    async (c) => {
      const user = currentUser(c);
      const t = await db.query.lrTests.findFirst({ where: eq(lrTests.id, c.req.valid('param').id) });
      if (!t || !canOpen(t, user)) throw new HTTPException(404, { message: 'Test not found' });
      const open = await db.query.lrAttempts.findFirst({ where: and(eq(lrAttempts.userId, user.id), eq(lrAttempts.testId, t.id), eq(lrAttempts.status, 'in_progress')) });
      const a = open ?? (await db.insert(lrAttempts).values({ userId: user.id, testId: t.id, mode: c.req.valid('json').mode }).returning())[0]!;
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
            id: a.id, testId: a.testId, ...t, mode: a.mode, status: a.status, raw: a.raw, total: a.total, band: a.band,
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
      const { a, t } = await ownAttempt(c.req.valid('param').id, currentUser(c));
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
        body: { content: { 'application/json': { schema: z.object({ responses: Responses, elapsedS: z.number().int().min(0).max(86400) }) } }, required: true },
      },
      responses: { 200: json(z.object({ savedAt: z.string() }), 'Saved'), 409: json(ErrorSchema, 'Already submitted'), ...errors },
    }),
    async (c) => {
      const { a, t } = await ownAttempt(c.req.valid('param').id, currentUser(c));
      if (a.status !== 'in_progress') throw new HTTPException(409, { message: 'Attempt already submitted' });
      const { responses, elapsedS } = c.req.valid('json');
      await db
        .update(lrAttempts)
        .set({ responses: cleanResponses(responses, scoreTotal(t.data)), elapsedS })
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
        body: { content: { 'application/json': { schema: z.object({ responses: Responses.optional(), elapsedS: z.number().int().min(0).max(86400).optional() }) } }, required: false },
      },
      responses: { 200: json(AttemptSchema, 'Scored attempt with the full test'), 409: json(ErrorSchema, 'Already submitted'), ...errors },
    }),
    async (c) => {
      const { a, t } = await ownAttempt(c.req.valid('param').id, currentUser(c));
      if (a.status !== 'in_progress') throw new HTTPException(409, { message: 'Attempt already submitted' });
      const body = c.req.valid('json') ?? {};
      const responses = cleanResponses(body.responses ?? (a.responses as Record<string, string>), scoreTotal(t.data));
      const score = scoreLr(t.data, Object.fromEntries(Object.entries(responses).map(([k, v]) => [+k, v])));
      // status guard in WHERE: two concurrent submits cannot both score
      const [row] = await db
        .update(lrAttempts)
        .set({ status: 'submitted', responses, elapsedS: body.elapsedS ?? a.elapsedS, submittedAt: new Date(), raw: score.raw, total: score.total, band: score.band, marks: score.marks })
        .where(and(eq(lrAttempts.id, a.id), eq(lrAttempts.status, 'in_progress')))
        .returning();
      if (!row) throw new HTTPException(409, { message: 'Attempt already submitted' });
      return c.json(await toAttempt(row, t), 200);
    },
  );
}

const scoreTotal = (t: LrTest) => t.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.questions.length, 0), 0);

