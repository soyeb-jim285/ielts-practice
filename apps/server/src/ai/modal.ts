// Our own verbatim Whisper (whisper-small.en fine-tune, 4-layer decoder, 166M; project crisperwhisper_recreate) on a Modal T4 that
// scales to zero, for the admin transcription playground. Keeps [uh]/[um], repeats, cut-offs (th-) and [laughter]/[breath].
// Auth is a Modal proxy-auth token (MODAL_KEY / MODAL_SECRET). The endpoint decodes any format with ffmpeg, so webm/m4a go as-is.
import { env } from '../env';
import { logAi } from './ailog';
import { AiError, type SttModel } from './openrouter';

const MODELS: Record<string, string> = { 'modal/verbatim-student4': 'Verbatim Whisper student4 (ours, Modal T4)' };

export const isModal = (model: string) => model in MODELS;
export const modalModels = (): SttModel[] =>
  Object.entries(MODELS).map(([id, name]) => ({
    id,
    name,
    description: 'Our verbatim Whisper (166M): keeps fillers, repeats, cut-offs and sound tags. Own GPU on Modal; first call after ~2 idle minutes cold-starts (~15 s). Commercial licence.',
    usdPerSecond: null,
    usdPerMTokIn: null,
    usdPerMTokOut: null,
  }));

type ModalOut = { text: string; words: { word: string; start: number; end: number }[]; audio_seconds: number; realtime_factor: number };

export async function transcribeModal(o: { model: string; audio: Uint8Array; format: string }) {
  const t0 = Date.now();
  const request = { url: env.MODAL_ASR_URL, format: o.format, bytes: o.audio.length };
  const fail = (msg: string, status?: number, code: AiError['code'] = 'http'): never => {
    logAi({ stage: 'playground', path: 'modal/transcribe', model: o.model, ok: false, status, latencyMs: Date.now() - t0, request, error: msg });
    throw new AiError(code, msg, status);
  };
  if (!env.MODAL_KEY || !env.MODAL_SECRET) return fail('MODAL_KEY / MODAL_SECRET not set (Modal dashboard > Settings > Proxy Auth Tokens)');
  try {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from(o.audio)]), `clip.${o.format}`);
    form.append('word_timestamps', 'true');
    const r = await fetch(`${env.MODAL_ASR_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Modal-Key': env.MODAL_KEY, 'Modal-Secret': env.MODAL_SECRET },
      body: form,
      signal: AbortSignal.timeout(120_000), // a cold start (GPU boot + model load) takes ~15 s
    });
    if (!r.ok) return fail(`Modal error: ${(await r.text()).slice(0, 300)}`, r.status);
    const d = (await r.json()) as ModalOut;
    const latencyMs = Date.now() - t0;
    // ponytail: estimate = wall time x T4 hourly price; ignores the idle-warm minutes Modal also bills
    const costUsd = (latencyMs / 3_600_000) * env.MODAL_USD_PER_HOUR;
    logAi({ stage: 'playground', path: 'modal/transcribe', model: o.model, ok: true, latencyMs, costUsd, request, response: d });
    return {
      model: o.model,
      text: d.text,
      words: d.words.map((w) => ({ w: w.word, start: w.start, end: w.end })),
      duration: d.audio_seconds,
      latencyMs,
      costUsd,
      costExact: false,
      raw: d,
    };
  } catch (e) {
    if (e instanceof AiError) throw e;
    const timeout = (e as Error).name === 'TimeoutError';
    return fail(timeout ? 'Modal timed out' : (e as Error).message, undefined, timeout ? 'timeout' : 'network');
  }
}
