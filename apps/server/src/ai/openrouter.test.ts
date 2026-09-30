import { expect, it } from 'vitest';
import { z } from 'zod';
import { chatReply, fakeFetch, json } from '../test/helpers';
import { AiError, chatJson, punctuate, setFetch, speak, toStrictSchema, transcribe } from './openrouter';

const schema = z.object({ band: z.number().int(), range: z.tuple([z.number(), z.number()]) });
const ask = () => chatJson({ model: 'm/x', system: 's', user: 'u', schema, schemaName: 'x' });

it('chatJson: parses fenced JSON and sends a strict json_schema', async () => {
  const f = fakeFetch({ '/chat/completions': () => chatReply('```json\n{"band":6,"range":[5,6]}\n```') });
  setFetch(f);
  expect(await ask()).toEqual({ band: 6, range: [5, 6] });
  const rf = f.calls[0]!.body.response_format;
  expect(rf.json_schema).toMatchObject({ name: 'x', strict: true });
  expect(rf.json_schema.schema).toMatchObject({ additionalProperties: false, required: ['band', 'range'] });
  expect(rf.json_schema.schema.properties.range).toEqual({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 });
  expect(JSON.stringify(toStrictSchema(schema))).not.toContain('prefixItems');
});

it('chatJson: repairs invalid JSON once with the validation errors', async () => {
  const replies = ['{"band":"six"}', '{"band":6,"range":[6,7]}'];
  const f = fakeFetch({ '/chat/completions': () => chatReply(replies.shift()!) });
  setFetch(f);
  expect(await ask()).toEqual({ band: 6, range: [6, 7] });
  expect(f.calls).toHaveLength(2);
  const msgs = f.calls[1]!.body.messages;
  expect(msgs.at(-2)).toEqual({ role: 'assistant', content: '{"band":"six"}' });
  expect(msgs.at(-1).content).toContain('failed validation');
  expect(msgs.at(-1).content).toContain('band');
});

it('chatJson: throws invalid_json after two bad replies', async () => {
  const f = fakeFetch({ '/chat/completions': () => chatReply('not json at all') });
  setFetch(f);
  await expect(ask()).rejects.toMatchObject({ code: 'invalid_json' });
  expect(f.calls).toHaveLength(2);
});

it('retries once on 503, then succeeds; gives up after a second failure', async () => {
  let n = 0;
  setFetch(fakeFetch({ '/chat/completions': () => (n++ === 0 ? json({}, 503) : chatReply({ band: 7, range: [7, 7] })) }));
  expect((await ask()).band).toBe(7);
  expect(n).toBe(2);

  const f = fakeFetch({ '/chat/completions': () => json({}, 500) });
  setFetch(f);
  await expect(ask()).rejects.toBeInstanceOf(AiError);
  expect(f.calls).toHaveLength(2);
});

it('transcribe: maps words, falls back to segment confidence, restores punctuation, primes verbatim fillers', async () => {
  const f = fakeFetch({
    '/audio/transcriptions': () =>
      json({
        text: ' Hello there, friend. It was big.',
        duration: 3,
        words: [
          { word: ' Hello', start: 0, end: 0.4, confidence: 0.9 },
          { word: 'there', start: 0.5, end: 0.8 },
          { word: 'friend', start: 1.1, end: 1.5, probability: 0.7 },
          { word: 'It', start: 2.1, end: 2.2 },
          { word: 'was', start: 2.2, end: 2.4 },
          { word: 'big', start: 2.4, end: 2.8 },
        ],
        segments: [{ start: 0, end: 3, avg_logprob: Math.log(0.5) }],
      }),
  });
  setFetch(f);
  const r = await transcribe({ model: 'openai/whisper-large-v3', audio: new Uint8Array([1, 2, 3]), format: 'webm' });
  expect(r.duration).toBe(3);
  expect(r.words.map((w) => w.w)).toEqual(['Hello', 'there,', 'friend.', 'It', 'was', 'big.']);
  // per-word probability wins; otherwise the segment's mean token probability (exp avg_logprob)
  expect(r.words.map((w) => w.conf)).toEqual([0.9, 0.5, 0.7, 0.5, 0.5, 0.5]);
  expect(f.calls[0]!.body).toMatchObject({ input_audio: { data: 'AQID', format: 'webm' }, response_format: 'verbose_json', prompt: expect.stringContaining('uh') });
});

