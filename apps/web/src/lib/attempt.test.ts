import { describe, expect, it } from 'vitest';
import { pollDelay } from './attempt';

describe('pollDelay', () => {
  it('backs off 2 s, 3 s, 5 s', () => {
    expect([0, 4, 5, 9, 10, 40].map(pollDelay)).toEqual([2000, 2000, 3000, 3000, 5000, 5000]);
  });
  it('makes about 12 calls in 40 s instead of 20', () => {
    let t = 0;
    let n = 0;
    while (t < 40_000) t += pollDelay(n++);
    expect(n).toBeLessThanOrEqual(13);
  });
});
