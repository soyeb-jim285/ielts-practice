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

/** Where to practise a weak criterion. */
export const PRACTICE: Record<CriterionKey, { label: string; skill: 'speaking' | 'writing'; part: 1 | 2 | 3 }> = {
  fc: { label: 'Part 3 discussion', skill: 'speaking', part: 3 },
  gra: { label: 'Part 3 discussion', skill: 'speaking', part: 3 },
  lr: { label: 'Part 2 cue card', skill: 'speaking', part: 2 },
  p: { label: 'Part 1 interview', skill: 'speaking', part: 1 },
  ta: { label: 'Task 2 essay', skill: 'writing', part: 2 },
  cc: { label: 'Task 2 essay', skill: 'writing', part: 2 },
};

export type Progress = Schemas['Progress'];

// Kept for the writing results screens that import these from here; lib/result is the source.
export { bandColor as bandTone, categoryLabel } from '@/lib/result';
