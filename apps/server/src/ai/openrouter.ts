import { z } from 'zod';
import type { Word } from '@ielts/core';
import { env, IS_TEST } from '../env';
import { recordCost, scribeUsd, usageCost, whisperUsd } from './cost';
import { keyCtx, redact } from './keyctx';

const BASE = 'https://openrouter.ai/api/v1';

export type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);
/** Test injection. Also clears the model-list cache. */
export function setFetch(f: Fetch) {
  fetcher = f;
  modelCache = undefined;
}
/** The injectable fetch for the small non-AI calls (key validation, the community balance) so tests can mock them. */
export const httpFetch: Fetch = (...a) => fetcher(...a);

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
function httpMessage(status: number, own = false) {
  if (own && status === 402) return 'Your OpenRouter key is out of credit. Add credit to it, or remove it in Settings to use the community balance.';
  if (own && (status === 401 || status === 403)) return 'Your OpenRouter key was rejected. Check it in Settings.';
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

const RETRIES = 2;
/** Jittered exponential backoff: ~1 s, ~2 s (instant under vitest). */
const backoff = (n: number) => new Promise((r) => setTimeout(r, IS_TEST ? 1 : 1000 * 2 ** n * (0.5 + Math.random())));

/** Retries network errors, 429 and 5xx twice with jittered backoff; timeouts are not retried (they already waited minutes). */
async function call(path: string, body: unknown, timeoutMs = 90_000, method = 'POST'): Promise<Response> {
  const ctx = keyCtx.getStore();
  const apiKey = ctx?.openrouter ?? env.OPENROUTER_API_KEY; // the user's own key when they have one: their credit, not the community's
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetcher(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': env.BETTER_AUTH_URL,
          'X-Title': 'IELTS Practice',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // The body is read under the same timeout, so a stall mid-body must also become an AiError, not a raw TimeoutError.
      if (res.ok) res = new Response(await res.arrayBuffer(), res);
    } catch (e) {
      if ((e as Error).name === 'TimeoutError') throw new AiError('timeout', 'The AI service took too long to respond. Please retry.');
      const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
      console.error(`openrouter ${path} fetch failed (attempt ${attempt + 1}/${RETRIES + 1}):`, (e as Error).message, cause?.code ?? cause?.message ?? '');
      if (attempt < RETRIES) {
        await backoff(attempt);
        continue;
      }
      throw new AiError('network', 'Could not reach the AI service. Please retry.');
    }
    if (res.ok) return res;
    if (attempt < RETRIES && (res.status === 429 || res.status >= 500)) {
      await backoff(attempt);
      continue;
    }
    console.error(`openrouter ${path} ${res.status}`, ctx?.openrouter ? 'own key' : OPERATOR_HINT[res.status] ?? '', redact((await res.text().catch(() => '')).slice(0, 500), apiKey));
    if (ctx?.openrouter && (res.status === 401 || res.status === 403)) ctx.onAuthFail?.();
    throw new AiError('http', httpMessage(res.status, !!ctx?.openrouter), res.status);
  }
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

/** Served model and provider of a chat call (OpenRouter reports which provider answered), and chatJson's output mode. */
export type Served = { provider?: string; model?: string; mode?: 'json_schema' | 'json_object' };

/** What the cost ledger needs to know about one call (ai/cost.ts): the pipeline stage, whether it re-asks a failed generation, and free-form meta. */
export type CostTag = { stage?: string; retry?: boolean; meta?: Record<string, unknown> };

/** A failed call is recorded too (zero cost, ok=false): it shows failure waste, and a timeout may have been billed without us seeing it. */
const recordFailure = (e: unknown, o: { stage: string; model: string; retry?: boolean; meta?: Record<string, unknown> }) =>
  recordCost({ stage: o.stage, provider: 'openrouter', model: o.model, costUsd: 0, ok: false, retry: o.retry, meta: { ...o.meta, ...(e instanceof AiError && { code: e.code, status: e.status, timeout: e.code === 'timeout' || undefined }) } });

async function chat(body: Record<string, unknown>, timeoutMs?: number, onServed?: (s: Served) => void, tag: CostTag = {}): Promise<string> {
  const stage = tag.stage ?? 'other', model = String(body.model);
  let data: Served & { id?: string; usage?: unknown; choices?: { message?: { content?: string | null } }[] };
  try {
    data = (await (await call('/chat/completions', { ...body, usage: { include: true } }, timeoutMs)).json()) as typeof data;
  } catch (e) {
    recordFailure(e, { stage, model, retry: tag.retry, meta: tag.meta });
    throw e;
  }
  const u = usageCost(data.usage);
  recordCost({
    stage, provider: 'openrouter', model: data.model ?? model, costUsd: u.costUsd, retry: tag.retry, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
    meta: { ...tag.meta, generationId: data.id, served: data.provider, ...(!u.exact && { estimated: true }) },
  });
  onServed?.({ provider: data.provider, model: data.model });
  return data.choices?.[0]?.message?.content ?? '';
}

/** OpenRouter provider routing: pin with { order: [slug], allow_fallbacks: false }; require_parameters refuses providers that would ignore the json_schema. */
export type ProviderPrefs = { order?: string[]; only?: string[]; allow_fallbacks?: boolean; require_parameters?: boolean; data_collection?: 'allow' | 'deny' };

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
  provider?: ProviderPrefs;
  /** Called with the served provider/model of each attempt (calibration records key on it). */
  onServed?: (s: Served) => void;
  /** Cost ledger: pipeline stage and extra meta (criterion, sample, extra) of this call. */
  cost?: CostTag;
}): Promise<T> {
  const schema = toStrictSchema(o.schema);
  const messages: ChatMessage[] = [
    { role: 'system', content: o.system },
    { role: 'user', content: o.user },
  ];
  const base = {
    model: o.model,
    temperature: o.temperature ?? 0.2,
    ...(o.effort && { reasoning: { effort: o.effort } }),
    ...(o.provider && { provider: o.provider }),
  };
  let mode: Served['mode'] = 'json_schema';
  for (let attempt = 0; attempt < 2; attempt++) {
    const response_format = mode === 'json_schema' ? { type: 'json_schema', json_schema: { name: o.schemaName, strict: true, schema } } : { type: 'json_object' };
    let content: string;
    try {
      content = await chat({ ...base, response_format, messages }, o.timeoutMs, (s) => o.onServed?.({ ...s, mode }), { ...o.cost, retry: o.cost?.retry || attempt > 0 || undefined });
    } catch (e) {
      // Some providers reject a strict schema they cannot compile (Gemini 3.8 Flash: 400 "invalid argument" on the errors enum array):
      // fall back to JSON mode with the schema, in field order, in the prompt; zod still validates (scoring-research §2.3).
      if (!(e instanceof AiError && e.status === 400 && mode === 'json_schema')) throw e;
      mode = 'json_object';
      messages[0] = { role: 'system', content: `${o.system}\n\nReturn one JSON object that matches this JSON Schema, with its fields in the order listed:\n${JSON.stringify(schema)}` };
      attempt--;
      continue;
    }
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
  /** Reasoning effort for reasoning models: a one-line examiner turn does not need the default (medium) thinking time. */
  effort?: 'low' | 'medium' | 'high';
  cost?: CostTag;
}): Promise<string> {
  return chat({ model: o.model, messages: o.messages, temperature: o.temperature ?? 0.7, max_tokens: o.maxTokens, ...(o.effort && { reasoning: { effort: o.effort } }) }, undefined, undefined, { stage: 'examiner_llm', ...o.cost });
}

