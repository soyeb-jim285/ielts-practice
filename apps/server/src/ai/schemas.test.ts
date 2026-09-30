import { expect, it } from 'vitest';
import { roundBand } from '@ielts/core';
import { AiError } from './openrouter';
import { poolCriteria, settleRanges, withScoringSamples, type LlmCriterion } from './schemas';

const crit = (band: number, range: [number, number]): LlmCriterion => ({ band, range, descriptor: '', evidence: [], summary: '' });

it('settleRanges: criterion ranges stay within band ±1; overall range is at least ±0.5', () => {
  const c = { fc: crit(0, [0, 4]), lr: crit(6, [6, 6]), gra: crit(6, [5, 7]) };
  const range = settleRanges(c, (b) => roundBand((b.fc + b.lr + b.gra) / 3));
  expect([c.fc.range, c.lr.range, c.gra.range]).toEqual([[0, 1], [5, 7], [5, 7]]);
  expect(range).toEqual([3.5, 5]);
  const one = { a: crit(7, [7, 8]) };
  expect(settleRanges(one, (b) => b.a)).toEqual([6.5, 8]);
});

it('withScoringSamples: retries the full analysis once on a retryable failure, not on others', async () => {
  const score = async () => ({ criteria: { a: crit(6, [6, 6]) } });
  let n = 0;
  const flaky = async () => {
    if (n++ === 0) throw new AiError('timeout', 'slow');
    return { criteria: { a: crit(7, [7, 7]) }, extra: 1 };
  };
  const r = await withScoringSamples(flaky, score);
  expect(r).toMatchObject({ extra: 1, criteria: { a: { band: 7 } } });
  expect(r.samples.map((s) => s.a.band)).toEqual([7, 6, 6]);
  expect(n).toBe(2);

  let m = 0;
  const bad = async () => {
    m++;
    throw new AiError('http', 'credits', 402);
  };
  await expect(withScoringSamples(bad, score)).rejects.toMatchObject({ status: 402 });
  expect(m).toBe(1);
});

it('poolCriteria: mean of samples (not the median sample), mapped then rounded; text from a sample at that band, else the official descriptor', () => {
  const s = (band: number, summary = `at ${band}`) => ({ a: { ...crit(band, [band, band]), summary } });
  // median of [5, 5, 7, 7, 7] is 7; the mean 6.2 rounds to 6
  expect(poolCriteria([s(5), s(5), s(7), s(7), s(7)]).a).toMatchObject({ band: 6, range: [5, 7] });
  expect(poolCriteria([s(5), s(6), s(6)]).a).toMatchObject({ band: 6, summary: 'at 6' });
  const describe = (_: 'a', b: number) => `official ${b}`;
  expect(poolCriteria([s(5), s(5)], (m) => m + 0.5, describe).a).toMatchObject({ band: 6, range: [6, 6], descriptor: 'official 6', summary: 'To reach band 7: official 7' });
  expect(poolCriteria([s(5), s(6), s(6)], (m) => m, describe).a.descriptor).toBe(''); // a sample gave 6: its own text is kept
  // an overall shift of +0.5 on four criteria at 5 raises the two nearest rounding up, so the shown bands average to 5.5
  const four = (lr: number) => ({ ta: crit(5, [5, 5]), cc: crit(5, [5, 5]), lr: crit(lr, [lr, lr]), gra: crit(5, [5, 5]) });
  const p = poolCriteria([four(5), four(6), four(5)], (m) => m + 0.5);
  expect(Object.values(p).map((c) => c.band)).toEqual([5, 5, 6, 6]);
});
