import { expect, it } from 'vitest';
import { pronunciationSummary, type PronResult } from './modal';

const w = (word: string, score: number | null, start = 1, bad = true) => ({ word, score, accent: 'gb' as const, start, end: start + 0.4, phones: [{ expected: 'θ', heard: bad ? 't' : 'θ', score: 0.2, ok: !bad }] });

it('keeps the worst content words once each and only repeated sound swaps', () => {
  const d = {
    accuracy: 82, fluency: { wordsPerMinute: 140 },
    words: [w('think', 60, 1), w('Think', 40, 9), w('the', 10), w('village', 65, 3), w('river', 90), w('three', 50, 5, false), w('both', null)],
    confusions: [{ expected: 'θ', heard: 't', count: 3 }, { expected: 'v', heard: 'w', count: 1 }],
  } as unknown as PronResult;
  const s = pronunciationSummary(d);
  expect(s.words.map((x) => [x.word, x.score])).toEqual([['Think', 40], ['village', 65]]);
  expect(s.confusions).toEqual([{ expected: 'θ', heard: 't', count: 3 }]);
  expect(s).toMatchObject({ accuracy: 82, wordsPerMinute: 140 });
});
