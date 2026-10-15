import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { req, seedPrompt, testUser } from '../test/helpers';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { aiCosts, liveSessions } from '../db/schema';
import { OWNER_EMAILS } from '../auth';
import { env } from '../env';

const sdk = vi.hoisted(() => ({ createRoom: vi.fn(), deleteRoom: vi.fn(), createDispatch: vi.fn(), addGrant: vi.fn(), token: vi.fn() }));
vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class { createRoom = sdk.createRoom; deleteRoom = sdk.deleteRoom; },
  AgentDispatchClient: class { createDispatch = sdk.createDispatch; },
  AccessToken: class { constructor(...args: unknown[]) { sdk.token(...args); } addGrant = sdk.addGrant; toJwt = async () => 'candidate-token'; },
}));

const originalEnv = { ...env };
afterEach(() => {
  for (const key of Object.keys(env)) if (!(key in originalEnv)) Reflect.deleteProperty(env, key);
  Object.assign(env, originalEnv);
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  sdk.createRoom.mockResolvedValue({});
  sdk.createDispatch.mockResolvedValue({});
  sdk.deleteRoom.mockResolvedValue(undefined);
  Object.assign(env, { LIVEKIT_URL: 'wss://example.livekit.cloud', LIVEKIT_API_KEY: 'lk-key', LIVEKIT_API_SECRET: 'lk-secret', LIVEKIT_REPORT_SECRET: 'r'.repeat(32), LIVEKIT_AGENT_NAME: 'ielts-examiner', SONIOX_API_KEY: 'soniox' });
});

async function session() {
  const owner = await testUser(OWNER_EMAILS[0]!);
  for (const topic of ['home', 'food', 'work']) await seedPrompt({ topic, followUps: ['Why?'] });
  await seedPrompt({ part: 2, type: 'cue-card', groupId: 'lk', title: 'Describe a book' });
  await seedPrompt({ part: 3, type: 'p3-discussion', groupId: 'lk', followUps: ['Why read?'] });
  const res = await req('/api/live/start', { headers: owner.headers, body: { skipTts: true } });
  expect(res.status).toBe(200);
  const { sessionId } = await res.json() as { sessionId: string };
  return { ...owner, sessionId };
}

it('hides start from non-owners and requires the current user active session', async () => {
  const s = await session(), other = await testUser();
  expect((await req('/api/live/livekit/start', { headers: other.headers, body: { sessionId: s.sessionId } })).status).toBe(404);
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: 'missing' } })).status).toBe(404);
  const row = await db.query.liveSessions.findFirst({ where: eq(liveSessions.id, s.sessionId) });
  await db.update(liveSessions).set({ state: { ...(row!.state as object), phase: 'done' } }).where(eq(liveSessions.id, s.sessionId));
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId } })).status).toBe(409);
  expect(sdk.createRoom).not.toHaveBeenCalled();
});

it('dispatches private trusted metadata and grants only room scoped audio/data publishing', async () => {
  const s = await session();
  const res = await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId } });
  expect(res.status).toBe(200);
  const b = await res.json() as any;
  expect(b).toEqual({ url: env.LIVEKIT_URL, token: 'candidate-token', roomName: expect.stringMatching(/^ielts-/), participantIdentity: expect.stringMatching(/^candidate-/) });
  expect(sdk.addGrant).toHaveBeenCalledWith({ roomJoin: true, room: b.roomName, canSubscribe: true, canPublish: true, canPublishData: true, canPublishSources: [2], canUpdateOwnMetadata: false });
  expect(sdk.token).toHaveBeenCalledWith('lk-key', 'lk-secret', { identity: b.participantIdentity, ttl: '5m' });
  expect(sdk.createRoom.mock.calls[0]![0].metadata).toBeUndefined();
  const metadata = JSON.parse(sdk.createDispatch.mock.calls[0]![2].metadata);
  expect(metadata).toMatchObject({ sessionId: s.sessionId, userId: s.user.id, participantIdentity: b.participantIdentity, prompt: expect.stringContaining('Never give feedback'), reportToken: expect.any(String), cfg: { stt: 'soniox', maxTokens: 200 } });
  expect(JSON.stringify(b)).not.toContain(metadata.reportToken);
});

it.each([
  { llm: 'anthropic/claude' }, { stt: 'elevenlabs' }, { minEndpointDelay: 5 },
  { parts: { '2': { minEndpointDelay: 5 } } }, { ttsModel: 'sonic-3.6' },
  { parts: { '3': { tts: 'cartesia' } } }, { maxTokens: 0 }, { secret: 'oops' },
  { maxTokens: 15 }, { parts: { '4': { voice: 'invalid' } } }, { parts: { '1': { sttModel: 'scribe_v2_realtime' } } },
])('rejects invalid effective configuration before room creation: %j', async (cfg) => {
  const s = await session();
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId, cfg } })).status).toBe(400);
  expect(sdk.createRoom).not.toHaveBeenCalled();
});

