import { it, expect } from 'vitest';
import { computeSpeechMetrics, type Word } from './speech';
const mk = (a: [string, number, number, number?][]): Word[] => a.map(([w, start, end, conf]) => ({ w, start, end, conf }));
it('detects short and long pauses, mid-clause flag', () => {
  const m = computeSpeechMetrics(mk([['I', 0, 0.2], ['love', 0.25, 0.5], ['the', 0.9, 1.0], ['city.', 1.1, 1.5], ['It', 2.8, 3.0]]), { durationS: 3 });
  expect(m.pauses.map(p => [p.kind, p.midClause])).toEqual([['short', true], ['long', false]]);
  expect(m.longPauses).toBe(1);
  expect(m.mlr).toBeCloseTo(5 / 3);
});
it('lexical fillers and repetitions and self-correction', () => {
  const m = computeSpeechMetrics(mk([['I', 0, .1], ['um', .2, .3], ['I', .35, .4], ['I', .45, .5], ['went', .55, .7], ['go', .75, .9], ['went', .95, 1.1]]), { durationS: 1.2 });
  expect(m.fillers.map(f => f.word)).toEqual(['um']);
  expect(m.repetitions.length).toBeGreaterThanOrEqual(1);
});
it('voiced gap from energy counts as filler', () => {
  const energy = Array.from({ length: 40 }, (_, i) => (i >= 10 && i < 20 ? 200 : i < 10 || i >= 30 ? 150 : 0)); // 50ms frames
  const m = computeSpeechMetrics(mk([['hello', 0, 0.45], ['there', 1.5, 1.9]]), { durationS: 2, energy, frameMs: 50, voiceThreshold: 60 });
  expect(m.fillers.some(f => f.kind === 'voiced')).toBe(true);
});
it('wpm series 10s windows 5s hop and unclear tiers', () => {
  const words = Array.from({ length: 60 }, (_, i) => ({ w: 'w', start: i * 0.5, end: i * 0.5 + 0.4, conf: i === 3 ? 0.3 : 0.95 }));
  const m = computeSpeechMetrics(words, { durationS: 30 });
  expect(m.wpmSeries[0]).toEqual({ t: 0, wpm: 120 });
  expect(m.wpmSeries.length).toBe(5);
  expect(m.unclear).toEqual([{ wordIdx: 3, w: 'w', conf: 0.3, tier: 3 }]);
});
it('empty words', () => expect(computeSpeechMetrics([], { durationS: 5 }).wordCount).toBe(0));
it('fillers are not counted as words and break runs', () => {
  const m = computeSpeechMetrics(mk([['I', 0, .2], ['um', .2, .5], ['think', .5, .8], ['it', .8, 1], ['uh', 1, 1.3], ['works', 1.3, 1.6]]), { durationS: 1.8 });
  expect(m.wordCount).toBe(4);
  expect(m.speechRate).toBeCloseTo(4 / (1.8 / 60));
  expect(m.mlr).toBeCloseTo(4 / 3);
});