it('punctuate: re-syncs after a word the text spells differently', () => {
  const words = [{ w: 'I' }, { w: 'have' }, { w: 'twenty' }, { w: 'cats' }, { w: 'Really' }];
  punctuate(words, 'I have 20 cats. Really?');
  expect(words.map((w) => w.w)).toEqual(['I', 'have', 'twenty', 'cats.', 'Really?']);
});

it('maps 402/401 to non-retryable, candidate-safe copy; 429/5xx stay retryable', async () => {
  for (const [status, msg, retryable] of [[402, 'try again later', false], [401, 'try again later', false], [400, 'choose another model', false], [429, 'retry in a minute', true]] as const) {
    setFetch(fakeFetch({ '/chat/completions': () => json({ error: 'x' }, status) }));
    const e = (await ask().catch((x) => x)) as AiError;
    expect(e.message).toContain(msg);
    expect(e.message).not.toContain('Please retry.');
    expect(e.retryable).toBe(retryable);
  }
  expect(new AiError('timeout', 'x').retryable).toBe(true);
});

it('transcribe: low segment probability yields unclear words', async () => {
  const { computeSpeechMetrics } = await import('@ielts/core');
  setFetch(fakeFetch({ '/audio/transcriptions': () => json({ text: 'I like it', duration: 2, words: ['I', 'like', 'it'].map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 })), segments: [{ start: 0, end: 2, avg_logprob: -1.2 }] }) }));
  const r = await transcribe({ model: 'openai/whisper-large-v3', audio: new Uint8Array([1]), format: 'webm' });
  expect(computeSpeechMetrics(r.words, { durationS: 2 }).unclear.map((u) => u.tier)).toEqual([3, 3, 3]);
});

it('chatJson: sends the reasoning effort when set', async () => {
  const f = fakeFetch({ '/chat/completions': () => chatReply({ band: 6, range: [5, 6] }) });
  setFetch(f);
  await chatJson({ model: 'm/x', system: 's', user: 'u', schema, schemaName: 'x', effort: 'low' });
  expect(f.calls[0]!.body.reasoning).toEqual({ effort: 'low' });
});

it('speak: PCM-only Gemini TTS is requested as pcm and wrapped in a WAV header; others get mp3', async () => {
  const pcm = new Uint8Array([1, 0, 2, 0]);
  const f = fakeFetch({ '/audio/speech': () => new Response(pcm, { headers: { 'Content-Type': 'audio/pcm;rate=24000;channels=1' } }) });
  setFetch(f);
  const r = await speak({ model: 'google/gemini-3.8-flash-tts', voice: 'Charon', text: 'Hi' });
  expect(f.calls[0]!.body.response_format).toBe('pcm');
  expect(r.contentType).toBe('audio/wav');
  const b = Buffer.from(r.audio);
  expect([b.toString('ascii', 0, 4), b.toString('ascii', 8, 12), b.readUInt32LE(24), b.readUInt32LE(40), b.length]).toEqual(['RIFF', 'WAVE', 24000, 4, 48]);

  const g = fakeFetch({ '/audio/speech': () => new Response(new Uint8Array([9]), { headers: { 'Content-Type': 'audio/mpeg' } }) });
  setFetch(g);
  expect((await speak({ model: 'deepgram/aura-2', voice: 'aura-2-thalia-en', text: 'Hi' })).contentType).toBe('audio/mpeg');
  expect(g.calls[0]!.body.response_format).toBe('mp3');
});

// Live smoke test of the default voice (a fraction of a cent): SMOKE=1 OPENROUTER_API_KEY=… pnpm exec vitest run src/ai/openrouter.test.ts -t smoke
it.runIf(process.env.SMOKE)('smoke: default TTS model returns playable audio', async () => {
  const { DEFAULT_SETTINGS } = await import('../settings');
  setFetch((...a) => fetch(...a));
  const r = await speak({ model: DEFAULT_SETTINGS.models.tts, voice: DEFAULT_SETTINGS.models.ttsVoice, text: 'Good morning.' });
  expect(r.audio.length).toBeGreaterThan(1000);
}, 60_000);
