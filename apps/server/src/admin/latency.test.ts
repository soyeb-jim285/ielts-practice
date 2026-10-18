import { expect, it } from 'vitest';
import { pct, summarize } from './latency';

it('nearest-rank percentiles', () => {
  const xs = Array.from({ length: 20 }, (_, i) => i + 1);
  expect(pct(xs, 0.5)).toBe(10);
  expect(pct(xs, 0.95)).toBe(19);
  expect(pct([], 0.5)).toBe(0);
});

it('summarizes stages, skips turns without LLM time, groups by configuration', () => {
  const t = (at: number, total: number, label = 'A', llm = 500) => ({ at, wait: 500, stt: 100, llm, tts: 200, net: total - 1300, total, label });
  const s = summarize(
    [
      { id: 's2', createdAt: new Date('2026-10-18T10:00:00Z'), turns: [t(1, 1000), t(2, 2000), t(3, 3000, 'B'), t(4, 9000, 'A', 0)] },
      { id: 's1', createdAt: new Date('2026-10-17T10:00:00Z'), turns: [] },
    ],
    30,
  );
  expect(s.turns).toBe(3);
  expect(s.sessions).toBe(1);
  expect(s.stages!.total).toEqual({ p50: 2000, p95: 3000, mean: 2000 });
  expect(s.byLabel).toEqual([{ label: 'A', turns: 2, p50: 1000, p95: 2000 }, { label: 'B', turns: 1, p50: 3000, p95: 3000 }]);
  expect(s.recent).toEqual([{ sessionId: 's2', at: '2026-10-18T10:00:00.000Z', turns: 3, p50: 2000, p95: 3000 }]);
  expect(summarize([], 7).stages).toBeNull();
});
