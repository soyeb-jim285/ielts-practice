import { describe, expect, it } from 'vitest';
import { formatBand, formatClock, formatDuration, formatMinutes, formatRange, formatRelative, plural } from './format';

describe('format', () => {
  it('clock', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3605)).toBe('1:00:05');
    expect(formatClock(-12)).toBe('-0:12');
  });
  it('duration', () => {
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(95_000)).toBe('1m 35s');
    expect(formatDuration(120_000)).toBe('2m');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
  });
  it('bands', () => {
    expect(formatBand(6)).toBe('6.0');
    expect(formatBand(null)).toBe('–');
    expect(formatRange([6, 7])).toBe('6–7');
    expect(formatRange([6.5, 6.5])).toBe('6.5');
  });
  it('relative + plural', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(formatRelative(now - 10_000, now)).toBe('just now');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(formatRelative(now - 86_400_000, now)).toBe('yesterday');
    expect(plural(1, 'word')).toBe('1 word');
    expect(plural(1200, 'word')).toBe('1,200 words');
  });
});

describe('formatMinutes', () => {
  it('says "<1 min" instead of 0 minutes', () => {
    expect(formatMinutes(0)).toBe('<1 min');
    expect(formatMinutes(1)).toBe('1 minute');
    expect(formatMinutes(12)).toBe('12 minutes');
  });
});