it('requires selected provider credentials in every effective part', async () => {
  const s = await session();
  const cfg = { parts: { '2': { tts: 'cartesia', ttsModel: 'sonic-3.6' } } };
  env.CARTESIA_API_KEY = undefined;
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId, cfg } })).status).toBe(503);
  expect(sdk.createRoom).not.toHaveBeenCalled();
});

it('requires an explicit TTS plan rate before dispatching an alternative provider', async () => {
  const s = await session();
  const cfg = { tts: 'cartesia', ttsModel: 'sonic-3.6', voice: 'default' };
  env.CARTESIA_API_KEY = 'test-key';
  env.CARTESIA_USD_PER_M_CHARS = undefined;
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId, cfg } })).status).toBe(503);
  expect(sdk.createRoom).not.toHaveBeenCalled();
  env.CARTESIA_USD_PER_M_CHARS = '30';
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId, cfg } })).status).toBe(200);
});

it('cleans up a room when dispatch fails and refuses incomplete server setup', async () => {
  const s = await session();
  env.LIVEKIT_REPORT_SECRET = undefined;
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId } })).status).toBe(503);
  env.LIVEKIT_REPORT_SECRET = 'r'.repeat(32);
  sdk.createDispatch.mockRejectedValueOnce(new Error('unavailable'));
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId } })).status).toBe(502);
  expect(sdk.deleteRoom).toHaveBeenCalledWith(sdk.createRoom.mock.calls[0]![0].name);
});

it('authenticates usage, validates entries and durably deduplicates concurrent retries', async () => {
  const s = await session();
  await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId } });
  const { reportToken } = JSON.parse(sdk.createDispatch.mock.calls[0]![2].metadata);
  const body = { sessionId: s.sessionId, userId: s.user.id, reportId: 'report-1', entries: [{ stage: 'examiner_llm', provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', costUsd: 0.01, inputTokens: 50, meta: { estimated: false } }] };
  const report = (b = body, token = reportToken) => req('/api/live/livekit/usage', { headers: new Headers({ 'content-type': 'application/json', 'x-livekit-report-token': token }), body: b });
  expect((await report(body, 'bad')).status).toBe(403);
  expect((await report({ ...body, userId: 'another' })).status).toBe(403);
  expect((await report({ ...body, entries: [{ ...body.entries[0]!, costUsd: -1 }] })).status).toBe(400);
  expect((await report({ ...body, entries: [{ ...body.entries[0]!, stage: 'examiner_tts' }] })).status).toBe(400);
  const replies = await Promise.all([report(), report(), report()]);
  expect(replies.map((r) => r.status)).toEqual([204, 204, 204]);
  const rows = await db.select().from(aiCosts).where(and(eq(aiCosts.sessionId, s.sessionId), eq(aiCosts.stage, 'examiner_llm')));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ costUsd: 0.01, paidBy: 'house', meta: { engine: 'livekit', reportId: 'report-1', estimated: true } });
});

it('does not accept expired tokens or reports after the owned session is deleted', async () => {
  const s = await session();
  await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId } });
  const { reportToken } = JSON.parse(sdk.createDispatch.mock.calls[0]![2].metadata);
  const body = { sessionId: s.sessionId, userId: s.user.id, reportId: 'report-1', entries: [{ stage: 'live_stt', provider: 'soniox', model: 'stt-rt-v5', costUsd: 0.001 }] };
  const headers = new Headers({ 'content-type': 'application/json', 'x-livekit-report-token': reportToken });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 86_400_001);
  expect((await req('/api/live/livekit/usage', { headers, body })).status).toBe(403);
  clock.mockRestore();
  await db.delete(liveSessions).where(eq(liveSessions.id, s.sessionId));
  expect((await req('/api/live/livekit/usage', { headers, body })).status).toBe(404);
  expect(await db.select().from(aiCosts).where(eq(aiCosts.sessionId, s.sessionId))).toHaveLength(0);
});

