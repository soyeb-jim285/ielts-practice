import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { newState, sessionScript, type LiveState } from '../ai/examiner';
import { keyCtx } from '../ai/keyctx';
import { currentUser, requireUser } from '../auth';
import { db } from '../db/client';
import { attempts, liveSessions } from '../db/schema';
import { clientIpHash } from '../ip';
import { runAnalysis } from '../jobs';
import { checkStart, requireLive, reserve, withPayer } from '../quota';
import { aiLimit } from '../ratelimit';
import { storage, uploadError } from '../storage';
import type { App, AppEnv } from '../types';
import { CodedError } from './community';
import { liveMock } from './mock';
import { attachLiveKit } from './livekit';
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
const SessionRef = z.object({ sessionId: z.string() });

async function loadSession(sessionId: string, userId: string) {
  const row = await db.query.liveSessions.findFirst({ where: and(eq(liveSessions.id, sessionId), eq(liveSessions.userId, userId)) });
  if (!row) throw new HTTPException(404, { message: 'Live session not found' });
  const cost = keyCtx.getStore()?.cost;
  if (cost) cost.sessionId = sessionId; // this session's cost rows belong to it
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

/** Candidate uploads must live under this session's prefix. */
function ownKey(s: LiveState, key: string) {
  if (!key.startsWith(`live/${s.sessionId}/`) || key.includes('..')) throw new HTTPException(400, { message: 'Invalid audio key' });
  return key;
}

export function register(app: App) {
  attachLiveKit(app, loadSession);
  app.openapi(
    createRoute({
      ...paid,
      method: 'post',
      path: '/api/live/start',
      summary: 'Start a live examiner session: picks a full speaking test and returns its opening line; the LiveKit examiner (POST /api/live/livekit/start) speaks it',
      request: body(
        z
          .object({
            source: z.enum(['generated', 'cambridge', 'any']).default('any'),
            mockId: z.string().optional().openapi({ description: 'Full mock test: use the mock\'s Cambridge test (ref) and require its speaking mode to be live' }),
            localHour: z.number().int().min(0).max(23).optional().openapi({ description: "The candidate's local hour (0-23): the examiner greets with Good morning / afternoon / evening; without it, Hello" }),
          })
          .openapi('LiveStart'),
      ),
      description: 'A user without an OpenRouter key needs a test left (429 quota_exceeded, 402 community_balance_exhausted). 503 when the live examiner is not configured.',
      responses: {
        402: json(CodedError, 'community_balance_exhausted'),
        503: json(CodedError, 'community_busy'),
        200: json(
          z.object({ sessionId: z.string(), examinerText: z.string(), phase: Phase, test: z.object({ part1: z.array(PromptSchema), part2: PromptSchema, part3: PromptSchema }) }).openapi('LiveStarted'),
          'Session started',
        ),
        404: json(ErrorSchema, 'Bank is empty'),
        ...tooMany,
        502: json(ErrorSchema, 'AI service error'),
      },
    }),
    async (c) => {
      const user = currentUser(c);
      const { source: asked, mockId, localHour } = c.req.valid('json');
      const mock = mockId ? await liveMock(user.id, mockId) : null;
      const source = mock?.source ?? asked;
      const payer = c.get('payer')!;
      requireLive();
      await checkStart(payer, 'speaking', clientIpHash(c)); // its analysis may still run on the community balance: tell them now, not after 14 minutes
      const picked = await pickSpeakingTest(user, source, mock?.ref);
      if (!picked) return c.json({ error: 'No speaking test available' }, 404);
      const test = { ...picked, branches: await pickP1Branches(user), script: sessionScript(localHour, picked.part1[0]?.topic) };
      const sessionId = crypto.randomUUID();
      const s = newState(sessionId, test, Date.now());
      await db.insert(liveSessions).values({ id: sessionId, userId: user.id, state: s });
      return c.json({ sessionId, test, examinerText: s.history[0]!.text, phase: s.phase }, 200);
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
      const s = await loadSession(b.sessionId, user.id);
      const ids = await addParts(c, s, user.id, [b.part], false, b.part.part);
      if (typeof ids === 'string') return c.json({ error: ids }, 400);
      if (!ids) return c.json({ error: 'This session was already finished' }, 409);
      return c.json({ attemptId: ids[0]! }, 200);
    },
  );

}
