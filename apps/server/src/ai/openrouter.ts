import { z } from 'zod';
import type { Word } from '@ielts/core';
import { env } from '../env';

const BASE = 'https://openrouter.ai/api/v1';

export type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);
/** Test injection. Also clears the model-list cache. */
export function setFetch(f: Fetch) {
  fetcher = f;
  modelCache = undefined;
}

/** Error whose message is safe to show the user (stored on failed attempts). */
export class AiError extends Error {
  constructor(
    public code: 'http' | 'timeout' | 'network' | 'invalid_json',
    message: string,
    /** Upstream HTTP status when code is 'http'. */
    public status?: number,
  ) {
    super(message);
  }
  /** False when retrying now cannot help (credit, key or request problems): clients should say "try later" instead of offering Retry. */
  get retryable() {
    return this.code !== 'http' || this.status === 429 || (this.status ?? 500) >= 500;
  }
}

/** Candidate-facing copy per upstream status; only 429/5xx/timeouts say "retry". Operator detail goes to the server log. */
function httpMessage(status: number) {
  if (status === 429) return 'The AI service is rate-limited right now. Please retry in a minute.';
  if (status >= 500) return `The AI service returned an error (${status}). Please retry.`;
  if (status === 402 || status === 401 || status === 403) return 'The AI service is temporarily unavailable. Your work is saved, so try again later.';
  return `The AI service rejected the request (${status}). If this keeps happening, choose another model in Settings.`;
}
const OPERATOR_HINT: Record<number, string> = { 402: 'OpenRouter credits exhausted: add credits at openrouter.ai/settings/credits', 401: 'OpenRouter API key invalid', 403: 'OpenRouter API key forbidden' };

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'input_audio'; input_audio: { data: string; format: string } }
  | { type: 'image_url'; image_url: { url: string } };
export type SttWord = Word;

async function call(path: string, body: unknown, timeoutMs = 90_000, method = 'POST'): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetcher(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': env.BETTER_AUTH_URL,
          'X-Title': 'IELTS Practice',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if ((e as Error).name === 'TimeoutError') throw new AiError('timeout', 'The AI service took too long to respond. Please retry.');
      throw new AiError('network', 'Could not reach the AI service. Please retry.');
    }
    if (res.ok) return res;
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    console.error(`openrouter ${path} ${res.status}`, OPERATOR_HINT[res.status] ?? '', (await res.text().catch(() => '')).slice(0, 500));
    throw new AiError('http', httpMessage(res.status), res.status);
  }
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

