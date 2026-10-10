// CrisperWhisper 2.0 (verbatim Whisper: fillers as [UM]/[UH], repeats, cut-offs) for the admin transcription playground. No inference provider hosts it,
// so this calls public Hugging Face Spaces through Gradio's HTTP API: free, ZeroGPU quota (more with HF_TOKEN), WAV only (the Space can't decode webm).
// Weights are non-commercial: playground only, never the app's stt.
import { env } from '../env';
import { logAi } from './ailog';
import { AiError, type SttModel } from './openrouter';

const SPACES: Record<string, { host: string; name: string }> = {
  'hf/crisperwhisper-2-turbo': { host: 'https://hugging-apps-crisper-whisper-2-turbo.hf.space', name: 'CrisperWhisper 2.0 turbo (HF Space)' },
  'hf/crisperwhisper-2-small': { host: 'https://hugging-apps-crisperwhisper2-small-demo.hf.space', name: 'CrisperWhisper 2.0 small (HF Space)' },
};
const LANGS = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'zh', 'ru', 'ar', 'hi', 'ko']); // the Space's dropdown; no auto-detect

export const isHfSpace = (model: string) => model in SPACES;
export const hfModels = (): SttModel[] =>
  Object.entries(SPACES).map(([id, s]) => ({ id, name: s.name, description: 'Verbatim Whisper fine-tune by Nyra Labs on a free public Hugging Face Space (ZeroGPU, WAV in). Non-commercial licence.', usdPerSecond: 0, usdPerMTokIn: null, usdPerMTokOut: null }));

/** "  20.66 →   21.36  it" lines of the Space's word-timestamp box. */
export function parseWordLines(s: string) {
  return s
    .split('\n')
    .map((l) => l.match(/^\s*([\d.]+)\s*→\s*([\d.]+)\s+(.+?)\s*$/))
    .filter((m) => !!m)
    .map((m) => ({ w: m[3]!, start: Number(m[1]), end: Number(m[2]) }));
}

export async function transcribeHfSpace(o: { model: string; audio: Uint8Array; language?: string | null }) {
  const space = SPACES[o.model]!, t0 = Date.now();
  const auth: Record<string, string> = env.HF_TOKEN ? { Authorization: `Bearer ${env.HF_TOKEN}` } : {};
  const request = { space: space.host, endpoint: '/transcribe', language: o.language && LANGS.has(o.language) ? o.language : 'en', mode: 'verbatim', bytes: o.audio.length };
  const fail = (msg: string, status?: number, code: AiError['code'] = 'http'): never => {
    logAi({ stage: 'playground', path: 'hf-space/transcribe', model: o.model, ok: false, status, latencyMs: Date.now() - t0, request, error: msg });
    throw new AiError(code, msg, status);
  };
  const signal = AbortSignal.timeout(180_000); // the ZeroGPU queue can wait for a GPU
  try {
    const form = new FormData();
    form.append('files', new Blob([Buffer.from(o.audio)], { type: 'audio/wav' }), 'clip.wav');
    const up = await fetch(`${space.host}/gradio_api/upload`, { method: 'POST', body: form, headers: auth, signal });
    if (!up.ok) return fail('Space upload failed', up.status);
    const [path] = (await up.json()) as string[];
    const call = await fetch(`${space.host}/gradio_api/call/transcribe`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [{ path, meta: { _type: 'gradio.FileData' } }, request.language, 'verbatim', true, ''] }),
      signal,
    });
    if (!call.ok) return fail('Space call failed', call.status);
    const { event_id } = (await call.json()) as { event_id: string };
    // Server-sent events; the last "event: complete" (or "error") carries the result.
    const sse = await (await fetch(`${space.host}/gradio_api/call/transcribe/${event_id}`, { headers: auth, signal })).text();
    const last = [...sse.matchAll(/event: (\w+)\ndata: (.*)/g)].at(-1);
    if (last?.[1] !== 'complete') return fail(`Space error: ${last?.[2] ?? sse.slice(0, 300)}`);
    const [text, wordLines, info] = JSON.parse(last[2]!) as [string, string, string];
    const words = parseWordLines(wordLines);
    const duration = Number(info.match(/Duration: ([\d.]+)s/)?.[1] ?? words.at(-1)?.end ?? 0);
    const latencyMs = Date.now() - t0;
    logAi({ stage: 'playground', path: 'hf-space/transcribe', model: o.model, ok: true, latencyMs, costUsd: 0, request, response: { text, words: wordLines, info } });
    return { model: o.model, text, words, duration, latencyMs, costUsd: 0, costExact: true, raw: { text, words: wordLines, info } };
  } catch (e) {
    if (e instanceof AiError) throw e;
    const timeout = (e as Error).name === 'TimeoutError';
    return fail(timeout ? 'Space timed out (GPU queue)' : (e as Error).message, undefined, timeout ? 'timeout' : 'network');
  }
}
