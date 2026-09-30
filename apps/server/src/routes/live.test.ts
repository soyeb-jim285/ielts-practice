import { afterEach, beforeEach, expect, it } from 'vitest';
// helpers first: it loads the app (and @hono/zod-openapi's zod extension) before the settings schema is built
import { chatReply, fakeFetch, json, req, seedPrompt, testUser } from '../test/helpers';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { attempts, liveSessions } from '../db/schema';
import { env } from '../env';
import { setAnalyzer } from '../jobs';
import { setFetch } from '../ai/openrouter';
import type { LiveState } from '../ai/examiner';
import { storage } from '../storage';

let ai: ReturnType<typeof fakeFetch>;
let analyzed: string[];
beforeEach(async () => {
  analyzed = [];
  setAnalyzer(async (id) => void analyzed.push(id));
  ai = fakeFetch({
    '/audio/speech': () => new Response(new Uint8Array([9, 9]), { headers: { 'Content-Type': 'audio/mpeg' } }),
    '/audio/transcriptions': () => json({ text: 'My name is Sam Lee.', duration: 3, words: [] }),
    '/chat/completions': () => chatReply('Thank you. Now, in this first part, I would like to ask you some questions about yourself. Where is your hometown?'),
  });
  setFetch(ai);
  for (const t of ['home', 'work', 'food']) await seedPrompt({ topic: t, followUps: [`${t} 1?`, `${t} 2?`, `${t} 3?`, `${t} 4?`] });
  await seedPrompt({ part: 2, type: 'cue-card', title: 'Describe a book you enjoyed', groupId: 'g1', followUps: ['Do you read often?'] });
  await seedPrompt({ part: 3, type: 'p3-discussion', topic: 'reading habits', groupId: 'g1', followUps: ['Do people read less today?'] });
});
afterEach(() => void (env.OPENAI_API_KEY = undefined));

const start = async (headers: Headers) => (await (await req('/api/live/start', { headers, body: {} })).json()) as any;
const upload = async (headers: Headers, sessionId: string) => {
  const { key } = (await (await req('/api/live/upload-url', { headers, body: { sessionId } })).json()) as any;
  await storage.put(key, new Uint8Array([1, 2]), 'audio/webm');
  return key as string;
};
const state = async (id: string) => (await db.query.liveSessions.findFirst({ where: eq(liveSessions.id, id) }))!.state as LiveState;

it('start → turn advances intro → p1 and grows the history by 2', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  expect(s).toMatchObject({ phase: 'intro', examinerText: expect.stringContaining('full name') });
  expect(s.audioUrl).toContain(`live/${s.sessionId}/e0.mp3`);
  expect(s.test.part1).toHaveLength(3);
  expect((await state(s.sessionId)).history).toHaveLength(1);

  const audioKey = await upload(headers, s.sessionId);
  const res = await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, audioKey } });
  expect(res.status).toBe(200);
  const t = (await res.json()) as any;
  expect(t).toMatchObject({ phase: 'p1', transcript: 'My name is Sam Lee.', examinerText: expect.stringContaining('hometown') });
  const st = await state(s.sessionId);
  expect(st.history).toHaveLength(3);
  expect(st.history.map((h) => [h.role, h.phase])).toEqual([['examiner', 'intro'], ['candidate', 'intro'], ['examiner', 'p1']]);
  expect(st.p1Asked).toBe(1);
  const chat = ai.calls.findLast((c) => c.url.includes('/chat/completions'))!.body;
  expect(chat.messages[0].content).toMatch(/Never give feedback/);
  expect(chat.messages.at(-1)).toEqual({ role: 'user', content: 'My name is Sam Lee.' });
});

it('rejects audio keys outside the session and other users', async () => {
  const a = await testUser();
  const b = await testUser();
  const s = await start(a.headers);
  expect((await req('/api/live/turn', { headers: a.headers, body: { sessionId: s.sessionId, audioKey: 'audio/other/x.webm' } })).status).toBe(400);
  expect((await req('/api/live/turn', { headers: b.headers, body: { sessionId: s.sessionId, skipped: true } })).status).toBe(404);
});

