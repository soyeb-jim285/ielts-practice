import { beforeEach, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { guestUser, req, seedPrompt, testUser } from '../test/helpers';
import { db } from '../db/client';
import { analyses, attempts, user as userTable } from '../db/schema';
import { setAnalyzer } from '../jobs';
import { storage } from '../storage';

let analyzed: string[] = [];
beforeEach(() => {
  analyzed = [];
  setAnalyzer(async (id) => void analyzed.push(id));
});

const put = (key: string) => storage.put(key, new Uint8Array([1, 2, 3]), 'audio/webm');

async function speaking(headers: Headers, promptId: string, extra: Record<string, unknown> = {}) {
  const res = await req('/api/attempts', { headers, body: { promptId, skill: 'speaking', part: 1, audioContentType: 'audio/webm;codecs=opus', ...extra } });
  return { res, body: (await res.json()) as any };
}

it('speaking: create → upload URL, submit needs upload, then analyzes', async () => {
  const { headers, user } = await testUser();
  const p = await seedPrompt();
  const { res, body } = await speaking(headers, p.id);
  expect(res.status).toBe(201);
  expect(body.audioKey).toBe(`audio/${user.id}/${body.id}.webm`);
  expect(body.uploadUrl).toContain(body.audioKey);

  const submit = { durationMs: 30000, energy: [0, 120, 255], marks: [0, 12000], overtime: false };
  const early = await req(`/api/attempts/${body.id}/submit`, { headers, body: submit });
  expect(early.status).toBe(400);
  expect(analyzed).toEqual([]);

  await put(body.audioKey);
  const ok = await req(`/api/attempts/${body.id}/submit`, { headers, body: submit });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ status: 'analyzing' });
  expect(analyzed).toEqual([body.id]);

  const again = await req(`/api/attempts/${body.id}/submit`, { headers, body: submit });
  expect(again.status).toBe(409);

  const got = (await (await req(`/api/attempts/${body.id}`, { headers })).json()) as any;
  expect(got).toMatchObject({ status: 'analyzing', durationMs: 30000, energy: [0, 120, 255], marks: [0, 12000], analysis: null, models: null });
  expect(got.audioUrl).toContain(body.audioKey);
  expect(got.prompt.title).toBe(p.title);
});

it('rejects unsupported audio types', async () => {
  const { headers } = await testUser();
  const p = await seedPrompt();
  expect((await speaking(headers, p.id, { audioContentType: 'video/mp4' })).res.status).toBe(400);
  expect((await speaking(headers, p.id, { audioContentType: 'audio/mp4' })).body.audioKey).toMatch(/\.m4a$/);
});

it('writing: stores text and plan; failed attempt can be re-run', async () => {
  const { headers } = await testUser();
  const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion', imageKey: 'images/x.png' });
  const created = await req('/api/attempts', { headers, body: { promptId: p.id, skill: 'writing', part: 2, text: 'draft' } });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as any;

  await req(`/api/attempts/${id}/submit`, { headers, body: { durationMs: 1000, text: 'Final essay text.', plan: 'intro, body, end' } });
  expect(analyzed).toEqual([id]);
  const row = await db.query.attempts.findFirst({ where: eq(attempts.id, id) });
  expect(row).toMatchObject({ text: 'Final essay text.', plan: 'intro, body, end', status: 'analyzing' });

  await db.update(attempts).set({ status: 'failed', error: 'LLM broke' }).where(eq(attempts.id, id));
  expect((await req(`/api/attempts/${id}/submit`, { headers, body: {} })).status).toBe(200);
  expect(analyzed).toEqual([id, id]);
  const got = (await (await req(`/api/attempts/${id}`, { headers })).json()) as any;
  expect(got).toMatchObject({ text: 'Final essay text.', status: 'analyzing', error: null, audioUrl: null });
  expect(got.prompt.imageUrl).toContain('images/x.png');
});

