import { describe, expect, it } from 'vitest';
import { dayBucket, runs } from './group';

describe('dayBucket', () => {
  const now = new Date(2026, 8, 30, 15).getTime();
  const at = (daysAgo: number) => new Date(2026, 8, 30 - daysAgo, 2).toISOString();
  it('buckets by calendar day, not by 24h windows', () => {
    expect(dayBucket(at(0), now)).toBe('Today');
    expect(dayBucket(at(1), now)).toBe('Yesterday');
    expect(dayBucket(at(3), now)).toBe('Past 7 days');
    expect(dayBucket(at(12), now)).toBe('Past 30 days');
    expect(dayBucket(at(45), now)).toBe('Older');
  });
});

describe('runs', () => {
  it('groups consecutive items only', () => {
    expect(runs([1, 1, 2, 1], (n) => String(n)).map((r) => r.items.length)).toEqual([2, 1, 1]);
  });
});
