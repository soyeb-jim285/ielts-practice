import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { EXAMINER_SYSTEM, direction, newState, nextPhase, PREP_MS, realtimeInstructions, scriptedLine, type LiveState } from '../ai/examiner';
import { AiError, chatText, speak, transcribe } from '../ai/openrouter';
import { currentUser, requireUser } from '../auth';
import { db } from '../db/client';
import { attempts, liveSessions } from '../db/schema';
import { env } from '../env';
import { runAnalysis } from '../jobs';
import { getSettings, type Settings } from '../settings';
import { aiLimit } from '../ratelimit';
import { storage, uploadError } from '../storage';
import type { App } from '../types';
import { pickSpeakingTest, PromptSchema } from './prompts';

const REALTIME_MODEL = 'gpt-realtime';
const AUDIO_EXT: Record<string, 'webm' | 'm4a' | 'wav'> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav' };
const MIME: Record<string, string> = { webm: 'audio/webm', m4a: 'audio/mp4', wav: 'audio/wav' };

const Phase = z.enum(['intro', 'p1', 'p2-prep', 'p2-talk', 'p2-follow', 'p3', 'closing', 'done']);
const ErrorSchema = z.object({ error: z.string() }).openapi('Error');
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const authed = { tags: ['Live'], security: [{ bearer: [] }], middleware: [requireUser] };
/** Routes that spend AI credit: rate-limited per user. */
const paid = { ...authed, middleware: [requireUser, aiLimit] };
const tooMany = { 429: json(ErrorSchema, 'Too many requests') };
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
  return row.state as LiveState;
}

const save = (s: LiveState) => db.update(liveSessions).set({ state: s }).where(eq(liveSessions.id, s.sessionId));

/** Candidate uploads must live under this session's prefix. */
function ownKey(s: LiveState, key: string) {
  if (!key.startsWith(`live/${s.sessionId}/`) || key.includes('..')) throw new HTTPException(400, { message: 'Invalid audio key' });
  return key;
}

/** TTS for history entry n, stored at live/{sessionId}/e{n}.mp3 (or .wav for PCM-only voices). A TTS failure degrades to captions only (url null) instead of failing the turn. */
async function voice(s: LiveState, n: number, text: string, settings: Settings): Promise<{ key?: string; url: string | null; voiceError?: string }> {
  const { tts, ttsVoice } = settings.models;
  try {
    const { audio, contentType } = await speak({ model: tts, voice: ttsVoice, text });
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
            skipTts: z.boolean().default(false).openapi({ description: 'Realtime sessions speak for themselves: create the session without examiner TTS (audioUrl null)' }),
          })
          .openapi('LiveStart'),
      ),
      responses: {
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
      const { source, skipTts } = c.req.valid('json');
      const test = await pickSpeakingTest(user, source);
      if (!test) return c.json({ error: 'No speaking test available' }, 404);
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
        ...tooMany,
        502: json(ErrorSchema, 'AI service error'),
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const b = c.req.valid('json');
      const s = await loadSession(b.sessionId, user.id);
      if (s.phase === 'done') return c.json({ error: 'The test is already over' }, 409);
      const settings = await getSettings(user.id);
      const now = Date.now();

      let transcript: string | undefined;
      if (s.phase !== 'p2-prep') {
        let durationMs: number | undefined;
        if (b.audioKey && !b.skipped) {
          const key = ownKey(s, b.audioKey);
          const bad = await uploadError(key);
          if (bad) return c.json({ error: bad }, 400);
          const r = await ai(async () => transcribe({ model: settings.models.stt, audio: await storage.get(key), format: key.split('.').pop() as 'webm' }));
          transcript = r.text.trim();
          durationMs = Math.round(r.duration * 1000);
        }
        s.history.push({ role: 'candidate', text: transcript || '[no response]', at: now, audioKey: b.audioKey, durationMs, phase: s.phase });
      }

      const phase = nextPhase(s, now);
      if (phase !== s.phase) Object.assign(s, { phase, phaseStartedAt: now });
      let text = scriptedLine(s);
      if (text === null) {
        const messages = s.history.map((h) => ({ role: h.role === 'examiner' ? ('assistant' as const) : ('user' as const), content: h.text }));
        text = (await ai(() => chatText({ model: settings.models.examiner, messages: [{ role: 'system', content: EXAMINER_SYSTEM(s) }, ...messages] }))).trim() || direction(s).fallback;
      }
      if (s.phase === 'p1') s.p1Asked++;
      if (s.phase === 'p3') s.p3Asked++;

      const audio = await voice(s, s.history.length, text, settings);
      s.history.push({ role: 'examiner', text, at: now, audioKey: audio.key, phase: s.phase });
      if (s.phase === 'closing') s.phase = 'done';
      await save(s);
      const prep = s.phase === 'p2-prep' ? { prepSeconds: Math.max(0, Math.ceil((s.phaseStartedAt + PREP_MS - now) / 1000)), cueCard: s.test.part2 } : {};
      return c.json({ examinerText: text, audioUrl: audio.url, voiceError: audio.voiceError, phase: s.phase, transcript, ...prep }, 200);
    },
  );

  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/realtime-token',
      summary: 'Ephemeral OpenAI Realtime client secret carrying the examiner instructions for this session',
      request: body(SessionRef.openapi('LiveRealtimeToken')),
      responses: {
        200: json(z.object({ value: z.string(), expiresAt: z.number().openapi({ description: 'Unix seconds' }), model: z.string() }).openapi('RealtimeToken'), 'Client secret'),
        400: json(ErrorSchema, 'Realtime not configured'),
        404: json(ErrorSchema, 'Not found'),
        ...tooMany,
        502: json(ErrorSchema, 'OpenAI error'),
      },
    }),
    async (c) => {
      if (!env.OPENAI_API_KEY) return c.json({ error: 'OpenAI Realtime is not configured on this server' }, 400);
      const s = await loadSession(c.req.valid('json').sessionId, currentUser(c).id);
      const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session: { type: 'realtime', model: REALTIME_MODEL, instructions: realtimeInstructions(s.test), audio: { output: { voice: 'marin' } } },
        }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      if (!res?.ok) {
        console.error('realtime client_secrets', res?.status, (await res?.text().catch(() => ''))?.slice(0, 500));
        return c.json({ error: 'Could not start a realtime session. Please retry or use the turn-based examiner.' }, 502);
      }
      const d = (await res.json()) as { value: string; expires_at: number };
      return c.json({ value: d.value, expiresAt: d.expires_at, model: REALTIME_MODEL }, 200);
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
        ...tooMany,
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const b = c.req.valid('json');
      const s = await loadSession(b.sessionId, user.id);
      if (new Set(b.parts.map((p) => p.part)).size !== b.parts.length) return c.json({ error: 'Each part may be sent once' }, 400);
      for (const p of b.parts) {
        const bad = await uploadError(ownKey(s, p.audioKey));
        if (bad) return c.json({ error: `${bad} (part ${p.part})` }, 400);
      }
      const promptId = { 1: s.test.part1[0]!.id, 2: s.test.part2.id, 3: s.test.part3.id };
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
            b.parts.map((p) => ({
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
