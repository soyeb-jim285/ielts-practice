import { expect, it } from 'vitest';
import { roundBand } from '@ielts/core';
import { AiError } from './openrouter';
import { settleRanges, withScoringSamples, type LlmCriterion } from './schemas';

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
  expect(await withScoringSamples(flaky, score)).toMatchObject({ extra: 1, criteria: { a: { band: 6 } } });
  expect(n).toBe(2);

  let m = 0;
  const bad = async () => {
    m++;
    throw new AiError('http', 'credits', 402);
  };
  await expect(withScoringSamples(bad, score)).rejects.toMatchObject({ status: 402 });
  expect(m).toBe(1);
});
