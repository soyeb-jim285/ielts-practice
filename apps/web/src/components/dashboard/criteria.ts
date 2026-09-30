import type { CriterionKey } from '@server/ai/types';
import type { Schemas } from '@/lib/api';

// Chart series come from the palette (teal, sky, slate, ink); green/amber/red stay reserved for good/warn/bad. Every skill has four criteria,
// so the fourth (ink) is also dashed: series stay distinguishable without colour.
const TEAL = 'var(--accent)';
const SKY = 'var(--sky)';
const SLATE = 'var(--chart-3)';
const INK = 'var(--ink)';
export const SERIES_COLOR: Record<CriterionKey, string> = { fc: TEAL, ta: TEAL, lr: SKY, gra: SLATE, p: INK, cc: INK };
export const SERIES_DASH: Partial<Record<CriterionKey, string>> = { p: '5 3', cc: '5 3' };

/** Skill each criterion belongs to, and the part to suggest when the user has no scored attempts to tell us where they are weakest. */
export const PRACTICE: Record<CriterionKey, { skill: 'speaking' | 'writing'; part: 1 | 2 | 3 }> = {
  fc: { skill: 'speaking', part: 2 },
  gra: { skill: 'speaking', part: 2 },
  lr: { skill: 'speaking', part: 2 },
  p: { skill: 'speaking', part: 1 },
  ta: { skill: 'writing', part: 2 },
  cc: { skill: 'writing', part: 2 },
};
/** Short names for CTAs ("Practise Part 1 (Fluency)"). */
export const CRITERION_SHORT: Record<CriterionKey, string> = { fc: 'Fluency', gra: 'Grammar', lr: 'Vocabulary', p: 'Pronunciation', ta: 'Task response', cc: 'Coherence' };

/** Where to practise a weak criterion: its skill, and the part/task where the user's own scores on it are lowest (so the advice matches their history). */
export function practiceTarget(key: CriterionKey, trend: Progress['trend']) {
  const { skill, part: fallback } = PRACTICE[key];
  const byPart = new Map<number, number[]>();
  for (const t of trend) {
    const v = t.criteria[key];
    if (t.skill === skill && v != null) byPart.set(t.part, [...(byPart.get(t.part) ?? []), v]);
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const [part = fallback] = [...byPart].sort(([, a], [, b]) => mean(a) - mean(b))[0] ?? [];
  return { skill, part: part as 1 | 2 | 3, label: `${skill === 'speaking' ? 'Part' : 'Task'} ${part}` };
}

export type Progress = Schemas['Progress'];

// Kept for the writing results screens that import these from here; lib/result is the source.
export { bandColor as bandTone, categoryLabel } from '@/lib/result';
