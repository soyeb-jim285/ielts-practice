import { expect, it } from 'vitest';
import { z } from 'zod';
import { chatReply, fakeFetch, json } from '../test/helpers';
import { AiError, chatJson, punctuate, setFetch, toStrictSchema, transcribe, verbatimAlone, verbatimSane } from './openrouter';

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

it('retries 503, then succeeds; gives up after the third failure', async () => {
  let n = 0;
  setFetch(fakeFetch({ '/chat/completions': () => (n++ === 0 ? json({}, 503) : chatReply({ band: 7, range: [7, 7] })) }));
  expect((await ask()).band).toBe(7);
  expect(n).toBe(2);

  const f = fakeFetch({ '/chat/completions': () => json({}, 500) });
  setFetch(f);
  await expect(ask()).rejects.toBeInstanceOf(AiError);
  expect(f.calls).toHaveLength(3);
});

it('transcribe: maps words, falls back to segment confidence, restores punctuation', async () => {
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
  expect(f.calls[0]!.body).toMatchObject({ input_audio: { data: 'AQID', format: 'webm' }, response_format: 'verbose_json' });
  expect(f.calls).toHaveLength(1); // not verbatim: one plain pass
});

it('transcribe verbatim: one primed Whisper pass (provider.options; top-level prompt is ignored) when it is sane on its own, else a plain pass decides', async () => {
  const stt = (ws: string[]) => json({ text: ws.join(' '), duration: 3, words: ws.map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.2 })) });
  const plain = ['I', 'go', 'there'];
  const go = (primed: string[]) => {
    const f = fakeFetch({ '/audio/transcriptions': (_, init) => stt(String(init.body).includes('"provider"') ? primed : plain) });
    setFetch(f);
    return transcribe({ model: 'openai/whisper-large-v3', audio: new Uint8Array([1]), format: 'webm', verbatim: true }).then((r) => ({ r, f }));
  };
  const { r, f } = await go(['um', 'I', 'go', 'uh', 'there']);
  expect(r).toMatchObject({ verbatim: true, text: 'um I go uh there' });
  expect(f.calls).toHaveLength(1); // sane on its own: no plain pass is paid for
  const primed = f.calls.find((c) => c.body.provider)!.body;
  expect(primed.prompt).toBeUndefined();
  expect(primed.provider.options.groq.prompt).toContain('uh');
  expect(Object.keys(primed.provider.options)).toEqual(expect.arrayContaining(['groq', 'deepinfra/us', 'together']));
  const loop = await go(['I', 'think', 'um', 'I', 'think', 'um', 'I', 'think', 'um']);
  expect(loop.r).toMatchObject({ verbatim: false, text: 'I go there' });
  expect(loop.f.calls).toHaveLength(2); // the plain pass only runs when the primed one is not sane
  expect((await transcribe({ model: 'deepgram/nova-3', audio: new Uint8Array([1]), format: 'webm', verbatim: true })).verbatim).toBe(false); // only Whisper is primed
});

it('verbatimAlone: a primed pass is kept on its own unless it loops, echoes the prompt or leaves a long stretch without words', () => {
  const at = (ws: string[], step = 0.4, from = 0) => ws.map((word, i) => ({ word, start: from + i * step, end: from + i * step + 0.3 }));
  const ok = 'um because my father he say he say it is uh important for safety'.split(' ');
  expect(verbatimAlone({ words: at(ok), duration: 6 })).toBe(true);
  expect(verbatimAlone({ words: [...at(ok.slice(0, 6)), ...at(ok.slice(6), 0.4, 20)], duration: 25 })).toBe(false); // 17 s in the middle with no words: a dropped stretch
  expect(verbatimAlone({ words: at(ok), duration: 30 })).toBe(false); // the last 24 s have no words
  expect(verbatimAlone({ words: at('I think um I think um I think um'.split(' ')), duration: 4 })).toBe(false); // loop
  expect(verbatimAlone({ words: at('so uh she have um two book you know'.split(' ')), duration: 4 })).toBe(false); // prompt echo
});

