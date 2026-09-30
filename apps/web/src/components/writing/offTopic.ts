import type { AnalysisResult } from '@server/ai/types';

/**
 * An off-topic answer (TR/TA ≤ 4, or a major task.relevance mistake) misses the question whatever the language criteria say,
 * so its overall is capped at one band above TR/TA. Returns the result with overall/range capped, and whether it is off topic.
 * ponytail: applied at display time; idempotent, so it stays correct once the server applies the same cap (see requests).
 */
export function capOffTopic(r: AnalysisResult): { result: AnalysisResult; offTopic: boolean } {
  const ta = r.criteria.ta?.band;
  const offTopic = !r.tooShort && ta != null && (ta <= 4 || r.errors.some((e) => e.category === 'task.relevance' && e.severity === 'major'));
  if (!offTopic) return { result: r, offTopic };
  const cap = ta + 1;
  return {
    offTopic,
    result: { ...r, overall: Math.min(r.overall, cap), overallRaw: Math.min(r.overallRaw, cap), range: [Math.min(r.range[0], cap), Math.min(r.range[1], cap)] },
  };
}
