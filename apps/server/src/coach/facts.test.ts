import { describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { analyses, attempts, lrAttempts, lrTests, mistakes } from '../db/schema';
import { seedPrompt, testUser } from '../test/helpers';
import { buildFacts, lastTestAt } from './facts';

const DAY = 864e5;
const now = new Date();
const ago = (d: number) => new Date(now.getTime() - d * DAY);
let n = 0;

async function ws(userId: string, skill: 'writing' | 'speaking', daysAgo: number, overall: number, result: object = {}, part = 2) {
  const p = await seedPrompt({ skill, part });
  const [a] = await db.insert(attempts).values({ userId, promptId: p.id, skill, part, status: 'done', durationMs: 60000, createdAt: ago(daysAgo) }).returning();
  await db.insert(analyses).values({ attemptId: a!.id, result, overall, criteria: {}, models: {}, createdAt: ago(daysAgo) });
  return a!;
}
async function lr(userId: string, skill: 'listening' | 'reading', daysAgo: number, o: { band: number | null; analysis?: object; parts?: number[]; stats?: object }) {
  const [t] = await db.insert(lrTests).values({ slug: `facts-${++n}-${Math.random().toString(36).slice(2, 6)}`, skill, variant: 'academic', source: 'generated', ref: 'X', title: 'x', data: { sections: [] } as never, restricted: false }).returning();
  const [a] = await db.insert(lrAttempts).values({ userId, testId: t!.id, mode: 'practice', status: 'submitted', band: o.band, parts: o.parts ?? null, analysis: o.analysis as never, stats: o.stats as never, elapsedS: 600, submittedAt: ago(daysAgo), startedAt: ago(daysAgo) }).returning();
  return a!;
}
const gap = (n: number, kind: string, word = 'x', typed = 'y') => ({ n, kind, label: kind, message: '', word, typed });

describe('buildFacts', () => {
  it('flags ideas-undeveloped from structure paragraphs in 3 of 4 Writing tests', async () => {
    const { user } = await testUser();
    const bad = { structure: { paragraphs: [{ role: 'body', topicSentence: '', ok: false, note: '' }], overview: null, position: null, planFollowed: null } };
    const good = { structure: { paragraphs: [{ role: 'body', topicSentence: '', ok: true, note: '' }], overview: null, position: null, planFollowed: null } };
    const made = [await ws(user.id, 'writing', 1, 6, bad), await ws(user.id, 'writing', 2, 6, bad), await ws(user.id, 'writing', 3, 6, bad), await ws(user.id, 'writing', 4, 6, good)];
    const f = await buildFacts(user.id, now);
    const c = f.candidates.find((x) => x.kind === 'ideas-undeveloped')!;
    expect(c).toMatchObject({ id: 'writing:ideas-undeveloped', skill: 'writing', tests: 3 });
    expect(new Set(c.evidence.attemptIds)).toEqual(new Set(made.slice(0, 3).map((a) => a.id)));
    expect(f.skills.find((s) => s.skill === 'writing')!.tests).toBe(4);
    expect(f.target).toBeNull();
  });

  it('flags plural gaps in 3 of 5 Listening tests with question numbers', async () => {
    const { user } = await testUser();
    for (let i = 0; i < 5; i++) await lr(user.id, 'listening', i + 1, { band: 6.5, analysis: { gaps: i < 3 ? [gap(3, 'plural'), gap(7, 'plural')] : [], tfng: [], byType: [] } });
    const f = await buildFacts(user.id, now);
    const c = f.candidates.find((x) => x.kind === 'plural')!;
    expect(c).toMatchObject({ skill: 'listening', count: 6, tests: 3 });
    expect(c.evidence.lr!.map((e) => e.n).sort()).toEqual([3, 3, 3, 7, 7, 7]);
    expect(f.skills.find((s) => s.skill === 'listening')!.tests).toBe(5);
  });

  it('copes with thin analyses and counts a partial L/R attempt in patterns but not in tests', async () => {
    const { user } = await testUser();
    await ws(user.id, 'speaking', 1, 6, {}, 1);
    await lr(user.id, 'reading', 1, { band: 6, analysis: { gaps: [gap(1, 'spelling')], tfng: [], byType: [] } });
    await lr(user.id, 'reading', 2, { band: null, parts: [1], analysis: { gaps: [gap(2, 'spelling')], tfng: [], byType: [] } });
    const f = await buildFacts(user.id, now);
    expect(f.skills.find((s) => s.skill === 'reading')!.tests).toBe(1);
    expect(f.candidates.find((x) => x.id === 'reading:spelling')).toMatchObject({ count: 2, tests: 2 });
    expect(f.totalTests).toBe(3);
  });

  it('groups swaps, spelling and counts the week', async () => {
    const { user } = await testUser();
    const a = await ws(user.id, 'writing', 1, 6);
    const b = await ws(user.id, 'writing', 2, 6);
    for (const x of [a, b]) {
      await db.insert(mistakes).values({ userId: user.id, attemptId: x.id, errorId: 'e0', category: 'lexis.word-choice', original: 'big', correction: 'significant', explanation: '' });
      await db.insert(mistakes).values({ userId: user.id, attemptId: x.id, errorId: 'e1', category: 'lexis.spelling', original: 'recieve', correction: 'receive', explanation: '' });
    }
    const f = await buildFacts(user.id, now);
    expect(f.swaps).toMatchObject([{ from: 'big', to: ['significant'], count: 2, source: 'mistake' }]);
    expect(f.spelling).toMatchObject([{ rule: 'ie-ei', count: 2 }]);
    expect(f.weekStats).toMatchObject({ tests: 2, days: 2, prev: { tests: 0 } });
  });
});

describe('lastTestAt', () => {
  it('is the newest of a Writing/Speaking and an L/R finish; null with none', async () => {
    const { user } = await testUser();
    expect(await lastTestAt(user.id)).toBeNull();
    await ws(user.id, 'speaking', 5, 6);
    const r = await lr(user.id, 'listening', 2, { band: 6 });
    expect((await lastTestAt(user.id))?.getTime()).toBe(r.submittedAt!.getTime());
    await ws(user.id, 'writing', 1, 6);
    expect((await lastTestAt(user.id))!.getTime()).toBeGreaterThan(r.submittedAt!.getTime());
  });
});
