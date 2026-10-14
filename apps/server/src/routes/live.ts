import { createHash, timingSafeEqual } from 'node:crypto';
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, max } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { candidateFacts, CUE_PREFIX, EXAMINER_SYSTEM, direction, GPT_LIVE_CUES, gptLiveCue, newState, nextPhase, PREP_MS, scriptedLine, sessionScript, type LiveState, type Turn } from '../ai/examiner';
import { activeRun, attachSideband, createWebrtcSession, endRun, saveTranscript } from '../ai/gpt-live';
import { GEMINI_LIVE_MODELS, geminiTokenRequest, mintGeminiToken } from '../ai/gemini-live';
import { mintClientSecret, mintRealtimeSecret, REALTIME_MODELS, realtimeUsd, type RealtimeUsage } from '../ai/openai-realtime';
import { CASCADE_BATCH_STTS, CASCADE_LLMS, CASCADE_STT_MODELS, sentenceSplitter, CASCADE_STTS, CASCADE_TTS, CASCADE_TTS_MODELS, cascadeMessages, scribeToken, sonioxToken, spokenLine, transcriptionSession } from '../ai/cascade';
import { geminiLiveUsd, recordCost, type GeminiLiveUsage } from '../ai/cost';
import { keyCtx, redact } from '../ai/keyctx';
import { AiError, chatText, chatTextStream, speak, transcribe, transcribeOnce } from '../ai/openrouter';
import { liveDeadline } from '../ai/live-deadline';
import { currentUser, requireOwner, requireUser } from '../auth';
import { db } from '../db/client';
import { aiCosts, attempts, liveSessions } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../errors';
import { clientIpHash } from '../ip';
import { runAnalysis } from '../jobs';
import { markKeyInvalid } from '../keys';
import { checkStart, liveKey, requireLive, reserve, withPayer } from '../quota';
import { getSettings, type Settings } from '../settings';
import { aiLimit } from '../ratelimit';
import { storage, uploadError } from '../storage';
import type { App, AppEnv } from '../types';
import { CodedError } from './community';
import { liveMock } from './mock';
import { pickP1Branches, pickSpeakingTest, PromptSchema } from './prompts';

const AUDIO_EXT: Record<string, 'webm' | 'm4a' | 'wav'> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav' };
const MIME: Record<string, string> = { webm: 'audio/webm', m4a: 'audio/mp4', wav: 'audio/wav' };

const Phase = z.enum(['intro', 'p1', 'p2-prep', 'p2-talk', 'p2-follow', 'p3', 'closing', 'done']);
const ErrorSchema = z.object({ error: z.string() }).openapi('Error');
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const authed = { tags: ['Live'], security: [{ bearer: [] }], middleware: [requireUser] };
/** Routes that spend AI credit: rate-limited per user. */
const paid = { ...authed, middleware: [requireUser, withPayer, aiLimit] };
const tooMany = { 429: json(CodedError, 'Too many requests (too_many_requests), or the test quota is used up (quota_exceeded)') };
const needsKey = { 403: json(CodedError, 'live_requires_own_key: the live examiner runs only on the user\'s own OpenRouter (turn-based), OpenAI (GPT-Live) or Gemini (Gemini Live) key') };
const SessionRef = z.object({ sessionId: z.string() });
const CascadeReplyBody = SessionRef.extend({
    turns: z
      .array(z.object({ role: z.enum(['examiner', 'candidate', 'app']), text: z.string().max(4000) }))
      .min(1)
      .max(200)
      .openapi({ description: "The whole conversation: examiner lines, the candidate's transcribed speech, and app cues (sent without the [APP CUE] prefix)" }),
    llm: z.enum(CASCADE_LLMS).optional(),
    tts: z.enum(CASCADE_TTS_MODELS).optional(),
    stt: z.enum([...CASCADE_STT_MODELS, ...CASCADE_BATCH_STTS]).optional().openapi({ description: 'Which transcriber the sttSeconds were spent on (pricing; batch transcribers record their own cost); default scribe_v2_realtime' }),
    sttSeconds: z.number().min(0).max(3600).optional().openapi({ description: 'Candidate audio transcribed since the last reply (priced into the ledger)' }),
});

const ExaminerLine = z
  .object({
    examinerText: z.string(),
    audioUrl: z.string().nullable().openapi({ description: 'Examiner TTS; null when the voice failed or was skipped: show examinerText as a caption and start listening' }),
    voiceError: z.string().optional().openapi({ description: 'Why audioUrl is null (voice failed)' }),
    phase: Phase.openapi({ description: "Phase of this line; 'done' after the closing line" }),
    transcript: z.string().optional().openapi({ description: "The candidate's transcribed answer" }),
    prepSeconds: z.number().optional().openapi({ description: 'p2-prep: seconds of preparation left; POST /turn (skipped) when it ends' }),
    cueCard: PromptSchema.optional(),
  })
  .openapi('ExaminerLine');

async function loadSession(sessionId: string, userId: string) {
  const row = await db.query.liveSessions.findFirst({ where: and(eq(liveSessions.id, sessionId), eq(liveSessions.userId, userId)) });
  if (!row) throw new HTTPException(404, { message: 'Live session not found' });
  const cost = keyCtx.getStore()?.cost;
  if (cost) cost.sessionId = sessionId; // the turn's STT / examiner / TTS rows belong to this live session
  return row.state as LiveState;
}

const LivePart = z.object({
                part: z.union([z.literal(1), z.literal(2), z.literal(3)]),
                audioKey: z.string(),
                durationMs: z.number().int().min(0),
                energy: z.array(z.number().int().min(0).max(255)).max(20000).optional(),
                marks: z.array(z.number().int().min(0)).max(200).optional().openapi({ description: 'Question start offsets (ms) within this part' }),
                conversationKey: z.string().optional().openapi({ description: "Upload key of the whole conversation (the candidate's mic mixed with the examiner's voice), for playback" }),
                segments: z
                  .array(z.object({ q: z.number().int().min(0), startMs: z.number().int().min(0), endMs: z.number().int().min(0), question: z.string().max(2000).optional().openapi({ description: 'The examiner line this window answers, as the examiner said it' }) }))
                  .max(200)
                  .optional()
                  .openapi({ description: 'Answer windows in the recording clock: the recorder paused while the examiner was audible, so the gaps between windows are examiner time, not pauses' }),
              }).openapi('LivePart');
type LivePart = z.infer<typeof LivePart>;

/**
 * Creates the attempts of the parts this session does not have yet, reserves them under the session's one speaking test, starts their analysis, and
 * (`finish`) closes the session. Returns the session's attempt ids (only part `only` when given), null when the session was already finished,
 * or an upload error message. A part sent twice (a retried /live/part, then /live/finish) is created once.
 */
