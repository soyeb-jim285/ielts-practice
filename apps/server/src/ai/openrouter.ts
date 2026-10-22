import { z } from 'zod';
import type { Word } from '@ielts/core';
import { env, IS_TEST } from '../env';
import { recordCost, usageCost, whisperUsd } from './cost';
import { type AiLogRow, logAi } from './ailog';
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
    /** The upstream error text (redacted), for admin screens; users get `message`. */
    public detail?: string,
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

/** What an OpenRouter response body was, for the AI log: parsed JSON, text, or a note for audio. */
function logBody(buf: ArrayBuffer, type: string): unknown {
  if (/audio|octet-stream/.test(type)) return { binary: type, bytes: buf.byteLength };
  const text = new TextDecoder().decode(buf);
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/** Retries network errors, 429 and 5xx twice with jittered backoff; timeouts are not retried (they already waited minutes).
 *  Every POST is written to the AI log (ai/ailog.ts) once, with its final outcome; `stage` names the pipeline step, as in the cost ledger. */
async function call(path: string, body: unknown, timeoutMs = 90_000, method = 'POST', stage = 'other'): Promise<Response> {
  const ctx = keyCtx.getStore();
  const apiKey = ctx?.openrouter ?? env.OPENROUTER_API_KEY; // the user's own key when they have one: their credit, not the community's
  const t0 = Date.now();
  const log = (r: Pick<AiLogRow, 'ok' | 'status' | 'response' | 'error' | 'served' | 'costUsd'>) =>
    method === 'POST' && logAi({ stage, path, model: (body as { model?: string } | undefined)?.model, latencyMs: Date.now() - t0, request: body, ...r });
  for (let attempt = 0; ; attempt++) {
    let res: Response, buf: ArrayBuffer | undefined;
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
      if (res.ok) res = new Response((buf = await res.arrayBuffer()), res);
    } catch (e) {
      if ((e as Error).name === 'TimeoutError') {
        log({ ok: false, error: `timeout after ${timeoutMs} ms` });
        throw new AiError('timeout', 'The AI service took too long to respond. Please retry.');
      }
      const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
      console.error(`openrouter ${path} fetch failed (attempt ${attempt + 1}/${RETRIES + 1}):`, (e as Error).message, cause?.code ?? cause?.message ?? '');
      if (attempt < RETRIES) {
        await backoff(attempt);
        continue;
      }
      log({ ok: false, error: `network: ${(e as Error).message} ${cause?.code ?? cause?.message ?? ''}`.trim() });
      throw new AiError('network', 'Could not reach the AI service. Please retry.');
    }
    if (res.ok) {
      const out = logBody(buf!, res.headers.get('content-type') ?? '') as { provider?: string; usage?: unknown };
      const u = usageCost(out?.usage);
      log({ ok: true, status: res.status, response: out, served: out?.provider, costUsd: u.exact ? u.costUsd : null });
      return res;
    }
    if (attempt < RETRIES && (res.status === 429 || res.status >= 500)) {
      await backoff(attempt);
      continue;
    }
    const detail = redact((await res.text().catch(() => '')).slice(0, 2000), apiKey);
    console.error(`openrouter ${path} ${res.status}`, ctx?.openrouter ? 'own key' : OPERATOR_HINT[res.status] ?? '', detail.slice(0, 500));
    log({ ok: false, status: res.status, error: detail || `HTTP ${res.status}` });
    if (ctx?.openrouter && (res.status === 401 || res.status === 403)) ctx.onAuthFail?.();
    throw new AiError('http', httpMessage(res.status, !!ctx?.openrouter), res.status, detail);
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

/** Anthropic models run on the house Anthropic key (OpenRouter BYOK) only, never on OpenRouter's own Anthropic capacity; when that key fails or its credit
 *  runs out OpenRouter moves to luna (`models`). The BYOK setting "never use OpenRouter's Anthropic capacity" must be on in the OpenRouter dashboard. */
export const FALLBACK_MODEL = 'openai/gpt-6-luna';
const ANTHROPIC_ROUTE = (model: string, provider: unknown) => ({
  cache_control: { type: 'ephemeral' }, // Anthropic caches only when asked; luna caches on its own
  models: [model, FALLBACK_MODEL],
  provider: { ...(provider as object), only: ['anthropic', 'openai'], allow_fallbacks: false },
});

async function chat(body: Record<string, unknown>, timeoutMs?: number, onServed?: (s: Served) => void, tag: CostTag = {}): Promise<string> {
  const stage = tag.stage ?? 'other', model = String(body.model);
  let data: Served & { id?: string; usage?: unknown; choices?: { message?: { content?: string | null } }[] };
  try {
    data = (await (await call('/chat/completions', { ...body, usage: { include: true }, ...(model.startsWith('anthropic/') && ANTHROPIC_ROUTE(model, body.provider)) }, timeoutMs, 'POST', stage)).json()) as typeof data;
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
  /** Reasoning effort for reasoning models: a one-line examiner turn does not need the default (medium) thinking time. 'none' turns reasoning off. */
  effort?: 'none' | 'low' | 'medium' | 'high';
  cost?: CostTag;
}): Promise<string> {
  return chat({ model: o.model, messages: o.messages, temperature: o.temperature ?? 0.7, max_tokens: o.maxTokens, ...(o.effort && { reasoning: o.effort === 'none' ? { enabled: false } : { effort: o.effort } }) }, undefined, undefined, { stage: 'examiner_llm', ...o.cost });
}

/** chatText, streamed: `onDelta` gets each text piece as it arrives (server-sent events), the full text is returned at the end.
 *  No retry once bytes have arrived (a half-spoken reply can't be restarted); before that, a failed request throws AiError like call(). */
export async function chatTextStream(o: Parameters<typeof chatText>[0] & { onDelta: (text: string) => void; timeoutMs?: number }): Promise<string> {
  const ctx = keyCtx.getStore();
  const apiKey = ctx?.openrouter ?? env.OPENROUTER_API_KEY;
  const stage = o.cost?.stage ?? 'examiner_llm';
  const body = { model: o.model, messages: o.messages, temperature: o.temperature ?? 0.7, max_tokens: o.maxTokens, stream: true, usage: { include: true }, ...(o.effort && { reasoning: o.effort === 'none' ? { enabled: false } : { effort: o.effort } }) };
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetcher(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': env.BETTER_AUTH_URL, 'X-Title': 'IELTS Practice' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
    });
  } catch (e) {
    recordFailure(e, { stage, model: o.model });
    throw new AiError((e as Error).name === 'TimeoutError' ? 'timeout' : 'network', 'Could not reach the AI service. Please retry.');
  }
  if (!res.ok || !res.body) {
    const detail = redact((await res.text().catch(() => '')).slice(0, 2000), apiKey);
    logAi({ stage, path: '/chat/completions', model: o.model, latencyMs: Date.now() - t0, request: body, ok: false, status: res.status, error: detail || `HTTP ${res.status}` });
    if (ctx?.openrouter && (res.status === 401 || res.status === 403)) ctx.onAuthFail?.();
    throw new AiError('http', httpMessage(res.status, !!ctx?.openrouter), res.status);
  }
  let text = '', buf = '', usage: unknown, provider: string | undefined, id: string | undefined;
  const dec = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
      try {
        const d = JSON.parse(line.slice(5)) as { id?: string; provider?: string; usage?: unknown; choices?: { delta?: { content?: string } }[] };
        id ??= d.id;
        provider ??= d.provider;
        if (d.usage) usage = d.usage;
        const piece = d.choices?.[0]?.delta?.content;
        if (piece) (text += piece), o.onDelta(piece);
      } catch {
        // a keep-alive comment or a partial line: skip
      }
    }
  }
  const u = usageCost(usage);
  logAi({ stage, path: '/chat/completions', model: o.model, latencyMs: Date.now() - t0, request: body, ok: true, status: res.status, served: provider, costUsd: u.exact ? u.costUsd : null, response: { text, usage } });
  recordCost({ stage, provider: 'openrouter', model: o.model, costUsd: u.costUsd ?? 0, meta: { generationId: id, served: provider, streamed: true, ...(!u.exact && { estimated: true }) } });
  return text;
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
    d = (await (await call('/systemone', { model: DECISION_MODEL, state: o.state, questions: o.questions }, o.timeoutMs ?? 10_000, 'POST', o.cost?.stage ?? 'decide')).json()) as Res;
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

