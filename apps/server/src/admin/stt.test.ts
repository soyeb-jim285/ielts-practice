import { fakeFetch, json, req, seedPrompt, testUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { and, eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { setFetch } from '../ai/openrouter';
import { env } from '../env';
import { OWNER_EMAILS } from '../auth';
import { db } from '../db/client';
import { aiCosts, attempts } from '../db/schema';
import { storage } from '../storage';

it('playground: lists OpenRouter transcription models with prices, transcribes with any of them, prices by list price and logs a playground cost; owner only', async () => {
  const or = fakeFetch({
    '/models?output_modalities=transcription': () =>
      json({ data: [{ id: 'acme/asr-1', name: 'Acme ASR', pricing: { prompt: '0.00001', completion: '0' } }, { id: 'acme/llm-asr', name: 'LLM ASR', pricing: { prompt: '0.000002', completion: '0.00001' } }] }),
    '/audio/transcriptions': () => json({ text: 'Um, I live in Dhaka.', duration: 36, words: [{ word: 'Um', start: 0, end: 0.4 }, { word: 'I', start: 0.5, end: 0.6 }, { word: 'live', start: 0.6, end: 0.9 }, { word: 'in', start: 0.9, end: 1 }, { word: 'Dhaka', start: 1, end: 1.5 }] }),
  });
  setFetch(or);
  const user = (await testUser()).headers;
  expect((await req('/api/admin/stt/models', { headers: user })).status).toBe(404);

  const { headers } = await testUser(OWNER_EMAILS[0]!);
  const models = (await (await req('/api/admin/stt/models', { headers })).json()) as any;
  expect(models.models).toEqual([
    expect.objectContaining({ id: 'hf/crisperwhisper-2-turbo', usdPerSecond: 0 }),
    expect.objectContaining({ id: 'hf/crisperwhisper-2-small', usdPerSecond: 0 }),
    expect.objectContaining({ id: 'modal/verbatim-student4', usdPerSecond: null }),
    expect.objectContaining({ id: 'acme/asr-1', usdPerSecond: 0.00001, usdPerMTokIn: null }),
    expect.objectContaining({ id: 'acme/llm-asr', usdPerSecond: null, usdPerMTokIn: 2, usdPerMTokOut: 10 }),
  ]);

  const r = await req('/api/admin/stt/transcribe', { headers, body: { model: 'acme/asr-1', audio: Buffer.from('fake').toString('base64'), format: 'webm', prompt: 'Uh, um.', language: null } });
  const d = (await r.json()) as any;
  expect(d).toMatchObject({ model: 'acme/asr-1', duration: 36, costExact: false, words: [{ w: 'Um,' }, { w: 'I' }, { w: 'live' }, { w: 'in' }, { w: 'Dhaka.' }] });
  expect(d.costUsd).toBeCloseTo(0.00036);
  const sent = or.calls.find((c) => c.url.includes('/audio/transcriptions'))!.body;
  expect(sent).toMatchObject({ model: 'acme/asr-1', prompt: 'Uh, um.', provider: { options: { groq: { prompt: 'Uh, um.' } } } });
  expect(sent.language).toBeUndefined(); // detect
  await vi.waitFor(async () => expect((await db.select().from(aiCosts).where(and(eq(aiCosts.stage, 'playground'), eq(aiCosts.model, 'acme/asr-1')))).map((c) => [c.costUsd, c.paidBy])).toContainEqual([0.00036, 'house']));

  setFetch(fakeFetch({ '/audio/transcriptions': () => new Response('{"error":"bad model"}', { status: 400 }) }));
  const bad = await req('/api/admin/stt/transcribe', { headers, body: { model: 'acme/nope', audio: 'AA==', format: 'wav' } });
  expect(bad.status).toBe(502);
  expect(((await bad.json()) as any).error).toContain('400');
});

it('playground: CrisperWhisper runs on its Hugging Face Space (Gradio upload, call, event stream) and comes back as words with timings, free', async () => {
  const seen: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+/, '')}`);
    if (url.endsWith('/gradio_api/upload')) return json(['/tmp/gradio/x/clip.wav']);
    if (url.endsWith('/gradio_api/call/transcribe')) return json({ event_id: 'ev1' });
    const out = ['We [UM] we went.', '   0.10 \u2192    0.30  We\n   0.40 \u2192    0.60  [UM]\n   0.90 \u2192    1.00  we\n   1.00 \u2192    1.40  went.', 'Mode: verbatim | Language: en | Duration: 1.6s | Processing time: 2s'];
    return new Response(`event: generating\ndata: null\n\nevent: complete\ndata: ${JSON.stringify(out)}\n\n`);
  });
  try {
    const { headers } = await testUser(OWNER_EMAILS[0]!);
    const r = await req('/api/admin/stt/transcribe', { headers, body: { model: 'hf/crisperwhisper-2-turbo', audio: 'UklGRg==', format: 'wav', language: null } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ text: 'We [UM] we went.', duration: 1.6, costUsd: 0, words: [{ w: 'We', start: 0.1, end: 0.3 }, { w: '[UM]' }, { w: 'we' }, { w: 'went.', end: 1.4 }] });
    expect(seen).toEqual(['POST /gradio_api/upload', 'POST /gradio_api/call/transcribe', 'GET /gradio_api/call/transcribe/ev1']);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('playground: our verbatim Whisper runs on Modal (multipart with proxy-auth headers, webm as-is) and comes back as words with timings and an estimated cost', async () => {
  const sent: { url: string; headers: Record<string, string>; body: FormData }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: init.body as FormData });
    return json({ text: '[uh] we we went [laughter]', words: [{ word: '[uh]', start: 0, end: 0.4 }, { word: 'we', start: 0.5, end: 0.6 }, { word: 'we', start: 0.6, end: 0.7 }, { word: 'went', start: 0.7, end: 1 }, { word: '[laughter]', start: 1.1, end: 1.6 }], audio_seconds: 1.8, realtime_factor: 25 });
  });
  const saved = { k: env.MODAL_KEY, s: env.MODAL_SECRET };
  try {
    const { headers } = await testUser(OWNER_EMAILS[0]!);
    const body = { model: 'modal/verbatim-student4', audio: Buffer.from('webm-bytes').toString('base64'), format: 'webm', language: 'en' };
    env.MODAL_KEY = env.MODAL_SECRET = undefined;
    const off = await req('/api/admin/stt/transcribe', { headers, body });
    expect(off.status).toBe(502);
    expect(((await off.json()) as any).error).toContain('MODAL_KEY');
    expect(sent).toHaveLength(0);

    Object.assign(env, { MODAL_KEY: 'wk-1', MODAL_SECRET: 'ws-1' });
    const r = await req('/api/admin/stt/transcribe', { headers, body });
    expect(r.status).toBe(200);
    const d = (await r.json()) as any;
    expect(d).toMatchObject({ model: 'modal/verbatim-student4', text: '[uh] we we went [laughter]', duration: 1.8, costExact: false, words: [{ w: '[uh]', start: 0, end: 0.4 }, { w: 'we' }, { w: 'we' }, { w: 'went' }, { w: '[laughter]', end: 1.6 }] });
    expect(d.costUsd).toBeGreaterThanOrEqual(0);
    expect(sent[0]!.url).toBe(`${env.MODAL_ASR_URL}/transcribe`);
    expect(sent[0]!.headers).toEqual({ 'Modal-Key': 'wk-1', 'Modal-Secret': 'ws-1' });
    expect(sent[0]!.body.get('word_timestamps')).toBe('true');
    expect((sent[0]!.body.get('audio') as File).name).toBe('clip.webm');
  } finally {
    Object.assign(env, { MODAL_KEY: saved.k, MODAL_SECRET: saved.s });
    vi.unstubAllGlobals();
  }
});

it('playground: picks a stored student recording by id, returns the stored run for the same audio, model and settings without calling the model, and runs again on a new setting or on request', async () => {
  const or = fakeFetch({ '/models?': () => json({ data: [] }), '/audio/transcriptions': () => json({ text: 'Hello there.', duration: 2, words: [] }) });
  setFetch(or);
  const student = await testUser('student@test.dev');
  const p = await seedPrompt({ title: 'Your hometown' });
  await storage.put('audio/s1.m4a', new TextEncoder().encode('m4a-bytes'), 'audio/mp4');
  await db.insert(attempts).values({ id: 'rec-1', userId: student.user.id, promptId: p.id, skill: 'speaking', part: 1, audioKey: 'audio/s1.m4a', durationMs: 2000 });
  await db.insert(attempts).values({ id: 'no-audio', userId: student.user.id, promptId: p.id, skill: 'writing', part: 2, text: 'An essay.' });
  const { headers } = await testUser(OWNER_EMAILS[0]!);
  expect((await req('/api/admin/stt/recordings', { headers: student.headers })).status).toBe(404);

  const list = (await (await req('/api/admin/stt/recordings?q=hometown', { headers })).json()) as any;
  expect(list).toMatchObject({ total: 1, items: [{ id: 'rec-1', user: 'student@test.dev', part: 1, prompt: 'Your hometown', format: 'm4a', durationMs: 2000, audioUrl: 'https://download.test/audio/s1.m4a' }] });
  expect(((await (await req('/api/admin/stt/recordings?q=nobody', { headers })).json()) as any).total).toBe(0);

  const run = (body: object) => req('/api/admin/stt/transcribe', { headers, body: { model: 'acme/asr-1', language: 'en', ...body } });
  const calls = () => or.calls.filter((c) => c.url.includes('/audio/transcriptions')).length;
  const first = (await (await run({ recordingId: 'rec-1' })).json()) as any;
  expect(first).toMatchObject({ text: 'Hello there.', cached: null });
  expect(or.calls.find((c) => c.url.includes('/audio/transcriptions'))!.body.input_audio).toEqual({ data: Buffer.from('m4a-bytes').toString('base64'), format: 'm4a' });
  // the same bytes uploaded hit the same stored run
  const again = (await (await run({ audio: Buffer.from('m4a-bytes').toString('base64'), format: 'm4a' })).json()) as any;
  expect(again).toMatchObject({ text: 'Hello there.', costUsd: 0, cached: { at: expect.any(String) } });
  expect(calls()).toBe(1);
  await run({ recordingId: 'rec-1', prompt: 'Um, uh.' });
  await run({ recordingId: 'rec-1', model: 'acme/asr-2' });
  expect(calls()).toBe(3);
  expect(((await (await run({ recordingId: 'rec-1', fresh: true })).json()) as any).cached).toBeNull();
  expect(calls()).toBe(4);

  // never an arbitrary storage key: only attempt rows that have audio
  expect((await run({ recordingId: 'no-audio' })).status).toBe(404);
  expect((await run({ recordingId: 'audio/s1.m4a' })).status).toBe(404);
  expect((await run({})).status).toBe(400);
  expect((await run({ recordingId: 'rec-1', audio: 'AA==', format: 'wav' })).status).toBe(400);
});