/** TypeSafe Jev (System One): typed decisions with probabilities, not text. ~$0.00002 a call. */
export const DECISION_MODEL = 'typesafe/jev-1.13';

export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string };
/** One Jev answer: `choice` labels, `score` expected step (0-based, continuous) with per-step probabilities, `noul` a yes-probability. */
export type JevAnswer = { choice?: string; score?: number; noul?: number; confidence?: number; probabilities?: Record<string, number> };

/** One Jev call with any set of named questions. Every question must come back answered, or it throws AiError. */
export async function decide<K extends string>(o: { state: unknown; questions: Record<K, JevQuestion>; timeoutMs?: number; cost?: CostTag }): Promise<Record<K, JevAnswer>> {
  const stage = o.cost?.stage ?? 'other';
  type Res = { id?: string; model?: string; provider?: string; answers?: Record<string, JevAnswer>; usage?: { input_tokens?: number; output_tokens?: number; cost?: number } };
  let d: Res;
  try {
    d = (await (await call('/systemone', { model: DECISION_MODEL, state: o.state, questions: o.questions }, o.timeoutMs ?? 10_000)).json()) as Res;
  } catch (e) {
    recordFailure(e, { stage, model: DECISION_MODEL, meta: o.cost?.meta });
    throw e;
  }
  recordCost({ stage, provider: 'openrouter', model: d.model ?? DECISION_MODEL, costUsd: d.usage?.cost ?? 0, inputTokens: d.usage?.input_tokens, outputTokens: d.usage?.output_tokens, meta: { ...o.cost?.meta, generationId: d.id, served: d.provider, ...(d.usage?.cost === undefined && { estimated: true }) } });
  const ok = (q: JevQuestion, a?: JevAnswer) =>
    !!a && (q.type === 'choice' ? !!a.choice && Object.hasOwn(q.criteria, a.choice) : q.type === 'score' ? Number.isFinite(a.score) && a.score! >= 0 && a.score! <= q.criteria.length - 1 : Number.isFinite(a.noul));
  for (const [k, q] of Object.entries(o.questions) as [string, JevQuestion][]) if (!ok(q, d.answers?.[k])) throw new AiError('invalid_json', 'The decision model returned no usable answer.');
  return d.answers as Record<K, JevAnswer>;
}

