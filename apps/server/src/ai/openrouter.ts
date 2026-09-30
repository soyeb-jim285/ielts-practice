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
}

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
    console.error(`openrouter ${path} ${res.status}`, (await res.text().catch(() => '')).slice(0, 500));
    throw new AiError('http', res.status === 429 ? 'The AI service is rate-limited right now. Please retry in a minute.' : `The AI service returned an error (${res.status}). Please retry.`, res.status);
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
  timeoutMs?: number;
}): Promise<T> {
  const messages: ChatMessage[] = [
    { role: 'system', content: o.system },
    { role: 'user', content: o.user },
  ];
  const base = {
    model: o.model,
    temperature: o.temperature ?? 0.2,
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
      timestamp_granularities: ['word'],
    },
    120_000,
  );
  const d = (await res.json()) as SttResponse;
  // Only a real per-word probability counts as confidence: segment avg_logprob would flag whole accented segments as unclear.
  const words: SttWord[] = (d.words ?? [])
    .filter((w) => w.word.trim())
    .map((w) => ({ w: w.word.trim(), start: w.start, end: w.end, conf: w.confidence ?? w.probability }));
  if (d.text) punctuate(words, d.text);
  return { text: d.text ?? words.map((w) => w.w).join(' '), words, duration: d.duration ?? words.at(-1)?.end ?? 0 };
}

export async function speak(o: { model: string; voice: string; text: string }): Promise<{ audio: Uint8Array; contentType: string }> {
  const res = await call('/audio/speech', { model: o.model, input: o.text, voice: o.voice, response_format: 'mp3' });
  return { audio: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'audio/mpeg' };
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
  const models = data.map((m) => ({
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
