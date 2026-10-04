import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { count } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { attempts, prompts } from '../db/schema';
import { forgetRenderedAudio, speakingAudioHash, speakingAudioKey } from '../ai/speaking-audio';
import { DEFAULT_BANK_DIR, seedBank } from '../seed';
import { storage } from '../storage';
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

  it('source=cambridge tests and random picks: allowlisted only, and they assemble without a P1 intro frame', async () => {
    const cam = { source: 'cambridge' as const, restricted: true };
    for (const t of ['Music', 'Food', 'Sport']) await seedPrompt({ ...cam, slug: `cam-p1-${t}`, topic: t });
    await seedPrompt({ ...cam, slug: 'cam-p2', part: 2, type: 'cue-card', groupId: 'cam-g', bullets: ['a', 'b', 'c'] });
    await seedPrompt({ ...cam, slug: 'cam-p3', part: 3, type: 'p3-linked', groupId: 'cam-g' });

    const other = (await testUser('a@x.com')).headers;
    expect((await req('/api/speaking/test?source=cambridge', { headers: other })).status).toBe(404);
    expect((await req('/api/prompts/random?skill=speaking&source=cambridge', { headers: other })).status).toBe(404);
    expect((await req('/api/prompts/random?skill=speaking&source=cambridge')).status).toBe(404); // guest

    const { headers } = await testUser('soyebjim@gmail.com');
    const t = await body(await req('/api/speaking/test?source=cambridge', { headers }));
    expect([t.part1.length, t.part2.slug, t.part3.slug]).toEqual([3, 'cam-p2', 'cam-p3']);
    expect([...t.part1, t.part2, t.part3].every((p: any) => p.source === 'cambridge')).toBe(true);
    for (let i = 0; i < 5; i++) expect((await body(await req('/api/prompts/random?skill=speaking&part=1&source=generated', { headers }))).source).toBe('generated');
    expect((await body(await req('/api/prompts/random?skill=speaking&part=1&source=cambridge', { headers }))).source).toBe('cambridge');
  });

  it('guests browse the generated bank; Cambridge stays hidden', async () => {
    expect((await body(await req('/api/prompts'))).total).toBe(2);
    expect((await req(`/api/prompts/${restrictedId}`)).status).toBe(404);
    expect((await body(await req('/api/prompts?source=cambridge'))).items).toEqual([]);
    expect((await body(await req('/api/prompts/meta'))).groups[0].topics.sort()).toEqual(['Work', 'hometown']);
    for (let i = 0; i < 5; i++) expect((await body(await req('/api/prompts/random?skill=speaking'))).source).toBe('generated'); // a 200, never the Cambridge row
    const [first] = (await body(await req('/api/prompts'))).items;
    expect(first.done).toBe(false);
    expect((await body(await req(`/api/prompts/${first.id}`))).id).toBe(first.id);
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
    expect(t.part1[0].type).toBe('p1-intro');
    expect(t.part1.slice(1).every((p: any) => p.type === 'p1-topic')).toBe(true);
    expect(t.part2.type).toBe('cue-card');
    expect(t.part2.bullets.length).toBeGreaterThan(0);
    expect(t.part3.part).toBe(3);
    expect(t.part3.groupId).toBe(t.part2.groupId);
    // Cambridge shape: 3 bullets, a full-stop title; Part 3 = two headed sub-topics of 3 questions (headings in bullets)
    expect([t.part2.bullets.length, t.part2.title.endsWith('.')]).toEqual([3, true]);
    expect([t.part3.followUps.length, t.part3.bullets.length, t.part3.title.endsWith('.')]).toEqual([6, 2, false]);
    expect((await req('/api/speaking/test?source=cambridge', { headers })).status).toBe(404);
  });

  it('re-seeding updates the questions of an existing slug in place (attempt FKs stay valid)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bank-'));
    const write = (q: string) => writeFile(join(dir, 'speaking-p1.json'), JSON.stringify([{ slug: 'p1-x', topic: 'x', frame: 'intro', questions: [q] }]));
    await write('Old question?');
    await seedBank(db, dir);
    const [before] = await db.select().from(prompts);
    await write('New question?');
    await seedBank(db, dir);
    const [after] = await db.select().from(prompts);
    expect([after!.id, after!.type, after!.followUps]).toEqual([before!.id, 'p1-intro', ['New question?']]);
  });

  it('stores Part 3 sub-topic headings on the linked set and on standalone sets, updating them on re-seed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bank-'));
    const card = (h: string) => ({ slug: 'p2x-a', topic: 'x', title: 'Describe a hotel.', bullets: ['a', 'b', 'c'], explain: 'and explain why.', followUps: ['q?'], p3: ['1?', '2?', '3?', '4?', '5?', '6?'], p3Topics: [h, 'Two'] });
    await writeFile(join(dir, 'speaking-p2-x.json'), JSON.stringify([card('One')]));
    await writeFile(join(dir, 'speaking-p3.json'), JSON.stringify([{ slug: 'p3-y', topic: 'y', subtopics: ['A', 'B'], questions: ['1?', '2?'] }]));
    await seedBank(db, dir);
    await writeFile(join(dir, 'speaking-p2-x.json'), JSON.stringify([card('Uno')]));
    await seedBank(db, dir);
    const rows = await db.select().from(prompts);
    const by = (slug: string) => rows.find((r) => r.slug === slug)!;
    expect([by('p2x-a-p3').bullets, by('p2x-a-p3').title, by('p3-y').bullets, by('p2x-a').bullets]).toEqual([['Uno', 'Two'], 'Discussion: a hotel', ['A', 'B'], ['a', 'b', 'c']]);
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

describe('examiner audio on speaking prompts', () => {
  it('presigns the rendered lines, leaves the rest null and skips Cambridge prompts', async () => {
    const gen = await seedPrompt({ slug: 'aud-1' });
    const cam = await seedPrompt({ slug: 'aud-2', source: 'cambridge', restricted: true });
    const { headers } = await testUser('soyebjim@gmail.com');
    const q = 'Where is your hometown?';
    await storage.put('speaking/manifest.json', new TextEncoder().encode(JSON.stringify({ [speakingAudioHash(q)]: speakingAudioKey(q) })), 'application/json');
    forgetRenderedAudio();
    const a = (await body(await req(`/api/prompts/${gen.id}`, { headers }))).audio;
    expect(a.questions).toEqual([{ text: q, url: `https://download.test/${speakingAudioKey(q)}` }, { text: 'What do you like about it?', url: null }]);
    expect(a.lead).toEqual({ text: "Let's talk about hometown.", url: null });
    expect((await body(await req(`/api/prompts/${cam.id}`, { headers }))).audio).toBeNull();
    forgetRenderedAudio();
  });
});
