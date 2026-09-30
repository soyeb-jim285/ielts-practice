import { computeSpeechMetrics, fuseDisfluencies } from '@ielts/core';
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

it('"like" and "you know" are not fillers on transcript evidence alone unless they sit between pauses', () => {
  const at = (text: string) => {
    const w = text.split(' ').flatMap((x, i) => (x === '_' ? [] : [{ w: x, start: 0, end: 0.3, gap: text.split(' ')[i - 1] === '_' }]));
    let t = 0;
    return w.map((x) => { t += x.gap ? 0.8 : 0.35; return { w: x.w, start: t, end: t + 0.3 }; });
  };
  const filled = (text: string, llm: { start: number }[] = []) => {
    const words = at(text), m = computeSpeechMetrics(words, { durationS: words.at(-1)!.end + 0.2 });
    return fuseDisfluencies(m, undefined, 0.3, llm.map((l) => ({ kind: 'filled' as const, start: l.start, end: l.start + 0.3, sources: ['llm' as const] }))).filter((e) => e.kind === 'filled').length;
  };
  expect(filled('I like football')).toBe(0);
  expect(filled('I like _ uh _ I like football')).toBe(1); // only the "uh"
  expect(filled('it was _ like _ big')).toBe(1);
  expect(filled('you know it was cold')).toBe(0);
  expect(filled('I like football', [{ start: at('I like football')[1]!.start }])).toBe(1); // the text tagger flagged it
});
