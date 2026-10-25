import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { acknowledgeFairUse, blockerCopy, blockerFromQuota, blockerOf, fairUseAcknowledged, quotaText, resetPhrase, type Quota, type SkillQuota } from './community';

const NOW = Date.parse('2026-10-03T19:00:00Z');
const skill = (p: Partial<SkillQuota>): SkillQuota => ({ used: 0, limit: 1, remaining: 1, resetAt: '2026-10-04T00:00:00Z', window: 'day', blocked: null, ...p });

describe('reset phrase', () => {
  it('counts hours and minutes under a day', () => {
    expect(resetPhrase('2026-10-04T00:00:00Z', NOW)).toBe('in 5 h');
    expect(resetPhrase('2026-10-03T19:40:00Z', NOW)).toBe('in 40 min');
    expect(resetPhrase('2026-10-03T19:00:20Z', NOW)).toBe('in a moment');
  });
  it('rounds like the apps: minutes up, hours to the nearest', () => {
    expect(resetPhrase('2026-10-03T19:01:30Z', NOW)).toBe('in 2 min');
    expect(resetPhrase('2026-10-03T23:20:00Z', NOW)).toBe('in 4 h');
    expect(resetPhrase('2026-10-03T19:59:30Z', NOW)).toBe('in 1 h');
  });
  it('names the weekday and a 24-hour time beyond a day', () => {
    expect(resetPhrase('2026-10-05T00:00:00Z', NOW)).toMatch(/^[A-Z][a-z]+ \d{1,2}:\d{2}$/);
  });
});

describe('quota text', () => {
  it('says what is left, by window', () => {
    expect(quotaText(skill({}), NOW)).toEqual({ text: '1 test left today', warn: false });
    expect(quotaText(skill({ window: 'week', remaining: 2, limit: 3 }), NOW).text).toBe('2 tests left this week');
  });
  it('says when none is left and when it resets', () => {
    expect(quotaText(skill({ remaining: 0 }), NOW)).toEqual({ text: 'No tests left. Resets in 5 h', warn: true });
  });
  it('is unlimited without a limit', () => {
    expect(quotaText(skill({ limit: null, remaining: null, resetAt: null, window: null })).text).toBe('Unlimited');
  });
});

describe('blockers', () => {
  it('reads the code and extras off an API error', () => {
    const e = new ApiError(429, 'x', 'quota_exceeded', { skill: 'writing', resetAt: 'r', tier: 'guest' });
    expect(blockerOf(e)).toEqual({ code: 'quota_exceeded', skill: 'writing', resetAt: 'r', tier: 'guest' });
  });
  it('ignores errors that are not a limit', () => {
    expect(blockerOf(new ApiError(500, 'x'))).toBeNull();
    expect(blockerOf(new ApiError(403, 'x', 'account_required'))).toBeNull();
    expect(blockerOf(new Error('x'))).toBeNull();
  });
  it('takes the reason from /api/quota', () => {
    const q = { tier: 'community', speaking: skill({}), writing: skill({ remaining: 0, blocked: 'quota_exceeded' }) } as Quota;
    expect(blockerFromQuota(q, 'speaking')).toBeNull();
    expect(blockerFromQuota(q, 'writing')).toMatchObject({ code: 'quota_exceeded', skill: 'writing', tier: 'community' });
  });
  it('words guests and members differently', () => {
    expect(blockerCopy({ code: 'quota_exceeded', skill: 'examiner', tier: 'guest', resetAt: '2026-10-04T00:00:00Z' }, NOW)).toEqual({ title: "You've used all your live sessions for now", body: 'Your next one frees up in 5 h. Create a free account for more.' });
    expect(blockerCopy({ code: 'quota_exceeded', skill: 'writing', tier: 'community', resetAt: '2026-10-04T00:00:00Z' }, NOW)).toEqual({ title: "You've used all your writing tests for now", body: 'Your next one frees up in 5 h.' });
  });
});

describe('blocker copy', () => {
  it('keeps a scoring pause neutral', () => {
    expect(blockerCopy({ code: 'community_balance_exhausted', tier: 'community' }).body).toBe('Scoring is paused for a short while. Please try again later.');
    expect(JSON.stringify(blockerCopy({ code: 'community_balance_exhausted', tier: 'guest' }))).not.toMatch(/balance|key/i);
  });
});

describe('fair-use acknowledgement', () => {
  beforeEach(() => localStorage.clear());
  it('is remembered per person for the day', () => {
    expect(fairUseAcknowledged('u1')).toBe(false);
    acknowledgeFairUse('u1');
    expect(fairUseAcknowledged('u1')).toBe(true);
    expect(fairUseAcknowledged('u2')).toBe(false);
    expect(fairUseAcknowledged(null)).toBe(false);
  });
  it('expires with the UTC day', () => {
    localStorage.setItem('ielts.fairUse.u1', '2020-01-01');
    expect(fairUseAcknowledged('u1')).toBe(false);
  });
});

