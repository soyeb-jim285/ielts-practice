import { roundBand } from '@ielts/core';
import type { Candidate, CoachFacts, Skill, SkillFacts, SpellGroup } from './types.js';

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const DAY = 86_400_000;

export function skillFacts(skill: Skill, scored: { at: Date; band: number }[], target: number | null): SkillFacts {
  const s = [...scored].sort((a, b) => a.at.getTime() - b.at.getTime());
  const tests = s.length;
  const band = tests ? roundBand(mean(s.slice(-5).map((x) => x.band))) : null;
  let trend: SkillFacts['trend'] = tests < 3 ? 'calibrating' : 'steady';
  let trendDelta: number | null = null;
  if (tests >= 6) {
    const b = s.map((x) => x.band);
    trendDelta = mean(b.slice(-3)) - mean(b.slice(-6, -3));
    trend = trendDelta >= 0.5 ? 'improving' : trendDelta <= -0.5 ? 'slipping' : 'steady';
  }
  return {
    skill, tests, band,
    range: band === null ? null : [band - 0.5, band + 0.5],
    trend, trendDelta,
    needMore: Math.max(0, 3 - tests),
    gap: band === null || target === null ? null : target - band,
    series: s.map((x) => ({ at: x.at.toISOString(), band: x.band })),
  };
}

export function overallFacts(skills: SkillFacts[]): CoachFacts['overall'] {
  const b = skills.flatMap((s) => (s.band === null ? [] : [s.band]));
  if (b.length < 2) return null;
  const band = roundBand(mean(b));
  return { band, range: [band - 0.5, band + 0.5] };
}

export function isPattern(occurrences: { attemptId: string }[]): boolean {
  return new Set(occurrences.map((o) => o.attemptId)).size >= 2 || occurrences.length >= 3;
}

// Items need skill + attemptId to cap "newest 15 tests per skill" (a test = one attemptId).
export function windowed<T extends { at: Date; skill: Skill; attemptId: string }>(items: T[], now: Date): T[] {
  const cutoff = now.getTime() - 60 * DAY;
  const recent = items.filter((i) => i.at.getTime() >= cutoff);
  const keep = new Map<Skill, Set<string>>();
  const newest = new Map<string, number>();
  for (const i of recent) newest.set(`${i.skill}:${i.attemptId}`, Math.max(newest.get(`${i.skill}:${i.attemptId}`) ?? 0, i.at.getTime()));
  for (const [k, t] of [...newest].sort((a, b) => b[1] - a[1])) {
    const [skill, id] = [k.slice(0, k.indexOf(':')) as Skill, k.slice(k.indexOf(':') + 1)];
    const set = keep.get(skill) ?? keep.set(skill, new Set()).get(skill)!;
    if (set.size < 15) set.add(id);
  }
  return recent.filter((i) => keep.get(i.skill)?.has(i.attemptId));
}

const HIGH = ['plural', 'spelling', 'word-limit', 'tfng-false-for-ng', 'ideas-undeveloped', 'under-length'];
const MEDIUM = ['grammar', 'collocation', 'word-choice', 'question-type', 'passage-timing'];
const LOW = ['pronunciation', 'fluency'];
// ponytail: prefix match on kind; tune when real kind names settle.
export const FIXABILITY = (kind: string): number =>
  HIGH.includes(kind) ? 1 : MEDIUM.some((p) => kind.startsWith(p)) ? 0.7 : LOW.some((p) => kind.startsWith(p)) ? 0.4 : 0.5;

export function priority(gap: number | null, share: number, kind: string): number {
  return (gap === null ? 0.5 : Math.max(gap, 0.25)) * share * FIXABILITY(kind);
}

export function pickCandidates(all: Candidate[]): Candidate[] {
  return [...all].sort((a, b) => b.score - a.score).slice(0, 6);
}

export function findWin(older: Candidate[], recentTests: Record<Skill, string[]>, skills: SkillFacts[]): Candidate | null {
  for (const c of older) {
    const recent = new Set(recentTests[c.skill].slice(0, 3));
    const hit = c.evidence.attemptIds.some((id) => recent.has(id));
    if (new Set(c.evidence.attemptIds).size >= 3 && !hit) return c;
  }
  const s = skills.find((x) => x.trend === 'improving');
  if (!s) return null;
  return {
    id: `win:${s.skill}`, skill: s.skill, kind: 'improving', count: s.tests, tests: s.tests, share: 0, score: 0,
    facts: { band: s.band ?? 0, delta: s.trendDelta ?? 0 }, evidence: { attemptIds: [] }, actions: [],
  };
}

const collapse = (w: string) => w.replace(/(.)\1+/g, '$1');

export function spellRule(typed: string, correct: string): SpellGroup['rule'] {
  const t = typed.toLowerCase(), c = correct.toLowerCase();
  if (c === t + 's' || c === t + 'es' || t === c + 's' || t === c + 'es') return 'plural';
  if (t.replace(/ie|ei/g, '#') === c.replace(/ie|ei/g, '#')) return 'ie-ei';
  if (collapse(t) === collapse(c)) return 'double';
  let p = 0;
  while (p < t.length && p < c.length && t[p] === c[p]) p++;
  if (p >= 3 && t.length > p && c.length > p && t.length - p <= 4 && c.length - p <= 4) return 'ending';
  if (Math.abs(t.length - c.length) === 1) {
    const [s, l] = t.length < c.length ? [t, c] : [c, t];
    if ([...l].some((_, i) => l.slice(0, i) + l.slice(i + 1) === s)) return 'silent';
  }
  return 'other';
}
