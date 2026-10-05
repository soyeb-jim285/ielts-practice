import { describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { analyses, attempts, mistakes } from '../db/schema';
import { req, seedPrompt, testUser } from '../test/helpers';
import { streak } from './progress';

const DAY = 864e5;
const body = async (r: Response) => (await r.json()) as any;

async function doneAttempt(userId: string, promptId: string, daysAgo: number, overall: number, criteria: Record<string, number>, skill: 'speaking' | 'writing' = 'speaking') {
  const [a] = await db
    .insert(attempts)
    .values({ userId, promptId, skill, part: 1, status: 'done', durationMs: 120000, createdAt: new Date(Date.now() - daysAgo * DAY) })
    .returning();
  await db.insert(analyses).values({ attemptId: a!.id, result: {}, overall, criteria, models: {} });
  return a!;
}

describe('streak', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  it('counts consecutive days ending today or yesterday; a gap resets it', () => {
    expect(streak(['2026-09-30', '2026-09-29', '2026-09-28'], now)).toBe(3);
    expect(streak(['2026-09-29', '2026-09-28', '2026-09-27'], now)).toBe(3);
    expect(streak(['2026-09-30', '2026-09-28', '2026-09-27'], now)).toBe(1);
    expect(streak(['2026-09-28', '2026-09-27'], now)).toBe(0);
    expect(streak([], now)).toBe(0);
  });
});