async function addParts(c: Context<AppEnv>, s: LiveState, userId: string, list: LivePart[], finish: boolean, only?: number): Promise<string[] | null | string> {
  for (const p of list) {
    const bad = await uploadError(ownKey(s, p.audioKey));
    if (bad) return `${bad} (part ${p.part})`;
    // the playback copy is optional: an unusable one is dropped, never a reason to lose the test
    if (p.conversationKey && (await uploadError(ownKey(s, p.conversationKey)))) p.conversationKey = undefined;
  }
  const ofSession = and(eq(attempts.sessionId, s.sessionId), eq(attempts.userId, userId));
  const have = new Set((await db.select({ part: attempts.part }).from(attempts).where(ofSession)).map((r) => r.part));
  const fresh = list.filter((p) => !have.has(p.part)).map((p) => ({ p, id: crypto.randomUUID() }));
  // One speaking test for the whole session, reserved before any analysis spends community credit; later parts join the same unit.
  if (fresh.length) await reserve(c.get('payer')!, 'speaking', s.sessionId, clientIpHash(c), fresh.map(({ p, id }) => ({ part: p.part, id })));
  const promptId = { 1: s.test.part1[0]!.id, 2: s.test.part2.id, 3: s.test.part3.id };
  const out = await db.transaction(async (tx) => {
    // Row lock serialises concurrent sends (double click, client retry, /part racing /finish).
    const [row] = await tx.select({ state: liveSessions.state }).from(liveSessions).where(and(eq(liveSessions.id, s.sessionId), eq(liveSessions.userId, userId))).for('update');
    if ((row?.state as LiveState | undefined)?.phase === 'done') return null;
    const now = new Set((await tx.select({ part: attempts.part }).from(attempts).where(ofSession)).map((r) => r.part));
    const insert = fresh.filter(({ p }) => !now.has(p.part));
    if (finish) {
      s.phase = 'done';
      await tx.update(liveSessions).set({ state: s }).where(eq(liveSessions.id, s.sessionId));
    }
    const inserted = insert.length
      ? await tx
          .insert(attempts)
          .values(
            insert.map(({ p, id }) => ({
              id, userId, promptId: promptId[p.part], skill: 'speaking' as const, part: p.part, mode: 'live' as const, sessionId: s.sessionId,
              audioKey: p.audioKey, audioMime: MIME[p.audioKey.split('.').pop()!] ?? 'audio/webm', durationMs: p.durationMs, energy: p.energy, marks: p.marks,
              segments: p.segments, conversationKey: p.conversationKey, status: 'analyzing' as const,
            })),
          )
          .returning({ id: attempts.id })
      : [];
    const all = await tx.select({ id: attempts.id, part: attempts.part }).from(attempts).where(ofSession).orderBy(attempts.part);
    return { inserted, all };
  });
  if (!out) return null;
  for (const r of out.inserted) void runAnalysis(r.id);
  return out.all.filter((r) => only == null || r.part === only).map((r) => r.id);
}

const save = (s: LiveState) => db.update(liveSessions).set({ state: s }).where(eq(liveSessions.id, s.sessionId));

/** Candidate uploads must live under this session's prefix. */
function ownKey(s: LiveState, key: string) {
  if (!key.startsWith(`live/${s.sessionId}/`) || key.includes('..')) throw new HTTPException(400, { message: 'Invalid audio key' });
  return key;
}

/** Fixed examiner lines (intro, "Can you start speaking now", closing, Part 1 questions) repeat across sessions: the audio is kept in memory (same model and voice), so they cost no TTS round trip.
 *  ponytail: per process, 40 lines, evicted oldest first. */
const speechCache = new Map<string, Awaited<ReturnType<typeof speak>>>();
export const clearSpeechCache = () => speechCache.clear();
async function cachedSpeech(model: string, voice: string, text: string) {
  const k = `${model}|${voice}|${text}`;
  let speech = speechCache.get(k);
  if (!speech) {
    speech = await speak({ model, voice, text });
    speechCache.set(k, speech);
    if (speechCache.size > 40) speechCache.delete(speechCache.keys().next().value!);
  }
  return speech;
}

/** TTS for history entry n, stored at live/{sessionId}/e{n}.mp3 (or .wav for PCM-only voices). A TTS failure degrades to captions only (url null) instead of failing the turn. */
async function voice(s: LiveState, n: number, text: string, settings: Settings): Promise<{ key?: string; url: string | null; voiceError?: string }> {
  const { tts, ttsVoice } = settings.models;
  try {
    return await liveDeadline((async () => {
      const { audio, contentType } = await cachedSpeech(tts, ttsVoice, text);
      const key = `live/${s.sessionId}/e${n}.${contentType === 'audio/wav' ? 'wav' : 'mp3'}`;
      await storage.put(key, audio, contentType);
      return { key, url: await storage.presignGet(key) };
    })(), 12_000);
  } catch (e) {
    if (!(e instanceof AiError)) throw e;
    console.error('examiner TTS failed, captions only', e.status, e.message);
    if (e.status === 400 || e.status === 404) console.error(`examiner voice model ${tts} (voice ${ttsVoice}) rejected the request`);
    return { url: null, voiceError: 'The examiner voice is unavailable right now, so questions are shown as captions.' };
  }
}

/** Maps AI failures to a readable 502 instead of a generic 500. */
async function ai<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AiError) throw new HTTPException(502, { message: e.message });
    throw e;
  }
}

/** The provider rejected the user's own key (401/403): flag it and tell them, instead of a vague "could not start". Only when the key was theirs; a rejected owner/server key is an operator problem. */
function rejectedKey(userId: string, provider: 'openai' | 'gemini', label: string, own: string | undefined): never {
  if (!own) throw new ApiError(502, { error: `Could not start a ${label} session. Please retry.`, code: 'key_check_failed' });
  void markKeyInvalid(userId, provider);
  throw new ApiError(400, { error: `${label} rejected your API key. Check it in Settings.`, code: 'invalid_key' });
}

/** Streaming transcription (Scribe Realtime / OpenAI) bills where the server can't see it: the browser counts the seconds and they are priced here.
 *  Batch transcribers ran through /live/cascade/transcribe, which recorded their cost already. */
function recordStreamingStt(b: { stt?: string; sttSeconds?: number }, payer: NonNullable<AppEnv['Variables']['payer']>) {
  const stt = (b.stt ?? CASCADE_STT_MODELS[0]) as keyof typeof CASCADE_STTS;
  const info = CASCADE_STTS[stt];
  if (!info || !b.sttSeconds) return;
  recordCost({ stage: 'live_stt', provider: info.provider, model: stt, costUsd: (b.sttSeconds / 60) * info.usdPerMin, audioSeconds: b.sttSeconds, paidBy: info.provider === 'openai' && payer.keys.openai ? 'own_key' : 'house', meta: { estimated: true } });
}