it('status: lightweight poll shape, stage only while analyzing, owner only', async () => {
  const { headers } = await testUser();
  const other = await testUser();
  const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
  const { id } = (await (await req('/api/attempts', { headers, body: { promptId: p.id, skill: 'writing', part: 2, text: 'draft' } })).json()) as any;
  await db.update(attempts).set({ status: 'analyzing', stage: 'scoring' }).where(eq(attempts.id, id));
  expect(await (await req(`/api/attempts/${id}/status`, { headers })).json()).toEqual({ status: 'analyzing', stage: 'scoring', error: null, retryable: true });
  await db.update(attempts).set({ status: 'failed', error: 'boom', errorRetryable: false }).where(eq(attempts.id, id));
  expect(await (await req(`/api/attempts/${id}/status`, { headers })).json()).toEqual({ status: 'failed', stage: null, error: 'boom', retryable: false });
  expect((await req(`/api/attempts/${id}/status`, { headers: other.headers })).status).toBe(404);
});

it('skill and part must match the prompt; a retry must use its parent prompt', async () => {
  const { headers } = await testUser();
  const p = await seedPrompt();
  expect((await req('/api/attempts', { headers, body: { promptId: p.id, skill: 'writing', part: 1 } })).status).toBe(400);
  const part = await speaking(headers, p.id, { part: 2 });
  expect(part.res.status).toBe(400);
  expect(part.body.error).toMatch(/Part/);
  const parent = (await speaking(headers, p.id)).body;
  const other = await seedPrompt();
  expect((await speaking(headers, other.id, { parentAttemptId: parent.id })).res.status).toBe(400);
});

it('submit rejects recordings over 25 MB', async () => {
  const { headers } = await testUser();
  const { body } = await speaking(headers, (await seedPrompt()).id);
  await storage.put(body.audioKey, new Uint8Array(25 * 1024 * 1024 + 1), 'audio/webm');
  const res = await req(`/api/attempts/${body.id}/submit`, { headers, body: {} });
  expect(res.status).toBe(400);
  expect(((await res.json()) as any).error).toMatch(/too large/);
  expect(analyzed).toEqual([]);
});

it('submit is rate-limited per user (token bucket)', async () => {
  const { headers } = await testUser();
  const { body } = await speaking(headers, (await seedPrompt()).id);
  const codes: number[] = [];
  for (let i = 0; i < 21; i++) codes.push((await req(`/api/attempts/${body.id}/submit`, { headers, body: {} })).status);
  expect(codes.slice(0, 20).every((c) => c === 400)).toBe(true);
  expect(codes[20]).toBe(429);
  const other = await testUser();
  expect((await req(`/api/attempts/${body.id}/submit`, { headers: other.headers, body: {} })).status).toBe(404);
});

it('restricted prompt is 404 for non-allowed users, OK for the verified allow-listed email', async () => {
  const p = await seedPrompt({ restricted: true, source: 'cambridge' });
  const other = await testUser();
  expect((await speaking(other.headers, p.id)).res.status).toBe(404);

  const owner = await testUser('soyebjim@gmail.com');
  await db.update(userTable).set({ emailVerified: true }).where(eq(userTable.id, owner.user.id));
  expect((await speaking(owner.headers, p.id)).res.status).toBe(201);
});

it('owner-only get/submit/delete; parent must be own attempt', async () => {
  const a = await testUser();
  const b = await testUser();
  const p = await seedPrompt();
  const { body } = await speaking(a.headers, p.id);
  expect((await req(`/api/attempts/${body.id}`, { headers: b.headers })).status).toBe(404);
  expect((await req(`/api/attempts/${body.id}/submit`, { headers: b.headers, body: {} })).status).toBe(404);
  expect((await req(`/api/attempts/${body.id}`, { method: 'DELETE', headers: b.headers })).status).toBe(404);
  expect((await speaking(b.headers, p.id, { parentAttemptId: body.id })).res.status).toBe(404);
  expect((await speaking(a.headers, p.id, { parentAttemptId: body.id })).res.status).toBe(201);

  await put(body.audioKey);
  expect((await req(`/api/attempts/${body.id}`, { method: 'DELETE', headers: a.headers })).status).toBe(200);
  expect((await req(`/api/attempts/${body.id}`, { headers: a.headers })).status).toBe(404);
  expect(await storage.size(body.audioKey)).toBeNull();
});

