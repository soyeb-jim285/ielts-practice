import { createRoute, z } from '@hono/zod-openapi';
import { P1_TEST_QUESTIONS } from '@ielts/core';
import { and, asc, count, eq, getTableColumns, ilike, inArray, isNotNull, notInArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { etag } from 'hono/etag';
import { visiblePromptWhere } from '../access';
import { currentUser, requireUser } from '../auth';
import { db } from '../db/client';
import { attempts, prompts, promptSeen } from '../db/schema';
import { promptAudio } from '../ai/speaking-audio';
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

const AudioLine = z.object({ text: z.string(), url: z.string().nullable() });
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
    audio: z.object({ intro: AudioLine.nullable(), lead: AudioLine, questions: z.array(AudioLine) }).nullable().optional().openapi({ description: 'Generated speaking prompts (single-prompt and test endpoints): presigned examiner audio. intro = greeting before the first Part 1 topic of a full test; lead = Let\'s talk about… / part transition; questions align with followUps (P2: the cue card title). A line without url is not rendered: ask it silently.' }),
  })
  .openapi('Prompt');
export type Prompt = z.infer<typeof PromptSchema>;

export const SpeakingTestSchema = z.object({ part1: z.array(PromptSchema), part2: PromptSchema, part3: PromptSchema }).openapi('SpeakingTest');
export type SpeakingTest = z.infer<typeof SpeakingTestSchema>;
const TestSource = z.enum(['generated', 'cambridge', 'any']);

