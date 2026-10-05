import { createRoute, z } from '@hono/zod-openapi';
import { and, count, desc, eq, gt, isNotNull, lt, max, or, sql } from 'drizzle-orm';
import { cambridgeSource, isCambridgeAllowed, setCambridgeGrant } from '../auth';
import { db } from '../db/client';
import { attempts, cambridgeAccess, emailLog, user } from '../db/schema';
import { runAnalysis } from '../jobs';
import type { App } from '../types';
import { adminRoute as readonlyRoute } from './common';
import { getCosts } from './costs';
import { CambridgeInfo, Costs, Health } from './schemas';

const adminRoute = { ...readonlyRoute, middleware: [...readonlyRoute.middleware] }; // ponytail: common.ts declares the tuple `as const`, which createRoute rejects
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const ErrorSchema = z.object({ error: z.string() });
const Id = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) });

const STUCK = sql`now() - interval '10 minutes'`;
const stuck = and(eq(attempts.status, 'analyzing'), lt(attempts.updatedAt, STUCK));
const since = (d: number) => sql`now() - ${d} * interval '1 day'`;

/** Retryable: failed, or analyzing for over 10 min (the same bar as recoverStale), and the input is still there. */
const hasInput = (a: { skill: string; audioKey: string | null; text: string | null }) => (a.skill === 'speaking' ? !!a.audioKey : !!a.text);
const retryableStatus = (a: { status: string; updatedAt: Date }) => a.status === 'failed' || (a.status === 'analyzing' && Date.now() - a.updatedAt.getTime() > 10 * 60_000);

const cambridgeInfo = (u: { email: string; emailVerified: boolean }): CambridgeInfo => {
  const source = cambridgeSource(u.email);
  return { allowed: isCambridgeAllowed(u), source, canToggle: source === null || source === 'granted' };
};

export function register(app: App) {
  app.openapi(
    createRoute({ ...adminRoute, method: 'get', path: '/api/admin/costs', summary: 'OpenRouter + ElevenLabs balances, community balance and low-balance warnings (cached 5 min)', responses: { 200: json(Costs, 'Costs') } }),
    async (c) => c.json(await getCosts(), 200),
  );

  app.openapi(
    createRoute({ ...adminRoute, method: 'get', path: '/api/admin/health', summary: 'Failed and stuck analyses, failed emails, recent errors', responses: { 200: json(Health, 'Health') } }),
    async (c) => {
      const failed7d = and(eq(attempts.status, 'failed'), gt(attempts.updatedAt, since(7)));
      const [[f], [s], [e], rows, mails, errors] = await Promise.all([
        db.select({ n: count() }).from(attempts).where(and(eq(attempts.status, 'failed'), gt(attempts.updatedAt, since(1)))),
        db.select({ n: count() }).from(attempts).where(stuck),
        db.select({ n: count() }).from(emailLog).where(and(eq(emailLog.status, 'failed'), gt(emailLog.createdAt, since(1)))),
        db
          .select({ a: attempts, email: user.email, isAnonymous: user.isAnonymous })
          .from(attempts)
          .innerJoin(user, eq(user.id, attempts.userId))
          .where(or(failed7d, stuck))
          .orderBy(desc(attempts.updatedAt))
          .limit(100),
        db.select().from(emailLog).where(and(eq(emailLog.status, 'failed'), gt(emailLog.createdAt, since(7)))).orderBy(desc(emailLog.createdAt)).limit(50),
        db
          .select({ error: attempts.error, n: count(), lastAt: max(attempts.updatedAt) })
          .from(attempts)
          .where(and(failed7d, isNotNull(attempts.error)))
          .groupBy(attempts.error)
          .orderBy(desc(count()), desc(max(attempts.updatedAt)))
          .limit(10),
      ]);
      return c.json(
        {
          counts: { failed24h: f!.n, stuckAnalyzing: s!.n, emailFailed24h: e!.n },
          attempts: rows.map(({ a, email, isAnonymous }) => ({
            id: a.id,
            userId: a.userId,
            email: isAnonymous ? '' : email,
            isGuest: !!isAnonymous,
            skill: a.skill,
            part: a.part,
            status: a.status as 'analyzing' | 'failed',
            stage: a.stage,
            error: a.error,
            errorRetryable: a.errorRetryable,
            ageMin: Math.floor((Date.now() - a.updatedAt.getTime()) / 60_000),
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
            canRetry: retryableStatus(a) && hasInput(a),
            resultPath: `/${a.skill}/result/${a.id}`,
          })),
          emailFailures: mails.map((m) => ({ id: m.id, email: m.email, purpose: m.purpose, status: m.status, error: m.error, attempts: m.attempts, createdAt: m.createdAt.toISOString() })),
          recentErrors: errors.map((r) => ({ error: r.error!, count: r.n, lastAt: r.lastAt!.toISOString() })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      ...adminRoute,
      method: 'post',
      path: '/api/admin/attempts/{id}/retry',
      summary: 'Re-run the analysis of a failed (or stuck) attempt, free for the user',
      request: { params: Id },
      responses: { 202: json(z.object({ id: z.string(), status: z.literal('analyzing') }), 'Analysis restarted'), 404: json(ErrorSchema, 'Unknown attempt'), 409: json(ErrorSchema, 'Not retryable') },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const a = await db.query.attempts.findFirst({ where: eq(attempts.id, id) });
      if (!a) return c.json({ error: 'Attempt not found' }, 404);
      if (!retryableStatus(a)) return c.json({ error: `Attempt is ${a.status}, only failed or long-stuck analyses can be retried` }, 409);
      if (!hasInput(a)) return c.json({ error: 'Attempt has no recording or text to analyse' }, 409);
      // No quota: a failed analysis was already refunded. The status guard makes a double click start one run (the second sees a fresh analyzing).
      const [go] = await db
        .update(attempts)
        .set({ status: 'analyzing', error: null, errorRetryable: true, stage: null, partial: null })
        .where(and(eq(attempts.id, id), eq(attempts.status, a.status)))
       .returning({ id: attempts.id });
      if (!go) return c.json({ error: 'Attempt changed, reload and try again' }, 409);
      void runAnalysis(id);
      return c.json({ id, status: 'analyzing' as const }, 202);
    },
  );

  app.openapi(
    createRoute({
      ...adminRoute,
      method: 'post',
      path: '/api/admin/users/{id}/cambridge',
      summary: 'Grant or revoke Cambridge access (owner and server-config emails are read-only)',
      request: { params: Id, body: { required: true, content: { 'application/json': { schema: z.object({ granted: z.boolean() }) } } } },
      responses: { 200: json(CambridgeInfo, 'New state'), 404: json(ErrorSchema, 'Unknown user'), 409: json(ErrorSchema, 'Managed in server config') },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { granted } = c.req.valid('json');
      const [u] = await db.select({ email: user.email, emailVerified: user.emailVerified, isAnonymous: user.isAnonymous }).from(user).where(eq(user.id, id));
      if (!u || u.isAnonymous) return c.json({ error: 'User not found' }, 404);
      if (!cambridgeInfo(u).canToggle) return c.json({ error: 'Managed in server config' }, 409);
      const email = u.email.toLowerCase();
      if (granted) await db.insert(cambridgeAccess).values({ email, grantedBy: c.get('user')!.email.toLowerCase() }).onConflictDoNothing();
      else await db.delete(cambridgeAccess).where(eq(cambridgeAccess.email, email));
      setCambridgeGrant(email, granted); // this process now; others pick it up within a minute (index.ts)
      return c.json(cambridgeInfo(u), 200);
    },
  );
}
