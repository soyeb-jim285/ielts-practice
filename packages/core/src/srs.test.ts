import { it, expect } from 'vitest';
import { review } from './srs';
const now = new Date('2026-01-01T00:00:00Z');
it('sm2 progression', () => {
  let s = { ease: 2.5, interval: 0, reps: 0, due: now };
  s = review(s, 4, now); expect(s.interval).toBe(3);
  s = review(s, 4, now); expect(s.interval).toBe(6);
  s = review(s, 4, now); expect(s.interval).toBe(15);
  s = review(s, 1, now); expect([s.reps, s.interval]).toEqual([0, 1]);
  expect(s.ease).toBeGreaterThanOrEqual(1.3);
});