/** The primed pass judged without a plain pass to compare with: no loop, no echo of the priming prompt, and no long stretch of the recording without words
 *  (a dropped stretch: over 8 s and over a quarter of the recording, inside or at the end). Candidate-only recordings rarely hold such a silence. */
export function verbatimAlone(d: { words?: { word: string; start: number; end: number }[]; duration?: number }) {
  const w = d.words ?? [];
  if (w.length < 3) return false;
  const v = w.map((x) => bare(x.word)).filter(Boolean);
  const loops = (n: number, times: number) => v.some((_, i) => i + n * times <= v.length && Array.from({ length: times }, (_, k) => v.slice(i + k * n, i + k * n + n).join(' ')).every((g, _k, all) => g === all[0]));
  if (loops(1, 4) || [2, 3, 4, 5, 6].some((n) => loops(n, 3)) || grams(v, 5).some((g) => PROMPT_5GRAMS.has(g))) return false;
  const dur = Math.max(d.duration ?? 0, w.at(-1)!.end), gap = (x: number) => x > 8 && x > dur / 4;
  return !w.some((x, i) => i > 0 && gap(x.start - w[i - 1]!.end)) && !gap(dur - w.at(-1)!.end) && !gap(w[0]!.start);
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
    'POST',
    stage,
  ).catch((e) => (recordFailure(e, { stage, model: o.model }), Promise.reject(e)));
  return (await res.json()) as SttResponse;
}

