// WebSocket relay for native apps (iOS, Android): GET /api/live/gpt-live/ws?sessionId=...  (Authorization: Bearer <token>, same as the REST API).
// The relay holds the OpenAI connection: the API key, model, voice and instructions never leave the server. Protocol: docs/live-examiner.md.
import { createNodeWebSocket } from '@hono/node-ws';
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { clientMessage, openRelay, scrub, type Run } from '../ai/gpt-live';
import type { LiveState } from '../ai/examiner';
import { currentUser, requireUser } from '../auth';
import { db } from '../db/client';
import { liveSessions } from '../db/schema';
import { payerOf, liveKey, requireLive } from '../quota';
import { aiLimit } from '../ratelimit';
import type { App, AppEnv } from '../types';

export type Client = { send(data: string): void; close(code?: number, reason?: string): void };

/** One relayed connection: `message` takes what the app sends, the app gets upstream events through `client`. */
export function relay(client: Client, o: { userId: string; paidBy?: 'house' | 'own_key'; sessionId: string; test: LiveState['test']; apiKey: string }) {
  const run: Run = openRelay({ ...o, onEvent: (raw) => client.send(scrub(raw)), onClosed: () => client.close(1000, 'session ended') });
  return {
    run,
    message(raw: string) {
      const m = clientMessage(raw);
      if (!m || !run.ready) return; // audio before session.started, or anything off the allowlist, is dropped
      if ('cue' in m) run.cue(m.cue);
      else run.send(m.upstream);
    },
    closed: () => void run.end(),
  };
}

const check = createMiddleware<AppEnv>(async (c, next) => {
  const payer = await payerOf(currentUser(c));
  requireLive(payer, 'gpt-live'); // the user's own OpenAI key (the owner may use the server's): the relay opens the upstream connection with it
  c.set('liveKey' as never, liveKey(payer, 'openai') as never);
  c.set('livePaidBy' as never, (payer.keys.openai ? 'own_key' : 'house') as never);
  const id = c.req.query('sessionId') ?? '';
  const row = await db.query.liveSessions.findFirst({ where: and(eq(liveSessions.id, id), eq(liveSessions.userId, currentUser(c).id)) });
  if (!row) throw new HTTPException(404, { message: 'Live session not found' });
  c.set('liveTest' as never, (row.state as LiveState).test as never);
  await next();
});

/** Registers the relay route; call before the SPA catch-all. Returns what index.ts needs to accept upgrades. */
export function attachLiveRelay(app: App) {
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
  app.get(
    '/api/live/gpt-live/ws',
    requireUser,
    aiLimit,
    check,
    upgradeWebSocket((c) => {
      let r: ReturnType<typeof relay> | undefined;
      const sessionId = c.req.query('sessionId')!;
      const userId = currentUser(c).id;
      const test = c.get('liveTest' as never) as LiveState['test'];
      const apiKey = c.get('liveKey' as never) as string;
      const paidBy = c.get('livePaidBy' as never) as 'house' | 'own_key';
      return {
        onOpen: (_e, ws) => (r = relay({ send: (d) => ws.send(d), close: (code, reason) => ws.close(code, reason) }, { userId, paidBy, sessionId, test, apiKey })),
        onMessage: (e) => typeof e.data === 'string' && r?.message(e.data),
        onClose: () => r?.closed(),
        onError: () => r?.closed(),
      };
    }),
  );
  return injectWebSocket;
}
