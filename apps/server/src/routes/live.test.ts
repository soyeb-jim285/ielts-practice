import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// helpers first: it loads the app (and @hono/zod-openapi's zod extension) before the settings schema is built
import { fakeFetch, json, req, seedPrompt, testUser } from '../test/helpers';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { attempts, quotaUsage } from '../db/schema';
import { setAnalyzer } from '../jobs';
import { setFetch } from '../ai/openrouter';
import { clearBalanceCache } from '../community';
import { examinerPrompt } from '../ai/examiner';
import { storage } from '../storage';
import { env } from '../env';

const originalEnv = { ...env };
afterEach(() => void Object.assign(env, originalEnv));
let analyzed: string[];
beforeEach(async () => {
  Object.assign(env, { LIVEKIT_URL: 'wss://example.livekit.cloud', LIVEKIT_API_KEY: 'lk-key', LIVEKIT_API_SECRET: 'lk-secret', LIVEKIT_REPORT_SECRET: 'r'.repeat(32), SONIOX_API_KEY: 'soniox' });
  analyzed = [];
  setAnalyzer(async (id) => void analyzed.push(id));
  for (const t of ['home', 'work', 'food']) await seedPrompt({ topic: t, followUps: [`${t} 1?`, `${t} 2?`, `${t} 3?`, `${t} 4?`] });
  await seedPrompt({ part: 2, type: 'cue-card', title: 'Describe a book you enjoyed', groupId: 'g1', followUps: ['Do you read often?'] });
  await seedPrompt({ part: 3, type: 'p3-discussion', topic: 'reading habits', groupId: 'g1', followUps: ['Do people read less today?'] });
});


/** The session's introduction is random (sessionScript): `rnd` pins it. 0.9 = one introduction question; 0.1 = three (what to call you, where from). */
const start = async (headers: Headers, body: Record<string, unknown> = {}, rnd = 0.9) => {
  const r = vi.spyOn(Math, 'random').mockReturnValue(rnd);
  try {
    return (await (await req('/api/live/start', { headers, body })).json()) as any;
  } finally {
    r.mockRestore();
  }
};
const upload = async (headers: Headers, sessionId: string) => {
  const { key } = (await (await req('/api/live/upload-url', { headers, body: { sessionId } })).json()) as any;
  await storage.put(key, new Uint8Array([1, 2]), 'audio/webm');
  return key as string;
};

it('rejects audio keys outside the session and other users', async () => {
  const a = await testUser();
  const b = await testUser();
  const s = await start(a.headers);
  expect((await req('/api/live/part', { headers: a.headers, body: { sessionId: s.sessionId, part: { part: 1, audioKey: 'audio/other/x.webm', durationMs: 1000 } } })).status).toBe(400);
  expect((await req('/api/live/upload-url', { headers: b.headers, body: { sessionId: s.sessionId } })).status).toBe(404);
});

it('start is refused (503) when the LiveKit examiner is not configured, and returns the opening line without audio', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  expect(s).toMatchObject({ sessionId: expect.any(String), phase: 'intro', examinerText: expect.stringMatching(/full name/) });
  expect(s).not.toHaveProperty('audioUrl');
  env.LIVEKIT_URL = undefined;
  expect((await req('/api/live/start', { headers, body: {} })).status).toBe(503);
});

