import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import WebSocket from 'ws';
import { setUpstream } from '../ai/gpt-live';
import type { LiveState } from '../ai/examiner';
import { db } from '../db/client';
import { liveSessions } from '../db/schema';
import { env } from '../env';
import { app, req, seedPrompt, testUser } from '../test/helpers';
import { fakeSocket } from '../test/fakeSocket';
import { attachLiveRelay } from './live-ws';

let server: ReturnType<typeof serve>;
let port: number;
beforeAll(async () => {
  const inject = attachLiveRelay(app);
  server = serve({ fetch: app.fetch, port: 0 });
  inject(server);
  await new Promise((r) => server.once('listening', r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => void server.close());

const open = (headers: Record<string, string>, sessionId: string) =>
  new Promise<{ ws: WebSocket; msgs: any[] } | { status: number }>((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/live/gpt-live/ws?sessionId=${sessionId}`, { headers });
    const msgs: any[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.on('open', () => resolve({ ws, msgs }));
    ws.on('unexpected-response', (_q, res) => resolve({ status: res.statusCode! }));
  });
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(f()).toBe(true);
};

it('relay: bearer auth, one allowlisted pipe to OpenAI, server-owned session.start, transcript saved on close', async () => {
  for (const t of ['home', 'work', 'food']) await seedPrompt({ topic: t, followUps: [`${t} 1?`] });
  await seedPrompt({ part: 2, type: 'cue-card', title: 'Describe a book', groupId: 'g1', followUps: ['Do you read?'] });
  await seedPrompt({ part: 3, type: 'p3-discussion', topic: 'reading', groupId: 'g1', followUps: ['Why?'] });
  const { headers } = await testUser();
  const { sessionId } = (await (await req('/api/live/start', { headers, body: { skipTts: true } })).json()) as any;
  const auth = { Authorization: headers.get('Authorization')! };
  expect(await open({}, sessionId)).toEqual({ status: 401 });
  expect(await open(auth, sessionId)).toEqual({ status: 400 }); // no OPENAI_API_KEY
  env.OPENAI_API_KEY = 'sk-test';
  try {
    expect(await open(auth, 'nope')).toEqual({ status: 404 });
    const up = fakeSocket(false);
    const urls: string[] = [];
    setUpstream((u) => (urls.push(u), up));
    const c = (await open(auth, sessionId)) as { ws: WebSocket; msgs: any[] };
    await until(() => urls.length === 1);
    expect(urls).toEqual(['wss://api.openai.com/v1/live/sessions']);
    up.readyState = 1;
    up.emit('open');
    expect(JSON.parse(up.sent[0]!)).toMatchObject({ type: 'session.start', session: { model: 'gpt-live-1', audio: { format: { type: 'audio/pcm', rate: 24000 } } } });

    c.ws.send('{"type":"session.input_audio.append","audio":"AAAA"}'); // before session.started: dropped
    await new Promise((r) => setTimeout(r, 150));
    up.emit('message', JSON.stringify({ type: 'session.started', session: { id: 'live_1', instructions: 'secret' } }));
    await until(() => c.msgs.length === 1);
    expect(c.msgs[0]).toEqual({ type: 'session.started', session: { id: 'live_1' } });

    c.ws.send('{"type":"session.input_audio.append","audio":"AAAA"}');
    c.ws.send('{"type":"session.start","session":{"model":"evil","instructions":"x"}}'); // not allowlisted
    c.ws.send('{"type":"app.cue","cue":"begin"}');
    await until(() => up.sent.length === 3);
    expect(up.sent.slice(1).map((m) => JSON.parse(m).type)).toEqual(['session.input_audio.append', 'session.instructions.append']);

    up.emit('message', JSON.stringify({ type: 'session.output_transcript.delta', delta: 'Hello.' }));
    await until(() => c.msgs.length === 2);
    c.ws.close();
    await until(() => up.sent.some((m) => JSON.parse(m).type === 'session.close'));
    await new Promise((r) => setTimeout(r, 200));
    const row = await db.query.liveSessions.findFirst({ where: eq(liveSessions.id, sessionId) });
    expect((row!.state as LiveState).history.map((h) => h.text)).toEqual(['Hello.']);
  } finally {
    env.OPENAI_API_KEY = undefined;
  }
});
