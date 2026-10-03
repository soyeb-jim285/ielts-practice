import { createRoute, z } from '@hono/zod-openapi';
import { P1_TEST_QUESTIONS } from '@ielts/core';
import { and, asc, count, eq, getTableColumns, ilike, isNotNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { etag } from 'hono/etag';
import { visiblePromptWhere } from '../access';
import { currentUser, requireUser } from '../auth';
import { db } from '../db/client';
import { attempts, prompts } from '../db/schema';
import { storage } from '../storage';
import type { App, SessionUser } from '../types';

const PAGE_SIZE = 30;

const Skill = z.enum(['speaking', 'writing']);
const Variant = z.enum(['academic', 'general']);
const Source = z.enum(['generated', 'cambridge']);
const ErrorSchema = z.object({ error: z.string() }).openapi('Error');
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const authed = { tags: ['Prompts'], security: [{ bearer: [] }], middleware: [requireUser] };
/** Readable by guests: restricted (Cambridge) prompts are filtered out unless the signed-in user is allow-listed, and `done` is false. */
const open = { tags: ['Prompts'], security: [{ bearer: [] }, {}] as Record<string, string[]>[] }; // {} = optional

export const PromptSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    skill: Skill,
    part: z.number(),
    variant: Variant.nullable(),
    type: z.string(),
    topic: z.string(),
    title: z.string(),
    body: z.string(),
    bullets: z.array(z.string()).nullable(),
    followUps: z.array(z.string()).nullable(),
    chart: z.unknown().nullable().openapi({ description: 'ChartSpec (generated Academic Task 1)' }),
    imageUrl: z.string().nullable().openapi({ description: 'Presigned figure URL (Cambridge Task 1)' }),
    source: Source,
    sourceRef: z.string().nullable(),
    groupId: z.string().nullable(),
    done: z.boolean().openapi({ description: 'The user has an attempt on this prompt' }),
  })
  .openapi('Prompt');
export type Prompt = z.infer<typeof PromptSchema>;

const SpeakingTestSchema = z.object({ part1: z.array(PromptSchema), part2: PromptSchema, part3: PromptSchema }).openapi('SpeakingTest');
export type SpeakingTest = z.infer<typeof SpeakingTestSchema>;
const TestSource = z.enum(['generated', 'cambridge', 'any']);