it('finish creates one live attempt per part and analyses each, once', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  const parts: { part: number; audioKey: string; durationMs: number; energy: number[]; segments?: { q: number; startMs: number; endMs: number }[] }[] = [];
  for (const part of [1, 2, 3]) parts.push({ part, audioKey: await upload(headers, s.sessionId), durationMs: 60_000, energy: [1, 2] });
  parts[0]!.segments = [{ q: 0, startMs: 0, endMs: 20_000 }, { q: 1, startMs: 20_000, endMs: 60_000 }]; // answer windows: the recorder paused while the examiner spoke
  const conversationKey = await upload(headers, s.sessionId); // part 1's playback copy (mic + examiner)
  (parts[0] as { conversationKey?: string }).conversationKey = conversationKey;
  (parts[1] as { conversationKey?: string }).conversationKey = `live/${s.sessionId}/missing.webm`; // an unusable playback copy is dropped, not fatal
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts: [{ ...parts[0], audioKey: `live/${s.sessionId}/nope.webm` }] } })).status).toBe(400);

  // Two concurrent finishes (double click / client retry): the session row lock lets exactly one through.
  const both = await Promise.all([1, 2].map(() => req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })));
  expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  const res = both.find((r) => r.status === 200);
  const { attemptIds } = (await res!.json()) as any;
  expect(attemptIds).toHaveLength(3);
  expect(analyzed.sort()).toEqual([...attemptIds].sort());
  const rows = await db.select().from(attempts).where(eq(attempts.sessionId, s.sessionId));
  expect(rows.map((r) => [r.part, r.mode, r.status, r.promptId]).sort()).toEqual(
    [[1, 'live', 'analyzing', s.test.part1[0].id], [2, 'live', 'analyzing', s.test.part2.id], [3, 'live', 'analyzing', s.test.part3.id]].sort(),
  );
  expect(rows.find((r) => r.part === 1)!.segments).toEqual(parts[0]!.segments);
  expect(rows.find((r) => r.part === 2)!.segments).toBeNull();
  expect(rows.find((r) => r.part === 1)!.conversationKey).toBe(conversationKey);
  expect(rows.find((r) => r.part === 2)!.conversationKey).toBeNull();
  const got = (await (await req(`/api/attempts/${rows.find((r) => r.part === 1)!.id}`, { headers })).json()) as any;
  expect(got.conversationUrl).toContain(conversationKey);
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })).status).toBe(409);
});

it('parts sent during the test are analysed at once; a repeat returns the same attempt; finish adds only the rest', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  const p1 = { part: 1, audioKey: await upload(headers, s.sessionId), durationMs: 60_000, energy: [1, 2] };
  const first = await req('/api/live/part', { headers, body: { sessionId: s.sessionId, part: p1 } });
  expect(first.status).toBe(200);
  const { attemptId } = (await first.json()) as any;
  expect(analyzed).toEqual([attemptId]); // analysis starts while the test goes on
  const again = (await (await req('/api/live/part', { headers, body: { sessionId: s.sessionId, part: p1 } })).json()) as any;
  expect(again.attemptId).toBe(attemptId); // a retried send is the same part, not a second one

  const rest = [];
  for (const part of [2, 3]) rest.push({ part, audioKey: await upload(headers, s.sessionId), durationMs: 60_000, energy: [1, 2] });
  const done = await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts: [p1, ...rest] } }); // a client that resends part 1 too
  expect(done.status).toBe(200);
  const { attemptIds } = (await done.json()) as any;
  expect(attemptIds).toHaveLength(3);
  expect(attemptIds[0]).toBe(attemptId);
  expect(analyzed).toHaveLength(3);
  expect((await req('/api/live/part', { headers, body: { sessionId: s.sessionId, part: p1 } })).status).toBe(409);
});

it('the introduction is picked per session: time-of-day greeting, one to three questions, then the Part 1 lead; the examiner prompt carries the same lines', async () => {
  const { headers } = await testUser();
  const s = await start(headers, { localHour: 9 }, 0.1);
  expect(s.examinerText).toMatch(/^Good morning\. .*full name, please\?$/);
  expect(s.test.script.intro).toHaveLength(3);
  for (const line of [...s.test.script.intro, s.test.script.p1Lead]) expect(examinerPrompt(s.test)).toContain(line);
  expect((await start(headers, { localHour: 22 })).examinerText).toMatch(/^Good evening\./);
  expect((await start(headers)).examinerText).toMatch(/^Hello\./);
  expect((await req('/api/live/start', { headers, body: { localHour: 24 } })).status).toBe(400);
});

