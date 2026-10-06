import type { AnalysisResult } from '@server/ai/types';
import { describe, expect, it } from 'vitest';
import { bandSummary, lastTryLine, sinceLast } from './OverviewPanel';

const crit = (band: number) => ({ band, range: [band, band], summary: '', evidence: [], descriptor: '' });
const result = (overall: number, bands: number[]) =>
  ({ overall, criteria: { ta: crit(bands[0]!), cc: crit(bands[1]!), lr: crit(bands[2]!), gra: crit(bands[3]!) } }) as unknown as AnalysisResult;
const order = ['ta', 'cc', 'lr', 'gra'] as const;

describe('bandSummary', () => {
  it('names the criterion that pulls the overall down when the spread is 2 bands or more', () => {
    const s = bandSummary(result(7, [8, 7, 7, 6]), [...order]);
    expect(s.how).toMatch(/Overall 7\.0 is the average of these 4 bands/);
    expect(s.pulls).toBe('Grammar (6.0) pulls it down without capping it.');
    expect(s.weakest).toBe('gra');
  });
  it('stays quiet on a flat profile and marks no weakest criterion', () => {
    const s = bandSummary(result(7, [7, 7, 7, 7]), [...order]);
    expect(s.pulls).toBeNull();
    expect(s.weakest).toBeNull();
  });
  it('explains a cap instead of the average', () => {
    const s = bandSummary(result(5.5, [7, 7, 7, 7]), [...order], 'the essay is off topic');
    expect(s.how).toBe('Average of these 4 bands would be 7.0, capped at 5.5 because the essay is off topic.');
    expect(s.pulls).toBeNull();
  });
});

describe('retry wording', () => {
  it('states direction in words', () => {
    expect(lastTryLine(7, 6.5)).toBe('Up 0.5 from your last try (6.5)');
    expect(lastTryLine(6, 6.5)).toBe('Down 0.5 from your last try (6.5)');
    expect(lastTryLine(6.5, 6.5)).toBe('Same as your last try (6.5)');
    expect(sinceLast(1)).toBe('Up 1 since last try');
    expect(sinceLast(0)).toBe('Unchanged since last try');
  });
});
