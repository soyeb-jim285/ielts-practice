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
import { clearSpeechCache } from './live';

let ai: ReturnType<typeof fakeFetch>;
let analyzed: string[];
beforeEach(async () => {
  clearSpeechCache();
  analyzed = [];
  setAnalyzer(async (id) => void analyzed.push(id));
  ai = fakeFetch({
    '/audio/speech': () => new Response(new Uint8Array([9, 9]), { headers: { 'Content-Type': 'audio/pcm;rate=24000;channels=1' } }),
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
  expect(s.audioUrl).toContain(`live/${s.sessionId}/e0.wav`); // default Gemini TTS is PCM-only → WAV
  expect(s.test.part1).toHaveLength(3);
  expect((await state(s.sessionId)).history).toHaveLength(1);

  const audioKey = await upload(headers, s.sessionId);
  const res = await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, audioKey } });
  expect(res.status).toBe(200);
  const t = (await res.json()) as any;
  expect(t).toMatchObject({ phase: 'p1', transcript: 'My name is Sam Lee.', examinerText: expect.stringContaining("Let's talk about") });
  const st = await state(s.sessionId);
  expect(st.history).toHaveLength(3);
  expect(st.history.map((h) => [h.role, h.phase])).toEqual([['examiner', 'intro'], ['candidate', 'intro'], ['examiner', 'p1']]);
  expect(st.p1Asked).toBe(1);
  // Part 1 questions are fixed wording: no examiner LLM call, so the voice is made while the answer is transcribed.
  expect(ai.calls.some((c) => c.url.includes('/chat/completions'))).toBe(false);
  expect(ai.calls.filter((c) => c.url.includes('/audio/transcriptions'))).toHaveLength(1);
});

it('a generated examiner line (Part 3) uses a low-effort, short LLM call after the transcript', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  const st = await state(s.sessionId);
  await db.update(liveSessions).set({ state: { ...st, phase: 'p2-follow' } }).where(eq(liveSessions.id, s.sessionId));
  const audioKey = await upload(headers, s.sessionId);
  const t = (await (await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, audioKey } })).json()) as any;
  expect(t).toMatchObject({ phase: 'p3', transcript: 'My name is Sam Lee.' });
  const chat = ai.calls.findLast((c) => c.url.includes('/chat/completions'))!.body;
  expect(chat).toMatchObject({ reasoning: { effort: 'low' }, max_tokens: 200 });
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

it('a TTS model/voice rejected upstream (4xx) says to change it in Settings, captions only', async () => {
  setFetch(fakeFetch({ '/audio/speech': () => json({ error: { message: 'Model does not exist' } }, 400) }));
  const { headers } = await testUser();
  const r = await req('/api/live/start', { headers, body: {} });
  expect(r.status).toBe(200);
  expect((await r.json()) as any).toMatchObject({ audioUrl: null, voiceError: expect.stringContaining('captions') });
});

it('TTS failure (402) degrades to captions: start and turn still work with audioUrl null', async () => {
  ai = fakeFetch({ '/audio/speech': () => json({ error: 'Insufficient credits' }, 402), '/audio/transcriptions': () => json({ text: 'Sam.', duration: 1, words: [] }), '/chat/completions': () => chatReply('Where is your hometown?') });
  setFetch(ai);
  const { headers } = await testUser();
  const s = await start(headers);
  expect(s).toMatchObject({ phase: 'intro', audioUrl: null, voiceError: expect.stringContaining('captions') });
  const t = (await (await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, audioKey: await upload(headers, s.sessionId) } })).json()) as any;
  expect(t).toMatchObject({ phase: 'p1', audioUrl: null });
});

it('skipTts starts a (realtime) session without calling TTS', async () => {
  const { headers } = await testUser();
  const s = (await (await req('/api/live/start', { headers, body: { skipTts: true } })).json()) as any;
  expect(s).toMatchObject({ phase: 'intro', audioUrl: null });
  expect(s.voiceError).toBeUndefined();
  expect(ai.calls.some((c) => c.url.includes('/audio/speech'))).toBe(false);
});

it('fixed examiner lines are voiced once per model and voice, not once per session', async () => {
  const { headers } = await testUser();
  await start(headers);
  const tts = () => ai.calls.filter((c) => c.url.includes('/audio/speech')).length;
  const first = tts();
  expect(first).toBeGreaterThan(0);
  await start(headers); // the intro line is fixed wording
  expect(tts()).toBe(first);
});

it('Part 2 long turn: prep timer, talk, then the 2:00 cut-in leads into the rounding-off question', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  const turn = async (body: Record<string, unknown> = { skipped: true }) => (await (await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, ...body } })).json()) as any;
  const set = async (patch: Partial<LiveState>) => db.update(liveSessions).set({ state: { ...(await state(s.sessionId)), ...patch } }).where(eq(liveSessions.id, s.sessionId));
  await set({ phase: 'p1', p1Asked: 12 });
  const prep = await turn();
  expect(prep).toMatchObject({ phase: 'p2-prep', prepSeconds: 60 });
  await set({ phaseStartedAt: Date.now() - 45_000 }); // asking too early: the remaining preparation time comes back
  const mid = await turn();
  expect(mid).toMatchObject({ phase: 'p2-prep', examinerText: 'You still have a little time to prepare.' });
  expect(mid.prepSeconds).toBeLessThanOrEqual(15);
  expect(mid.prepSeconds).toBeGreaterThan(10);
  await set({ phaseStartedAt: Date.now() - 61_000 });
  expect(await turn()).toMatchObject({ phase: 'p2-talk', examinerText: expect.stringContaining('Can you start speaking now') });
  // the candidate talks for the full two minutes: the examiner cuts in with the end-of-time line, then asks the rounding-off question
  const long = fakeFetch({
    '/audio/speech': () => new Response(new Uint8Array([9, 9]), { headers: { 'Content-Type': 'audio/pcm;rate=24000;channels=1' } }),
    '/audio/transcriptions': () => json({ text: 'I talked about a book for two minutes.', duration: 120, words: [] }),
    '/chat/completions': () => chatReply("Thank you. That's the end of your time. Do you read often?"),
  });
  setFetch(long);
  await set({ phaseStartedAt: Date.now() - 121_000 });
  const cut = await turn({ audioKey: await upload(headers, s.sessionId) });
  expect(cut).toMatchObject({ phase: 'p2-follow', transcript: 'I talked about a book for two minutes.', examinerText: "Thank you. That's the end of your time. Do you read often?" });
  // the examiner LLM was told to use the end-of-time lead because the talk ran to the limit
  expect(JSON.stringify(long.calls.findLast((c) => c.url.includes('/chat/completions'))!.body.messages[0])).toContain("That's the end of your time.");
  expect((await state(s.sessionId)).history.filter((h) => h.phase === 'p2-talk').map((h) => [h.role, h.durationMs])).toEqual([['examiner', undefined], ['candidate', 120_000]]);
  const after = await turn({ skipped: true });
  expect(after.phase).toBe('p3');
});
