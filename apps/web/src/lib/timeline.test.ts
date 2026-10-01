import type { AnalysisResult } from '@server/ai/types';
import { describe, expect, it } from 'vitest';
import { timelineMarkers, wordAt, wpmAt } from './timeline';

const words = Array.from({ length: 10 }, (_, i) => ({ w: `w${i}`, start: i * 2, end: i * 2 + 1 }));
const err = (id: string, category: string, start: number, time?: number) => ({ id, category, severity: 'minor' as const, start, end: start, original: 'a', correction: 'b', explanation: '', time });
const r = {
  v: 1, skill: 'speaking', part: 1, overall: 6, overallRaw: 6, range: [6, 7], criteria: {}, topFixes: [], vocabUpgrades: [], rewrite: { text: '', note: '' },
  words,
  errors: [err('e0', 'grammar.tense', 3, 6.2), err('e1', 'lexis.collocation', 1), err('e2', 'pronunciation.stress', 5), err('e3', 'fluency.pace', 7), err('e4', 'task.relevance', 2)],
  questions: [{ text: 'Q one', startWord: 0 }, { text: 'Q two', startWord: 5 }],
  metrics: {
    durationS: 22, pauses: [{ start: 3, end: 4.2, dur: 1.2, kind: 'long', midClause: false, voiced: false }, { start: 8, end: 8.6, dur: 0.6, kind: 'short', midClause: false, voiced: false }],
    fillers: [], repetitions: [], selfCorrections: [], wpmSeries: [], unclear: [{ wordIdx: 4, w: 'w4', conf: 0.3, tier: 3 }],
    fluency: { events: [{ kind: 'filled', start: 1, end: 1.4, sources: ['stt'] }] },
  },
} as unknown as AnalysisResult;

describe('timelineMarkers', () => {
  const t = timelineMarkers(r);
  it('maps categories by prefix, drops task notes, adds events and unclear words, sorted by time', () => {
    expect(t.markers.map((m) => [m.id, m.type])).toEqual([['d0', 'fluency'], ['e1', 'vocabulary'], ['e0', 'grammar'], ['u4', 'pronunciation'], ['e2', 'pronunciation'], ['e3', 'fluency']]);
    expect(t.markers.find((m) => m.id === 'e0')!.t).toBe(6.2); // error time wins over the word start
    expect(t.markers.some((m) => m.id === 'e4')).toBe(false);
  });
  it('question segments run to the next start or the duration; only long pauses become spans', () => {
    expect(t.questions).toEqual([{ idx: 0, start: 0, end: 10, text: 'Q one' }, { idx: 1, start: 10, end: 22, text: 'Q two' }]);
    expect(t.pauses).toEqual([{ start: 3, end: 4.2 }]);
  });
});

describe('wpmAt / wordAt', () => {
  const s = [{ t: 0, wpm: 100 }, { t: 10, wpm: 200 }]; // midpoints 5 and 15
  it('interpolates and clamps', () => {
    expect([wpmAt(s, 10, 0), wpmAt(s, 10, 10), wpmAt(s, 10, 20)]).toEqual([100, 150, 200]);
  });
  it('finds the playing word', () => {
    expect([wordAt(words, -1), wordAt(words, 0), wordAt(words, 5), wordAt(words, 99)]).toEqual([-1, 0, 2, 9]);
  });
});
