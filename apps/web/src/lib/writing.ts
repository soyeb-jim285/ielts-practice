// Writing labels with no component imports, so routes can use them without pulling in PromptPanel.
import { MIN_WORDS } from '@ielts/core';
import type { ChartSpec } from '@server/ai/types';

export const minWords = (part: number) => (part === 1 ? MIN_WORDS.t1 : MIN_WORDS.t2);
export const taskLabel = (p: { part: number; variant: 'academic' | 'general' | null }) =>
  p.part === 2 ? 'Task 2' : `Task 1 ${p.variant === 'general' ? 'General' : 'Academic'}`;

/** Below this many words a submit is refused: the server rates ≤20 words Band 1 anyway. */
export const SUBMIT_FLOOR = 21;

const TYPE_LABEL: Record<string, string> = {
  'adv-disadv': 'Advantages & disadvantages',
  'problem-solution': 'Problem & solution',
  'two-part': 'Two-part question',
  'letter-formal': 'Formal letter',
  'letter-semi': 'Semi-formal letter',
  'letter-informal': 'Informal letter',
  line: 'Line graph',
  bar: 'Bar chart',
  pie: 'Pie chart',
  mixed: 'Mixed charts',
  'p1-topic': 'Part 1 topic',
  'cue-card': 'Cue card',
  'p3-linked': 'Part 3 (linked to cue card)',
  'p3-discussion': 'Part 3 discussion',
};
/** Human label for a prompt `type` slug (writing and speaking). */
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, ' ');

/** Accepts the untyped `prompt.chart` JSON; anything that isn't a known ChartSpec is null. */
export const asChart = (c: unknown): ChartSpec | null =>
  c && typeof c === 'object' && ['line', 'bar', 'pie', 'table', 'process', 'map'].includes((c as { kind?: string }).kind ?? '') ? (c as ChartSpec) : null;
