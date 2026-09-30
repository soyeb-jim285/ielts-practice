import { expect, it } from 'vitest';
import { AiError } from './openrouter';
import { poolCriteria, retryOnce, scoringSamples, settleRanges, type LlmCriterion } from './schemas';

const crit = (band: number, range: [number, number]): LlmCriterion => ({ band, range, descriptor: '', evidence: [], summary: '' });

it('settleRanges: overall ± q (conformal), criteria ± ⌈q⌉ whole bands, clamped', () => {
  const c = { fc: crit(0, [0, 4]), lr: crit(6, [6, 6]), gra: crit(9, [5, 7]) };
  expect(settleRanges(c, 5, 1)).toEqual([4, 6]);
  expect([c.fc.range, c.lr.range, c.gra.range]).toEqual([[0, 1], [5, 7], [8, 9]]);
  expect(settleRanges(c, 8.5, 0.5)).toEqual([8, 9]);
  expect(c.lr.range).toEqual([5, 7]); // q 0.5 still spans a whole band either side
  expect(settleRanges(c, 8.5, 1.5)).toEqual([7, 9]);
  expect(c.lr.range).toEqual([4, 8]);
});

it('retryOnce retries a retryable failure once, not others; scoringSamples drops failed calls and throws only when all fail', async () => {
  let n = 0;
  const flaky = async () => {
    if (n++ === 0) throw new AiError('timeout', 'slow');
    return 7;
  };
  expect(await retryOnce(flaky)).toBe(7);
  expect(n).toBe(2);
  let m = 0;
  const bad = async () => {
    m++;
    throw new AiError('http', 'credits', 402);
  };
  await expect(retryOnce(bad)).rejects.toMatchObject({ status: 402 });
  expect(m).toBe(1);
  expect(await scoringSamples([async () => 1, bad, async () => 3])).toEqual([1, 3]);
  await expect(scoringSamples([bad, bad])).rejects.toMatchObject({ status: 402 });
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
