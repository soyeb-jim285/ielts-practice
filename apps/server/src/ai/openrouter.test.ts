import { expect, it } from 'vitest';
import { z } from 'zod';
import { chatReply, fakeFetch, json } from '../test/helpers';
import { AiError, chatJson, punctuate, setFetch, toStrictSchema, transcribe } from './openrouter';

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

it('transcribe: maps words, keeps only per-word confidence, restores punctuation, primes verbatim fillers', async () => {
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
  expect(r.words.map((w) => w.conf)).toEqual([0.9, undefined, 0.7, undefined, undefined, undefined]);
  expect(f.calls[0]!.body).toMatchObject({ input_audio: { data: 'AQID', format: 'webm' }, response_format: 'verbose_json', prompt: expect.stringContaining('uh') });
});

it('punctuate: re-syncs after a word the text spells differently', () => {
  const words = [{ w: 'I' }, { w: 'have' }, { w: 'twenty' }, { w: 'cats' }, { w: 'Really' }];
  punctuate(words, 'I have 20 cats. Really?');
  expect(words.map((w) => w.w)).toEqual(['I', 'have', 'twenty', 'cats.', 'Really?']);
});