const part = z.coerce.number().int().min(1).max(3).optional();
const RandomQuery = z.object({ skill: Skill, part, variant: Variant.optional(), type: z.string().max(40).optional() });
const ListQuery = RandomQuery.extend({
  skill: Skill.optional(),
  topic: z.string().max(80).optional(),
  source: Source.optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// Correlated subqueries use a literal "prompts" qualifier: drizzle renders columns unqualified in single-table selects.
const doneExpr = (userId: string | null) =>
  userId ? sql<boolean>`exists(select 1 from ${attempts} a where a.prompt_id = "prompts".id and a.user_id = ${userId})` : sql<boolean>`false`;
const selectWithDone = (userId: string | null) => db.select({ ...getTableColumns(prompts), done: doneExpr(userId) }).from(prompts);
type Row = Awaited<ReturnType<ReturnType<typeof selectWithDone>['execute']>>[number];

async function toPrompt({ imageKey, restricted: _r, createdAt: _c, ...p }: Row): Promise<Prompt> {
  return { ...p, imageUrl: imageKey ? await storage.presignGet(imageKey) : null };
}

const like = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;
const filters = (user: SessionUser | null, f: Partial<z.infer<typeof ListQuery>>) =>
  and(
    visiblePromptWhere(user),
    f.skill ? eq(prompts.skill, f.skill) : undefined,
    f.part ? eq(prompts.part, f.part) : undefined,
    f.variant ? eq(prompts.variant, f.variant) : undefined,
    f.type ? eq(prompts.type, f.type) : undefined,
    f.topic ? eq(prompts.topic, f.topic) : undefined,
    f.source ? eq(prompts.source, f.source) : undefined,
    f.q ? or(ilike(prompts.title, like(f.q)), ilike(prompts.body, like(f.q))) : undefined,
  );

/** Random visible prompts, undone first. */
const pick = (user: SessionUser | null, where: SQL | undefined, limit: number) =>
  selectWithDone(user?.id ?? null).where(and(visiblePromptWhere(user), where)).orderBy(doneExpr(user?.id ?? null), sql`random()`).limit(limit);

/** A full speaking test: a random P1 intro frame plus 2 familiar topics (P1_TEST_QUESTIONS each), a P2 cue card and its linked P3 set. Null when the bank has no card. */
export async function pickSpeakingTest(user: SessionUser, source: z.infer<typeof TestSource> = 'any'): Promise<SpeakingTest | null> {
  const src = source === 'any' ? undefined : eq(prompts.source, source);
  const speaking = (p: number) => and(eq(prompts.skill, 'speaking'), eq(prompts.part, p), src);
  // Real Part 1: one introductory frame (hometown, home, work/study), then two familiar topics. Falls back to topics only when the bank has no frame.
  const frameTypes = ['p1-intro', 'p1-branch'];
  const [[frame], topics, [card]] = await Promise.all([
    pick(user, and(speaking(1), eq(prompts.type, 'p1-intro')), 1),
    pick(user, and(speaking(1), notInArray(prompts.type, frameTypes)), 3),
    pick(user, and(speaking(2), isNotNull(prompts.groupId), sql`exists(select 1 from ${prompts} p3 where p3.group_id = "prompts".group_id and p3.part = 3 and p3.skill = 'speaking')`), 1),
  ]);
  const part1 = [...(frame ? [frame] : []), ...topics.slice(0, frame ? 2 : 3)];
  if (!card || !part1.length) return null;
  const [linked] = await pick(user, and(eq(prompts.skill, 'speaking'), eq(prompts.part, 3), eq(prompts.groupId, card.groupId!)), 1);
  if (!linked) return null;
  return {
    part1: await Promise.all(part1.map((p) => toPrompt({ ...p, followUps: p.followUps?.slice(0, P1_TEST_QUESTIONS) ?? null }))),
    part2: await toPrompt(card),
    part3: await toPrompt(linked),
  };
}

/** The Part 1 work and study sets (bank p1-work, p1-study) the live examiner switches to once the candidate says which applies. Undefined if the bank lacks them. */
export async function pickP1Branches(user: SessionUser): Promise<{ work: string[]; study: string[] } | undefined> {
  const rows = await db.select().from(prompts).where(and(visiblePromptWhere(user), eq(prompts.skill, 'speaking'), eq(prompts.part, 1), eq(prompts.type, 'p1-branch')));
  const qs = (topic: string) => rows.find((r) => r.topic === topic)?.followUps ?? [];
  const [work, study] = [qs('Work'), qs('Study')];
  return work.length && study.length ? { work, study } : undefined;
}

export function register(app: App) {
  app.openapi(
    createRoute({
      ...open,
      method: 'get',
      path: '/api/prompts',
      summary: 'Prompt bank (30 per page) with a per-user done flag',
      request: { query: ListQuery },
      responses: { 200: json(z.object({ items: z.array(PromptSchema), total: z.number(), page: z.number(), pageSize: z.number() }).openapi('PromptPage'), 'Prompts') },
    }),
    async (c) => {
      const user = c.get('user');
      const q = c.req.valid('query');
      const where = filters(user, q);
      const [rows, [{ total } = { total: 0 }]] = await Promise.all([
        selectWithDone(user?.id ?? null).where(where).orderBy(asc(prompts.skill), asc(prompts.part), asc(prompts.topic), asc(prompts.title)).limit(PAGE_SIZE).offset((q.page - 1) * PAGE_SIZE),
        db.select({ total: count() }).from(prompts).where(where),
      ]);
      return c.json({ items: await Promise.all(rows.map(toPrompt)), total, page: q.page, pageSize: PAGE_SIZE }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...open,
      method: 'get',
      path: '/api/prompts/meta',
      middleware: [etag()],
      summary: 'Distinct topics and types per skill/part (for bank filters)',
      responses: {
        200: json(z.object({ groups: z.array(z.object({ skill: Skill, part: z.number(), topics: z.array(z.string()), types: z.array(z.string()) })) }).openapi('PromptMeta'), 'Filter values'),
      },
    }),
    async (c) => {
      const groups = await db
        .select({
          skill: prompts.skill,
          part: prompts.part,
          topics: sql<string[]>`array_agg(distinct ${prompts.topic} order by ${prompts.topic})`,
          types: sql<string[]>`array_agg(distinct ${prompts.type} order by ${prompts.type})`,
        })
        .from(prompts)
        .where(visiblePromptWhere(c.get('user')))
        .groupBy(prompts.skill, prompts.part)
        .orderBy(prompts.skill, prompts.part);
      // Changes only on seed. private: the set differs per user (restricted Cambridge prompts); ETag revalidation is free after max-age.
      c.header('Cache-Control', 'private, max-age=300');
      c.header('Vary', 'Cookie, Authorization');
      return c.json({ groups }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...open,
      method: 'get',
      path: '/api/prompts/random',
      summary: 'A random matching prompt, preferring ones the user has not done',
      request: { query: RandomQuery },
      responses: { 200: json(PromptSchema, 'Prompt'), 404: json(ErrorSchema, 'No matching prompt') },
    }),
    async (c) => {
      const user = c.get('user');
      const [row] = await pick(user, filters(user, c.req.valid('query')), 1);
      return row ? c.json(await toPrompt(row), 200) : c.json({ error: 'No matching prompt' }, 404);
    },
  );

  app.openapi(
    createRoute({
      ...open,
      method: 'get',
      path: '/api/prompts/{id}',
      summary: 'Single prompt (figure URL presigned)',
      request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }) },
      responses: { 200: json(PromptSchema, 'Prompt'), 404: json(ErrorSchema, 'Not found') },
    }),
    async (c) => {
      const user = c.get('user');
      const [row] = await selectWithDone(user?.id ?? null).where(and(eq(prompts.id, c.req.valid('param').id), visiblePromptWhere(user)));
      return row ? c.json(await toPrompt(row), 200) : c.json({ error: 'Prompt not found' }, 404);
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      tags: ['Speaking'],
      method: 'get',
      path: '/api/speaking/test',
      summary: 'Random full speaking test: 3 P1 topics × 4 questions, a P2 cue card and its linked P3',
      request: { query: z.object({ source: TestSource.default('any') }) },
      responses: { 200: json(SpeakingTestSchema, 'Test'), 404: json(ErrorSchema, 'Bank is empty') },
    }),
    async (c) => {
      const test = await pickSpeakingTest(currentUser(c), c.req.valid('query').source);
      return test ? c.json(test, 200) : c.json({ error: 'No speaking test available' }, 404);
    },
  );
}