const part = z.coerce.number().int().min(1).max(3).optional();
const RandomQuery = z.object({ skill: Skill, part, variant: Variant.optional(), type: z.string().max(40).optional(), source: Source.optional() });
const ListQuery = RandomQuery.extend({
  skill: Skill.optional(),
  topic: z.string().max(80).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// Correlated subqueries use a literal "prompts" qualifier: drizzle renders columns unqualified in single-table selects.
const doneExpr = (userId: string | null) =>
  userId ? sql<boolean>`exists(select 1 from ${attempts} a where a.prompt_id = "prompts".id and a.user_id = ${userId})` : sql<boolean>`false`;
const selectWithDone = (userId: string | null) => db.select({ ...getTableColumns(prompts), done: doneExpr(userId) }).from(prompts);
type Row = Awaited<ReturnType<ReturnType<typeof selectWithDone>['execute']>>[number];

const withAudio = async (p: Prompt): Promise<Prompt> => (p.skill === 'speaking' ? { ...p, audio: await promptAudio(p) } : p);

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

/** When this user last had this prompt's topic (same skill and part, by topic name): an attempt at any prompt on it, or a test that served one (prompt_seen).
 *  Topic level, so a second set on "Birthdays" with other wording does not come straight back. Null: never. */
const lastHad = (userId: string) => sql`(select max(t) from (
    select a.created_at as t from ${attempts} a join ${prompts} q on q.id = a.prompt_id
      where a.user_id = ${userId} and q.skill = "prompts".skill and q.part = "prompts".part and lower(q.topic) = lower("prompts".topic)
    union all
    select s.seen_at from ${promptSeen} s join ${prompts} q on q.id = s.prompt_id
      where s.user_id = ${userId} and q.skill = "prompts".skill and q.part = "prompts".part and lower(q.topic) = lower("prompts".topic)
  ) x)`;

/** When this exact prompt was last handed to the user. */
const lastServed = (userId: string) => sql`(select s.seen_at from ${promptSeen} s where s.user_id = ${userId} and s.prompt_id = "prompts".id)`;

/** Random visible prompts: never answered first, then the least recently had topic, then the least recently served prompt (never first each time).
 *  Without a user there is no history to sort by. */
export const pick = (user: SessionUser | null, where: SQL | undefined, limit: number) =>
  selectWithDone(user?.id ?? null)
    .where(and(visiblePromptWhere(user), where))
    .orderBy(...(user ? [doneExpr(user.id), sql`${lastHad(user.id)} asc nulls first`, sql`${lastServed(user.id)} asc nulls first`] : []), sql`random()`)
    .limit(limit);

/** Remembers what a user was handed, so the picker moves on from it even if they never answered. */
export async function markSeen(user: SessionUser | null, ids: string[]) {
  if (!user || !ids.length) return;
  const at = new Date();
  await db.insert(promptSeen).values(ids.map((promptId) => ({ userId: user.id, promptId, seenAt: at }))).onConflictDoUpdate({ target: [promptSeen.userId, promptSeen.promptId], set: { seenAt: at } });
}

/** Familiar topics that repeat a place frame (hometown, home, accommodation, the area you live in): never asked straight after one. */
const PLACE_TOPICS = ['Where you live', 'Neighbours'];
const repeatsFrame = (frame: { topic: string } | undefined, t: { topic: string }) => !!frame && frame.topic !== 'Work or study' && PLACE_TOPICS.includes(t.topic);

/** A full speaking test: a random P1 intro frame plus 2 familiar topics (P1_TEST_QUESTIONS each), a P2 cue card and its linked P3 set. Null when the bank has no card. */
/** Question lists an examiner can ask: at most `max` lines (Part 1: 8, Part 3: 12), each a question or "Tell me about…". Keeps out extraction junk (a Listening dialogue, an old-format
 *  role-play card) that the examiner would otherwise read aloud as questions. `col` is the follow-ups column (of `prompts` or an alias). */
const askable = (col: SQL | AnyColumn, max = 8) =>
  sql`(${col} is null or (jsonb_array_length(${col}) <= ${max} and not exists (select 1 from jsonb_array_elements_text(${col}) q where q not like '%?%' and q !~* '^tell me')))`;

/** `record` false: only checks that a test exists (it is not handed to anyone). */
export async function pickSpeakingTest(user: SessionUser, source: z.infer<typeof TestSource> = 'any', ref?: string | null, record = true): Promise<SpeakingTest | null> {
  const src = and(source === 'any' ? undefined : eq(prompts.source, source), ref ? eq(prompts.sourceRef, ref) : undefined);
  const speaking = (p: number) => and(eq(prompts.skill, 'speaking'), eq(prompts.part, p), src);
  // Real Part 1: one introductory frame (hometown, home, work/study), then two familiar topics. Falls back to topics only when the bank has no frame.
  const frameTypes = ['p1-intro', 'p1-branch'];
  const [[frame], topics, [card]] = await Promise.all([
    pick(user, and(speaking(1), eq(prompts.type, 'p1-intro')), 1),
    pick(user, and(speaking(1), notInArray(prompts.type, frameTypes), askable(prompts.followUps)), 3 + PLACE_TOPICS.length),
    pick(user, and(speaking(2), isNotNull(prompts.groupId), sql`exists(select 1 from ${prompts} p3 where p3.group_id = "prompts".group_id and p3.part = 3 and p3.skill = 'speaking' and ${askable(sql`p3.follow_ups`, 12)})`), 1),
  ]);
  // Never the same topic twice in one test (the bank has several sets on some topics).
  const seenTopics = new Set(frame ? [frame.topic.toLowerCase()] : []);
  const fresh = topics.filter((t) => !repeatsFrame(frame, t) && !seenTopics.has(t.topic.toLowerCase()) && seenTopics.add(t.topic.toLowerCase()));
  const part1 = [...(frame ? [frame] : []), ...fresh.slice(0, frame ? 2 : 3)];
  if (!card || !part1.length) return null;
  const [linked] = await pick(user, and(eq(prompts.skill, 'speaking'), eq(prompts.part, 3), eq(prompts.groupId, card.groupId!), askable(prompts.followUps, 12)), 1);
  if (!linked) return null;
  if (record) await markSeen(user, [...part1.map((p) => p.id), card.id, linked.id]);
  return {
    part1: await Promise.all(part1.map((p) => toPrompt({ ...p, followUps: p.followUps?.slice(0, P1_TEST_QUESTIONS) ?? null }).then(withAudio))),
    part2: await toPrompt(card).then(withAudio),
    part3: await toPrompt(linked).then(withAudio),
  };
}

/** Visible prompts by id, in the order asked (a full mock test stores the ids it picked). Null if any is missing or no longer visible to this user. */
export async function promptsByIds(user: SessionUser, ids: string[]): Promise<Prompt[] | null> {
  const rows = await selectWithDone(user.id).where(and(inArray(prompts.id, ids), visiblePromptWhere(user)));
  const by = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((i) => by.get(i));
  return ordered.every(Boolean) ? Promise.all(ordered.map((r) => toPrompt(r!).then(withAudio))) : null;
}

/** The speaking test stored by ids [p1.., p2, p3] (Part 1 questions cut as pickSpeakingTest does). */
export async function speakingTestByIds(user: SessionUser, ids: string[]): Promise<SpeakingTest | null> {
  const ps = await promptsByIds(user, ids);
  return ps && { part1: ps.slice(0, -2).map((p) => ({ ...p, followUps: p.followUps?.slice(0, P1_TEST_QUESTIONS) ?? null })), part2: ps.at(-2)!, part3: ps.at(-1)! };
}

/** A random Part 1 work set and study set (bank frame 'branch', topics Work and Study; undone first) the live examiner switches to once the candidate says which
 *  applies. Undefined if the bank lacks them. */
export async function pickP1Branches(user: SessionUser): Promise<{ work: string[]; study: string[] } | undefined> {
  const qs = async (topic: string) => (await pick(user, and(eq(prompts.skill, 'speaking'), eq(prompts.part, 1), eq(prompts.type, 'p1-branch'), eq(prompts.topic, topic)), 1))[0]?.followUps ?? [];
  const [work, study] = await Promise.all([qs('Work'), qs('Study')]);
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
      if (row) await markSeen(user, [row.id]);
      return row ? c.json(await withAudio(await toPrompt(row)), 200) : c.json({ error: 'No matching prompt' }, 404);
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
      return row ? c.json(await withAudio(await toPrompt(row)), 200) : c.json({ error: 'Prompt not found' }, 404);
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