it('verbatimSane: rejects loops, prompt echoes and dropped or invented content', () => {
  const plain = 'because my father he say it is important for safety so I go to the pool'.split(' ');
  expect(verbatimSane('um because my father he say he say it is uh important for for safety so I go to the the pool'.split(' '), plain)).toBe(true);
  expect(verbatimSane('um because my father he say'.split(' '), plain)).toBe(false); // dropped a stretch
  expect(verbatimSane([...plain, ...'I think um I think um I think um'.split(' ')], plain)).toBe(false); // loop
  expect(verbatimSane([...plain.slice(0, 12), 'uh', 'she', 'have', 'um', 'two', 'book'], plain)).toBe(false); // prompt echo
  expect(verbatimSane(['um', 'um', 'um', 'um', ...plain], plain)).toBe(false);
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

it('chatJson: a provider that rejects the strict schema (400) gets JSON mode with the schema in the prompt', async () => {
  const f = fakeFetch({ '/chat/completions': (_, init) => (String(init.body).includes('"json_schema"') ? json({ error: 'invalid argument' }, 400) : chatReply({ band: 6, range: [5, 6] })) });
  setFetch(f);
  const served: unknown[] = [];
  expect(await chatJson({ model: 'm/x', system: 's', user: 'u', schema, schemaName: 'x', onServed: (s) => served.push(s) })).toEqual({ band: 6, range: [5, 6] });
  expect(f.calls.map((c) => c.body.response_format.type)).toEqual(['json_schema', 'json_object']);
  expect(f.calls[1]!.body.messages[0].content).toContain('"required":["band","range"]');
  expect(served).toEqual([{ mode: 'json_object' }]);
  setFetch(fakeFetch({ '/chat/completions': () => json({ error: 'bad' }, 400) }));
  await expect(ask()).rejects.toMatchObject({ code: 'http', status: 400 }); // JSON mode rejected too: give up
});

it('a timeout while reading the body is an AiError timeout, not a raw TimeoutError', async () => {
  const stalled = new ReadableStream({ start: (c) => c.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError')) });
  setFetch(fakeFetch({ '/chat/completions': () => new Response(stalled, { status: 200 }) }));
  await expect(ask()).rejects.toMatchObject({ code: 'timeout' });
});

it('chatJson: pins the provider when asked and reports the served provider', async () => {
  const f = fakeFetch({ '/chat/completions': () => json({ provider: 'OpenAI', model: 'openai/gpt-x', choices: [{ message: { content: '{"band":6,"range":[5,6]}' } }] }) });
  setFetch(f);
  const served: unknown[] = [];
  await chatJson({ model: 'm/x', system: 's', user: 'u', schema, schemaName: 'x', provider: { order: ['openai'], allow_fallbacks: false, require_parameters: true }, onServed: (s) => served.push(s) });
  expect(f.calls[0]!.body.provider).toEqual({ order: ['openai'], allow_fallbacks: false, require_parameters: true });
  expect(served).toEqual([{ provider: 'OpenAI', model: 'openai/gpt-x', mode: 'json_schema' }]);
  await ask();
  expect(f.calls[1]!.body.provider).toBeUndefined();
});

it('chatJson: sends the reasoning effort when set', async () => {
  const f = fakeFetch({ '/chat/completions': () => chatReply({ band: 6, range: [5, 6] }) });
  setFetch(f);
  await chatJson({ model: 'm/x', system: 's', user: 'u', schema, schemaName: 'x', effort: 'low' });
  expect(f.calls[0]!.body.reasoning).toEqual({ effort: 'low' });
});

it('call: retries network errors and 5xx twice, then gives up with the generic message', async () => {
  let n = 0;
  setFetch(fakeFetch({ '/chat/completions': () => { if (++n <= 2) throw new TypeError('fetch failed'); return chatReply('{"band":6,"range":[5,6]}'); } }));
  expect(await ask()).toEqual({ band: 6, range: [5, 6] });
  expect(n).toBe(3);
  n = 0;
  setFetch(fakeFetch({ '/chat/completions': () => { n++; return json({ error: 'x' }, 503); } }));
  expect(((await ask().catch((x) => x)) as AiError).status).toBe(503);
  expect(n).toBe(3);
  n = 0;
  setFetch(fakeFetch({ '/chat/completions': () => { n++; throw new TypeError('fetch failed'); } }));
  expect(((await ask().catch((x) => x)) as AiError).code).toBe('network');
  expect(n).toBe(3);
});

it('transcribe: Scribe v2 through OpenRouter (verbatim words kept), Whisper fallback on error or quota', async () => {
  const words = [{ word: 'I', start: 0, end: 0.2, confidence: 0.9 }, { word: 'um,', start: 0.4, end: 0.7, confidence: 0.5 }, { word: 'the—', start: 1.2, end: 1.5 }, { word: 'sooo', start: 1.6, end: 2.4 }];
  const f = fakeFetch({ '/audio/transcriptions': () => json({ text: 'I um, the— sooo', duration: 2.4, words, usage: { seconds: 2.4, cost: 0.0001 } }) });
  setFetch(f);
  const r = await transcribe({ model: 'elevenlabs/scribe-v2', audio: new Uint8Array([1, 2]), format: 'webm', verbatim: true });
  expect(f.calls).toHaveLength(1); // one pass: Scribe is verbatim, no primed Whisper pass
  expect(f.calls[0]!.body).toMatchObject({ model: 'elevenlabs/scribe-v2', language: 'en', input_audio: { format: 'webm' } });
  expect(r).toMatchObject({ text: 'I um, the— sooo', verbatim: true, model: 'elevenlabs/scribe-v2', duration: 2.4 });
  expect(r.words.map((x) => x.w)).toEqual(['I', 'um,', 'the—', 'sooo']);
  expect(r.words[1]!.conf).toBe(0.5);

  // quota / outage: Whisper answers instead, and the result says so
  for (const scribeFail of [() => json({ error: { message: 'quota' } }, 402), () => { throw new TypeError('fetch failed'); }]) {
    const g = fakeFetch({ '/audio/transcriptions': (_u: string, init?: RequestInit) => (JSON.parse(String(init?.body)).model === 'elevenlabs/scribe-v2' ? scribeFail() : json({ text: 'hello there', duration: 1, words: [{ word: 'hello', start: 0, end: 0.4 }, { word: 'there', start: 0.5, end: 0.9 }] })) });
    setFetch(g);
    const fb = await transcribe({ model: 'elevenlabs/scribe-v2', audio: new Uint8Array([1]), format: 'webm' });
    expect(fb).toMatchObject({ text: 'hello there', model: 'openai/whisper-large-v3' });
  }
});