export function register(app: App) {
  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/start',
      summary: 'Start a live examiner session: picks a full speaking test and returns the opening line with TTS audio',
      request: body(
        z
          .object({
            source: z.enum(['generated', 'cambridge', 'any']).default('any'),
            mockId: z.string().optional().openapi({ description: 'Full mock test: use the mock\'s Cambridge test (ref) and require its speaking mode to be live' }),
            skipTts: z.boolean().default(false).openapi({ description: 'Duplex (GPT-Live, Gemini Live) sessions speak for themselves: create the session without examiner TTS (audioUrl null)' }),
            localHour: z.number().int().min(0).max(23).optional().openapi({ description: "The candidate's local hour (0-23): the examiner greets with Good morning / afternoon / evening; without it, Hello" }),
          })
          .openapi('LiveStart'),
      ),
      description: 'Needs the user\'s own key: OpenRouter for the turn-based examiner (skipTts false), OpenAI or Gemini for duplex sessions (skipTts true), else 403 live_requires_own_key. A user without an OpenRouter key also needs a test left (429 quota_exceeded, 402 community_balance_exhausted).',
      responses: {
        ...needsKey,
        402: json(CodedError, 'community_balance_exhausted'),
        503: json(CodedError, 'community_busy'),
        200: json(
          ExaminerLine.extend({ sessionId: z.string(), test: z.object({ part1: z.array(PromptSchema), part2: PromptSchema, part3: PromptSchema }) }).openapi('LiveStarted'),
          'Session started',
        ),
        404: json(ErrorSchema, 'Bank is empty'),
        ...tooMany,
        502: json(ErrorSchema, 'AI service error'),
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const { source: asked, skipTts, mockId, localHour } = c.req.valid('json');
      const mock = mockId ? await liveMock(user.id, mockId) : null;
      const source = mock?.source ?? asked;
      const payer = c.get('payer')!;
      requireLive(payer, skipTts ? 'duplex' : 'turn');
      await checkStart(payer, 'speaking', clientIpHash(c)); // its analysis may still run on the community balance: tell them now, not after 14 minutes
      const picked = await pickSpeakingTest(user, source, mock?.ref);
      if (!picked) return c.json({ error: 'No speaking test available' }, 404);
      const test = { ...picked, branches: await pickP1Branches(user), script: sessionScript(localHour, picked.part1[0]?.topic) };
      const sessionId = crypto.randomUUID();
      const s = newState(sessionId, test, Date.now());
      const { key, ...audio } = skipTts ? { url: null } : await voice(s, 0, s.history[0]!.text, await getSettings(user.id));
      s.history[0]!.audioKey = key;
      await db.insert(liveSessions).values({ id: sessionId, userId: user.id, state: s });
      return c.json({ sessionId, test, examinerText: s.history[0]!.text, audioUrl: audio.url, voiceError: audio.voiceError, phase: s.phase }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...authed,
      method: 'post',
      path: '/api/live/upload-url',
      summary: "Presigned PUT for a candidate recording (a turn or a whole part) in this session",
      request: body(SessionRef.extend({ audioContentType: z.string().default('audio/webm') }).openapi('LiveUploadUrl')),
      responses: { 200: json(z.object({ key: z.string(), uploadUrl: z.string() }).openapi('LiveUpload'), 'Upload URL'), 400: json(ErrorSchema, 'Bad type'), 404: json(ErrorSchema, 'Not found') },
    }),
    async (c) => {
      const b = c.req.valid('json');
      await loadSession(b.sessionId, currentUser(c).id);
      const ext = AUDIO_EXT[b.audioContentType.split(';')[0]!.trim().toLowerCase()];
      if (!ext) return c.json({ error: `Unsupported audio type ${b.audioContentType}` }, 400);
      const key = `live/${b.sessionId}/c-${crypto.randomUUID()}.${ext}`;
      return c.json({ key, uploadUrl: await storage.presignPut(key, b.audioContentType) }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/turn',
      summary: "Turn-based examiner: transcribes the candidate's answer (if any) and returns the examiner's next line",
      request: body(SessionRef.extend({ audioKey: z.string().optional(), skipped: z.boolean().optional() }).openapi('LiveTurn')),
      responses: {
        200: json(ExaminerLine, 'Next examiner line'),
        400: json(ErrorSchema, 'Bad audio key'),
        404: json(ErrorSchema, 'Not found'),
        409: json(ErrorSchema, 'Test already over'),
        ...needsKey,
        ...tooMany,
        502: json(ErrorSchema, 'AI service error'),
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const b = c.req.valid('json');
      requireLive(c.get('payer')!, 'turn');
      const s = await loadSession(b.sessionId, user.id);
      if (s.phase === 'done') return c.json({ error: 'The test is already over' }, 409);
      const settings = await getSettings(user.id);
      const now = Date.now();

      // The candidate's turn goes into the history first (as "[no response]"), because the phase and every scripted line depend on whether a turn
      // was taken, not on what was said. That lets the examiner's scripted line be voiced while the answer is still being transcribed.
      const cand: Turn | undefined = s.phase === 'p2-prep' ? undefined : { role: 'candidate', text: '[no response]', at: now, audioKey: b.audioKey, phase: s.phase };
      if (cand) s.history.push(cand);
      const t0 = Date.now(), ms: Record<string, number> = {};
      let audioKey: string | undefined;
      if (cand && b.audioKey && !b.skipped) {
        audioKey = ownKey(s, b.audioKey);
        const bad = await uploadError(audioKey);
        if (bad) return c.json({ error: bad }, 400);
      }
      // verbatim: false: live turns need the words, not the disfluency-primed second Whisper pass; Scribe (when configured) is verbatim anyway.
      const transcribed = (async () => {
        if (!cand || !audioKey) return undefined;
        const r = await ai(() => liveDeadline((async () => transcribe({ model: settings.models.stt, audio: await storage.get(audioKey!), format: audioKey!.split('.').pop() as 'webm', verbatim: false }))(), 20_000));
        ms.sttMs = Date.now() - t0;
        const transcript = r.text.trim();
        Object.assign(cand, { text: transcript || '[no response]', durationMs: Math.round(r.duration * 1000) });
        return transcript;
      })();

      const phase = nextPhase(s, now);
      if (phase !== s.phase) Object.assign(s, { phase, phaseStartedAt: now });
      // Fixed wording (scripted moments and Part 1 questions) needs no LLM, so the examiner voice starts while the answer is transcribed.
      // The first Part 1 question needs no LLM; later ones are adapted to the candidate's answers.
      let text = scriptedLine(s) ?? (s.phase === 'p1' && s.p1Asked === 0 ? direction(s).fallback : null);
      let audio: Awaited<ReturnType<typeof voice>>, transcript: string | undefined;
      const speakLine = async (line: string) => {
        const t = Date.now();
        const r = await voice(s, s.history.length, line, settings);
        ms.ttsMs = Date.now() - t;
        return r;
      };
      if (text !== null) {
        [transcript, audio] = await Promise.all([transcribed, speakLine(text)]);
      } else {
        transcript = await transcribed;
        const t = Date.now();
        const messages = s.history.map((h) => ({ role: h.role === 'examiner' ? ('assistant' as const) : ('user' as const), content: h.text }));
        try {
          text = (await liveDeadline(chatText({ model: settings.models.examiner, messages: [{ role: 'system', content: EXAMINER_SYSTEM(s) }, ...messages], effort: 'low', maxTokens: 200, cost: { stage: 'examiner_llm' } }), 15_000)).trim() || direction(s).fallback;
        } catch (e) {
          if (!(e instanceof AiError)) throw e;
          if (e.code !== 'timeout') throw new HTTPException(502, { message: e.message });
          text = direction(s).fallback;
        }
        ms.llmMs = Date.now() - t;
        audio = await speakLine(text);
      }
      if (s.phase === 'p1') s.p1Asked++;
      if (s.phase === 'p3') s.p3Asked++;

      s.history.push({ role: 'examiner', text, at: now, audioKey: audio.key, phase: s.phase });
      if (s.phase === 'closing') s.phase = 'done';
      await save(s);
      console.log(`live turn ${s.phase} timings ${JSON.stringify({ ...ms, totalMs: Date.now() - t0 })}`);
      const prep = s.phase === 'p2-prep' ? { prepSeconds: Math.max(0, Math.ceil((s.phaseStartedAt + PREP_MS - now) / 1000)), cueCard: s.test.part2 } : {};
      return c.json({ examinerText: text, audioUrl: audio.url, voiceError: audio.voiceError, phase: s.phase, transcript, ...prep }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/gpt-live/session',
      summary: "GPT-Live over WebRTC: exchanges the browser's SDP offer for the answer. The server creates the session (model, voice and examiner instructions are ours) and attaches a sideband that records the transcript",
      request: body(SessionRef.extend({ sdp: z.string().min(1).max(50_000).openapi({ description: "The browser's SDP offer (data channel \"oai-events\" created before the offer)" }) }).openapi('LiveGptSession')),
      responses: {
        200: json(z.object({ sdp: z.string(), sessionId: z.string().openapi({ description: "OpenAI's live session id" }) }).openapi('GptLiveSession'), 'SDP answer'),
        400: json(CodedError, 'invalid_key: OpenAI rejected the user\'s key'),
        ...needsKey,
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
        502: json(ErrorSchema, 'OpenAI error'),
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const payer = c.get('payer')!;
      requireLive(payer, 'gpt-live');
      const b = c.req.valid('json');
      const s = await loadSession(b.sessionId, user.id);
      const apiKey = liveKey(payer, 'openai')!;
      const r = await createWebrtcSession(b.sdp, user.id, apiKey);
      if (!('id' in r)) {
        console.error('gpt-live create session', r.status, redact(r.detail, apiKey));
        if (r.status === 401 || r.status === 403) return rejectedKey(user.id, 'openai', 'OpenAI', payer.keys.openai);
        return c.json({ error: 'Could not start a GPT-Live session. Please retry or use the turn-based examiner.' }, 502);
      }
      attachSideband({ userId: user.id, paidBy: payer.keys.openai ? 'own_key' : 'house', sessionId: s.sessionId, test: s.test, liveId: r.id, apiKey });
      return c.json({ sdp: r.sdp, sessionId: r.id }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/gpt-live/cue',
      summary: 'Script control for a GPT-Live session: the server appends the instruction for this moment (session.instructions.append) through its sideband. If it could not, `content` is the instruction for the client to append on its data channel',
      request: body(SessionRef.extend({ cue: z.enum(GPT_LIVE_CUES) }).openapi('LiveGptCue')),
      responses: {
        200: json(z.object({ sent: z.boolean(), content: z.string() }).openapi('GptLiveCueResult'), 'Cue handled'),
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const b = c.req.valid('json');
      const s = await loadSession(b.sessionId, user.id);
      const sent = activeRun(s.sessionId, user.id)?.cue(b.cue) ?? false;
      return c.json({ sent, content: gptLiveCue(b.cue, s.test, candidateFacts(s.history)) }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/gemini-token',
      summary: 'Ephemeral Gemini Live token locked to the examiner setup (model, voice, instructions, VAD) for this session',
      request: body(SessionRef.extend({ model: z.enum(GEMINI_LIVE_MODELS).optional().openapi({ description: 'Admin playground only; the live examiner uses the server default (GEMINI_LIVE_MODEL)' }) }).openapi('LiveGeminiToken')),
      responses: {
        200: json(z.object({ value: z.string(), expiresAt: z.number().openapi({ description: 'Unix seconds' }), model: z.string() }).openapi('GeminiToken'), 'Ephemeral token: pass as access_token to BidiGenerateContentConstrained'),
        400: json(CodedError, 'invalid_key: Gemini rejected the user\'s key'),
        ...needsKey,
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
        502: json(ErrorSchema, 'Gemini error'),
      },
    }),
    async (c) => {
      const payer = c.get('payer')!;
      requireLive(payer, 'gemini-live');
      const b = c.req.valid('json');
      const s = await loadSession(b.sessionId, currentUser(c).id);
      const model = b.model ?? env.GEMINI_LIVE_MODEL;
      const req = geminiTokenRequest(model, s.test);
      const t = await mintGeminiToken(liveKey(payer, 'gemini')!, req);
      if (!('name' in t)) {
        const geminiKey = liveKey(payer, 'gemini')!;
        console.error('gemini auth_tokens', t.status, redact(t.detail, geminiKey));
        if (t.status === 401 || t.status === 403 || (t.status === 400 && /API key not valid|API_KEY_INVALID/i.test(t.detail))) return rejectedKey(currentUser(c).id, 'gemini', 'Gemini', payer.keys.gemini);
        return c.json({ error: 'Could not start a Gemini Live session. Please retry or use the turn-based examiner.' }, 502);
      }
      // The browser talks to Google directly, so the server never sees usage: one zero-cost marker row keeps the session visible in the ledger.
      recordCost({ stage: 'live_realtime', provider: 'gemini', model, costUsd: 0, userId: currentUser(c).id, sessionId: s.sessionId, paidBy: payer.keys.gemini ? 'own_key' : 'house', meta: { estimated: true, unmetered: true } });
      return c.json({ value: t.name, expiresAt: Math.floor(Date.parse(req.expireTime) / 1000), model }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/gemini-usage',
      summary: "Gemini Live token usage of this session, summed by the browser (it talks to Google directly): priced and stored as the session's live cost",
      request: body(
        SessionRef.extend({
          model: z.enum(GEMINI_LIVE_MODELS).optional().openapi({ description: 'The model the session ran on (default GEMINI_LIVE_MODEL)' }),
          usage: z
            .object(Object.fromEntries((['inputText', 'inputAudio', 'inputMedia', 'outputText', 'outputAudio', 'thoughts'] as const).map((k) => [k, z.number().int().min(0).max(20_000_000)])) as Record<keyof GeminiLiveUsage, z.ZodNumber>)
            .openapi('GeminiLiveUsage', { description: 'Running totals: each report replaces the previous one' }),
        }).openapi('LiveGeminiUsage'),
      ),
      responses: { 200: json(z.object({ costUsd: z.number() }).openapi('GeminiLiveCost'), 'Recorded'), 404: json(ErrorSchema, 'Not found'), ...tooMany },
    }),
    async (c) => {
      const user = currentUser(c), b = c.req.valid('json');
      const s = await loadSession(b.sessionId, user.id);
      const model = b.model ?? env.GEMINI_LIVE_MODEL;
      const usage = b.usage as GeminiLiveUsage, costUsd = geminiLiveUsd(usage, model);
      // One row per session: the token-mint placeholders and any earlier report give way to this running total.
      // ponytail: client-reported (Google bills the browser's socket, the server never sees tokens); admin ledger only, never charged to users.
      // Totals only grow, so a later, smaller report never lowers what is recorded.
      const mine = and(eq(aiCosts.sessionId, s.sessionId), eq(aiCosts.provider, 'gemini'), eq(aiCosts.stage, 'live_realtime'));
      const [prev] = await db.select({ usd: max(aiCosts.costUsd) }).from(aiCosts).where(mine);
      if ((prev?.usd ?? 0) > costUsd) return c.json({ costUsd: Math.round(prev!.usd! * 1e6) / 1e6 }, 200);
      await db.delete(aiCosts).where(mine);
      recordCost({
        stage: 'live_realtime', provider: 'gemini', model, costUsd, userId: user.id, sessionId: s.sessionId, paidBy: c.get('payer')!.keys.gemini ? 'own_key' : 'house',
        inputTokens: usage.inputText + usage.inputAudio + usage.inputMedia, outputTokens: usage.outputText + usage.outputAudio + usage.thoughts,
        meta: { estimated: true, reported: true, usage },
      });
      return c.json({ costUsd: Math.round(costUsd * 1e6) / 1e6 }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/realtime-token',
      summary: 'OpenAI Realtime (gpt-realtime family) examiner: a short-lived client secret locked to the examiner session (model, voice, instructions, VAD, input transcription)',
      request: body(SessionRef.extend({ model: z.enum(REALTIME_MODELS).optional().openapi({ description: 'Admin playground only; the live examiner uses the server default (OPENAI_REALTIME_MODEL)' }) }).openapi('LiveRealtimeToken')),
      responses: {
        200: json(z.object({ value: z.string(), expiresAt: z.number().openapi({ description: 'Unix seconds' }), model: z.string() }).openapi('RealtimeToken'), 'Client secret: Bearer for POST /v1/realtime/calls'),
        400: json(CodedError, "invalid_key: OpenAI rejected the user's key"),
        ...needsKey,
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
        502: json(ErrorSchema, 'OpenAI error'),
      },
    }),
    async (c) => {
      const payer = c.get('payer')!, user = currentUser(c), b = c.req.valid('json');
      requireLive(payer, 'realtime-mini');
      const s = await loadSession(b.sessionId, user.id);
      const apiKey = liveKey(payer, 'openai')!;
      const model = b.model ?? env.OPENAI_REALTIME_MODEL;
      const t = await mintRealtimeSecret(apiKey, model, s.test);
      if (!('value' in t)) {
        console.error('openai realtime client_secrets', t.status, redact(t.detail, apiKey));
        if (t.status === 401 || t.status === 403) return rejectedKey(user.id, 'openai', 'OpenAI', payer.keys.openai);
        return c.json({ error: 'Could not start an OpenAI Realtime session. Please retry.' }, 502);
      }
      return c.json({ value: t.value, expiresAt: t.expiresAt, model }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/realtime-usage',
      summary: 'OpenAI Realtime token usage of this session, summed by the browser from response.done: priced and stored as the session\'s live cost (never lowered by a later report)',
      request: body(
        SessionRef.extend({
          model: z.enum(REALTIME_MODELS),
          usage: z
            .object(Object.fromEntries((['textIn', 'audioIn', 'cachedIn', 'textOut', 'audioOut', 'transcribeSeconds'] as const).map((k) => [k, z.number().min(0).max(20_000_000)])) as Record<keyof RealtimeUsage, z.ZodNumber>)
            .openapi('RealtimeUsage'),
        }).openapi('LiveRealtimeUsage'),
      ),
      responses: { 200: json(z.object({ costUsd: z.number() }).openapi('RealtimeCost'), 'Recorded'), 404: json(ErrorSchema, 'Not found'), ...tooMany },
    }),
    async (c) => {
      const user = currentUser(c), b = c.req.valid('json');
      const s = await loadSession(b.sessionId, user.id);
      const usage = b.usage as RealtimeUsage, costUsd = realtimeUsd(b.model, usage);
      // Same rules as the Gemini report: client-reported (the browser holds the session), one row per session, totals only grow.
      const mine = and(eq(aiCosts.sessionId, s.sessionId), eq(aiCosts.provider, 'openai'), eq(aiCosts.stage, 'live_realtime'), eq(aiCosts.model, b.model));
      const [prev] = await db.select({ usd: max(aiCosts.costUsd) }).from(aiCosts).where(mine);
      if ((prev?.usd ?? 0) > costUsd) return c.json({ costUsd: Math.round(prev!.usd! * 1e6) / 1e6 }, 200);
      await db.delete(aiCosts).where(mine);
      recordCost({
        stage: 'live_realtime', provider: 'openai', model: b.model, costUsd, userId: user.id, sessionId: s.sessionId, paidBy: c.get('payer')!.keys.openai ? 'own_key' : 'house',
        inputTokens: usage.textIn + usage.audioIn + usage.cachedIn, outputTokens: usage.textOut + usage.audioOut, meta: { estimated: true, reported: true, usage },
      });
      return c.json({ costUsd: Math.round(costUsd * 1e6) / 1e6 }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      middleware: [...paid.middleware, requireOwner], // the owner's ElevenLabs / OpenAI keys pay: owner only, 404 for everyone else
      method: 'post',
      path: '/api/live/cascade/stt-token',
      summary: 'Fast cascade examiner (admin playground): credentials for one streaming transcription session (Scribe v2 Realtime or an OpenAI Realtime transcription session)',
      request: body(SessionRef.extend({ stt: z.enum(CASCADE_STT_MODELS).optional().openapi({ description: 'Default scribe_v2_realtime' }), serverVad: z.boolean().optional().openapi({ description: "OpenAI only: the session's own silence detection ends answers (default true); false: the browser commits each answer" }) }).openapi('LiveCascadeSttToken')),
      responses: {
        200: json(
          z
            .object({
              token: z.string().optional().openapi({ description: 'Scribe: the `token` query parameter of wss://api.elevenlabs.io/v1/speech-to-text/realtime' }),
              value: z.string().optional().openapi({ description: 'OpenAI: client secret, Bearer for POST /v1/realtime/calls' }),
              key: z.string().optional().openapi({ description: 'Soniox: temporary API key, the `api_key` of the first message on wss://stt-rt.soniox.com/transcribe-websocket' }),
            })
            .openapi('CascadeSttToken'),
          'Credentials',
        ),
        400: json(CodedError, "invalid_key: OpenAI rejected the user's key"),
        ...needsKey,
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
        502: json(ErrorSchema, 'Transcription provider error'),
        503: json(ErrorSchema, 'ELEVENLABS_API_KEY or SONIOX_API_KEY is not set'),
      },
    }),
    async (c) => {
      const b = c.req.valid('json'), user = currentUser(c), stt = b.stt ?? CASCADE_STT_MODELS[0];
      await loadSession(b.sessionId, user.id);
      if (CASCADE_STTS[stt].provider === 'openai') {
        const payer = c.get('payer')!;
        requireLive(payer, 'realtime-mini');
        const apiKey = liveKey(payer, 'openai')!;
        const t = await mintClientSecret(apiKey, transcriptionSession(stt, b.serverVad ?? true));
        if (!('value' in t)) {
          console.error('openai transcription client_secrets', t.status, redact(t.detail, apiKey));
          if (t.status === 401 || t.status === 403) return rejectedKey(user.id, 'openai', 'OpenAI', payer.keys.openai);
          return c.json({ error: 'Could not start the transcription session. Please retry.' }, 502);
        }
        return c.json({ value: t.value }, 200);
      }
      if (CASCADE_STTS[stt].provider === 'soniox') {
        if (!env.SONIOX_API_KEY) return c.json({ error: 'Soniox is not configured on this server.' }, 503);
        const t = await sonioxToken(env.SONIOX_API_KEY);
        if (!('key' in t)) {
          console.error('soniox temporary-api-key', t.status, redact(t.detail, env.SONIOX_API_KEY));
          return c.json({ error: 'Could not start the transcription session. Please retry.' }, 502);
        }
        return c.json({ key: t.key }, 200);
      }
      if (!env.ELEVENLABS_API_KEY) return c.json({ error: 'ElevenLabs is not configured on this server.' }, 503);
      const t = await scribeToken(env.ELEVENLABS_API_KEY);
      if (!('token' in t)) {
        console.error('elevenlabs single-use-token', t.status, redact(t.detail, env.ELEVENLABS_API_KEY));
        return c.json({ error: 'Could not start the transcription session. Please retry.' }, 502);
      }
      return c.json({ token: t.token }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/cascade/reply',
      summary: "Fast cascade examiner (admin playground): the examiner's next line from the conversation so far (cheap LLM), voiced inline (TTS)",
      request: body(
        CascadeReplyBody.openapi('LiveCascadeReply'),
      ),
      responses: {
        200: json(
          z
            .object({
              text: z.string().openapi({ description: 'What the examiner says; empty = stay silent' }),
              audio: z.string().nullable().openapi({ description: 'Base64 audio of `text`; null when silent or the voice failed' }),
              contentType: z.string().nullable(),
              ms: z.object({ llm: z.number(), tts: z.number() }),
              costUsd: z.number().openapi({ description: 'This reply: STT since the last reply + LLM + TTS (TTS estimated)' }),
            })
            .openapi('CascadeLine'),
          'Next line',
        ),
        ...needsKey,
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
        502: json(ErrorSchema, 'AI service error'),
      },
    }),
    async (c) => {
      const payer = c.get('payer')!, user = currentUser(c), b = c.req.valid('json');
      requireLive(payer, 'turn');
      const s = await loadSession(b.sessionId, user.id);
      const tally = { usd: 0 };
      return keyCtx.run({ ...keyCtx.getStore(), tally }, async () => {
        recordStreamingStt(b, payer);
        const t0 = Date.now();
        const raw = await ai(() => liveDeadline(chatText({ model: b.llm ?? CASCADE_LLMS[0], messages: cascadeMessages(s.test, b.turns), effort: 'none', maxTokens: 200, cost: { stage: 'examiner_llm' } }), 15_000));
        const text = spokenLine(raw), llm = Date.now() - t0;
        const tts = b.tts ?? CASCADE_TTS_MODELS[0];
        const speech = text ? await liveDeadline(cachedSpeech(tts, CASCADE_TTS[tts], text), 12_000).catch((e) => (console.error('cascade TTS failed', (e as Error).message), null)) : null;
        return c.json({ text, audio: speech ? Buffer.from(speech.audio).toString('base64') : null, contentType: speech?.contentType ?? null, ms: { llm, tts: Date.now() - t0 - llm }, costUsd: Math.round(tally.usd * 1e6) / 1e6 }, 200);
      });
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/cascade/transcribe',
      summary: 'Fast cascade examiner (admin playground): one finished answer, or one finished piece of it, transcribed by a batch OpenRouter transcriber',
      request: body(
        SessionRef.extend({
          audio: z.string().min(1).max(8_000_000).openapi({ description: 'Base64 16 kHz mono WAV' }),
          model: z.enum(CASCADE_BATCH_STTS),
        }).openapi('LiveCascadeTranscribe'),
      ),
      responses: {
        200: json(z.object({ text: z.string(), ms: z.number(), costUsd: z.number().nullable() }).openapi('CascadeTranscript'), 'Transcript'),
        ...needsKey,
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
        502: json(ErrorSchema, 'AI service error'),
      },
    }),
    async (c) => {
      const payer = c.get('payer')!, b = c.req.valid('json');
      requireLive(payer, 'turn');
      await loadSession(b.sessionId, currentUser(c).id);
      const t0 = Date.now();
      const r = await ai(() => liveDeadline(transcribeOnce({ model: b.model, audio: new Uint8Array(Buffer.from(b.audio, 'base64')), format: 'wav', language: 'en' }), 15_000));
      return c.json({ text: r.text.trim(), ms: Date.now() - t0, costUsd: r.costUsd }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/cascade/reply-stream',
      summary: "Fast cascade examiner (admin playground): the next line streamed as NDJSON events; with sentenceTts each sentence is voiced as soon as the LLM finishes it",
      request: body(CascadeReplyBody.extend({ sentenceTts: z.boolean().optional().openapi({ description: 'Voice each sentence as soon as it is written (default true); false: one TTS call for the whole line' }) }).openapi('LiveCascadeReplyStream')),
      responses: {
        200: {
          description:
            'application/x-ndjson, one event per line: {type:"text",i,text,ms} per sentence; {type:"audio",i,audio,contentType,ms} per voiced clip (any order, play by i); {type:"done",text,ms:{llmFirst,llm,ttsFirst},costUsd}; {type:"error",error}. ms are since the request arrived.',
          content: { 'application/x-ndjson': { schema: z.string() } },
        },
        ...needsKey,
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
      },
    }),
    async (c) => {
      const payer = c.get('payer')!, user = currentUser(c), b = c.req.valid('json');
      requireLive(payer, 'turn');
      const s = await loadSession(b.sessionId, user.id);
      const tally = { usd: 0 }, store = { ...keyCtx.getStore(), tally };
      const tts = b.tts ?? CASCADE_TTS_MODELS[0], perSentence = b.sentenceTts ?? true;
      const t0 = Date.now(), enc = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start: (ctl) =>
          keyCtx.run(store, async () => {
            const send = (e: object) => ctl.enqueue(enc.encode(JSON.stringify(e) + '\n'));
            const voiced: Promise<void>[] = [];
            let i = 0, llmFirst: number | undefined, ttsFirst: number | undefined, spoken = '';
            const voice = (text: string, n: number) =>
              voiced.push(
                liveDeadline(cachedSpeech(tts, CASCADE_TTS[tts], text), 12_000)
                  .then((sp) => {
                    ttsFirst ??= Date.now() - t0;
                    send({ type: 'audio', i: n, audio: Buffer.from(sp.audio).toString('base64'), contentType: sp.contentType, ms: Date.now() - t0 });
                  })
                  .catch((e) => console.error('cascade TTS failed', (e as Error).message)),
              );
            const say = (raw: string) => {
              const text = spokenLine(raw);
              if (!text) return;
              llmFirst ??= Date.now() - t0;
              spoken = spoken ? `${spoken} ${text}` : text;
              send({ type: 'text', i, text, ms: Date.now() - t0 });
              if (perSentence) voice(text, i);
              i++;
            };
            try {
              recordStreamingStt(b, payer);
              const split = sentenceSplitter();
              await chatTextStream({ model: b.llm ?? CASCADE_LLMS[0], messages: cascadeMessages(s.test, b.turns), effort: 'none', maxTokens: 200, cost: { stage: 'examiner_llm' }, timeoutMs: 15_000, onDelta: (d) => split.push(d).forEach(say) });
              say(split.flush());
              const llm = Date.now() - t0;
              if (!perSentence && spoken) voice(spoken, 0);
              await Promise.all(voiced);
              send({ type: 'done', text: spoken, ms: { llmFirst: llmFirst ?? llm, llm, ttsFirst: ttsFirst ?? null }, costUsd: Math.round(tally.usd * 1e6) / 1e6 });
            } catch (e) {
              send({ type: 'error', error: e instanceof AiError ? e.message : 'The examiner could not reply.' });
            } finally {
              ctl.close();
            }
          }),
      });
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } }) as never;
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/finish',
      summary: 'Finish a live session: one attempt per recorded part (mode live, shared sessionId), each analysed',
      request: body(
        SessionRef.extend({
          parts: z.array(LivePart).max(3).openapi({ description: 'The parts not already sent with /live/part (may be empty)' }),
        }).openapi('LiveFinish'),
      ),
      responses: {
        200: json(z.object({ attemptIds: z.array(z.string()) }).openapi('LiveFinished'), 'Attempts created'),
        400: json(ErrorSchema, 'Bad upload'),
        404: json(ErrorSchema, 'Not found'),
        409: json(ErrorSchema, 'Already finished'),
        402: json(CodedError, 'community_balance_exhausted'),
        503: json(CodedError, 'community_busy'),
        ...tooMany,
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const b = c.req.valid('json');
      await endRun(b.sessionId, user.id); // a GPT-Live session still open ends here, and its transcript is saved before we read the state
      const s = await loadSession(b.sessionId, user.id);
      if (new Set(b.parts.map((p) => p.part)).size !== b.parts.length) return c.json({ error: 'Each part may be sent once' }, 400);
      const ids = await addParts(c, s, user.id, b.parts, true);
      if (typeof ids === 'string') return c.json({ error: ids }, 400);
      if (!ids) return c.json({ error: 'This session was already finished' }, 409);
      return c.json({ attemptIds: ids }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/part',
      summary: 'Send one finished part while the test goes on: its attempt is created and analysed now, so the result is ready sooner. Idempotent per part.',
      request: body(SessionRef.extend({ part: LivePart }).openapi('LivePartSubmit')),
      responses: {
        200: json(z.object({ attemptId: z.string() }).openapi('LivePartCreated'), 'Attempt created (or the existing one for this part)'),
        400: json(ErrorSchema, 'Bad upload'),
        404: json(ErrorSchema, 'Not found'),
        409: json(ErrorSchema, 'Already finished'),
        402: json(CodedError, 'community_balance_exhausted'),
        503: json(CodedError, 'community_busy'),
        ...tooMany,
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const b = c.req.valid('json');
      // GPT-Live keeps the examiner's lines in memory until the session ends: save them now so this part's questions are known to its analysis.
      const run = activeRun(b.sessionId, user.id);
      if (run) await saveTranscript(run).catch((e) => console.error('live/part: saving the transcript failed', e));
      const s = await loadSession(b.sessionId, user.id);
      const ids = await addParts(c, s, user.id, [b.part], false, b.part.part);
      if (typeof ids === 'string') return c.json({ error: ids }, 400);
      if (!ids) return c.json({ error: 'This session was already finished' }, 409);
      return c.json({ attemptId: ids[0]! }, 200);
    },
  );

  // Pipecat examiner (admin playground): the browser's WebRTC signalling goes through here, so the voice service (services/voice) needs no user auth
  // and stays off the public internet. The offer carries the examiner prompt built here; the service reports usage back at the end.
  const PipecatCfg = z
    .object({
      stt: z.enum(['soniox', 'scribe']).optional(),
      llm: z.enum(CASCADE_LLMS).optional(),
      tts: z.enum(['soniox', 'elevenlabs']).optional(),
      ttsModel: z.enum(['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_v4_turbo']).optional(),
      voice: z.string().max(64).optional(),
      vadStopSecs: z.number().min(0.1).max(1.5).optional(),
      smartStopSecs: z.number().min(0.3).max(5).optional(),
    })
    .openapi('PipecatConfig');
  // the voice service derives the same default from the OpenRouter key both already have
  const voiceSecret = env.VOICE_SECRET ?? createHash('sha256').update(`ielts-voice:${env.OPENROUTER_API_KEY}`).digest('hex');
  const voiceFetch = async (method: 'POST' | 'PATCH', body: unknown) => {
    if (!env.VOICE_URL) throw new HTTPException(503, { message: 'The Pipecat examiner is not configured on this server.' });
    const res = await fetch(`${env.VOICE_URL}/api/offer`, { method, headers: { 'content-type': 'application/json', 'x-voice-secret': voiceSecret }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) {
      console.error('voice service', method, res?.status, res && (await res.text()).slice(0, 300));
      throw new HTTPException(502, { message: 'The examiner service did not answer. Please retry.' });
    }
    return res.json();
  };

  app.openapi(
    createRoute({
      ...paid,
      middleware: [...paid.middleware, requireOwner], // house Soniox / OpenRouter / ElevenLabs keys pay: owner only
      method: 'post',
      path: '/api/live/pipecat/offer',
      summary: 'Pipecat examiner (admin playground): WebRTC offer → answer, relayed to the voice service with the examiner prompt',
      request: body(
        z
          .object({ sdp: z.string().max(20_000), type: z.string(), pc_id: z.string().nullish(), restart_pc: z.boolean().nullish(), requestData: z.object({ sessionId: z.string(), cfg: PipecatCfg.optional() }) })
          .openapi('PipecatOffer'),
      ),
      responses: { 200: json(z.object({ sdp: z.string(), type: z.string(), pc_id: z.string() }).passthrough().openapi('PipecatAnswer'), 'SDP answer'), 404: json(ErrorSchema, 'Not found'), ...tooMany, 502: json(ErrorSchema, 'Voice service error'), 503: json(ErrorSchema, 'Not configured') },
    }),
    async (c) => {
      const b = c.req.valid('json'), user = currentUser(c);
      const s = await loadSession(b.requestData.sessionId, user.id), cfg = b.requestData.cfg ?? {};
      if ((cfg.stt ?? 'soniox') === 'soniox' || (cfg.tts ?? 'soniox') === 'soniox') {
        if (!env.SONIOX_API_KEY) return c.json({ error: 'Soniox is not configured on this server (SONIOX_API_KEY). Pick Scribe and ElevenLabs, or add the key.' }, 503);
      }
      const request_data = {
        sessionId: b.requestData.sessionId,
        userId: user.id,
        cfg,
        prompt: cascadeMessages(s.test, [])[0]!.content,
        cuePrefix: CUE_PREFIX,
        reportUrl: `${env.BETTER_AUTH_URL}/api/live/pipecat/usage`,
      };
      return c.json((await voiceFetch('POST', { sdp: b.sdp, type: b.type, pc_id: b.pc_id, restart_pc: b.restart_pc, request_data })) as { sdp: string; type: string; pc_id: string }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      middleware: [...paid.middleware, requireOwner],
      method: 'patch',
      path: '/api/live/pipecat/offer',
      summary: 'Pipecat examiner (admin playground): trickled ICE candidates, relayed to the voice service',
      request: body(z.object({ pc_id: z.string(), candidates: z.array(z.object({ candidate: z.string(), sdp_mid: z.string().nullish(), sdp_mline_index: z.number().nullish() })).max(50) }).openapi('PipecatIce')),
      responses: { 200: json(z.object({ status: z.string() }), 'Relayed'), 404: json(ErrorSchema, 'Not found'), ...tooMany, 502: json(ErrorSchema, 'Voice service error'), 503: json(ErrorSchema, 'Not configured') },
    }),
    async (c) => c.json((await voiceFetch('PATCH', c.req.valid('json'))) as { status: string }, 200),
  );

  app.openapi(
    createRoute({
      tags: ['Live'],
      method: 'post',
      path: '/api/live/pipecat/usage',
      summary: "Voice service only (x-voice-secret): one Pipecat session's usage for the cost ledger",
      request: body(
        z
          .object({
            sessionId: z.string(),
            userId: z.string(),
            cfg: z.object({ stt: z.string(), llm: z.string(), tts: z.string() }).passthrough(),
            seconds: z.number().min(0),
            sttUsd: z.number().min(0),
            llmTokensIn: z.number().int().min(0),
            llmTokensOut: z.number().int().min(0),
            ttsChars: z.number().int().min(0),
            usd: z.number().min(0),
          })
          .openapi('PipecatUsage'),
      ),
      responses: { 204: { description: 'Recorded' }, 403: json(ErrorSchema, 'Bad secret') },
    }),
    async (c) => {
      const secret = c.req.header('x-voice-secret') ?? '';
      if (secret.length !== voiceSecret.length || !timingSafeEqual(Buffer.from(secret), Buffer.from(voiceSecret))) return c.json({ error: 'Forbidden' }, 403);
      const u = c.req.valid('json'), who = { userId: u.userId, sessionId: u.sessionId, paidBy: 'house' as const, meta: { estimated: true, engine: 'pipecat', cfg: u.cfg } };
      const llmUsd = u.usd - u.sttUsd - (u.ttsChars * (u.cfg.tts === 'soniox' ? 0.014 / 1000 : 20 / 1e6));
      recordCost({ ...who, stage: 'live_stt', provider: u.cfg.stt === 'scribe' ? 'elevenlabs' : 'soniox', model: u.cfg.stt, costUsd: u.sttUsd, audioSeconds: u.seconds });
      recordCost({ ...who, stage: 'examiner_llm', provider: 'openrouter', model: u.cfg.llm, costUsd: Math.max(0, llmUsd), inputTokens: u.llmTokensIn, outputTokens: u.llmTokensOut });
      recordCost({ ...who, stage: 'examiner_tts', provider: u.cfg.tts === 'soniox' ? 'soniox' : 'elevenlabs', model: u.cfg.tts, costUsd: u.usd - u.sttUsd - Math.max(0, llmUsd), characters: u.ttsChars });
      return c.body(null, 204);
    },
  );
}
