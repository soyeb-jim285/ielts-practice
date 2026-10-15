import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRoute, z } from '@hono/zod-openapi';
import { DEFAULT_LIVEKIT, LIVEKIT_TTS_MODELS, livekitPartConfig, type LiveKitConfig } from '@ielts/core';
import { and, eq, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { cascadeMessages } from '../ai/cascade';
import { CUE_PREFIX, type LiveState } from '../ai/examiner';
import { currentUser, isOwner, requireUser } from '../auth';
import { db } from '../db/client';
import { aiCosts, liveSessions } from '../db/schema';
import { env } from '../env';
import { clientIpHash } from '../ip';
import { reserve, withPayer } from '../quota';
import { aiLimit } from '../ratelimit';
import type { App } from '../types';

const llms = ['openai/gpt-6-luna', 'deepseek/deepseek-v4.1-flash'] as const;
const Part = z.object({
  stt: z.enum(['soniox', 'elevenlabs']),
  sttModel: z.enum(['stt-rt-v5', 'scribe_v2_realtime']),
  llm: z.enum(llms),
  tts: z.enum(['soniox', 'cartesia', 'elevenlabs', 'inworld', 'gradium']),
  ttsModel: z.string().min(1).max(64),
  voice: z.string().trim().min(1).max(128),
  turnDetection: z.enum(['audio', 'vad']),
  minEndpointDelay: z.number().min(0).max(10),
  maxEndpointDelay: z.number().min(0.1).max(10),
  vadSilence: z.number().min(0.1).max(2),
  interruptions: z.boolean(),
  preemptiveGeneration: z.boolean(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(16).max(2048),
}).strict();
const Config = Part.partial().extend({ parts: z.object({ '1': Part.partial().optional(), '2': Part.partial().optional(), '3': Part.partial().optional() }).strict().optional() }).strict().superRefine((v, ctx) => {
  const cfg = { ...DEFAULT_LIVEKIT, ...v } as LiveKitConfig;
  for (const part of ['base', '1', '2', '3'] as const) {
    const p = part === 'base' ? cfg : livekitPartConfig(cfg, part);
    const path = part === 'base' ? [] : ['parts', part];
    if (p.minEndpointDelay > p.maxEndpointDelay) ctx.addIssue({ code: 'custom', path: [...path, 'minEndpointDelay'], message: 'Minimum endpoint delay exceeds maximum' });
    if (p.sttModel !== (p.stt === 'soniox' ? 'stt-rt-v5' : 'scribe_v2_realtime')) ctx.addIssue({ code: 'custom', path: [...path, 'sttModel'], message: 'STT model does not match provider' });
    if (!(LIVEKIT_TTS_MODELS[p.tts] as readonly string[]).includes(p.ttsModel)) ctx.addIssue({ code: 'custom', path: [...path, 'ttsModel'], message: 'TTS model does not match provider' });
  }
}).openapi('LiveKitConfig');

const Entry = z.object({
  stage: z.enum(['live_stt', 'examiner_llm', 'examiner_tts']),
  provider: z.enum(['openrouter', 'soniox', 'elevenlabs', 'cartesia', 'inworld', 'gradium']),
  model: z.string().min(1).max(128),
  costUsd: z.number().min(0).max(100),
  inputTokens: z.number().int().min(0).max(10_000_000).optional(),
  outputTokens: z.number().int().min(0).max(1_000_000).optional(),
  audioSeconds: z.number().min(0).max(7200).optional(),
  characters: z.number().int().min(0).max(1_000_000).optional(),
  meta: z.record(z.string().max(64), z.union([z.string().max(1024), z.number(), z.boolean(), z.null()])).refine((m) => Object.keys(m).length <= 32, 'Too many metadata fields').optional(),
}).strict().superRefine((e, ctx) => {
  const valid = e.stage === 'examiner_llm'
    ? e.provider === 'openrouter' && (llms as readonly string[]).includes(e.model)
    : e.stage === 'live_stt'
      ? (e.provider === 'soniox' && e.model === 'stt-rt-v5') || (e.provider === 'elevenlabs' && e.model === 'scribe_v2_realtime')
      : e.provider !== 'openrouter' && (LIVEKIT_TTS_MODELS[e.provider] as readonly string[]).includes(e.model);
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid stage/provider/model combination' });
});
const Usage = z.object({
  sessionId: z.string().min(1).max(128), userId: z.string().min(1).max(128),
  reportId: z.string().min(1).max(128), entries: z.array(Entry).min(1).max(1000),
}).strict().refine((u) => u.entries.reduce((n, e) => n + e.costUsd, 0) <= 100, 'Report cost exceeds limit').openapi('LiveKitUsage');
const Claims = z.object({ sessionId: z.string(), userId: z.string(), roomName: z.string().regex(/^ielts-[a-f0-9-]+$/), expiresAt: z.number() }).strict();
const error = z.object({ error: z.string() });
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
/** Rooms one session may open (first connect + reconnects). */
const LIVEKIT_ROOMS = 3;
const signature = (payload: string) => createHmac('sha256', env.LIVEKIT_REPORT_SECRET!).update(`livekit-report:${payload}`).digest('base64url');

export function attachLiveKit(app: App, loadSession: (sessionId: string, userId: string) => Promise<LiveState>) {
  app.openapi(createRoute({
    method: 'post', path: '/api/live/livekit/start', tags: ['Live'], security: [{ bearer: [] }],
    middleware: [requireUser, withPayer, aiLimit],
    summary: 'Create a private LiveKit room and dispatch its examiner. Runs on the server keys: the session is reserved as the speaking test (1 a day, guests 1 a week; owner exempt). Only the owner may send cfg.',
    request: body(z.object({ sessionId: z.string().min(1).max(128), cfg: Config.optional() }).strict()),
    responses: {
      200: json(z.object({ url: z.string(), token: z.string(), roomName: z.string(), participantIdentity: z.string() }).openapi('LiveKitStart'), 'Room scoped candidate token'),
      400: json(error, 'Invalid config'), 404: json(error, 'Not found'), 409: json(error, 'Session finished'),
      402: json(error, 'community_balance_exhausted'), 403: json(error, 'cfg is owner-only'),
      429: json(error, 'Rate limited, quota_exceeded, or too many reconnects'), 502: json(error, 'LiveKit unavailable'), 503: json(error, 'Not configured'),
    },
  }), async (c) => {
    const b = c.req.valid('json'), user = currentUser(c), owner = isOwner(user);
    if (b.cfg && !owner) return c.json({ error: 'Only the owner may configure the examiner.' }, 403);
    const s = await loadSession(b.sessionId, user.id);
    if (s.phase === 'done') return c.json({ error: 'This live session is finished.' }, 409);
    // Reconnects of a dropped session are free, a few times; past that it would be an endless free test.
    if (!owner && (s.livekitRooms ?? 0) >= LIVEKIT_ROOMS) return c.json({ error: 'This session has reconnected too many times. Start a new test.' }, 429);
    if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_REPORT_SECRET || env.LIVEKIT_REPORT_SECRET.length < 32) return c.json({ error: 'LiveKit is not configured on this server.' }, 503);
    // Parse even the omitted config so defaults and all effective overrides receive the same validation.
    const cfg: LiveKitConfig = { ...DEFAULT_LIVEKIT, ...Config.parse(b.cfg ?? {}) };
    const credentials = { soniox: env.SONIOX_API_KEY, elevenlabs: env.ELEVENLABS_API_KEY, cartesia: env.CARTESIA_API_KEY, inworld: env.INWORLD_API_KEY, gradium: env.GRADIUM_API_KEY };
    const rates = { elevenlabs: env.ELEVENLABS_USD_PER_M_CHARS, cartesia: env.CARTESIA_USD_PER_M_CHARS, inworld: env.INWORLD_USD_PER_M_CHARS, gradium: env.GRADIUM_USD_PER_M_CHARS };
    for (const p of [cfg, ...(['1', '2', '3'] as const).map((part) => livekitPartConfig(cfg, part))]) {
      if (!env.OPENROUTER_API_KEY || !credentials[p.stt] || !credentials[p.tts]) return c.json({ error: 'A selected LiveKit provider is not configured on this server.' }, 503);
      if (p.tts !== 'soniox' && (!rates[p.tts]?.trim() || !Number.isFinite(Number(rates[p.tts])) || Number(rates[p.tts]) < 0)) return c.json({ error: 'Set the selected LiveKit TTS provider plan rate before starting.' }, 503);
    }
    const payer = c.get('payer')!;
    // The server pays for LiveKit, so own-key users are limited like everyone else (their own key only pays the scoring).
    if (!owner) await reserve(payer.tier === 'own-key' ? { ...payer, tier: 'community' } : payer, 'speaking', b.sessionId, clientIpHash(c));
    s.livekitRooms = (s.livekitRooms ?? 0) + 1;
    await db.update(liveSessions).set({ state: s }).where(and(eq(liveSessions.id, b.sessionId), eq(liveSessions.userId, user.id)));
    const roomName = `ielts-${crypto.randomUUID()}`, participantIdentity = `candidate-${crypto.randomUUID()}`;
    const payload = Buffer.from(JSON.stringify({ sessionId: b.sessionId, userId: user.id, roomName, expiresAt: Date.now() + 86_400_000 })).toString('base64url');
    const reportToken = `${payload}.${signature(payload)}`;
    const host = env.LIVEKIT_URL.replace(/^ws/, 'http');
    const rooms = new RoomServiceClient(host, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { requestTimeout: 15 });
    const dispatch = new AgentDispatchClient(host, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { requestTimeout: 15 });
    let created = false;
    try {
      const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity: participantIdentity, ttl: '5m' });
      // TTL limits joining/rejoining, not how long an established connection stays open.
      token.addGrant({ roomJoin: true, room: roomName, canSubscribe: true, canPublish: true, canPublishData: true, canPublishSources: [2 /* MICROPHONE */], canUpdateOwnMetadata: false });
      const jwt = await token.toJwt();
      await rooms.createRoom({ name: roomName, emptyTimeout: 60, departureTimeout: 20, maxParticipants: 2 });
      created = true;
      // Dispatch metadata is worker-only. Room metadata is visible to candidate clients.
      await dispatch.createDispatch(roomName, env.LIVEKIT_AGENT_NAME, { metadata: JSON.stringify({
        sessionId: b.sessionId, userId: user.id, participantIdentity,
        prompt: cascadeMessages(s.test, [])[0]!.content, cuePrefix: CUE_PREFIX,
        reportUrl: `${env.BETTER_AUTH_URL.replace(/\/$/, '')}/api/live/livekit/usage`, reportToken, cfg,
      }) });
      return c.json({ url: env.LIVEKIT_URL, token: jwt, roomName, participantIdentity }, 200);
    } catch {
      if (created) await rooms.deleteRoom(roomName).catch(() => console.error('LiveKit room cleanup failed', roomName));
      return c.json({ error: 'Could not start the LiveKit examiner. Please retry.' }, 502);
    }
  });

  app.openapi(createRoute({
    method: 'post', path: '/api/live/livekit/usage', tags: ['Live'],
    summary: 'Worker-only signed per-room usage report, durably idempotent by reportId',
    request: body(Usage),
    responses: { 204: { description: 'Recorded, or already recorded' }, 400: json(error, 'Invalid report'), 403: json(error, 'Forbidden'), 404: json(error, 'Session not found') },
  }), async (c) => {
    const b = c.req.valid('json'), token = c.req.header('x-livekit-report-token') ?? '';
    if (!env.LIVEKIT_REPORT_SECRET || env.LIVEKIT_REPORT_SECRET.length < 32 || token.length > 2048) return c.json({ error: 'Forbidden' }, 403);
    const [payload, sig, extra] = token.split('.');
    if (!payload || !sig || extra !== undefined) return c.json({ error: 'Forbidden' }, 403);
    const expected = Buffer.from(signature(payload)), actual = Buffer.from(sig);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return c.json({ error: 'Forbidden' }, 403);
    let claims: z.infer<typeof Claims>;
    try { claims = Claims.parse(JSON.parse(Buffer.from(payload, 'base64url').toString())); }
    catch { return c.json({ error: 'Forbidden' }, 403); }
    if (claims.sessionId !== b.sessionId || claims.userId !== b.userId || claims.expiresAt < Date.now()) return c.json({ error: 'Forbidden' }, 403);
    await db.transaction(async (tx) => {
      // Lock the durable session row, serializing reports across processes and restarts.
      const [session] = await tx.select({ id: liveSessions.id }).from(liveSessions).where(and(eq(liveSessions.id, b.sessionId), eq(liveSessions.userId, b.userId))).for('update');
      if (!session) throw new HTTPException(404, { message: 'Live session not found' });
      const [existing] = await tx.select({ id: aiCosts.id }).from(aiCosts).where(and(
        eq(aiCosts.sessionId, b.sessionId), eq(aiCosts.userId, b.userId),
        sql`${aiCosts.meta}->>'engine' = 'livekit'`, sql`${aiCosts.meta}->>'roomName' = ${claims.roomName}`, sql`${aiCosts.meta}->>'reportId' = ${b.reportId}`,
      )).limit(1);
      if (existing) return;
      // recordCost is intentionally fire-and-forget: use an awaited insert here to commit the whole report atomically.
      await tx.insert(aiCosts).values(b.entries.map((e) => ({
        ...e, userId: b.userId, sessionId: b.sessionId, skill: 'speaking', paidBy: 'house',
        meta: { ...e.meta, engine: 'livekit', reportId: b.reportId, roomName: claims.roomName, estimated: true },
      })));
    });
    return c.body(null, 204);
  });
}
