// AI logs (owner only): every OpenRouter call with its full request and response (ai/ailog.ts), newest first, filterable by stage, model,
// outcome, attempt and user. The list carries a short preview; the full bodies come one row at a time.
import { createRoute, z } from '@hono/zod-openapi';
import { and, count, desc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { AI_LOG_DAYS } from '../ai/ailog';
import { requireOwner } from '../auth';
import { db } from '../db/client';
import { aiLogs, user } from '../db/schema';
import type { App } from '../types';
import { adminRoute, guestLabel, pageQuery } from './common';

const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const route = { tags: adminRoute.tags, security: [{ bearer: [] }], middleware: requireOwner };

const LogItem = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    stage: z.string(),
    path: z.string(),
    model: z.string().nullable(),
    served: z.string().nullable(),
    ok: z.boolean(),
    status: z.number().nullable(),
    latencyMs: z.number(),
    costUsd: z.number().nullable(),
    userId: z.string().nullable(),
    userLabel: z.string().nullable(),
    attemptId: z.string().nullable(),
    sessionId: z.string().nullable(),
    preview: z.string().openapi({ description: 'Start of the output text (or the error)' }),
  })
  .openapi('AdminAiLogItem');
const LogDetail = LogItem.extend({ request: z.unknown(), response: z.unknown(), error: z.string().nullable() }).openapi('AdminAiLog');

const cols = {
  id: aiLogs.id, createdAt: aiLogs.createdAt, stage: aiLogs.stage, path: aiLogs.path, model: aiLogs.model, served: aiLogs.served, ok: aiLogs.ok, status: aiLogs.status,
  latencyMs: aiLogs.latencyMs, costUsd: aiLogs.costUsd, userId: aiLogs.userId, attemptId: aiLogs.attemptId, sessionId: aiLogs.sessionId,
  email: user.email, isAnonymous: user.isAnonymous,
};
type Row = { [K in keyof typeof cols]: unknown } & { id: string; createdAt: Date; userId: string | null; email: string | null; isAnonymous: boolean | null };
const label = (r: Row) => (r.userId && r.email != null ? guestLabel({ id: r.userId, email: r.email, isAnonymous: r.isAnonymous }) : null);

export function register(app: App) {
  app.openapi(
    createRoute({
      ...route,
      method: 'get',
      path: '/api/admin/logs',
      summary: `AI calls of the last ${AI_LOG_DAYS} days, newest first, with the stages and models seen for the filters`,
      request: {
        query: pageQuery.extend({
          stage: z.string().max(40).optional(),
          model: z.string().max(120).optional(),
          outcome: z.enum(['all', 'failed']).default('all'),
          attempt: z.string().max(64).optional(),
          user: z.string().max(64).optional(),
        }),
      },
      responses: {
        200: json(z.object({ items: z.array(LogItem), page: z.number(), pageSize: z.number(), total: z.number(), stages: z.array(z.string()), models: z.array(z.string()) }).openapi('AdminAiLogPage'), 'Page'),
      },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const where = and(
        ...([q.stage && eq(aiLogs.stage, q.stage), q.model && eq(aiLogs.model, q.model), q.outcome === 'failed' && eq(aiLogs.ok, false), q.attempt && eq(aiLogs.attemptId, q.attempt), q.user && eq(aiLogs.userId, q.user)].filter(Boolean) as SQL[]),
      );
      const recent = gt(aiLogs.createdAt, sql`now() - ${AI_LOG_DAYS} * interval '1 day'`);
      const preview = sql<string>`left(coalesce(${aiLogs.error}, ${aiLogs.response}->'choices'->0->'message'->>'content', ${aiLogs.response}->>'text', ${aiLogs.response}::text, ''), 240)`;
      const [rows, [t], stages, models] = await Promise.all([
        db.select({ ...cols, preview }).from(aiLogs).leftJoin(user, eq(user.id, aiLogs.userId)).where(where).orderBy(desc(aiLogs.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        db.select({ n: count() }).from(aiLogs).where(where),
        db.selectDistinct({ v: aiLogs.stage }).from(aiLogs).where(recent).orderBy(aiLogs.stage),
        db.selectDistinct({ v: aiLogs.model }).from(aiLogs).where(recent).orderBy(aiLogs.model),
      ]);
      return c.json(
        {
          items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), userLabel: label(r as Row), preview: r.preview ?? '' })).map(({ email: _e, isAnonymous: _a, ...r }) => r),
          page: q.page,
          pageSize: q.pageSize,
          total: t!.n,
          stages: stages.map((s) => s.v),
          models: models.flatMap((m) => (m.v ? [m.v] : [])),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      ...route,
      method: 'get',
      path: '/api/admin/logs/{id}',
      summary: 'One AI call with its full request and response (base64 payloads replaced by a size note)',
      request: { params: z.object({ id: z.string() }) },
      responses: { 200: json(LogDetail, 'Log'), 404: json(z.object({ error: z.string() }), 'Unknown id') },
    }),
    async (c) => {
      const [r] = await db.select({ ...cols, request: aiLogs.request, response: aiLogs.response, error: aiLogs.error }).from(aiLogs).leftJoin(user, eq(user.id, aiLogs.userId)).where(eq(aiLogs.id, c.req.valid('param').id));
      if (!r) return c.json({ error: 'Not found' }, 404);
      const { email: _e, isAnonymous: _a, ...rest } = r;
      return c.json({ ...rest, createdAt: r.createdAt.toISOString(), userLabel: label(r as Row), preview: '' }, 200);
    },
  );
}
