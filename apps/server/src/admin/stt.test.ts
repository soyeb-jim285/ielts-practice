import { fakeFetch, json, req, testUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { and, eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { setFetch } from '../ai/openrouter';
import { OWNER_EMAILS } from '../auth';
import { db } from '../db/client';
import { aiCosts } from '../db/schema';

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