/** Success row of a Whisper pass. OpenRouter's STT response is not known to carry `usage.cost` (docs section 2): without it the price is audio seconds x a documented rate, flagged estimated. */
function recordStt(d: SttResponse, model: string, stage: string, meta: Record<string, unknown> = {}) {
  const u = usageCost(d.usage), seconds = d.duration ?? d.words?.at(-1)?.end ?? 0;
  recordCost({ stage, provider: 'openrouter', model, costUsd: u.exact ? u.costUsd : whisperUsd(seconds), audioSeconds: seconds, meta: { ...meta, generationId: d.id, ...(!u.exact && { estimated: true }) } });
}

export const SCRIBE_MODEL = 'elevenlabs/scribe-v2';
const WHISPER_FALLBACK = 'openai/whisper-large-v3';

/** ElevenLabs Scribe v2 through OpenRouter (spec §5.2): verbatim (fillers, repeats and false starts kept), word timings, exact cost in `usage`.
 *  OpenRouter passes no character timings, so `prolonged` comes only from the text ("sooo", core speech.ts). Throws on any failure; transcribe() falls back to Whisper. */
async function scribe(o: { audio: Uint8Array; format: Format }) {
  const d = await stt({ ...o, model: SCRIBE_MODEL }, 'stt');
  recordStt(d, SCRIBE_MODEL, 'stt');
  // "…" and cut-offs ("th-", "I went to the—") stay in the word text: core's rule tagger and the text tagger read them as false starts / partials.
  const words = wordsOf(d);
  return { text: d.text ?? words.map((w) => w.w).join(' '), words, duration: d.duration ?? words.at(-1)?.end ?? 0, verbatim: true, model: SCRIBE_MODEL };
}

/** `verbatim`: for Whisper models, also runs a disfluency-primed pass (in parallel) and keeps it when verbatimSane; `verbatim` in the result says which was used.
 *  model `elevenlabs/scribe-v2` falls back to Whisper on any error or quota; `model` in the result is the one that answered. */
export async function transcribe(o: { model: string; audio: Uint8Array; format: Format; verbatim?: boolean }, fallbackFrom?: string): Promise<{ text: string; words: SttWord[]; duration: number; verbatim: boolean; model: string }> {
  if (o.model === SCRIBE_MODEL) {
    try {
      return await scribe(o);
    } catch (e) {
      console.error('Scribe failed, falling back to Whisper:', (e as Error).message);
    }
    return transcribe({ ...o, model: WHISPER_FALLBACK }, o.model);
  }
  const primed = o.verbatim && /whisper/.test(o.model);
  // One pass when it can: the disfluency-primed pass alone, checked on its own (verbatimAlone). The plain pass runs only when the primed one fails or is not sane,
  // then the old comparison decides (verbatimSane). ponytail: the two-pass check caught more drops, at double the cost on every recording.
  let d: SttResponse, verbatim = false;
  const v = primed ? await stt(o, 'stt_verbatim', { provider: VERBATIM_PROVIDER }).catch(() => undefined) : undefined;
  const toks = (x: SttResponse) => (x.words ?? []).map((w) => w.word);
  if (v && verbatimAlone(v)) {
    d = v;
    verbatim = true;
    recordStt(v, o.model, 'stt', { verbatim: true, ...(fallbackFrom && { fallbackFrom }) });
  } else {
    const plain = await stt(o, 'stt').catch((e) => {
      if (v) recordStt(v, o.model, 'stt_verbatim', { kept: false });
      throw e;
    });
    verbatim = !!v && verbatimSane(toks(v), toks(plain));
    d = verbatim ? v! : plain;
    recordStt(plain, o.model, 'stt', fallbackFrom ? { fallbackFrom } : {});
    if (v) recordStt(v, o.model, 'stt_verbatim', { kept: verbatim }); // a second full charge; kept=false is pure waste
  }
  const words = wordsOf(d);
  return { text: d.text ?? words.map((w) => w.w).join(' '), words, duration: d.duration ?? words.at(-1)?.end ?? 0, verbatim, model: o.model };
}

