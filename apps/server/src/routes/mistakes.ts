import { createRoute, z } from '@hono/zod-openapi';
import { and, count, desc, eq } from 'drizzle-orm';
import { currentUser, requireAccount } from '../auth';
import { db } from '../db/client';
import { attempts, mistakes, prompts } from '../db/schema';
import type { App } from '../types';
import { CardSchema, inDeck, insertCards } from './cards';

const mistakeCard = (m: { original: string; correction: string; explanation: string }) => ({ front: m.original, back: `${m.correction} — ${m.explanation}`, source: 'mistake' as const });

const PAGE_SIZE = 30;
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const ErrorSchema = z.object({ error: z.string() }).openapi('Error');
const authed = { tags: ['Mistakes'], security: [{ bearer: [] }], middleware: [requireAccount] };

const MistakeSchema = z
  .object({
    id: z.string(),
    attemptId: z.string(),
    skill: z.enum(['speaking', 'writing']),
    part: z.number(),
    promptTitle: z.string(),
    category: z.string(),
    original: z.string(),
    correction: z.string(),
    explanation: z.string(),
    time: z.number().nullable().openapi({ description: 'Seconds into the audio (speaking)' }),
    inDeck: z.boolean().openapi({ description: 'Already added to the review deck' }),
    createdAt: z.string(),
  })
  .openapi('Mistake');

const MistakeLog = z
  .object({
    groups: z.array(z.object({ category: z.string(), count: z.number() })).openapi({ description: 'All categories, most frequent first' }),
    items: z.array(MistakeSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  })
  .openapi('MistakeLog');

export function register(app: App) {
  app.openapi(
    createRoute({
      ...authed,
      method: 'get',
      path: '/api/mistakes',
      summary: 'Error log: counts per category + newest mistakes (optionally one category), 30 per page',
      request: { query: z.object({ category: z.string().max(60).optional(), page: z.coerce.number().int().min(1).default(1) }) },
      responses: { 200: json(MistakeLog, 'Mistakes') },
    }),
    async (c) => {
      const uid = currentUser(c).id;
      const { category, page } = c.req.valid('query');
      const where = and(eq(mistakes.userId, uid), category ? eq(mistakes.category, category) : undefined);
      const [groups, [{ total } = { total: 0 }], rows] = await Promise.all([
        db.select({ category: mistakes.category, count: count() }).from(mistakes).where(eq(mistakes.userId, uid)).groupBy(mistakes.category).orderBy(desc(count()), mistakes.category),
        db.select({ total: count() }).from(mistakes).where(where),
        db
          .select({ m: mistakes, skill: attempts.skill, part: attempts.part, promptTitle: prompts.title })
          .from(mistakes)
          .innerJoin(attempts, eq(attempts.id, mistakes.attemptId))
          .innerJoin(prompts, eq(prompts.id, attempts.promptId))
          .where(where)
          .orderBy(desc(mistakes.createdAt), mistakes.id)
          .limit(PAGE_SIZE)
          .offset((page - 1) * PAGE_SIZE),
      ]);
      const added = await inDeck(uid, rows.map((r) => mistakeCard(r.m)));
      const items = rows.map(({ m: { userId: _u, errorId: _e, createdAt, ...m }, ...r }, k) => ({ ...m, ...r, inDeck: added[k]!, createdAt: createdAt.toISOString() }));
      return c.json({ groups, items, total, page, pageSize: PAGE_SIZE }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      method: 'post',
      path: '/api/mistakes/{id}/card',
      summary: 'Add a mistake to the review deck (front: original, back: correction — explanation)',
      request: { params: z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) }) },
      responses: { 201: json(CardSchema, 'Created'), 404: json(ErrorSchema, 'Not found') },
    }),
    async (c) => {
      const uid = currentUser(c).id;
      const [m] = await db.select().from(mistakes).where(and(eq(mistakes.id, c.req.valid('param').id), eq(mistakes.userId, uid)));
      if (!m) return c.json({ error: 'Mistake not found' }, 404);
      const [card] = await insertCards(uid, [mistakeCard(m)]);
      return c.json(card!, 201);
    },
  );
}
