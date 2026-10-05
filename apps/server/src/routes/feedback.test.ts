import { beforeEach, describe, expect, it } from 'vitest';
import { OWNER_EMAILS } from '../auth';
import { guestUser, req, testUser } from '../test/helpers';

const OWNER = OWNER_EMAILS[0]!;
const body = { message: '  Audio is stuck  ', page: '/speaking?x=1' };
const post = (headers?: Headers, b: unknown = body) => req('/api/feedback', { headers, body: b });
let n = 0;
const ip = () => new Headers({ 'Content-Type': 'application/json', 'CF-Connecting-IP': `203.0.113.${++n}` });

describe('POST /api/feedback', () => {
  beforeEach(() => void (n += 10));

  it('stores reports from a user, a guest and a visitor', async () => {
    const u = await testUser();
    const g = await guestUser();
    const sid = crypto.randomUUID();
    const r1 = await post(u.headers, { ...body, replaySessionId: sid });
    expect(r1.status).toBe(201);
    expect((await post(g.headers)).status).toBe(201);
    expect((await post(ip())).status).toBe(201);

    const o = await testUser(OWNER);
    const { items, total } = (await (await req('/api/admin/feedback', { headers: o.headers })).json()) as { items: { email: string | null; userId: string | null; message: string; replaySessionId: string | null }[]; total: number };
    expect(total).toBe(3);
    const byEmail = (e: string | null) => items.filter((i) => i.email === e);
    expect(byEmail(u.user.email)).toMatchObject([{ message: 'Audio is stuck', replaySessionId: sid }]);
    expect(items.filter((i) => i.email === null).map((i) => i.userId).sort()).toEqual([null, g.user.id].sort());
  });

  it('validates the body and rate limits per client', async () => {
    const h = ip();
    expect((await post(h, { ...body, message: '   ' })).status).toBe(400);
    expect((await post(h, { ...body, message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await post(h, { ...body, page: 'p'.repeat(301) })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await post(h)).status).toBe(201);
    expect((await post(h)).status).toBe(429);
  });
});

describe('admin feedback', () => {
  it('is 404 for everyone but the owner', async () => {
    for (const h of [undefined, (await guestUser()).headers, (await testUser()).headers]) {
      expect((await req('/api/admin/feedback', { headers: h })).status).toBe(404);
      expect((await req('/api/admin/feedback/x', { method: 'PATCH', headers: h, body: { status: 'done' } })).status).toBe(404);
    }
  });

  it('lists new first, filters by status and updates it', async () => {
    const a = (await (await post(ip(), { ...body, message: 'first' })).json()) as { id: string };
    await post(ip(), { ...body, message: 'second' });
    const o = await testUser(OWNER);
    const patch = (id: string, status: string) => req(`/api/admin/feedback/${id}`, { method: 'PATCH', headers: o.headers, body: { status } });
    const list = async (q = '') => ((await (await req(`/api/admin/feedback${q}`, { headers: o.headers })).json()) as { items: { id: string; message: string; status: string }[]; total: number });

    expect((await patch(a.id, 'done')).status).toBe(200);
    expect((await list()).items.map((i) => i.message)).toEqual(['second', 'first']); // new before done
    expect((await list('?status=done')).items.map((i) => i.message)).toEqual(['first']);
    expect((await list('?status=new')).total).toBe(1);
    expect((await patch(a.id, 'bogus')).status).toBe(400);
    expect((await patch('nope', 'seen')).status).toBe(404);
  });
});
