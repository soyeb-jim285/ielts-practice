import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { count } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { attempts, prompts } from '../db/schema';
import { DEFAULT_BANK_DIR, seedBank } from '../seed';
import { req, seedPrompt, testUser } from '../test/helpers';

const body = async (r: Response) => (await r.json()) as any;

describe('prompt gating (Review Focus #5)', () => {
  let restrictedId: string;
  beforeEach(async () => {
    await seedPrompt({ slug: 'gen-1' });
    await seedPrompt({ slug: 'gen-2', topic: 'Work' });
    restrictedId = (await seedPrompt({ slug: 'cam-1', source: 'cambridge', restricted: true, sourceRef: 'C17 T2', imageKey: 'cambridge/c17.png' })).id;
  });

  it('hides restricted prompts from a non-allowlisted user', async () => {
    const { headers } = await testUser('a@x.com');
    expect((await body(await req('/api/prompts', { headers }))).total).toBe(2);
    expect((await req(`/api/prompts/${restrictedId}`, { headers })).status).toBe(404);
    expect((await body(await req('/api/prompts?source=cambridge', { headers }))).items).toEqual([]);
    const meta = await body(await req('/api/prompts/meta', { headers }));
    expect(meta.groups[0].topics.sort()).toEqual(['Work', 'hometown']);
    for (let i = 0; i < 5; i++) expect((await body(await req('/api/prompts/random?skill=speaking', { headers }))).id).not.toBe(restrictedId);
  });

  it('meta is cacheable for 5 min (private: it differs per user) and revalidates with its ETag', async () => {
    const { headers } = await testUser('b@x.com');
    const first = await req('/api/prompts/meta', { headers });
    expect(first.headers.get('cache-control')).toBe('private, max-age=300');
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    headers.set('If-None-Match', etag);
    expect((await req('/api/prompts/meta', { headers })).status).toBe(304);
  });

  it('an unverified allowlisted email is not trusted', async () => {
    const { headers } = await testUser('soyebjim@gmail.com', { verified: false });
    expect((await req(`/api/prompts/${restrictedId}`, { headers })).status).toBe(404);
  });

  it('shows restricted prompts (with presigned image) to the allowlisted user', async () => {
    const { headers } = await testUser('soyebjim@gmail.com');
    expect((await body(await req('/api/prompts', { headers }))).total).toBe(3);
    const r = await req(`/api/prompts/${restrictedId}`, { headers });
    expect(r.status).toBe(200);
    expect((await body(r)).imageUrl).toBe('https://download.test/cambridge/c17.png');
    expect((await body(await req('/api/prompts?source=cambridge', { headers }))).items).toHaveLength(1);
  });

  it('requires auth', async () => {
    expect((await req('/api/prompts')).status).toBe(401);
  });
});

describe('prompt list', () => {
  it('filters, searches, paginates and flags done', async () => {
    const { headers, user } = await testUser();
    const p = await seedPrompt({ slug: 'w1', skill: 'writing', part: 2, type: 'opinion', title: 'Cars', body: 'Cars should be banned 100% of the time' });
    await seedPrompt({ slug: 'w2', skill: 'writing', part: 2, type: 'discussion', title: 'Tourism', body: 'Tourism is good' });
    for (let i = 0; i < 31; i++) await seedPrompt({ slug: `s${i}` });
    await db.insert(attempts).values({ userId: user.id, promptId: p.id, skill: 'writing', part: 2 });

    const w = await body(await req('/api/prompts?skill=writing', { headers }));
    expect(w.total).toBe(2);
    expect(w.items.find((x: any) => x.id === p.id).done).toBe(true);
    expect(w.items.find((x: any) => x.id !== p.id).done).toBe(false);
    expect((await body(await req('/api/prompts?skill=writing&type=discussion', { headers }))).total).toBe(1);
    expect((await body(await req('/api/prompts?q=banned', { headers }))).items[0].id).toBe(p.id);
    expect((await body(await req('/api/prompts?q=%25', { headers }))).total).toBe(1); // literal %, not a wildcard
    const s2 = await body(await req('/api/prompts?skill=speaking&page=2', { headers }));
    expect([s2.total, s2.items.length]).toEqual([31, 1]);
    // random prefers undone
    for (let i = 0; i < 5; i++) expect((await body(await req('/api/prompts/random?skill=writing&part=2', { headers }))).id).not.toBe(p.id);
    expect((await req('/api/prompts/random?skill=writing&part=1', { headers })).status).toBe(404);
  });
});

describe('speaking test + seed', () => {
  it('seeds the committed bank idempotently and builds a linked test', async () => {
    const warns: string[] = [];
    const first = await seedBank(db, DEFAULT_BANK_DIR, (m) => warns.push(m));
    expect(warns).toEqual([]);
    const again = await seedBank(db);
    expect(again.upserted).toBe(first.upserted);
    const [{ n }] = (await db.select({ n: count() }).from(prompts)) as [{ n: number }];
    expect(n).toBe(first.upserted);

    const { headers } = await testUser();
    const t = await body(await req('/api/speaking/test', { headers }));
    expect(t.part1).toHaveLength(3);
    expect(t.part1.every((p: any) => p.part === 1 && p.followUps.length === 4)).toBe(true);
    expect(t.part2.type).toBe('cue-card');
    expect(t.part2.bullets.length).toBeGreaterThan(0);
    expect(t.part3.part).toBe(3);
    expect(t.part3.groupId).toBe(t.part2.groupId);
    expect((await req('/api/speaking/test?source=cambridge', { headers })).status).toBe(404);
  });

  it('skips invalid entries and unknown files with a warning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bank-'));
    await writeFile(join(dir, 'writing-t2-x.json'), JSON.stringify([
      { slug: 't2-ok', topic: 'education', type: 'opinion', body: 'Schools should ban phones. Do you agree?' },
      { slug: 't2-bad', topic: 'education', type: 'essay', body: 'x' },
    ]));
    await writeFile(join(dir, 'writing-t1a-x.json'), JSON.stringify([
      { slug: 't1-bad', topic: 'x', type: 'line', body: 'b', chart: { kind: 'line', title: 't', xLabel: '', yLabel: '', unit: '', categories: ['a', 'b'], series: [{ name: 's', values: [1] }] } },
    ]));
    await writeFile(join(dir, 'notes.json'), '[]');
    const warns: string[] = [];
    expect(await seedBank(db, dir, (m) => warns.push(m))).toEqual({ upserted: 1, skipped: 2 });
    expect(warns).toHaveLength(3);
    const [row] = await db.select().from(prompts);
    expect([row!.topic, row!.title, row!.part, row!.variant]).toEqual(['Education', 'Schools should ban phones.', 2, null]);
  });
});
