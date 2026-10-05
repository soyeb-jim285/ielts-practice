import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { candidateFacts, EXAMINER_SYSTEM, direction, GPT_LIVE_CUES, gptLiveCue, newState, nextPhase, PREP_MS, scriptedLine, type LiveState, type Turn } from '../ai/examiner';
import { activeRun, attachSideband, createWebrtcSession, endRun } from '../ai/gpt-live';
import { geminiTokenRequest, mintGeminiToken } from '../ai/gemini-live';
import { recordCost } from '../ai/cost';
import { keyCtx, redact } from '../ai/keyctx';
import { AiError, chatText, speak, transcribe } from '../ai/openrouter';
import { currentUser, requireUser } from '../auth';
import { db } from '../db/client';
import { attempts, liveSessions } from '../db/schema';
import { env } from '../env';
import { ApiError } from '../errors';
import { clientIpHash } from '../ip';
import { runAnalysis } from '../jobs';
import { markKeyInvalid } from '../keys';
import { checkStart, liveKey, requireLive, reserve, withPayer } from '../quota';
import { getSettings, type Settings } from '../settings';
import { aiLimit } from '../ratelimit';
import { storage, uploadError } from '../storage';
import type { App } from '../types';
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

/** TTS for history entry n, stored at live/{sessionId}/e{n}.mp3 (or .wav for PCM-only voices). A TTS failure degrades to captions only (url null) instead of failing the turn. */
async function voice(s: LiveState, n: number, text: string, settings: Settings): Promise<{ key?: string; url: string | null; voiceError?: string }> {
  const { tts, ttsVoice } = settings.models;
  try {
    const k = `${tts}|${ttsVoice}|${text}`;
    let speech = speechCache.get(k);
    if (!speech) {
      speech = await speak({ model: tts, voice: ttsVoice, text });
      speechCache.set(k, speech);
      if (speechCache.size > 40) speechCache.delete(speechCache.keys().next().value!);
    }
    const { audio, contentType } = speech;
    const key = `live/${s.sessionId}/e${n}.${contentType === 'audio/wav' ? 'wav' : 'mp3'}`;
    await storage.put(key, audio, contentType);
    return { key, url: await storage.presignGet(key) };
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
      const { source: asked, skipTts, mockId } = c.req.valid('json');
      const mock = mockId ? await liveMock(user.id, mockId) : null;
      const source = mock?.source ?? asked;
      const payer = c.get('payer')!;
      requireLive(payer, skipTts ? 'duplex' : 'turn');
      await checkStart(payer, 'speaking', clientIpHash(c)); // its analysis may still run on the community balance: tell them now, not after 14 minutes
      const picked = await pickSpeakingTest(user, source, mock?.ref);
      if (!picked) return c.json({ error: 'No speaking test available' }, 404);
      const test = { ...picked, branches: await pickP1Branches(user) };
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
        const r = await ai(async () => transcribe({ model: settings.models.stt, audio: await storage.get(audioKey!), format: audioKey!.split('.').pop() as 'webm', verbatim: false }));
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
        text = (await ai(() => chatText({ model: settings.models.examiner, messages: [{ role: 'system', content: EXAMINER_SYSTEM(s) }, ...messages], effort: 'low', maxTokens: 200, cost: { stage: 'examiner_llm' } }))).trim() || direction(s).fallback;
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
      request: body(SessionRef.openapi('LiveGeminiToken')),
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
      const s = await loadSession(c.req.valid('json').sessionId, currentUser(c).id);
      const model = env.GEMINI_LIVE_MODEL;
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
      path: '/api/live/finish',
      summary: 'Finish a live session: one attempt per recorded part (mode live, shared sessionId), each analysed',
      request: body(
        SessionRef.extend({
          parts: z
            .array(
              z.object({
                part: z.union([z.literal(1), z.literal(2), z.literal(3)]),
                audioKey: z.string(),
                durationMs: z.number().int().min(0),
                energy: z.array(z.number().int().min(0).max(255)).max(20000).optional(),
                marks: z.array(z.number().int().min(0)).max(200).optional().openapi({ description: 'Question start offsets (ms) within this part' }),
              }),
            )
            .min(1)
            .max(3),
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
      for (const p of b.parts) {
        const bad = await uploadError(ownKey(s, p.audioKey));
        if (bad) return c.json({ error: `${bad} (part ${p.part})` }, 400);
      }
      const promptId = { 1: s.test.part1[0]!.id, 2: s.test.part2.id, 3: s.test.part3.id };
      // A retried finish (client retry after a lost response) must not reserve again: if the first one's analysis failed and was refunded, that would charge a test for nothing.
      if ((await db.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.sessionId, s.sessionId), eq(attempts.userId, user.id))).limit(1)).length) return c.json({ error: 'This session was already finished' }, 409);
      // One speaking test for the whole session. Normally already checked at start; reserved now, before any analysis spends community credit.
      const ids = b.parts.map(() => crypto.randomUUID()); // the parts are members of the payment, so none can be re-submitted for free later
      await reserve(c.get('payer')!, 'speaking', s.sessionId, clientIpHash(c), b.parts.map((p, i) => ({ part: p.part, id: ids[i]! })));
      const rows = await db.transaction(async (tx) => {
        // Row lock serialises concurrent finishes (double click, client retry): the second one then sees the first's attempts.
        await tx.select({ id: liveSessions.id }).from(liveSessions).where(and(eq(liveSessions.id, s.sessionId), eq(liveSessions.userId, user.id))).for('update');
        const [existing] = await tx.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.sessionId, s.sessionId), eq(attempts.userId, user.id))).limit(1);
        if (existing) return null;
        s.phase = 'done';
        await tx.update(liveSessions).set({ state: s }).where(eq(liveSessions.id, s.sessionId));
        return tx
          .insert(attempts)
          .values(
            b.parts.map((p, i) => ({
              id: ids[i]!,
              userId: user.id,
              promptId: promptId[p.part],
              skill: 'speaking' as const,
              part: p.part,
              mode: 'live' as const,
              sessionId: s.sessionId,
              audioKey: p.audioKey,
              audioMime: MIME[p.audioKey.split('.').pop()!] ?? 'audio/webm',
              durationMs: p.durationMs,
              energy: p.energy,
              marks: p.marks,
              status: 'analyzing' as const,
            })),
          )
          .returning({ id: attempts.id });
      });
      if (!rows) return c.json({ error: 'This session was already finished' }, 409);
      for (const r of rows) void runAnalysis(r.id);
      return c.json({ attemptIds: rows.map((r) => r.id) }, 200);
    },
  );
}