/** One Jev `choice` question: the label of `criteria` that best fits `state`, with its confidence. Throws AiError on failure or an unknown label. */
export async function decideChoice(o: { state: unknown; instructions: string; criteria: Record<string, string>; timeoutMs?: number; cost?: CostTag }): Promise<{ choice: string; confidence: number }> {
  const { q } = await decide({ state: o.state, questions: { q: { type: 'choice', instructions: o.instructions, criteria: o.criteria } }, timeoutMs: o.timeoutMs, cost: o.cost });
  return { choice: q.choice!, confidence: q.confidence ?? 0 };
}

type SttResponse = {
  text?: string;
  duration?: number;
  words?: { word: string; start: number; end: number; confidence?: number; probability?: number }[];
  segments?: { start: number; end: number; avg_logprob?: number }[];
  id?: string;
  usage?: unknown;
};

// Whisper disfluency-priming prompt (research.md §3): Whisper imitates its style, so disfluent, ungrammatical text keeps um/uh and the speaker's own word forms instead of repairing them.
// OpenRouter ignores a top-level `prompt` on transcriptions and applies no routing to them: only provider.options[<serving slug>] is forwarded, so the prompt goes to every Whisper host.
const VERBATIM_PROMPT = 'Umm, let me think, uh... he go... he go there. Uh, she have, um, two book. Hmm, I mean, like, you know.';
const VERBATIM_PROVIDER = { options: Object.fromEntries(['groq', 'together', 'deepinfra', 'deepinfra/us'].map((slug) => [slug, { prompt: VERBATIM_PROMPT }])) };
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

const FILLER = /^(u+m+|u+h+|e+r+m*|a+h+|h+m+|m+)$/;
const grams = (t: string[], n: number) => t.slice(0, Math.max(0, t.length - n + 1)).map((_, i) => t.slice(i, i + n).join(' '));
const PROMPT_5GRAMS = new Set(grams(VERBATIM_PROMPT.split(/\s+/).map(bare), 5));

/** Prompted Whisper sometimes loops, echoes the prompt or drops a stretch of speech (1 of 6 TTS clips, reproducibly, in .eval/4/speaking).
 *  The verbatim transcript is kept only when its non-filler word count is close to the unprompted one, no 2-6 word phrase repeats 3+ times
 *  in a row (a single word 4+ times) and no 5 words of the prompt appear. */