describe('GET /api/progress', () => {
  it('reports trend, streak, weakest, mistakes and predicted bands', async () => {
    const { headers, user } = await testUser();
    const p = await seedPrompt();
    const a = await doneAttempt(user.id, p.id, 0, 6, { fc: 6, lr: 6, gra: 5, p: 7 });
    await doneAttempt(user.id, p.id, 1, 6.5, { fc: 7, lr: 6, gra: 5, p: 7 });
    await doneAttempt(user.id, p.id, 2, 7, { fc: 7, lr: 7, gra: 6, p: 7 });
    await doneAttempt(user.id, p.id, 4, 5, { fc: 5, lr: 5, gra: 5, p: 5 }); // gap on day 3
    await doneAttempt(user.id, (await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' })).id, 10, 6, { ta: 6, cc: 6, lr: 6, gra: 6 }, 'writing');
    await doneAttempt(user.id, p.id, 0, 0, {}); // no speech detected: not assessed, must not drag the bands down
    await db.insert(mistakes).values([
      { userId: user.id, attemptId: a.id, errorId: 'e0', category: 'grammar.article', original: 'a', correction: 'the', explanation: 'x' },
      { userId: user.id, attemptId: a.id, errorId: 'e1', category: 'grammar.article', original: 'a', correction: 'the', explanation: 'x' },
      { userId: user.id, attemptId: a.id, errorId: 'e2', category: 'lexis.collocation', original: 'do', correction: 'make', explanation: 'x' },
    ]);

    const r = await body(await req('/api/progress?skill=speaking', { headers }));
    expect(r.trend.map((t: any) => t.overall)).toEqual([5, 7, 6.5, 6]);
    expect(r.streak).toBe(3);
    expect(r.attempts).toBe(4);
    expect(r.weakest).toEqual({ key: 'gra', avg: 5.25 });
    expect(r.topMistakes).toEqual([{ category: 'grammar.article', count: 2 }, { category: 'lexis.collocation', count: 1 }]);
    expect(r.predicted).toEqual({ speaking: 6, writing: 6 }); // mean 6.125 → 6
    expect(r.minutesThisWeek).toBeGreaterThanOrEqual(2);

    const all = await body(await req('/api/progress', { headers }));
    expect(all.attempts).toBe(5);
    expect(all.trend).toHaveLength(5);
  });

  it('is empty for a new user, then reports a failed latest attempt', async () => {
    const { headers, user } = await testUser();
    expect(await body(await req('/api/progress', { headers }))).toEqual({
      trend: [], streak: 0, minutesThisWeek: 0, attempts: 0, weakest: null, topMistakes: [], predicted: { speaking: null, writing: null }, lastFailed: null,
    });
    const [f] = await db.insert(attempts).values({ userId: user.id, promptId: (await seedPrompt()).id, skill: 'speaking', part: 1, status: 'failed' }).returning();
    expect((await body(await req('/api/progress', { headers }))).lastFailed).toEqual({ id: f!.id, skill: 'speaking' });
  });
});

describe('mistakes + cards', () => {
  it('lists mistakes, turns one into a card, and schedules reviews with SM-2', async () => {
    const { headers, user } = await testUser();
    const other = await testUser();
    const a = await doneAttempt(user.id, (await seedPrompt({ title: 'Hometown' })).id, 0, 6, { fc: 6 });
    const [m] = await db
      .insert(mistakes)
      .values([
        { userId: user.id, attemptId: a.id, errorId: 'e0', category: 'grammar.tense', original: 'I go yesterday', correction: 'I went yesterday', explanation: 'Past time needs past simple', time: 3.2 },
        { userId: user.id, attemptId: a.id, errorId: 'e1', category: 'grammar.article', original: 'a', correction: 'the', explanation: 'x' },
      ])
      .returning();

    const log = await body(await req('/api/mistakes?category=grammar.tense', { headers }));
    expect(log.groups).toHaveLength(2);
    expect(log.total).toBe(1);
    expect(log.items[0]).toMatchObject({ id: m!.id, attemptId: a.id, promptTitle: 'Hometown', time: 3.2, skill: 'speaking' });
    expect((await body(await req('/api/mistakes', { headers: other.headers }))).total).toBe(0);

    expect((await req(`/api/mistakes/${m!.id}/card`, { method: 'POST', headers: other.headers })).status).toBe(404);
    const card = await body(await req(`/api/mistakes/${m!.id}/card`, { method: 'POST', headers }));
    expect(card).toMatchObject({ front: 'I go yesterday', back: 'I went yesterday — Past time needs past simple', source: 'mistake', interval: 0 });
    expect((await body(await req(`/api/mistakes/${m!.id}/card`, { method: 'POST', headers }))).id).toBe(card.id); // no duplicate
    const inDeck = (await body(await req('/api/mistakes', { headers }))).items.map((i: any) => [i.id, i.inDeck]);
    expect(inDeck).toContainEqual([m!.id, true]);
    expect(inDeck.filter(([, d]: any) => !d)).toHaveLength(1);

    const bulk = await req('/api/cards/bulk', { headers, body: { cards: [{ front: 'f1', back: 'b1', source: 'fix' }, { front: 'f2', back: 'b2', source: 'vocab' }] } });
    expect(bulk.status).toBe(201);
    await req('/api/cards/bulk', { headers, body: { cards: [{ front: 'f1', back: 'b1', source: 'fix' }, { front: 'f1', back: 'b1', source: 'fix' }] } });
    expect((await body(await req('/api/cards/due', { headers }))).total).toBe(3);

    const g1 = await body(await req(`/api/cards/${card.id}/review`, { headers, body: { grade: 4 } }));
    expect(g1.interval).toBe(3); // first Good review: 3 days
    const g2 = await body(await req(`/api/cards/${card.id}/review`, { headers, body: { grade: 4 } }));
    expect(g2.interval).toBe(6);
    expect(Date.parse(g2.due)).toBeGreaterThan(Date.now() + 5 * DAY);
    const due = await body(await req('/api/cards/due', { headers }));
    expect([due.total, due.cards.some((c: any) => c.id === card.id)]).toEqual([2, false]);

    expect((await req(`/api/cards/${card.id}/review`, { headers: other.headers, body: { grade: 4 } })).status).toBe(404);
    expect((await req(`/api/cards/${card.id}/review`, { headers, body: { grade: 6 } })).status).toBe(400);
  });
});

it('minutesThisWeek counts measured writing time only, never the 40-minute limit (rounded up)', async () => {
  const { headers, user } = await testUser();
  const w = await seedPrompt({ skill: 'writing', part: 2, type: 'opinion' });
  await db.insert(attempts).values({ userId: user.id, promptId: w.id, skill: 'writing', part: 2, status: 'done' });
  await db.insert(attempts).values({ userId: user.id, promptId: w.id, skill: 'writing', part: 2, status: 'done', durationMs: 65_000 });
  expect((await body(await req('/api/progress', { headers }))).minutesThisWeek).toBe(2);
});
