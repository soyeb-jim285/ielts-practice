import { createRoute, z } from '@hono/zod-openapi';
import { and, desc, gt, sql } from 'drizzle-orm';
import type { TurnTiming } from '../ai/examiner';
import { db } from '../db/client';
import { liveSessions } from '../db/schema';
import type { App } from '../types';
import { adminRoute as readonlyRoute, daysAgo } from './common';
import { LiveLatency } from './schemas';

const adminRoute = { ...readonlyRoute, middleware: [...readonlyRoute.middleware] }; // as in ops.ts
const STAGES = ['total', 'wait', 'stt', 'llm', 'tts', 'net'] as const;

/** Nearest-rank percentile of an ascending list (p in 0..1). */
export const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]! : 0);
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { p50: Math.round(pct(s, 0.5)), p95: Math.round(pct(s, 0.95)), mean: Math.round(s.reduce((a, b) => a + b, 0) / (s.length || 1)) };
};

/** Reply-time summary from the turns stored on live sessions (POST /api/live/latency). Turns with no LLM time are skipped: the worker's
 *  'turn' event never arrived, so their split is incomplete. */
export function summarize(rows: { id: string; createdAt: Date; turns: TurnTiming[] }[], days: number): LiveLatency {
  const withTurns = rows.map((r) => ({ ...r, turns: r.turns.filter((t) => t.total > 0 && t.llm > 0) })).filter((r) => r.turns.length);
  const all = withTurns.flatMap((r) => r.turns);
  const labels = new Map<string, number[]>();
  for (const t of all) labels.set(t.label ?? 'unknown', [...(labels.get(t.label ?? 'unknown') ?? []), t.total]);
  return {
    days,
    turns: all.length,
    sessions: withTurns.length,
    stages: all.length ? (Object.fromEntries(STAGES.map((k) => [k, stats(all.map((t) => t[k]))])) as LiveLatency['stages']) : null,
    byLabel: [...labels].map(([label, xs]) => ({ label, turns: xs.length, ...stats(xs) })).map(({ mean: _, ...r }) => r).sort((a, b) => b.turns - a.turns),
    recent: withTurns.slice(0, 20).map((r) => { const { p50, p95 } = stats(r.turns.map((t) => t.total)); return { sessionId: r.id, at: r.createdAt.toISOString(), turns: r.turns.length, p50, p95 }; }),
  };
}

export function register(app: App) {
  app.openapi(
    createRoute({
      ...adminRoute,
      method: 'get',
      path: '/api/admin/live-latency',
      summary: 'Live examiner reply times measured in real sessions: median and p95 per stage',
      request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) },
      responses: { 200: { description: 'Latency summary', content: { 'application/json': { schema: LiveLatency } } } },
    }),
    async (c) => {
      const { days } = c.req.valid('query');
      const rows = await db
        .select({ id: liveSessions.id, createdAt: liveSessions.createdAt, turns: sql<TurnTiming[]>`${liveSessions.state}->'latency'` })
        .from(liveSessions)
        .where(and(gt(liveSessions.createdAt, daysAgo(days - 1)), sql`${liveSessions.state} ? 'latency'`))
        .orderBy(desc(liveSessions.createdAt))
        .limit(1000);
      return c.json(summarize(rows, days), 200);
    },
  );
}