export function verbatimSane(verbatim: string[], plain: string[]) {
  const v = verbatim.map(bare).filter(Boolean), content = (t: string[]) => t.filter((w) => !FILLER.test(w)).length;
  const ratio = content(v) / Math.max(1, content(plain.map(bare).filter(Boolean)));
  if (ratio < 0.85 || ratio > 1.3) return false;
  const loops = (n: number, times: number) => v.some((_, i) => i + n * times <= v.length && Array.from({ length: times }, (_, k) => v.slice(i + k * n, i + k * n + n).join(' ')).every((g, _k, all) => g === all[0]));
  if (loops(1, 4) || [2, 3, 4, 5, 6].some((n) => loops(n, 3))) return false;
  return !grams(v, 5).some((g) => PROMPT_5GRAMS.has(g));
}

type Format = 'webm' | 'm4a' | 'wav' | 'mp3' | 'ogg';
async function stt(o: { model: string; audio: Uint8Array; format: Format }, stage: string, extra?: object) {
  const res = await call(
    '/audio/transcriptions',
    {
      model: o.model,
      input_audio: { data: Buffer.from(o.audio).toString('base64'), format: o.format },
      language: 'en',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      ...extra,
    },
    120_000,
  ).catch((e) => (recordFailure(e, { stage, model: o.model }), Promise.reject(e)));
  return (await res.json()) as SttResponse;
}

/** Success row of a Whisper pass. OpenRouter's STT response is not known to carry `usage.cost` (docs section 2): without it the price is audio seconds x a documented rate, flagged estimated. */
function recordStt(d: SttResponse, model: string, stage: string, meta: Record<string, unknown> = {}) {
  const u = usageCost(d.usage), seconds = d.duration ?? d.words?.at(-1)?.end ?? 0;
  recordCost({ stage, provider: 'openrouter', model, costUsd: u.exact ? u.costUsd : whisperUsd(seconds), audioSeconds: seconds, meta: { ...meta, generationId: d.id, ...(!u.exact && { estimated: true }) } });
}

