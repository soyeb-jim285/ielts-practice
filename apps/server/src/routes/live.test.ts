import { afterEach, beforeEach, expect, it } from 'vitest';
// helpers first: it loads the app (and @hono/zod-openapi's zod extension) before the settings schema is built
import { chatReply, fakeFetch, json, req, seedPrompt, setKey, testUser } from '../test/helpers';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { attempts, liveSessions, quotaUsage } from '../db/schema';
import { setAnalyzer } from '../jobs';
import { setFetch } from '../ai/openrouter';
import { clearBalanceCache } from '../community';
import type { LiveState } from '../ai/examiner';
import { storage } from '../storage';
import { clearSpeechCache } from './live';
import { endRun, setUpstream } from '../ai/gpt-live';
import { fakeSocket } from '../test/fakeSocket';

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
  // the turn-based examiner (STT, TTS, LLM) is paid with the user's own OpenRouter key, never the community key
  expect(ai.calls.length).toBeGreaterThan(2);
  expect(new Set(ai.calls.map((c) => c.headers.authorization))).toEqual(new Set(['Bearer sk-test-openrouter-0000']));
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

it('gpt-live/session: 403 without an own OpenAI key, else creates the WebRTC session on that key with the server-owned config and attaches a sideband', async () => {
  const { headers, user } = await testUser();
  const s = await start(headers);
  const body = { sessionId: s.sessionId, sdp: 'v=0 offer' };
  const denied = await req('/api/live/gpt-live/session', { headers, body });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: 'live_requires_own_key', tier: 'own-key' });

  await setKey(user.id, 'openai', 'sk-test');
  const openai = fakeFetch({ '/v1/live/sessions': () => json({ session: { id: 'live_123' }, transport: { type: 'webrtc', sdp: 'v=0 answer' } }, 201) });
  const real = globalThis.fetch;
  globalThis.fetch = openai;
  const attached: string[] = [];
  setUpstream((url) => (attached.push(url), fakeSocket()));
  try {
    const r = await req('/api/live/gpt-live/session', { headers, body });
    expect(await r.json()).toEqual({ sdp: 'v=0 answer', sessionId: 'live_123' });
    expect((await req('/api/live/gpt-live/session', { headers, body: { ...body, sessionId: 'nope' } })).status).toBe(404);
  } finally {
    globalThis.fetch = real;
    await endRun(s.sessionId, user.id);
  }
  expect(openai.calls[0]!.headers.authorization).toBe('Bearer sk-test'); // their key, not the server's
  const sent = openai.calls[0]!.body;
  expect(sent.transport).toEqual({ type: 'webrtc', sdp: 'v=0 offer' });
  expect(sent.session).toMatchObject({ model: 'gpt-live-1', audio: { output: { voice: 'vesper' } } });
  expect(sent.session.delegation).toBeUndefined();
  expect(sent.session.instructions).toContain('Never delegate');
  expect(sent.session.instructions).not.toContain('Describe a book you enjoyed'); // topics arrive with the cues
  expect(attached).toEqual(['wss://api.openai.com/v1/live/sessions/live_123/attach']);
});

it('gpt-live/cue: the server sends the instruction through the sideband, else hands the text back', async () => {
  const { headers, user } = await testUser();
  const s = await start(headers);
  const cue = (cue: string) => req('/api/live/gpt-live/cue', { headers, body: { sessionId: s.sessionId, cue } });
  const before = (await (await cue('part2')).json()) as any;
  expect(before.sent).toBe(false);
  expect(before.content).toContain('Describe a book you enjoyed');

  await setKey(user.id, 'openai', 'sk-test');
  const sock = fakeSocket();
  setUpstream(() => sock);
  const real = globalThis.fetch;
  globalThis.fetch = fakeFetch({ '/v1/live/sessions': () => json({ session: { id: 'live_1' }, transport: { sdp: 'a' } }, 201) });
  try {
    await req('/api/live/gpt-live/session', { headers, body: { sessionId: s.sessionId, sdp: 'o' } });
    sock.emit('open');
    expect(((await (await cue('part2')).json()) as any).sent).toBe(true);
    expect(sock.sent.map((m) => JSON.parse(m))).toEqual([expect.objectContaining({ type: 'session.instructions.append', delegation_id: null, content: before.content })]);
    expect((await cue('nope')).status).toBe(400);
    // transcripts from the sideband are saved when the run ends (also by /finish)
    sock.emit('message', JSON.stringify({ type: 'session.output_transcript.delta', delta: 'Thank you.' }));
  } finally {
    globalThis.fetch = real;
  }
  await endRun(s.sessionId, user.id);
  const st = await state(s.sessionId);
  expect(st.history.map((h) => [h.role, h.phase, h.text])).toEqual([['examiner', 'p2-prep', 'Thank you.']]);
});

