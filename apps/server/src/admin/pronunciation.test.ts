import { json, req, testUser } from '../test/helpers'; // first: loads the app before the modules that import it back
import { expect, it, vi } from 'vitest';
import { env } from '../env';
import { OWNER_EMAILS } from '../auth';

it('pronunciation playground: sends the clip and the read text to the Modal scorer with the proxy-auth token, returns its scores; owner only', async () => {
  const out = {
    mode: 'scripted', text: 'think', audioSeconds: 1.2, accuracy: 62.5, mispronouncedWords: 1,
    words: [{ word: 'think', score: 62.5, accent: 'gb', start: 0.1, end: 0.6, phones: [{ expected: 'θ', heard: 't', score: 0.2, ok: false }, { expected: 'ɪ', heard: 'ɪ', score: 1, ok: true }] }],
    fluency: { wordsPerMinute: null, phonesPerSecond: 8, pauses: 0, longPauses: 0, speakingSeconds: 0.5 },
    confusions: [{ expected: 'θ', heard: 't', count: 1 }], timing: { alignMs: 80, totalMs: 90 }, model: 'facebook/wav2vec2-xlsr-53-espeak-cv-ft',
  };
  const sent: { url: string; headers: Record<string, string>; form: FormData }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, form: init.body as FormData });
    return json(out);
  });
  const saved = { k: env.MODAL_KEY, s: env.MODAL_SECRET };
  try {
    const body = { audio: Buffer.from('webm-bytes').toString('base64'), format: 'webm', text: ' think ' };
    expect((await req('/api/admin/pronunciation/assess', { headers: (await testUser()).headers, body })).status).toBe(404);
    const { headers } = await testUser(OWNER_EMAILS[0]!);
    env.MODAL_KEY = env.MODAL_SECRET = undefined;
    const off = await req('/api/admin/pronunciation/assess', { headers, body });
    expect([off.status, ((await off.json()) as any).error]).toEqual([502, expect.stringContaining('MODAL_KEY')]);

    Object.assign(env, { MODAL_KEY: 'wk-1', MODAL_SECRET: 'ws-1' });
    const r = await req('/api/admin/pronunciation/assess', { headers, body });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ...out, costUsd: expect.any(Number), latencyMs: expect.any(Number) });
    expect(sent[0]!.url).toBe(`${env.MODAL_PRON_URL}/assess`);
    expect(sent[0]!.headers).toMatchObject({ 'Modal-Key': 'wk-1', 'Modal-Secret': 'ws-1' });
    expect(sent[0]!.form.get('text')).toBe('think');
  } finally {
    vi.unstubAllGlobals();
    Object.assign(env, { MODAL_KEY: saved.k, MODAL_SECRET: saved.s });
  }
});
