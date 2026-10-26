import { createRoute, z } from '@hono/zod-openapi';
import { and, eq, sql } from 'drizzle-orm';
import { requireUser } from '../auth';
import { generateReport, isStale, latestReport } from '../coach/report';
import type { CoachFacts, CoachWords } from '../coach/types';
import { db } from '../db/client';
import { coachFeedback, coachReports } from '../db/schema';
import type { App } from '../types';

// ponytail: permissive schemas, the TS types in coach/types.ts are the contract
const Facts = z.custom<CoachFacts>().openapi('CoachFacts', { type: 'object', additionalProperties: true });
const Words = z.custom<CoachWords>().openapi('CoachWords', { type: 'object', additionalProperties: true });
const Report = z
  .object({ id: z.string(), day: z.string(), createdAt: z.string(), facts: Facts, words: Words, hidden: z.array(z.string()).openapi({ description: 'Item keys the student gave feedback on' }) })
  .openapi('CoachReport');
const Coach = z.object({ state: z.enum(['empty', 'ready']), updating: z.boolean(), report: Report.nullable() }).openapi('Coach');
const FeedbackBody = z.object({ reportId: z.string(), itemKey: z.string().min(1).max(100), note: z.string().max(1000).optional() }).openapi('CoachFeedbackBody');

const running = new Set<string>(); // ponytail: per process; repeated polls must not stack transactions while stale

export function register(app: App) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/coach',
      tags: ['Coach'],
      security: [{ bearer: [] }],
      middleware: [requireUser] as const,
      summary: 'Latest coach report; refreshes it in the background when new tests exist',
      responses: { 200: { description: 'Report', content: { 'application/json': { schema: Coach } } } },
    }),
    async (c) => {
      const id = c.get('user')!.id;
      const updating = await isStale(id, new Date());
      if (updating && !running.has(id) && running.size < 2) { // ponytail: cap 2 per process so free guests cannot exhaust the pool (max 10); upgrade is a queue or worker
        running.add(id);
        void generateReport(id).catch(console.error).finally(() => running.delete(id));
      }
      const r = await latestReport(id);
      if (!r) return c.json({ state: 'empty' as const, updating, report: null }, 200);
      const hidden = (await db.select({ k: coachFeedback.itemKey }).from(coachFeedback).where(eq(coachFeedback.reportId, r.id))).map((x) => x.k);
      return c.json({ state: 'ready' as const, updating, report: { id: r.id, day: r.day, createdAt: r.createdAt.toISOString(), facts: r.facts, words: r.words, hidden } }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/coach/feedback',
      tags: ['Coach'],
      security: [{ bearer: [] }],
      middleware: [requireUser] as const,
      summary: 'Flag a coach item as wrong or unhelpful',
      request: { body: { required: true, content: { 'application/json': { schema: FeedbackBody } } } },
      responses: { 200: { description: 'Saved' }, 404: { description: 'Not your report' } },
    }),
    async (c) => {
      const userId = c.get('user')!.id;
      const b = c.req.valid('json');
      const [r] = await db.select({ id: coachReports.id }).from(coachReports).where(and(eq(coachReports.id, b.reportId), eq(coachReports.userId, userId)));
      if (!r) return c.json({ error: 'Not found' }, 404);
      await db.insert(coachFeedback).values({ userId, reportId: r.id, itemKey: b.itemKey, note: b.note ?? '' }).onConflictDoUpdate({ target: [coachFeedback.reportId, coachFeedback.itemKey], set: { note: b.note ?? sql`${coachFeedback.note}` } });
      return c.json({ ok: true }, 200);
    },
  );
}
