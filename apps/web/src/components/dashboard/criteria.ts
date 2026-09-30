import type { CriterionKey } from '@server/ai/types';

// ponytail: mid-lightness hues that read on both themes; move to styles.css tokens if more charts need a categorical palette.
export const SERIES_COLOR: Record<CriterionKey, string> = {
  fc: 'oklch(0.62 0.15 265)',
  ta: 'oklch(0.62 0.15 265)',
  lr: 'oklch(0.66 0.12 185)',
  gra: 'oklch(0.72 0.14 70)',
  p: 'oklch(0.63 0.17 345)',
  cc: 'oklch(0.63 0.17 345)',
};

/** Where to practise a weak criterion. */
export const PRACTICE: Record<CriterionKey, { label: string; skill: 'speaking' | 'writing'; part: 1 | 2 | 3 }> = {
  fc: { label: 'Part 3 discussion', skill: 'speaking', part: 3 },
  gra: { label: 'Part 3 discussion', skill: 'speaking', part: 3 },
  lr: { label: 'Part 2 cue card', skill: 'speaking', part: 2 },
  p: { label: 'Part 1 interview', skill: 'speaking', part: 1 },
  ta: { label: 'Task 2 essay', skill: 'writing', part: 2 },
  cc: { label: 'Task 2 essay', skill: 'writing', part: 2 },
};

export type Progress = {
  trend: { attemptId: string; date: string; skill: 'speaking' | 'writing'; part: number; overall: number; criteria: Record<string, number> }[];
  streak: number;
  minutesThisWeek: number;
  attempts: number;
  weakest: { key: string; avg: number } | null;
  topMistakes: { category: string; count: number }[];
  predicted: { speaking: number | null; writing: number | null };
};

// Kept for the writing results screens that import these from here; lib/result is the source.
export { bandColor as bandTone, categoryLabel } from '@/lib/result';
