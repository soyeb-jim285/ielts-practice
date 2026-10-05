import { createRoute, z } from '@hono/zod-openapi';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { gzipSync } from 'node:zlib';
import { currentUser, requireUser, sessionMiddleware } from '../auth';
import { db } from '../db/client';
import { replaySessions } from '../db/schema';
import { ApiError, type ErrorCode } from '../errors';
import { clientIpHash } from '../ip';
import { replayChunkOk, replayIpOk } from '../ratelimit';
import { replayKey } from '../replay';
import { storage } from '../storage';
import type { App } from '../types';

export const MAX_CHUNK_BYTES = 1024 * 1024;
export const MAX_SESSION_BYTES = 30 * 1024 * 1024;
const MAX_NEW_SESSIONS_PER_DAY = 50;
const MAX_SEQ_GAP = 5; // a client may drop a few chunks, not skip ahead
/** Pages the recorder never records (mirrors apps/web/src/lib/replay.ts); refused here too as defence in depth. */
const EXCLUDED = ['/login', '/signup', '/forgot-password', '/reset-password'];

// ponytail: these codes are not in ErrorCode (errors.ts is not this slice's); the web reads them as plain strings.
const fail = (status: 400 | 413, error: string, code: string) => new ApiError(status, { error, code: code as ErrorCode });

const Body = z.object({
  seq: z.number().int().min(0),
  events: z.array(z.unknown()).min(1).max(5000),
  // paths are shown in the owner's admin page: app paths only (leading slash, URL-safe characters), never arbitrary text
  pages: z.array(z.object({ path: z.string().max(200).regex(/^\/[A-Za-z0-9\-._~/?=&%#+]*$/), at: z.number() })).max(20).optional(),
});

export function register(app: App) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/replay/{sessionId}/chunks',
      tags: ['Admin'],
      summary: 'Upload one chunk of rrweb events for a tab recording',
      description: 'JSON body `{ seq, events[], pages?[] }`, at most 1 MB. A session holds at most 30 MB.',
      security: [{ bearer: [] }],
      middleware: [sessionMiddleware, requireUser, bodyLimit({ maxSize: MAX_CHUNK_BYTES, onError: () => { throw fail(413, 'Chunk too large.', 'chunk_too_large'); } })] as const,
      request: { params: z.object({ sessionId: z.string().uuid() }) },
      responses: { 200: { description: 'Stored (or a duplicate retry)', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } } },
    }),
    async (c) => {
      const user = currentUser(c);
      const { sessionId } = c.req.valid('param');
      if (!replayChunkOk(user.id) || !replayIpOk(clientIpHash(c) ?? 'unknown')) throw new ApiError(429, { error: 'Too many requests, slow down.', code: 'too_many_requests' });

      const raw = await c.req.text();
      const rawBytes = Buffer.byteLength(raw);
      if (rawBytes > MAX_CHUNK_BYTES) throw fail(413, 'Chunk too large.', 'chunk_too_large');
      let parsed;
      try {
        parsed = Body.safeParse(JSON.parse(raw));
      } catch {
        parsed = null;
      }
      if (!parsed?.success) throw new HTTPException(400, { message: 'Invalid chunk.' });
      const { seq, events, pages = [] } = parsed.data;
      if (pages.some((p) => EXCLUDED.some((x) => p.path.startsWith(x)))) throw new HTTPException(400, { message: 'Page is not recorded.' });

      let [row] = await db.select().from(replaySessions).where(eq(replaySessions.id, sessionId));
      if (!row) {
        const [recent] = await db.select({ n: count() }).from(replaySessions).where(and(eq(replaySessions.userId, user.id), gt(replaySessions.startedAt, sql`now() - interval '1 day'`)));
        if (recent!.n >= MAX_NEW_SESSIONS_PER_DAY) throw new ApiError(429, { error: 'Too many recordings today.', code: 'too_many_requests' });
        await db.insert(replaySessions).values({ id: sessionId, userId: user.id, userAgent: c.req.header('user-agent')?.slice(0, 300) ?? null }).onConflictDoNothing();
        [row] = await db.select().from(replaySessions).where(eq(replaySessions.id, sessionId));
      }
      if (row!.userId !== user.id) throw new HTTPException(404, { message: 'Not found.' }); // only the owner appends; a guest's row moves to the account via linkGuest, an orphaned row (owner deleted) takes nothing
      if (seq > row!.chunks + MAX_SEQ_GAP) throw new HTTPException(400, { message: 'Invalid chunk.' });
      if (seq < row!.chunks) return c.json({ ok: true as const }, 200); // retry of a chunk we already have
      if (row!.bytes + rawBytes > MAX_SESSION_BYTES) throw fail(413, 'Recording is full.', 'replay_full');

      await storage.put(replayKey(row!, seq), gzipSync(JSON.stringify(events)), 'application/gzip');
      await db
        .update(replaySessions)
        .set({
          chunks: seq + 1,
          bytes: sql`${replaySessions.bytes} + ${rawBytes}`,
          lastAt: sql`now()`,
          pages: [...row!.pages, ...pages].slice(-200),
        })
        .where(and(eq(replaySessions.id, sessionId), eq(replaySessions.userId, user.id)));
      return c.json({ ok: true as const }, 200);
    },
  );
}