export const SCRIBE_MODEL = 'elevenlabs/scribe_v2';
const WHISPER_FALLBACK = 'openai/whisper-large-v3';
const SCRIBE_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const SCRIBE_MIME: Record<Format, string> = { webm: 'audio/webm', m4a: 'audio/mp4', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg' };
/** A single character held this long (s) marks a prolonged sound (fluent TTS clips reach 0.4 s on stressed vowels; 0.6 s is conservative, unvalidated on real speech). */
const HELD_CHAR_S = 0.6;

type ScribeResponse = {
  words?: { text: string; start?: number; end?: number; type: 'word' | 'spacing' | 'audio_event'; logprob?: number; characters?: { text: string; start: number; end: number }[] }[];
};

/** ElevenLabs Scribe v2 (spec §5.2): verbatim (fillers and false starts kept), character timestamps, audio events tagged then dropped.
 *  Throws on any failure; transcribe() falls back to Whisper. */
async function scribe(o: { audio: Uint8Array; format: Format }) {
  const form = new FormData();
  form.set('model_id', 'scribe_v2');
  form.set('language_code', 'en');
  form.set('no_verbatim', 'false');
  form.set('timestamps_granularity', 'character');
  form.set('tag_audio_events', 'true');
  form.set('file', new Blob([Buffer.from(o.audio)], { type: SCRIBE_MIME[o.format] }), `audio.${o.format}`);
  let d: ScribeResponse;
  try {
    const res = await fetcher(SCRIBE_URL, { method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY! }, body: form, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`scribe ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
    d = (await res.json()) as ScribeResponse;
  } catch (e) {
    recordCost({ stage: 'stt', provider: 'elevenlabs', model: SCRIBE_MODEL, costUsd: 0, ok: false, paidBy: 'house', meta: { error: (e as Error).message.slice(0, 80) } });
    throw e;
  }
  // "…" and cut-offs ("th-", "I went to the—") stay in the word text: core's rule tagger and the text tagger read them as false starts / partials.
  const words: SttWord[] = (d.words ?? [])
    .filter((w) => w.type === 'word' && w.text.trim() && w.start != null && w.end != null)
    .map((w) => ({
      w: w.text.trim(), start: w.start!, end: w.end!,
      conf: w.logprob == null ? undefined : Math.round(Math.exp(w.logprob) * 100) / 100,
      ...(w.characters?.some((c) => c.end - c.start >= HELD_CHAR_S) && w.text.length > 1 && { prolonged: true }),
    }));
  const duration = words.at(-1)?.end ?? 0;
  // Scribe returns no price: audio seconds x ELEVENLABS_SCRIBE_USD_PER_HOUR, reconciled by the character_count drift on the Costs page.
  recordCost({ stage: 'stt', provider: 'elevenlabs', model: SCRIBE_MODEL, costUsd: scribeUsd(duration), audioSeconds: duration, paidBy: 'house', meta: { estimated: true } });
  return { text: words.map((w) => w.w).join(' '), words, duration, verbatim: true, model: SCRIBE_MODEL };
}

/** `verbatim`: for Whisper models, also runs a disfluency-primed pass (in parallel) and keeps it when verbatimSane; `verbatim` in the result says which was used.
 *  model `elevenlabs/scribe_v2` uses ElevenLabs when ELEVENLABS_API_KEY is set and falls back to Whisper on any error or quota; `model` in the result is the one that answered. */
export async function transcribe(o: { model: string; audio: Uint8Array; format: Format; verbatim?: boolean }, fallbackFrom?: string): Promise<{ text: string; words: SttWord[]; duration: number; verbatim: boolean; model: string }> {
  if (o.model === SCRIBE_MODEL) {
    // ElevenLabs credit is the owner's: users with their own OpenRouter key transcribe with Whisper on their key instead.
    if (env.ELEVENLABS_API_KEY && !keyCtx.getStore()?.openrouter)
      try {
        return await scribe(o);
      } catch (e) {
        console.error('ElevenLabs Scribe failed, falling back to Whisper:', (e as Error).message);
      }
    return transcribe({ ...o, model: WHISPER_FALLBACK }, o.model);
  }
  const primed = o.verbatim && /whisper/.test(o.model);
  // allSettled: a billed primed pass is recorded even when the plain pass fails
  const [plainR, vR] = await Promise.allSettled([stt(o, 'stt'), primed ? stt(o, 'stt_verbatim', { provider: VERBATIM_PROVIDER }) : Promise.resolve(undefined)]);
  const v = vR.status === 'fulfilled' ? vR.value : undefined;
  if (plainR.status === 'rejected') {
    if (v) recordStt(v, o.model, 'stt_verbatim', { kept: false });
    throw plainR.reason;
  }
  const plain = plainR.value!;
  const toks = (d: SttResponse) => (d.words ?? []).map((w) => w.word);
  const verbatim = !!v && verbatimSane(toks(v), toks(plain));
  const d = verbatim ? v! : plain;
  recordStt(plain, o.model, 'stt', fallbackFrom ? { fallbackFrom } : {});
  if (v) recordStt(v, o.model, 'stt_verbatim', { kept: verbatim }); // the primed pass is a second full charge; kept=false is pure waste
  // Whisper via OpenRouter gives no per-word probability; fall back to the word's segment mean token probability.
  // Segment-level confidence can flag several words together; it is not proof of a pronunciation error.
  const segConf = (t: number) => {
    const lp = d.segments?.find((s) => t >= s.start && t < s.end)?.avg_logprob;
    return lp == null ? undefined : Math.round(Math.exp(lp) * 100) / 100;
  };
  const words: SttWord[] = (d.words ?? [])
    .filter((w) => w.word.trim())
    .map((w) => ({ w: w.word.trim(), start: w.start, end: w.end, conf: w.confidence ?? w.probability ?? segConf(w.start) }));
  if (d.text) punctuate(words, d.text);
  return { text: d.text ?? words.map((w) => w.w).join(' '), words, duration: d.duration ?? words.at(-1)?.end ?? 0, verbatim, model: o.model };
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

type Speech = { audio: Uint8Array; contentType: 'audio/mpeg' | 'audio/wav' };

async function speakOnce(o: { model: string; voice: string; text: string }): Promise<Speech> {
  const pcm = pcmOnly(o.model);
  const res = await call('/audio/speech', { model: o.model, input: o.text, voice: o.voice, response_format: pcm ? 'pcm' : 'mp3' }).catch((e) => {
    recordFailure(e, { stage: 'examiner_tts', model: o.model, meta: { characters: o.text.length } });
    throw e;
  });
  // The response is raw audio: no usage block. Price = characters x the catalogue's per-token rate when the catalogue is cached, else 0; always flagged estimated.
  const rate = Number(modelCache?.models.find((m) => m.id === o.model)?.pricing.prompt);
  recordCost({ stage: 'examiner_tts', provider: 'openrouter', model: o.model, costUsd: Number.isFinite(rate) ? o.text.length * rate : 0, characters: o.text.length, meta: { estimated: true, generationId: res.headers.get('x-generation-id') ?? undefined } });
  const audio = new Uint8Array(await res.arrayBuffer());
  if (!pcm) return { audio, contentType: 'audio/mpeg' };
  // content-type is e.g. "audio/pcm;rate=24000;channels=1"
  const param = (k: string, d: number) => Number(res.headers.get('content-type')?.match(new RegExp(`${k}=(\\d+)`))?.[1] ?? d);
  return { audio: pcmToWav(audio, param('rate', 24000), param('channels', 1)), contentType: 'audio/wav' };
}

/** Sentence groups of a long line (at most 3, about 80+ characters each) so that they can be synthesised in parallel: TTS time grows with text length. */
export function speechChunks(text: string, per = 80, max = 3): string[] {
  const sentences = text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)?.map((x) => x.trim()).filter(Boolean) ?? [text];
  const n = Math.min(max, sentences.length, Math.floor(text.length / per));
  if (n < 2) return [text];
  const goal = text.length / n, out: string[] = [];
  let cur = '';
  for (const x of sentences) {
    if (cur.length >= goal && out.length < n - 1) (out.push(cur), (cur = ''));
    cur = cur ? `${cur} ${x}` : x;
  }
  return [...out, cur];
}

/** Joins chunks of one line: mp3 frames concatenate; WAV chunks share a rate, so their PCM is re-wrapped in one header. */
function joinSpeech(parts: Speech[]): Speech {
  if (parts.length === 1) return parts[0]!;
  if (parts[0]!.contentType === 'audio/mpeg') return { audio: new Uint8Array(Buffer.concat(parts.map((p) => p.audio))), contentType: 'audio/mpeg' };
  const rate = Buffer.from(parts[0]!.audio).readUInt32LE(24), channels = Buffer.from(parts[0]!.audio).readUInt16LE(22);
  return { audio: pcmToWav(new Uint8Array(Buffer.concat(parts.map((p) => p.audio.subarray(44)))), rate, channels), contentType: 'audio/wav' };
}

/** Returns mp3 (audio/mpeg) or, for PCM-only models, WAV (audio/wav). A line of several sentences is synthesised as parallel chunks (lower time to first audio). */
export async function speak(o: { model: string; voice: string; text: string }): Promise<Speech> {
  const chunks = speechChunks(o.text);
  return joinSpeech(await Promise.all(chunks.map((text) => speakOnce({ ...o, text }))));
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
  if (env.ELEVENLABS_API_KEY) models.push({ id: SCRIBE_MODEL, name: 'ElevenLabs Scribe v2', input: ['audio'], output: ['transcription'], pricing: { prompt: '0', completion: '0' }, voices: [] });
  modelCache = { at: Date.now(), models };
  return models;
}

/** Whether a model accepts image input. Unknown model or catalogue down: assume yes and let the call fail loudly. */
export const acceptsImages = (model: string) =>
  listModels().then((ms) => ms.find((m) => m.id === model)?.input.includes('image') ?? true, () => true);
