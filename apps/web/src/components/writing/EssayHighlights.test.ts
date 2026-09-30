import type { AnalysisError } from '@server/ai/types';
import { describe, expect, it } from 'vitest';
import { errorTitle, segmentEssay } from './EssayHighlights';

const err = (id: string, start: number, end: number): AnalysisError => ({ id, category: 'grammar.tense', severity: 'minor', start, end, original: '', correction: '', explanation: '' });

describe('segmentEssay', () => {
  it('splits at char spans, keeps text intact, and lists overlapping / unlocated errors separately', () => {
    const text = 'People has many reason to travel.';
    const { segments, unplaced } = segmentEssay(text, [err('e1', 16, 22), err('e0', 7, 10), err('e2', 8, 12), err('e3', -1, -1)]);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(segments.filter((s) => s.error).map((s) => [s.error!.id, s.text])).toEqual([
      ['e0', 'has'],
      ['e1', 'reason'],
    ]);
    expect(unplaced.map((e) => e.id)).toEqual(['e2', 'e3']);
  });
});

describe('errorTitle', () => {
  it('uses plain names for task problems and "Group: sub" otherwise', () => {
    expect(errorTitle('task.relevance')).toBe('Off-topic phrase');
    expect(errorTitle('grammar.subject-verb')).toBe('Grammar: subject verb');
    expect(errorTitle('lexis')).toBe('Vocabulary');
  });
});
