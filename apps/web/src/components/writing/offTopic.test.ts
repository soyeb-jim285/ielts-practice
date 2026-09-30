import type { AnalysisResult } from '@server/ai/types';
import { describe, expect, it } from 'vitest';
import { capOffTopic } from './offTopic';

const make = (ta: number, over: Partial<AnalysisResult> = {}) =>
  ({ overall: 6.5, overallRaw: 6.5, range: [6, 7], criteria: { ta: { band: ta } }, errors: [], ...over }) as unknown as AnalysisResult;

describe('capOffTopic', () => {
  it('caps overall and range at TA + 1 when TA ≤ 4', () => {
    const { result, offTopic } = capOffTopic(make(4));
    expect(offTopic).toBe(true);
    expect(result).toMatchObject({ overall: 5, overallRaw: 5, range: [5, 5] });
  });
  it('flags a major relevance mistake but never raises the band', () => {
    const { result, offTopic } = capOffTopic(make(6, { errors: [{ category: 'task.relevance', severity: 'major' }] as AnalysisResult['errors'] }));
    expect(offTopic).toBe(true);
    expect(result.overall).toBe(6.5);
  });
  it('leaves on-topic and too-short answers alone', () => {
    expect(capOffTopic(make(6)).offTopic).toBe(false);
    expect(capOffTopic(make(1, { tooShort: true })).result.overall).toBe(6.5);
  });
});