/** Normalised words of an STT response, punctuated from its text. Whisper via OpenRouter gives no per-word probability: a word falls back to its
 *  segment's mean token probability (segment-level, so it can flag several words together; not proof of a pronunciation error). */
function wordsOf(d: SttResponse): SttWord[] {
  const segConf = (t: number) => {
    const lp = d.segments?.find((s) => t >= s.start && t < s.end)?.avg_logprob;
    return lp == null ? undefined : Math.round(Math.exp(lp) * 100) / 100;
  };
  const words: SttWord[] = (d.words ?? [])
    .filter((w) => w.word?.trim())
    .map((w) => ({ w: w.word.trim(), start: w.start, end: w.end, conf: w.confidence ?? w.probability ?? segConf(w.start) }));
  if (d.text) punctuate(words, d.text);
  return words;
}

/** An OpenRouter transcription model: list price per audio second, or per token for the LLM-style ones. */
export type SttModel = { id: string; name: string; description: string; usdPerSecond: number | null; usdPerMTokIn: number | null; usdPerMTokOut: number | null };
let sttModelCache: { at: number; models: SttModel[] } | undefined;
/** OpenRouter's transcription models (GET /models?output_modalities=transcription), cached for an hour. */
export async function sttModels(): Promise<SttModel[]> {
  if (sttModelCache && Date.now() - sttModelCache.at < 3_600_000) return sttModelCache.models;
  const d = (await (await call('/models?output_modalities=transcription', undefined, 15_000, 'GET')).json()) as { data?: { id: string; name?: string; description?: string; pricing?: { prompt?: string; completion?: string } }[] };
  const num = (x?: string) => (x == null || Number(x) < 0 || !Number.isFinite(Number(x)) ? null : Number(x));
  const models = (d.data ?? []).map((m) => {
    const inP = num(m.pricing?.prompt), outP = num(m.pricing?.completion);
    // Audio models bill the input per second and nothing for output; a non-zero output price means token billing (prompt and completion per token).
    const perToken = !!outP;
    return { id: m.id, name: m.name ?? m.id, description: (m.description ?? '').slice(0, 300), usdPerSecond: perToken ? null : inP, usdPerMTokIn: perToken && inP != null ? inP * 1e6 : null, usdPerMTokOut: perToken ? outP! * 1e6 : null };
  });
  sttModelCache = { at: Date.now(), models };
  return models;
}

/** One admin playground transcription: any OpenRouter model, optional priming prompt and language, raw response kept. Priced from usage.cost when
 *  OpenRouter sends it, else list price x audio seconds (null for token-priced models without usage). Recorded under the `playground` stage. */
export async function transcribeOnce(o: { model: string; audio: Uint8Array; format: Format; prompt?: string; language?: string | null }) {
  const t0 = Date.now();
  const options = o.prompt ? { provider: { options: Object.fromEntries(['groq', 'together', 'deepinfra', 'deepinfra/us', 'fireworks'].map((slug) => [slug, { prompt: o.prompt }])) }, prompt: o.prompt } : {};
  let promptDropped = false;
  // A 400 that a narrower request avoids: gpt-4o-transcribe and friends take only "json" (no word timings then); Together rejects any prompt for
  // Parakeet (its only host), so a prompted run goes again without one and says so (promptDropped).
  const go = (x: Record<string, unknown>): Promise<SttResponse> =>
    stt(o, 'playground', x).catch((e) => {
      if (!(e instanceof AiError && e.status === 400)) throw e;
      if (/response_format/.test(e.detail ?? '') && x.response_format !== 'json') return go({ ...x, response_format: 'json', timestamp_granularities: undefined });
      if (x.prompt) return go({ ...x, prompt: undefined, provider: undefined }).then((d) => ((promptDropped = true), d));
      throw e;
    });
  const d = await go({ ...options, language: o.language ?? undefined });
  const ms = Date.now() - t0;
  const words = wordsOf(d), seconds = d.duration ?? words.at(-1)?.end ?? 0;
  const u = usageCost(d.usage), price = (await sttModels().catch(() => [])).find((m) => m.id === o.model)?.usdPerSecond;
  const costUsd = u.exact ? u.costUsd : price != null ? price * seconds : null;
  recordCost({ stage: 'playground', provider: 'openrouter', model: o.model, costUsd: costUsd ?? 0, audioSeconds: seconds, paidBy: 'house', meta: { generationId: d.id, ...(!u.exact && { estimated: true }), ...(costUsd == null && { unknownCost: true }) } });
  return { model: o.model, text: d.text ?? words.map((w) => w.w).join(' '), words, duration: seconds, latencyMs: ms, costUsd, costExact: u.exact, promptDropped, raw: d };
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
