import { chatReply, fakeFetch, json, req, testUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { expect, it } from 'vitest';
import { flushAiLogs, sanitize } from '../ai/ailog';
import { keyCtx } from '../ai/keyctx';
import { chatText, setFetch, transcribe } from '../ai/openrouter';
import { OWNER_EMAILS } from '../auth';

it('sanitize: base64 payloads become a size note, long text is cut, everything else is kept', () => {
  const audio = 'A'.repeat(8000);
  expect(sanitize({ input_audio: { data: audio, format: 'webm' }, prompt: 'Um, uh.', n: 3, ok: true, x: null })).toEqual({ input_audio: { data: '[base64, 6 KB]', format: 'webm' }, prompt: 'Um, uh.', n: 3, ok: true, x: null });
  expect(String(sanitize('word '.repeat(50_000)))).toMatch(/… \[cut, 250000 chars\]$/);
});

it('AI logs: every OpenRouter call is logged with its request and response (audio stripped) and failures with the error; owner-only list and detail', async () => {
  const { user } = await testUser();
  setFetch(
    fakeFetch({
      '/chat/completions': () => chatReply('{"band": 7}'),
      '/audio/transcriptions': () => json({ text: 'Hello there.', words: [{ word: 'Hello', start: 0, end: 0.4 }], duration: 1 }),
    }),
  );
  await keyCtx.run({ cost: { userId: user.id, attemptId: 'att-log-1' } }, async () => {
    await chatText({ model: 'openai/gpt-6-luna', messages: [{ role: 'system', content: 'You are an examiner.' }, { role: 'user', content: 'Rate this.' }], cost: { stage: 'feedback' } });
    await transcribe({ model: 'openai/whisper-large-v3', audio: new Uint8Array(9000), format: 'webm' });
  });
  setFetch(fakeFetch({ '/chat/completions': () => new Response('{"error":{"message":"model not found"}}', { status: 404 }) }));
  await keyCtx.run({ cost: { userId: user.id, attemptId: 'att-log-1' } }, () => chatText({ model: 'acme/missing', messages: [{ role: 'user', content: 'u' }], cost: { stage: 'score' } }).catch(() => null));
  await flushAiLogs();

  expect((await req('/api/admin/logs', { headers: (await testUser()).headers })).status).toBe(404);
  const { headers } = await testUser(OWNER_EMAILS[0]!);
  const page = (await (await req('/api/admin/logs?attempt=att-log-1', { headers })).json()) as any;
  expect(page.items.map((i: any) => [i.stage, i.path, i.ok, i.status])).toEqual([
    ['score', '/chat/completions', false, 404],
    ['stt', '/audio/transcriptions', true, 200],
    ['feedback', '/chat/completions', true, 200],
  ]);
  expect(page.items[2].preview).toBe('{"band": 7}');
  expect(page.items[0].preview).toContain('model not found');
  expect(page.stages).toEqual(expect.arrayContaining(['feedback', 'score', 'stt']));
  expect((await (await req('/api/admin/logs?attempt=att-log-1&outcome=failed', { headers })).json() as any).total).toBe(1);

  const stt = (await (await req(`/api/admin/logs/${page.items[1].id}`, { headers })).json()) as any;
  expect(stt.request.input_audio.data).toBe('[base64, 9 KB]');
  expect(stt.response.text).toBe('Hello there.');
  const chat = (await (await req(`/api/admin/logs/${page.items[2].id}`, { headers })).json()) as any;
  expect(chat.request.messages).toEqual([{ role: 'system', content: 'You are an examiner.' }, { role: 'user', content: 'Rate this.' }]);
  expect(chat.userId).toBe(user.id);
});
