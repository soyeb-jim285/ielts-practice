import { createRoute, z } from '@hono/zod-openapi';
import { desc, eq, sql } from 'drizzle-orm';
import { gunzipSync } from 'node:zlib';
import { db } from '../db/client';
import { replaySessions, user } from '../db/schema';
import { HTTPException } from 'hono/http-exception';
import { replayKey } from '../replay';
import { storage } from '../storage';
import type { App } from '../types';
import { requireOwner } from '../auth';
import { adminRoute, pageQuery, Paged } from './common';
import { ReplayItem } from './schemas';

const cols = { s: replaySessions, email: user.email, isAnonymous: user.isAnonymous };
const toItem = ({ s, email, isAnonymous }: { s: typeof replaySessions.$inferSelect; email: string | null; isAnonymous: boolean | null }): z.infer<typeof ReplayItem> => ({
  id: s.id,
  userId: s.userId,
  email: isAnonymous ? null : email,
  startedAt: s.startedAt.toISOString(),
  lastAt: s.lastAt.toISOString(),
  durationS: (s.lastAt.getTime() - s.startedAt.getTime()) / 1000,
  pages: s.pages,
  bytes: s.bytes,
  chunks: s.chunks,
  userAgent: s.userAgent,
});

const id = z.object({ id: z.string() });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 200: { description: 'OK', content: { 'application/json': { schema } } } });
const find = async (sid: string) => {
  const [r] = await db.select(cols).from(replaySessions).leftJoin(user, eq(user.id, replaySessions.userId)).where(eq(replaySessions.id, sid));
  if (!r) throw new HTTPException(404, { message: 'Not found' });
  return r;
};

export function register(app: App) {
  app.openapi(
    createRoute({
      ...adminRoute,
      middleware: [requireOwner] as const, // ponytail: adminRoute.middleware is readonly and does not type-check when spread
      method: 'get',
      path: '/api/admin/replays',
      summary: 'Session recordings, newest first',
      request: { query: pageQuery.extend({ userId: z.string().optional() }) },
      responses: json(Paged(ReplayItem)),
    }),
    async (c) => {
      const { page, pageSize, userId } = c.req.valid('query');
      const where = userId ? eq(replaySessions.userId, userId) : undefined;
      const rows = await db.select(cols).from(replaySessions).leftJoin(user, eq(user.id, replaySessions.userId)).where(where).orderBy(desc(replaySessions.startedAt)).limit(pageSize).offset((page - 1) * pageSize);
      const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(replaySessions).where(where);
      return c.json({ items: rows.map(toItem), page, pageSize, total: count!.n }, 200);
    },
  );

  app.openapi(
    createRoute({ ...adminRoute, middleware: [requireOwner] as const, method: 'get', path: '/api/admin/replays/{id}', summary: 'One session recording', request: { params: id }, responses: json(ReplayItem) }),
    async (c) => c.json(toItem(await find(c.req.valid('param').id)), 200),
  );

  app.openapi(
    createRoute({
      ...adminRoute,
      middleware: [requireOwner] as const, // ponytail: adminRoute.middleware is readonly and does not type-check when spread
      method: 'get',
      path: '/api/admin/replays/{id}/events',
      summary: 'All rrweb events of a session, in order',
      request: { params: id },
      responses: json(z.object({ events: z.array(z.unknown()) })),
    }),
    async (c) => {
      const { s } = await find(c.req.valid('param').id);
      const events: unknown[] = [];
      for (let seq = 0; seq < s.chunks; seq++) {
        const gz = await storage.get(replayKey(s, seq)).catch(() => null); // a dropped seq has no object
        if (gz) events.push(...(JSON.parse(gunzipSync(gz).toString()) as unknown[]));
      }
      return c.json({ events }, 200);
    },
  );
}