it('gemini-token: 403 without an own Gemini key, else mints a locked ephemeral token with it', async () => {
  const { headers, user } = await testUser();
  const s = await start(headers);
  expect((await req('/api/live/gemini-token', { headers, body: { sessionId: s.sessionId } })).status).toBe(403);

  await setKey(user.id, 'gemini', 'g-test');
  const google = fakeFetch({ '/v1beta/auth_tokens': () => json({ name: 'auth_tokens/abc', expireTime: '2030-01-01T00:20:00Z' }) });
  const real = globalThis.fetch;
  globalThis.fetch = google;
  try {
    const r = await req('/api/live/gemini-token', { headers, body: { sessionId: s.sessionId } });
    expect(await r.json()).toMatchObject({ value: 'auth_tokens/abc', model: 'gemini-3.8-live', expiresAt: expect.any(Number) });
  } finally {
    globalThis.fetch = real;
  }
  expect(google.calls[0]!.headers['x-goog-api-key']).toBe('g-test');
  const sent = google.calls[0]!.body;
  expect(sent).toMatchObject({ uses: 1, bidiGenerateContentSetup: { model: 'models/gemini-3.8-live', generationConfig: { responseModalities: ['AUDIO'] } } });
  expect(sent.bidiGenerateContentSetup.systemInstruction.parts[0].text).toContain('Describe a book you enjoyed');
  expect(sent.fieldMask).toContain('systemInstruction.parts');
  expect(sent.fieldMask).not.toContain('sessionResumption');
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
  const { headers, user } = await testUser();
  await setKey(user.id, 'gemini');
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

it('a signed-in user without an OpenRouter key but with an OpenAI key: duplex start is allowed, turn-based is not; the quota is checked at start and reserved at finish', async () => {
  const { headers, user } = await testUser(undefined, { key: false });
  await setKey(user.id, 'openai', 'sk-test');
  const turnBased = await req('/api/live/start', { headers, body: {} });
  expect([turnBased.status, ((await turnBased.json()) as any).code]).toEqual([403, 'live_requires_own_key']);

  const s = (await (await req('/api/live/start', { headers, body: { skipTts: true } })).json()) as any;
  expect(s.sessionId).toBeTruthy();
  const turn = await req('/api/live/turn', { headers, body: { sessionId: s.sessionId, skipped: true } });
  expect(turn.status).toBe(403);

  const parts = [{ part: 1, audioKey: await upload(headers, s.sessionId), durationMs: 60_000 }];
  const done = await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } });
  expect(done.status).toBe(200);
  expect(await db.select().from(quotaUsage).where(eq(quotaUsage.userId, user.id))).toMatchObject([{ skill: 'speaking', unitKey: s.sessionId, tier: 'community' }]);

  // the one speaking test of the day is gone: the next live session is refused before it starts
  const again = await req('/api/live/start', { headers, body: { skipTts: true } });
  expect(again.status).toBe(429);
  expect(await again.json()).toMatchObject({ code: 'quota_exceeded', skill: 'speaking', tier: 'community' });
});

it('live finish with an exhausted community balance is refused (402) and creates no attempts', async () => {
  const { headers, user } = await testUser(undefined, { key: false });
  await setKey(user.id, 'gemini', 'g-test');
  const s = (await (await req('/api/live/start', { headers, body: { skipTts: true } })).json()) as any;
  const f = fakeFetch({ '/api/v1/key': () => json({ data: { limit: 20, usage: 20, limit_remaining: 0 } }) });
  setFetch(f);
  clearBalanceCache(); // the balance ran out while the session was running
  const parts = [{ part: 1, audioKey: await upload(headers, s.sessionId), durationMs: 60_000 }];
  const r = await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } });
  expect([r.status, ((await r.json()) as any).code]).toEqual([402, 'community_balance_exhausted']);
  expect(await db.select().from(attempts).where(eq(attempts.sessionId, s.sessionId))).toHaveLength(0);
});

it('a retried finish after a refund is a 409 and does not charge the test again', async () => {
  const { headers, user } = await testUser(undefined, { key: false });
  await setKey(user.id, 'gemini', 'g-test');
  const s = (await (await req('/api/live/start', { headers, body: { skipTts: true } })).json()) as any;
  const parts = [{ part: 1, audioKey: await upload(headers, s.sessionId), durationMs: 60_000 }];
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })).status).toBe(200);
  await db.update(quotaUsage).set({ refundedAt: new Date() }).where(eq(quotaUsage.userId, user.id)); // its analysis failed and was given back
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })).status).toBe(409);
  expect((await db.select().from(quotaUsage).where(eq(quotaUsage.userId, user.id)))[0]!.refundedAt).toBeInstanceOf(Date);
});

it('an own-key user can run any number of live sessions', async () => {
  const { headers, user } = await testUser();
  await setKey(user.id, 'gemini', 'g-test');
  for (let i = 0; i < 3; i++) {
    const s = (await (await req('/api/live/start', { headers, body: { skipTts: true } })).json()) as any;
    const parts = [{ part: 1, audioKey: await upload(headers, s.sessionId), durationMs: 60_000 }];
    expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })).status).toBe(200);
  }
});