async function chat(body: Record<string, unknown>, timeoutMs?: number): Promise<string> {
  const data = (await (await call('/chat/completions', body, timeoutMs)).json()) as { choices?: { message?: { content?: string | null } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

/** Parses model output that may be fenced or wrapped in prose. */
function parseJson(s: string): unknown {
  const t = s.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  try {
    return JSON.parse(t);
  } catch {
    return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  }
}

/** JSON Schema for OpenRouter strict json_schema mode (tuples → plain arrays; zod already emits required + additionalProperties:false). */
export function toStrictSchema(schema: z.ZodType) {
  const { $schema: _, ...js } = z.toJSONSchema(schema, {
    override: ({ jsonSchema: s }) => {
      if (Array.isArray(s.prefixItems)) {
        s.items = s.prefixItems[0];
        delete s.prefixItems;
      }
    },
  });
  return js;
}

export async function chatJson<T>(o: {
  model: string;
  system: string;
  user: string | ContentPart[];
  schema: z.ZodType<T>;
  schemaName: string;
  temperature?: number;
  /** OpenRouter unified reasoning effort; ignored by non-reasoning models. Unset = provider default (medium). */
  effort?: 'low' | 'medium' | 'high';
  timeoutMs?: number;
}): Promise<T> {
  const messages: ChatMessage[] = [
    { role: 'system', content: o.system },
    { role: 'user', content: o.user },
  ];
  const base = {
    model: o.model,
    temperature: o.temperature ?? 0.2,
    ...(o.effort && { reasoning: { effort: o.effort } }),
    response_format: { type: 'json_schema', json_schema: { name: o.schemaName, strict: true, schema: toStrictSchema(o.schema) } },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chat({ ...base, messages }, o.timeoutMs);
    let issues: string;
    try {
      const r = o.schema.safeParse(parseJson(content));
      if (r.success) return r.data;
      issues = r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    } catch {
      issues = 'response is not valid JSON';
    }
    messages.push(
      { role: 'assistant', content },
      { role: 'user', content: `Your JSON failed validation: ${issues}. Return corrected JSON only.` },
    );
  }
  throw new AiError('invalid_json', 'The AI returned an unreadable analysis. Please retry.');
}

export async function chatText(o: {
  model: string;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  return chat({ model: o.model, messages: o.messages, temperature: o.temperature ?? 0.7, max_tokens: o.maxTokens });
}

type SttResponse = {
  text?: string;
  duration?: number;
  words?: { word: string; start: number; end: number; confidence?: number; probability?: number }[];
  segments?: { start: number; end: number; avg_logprob?: number }[];
};

// Standard Whisper disfluency-priming prompt: keeps um/uh in the transcript instead of cleaning them out (research.md §3).
const VERBATIM_PROMPT = 'Umm, let me think, uh... well, like, you know, I mean, hmm.';
const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, '');

/** Word timestamps come without punctuation; copy trailing punctuation back from the full text so clause boundaries survive. */
export function punctuate(words: { w: string }[], text: string) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let at = 0;
  for (const w of words) {
    if (/[.!?,;:]$/.test(w.w)) continue;
    // ponytail: 4-token lookahead re-syncs after ASR text/word mismatches (numbers, hyphens); a longer drift just loses punctuation.
    for (let k = at; k < Math.min(at + 4, tokens.length); k++) {
      if (bare(tokens[k]!) !== bare(w.w)) continue;
      w.w += tokens[k]!.match(/[.!?,;:]+$/)?.[0] ?? '';
      at = k + 1;
      break;
    }
  }
}

export async function transcribe(o: { model: string; audio: Uint8Array; format: 'webm' | 'm4a' | 'wav' | 'mp3' | 'ogg' }): Promise<{ text: string; words: SttWord[]; duration: number }> {
  const res = await call(
    '/audio/transcriptions',
    {
      model: o.model,
      input_audio: { data: Buffer.from(o.audio).toString('base64'), format: o.format },
      language: 'en',
      prompt: VERBATIM_PROMPT,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    },
    120_000,
  );
  const d = (await res.json()) as SttResponse;
  // Whisper via OpenRouter gives no per-word probability; fall back to the word's segment mean token probability.
  // ponytail: segment-level, so a poorly recognised segment flags all its words; the audio pronunciation pass is the precise signal.
  const segConf = (t: number) => {
    const lp = d.segments?.find((s) => t >= s.start && t < s.end)?.avg_logprob;
    return lp == null ? undefined : Math.round(Math.exp(lp) * 100) / 100;
  };
  const words: SttWord[] = (d.words ?? [])
    .filter((w) => w.word.trim())
    .map((w) => ({ w: w.word.trim(), start: w.start, end: w.end, conf: w.confidence ?? w.probability ?? segConf(w.start) }));
  if (d.text) punctuate(words, d.text);
  return { text: d.text ?? words.map((w) => w.w).join(' '), words, duration: d.duration ?? words.at(-1)?.end ?? 0 };
}

/** 44-byte RIFF header around raw s16le PCM so browsers and AVPlayer can play it. */
export function pcmToWav(pcm: Uint8Array, rate = 24000, channels = 1) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return new Uint8Array(Buffer.concat([h, pcm]));
}

/** Gemini TTS only returns raw PCM ("only supports response_format=pcm"); every other speech model gets mp3. */
const pcmOnly = (model: string) => /^google\/.*tts/.test(model);

/** Returns mp3 (audio/mpeg) or, for PCM-only models, WAV (audio/wav). */
export async function speak(o: { model: string; voice: string; text: string }): Promise<{ audio: Uint8Array; contentType: 'audio/mpeg' | 'audio/wav' }> {
  const pcm = pcmOnly(o.model);
  const res = await call('/audio/speech', { model: o.model, input: o.text, voice: o.voice, response_format: pcm ? 'pcm' : 'mp3' });
  const audio = new Uint8Array(await res.arrayBuffer());
  if (!pcm) return { audio, contentType: 'audio/mpeg' };
  // content-type is e.g. "audio/pcm;rate=24000;channels=1"
  const param = (k: string, d: number) => Number(res.headers.get('content-type')?.match(new RegExp(`${k}=(\\d+)`))?.[1] ?? d);
  return { audio: pcmToWav(audio, param('rate', 24000), param('channels', 1)), contentType: 'audio/wav' };
}

export type ModelInfo = { id: string; name: string; input: string[]; output: string[]; pricing: { prompt: string; completion: string }; voices: string[] };
let modelCache: { at: number; models: ModelInfo[] } | undefined;

/** OpenRouter model catalogue, cached for 1 h. */
export async function listModels(): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.at < 3_600_000) return modelCache.models;
  const res = await call('/models?output_modalities=all', undefined, 30_000, 'GET');
  const { data } = (await res.json()) as {
    data: { id: string; name?: string; architecture?: { input_modalities?: string[]; output_modalities?: string[] }; pricing?: { prompt?: string; completion?: string }; supported_voices?: string[] | null }[];
  };
  // Routers/meta models report price -1 (variable): unusable in the picker.
  const models = data.filter((m) => !(Number(m.pricing?.prompt) < 0 || Number(m.pricing?.completion) < 0)).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    input: m.architecture?.input_modalities ?? ['text'],
    output: m.architecture?.output_modalities ?? ['text'],
    pricing: { prompt: m.pricing?.prompt ?? '0', completion: m.pricing?.completion ?? '0' },
    voices: m.supported_voices ?? [],
  }));
  modelCache = { at: Date.now(), models };
  return models;
}

/** Whether a model accepts image input. Unknown model or catalogue down: assume yes and let the call fail loudly. */
export const acceptsImages = (model: string) =>
  listModels().then((ms) => ms.find((m) => m.id === model)?.input.includes('image') ?? true, () => true);
