import { eq } from 'drizzle-orm';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { OWNER_EMAILS } from './auth';
import { db } from './db/client';
import { replaySessions } from './db/schema';
import { purgeReplays, replayKey } from './replay';
import { storage } from './storage';
import { guestUser, req, testUser } from './test/helpers';

const post = (sid: string, headers: Headers | undefined, body: unknown) =>
  req(`/api/replay/${sid}/chunks`, { headers: headers ?? new Headers({ 'Content-Type': 'application/json' }), body });
const ev = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 3, timestamp: i }));
const row = async (sid: string) => (await db.select().from(replaySessions).where(eq(replaySessions.id, sid)))[0]!;

describe('POST /api/replay/{sessionId}/chunks', () => {
  it('needs a session', async () => {
    expect((await post(crypto.randomUUID(), undefined, { seq: 0, events: ev(1) })).status).toBe(401);
  });

  it('stores a gzipped chunk under the dated key and upserts the row', async () => {
    const { headers, user } = await testUser();
    const sid = crypto.randomUUID();
    expect((await post(sid, headers, { seq: 0, events: ev(2), pages: [{ path: '/', at: 1 }] })).status).toBe(200);
    expect((await post(sid, headers, { seq: 1, events: ev(1), pages: [{ path: '/history', at: 2 }] })).status).toBe(200);
    const r = await row(sid);
    expect(r).toMatchObject({ userId: user.id, chunks: 2 });
    expect(r.pages.map((p) => p.path)).toEqual(['/', '/history']);
    const key = `replay/${r.startedAt.toISOString().slice(0, 10)}/${sid}/0.json.gz`;
    expect(replayKey(r, 0)).toBe(key);
    expect(JSON.parse(gunzipSync(await storage.get(key)).toString())).toEqual(ev(2));
  });

  it('ignores a duplicate seq, and a guest who signs up in the tab takes the row over', async () => {
    const guest = await guestUser();
    const sid = crypto.randomUUID();
    await post(sid, guest.headers, { seq: 0, events: ev(1) });
    const before = await row(sid);
    expect((await post(sid, guest.headers, { seq: 0, events: ev(3) })).status).toBe(200);
    expect(await row(sid)).toMatchObject({ chunks: 1, bytes: before.bytes });
    const other = await testUser();
    expect((await post(sid, other.headers, { seq: 1, events: ev(1) })).status).toBe(404); // not yours
    expect((await row(sid)).userId).toBe(guest.user.id);
  });

  it('refuses a far-ahead seq and a 51st recording in a day', async () => {
    const far = await testUser();
    expect((await post(crypto.randomUUID(), far.headers, { seq: 2_000_000_000, events: ev(1) })).status).toBe(400);
    const { headers, user } = await testUser();
    await db.insert(replaySessions).values(Array.from({ length: 50 }, () => ({ id: crypto.randomUUID(), userId: user.id })));
    expect((await post(crypto.randomUUID(), headers, { seq: 0, events: ev(1) })).status).toBe(429);
  });

  it('rejects a chunk over 1 MB with chunk_too_large', async () => {
    const { headers } = await testUser();
    const sid = crypto.randomUUID();
    const r = await post(sid, headers, { seq: 0, events: [{ blob: 'x'.repeat(1024 * 1024) }] });
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ code: 'chunk_too_large' });
  });

  it('stops a session at 30 MB with replay_full', async () => {
    const { headers } = await testUser();
    const sid = crypto.randomUUID();
    await post(sid, headers, { seq: 0, events: ev(1) });
    await db.update(replaySessions).set({ bytes: 30 * 1024 * 1024 - 10 }).where(eq(replaySessions.id, sid));
    const r = await post(sid, headers, { seq: 1, events: ev(5) });
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ code: 'replay_full' });
    expect((await row(sid)).chunks).toBe(1);
  });

  it('rejects excluded pages and malformed bodies with 400', async () => {
    const { headers } = await testUser();
    const sid = crypto.randomUUID();
    for (const path of ['/login', '/signup', '/forgot-password', '/reset-password?x']) expect((await post(sid, headers, { seq: 0, events: ev(1), pages: [{ path, at: 1 }] })).status).toBe(400);
    expect((await post(sid, headers, { seq: 0, events: [] })).status).toBe(400);
    expect((await req(`/api/replay/${sid}/chunks`, { method: 'POST', headers, body: undefined })).status).toBe(400);
    expect((await post('not-a-uuid', headers, { seq: 0, events: ev(1) })).status).toBe(400);
  });

  it('rate limits per session', async () => {
    const { headers } = await testUser();
    const sid = crypto.randomUUID();
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await post(sid, headers, { seq: i, events: ev(1) })).status);
    expect(codes.slice(0, 12).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('GET /api/admin/replays', () => {
  it('is owner only (404 for everyone else)', async () => {
    const sid = crypto.randomUUID();
    const { headers } = await testUser();
    await post(sid, headers, { seq: 0, events: ev(1) });
    for (const path of ['/api/admin/replays', `/api/admin/replays/${sid}`, `/api/admin/replays/${sid}/events`]) {
      expect((await req(path)).status).toBe(404);
      expect((await req(path, { headers })).status).toBe(404);
    }
  });

  it('lists sessions and concatenates chunks in seq order, skipping a dropped one', async () => {
    const owner = await testUser(OWNER_EMAILS[0]!);
    const { headers, user } = await testUser();
    const sid = crypto.randomUUID();
    await post(sid, headers, { seq: 0, events: [{ n: 'a' }, { n: 'b' }], pages: [{ path: '/', at: 5 }] });
    await post(sid, headers, { seq: 2, events: [{ n: 'c' }] }); // seq 1 was dropped by the client
    const list = await (await req('/api/admin/replays', { headers: owner.headers })).json();
    expect(list).toMatchObject({ total: 1, items: [{ id: sid, userId: user.id, email: expect.any(String), chunks: 3, pages: [{ path: '/', at: 5 }] }] });
    expect(((await (await req(`/api/admin/replays?userId=nobody`, { headers: owner.headers })).json()) as { total: number }).total).toBe(0);
    expect((await req(`/api/admin/replays/${sid}`, { headers: owner.headers })).status).toBe(200);
    expect(await (await req(`/api/admin/replays/${sid}/events`, { headers: owner.headers })).json()).toEqual({ events: [{ n: 'a' }, { n: 'b' }, { n: 'c' }] });
    expect((await req(`/api/admin/replays/${crypto.randomUUID()}/events`, { headers: owner.headers })).status).toBe(404);
  });
});

describe('purgeReplays', () => {
  it('deletes sessions idle for more than 14 days with their objects, keeps the rest', async () => {
    const { headers } = await testUser();
    const [oldId, newId] = [crypto.randomUUID(), crypto.randomUUID()];
    for (const sid of [oldId, newId]) await post(sid, headers, { seq: 0, events: ev(1) });
    const old = await row(oldId);
    await db.update(replaySessions).set({ lastAt: new Date(Date.now() - 15 * 86_400_000) }).where(eq(replaySessions.id, oldId));
    expect(await purgeReplays()).toBe(1);
    expect(await db.select().from(replaySessions).where(eq(replaySessions.id, oldId))).toHaveLength(0);
    expect(await storage.size(replayKey(old, 0))).toBeNull();
    expect(await storage.size(replayKey(await row(newId), 0))).not.toBeNull();
  });
});