it('a signed-in user without an OpenRouter key: the quota is checked at start and reserved at finish', async () => {
  const { headers, user } = await testUser(undefined, { unlimited: false });
  const s = await start(headers);
  expect(s.sessionId).toBeTruthy();
  const parts = [{ part: 1, audioKey: await upload(headers, s.sessionId), durationMs: 60_000 }];
  const done = await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } });
  expect(done.status).toBe(200);
  expect(await db.select().from(quotaUsage).where(eq(quotaUsage.userId, user.id))).toMatchObject([{ skill: 'examiner', unitKey: s.sessionId, tier: 'community' }]);

  // the examiner session of the window is gone: the next live session is refused before it starts
  const again = await req('/api/live/start', { headers, body: {} });
  expect(again.status).toBe(429);
  expect(await again.json()).toMatchObject({ code: 'quota_exceeded', skill: 'examiner', tier: 'community' });
});

it('live finish with an exhausted community balance is refused (402) and creates no attempts', async () => {
  const { headers } = await testUser(undefined, { unlimited: false });
  const s = await start(headers);
  const f = fakeFetch({ '/api/v1/key': () => json({ data: { limit: 20, usage: 20, limit_remaining: 0 } }) });
  setFetch(f);
  clearBalanceCache(); // the balance ran out while the session was running
  const parts = [{ part: 1, audioKey: await upload(headers, s.sessionId), durationMs: 60_000 }];
  const r = await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } });
  expect([r.status, ((await r.json()) as any).code]).toEqual([402, 'community_balance_exhausted']);
  expect(await db.select().from(attempts).where(eq(attempts.sessionId, s.sessionId))).toHaveLength(0);
});

it('a retried finish after a refund is a 409 and does not charge the test again', async () => {
  const { headers, user } = await testUser(undefined, { unlimited: false });
  const s = await start(headers);
  const parts = [{ part: 1, audioKey: await upload(headers, s.sessionId), durationMs: 60_000 }];
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })).status).toBe(200);
  await db.update(quotaUsage).set({ refundedAt: new Date() }).where(eq(quotaUsage.userId, user.id)); // its analysis failed and was given back
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts } })).status).toBe(409);
  expect((await db.select().from(quotaUsage).where(eq(quotaUsage.userId, user.id)))[0]!.refundedAt).toBeInstanceOf(Date);
});

it('reply times are saved per session, merged across batches, kept through finish, and only by the owner', async () => {
  const { headers } = await testUser();
  const s = await start(headers);
  const turn = (at: number, total: number) => ({ at, wait: 500, stt: 100, llm: 600, tts: 200, net: total - 1400, total, label: 'LiveKit test' });
  const post = (h: Headers, turns: unknown[]) => req('/api/live/latency', { headers: h, body: { sessionId: s.sessionId, turns } });
  expect(await (await post(headers, [turn(1, 1500), turn(2, 1700)])).json()).toEqual({ turns: 2 });
  // a reconnect's batch: turn 2 again (updated) plus a new turn 3
  expect(await (await post(headers, [turn(2, 1800), turn(3, 2000)])).json()).toEqual({ turns: 3 });
  const other = await testUser();
  expect((await post(other.headers, [turn(9, 1500)])).status).toBe(404);
  const audioKey = await upload(headers, s.sessionId);
  expect((await req('/api/live/finish', { headers, body: { sessionId: s.sessionId, parts: [{ part: 1, audioKey, durationMs: 1000 }] } })).status).toBe(200);
  const row = await db.query.liveSessions.findFirst({ where: (t, { eq }) => eq(t.id, s.sessionId) });
  const st = row!.state as { phase: string; latency: { at: number; total: number }[] };
  expect(st.phase).toBe('done');
  expect(st.latency.map((t) => [t.at, t.total])).toEqual([[1, 1500], [2, 1800], [3, 2000]]);
});
