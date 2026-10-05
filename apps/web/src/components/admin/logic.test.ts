import type { TestHealth } from '@server/admin/schemas';
import { describe, expect, it } from 'vitest';
import { attentionItems, deltaChip, funnelRows, periodDelta, rankTests, relative } from './logic';

const t = (o: Partial<TestHealth>) => ({ id: 'x', skill: 'reading', part: null, title: 'T', source: 'generated', started: 1, finished: 1, completionRate: 1, avgBand: 6, avgRaw: 20, ...o }) as TestHealth;

describe('admin logic', () => {
  it('compares the last 7 values with the 7 before', () => {
    const v = [...Array(7).fill(1), ...Array(7).fill(2)];
    expect(periodDelta(v)).toEqual({ cur: 14, prev: 7, diff: 7 });
    expect(deltaChip(14, 7, 'vs prev 7 d')).toEqual({ value: '+7 vs prev 7 d', tone: 'good' });
    expect(deltaChip(3, 1, 'x', false).tone).toBe('bad');
    expect(deltaChip(2, 2, 'x').tone).toBe('neutral');
  });
  it('orders alerts worst first and is empty when all is well', () => {
    expect(attentionItems({ failed24h: 0, stuck: 0, emailFailed24h: 0, feedbackNew: 0 })).toEqual([]);
    const a = attentionItems({ failed24h: 2, stuck: 0, emailFailed24h: 1, feedbackNew: 1, balanceErrors: 2, forecast: { status: 'low', daysLeft: 6.4, burnPerDay7d: 0.82, remaining: 5 } });
    expect(a.map((x) => x.id)).toEqual(['failed', 'runway', 'email', 'feedback']);
    expect(a[0]!.text).toContain('2 from a low balance');
    expect(a[1]!.text).toBe('OpenRouter runs out in about 6 days at $0.82 a day.');
  });
  it('flags a funnel step that is bigger than the one above', () => {
    const r = funnelRows([{ label: 'a', users: 100 }, { label: 'b', users: 40 }, { label: 'c', users: 50 }]);
    expect(r.map((x) => x.notNested)).toEqual([false, false, true]);
    expect(r[1]!.fromPrev).toBe(0.4);
    expect(r[0]!.fromPrev).toBeNull();
  });
  it('ranks, searches and limits tests', () => {
    const rows = [t({ id: 'a', title: 'Alpha', started: 5, completionRate: 0.9 }), t({ id: 'b', title: 'Beta', started: 9, completionRate: 0.2, avgBand: null }), t({ id: 'c', title: 'Gamma', started: 1, source: 'cambridge', avgBand: 4 })];
    expect(rankTests(rows, { sort: 'started', limit: 2 }).items.map((x) => x.id)).toEqual(['b', 'a']);
    expect(rankTests(rows, { sort: 'completion', limit: 9 }).items[0]!.id).toBe('b');
    expect(rankTests(rows, { sort: 'band', limit: 9 }).items.map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(rankTests(rows, { sort: 'started', limit: 9, source: 'cambridge' }).total).toBe(1);
    expect(rankTests(rows, { sort: 'started', limit: 9, q: 'alp' }).items[0]!.id).toBe('a');
  });
  it('words relative times', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(relative('2026-10-06T11:50:00Z', now)).toBe('10 min ago');
    expect(relative('2026-10-04T12:00:00Z', now)).toBe('2 d ago');
    expect(relative('2026-08-01T12:00:00Z', now)).toBeNull();
  });
});