it('lists own attempts newest first with overall band and prompt title, paged and filterable', async () => {
  const { headers } = await testUser();
  await testUser().then(async (o) => speaking(o.headers, (await seedPrompt()).id));
  const sp = await seedPrompt({ title: 'Speak' });
  const wp = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion', title: 'Write' });
  const ids: string[] = [];
  for (let i = 0; i < 21; i++) ids.push((await speaking(headers, sp.id)).body.id);
  const w = (await (await req('/api/attempts', { headers, body: { promptId: wp.id, skill: 'writing', part: 2, text: 'x' } })).json()) as any;
  await db.insert(analyses).values({ attemptId: w.id, result: {}, overall: 6.5, criteria: {}, models: {} });

  const p1 = (await (await req('/api/attempts', { headers })).json()) as any;
  expect(p1.total).toBe(22);
  expect(p1.items).toHaveLength(20);
  expect(p1.items[0]).toMatchObject({ id: w.id, promptTitle: 'Write', overall: 6.5, skill: 'writing' });
  expect(p1.items[1]).toMatchObject({ promptTitle: 'Speak', overall: null });
  const p2 = (await (await req('/api/attempts?page=2', { headers })).json()) as any;
  expect(p2.items).toHaveLength(2);

  const writing = (await (await req('/api/attempts?skill=writing', { headers })).json()) as any;
  expect(writing.items.map((i: any) => i.id)).toEqual([w.id]);
  expect((await req('/api/attempts')).status).toBe(401);
});

it('topFixesInDeck turns true once the top fixes were added to the deck', async () => {
  const { headers } = await testUser();
  const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
  const { id } = (await (await req('/api/attempts', { headers, body: { promptId: p.id, skill: 'writing', part: 2, text: 'x' } })).json()) as any;
  const topFixes = [1, 2].map((n) => ({ title: `Fix ${n}`, why: 'why', before: 'b', after: 'a' }));
  await db.insert(analyses).values({ attemptId: id, result: { topFixes }, overall: 6, criteria: {}, models: { analysis: 'openai/gpt-6-luna' } });
  expect(((await (await req(`/api/attempts/${id}`, { headers })).json()) as any).models).toEqual({ analysis: 'openai/gpt-6-luna' });
  const flag = async () => ((await (await req(`/api/attempts/${id}`, { headers })).json()) as any).topFixesInDeck;
  expect(await flag()).toBe(false);
  await req('/api/cards/bulk', { headers, body: { cards: topFixes.map((f) => ({ front: `${f.title}\n\n${f.before}`, back: `${f.after}\n\n${f.why}`, source: 'fix' })) } });
  expect(await flag()).toBe(true);
});

it('list: a guest sees only their own latest 10 (no paging); accounts keep full paged history', async () => {
  const g = await guestUser();
  const other = await guestUser();
  const acct = await testUser();
  const p = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
  const mine = Array.from({ length: 12 }, (_, i) => ({ id: `gr-${g.user.id}-${i}`, userId: g.user.id, promptId: p.id, skill: 'writing' as const, part: 2, createdAt: new Date(Date.now() - i * 1000) }));
  await db.insert(attempts).values([...mine, { id: `gr-o-${other.user.id}`, userId: other.user.id, promptId: p.id, skill: 'writing', part: 2 }]);
  await db.insert(attempts).values(Array.from({ length: 12 }, (_, i) => ({ id: `ga-${acct.user.id}-${i}`, userId: acct.user.id, promptId: p.id, skill: 'writing' as const, part: 2 })));

  const res = await req('/api/attempts?page=2', { headers: g.headers });
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body).toMatchObject({ page: 1, pageSize: 10, total: 10 });
  expect(body.items).toHaveLength(10);
  expect(body.items.every((a: any) => a.id.startsWith(`gr-${g.user.id}-`))).toBe(true);
  expect(body.items[0].id).toBe(mine[0]!.id);

  const o = (await (await req('/api/attempts', { headers: other.headers })).json()) as any;
  expect(o.items.map((a: any) => a.id)).toEqual([`gr-o-${other.user.id}`]);

  const a = (await (await req('/api/attempts', { headers: acct.headers })).json()) as any;
  expect(a).toMatchObject({ pageSize: 20, total: 12 });
  expect((await req('/api/attempts')).status).toBe(401);
});
