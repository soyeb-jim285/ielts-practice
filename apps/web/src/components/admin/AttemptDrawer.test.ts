import { expect, it } from 'vitest';
import { groupLive } from './AttemptDrawer';

const row = (stage: string, model: string, costUsd: number, o: object = {}) =>
  ({ stage, model, costUsd, ok: true, estimated: true, retry: false, paidBy: 'house', inputTokens: null, outputTokens: null, audioSeconds: null, characters: null, criterion: null, sample: null, ...o }) as never;

it('sums the per-minute live reports into one line per stage and model, most expensive first', () => {
  const g = groupLive([
    row('live_stt', 'stt-rt-v5', 0.001, { audioSeconds: 30 }),
    row('examiner_llm', 'deepseek', 0.0002, { inputTokens: 100, outputTokens: 10, estimated: false }),
    row('live_stt', 'stt-rt-v5', 0.002, { audioSeconds: 60 }),
    row('examiner_llm', 'deepseek', 0.0003, { inputTokens: 200, outputTokens: 20, ok: false, estimated: false }),
  ]);
  expect(g.map((x) => [x.stage, x.calls])).toEqual([['live_stt', 2], ['examiner_llm', 2]]);
  expect(g[0]).toMatchObject({ audioSeconds: 90, inputTokens: null, failed: 0 });
  expect(g[0]!.costUsd).toBeCloseTo(0.003);
  expect(g[1]).toMatchObject({ inputTokens: 300, outputTokens: 30, failed: 1, estimated: false });
});
