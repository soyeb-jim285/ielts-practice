import { describe, expect, it } from 'vitest';
import { findWin, isPattern, overallFacts, priority, skillFacts, spellRule, windowed } from './rules.js';
import type { Candidate, Skill } from './types.js';

const d = (i: number) => new Date(Date.UTC(2026, 0, 1 + i));
const sc = (...b: number[]) => b.map((band, i) => ({ at: d(i), band }));

describe('skillFacts', () => {
  it('0 tests', () => {
    const f = skillFacts('writing', [], 7);
    expect(f).toMatchObject({ tests: 0, band: null, range: null, trend: 'calibrating', needMore: 3, gap: null });
  });
  it('2 tests calibrating', () => {
    const f = skillFacts('writing', sc(6, 6), 7);
    expect(f).toMatchObject({ trend: 'calibrating', needMore: 1 });
  });
  it('4 steady, gap from target', () => {
    const f = skillFacts('reading', sc(6, 6.5, 6, 6.5), 7.5);
    expect(f).toMatchObject({ trend: 'steady', needMore: 0, band: 6.5, range: [6, 7], gap: 1 });
    expect(skillFacts('reading', sc(6, 6.5, 6, 6.5), null).gap).toBeNull();
  });
  it('6 rising improving', () => {
    const f = skillFacts('listening', sc(5, 5, 5, 5.5, 5.5, 5.5), 7);
    expect(f).toMatchObject({ trend: 'improving', trendDelta: 0.5 });
  });
  it('6 with one noisy jump steady', () => {
    expect(skillFacts('listening', sc(6, 6, 6, 6, 6, 7), 7).trend).toBe('steady');
  });
  it('slipping', () => {
    expect(skillFacts('listening', sc(6, 6, 6, 5.5, 5.5, 5.5), 7).trend).toBe('slipping');
  });
});

describe('overallFacts', () => {
  it('one skill -> null', () => {
    expect(overallFacts([skillFacts('listening', sc(6, 6, 6), 7), skillFacts('reading', [], 7)])).toBeNull();
  });
  it('two skills', () => {
    const o = overallFacts([skillFacts('listening', sc(6, 6, 6), 7), skillFacts('reading', sc(7, 7, 7), 7)]);
    expect(o).toEqual({ band: 6.5, range: [6, 7] });
  });
});

describe('isPattern', () => {
  it('rules', () => {
    expect(isPattern([{ attemptId: 'a' }, { attemptId: 'a' }])).toBe(false);
    expect(isPattern([{ attemptId: 'a' }, { attemptId: 'b' }])).toBe(true);
    expect(isPattern([{ attemptId: 'a' }, { attemptId: 'a' }, { attemptId: 'a' }])).toBe(true);
  });
});

describe('priority', () => {
  it('values', () => {
    expect(priority(0, 1, 'plural')).toBe(0.25);
    expect(priority(null, 0.5, 'plural')).toBe(0.25);
    expect(priority(1, 1, 'nonsense')).toBe(0.5);
  });
});

describe('windowed', () => {
  it('60 days and 15 per skill', () => {
    const now = d(100);
    const items = [
      { at: d(10), skill: 'writing' as Skill, attemptId: 'old' },
      ...Array.from({ length: 20 }, (_, i) => ({ at: d(50 + i), skill: 'reading' as Skill, attemptId: `r${i}` })),
    ];
    const out = windowed(items, now);
    expect(out.find((x) => x.attemptId === 'old')).toBeUndefined();
    expect(out).toHaveLength(15);
    expect(out.some((x) => x.attemptId === 'r19')).toBe(true);
    expect(out.some((x) => x.attemptId === 'r4')).toBe(false);
  });
});

describe('findWin', () => {
  const cand = (attemptIds: string[]): Candidate => ({
    id: 'w:articles', skill: 'writing', kind: 'articles', count: attemptIds.length, tests: attemptIds.length, share: 0.3, score: 0.1, facts: {},
    evidence: { attemptIds }, actions: [],
  });
  const none = { listening: [], reading: [], writing: [], speaking: [] } as Record<Skill, string[]>;
  it('fixed pattern', () => {
    const w = findWin([cand(['a', 'b', 'c'])], { ...none, writing: ['x', 'y', 'z'] }, []);
    expect(w?.id).toBe('w:articles');
  });
  it('still present -> none', () => {
    expect(findWin([cand(['a', 'b', 'c'])], { ...none, writing: ['x', 'b', 'z'] }, [])).toBeNull();
  });
  it('falls back to improving skill', () => {
    const f = skillFacts('listening', sc(5, 5, 5, 5.5, 5.5, 5.5), 7);
    expect(findWin([], none, [f])).toMatchObject({ skill: 'listening', kind: 'improving' });
  });
});

describe('spellRule', () => {
  it('rules', () => {
    expect(spellRule('accomodation', 'accommodation')).toBe('double');
    expect(spellRule('enviroment', 'environment')).toBe('silent');
    expect(spellRule('existance', 'existence')).toBe('ending');
    expect(spellRule('recieve', 'receive')).toBe('ie-ei');
    expect(spellRule('ticket', 'tickets')).toBe('plural');
    expect(spellRule('foo', 'quux')).toBe('other');
  });
});

describe('only listening scored', () => {
  it('overall null', () => {
    const skills = [skillFacts('listening', sc(6, 6, 6), 7)];
    expect(skills[0]!.band).toBe(6);
    expect(overallFacts(skills)).toBeNull();
  });
});
