import { it, expect } from 'vitest';
import { computeTextMetrics, countWords, mtld, tokenize } from './text';
it('counts paragraphs, sentences, words', () => {
  const m = computeTextMetrics('First para. Has two sentences!\n\nSecond one?');
  expect([m.paragraphs, m.sentences, m.words]).toEqual([2, 3, 7]);
});
it('flags a linker that opens 3+ sentences', () => {
  const m = computeTextMetrics('Moreover it is. Moreover it was. Moreover it will be.');
  expect(m.linkers.find(l => l.word === 'moreover')).toMatchObject({ count: 3, overused: true });
});
it('does not flag mid-sentence linkers or "in addition to"', () => {
  const m = computeTextMetrics(
    'Cars are fast, however they pollute. Buses are cheap, however they are slow. Trains are clean, however they cost more. ' +
      'In addition to trains, bikes help. People walk, for example in cities. Some cycle, for example to work.',
  );
  expect(m.linkers.find(l => l.word === 'however')).toMatchObject({ count: 3, overused: false });
  expect(m.linkers.find(l => l.word === 'for example')).toMatchObject({ count: 2, overused: false });
  expect(m.linkers.find(l => l.word === 'in addition')).toBeUndefined();
});
it('reports the linker-opening ratio without flagging linkers used once', () => {
  const m = computeTextMetrics('Firstly, cars pollute. Moreover, they are loud. Cities grow. Furthermore, roads fill. People move. Parks shrink.');
  expect(m.linkers.filter(l => l.overused)).toEqual([]);
  expect(m.linkerOpeningRatio).toBeCloseTo(0.5);
});
it('mtld higher for diverse text', () => {
  expect(mtld(tokenize('the cat the cat the cat the cat the cat the cat'))).toBeLessThan(mtld(tokenize('a quick brown fox jumps over lazy dogs while seven wizards quietly hex ancient boxes')));
});
it('counts numbers, percentages and currency as words', () => {
  expect(countWords('75% in 2017')).toBe(3);
  expect(countWords('It cost $20 - a rise of 5.5 points.')).toBe(8);
  expect(computeTextMetrics('Sales rose 75% in 2017.').words).toBe(5);
});
