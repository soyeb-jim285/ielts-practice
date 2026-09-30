import { describe, expect, it } from 'vitest';
import { niceTicks } from './ChartRenderer';

describe('niceTicks', () => {
  it('covers the data with round steps', () => {
    expect(niceTicks(0, 87)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 4.3)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceTicks(0, 1200)).toEqual([0, 250, 500, 750, 1000, 1250]);
    expect(niceTicks(-12, 30)).toEqual([-20, -10, 0, 10, 20, 30]);
    expect(niceTicks(0, 0)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});
