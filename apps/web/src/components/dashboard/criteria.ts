import type { CriterionKey } from '@server/ai/types';
import type { Schemas } from '@/lib/api';

// Categorical, non-semantic hues (indigo, teal, violet, slate) that read on both themes: green/amber/red stay reserved for good/warn/bad.
// Each skill's four criteria get four distinct colours. ponytail: move to styles.css tokens if more charts need a categorical palette.
const INDIGO = 'oklch(0.6 0.15 265)';
const TEAL = 'oklch(0.64 0.11 190)';
const VIOLET = 'oklch(0.6 0.16 310)';
const SLATE = 'oklch(0.6 0.03 250)';
export const SERIES_COLOR: Record<CriterionKey, string> = { fc: INDIGO, ta: INDIGO, lr: TEAL, gra: VIOLET, p: SLATE, cc: SLATE };

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
