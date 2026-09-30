import { createRoute, z } from '@hono/zod-openapi';
import { roundBand, WRITING_SECONDS } from '@ielts/core';
import { and, count, desc, eq, gt, gte, ne, sql } from 'drizzle-orm';
import { currentUser, requireUser } from '../auth';
import { db } from '../db/client';
import { analyses, attempts, mistakes } from '../db/schema';
import type { App } from '../types';

const Skill = z.enum(['speaking', 'writing']);
const DAY = 864e5;
const dayStr = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Consecutive days (YYYY-MM-DD, newest first) with activity, ending today or yesterday. ponytail: UTC days; pass the user's TZ if it matters. */
export function streak(days: string[], now = Date.now()) {
  let t = days[0] === dayStr(now) ? now : now - DAY;
  let n = 0;
  for (const d of days) {
    if (d !== dayStr(t)) break;
    n++;
    t -= DAY;
  }
  return n;
}

const Progress = z
  .object({
    trend: z.array(z.object({ attemptId: z.string(), date: z.string(), skill: Skill, part: z.number(), overall: z.number(), criteria: z.record(z.string(), z.number()) })).openapi({ description: 'Last 30 analysed attempts, oldest first' }),
    streak: z.number(),
    minutesThisWeek: z.number(),
    attempts: z.number().openapi({ description: 'Analysed attempts' }),
    weakest: z.object({ key: z.string(), avg: z.number() }).nullable(),
    topMistakes: z.array(z.object({ category: z.string(), count: z.number() })).openapi({ description: 'Top 5 categories, last 30 days' }),
    predicted: z.object({ speaking: z.number().nullable(), writing: z.number().nullable() }).openapi({ description: 'roundBand of the mean of the last 5 overalls per skill (ignores the skill filter)' }),
    lastFailed: z.object({ id: z.string(), skill: Skill }).nullable().openapi({ description: "The user's most recent submitted attempt, when its analysis failed" }),
  })
  .openapi('Progress');

export function register(app: App) {
  app.openapi(
    createRoute({
      tags: ['Progress'],
      security: [{ bearer: [] }],
      middleware: [requireUser],
      method: 'get',
      path: '/api/progress',
      summary: 'Dashboard stats: band trend, streak, minutes, weakest criterion, recurring mistakes, predicted band',
      request: { query: z.object({ skill: Skill.optional() }) },
      responses: { 200: { description: 'Progress', content: { 'application/json': { schema: Progress } } } },
    }),
    async (c) => {
      const uid = currentUser(c).id;
      const { skill } = c.req.valid('query');
      const done = and(eq(attempts.userId, uid), eq(attempts.status, 'done'), skill ? eq(attempts.skill, skill) : undefined);
      // Overall 0 = nothing assessed (no speech detected): keep it out of bands, averages and the assessed count.
      const assessed = and(done, gt(analyses.overall, 0));
      const lastOveralls = (s: 'speaking' | 'writing') =>
        db
          .select({ overall: analyses.overall })
          .from(attempts)
          .innerJoin(analyses, eq(analyses.attemptId, attempts.id))
          .where(and(eq(attempts.userId, uid), eq(attempts.status, 'done'), eq(attempts.skill, s), gt(analyses.overall, 0)))
          .orderBy(desc(attempts.createdAt))
          .limit(5);
      const day = sql<string>`to_char(${attempts.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;

      const [trend, days, [week], [total], topMistakes, sp, wr, [last]] = await Promise.all([
        db
          .select({ attemptId: attempts.id, date: attempts.createdAt, skill: attempts.skill, part: attempts.part, overall: analyses.overall, criteria: analyses.criteria })
          .from(attempts)
          .innerJoin(analyses, eq(analyses.attemptId, attempts.id))
          .where(assessed)
          .orderBy(desc(attempts.createdAt))
          .limit(30),
        db.selectDistinct({ day }).from(attempts).where(done).orderBy(desc(day)).limit(400),
        // Writing without a timed duration (API submits) counts the task's nominal time: T1 20 min, T2 40 min.
        db.select({ ms: sql<string>`coalesce(sum(coalesce(${attempts.durationMs}, case when ${attempts.skill} = 'writing' then (case when ${attempts.part} = 1 then ${sql.raw(String(WRITING_SECONDS.t1 * 1000))} else ${sql.raw(String(WRITING_SECONDS.t2 * 1000))} end) end)), 0)` }).from(attempts).where(and(done, gte(attempts.createdAt, sql`date_trunc('week', now())`))),
        db.select({ n: count() }).from(attempts).innerJoin(analyses, eq(analyses.attemptId, attempts.id)).where(assessed),
        db
          .select({ category: mistakes.category, count: count() })
          .from(mistakes)
          .innerJoin(attempts, eq(attempts.id, mistakes.attemptId))
          .where(and(eq(mistakes.userId, uid), gte(mistakes.createdAt, new Date(Date.now() - 30 * DAY)), skill ? eq(attempts.skill, skill) : undefined))
          .groupBy(mistakes.category)
          .orderBy(desc(count()), mistakes.category)
          .limit(5),
        lastOveralls('speaking'),
        lastOveralls('writing'),
        db
          .select({ id: attempts.id, skill: attempts.skill, status: attempts.status })
          .from(attempts)
          .where(and(eq(attempts.userId, uid), ne(attempts.status, 'recording')))
          .orderBy(desc(attempts.createdAt))
          .limit(1),
      ]);

      const sums: Record<string, { sum: number; n: number }> = {};
      for (const t of trend)
        for (const [k, v] of Object.entries(t.criteria)) {
          const s = (sums[k] ??= { sum: 0, n: 0 });
          s.sum += v;
          s.n++;
        }
      const weakest = Object.entries(sums)
        .map(([key, { sum, n }]) => ({ key, avg: Math.round((sum / n) * 100) / 100 }))
        .reduce<{ key: string; avg: number } | null>((w, x) => (!w || x.avg < w.avg ? x : w), null);
      const predict = (rows: { overall: number }[]) => (rows.length ? roundBand(rows.reduce((s, r) => s + r.overall, 0) / rows.length) : null);

      return c.json(
        {
          trend: trend.reverse().map((t) => ({ ...t, date: t.date.toISOString() })),
          streak: streak(days.map((d) => d.day)),
          minutesThisWeek: Math.round(Number(week?.ms ?? 0) / 60000),
          attempts: total?.n ?? 0,
          weakest,
          topMistakes,
          predicted: { speaking: predict(sp), writing: predict(wr) },
          lastFailed: last?.status === 'failed' ? { id: last.id, skill: last.skill } : null,
        },
        200,
      );
    },
  );
}
