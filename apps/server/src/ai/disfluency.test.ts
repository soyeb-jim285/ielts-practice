import { expect, it } from 'vitest';
import { tagEvents } from './disfluency';

const words = 'I went to the market and and then I bought um some bread'.split(' ').map((w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.3 }));

it('anchors LLM tags on the nearest occurrence of their words and drops tags that match nothing', () => {
  const ev = tagEvents(words, [
    { type: 'repetition', start: 5, reparandum: 'and', interregnum: '', repair: 'and' },
    { type: 'false_start', start: 1, reparandum: 'I went', interregnum: '', repair: 'I bought' }, // the LLM's index is off by one, the words say 0
    { type: 'filled', start: 10, reparandum: 'um', interregnum: '', repair: '' },
    { type: 'repair', start: 4, reparandum: 'zebra', interregnum: '', repair: 'giraffe' }, // not in the transcript
  ]);
  expect(ev.map((e) => [e.kind, e.start])).toEqual([['repetition', 5 * 0.4], ['false_start', 0], ['filled', 10 * 0.4]]);
  expect(ev.every((e) => e.sources.join() === 'llm')).toBe(true);
});