it('p1 end gives the cue card with 60 s prep, then the scripted long-turn start', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  const st = await state(s.sessionId);
  await db.update(liveSessions).set({ state: { ...st, phase: 'p1', p1Asked: 12 } }).where(eq(liveSessions.id, s.sessionId));
  const prep = (await (await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, skipped: true } })).json()) as any;
  expect(prep).toMatchObject({ phase: 'p2-prep', prepSeconds: 60, cueCard: { title: 'Describe a book you enjoyed' } });
  expect(prep.examinerText).toContain("Now, I'm going to give you a topic");

  const early = (await (await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, skipped: true } })).json()) as any;
  expect(early.phase).toBe('p2-prep');
  const st2 = await state(s.sessionId);
  await db.update(liveSessions).set({ state: { ...st2, phaseStartedAt: Date.now() - 61_000 } }).where(eq(liveSessions.id, s.sessionId));
  const talk = (await (await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, skipped: true } })).json()) as any;
  expect(talk).toMatchObject({ phase: 'p2-talk', examinerText: expect.stringContaining('Can you start speaking now, please?') });
});

it('realtime-token: 400 without a key, else mints a client secret', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  expect((await req('/api/live/realtime-token', { headers, body: { sessionId: s.sessionId } })).status).toBe(400);

  env.OPENAI_API_KEY = 'sk-test';
  const openai = fakeFetch({ '/v1/realtime/client_secrets': () => json({ value: 'ek_123', expires_at: 1756310470 }) });
  const real = globalThis.fetch;
  globalThis.fetch = openai;
  try {
    const r = await req('/api/live/realtime-token', { headers, body: { sessionId: s.sessionId } });
    expect(await r.json()).toEqual({ value: 'ek_123', expiresAt: 1756310470, model: 'gpt-realtime' });
  } finally {
    globalThis.fetch = real;
  }
  const sent = openai.calls[0]!.body;
  expect(sent.session).toMatchObject({ type: 'realtime', model: 'gpt-realtime', audio: { output: { voice: 'marin' } } });
  expect(sent.session.instructions).toContain('Describe a book you enjoyed');
});

it('finish creates one live attempt per part and analyses each, once', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  const parts: { part: number; audioKey: string; durationMs: number; energy: number[] }[] = [];
  for (const part of [1, 2, 3]) parts.push({ part, audioKey: await upload(headers, s.sessionId), durationMs: 60_000, energy: [1, 2] });
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts: [{ ...parts[0], audioKey: `live/${s.sessionId}/nope.webm` }] } })).status).toBe(400);

  // Two concurrent finishes (double click / client retry): the session row lock lets exactly one through.
  const both = await Promise.all([1, 2].map(() => req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })));
  expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  const res = both.find((r) => r.status === 200);
  const { attemptIds } = (await res!.json()) as any;
  expect(attemptIds).toHaveLength(3);
  expect(analyzed.sort()).toEqual([...attemptIds].sort());
  const rows = await db.select().from(attempts).where(eq(attempts.sessionId, s.sessionId));
  expect(rows.map((r) => [r.part, r.mode, r.status, r.promptId]).sort()).toEqual(
    [[1, 'live', 'analyzing', s.test.part1[0].id], [2, 'live', 'analyzing', s.test.part2.id], [3, 'live', 'analyzing', s.test.part3.id]].sort(),
  );
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })).status).toBe(409);
  expect((await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, skipped: true } })).status).toBe(409);
});

it('a TTS model/voice rejected upstream (4xx) says to change it in Settings', async () => {
  setFetch(fakeFetch({ '/audio/speech': () => json({ error: { message: 'Model does not exist' } }, 400) }));
  const { headers } = await testUser();
  const r = await req('/api/live/start', { headers, body: {} });
  expect(r.status).toBe(502);
  expect(((await r.json()) as any).error).toMatch(/Examiner voice model .* is unavailable – change it in Settings/);
});
