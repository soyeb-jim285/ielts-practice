import { describe, expect, it } from 'vitest';
import { band, dhakaDay, dhakaTime, userLabel } from './format';

describe('admin format', () => {
  it('shows times in Asia/Dhaka, not UTC', () => {
    expect(dhakaTime('2026-10-04T20:30:00Z')).toBe('5 Oct, 02:30');
    expect(dhakaDay('2026-10-05')).toBe('5 Oct');
  });
  it('labels guests by id and accounts by email', () => {
    expect(userLabel({ id: 'abcdef123', email: '' })).toBe('Guest abcdef');
    expect(userLabel({ id: 'x', email: 'a@b.co' })).toBe('a@b.co');
    expect(band(null)).toBe('-');
  });
});