it('accepts a valid per-part provider switch and records its TTS model', async () => {
  const s = await session();
  env.CARTESIA_API_KEY = 'cartesia';
  env.CARTESIA_USD_PER_M_CHARS = '30';
  const cfg = { parts: { '2': { tts: 'cartesia', ttsModel: 'sonic-3.6', voice: 'cartesia-voice' } } };
  expect((await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId, cfg } })).status).toBe(200);
  const metadata = JSON.parse(sdk.createDispatch.mock.calls[0]![2].metadata);
  expect(metadata.cfg.parts).toEqual(cfg.parts);
  const body = { sessionId: s.sessionId, userId: s.user.id, reportId: 'tts-1', entries: [{ stage: 'examiner_tts', provider: 'cartesia', model: 'sonic-3.6', costUsd: 0.001, characters: 25 }] };
  const headers = new Headers({ 'content-type': 'application/json', 'x-livekit-report-token': metadata.reportToken });
  expect((await req('/api/live/livekit/usage', { headers, body })).status).toBe(204);
  expect((await db.select().from(aiCosts).where(eq(aiCosts.sessionId, s.sessionId)))[0]).toMatchObject({ provider: 'cartesia', model: 'sonic-3.6' });
});

it('opens to everyone on the server keys: one test a day, free reconnects up to a cap, owner-only config', async () => {
  for (const topic of ['home', 'food', 'work']) await seedPrompt({ topic, followUps: ['Why?'] });
  await seedPrompt({ part: 2, type: 'cue-card', groupId: 'lk', title: 'Describe a book' });
  await seedPrompt({ part: 3, type: 'p3-discussion', groupId: 'lk', followUps: ['Why read?'] });
  const u = await testUser();
  const start = async () => {
    const res = await req('/api/live/start', { headers: u.headers, body: { skipTts: true } });
    return res.status === 200 ? ((await res.json()) as { sessionId: string }).sessionId : res.status;
  };
  const sessionId = await start();
  expect(typeof sessionId).toBe('string');
  const lk = async (body: object) => (await req('/api/live/livekit/start', { headers: u.headers, body: { sessionId, ...body } })).status;
  expect(await lk({ cfg: { temperature: 1 } })).toBe(403);
  expect(await lk({})).toBe(200);
  expect(await lk({})).toBe(200); // reconnect: same paid test
  expect(await lk({})).toBe(200);
  expect(await lk({})).toBe(429); // reconnect cap
  // An own OpenRouter key pays only the scoring: the LiveKit examiner (server keys) stays one a day.
  const next = await start();
  expect((await req('/api/live/livekit/start', { headers: u.headers, body: { sessionId: next } })).status).toBe(429);
  const community = await testUser(undefined, { key: false });
  const res = await req('/api/live/start', { headers: community.headers, body: { skipTts: true } });
  expect(res.status).toBe(200); // the LiveKit examiner needs no key of their own
});

it('caps reconnects even when starts race, and sends the worker the only cue texts it may accept', async () => {
  const s = await session(), u = await testUser();
  const res = await req('/api/live/start', { headers: u.headers, body: { skipTts: true } });
  const { sessionId } = (await res.json()) as { sessionId: string };
  const codes = await Promise.all(Array.from({ length: 6 }, async () => (await req('/api/live/livekit/start', { headers: u.headers, body: { sessionId } })).status));
  expect(codes.filter((c) => c === 429)).toHaveLength(3); // only 3 rooms ever opened
  const open = new Set(sdk.createRoom.mock.calls.map(([r]) => r.name));
  for (const [name] of sdk.deleteRoom.mock.calls) open.delete(name);
  expect(open.size).toBe(1); // each start replaced the one before
  const meta = JSON.parse(sdk.createDispatch.mock.calls[0]![2].metadata);
  expect(meta.cues).toContain('The test is over. Say the closing line now and nothing more.');
  await req('/api/live/livekit/start', { headers: s.headers, body: { sessionId: s.sessionId } });
  expect(JSON.parse(sdk.createDispatch.mock.calls.at(-1)![2].metadata).cues).toBeNull(); // owner playground: free cues
});

it('never picks a question list an examiner cannot ask (a Listening dialogue imported as Part 1)', async () => {
  for (const topic of ['home', 'food', 'work']) await seedPrompt({ topic, followUps: ['Why?'] });
  await seedPrompt({ topic: 'Settling into a new flat', followUps: ['Hi Shannon – how are you settling in?', "You look like you're going shopping."] });
  await seedPrompt({ part: 2, type: 'cue-card', groupId: 'lk', title: 'Describe a book' });
  await seedPrompt({ part: 3, type: 'p3-discussion', groupId: 'lk', followUps: ['Why read?'] });
  const u = await testUser();
  for (let i = 0; i < 5; i++) {
    const s = (await (await req('/api/live/start', { headers: u.headers, body: { skipTts: true } })).json()) as { test: { part1: { topic: string }[] } };
    expect(s.test.part1.map((p) => p.topic)).not.toContain('Settling into a new flat');
  }
});
